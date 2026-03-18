import { useEffect, useRef, useState } from 'react'

import type { FileTreeNode } from '@shared/types'

export type SearchScope = 'workspace' | 'all-workspaces'

export interface SearchDialogResult {
  file: FileTreeNode
  workspacePath: string
}

interface SearchDialogProps {
  loading?: boolean
  open: boolean
  onClose: () => void
  onSelect: (result: SearchDialogResult) => void
  results: SearchDialogResult[]
  scope: SearchScope
}

function workspaceLabel(workspacePath: string) {
  const segments = workspacePath.split(/[\\/]/).filter(Boolean)
  return segments.at(-1) ?? workspacePath
}

export function SearchDialog({
  loading = false,
  open,
  onClose,
  onSelect,
  results,
  scope
}: SearchDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const resultRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [query, setQuery] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState(0)

  useEffect(() => {
    if (!open) {
      setQuery('')
      setHighlightedIndex(0)
      return
    }

    const frame = window.requestAnimationFrame(() => inputRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [open])

  const normalizedQuery = query.trim().toLowerCase()
  const filteredResults = results
    .filter((result) =>
      normalizedQuery.length === 0
        ? true
        : `${result.file.name} ${result.file.path} ${workspaceLabel(result.workspacePath)}`
            .toLowerCase()
            .includes(normalizedQuery)
    )
    .slice(0, 40)
  const isGlobalSearch = scope === 'all-workspaces'
  const heading = isGlobalSearch ? 'Opened Workspaces Search' : 'Workspace Search'
  const placeholder = isGlobalSearch
    ? 'Search files in any opened workspace'
    : 'Search files in the current workspace'
  const emptyMessage = isGlobalSearch
    ? 'No files match this query in your opened workspaces.'
    : 'No files match this query in the current workspace.'
  const activeIndex =
    filteredResults.length === 0 ? -1 : Math.min(highlightedIndex, filteredResults.length - 1)

  useEffect(() => {
    if (!open) {
      return
    }

    setHighlightedIndex((current) => {
      if (filteredResults.length === 0) {
        return 0
      }

      return Math.min(current, filteredResults.length - 1)
    })
  }, [filteredResults.length, open])

  useEffect(() => {
    if (activeIndex < 0) {
      return
    }

    resultRefs.current[activeIndex]?.scrollIntoView({
      block: 'nearest'
    })
  }, [activeIndex])

  if (!open) {
    return null
  }

  return (
    <div className="absolute inset-0 z-[300] flex items-start justify-center bg-[color:var(--overlay)] px-6 py-20 backdrop-blur-sm">
      <div className="glass-panel w-full max-w-2xl rounded-[6px] p-5">
        <div className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">
          {heading}
        </div>
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setHighlightedIndex(0)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              onClose()
              return
            }

            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setHighlightedIndex((current) =>
                filteredResults.length === 0
                  ? 0
                  : Math.min(current + 1, filteredResults.length - 1)
              )
              return
            }

            if (event.key === 'ArrowUp') {
              event.preventDefault()
              setHighlightedIndex((current) =>
                filteredResults.length === 0 ? 0 : Math.max(current - 1, 0)
              )
              return
            }

            if (event.key === 'Enter' && activeIndex >= 0 && filteredResults[activeIndex]) {
              event.preventDefault()
              onSelect(filteredResults[activeIndex])
            }
          }}
          className="w-full rounded-[4px] border border-[color:var(--line)] bg-[var(--surface-0)] px-4 py-3 text-[15px] text-[var(--text)] outline-none transition focus:border-[color:var(--accent)]"
          placeholder={placeholder}
        />
        <div className="mt-4 max-h-[56vh] space-y-2 overflow-auto">
          {loading ? (
            <div className="rounded-[4px] border border-dashed border-[color:var(--line-strong)] bg-[var(--surface-1)] p-4 text-sm text-[var(--text-dim)]">
              Indexing files…
            </div>
          ) : filteredResults.length === 0 ? (
            <div className="rounded-[4px] border border-dashed border-[color:var(--line-strong)] bg-[var(--surface-1)] p-4 text-sm text-[var(--text-dim)]">
              {emptyMessage}
            </div>
          ) : (
            filteredResults.map((result, index) => (
              <button
                key={`${result.workspacePath}:${result.file.path}`}
                ref={(node) => {
                  resultRefs.current[index] = node
                }}
                className={`flex w-full items-start justify-between gap-4 rounded-[4px] border px-4 py-3 text-left transition ${
                  index === activeIndex
                    ? 'border-[color:var(--accent)] bg-[var(--surface-1)]'
                    : 'border-[color:var(--line)] bg-[var(--surface-0)] hover:border-[color:var(--line-strong)] hover:bg-[var(--surface-1)]'
                }`}
                onClick={() => onSelect(result)}
                onMouseEnter={() => setHighlightedIndex(index)}
                title={`Open preview for ${result.file.name}`}
                aria-selected={index === activeIndex}
              >
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium text-[var(--text)]">
                    {result.file.name}
                  </div>
                  <div className="truncate text-xs text-[var(--text-dim)]">{result.file.path}</div>
                  {isGlobalSearch ? (
                    <div className="mt-1 truncate text-[11px] text-[var(--text-faint)]">
                      {workspaceLabel(result.workspacePath)}
                    </div>
                  ) : null}
                </div>
                <div className="rounded-[4px] border border-[color:var(--line)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
                  {result.file.fileKind}
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
