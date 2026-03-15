import { useEffect, useState } from 'react'

import clsx from 'clsx'

import type { FileTreeNode } from '@shared/types'

interface FileTreeProps {
  activeFilePath: string | null
  nodes: FileTreeNode[]
  onPlaceFile: (node: FileTreeNode) => void
  onSelectFile: (node: FileTreeNode) => void
}

const INDENT = 14

export function FileTree({ activeFilePath, nodes, onPlaceFile, onSelectFile }: FileTreeProps) {
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
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-white/70"
            style={{ paddingLeft: 12 + depth * INDENT }}
            onClick={() => toggleDirectory(node.path)}
          >
            <span className="text-xs text-slate-400">{isExpanded ? '▾' : '▸'}</span>
            <span className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] uppercase tracking-[0.2em] text-slate-400">
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
            ? 'bg-slate-200/70 text-slate-800 ring-1 ring-slate-300'
            : 'text-slate-700 hover:bg-white/70'
        )}
        style={{ paddingLeft: 12 + depth * INDENT }}
        onClick={() => onSelectFile(node)}
        onDoubleClick={() => onPlaceFile(node)}
        title="Click to preview. Double-click to place on canvas."
      >
        <span
          className={clsx(
            'rounded-md border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.2em]',
            node.fileKind === 'note'
              ? 'border-lime-200 bg-lime-50 text-lime-700'
              : node.fileKind === 'image'
                ? 'border-sky-200 bg-sky-50 text-sky-700'
                : 'border-slate-200 bg-white text-slate-500'
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
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 p-4 text-sm text-slate-500">
        This workspace is empty.
      </div>
    )
  }

  return <div className="space-y-1">{nodes.map((node) => renderNode(node, 0))}</div>
}
