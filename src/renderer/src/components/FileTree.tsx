import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent
} from 'react'
import { createPortal } from 'react-dom'

import clsx from 'clsx'

import type { FileTreeNode } from '@shared/types'
import {
  externalDownloadFromDataTransfer,
  externalPathsFromDataTransfer,
  hasExternalPathPayload
} from '../utils/externalDropPaths'
import {
  PLACE_ON_CANVAS_SHORTCUT_KEY,
  TREE_COLLAPSE_ALL_SHORTCUT_KEY,
  TREE_EXPAND_ALL_SHORTCUT_KEY
} from '../utils/navigatorShortcuts'

interface FileTreeProps {
  activePath: string | null
  collapseAllVersion?: number
  darkMode: boolean
  expandAllVersion?: number
  focusVersion?: number
  keyboardActive?: boolean
  nodes: FileTreeNode[]
  onCreateWorkspaceDirectory: (targetDirectoryPath: string, directoryName: string) => void
  onCreateWorkspaceFile: (targetDirectoryPath: string, fileName: string) => void
  onCopyNodePath: (targetPath: string) => void
  onDeleteNode: (targetPath: string) => void
  onImportExternalDownload: (
    download: { fileName?: string; mimeType?: string | null; url: string },
    targetDirectoryPath: string | null
  ) => void
  onImportExternalPaths: (sourcePaths: string[], targetDirectoryPath: string | null) => void
  onMoveFile: (sourcePath: string, targetDirectoryPath: string) => void
  onPlaceFile: (node: FileTreeNode) => void
  onPlaceFileAtPoint: (node: FileTreeNode, clientX: number, clientY: number) => void
  onRevealNodeInFinder: (targetPath: string) => void
  onRenameNode: (targetPath: string, nextName: string) => void
  onSelectNode: (node: FileTreeNode, options?: { preview?: boolean }) => void
  query: string
  rootDirectoryPath: string | null
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={clsx(
        'h-3 w-3 fill-none stroke-current stroke-[1.45] transition-transform',
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
      className="h-3.5 w-3.5 fill-none stroke-current stroke-[1.35] [stroke-linecap:round] [stroke-linejoin:round]"
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
      className="h-3.5 w-3.5 fill-none stroke-current stroke-[1.3] [stroke-linecap:round] [stroke-linejoin:round]"
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
      className="h-3.5 w-3.5 fill-none stroke-current stroke-[1.28] [stroke-linecap:round] [stroke-linejoin:round]"
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
      className="h-3.5 w-3.5 fill-none stroke-current stroke-[1.28] [stroke-linecap:round] [stroke-linejoin:round]"
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
      className="h-3.5 w-3.5 fill-none stroke-current stroke-[1.28] [stroke-linecap:round] [stroke-linejoin:round]"
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
      className="h-3.5 w-3.5 fill-none stroke-current stroke-[1.28] [stroke-linecap:round] [stroke-linejoin:round]"
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
      className="h-3.5 w-3.5 fill-none stroke-current stroke-[1.28] [stroke-linecap:round] [stroke-linejoin:round]"
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
      className="h-3.5 w-3.5 fill-none stroke-current stroke-[1.28] [stroke-linecap:round] [stroke-linejoin:round]"
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
    return darkMode ? 'text-[#66d1ae]' : 'text-[#1a8a67]'
  }

  if (kind === 'image') {
    return darkMode ? 'text-[#7cc8ea]' : 'text-[#3e91b6]'
  }

  if (kind === 'video') {
    return darkMode ? 'text-[#e0b073]' : 'text-[#ae7640]'
  }

  if (kind === 'pdf') {
    return darkMode ? 'text-[#e79d9d]' : 'text-[#b56666]'
  }

  if (kind === 'spreadsheet') {
    return darkMode ? 'text-[#9acc92]' : 'text-[#5d9460]'
  }

  if (kind === 'presentation') {
    return darkMode ? 'text-[#d8b2de]' : 'text-[#9a6aa3]'
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
    <span className={clsx('flex h-3.5 w-3.5 items-center justify-center', iconToneClasses(kind, darkMode))}>
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

function directoryExpansionState(nodes: FileTreeNode[], expanded: boolean) {
  const directoryPaths = collectDirectoryPaths(nodes)

  return Object.fromEntries(Object.keys(directoryPaths).map((path) => [path, expanded]))
}

interface VisibleTreeEntry {
  depth: number
  node: FileTreeNode
  parentPath: string | null
}

function findAncestorDirectoryPaths(
  nodes: FileTreeNode[],
  targetPath: string,
  ancestors: string[] = []
): string[] | null {
  for (const node of nodes) {
    if (node.path === targetPath) {
      return ancestors
    }

    if (node.kind !== 'directory' || !node.children?.length) {
      continue
    }

    const nestedAncestors = findAncestorDirectoryPaths(node.children, targetPath, [...ancestors, node.path])

    if (nestedAncestors) {
      return nestedAncestors
    }
  }

  return null
}

function visibleTreeEntries(
  nodes: FileTreeNode[],
  expanded: Record<string, boolean>,
  queryActive: boolean,
  depth = 0,
  parentPath: string | null = null
): VisibleTreeEntry[] {
  return nodes.flatMap((node) => {
    const currentEntry: VisibleTreeEntry = {
      depth,
      node,
      parentPath
    }

    if (node.kind !== 'directory') {
      return [currentEntry]
    }

    const isExpanded = queryActive ? true : expanded[node.path] ?? true

    return [
      currentEntry,
      ...(isExpanded
        ? visibleTreeEntries(node.children ?? [], expanded, queryActive, depth + 1, node.path)
        : [])
    ]
  })
}

interface TreeContextMenuState {
  directoryPath: string
  node: FileTreeNode | null
  x: number
  y: number
}

interface TreeInputDialogState {
  confirmLabel: string
  directoryPath?: string
  mode: 'create-file' | 'create-folder' | 'rename'
  node?: FileTreeNode
  title: string
  value: string
}

interface PointerDragState {
  active: boolean
  currentX: number
  currentY: number
  sourceFileKind?: FileTreeNode['fileKind']
  sourceKind: FileTreeNode['kind']
  sourceName: string
  sourcePath: string
  startX: number
  startY: number
}

function displayFileNameParts(node: FileTreeNode) {
  const extension = node.extension?.trim().toLowerCase() ?? ''

  if (node.kind !== 'file' || !extension || !node.name.toLowerCase().endsWith(extension)) {
    return {
      extensionLabel: null,
      stem: node.name
    }
  }

  return {
    extensionLabel: extension.startsWith('.') ? extension.slice(1) : extension,
    stem: node.name.slice(0, -extension.length) || node.name
  }
}

function defaultFileNameSelectionEnd(fileName: string) {
  const trimmedName = fileName.trim()
  const lastDotIndex = trimmedName.lastIndexOf('.')

  if (lastDotIndex <= 0) {
    return trimmedName.length
  }

  return lastDotIndex
}

function dialogSelectionRange(dialog: TreeInputDialogState) {
  if (dialog.mode === 'rename' && dialog.node?.kind === 'file') {
    return {
      end: displayFileNameParts(dialog.node).stem.length,
      start: 0
    }
  }

  if (dialog.mode === 'create-file') {
    return {
      end: defaultFileNameSelectionEnd(dialog.value),
      start: 0
    }
  }

  return {
    end: dialog.value.length,
    start: 0
  }
}

function directChildCount(node: FileTreeNode) {
  return node.kind === 'directory' ? node.children?.length ?? 0 : 0
}

function directoryNameTone(nodeName: string, darkMode: boolean) {
  if (!nodeName.startsWith('.')) {
    return 'text-[var(--text)]'
  }

  return darkMode ? 'text-[#c9bb98]' : 'text-[#8a7751]'
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
  collapseAllVersion = 0,
  darkMode,
  expandAllVersion = 0,
  focusVersion = 0,
  keyboardActive = false,
  nodes,
  onCreateWorkspaceDirectory,
  onCreateWorkspaceFile,
  onCopyNodePath,
  onDeleteNode,
  onImportExternalDownload,
  onImportExternalPaths,
  onMoveFile,
  onPlaceFile,
  onPlaceFileAtPoint,
  onRevealNodeInFinder,
  onRenameNode,
  onSelectNode,
  query,
  rootDirectoryPath
}: FileTreeProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [dragState, setDragState] = useState<PointerDragState | null>(null)
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null)
  const [externalDragActive, setExternalDragActive] = useState(false)
  const [externalDropTargetPath, setExternalDropTargetPath] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<TreeContextMenuState | null>(null)
  const [inputDialog, setInputDialog] = useState<TreeInputDialogState | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<FileTreeNode | null>(null)
  const [focusedPath, setFocusedPath] = useState<string | null>(activePath)
  const dragStateRef = useRef<PointerDragState | null>(null)
  const externalDragDepthRef = useRef(0)
  const expandTimerRef = useRef<number | null>(null)
  const contextMenuRef = useRef<HTMLDivElement | null>(null)
  const dialogInputRef = useRef<HTMLInputElement | null>(null)
  const treeRootRef = useRef<HTMLDivElement | null>(null)
  const rowRefs = useRef(new Map<string, HTMLButtonElement>())
  const suppressClickRef = useRef(false)
  const trimmedQuery = query.trim().toLowerCase()
  const visibleNodes = trimmedQuery ? filterNodes(nodes, trimmedQuery) : nodes
  const queryActive = trimmedQuery.length > 0
  const flatVisibleEntries = useMemo(
    () => visibleTreeEntries(visibleNodes, expanded, queryActive),
    [expanded, queryActive, visibleNodes]
  )

  useEffect(() => {
    setExpanded((current) => ({ ...collectDirectoryPaths(nodes), ...current }))
  }, [nodes])

  useEffect(() => {
    setExpanded(directoryExpansionState(nodes, false))
  }, [collapseAllVersion])

  useEffect(() => {
    setExpanded(directoryExpansionState(nodes, true))
  }, [expandAllVersion])

  useEffect(() => {
    if (!activePath) {
      return
    }

    const ancestorPaths = findAncestorDirectoryPaths(nodes, activePath)

    if (!ancestorPaths?.length) {
      return
    }

    setExpanded((current) => {
      let changed = false
      const nextExpanded = { ...current }

      for (const path of ancestorPaths) {
        if (!nextExpanded[path]) {
          nextExpanded[path] = true
          changed = true
        }
      }

      return changed ? nextExpanded : current
    })
  }, [activePath, nodes])

  useEffect(() => {
    if (keyboardActive) {
      return
    }

    const activeElement = document.activeElement

    if (activeElement instanceof HTMLElement && treeRootRef.current?.contains(activeElement)) {
      activeElement.blur()
    }
  }, [keyboardActive])

  useEffect(() => {
    if (focusVersion === 0) {
      return
    }

    const targetPath =
      (activePath && flatVisibleEntries.some((entry) => entry.node.path === activePath) ? activePath : null) ??
      flatVisibleEntries[0]?.node.path ??
      null

    setFocusedPath(targetPath)

    window.requestAnimationFrame(() => {
      if (targetPath) {
        const row = rowRefs.current.get(targetPath)

        if (row) {
          row.focus()
          row.scrollIntoView({
            block: 'nearest'
          })
          return
        }
      }

      treeRootRef.current?.focus()
    })
  }, [activePath, flatVisibleEntries, focusVersion])

  useEffect(() => {
    if (focusedPath && flatVisibleEntries.some((entry) => entry.node.path === focusedPath)) {
      return
    }

    const nextFocusedPath =
      (activePath && flatVisibleEntries.some((entry) => entry.node.path === activePath) ? activePath : null) ??
      flatVisibleEntries[0]?.node.path ??
      null

    setFocusedPath(nextFocusedPath)
  }, [activePath, flatVisibleEntries, focusedPath])

  useEffect(() => {
    dragStateRef.current = dragState
  }, [dragState])

  useEffect(() => {
    return () => {
      if (expandTimerRef.current !== null) {
        window.clearTimeout(expandTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    function handleWindowDrop() {
      clearExternalDragState()
    }

    window.addEventListener('dragend', handleWindowDrop)
    window.addEventListener('drop', handleWindowDrop)

    return () => {
      window.removeEventListener('dragend', handleWindowDrop)
      window.removeEventListener('drop', handleWindowDrop)
    }
  }, [])

  useEffect(() => {
    if (!contextMenu) {
      return
    }

    function dismissMenu() {
      setContextMenu(null)
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null

      if (target && contextMenuRef.current?.contains(target)) {
        return
      }

      dismissMenu()
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        dismissMenu()
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('blur', dismissMenu)
    window.addEventListener('resize', dismissMenu)
    window.addEventListener('scroll', dismissMenu, true)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('blur', dismissMenu)
      window.removeEventListener('resize', dismissMenu)
      window.removeEventListener('scroll', dismissMenu, true)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [contextMenu])

  useLayoutEffect(() => {
    if (!contextMenu || !contextMenuRef.current) {
      return
    }

    const rect = contextMenuRef.current.getBoundingClientRect()
    const nextX = Math.max(8, Math.min(contextMenu.x, window.innerWidth - rect.width - 12))
    const nextY = Math.max(8, Math.min(contextMenu.y, window.innerHeight - rect.height - 12))

    if (nextX !== contextMenu.x || nextY !== contextMenu.y) {
      setContextMenu((current) =>
        current
          ? {
              ...current,
              x: nextX,
              y: nextY
            }
          : current
      )
    }
  }, [contextMenu])

  useEffect(() => {
    if (!inputDialog) {
      return
    }

    const frameId = window.requestAnimationFrame(() => {
      const input = dialogInputRef.current

      if (!input) {
        return
      }

      const selection = dialogSelectionRange(inputDialog)

      input.focus()
      input.setSelectionRange(selection.start, selection.end)
    })

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [inputDialog?.directoryPath, inputDialog?.mode, inputDialog?.node?.path, inputDialog?.title])

  useEffect(() => {
    if (!inputDialog && !deleteTarget) {
      return
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setInputDialog(null)
        setDeleteTarget(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [deleteTarget, inputDialog])

  function toggleDirectory(path: string) {
    setExpanded((current) => ({
      ...current,
      [path]: !current[path]
    }))
  }

  function clearPendingExpand() {
    if (expandTimerRef.current !== null) {
      window.clearTimeout(expandTimerRef.current)
      expandTimerRef.current = null
    }
  }

  function scheduleDirectoryExpand(path: string, shouldExpand: boolean) {
    clearPendingExpand()

    if (!shouldExpand || trimmedQuery) {
      return
    }

    expandTimerRef.current = window.setTimeout(() => {
      setExpanded((current) => (current[path] ? current : { ...current, [path]: true }))
      expandTimerRef.current = null
    }, 320)
  }

  function consumeSuppressedClick() {
    if (!suppressClickRef.current) {
      return false
    }

    suppressClickRef.current = false
    return true
  }

  function setRowRef(path: string, element: HTMLButtonElement | null) {
    if (element) {
      rowRefs.current.set(path, element)
      return
    }

    rowRefs.current.delete(path)
  }

  function focusNodePath(targetPath: string | null, options?: { preview?: boolean }) {
    if (!targetPath) {
      treeRootRef.current?.focus()
      return
    }

    const entry = flatVisibleEntries.find((candidate) => candidate.node.path === targetPath)

    if (!entry) {
      return
    }

    setFocusedPath(entry.node.path)
    onSelectNode(entry.node, {
      preview: options?.preview ?? false
    })

    window.requestAnimationFrame(() => {
      const row = rowRefs.current.get(entry.node.path)

      if (!row) {
        return
      }

      row.focus()
      row.scrollIntoView({
        block: 'nearest'
      })
    })
  }

  function handleTreeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!keyboardActive || inputDialog || deleteTarget) {
      return
    }

    if (!flatVisibleEntries.length) {
      return
    }

    const currentPath =
      (focusedPath && flatVisibleEntries.some((entry) => entry.node.path === focusedPath) ? focusedPath : null) ??
      (activePath && flatVisibleEntries.some((entry) => entry.node.path === activePath) ? activePath : null) ??
      flatVisibleEntries[0]?.node.path ??
      null

    const currentIndex = currentPath
      ? flatVisibleEntries.findIndex((entry) => entry.node.path === currentPath)
      : -1
    const currentEntry = currentIndex >= 0 ? flatVisibleEntries[currentIndex] : null

    if (event.shiftKey && event.key === 'ArrowLeft') {
      event.preventDefault()
      event.stopPropagation()
      setExpanded(directoryExpansionState(nodes, false))
      return
    }

    if (event.shiftKey && event.key === 'ArrowRight') {
      event.preventDefault()
      event.stopPropagation()
      setExpanded(directoryExpansionState(nodes, true))
      return
    }

    if (event.shiftKey && event.key === 'Enter' && currentEntry?.node.kind === 'file') {
      event.preventDefault()
      event.stopPropagation()
      onPlaceFile(currentEntry.node)
      setFocusedPath(currentEntry.node.path)
      return
    }

    if (event.key === 'Home') {
      event.preventDefault()
      event.stopPropagation()
      focusNodePath(flatVisibleEntries[0]?.node.path ?? null)
      return
    }

    if (event.key === 'End') {
      event.preventDefault()
      event.stopPropagation()
      focusNodePath(flatVisibleEntries[flatVisibleEntries.length - 1]?.node.path ?? null)
      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      event.stopPropagation()
      focusNodePath(flatVisibleEntries[Math.min(currentIndex + 1, flatVisibleEntries.length - 1)]?.node.path ?? null)
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      event.stopPropagation()
      focusNodePath(flatVisibleEntries[Math.max(currentIndex - 1, 0)]?.node.path ?? null)
      return
    }

    if (!currentEntry) {
      return
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault()
      event.stopPropagation()

      if (currentEntry.node.kind !== 'directory') {
        return
      }

      const isExpanded = queryActive ? true : expanded[currentEntry.node.path] ?? true

      if (!isExpanded) {
        setExpanded((current) => ({
          ...current,
          [currentEntry.node.path]: true
        }))
        setFocusedPath(currentEntry.node.path)
        return
      }

      const childEntry = flatVisibleEntries[currentIndex + 1]

      if (childEntry?.parentPath === currentEntry.node.path) {
        focusNodePath(childEntry.node.path)
      }

      return
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      event.stopPropagation()

      if (currentEntry.node.kind === 'directory' && (expanded[currentEntry.node.path] ?? true) && !queryActive) {
        setExpanded((current) => ({
          ...current,
          [currentEntry.node.path]: false
        }))
        setFocusedPath(currentEntry.node.path)
        return
      }

      if (currentEntry.parentPath) {
        focusNodePath(currentEntry.parentPath)
      }

      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()

      if (currentEntry.node.kind === 'directory') {
        onSelectNode(currentEntry.node, { preview: false })
        toggleDirectory(currentEntry.node.path)
        setFocusedPath(currentEntry.node.path)
        return
      }

      onSelectNode(currentEntry.node)
    }
  }

  function dropTargetLabel(targetPath: string) {
    if (rootDirectoryPath && normalizeFsPath(targetPath) === normalizeFsPath(rootDirectoryPath)) {
      return 'Workspace Root'
    }

    const pathParts = targetPath.split(/[\\/]/).filter(Boolean)
    return pathParts[pathParts.length - 1] ?? targetPath
  }

  function resolveDropTargetFromPoint(clientX: number, clientY: number, sourcePath: string) {
    if (typeof document === 'undefined') {
      return null
    }

    const elementAtPoint = document.elementFromPoint(clientX, clientY) as HTMLElement | null
    const dropElement = elementAtPoint?.closest<HTMLElement>('[data-file-tree-drop-path], [data-file-tree-root-drop="true"]')

    if (!dropElement) {
      clearPendingExpand()
      return null
    }

    const candidatePath =
      dropElement.dataset.fileTreeDropPath ??
      (dropElement.dataset.fileTreeRootDrop === 'true' ? rootDirectoryPath : null)

    if (!candidatePath || !canMoveNodeIntoDirectory(sourcePath, candidatePath)) {
      clearPendingExpand()
      return null
    }

    const directoryHover = dropElement.dataset.fileTreeDirectory === 'true'
    const isExpanded = trimmedQuery ? true : expanded[candidatePath] ?? true
    scheduleDirectoryExpand(candidatePath, directoryHover && !isExpanded)

    return candidatePath
  }

  function resolveExternalDropTargetFromPoint(clientX: number, clientY: number) {
    if (typeof document === 'undefined') {
      return rootDirectoryPath
    }

    const elementAtPoint = document.elementFromPoint(clientX, clientY) as HTMLElement | null
    const dropElement = elementAtPoint?.closest<HTMLElement>('[data-file-tree-drop-path], [data-file-tree-root-drop="true"]')

    if (!dropElement) {
      clearPendingExpand()
      return rootDirectoryPath
    }

    const candidatePath =
      dropElement.dataset.fileTreeDropPath ??
      (dropElement.dataset.fileTreeRootDrop === 'true' ? rootDirectoryPath : null)
    const directoryHover = dropElement.dataset.fileTreeDirectory === 'true'

    if (candidatePath && directoryHover) {
      const isExpanded = trimmedQuery ? true : expanded[candidatePath] ?? true
      scheduleDirectoryExpand(candidatePath, !isExpanded)
    } else {
      clearPendingExpand()
    }

    return candidatePath ?? rootDirectoryPath
  }

  function isCanvasDropTarget(clientX: number, clientY: number) {
    if (typeof document === 'undefined') {
      return false
    }

    const elementAtPoint = document.elementFromPoint(clientX, clientY) as HTMLElement | null
    return Boolean(elementAtPoint?.closest('[data-canvas-surface="true"]'))
  }

  function clearExternalDragState() {
    externalDragDepthRef.current = 0
    setExternalDragActive(false)
    setExternalDropTargetPath(null)
    clearPendingExpand()
  }

  function handleExternalDragEnter(event: ReactDragEvent<HTMLElement>) {
    if (!rootDirectoryPath || !hasExternalPathPayload(event.dataTransfer)) {
      return
    }

    externalDragDepthRef.current += 1
    setExternalDragActive(true)
    setExternalDropTargetPath(resolveExternalDropTargetFromPoint(event.clientX, event.clientY))
    event.preventDefault()
  }

  function handleExternalDragOver(event: ReactDragEvent<HTMLElement>) {
    if (!rootDirectoryPath || !hasExternalPathPayload(event.dataTransfer)) {
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setExternalDragActive(true)
    setExternalDropTargetPath(resolveExternalDropTargetFromPoint(event.clientX, event.clientY))
  }

  function handleExternalDragLeave(event: ReactDragEvent<HTMLElement>) {
    if (!rootDirectoryPath || !hasExternalPathPayload(event.dataTransfer)) {
      return
    }

    externalDragDepthRef.current = Math.max(0, externalDragDepthRef.current - 1)

    if (externalDragDepthRef.current === 0) {
      clearExternalDragState()
    }
  }

  function handleExternalDrop(event: ReactDragEvent<HTMLElement>) {
    if (!rootDirectoryPath) {
      return
    }

    const sourcePaths = externalPathsFromDataTransfer(event.dataTransfer)
    const externalDownload = externalDownloadFromDataTransfer(event.dataTransfer)

    if (sourcePaths.length === 0 && !externalDownload) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    const targetDirectoryPath =
      resolveExternalDropTargetFromPoint(event.clientX, event.clientY) ?? rootDirectoryPath

    clearExternalDragState()

    if (sourcePaths.length > 0) {
      onImportExternalPaths(sourcePaths, targetDirectoryPath)
      return
    }

    if (externalDownload) {
      onImportExternalDownload(externalDownload, targetDirectoryPath)
    }
  }

  function openContextMenu(event: ReactMouseEvent, node: FileTreeNode | null, directoryPath: string) {
    event.preventDefault()
    event.stopPropagation()

    if (node) {
      onSelectNode(node, { preview: false })
    }

    const menuWidth = 220
    const menuHeight = node ? 304 : 132
    const nextX = Math.min(event.clientX, Math.max(8, window.innerWidth - menuWidth - 12))
    const nextY = Math.min(event.clientY, Math.max(8, window.innerHeight - menuHeight - 12))

    setContextMenu({
      directoryPath,
      node,
      x: nextX,
      y: nextY
    })
  }

  function openNewFileDialog(directoryPath: string) {
    setContextMenu(null)
    setInputDialog({
      confirmLabel: 'Create File',
      directoryPath,
      mode: 'create-file',
      title: 'Create a new file',
      value: 'untitled.md'
    })
  }

  function openNewFolderDialog(directoryPath: string) {
    setContextMenu(null)
    setInputDialog({
      confirmLabel: 'Create Folder',
      directoryPath,
      mode: 'create-folder',
      title: 'Create a new folder',
      value: 'New Folder'
    })
  }

  function openDeleteDialog(node: FileTreeNode) {
    setContextMenu(null)
    setDeleteTarget(node)
  }

  function openRenameDialog(node: FileTreeNode) {
    setContextMenu(null)
    setInputDialog({
      confirmLabel: 'Rename',
      mode: 'rename',
      node,
      title: `Rename ${node.kind === 'directory' ? 'folder' : 'file'}`,
      value: node.name
    })
  }

  function submitInputDialog() {
    if (!inputDialog) {
      return
    }

    const nextValue = inputDialog.value.trim()

    if (!nextValue) {
      return
    }

    if (inputDialog.mode === 'create-file' && inputDialog.directoryPath) {
      onCreateWorkspaceFile(inputDialog.directoryPath, nextValue)
      setInputDialog(null)
      return
    }

    if (inputDialog.mode === 'create-folder' && inputDialog.directoryPath) {
      onCreateWorkspaceDirectory(inputDialog.directoryPath, nextValue)
      setInputDialog(null)
      return
    }

    if (inputDialog.mode === 'rename' && inputDialog.node && nextValue !== inputDialog.node.name) {
      onRenameNode(inputDialog.node.path, nextValue)
    }

    setInputDialog(null)
  }

  function copyNodePath(node: FileTreeNode) {
    setContextMenu(null)
    onCopyNodePath(node.path)
  }

  function revealNodeInFinder(node: FileTreeNode) {
    setContextMenu(null)
    onRevealNodeInFinder(node.path)
  }

  function startDraggingNode(event: ReactPointerEvent, node: FileTreeNode) {
    if (event.button !== 0) {
      return
    }

    clearPendingExpand()
    const nextDragState: PointerDragState = {
      active: false,
      currentX: event.clientX,
      currentY: event.clientY,
      sourceFileKind: node.kind === 'file' ? node.fileKind : undefined,
      sourceKind: node.kind,
      sourceName: node.name,
      sourcePath: node.path,
      startX: event.clientX,
      startY: event.clientY
    }

    dragStateRef.current = nextDragState
    setDragState(nextDragState)
    setDropTargetPath(null)

    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Ignore browsers/environments that reject explicit pointer capture.
    }
  }

  useEffect(() => {
    if (!dragState) {
      return
    }

    function clearDragState() {
      clearPendingExpand()
      dragStateRef.current = null
      setDragState(null)
      setDropTargetPath(null)
    }

    function handlePointerMove(event: PointerEvent) {
      const currentDragState = dragStateRef.current

      if (!currentDragState) {
        return
      }

      const deltaX = event.clientX - currentDragState.startX
      const deltaY = event.clientY - currentDragState.startY
      const nextActive = currentDragState.active || Math.hypot(deltaX, deltaY) >= 4
      const nextDragState: PointerDragState = {
        ...currentDragState,
        active: nextActive,
        currentX: event.clientX,
        currentY: event.clientY
      }

      dragStateRef.current = nextDragState
      setDragState(nextDragState)

      if (!nextActive) {
        return
      }

      const nextDropTargetPath = resolveDropTargetFromPoint(
        event.clientX,
        event.clientY,
        currentDragState.sourcePath
      )

      setDropTargetPath((currentPath) => (currentPath === nextDropTargetPath ? currentPath : nextDropTargetPath))
      event.preventDefault()
    }

    function handlePointerEnd(event: PointerEvent) {
      const currentDragState = dragStateRef.current

      if (!currentDragState) {
        return
      }

      const nextDropTargetPath = currentDragState.active
        ? resolveDropTargetFromPoint(event.clientX, event.clientY, currentDragState.sourcePath)
        : null
      const shouldPlaceOnCanvas =
        currentDragState.active &&
        currentDragState.sourceKind === 'file' &&
        !nextDropTargetPath &&
        isCanvasDropTarget(event.clientX, event.clientY)

      if (currentDragState.active) {
        suppressClickRef.current = true
        window.setTimeout(() => {
          suppressClickRef.current = false
        }, 0)
      }

      clearDragState()

      if (!currentDragState.active) {
        return
      }

      if (shouldPlaceOnCanvas) {
        onPlaceFileAtPoint(
          {
            fileKind: currentDragState.sourceFileKind,
            kind: 'file',
            name: currentDragState.sourceName,
            path: currentDragState.sourcePath
          },
          event.clientX,
          event.clientY
        )
        return
      }

      if (!nextDropTargetPath) {
        return
      }

      onMoveFile(currentDragState.sourcePath, nextDropTargetPath)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerEnd)
    window.addEventListener('pointercancel', clearDragState)
    window.addEventListener('blur', clearDragState)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerEnd)
      window.removeEventListener('pointercancel', clearDragState)
      window.removeEventListener('blur', clearDragState)
    }
  }, [dragState, expanded, onMoveFile, rootDirectoryPath, trimmedQuery])

  function renderNode(node: FileTreeNode, depth: number) {
    const isFocused = focusedPath === node.path

    if (node.kind === 'directory') {
      const isExpanded = queryActive ? true : expanded[node.path] ?? true
      const childCount = directChildCount(node)
      const isDropTarget = dropTargetPath === node.path || externalDropTargetPath === node.path

      return (
        <div key={node.path} className="space-y-0.5" role="none">
          <div className="relative">
            {depth > 0 ? (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute left-[-12px] top-1/2 h-px w-3 -translate-y-1/2 bg-[var(--nav-tree-line)]"
              />
            ) : null}
            <button
              ref={(element) => setRowRef(node.path, element)}
              data-file-tree-node="true"
              data-file-tree-directory="true"
              data-file-tree-drop-path={node.path}
              role="treeitem"
              aria-expanded={isExpanded}
              aria-selected={activePath === node.path}
              tabIndex={keyboardActive && isFocused ? 0 : -1}
              className={clsx(
                'flex w-full cursor-grab items-center gap-1.5 px-1.5 py-[2px] text-left text-[11px] font-medium leading-[1.15rem] transition active:cursor-grabbing focus-visible:outline-none',
                'rounded-[var(--radius-control)] border border-transparent hover:bg-[var(--nav-surface-hover)]',
                activePath === node.path &&
                  'border-[color:var(--line)] bg-[color:color-mix(in_srgb,var(--surface-selected)_82%,transparent)] text-[var(--text)]',
                isFocused && 'border-[color:var(--accent)] bg-[color:color-mix(in_srgb,var(--accent-soft)_70%,transparent)]',
                dragState?.sourcePath === node.path && 'opacity-55',
                isDropTarget &&
                  'border-[color:var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
              )}
              onMouseDown={(event) => {
                if (event.button === 2) {
                  event.preventDefault()
                  event.stopPropagation()
                }
              }}
              onClick={() => {
                if (consumeSuppressedClick()) {
                  return
                }

                onSelectNode(node)
                toggleDirectory(node.path)
              }}
              onFocus={() => setFocusedPath(node.path)}
              onDragEnterCapture={handleExternalDragEnter}
              onDragLeaveCapture={handleExternalDragLeave}
              onDragOverCapture={handleExternalDragOver}
              onDropCapture={handleExternalDrop}
              onContextMenu={(event) => openContextMenu(event, node, node.path)}
              title={`Toggle folder: ${node.name}. Use ${TREE_COLLAPSE_ALL_SHORTCUT_KEY} or ${TREE_EXPAND_ALL_SHORTCUT_KEY} to collapse or expand everything.`}
              onPointerDown={(event) => startDraggingNode(event, node)}
            >
              <span className="flex h-3 w-3 shrink-0 items-center justify-center text-[var(--text-faint)]">
                <ChevronIcon expanded={isExpanded} />
              </span>
              <span
                className={clsx(
                  'flex h-3.5 w-3.5 shrink-0 items-center justify-center',
                  iconToneClasses('directory', darkMode)
                )}
              >
                <FolderIcon />
              </span>
              <span className={clsx('min-w-0 flex-1 truncate', directoryNameTone(node.name, darkMode))}>
                {node.name}
              </span>
              <span
                className={clsx(
                  'shrink-0 rounded-full border px-1.5 py-[1px] text-[9px] font-semibold leading-none',
                  activePath === node.path || dropTargetPath === node.path
                    ? 'border-current/20 bg-white/10 text-current'
                    : 'border-[color:var(--line)] bg-[var(--nav-badge)] text-[var(--text-faint)]'
                )}
                title={
                  node.descendantFileCount !== undefined
                    ? `${childCount} direct item${childCount === 1 ? '' : 's'}, ${node.descendantFileCount} file${node.descendantFileCount === 1 ? '' : 's'} inside`
                    : `${childCount} direct item${childCount === 1 ? '' : 's'}`
                }
              >
                {childCount}
              </span>
            </button>
          </div>
          {isExpanded ? (
            <div className="relative ml-4">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute bottom-1 left-[7px] top-0 w-px bg-[var(--nav-tree-line)]"
              />
              <div className="space-y-0.5 pl-3.5">{node.children?.map((child) => renderNode(child, depth + 1))}</div>
            </div>
          ) : null}
        </div>
      )
    }

  const { extensionLabel, stem } = displayFileNameParts(node)
  const parentDropTargetPath = parentDirectoryPath(node.path) ?? rootDirectoryPath ?? null

  return (
      <div key={node.path} className="relative" role="none">
        {depth > 0 ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-[-12px] top-1/2 h-px w-3 -translate-y-1/2 bg-[var(--nav-tree-line)]"
          />
        ) : null}
        <button
          ref={(element) => setRowRef(node.path, element)}
          data-file-tree-node="true"
          data-file-tree-drop-path={parentDirectoryPath(node.path) ?? rootDirectoryPath ?? undefined}
          role="treeitem"
          aria-selected={activePath === node.path}
          tabIndex={keyboardActive && isFocused ? 0 : -1}
          className={clsx(
            'flex w-full cursor-grab items-center gap-1.5 px-1.5 py-[2px] text-left text-[11px] font-medium leading-[1.15rem] transition active:cursor-grabbing focus-visible:outline-none',
            'rounded-[var(--radius-control)] border border-transparent',
            dragState?.sourcePath === node.path && 'opacity-55',
            activePath === node.path
              ? 'border-[color:var(--line)] bg-[color:color-mix(in_srgb,var(--surface-selected)_82%,transparent)] text-[var(--text)]'
              : 'text-[var(--text-dim)] hover:bg-[var(--nav-surface-hover)]',
            isFocused && 'border-[color:var(--accent)] bg-[color:color-mix(in_srgb,var(--accent-soft)_70%,transparent)] text-[var(--text)]',
            parentDropTargetPath && externalDropTargetPath === parentDropTargetPath && 'border-[color:var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
          )}
          onMouseDown={(event) => {
            if (event.button === 2) {
              event.preventDefault()
              event.stopPropagation()
            }
          }}
          onClick={() => {
            if (consumeSuppressedClick()) {
              return
            }

            onSelectNode(node)
          }}
          onFocus={() => setFocusedPath(node.path)}
          onDragEnterCapture={handleExternalDragEnter}
          onDragLeaveCapture={handleExternalDragLeave}
          onDragOverCapture={handleExternalDragOver}
          onDropCapture={handleExternalDrop}
          onContextMenu={(event) =>
            openContextMenu(event, node, parentDirectoryPath(node.path) ?? rootDirectoryPath ?? node.path)
          }
          onDoubleClick={(event) => {
            event.preventDefault()
            onPlaceFile(node)
          }}
          onPointerDown={(event) => startDraggingNode(event, node)}
          title={`Preview ${node.name}. Double-click or ${PLACE_ON_CANVAS_SHORTCUT_KEY} to place it on the canvas.`}
        >
          <span className="flex h-3 w-3 shrink-0 items-center justify-center text-transparent">
            <ChevronIcon expanded={false} />
          </span>
          <FileKindIcon darkMode={darkMode} fileKind={node.fileKind} />
          <span className="min-w-0 flex-1 truncate">
            <span className="truncate text-current">{stem}</span>
            {extensionLabel ? (
              <span className="ml-1 align-middle text-[9px] font-semibold uppercase tracking-[0.08em] text-[var(--text-faint)]">
                {extensionLabel}
              </span>
            ) : null}
          </span>
        </button>
      </div>
    )
  }

  if (nodes.length === 0) {
    return (
      <div
        ref={treeRootRef}
        tabIndex={keyboardActive ? 0 : -1}
        className="rounded-[var(--radius-surface)] border border-dashed border-[color:var(--line-strong)] bg-[var(--nav-surface)] p-4 text-[11px] text-[var(--text-dim)] outline-none"
        data-file-tree-root-drop={rootDirectoryPath ? 'true' : undefined}
        onDragEnterCapture={handleExternalDragEnter}
        onDragLeaveCapture={handleExternalDragLeave}
        onDragOverCapture={handleExternalDragOver}
        onDropCapture={handleExternalDrop}
        onDragEnter={handleExternalDragEnter}
        onDragLeave={handleExternalDragLeave}
        onDragOver={handleExternalDragOver}
        onDrop={handleExternalDrop}
        onContextMenu={(event) => {
          if (rootDirectoryPath) {
            openContextMenu(event, null, rootDirectoryPath)
          }
        }}
        onKeyDown={handleTreeKeyDown}
      >
        This workspace is empty.
      </div>
    )
  }

  if (visibleNodes.length === 0) {
    return (
      <div
        ref={treeRootRef}
        tabIndex={keyboardActive ? 0 : -1}
        className="rounded-[var(--radius-surface)] border border-dashed border-[color:var(--line-strong)] bg-[var(--nav-surface)] p-4 text-[11px] text-[var(--text-dim)] outline-none"
        data-file-tree-root-drop={rootDirectoryPath ? 'true' : undefined}
        onDragEnterCapture={handleExternalDragEnter}
        onDragLeaveCapture={handleExternalDragLeave}
        onDragOverCapture={handleExternalDragOver}
        onDropCapture={handleExternalDrop}
        onDragEnter={handleExternalDragEnter}
        onDragLeave={handleExternalDragLeave}
        onDragOver={handleExternalDragOver}
        onDrop={handleExternalDrop}
        onContextMenu={(event) => {
          if (rootDirectoryPath) {
            openContextMenu(event, null, rootDirectoryPath)
          }
        }}
        onKeyDown={handleTreeKeyDown}
      >
        No files or folders match <span className="text-[var(--text)]">“{query.trim()}”</span>.
      </div>
    )
  }

  return (
    <div
      ref={treeRootRef}
      role="tree"
      aria-label="Workspace file tree"
      tabIndex={-1}
      className={clsx(
        'space-y-0.5 font-[var(--font-ui)] text-[11px] outline-none',
        dragState?.active && 'select-none'
      )}
      data-file-tree-root-drop={rootDirectoryPath ? 'true' : undefined}
      onKeyDown={handleTreeKeyDown}
      onDragEnterCapture={handleExternalDragEnter}
      onDragLeaveCapture={handleExternalDragLeave}
      onDragOverCapture={handleExternalDragOver}
      onDropCapture={handleExternalDrop}
      onDragEnter={handleExternalDragEnter}
      onDragLeave={handleExternalDragLeave}
      onDragOver={handleExternalDragOver}
      onDrop={handleExternalDrop}
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
      {rootDirectoryPath && (dragState?.active || externalDragActive) ? (
        <div
          data-file-tree-root-drop="true"
          className={clsx(
            'mb-2 rounded-[var(--radius-control)] border border-dashed px-3 py-2 text-[10px] font-medium uppercase tracking-[0.14em] transition',
            (externalDragActive ? externalDropTargetPath : dropTargetPath) === rootDirectoryPath
              ? 'border-[color:var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
              : 'border-[color:var(--line-strong)] bg-[var(--nav-surface)] text-[var(--text-faint)]'
          )}
        >
          {externalDragActive ? 'Drop Here To Import Into Workspace Root' : 'Drop Here To Move To Workspace Root'}
        </div>
      ) : null}
      {visibleNodes.map((node) => renderNode(node, 0))}
      {rootDirectoryPath && (dragState?.active || externalDragActive) ? (
        <div
          data-file-tree-root-drop="true"
          className={clsx(
            'mt-2 rounded-[var(--radius-control)] border border-dashed px-3 py-2 text-[10px] font-medium uppercase tracking-[0.14em] transition',
            (externalDragActive ? externalDropTargetPath : dropTargetPath) === rootDirectoryPath
              ? 'border-[color:var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
              : 'border-[color:var(--line-strong)] bg-[var(--nav-surface)] text-[var(--text-faint)]'
          )}
        >
          {externalDragActive ? 'Or Drop Here To Import Back To Root' : 'Or Drop Here To Move Back To Root'}
        </div>
      ) : null}
      {dragState?.active && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="pointer-events-none fixed z-[530] flex max-w-[18rem] items-center gap-2 rounded-[var(--radius-surface)] border border-[color:var(--line-strong)] bg-[var(--nav-surface)] px-3 py-2 text-[11px] shadow-[0_14px_30px_rgba(0,0,0,0.16)]"
              style={{
                left: Math.min(dragState.currentX + 14, window.innerWidth - 280),
                top: Math.min(dragState.currentY + 14, window.innerHeight - 72)
              }}
            >
              <span className="shrink-0 text-[var(--text-faint)]">
                {dragState.sourceKind === 'directory' ? (
                  <FolderIcon />
                ) : (
                  <FileKindIcon darkMode={darkMode} fileKind={dragState.sourceFileKind} />
                )}
              </span>
              <div className="min-w-0">
                <div className="truncate font-medium text-[var(--text)]">{dragState.sourceName}</div>
                <div className="truncate text-[10px] text-[var(--text-faint)]">
                  {dropTargetPath ? `Move to ${dropTargetLabel(dropTargetPath)}` : 'Drag into a folder or back to root'}
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
      {contextMenu && typeof document !== 'undefined'
        ? createPortal(
        <div
          ref={contextMenuRef}
          className="fixed z-[520] min-w-[220px] rounded-[var(--radius-surface)] border border-[color:var(--line)] bg-[var(--surface-2)] p-1.5 shadow-[0_16px_40px_rgba(0,0,0,0.18)]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            className="flex w-full items-center justify-between rounded-[var(--radius-control)] px-3 py-2 text-left text-[12px] font-medium text-[var(--text)] transition hover:bg-[var(--surface-0)]"
            onClick={() => openNewFileDialog(contextMenu.directoryPath)}
          >
            <span>New File</span>
            <span className="text-[var(--text-faint)]">+</span>
          </button>
          <button
            className="flex w-full items-center justify-between rounded-[var(--radius-control)] px-3 py-2 text-left text-[12px] font-medium text-[var(--text)] transition hover:bg-[var(--surface-0)]"
            onClick={() => openNewFolderDialog(contextMenu.directoryPath)}
          >
            <span>New Folder</span>
            <span className="text-[var(--text-faint)]">+</span>
          </button>
          {contextMenu.node ? (
            <>
              <div className="my-1 h-px bg-[var(--line)]" />
              <button
                className="flex w-full items-center justify-between rounded-[var(--radius-control)] px-3 py-2 text-left text-[12px] font-medium text-[var(--text)] transition hover:bg-[var(--surface-0)]"
                onClick={() => copyNodePath(contextMenu.node!)}
              >
                <span>Copy Path</span>
                <span className="text-[var(--text-faint)]">⌘C</span>
              </button>
              <button
                className="flex w-full items-center justify-between rounded-[var(--radius-control)] px-3 py-2 text-left text-[12px] font-medium text-[var(--text)] transition hover:bg-[var(--surface-0)]"
                onClick={() => revealNodeInFinder(contextMenu.node!)}
              >
                <span>Open In Finder</span>
                <span className="text-[var(--text-faint)]">↗</span>
              </button>
              <button
                className="flex w-full items-center justify-between rounded-[var(--radius-control)] px-3 py-2 text-left text-[12px] font-medium text-[var(--text)] transition hover:bg-[var(--surface-0)]"
                onClick={() => openRenameDialog(contextMenu.node!)}
              >
                <span>Rename</span>
                <span className="text-[var(--text-faint)]">↵</span>
              </button>
              <button
                className="flex w-full items-center justify-between rounded-[var(--radius-control)] px-3 py-2 text-left text-[12px] font-medium text-[var(--danger,#b95151)] transition hover:bg-[var(--surface-0)]"
                onClick={() => openDeleteDialog(contextMenu.node!)}
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
      {inputDialog && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="fixed inset-0 z-[540] flex items-center justify-center bg-black/18 px-4"
              onMouseDown={() => setInputDialog(null)}
            >
              <div
                className="w-full max-w-[28rem] rounded-[var(--radius-surface)] border border-[color:var(--line)] bg-[var(--surface-2)] p-4 shadow-[0_20px_50px_rgba(0,0,0,0.2)]"
                onMouseDown={(event) => event.stopPropagation()}
              >
                <div className="text-[13px] font-semibold text-[var(--text)]">{inputDialog.title}</div>
                <div className="mt-1 text-[12px] text-[var(--text-dim)]">
                  {inputDialog.mode === 'rename'
                    ? 'Enter the new name for this workspace item.'
                    : 'This will be created in the selected folder.'}
                </div>
                <form
                  className="mt-4 space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault()
                    submitInputDialog()
                  }}
                >
                  <input
                    ref={dialogInputRef}
                    value={inputDialog.value}
                    onChange={(event) =>
                      setInputDialog((current) =>
                        current
                          ? {
                              ...current,
                              value: event.target.value
                            }
                          : current
                      )
                    }
                    className="h-11 w-full rounded-[var(--radius-control)] border border-[color:var(--line)] bg-[var(--surface-0)] px-3 text-[13px] text-[var(--text)] outline-none transition focus:border-[color:var(--accent)]"
                  />
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      className="rounded-[var(--radius-control)] border border-[color:var(--line)] bg-[var(--surface-0)] px-3 py-2 text-[12px] font-medium text-[var(--text-dim)] transition hover:bg-[var(--surface-1)] hover:text-[var(--text)]"
                      onClick={() => setInputDialog(null)}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="rounded-[var(--radius-control)] border border-[color:var(--accent)] bg-[var(--accent-soft)] px-3 py-2 text-[12px] font-medium text-[var(--accent)] transition hover:brightness-[0.98]"
                    >
                      {inputDialog.confirmLabel}
                    </button>
                  </div>
                </form>
              </div>
            </div>,
            document.body
          )
        : null}
      {deleteTarget && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="fixed inset-0 z-[540] flex items-center justify-center bg-black/18 px-4"
              onMouseDown={() => setDeleteTarget(null)}
            >
              <div
                className="w-full max-w-[28rem] rounded-[var(--radius-surface)] border border-[color:var(--line)] bg-[var(--surface-2)] p-4 shadow-[0_20px_50px_rgba(0,0,0,0.2)]"
                onMouseDown={(event) => event.stopPropagation()}
              >
                <div className="text-[13px] font-semibold text-[var(--text)]">
                  Delete {deleteTarget.kind === 'directory' ? 'folder' : 'file'}?
                </div>
                <div className="mt-2 text-[12px] leading-5 text-[var(--text-dim)]">
                  {deleteTarget.kind === 'directory'
                    ? `Delete “${deleteTarget.name}” and everything inside it?`
                    : `Delete “${deleteTarget.name}”?`}
                </div>
                <div className="mt-4 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    className="rounded-[var(--radius-control)] border border-[color:var(--line)] bg-[var(--surface-0)] px-3 py-2 text-[12px] font-medium text-[var(--text-dim)] transition hover:bg-[var(--surface-1)] hover:text-[var(--text)]"
                    onClick={() => setDeleteTarget(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="rounded-[var(--radius-control)] border border-[color:var(--error-line)] bg-[var(--error-bg)] px-3 py-2 text-[12px] font-medium text-[var(--error-text)] transition hover:brightness-[0.98]"
                    onClick={() => {
                      onDeleteNode(deleteTarget.path)
                      setDeleteTarget(null)
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  )
}
