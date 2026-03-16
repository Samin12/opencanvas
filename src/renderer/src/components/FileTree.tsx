import {
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent
} from 'react'
import { createPortal } from 'react-dom'

import clsx from 'clsx'

import type { FileTreeNode } from '@shared/types'

interface FileTreeProps {
  activePath: string | null
  darkMode: boolean
  nodes: FileTreeNode[]
  onCreateWorkspaceDirectory: (targetDirectoryPath: string, directoryName: string) => void
  onCreateWorkspaceFile: (targetDirectoryPath: string, fileName: string) => void
  onCopyNodePath: (targetPath: string) => void
  onDeleteNode: (targetPath: string) => void
  onMoveFile: (sourcePath: string, targetDirectoryPath: string) => void
  onPlaceFile: (node: FileTreeNode) => void
  onRevealNodeInFinder: (targetPath: string) => void
  onRenameNode: (targetPath: string, nextName: string) => void
  onSelectNode: (node: FileTreeNode, options?: { preview?: boolean }) => void
  query: string
  rootDirectoryPath: string | null
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

function SpreadsheetIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="h-4 w-4 fill-none stroke-current stroke-[1.35] [stroke-linecap:round] [stroke-linejoin:round]"
    >
      <rect x="2.5" y="2.5" width="11" height="11" rx="1.6" />
      <path d="M2.75 6H13.25M6 2.75V13.25M9.75 2.75V13.25M2.75 9.75H13.25" />
    </svg>
  )
}

function PresentationIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="h-4 w-4 fill-none stroke-current stroke-[1.35] [stroke-linecap:round] [stroke-linejoin:round]"
    >
      <path d="M3.25 3.25H12.75V10.75H3.25Z" />
      <path d="M8 10.75V13.1M5.75 13.1H10.25" />
      <path d="M5.1 8.8 6.75 6.6 7.95 7.75 10.2 4.95 11.1 6.05" />
    </svg>
  )
}

function iconToneClasses(
  kind: 'directory' | 'note' | 'code' | 'image' | 'video' | 'pdf' | 'spreadsheet' | 'presentation',
  darkMode: boolean
) {
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

  if (kind === 'spreadsheet') {
    return darkMode ? 'text-[#9fe08f]' : 'text-[#4b9b3b]'
  }

  if (kind === 'presentation') {
    return darkMode ? 'text-[#f5b3ff]' : 'text-[#a650b1]'
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
    fileKind === 'note' ||
    fileKind === 'image' ||
    fileKind === 'video' ||
    fileKind === 'pdf' ||
    fileKind === 'spreadsheet' ||
    fileKind === 'presentation'
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
      ) : kind === 'spreadsheet' ? (
        <SpreadsheetIcon />
      ) : kind === 'presentation' ? (
        <PresentationIcon />
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

function normalizeFsPath(targetPath: string) {
  return targetPath.replace(/\\/g, '/').replace(/\/+$/, '')
}

function canMoveNodeIntoDirectory(sourcePath: string, targetDirectoryPath: string) {
  const normalizedSourcePath = normalizeFsPath(sourcePath)
  const normalizedTargetDirectoryPath = normalizeFsPath(targetDirectoryPath)

  if (normalizedSourcePath === normalizedTargetDirectoryPath) {
    return false
  }

  return !normalizedTargetDirectoryPath.startsWith(`${normalizedSourcePath}/`)
}

function parentDirectoryPath(nodePath: string) {
  const separatorIndex = Math.max(nodePath.lastIndexOf('/'), nodePath.lastIndexOf('\\'))
  return separatorIndex <= 0 ? null : nodePath.slice(0, separatorIndex)
}

function collectDirectoryPaths(nodes: FileTreeNode[]) {
  const directoryPaths: Record<string, boolean> = {}

  function visit(currentNodes: FileTreeNode[]) {
    for (const node of currentNodes) {
      if (node.kind !== 'directory') {
        continue
      }

      directoryPaths[node.path] = true
      visit(node.children ?? [])
    }
  }

  visit(nodes)

  return directoryPaths
}

interface TreeContextMenuState {
  directoryPath: string
  node: FileTreeNode | null
  x: number
  y: number
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
  onCreateWorkspaceDirectory,
  onCreateWorkspaceFile,
  onCopyNodePath,
  onDeleteNode,
  onMoveFile,
  onPlaceFile,
  onRevealNodeInFinder,
  onRenameNode,
  onSelectNode,
  query,
  rootDirectoryPath
}: FileTreeProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [draggedNodePath, setDraggedNodePath] = useState<string | null>(null)
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<TreeContextMenuState | null>(null)
  const draggedNodePathRef = useRef<string | null>(null)
  const trimmedQuery = query.trim().toLowerCase()
  const visibleNodes = trimmedQuery ? filterNodes(nodes, trimmedQuery) : nodes

  useEffect(() => {
    setExpanded((current) => ({ ...collectDirectoryPaths(nodes), ...current }))
  }, [nodes])

  useEffect(() => {
    if (!contextMenu) {
      return
    }

    function dismissMenu() {
      setContextMenu(null)
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        dismissMenu()
      }
    }

    document.addEventListener('pointerdown', dismissMenu)
    window.addEventListener('blur', dismissMenu)
    window.addEventListener('resize', dismissMenu)
    window.addEventListener('scroll', dismissMenu, true)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', dismissMenu)
      window.removeEventListener('blur', dismissMenu)
      window.removeEventListener('resize', dismissMenu)
      window.removeEventListener('scroll', dismissMenu, true)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [contextMenu])

  function toggleDirectory(path: string) {
    setExpanded((current) => ({
      ...current,
      [path]: !current[path]
    }))
  }

  function currentDraggedPath(dataTransfer: DataTransfer | null) {
    return draggedNodePathRef.current ?? draggedNodePath ?? getDraggedFilePayload(dataTransfer)?.path ?? null
  }

  function openContextMenu(event: ReactMouseEvent, node: FileTreeNode | null, directoryPath: string) {
    event.preventDefault()
    event.stopPropagation()

    if (node) {
      onSelectNode(node, { preview: false })
    }

    const menuWidth = 220
    const menuHeight = node ? 220 : 132
    const nextX = Math.min(event.clientX, Math.max(8, window.innerWidth - menuWidth - 12))
    const nextY = Math.min(event.clientY, Math.max(8, window.innerHeight - menuHeight - 12))

    setContextMenu({
      directoryPath,
      node,
      x: nextX,
      y: nextY
    })
  }

  function promptForNewFile(directoryPath: string) {
    setContextMenu(null)
    const fileName = window.prompt('New file name', 'untitled.md')

    if (!fileName?.trim()) {
      return
    }

    onCreateWorkspaceFile(directoryPath, fileName.trim())
  }

  function promptForNewFolder(directoryPath: string) {
    setContextMenu(null)
    const directoryName = window.prompt('New folder name', 'New Folder')

    if (!directoryName?.trim()) {
      return
    }

    onCreateWorkspaceDirectory(directoryPath, directoryName.trim())
  }

  function confirmDeleteNode(node: FileTreeNode) {
    setContextMenu(null)
    const confirmed = window.confirm(
      node.kind === 'directory'
        ? `Delete folder “${node.name}” and everything inside it?`
        : `Delete file “${node.name}”?`
    )

    if (!confirmed) {
      return
    }

    onDeleteNode(node.path)
  }

  function promptToRenameNode(node: FileTreeNode) {
    setContextMenu(null)
    const nextName = window.prompt('Rename', node.name)

    if (!nextName?.trim() || nextName.trim() === node.name) {
      return
    }

    onRenameNode(node.path, nextName.trim())
  }

  function copyNodePath(node: FileTreeNode) {
    setContextMenu(null)
    onCopyNodePath(node.path)
  }

  function revealNodeInFinder(node: FileTreeNode) {
    setContextMenu(null)
    onRevealNodeInFinder(node.path)
  }

  function startDraggingNode(event: ReactDragEvent, node: FileTreeNode) {
    draggedNodePathRef.current = node.path
    setDraggedNodePath(node.path)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(
      COLLABORATOR_FILE_MIME,
      JSON.stringify({
        path: node.path,
        name: node.name,
        fileKind: node.fileKind
      })
    )
  }

  function renderNode(node: FileTreeNode, depth: number) {
    if (node.kind === 'directory') {
      const isExpanded = trimmedQuery ? true : expanded[node.path] ?? true

      return (
        <div key={node.path}>
          <button
            draggable
            data-file-tree-node="true"
            className={clsx(
              'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px] font-medium text-[var(--text-dim)] transition',
              'rounded-[4px] border border-transparent hover:bg-[var(--surface-0)]',
              activePath === node.path &&
                'border-[color:var(--line)] bg-[var(--surface-selected)] text-[var(--text)]',
              dropTargetPath === node.path &&
                'border-[color:var(--line)] bg-[var(--surface-selected)] text-[var(--text)]'
            )}
            style={{ paddingLeft: 10 + depth * INDENT }}
            onMouseDown={(event) => {
              if (event.button === 2) {
                event.preventDefault()
                event.stopPropagation()
              }
            }}
            onClick={() => {
              onSelectNode(node)
              toggleDirectory(node.path)
            }}
            onContextMenu={(event) => openContextMenu(event, node, node.path)}
            title={`Toggle folder: ${node.name}`}
            onDragStart={(event) => startDraggingNode(event, node)}
            onDragEnd={() => {
              draggedNodePathRef.current = null
              setDraggedNodePath(null)
              setDropTargetPath(null)
            }}
            onDragOver={(event) => {
              const draggedPath = currentDraggedPath(event.dataTransfer)

              if (!draggedPath || !canMoveNodeIntoDirectory(draggedPath, node.path)) {
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
              const draggedPath = currentDraggedPath(event.dataTransfer)

              draggedNodePathRef.current = null
              setDraggedNodePath(null)
              setDropTargetPath(null)

              if (!draggedPath || !canMoveNodeIntoDirectory(draggedPath, node.path)) {
                return
              }

              event.preventDefault()
              event.stopPropagation()
              onMoveFile(draggedPath, node.path)
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
        data-file-tree-node="true"
        onDragStart={(event) => {
          startDraggingNode(event, node)
        }}
        onDragEnd={() => {
          draggedNodePathRef.current = null
          setDraggedNodePath(null)
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
        onMouseDown={(event) => {
          if (event.button === 2) {
            event.preventDefault()
            event.stopPropagation()
          }
        }}
        onClick={() => onSelectNode(node)}
        onContextMenu={(event) =>
          openContextMenu(event, node, parentDirectoryPath(node.path) ?? rootDirectoryPath ?? node.path)
        }
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
      <div
        className="rounded-[4px] border border-dashed border-[color:var(--line-strong)] bg-[var(--surface-0)] p-4 text-sm text-[var(--text-dim)]"
        onDragOver={(event) => {
          const draggedPath = currentDraggedPath(event.dataTransfer)

          if (!rootDirectoryPath || !draggedPath || !canMoveNodeIntoDirectory(draggedPath, rootDirectoryPath)) {
            return
          }

          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
          setDropTargetPath(rootDirectoryPath)
        }}
        onDragLeave={() => {
          if (dropTargetPath === rootDirectoryPath) {
            setDropTargetPath(null)
          }
        }}
        onDrop={(event) => {
          const draggedPath = currentDraggedPath(event.dataTransfer)

          draggedNodePathRef.current = null
          setDraggedNodePath(null)
          setDropTargetPath(null)

          if (!rootDirectoryPath || !draggedPath || !canMoveNodeIntoDirectory(draggedPath, rootDirectoryPath)) {
            return
          }

          event.preventDefault()
          onMoveFile(draggedPath, rootDirectoryPath)
        }}
        onContextMenu={(event) => {
          if (rootDirectoryPath) {
            openContextMenu(event, null, rootDirectoryPath)
          }
        }}
      >
        This workspace is empty.
      </div>
    )
  }

  if (visibleNodes.length === 0) {
    return (
      <div
        className="rounded-[4px] border border-dashed border-[color:var(--line-strong)] bg-[var(--surface-0)] p-4 text-sm text-[var(--text-dim)]"
        onDragOver={(event) => {
          const draggedPath = currentDraggedPath(event.dataTransfer)

          if (!rootDirectoryPath || !draggedPath || !canMoveNodeIntoDirectory(draggedPath, rootDirectoryPath)) {
            return
          }

          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
          setDropTargetPath(rootDirectoryPath)
        }}
        onDragLeave={() => {
          if (dropTargetPath === rootDirectoryPath) {
            setDropTargetPath(null)
          }
        }}
        onDrop={(event) => {
          const draggedPath = currentDraggedPath(event.dataTransfer)

          draggedNodePathRef.current = null
          setDraggedNodePath(null)
          setDropTargetPath(null)

          if (!rootDirectoryPath || !draggedPath || !canMoveNodeIntoDirectory(draggedPath, rootDirectoryPath)) {
            return
          }

          event.preventDefault()
          onMoveFile(draggedPath, rootDirectoryPath)
        }}
        onContextMenu={(event) => {
          if (rootDirectoryPath) {
            openContextMenu(event, null, rootDirectoryPath)
          }
        }}
      >
        No files or folders match <span className="text-[var(--text)]">“{query.trim()}”</span>.
      </div>
    )
  }

  return (
    <div
      className="space-y-0.5"
      onDragOver={(event) => {
        const target = event.target as HTMLElement | null

        if (target?.closest('[data-file-tree-node="true"]')) {
          return
        }

        const draggedPath = currentDraggedPath(event.dataTransfer)

        if (!rootDirectoryPath || !draggedPath || !canMoveNodeIntoDirectory(draggedPath, rootDirectoryPath)) {
          return
        }

        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'

        if (dropTargetPath !== rootDirectoryPath) {
          setDropTargetPath(rootDirectoryPath)
        }
      }}
      onDragLeave={(event) => {
        const relatedTarget = event.relatedTarget as Node | null

        if (relatedTarget && event.currentTarget.contains(relatedTarget)) {
          return
        }

        if (dropTargetPath === rootDirectoryPath) {
          setDropTargetPath(null)
        }
      }}
      onDrop={(event) => {
        const target = event.target as HTMLElement | null

        if (target?.closest('[data-file-tree-node="true"]')) {
          return
        }

        const draggedPath = currentDraggedPath(event.dataTransfer)

        draggedNodePathRef.current = null
        setDraggedNodePath(null)
        setDropTargetPath(null)

        if (!rootDirectoryPath || !draggedPath || !canMoveNodeIntoDirectory(draggedPath, rootDirectoryPath)) {
          return
        }

        event.preventDefault()
        onMoveFile(draggedPath, rootDirectoryPath)
      }}
      onContextMenu={(event) => {
        if (!rootDirectoryPath) {
          return
        }

        const target = event.target as HTMLElement | null

        if (target?.closest('[data-file-tree-node="true"]')) {
          return
        }

        openContextMenu(event, null, rootDirectoryPath)
      }}
    >
      {rootDirectoryPath && draggedNodePath ? (
        <div
          className={clsx(
            'mb-2 rounded-[6px] border border-dashed px-3 py-2 text-[11px] font-medium uppercase tracking-[0.14em] transition',
            dropTargetPath === rootDirectoryPath
              ? 'border-[color:var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
              : 'border-[color:var(--line-strong)] bg-[var(--surface-0)] text-[var(--text-faint)]'
          )}
        >
          Drop Here To Move To Workspace Root
        </div>
      ) : null}
      {visibleNodes.map((node) => renderNode(node, 0))}
      {contextMenu && typeof document !== 'undefined'
        ? createPortal(
        <div
          className="fixed z-[520] min-w-[220px] rounded-[8px] border border-[color:var(--line)] bg-[var(--surface-2)] p-1.5 shadow-[0_16px_40px_rgba(0,0,0,0.18)]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            className="flex w-full items-center justify-between rounded-[6px] px-3 py-2 text-left text-[12px] font-medium text-[var(--text)] transition hover:bg-[var(--surface-0)]"
            onClick={() => promptForNewFile(contextMenu.directoryPath)}
          >
            <span>New File</span>
            <span className="text-[var(--text-faint)]">+</span>
          </button>
          <button
            className="flex w-full items-center justify-between rounded-[6px] px-3 py-2 text-left text-[12px] font-medium text-[var(--text)] transition hover:bg-[var(--surface-0)]"
            onClick={() => promptForNewFolder(contextMenu.directoryPath)}
          >
            <span>New Folder</span>
            <span className="text-[var(--text-faint)]">+</span>
          </button>
          {contextMenu.node ? (
            <>
              <div className="my-1 h-px bg-[var(--line)]" />
              <button
                className="flex w-full items-center justify-between rounded-[6px] px-3 py-2 text-left text-[12px] font-medium text-[var(--text)] transition hover:bg-[var(--surface-0)]"
                onClick={() => copyNodePath(contextMenu.node!)}
              >
                <span>Copy Path</span>
                <span className="text-[var(--text-faint)]">⌘C</span>
              </button>
              <button
                className="flex w-full items-center justify-between rounded-[6px] px-3 py-2 text-left text-[12px] font-medium text-[var(--text)] transition hover:bg-[var(--surface-0)]"
                onClick={() => revealNodeInFinder(contextMenu.node!)}
              >
                <span>Open In Finder</span>
                <span className="text-[var(--text-faint)]">↗</span>
              </button>
              <button
                className="flex w-full items-center justify-between rounded-[6px] px-3 py-2 text-left text-[12px] font-medium text-[var(--text)] transition hover:bg-[var(--surface-0)]"
                onClick={() => promptToRenameNode(contextMenu.node!)}
              >
                <span>Rename</span>
                <span className="text-[var(--text-faint)]">↵</span>
              </button>
              <button
                className="flex w-full items-center justify-between rounded-[6px] px-3 py-2 text-left text-[12px] font-medium text-[var(--danger,#b95151)] transition hover:bg-[var(--surface-0)]"
                onClick={() => confirmDeleteNode(contextMenu.node!)}
              >
                <span>Delete</span>
                <span className="text-[var(--text-faint)]">⌫</span>
              </button>
            </>
          ) : null}
        </div>,
        document.body
      )
        : null}
    </div>
  )
}
