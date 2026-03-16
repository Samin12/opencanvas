import { useEffect, useState } from 'react'

import clsx from 'clsx'

import type { FileTreeNode } from '@shared/types'

interface FileTreeProps {
  activePath: string | null
  darkMode: boolean
  nodes: FileTreeNode[]
  query: string
  onMoveFile: (sourcePath: string, targetDirectoryPath: string) => void
  onPlaceFile: (node: FileTreeNode) => void
  onSelectNode: (node: FileTreeNode) => void
}

const INDENT = 12
const COLLABORATOR_FILE_MIME = 'application/x-collaborator-file'

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={clsx(
        'h-3.5 w-3.5 fill-none stroke-current stroke-[1.6] transition-transform',
        expanded ? 'rotate-90' : 'rotate-0'
      )}
    >
      <path d="m6 4.75 4 3.25-4 3.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function FolderIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="h-4 w-4 fill-none stroke-current stroke-[1.45] [stroke-linecap:round] [stroke-linejoin:round]"
    >
      <path d="M2.25 4.25A1.75 1.75 0 0 1 4 2.5H6.2L7.45 3.8H12A1.75 1.75 0 0 1 13.75 5.55V11.75A1.75 1.75 0 0 1 12 13.5H4A1.75 1.75 0 0 1 2.25 11.75V4.25Z" />
    </svg>
  )
}

function NoteIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="h-4 w-4 fill-none stroke-current stroke-[1.4] [stroke-linecap:round] [stroke-linejoin:round]"
    >
      <path d="M3 4.35C3 3.39 3.77 2.6 4.75 2.6H7.3C7.87 2.6 8.4 2.84 8.8 3.25C9.2 2.84 9.73 2.6 10.3 2.6H12.05C13.03 2.6 13.8 3.39 13.8 4.35V11.85C13.8 12.23 13.49 12.55 13.1 12.55H10.3C9.73 12.55 9.2 12.79 8.8 13.2C8.4 12.79 7.87 12.55 7.3 12.55H4.5C3.84 12.55 3.3 12.02 3.3 11.35V4.35H3Z" />
      <path d="M8.8 3.35V13.15" />
    </svg>
  )
}

function CodeIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="h-4 w-4 fill-none stroke-current stroke-[1.35] [stroke-linecap:round] [stroke-linejoin:round]"
    >
      <path d="M4 2.5H8.9L12.5 6.05V12A1.5 1.5 0 0 1 11 13.5H4A1.5 1.5 0 0 1 2.5 12V4A1.5 1.5 0 0 1 4 2.5Z" />
      <path d="M8.7 2.75V6H12" />
      <path d="M5.7 9.2 4.5 10.3 5.7 11.4" />
      <path d="M8 9.2 9.2 10.3 8 11.4" />
      <path d="M7.25 8.8 6.55 11.75" />
    </svg>
  )
}

function ImageIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="h-4 w-4 fill-none stroke-current stroke-[1.35] [stroke-linecap:round] [stroke-linejoin:round]"
    >
      <rect x="2.5" y="2.75" width="11" height="10.5" rx="1.5" />
      <circle cx="5.4" cy="5.55" r="0.9" />
      <path d="m4.2 11 2.25-2.5 1.65 1.55 2.15-2.35 1.55 1.9" />
    </svg>
  )
}

function VideoIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="h-4 w-4 fill-none stroke-current stroke-[1.35] [stroke-linecap:round] [stroke-linejoin:round]"
    >
      <rect x="2.5" y="3" width="8" height="10" rx="1.5" />
      <path d="M10.5 6.1 13.5 4.75V11.25L10.5 9.9" />
      <path d="M5.7 6.2 8.45 8 5.7 9.8V6.2Z" />
    </svg>
  )
}

function PdfIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="h-4 w-4 fill-none stroke-current stroke-[1.35] [stroke-linecap:round] [stroke-linejoin:round]"
    >
      <path d="M4 2.5H8.9L12.5 6.05V12A1.5 1.5 0 0 1 11 13.5H4A1.5 1.5 0 0 1 2.5 12V4A1.5 1.5 0 0 1 4 2.5Z" />
      <path d="M8.7 2.75V6H12" />
      <path d="M4.9 10.95h.85a.9.9 0 1 0 0-1.8H4.9v2.7" />
      <path d="M7.35 11.85V9.15H8a1.35 1.35 0 1 1 0 2.7h-.65Z" />
      <path d="M10.9 9.15H9.4v2.7" />
      <path d="M9.4 10.45H10.55" />
    </svg>
  )
}

function iconToneClasses(kind: 'directory' | 'note' | 'code' | 'image' | 'video' | 'pdf', darkMode: boolean) {
  if (kind === 'directory') {
    return darkMode ? 'text-[#d8d9d4]' : 'text-[#53584f]'
  }

  if (kind === 'note') {
    return darkMode ? 'text-[#49d8b4]' : 'text-[#149c73]'
  }

  if (kind === 'image') {
    return darkMode ? 'text-[#70d5ff]' : 'text-[#279dcd]'
  }

  if (kind === 'video') {
    return darkMode ? 'text-[#f6b26b]' : 'text-[#c76d28]'
  }

  if (kind === 'pdf') {
    return darkMode ? 'text-[#ff9d9d]' : 'text-[#c45151]'
  }

  return darkMode ? 'text-[#c1c5bd]' : 'text-[#70756c]'
}

export function FileKindIcon({
  darkMode,
  fileKind
}: {
  darkMode: boolean
  fileKind: FileTreeNode['fileKind']
}) {
  const kind =
    fileKind === 'note' || fileKind === 'image' || fileKind === 'video' || fileKind === 'pdf'
      ? fileKind
      : 'code'

  return (
    <span className={clsx('flex h-4.5 w-4.5 items-center justify-center', iconToneClasses(kind, darkMode))}>
      {kind === 'note' ? (
        <NoteIcon />
      ) : kind === 'image' ? (
        <ImageIcon />
      ) : kind === 'video' ? (
        <VideoIcon />
      ) : kind === 'pdf' ? (
        <PdfIcon />
      ) : (
        <CodeIcon />
      )}
    </span>
  )
}

function getDraggedFilePayload(dataTransfer: DataTransfer | null) {
  const rawPayload = dataTransfer?.getData(COLLABORATOR_FILE_MIME)

  if (!rawPayload) {
    return null
  }

  try {
    const payload = JSON.parse(rawPayload) as { path?: string }

    return typeof payload.path === 'string' ? { path: payload.path } : null
  } catch {
    return null
  }
}

function matchesQuery(node: FileTreeNode, query: string) {
  const haystack = `${node.name} ${node.path}`.toLowerCase()
  return haystack.includes(query)
}

function filterNodes(nodes: FileTreeNode[], query: string): FileTreeNode[] {
  return nodes.flatMap((node) => {
    if (node.kind === 'directory') {
      const children = filterNodes(node.children ?? [], query)

      if (matchesQuery(node, query) || children.length > 0) {
        return [
          {
            ...node,
            children
          }
        ]
      }

      return []
    }

    return matchesQuery(node, query) ? [node] : []
  })
}

export function FileTree({
  activePath,
  darkMode,
  nodes,
  query,
  onMoveFile,
  onPlaceFile,
  onSelectNode
}: FileTreeProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null)
  const trimmedQuery = query.trim().toLowerCase()
  const visibleNodes = trimmedQuery ? filterNodes(nodes, trimmedQuery) : nodes

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
      const isExpanded = trimmedQuery ? true : expanded[node.path] ?? true

      return (
        <div key={node.path}>
          <button
            className={clsx(
              'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px] font-medium text-[var(--text-dim)] transition',
              'rounded-[4px] border border-transparent hover:bg-[var(--surface-0)]',
              activePath === node.path &&
                'border-[color:var(--line)] bg-[var(--surface-selected)] text-[var(--text)]',
              dropTargetPath === node.path &&
                'border-[color:var(--line)] bg-[var(--surface-selected)] text-[var(--text)]'
            )}
            style={{ paddingLeft: 10 + depth * INDENT }}
            onClick={() => {
              onSelectNode(node)
              toggleDirectory(node.path)
            }}
            title={`Toggle folder: ${node.name}`}
            onDragOver={(event) => {
              const draggedFile = getDraggedFilePayload(event.dataTransfer)

              if (!draggedFile || draggedFile.path === node.path) {
                return
              }

              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'

              if (dropTargetPath !== node.path) {
                setDropTargetPath(node.path)
              }
            }}
            onDragLeave={(event) => {
              const relatedTarget = event.relatedTarget as Node | null

              if (relatedTarget && event.currentTarget.contains(relatedTarget)) {
                return
              }

              if (dropTargetPath === node.path) {
                setDropTargetPath(null)
              }
            }}
            onDrop={(event) => {
              const draggedFile = getDraggedFilePayload(event.dataTransfer)

              setDropTargetPath(null)

              if (!draggedFile) {
                return
              }

              event.preventDefault()
              event.stopPropagation()
              onMoveFile(draggedFile.path, node.path)
            }}
          >
            <span className="text-[var(--text-faint)]">
              <ChevronIcon expanded={isExpanded} />
            </span>
            <span className={clsx('flex h-4.5 w-4.5 items-center justify-center', iconToneClasses('directory', darkMode))}>
              <FolderIcon />
            </span>
            <span className="min-w-0 flex-1 truncate">
              {node.name}
            </span>
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
          event.dataTransfer.effectAllowed = 'copyMove'
          event.dataTransfer.setData(
            COLLABORATOR_FILE_MIME,
            JSON.stringify({
              path: node.path,
              name: node.name,
              fileKind: node.fileKind
            })
          )
        }}
        onDragEnd={() => {
          setDropTargetPath(null)
        }}
        className={clsx(
          'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px] font-medium transition',
          'rounded-[4px] border border-transparent',
          activePath === node.path
            ? 'border-[color:var(--line)] bg-[var(--surface-selected)] text-[var(--text)]'
            : 'text-[var(--text-dim)] hover:bg-[var(--surface-0)]'
        )}
        style={{ paddingLeft: 10 + depth * INDENT }}
        onClick={() => onSelectNode(node)}
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
        title={`Preview ${node.name}. Double-click or Shift+Enter to place it on the canvas.`}
      >
        <FileKindIcon darkMode={darkMode} fileKind={node.fileKind} />
        <span className="min-w-0 flex-1 truncate">
          {node.name}
        </span>
      </button>
    )
  }

  if (nodes.length === 0) {
    return (
      <div className="rounded-[4px] border border-dashed border-[color:var(--line-strong)] bg-[var(--surface-0)] p-4 text-sm text-[var(--text-dim)]">
        This workspace is empty.
      </div>
    )
  }

  if (visibleNodes.length === 0) {
    return (
      <div className="rounded-[4px] border border-dashed border-[color:var(--line-strong)] bg-[var(--surface-0)] p-4 text-sm text-[var(--text-dim)]">
        No files or folders match <span className="text-[var(--text)]">“{query.trim()}”</span>.
      </div>
    )
  }

  return <div className="space-y-0.5">{visibleNodes.map((node) => renderNode(node, 0))}</div>
}
