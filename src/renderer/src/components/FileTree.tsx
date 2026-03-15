import { useEffect, useState } from 'react'

import clsx from 'clsx'

import type { FileTreeNode } from '@shared/types'

interface FileTreeProps {
  activeFilePath: string | null
  darkMode: boolean
  nodes: FileTreeNode[]
  onPlaceFile: (node: FileTreeNode) => void
  onSelectFile: (node: FileTreeNode) => void
}

const INDENT = 14

export function FileTree({
  activeFilePath,
  darkMode,
  nodes,
  onPlaceFile,
  onSelectFile
}: FileTreeProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  useEffect(() => {
    const nextState: Record<string, boolean> = {}

    for (const node of nodes) {
      if (node.kind === 'directory') {
        nextState[node.path] = true
      }
    }

    setExpanded((current) => ({ ...nextState, ...current }))
  }, [nodes])

  function toggleDirectory(path: string) {
    setExpanded((current) => ({
      ...current,
      [path]: !current[path]
    }))
  }

  function renderNode(node: FileTreeNode, depth: number) {
    if (node.kind === 'directory') {
      const isExpanded = expanded[node.path] ?? true

      return (
        <div key={node.path}>
          <button
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-[var(--text-dim)] transition hover:bg-[var(--surface-1)]"
            style={{ paddingLeft: 12 + depth * INDENT }}
            onClick={() => toggleDirectory(node.path)}
          >
            <span className="text-xs text-[var(--text-faint)]">{isExpanded ? '▾' : '▸'}</span>
            <span className="rounded-md border border-[color:var(--line)] bg-[var(--surface-0)] px-1.5 py-0.5 text-[10px] uppercase tracking-[0.2em] text-[var(--text-faint)]">
              Dir
            </span>
            <span className="truncate">{node.name}</span>
          </button>
          {isExpanded ? (
            <div>{node.children?.map((child) => renderNode(child, depth + 1))}</div>
          ) : null}
        </div>
      )
    }

    return (
      <button
        key={node.path}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'copy'
          event.dataTransfer.setData(
            'application/x-collaborator-file',
            JSON.stringify({
              path: node.path,
              name: node.name,
              fileKind: node.fileKind
            })
          )
        }}
        className={clsx(
          'flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition',
          activeFilePath === node.path
            ? 'bg-[var(--surface-selected)] text-[var(--text)] ring-1 ring-[color:var(--line-strong)]'
            : 'text-[var(--text-dim)] hover:bg-[var(--surface-1)]'
        )}
        style={{ paddingLeft: 12 + depth * INDENT }}
        onClick={() => onSelectFile(node)}
        onDoubleClick={(event) => {
          event.preventDefault()
          onPlaceFile(node)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && event.shiftKey) {
            event.preventDefault()
            onPlaceFile(node)
          }
        }}
        title="Click to preview. Double-click or Shift+Enter to place on canvas."
      >
        <span
          className={clsx(
            'rounded-md border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.2em]',
            node.fileKind === 'note'
              ? darkMode
                ? 'border-lime-800/80 bg-lime-950/40 text-lime-300'
                : 'border-lime-200 bg-lime-50 text-lime-700'
              : node.fileKind === 'image'
                ? darkMode
                  ? 'border-sky-800/80 bg-sky-950/40 text-sky-300'
                  : 'border-sky-200 bg-sky-50 text-sky-700'
                : 'border-[color:var(--line)] bg-[var(--surface-0)] text-[var(--text-faint)]'
          )}
        >
          {node.fileKind}
        </span>
        <span className="truncate">{node.name}</span>
      </button>
    )
  }

  if (nodes.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[color:var(--line-strong)] bg-[var(--surface-1)] p-4 text-sm text-[var(--text-dim)]">
        This workspace is empty.
      </div>
    )
  }

  return <div className="space-y-1">{nodes.map((node) => renderNode(node, 0))}</div>
}
