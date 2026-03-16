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
      <div className="glass-panel w-full max-w-2xl rounded-[6px] p-5">
        <div className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">
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
          className="w-full rounded-[4px] border border-[color:var(--line)] bg-[var(--surface-0)] px-4 py-3 text-[15px] text-[var(--text)] outline-none transition focus:border-[color:var(--accent)]"
          placeholder="Search files by name or path"
        />
        <div className="mt-4 max-h-[56vh] space-y-2 overflow-auto">
          {results.length === 0 ? (
            <div className="rounded-[4px] border border-dashed border-[color:var(--line-strong)] bg-[var(--surface-1)] p-4 text-sm text-[var(--text-dim)]">
              No files match this query.
            </div>
          ) : (
            results.map((file) => (
              <button
                key={file.path}
                className="flex w-full items-start justify-between gap-4 rounded-[4px] border border-[color:var(--line)] bg-[var(--surface-0)] px-4 py-3 text-left transition hover:border-[color:var(--line-strong)] hover:bg-[var(--surface-1)]"
                onClick={() => onSelect(file)}
                title={`Open preview for ${file.name}`}
              >
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium text-[var(--text)]">
                    {file.name}
                  </div>
                  <div className="truncate text-xs text-[var(--text-dim)]">{file.path}</div>
                </div>
                <div className="rounded-[4px] border border-[color:var(--line)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
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
