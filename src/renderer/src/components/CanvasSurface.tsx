import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
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
  darkMode: boolean
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
type BoardTool = 'hand' | 'select' | 'box' | 'arrow' | 'text' | 'note' | 'draw' | 'frame'
type ShortcutAction = BoardTool | 'terminal'
type GestureLikeEvent = Event & {
  clientX?: number
  clientY?: number
  preventDefault: () => void
  scale: number
}
type DragConnectionState = {
  currentX: number
  currentY: number
  sourceTileId: string
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
const COLLABORATOR_FILE_MIME = 'application/x-collaborator-file'
const SHORTCUT_ITEMS: Array<{ action: ShortcutAction; key: string; label: string }> = [
  { action: 'terminal', key: 'Shift+T', label: 'Terminal' },
  { action: 'hand', key: 'M', label: 'Move' },
  { action: 'select', key: 'V', label: 'Select' },
  { action: 'box', key: 'B', label: 'Box' },
  { action: 'arrow', key: 'A', label: 'Arrow' },
  { action: 'text', key: 'T', label: 'Text' },
  { action: 'note', key: 'N', label: 'Note' },
  { action: 'draw', key: 'D', label: 'Draw' },
  { action: 'frame', key: 'F', label: 'Frame' }
]
const BOARD_TOOL_SHORTCUTS: Record<string, BoardTool> = {
  a: 'arrow',
  b: 'box',
  d: 'draw',
  f: 'frame',
  m: 'hand',
  n: 'note',
  t: 'text',
  v: 'select'
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function snap(value: number) {
  return Math.round(value / GRID_SIZE) * GRID_SIZE
}

function hasCollaboratorFilePayload(dataTransfer: DataTransfer | null) {
  return Boolean(dataTransfer && Array.from(dataTransfer.types).includes(COLLABORATOR_FILE_MIME))
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
    width: isImage ? 420 : isNote ? 360 : 520,
    height: isImage ? 320 : isNote ? 440 : 420,
    zIndex,
    filePath: file.path
  }
}

export const CanvasSurface = forwardRef<CanvasSurfaceHandle, CanvasSurfaceProps>(
  function CanvasSurface({ activeWorkspacePath, darkMode, onOpenFile, onStateChange, state }, ref) {
    const containerRef = useRef<HTMLDivElement>(null)
    const editorRef = useRef<Editor | null>(null)
    const interactionRef = useRef<InteractionState | null>(null)
    const pinchStateRef = useRef<{
      originClientX: number
      originClientY: number
      startZoom: number
    } | null>(null)
    const dragConnectionRef = useRef<DragConnectionState | null>(null)
    const canvasActiveRef = useRef(true)
    const stateRef = useRef(state)
    const [activeBoardTool, setActiveBoardTool] = useState<BoardTool>('hand')
    const [dragConnection, setDragConnection] = useState<DragConnectionState | null>(null)
    const [linkSourceTileId, setLinkSourceTileId] = useState<string | null>(null)
    const [selectedTileId, setSelectedTileId] = useState<string | null>(null)
    const [zoomIndicator, setZoomIndicator] = useState<string | null>(null)

    stateRef.current = state

    function tileById(tileId: string | null) {
      if (!tileId) {
        return null
      }

      return stateRef.current.tiles.find((tile) => tile.id === tileId) ?? null
    }

    function isContextSourceTile(tile: CanvasTile | null): tile is CanvasTile {
      return Boolean(tile && tile.type !== 'term' && tile.filePath)
    }

    function contextTilesForTerminal(tile: CanvasTile) {
      if (tile.type !== 'term') {
        return []
      }

      return (tile.contextTileIds ?? [])
        .map((contextTileId) => tileById(contextTileId))
        .filter(isContextSourceTile)
    }

    function connectorCenterForTile(tile: CanvasTile) {
      return {
        x: tile.type === 'term' ? tile.x - 10 : tile.x + tile.width + 10,
        y: tile.y + tile.height / 2
      }
    }

    function setActiveDragConnection(nextConnection: DragConnectionState | null) {
      dragConnectionRef.current = nextConnection
      setDragConnection(nextConnection)
    }

    function terminalConnectorIdFromTarget(target: EventTarget | null) {
      if (!(target instanceof HTMLElement)) {
        return null
      }

      const connector = target.closest<HTMLElement>('[data-terminal-connector-id]')
      const terminalConnectorId = connector?.dataset.terminalConnectorId

      return typeof terminalConnectorId === 'string' ? terminalConnectorId : null
    }

    function toggleLinkMode(tileId: string) {
      const tile = tileById(tileId)

      if (!isContextSourceTile(tile)) {
        return
      }

      setSelectedTileId(tileId)
      setLinkSourceTileId((current) => (current === tileId ? null : tileId))
    }

    function beginConnectionDrag(tileId: string, event: ReactPointerEvent<HTMLDivElement>) {
      const tile = tileById(tileId)

      if (!isContextSourceTile(tile)) {
        return
      }

      const { x, y } = connectorCenterForTile(tile)

      event.stopPropagation()
      setSelectedTileId(tileId)
      setLinkSourceTileId(tileId)
      setActiveDragConnection({
        sourceTileId: tileId,
        currentX: x,
        currentY: y
      })
    }

    function attachContextTile(sourceTileId: string, terminalTileId: string) {
      const sourceTile = tileById(sourceTileId)
      const terminalTile = tileById(terminalTileId)

      if (!isContextSourceTile(sourceTile) || !terminalTile || terminalTile.type !== 'term') {
        return
      }

      const nextContextTileIds = Array.from(
        new Set([...(terminalTile.contextTileIds ?? []), sourceTileId])
      )

      updateState(
        {
          ...stateRef.current,
          tiles: stateRef.current.tiles.map((tile) =>
            tile.id === terminalTileId
              ? {
                  ...tile,
                  contextTileIds: nextContextTileIds
                }
              : tile
          )
        },
        { immediate: true }
      )
      setSelectedTileId(terminalTileId)
      setLinkSourceTileId(null)
    }

    function detachContextTile(terminalTileId: string, sourceTileId: string) {
      updateState(
        {
          ...stateRef.current,
          tiles: stateRef.current.tiles.map((tile) =>
            tile.id === terminalTileId
              ? {
                  ...tile,
                  contextTileIds: (tile.contextTileIds ?? []).filter(
                    (contextTileId) => contextTileId !== sourceTileId
                  )
                }
              : tile
          )
        },
        { immediate: true }
      )
    }

    function buildClaudeCodeContextPrompt(terminalTileId: string) {
      const terminalTile = tileById(terminalTileId)

      if (!terminalTile || terminalTile.type !== 'term') {
        return ''
      }

      const contextPaths = Array.from(
        new Set(
          contextTilesForTerminal(terminalTile)
            .map((tile) => tile.filePath)
            .filter((filePath): filePath is string => typeof filePath === 'string')
        )
      )

      if (contextPaths.length === 0) {
        return ''
      }

      return [
        'Use these workspace files as context for this Claude Code session:',
        '',
        ...contextPaths.map((filePath) => `- ${filePath}`),
        '',
        'Read them before responding and keep them in working context.'
      ].join('\n')
    }

    function pasteClaudeCodeContext(terminalTileId: string) {
      const terminalTile = tileById(terminalTileId)

      if (!terminalTile || terminalTile.type !== 'term' || !terminalTile.sessionId) {
        return
      }

      const prompt = buildClaudeCodeContextPrompt(terminalTileId)

      if (!prompt) {
        return
      }

      window.collaborator.writeTerminalInput(terminalTile.sessionId, `${prompt}\n`)
    }

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

    function zoomAroundCenter(nextZoom: number) {
      const container = containerRef.current

      if (!container) {
        return
      }

      const rect = container.getBoundingClientRect()
      zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, nextZoom)
    }

    function zoomByFactor(factor: number) {
      zoomAroundCenter(stateRef.current.viewport.zoom * factor)
    }

    function resetViewportZoom() {
      setViewport({
        ...stateRef.current.viewport,
        zoom: 1
      })
      showZoom(1)
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
      const tileId = `tile-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

      appendTile(
        {
          id: tileId,
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
      setSelectedTileId(tileId)
    }

    function spawnFileTile(file: FileTreeNode) {
      const fileKind = file.fileKind ?? 'code'
      const { x, y } = centerWorldPosition(stateRef.current.tiles.length % 5)
      const tile = createTileFromFile(
        {
          fileKind,
          name: file.name,
          path: file.path
        },
        x - 180,
        y - 120,
        nextZIndex(stateRef.current.tiles)
      )

      appendTile(
        tile,
        { immediate: true }
      )
      setSelectedTileId(tile.id)
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

    function runShortcutAction(action: ShortcutAction) {
      if (action === 'terminal') {
        createTerminalNearCenter()
        return
      }

      setSelectedTileId(null)
      applyBoardTool(action)
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
        zoomByFactor(1.1)
      },
      zoomOut: () => {
        zoomByFactor(0.9)
      },
      resetZoom: () => {
        resetViewportZoom()
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

        const lowerKey = event.key.toLowerCase()
        const nextTool = BOARD_TOOL_SHORTCUTS[lowerKey]

        if (event.key === 'Escape') {
          if (linkSourceTileId) {
            event.preventDefault()
            setLinkSourceTileId(null)
            return
          }

          if (selectedTileId) {
            event.preventDefault()
            setSelectedTileId(null)
          }

          return
        }

        if (event.key === 'Backspace' || event.key === 'Delete') {
          const selectedShapeIds = editorRef.current?.getSelectedShapeIds() ?? []

          if (selectedTileId) {
            event.preventDefault()
            deleteTile(selectedTileId)
            return
          }

          if (selectedShapeIds.length > 0 && editorRef.current) {
            event.preventDefault()
            editorRef.current.deleteShapes(selectedShapeIds)
          }

          return
        }

        if (lowerKey === 't' && event.shiftKey) {
          event.preventDefault()
          runShortcutAction('terminal')
          return
        }

        if (lowerKey === 'l' && selectedTileId) {
          const selectedTile = tileById(selectedTileId)

          if (isContextSourceTile(selectedTile)) {
            event.preventDefault()
            toggleLinkMode(selectedTileId)
            return
          }
        }

        if (!nextTool) {
          return
        }

        event.preventDefault()
        runShortcutAction(nextTool)
      }

      window.addEventListener('pointerdown', handlePointerContext, true)
      window.addEventListener('keydown', handleKeyDown)

      return () => {
        window.removeEventListener('pointerdown', handlePointerContext, true)
        window.removeEventListener('keydown', handleKeyDown)
      }
    }, [linkSourceTileId, selectedTileId])

    useEffect(() => {
      function handlePointerMove(event: PointerEvent) {
        const interaction = interactionRef.current

        if (!interaction) {
          if (dragConnectionRef.current) {
            const point = pagePointFromClient(event.clientX, event.clientY)

            setActiveDragConnection({
              ...dragConnectionRef.current,
              currentX: point.x,
              currentY: point.y
            })
          }

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

      function handlePointerUp(event: PointerEvent) {
        if (dragConnectionRef.current) {
          const terminalTileId = terminalConnectorIdFromTarget(event.target)

          if (terminalTileId) {
            attachContextTile(dragConnectionRef.current.sourceTileId, terminalTileId)
          } else {
            setLinkSourceTileId(null)
          }

          setActiveDragConnection(null)
        }

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
          tiles: stateRef.current.tiles
            .filter((tile) => tile.id !== tileId)
            .map((tile) =>
              tile.type === 'term'
                ? {
                    ...tile,
                    contextTileIds: (tile.contextTileIds ?? []).filter(
                      (contextTileId) => contextTileId !== tileId
                    )
                  }
                : tile
            )
        },
        { immediate: true }
      )

      if (selectedTileId === tileId) {
        setSelectedTileId(null)
      }

      if (linkSourceTileId === tileId) {
        setLinkSourceTileId(null)
      }

      if (dragConnectionRef.current?.sourceTileId === tileId) {
        setActiveDragConnection(null)
      }
    }

    function createTerminalAt(clientX: number, clientY: number) {
      const point = pagePointFromClient(clientX, clientY)
      const tileId = `tile-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

      appendTile(
        {
          id: tileId,
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
      setSelectedTileId(tileId)
    }

    function handleDragOverCapture(event: ReactDragEvent<HTMLDivElement>) {
      if (!hasCollaboratorFilePayload(event.dataTransfer)) {
        return
      }

      event.preventDefault()
    }

    function handleDropCapture(event: ReactDragEvent<HTMLDivElement>) {
      if (!hasCollaboratorFilePayload(event.dataTransfer)) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      const payload = event.dataTransfer.getData(COLLABORATOR_FILE_MIME)

      if (!payload) {
        return
      }

      const parsed = JSON.parse(payload) as { fileKind: FileKind; name: string; path: string }
      const point = pagePointFromClient(event.clientX, event.clientY)
      const tile = createTileFromFile(parsed, point.x, point.y, nextZIndex(stateRef.current.tiles))

      appendTile(tile, { immediate: true })
      setSelectedTileId(tile.id)
    }

    const activeLinkSourceTile = tileById(linkSourceTileId)
    const linkSourceTile = isContextSourceTile(activeLinkSourceTile) ? activeLinkSourceTile : null
    const zoomLabel = `${Math.round(state.viewport.zoom * 100)}%`
    const canZoomIn = state.viewport.zoom < MAX_ZOOM - CAMERA_EPSILON
    const canZoomOut = state.viewport.zoom > MIN_ZOOM + CAMERA_EPSILON
    const terminalConnections = state.tiles.flatMap((terminalTile) => {
      if (terminalTile.type !== 'term') {
        return []
      }

      return contextTilesForTerminal(terminalTile).map((sourceTile) => ({
        sourceTile,
        terminalTile
      }))
    })

    return (
      <div
        ref={containerRef}
        className={clsx(
          'canvas-surface relative h-full overflow-hidden rounded-[24px] border border-[color:var(--line-strong)] bg-[var(--canvas-bg)] touch-none [overscroll-behavior:none]'
        )}
        onPointerDownCapture={(event) => {
          const target = event.target as HTMLElement

          if (target.closest('[data-tile-root="true"]') || target.closest('[data-canvas-ui="true"]')) {
            return
          }

          setSelectedTileId(null)
        }}
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
        onDragOverCapture={handleDragOverCapture}
        onDropCapture={handleDropCapture}
      >
        <div
          data-canvas-ui="true"
          className="group absolute right-4 top-4 z-[220]"
        >
          <div className="flex min-h-10 w-10 origin-top-right items-start overflow-hidden rounded-full border border-[color:var(--line)] bg-[color:var(--surface-overlay)] shadow-[0_10px_22px_rgba(15,23,42,0.08)] backdrop-blur transition-[width,max-height,border-radius] duration-200 ease-out max-h-10 group-hover:w-[332px] group-hover:max-h-[220px] group-hover:rounded-[18px] group-focus-within:w-[332px] group-focus-within:max-h-[220px] group-focus-within:rounded-[18px]">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center self-start text-[13px] font-semibold tracking-[0.2em] text-[var(--text-dim)]">
              ?
            </div>
            <div className="min-w-0 flex-1 self-stretch pr-3 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
              <div className="pt-2 text-[10px] uppercase tracking-[0.22em] text-[var(--text-faint)]">Canvas Keys</div>
              <div className="mt-1.5 grid grid-cols-3 gap-1.5 pb-2">
                {SHORTCUT_ITEMS.map((shortcut) => {
                  const isActive =
                    shortcut.action !== 'terminal' && activeBoardTool === shortcut.action

                  return (
                    <button
                      key={shortcut.action}
                      className={clsx(
                        'flex items-center justify-between rounded-[10px] border px-2 py-1.5 text-left transition',
                        isActive
                          ? 'border-[color:var(--text)] bg-[var(--text)] text-[var(--surface-0)]'
                          : 'border-[color:var(--line)] bg-[var(--surface-0)] text-[var(--text-dim)] hover:border-[color:var(--line-strong)] hover:text-[var(--text)]'
                      )}
                      onClick={() => runShortcutAction(shortcut.action)}
                    >
                      <span className="truncate pr-2 text-[10px] uppercase tracking-[0.14em]">
                        {shortcut.label}
                      </span>
                      <span
                        className={clsx(
                          'shrink-0 rounded-md border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.16em]',
                          isActive
                            ? 'border-white/25 bg-white/12 text-white'
                            : 'border-[color:var(--line)] bg-[var(--surface-1)] text-[var(--text-faint)]'
                        )}
                      >
                        {shortcut.key}
                      </span>
                    </button>
                  )
                })}
              </div>
              <div className="border-t border-[color:var(--line)] py-2 text-[10px] uppercase tracking-[0.16em] text-[var(--text-faint)]">
                Drag from a file dot to a terminal dot. Connected files become Claude Code context.
              </div>
            </div>
          </div>
        </div>

        {linkSourceTile ? (
          <div className="pointer-events-none absolute left-4 top-4 z-[210] rounded-full border border-[color:var(--line)] bg-[color:var(--surface-overlay)] px-3 py-1.5 text-[11px] font-medium tracking-[0.16em] text-[var(--text-dim)] backdrop-blur">
            Drag <span className="text-[var(--text)]">{linkSourceTile.title}</span> into a terminal
            dot, or press Esc to cancel.
          </div>
        ) : null}

        <div className="absolute inset-0">
          <Tldraw
            autoFocus={false}
            className={clsx('collab-tldraw', darkMode && 'theme-dark')}
            hideUi
            inferDarkMode={darkMode}
            maxAssetSize={1024 * 1024 * 256}
            onMount={handleBoardMount}
          />
        </div>

        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(circle, var(--canvas-dot) 0.9px, transparent 1.15px)',
            backgroundSize: `${GRID_SIZE * state.viewport.zoom}px ${GRID_SIZE * state.viewport.zoom}px`,
            backgroundPosition: `${state.viewport.panX}px ${state.viewport.panY}px`
          }}
        />

        <div
          className="pointer-events-none absolute inset-0 origin-top-left"
          style={{
            transform: `translate(${state.viewport.panX}px, ${state.viewport.panY}px) scale(${state.viewport.zoom})`
          }}
        >
          <svg className="absolute inset-0 h-full w-full" style={{ overflow: 'visible' }}>
            {terminalConnections.map(({ sourceTile, terminalTile }) => {
              const start = connectorCenterForTile(sourceTile)
              const end = connectorCenterForTile(terminalTile)
              const startX = start.x
              const startY = start.y
              const endX = end.x
              const endY = end.y
              const controlOffset = Math.max(80, Math.abs(endX - startX) * 0.4)

              return (
                <g key={`${sourceTile.id}:${terminalTile.id}`}>
                  <path
                    d={`M ${startX} ${startY} C ${startX + controlOffset} ${startY}, ${endX - controlOffset} ${endY}, ${endX} ${endY}`}
                    fill="none"
                    stroke="var(--link-line)"
                    strokeDasharray="8 6"
                    strokeLinecap="round"
                    strokeWidth={2}
                  />
                  <circle cx={startX} cy={startY} fill="var(--link-line)" r={4} />
                  <circle cx={endX} cy={endY} fill="var(--link-line)" r={4} />
                </g>
              )
            })}
            {dragConnection ? (() => {
              const sourceTile = tileById(dragConnection.sourceTileId)

              if (!isContextSourceTile(sourceTile)) {
                return null
              }

              const start = connectorCenterForTile(sourceTile)
              const end = {
                x: dragConnection.currentX,
                y: dragConnection.currentY
              }
              const controlOffset = Math.max(80, Math.abs(end.x - start.x) * 0.4)

              return (
                <g key={`drag:${dragConnection.sourceTileId}`}>
                  <path
                    d={`M ${start.x} ${start.y} C ${start.x + controlOffset} ${start.y}, ${end.x - controlOffset} ${end.y}, ${end.x} ${end.y}`}
                    fill="none"
                    stroke="var(--link-line)"
                    strokeDasharray="8 6"
                    strokeLinecap="round"
                    strokeWidth={2}
                  />
                  <circle cx={start.x} cy={start.y} fill="var(--link-line)" r={4} />
                  <circle cx={end.x} cy={end.y} fill="var(--link-line)" opacity={0.75} r={4} />
                </g>
              )
            })() : null}
          </svg>

          {state.tiles
            .slice()
            .sort((left, right) => left.zIndex - right.zIndex)
            .map((tile) => (
              (() => {
                const contextTiles = tile.type === 'term' ? contextTilesForTerminal(tile) : []
                const isContextSource = isContextSourceTile(tile)
                const isPendingLinkSource = linkSourceTileId === tile.id
                const connectorLabel =
                  tile.type === 'term'
                    ? linkSourceTile && linkSourceTile.id !== tile.id
                      ? `Attach ${linkSourceTile.title} to ${tile.title}`
                      : contextTiles.length > 0
                        ? `${tile.title} has linked context`
                        : `${tile.title} terminal connector`
                    : `Connect ${tile.title} to a terminal`

                return (
                  <div
                    key={tile.id}
                    data-tile-root="true"
                    className={clsx(
                      'pointer-events-auto absolute overflow-visible rounded-[10px] border bg-[var(--surface-0)] shadow-[0_6px_14px_rgba(15,23,42,0.10)]',
                      selectedTileId === tile.id
                        ? 'border-[color:var(--line-strong)] shadow-[0_0_0_2px_rgba(71,85,105,0.18),0_6px_14px_rgba(15,23,42,0.10)]'
                        : 'border-[color:var(--line)]',
                      isPendingLinkSource && 'border-[color:var(--link-line)]'
                    )}
                    style={{
                      left: tile.x,
                      top: tile.y,
                      width: tile.width,
                      height: tile.height,
                      zIndex: tile.zIndex
                    }}
                    onPointerDownCapture={() => {
                      setSelectedTileId(tile.id)
                      bringTileToFront(tile.id)
                    }}
                  >
                {(tile.type === 'term' || isContextSource) ? (
                  <div
                    data-terminal-connector-id={tile.type === 'term' ? tile.id : undefined}
                    className={clsx(
                      'absolute top-1/2 z-20 h-5 w-5 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_4px_10px_rgba(56,189,248,0.28)] transition',
                      tile.type === 'term' ? 'left-[-11px]' : 'right-[-11px]',
                      tile.type === 'term'
                        ? linkSourceTile && linkSourceTile.id !== tile.id
                          ? 'bg-[color:var(--link-line)] scale-110'
                          : contextTiles.length > 0
                            ? 'bg-[color:var(--link-line)]'
                            : 'bg-[color:var(--link-line)]'
                        : isPendingLinkSource
                          ? 'bg-[color:var(--link-line)] scale-110'
                          : 'bg-[color:var(--link-line)]'
                    )}
                    title={connectorLabel}
                    onPointerDown={(event) => {
                      event.stopPropagation()

                      if (tile.type === 'term') {
                        return
                      }

                      beginConnectionDrag(tile.id, event)
                    }}
                    onClick={(event) => {
                      event.stopPropagation()

                      if (tile.type === 'term' && linkSourceTile && linkSourceTile.id !== tile.id) {
                        attachContextTile(linkSourceTile.id, tile.id)
                        return
                      }

                      if (tile.type !== 'term') {
                        toggleLinkMode(tile.id)
                      }
                    }}
                  />
                ) : null}
                <div
                  className="flex items-center justify-between rounded-t-[10px] border-b border-[color:var(--line)] bg-[var(--surface-1)] px-3 py-1.5"
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
                    <div className="truncate text-[11px] font-medium text-[var(--text)]">{tile.title}</div>
                    <div className="truncate text-[10px] uppercase tracking-[0.18em] text-[var(--text-faint)]">
                      {tile.type === 'term'
                        ? tile.sessionId
                        : tile.filePath?.replace(/^.*\//, '')}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {tile.filePath ? (
                      <button
                        className="flex h-6 w-6 items-center justify-center rounded-full border border-[color:var(--line)] bg-[var(--surface-0)] text-[12px] text-[var(--text-dim)] transition hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
                        onPointerDown={(event) => event.stopPropagation()}
                        title="Open preview"
                        onClick={(event) => {
                          event.stopPropagation()
                          onOpenFile({
                            kind: 'file',
                            name: tile.title,
                            path: tile.filePath as string,
                            fileKind: tile.type as FileKind
                          })
                        }}
                      >
                        ↗
                      </button>
                    ) : null}
                    <button
                      className="flex h-6 w-6 items-center justify-center rounded-full border border-[color:var(--line)] bg-[var(--surface-0)] text-[14px] leading-none text-[var(--text-dim)] transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700"
                      title="Close tile"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation()
                        deleteTile(tile.id)
                      }}
                    >
                      ×
                    </button>
                  </div>
                </div>

                <div className="h-[calc(100%-37px)] p-2">
                  {tile.type === 'term' ? (
                    <div className="flex h-full min-h-0 flex-col gap-2">
                      <div
                        className="flex flex-wrap items-center gap-2 rounded-[8px] border border-[color:var(--line)] bg-[var(--surface-1)] px-2 py-1.5"
                        data-terminal-control="true"
                        onPointerDown={(event) => event.stopPropagation()}
                      >
                        {contextTiles.length === 0 ? (
                          <div className="text-[11px] text-[var(--text-dim)]">
                            {linkSourceTile
                              ? 'Drop the dragged connector on this terminal dot to attach it.'
                              : 'Drag a blue dot from a file tile into this terminal to build Claude Code context.'}
                          </div>
                        ) : (
                          contextTiles.map((contextTile) => (
                            <div
                              key={contextTile.id}
                              className="flex items-center gap-1 rounded-full border border-[color:var(--line)] bg-[var(--surface-0)] px-2 py-1 text-[10px] text-[var(--text-dim)]"
                            >
                              <span className="max-w-[120px] truncate">{contextTile.title}</span>
                              <button
                                className="rounded-full px-1 text-[var(--text-faint)] transition hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
                                title="Remove linked context"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  detachContextTile(tile.id, contextTile.id)
                                }}
                              >
                                ×
                              </button>
                            </div>
                          ))
                        )}
                        <div className="relative ml-auto" onPointerDown={(event) => event.stopPropagation()}>
                          <button
                            className="peer flex h-7 w-7 items-center justify-center rounded-full border border-[color:var(--line)] bg-[var(--surface-0)] text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-dim)] transition hover:bg-[var(--surface-2)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-45"
                            aria-label="Paste linked Claude Code context into the terminal"
                            disabled={contextTiles.length === 0}
                            onClick={(event) => {
                              event.stopPropagation()
                              pasteClaudeCodeContext(tile.id)
                            }}
                            title="Paste linked Claude Code context into the terminal"
                          >
                            i
                          </button>
                          <div className="pointer-events-none absolute bottom-[calc(100%+8px)] right-0 z-30 w-52 rounded-[10px] border border-[color:var(--line)] bg-[color:var(--surface-overlay)] px-3 py-2 text-[10px] leading-4 text-[var(--text-dim)] opacity-0 shadow-[0_10px_22px_rgba(15,23,42,0.08)] backdrop-blur transition peer-hover:opacity-100 peer-focus-visible:opacity-100">
                            Pastes the linked file paths into the terminal so Claude Code can read them as session context.
                          </div>
                        </div>
                      </div>

                      <div className="min-h-0 flex-1">
                        <TerminalPane
                          cwd={activeWorkspacePath}
                          darkMode={darkMode}
                          sessionId={tile.sessionId as string}
                        />
                      </div>
                    </div>
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
                )
              })()
            ))}
        </div>

        {zoomIndicator ? (
          <div className="pointer-events-none absolute bottom-[4.5rem] right-4 z-[220] rounded-full border border-[color:var(--line)] bg-[var(--surface-0)] px-3.5 py-1.5 text-[11px] font-medium tracking-[0.2em] text-[var(--text-dim)] shadow-[0_10px_22px_rgba(15,23,42,0.08)] backdrop-blur">
            {zoomIndicator}
          </div>
        ) : null}

        <div
          data-canvas-ui="true"
          className="absolute bottom-4 right-4 z-[220] flex items-center gap-1.5 rounded-full border border-[color:var(--line)] bg-[var(--surface-0)] px-1.5 py-1 shadow-[0_10px_22px_rgba(15,23,42,0.1)] backdrop-blur"
        >
          <button
            className="flex h-9 w-9 items-center justify-center rounded-full border border-[color:var(--line)] bg-[var(--surface-0)] text-lg leading-none text-[var(--text-dim)] transition hover:border-[color:var(--line-strong)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-45"
            aria-label="Zoom out"
            disabled={!canZoomOut}
            onClick={() => {
              zoomByFactor(0.9)
            }}
            title="Zoom out"
          >
            -
          </button>
          <button
            className="min-w-[5.5rem] rounded-full border border-[color:var(--line)] bg-[var(--surface-0)] px-4 py-2 text-[11px] font-medium tracking-[0.18em] text-[var(--text-dim)] transition hover:border-[color:var(--line-strong)] hover:text-[var(--text)]"
            aria-label="Reset zoom"
            onClick={() => {
              resetViewportZoom()
            }}
            title="Reset zoom"
          >
            {zoomLabel}
          </button>
          <button
            className="flex h-9 w-9 items-center justify-center rounded-full border border-[color:var(--line)] bg-[var(--surface-0)] text-lg leading-none text-[var(--text-dim)] transition hover:border-[color:var(--line-strong)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-45"
            aria-label="Zoom in"
            disabled={!canZoomIn}
            onClick={() => {
              zoomByFactor(1.1)
            }}
            title="Zoom in"
          >
            +
          </button>
        </div>
      </div>
    )
  }
)
