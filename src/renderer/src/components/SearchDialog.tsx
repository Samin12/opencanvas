import { useEffect, useRef, useState } from 'react'

import type { FileTreeNode } from '@shared/types'

interface SearchDialogProps {
  files: FileTreeNode[]
  open: boolean
  onClose: () => void
  onSelect: (node: FileTreeNode) => void
}

export function SearchDialog({ files, open, onClose, onSelect }: SearchDialogProps) {
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
  const results = files
    .filter((file) =>
      normalizedQuery.length === 0
        ? true
        : `${file.name} ${file.path}`.toLowerCase().includes(normalizedQuery)
    )
    .slice(0, 40)

  return (
    <div className="absolute inset-0 z-[300] flex items-start justify-center bg-[color:var(--overlay)] px-6 py-20 backdrop-blur-sm">
      <div className="glass-panel w-full max-w-2xl rounded-[28px] p-4">
        <div className="mb-4 text-[11px] uppercase tracking-[0.25em] text-[var(--text-faint)]">
          Workspace Search
        </div>
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              onClose()
            }

            if (event.key === 'Enter' && results[0]) {
              onSelect(results[0])
            }
          }}
          className="w-full rounded-2xl border border-[color:var(--line)] bg-[var(--surface-0)] px-4 py-3 text-base text-[var(--text)] outline-none focus:border-[color:var(--accent)]"
          placeholder="Search files by name or path"
        />
        <div className="mt-4 max-h-[56vh] space-y-2 overflow-auto">
          {results.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[color:var(--line-strong)] bg-[var(--surface-1)] p-4 text-sm text-[var(--text-dim)]">
              No files match this query.
            </div>
          ) : (
            results.map((file) => (
              <button
                key={file.path}
                className="flex w-full items-start justify-between rounded-2xl border border-[color:var(--line)] bg-[var(--surface-0)] px-4 py-3 text-left transition hover:bg-[var(--surface-1)]"
                onClick={() => onSelect(file)}
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-[var(--text)]">{file.name}</div>
                  <div className="truncate text-xs text-[var(--text-dim)]">{file.path}</div>
                </div>
                <div className="rounded-full border border-[color:var(--line)] px-2 py-1 text-[10px] uppercase tracking-[0.25em] text-[var(--text-faint)]">
                  {file.fileKind}
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
