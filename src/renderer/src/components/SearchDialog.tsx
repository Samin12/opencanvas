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
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!open) {
      setQuery('')
      return
    }

    const frame = window.requestAnimationFrame(() => inputRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [open])

  if (!open) {
    return null
  }

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

  return (
    <div className="absolute inset-0 z-[300] flex items-start justify-center bg-[color:var(--overlay)] px-6 py-20 backdrop-blur-sm">
      <div className="glass-panel w-full max-w-2xl rounded-[6px] p-5">
        <div className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">
          {heading}
        </div>
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              onClose()
            }

            if (event.key === 'Enter' && filteredResults[0]) {
              onSelect(filteredResults[0])
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
            filteredResults.map((result) => (
              <button
                key={`${result.workspacePath}:${result.file.path}`}
                className="flex w-full items-start justify-between gap-4 rounded-[4px] border border-[color:var(--line)] bg-[var(--surface-0)] px-4 py-3 text-left transition hover:border-[color:var(--line-strong)] hover:bg-[var(--surface-1)]"
                onClick={() => onSelect(result)}
                title={`Open preview for ${result.file.name}`}
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
