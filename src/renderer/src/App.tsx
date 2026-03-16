import { startTransition, useEffect, useMemo, useRef, useState } from 'react'

import clsx from 'clsx'
import type {
  AppConfig,
  CanvasState,
  FileTreeNode,
  SidebarSide,
  TerminalDependencyState
} from '@shared/types'

import { CanvasSurface, type CanvasSurfaceHandle } from './components/CanvasSurface'
import { SearchDialog } from './components/SearchDialog'
import { Sidebar } from './components/Sidebar'
import { ViewerOverlay } from './components/ViewerOverlay'

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

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
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

  const [config, setConfig] = useState<AppConfig | null>(null)
  const [canvasState, setCanvasState] = useState<CanvasState | null>(null)
  const [workspaceTree, setWorkspaceTree] = useState<FileTreeNode[]>([])
  const [viewerFile, setViewerFile] = useState<FileTreeNode | null>(null)
  const [sidebarWidth, setSidebarWidth] = useState(320)
  const [darkMode, setDarkMode] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [sidebarSide, setSidebarSide] = useState<SidebarSide>('left')
  const [searchOpen, setSearchOpen] = useState(false)
  const [loadingWorkspace, setLoadingWorkspace] = useState(false)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)
  const [bootError, setBootError] = useState<string | null>(null)
  const [terminalDependencies, setTerminalDependencies] = useState<TerminalDependencyState | null>(null)

  const activeWorkspace = config ? config.workspaces[config.activeWorkspace] ?? null : null
  const flatFiles = useMemo(() => flattenFiles(workspaceTree), [workspaceTree])
  const missingTerminalDependencies =
    terminalDependencies === null
      ? []
      : [
          terminalDependencies.tmuxInstalled ? null : 'tmux',
          terminalDependencies.claudeInstalled ? null : terminalDependencies.claudeCommand
        ].filter((dependency): dependency is string => Boolean(dependency))
  const terminalReady = terminalDependencies !== null && missingTerminalDependencies.length === 0
  const terminalDependencyMessage =
    terminalDependencies === null || terminalReady
      ? null
      : `Install ${missingTerminalDependencies.join(' and ')} and restart the app before creating terminal tiles.`

  useEffect(() => {
    let cancelled = false

    async function bootstrap() {
      try {
        const payload = await window.collaborator.bootstrap()

        if (cancelled) {
          return
        }

        setConfig(payload.config)
        setCanvasState(payload.canvasState)
        canvasStateRef.current = payload.canvasState
        setSidebarWidth(payload.config.ui.sidebarWidth)
        setDarkMode(payload.config.ui.darkMode)
        setSidebarCollapsed(payload.config.ui.sidebarCollapsed)
        setSidebarSide(payload.config.ui.sidebarSide)
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
    document.documentElement.classList.toggle('theme-dark', darkMode)
    document.body.classList.toggle('theme-dark', darkMode)

    return () => {
      document.documentElement.classList.remove('theme-dark')
      document.body.classList.remove('theme-dark')
    }
  }, [darkMode])

  useEffect(() => {
    return () => {
      if (canvasFrameRef.current !== null) {
        window.cancelAnimationFrame(canvasFrameRef.current)
      }

      if (canvasSaveTimerRef.current !== null) {
        window.clearTimeout(canvasSaveTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      const isEditing =
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'INPUT' ||
        target?.isContentEditable === true

      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'o') {
        event.preventDefault()
        void addWorkspace()
        return
      }

      if (
        (event.metaKey || event.ctrlKey) &&
        (event.key.toLowerCase() === 'k' || event.key.toLowerCase() === 'o')
      ) {
        event.preventDefault()
        setSearchOpen(true)
        return
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n' && !isEditing) {
        event.preventDefault()
        void createRootNote()
        return
      }

      if (event.shiftKey && event.key === 'Enter' && !isEditing && viewerFile) {
        event.preventDefault()
        placeFileOnCanvas(viewerFile)
        return
      }

      if ((event.metaKey || event.ctrlKey) && !isEditing) {
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

      if (event.key === 'Escape' && !isEditing) {
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
  }, [searchOpen, viewerFile, activeWorkspace])

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
    setViewerFile(file)
  }

  async function createRootNote() {
    if (!activeWorkspace) {
      return
    }

    try {
      const createdNode = await window.collaborator.createWorkspaceNote(activeWorkspace)
      const nextTree = await refreshWorkspaceTree(activeWorkspace)
      const nextNode = findNodeByPath(nextTree, createdNode.path) ?? createdNode

      canvasRef.current?.spawnFileTile(nextNode)
      setViewerFile(null)
    } catch {
      setWorkspaceError('A new note could not be created in the workspace root.')
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
      const nextNode = findNodeByPath(nextTree, movedNode.path) ?? movedNode

      if (viewerFile?.path === sourcePath) {
        setViewerFile(nextNode)
      }

      const currentCanvasState = canvasStateRef.current

      if (currentCanvasState) {
        const nextCanvasState: CanvasState = {
          ...currentCanvasState,
          tiles: currentCanvasState.tiles.map((tile) =>
            tile.filePath === sourcePath
              ? {
                  ...tile,
                  filePath: nextNode.path,
                  title: nextNode.name
                }
              : tile
          )
        }

        handleCanvasStateChange(nextCanvasState, { immediate: true })
      }
    } catch {
      setWorkspaceError('That file could not be moved into the selected folder.')
    }
  }

  function placeFileOnCanvas(file: FileTreeNode) {
    canvasRef.current?.spawnFileTile(file)
    setViewerFile(file)
  }

  function createTerminal() {
    if (!terminalReady) {
      setWorkspaceError(
        terminalDependencyMessage ?? 'Terminal prerequisites are missing. Install tmux and Claude Code, then restart the app.'
      )
      return
    }

    canvasRef.current?.createTerminal()
  }

  function setSidebarPlacement(nextSide: SidebarSide, nextCollapsed = false) {
    setSidebarSide(nextSide)
    setSidebarCollapsed(nextCollapsed)
    void persistUi({
      sidebarCollapsed: nextCollapsed,
      sidebarSide: nextSide
    })
  }

  function scheduleCanvasSave(nextState: CanvasState, immediate = false) {
    if (canvasSaveTimerRef.current !== null) {
      window.clearTimeout(canvasSaveTimerRef.current)
      canvasSaveTimerRef.current = null
    }

    if (immediate) {
      void window.collaborator.saveCanvasState(nextState)
      return
    }

    canvasSaveTimerRef.current = window.setTimeout(() => {
      canvasSaveTimerRef.current = null

      if (canvasStateRef.current) {
        void window.collaborator.saveCanvasState(canvasStateRef.current)
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
        <div className="glass-panel flex flex-1 items-center justify-center rounded-[10px] text-center">
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
        <div className="glass-panel flex flex-1 items-center justify-center rounded-[10px]">
          <div className="text-sm uppercase tracking-[0.25em] text-[var(--text-faint)]">
            Initializing…
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <div className="flex h-full min-w-0 flex-1">
        {sidebarCollapsed || sidebarSide === 'right' ? null : (
          <div
            style={{ width: sidebarWidth }}
            className="min-w-[260px] max-w-[520px] overflow-hidden opacity-100 transition-[width,opacity] duration-200"
          >
            <Sidebar
              activeFilePath={viewerFile?.path ?? null}
              config={config}
              darkMode={darkMode}
              loadingWorkspace={loadingWorkspace}
              onAddWorkspace={() => void addWorkspace()}
              onCreateNote={() => void createRootNote()}
              onCreateTerminal={createTerminal}
              onMoveFile={(sourcePath, targetDirectoryPath) =>
                void moveFileIntoDirectory(sourcePath, targetDirectoryPath)
              }
              onMoveSidebar={setSidebarPlacement}
              onOpenSearch={() => setSearchOpen(true)}
              onPlaceFile={placeFileOnCanvas}
              onRemoveWorkspace={() => void removeActiveWorkspace()}
              onSelectFile={previewFile}
              onSelectWorkspace={(index) =>
                void persistConfig({
                  ...config,
                  activeWorkspace: index
                })
              }
              terminalDependencyMessage={terminalDependencyMessage}
              terminalReady={terminalReady}
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

        <main className="relative min-w-0 flex-1">
          {sidebarCollapsed && !viewerFile ? (
            <div
              className={clsx(
                'glass-panel absolute top-3 z-[270] flex items-center gap-1 rounded-[10px] border border-[color:var(--line-strong)] bg-[var(--surface-0)] p-1.5',
                sidebarSide === 'left' ? 'left-3' : 'right-3'
              )}
            >
              <button
                className="flex h-9 w-9 items-center justify-center rounded-[8px] text-[var(--text-dim)] transition hover:bg-[var(--surface-1)] hover:text-[var(--text)]"
                aria-label="Open sidebar on the left"
                title="Open sidebar on the left"
                onClick={() => setSidebarPlacement('left')}
              >
                <SidebarDockIcon side="left" />
              </button>
              <button
                className="flex h-9 w-9 items-center justify-center rounded-[8px] text-[var(--text-dim)] transition hover:bg-[var(--surface-1)] hover:text-[var(--text)]"
                aria-label="Open sidebar on the right"
                title="Open sidebar on the right"
                onClick={() => setSidebarPlacement('right')}
              >
                <SidebarDockIcon side="right" />
              </button>
            </div>
          ) : null}
          <CanvasSurface
            activeWorkspacePath={activeWorkspace}
            darkMode={darkMode}
            ref={canvasRef}
            onOpenFile={previewFile}
            onStateChange={handleCanvasStateChange}
            state={canvasState}
          />
          <ViewerOverlay
            file={viewerFile}
            onClose={() => setViewerFile(null)}
            onPlaceOnCanvas={placeFileOnCanvas}
          />
          {workspaceError ? (
            <div className="glass-panel absolute right-3 top-3 z-[260] max-w-[24rem] rounded-[10px] border border-amber-500/30 bg-[rgba(120,53,15,0.16)] px-4 py-3 text-sm text-amber-100">
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
            className="min-w-[260px] max-w-[520px] overflow-hidden opacity-100 transition-[width,opacity] duration-200"
          >
            <Sidebar
              activeFilePath={viewerFile?.path ?? null}
              config={config}
              darkMode={darkMode}
              loadingWorkspace={loadingWorkspace}
              onAddWorkspace={() => void addWorkspace()}
              onCreateNote={() => void createRootNote()}
              onCreateTerminal={createTerminal}
              onMoveFile={(sourcePath, targetDirectoryPath) =>
                void moveFileIntoDirectory(sourcePath, targetDirectoryPath)
              }
              onMoveSidebar={setSidebarPlacement}
              onOpenSearch={() => setSearchOpen(true)}
              onPlaceFile={placeFileOnCanvas}
              onRemoveWorkspace={() => void removeActiveWorkspace()}
              onSelectFile={previewFile}
              onSelectWorkspace={(index) =>
                void persistConfig({
                  ...config,
                  activeWorkspace: index
                })
              }
              terminalDependencyMessage={terminalDependencyMessage}
              terminalReady={terminalReady}
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
              workspaceTree={workspaceTree}
            />
          </div>
        )}
      </div>

      <SearchDialog
        files={flatFiles}
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelect={(file) => {
          setViewerFile(file)
          setSearchOpen(false)
        }}
      />
    </div>
  )
}
