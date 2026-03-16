import { useEffect, useState } from 'react'

import clsx from 'clsx'

import type { FileTreeNode } from '@shared/types'

interface FileTreeProps {
  activePath: string | null
  darkMode: boolean
  nodes: FileTreeNode[]
  onMoveFile: (sourcePath: string, targetDirectoryPath: string) => void
  onPlaceFile: (node: FileTreeNode) => void
  onSelectNode: (node: FileTreeNode) => void
}

const INDENT = 14
const COLLABORATOR_FILE_MIME = 'application/x-collaborator-file'

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={clsx(
        'h-3.5 w-3.5 fill-none stroke-current stroke-[1.7] transition-transform',
        expanded ? 'rotate-90' : 'rotate-0'
      )}
    >
      <path d="M6 3.5L10.5 8L6 12.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-[1.35]">
      <path
        d="M2.25 4.25A1.75 1.75 0 0 1 4 2.5H6.4L7.6 3.85H12A1.75 1.75 0 0 1 13.75 5.6V11.75A1.75 1.75 0 0 1 12 13.5H4A1.75 1.75 0 0 1 2.25 11.75V4.25Z"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function NoteIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-[1.35]">
      <path
        d="M4 2.25H9.25L12.5 5.5V12A1.75 1.75 0 0 1 10.75 13.75H4A1.75 1.75 0 0 1 2.25 12V4A1.75 1.75 0 0 1 4 2.25Z"
        strokeLinejoin="round"
      />
      <path d="M9 2.75V5.75H12" strokeLinejoin="round" />
      <path d="M5 8H9.5M5 10.5H8" strokeLinecap="round" />
    </svg>
  )
}

function CodeIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-[1.35]">
      <path d="M6 4L3 8L6 12" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 4L13 8L10 12" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.75 3.5L7.25 12.5" strokeLinecap="round" />
    </svg>
  )
}

function ImageIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-[1.35]">
      <rect x="2.25" y="2.5" width="11.5" height="11" rx="2" />
      <circle cx="5.4" cy="5.6" r="1.05" />
      <path d="M3.75 11L6.85 7.9L8.8 9.85L10.4 8.25L12.25 10.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function iconToneClasses(kind: 'directory' | 'note' | 'code' | 'image', darkMode: boolean) {
  if (kind === 'directory') {
    return darkMode
      ? 'border-amber-500/25 bg-[rgba(120,53,15,0.16)] text-amber-200'
      : 'border-amber-300/80 bg-amber-50 text-amber-800'
  }

  if (kind === 'note') {
    return darkMode
      ? 'border-lime-500/25 bg-[rgba(63,98,18,0.16)] text-lime-200'
      : 'border-lime-300/80 bg-lime-50 text-lime-800'
  }

  if (kind === 'image') {
    return darkMode
      ? 'border-sky-500/25 bg-[rgba(7,89,133,0.16)] text-sky-200'
      : 'border-sky-300/80 bg-sky-50 text-sky-800'
  }

  return darkMode
    ? 'border-slate-500/25 bg-[rgba(30,41,59,0.26)] text-slate-300'
    : 'border-[color:var(--line)] bg-[var(--surface-0)] text-[var(--text-faint)]'
}

function FileKindIcon({ darkMode, fileKind }: { darkMode: boolean; fileKind: FileTreeNode['fileKind'] }) {
  const kind = fileKind === 'note' || fileKind === 'image' ? fileKind : 'code'

  return (
    <span
      className={clsx(
        'flex h-6 w-6 items-center justify-center rounded-[6px] border',
        iconToneClasses(kind, darkMode)
      )}
    >
      {kind === 'note' ? <NoteIcon /> : kind === 'image' ? <ImageIcon /> : <CodeIcon />}
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

export function FileTree({
  activePath,
  darkMode,
  nodes,
  onMoveFile,
  onPlaceFile,
  onSelectNode
}: FileTreeProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null)

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
            className={clsx(
              'flex w-full items-center gap-2.5 rounded-[8px] px-3 py-2.5 text-left text-[13px] text-[var(--text-dim)] transition hover:bg-[var(--surface-1)]',
              activePath === node.path &&
                'bg-[var(--surface-selected)] text-[var(--text)] ring-1 ring-[color:var(--line-strong)]',
              dropTargetPath === node.path &&
                'bg-[var(--surface-selected)] text-[var(--text)] ring-1 ring-[color:var(--line-strong)]'
            )}
            style={{ paddingLeft: 12 + depth * INDENT }}
            onClick={() => {
              onSelectNode(node)
              toggleDirectory(node.path)
            }}
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
            <span
              className={clsx(
                'flex h-6 w-6 items-center justify-center rounded-[6px] border',
                iconToneClasses('directory', darkMode)
              )}
            >
              <FolderIcon />
            </span>
            <span className="truncate font-['IBM_Plex_Mono','SFMono-Regular','Menlo',monospace]">
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
          'flex w-full items-center gap-2.5 rounded-[8px] px-3 py-2.5 text-left text-[13px] transition',
          activePath === node.path
            ? 'bg-[var(--surface-selected)] text-[var(--text)] ring-1 ring-[color:var(--line-strong)]'
            : 'text-[var(--text-dim)] hover:bg-[var(--surface-1)]'
        )}
        style={{ paddingLeft: 12 + depth * INDENT }}
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
        title="Click to preview. Double-click or Shift+Enter to place on canvas."
      >
        <FileKindIcon darkMode={darkMode} fileKind={node.fileKind} />
        <span className="truncate font-['IBM_Plex_Mono','SFMono-Regular','Menlo',monospace]">
          {node.name}
        </span>
      </button>
    )
  }

  if (nodes.length === 0) {
    return (
      <div className="rounded-[8px] border border-dashed border-[color:var(--line-strong)] bg-[var(--surface-1)] p-4 text-sm text-[var(--text-dim)]">
        This workspace is empty.
      </div>
    )
  }

  return (
    <div className="space-y-1 font-['IBM_Plex_Mono','SFMono-Regular','Menlo',monospace]">
      {nodes.map((node) => renderNode(node, 0))}
    </div>
  )
}
