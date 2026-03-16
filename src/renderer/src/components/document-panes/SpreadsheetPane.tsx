import { useEffect, useMemo, useRef, useState } from 'react'

import Papa from 'papaparse'
import { getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'

import { ErrorPane, FileViewerSurface, LoadingPane, type ViewerVariant } from './FileViewerSurface'

import type { OfficeViewerBootstrap } from '@shared/types'

const LARGE_CSV_THRESHOLD_BYTES = 20 * 1024 * 1024

interface ParsedTable {
  columns: string[]
  rows: string[][]
}

function normalizeCell(value: unknown) {
  if (value == null) {
    return ''
  }

  return String(value)
}

function parseDelimitedTable(
  content: string,
  delimiter: '' | '\t'
): ParsedTable {
  const parsed = Papa.parse<string[]>(content, {
    delimiter,
    skipEmptyLines: false
  })

  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors[0]?.message || 'The table could not be parsed.')
  }

  const rawRows = (parsed.data as string[][]).map((row: string[]) => row.map(normalizeCell))
  const maxColumns = Math.max(0, ...rawRows.map((row: string[]) => row.length))
  const headerSource = rawRows[0] ?? []
  const columns = Array.from({ length: maxColumns }, (_value, index) => {
    const headerValue = headerSource[index]?.trim()
    return headerValue || `Column ${index + 1}`
  })
  const bodyRows = rawRows.slice(rawRows.length > 0 ? 1 : 0).map((row: string[]) =>
    Array.from({ length: maxColumns }, (_value, index) => row[index] ?? '')
  )

  return {
    columns,
    rows: bodyRows
  }
}

export function SpreadsheetPane({
  filePath,
  officeViewer: _officeViewer = null,
  refreshToken = 0,
  showTileRefreshButton = true,
  showViewerRefreshButton = true,
  variant = 'tile'
}: {
  filePath: string
  officeViewer?: OfficeViewerBootstrap | null
  refreshToken?: number
  showTileRefreshButton?: boolean
  showViewerRefreshButton?: boolean
  variant?: ViewerVariant
}) {
  const [mode, setMode] = useState<'loading' | 'table' | 'unsupported' | 'error'>('loading')
  const [reloadCount, setReloadCount] = useState(0)
  const [tableData, setTableData] = useState<ParsedTable | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (refreshToken > 0) {
      setReloadCount((current) => current + 1)
    }
  }, [refreshToken])

  useEffect(() => {
    let cancelled = false

    setMode('loading')
    setTableData(null)
    setErrorMessage(null)

    async function load() {
      try {
        const metadata = await window.collaborator.readFileMetadata(filePath)

        if (cancelled) {
          return
        }

        if (!['.csv', '.tsv'].includes(metadata.extension)) {
          setErrorMessage(
            'Spreadsheet preview is limited to CSV and TSV right now. Open this workbook externally.'
          )
          setMode('unsupported')
          return
        }

        if (metadata.size > LARGE_CSV_THRESHOLD_BYTES) {
          setErrorMessage(
            'Large table previews are disabled in-app to keep Open Canvas stable. Open this file externally.'
          )
          setMode('unsupported')
          return
        }

        const document = await window.collaborator.readTextFile(filePath)
        const parsedTable = parseDelimitedTable(document.content, metadata.extension === '.tsv' ? '\t' : '')

        if (!cancelled) {
          setTableData(parsedTable)
          setMode('table')
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error instanceof Error ? error.message : 'The spreadsheet could not be loaded.')
          setMode('error')
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [filePath, reloadCount])

  const columns = useMemo<ColumnDef<string[]>[]>(
    () =>
      (tableData?.columns ?? []).map((column, index) => ({
        accessorFn: (row) => row[index] ?? '',
        cell: (info) => info.getValue<string>(),
        header: column,
        id: `column-${index}`
      })),
    [tableData]
  )

  const table = useReactTable({
    columns,
    data: tableData?.rows ?? [],
    getCoreRowModel: getCoreRowModel()
  })

  const rowVirtualizer = useVirtualizer({
    count: table.getRowModel().rows.length,
    estimateSize: () => 38,
    getScrollElement: () => scrollRef.current,
    overscan: 8
  })

  if (mode === 'loading') {
    return <LoadingPane variant={variant} />
  }

  if (mode === 'unsupported' || mode === 'error' || !tableData) {
    return (
      <ErrorPane
        actions={
          <button
            className="rounded-[4px] border border-[color:var(--line-strong)] bg-[var(--surface-0)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-dim)] transition hover:bg-[var(--surface-1)] hover:text-[var(--text)]"
            onClick={() => {
              void window.collaborator.openPath(filePath)
            }}
          >
            Open externally
          </button>
        }
        message={errorMessage ?? 'This spreadsheet could not be opened.'}
        variant={variant}
      />
    )
  }

  const gridTemplateColumns = `repeat(${tableData.columns.length}, minmax(160px, 1fr))`
  const contentWidth = Math.max(tableData.columns.length * 180, variant === 'viewer' ? 920 : 680)

  return (
    <FileViewerSurface
      label="Spreadsheet Surface"
      onRefresh={() => setReloadCount((current) => current + 1)}
      showTileRefreshButton={showTileRefreshButton}
      showViewerRefreshButton={showViewerRefreshButton}
      statusLabel={`${tableData.rows.length} rows`}
      variant={variant}
    >
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto bg-[var(--surface-0)]"
        data-scroll-lock="true"
      >
        {tableData.rows.length === 0 ? (
          <div className="flex h-full min-h-[14rem] items-center justify-center text-sm text-[var(--text-dim)]">
            This sheet is empty.
          </div>
        ) : (
          <div className="min-w-full" style={{ width: `${contentWidth}px` }}>
            <div
              className="sticky top-0 z-10 grid border-b border-[color:var(--line)] bg-[var(--surface-1)]/96 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-dim)] backdrop-blur"
              style={{ gridTemplateColumns }}
            >
              {table.getFlatHeaders().map((header) => (
                <div
                  key={header.id}
                  className="border-r border-[color:var(--line)] px-3 py-2 last:border-r-0"
                >
                  {header.isPlaceholder ? null : String(header.column.columnDef.header)}
                </div>
              ))}
            </div>
            <div
              className="relative"
              style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const row = table.getRowModel().rows[virtualRow.index]

                return (
                  <div
                    key={row.id}
                    className="absolute left-0 top-0 grid w-full border-b border-[color:var(--line)] text-[13px] text-[var(--text)]"
                    style={{
                      gridTemplateColumns,
                      transform: `translateY(${virtualRow.start}px)`
                    }}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <div
                        key={cell.id}
                        className="border-r border-[color:var(--line)] px-3 py-2 leading-6 last:border-r-0"
                      >
                        {String(cell.getValue() ?? '')}
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </FileViewerSurface>
  )
}
