import { startTransition, useEffect, useMemo, useRef, useState } from 'react'

import clsx from 'clsx'
import type {
  AppConfig,
  CanvasDiagramQueueIndex,
  CanvasState,
  EnsureWorkspaceDiagramToolsResult,
  FileTreeNode,
  OfficeViewerBootstrap,
  SidebarSide,
  TerminalDependencyState,
  TerminalProvider
} from '@shared/types'

import { CanvasSurface, type CanvasSurfaceHandle } from './components/CanvasSurface'
import { HoverTooltip } from './components/HoverTooltip'
import {
  SearchDialog,
  type SearchDialogResult,
  type SearchScope
} from './components/SearchDialog'
import { Sidebar } from './components/Sidebar'
import { ViewerOverlay } from './components/ViewerOverlay'
import {
  parseCanvasDiagramEnvelopeJson,
  parseExcalidrawPayloadJson,
  parseCanvasDiagramQueueIndex,
  resolveWorkspaceRelativePath
} from './utils/canvasDiagramValidation'
import { extractPastedUrl } from './utils/embedTiles'
import { keyboardShortcutsBlocked } from './utils/keyboard'
import { installButtonTooltipSync } from './utils/buttonTooltips'

const IS_MAC_PLATFORM =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform)
const SIDEBAR_LEFT_SHORTCUT_KEY = IS_MAC_PLATFORM ? 'Cmd+\u2190' : null
const SIDEBAR_RIGHT_SHORTCUT_KEY = IS_MAC_PLATFORM ? 'Cmd+\u2192' : null
const TOGGLE_DARK_MODE_SHORTCUT_KEY = IS_MAC_PLATFORM ? 'Cmd+Shift+D' : 'Ctrl+Shift+D'
const WORKSPACE_SWITCHER_SHORTCUT_KEY = IS_MAC_PLATFORM ? 'Cmd+Shift+W' : 'Ctrl+Shift+W'
const WORKSPACE_SWITCHER_OPEN_EVENT = 'claude-canvas:open-workspace-switcher'
const INTERACTIVE_SHORTCUT_TARGET_SELECTOR =
  'button, [role="button"], a[href], input:not([type="hidden"]), select, textarea, summary'

function terminalProviderLabel(provider: TerminalProvider) {
  return provider === 'codex' ? 'Codex' : 'Claude Code'
}

function flattenFiles(nodes: FileTreeNode[]): FileTreeNode[] {
  const files: FileTreeNode[] = []

  for (const node of nodes) {
    if (node.kind === 'file') {
      files.push(node)
    }

    if (node.children) {
      files.push(...flattenFiles(node.children))
    }
  }

  return files
}

function findNodeByPath(nodes: FileTreeNode[], targetPath: string): FileTreeNode | null {
  for (const node of nodes) {
    if (node.path === targetPath) {
      return node
    }

    if (node.children) {
      const nestedMatch = findNodeByPath(node.children, targetPath)

      if (nestedMatch) {
        return nestedMatch
      }
    }
  }

  return null
}

function findDirectoryPathForNode(
  nodes: FileTreeNode[],
  targetPath: string,
  parentDirectoryPath: string | null = null
): string | null {
  for (const node of nodes) {
    if (node.path === targetPath) {
      return node.kind === 'directory' ? node.path : parentDirectoryPath
    }

    if (node.children) {
      const nestedMatch = findDirectoryPathForNode(
        node.children,
        targetPath,
        node.kind === 'directory' ? node.path : parentDirectoryPath
      )

      if (nestedMatch) {
        return nestedMatch
      }
    }
  }

  return null
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function normalizeFsPath(targetPath: string) {
  return targetPath.replace(/\\/g, '/').replace(/\/+$/, '')
}

function isSameOrDescendantPath(candidatePath: string | null | undefined, targetPath: string) {
  if (!candidatePath) {
    return false
  }

  const normalizedCandidatePath = normalizeFsPath(candidatePath)
  const normalizedTargetPath = normalizeFsPath(targetPath)

  return (
    normalizedCandidatePath === normalizedTargetPath ||
    normalizedCandidatePath.startsWith(`${normalizedTargetPath}/`)
  )
}

function replacePathPrefix(candidatePath: string, fromPath: string, toPath: string) {
  const normalizedCandidatePath = normalizeFsPath(candidatePath)
  const normalizedFromPath = normalizeFsPath(fromPath)
  const normalizedToPath = normalizeFsPath(toPath)

  if (normalizedCandidatePath === normalizedFromPath) {
    return normalizedToPath
  }

  if (!normalizedCandidatePath.startsWith(`${normalizedFromPath}/`)) {
    return candidatePath
  }

  return `${normalizedToPath}${normalizedCandidatePath.slice(normalizedFromPath.length)}`
}

function fileNameFromPath(targetPath: string) {
  const parts = targetPath.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? targetPath
}

function shortcutHandledByFocusedControl(target: EventTarget | null) {
  if (target instanceof Element) {
    return Boolean(target.closest(INTERACTIVE_SHORTCUT_TARGET_SELECTOR))
  }

  if (target instanceof Node) {
    return Boolean(target.parentElement?.closest(INTERACTIVE_SHORTCUT_TARGET_SELECTOR))
  }

  return false
}

function emptyCanvasState(): CanvasState {
  return {
    version: 1,
    tiles: [],
    viewport: {
      panX: 0,
      panY: 0,
      zoom: 1
    },
    boardSnapshot: undefined
  }
}

function diagramQueueArchivePath(workspacePath: string, requestId: string) {
  return resolveWorkspaceRelativePath(
    workspacePath,
    `.claude-canvas/diagram-inbox/archive/${requestId}.oc-diagrams.json`
  )
}

function diagramQueueFailedPath(workspacePath: string, requestId: string) {
  return resolveWorkspaceRelativePath(
    workspacePath,
    `.claude-canvas/diagram-inbox/failed/${requestId}.oc-diagrams.json`
  )
}

function toWorkspaceRelativeDiagramPath(targetPath: string) {
  const normalizedTargetPath = targetPath.replace(/\\/g, '/')
  const marker = '/.claude-canvas/'
  const markerIndex = normalizedTargetPath.indexOf(marker)

  return (markerIndex >= 0 ? normalizedTargetPath.slice(markerIndex + 1) : normalizedTargetPath).replace(
    /^\.\//,
    ''
  )
}

function errorMessageFromUnknown(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message
  }

  if (typeof error === 'string') {
    return error
  }

  return ''
}

function isMissingPathError(error: unknown) {
  const message = errorMessageFromUnknown(error)
  return /ENOENT|no such file or directory/i.test(message)
}

function writeDiagramQueueIndex(indexPath: string, index: CanvasDiagramQueueIndex) {
  return window.collaborator.writeTextFile(indexPath, `${JSON.stringify(index, null, 2)}\n`)
}

async function copyTextWithBrowserFallback(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textArea = document.createElement('textarea')
  textArea.value = text
  textArea.setAttribute('readonly', '')
  textArea.style.position = 'fixed'
  textArea.style.top = '-9999px'
  textArea.style.opacity = '0'
  document.body.appendChild(textArea)
  textArea.select()
  textArea.setSelectionRange(0, text.length)

  const copied = document.execCommand('copy')
  document.body.removeChild(textArea)

  if (!copied) {
    throw new Error('The browser clipboard API is unavailable.')
  }
}

function SidebarDockIcon({ side }: { side: SidebarSide }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-[1.3]">
      <rect x="1.75" y="2.25" width="12.5" height="11.5" rx="2.25" />
      <path d={side === 'left' ? 'M5.5 2.75V13.25' : 'M10.5 2.75V13.25'} />
    </svg>
  )
}

export default function App() {
  const canvasRef = useRef<CanvasSurfaceHandle>(null)
  const resizeRef = useRef<{ side: SidebarSide; startWidth: number; startX: number } | null>(null)
  const canvasFrameRef = useRef<number | null>(null)
  const canvasSaveTimerRef = useRef<number | null>(null)
  const canvasStateRef = useRef<CanvasState | null>(null)
  const canvasWorkspaceRef = useRef<string | null>(null)
  const canvasLoadRequestRef = useRef(0)
  const diagramToolsRef = useRef<EnsureWorkspaceDiagramToolsResult | null>(null)
  const diagramQueueStopRef = useRef<(() => void) | null>(null)
  const diagramQueueWorkspaceRef = useRef<string | null>(null)
  const diagramQueueProcessingRef = useRef(false)
  const diagramQueuePendingRef = useRef(false)

  const [config, setConfig] = useState<AppConfig | null>(null)
  const [canvasState, setCanvasState] = useState<CanvasState | null>(null)
  const [canvasWorkspacePath, setCanvasWorkspacePath] = useState<string | null>(null)
  const [workspaceTree, setWorkspaceTree] = useState<FileTreeNode[]>([])
  const [viewerFile, setViewerFile] = useState<FileTreeNode | null>(null)
  const [selectedTreePath, setSelectedTreePath] = useState<string | null>(null)
  const [sidebarWidth, setSidebarWidth] = useState(320)
  const [darkMode, setDarkMode] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [sidebarSide, setSidebarSide] = useState<SidebarSide>('left')
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchScope, setSearchScope] = useState<SearchScope>('workspace')
  const [globalSearchFiles, setGlobalSearchFiles] = useState<SearchDialogResult[]>([])
  const [globalSearchLoading, setGlobalSearchLoading] = useState(false)
  const [loadingWorkspace, setLoadingWorkspace] = useState(false)
  const [pendingSearchResult, setPendingSearchResult] = useState<SearchDialogResult | null>(null)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)
  const [bootError, setBootError] = useState<string | null>(null)
  const [officeViewer, setOfficeViewer] = useState<OfficeViewerBootstrap | null>(null)
  const [terminalDependencies, setTerminalDependencies] = useState<TerminalDependencyState | null>(null)
  const [diagramTools, setDiagramTools] = useState<EnsureWorkspaceDiagramToolsResult | null>(null)
  const [boardReadyVersion, setBoardReadyVersion] = useState(0)

  const activeWorkspace = config ? config.workspaces[config.activeWorkspace] ?? null : null
  const flatFiles = useMemo(() => flattenFiles(workspaceTree), [workspaceTree])
  const workspaceSearchFiles = useMemo(
    () =>
      activeWorkspace
        ? flatFiles.map((file) => ({
            file,
            workspacePath: activeWorkspace
          }))
        : [],
    [activeWorkspace, flatFiles]
  )
  const searchFiles = searchScope === 'all-workspaces' ? globalSearchFiles : workspaceSearchFiles
  const selectedTreeNode = useMemo(
    () => (selectedTreePath ? findNodeByPath(workspaceTree, selectedTreePath) : null),
    [selectedTreePath, workspaceTree]
  )
  const selectedFileNode = useMemo(
    () => (selectedTreeNode?.kind === 'file' ? selectedTreeNode : null),
    [selectedTreeNode]
  )
  const noteTargetPath = useMemo(() => {
    if (!activeWorkspace) {
      return null
    }

    if (!selectedTreePath) {
      return activeWorkspace
    }

    if (selectedTreeNode?.kind === 'directory') {
      return selectedTreeNode.path
    }

    return findDirectoryPathForNode(workspaceTree, selectedTreePath) ?? activeWorkspace
  }, [activeWorkspace, selectedTreeNode, selectedTreePath, workspaceTree])
  useEffect(() => {
    return installButtonTooltipSync(document)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function bootstrap() {
      try {
        const payload = await window.collaborator.bootstrap()

        if (cancelled) {
          return
        }

        const initialWorkspacePath =
          payload.config.workspaces[payload.config.activeWorkspace] ?? null

        canvasWorkspaceRef.current = initialWorkspacePath
        canvasStateRef.current = payload.canvasState
        setCanvasWorkspacePath(initialWorkspacePath)
        setConfig(payload.config)
        setCanvasState(payload.canvasState)
        setSidebarWidth(payload.config.ui.sidebarWidth)
        setDarkMode(payload.config.ui.darkMode)
        setSidebarCollapsed(payload.config.ui.sidebarCollapsed)
        setSidebarSide(payload.config.ui.sidebarSide)
        setOfficeViewer(payload.officeViewer)
        setTerminalDependencies(payload.terminalDependencies)
      } catch {
        if (!cancelled) {
          setBootError('The app state could not be loaded. Delete corrupted state or restart.')
        }
      }
    }

    void bootstrap()

    return () => {
      cancelled = true
    }
  }, [])

  async function flushPendingCanvasSave() {
    if (canvasSaveTimerRef.current !== null) {
      window.clearTimeout(canvasSaveTimerRef.current)
      canvasSaveTimerRef.current = null
    }

    if (!canvasStateRef.current) {
      return
    }

    await window.collaborator.saveCanvasState(canvasWorkspaceRef.current, canvasStateRef.current)
  }

  async function processDiagramQueue(workspacePath: string, queueIndexPath: string) {
    if (diagramQueueProcessingRef.current) {
      diagramQueuePendingRef.current = true
      return
    }

    if (!canvasRef.current) {
      diagramQueuePendingRef.current = true
      return
    }

    diagramQueueProcessingRef.current = true

    try {
      while (diagramQueueWorkspaceRef.current === workspacePath) {
        const queueDocument = await window.collaborator.readTextFile(queueIndexPath)
        const queueIndex = parseCanvasDiagramQueueIndex(queueDocument.content)
        const nextPending = queueIndex.pending.find(
          (entry) => !queueIndex.processed.includes(entry.requestId)
        )

        if (!nextPending) {
          break
        }

        const requestPath = resolveWorkspaceRelativePath(workspacePath, nextPending.file)
        let requestContent = ''

        try {
          const requestDocument = await window.collaborator.readTextFile(requestPath)
          requestContent = requestDocument.content

          const parsedEnvelope = parseCanvasDiagramEnvelopeJson(requestDocument.content)
          const parsedExcalidraw = !parsedEnvelope.value
            ? parseExcalidrawPayloadJson(requestDocument.content)
            : null

          if (parsedEnvelope.value) {
            canvasRef.current.importDiagramSet(parsedEnvelope.value)
          } else if (parsedExcalidraw?.value) {
            await canvasRef.current.importExcalidrawContent(
              parsedExcalidraw.value,
              nextPending.promptSummary
            )
          } else {
            throw new Error(
              parsedEnvelope.error ??
                parsedExcalidraw?.error ??
                'The diagram request is invalid.'
            )
          }

          const archiveRequestId = parsedEnvelope.value?.requestId ?? nextPending.requestId
          const archivePath = diagramQueueArchivePath(workspacePath, archiveRequestId)
          await window.collaborator.writeTextFile(archivePath, requestDocument.content)

          try {
            await window.collaborator.deleteWorkspaceNode(workspacePath, requestPath)
          } catch (error) {
            if (!(error instanceof Error) || !/ENOENT/i.test(error.message)) {
              throw error
            }
          }

          await writeDiagramQueueIndex(queueIndexPath, {
            version: 1,
            pending: queueIndex.pending.filter((entry) => entry.requestId !== nextPending.requestId),
            processed: Array.from(new Set([...queueIndex.processed, archiveRequestId])),
            failed: queueIndex.failed.filter((entry) => entry.requestId !== archiveRequestId)
          })
        } catch (error) {
          const failureMessage =
            errorMessageFromUnknown(error) || 'The diagram request could not be imported.'
          const archivePath = diagramQueueArchivePath(workspacePath, nextPending.requestId)

          if (!requestContent.length && isMissingPathError(error)) {
            try {
              await window.collaborator.readTextFile(archivePath)

              await writeDiagramQueueIndex(queueIndexPath, {
                version: 1,
                pending: queueIndex.pending.filter((entry) => entry.requestId !== nextPending.requestId),
                processed: Array.from(new Set([...queueIndex.processed, nextPending.requestId])),
                failed: queueIndex.failed.filter((entry) => entry.requestId !== nextPending.requestId)
              })
              continue
            } catch {
              // Fall through to the regular failure path when the archive is missing too.
            }
          }

          const failedAt = new Date().toISOString()
          const failedPath = diagramQueueFailedPath(workspacePath, nextPending.requestId)

          if (requestContent.length > 0) {
            await window.collaborator.writeTextFile(failedPath, requestContent)

            try {
              await window.collaborator.deleteWorkspaceNode(workspacePath, requestPath)
            } catch {
              // Keep the original request if cleanup fails so the payload is not lost.
            }
          }

          await writeDiagramQueueIndex(queueIndexPath, {
            version: 1,
            pending: queueIndex.pending.filter((entry) => entry.requestId !== nextPending.requestId),
            processed: queueIndex.processed,
            failed: [
              ...queueIndex.failed.filter((entry) => entry.requestId !== nextPending.requestId),
              {
                requestId: nextPending.requestId,
                file:
                  requestContent.length > 0
                    ? toWorkspaceRelativeDiagramPath(failedPath)
                    : nextPending.file,
                error: failureMessage,
                failedAt
              }
            ]
          })

          setWorkspaceError(
            `A canvas diagram request could not be imported: ${failureMessage}`
          )
        }
      }
    } catch (error) {
      setWorkspaceError(
        error instanceof Error && error.message
          ? `Canvas diagram queue processing failed: ${error.message}`
          : 'Canvas diagram queue processing failed.'
      )
    } finally {
      diagramQueueProcessingRef.current = false

      if (diagramQueuePendingRef.current && diagramQueueWorkspaceRef.current === workspacePath) {
        diagramQueuePendingRef.current = false
        void processDiagramQueue(workspacePath, queueIndexPath)
      }
    }
  }

  useEffect(() => {
    if (!activeWorkspace) {
      setWorkspaceTree([])
      return
    }

    let cancelled = false
    const workspacePath = activeWorkspace
    setLoadingWorkspace(true)
    setWorkspaceError(null)

    async function loadWorkspaceTree() {
      try {
        const tree = await window.collaborator.readWorkspaceTree(workspacePath)

        if (!cancelled) {
          startTransition(() => {
            setWorkspaceTree(tree)
          })
        }
      } catch {
        if (!cancelled) {
          setWorkspaceError('The workspace tree could not be read.')
          setWorkspaceTree([])
        }
      } finally {
        if (!cancelled) {
          setLoadingWorkspace(false)
        }
      }
    }

    void loadWorkspaceTree()

    return () => {
      cancelled = true
    }
  }, [activeWorkspace])

  useEffect(() => {
    if (!config) {
      return
    }

    const workspacePath = activeWorkspace ?? null

    if (canvasWorkspaceRef.current === workspacePath && canvasStateRef.current !== null) {
      return
    }

    let cancelled = false
    const requestId = canvasLoadRequestRef.current + 1
    canvasLoadRequestRef.current = requestId

    async function loadWorkspaceCanvas() {
      await flushPendingCanvasSave()

      try {
        const nextCanvasState = await window.collaborator.readCanvasState(workspacePath)

        if (cancelled || canvasLoadRequestRef.current !== requestId) {
          return
        }

        if (canvasFrameRef.current !== null) {
          window.cancelAnimationFrame(canvasFrameRef.current)
          canvasFrameRef.current = null
        }

        canvasWorkspaceRef.current = workspacePath
        canvasStateRef.current = nextCanvasState
        setCanvasWorkspacePath(workspacePath)
        setCanvasState(nextCanvasState)
      } catch {
        if (cancelled || canvasLoadRequestRef.current !== requestId) {
          return
        }

        const nextCanvasState = emptyCanvasState()

        canvasWorkspaceRef.current = workspacePath
        canvasStateRef.current = nextCanvasState
        setCanvasWorkspacePath(workspacePath)
        setCanvasState(nextCanvasState)
        setWorkspaceError('The workspace canvas could not be loaded.')
      }
    }

    void loadWorkspaceCanvas()

    return () => {
      cancelled = true
    }
  }, [activeWorkspace, config])

  useEffect(() => {
    diagramQueueStopRef.current?.()
    diagramQueueStopRef.current = null
    diagramToolsRef.current = null
    setDiagramTools(null)
    setBoardReadyVersion(0)
    diagramQueueWorkspaceRef.current = activeWorkspace
    diagramQueuePendingRef.current = false

    if (!activeWorkspace) {
      return
    }

    let cancelled = false

    void (async () => {
      try {
        const tools = await window.collaborator.ensureWorkspaceDiagramTools(activeWorkspace)

        if (cancelled) {
          return
        }

        diagramToolsRef.current = tools
        setDiagramTools(tools)

        const processQueue = () => {
          void processDiagramQueue(activeWorkspace, tools.queueIndexPath)
        }

        diagramQueueStopRef.current = window.collaborator.onFileChanged(
          tools.queueIndexPath,
          processQueue
        )
        processQueue()
      } catch (error) {
        if (!cancelled) {
          setWorkspaceError(
            error instanceof Error && error.message
              ? `Canvas diagram tools could not be installed: ${error.message}`
              : 'Canvas diagram tools could not be installed.'
          )
        }
      }
    })()

    return () => {
      cancelled = true
      diagramQueueStopRef.current?.()
      diagramQueueStopRef.current = null
    }
  }, [activeWorkspace])

  useEffect(() => {
    if (!activeWorkspace || !canvasState || !diagramTools || !canvasRef.current || boardReadyVersion === 0) {
      return
    }

    void processDiagramQueue(activeWorkspace, diagramTools.queueIndexPath)
  }, [activeWorkspace, boardReadyVersion, canvasState, diagramTools])

  useEffect(() => {
    setSelectedTreePath(null)
    setViewerFile(null)
  }, [activeWorkspace])

  useEffect(() => {
    if (!searchOpen || searchScope !== 'all-workspaces') {
      setGlobalSearchLoading(false)
      return
    }

    let cancelled = false
    const workspacePaths = config?.workspaces ?? []
    const currentWorkspacePath = activeWorkspace
    const currentWorkspaceTree = workspaceTree

    setGlobalSearchLoading(true)

    void (async () => {
      const settledResults = await Promise.allSettled(
        workspacePaths.map(async (workspacePath) => {
          const tree =
            workspacePath === currentWorkspacePath
              ? currentWorkspaceTree
              : await window.collaborator.readWorkspaceTree(workspacePath)

          return flattenFiles(tree).map((file) => ({
            file,
            workspacePath
          }))
        })
      )

      if (cancelled) {
        return
      }

      const nextResults: SearchDialogResult[] = []
      let failureCount = 0

      for (const result of settledResults) {
        if (result.status === 'fulfilled') {
          nextResults.push(...result.value)
        } else {
          failureCount += 1
        }
      }

      setGlobalSearchFiles(nextResults)
      setGlobalSearchLoading(false)

      if (failureCount > 0) {
        setWorkspaceError(
          failureCount === workspacePaths.length
            ? 'Opened workspaces could not be indexed for search.'
            : 'Some opened workspaces could not be indexed for search.'
        )
      }
    })()

    return () => {
      cancelled = true
    }
  }, [activeWorkspace, config, searchOpen, searchScope, workspaceTree])

  useEffect(() => {
    if (!pendingSearchResult || loadingWorkspace || activeWorkspace !== pendingSearchResult.workspacePath) {
      return
    }

    const nextNode = findNodeByPath(workspaceTree, pendingSearchResult.file.path)

    previewFile(nextNode?.kind === 'file' ? nextNode : pendingSearchResult.file)
    setPendingSearchResult(null)
  }, [activeWorkspace, loadingWorkspace, pendingSearchResult, workspaceTree])

  useEffect(() => {
    document.documentElement.classList.toggle('theme-dark', darkMode)
    document.body.classList.toggle('theme-dark', darkMode)

    return () => {
      document.documentElement.classList.remove('theme-dark')
      document.body.classList.remove('theme-dark')
    }
  }, [darkMode])

  useEffect(() => {
    return () => {
      diagramQueueStopRef.current?.()

      if (canvasFrameRef.current !== null) {
        window.cancelAnimationFrame(canvasFrameRef.current)
      }

      if (canvasSaveTimerRef.current !== null) {
        window.clearTimeout(canvasSaveTimerRef.current)
      }

      if (canvasStateRef.current) {
        void window.collaborator.saveCanvasState(canvasWorkspaceRef.current, canvasStateRef.current)
      }
    }
  }, [])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const isEditing = keyboardShortcutsBlocked(event.target)

      if (isEditing) {
        return
      }

      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'o') {
        event.preventDefault()
        void addWorkspace()
        return
      }

      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'd') {
        event.preventDefault()
        const nextDarkMode = !darkMode
        setDarkMode(nextDarkMode)
        void persistUi({
          darkMode: nextDarkMode
        })
        return
      }

      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'w') {
        event.preventDefault()
        window.dispatchEvent(new CustomEvent(WORKSPACE_SWITCHER_OPEN_EVENT))
        return
      }

      if (event.metaKey && !event.ctrlKey && !event.altKey) {
        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          toggleSidebarDock('left')
          return
        }

        if (event.key === 'ArrowRight') {
          event.preventDefault()
          toggleSidebarDock('right')
          return
        }

        if (event.key === 'ArrowDown') {
          event.preventDefault()
          setSidebarPlacement(sidebarSide, true)
          return
        }
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchScope('workspace')
        setSearchOpen(true)
        return
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'o') {
        event.preventDefault()
        setSearchScope('all-workspaces')
        setSearchOpen(true)
        return
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        void createMarkdownNote()
        return
      }

      const fileToPlace = viewerFile ?? selectedFileNode

      if (event.shiftKey && event.key === 'Enter' && fileToPlace) {
        if (shortcutHandledByFocusedControl(event.target)) {
          return
        }

        event.preventDefault()
        placeFileOnCanvas(fileToPlace)
        setViewerFile(null)
        return
      }

      if (event.metaKey || event.ctrlKey) {
        if (event.key === '=' || event.key === '+') {
          event.preventDefault()
          canvasRef.current?.zoomIn()
        }

        if (event.key === '-') {
          event.preventDefault()
          canvasRef.current?.zoomOut()
        }

        if (event.key === '0') {
          event.preventDefault()
          canvasRef.current?.resetZoom()
        }
      }

      if (event.key === 'Escape') {
        if (searchOpen) {
          setSearchOpen(false)
          return
        }

        setViewerFile(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [
    activeWorkspace,
    darkMode,
    noteTargetPath,
    searchOpen,
    selectedFileNode,
    sidebarCollapsed,
    sidebarSide,
    viewerFile
  ])

  useEffect(() => {
    function handlePaste(event: ClipboardEvent) {
      const isEditing = keyboardShortcutsBlocked(event.target)

      if (isEditing) {
        return
      }

      const imageItem = Array.from(event.clipboardData?.items ?? []).find((item) =>
        item.type.startsWith('image/')
      )
      const file = imageItem?.getAsFile()

      if (file) {
        event.preventDefault()
        event.stopPropagation()

        void (async () => {
          const importedNode = await importWorkspaceImageFile(file)

          if (importedNode) {
            canvasRef.current?.spawnFileTile(importedNode)
          }
        })()
        return
      }

      const pastedUrl = extractPastedUrl(event.clipboardData)

      if (!pastedUrl) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      canvasRef.current?.spawnEmbedTile(pastedUrl.canonicalUrl)
    }

    window.addEventListener('paste', handlePaste, true)

    return () => {
      window.removeEventListener('paste', handlePaste, true)
    }
  }, [activeWorkspace])

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      if (!resizeRef.current || !config) {
        return
      }

      const nextWidth = clamp(
        resizeRef.current.side === 'left'
          ? resizeRef.current.startWidth + event.clientX - resizeRef.current.startX
          : resizeRef.current.startWidth - (event.clientX - resizeRef.current.startX),
        260,
        520
      )
      setSidebarWidth(nextWidth)
    }

    function handlePointerUp() {
      if (!resizeRef.current || !config) {
        return
      }

      resizeRef.current = null
      void persistConfig({
        ...config,
        ui: {
          ...config.ui,
          sidebarWidth
        }
      })
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [config, sidebarWidth])

  useEffect(() => {
    if (!workspaceError) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setWorkspaceError(null)
    }, 4200)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [workspaceError])

  async function persistConfig(nextConfig: AppConfig) {
    setConfig(nextConfig)
    const saved = await window.collaborator.saveConfig(nextConfig)
    setConfig(saved)
    setSidebarWidth(saved.ui.sidebarWidth)
    setDarkMode(saved.ui.darkMode)
    setSidebarCollapsed(saved.ui.sidebarCollapsed)
    setSidebarSide(saved.ui.sidebarSide)
  }

  async function persistUi(nextUi: Partial<AppConfig['ui']>) {
    if (!config) {
      return
    }

    await persistConfig({
      ...config,
      ui: {
        ...config.ui,
        ...nextUi
      }
    })
  }

  async function addWorkspace() {
    if (!config) {
      return
    }

    const selectedPath = await window.collaborator.pickWorkspaceDirectory()

    if (!selectedPath) {
      return
    }

    const existingIndex = config.workspaces.indexOf(selectedPath)
    const nextWorkspaces =
      existingIndex === -1 ? [...config.workspaces, selectedPath] : [...config.workspaces]
    const nextIndex = existingIndex === -1 ? nextWorkspaces.length - 1 : existingIndex

    await persistConfig({
      ...config,
      workspaces: nextWorkspaces,
      activeWorkspace: nextIndex
    })
  }

  async function refreshWorkspaceTree(workspacePath: string) {
    setLoadingWorkspace(true)
    setWorkspaceError(null)

    try {
      const tree = await window.collaborator.readWorkspaceTree(workspacePath)

      startTransition(() => {
        setWorkspaceTree(tree)
      })

      return tree
    } catch {
      setWorkspaceError('The workspace tree could not be read.')
      setWorkspaceTree([])
      return [] as FileTreeNode[]
    } finally {
      setLoadingWorkspace(false)
    }
  }

  async function removeActiveWorkspace() {
    if (!config || !activeWorkspace) {
      return
    }

    const nextWorkspaces = config.workspaces.filter((workspace) => workspace !== activeWorkspace)

    await persistConfig({
      ...config,
      workspaces: nextWorkspaces,
      activeWorkspace: clamp(config.activeWorkspace - 1, 0, Math.max(nextWorkspaces.length - 1, 0))
    })

    setWorkspaceTree([])
    setViewerFile(null)
  }

  function previewFile(file: FileTreeNode) {
    setSelectedTreePath(file.path)
    setViewerFile(file)
  }

  function selectWorkspaceNode(node: FileTreeNode, options?: { preview?: boolean }) {
    setSelectedTreePath(node.path)

    if (node.kind === 'file' && options?.preview !== false) {
      setViewerFile(node)
    }
  }

  async function createMarkdownNote() {
    const nextNode = await createWorkspaceMarkdownNote()

    if (!nextNode) {
      return
    }

    canvasRef.current?.spawnFileTile(nextNode)
  }

  async function createWorkspaceMarkdownNote(options?: {
    baseName?: string
    initialContent?: string
    targetDirectoryPath?: string
  }): Promise<FileTreeNode | null> {
    const workspaceRoot = activeWorkspace ?? options?.targetDirectoryPath ?? null

    if (!workspaceRoot) {
      return null
    }

    try {
      const createdNode = await window.collaborator.createWorkspaceNote(workspaceRoot, {
        baseName: options?.baseName,
        initialContent: options?.initialContent,
        targetDirectoryPath: options?.targetDirectoryPath ?? noteTargetPath ?? workspaceRoot
      })

      if (!activeWorkspace) {
        setViewerFile(null)
        return createdNode
      }

      const nextTree = await refreshWorkspaceTree(activeWorkspace)
      const nextNode = findNodeByPath(nextTree, createdNode.path) ?? createdNode

      setSelectedTreePath(nextNode.path)
      setViewerFile(null)

      return nextNode
    } catch (error) {
      setWorkspaceError(
        error instanceof Error && error.message
          ? `A new markdown note could not be created: ${error.message}`
          : 'A new markdown note could not be created in the current folder.'
      )
      return null
    }
  }

  async function openActiveWorkspacePath() {
    if (!activeWorkspace) {
      return
    }

    try {
      if (typeof window.collaborator.openPath !== 'function') {
        throw new Error('Workspace opening is available after restarting the app.')
      }

      await window.collaborator.openPath(activeWorkspace)
    } catch (error) {
      setWorkspaceError(
        error instanceof Error && error.message
          ? `The workspace root could not be opened: ${error.message}`
          : 'The workspace root could not be opened.'
      )
    }
  }

  async function copyActiveWorkspacePath() {
    if (!activeWorkspace) {
      return
    }

    try {
      if (typeof window.collaborator.copyTextToClipboard === 'function') {
        await window.collaborator.copyTextToClipboard(activeWorkspace)
        return
      }

      await copyTextWithBrowserFallback(activeWorkspace)
    } catch (error) {
      try {
        await copyTextWithBrowserFallback(activeWorkspace)
      } catch (fallbackError) {
        const message =
          fallbackError instanceof Error && fallbackError.message
            ? fallbackError.message
            : error instanceof Error && error.message
              ? error.message
              : null

        setWorkspaceError(
          message
            ? `The workspace root path could not be copied: ${message}`
            : 'The workspace root path could not be copied.'
        )
      }
    }
  }

  async function copyWorkspaceNodePath(targetPath: string) {
    try {
      if (typeof window.collaborator.copyTextToClipboard === 'function') {
        await window.collaborator.copyTextToClipboard(targetPath)
      } else {
        await copyTextWithBrowserFallback(targetPath)
      }

      setWorkspaceError(null)
    } catch (error) {
      try {
        await copyTextWithBrowserFallback(targetPath)
        setWorkspaceError(null)
      } catch (fallbackError) {
        const message =
          fallbackError instanceof Error && fallbackError.message
            ? fallbackError.message
            : error instanceof Error && error.message
              ? error.message
              : null

        setWorkspaceError(
          message ? `That path could not be copied: ${message}` : 'That path could not be copied.'
        )
      }
    }
  }

  async function revealWorkspaceNodeInFinder(targetPath: string) {
    try {
      if (typeof window.collaborator.revealPath !== 'function') {
        throw new Error('Restart Open Canvas once to enable Finder reveal from the file tree.')
      }

      await window.collaborator.revealPath(targetPath)
      setWorkspaceError(null)
    } catch (error) {
      setWorkspaceError(
        error instanceof Error && error.message
          ? `That item could not be revealed in Finder: ${error.message}`
          : 'That item could not be revealed in Finder.'
      )
    }
  }

  async function importWorkspaceImageFile(file: File): Promise<FileTreeNode | null> {
    if (!activeWorkspace) {
      setWorkspaceError('Add a workspace before pasting or dropping images onto the canvas.')
      return null
    }

    try {
      const importedNode = await window.collaborator.importWorkspaceImage(activeWorkspace, {
        bytes: Array.from(new Uint8Array(await file.arrayBuffer())),
        fileName: file.name,
        mimeType: file.type
      })

      setWorkspaceError(null)

      return importedNode
    } catch {
      setWorkspaceError('The image could not be saved into the active workspace.')
      return null
    }
  }

  async function importWorkspaceAssetFile(file: File): Promise<FileTreeNode | null> {
    if (!activeWorkspace) {
      setWorkspaceError('Add a workspace before dropping media, PDFs, spreadsheets, or presentations onto the canvas.')
      return null
    }

    if (typeof window.collaborator.importWorkspaceAsset !== 'function') {
      setWorkspaceError('Restart Open Canvas once to enable PDF, office, and media imports.')
      return null
    }

    try {
      const importedNode = await window.collaborator.importWorkspaceAsset(activeWorkspace, {
        bytes: Array.from(new Uint8Array(await file.arrayBuffer())),
        fileName: file.name,
        mimeType: file.type
      })

      setWorkspaceError(null)

      return importedNode
    } catch {
      setWorkspaceError('That file could not be saved into the active workspace.')
      return null
    }
  }

  async function moveFileIntoDirectory(sourcePath: string, targetDirectoryPath: string) {
    if (!activeWorkspace) {
      return
    }

    try {
      const movedNode = await window.collaborator.moveWorkspaceNode(
        activeWorkspace,
        sourcePath,
        targetDirectoryPath
      )
      const nextTree = await refreshWorkspaceTree(activeWorkspace)
      const rebasedViewerPath =
        viewerFile && isSameOrDescendantPath(viewerFile.path, sourcePath)
          ? replacePathPrefix(viewerFile.path, sourcePath, movedNode.path)
          : null
      const rebasedSelectedPath = isSameOrDescendantPath(selectedTreePath, sourcePath)
        ? replacePathPrefix(selectedTreePath ?? '', sourcePath, movedNode.path)
        : null

      if (rebasedViewerPath) {
        const nextViewerNode = findNodeByPath(nextTree, rebasedViewerPath)
        setViewerFile(nextViewerNode?.kind === 'file' ? nextViewerNode : null)
      }

      if (rebasedSelectedPath) {
        const nextSelectedNode = findNodeByPath(nextTree, rebasedSelectedPath)
        setSelectedTreePath(nextSelectedNode?.path ?? null)
      }

      const currentCanvasState = canvasStateRef.current

      if (currentCanvasState) {
        const nextCanvasState: CanvasState = {
          ...currentCanvasState,
          tiles: currentCanvasState.tiles.map((tile) =>
            isSameOrDescendantPath(tile.filePath, sourcePath)
              ? {
                  ...tile,
                  filePath: replacePathPrefix(tile.filePath ?? '', sourcePath, movedNode.path),
                  title:
                    tile.filePath === sourcePath
                      ? movedNode.name
                      : fileNameFromPath(replacePathPrefix(tile.filePath ?? '', sourcePath, movedNode.path))
                }
              : tile
          )
        }

        handleCanvasStateChange(nextCanvasState, { immediate: true })
      }

      setWorkspaceError(null)
    } catch {
      setWorkspaceError('That item could not be moved into the selected folder.')
    }
  }

  async function renameWorkspaceNode(targetPath: string, nextName: string) {
    if (!activeWorkspace) {
      return
    }

    try {
      const renamedNode = await window.collaborator.renameWorkspaceNode(activeWorkspace, {
        nextName,
        targetPath
      })
      const nextTree = await refreshWorkspaceTree(activeWorkspace)
      const rebasedViewerPath =
        viewerFile && isSameOrDescendantPath(viewerFile.path, targetPath)
          ? replacePathPrefix(viewerFile.path, targetPath, renamedNode.path)
          : null
      const rebasedSelectedPath = isSameOrDescendantPath(selectedTreePath, targetPath)
        ? replacePathPrefix(selectedTreePath ?? '', targetPath, renamedNode.path)
        : null

      if (rebasedViewerPath) {
        const nextViewerNode = findNodeByPath(nextTree, rebasedViewerPath)
        setViewerFile(nextViewerNode?.kind === 'file' ? nextViewerNode : null)
      }

      if (rebasedSelectedPath) {
        const nextSelectedNode = findNodeByPath(nextTree, rebasedSelectedPath)
        setSelectedTreePath(nextSelectedNode?.path ?? null)
      }

      const currentCanvasState = canvasStateRef.current

      if (currentCanvasState) {
        const nextCanvasState: CanvasState = {
          ...currentCanvasState,
          tiles: currentCanvasState.tiles.map((tile) =>
            isSameOrDescendantPath(tile.filePath, targetPath)
              ? {
                  ...tile,
                  filePath: replacePathPrefix(tile.filePath ?? '', targetPath, renamedNode.path),
                  title:
                    tile.filePath === targetPath
                      ? renamedNode.name
                      : fileNameFromPath(replacePathPrefix(tile.filePath ?? '', targetPath, renamedNode.path))
                }
              : tile
          )
        }

        handleCanvasStateChange(nextCanvasState, { immediate: true })
      }

      setWorkspaceError(null)
    } catch (error) {
      setWorkspaceError(
        error instanceof Error && error.message
          ? `That item could not be renamed: ${error.message}`
          : 'That item could not be renamed.'
      )
    }
  }

  async function createWorkspaceFile(targetDirectoryPath: string, fileName: string) {
    if (!activeWorkspace) {
      return
    }

    try {
      const createdNode = await window.collaborator.createWorkspaceFile(activeWorkspace, {
        fileName,
        targetDirectoryPath
      })
      const nextTree = await refreshWorkspaceTree(activeWorkspace)
      const nextNode = findNodeByPath(nextTree, createdNode.path) ?? createdNode

      setSelectedTreePath(nextNode.path)
      setViewerFile(nextNode.kind === 'file' ? nextNode : null)
      setWorkspaceError(null)
    } catch (error) {
      setWorkspaceError(
        error instanceof Error && error.message
          ? `That file could not be created: ${error.message}`
          : 'That file could not be created.'
      )
    }
  }

  async function createWorkspaceDirectory(targetDirectoryPath: string, directoryName: string) {
    if (!activeWorkspace) {
      return
    }

    try {
      const createdNode = await window.collaborator.createWorkspaceDirectory(activeWorkspace, {
        directoryName,
        targetDirectoryPath
      })
      const nextTree = await refreshWorkspaceTree(activeWorkspace)
      const nextNode = findNodeByPath(nextTree, createdNode.path) ?? createdNode

      setSelectedTreePath(nextNode.path)
      setViewerFile(null)
      setWorkspaceError(null)
    } catch (error) {
      setWorkspaceError(
        error instanceof Error && error.message
          ? `That folder could not be created: ${error.message}`
          : 'That folder could not be created.'
      )
    }
  }

  async function deleteWorkspaceNode(targetPath: string) {
    if (!activeWorkspace) {
      return
    }

    try {
      await window.collaborator.deleteWorkspaceNode(activeWorkspace, targetPath)
      await refreshWorkspaceTree(activeWorkspace)

      if (isSameOrDescendantPath(viewerFile?.path, targetPath)) {
        setViewerFile(null)
      }

      if (isSameOrDescendantPath(selectedTreePath, targetPath)) {
        setSelectedTreePath(null)
      }

      const currentCanvasState = canvasStateRef.current

      if (currentCanvasState) {
        const removedTileIds = new Set(
          currentCanvasState.tiles
            .filter((tile) => isSameOrDescendantPath(tile.filePath, targetPath))
            .map((tile) => tile.id)
        )

        if (removedTileIds.size > 0) {
          const nextCanvasState: CanvasState = {
            ...currentCanvasState,
            tiles: currentCanvasState.tiles
              .filter((tile) => !removedTileIds.has(tile.id))
              .map((tile) =>
                tile.type === 'term'
                  ? {
                      ...tile,
                      contextTileIds: (tile.contextTileIds ?? []).filter(
                        (contextTileId) => !removedTileIds.has(contextTileId)
                      )
                    }
                  : tile
              )
          }

          handleCanvasStateChange(nextCanvasState, { immediate: true })
        }
      }

      setWorkspaceError(null)
    } catch (error) {
      setWorkspaceError(
        error instanceof Error && error.message
          ? `That item could not be deleted: ${error.message}`
          : 'That item could not be deleted.'
      )
    }
  }

  function placeFileOnCanvas(file: FileTreeNode) {
    canvasRef.current?.spawnFileTile(file)
    setSelectedTreePath(file.path)
  }

  function terminalProviderDependencyMessage(provider: TerminalProvider) {
    if (!terminalDependencies) {
      return 'Terminal prerequisites are still loading.'
    }

    if (!terminalDependencies.tmuxInstalled) {
      return 'Install tmux and restart the app before creating terminal tiles.'
    }

    const providerState = terminalDependencies.providers[provider]

    if (!providerState?.installed) {
      return `Install ${providerState?.command ?? terminalProviderLabel(provider)} and restart the app before creating ${terminalProviderLabel(provider)} terminals.`
    }

    return null
  }

  function createTerminal(provider: TerminalProvider = 'claude') {
    const dependencyMessage = terminalProviderDependencyMessage(provider)

    if (dependencyMessage) {
      setWorkspaceError(dependencyMessage)
      return
    }

    canvasRef.current?.createTerminal(provider)
  }

  function setSidebarPlacement(nextSide: SidebarSide, nextCollapsed = false) {
    setSidebarSide(nextSide)
    setSidebarCollapsed(nextCollapsed)
    void persistUi({
      sidebarCollapsed: nextCollapsed,
      sidebarSide: nextSide
    })
  }

  function toggleSidebarDock(nextSide: SidebarSide) {
    if (!sidebarCollapsed && sidebarSide === nextSide) {
      setSidebarPlacement(nextSide, true)
      return
    }

    setSidebarPlacement(nextSide, false)
  }

  function scheduleCanvasSave(nextState: CanvasState, immediate = false) {
    const workspacePath = canvasWorkspaceRef.current

    if (canvasSaveTimerRef.current !== null) {
      window.clearTimeout(canvasSaveTimerRef.current)
      canvasSaveTimerRef.current = null
    }

    if (immediate) {
      void window.collaborator.saveCanvasState(workspacePath, nextState)
      return
    }

    canvasSaveTimerRef.current = window.setTimeout(() => {
      canvasSaveTimerRef.current = null

      if (canvasStateRef.current) {
        void window.collaborator.saveCanvasState(workspacePath, canvasStateRef.current)
      }
    }, 500)
  }

  function handleCanvasStateChange(nextState: CanvasState, options?: { immediate?: boolean }) {
    canvasStateRef.current = nextState

    if (options?.immediate) {
      if (canvasFrameRef.current !== null) {
        window.cancelAnimationFrame(canvasFrameRef.current)
        canvasFrameRef.current = null
      }

      setCanvasState(nextState)
      scheduleCanvasSave(nextState, true)
      return
    }

    if (canvasFrameRef.current === null) {
      canvasFrameRef.current = window.requestAnimationFrame(() => {
        canvasFrameRef.current = null

        if (canvasStateRef.current) {
          setCanvasState(canvasStateRef.current)
        }
      })
    }

    scheduleCanvasSave(nextState)
  }

  if (bootError) {
    return (
      <div className="app-shell">
        <div className="glass-panel flex flex-1 items-center justify-center rounded-[6px] text-center">
          <div className="max-w-lg p-8">
            <div className="text-[11px] uppercase tracking-[0.25em] text-[var(--text-faint)]">
              Boot Error
            </div>
            <div className="mt-4 text-2xl font-semibold text-[var(--text)]">{bootError}</div>
          </div>
        </div>
      </div>
    )
  }

  if (!config || !canvasState) {
    return (
      <div className="app-shell">
        <div className="glass-panel flex flex-1 items-center justify-center rounded-[6px]">
          <div className="text-sm uppercase tracking-[0.25em] text-[var(--text-faint)]">
            Initializing…
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <div className="flex h-full min-h-0 min-w-0 flex-1 overflow-hidden">
        {sidebarCollapsed || sidebarSide === 'right' ? null : (
          <div
            style={{ width: sidebarWidth }}
            className="min-h-0 min-w-[260px] max-w-[520px] opacity-100 transition-[width,opacity] duration-200"
          >
            <Sidebar
              activeTreePath={selectedTreePath}
              config={config}
              darkMode={darkMode}
              loadingWorkspace={loadingWorkspace}
              onAddWorkspace={() => void addWorkspace()}
              onCopyWorkspacePath={() => void copyActiveWorkspacePath()}
              onCreateNote={() => void createMarkdownNote()}
              onCreateWorkspaceDirectory={(targetDirectoryPath, directoryName) =>
                void createWorkspaceDirectory(targetDirectoryPath, directoryName)
              }
              onCreateWorkspaceFile={(targetDirectoryPath, fileName) =>
                void createWorkspaceFile(targetDirectoryPath, fileName)
              }
              onCreateTerminal={createTerminal}
              onCopyNodePath={(targetPath) => void copyWorkspaceNodePath(targetPath)}
              onDeleteNode={(targetPath) => void deleteWorkspaceNode(targetPath)}
              onMoveFile={(sourcePath, targetDirectoryPath) =>
                void moveFileIntoDirectory(sourcePath, targetDirectoryPath)
              }
              onRevealNodeInFinder={(targetPath) => void revealWorkspaceNodeInFinder(targetPath)}
              onRenameNode={(targetPath, nextName) => void renameWorkspaceNode(targetPath, nextName)}
              onOpenWorkspacePath={() => void openActiveWorkspacePath()}
              onMoveSidebar={setSidebarPlacement}
              onOpenSearch={() => {
                setSearchScope('workspace')
                setSearchOpen(true)
              }}
              onPlaceFile={placeFileOnCanvas}
              onRemoveWorkspace={() => void removeActiveWorkspace()}
              onSelectNode={selectWorkspaceNode}
              onSelectWorkspace={(index) =>
                void persistConfig({
                  ...config,
                  activeWorkspace: index
                })
              }
              terminalDependencies={terminalDependencies}
              onToggleSidebar={() => {
                setSidebarCollapsed(true)
                void persistUi({
                  sidebarCollapsed: true
                })
              }}
              onToggleDarkMode={() => {
                const nextDarkMode = !darkMode
                setDarkMode(nextDarkMode)
                void persistUi({
                  darkMode: nextDarkMode
                })
              }}
              sidebarCollapsed={sidebarCollapsed}
              sidebarSide={sidebarSide}
              sidebarWidth={sidebarWidth}
              workspaceRootPath={activeWorkspace}
              workspaceTree={workspaceTree}
            />
          </div>
        )}

        {sidebarCollapsed || sidebarSide === 'right' ? null : (
          <div
            className="w-3 cursor-col-resize"
            onPointerDown={(event) => {
              resizeRef.current = {
                side: sidebarSide,
                startX: event.clientX,
                startWidth: sidebarWidth
              }
            }}
          />
        )}

        <main className="relative min-h-0 min-w-0 flex-1">
          {sidebarCollapsed && !viewerFile ? (
            <div
              className={clsx(
                'app-drag-region glass-panel absolute top-3 z-[270] flex items-center gap-1 rounded-[6px] border border-[color:var(--line-strong)] bg-[var(--surface-0)] p-1.5',
                sidebarSide === 'left' ? 'left-3' : 'right-3'
              )}
            >
              <HoverTooltip
                label="Open sidebar on the left"
                placement="bottom"
                shortcut={SIDEBAR_LEFT_SHORTCUT_KEY}
              >
                <button
                  className="app-no-drag flex h-10 w-10 items-center justify-center rounded-[4px] text-[var(--text-dim)] transition hover:bg-[var(--surface-1)] hover:text-[var(--text)]"
                  aria-label="Open sidebar on the left"
                  data-managed-tooltip="custom"
                  data-shortcut={SIDEBAR_LEFT_SHORTCUT_KEY ?? undefined}
                  onClick={() => setSidebarPlacement('left')}
                >
                  <SidebarDockIcon side="left" />
                </button>
              </HoverTooltip>
              <HoverTooltip
                label="Open sidebar on the right"
                placement="bottom"
                shortcut={SIDEBAR_RIGHT_SHORTCUT_KEY}
              >
                <button
                  className="app-no-drag flex h-10 w-10 items-center justify-center rounded-[4px] text-[var(--text-dim)] transition hover:bg-[var(--surface-1)] hover:text-[var(--text)]"
                  aria-label="Open sidebar on the right"
                  data-managed-tooltip="custom"
                  data-shortcut={SIDEBAR_RIGHT_SHORTCUT_KEY ?? undefined}
                  onClick={() => setSidebarPlacement('right')}
                >
                  <SidebarDockIcon side="right" />
                </button>
              </HoverTooltip>
            </div>
          ) : null}
          <CanvasSurface
            activeWorkspacePath={activeWorkspace}
            darkMode={darkMode}
            key={canvasWorkspacePath ?? 'no-workspace'}
            officeViewer={officeViewer}
            onBoardReady={() => {
              setBoardReadyVersion((currentVersion) => currentVersion + 1)
            }}
            ref={canvasRef}
            onCreateMarkdownCard={({ baseName, initialContent, targetDirectoryPath }) =>
              createWorkspaceMarkdownNote({ baseName, initialContent, targetDirectoryPath })
            }
            onCreateMarkdownNote={() => void createMarkdownNote()}
            onConvertStickyNoteToMarkdown={(content) =>
              createWorkspaceMarkdownNote({ initialContent: content })
            }
            onImportAssetFile={importWorkspaceAssetFile}
            onImportImageFile={importWorkspaceImageFile}
            onOpenFile={previewFile}
            onStateChange={handleCanvasStateChange}
            shortcutsSuspended={Boolean(viewerFile)}
            state={canvasState}
          />
          <ViewerOverlay
            file={viewerFile}
            onClose={() => setViewerFile(null)}
            onImportImageFile={importWorkspaceImageFile}
            officeViewer={officeViewer}
            onPlaceOnCanvas={placeFileOnCanvas}
          />
          {workspaceError ? (
            <div
              className={clsx(
                'absolute right-3 top-3 z-[260] max-w-[24rem] rounded-[4px] border px-3.5 py-3 text-[13px] leading-5 shadow-[0_14px_30px_rgba(0,0,0,0.18)] backdrop-blur',
                'border-[color:var(--error-line)] bg-[var(--error-bg)] text-[var(--error-text)]'
              )}
            >
              {workspaceError}
            </div>
          ) : null}
        </main>

        {sidebarCollapsed || sidebarSide === 'left' ? null : (
          <div
            className="w-3 cursor-col-resize"
            onPointerDown={(event) => {
              resizeRef.current = {
                side: sidebarSide,
                startX: event.clientX,
                startWidth: sidebarWidth
              }
            }}
          />
        )}

        {sidebarCollapsed || sidebarSide === 'left' ? null : (
          <div
            style={{ width: sidebarWidth }}
            className="min-h-0 min-w-[260px] max-w-[520px] opacity-100 transition-[width,opacity] duration-200"
          >
            <Sidebar
              activeTreePath={selectedTreePath}
              config={config}
              darkMode={darkMode}
              loadingWorkspace={loadingWorkspace}
              onAddWorkspace={() => void addWorkspace()}
              onCopyWorkspacePath={() => void copyActiveWorkspacePath()}
              onCreateNote={() => void createMarkdownNote()}
              onCreateWorkspaceDirectory={(targetDirectoryPath, directoryName) =>
                void createWorkspaceDirectory(targetDirectoryPath, directoryName)
              }
              onCreateWorkspaceFile={(targetDirectoryPath, fileName) =>
                void createWorkspaceFile(targetDirectoryPath, fileName)
              }
              onCreateTerminal={createTerminal}
              onCopyNodePath={(targetPath) => void copyWorkspaceNodePath(targetPath)}
              onDeleteNode={(targetPath) => void deleteWorkspaceNode(targetPath)}
              onMoveFile={(sourcePath, targetDirectoryPath) =>
                void moveFileIntoDirectory(sourcePath, targetDirectoryPath)
              }
              onRevealNodeInFinder={(targetPath) => void revealWorkspaceNodeInFinder(targetPath)}
              onRenameNode={(targetPath, nextName) => void renameWorkspaceNode(targetPath, nextName)}
              onOpenWorkspacePath={() => void openActiveWorkspacePath()}
              onMoveSidebar={setSidebarPlacement}
              onOpenSearch={() => {
                setSearchScope('workspace')
                setSearchOpen(true)
              }}
              onPlaceFile={placeFileOnCanvas}
              onRemoveWorkspace={() => void removeActiveWorkspace()}
              onSelectNode={selectWorkspaceNode}
              onSelectWorkspace={(index) =>
                void persistConfig({
                  ...config,
                  activeWorkspace: index
                })
              }
              terminalDependencies={terminalDependencies}
              onToggleSidebar={() => {
                setSidebarCollapsed(true)
                void persistUi({
                  sidebarCollapsed: true
                })
              }}
              onToggleDarkMode={() => {
                const nextDarkMode = !darkMode
                setDarkMode(nextDarkMode)
                void persistUi({
                  darkMode: nextDarkMode
                })
              }}
              sidebarCollapsed={sidebarCollapsed}
              sidebarSide={sidebarSide}
              sidebarWidth={sidebarWidth}
              workspaceRootPath={activeWorkspace}
              workspaceTree={workspaceTree}
            />
          </div>
        )}
      </div>

      <SearchDialog
        loading={searchScope === 'all-workspaces' ? globalSearchLoading : false}
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelect={(result) => {
          setSearchOpen(false)

          if (!config || result.workspacePath === activeWorkspace) {
            previewFile(result.file)
            return
          }

          const nextWorkspaceIndex = config.workspaces.indexOf(result.workspacePath)

          if (nextWorkspaceIndex === -1) {
            previewFile(result.file)
            return
          }

          setPendingSearchResult(result)
          void persistConfig({
            ...config,
            activeWorkspace: nextWorkspaceIndex
          })
        }}
        results={searchFiles}
        scope={searchScope}
      />
    </div>
  )
}
