import { startTransition, useEffect, useRef, useState } from 'react'

import type { AppConfig, CanvasState, FileTreeNode } from '@shared/types'

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

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

export default function App() {
  const canvasRef = useRef<CanvasSurfaceHandle>(null)
  const resizeRef = useRef<{ startWidth: number; startX: number } | null>(null)
  const canvasSaveTimerRef = useRef<number | null>(null)

  const [config, setConfig] = useState<AppConfig | null>(null)
  const [canvasState, setCanvasState] = useState<CanvasState | null>(null)
  const [workspaceTree, setWorkspaceTree] = useState<FileTreeNode[]>([])
  const [viewerFile, setViewerFile] = useState<FileTreeNode | null>(null)
  const [sidebarWidth, setSidebarWidth] = useState(320)
  const [searchOpen, setSearchOpen] = useState(false)
  const [loadingWorkspace, setLoadingWorkspace] = useState(false)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)
  const [bootError, setBootError] = useState<string | null>(null)

  const activeWorkspace = config ? config.workspaces[config.activeWorkspace] ?? null : null
  const flatFiles = flattenFiles(workspaceTree)

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
        setSidebarWidth(payload.config.ui.sidebarWidth)
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
    if (!canvasState) {
      return
    }

    if (canvasSaveTimerRef.current !== null) {
      window.clearTimeout(canvasSaveTimerRef.current)
    }

    canvasSaveTimerRef.current = window.setTimeout(() => {
      void window.collaborator.saveCanvasState(canvasState)
    }, 500)

    return () => {
      if (canvasSaveTimerRef.current !== null) {
        window.clearTimeout(canvasSaveTimerRef.current)
      }
    }
  }, [canvasState])

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

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen(true)
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
  }, [searchOpen])

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      if (!resizeRef.current || !config) {
        return
      }

      const nextWidth = clamp(
        resizeRef.current.startWidth + event.clientX - resizeRef.current.startX,
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

  function placeFileOnCanvas(file: FileTreeNode) {
    canvasRef.current?.spawnFileTile(file)
    setViewerFile(file)
  }

  function handleCanvasStateChange(nextState: CanvasState, options?: { immediate?: boolean }) {
    setCanvasState(nextState)

    if (options?.immediate) {
      void window.collaborator.saveCanvasState(nextState)
    }
  }

  if (bootError) {
    return (
      <div className="app-shell">
        <div className="glass-panel flex flex-1 items-center justify-center rounded-[32px] text-center">
          <div className="max-w-lg p-8">
            <div className="text-[11px] uppercase tracking-[0.25em] text-slate-400">Boot Error</div>
            <div className="mt-4 text-2xl font-semibold text-slate-800">{bootError}</div>
          </div>
        </div>
      </div>
    )
  }

  if (!config || !canvasState) {
    return (
      <div className="app-shell">
        <div className="glass-panel flex flex-1 items-center justify-center rounded-[32px]">
          <div className="text-sm uppercase tracking-[0.25em] text-slate-400">Initializing…</div>
        </div>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <div className="flex h-full min-w-0 flex-1">
        <div style={{ width: sidebarWidth }} className="min-w-[260px] max-w-[520px]">
          <Sidebar
            activeFilePath={viewerFile?.path ?? null}
            config={config}
            loadingWorkspace={loadingWorkspace}
            onAddWorkspace={() => void addWorkspace()}
            onCreateTerminal={() => canvasRef.current?.createTerminal()}
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
            workspaceTree={workspaceTree}
          />
        </div>

        <div
          className="w-3 cursor-col-resize"
          onPointerDown={(event) => {
            resizeRef.current = {
              startX: event.clientX,
              startWidth: sidebarWidth
            }
          }}
        />

        <main className="relative min-w-0 flex-1">
          <CanvasSurface
            activeWorkspacePath={activeWorkspace}
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
            <div className="glass-panel absolute right-4 top-4 z-[260] rounded-2xl border border-rose-200 px-4 py-3 text-sm text-rose-700">
              {workspaceError}
            </div>
          ) : null}
        </main>
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
