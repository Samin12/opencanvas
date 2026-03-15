import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent
} from 'react'

import clsx from 'clsx'
import { Editor, Tldraw } from 'tldraw'
import { GeoShapeGeoStyle } from '@tldraw/tlschema'

import type {
  CanvasPinchPayload,
  CanvasState,
  CanvasTile,
  FileKind,
  FileTreeNode
} from '@shared/types'

import { DocumentPane } from './DocumentPane'
import { TerminalPane } from './TerminalPane'

interface CanvasSurfaceProps {
  activeWorkspacePath: string | null
  onOpenFile: (node: FileTreeNode) => void
  onStateChange: (state: CanvasState, options?: { immediate?: boolean }) => void
  state: CanvasState
}

export interface CanvasSurfaceHandle {
  createTerminal: () => void
  spawnFileTile: (file: FileTreeNode) => void
  resetZoom: () => void
  zoomIn: () => void
  zoomOut: () => void
}

type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
type BoardTool = 'hand' | 'select' | 'box' | 'arrow' | 'note' | 'draw'
type GestureLikeEvent = Event & {
  clientX?: number
  clientY?: number
  preventDefault: () => void
  scale: number
}

type InteractionState =
  | {
      type: 'pan'
      startClientX: number
      startClientY: number
      startPanX: number
      startPanY: number
    }
  | {
      startClientX: number
      startClientY: number
      startX: number
      startY: number
      tileId: string
      type: 'drag'
    }
  | {
      handle: ResizeHandle
      startClientX: number
      startClientY: number
      startHeight: number
      startWidth: number
      startX: number
      startY: number
      tileId: string
      type: 'resize'
    }

const GRID_SIZE = 20
const MAJOR_GRID = GRID_SIZE * 4
const MIN_ZOOM = 0.33
const MAX_ZOOM = 1
const MIN_TILE_WIDTH = 280
const MIN_TILE_HEIGHT = 220
const CAMERA_EPSILON = 0.001
const BOARD_TOOL_BUTTONS: Array<{ id: BoardTool; label: string }> = [
  { id: 'hand', label: 'Move' },
  { id: 'select', label: 'Select' },
  { id: 'box', label: 'Box' },
  { id: 'arrow', label: 'Arrow' },
  { id: 'note', label: 'Note' },
  { id: 'draw', label: 'Draw' }
]
const BOARD_TOOL_SHORTCUTS: Record<string, BoardTool> = {
  a: 'arrow',
  b: 'box',
  d: 'draw',
  m: 'hand',
  n: 'note',
  v: 'select'
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function snap(value: number) {
  return Math.round(value / GRID_SIZE) * GRID_SIZE
}

function viewportToCamera(viewport: CanvasState['viewport']) {
  const zoom = clamp(viewport.zoom, MIN_ZOOM, MAX_ZOOM)

  return {
    x: viewport.panX / zoom,
    y: viewport.panY / zoom,
    z: zoom
  }
}

function cameraToViewport(camera: { x: number; y: number; z: number }): CanvasState['viewport'] {
  const zoom = clamp(camera.z, MIN_ZOOM, MAX_ZOOM)

  return {
    panX: camera.x * zoom,
    panY: camera.y * zoom,
    zoom
  }
}

function viewportChanged(left: CanvasState['viewport'], right: CanvasState['viewport']) {
  return (
    Math.abs(left.panX - right.panX) > CAMERA_EPSILON ||
    Math.abs(left.panY - right.panY) > CAMERA_EPSILON ||
    Math.abs(left.zoom - right.zoom) > CAMERA_EPSILON
  )
}

function nextZIndex(tiles: CanvasTile[]) {
  return Math.max(0, ...tiles.map((tile) => tile.zIndex)) + 1
}

function titleForTerminal(tiles: CanvasTile[]) {
  const count = tiles.filter((tile) => tile.type === 'term').length + 1
  return `Terminal ${count}`
}

function sessionId() {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function createTileFromFile(
  file: { fileKind: FileKind; name: string; path: string },
  x: number,
  y: number,
  zIndex: number
): CanvasTile {
  const isImage = file.fileKind === 'image'
  const isNote = file.fileKind === 'note'

  return {
    id: `tile-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: file.fileKind,
    title: file.name,
    x: snap(x),
    y: snap(y),
    width: isImage ? 420 : isNote ? 300 : 520,
    height: isImage ? 320 : isNote ? 360 : 420,
    zIndex,
    filePath: file.path
  }
}

export const CanvasSurface = forwardRef<CanvasSurfaceHandle, CanvasSurfaceProps>(
  function CanvasSurface({ activeWorkspacePath, onOpenFile, onStateChange, state }, ref) {
    const containerRef = useRef<HTMLDivElement>(null)
    const editorRef = useRef<Editor | null>(null)
    const interactionRef = useRef<InteractionState | null>(null)
    const pinchStateRef = useRef<{
      originClientX: number
      originClientY: number
      startZoom: number
    } | null>(null)
    const canvasActiveRef = useRef(true)
    const stateRef = useRef(state)
    const [activeBoardTool, setActiveBoardTool] = useState<BoardTool>('hand')
    const [zoomIndicator, setZoomIndicator] = useState<string | null>(null)

    stateRef.current = state

    function updateState(nextState: CanvasState, options?: { immediate?: boolean }) {
      onStateChange(nextState, options)
    }

    function appendTile(tile: CanvasTile, options?: { immediate?: boolean }) {
      updateState(
        {
          ...stateRef.current,
          tiles: [...stateRef.current.tiles, tile]
        },
        options
      )
    }

    function showZoom(nextZoom: number) {
      setZoomIndicator(`${Math.round(nextZoom * 100)}%`)
      window.clearTimeout((showZoom as typeof showZoom & { timer?: number }).timer)
      ;(showZoom as typeof showZoom & { timer?: number }).timer = window.setTimeout(() => {
        setZoomIndicator(null)
      }, 900)
    }

    function setViewport(nextViewport: CanvasState['viewport']) {
      updateState({
        ...stateRef.current,
        viewport: nextViewport
      })
    }

    function syncEditorCamera(nextViewport: CanvasState['viewport']) {
      const editor = editorRef.current

      if (!editor) {
        return
      }

      const currentCamera = editor.getCamera()
      const targetCamera = viewportToCamera(nextViewport)

      if (
        Math.abs(currentCamera.x - targetCamera.x) <= CAMERA_EPSILON &&
        Math.abs(currentCamera.y - targetCamera.y) <= CAMERA_EPSILON &&
        Math.abs(currentCamera.z - targetCamera.z) <= CAMERA_EPSILON
      ) {
        return
      }

      editor.setCamera(targetCamera)
    }

    function pagePointFromClient(clientX: number, clientY: number) {
      const editor = editorRef.current

      if (editor) {
        return editor.screenToPage({ x: clientX, y: clientY })
      }

      const container = containerRef.current

      if (!container) {
        return { x: 0, y: 0 }
      }

      const rect = container.getBoundingClientRect()

      return {
        x: (clientX - rect.left - stateRef.current.viewport.panX) / stateRef.current.viewport.zoom,
        y: (clientY - rect.top - stateRef.current.viewport.panY) / stateRef.current.viewport.zoom
      }
    }

    function normalizeWheelDelta(delta: number, deltaMode: number) {
      if (deltaMode === 1) {
        return delta * 16
      }

      if (deltaMode === 2) {
        return delta * 120
      }

      return delta
    }

    function zoomAt(clientX: number, clientY: number, nextZoom: number) {
      const container = containerRef.current

      if (!container) {
        return
      }

      const rect = container.getBoundingClientRect()
      const previousZoom = stateRef.current.viewport.zoom
      const clampedZoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM)
      const worldX = (clientX - rect.left - stateRef.current.viewport.panX) / previousZoom
      const worldY = (clientY - rect.top - stateRef.current.viewport.panY) / previousZoom

      setViewport({
        zoom: clampedZoom,
        panX: clientX - rect.left - worldX * clampedZoom,
        panY: clientY - rect.top - worldY * clampedZoom
      })
      showZoom(clampedZoom)
    }

    function zoomByWheelDelta(clientX: number, clientY: number, deltaY: number, deltaMode: number) {
      const normalizedDelta = normalizeWheelDelta(deltaY, deltaMode)
      const zoomFactor = Math.exp(-normalizedDelta * 0.0025)
      zoomAt(clientX, clientY, stateRef.current.viewport.zoom * zoomFactor)
    }

    function pinchOrigin(clientX?: number, clientY?: number) {
      const container = containerRef.current

      if (
        container &&
        typeof clientX === 'number' &&
        Number.isFinite(clientX) &&
        typeof clientY === 'number' &&
        Number.isFinite(clientY)
      ) {
        return { clientX, clientY }
      }

      if (!container) {
        return { clientX: 0, clientY: 0 }
      }

      const rect = container.getBoundingClientRect()

      return {
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2
      }
    }

    function beginPinch(clientX?: number, clientY?: number) {
      const origin = pinchOrigin(clientX, clientY)

      pinchStateRef.current = {
        originClientX: origin.clientX,
        originClientY: origin.clientY,
        startZoom: stateRef.current.viewport.zoom
      }
    }

    function updatePinch(payload: {
      clientX?: number
      clientY?: number
      delta?: number
      scale?: number
    }) {
      if (!pinchStateRef.current) {
        beginPinch(payload.clientX, payload.clientY)
      }

      const pinchState = pinchStateRef.current

      if (!pinchState) {
        return
      }

      if (typeof payload.scale === 'number' && Number.isFinite(payload.scale) && payload.scale > 0) {
        zoomAt(
          pinchState.originClientX,
          pinchState.originClientY,
          pinchState.startZoom * payload.scale
        )
        return
      }

      if (typeof payload.delta === 'number' && Number.isFinite(payload.delta) && payload.delta !== 0) {
        const normalizedDelta = Math.abs(payload.delta) > 2 ? payload.delta * 0.01 : payload.delta

        zoomAt(
          pinchState.originClientX,
          pinchState.originClientY,
          stateRef.current.viewport.zoom * Math.exp(normalizedDelta)
        )
      }
    }

    function endPinch() {
      pinchStateRef.current = null
    }

    function bringTileToFront(tileId: string) {
      const maxZIndex = nextZIndex(stateRef.current.tiles)

      updateState({
        ...stateRef.current,
        tiles: stateRef.current.tiles.map((tile) =>
          tile.id === tileId
            ? {
                ...tile,
                zIndex: maxZIndex
              }
            : tile
        )
      })
    }

    function panBy(deltaX: number, deltaY: number) {
      setViewport({
        ...stateRef.current.viewport,
        panX: stateRef.current.viewport.panX - deltaX,
        panY: stateRef.current.viewport.panY - deltaY
      })
    }

    function centerWorldPosition(spread = 0) {
      const container = containerRef.current

      if (!container) {
        return {
          x: 0,
          y: 0
        }
      }

      const rect = container.getBoundingClientRect()
      const offsets = [
        { x: -220, y: -130 },
        { x: 120, y: -90 },
        { x: -160, y: 80 },
        { x: 160, y: 90 },
        { x: 0, y: -10 }
      ]
      const offset = offsets[spread % offsets.length]

      return {
        x: (rect.width / 2 - stateRef.current.viewport.panX) / stateRef.current.viewport.zoom + offset.x,
        y: (rect.height / 2 - stateRef.current.viewport.panY) / stateRef.current.viewport.zoom + offset.y
      }
    }

    function createTerminalNearCenter() {
      const { x, y } = centerWorldPosition(stateRef.current.tiles.length % 4)

      appendTile(
        {
          id: `tile-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          type: 'term',
          title: titleForTerminal(stateRef.current.tiles),
          x: snap(x),
          y: snap(y),
          width: 460,
          height: 320,
          zIndex: nextZIndex(stateRef.current.tiles),
          sessionId: sessionId()
        },
        { immediate: true }
      )
    }

    function spawnFileTile(file: FileTreeNode) {
      const fileKind = file.fileKind ?? 'code'
      const { x, y } = centerWorldPosition(stateRef.current.tiles.length % 5)

      appendTile(
        createTileFromFile(
          {
            fileKind,
            name: file.name,
            path: file.path
          },
          x - 180,
          y - 120,
          nextZIndex(stateRef.current.tiles)
        ),
        { immediate: true }
      )
    }

    function applyBoardTool(nextTool: BoardTool) {
      const editor = editorRef.current

      setActiveBoardTool(nextTool)

      if (!editor) {
        return
      }

      if (nextTool === 'box') {
        editor.setStyleForNextShapes(GeoShapeGeoStyle, 'rectangle')
        editor.setCurrentTool('geo')
        return
      }

      editor.setCurrentTool(nextTool)
    }

    function handleBoardMount(editor: Editor) {
      editorRef.current = editor
      editor.updateInstanceState({ isReadonly: false })
      editor.setCameraOptions({
        wheelBehavior: 'pan',
        zoomSpeed: 1,
        panSpeed: 1,
        zoomSteps: [MIN_ZOOM, 0.5, 0.67, 0.8, 1]
      })
      if (stateRef.current.boardSnapshot && typeof stateRef.current.boardSnapshot === 'object') {
        try {
          editor.loadSnapshot(stateRef.current.boardSnapshot as Parameters<Editor['loadSnapshot']>[0])
        } catch {
          // Ignore malformed board data and continue with an empty board.
        }
      }
      editor.setCamera(viewportToCamera(stateRef.current.viewport))
      applyBoardTool('hand')

      const detachStoreListener = editor.store.listen(
        () => {
          const nextViewport = cameraToViewport(editor.getCamera())
          const currentViewport = stateRef.current.viewport

          if (!viewportChanged(currentViewport, nextViewport)) {
            return
          }

          updateState({
            ...stateRef.current,
            viewport: nextViewport
          })

          if (Math.abs(currentViewport.zoom - nextViewport.zoom) > CAMERA_EPSILON) {
            showZoom(nextViewport.zoom)
          }
        },
        {
          scope: 'session',
          source: 'all'
        }
      )

      const detachDocumentListener = editor.store.listen(
        () => {
          updateState({
            ...stateRef.current,
            boardSnapshot: editor.getSnapshot()
          })
        },
        {
          scope: 'document',
          source: 'all'
        }
      )

      return () => {
        detachStoreListener()
        detachDocumentListener()

        if (editorRef.current === editor) {
          editorRef.current = null
        }
      }
    }

    useImperativeHandle(ref, () => ({
      createTerminal: () => {
        createTerminalNearCenter()
      },
      spawnFileTile: (file: FileTreeNode) => {
        spawnFileTile(file)
      },
      zoomIn: () => {
        const container = containerRef.current
        if (!container) {
          return
        }

        const rect = container.getBoundingClientRect()
        zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, stateRef.current.viewport.zoom * 1.1)
      },
      zoomOut: () => {
        const container = containerRef.current
        if (!container) {
          return
        }

        const rect = container.getBoundingClientRect()
        zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, stateRef.current.viewport.zoom * 0.9)
      },
      resetZoom: () => {
        setViewport({
          ...stateRef.current.viewport,
          zoom: 1
        })
        showZoom(1)
      }
    }))

    useEffect(() => {
      syncEditorCamera(state.viewport)
    }, [state.viewport.panX, state.viewport.panY, state.viewport.zoom])

    useEffect(() => {
      const container = containerRef.current

      if (!container) {
        return
      }

      const gestureContainer = container

      function handleGestureStart(rawEvent: Event) {
        const event = rawEvent as GestureLikeEvent
        beginPinch(event.clientX, event.clientY)
        event.preventDefault()
      }

      function handleGestureChange(rawEvent: Event) {
        const event = rawEvent as GestureLikeEvent

        event.preventDefault()
        updatePinch({ scale: event.scale })
      }

      function handleGestureEnd() {
        endPinch()
      }

      gestureContainer.addEventListener('gesturestart', handleGestureStart as EventListener, {
        passive: false
      })
      gestureContainer.addEventListener('gesturechange', handleGestureChange as EventListener, {
        passive: false
      })
      gestureContainer.addEventListener('gestureend', handleGestureEnd as EventListener)

      return () => {
        gestureContainer.removeEventListener('gesturestart', handleGestureStart as EventListener)
        gestureContainer.removeEventListener('gesturechange', handleGestureChange as EventListener)
        gestureContainer.removeEventListener('gestureend', handleGestureEnd as EventListener)
      }
    }, [])

    useEffect(() => {
      const detach = window.collaborator.onCanvasPinch((payload: CanvasPinchPayload) => {
        if (payload.phase === 'begin') {
          beginPinch(payload.clientX, payload.clientY)
          return
        }

        if (payload.phase === 'update') {
          updatePinch(payload)
          return
        }

        endPinch()
      })

      return () => {
        detach()
      }
    }, [])

    useEffect(() => {
      function handlePointerContext(event: PointerEvent) {
        const container = containerRef.current
        const target = event.target as Node | null

        canvasActiveRef.current = Boolean(container && target && container.contains(target))
      }

      function handleKeyDown(event: KeyboardEvent) {
        if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) {
          return
        }

        if (!canvasActiveRef.current) {
          return
        }

        const target = event.target as HTMLElement | null
        const isEditing =
          target?.tagName === 'TEXTAREA' ||
          target?.tagName === 'INPUT' ||
          target?.isContentEditable === true

        if (isEditing) {
          return
        }

        const nextTool = BOARD_TOOL_SHORTCUTS[event.key.toLowerCase()]

        if (!nextTool) {
          return
        }

        event.preventDefault()
        applyBoardTool(nextTool)
      }

      window.addEventListener('pointerdown', handlePointerContext, true)
      window.addEventListener('keydown', handleKeyDown)

      return () => {
        window.removeEventListener('pointerdown', handlePointerContext, true)
        window.removeEventListener('keydown', handleKeyDown)
      }
    }, [])

    useEffect(() => {
      function handlePointerMove(event: PointerEvent) {
        const interaction = interactionRef.current

        if (!interaction) {
          return
        }

        if (interaction.type === 'pan') {
          updateState({
            ...stateRef.current,
            viewport: {
              ...stateRef.current.viewport,
              panX: interaction.startPanX + event.clientX - interaction.startClientX,
              panY: interaction.startPanY + event.clientY - interaction.startClientY
            }
          })
          return
        }

        const deltaX = (event.clientX - interaction.startClientX) / stateRef.current.viewport.zoom
        const deltaY = (event.clientY - interaction.startClientY) / stateRef.current.viewport.zoom

        if (interaction.type === 'drag') {
          updateState({
            ...stateRef.current,
            tiles: stateRef.current.tiles.map((tile) =>
              tile.id === interaction.tileId
                ? {
                    ...tile,
                    x: interaction.startX + deltaX,
                    y: interaction.startY + deltaY
                  }
                : tile
            )
          })
          return
        }

        updateState({
          ...stateRef.current,
          tiles: stateRef.current.tiles.map((tile) => {
            if (tile.id !== interaction.tileId) {
              return tile
            }

            let nextX = interaction.startX
            let nextY = interaction.startY
            let nextWidth = interaction.startWidth
            let nextHeight = interaction.startHeight

            if (interaction.handle.includes('e')) {
              nextWidth = Math.max(MIN_TILE_WIDTH, interaction.startWidth + deltaX)
            }

            if (interaction.handle.includes('s')) {
              nextHeight = Math.max(MIN_TILE_HEIGHT, interaction.startHeight + deltaY)
            }

            if (interaction.handle.includes('w')) {
              const width = Math.max(MIN_TILE_WIDTH, interaction.startWidth - deltaX)
              nextX = interaction.startX + (interaction.startWidth - width)
              nextWidth = width
            }

            if (interaction.handle.includes('n')) {
              const height = Math.max(MIN_TILE_HEIGHT, interaction.startHeight - deltaY)
              nextY = interaction.startY + (interaction.startHeight - height)
              nextHeight = height
            }

            return {
              ...tile,
              x: nextX,
              y: nextY,
              width: nextWidth,
              height: nextHeight
            }
          })
        })
      }

      function handlePointerUp() {
        const interaction = interactionRef.current

        if (!interaction) {
          return
        }

        interactionRef.current = null

        if (interaction.type === 'drag' || interaction.type === 'resize') {
          updateState(
            {
              ...stateRef.current,
              tiles: stateRef.current.tiles.map((tile) =>
                tile.id === interaction.tileId
                  ? {
                      ...tile,
                      x: snap(tile.x),
                      y: snap(tile.y),
                      width: snap(tile.width),
                      height: snap(tile.height)
                    }
                  : tile
              )
            },
            {
              immediate: true
            }
          )
        }
      }

      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp)

      return () => {
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
      }
    }, [onStateChange])

    function beginTileDrag(tile: CanvasTile, event: ReactPointerEvent<HTMLDivElement>) {
      bringTileToFront(tile.id)
      interactionRef.current = {
        type: 'drag',
        tileId: tile.id,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: tile.x,
        startY: tile.y
      }
    }

    function beginTileResize(tile: CanvasTile, handle: ResizeHandle, event: ReactPointerEvent<HTMLDivElement>) {
      bringTileToFront(tile.id)
      interactionRef.current = {
        type: 'resize',
        tileId: tile.id,
        handle,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: tile.x,
        startY: tile.y,
        startWidth: tile.width,
        startHeight: tile.height
      }
    }

    function deleteTile(tileId: string) {
      updateState(
        {
          ...stateRef.current,
          tiles: stateRef.current.tiles.filter((tile) => tile.id !== tileId)
        },
        { immediate: true }
      )
    }

    function createTerminalAt(clientX: number, clientY: number) {
      const point = pagePointFromClient(clientX, clientY)

      appendTile(
        {
          id: `tile-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          type: 'term',
          title: titleForTerminal(stateRef.current.tiles),
          x: snap(point.x),
          y: snap(point.y),
          width: 460,
          height: 320,
          zIndex: nextZIndex(stateRef.current.tiles),
          sessionId: sessionId()
        },
        { immediate: true }
      )
    }

    function handleDrop(event: React.DragEvent<HTMLDivElement>) {
      event.preventDefault()
      const payload = event.dataTransfer.getData('application/x-collaborator-file')

      if (!payload) {
        return
      }

      const parsed = JSON.parse(payload) as { fileKind: FileKind; name: string; path: string }
      const point = pagePointFromClient(event.clientX, event.clientY)

      appendTile(createTileFromFile(parsed, point.x, point.y, nextZIndex(stateRef.current.tiles)), {
        immediate: true
      })
    }

    return (
      <div
        ref={containerRef}
        className={clsx(
          'canvas-surface relative h-full overflow-hidden rounded-[24px] border border-slate-300/80 bg-[#f8f5ee] touch-none [overscroll-behavior:none]'
        )}
        onDoubleClick={(event: ReactMouseEvent<HTMLDivElement>) => {
          const target = event.target as HTMLElement

          if (activeBoardTool !== 'hand') {
            return
          }

          if (target.closest('[data-tile-root="true"]') || target.closest('[data-canvas-ui="true"]')) {
            return
          }

          createTerminalAt(event.clientX, event.clientY)
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
      >
        <div
          data-canvas-ui="true"
          className="absolute left-5 top-5 z-[220] flex items-center gap-1 rounded-full border border-slate-300 bg-white/92 p-1 shadow-[0_10px_18px_rgba(15,23,42,0.10)] backdrop-blur"
        >
          {BOARD_TOOL_BUTTONS.map((tool) => (
            <button
              key={tool.id}
              className={clsx(
                'rounded-full px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] transition',
                activeBoardTool === tool.id
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
              )}
              onClick={() => applyBoardTool(tool.id)}
            >
              {tool.label}
            </button>
          ))}
        </div>

        <div className="absolute inset-0">
          <Tldraw
            autoFocus={false}
            className="collab-tldraw"
            hideUi
            inferDarkMode={false}
            onMount={handleBoardMount}
          />
        </div>

        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: `
              radial-gradient(circle, rgba(148, 163, 184, 0.2) 0.7px, transparent 1px),
              radial-gradient(circle, rgba(100, 116, 139, 0.12) 1.1px, transparent 1.4px)
            `,
            backgroundSize: `${GRID_SIZE * state.viewport.zoom}px ${GRID_SIZE * state.viewport.zoom}px, ${MAJOR_GRID * state.viewport.zoom}px ${MAJOR_GRID * state.viewport.zoom}px`,
            backgroundPosition: `${state.viewport.panX}px ${state.viewport.panY}px, ${state.viewport.panX}px ${state.viewport.panY}px`
          }}
        />

        <div
          className="pointer-events-none absolute inset-0 origin-top-left"
          style={{
            transform: `translate(${state.viewport.panX}px, ${state.viewport.panY}px) scale(${state.viewport.zoom})`
          }}
        >
          {state.tiles
            .slice()
            .sort((left, right) => left.zIndex - right.zIndex)
            .map((tile) => (
              <div
                key={tile.id}
                data-tile-root="true"
                className="pointer-events-auto absolute overflow-hidden rounded-[10px] border border-slate-300 bg-[#fffdfa] shadow-[0_6px_14px_rgba(15,23,42,0.10)]"
                style={{
                  left: tile.x,
                  top: tile.y,
                  width: tile.width,
                  height: tile.height,
                  zIndex: tile.zIndex
                }}
                onPointerDownCapture={() => bringTileToFront(tile.id)}
              >
                <div
                  className="flex items-center justify-between border-b border-slate-200 bg-[#faf7f1] px-3 py-1.5"
                  onPointerDown={(event) => {
                    if (event.button !== 0) {
                      return
                    }

                    event.stopPropagation()
                    beginTileDrag(tile, event)
                  }}
                  onDoubleClick={() => {
                    if (tile.filePath) {
                      onOpenFile({
                        kind: 'file',
                        name: tile.title,
                        path: tile.filePath,
                        fileKind: tile.type as FileKind
                      })
                    }
                  }}
                >
                  <div className="min-w-0">
                    <div className="truncate text-[11px] font-medium text-slate-700">{tile.title}</div>
                    <div className="truncate text-[10px] uppercase tracking-[0.18em] text-slate-400">
                      {tile.type === 'term'
                        ? tile.sessionId
                        : tile.filePath?.replace(/^.*\//, '')}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {tile.filePath ? (
                      <button
                        className="flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-[12px] text-slate-500 transition hover:bg-amber-50 hover:text-slate-700"
                        title="Open preview"
                        onClick={() =>
                          onOpenFile({
                            kind: 'file',
                            name: tile.title,
                            path: tile.filePath as string,
                            fileKind: tile.type as FileKind
                          })
                        }
                      >
                        ↗
                      </button>
                    ) : null}
                    <button
                      className="flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-[14px] leading-none text-slate-500 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700"
                      title="Close tile"
                      onClick={() => deleteTile(tile.id)}
                    >
                      ×
                    </button>
                  </div>
                </div>

                <div className="h-[calc(100%-37px)] p-2">
                  {tile.type === 'term' ? (
                    <TerminalPane cwd={activeWorkspacePath} sessionId={tile.sessionId as string} />
                  ) : (
                    <DocumentPane
                      fileKind={tile.type as FileKind}
                      filePath={tile.filePath as string}
                      onPassthroughScroll={panBy}
                    />
                  )}
                </div>

                {(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as ResizeHandle[]).map((handle) => (
                  <div
                    key={handle}
                    className="absolute bg-transparent"
                    style={{
                      cursor: `${handle}-resize`,
                      top: handle.includes('n') ? -4 : handle.includes('s') ? undefined : 8,
                      bottom: handle.includes('s') ? -4 : handle.includes('n') ? undefined : 8,
                      left: handle.includes('w') ? -4 : handle.includes('e') ? undefined : 8,
                      right: handle.includes('e') ? -4 : handle.includes('w') ? undefined : 8,
                      width: handle === 'n' || handle === 's' ? 'calc(100% - 16px)' : 12,
                      height: handle === 'e' || handle === 'w' ? 'calc(100% - 16px)' : 12
                    }}
                    onPointerDown={(event) => {
                      event.stopPropagation()
                      beginTileResize(tile, handle, event)
                    }}
                  />
                ))}
              </div>
            ))}
        </div>

        <div className="pointer-events-none absolute bottom-5 left-5 rounded-full border border-slate-300 bg-white/85 px-3 py-1.5 text-[11px] uppercase tracking-[0.22em] text-slate-500 backdrop-blur">
          Move mode: double-click for terminal. Draw mode: boxes, arrows, notes, sketch.
        </div>

        {zoomIndicator ? (
          <div className="pointer-events-none absolute bottom-5 right-5 rounded-full border border-amber-200 bg-white/90 px-3 py-1.5 text-[11px] font-medium tracking-[0.2em] text-amber-700 backdrop-blur">
            {zoomIndicator}
          </div>
        ) : null}
      </div>
    )
  }
)
