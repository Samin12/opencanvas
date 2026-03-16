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
import { Editor, Tldraw, type TLRecord } from 'tldraw'
import {
  DefaultColorStyle,
  DefaultColorThemePalette,
  GeoShapeGeoStyle,
  type TLDefaultColorStyle,
  type TLDrawShape,
  type TLNoteShape,
  type TLShapePartial
} from '@tldraw/tlschema'

import type {
  CanvasPinchPayload,
  CanvasState,
  CanvasTile,
  FileKind,
  FileTreeNode,
  TerminalUiMode
} from '@shared/types'

import { DocumentPane } from './DocumentPane'
import { HoverTooltip } from './HoverTooltip'
import { TerminalPane } from './TerminalPane'
import { keyboardShortcutsBlocked } from '../utils/keyboard'
import { composeTooltipLabel } from '../utils/buttonTooltips'

interface CanvasSurfaceProps {
  activeWorkspacePath: string | null
  darkMode: boolean
  onCreateMarkdownCard: (options: {
    baseName?: string
    initialContent: string
    targetDirectoryPath?: string
  }) => Promise<FileTreeNode | null>
  onCreateMarkdownNote: () => void
  onConvertStickyNoteToMarkdown: (content: string) => Promise<FileTreeNode | null>
  onImportImageFile: (file: File) => Promise<FileTreeNode | null>
  onOpenFile: (node: FileTreeNode) => void
  onStateChange: (state: CanvasState, options?: { immediate?: boolean }) => void
  shortcutsSuspended?: boolean
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
type BoardTool = 'hand' | 'select' | 'box' | 'arrow' | 'text' | 'note' | 'draw' | 'frame' | 'eraser'
type ShortcutAction = BoardTool | 'markdown' | 'terminal'
type DrawShapeUpdate = TLShapePartial<TLDrawShape>
type GestureLikeEvent = Event & {
  clientX?: number
  clientY?: number
  preventDefault: () => void
  scale: number
}
type WheelGestureOwner =
  | {
      kind: 'board'
    }
  | {
      element: HTMLElement
      kind: 'element'
    }
type DragConnectionState =
  | {
      currentX: number
      currentY: number
      sourceKind: 'group'
      sourceGroupId: string
    }
  | {
      currentX: number
      currentY: number
      sourceKind: 'tile'
      sourceTileId: string
    }

interface HoveredConnectionState {
  midpointX: number
  midpointY: number
  sourceTileId: string
  terminalTileId: string
}

interface FrameContextGroup {
  containedTiles: CanvasTile[]
  height: number
  id: string
  label: string
  width: number
  x: number
  y: number
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
const MIN_ZOOM = 0.1
const MAX_ZOOM = 2
const WHEEL_GESTURE_LOCK_MS = 180
const MIN_TILE_WIDTH = 280
const MIN_TILE_HEIGHT = 220
const DEFAULT_TERMINAL_WIDTH = 760
const DEFAULT_TERMINAL_HEIGHT = 560
const DEFAULT_TERMINAL_CARD_WIDTH = 460
const DEFAULT_TERMINAL_CARD_HEIGHT = 520
const CAMERA_EPSILON = 0.001
const COLLABORATOR_FILE_MIME = 'application/x-collaborator-file'
const IMAGE_FILE_EXTENSIONS = new Set(['.gif', '.jpg', '.jpeg', '.png', '.svg', '.webp'])
const DOCUMENT_DROP_TARGET_SELECTOR = '[data-document-drop-target="true"]'
const SCROLL_LOCK_SELECTOR = '[data-scroll-lock="true"]'
const NATIVE_WHEEL_SELECTOR = '[data-native-wheel="true"]'
const IS_MAC_PLATFORM =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform)
const MARKDOWN_SHORTCUT_KEY =
  IS_MAC_PLATFORM ? 'Cmd+N' : 'Ctrl+N'
const PASTE_IMAGE_SHORTCUT_KEY = IS_MAC_PLATFORM ? 'Cmd+V' : 'Ctrl+V'
const ZOOM_IN_SHORTCUT_KEY = IS_MAC_PLATFORM ? 'Cmd++' : 'Ctrl++'
const ZOOM_OUT_SHORTCUT_KEY = IS_MAC_PLATFORM ? 'Cmd+-' : 'Ctrl+-'
const RESET_ZOOM_SHORTCUT_KEY = IS_MAC_PLATFORM ? 'Cmd+0' : 'Ctrl+0'
const NOTE_SLASH_TOOLTIP_LABEL =
  'Markdown shortcuts: /h1-/h6 headings, /p paragraph, /bullet list, /numbered list, /todo checklist, /quote blockquote, /code code block, /line divider. Also works with #, >, -, 1., [ ] and ---.'
const SHORTCUT_ITEMS: Array<{ action: ShortcutAction; key: string; label: string }> = [
  { action: 'terminal', key: 'Shift+T', label: 'New Terminal' },
  { action: 'markdown', key: MARKDOWN_SHORTCUT_KEY, label: 'New Markdown' },
  { action: 'hand', key: 'M', label: 'Move' },
  { action: 'select', key: 'V', label: 'Select' },
  { action: 'box', key: 'B', label: 'Box' },
  { action: 'arrow', key: 'A', label: 'Arrow' },
  { action: 'eraser', key: 'E', label: 'Eraser' },
  { action: 'text', key: 'T', label: 'Text' },
  { action: 'note', key: 'N', label: 'Canvas Note' },
  { action: 'draw', key: 'D', label: 'Draw' },
  { action: 'frame', key: 'F', label: 'Frame' }
]
const QUICK_ACTION_ITEMS: Array<{ action: BoardTool; key: string; label: string }> = [
  { action: 'select', key: 'V', label: 'Select' },
  { action: 'note', key: 'N', label: 'Sticky note' },
  { action: 'box', key: 'B', label: 'Box' },
  { action: 'draw', key: 'D', label: 'Draw' }
]
const DRAW_COLOR_ITEMS: Array<{ color: TLDefaultColorStyle; label: string }> = [
  { color: 'black', label: 'Black' },
  { color: 'grey', label: 'Slate' },
  { color: 'blue', label: 'Blue' },
  { color: 'green', label: 'Green' },
  { color: 'orange', label: 'Orange' },
  { color: 'red', label: 'Red' },
  { color: 'violet', label: 'Violet' },
  { color: 'white', label: 'White' }
]
const BOARD_TOOL_SHORTCUTS: Record<string, BoardTool> = {
  a: 'arrow',
  b: 'box',
  d: 'draw',
  e: 'eraser',
  f: 'frame',
  m: 'hand',
  n: 'note',
  t: 'text',
  v: 'select'
}

function isBoardToolAction(action: ShortcutAction): action is BoardTool {
  return action !== 'terminal' && action !== 'markdown'
}

function QuickActionIcon({ action }: { action: BoardTool }) {
  if (action === 'select') {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4 fill-current">
        <path d="M3 2.5v11l3.1-3.2 2 3.2 1.3-.8-2-3.2H12L3 2.5Z" />
      </svg>
    )
  }

  if (action === 'note') {
    return (
      <svg
        viewBox="0 0 16 16"
        aria-hidden="true"
        className="h-4 w-4 fill-none stroke-current stroke-[1.35] [stroke-linecap:round] [stroke-linejoin:round]"
      >
        <path d="M3.25 2.75h9.5v10.5h-6l-3.5-3.5Z" />
        <path d="M6.75 13.25V9.75H3.25" />
      </svg>
    )
  }

  if (action === 'box') {
    return (
      <svg
        viewBox="0 0 16 16"
        aria-hidden="true"
        className="h-4 w-4 fill-none stroke-current stroke-[1.35]"
      >
        <rect x="3" y="3" width="10" height="10" rx="1.8" />
      </svg>
    )
  }

  if (action === 'draw') {
    return (
      <svg
        viewBox="0 0 16 16"
        aria-hidden="true"
        className="h-4 w-4 fill-none stroke-current stroke-[1.35] [stroke-linecap:round] [stroke-linejoin:round]"
      >
        <path d="m3.25 12.75 1.1-3.25L10.9 2.95a1.1 1.1 0 0 1 1.55 0l.6.6a1.1 1.1 0 0 1 0 1.55L6.5 11.65l-3.25 1.1Z" />
        <path d="m9.85 4 2.15 2.15" />
      </svg>
    )
  }

  return null
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function snap(value: number) {
  return Math.round(value / GRID_SIZE) * GRID_SIZE
}

function isScrollableOverflow(value: string) {
  return value === 'auto' || value === 'overlay' || value === 'scroll'
}

function scrollLockElementFromTarget(
  target: EventTarget | null,
  boundary: HTMLElement
): HTMLElement | null {
  if (!(target instanceof Node)) {
    return null
  }

  let element = target instanceof Element ? target : target.parentElement

  while (element) {
    if (element instanceof HTMLElement && element.matches(SCROLL_LOCK_SELECTOR)) {
      return element
    }

    if (element === boundary) {
      break
    }

    element = element.parentElement
  }

  return null
}

function firstScrollableDescendant(root: HTMLElement): HTMLElement | null {
  const descendants = root.querySelectorAll<HTMLElement>('*')

  for (const element of descendants) {
    const styles = window.getComputedStyle(element)
    const canScrollY =
      isScrollableOverflow(styles.overflowY) && element.scrollHeight > element.clientHeight
    const canScrollX =
      isScrollableOverflow(styles.overflowX) && element.scrollWidth > element.clientWidth

    if (canScrollX || canScrollY) {
      return element
    }
  }

  return null
}

function elementMatchingSelectorFromTarget(
  target: EventTarget | null,
  boundary: HTMLElement,
  selector: string
): HTMLElement | null {
  if (!(target instanceof Node)) {
    return null
  }

  let element = target instanceof Element ? target : target.parentElement

  while (element) {
    if (element instanceof HTMLElement && element.matches(selector)) {
      return element
    }

    if (element === boundary) {
      break
    }

    element = element.parentElement
  }

  return null
}

function scrollableElementFromTarget(
  target: EventTarget | null,
  boundary: HTMLElement
): HTMLElement | null {
  if (!(target instanceof Node)) {
    return null
  }

  let element = target instanceof Element ? target : target.parentElement

  while (element) {
    if (element instanceof HTMLElement) {
      const styles = window.getComputedStyle(element)
      const canScrollY =
        isScrollableOverflow(styles.overflowY) && element.scrollHeight > element.clientHeight
      const canScrollX =
        isScrollableOverflow(styles.overflowX) && element.scrollWidth > element.clientWidth

      if (canScrollX || canScrollY) {
        return element
      }
    }

    if (element === boundary) {
      break
    }

    element = element.parentElement
  }

  return null
}

function canScrollElementForDelta(element: HTMLElement, deltaX: number, deltaY: number) {
  const dominantAxis = Math.abs(deltaX) > Math.abs(deltaY) ? 'x' : 'y'

  if (dominantAxis === 'x' && Math.abs(deltaX) > 0.01) {
    if (deltaX < 0) {
      return element.scrollLeft > 0
    }

    return element.scrollLeft + element.clientWidth < element.scrollWidth - 1
  }

  if (Math.abs(deltaY) > 0.01) {
    if (deltaY < 0) {
      return element.scrollTop > 0
    }

    return element.scrollTop + element.clientHeight < element.scrollHeight - 1
  }

  return false
}

function hasCollaboratorFilePayload(dataTransfer: DataTransfer | null) {
  return Boolean(dataTransfer && Array.from(dataTransfer.types).includes(COLLABORATOR_FILE_MIME))
}

function isImportableImageFile(file: File) {
  if (file.type.startsWith('image/')) {
    return true
  }

  const lowerName = file.name.toLowerCase()

  return Array.from(IMAGE_FILE_EXTENSIONS).some((extension) => lowerName.endsWith(extension))
}

function droppedImageFiles(dataTransfer: DataTransfer | null) {
  return Array.from(dataTransfer?.files ?? []).filter(isImportableImageFile)
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

function terminalConnectionKey(sourceTileId: string, terminalTileId: string) {
  return `${sourceTileId}:${terminalTileId}`
}

function cubicBezierPointAt(
  start: { x: number; y: number },
  controlStart: { x: number; y: number },
  controlEnd: { x: number; y: number },
  end: { x: number; y: number },
  t: number
) {
  const inverseT = 1 - t

  return {
    x:
      inverseT ** 3 * start.x +
      3 * inverseT ** 2 * t * controlStart.x +
      3 * inverseT * t ** 2 * controlEnd.x +
      t ** 3 * end.x,
    y:
      inverseT ** 3 * start.y +
      3 * inverseT ** 2 * t * controlStart.y +
      3 * inverseT * t ** 2 * controlEnd.y +
      t ** 3 * end.y
  }
}

function connectionCurve(start: { x: number; y: number }, end: { x: number; y: number }) {
  const controlOffset = Math.max(80, Math.abs(end.x - start.x) * 0.4)
  const controlStart = {
    x: start.x + controlOffset,
    y: start.y
  }
  const controlEnd = {
    x: end.x - controlOffset,
    y: end.y
  }

  return {
    midpoint: cubicBezierPointAt(start, controlStart, controlEnd, end, 0.5),
    path: `M ${start.x} ${start.y} C ${controlStart.x} ${controlStart.y}, ${controlEnd.x} ${controlEnd.y}, ${end.x} ${end.y}`
  }
}

export const CanvasSurface = forwardRef<CanvasSurfaceHandle, CanvasSurfaceProps>(
  function CanvasSurface(
    {
      activeWorkspacePath,
      darkMode,
      onCreateMarkdownCard,
      onCreateMarkdownNote,
      onConvertStickyNoteToMarkdown,
      onImportImageFile,
      onOpenFile,
      onStateChange,
      shortcutsSuspended = false,
      state
    },
    ref
  ) {
    const containerRef = useRef<HTMLDivElement>(null)
    const editorRef = useRef<Editor | null>(null)
    const interactionRef = useRef<InteractionState | null>(null)
    const pinchStateRef = useRef<{
      originClientX: number
      originClientY: number
      startZoom: number
    } | null>(null)
    const wheelGestureOwnerRef = useRef<WheelGestureOwner | null>(null)
    const wheelGestureTimerRef = useRef<number | null>(null)
    const dragConnectionRef = useRef<DragConnectionState | null>(null)
    const canvasActiveRef = useRef(true)
    const stateRef = useRef(state)
    const drawColorRef = useRef<TLDefaultColorStyle>('black')
    const [activeBoardTool, setActiveBoardTool] = useState<BoardTool>('hand')
    const [drawColor, setDrawColor] = useState<TLDefaultColorStyle>('black')
    const [dragConnection, setDragConnection] = useState<DragConnectionState | null>(null)
    const [hoveredConnection, setHoveredConnection] = useState<HoveredConnectionState | null>(null)
    const [linkSourceTileId, setLinkSourceTileId] = useState<string | null>(null)
    const [selectedCanvasNoteId, setSelectedCanvasNoteId] = useState<string | null>(null)
    const [selectedTileId, setSelectedTileId] = useState<string | null>(null)
    const [focusedTerminal, setFocusedTerminal] = useState<{ mode: TerminalUiMode; tileId: string } | null>(null)
    const [tileRefreshTokens, setTileRefreshTokens] = useState<Record<string, number>>({})
    const [convertingStickyNote, setConvertingStickyNote] = useState(false)
    const [zoomIndicator, setZoomIndicator] = useState<string | null>(null)

    stateRef.current = state
    drawColorRef.current = drawColor

    function tileById(tileId: string | null) {
      if (!tileId) {
        return null
      }

      return stateRef.current.tiles.find((tile) => tile.id === tileId) ?? null
    }

    function isContextSourceTile(tile: CanvasTile | null): tile is CanvasTile {
      return Boolean(tile && tile.type !== 'term' && tile.filePath)
    }

    function focusTerminal(tileId: string, mode: TerminalUiMode) {
      setSelectedTileId(tileId)
      setFocusedTerminal({ tileId, mode })
      bringTileToFront(tileId)
    }

    function selectedStickyNoteFromEditor(editor: Editor) {
      const selectedShape = editor.getOnlySelectedShape()

      if (!selectedShape || selectedShape.type !== 'note') {
        return null
      }

      const noteShape = selectedShape as TLNoteShape
      const bounds = editor.getSelectionPageBounds() ?? editor.getShapePageBounds(noteShape.id)

      if (!bounds) {
        return null
      }

      return {
        bounds,
        shape: noteShape,
        text: (editor.getShapeUtil('note').getText(noteShape) ?? '').trim()
      }
    }

    function contextTilesForTerminal(tile: CanvasTile) {
      if (tile.type !== 'term') {
        return []
      }

      return (tile.contextTileIds ?? [])
        .map((contextTileId) => tileById(contextTileId))
        .filter(isContextSourceTile)
    }

    function frameContextGroups(): FrameContextGroup[] {
      const editor = editorRef.current

      if (!editor) {
        return []
      }

      return editor
        .getCurrentPageShapes()
        .filter((shape) => shape.type === 'frame')
        .flatMap((shape) => {
          const bounds = editor.getShapePageBounds(shape.id)

          if (!bounds) {
            return []
          }

          const containedTiles = stateRef.current.tiles.filter((tile) => {
            if (!isContextSourceTile(tile)) {
              return false
            }

            const centerX = tile.x + tile.width / 2
            const centerY = tile.y + tile.height / 2

            return (
              centerX >= bounds.x &&
              centerX <= bounds.x + bounds.w &&
              centerY >= bounds.y &&
              centerY <= bounds.y + bounds.h
            )
          })

          if (containedTiles.length === 0) {
            return []
          }

          return [
            {
              id: shape.id,
              label:
                typeof shape.props === 'object' &&
                shape.props &&
                'name' in shape.props &&
                typeof shape.props.name === 'string' &&
                shape.props.name.trim().length > 0
                  ? shape.props.name
                  : 'Group',
              x: bounds.x,
              y: bounds.y,
              width: bounds.w,
              height: bounds.h,
              containedTiles
            }
          ]
        })
    }

    function frameContextGroupById(groupId: string) {
      return frameContextGroups().find((group) => group.id === groupId) ?? null
    }

    function connectorCenterForTile(tile: CanvasTile) {
      return {
        x: tile.type === 'term' ? tile.x - 10 : tile.x + tile.width + 10,
        y: tile.y + tile.height / 2
      }
    }

    function connectorCenterForGroup(group: FrameContextGroup) {
      return {
        x: group.x + group.width + 10,
        y: group.y + group.height / 2
      }
    }

    function setActiveDragConnection(nextConnection: DragConnectionState | null) {
      dragConnectionRef.current = nextConnection
      setDragConnection(nextConnection)

      if (nextConnection) {
        setHoveredConnection(null)
      }
    }

    function terminalConnectorIdFromTarget(target: EventTarget | null) {
      if (!(target instanceof HTMLElement)) {
        return null
      }

      const connector = target.closest<HTMLElement>('[data-terminal-connector-id]')
      const terminalConnectorId = connector?.dataset.terminalConnectorId

      return typeof terminalConnectorId === 'string' ? terminalConnectorId : null
    }

    function showHoveredConnection(sourceTile: CanvasTile, terminalTile: CanvasTile) {
      const start = connectorCenterForTile(sourceTile)
      const end = connectorCenterForTile(terminalTile)
      const { midpoint } = connectionCurve(start, end)

      setHoveredConnection({
        sourceTileId: sourceTile.id,
        terminalTileId: terminalTile.id,
        midpointX: midpoint.x,
        midpointY: midpoint.y
      })
    }

    function isSameConnectionHoverTarget(target: EventTarget | null, connectionKey: string) {
      if (!(target instanceof Element)) {
        return false
      }

      return (
        target.closest('[data-terminal-connection-key]')?.getAttribute('data-terminal-connection-key') ===
        connectionKey
      )
    }

    function clearHoveredConnection(
      connectionKey: string,
      nextTarget: EventTarget | null = null
    ) {
      if (isSameConnectionHoverTarget(nextTarget, connectionKey)) {
        return
      }

      setHoveredConnection((current) =>
        current && terminalConnectionKey(current.sourceTileId, current.terminalTileId) === connectionKey
          ? null
          : current
      )
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
        sourceKind: 'tile',
        sourceTileId: tileId,
        currentX: x,
        currentY: y
      })
    }

    function beginGroupConnectionDrag(groupId: string, event: ReactPointerEvent<HTMLButtonElement>) {
      const group = frameContextGroupById(groupId)

      if (!group) {
        return
      }

      const { x, y } = connectorCenterForGroup(group)

      event.stopPropagation()
      setSelectedTileId(null)
      setFocusedTerminal(null)
      setLinkSourceTileId(null)
      setActiveDragConnection({
        sourceKind: 'group',
        sourceGroupId: groupId,
        currentX: x,
        currentY: y
      })
    }

    function buildClaudeCodeContextPromptForTileIds(sourceTileIds: string[]) {
      const contextTiles = Array.from(
        new Map(
          sourceTileIds
            .map((sourceTileId) => tileById(sourceTileId))
            .filter(isContextSourceTile)
            .map((tile) => [tile.filePath, tile] as const)
        ).values()
      )

      if (contextTiles.length === 0) {
        return ''
      }

      const hasImageContext = contextTiles.some((tile) => tile.type === 'image')

      return [
        'Use these workspace files as context for this Claude Code session:',
        '',
        ...contextTiles.map((tile) => `- ${tile.filePath}${tile.type === 'image' ? ' (image)' : ''}`),
        '',
        hasImageContext
          ? 'Read the text files. For each path marked (image), open that image from the workspace and inspect it before responding. Keep all of them in working context.'
          : 'Read them before responding and keep them in working context.'
      ].join('\n')
    }

    function attachContextTileIds(sourceTileIds: string[], terminalTileId: string) {
      const terminalTile = tileById(terminalTileId)
      const validSourceTileIds = sourceTileIds.filter((sourceTileId) =>
        isContextSourceTile(tileById(sourceTileId))
      )

      if (validSourceTileIds.length === 0 || !terminalTile || terminalTile.type !== 'term') {
        return
      }

      const nextContextTileIds = Array.from(
        new Set([...(terminalTile.contextTileIds ?? []), ...validSourceTileIds])
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

      const prompt = buildClaudeCodeContextPromptForTileIds(nextContextTileIds)

      if (prompt && terminalTile.sessionId) {
        window.collaborator.writeTerminalInput(terminalTile.sessionId, `${prompt}\r`)
      }

      setSelectedTileId(terminalTileId)
      setFocusedTerminal(null)
      setLinkSourceTileId(null)
    }

    function attachContextTile(sourceTileId: string, terminalTileId: string) {
      attachContextTileIds([sourceTileId], terminalTileId)
    }

    function attachContextGroup(groupId: string, terminalTileId: string) {
      const group = frameContextGroupById(groupId)

      if (!group) {
        return
      }

      attachContextTileIds(
        group.containedTiles.map((tile) => tile.id),
        terminalTileId
      )
    }

    async function createMarkdownCardForTerminal(
      tileId: string,
      options: { baseName?: string; content: string; targetDirectoryPath?: string }
    ) {
      const sourceTile = tileById(tileId)

      if (!sourceTile || sourceTile.type !== 'term') {
        return
      }

      const createdNode = await onCreateMarkdownCard({
        baseName: options.baseName,
        initialContent: options.content,
        targetDirectoryPath: options.targetDirectoryPath
      })

      if (!createdNode) {
        return
      }

      const draftTile = createTileFromFile(
        {
          fileKind: 'note',
          name: createdNode.name,
          path: createdNode.path
        },
        0,
        0,
        nextZIndex(stateRef.current.tiles)
      )
      const viewportMargin = 28
      const preferredRightX = sourceTile.x + sourceTile.width + viewportMargin
      const preferredLeftX = sourceTile.x - draftTile.width - viewportMargin
      const preferredY = sourceTile.y + viewportMargin
      let nextX = preferredRightX
      let nextY = preferredY
      const bounds = visibleWorldBounds()

      if (bounds) {
        const minX = bounds.left + viewportMargin
        const maxX = Math.max(minX, bounds.right - draftTile.width - viewportMargin)
        const minY = bounds.top + viewportMargin
        const maxY = Math.max(minY, bounds.bottom - draftTile.height - viewportMargin)

        if (preferredRightX > maxX && preferredLeftX >= minX) {
          nextX = preferredLeftX
        }

        nextX = clamp(nextX, minX, maxX)
        nextY = clamp(nextY, minY, maxY)
      }

      const createdTile = {
        ...draftTile,
        width: DEFAULT_TERMINAL_CARD_WIDTH,
        height: DEFAULT_TERMINAL_CARD_HEIGHT,
        x: snap(nextX),
        y: snap(nextY)
      }

      appendTile(createdTile, { immediate: true })
      setSelectedTileId(createdTile.id)
      setFocusedTerminal(null)
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

      clearHoveredConnection(terminalConnectionKey(sourceTileId, terminalTileId))
    }

    function updateState(nextState: CanvasState, options?: { immediate?: boolean }) {
      stateRef.current = nextState
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

    function requestTileRefresh(tileId: string) {
      setTileRefreshTokens((current) => ({
        ...current,
        [tileId]: (current[tileId] ?? 0) + 1
      }))
    }

    function showZoom(nextZoom: number) {
      setZoomIndicator(`${Math.round(nextZoom * 100)}%`)
      window.clearTimeout((showZoom as typeof showZoom & { timer?: number }).timer)
      ;(showZoom as typeof showZoom & { timer?: number }).timer = window.setTimeout(() => {
        setZoomIndicator(null)
      }, 900)
    }

    function setViewport(nextViewport: CanvasState['viewport']) {
      const resolvedViewport = syncEditorCamera(nextViewport)

      updateState({
        ...stateRef.current,
        viewport: resolvedViewport
      })
    }

    function visibleWorldBounds() {
      const container = containerRef.current

      if (!container) {
        return null
      }

      const rect = container.getBoundingClientRect()
      const { panX, panY, zoom } = stateRef.current.viewport

      return {
        left: -panX / zoom,
        top: -panY / zoom,
        right: (rect.width - panX) / zoom,
        bottom: (rect.height - panY) / zoom
      }
    }

    function syncEditorCamera(nextViewport: CanvasState['viewport']) {
      const editor = editorRef.current

      if (!editor) {
        return nextViewport
      }

      const currentCamera = editor.getCamera()
      const targetCamera = viewportToCamera(nextViewport)

      if (
        Math.abs(currentCamera.x - targetCamera.x) <= CAMERA_EPSILON &&
        Math.abs(currentCamera.y - targetCamera.y) <= CAMERA_EPSILON &&
        Math.abs(currentCamera.z - targetCamera.z) <= CAMERA_EPSILON
      ) {
        return cameraToViewport(currentCamera)
      }

      editor.setCamera(targetCamera)

      return cameraToViewport(editor.getCamera())
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

    function clearWheelGestureOwner() {
      wheelGestureOwnerRef.current = null

      if (wheelGestureTimerRef.current !== null) {
        window.clearTimeout(wheelGestureTimerRef.current)
        wheelGestureTimerRef.current = null
      }
    }

    function currentWheelGestureOwner() {
      const owner = wheelGestureOwnerRef.current

      if (!owner) {
        return null
      }

      if (owner.kind === 'element' && !owner.element.isConnected) {
        clearWheelGestureOwner()
        return null
      }

      return owner
    }

    function extendWheelGestureOwner(owner: WheelGestureOwner) {
      wheelGestureOwnerRef.current = owner

      if (wheelGestureTimerRef.current !== null) {
        window.clearTimeout(wheelGestureTimerRef.current)
      }

      wheelGestureTimerRef.current = window.setTimeout(() => {
        wheelGestureOwnerRef.current = null
        wheelGestureTimerRef.current = null
      }, WHEEL_GESTURE_LOCK_MS)
    }

    function resolveWheelGestureOwner(
      target: EventTarget | null,
      deltaX: number,
      deltaY: number
    ): WheelGestureOwner {
      const container = containerRef.current

      if (!container) {
        return { kind: 'board' }
      }

      const scrollLockElement = scrollLockElementFromTarget(target, container)
      const scrollableElement = scrollableElementFromTarget(target, container)

      if (scrollableElement && canScrollElementForDelta(scrollableElement, deltaX, deltaY)) {
        return {
          kind: 'element',
          element: scrollableElement
        }
      }

      if (scrollLockElement) {
        return {
          kind: 'element',
          element: scrollableElement ?? firstScrollableDescendant(scrollLockElement) ?? scrollLockElement
        }
      }

      return { kind: 'board' }
    }

    function applyWheelGestureOwner(owner: WheelGestureOwner, deltaX: number, deltaY: number) {
      if (owner.kind === 'element') {
        owner.element.scrollLeft += deltaX
        owner.element.scrollTop += deltaY
        return
      }

      panBy(deltaX, deltaY)
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
          width: DEFAULT_TERMINAL_WIDTH,
          height: DEFAULT_TERMINAL_HEIGHT,
          zIndex: nextZIndex(stateRef.current.tiles),
          sessionId: sessionId()
        },
        { immediate: true }
      )
      setSelectedTileId(tileId)
      setFocusedTerminal(null)
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
      setFocusedTerminal(null)
    }

    function spawnFileTileAtClientPoint(file: FileTreeNode, clientX: number, clientY: number) {
      const fileKind = file.fileKind ?? 'code'
      const point = pagePointFromClient(clientX, clientY)
      const tile = createTileFromFile(
        {
          fileKind,
          name: file.name,
          path: file.path
        },
        point.x,
        point.y,
        nextZIndex(stateRef.current.tiles)
      )

      appendTile(tile, { immediate: true })
      setSelectedTileId(tile.id)
      setFocusedTerminal(null)
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

      if (nextTool === 'draw') {
        editor.setStyleForNextShapes(DefaultColorStyle, drawColor)
      }

      editor.setCurrentTool(nextTool)
    }

    function applyDrawColor(nextColor: TLDefaultColorStyle) {
      drawColorRef.current = nextColor
      setDrawColor(nextColor)
      editorRef.current?.setStyleForNextShapes(DefaultColorStyle, nextColor)
    }

    function runShortcutAction(action: ShortcutAction) {
      if (action === 'terminal') {
        createTerminalNearCenter()
        return
      }

      if (action === 'markdown') {
        onCreateMarkdownNote()
        return
      }

      setSelectedTileId(null)
      setFocusedTerminal(null)
      applyBoardTool(action)
    }

    async function convertSelectedStickyNoteToMarkdown() {
      const editor = editorRef.current

      if (!editor || convertingStickyNote) {
        return
      }

      const selectedNote = selectedStickyNoteFromEditor(editor)

      if (!selectedNote) {
        return
      }

      setConvertingStickyNote(true)

      try {
        const convertedNode = await onConvertStickyNoteToMarkdown(selectedNote.text)

        if (!convertedNode) {
          return
        }

        const replacementTile = createTileFromFile(
          {
            fileKind: 'note',
            name: convertedNode.name,
            path: convertedNode.path
          },
          selectedNote.bounds.x,
          selectedNote.bounds.y,
          nextZIndex(stateRef.current.tiles)
        )

        appendTile(replacementTile, { immediate: true })
        editor.deleteShapes([selectedNote.shape.id])
        setLinkSourceTileId(null)
        setSelectedTileId(replacementTile.id)
        setFocusedTerminal(null)
      } finally {
        setConvertingStickyNote(false)
      }
    }

    function handleBoardMount(editor: Editor) {
      editorRef.current = editor
      editor.updateInstanceState({ isReadonly: false })
      editor.setCameraOptions({
        wheelBehavior: 'pan',
        zoomSpeed: 1,
        panSpeed: 1,
        zoomSteps: [MIN_ZOOM, 0.16, 0.25, 0.33, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2]
      })
      if (stateRef.current.boardSnapshot && typeof stateRef.current.boardSnapshot === 'object') {
        try {
          editor.loadSnapshot(stateRef.current.boardSnapshot as Parameters<Editor['loadSnapshot']>[0])
        } catch {
          // Ignore malformed board data and continue with an empty board.
        }
      }
      editor.setCamera(viewportToCamera(stateRef.current.viewport))
      editor.setStyleForNextShapes(DefaultColorStyle, drawColor)
      applyBoardTool('hand')
      setSelectedCanvasNoteId(selectedStickyNoteFromEditor(editor)?.shape.id ?? null)

      const handleCreatedShapes = (records: TLRecord[]) => {
        const nextColor = drawColorRef.current
        const drawShapeUpdates: DrawShapeUpdate[] = records.flatMap((record) => {
          if (record.typeName !== 'shape' || record.type !== 'draw' || record.props.color === nextColor) {
            return []
          }

          return [
            {
              id: record.id,
              type: 'draw',
              props: {
                color: nextColor
              }
            }
          ]
        })

        if (drawShapeUpdates.length > 0) {
          editor.updateShapes(drawShapeUpdates)
        }
      }

      editor.on('created-shapes', handleCreatedShapes)

      const detachStoreListener = editor.store.listen(
        () => {
          const selectedStickyNote = selectedStickyNoteFromEditor(editor)

          setSelectedCanvasNoteId((current) =>
            current === (selectedStickyNote?.shape.id ?? null) ? current : (selectedStickyNote?.shape.id ?? null)
          )

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
        editor.off('created-shapes', handleCreatedShapes)
        detachStoreListener()
        detachDocumentListener()
        setSelectedCanvasNoteId(null)

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
      if (!shortcutsSuspended) {
        return
      }

      canvasActiveRef.current = false
      editorRef.current?.blur()
    }, [shortcutsSuspended])

    useEffect(() => {
      editorRef.current?.setStyleForNextShapes(DefaultColorStyle, drawColor)
    }, [drawColor])

    useEffect(() => {
      if (!focusedTerminal) {
        return
      }

      const selectedTile = selectedTileId
        ? state.tiles.find((tile) => tile.id === selectedTileId) ?? null
        : null

      if (!selectedTile || selectedTile.type !== 'term' || selectedTile.id !== focusedTerminal.tileId) {
        setFocusedTerminal(null)
      }
    }, [focusedTerminal, selectedTileId, state.tiles])

    useEffect(() => {
      function shouldPreferResolvedWheelOwner(
        activeOwner: WheelGestureOwner | null,
        resolvedOwner: WheelGestureOwner
      ) {
        return !activeOwner
      }

      function handleGlobalWheel(event: WheelEvent) {
        const container = containerRef.current
        const targetInsideCanvas =
          event.target instanceof Node && (container?.contains(event.target) ?? false)
        const activeWheelOwner = currentWheelGestureOwner()
        const nativeWheelElement =
          container && targetInsideCanvas
            ? elementMatchingSelectorFromTarget(event.target, container, NATIVE_WHEEL_SELECTOR)
            : null

        if (!event.ctrlKey && !event.metaKey) {
          if (nativeWheelElement) {
            clearWheelGestureOwner()
            return
          }

          if (!targetInsideCanvas && !activeWheelOwner) {
            return
          }

          const normalizedDeltaX = normalizeWheelDelta(event.deltaX, event.deltaMode)
          const normalizedDeltaY = normalizeWheelDelta(event.deltaY, event.deltaMode)
          const resolvedOwner = resolveWheelGestureOwner(
            event.target,
            normalizedDeltaX,
            normalizedDeltaY
          )
          const owner = shouldPreferResolvedWheelOwner(activeWheelOwner, resolvedOwner)
            ? resolvedOwner
            : activeWheelOwner ?? resolvedOwner

          extendWheelGestureOwner(owner)
          event.preventDefault()
          event.stopPropagation()
          applyWheelGestureOwner(owner, normalizedDeltaX, normalizedDeltaY)
          return
        }

        if (!targetInsideCanvas && !activeWheelOwner) {
          return
        }

        event.preventDefault()
        event.stopPropagation()

        const zoomDelta = -normalizeWheelDelta(event.deltaY, event.deltaMode) * 0.01
        const nextZoom = clamp(
          stateRef.current.viewport.zoom * Math.exp(zoomDelta),
          MIN_ZOOM,
          MAX_ZOOM
        )

        zoomAt(event.clientX, event.clientY, nextZoom)
      }

      function handleGlobalGestureStart(rawEvent: Event) {
        const event = rawEvent as GestureLikeEvent

        event.preventDefault()
        event.stopPropagation()
        beginPinch(event.clientX, event.clientY)
      }

      function handleGlobalGestureChange(rawEvent: Event) {
        const event = rawEvent as GestureLikeEvent

        event.preventDefault()
        event.stopPropagation()
        updatePinch({ scale: event.scale })
      }

      function handleGlobalGestureEnd(rawEvent: Event) {
        rawEvent.preventDefault()
        rawEvent.stopPropagation()
        endPinch()
      }

      window.addEventListener('wheel', handleGlobalWheel, { passive: false, capture: true })
      window.addEventListener('gesturestart', handleGlobalGestureStart as EventListener, {
        passive: false,
        capture: true
      })
      window.addEventListener('gesturechange', handleGlobalGestureChange as EventListener, {
        passive: false,
        capture: true
      })
      window.addEventListener('gestureend', handleGlobalGestureEnd as EventListener, {
        capture: true
      })

      return () => {
        clearWheelGestureOwner()
        window.removeEventListener('wheel', handleGlobalWheel, true)
        window.removeEventListener('gesturestart', handleGlobalGestureStart as EventListener, true)
        window.removeEventListener('gesturechange', handleGlobalGestureChange as EventListener, true)
        window.removeEventListener('gestureend', handleGlobalGestureEnd as EventListener, true)
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
      function syncBoardKeyboardFocus(target: EventTarget | null) {
        const editor = editorRef.current
        const container = containerRef.current
        const targetNode = target as Node | null
        const targetInsideCanvas = Boolean(container && targetNode && container.contains(targetNode))
        const boardShouldOwnFocus =
          !shortcutsSuspended && targetInsideCanvas && !keyboardShortcutsBlocked(target)

        canvasActiveRef.current = boardShouldOwnFocus

        if (!editor) {
          return
        }

        if (!boardShouldOwnFocus) {
          editor.blur()
          return
        }

        editor.focus()
      }

      function handlePointerContext(event: PointerEvent) {
        syncBoardKeyboardFocus(event.target)
      }

      function handleFocusIn(event: FocusEvent) {
        syncBoardKeyboardFocus(event.target)
      }

      function handleKeyDown(event: KeyboardEvent) {
        if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) {
          return
        }

        if (shortcutsSuspended || !canvasActiveRef.current) {
          return
        }

        const isEditing = keyboardShortcutsBlocked(event.target)

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

          if (focusedTerminal) {
            event.preventDefault()
            setFocusedTerminal(null)
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
      window.addEventListener('focusin', handleFocusIn, true)
      window.addEventListener('keydown', handleKeyDown)

      return () => {
        window.removeEventListener('pointerdown', handlePointerContext, true)
        window.removeEventListener('focusin', handleFocusIn, true)
        window.removeEventListener('keydown', handleKeyDown)
      }
    }, [focusedTerminal, linkSourceTileId, selectedTileId, shortcutsSuspended])

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
            if (dragConnectionRef.current.sourceKind === 'tile') {
              attachContextTile(dragConnectionRef.current.sourceTileId, terminalTileId)
            } else {
              attachContextGroup(dragConnectionRef.current.sourceGroupId, terminalTileId)
            }
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

      if (focusedTerminal?.tileId === tileId) {
        setFocusedTerminal(null)
      }

      if (linkSourceTileId === tileId) {
        setLinkSourceTileId(null)
      }

      if (
        dragConnectionRef.current?.sourceKind === 'tile' &&
        dragConnectionRef.current.sourceTileId === tileId
      ) {
        setActiveDragConnection(null)
      }

      setTileRefreshTokens((current) => {
        if (!(tileId in current)) {
          return current
        }

        const next = { ...current }
        delete next[tileId]
        return next
      })

      setHoveredConnection((current) =>
        current && (current.sourceTileId === tileId || current.terminalTileId === tileId) ? null : current
      )
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
          width: DEFAULT_TERMINAL_WIDTH,
          height: DEFAULT_TERMINAL_HEIGHT,
          zIndex: nextZIndex(stateRef.current.tiles),
          sessionId: sessionId()
        },
        { immediate: true }
      )
      setSelectedTileId(tileId)
      setFocusedTerminal(null)
    }

    function handleDragOverCapture(event: ReactDragEvent<HTMLDivElement>) {
      const targetDocumentDropZone =
        containerRef.current &&
        elementMatchingSelectorFromTarget(
          event.target,
          containerRef.current,
          DOCUMENT_DROP_TARGET_SELECTOR
        )

      if (targetDocumentDropZone) {
        return
      }

      if (hasCollaboratorFilePayload(event.dataTransfer)) {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        return
      }

      if (!activeWorkspacePath || droppedImageFiles(event.dataTransfer).length === 0) {
        return
      }

      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    }

    function handleDropCapture(event: ReactDragEvent<HTMLDivElement>) {
      const targetDocumentDropZone =
        containerRef.current &&
        elementMatchingSelectorFromTarget(
          event.target,
          containerRef.current,
          DOCUMENT_DROP_TARGET_SELECTOR
        )

      if (targetDocumentDropZone) {
        return
      }

      if (hasCollaboratorFilePayload(event.dataTransfer)) {
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
        setFocusedTerminal(null)
        return
      }

      if (!activeWorkspacePath) {
        return
      }

      const imageFiles = droppedImageFiles(event.dataTransfer)

      if (imageFiles.length === 0) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      const dropClientX = event.clientX
      const dropClientY = event.clientY

      void (async () => {
        for (const [index, imageFile] of imageFiles.entries()) {
          const importedNode = await onImportImageFile(imageFile)

          if (!importedNode) {
            continue
          }

          const staggerOffset = index * 28

          spawnFileTileAtClientPoint(
            importedNode,
            dropClientX + staggerOffset,
            dropClientY + staggerOffset
          )
        }
      })()
    }

    const activeLinkSourceTile = tileById(linkSourceTileId)
    const linkSourceTile = isContextSourceTile(activeLinkSourceTile) ? activeLinkSourceTile : null
    const frameGroups = frameContextGroups()
    const zoomLabel = `${Math.round(state.viewport.zoom * 100)}%`
    const canZoomIn = state.viewport.zoom < MAX_ZOOM - CAMERA_EPSILON
    const canZoomOut = state.viewport.zoom > MIN_ZOOM + CAMERA_EPSILON
    const drawTheme = darkMode ? DefaultColorThemePalette.darkMode : DefaultColorThemePalette.lightMode
    const terminalConnections = state.tiles.flatMap((terminalTile) => {
      if (terminalTile.type !== 'term') {
        return []
      }

      return contextTilesForTerminal(terminalTile).map((sourceTile) => ({
        sourceTile,
        terminalTile
      }))
    })
    const hoveredConnectionKey = hoveredConnection
      ? terminalConnectionKey(hoveredConnection.sourceTileId, hoveredConnection.terminalTileId)
      : null
    const hoveredConnectionSourceTile = hoveredConnection ? tileById(hoveredConnection.sourceTileId) : null
    const hoveredConnectionTerminalTile = hoveredConnection ? tileById(hoveredConnection.terminalTileId) : null

    return (
      <div
        ref={containerRef}
        className={clsx(
          'canvas-surface relative h-full overflow-hidden bg-[var(--canvas-bg)] touch-none [overscroll-behavior:none]'
        )}
        onPointerDownCapture={(event) => {
          const target = event.target as HTMLElement

          if (target.closest('[data-tile-root="true"]') || target.closest('[data-canvas-ui="true"]')) {
            return
          }

          setSelectedTileId(null)
          setFocusedTerminal(null)
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
          className="group absolute right-3 top-3 z-[220]"
        >
          <div className="flex min-h-10 w-10 max-w-[calc(100vw-1.5rem)] origin-top-right items-start overflow-hidden rounded-[6px] border border-[color:var(--line)] bg-[color:var(--surface-overlay)] shadow-[0_10px_22px_rgba(15,23,42,0.12)] backdrop-blur transition-[width,max-height,border-radius] duration-200 ease-out max-h-10 group-hover:w-[28rem] group-hover:max-h-[26rem] group-hover:rounded-[6px] group-focus-within:w-[28rem] group-focus-within:max-h-[26rem] group-focus-within:rounded-[6px]">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center self-start text-[13px] font-semibold tracking-[0.2em] text-[var(--text-dim)]">
              ?
            </div>
            <div className="min-w-0 flex-1 self-stretch overflow-y-auto pr-3 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
              <div className="pt-2.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-faint)]">
                Canvas Keys
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 pb-3">
                {SHORTCUT_ITEMS.map((shortcut) => {
                  const isActive =
                    isBoardToolAction(shortcut.action) && activeBoardTool === shortcut.action
                  const isDisabled = shortcut.action === 'markdown' && !activeWorkspacePath

                  return (
                    <button
                      key={shortcut.action}
                      disabled={isDisabled}
                      className={clsx(
                        'flex min-h-[2.75rem] items-center justify-between gap-3 rounded-[4px] border px-3 py-2 text-left transition',
                        isActive
                          ? 'border-[color:var(--text)] bg-[var(--text)] text-[var(--surface-0)]'
                          : 'border-[color:var(--line)] bg-[var(--surface-0)] text-[var(--text-dim)] hover:border-[color:var(--line-strong)] hover:text-[var(--text)]',
                        isDisabled && 'cursor-not-allowed opacity-45 hover:border-[color:var(--line)] hover:text-[var(--text-dim)]'
                      )}
                      onClick={() => runShortcutAction(shortcut.action)}
                    >
                      <span className="min-w-0 flex-1 whitespace-normal text-[11px] font-semibold uppercase leading-[1.35] tracking-[0.08em]">
                        {shortcut.label}
                      </span>
                      <span
                        className={clsx(
                          'shrink-0 rounded-[4px] border px-2 py-1 text-[10px] font-medium uppercase tracking-[0.12em]',
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
              <div className="grid gap-2 border-t border-[color:var(--line)] py-3 text-[11px] leading-5 text-[var(--text-dim)]">
                <div>
                  <span className="font-semibold text-[var(--text)]">Canvas Note:</span> press{' '}
                  <span className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.08em] text-[var(--text)]">
                    N
                  </span>{' '}
                  to place a note on the canvas.
                </div>
                <div>
                  <span className="font-semibold text-[var(--text)]">New .md file:</span> use the
                  shortcut{' '}
                  <span className="font-[var(--font-mono)] text-[10px] tracking-[0.04em] text-[var(--text)]">
                    {MARKDOWN_SHORTCUT_KEY}
                  </span>{' '}
                  or the sidebar button. It creates <span className="text-[var(--text)]">Untitled.md</span>{' '}
                  in the selected folder, or beside the selected file.
                </div>
                <div>
                  <span className="font-semibold text-[var(--text)]">Paste image:</span> press{' '}
                  <span className="font-[var(--font-mono)] text-[10px] tracking-[0.04em] text-[var(--text)]">
                    {PASTE_IMAGE_SHORTCUT_KEY}
                  </span>{' '}
                  or drop an image onto the canvas. It is saved in{' '}
                  <span className="font-[var(--font-mono)] text-[10px] tracking-[0.04em] text-[var(--text)]">
                    .claude-canvas/assets
                  </span>{' '}
                  inside the active workspace.
                </div>
                <div>
                  <span className="font-semibold text-[var(--text)]">Send to Claude:</span> drag a
                  file, image, or frame dot onto a terminal dot.
                </div>
              </div>
            </div>
          </div>
        </div>

        {linkSourceTile ? (
          <div className="pointer-events-none absolute left-3 top-3 z-[210] rounded-[4px] border border-[color:var(--line)] bg-[color:var(--surface-overlay)] px-3 py-1.5 text-[11px] font-medium tracking-[0.12em] text-[var(--text-dim)] backdrop-blur">
            Drag <span className="text-[var(--text)]">{linkSourceTile.title}</span> into a terminal
            dot, or press Esc to cancel.
          </div>
        ) : null}

        <div
          className="pointer-events-none absolute inset-0 z-0"
          style={{
            backgroundImage:
              'radial-gradient(circle, var(--canvas-dot) 0.9px, transparent 1.15px)',
            backgroundSize: `${GRID_SIZE * state.viewport.zoom}px ${GRID_SIZE * state.viewport.zoom}px`,
            backgroundPosition: `${state.viewport.panX}px ${state.viewport.panY}px`
          }}
        />

        <div className="absolute inset-0 z-10">
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
          className="pointer-events-none absolute inset-0 z-20 origin-top-left"
          style={{
            transform: `translate(${state.viewport.panX}px, ${state.viewport.panY}px) scale(${state.viewport.zoom})`
          }}
        >
          <svg className="absolute inset-0 h-full w-full" style={{ overflow: 'visible' }}>
            {terminalConnections.map(({ sourceTile, terminalTile }) => {
              const start = connectorCenterForTile(sourceTile)
              const end = connectorCenterForTile(terminalTile)
              const { path } = connectionCurve(start, end)
              const connectionKey = terminalConnectionKey(sourceTile.id, terminalTile.id)
              const isHoveredConnection = hoveredConnectionKey === connectionKey
              const startX = start.x
              const startY = start.y
              const endX = end.x
              const endY = end.y

              return (
                <g key={connectionKey}>
                  <path
                    d={path}
                    fill="none"
                    stroke="var(--link-line)"
                    strokeDasharray="8 6"
                    strokeLinecap="round"
                    strokeOpacity={isHoveredConnection ? 1 : 0.9}
                    strokeWidth={isHoveredConnection ? 2.5 : 2}
                  />
                  <path
                    d={path}
                    fill="none"
                    stroke="transparent"
                    strokeLinecap="round"
                    strokeWidth={14}
                    pointerEvents="stroke"
                    className="pointer-events-auto"
                    data-terminal-connection-key={connectionKey}
                    onPointerEnter={() => showHoveredConnection(sourceTile, terminalTile)}
                    onPointerLeave={(event) =>
                      clearHoveredConnection(connectionKey, event.relatedTarget)
                    }
                  />
                  <circle cx={startX} cy={startY} fill="var(--link-line)" r={4} />
                  <circle cx={endX} cy={endY} fill="var(--link-line)" r={4} />
                </g>
              )
            })}
            {dragConnection ? (() => {
              const start =
                dragConnection.sourceKind === 'tile'
                  ? (() => {
                      const sourceTile = tileById(dragConnection.sourceTileId)
                      return isContextSourceTile(sourceTile) ? connectorCenterForTile(sourceTile) : null
                    })()
                  : (() => {
                      const sourceGroup = frameGroups.find(
                        (group) => group.id === dragConnection.sourceGroupId
                      )
                      return sourceGroup ? connectorCenterForGroup(sourceGroup) : null
                    })()

              if (!start) {
                return null
              }

              const end = {
                x: dragConnection.currentX,
                y: dragConnection.currentY
              }
              const { path } = connectionCurve(start, end)

              return (
                <g
                  key={
                    dragConnection.sourceKind === 'tile'
                      ? `drag:${dragConnection.sourceTileId}`
                      : `drag:${dragConnection.sourceGroupId}`
                  }
                >
                  <path
                    d={path}
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

          {frameGroups.map((group) => {
            const connector = connectorCenterForGroup(group)
            const isDraggingGroup =
              dragConnection?.sourceKind === 'group' && dragConnection.sourceGroupId === group.id

            return (
              <button
                key={group.id}
                className={clsx(
                  'pointer-events-auto absolute z-[205] flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full border-2 shadow-[0_0_0_2px_var(--surface-0)] transition',
                  isDraggingGroup
                    ? 'border-[color:var(--link-line)] bg-[color:var(--link-line)] scale-110'
                    : 'border-[color:var(--line-strong)] bg-[var(--surface-0)] hover:border-[color:var(--link-line)] hover:bg-[color:var(--link-line)]'
                )}
                style={{
                  left: connector.x - 10,
                  top: connector.y
                }}
                aria-label={`Attach ${group.label} (${group.containedTiles.length}) to a terminal`}
                title={`Attach ${group.label} (${group.containedTiles.length}) to a terminal`}
                onPointerDown={(event) => beginGroupConnectionDrag(group.id, event)}
              >
                <span className="pointer-events-none block h-full w-full rounded-full bg-transparent" />
              </button>
            )
          })}

          {state.tiles
            .slice()
            .sort((left, right) => left.zIndex - right.zIndex)
            .map((tile) => (
              (() => {
                const contextTiles = tile.type === 'term' ? contextTilesForTerminal(tile) : []
                const isContextSource = isContextSourceTile(tile)
                const isPendingLinkSource = linkSourceTileId === tile.id
                const hasFileDocument = Boolean(tile.filePath)
                const showNoteShortcutHelp = tile.type === 'note'
                const tileRefreshToken = tileRefreshTokens[tile.id] ?? 0
                const connectorLabel =
                  tile.type === 'term'
                    ? dragConnection?.sourceKind === 'group'
                      ? `Attach ${frameGroups.find((group) => group.id === dragConnection.sourceGroupId)?.label ?? 'group'} to ${tile.title}`
                      : linkSourceTile && linkSourceTile.id !== tile.id
                        ? `Attach ${linkSourceTile.title} to ${tile.title}`
                        : contextTiles.length > 0
                          ? `${tile.title} has linked context`
                          : `${tile.title} terminal connector`
                    : `Connect ${tile.title} to a terminal`

                return (
                  <div
                    key={tile.id}
                    data-tile-root="true"
                    data-terminal-connector-id={tile.type === 'term' ? tile.id : undefined}
                    className={clsx(
                      'pointer-events-auto absolute overflow-visible rounded-[4px] border bg-[var(--surface-0)] shadow-[0_8px_18px_rgba(0,0,0,0.22)]',
                      selectedTileId === tile.id && focusedTerminal?.tileId === tile.id
                        ? 'border-[color:var(--accent)] shadow-[0_0_0_1px_var(--accent-soft),0_10px_22px_rgba(0,0,0,0.22)]'
                        : selectedTileId === tile.id
                          ? 'border-[color:var(--line-strong)] shadow-[0_0_0_1px_rgba(148,163,184,0.22),0_8px_18px_rgba(0,0,0,0.24)]'
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
                      if (tile.type !== 'term') {
                        setFocusedTerminal(null)
                      }
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

                      if (tile.type === 'term') {
                        if (linkSourceTile && linkSourceTile.id !== tile.id) {
                          attachContextTile(linkSourceTile.id, tile.id)
                        } else if (dragConnection?.sourceKind === 'group') {
                          attachContextGroup(dragConnection.sourceGroupId, tile.id)
                          setActiveDragConnection(null)
                        }

                        return
                      }

                      toggleLinkMode(tile.id)
                    }}
                  />
                ) : null}
                <div
                  className="flex items-center justify-between rounded-t-[4px] border-b border-[color:var(--line)] bg-[var(--surface-1)] px-2.5 py-1.5"
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
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-medium text-[var(--text)]">
                      {tile.title}
                    </div>
                    <div className="truncate text-[10px] uppercase tracking-[0.14em] text-[var(--text-faint)]">
                      {tile.type === 'term'
                        ? tile.sessionId
                        : tile.filePath?.replace(/^.*\//, '')}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {showNoteShortcutHelp ? (
                      <HoverTooltip label={NOTE_SLASH_TOOLTIP_LABEL} placement="bottom">
                        <button
                          type="button"
                          aria-label="Markdown shortcuts"
                          data-managed-tooltip="custom"
                          className="flex h-5 w-5 items-center justify-center rounded-[4px] border border-[color:var(--line)] bg-[var(--surface-0)] text-[10px] font-semibold text-[var(--text-faint)] transition hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => event.stopPropagation()}
                        >
                          /
                        </button>
                      </HoverTooltip>
                    ) : null}
                    {hasFileDocument ? (
                      <button
                        className="flex h-5 w-5 items-center justify-center rounded-[4px] border border-[color:var(--line)] bg-[var(--surface-0)] text-[11px] text-[var(--text-dim)] transition hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
                        onPointerDown={(event) => event.stopPropagation()}
                        title={tile.type === 'image' ? 'Refresh image' : 'Refresh file'}
                        onClick={(event) => {
                          event.stopPropagation()
                          requestTileRefresh(tile.id)
                        }}
                      >
                        ↻
                      </button>
                    ) : null}
                    {hasFileDocument ? (
                      <button
                        className="flex h-5 w-5 items-center justify-center rounded-[4px] border border-[color:var(--line)] bg-[var(--surface-0)] text-[11px] text-[var(--text-dim)] transition hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
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
                      className="flex h-5 w-5 items-center justify-center rounded-[4px] border border-[color:var(--line)] bg-[var(--surface-0)] text-[13px] leading-none text-[var(--text-dim)] transition hover:border-[color:var(--error-line)] hover:bg-[var(--error-bg)] hover:text-[var(--error-text)]"
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
                        className="flex flex-wrap items-center gap-2 rounded-[4px] border border-[color:var(--line)] bg-[var(--surface-1)] px-2.5 py-2"
                        data-terminal-control="true"
                        onPointerDown={(event) => event.stopPropagation()}
                      >
                        {contextTiles.length === 0 ? (
                          <div className="text-[11px] text-[var(--text-dim)]">
                            {linkSourceTile
                              ? 'Drop the dragged connector on this terminal dot to attach it.'
                              : 'Drag a file dot or a frame-group dot into this terminal to build Claude Code context.'}
                          </div>
                        ) : (
                          contextTiles.map((contextTile) => (
                            <div
                              key={contextTile.id}
                              className="flex items-center gap-1 rounded-[4px] border border-[color:var(--line)] bg-[var(--surface-0)] px-2 py-1 text-[10px] text-[var(--text-dim)]"
                            >
                              <span className="max-w-[120px] truncate">{contextTile.title}</span>
                              <button
                                className="rounded-[4px] px-1 text-[var(--text-faint)] transition hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
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
                      </div>

                      <div className="min-h-0 flex-1">
                        <TerminalPane
                          cwd={activeWorkspacePath}
                          darkMode={darkMode}
                          focusMode={
                            selectedTileId === tile.id && focusedTerminal?.tileId === tile.id
                              ? focusedTerminal.mode
                              : null
                          }
                          isSelected={selectedTileId === tile.id}
                          onCreateMarkdownCard={(options) => createMarkdownCardForTerminal(tile.id, options)}
                          onFocusModeChange={(mode) => {
                            focusTerminal(tile.id, mode)
                          }}
                          sessionId={tile.sessionId as string}
                        />
                      </div>
                    </div>
                  ) : (
                    <DocumentPane
                      fileKind={tile.type as FileKind}
                      filePath={tile.filePath as string}
                      onImportImageFile={onImportImageFile}
                      onPassthroughScroll={panBy}
                      refreshToken={tileRefreshToken}
                      showTileRefreshButton={false}
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

        {hoveredConnection &&
        isContextSourceTile(hoveredConnectionSourceTile) &&
        hoveredConnectionTerminalTile?.type === 'term' ? (
          <div data-canvas-ui="true" className="pointer-events-none absolute inset-0 z-[210]">
            <button
              type="button"
              data-terminal-connection-key={hoveredConnectionKey ?? undefined}
              className="pointer-events-auto absolute flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-[color:var(--line-strong)] bg-[color:var(--surface-overlay)] text-[11px] leading-none text-[var(--text-dim)] shadow-[0_8px_18px_rgba(0,0,0,0.18)] backdrop-blur transition hover:border-[color:var(--error-line)] hover:bg-[var(--error-bg)] hover:text-[var(--error-text)]"
              style={{
                left: hoveredConnection.midpointX * state.viewport.zoom + state.viewport.panX,
                top: hoveredConnection.midpointY * state.viewport.zoom + state.viewport.panY
              }}
              aria-label={`Remove link from ${hoveredConnectionSourceTile.title} to ${hoveredConnectionTerminalTile.title}`}
              title={`Remove link from ${hoveredConnectionSourceTile.title} to ${hoveredConnectionTerminalTile.title}`}
              onPointerDown={(event) => {
                event.stopPropagation()
              }}
              onPointerLeave={(event) => {
                if (hoveredConnectionKey) {
                  clearHoveredConnection(hoveredConnectionKey, event.relatedTarget)
                }
              }}
              onClick={(event) => {
                event.stopPropagation()
                detachContextTile(hoveredConnectionTerminalTile.id, hoveredConnectionSourceTile.id)
              }}
            >
              <span className="pointer-events-none block leading-none">×</span>
            </button>
          </div>
        ) : null}

        {zoomIndicator ? (
          <div className="pointer-events-none absolute bottom-[6.65rem] right-3 z-[220] rounded-[4px] border border-[color:var(--line)] bg-[var(--surface-0)] px-3 py-1.5 text-[10px] font-medium tracking-[0.14em] text-[var(--text-dim)] shadow-[0_10px_22px_rgba(15,23,42,0.08)] backdrop-blur">
            {zoomIndicator}
          </div>
        ) : null}

        <div
          data-canvas-ui="true"
          className="absolute bottom-0 right-0 z-[220] overflow-hidden border-l border-t border-[color:var(--line)] bg-[color:var(--surface-overlay)] shadow-[0_-8px_24px_rgba(15,23,42,0.1)] backdrop-blur"
        >
          <div className="flex items-center gap-1.5 border-b border-[color:var(--line)] px-3 py-2">
            {QUICK_ACTION_ITEMS.map((action) => {
              const isActive = activeBoardTool === action.action

              return (
                <HoverTooltip key={action.action} label={action.label} shortcut={action.key}>
                  <button
                    aria-label={action.label}
                    data-managed-tooltip="custom"
                    data-shortcut={action.key}
                    className={clsx(
                      'flex h-9 w-9 items-center justify-center rounded-[4px] border transition',
                      isActive
                        ? 'border-[color:var(--text)] bg-[var(--text)] text-[var(--surface-0)]'
                        : 'border-[color:var(--line)] bg-[var(--surface-0)] text-[var(--text-dim)] hover:border-[color:var(--line-strong)] hover:text-[var(--text)]'
                    )}
                    onClick={() => runShortcutAction(action.action)}
                  >
                    <span
                      className={clsx(
                        'pointer-events-none inline-flex items-center justify-center',
                        isActive ? 'text-[var(--surface-0)]' : 'text-current'
                      )}
                    >
                      <QuickActionIcon action={action.action} />
                    </span>
                  </button>
                </HoverTooltip>
              )
            })}
          </div>

          {activeBoardTool === 'draw' ? (
            <div className="flex items-center gap-2 border-b border-[color:var(--line)] px-3 py-2">
              <div className="pr-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-faint)]">
                Ink
              </div>
              <div className="flex items-center gap-1.5">
                {DRAW_COLOR_ITEMS.map((item) => {
                  const isActive = drawColor === item.color

                  return (
                    <button
                      key={item.color}
                      aria-label={`Pen color ${item.label}`}
                      className={clsx(
                        'relative flex h-7 w-7 items-center justify-center rounded-full border transition',
                        isActive
                          ? 'border-[color:var(--text)] bg-[var(--surface-0)] shadow-[0_0_0_1px_rgba(15,23,42,0.08)]'
                          : 'border-[color:var(--line)] bg-[var(--surface-0)] hover:border-[color:var(--line-strong)]'
                      )}
                      onClick={() => {
                        applyDrawColor(item.color)
                      }}
                      title={`Pen color: ${item.label}`}
                    >
                      <span
                        className={clsx(
                          'block h-4 w-4 rounded-full border',
                          item.color === 'white'
                            ? 'border-[color:var(--line-strong)]'
                            : 'border-black/5'
                        )}
                        style={{
                          backgroundColor: drawTheme[item.color].solid
                        }}
                      />
                      {isActive ? (
                        <span className="pointer-events-none absolute inset-0 rounded-full shadow-[inset_0_0_0_1px_var(--text)]" />
                      ) : null}
                    </button>
                  )
                })}
              </div>
            </div>
          ) : null}

          {selectedCanvasNoteId && activeWorkspacePath ? (
            <div className="flex items-center justify-between gap-3 border-b border-[color:var(--line)] px-3 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-faint)]">
                Sticky note
              </div>
              <HoverTooltip label="Convert the selected sticky note into a real markdown file in the current folder">
                <button
                  type="button"
                  aria-label="Convert selected sticky note to markdown"
                  data-managed-tooltip="custom"
                  className="flex items-center gap-2 rounded-[4px] border border-[color:var(--line)] bg-[var(--surface-0)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--text-dim)] transition hover:border-[color:var(--line-strong)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-45"
                  disabled={convertingStickyNote}
                  onClick={() => {
                    void convertSelectedStickyNoteToMarkdown()
                  }}
                >
                  <span className="font-[var(--font-mono)] text-[10px] text-[var(--text-faint)]">.md</span>
                  <span>{convertingStickyNote ? 'Saving…' : 'Convert'}</span>
                </button>
              </HoverTooltip>
            </div>
          ) : null}

          <div className="flex items-center gap-1.5 px-3 py-2.5">
            <button
              className="flex h-9 w-9 items-center justify-center rounded-[4px] border border-[color:var(--line)] bg-[var(--surface-0)] text-[1.35rem] font-light leading-none text-[var(--text-dim)] transition hover:border-[color:var(--line-strong)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-45"
              aria-label="Zoom out"
              data-shortcut={ZOOM_OUT_SHORTCUT_KEY}
              disabled={!canZoomOut}
              onClick={() => {
                zoomByFactor(0.9)
              }}
              title={composeTooltipLabel('Zoom out', ZOOM_OUT_SHORTCUT_KEY)}
            >
              -
            </button>
            <button
              className="min-w-[6rem] rounded-[4px] border border-[color:var(--line)] bg-[var(--surface-0)] px-3.5 py-2.5 text-[0.95rem] font-medium leading-none tracking-[0.04em] text-[var(--text-dim)] transition hover:border-[color:var(--line-strong)] hover:text-[var(--text)]"
              aria-label="Reset zoom"
              data-shortcut={RESET_ZOOM_SHORTCUT_KEY}
              onClick={() => {
                resetViewportZoom()
              }}
              title={composeTooltipLabel('Reset zoom', RESET_ZOOM_SHORTCUT_KEY)}
            >
              {zoomLabel}
            </button>
            <button
              className="flex h-9 w-9 items-center justify-center rounded-[4px] border border-[color:var(--line)] bg-[var(--surface-0)] text-[1.35rem] font-light leading-none text-[var(--text-dim)] transition hover:border-[color:var(--line-strong)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-45"
              aria-label="Zoom in"
              data-shortcut={ZOOM_IN_SHORTCUT_KEY}
              disabled={!canZoomIn}
              onClick={() => {
                zoomByFactor(1.1)
              }}
              title={composeTooltipLabel('Zoom in', ZOOM_IN_SHORTCUT_KEY)}
            >
              +
            </button>
          </div>
        </div>
      </div>
    )
  }
)
