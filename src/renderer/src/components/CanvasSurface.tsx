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
import {
  Editor,
  Tldraw,
  putExcalidrawContent,
  startEditingShapeWithRichText,
  type TLRecord
} from 'tldraw'
import {
  DefaultColorStyle,
  DefaultLabelColorStyle,
  DefaultColorThemePalette,
  DefaultSizeStyle,
  GeoShapeGeoStyle,
  type TLDefaultColorStyle,
  type TLDefaultSizeStyle,
  type TLDrawShape,
  type TLFrameShape,
  type TLNoteShape,
  type TLShapePartial,
  type TLTextShape,
  toRichText
} from '@tldraw/tlschema'

import type {
  CanvasPinchPayload,
  CanvasDiagramEnvelope,
  CanvasState,
  CanvasTile,
  FileKind,
  FileTreeNode,
  OfficeViewerBootstrap,
  TerminalProvider,
  TerminalUiMode
} from '@shared/types'

import { DocumentPane } from './DocumentPane'
import { EmbedPane } from './EmbedPane'
import { HoverTooltip } from './HoverTooltip'
import { TerminalPane } from './TerminalPane'
import { embedDescriptorFromUrl, extractDroppedUrl } from '../utils/embedTiles'
import {
  externalDownloadFromDataTransfer,
  externalPathsFromDataTransfer,
  hasExternalPathPayload
} from '../utils/externalDropPaths'
import { keyboardShortcutsBlocked } from '../utils/keyboard'
import {
  FOCUS_CANVAS_SHORTCUT_KEY,
  FOCUS_NAVIGATOR_SHORTCUT_KEY,
  MODIFIER_KEY,
  PLACE_ON_CANVAS_SHORTCUT_KEY,
  TREE_COLLAPSE_ALL_SHORTCUT_KEY,
  TREE_COLLAPSE_SHORTCUT_KEY,
  TREE_EXPAND_ALL_SHORTCUT_KEY,
  TREE_EXPAND_SHORTCUT_KEY
} from '../utils/navigatorShortcuts'
import { composeTooltipLabel } from '../utils/buttonTooltips'
import { renderCanvasDiagramSet } from '../utils/canvasDiagramRenderer'
import { COLLABORATOR_TERMINAL_CARD_MIME, type TerminalCardTransferPayload } from '../utils/terminalCards'

interface CanvasSurfaceProps {
  activeWorkspacePath: string | null
  darkMode: boolean
  importTargetDirectoryPath: string | null
  officeViewer: OfficeViewerBootstrap | null
  onBoardReady?: () => void
  onCreateMarkdownCard: (options: {
    baseName?: string
    initialContent: string
    targetDirectoryPath?: string
  }) => Promise<FileTreeNode | null>
  onCreateMarkdownNote: () => void
  onConvertStickyNoteToMarkdown: (content: string) => Promise<FileTreeNode | null>
  onImportAssetFile: (file: File) => Promise<FileTreeNode | null>
  onImportExternalDownload: (
    download: { fileName?: string; mimeType?: string | null; url: string },
    targetDirectoryPath: string | null
  ) => Promise<FileTreeNode | null>
  onImportExternalPaths: (
    sourcePaths: string[],
    targetDirectoryPath: string | null
  ) => Promise<FileTreeNode[]>
  onImportImageFile: (file: File) => Promise<FileTreeNode | null>
  onOpenFile: (node: FileTreeNode) => void
  onRenameNode: (
    targetPath: string,
    nextName: string,
    options?: { dedupeConflicts?: boolean; suppressError?: boolean }
  ) => Promise<boolean>
  onStateChange: (state: CanvasState, options?: { immediate?: boolean }) => void
  shortcutsSuspended?: boolean
  state: CanvasState
}

export interface CanvasSurfaceHandle {
  createTerminal: (provider?: TerminalProvider) => void
  focusCanvas: () => void
  focusSelectedTileEditor: () => boolean
  importDiagramSet: (envelope: CanvasDiagramEnvelope) => void
  importExcalidrawContent: (content: unknown, title?: string) => Promise<void>
  spawnEmbedTile: (url: string) => void
  spawnFileTile: (file: FileTreeNode) => void
  spawnFileTileAtPoint: (file: FileTreeNode, clientX: number, clientY: number) => void
  resetZoom: () => void
  zoomIn: () => void
  zoomOut: () => void
}

type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
type BoardTool = 'hand' | 'select' | 'box' | 'arrow' | 'text' | 'note' | 'draw' | 'frame' | 'eraser'
type ShortcutAction = BoardTool | 'markdown' | 'terminal-claude' | 'terminal-codex'
type DrawShapeUpdate = TLShapePartial<TLDrawShape>
type FrameShapeUpdate = TLShapePartial<TLFrameShape>
type NoteShapeUpdate = TLShapePartial<TLNoteShape>
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

type HoveredConnectionState =
  | {
      midpointX: number
      midpointY: number
      sourceGroupId: string
      sourceKind: 'group'
      terminalTileId: string
    }
  | {
      midpointX: number
      midpointY: number
      sourceKind: 'tile'
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

interface FrameBundleVisual extends FrameContextGroup {
  isEmpty: boolean
  movableTiles: CanvasTile[]
}

interface FrameBoundsSnapshot {
  height: number
  width: number
  x: number
  y: number
}

interface TileSelectionBox {
  currentX: number
  currentY: number
  startX: number
  startY: number
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
      tileStarts: Array<{ id: string; x: number; y: number }>
      type: 'drag'
    }
  | {
      frameId: string
      frameStartHeight: number
      frameStartWidth: number
      frameStartX: number
      frameStartY: number
      startClientX: number
      startClientY: number
      tileStarts: Array<{ id: string; x: number; y: number }>
      type: 'frame-drag'
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
  | {
      startClientX: number
      startClientY: number
      startX: number
      startY: number
      type: 'tile-select'
    }

const GRID_SIZE = 20
const MAJOR_GRID = GRID_SIZE * 4
const MIN_ZOOM = 0.1
const MAX_ZOOM = 2
const WHEEL_GESTURE_LOCK_MS = 180
const POINTER_SCROLL_ACTIVATION_WINDOW_MS = 400
const MIN_TILE_WIDTH = 280
const MIN_TILE_HEIGHT = 220
const NOTE_TILE_DEFAULT_WIDTH = 360
const NOTE_TILE_DEFAULT_HEIGHT = 168
const NOTE_TILE_MIN_WIDTH = 240
const NOTE_TILE_MIN_HEIGHT = 140
const DEFAULT_TERMINAL_WIDTH = 860
const DEFAULT_TERMINAL_HEIGHT = 620
const CAMERA_EPSILON = 0.001
const FRAME_MOVE_EPSILON = 0.01
const GROUP_FRAME_HEADER_HEIGHT = 32
const GROUP_FRAME_INSET = 12
const COLLABORATOR_FILE_MIME = 'application/x-collaborator-file'
const IMAGE_FILE_EXTENSIONS = new Set(['.gif', '.jpg', '.jpeg', '.png', '.svg', '.webp'])
const VIDEO_FILE_EXTENSIONS = new Set(['.avi', '.m4v', '.mkv', '.mov', '.mp4', '.webm'])
const PDF_FILE_EXTENSIONS = new Set(['.pdf'])
const SPREADSHEET_FILE_EXTENSIONS = new Set(['.csv', '.tsv', '.xls', '.xlsx', '.ods'])
const PRESENTATION_FILE_EXTENSIONS = new Set(['.ppt', '.pptx', '.odp'])
const RENDERABLE_CODE_FILE_EXTENSIONS = new Set([
  '.c',
  '.cc',
  '.cfg',
  '.conf',
  '.cpp',
  '.cs',
  '.css',
  '.env',
  '.go',
  '.graphql',
  '.gql',
  '.h',
  '.hpp',
  '.html',
  '.ini',
  '.java',
  '.js',
  '.json',
  '.jsx',
  '.kt',
  '.less',
  '.log',
  '.lua',
  '.mjs',
  '.php',
  '.pl',
  '.properties',
  '.py',
  '.rb',
  '.rs',
  '.scss',
  '.sh',
  '.sql',
  '.svelte',
  '.swift',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.vue',
  '.xml',
  '.yaml',
  '.yml',
  '.zsh'
])
const RENDERABLE_CODE_FILE_NAMES = new Set([
  '.bashrc',
  '.editorconfig',
  '.env',
  '.gitignore',
  '.npmrc',
  '.prettierrc',
  '.tool-versions',
  'dockerfile',
  'makefile',
  'readme',
  'readme.txt'
])
const IMPORTABLE_ASSET_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.oasis.opendocument.presentation',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/tab-separated-values'
])
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
const CREATE_CODEX_TERMINAL_SHORTCUT_KEY = 'Shift+C'
const SEARCH_SHORTCUT_KEY = `${MODIFIER_KEY}+K / ${MODIFIER_KEY}+O`
const ADD_WORKSPACE_SHORTCUT_KEY = `${MODIFIER_KEY}+Shift+O`
const WORKSPACE_SWITCHER_SHORTCUT_KEY = `${MODIFIER_KEY}+Shift+W`
const TOGGLE_DARK_MODE_SHORTCUT_KEY = `${MODIFIER_KEY}+Shift+D`
const NOTE_VIEW_SCALE_MIN = 0.85
const NOTE_VIEW_SCALE_MAX = 1.45
const NOTE_VIEW_SCALE_STEP = 0.12
const SHORTCUT_ITEMS: Array<{ action: ShortcutAction; key: string; label: string }> = [
  { action: 'terminal-claude', key: 'Shift+T', label: 'New Claude Terminal' },
  { action: 'terminal-codex', key: CREATE_CODEX_TERMINAL_SHORTCUT_KEY, label: 'New Codex Terminal' },
  { action: 'markdown', key: MARKDOWN_SHORTCUT_KEY, label: 'New Markdown' },
  { action: 'hand', key: 'M', label: 'Move' },
  { action: 'select', key: 'V', label: 'Select' },
  { action: 'box', key: 'B', label: 'Box' },
  { action: 'arrow', key: 'A', label: 'Arrow' },
  { action: 'eraser', key: 'E', label: 'Eraser' },
  { action: 'text', key: 'T', label: 'Text' },
  { action: 'note', key: 'N', label: 'Canvas Note' },
  { action: 'draw', key: 'D', label: 'Draw' },
  { action: 'frame', key: 'G / Shift+G', label: 'Group Frame' }
]
const QUICK_ACTION_ITEMS: Array<{ action: BoardTool; key: string; label: string }> = [
  { action: 'select', key: 'V', label: 'Select' },
  { action: 'note', key: 'N', label: 'Sticky note' },
  { action: 'box', key: 'B', label: 'Box' },
  { action: 'draw', key: 'D', label: 'Draw' }
]
const APP_SHORTCUT_ITEMS: Array<{ key: string; label: string }> = [
  { key: SEARCH_SHORTCUT_KEY, label: 'Search files' },
  { key: ADD_WORKSPACE_SHORTCUT_KEY, label: 'Add workspace' },
  { key: WORKSPACE_SWITCHER_SHORTCUT_KEY, label: 'Switch workspace' },
  { key: TOGGLE_DARK_MODE_SHORTCUT_KEY, label: 'Toggle theme' },
  { key: FOCUS_NAVIGATOR_SHORTCUT_KEY, label: 'Focus explorer' },
  { key: FOCUS_CANVAS_SHORTCUT_KEY, label: 'Focus canvas' }
]
const NAVIGATOR_SHORTCUT_ITEMS: Array<{ key: string; label: string }> = [
  { key: '↑ / ↓', label: 'Move selection' },
  { key: TREE_EXPAND_SHORTCUT_KEY, label: 'Expand folder' },
  { key: TREE_COLLAPSE_SHORTCUT_KEY, label: 'Collapse folder' },
  { key: TREE_EXPAND_ALL_SHORTCUT_KEY, label: 'Expand all folders' },
  { key: TREE_COLLAPSE_ALL_SHORTCUT_KEY, label: 'Collapse all folders' },
  { key: PLACE_ON_CANVAS_SHORTCUT_KEY, label: 'Place file on canvas' }
]
const PREVIEW_SHORTCUT_ITEMS: Array<{ key: string; label: string }> = [
  { key: PLACE_ON_CANVAS_SHORTCUT_KEY, label: 'Place preview and return to canvas' },
  { key: 'Esc', label: 'Close preview' }
]
const DRAW_COLOR_ITEMS: Array<{
  color: TLDefaultColorStyle
  darkModeLabel?: string
  hideInLightMode?: boolean
  label: string
}> = [
  { color: 'black', darkModeLabel: 'Ink', label: 'Black' },
  { color: 'grey', label: 'Slate' },
  { color: 'blue', label: 'Blue' },
  { color: 'green', label: 'Green' },
  { color: 'orange', label: 'Orange' },
  { color: 'red', label: 'Red' },
  { color: 'violet', label: 'Violet' },
  { color: 'white', hideInLightMode: true, label: 'White' }
]
const DRAW_SIZE_ITEMS: Array<{
  previewSize: number
  size: TLDefaultSizeStyle
  label: string
}> = [
  { size: 's', label: 'Fine', previewSize: 2 },
  { size: 'm', label: 'Medium', previewSize: 3.5 },
  { size: 'l', label: 'Bold', previewSize: 5 },
  { size: 'xl', label: 'Heavy', previewSize: 6.5 }
]
const STICKY_NOTE_COLOR: TLDefaultColorStyle = 'yellow'
const STICKY_NOTE_TEXT_COLOR: TLDefaultColorStyle = 'black'
const BOARD_TOOL_SHORTCUTS: Record<string, BoardTool> = {
  a: 'arrow',
  b: 'box',
  d: 'draw',
  e: 'eraser',
  g: 'frame',
  m: 'hand',
  n: 'note',
  t: 'text',
  v: 'select'
}

function isBoardToolAction(action: ShortcutAction): action is BoardTool {
  return action !== 'terminal-claude' && action !== 'terminal-codex' && action !== 'markdown'
}

function drawColorLabel(
  item: { darkModeLabel?: string; label: string },
  darkMode: boolean
) {
  return darkMode && item.darkModeLabel ? item.darkModeLabel : item.label
}

function boardToolFromEditorToolId(toolId: string): BoardTool | null {
  switch (toolId) {
    case 'arrow':
    case 'draw':
    case 'eraser':
    case 'frame':
    case 'hand':
    case 'note':
    case 'select':
    case 'text':
      return toolId
    case 'geo':
      return 'box'
    default:
      return null
  }
}

function isTileSelectionBackgroundTarget(target: HTMLElement | null) {
  return Boolean(target?.closest('.tl-background'))
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

function wheelCaptureElementFromTarget(
  target: EventTarget | null,
  boundary: HTMLElement
): HTMLElement | null {
  return (
    scrollLockElementFromTarget(target, boundary) ??
    elementMatchingSelectorFromTarget(target, boundary, NATIVE_WHEEL_SELECTOR)
  )
}

function elementsShareCaptureChain(candidate: HTMLElement | null, active: HTMLElement | null) {
  if (!candidate || !active) {
    return false
  }

  return candidate === active || candidate.contains(active) || active.contains(candidate)
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

function hasCollaboratorTerminalCardPayload(dataTransfer: DataTransfer | null) {
  return Boolean(
    dataTransfer && Array.from(dataTransfer.types).includes(COLLABORATOR_TERMINAL_CARD_MIME)
  )
}

function isImportableImageFile(file: File) {
  if (file.type.startsWith('image/')) {
    return true
  }

  const lowerName = file.name.toLowerCase()

  return Array.from(IMAGE_FILE_EXTENSIONS).some((extension) => lowerName.endsWith(extension))
}

function isImportableAssetFile(file: File) {
  if (
    isImportableImageFile(file) ||
    file.type.startsWith('video/') ||
    IMPORTABLE_ASSET_MIME_TYPES.has(file.type.toLowerCase())
  ) {
    return true
  }

  const lowerName = file.name.toLowerCase()

  return (
    Array.from(VIDEO_FILE_EXTENSIONS).some((extension) => lowerName.endsWith(extension)) ||
    Array.from(PDF_FILE_EXTENSIONS).some((extension) => lowerName.endsWith(extension)) ||
    Array.from(SPREADSHEET_FILE_EXTENSIONS).some((extension) => lowerName.endsWith(extension)) ||
    Array.from(PRESENTATION_FILE_EXTENSIONS).some((extension) => lowerName.endsWith(extension))
  )
}

function droppedImportableAssetFiles(dataTransfer: DataTransfer | null) {
  return Array.from(dataTransfer?.files ?? []).filter(isImportableAssetFile)
}

function isRenderableImportedFile(node: FileTreeNode) {
  if (node.kind !== 'file') {
    return false
  }

  if (
    node.fileKind === 'note' ||
    node.fileKind === 'image' ||
    node.fileKind === 'video' ||
    node.fileKind === 'pdf' ||
    node.fileKind === 'spreadsheet' ||
    node.fileKind === 'presentation'
  ) {
    return true
  }

  if (node.fileKind !== 'code') {
    return false
  }

  const lowerName = node.name.toLowerCase()
  const { extension } = splitFileName(lowerName)

  return RENDERABLE_CODE_FILE_EXTENSIONS.has(extension) || RENDERABLE_CODE_FILE_NAMES.has(lowerName)
}

function collectRenderableImportedFiles(nodes: FileTreeNode[]) {
  const files: FileTreeNode[] = []

  for (const node of nodes) {
    if (isRenderableImportedFile(node)) {
      files.push(node)
      continue
    }

    if (node.children?.length) {
      files.push(...collectRenderableImportedFiles(node.children))
    }
  }

  return files
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

function terminalProviderForTile(tile: CanvasTile | null | undefined): TerminalProvider {
  if (tile?.terminalProvider === 'codex') {
    return 'codex'
  }

  return 'claude'
}

function terminalProviderLabel(provider: TerminalProvider) {
  if (provider === 'codex') {
    return 'Codex'
  }

  return 'Claude Code'
}

function titleForTerminal(tiles: CanvasTile[], provider: TerminalProvider) {
  const count =
    tiles.filter((tile) => tile.type === 'term' && terminalProviderForTile(tile) === provider).length + 1
  if (provider === 'codex') {
    return `Codex ${count}`
  }

  return `Claude ${count}`
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
  const isVideo = file.fileKind === 'video'
  const isPdf = file.fileKind === 'pdf'
  const isSpreadsheet = file.fileKind === 'spreadsheet'
  const isPresentation = file.fileKind === 'presentation'
  const width = isImage
    ? 420
    : isVideo
      ? 820
      : isPdf
        ? 820
        : isSpreadsheet || isPresentation
          ? 980
          : isNote
            ? NOTE_TILE_DEFAULT_WIDTH
            : 520
  const height = isImage
    ? 320
    : isVideo
      ? 520
      : isPdf
        ? 620
        : isSpreadsheet || isPresentation
          ? 620
          : isNote
            ? NOTE_TILE_DEFAULT_HEIGHT
            : 420

  return {
    id: `tile-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: file.fileKind,
    title: file.name,
    x: snap(x),
    y: snap(y),
    width,
    height,
    zIndex,
    filePath: file.path,
    noteSizeMode: isNote ? 'auto' : undefined,
    noteViewScale: isNote ? 1 : undefined
  }
}

function minTileWidthForTile(tile: CanvasTile) {
  return tile.type === 'note' ? NOTE_TILE_MIN_WIDTH : MIN_TILE_WIDTH
}

function minTileHeightForTile(tile: CanvasTile) {
  return tile.type === 'note' ? NOTE_TILE_MIN_HEIGHT : MIN_TILE_HEIGHT
}

function autoSizedNoteTileHeight(contentHeight: number) {
  return snap(Math.max(NOTE_TILE_DEFAULT_HEIGHT, contentHeight))
}

function createEmbedTile(url: string, x: number, y: number, zIndex: number): CanvasTile | null {
  const descriptor = embedDescriptorFromUrl(url)

  if (!descriptor) {
    return null
  }

  const isPdf = descriptor.renderKind === 'pdf'
  const isVideo = descriptor.renderKind === 'video'

  return {
    id: `tile-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: 'embed',
    title: descriptor.title,
    x: snap(x),
    y: snap(y),
    width: isPdf ? 560 : isVideo ? 520 : 720,
    height: isPdf ? 700 : isVideo ? 340 : 520,
    zIndex,
    embedUrl: descriptor.canonicalUrl
  }
}

function contextResourceLabel(tile: CanvasTile) {
  if (tile.type === 'embed') {
    return 'link'
  }

  if (tile.type === 'image') {
    return 'image'
  }

  if (tile.type === 'video') {
    return 'video'
  }

  if (tile.type === 'pdf') {
    return 'pdf'
  }

  if (tile.type === 'spreadsheet') {
    return 'spreadsheet'
  }

  if (tile.type === 'presentation') {
    return 'presentation'
  }

  return 'file'
}

function contextResourceIdentity(tile: CanvasTile) {
  return tile.filePath ?? tile.embedUrl ?? tile.id
}

function contextResourceTarget(tile: CanvasTile) {
  return tile.filePath ?? tile.embedUrl ?? tile.title
}

function contextResourcePromptLines(tile: CanvasTile) {
  const lines = [`- ${contextResourceTarget(tile)} (${contextResourceLabel(tile)})`]

  if (tile.filePath && tile.embedUrl) {
    lines.push(`  - linked-url: ${tile.embedUrl}`)
  }

  return lines
}

function fileKindForTile(tile: CanvasTile): FileKind | null {
  if (
    tile.type === 'note' ||
    tile.type === 'code' ||
    tile.type === 'image' ||
    tile.type === 'video' ||
    tile.type === 'pdf' ||
    tile.type === 'spreadsheet' ||
    tile.type === 'presentation'
  ) {
    return tile.type
  }

  return null
}

function tileSubtitleLabel(tile: CanvasTile) {
  if (tile.type === 'term') {
    return tile.sessionId ?? ''
  }

  if (tile.type === 'embed') {
    return tile.embedUrl?.replace(/^https?:\/\//i, '') ?? ''
  }

  return tile.filePath?.replace(/^.*[\\/]/, '') ?? ''
}

function fileNameFromPath(targetPath: string) {
  const pathParts = targetPath.split(/[\\/]/).filter(Boolean)
  return pathParts[pathParts.length - 1] ?? targetPath
}

function splitFileName(targetName: string) {
  const extensionIndex = targetName.lastIndexOf('.')

  if (extensionIndex <= 0) {
    return {
      extension: '',
      stem: targetName
    }
  }

  return {
    extension: targetName.slice(extensionIndex),
    stem: targetName.slice(0, extensionIndex)
  }
}

function sanitizeTileFileStem(value: string) {
  return value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 72)
}

function normalizedNoteViewScale(value: number | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 1
  }

  return Math.min(NOTE_VIEW_SCALE_MAX, Math.max(NOTE_VIEW_SCALE_MIN, value))
}

function isMarkdownNotePath(targetPath: string | null | undefined) {
  return typeof targetPath === 'string' && /\.(?:md|mdx|markdown)$/i.test(targetPath)
}

function tileCenterWithinBounds(tile: CanvasTile, bounds: FrameBoundsSnapshot) {
  const centerX = tile.x + tile.width / 2
  const centerY = tile.y + tile.height / 2

  return (
    centerX >= bounds.x &&
    centerX <= bounds.x + bounds.width &&
    centerY >= bounds.y &&
    centerY <= bounds.y + bounds.height
  )
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
      importTargetDirectoryPath,
      officeViewer,
      onBoardReady,
      onCreateMarkdownCard,
      onCreateMarkdownNote,
      onConvertStickyNoteToMarkdown,
      onImportAssetFile,
      onImportExternalDownload,
      onImportExternalPaths,
      onImportImageFile,
      onOpenFile,
      onRenameNode,
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
    const activeScrollCaptureElementRef = useRef<HTMLElement | null>(null)
    const lastPointerScrollActivationAtRef = useRef(0)
    const renamingInputRef = useRef<HTMLInputElement | null>(null)
    const headingRenameRequestRef = useRef<Map<string, string>>(new Map())
    const frameBoundsRef = useRef<Map<string, FrameBoundsSnapshot>>(new Map())
    const stateRef = useRef(state)
    const drawColorRef = useRef<TLDefaultColorStyle>('black')
    const drawSizeRef = useRef<TLDefaultSizeStyle>('m')
    const [activeBoardTool, setActiveBoardTool] = useState<BoardTool>('hand')
    const [drawColor, setDrawColor] = useState<TLDefaultColorStyle>('black')
    const [drawSize, setDrawSize] = useState<TLDefaultSizeStyle>('m')
    const [dragConnection, setDragConnection] = useState<DragConnectionState | null>(null)
    const [hoveredConnection, setHoveredConnection] = useState<HoveredConnectionState | null>(null)
    const [hoveredTileId, setHoveredTileId] = useState<string | null>(null)
    const [linkSourceTileId, setLinkSourceTileId] = useState<string | null>(null)
    const [selectedCanvasNoteId, setSelectedCanvasNoteId] = useState<string | null>(null)
    const [selectedTileId, setSelectedTileId] = useState<string | null>(null)
    const [selectedTileIds, setSelectedTileIds] = useState<string[]>([])
    const [tileSelectionBox, setTileSelectionBox] = useState<TileSelectionBox | null>(null)
    const [focusedTerminal, setFocusedTerminal] = useState<{ mode: TerminalUiMode; tileId: string } | null>(null)
    const [tileRefreshTokens, setTileRefreshTokens] = useState<Record<string, number>>({})
    const [convertingStickyNote, setConvertingStickyNote] = useState(false)
    const [renamingTileId, setRenamingTileId] = useState<string | null>(null)
    const [renamingValue, setRenamingValue] = useState('')
    const [zoomIndicator, setZoomIndicator] = useState<string | null>(null)

    stateRef.current = state
    drawColorRef.current = drawColor
    drawSizeRef.current = drawSize

    function tileById(tileId: string | null) {
      if (!tileId) {
        return null
      }

      return stateRef.current.tiles.find((tile) => tile.id === tileId) ?? null
    }

    function sameTileIdList(left: string[], right: string[]) {
      return left.length === right.length && left.every((value, index) => value === right[index])
    }

    function normalizedSelectedTileIds(tileIds: string[]) {
      const selectedTileIdSet = new Set(tileIds)

      return stateRef.current.tiles
        .filter((tile) => selectedTileIdSet.has(tile.id))
        .map((tile) => tile.id)
    }

    function setTileSelection(
      tileIds: string[],
      options?: { preserveFocusedTerminal?: boolean; primaryTileId?: string | null }
    ) {
      const nextSelectedTileIds = normalizedSelectedTileIds(tileIds)
      const nextPrimaryTileId =
        nextSelectedTileIds.length === 1
          ? nextSelectedTileIds[0]
          : options?.primaryTileId && nextSelectedTileIds.includes(options.primaryTileId)
            ? options.primaryTileId
            : null

      setSelectedTileIds((current) =>
        sameTileIdList(current, nextSelectedTileIds) ? current : nextSelectedTileIds
      )
      setSelectedTileId((current) => (current === nextPrimaryTileId ? current : nextPrimaryTileId))

      if (!options?.preserveFocusedTerminal) {
        setFocusedTerminal((current) =>
          current && nextPrimaryTileId === current.tileId && nextSelectedTileIds.length === 1 ? current : null
        )
      }
    }

    function clearTileSelection(options?: { preserveFocusedTerminal?: boolean }) {
      setTileSelection([], options)
    }

    function toggleTileSelection(tileId: string) {
      setTileSelection(
        selectedTileIds.includes(tileId)
          ? selectedTileIds.filter((selectedId) => selectedId !== tileId)
          : [...selectedTileIds, tileId],
        {
          primaryTileId: tileId
        }
      )
    }

    function selectionBoxBounds(selectionBox: TileSelectionBox) {
      return {
        left: Math.min(selectionBox.startX, selectionBox.currentX),
        top: Math.min(selectionBox.startY, selectionBox.currentY),
        right: Math.max(selectionBox.startX, selectionBox.currentX),
        bottom: Math.max(selectionBox.startY, selectionBox.currentY)
      }
    }

    function tileIdsForSelectionBox(selectionBox: TileSelectionBox) {
      const bounds = selectionBoxBounds(selectionBox)

      return stateRef.current.tiles
        .filter((tile) => {
          const tileRight = tile.x + tile.width
          const tileBottom = tile.y + tile.height

          return tile.x < bounds.right && tileRight > bounds.left && tile.y < bounds.bottom && tileBottom > bounds.top
        })
        .map((tile) => tile.id)
    }

    function bringTilesToFront(tileIds: string[]) {
      const tileIdSet = new Set(tileIds)
      const orderedTileIds = stateRef.current.tiles
        .filter((tile) => tileIdSet.has(tile.id))
        .sort((left, right) => left.zIndex - right.zIndex)
        .map((tile) => tile.id)

      if (orderedTileIds.length === 0) {
        return
      }

      const nextZIndexStart = nextZIndex(stateRef.current.tiles)
      const nextZIndexByTileId = new Map(orderedTileIds.map((tileId, index) => [tileId, nextZIndexStart + index]))

      updateState({
        ...stateRef.current,
        tiles: stateRef.current.tiles.map((tile) =>
          nextZIndexByTileId.has(tile.id)
            ? {
                ...tile,
                zIndex: nextZIndexByTileId.get(tile.id) as number
              }
            : tile
        )
      })
    }

    function beginTileSelection(event: ReactPointerEvent<HTMLDivElement>) {
      if (event.button !== 0) {
        return
      }

      const point = pagePointFromClient(event.clientX, event.clientY)
      const nextSelectionBox = {
        startX: point.x,
        startY: point.y,
        currentX: point.x,
        currentY: point.y
      }

      event.preventDefault()
      event.stopPropagation()
      interactionRef.current = {
        type: 'tile-select',
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: point.x,
        startY: point.y
      }
      setTileSelectionBox(nextSelectionBox)
      clearTileSelection()
      setLinkSourceTileId(null)
    }

    function beginTileRename(tile: CanvasTile) {
      if (!tile.filePath || !isMarkdownNotePath(tile.filePath)) {
        return
      }

      const { stem } = splitFileName(fileNameFromPath(tile.filePath))
      setRenamingTileId(tile.id)
      setRenamingValue(stem)
    }

    function cancelTileRename() {
      setRenamingTileId(null)
      setRenamingValue('')
    }

    function commitTileRename(tile: CanvasTile) {
      if (!tile.filePath) {
        cancelTileRename()
        return
      }

      const trimmedValue = renamingValue.trim()
      const currentName = fileNameFromPath(tile.filePath)
      const { extension } = splitFileName(currentName)

      setRenamingTileId(null)
      setRenamingValue('')

      if (!trimmedValue) {
        return
      }

      const nextName =
        extension && !trimmedValue.toLowerCase().endsWith(extension.toLowerCase())
          ? `${trimmedValue}${extension}`
          : trimmedValue

      if (nextName === currentName) {
        return
      }

      void onRenameNode(tile.filePath, nextName)
    }

    async function handleNotePrimaryHeadingChange(tile: CanvasTile, heading: string | null) {
      if (
        tile.type !== 'note' ||
        !tile.filePath ||
        !isMarkdownNotePath(tile.filePath) ||
        renamingTileId === tile.id
      ) {
        return
      }

      const nextStem = heading ? sanitizeTileFileStem(heading) : ''

      if (!nextStem) {
        return
      }

      const currentName = fileNameFromPath(tile.filePath)
      const { extension, stem } = splitFileName(currentName)

      if (stem === nextStem) {
        return
      }

      if (headingRenameRequestRef.current.get(tile.id) === nextStem) {
        return
      }

      headingRenameRequestRef.current.set(tile.id, nextStem)

      try {
        await onRenameNode(tile.filePath, `${nextStem}${extension}`, {
          dedupeConflicts: true,
          suppressError: true
        })
      } finally {
        if (headingRenameRequestRef.current.get(tile.id) === nextStem) {
          headingRenameRequestRef.current.delete(tile.id)
        }
      }
    }

    useEffect(() => {
      if (!renamingTileId || !renamingInputRef.current) {
        return
      }

      renamingInputRef.current.focus()
      renamingInputRef.current.select()
    }, [renamingTileId])

    useEffect(() => {
      if (!renamingTileId) {
        return
      }

      const activeTile = tileById(renamingTileId)

      if (!activeTile?.filePath || !isMarkdownNotePath(activeTile.filePath)) {
        cancelTileRename()
      }
    }, [renamingTileId, state])

    function isContextSourceTile(tile: CanvasTile | null): tile is CanvasTile {
      return Boolean(tile && tile.type !== 'term' && (tile.filePath || tile.embedUrl))
    }

    function focusTerminal(tileId: string, mode: TerminalUiMode) {
      setTileSelection([tileId], {
        preserveFocusedTerminal: true
      })
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

    function selectedEditableRichTextShapeFromEditor(editor: Editor) {
      const selectedShape = editor.getOnlySelectedShape()

      if (!selectedShape || (selectedShape.type !== 'note' && selectedShape.type !== 'text')) {
        return null
      }

      return selectedShape as TLNoteShape | TLTextShape
    }

    function startEditingSelectedRichTextShape(options?: { selectAll?: boolean }) {
      const editor = editorRef.current

      if (!editor) {
        return false
      }

      const selectedShape = selectedEditableRichTextShapeFromEditor(editor)

      if (!selectedShape) {
        return false
      }

      editor.setCurrentTool('select')
      startEditingShapeWithRichText(editor, selectedShape.id, {
        selectAll: options?.selectAll ?? false
      })
      return true
    }

    function frameBundleVisuals(): FrameBundleVisual[] {
      const editor = editorRef.current

      if (!editor) {
        return []
      }

      const currentPageShapes = editor.getCurrentPageShapes()

      return currentPageShapes
        .filter((shape) => shape.type === 'frame')
        .flatMap((shape) => {
          const bounds = editor.getShapePageBounds(shape.id)

          if (!bounds) {
            return []
          }

          const hasFrameChildren = currentPageShapes.some(
            (candidate) => candidate.parentId === shape.id && candidate.type !== 'frame'
          )

          const boundsSnapshot = {
            x: bounds.x,
            y: bounds.y,
            width: bounds.w,
            height: bounds.h
          }
          const movableTiles = stateRef.current.tiles.filter((tile) =>
            tileCenterWithinBounds(tile, boundsSnapshot)
          )
          const containedTiles = movableTiles.filter(isContextSourceTile)

          if (movableTiles.length === 0 && hasFrameChildren) {
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
              containedTiles,
              movableTiles,
              isEmpty: containedTiles.length === 0
            }
          ]
        })
    }

    function frameContextGroups(): FrameContextGroup[] {
      return frameBundleVisuals().filter((group) => !group.isEmpty)
    }

    function frameBoundsSnapshot(editor: Editor) {
      const boundsById = new Map<string, FrameBoundsSnapshot>()

      editor
        .getCurrentPageShapes()
        .filter((shape) => shape.type === 'frame')
        .forEach((shape) => {
          const bounds = editor.getShapePageBounds(shape.id)

          if (!bounds) {
            return
          }

          boundsById.set(shape.id, {
            x: bounds.x,
            y: bounds.y,
            width: bounds.w,
            height: bounds.h
          })
        })

      return boundsById
    }

    function nextGroupFrameLabel(editor: Editor) {
      const maxGroupNumber = editor
        .getCurrentPageShapes()
        .filter((shape) => shape.type === 'frame')
        .reduce((maxNumber, shape) => {
          const name =
            typeof shape.props === 'object' &&
            shape.props &&
            'name' in shape.props &&
            typeof shape.props.name === 'string'
              ? shape.props.name.trim()
              : ''
          const match = /^Group\s+(\d+)$/i.exec(name)
          const nextNumber = match ? Number.parseInt(match[1] ?? '0', 10) : 0

          return Number.isFinite(nextNumber) ? Math.max(maxNumber, nextNumber) : maxNumber
        }, 0)

      return `Group ${maxGroupNumber + 1}`
    }

    function expandFrameBoundsForTile(bounds: FrameBoundsSnapshot, tile: CanvasTile): FrameBoundsSnapshot {
      const nextLeft = Math.min(bounds.x, tile.x - GROUP_FRAME_INSET)
      const nextTop = Math.min(bounds.y, tile.y - GROUP_FRAME_HEADER_HEIGHT - GROUP_FRAME_INSET)
      const nextRight = Math.max(bounds.x + bounds.width, tile.x + tile.width + GROUP_FRAME_INSET)
      const nextBottom = Math.max(bounds.y + bounds.height, tile.y + tile.height + GROUP_FRAME_INSET)

      return {
        x: snap(nextLeft),
        y: snap(nextTop),
        width: snap(nextRight - nextLeft),
        height: snap(nextBottom - nextTop)
      }
    }

    function expandGroupsForTileIds(tileIds: string[]) {
      const editor = editorRef.current

      if (!editor || tileIds.length === 0) {
        return
      }

      const currentBounds = frameBoundsSnapshot(editor)
      const nextBounds = new Map(currentBounds)

      tileIds.forEach((tileId) => {
        const tile = tileById(tileId)

        if (!tile) {
          return
        }

        Array.from(nextBounds.entries()).forEach(([frameId, bounds]) => {
          if (!tileCenterWithinBounds(tile, bounds)) {
            return
          }

          nextBounds.set(frameId, expandFrameBoundsForTile(bounds, tile))
        })
      })

      const frameUpdates: FrameShapeUpdate[] = Array.from(nextBounds.entries()).flatMap(([frameId, bounds]) => {
        const previousBounds = currentBounds.get(frameId)

        if (
          !previousBounds ||
          (Math.abs(previousBounds.x - bounds.x) <= FRAME_MOVE_EPSILON &&
            Math.abs(previousBounds.y - bounds.y) <= FRAME_MOVE_EPSILON &&
            Math.abs(previousBounds.width - bounds.width) <= FRAME_MOVE_EPSILON &&
            Math.abs(previousBounds.height - bounds.height) <= FRAME_MOVE_EPSILON)
        ) {
          return []
        }

        return [
          {
            id: frameId as TLFrameShape['id'],
            type: 'frame',
            x: bounds.x,
            y: bounds.y,
            props: {
              w: bounds.width,
              h: bounds.height
            }
          }
        ]
      })

      if (frameUpdates.length === 0) {
        return
      }

      frameUpdates.forEach((update) => {
        frameBoundsRef.current.set(update.id, {
          x: update.x ?? currentBounds.get(update.id)?.x ?? 0,
          y: update.y ?? currentBounds.get(update.id)?.y ?? 0,
          width: update.props?.w ?? currentBounds.get(update.id)?.width ?? 0,
          height: update.props?.h ?? currentBounds.get(update.id)?.height ?? 0
        })
      })

      editor.updateShapes(frameUpdates)
    }

    function frameContextGroupById(groupId: string) {
      return frameContextGroups().find((group) => group.id === groupId) ?? null
    }

    function contextGroupsForTerminal(tile: CanvasTile) {
      if (tile.type !== 'term') {
        return []
      }

      return (tile.contextGroupIds ?? [])
        .map((groupId) => frameContextGroupById(groupId))
        .filter((group): group is FrameContextGroup => group !== null)
    }

    function contextTilesForTerminal(tile: CanvasTile) {
      if (tile.type !== 'term') {
        return []
      }

      const groupedTileIds = new Set(
        contextGroupsForTerminal(tile).flatMap((group) => group.containedTiles.map((groupTile) => groupTile.id))
      )

      return (tile.contextTileIds ?? [])
        .map((contextTileId) => tileById(contextTileId))
        .filter(isContextSourceTile)
        .filter((contextTile) => !groupedTileIds.has(contextTile.id))
    }

    function resolvedContextTilesForTerminal(tile: CanvasTile) {
      if (tile.type !== 'term') {
        return []
      }

      return Array.from(
        new Map(
          [...contextGroupsForTerminal(tile).flatMap((group) => group.containedTiles), ...contextTilesForTerminal(tile)]
            .filter(isContextSourceTile)
            .map((contextTile) => [contextResourceIdentity(contextTile), contextTile] as const)
        ).values()
      )
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

    function showHoveredTileConnection(sourceTile: CanvasTile, terminalTile: CanvasTile) {
      const start = connectorCenterForTile(sourceTile)
      const end = connectorCenterForTile(terminalTile)
      const { midpoint } = connectionCurve(start, end)

      setHoveredConnection({
        sourceKind: 'tile',
        sourceTileId: sourceTile.id,
        terminalTileId: terminalTile.id,
        midpointX: midpoint.x,
        midpointY: midpoint.y
      })
    }

    function showHoveredGroupConnection(sourceGroup: FrameContextGroup, terminalTile: CanvasTile) {
      const start = connectorCenterForGroup(sourceGroup)
      const end = connectorCenterForTile(terminalTile)
      const { midpoint } = connectionCurve(start, end)

      setHoveredConnection({
        sourceGroupId: sourceGroup.id,
        sourceKind: 'group',
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
        current &&
        (current.sourceKind === 'group'
          ? `group:${current.sourceGroupId}:${current.terminalTileId}`
          : terminalConnectionKey(current.sourceTileId, current.terminalTileId)) === connectionKey
          ? null
          : current
      )
    }

    function toggleLinkMode(tileId: string) {
      const tile = tileById(tileId)

      if (!isContextSourceTile(tile)) {
        return
      }

      setTileSelection([tileId])
      setLinkSourceTileId((current) => (current === tileId ? null : tileId))
    }

    function beginConnectionDrag(tileId: string, event: ReactPointerEvent<HTMLDivElement>) {
      const tile = tileById(tileId)

      if (!isContextSourceTile(tile)) {
        return
      }

      const { x, y } = connectorCenterForTile(tile)

      event.stopPropagation()
      setTileSelection([tileId])
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
      clearTileSelection()
      setLinkSourceTileId(null)
      setActiveDragConnection({
        sourceKind: 'group',
        sourceGroupId: groupId,
        currentX: x,
        currentY: y
      })
    }

    function beginFrameBundleDrag(
      group: FrameBundleVisual,
      event: ReactPointerEvent<HTMLDivElement>
    ) {
      if (event.button !== 0) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      clearTileSelection()
      setLinkSourceTileId(null)

      interactionRef.current = {
        type: 'frame-drag',
        frameId: group.id,
        frameStartX: group.x,
        frameStartY: group.y,
        frameStartWidth: group.width,
        frameStartHeight: group.height,
        startClientX: event.clientX,
        startClientY: event.clientY,
        tileStarts: group.movableTiles.map((tile) => ({
          id: tile.id,
          x: tile.x,
          y: tile.y
        }))
      }
    }

    function moveFrameBundle(
      interaction: Extract<InteractionState, { type: 'frame-drag' }>,
      deltaX: number,
      deltaY: number,
      options?: { immediate?: boolean; snapToGrid?: boolean }
    ) {
      const editor = editorRef.current
      const nextFrameX = options?.snapToGrid ? snap(interaction.frameStartX + deltaX) : interaction.frameStartX + deltaX
      const nextFrameY = options?.snapToGrid ? snap(interaction.frameStartY + deltaY) : interaction.frameStartY + deltaY
      const resolvedDeltaX = nextFrameX - interaction.frameStartX
      const resolvedDeltaY = nextFrameY - interaction.frameStartY

      if (editor) {
        frameBoundsRef.current.set(interaction.frameId, {
          x: nextFrameX,
          y: nextFrameY,
          width: interaction.frameStartWidth,
          height: interaction.frameStartHeight
        })
        editor.updateShapes([
          {
            id: interaction.frameId as TLFrameShape['id'],
            type: 'frame',
            x: nextFrameX,
            y: nextFrameY,
            props: {
              w: interaction.frameStartWidth,
              h: interaction.frameStartHeight
            }
          }
        ])
      }

      const tileOffsets = new Map(
        interaction.tileStarts.map((tileStart) => [
          tileStart.id,
          {
            x: tileStart.x + resolvedDeltaX,
            y: tileStart.y + resolvedDeltaY
          }
        ])
      )

      updateState(
        {
          ...stateRef.current,
          tiles: stateRef.current.tiles.map((tile) => {
            const nextPosition = tileOffsets.get(tile.id)

            if (!nextPosition) {
              return tile
            }

            return {
              ...tile,
              x: nextPosition.x,
              y: nextPosition.y
            }
          })
        },
        options?.immediate ? { immediate: true } : undefined
      )
    }

    function buildTerminalContextPrompt(
      terminalTile: CanvasTile,
      provider: TerminalProvider
    ) {
      const contextGroups = contextGroupsForTerminal(terminalTile)
      const contextTiles = resolvedContextTilesForTerminal(terminalTile)

      if (contextTiles.length === 0) {
        return ''
      }

      const hasImageContext = contextTiles.some((tile) => tile.type === 'image')
      const hasPdfContext = contextTiles.some((tile) => tile.type === 'pdf')
      const hasSpreadsheetContext = contextTiles.some((tile) => tile.type === 'spreadsheet')
      const hasPresentationContext = contextTiles.some((tile) => tile.type === 'presentation')
      const hasVideoContext = contextTiles.some((tile) => tile.type === 'video')
      const hasLinkContext = contextTiles.some((tile) => tile.type === 'embed' || Boolean(tile.embedUrl))
      const looseContextTiles = contextTilesForTerminal(terminalTile)
      const lines = [
        `Use these workspace resources as context for this ${terminalProviderLabel(provider)} session:`,
        ''
      ]

      if (contextGroups.length > 0) {
        lines.push('Resource bundles:')
        contextGroups.forEach((group) => {
          lines.push(`- ${group.label} (${group.containedTiles.length} items)`)
          group.containedTiles.forEach((groupTile) => {
            contextResourcePromptLines(groupTile).forEach((line) => lines.push(`  ${line}`))
          })
        })
      }

      if (looseContextTiles.length > 0) {
        if (contextGroups.length > 0) {
          lines.push('')
        }

        lines.push('Loose resources:')
        looseContextTiles.forEach((contextTile) => {
          contextResourcePromptLines(contextTile).forEach((line) => lines.push(line))
        })
      }

      lines.push('')
      lines.push('Read the text and code files before responding.')

      if (hasImageContext) {
        lines.push('For each path marked (image), inspect that image before responding.')
      }

      if (hasPdfContext) {
        lines.push('For each path marked (pdf), read that PDF before responding.')
      }

      if (hasSpreadsheetContext) {
        lines.push(
          'For each path marked (spreadsheet), inspect the table structure and values before responding.'
        )
      }

      if (hasPresentationContext) {
        lines.push(
          'For each path marked (presentation), review the deck slides and speaker context before responding. If a linked-url is present, open that slideshow URL and use it as the primary deck reference.'
        )
      }

      if (hasVideoContext) {
        lines.push(
          'For each path marked (video), inspect the video file or extract the relevant details before responding.'
        )
      }

      if (hasLinkContext) {
        lines.push(
          'For each path marked (link) or any resource with a linked-url, open that URL and inspect the webpage or embedded resource before responding.'
        )
      }

      lines.push('Keep all of these resources in working context for follow-up questions.')

      return lines.join('\n')
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

      setTileSelection([terminalTileId])
      setLinkSourceTileId(null)
    }

    function attachContextTile(sourceTileId: string, terminalTileId: string) {
      attachContextTileIds([sourceTileId], terminalTileId)
    }

    function attachContextGroup(groupId: string, terminalTileId: string) {
      const group = frameContextGroupById(groupId)
      const terminalTile = tileById(terminalTileId)

      if (!group || !terminalTile || terminalTile.type !== 'term') {
        return
      }

      const nextContextGroupIds = Array.from(new Set([...(terminalTile.contextGroupIds ?? []), groupId]))

      updateState(
        {
          ...stateRef.current,
          tiles: stateRef.current.tiles.map((tile) =>
            tile.id === terminalTileId
              ? {
                  ...tile,
                  contextGroupIds: nextContextGroupIds
                }
              : tile
          )
        },
        { immediate: true }
      )

      setTileSelection([terminalTileId])
      setLinkSourceTileId(null)
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
        x: snap(nextX),
        y: snap(nextY)
      }

      appendTile(createdTile, { immediate: true })
      setTileSelection([createdTile.id])
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

    function detachContextGroup(terminalTileId: string, groupId: string) {
      updateState(
        {
          ...stateRef.current,
          tiles: stateRef.current.tiles.map((tile) =>
            tile.id === terminalTileId
              ? {
                  ...tile,
                  contextGroupIds: (tile.contextGroupIds ?? []).filter(
                    (contextGroupId) => contextGroupId !== groupId
                  )
                }
              : tile
          )
        },
        { immediate: true }
      )

      clearHoveredConnection(`group:${groupId}:${terminalTileId}`)
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
      expandGroupsForTileIds([tile.id])
    }

    function updateTile(
      tileId: string,
      updater: (tile: CanvasTile) => CanvasTile,
      options?: { immediate?: boolean }
    ) {
      updateState(
        {
          ...stateRef.current,
          tiles: stateRef.current.tiles.map((tile) => (tile.id === tileId ? updater(tile) : tile))
        },
        options
      )
    }

    function handleNoteContentHeightChange(tileId: string, contentHeight: number) {
      const tile = tileById(tileId)

      if (!tile || tile.type !== 'note' || tile.noteSizeMode === 'manual') {
        return
      }

      const nextHeight = autoSizedNoteTileHeight(contentHeight)

      if (Math.abs(tile.height - nextHeight) < 2) {
        return
      }

      updateTile(
        tileId,
        (currentTile) =>
          currentTile.type === 'note' && currentTile.noteSizeMode !== 'manual'
            ? {
                ...currentTile,
                height: nextHeight
              }
            : currentTile
      )
    }

    function adjustNoteViewScale(tileId: string, delta: number) {
      updateTile(
        tileId,
        (currentTile) =>
          currentTile.type === 'note'
            ? {
                ...currentTile,
                noteViewScale: normalizedNoteViewScale(
                  normalizedNoteViewScale(currentTile.noteViewScale) + delta
                )
              }
            : currentTile,
        { immediate: true }
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

    function currentActiveScrollCaptureElement() {
      const element = activeScrollCaptureElementRef.current

      if (!element) {
        return null
      }

      if (!element.isConnected) {
        activeScrollCaptureElementRef.current = null
        return null
      }

      return element
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
      const activeScrollCaptureElement = currentActiveScrollCaptureElement()

      if (scrollLockElement && elementsShareCaptureChain(scrollLockElement, activeScrollCaptureElement)) {
        const scrollableElement = scrollableElementFromTarget(target, container)

        if (scrollableElement && canScrollElementForDelta(scrollableElement, deltaX, deltaY)) {
          return {
            kind: 'element',
            element: scrollableElement
          }
        }

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

    function viewportCenterWorldPosition() {
      const bounds = visibleWorldBounds()

      if (!bounds) {
        return centerWorldPosition()
      }

      return {
        x: (bounds.left + bounds.right) / 2,
        y: (bounds.top + bounds.bottom) / 2
      }
    }

    function preferredTerminalFrame(preferredX: number, preferredY: number) {
      const viewportMargin = 24
      const bounds = visibleWorldBounds()
      const maxWidth = bounds
        ? Math.max(MIN_TILE_WIDTH, bounds.right - bounds.left - viewportMargin * 2)
        : DEFAULT_TERMINAL_WIDTH
      const maxHeight = bounds
        ? Math.max(MIN_TILE_HEIGHT, bounds.bottom - bounds.top - viewportMargin * 2)
        : DEFAULT_TERMINAL_HEIGHT
      const width = snap(Math.min(DEFAULT_TERMINAL_WIDTH, maxWidth))
      const height = snap(Math.min(DEFAULT_TERMINAL_HEIGHT, maxHeight))
      let x = preferredX
      let y = preferredY

      if (bounds) {
        const minX = bounds.left + viewportMargin
        const maxX = Math.max(minX, bounds.right - width - viewportMargin)
        const minY = bounds.top + viewportMargin
        const maxY = Math.max(minY, bounds.bottom - height - viewportMargin)

        x = clamp(x, minX, maxX)
        y = clamp(y, minY, maxY)
      }

      return {
        height,
        width,
        x: snap(x),
        y: snap(y)
      }
    }

    function createTerminalNearCenter(provider: TerminalProvider = 'claude') {
      const { x, y } = centerWorldPosition(stateRef.current.tiles.length % 4)
      const frame = preferredTerminalFrame(x, y)
      const tileId = `tile-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

      appendTile(
        {
          id: tileId,
          type: 'term',
          title: titleForTerminal(stateRef.current.tiles, provider),
          x: frame.x,
          y: frame.y,
          width: frame.width,
          height: frame.height,
          zIndex: nextZIndex(stateRef.current.tiles),
          sessionId: sessionId(),
          terminalNotifyOnComplete: false,
          terminalProvider: provider
        },
        { immediate: true }
      )
      setTileSelection([tileId])
    }

    function importDiagramSet(envelope: CanvasDiagramEnvelope) {
      const editor = editorRef.current

      if (!editor) {
        return
      }

      const { x, y } = centerWorldPosition(0)

      renderCanvasDiagramSet(editor, envelope, {
        centerX: x,
        centerY: y
      })
    }

    async function importExcalidrawContent(content: unknown, title = 'Imported Diagram') {
      const editor = editorRef.current

      if (!editor) {
        return
      }

      const existingShapeIds = new Set(editor.getCurrentPageShapeIds())
      const { x, y } = centerWorldPosition(0)
      await putExcalidrawContent(editor, content, { x, y })

      const importedShapeIds = Array.from(editor.getCurrentPageShapeIds()).filter(
        (shapeId) => !existingShapeIds.has(shapeId)
      )

      if (importedShapeIds.length === 0) {
        return
      }

      const importedBounds = importedShapeIds.reduce<{
        bottom: number
        left: number
        right: number
        top: number
      } | null>((bounds, shapeId) => {
        const shapeBounds = editor.getShapePageBounds(shapeId)

        if (!shapeBounds) {
          return bounds
        }

        if (!bounds) {
          return {
            left: shapeBounds.x,
            top: shapeBounds.y,
            right: shapeBounds.x + shapeBounds.w,
            bottom: shapeBounds.y + shapeBounds.h
          }
        }

        return {
          left: Math.min(bounds.left, shapeBounds.x),
          top: Math.min(bounds.top, shapeBounds.y),
          right: Math.max(bounds.right, shapeBounds.x + shapeBounds.w),
          bottom: Math.max(bounds.bottom, shapeBounds.y + shapeBounds.h)
        }
      }, null)

      if (!importedBounds) {
        return
      }

      const frameId = `shape:${Date.now()}-${Math.random().toString(36).slice(2, 8)}` as TLFrameShape['id']
      const frameInset = 40

      editor.createShapes([
        {
          id: frameId,
          type: 'frame',
          x: importedBounds.left - frameInset,
          y: importedBounds.top - frameInset - 24,
          props: {
            w: importedBounds.right - importedBounds.left + frameInset * 2,
            h: importedBounds.bottom - importedBounds.top + frameInset * 2 + 24,
            color: 'grey',
            name: title.trim() || 'Imported Diagram'
          }
        }
      ])
      editor.reparentShapes(importedShapeIds, frameId)
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
      setTileSelection([tile.id])
    }

    function spawnEmbedTile(url: string) {
      const { x, y } = centerWorldPosition(stateRef.current.tiles.length % 5)
      const tile = createEmbedTile(
        url,
        x - 280,
        y - 180,
        nextZIndex(stateRef.current.tiles)
      )

      if (!tile) {
        return
      }

      appendTile(tile, { immediate: true })
      setTileSelection([tile.id])
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
      setTileSelection([tile.id])
    }

    function focusSelectedTileEditor() {
      if (!containerRef.current || !selectedTileId || selectedTileIds.length !== 1) {
        return false
      }

      const tileRoot = containerRef.current.querySelector<HTMLElement>(
        `[data-tile-root="true"][data-tile-id="${CSS.escape(selectedTileId)}"]`
      )
      const documentEditTarget = tileRoot?.querySelector<HTMLElement>('[data-document-edit-target="true"]')

      if (!documentEditTarget) {
        return false
      }

      documentEditTarget.dispatchEvent(new Event('collaborator:focus-document-editor'))
      return true
    }

    function spawnEmbedTileAtClientPoint(url: string, clientX: number, clientY: number) {
      const point = pagePointFromClient(clientX, clientY)
      const tile = createEmbedTile(
        url,
        point.x,
        point.y,
        nextZIndex(stateRef.current.tiles)
      )

      if (!tile) {
        return
      }

      appendTile(tile, { immediate: true })
      setTileSelection([tile.id])
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
        editor.setStyleForNextShapes(DefaultSizeStyle, drawSize)
      } else if (nextTool === 'note') {
        editor.setStyleForNextShapes(DefaultColorStyle, STICKY_NOTE_COLOR)
        editor.setStyleForNextShapes(DefaultLabelColorStyle, STICKY_NOTE_TEXT_COLOR)
      } else if (nextTool === 'text') {
        editor.setStyleForNextShapes(DefaultColorStyle, darkMode ? 'white' : 'black')
      }

      editor.setCurrentTool(nextTool)
    }

    function applyDrawColor(nextColor: TLDefaultColorStyle) {
      drawColorRef.current = nextColor
      setDrawColor(nextColor)

      if (activeBoardTool === 'draw') {
        editorRef.current?.setStyleForNextShapes(DefaultColorStyle, nextColor)
      }
    }

    function applyDrawSize(nextSize: TLDefaultSizeStyle) {
      drawSizeRef.current = nextSize
      setDrawSize(nextSize)

      if (activeBoardTool === 'draw') {
        editorRef.current?.setStyleForNextShapes(DefaultSizeStyle, nextSize)
      }
    }

    function createEditableTextAtViewportCenter() {
      const editor = editorRef.current

      if (!editor) {
        setActiveBoardTool('text')
        return
      }

      const { x, y } = viewportCenterWorldPosition()
      const textShapeId = `shape:${Date.now()}-${Math.random().toString(36).slice(2, 8)}` as TLTextShape['id']
      const textColor: TLDefaultColorStyle = darkMode ? 'white' : 'black'

      editor.createShapes([
        {
          id: textShapeId,
          type: 'text',
          x,
          y,
          props: {
            autoSize: true,
            color: textColor,
            font: 'draw',
            richText: toRichText(''),
            scale: 1,
            size: 'm',
            textAlign: 'start',
            w: 8
          }
        }
      ])
      editor.select(textShapeId)
      editor.setCurrentTool('select')
      startEditingShapeWithRichText(editor, textShapeId, { selectAll: true })
      setActiveBoardTool('text')
    }

    function normalizeStickyNoteShapes(editor: Editor) {
      const noteShapeUpdates: NoteShapeUpdate[] = editor
        .getCurrentPageShapes()
        .flatMap((shape) => {
          if (shape.type !== 'note') {
            return []
          }

          const nextProps: Partial<TLNoteShape['props']> = {}

          if (shape.props.color !== STICKY_NOTE_COLOR) {
            nextProps.color = STICKY_NOTE_COLOR
          }

          if (shape.props.labelColor !== STICKY_NOTE_TEXT_COLOR) {
            nextProps.labelColor = STICKY_NOTE_TEXT_COLOR
          }

          if (Object.keys(nextProps).length === 0) {
            return []
          }

          return [
            {
              id: shape.id,
              type: 'note',
              props: nextProps
            }
          ]
        })

      if (noteShapeUpdates.length > 0) {
        editor.updateShapes(noteShapeUpdates)
      }
    }

    function runShortcutAction(action: ShortcutAction) {
      if (action === 'terminal-claude') {
        createTerminalNearCenter('claude')
        return
      }

      if (action === 'terminal-codex') {
        createTerminalNearCenter('codex')
        return
      }

      if (action === 'markdown') {
        onCreateMarkdownNote()
        return
      }

      if (action === 'text') {
        clearTileSelection()

        if (!startEditingSelectedRichTextShape({ selectAll: true })) {
          createEditableTextAtViewportCenter()
        }
        return
      }

      clearTileSelection()
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
        setTileSelection([replacementTile.id])
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
      editor.setStyleForNextShapes(DefaultSizeStyle, drawSize)
      applyBoardTool('hand')
      normalizeStickyNoteShapes(editor)
      frameBoundsRef.current = frameBoundsSnapshot(editor)
      setSelectedCanvasNoteId(selectedStickyNoteFromEditor(editor)?.shape.id ?? null)
      onBoardReady?.()

      const handleCreatedShapes = (records: TLRecord[]) => {
        const nextColor = drawColorRef.current
        const nextSize = drawSizeRef.current
        let nextGeneratedGroupNumber: number | null = null
        const drawShapeUpdates: DrawShapeUpdate[] = records.flatMap((record) => {
          if (record.typeName !== 'shape' || record.type !== 'draw') {
            return []
          }

          const nextProps: Partial<TLDrawShape['props']> = {}

          if (record.props.color !== nextColor) {
            nextProps.color = nextColor
          }

          if (record.props.size !== nextSize) {
            nextProps.size = nextSize
          }

          if (Object.keys(nextProps).length === 0) {
            return []
          }

          return [
            {
              id: record.id,
              type: 'draw',
              props: nextProps
            }
          ]
        })
        const noteShapeUpdates: NoteShapeUpdate[] = records.flatMap((record) => {
          if (record.typeName !== 'shape' || record.type !== 'note') {
            return []
          }

          const nextProps: Partial<TLNoteShape['props']> = {}

          if (record.props.color !== STICKY_NOTE_COLOR) {
            nextProps.color = STICKY_NOTE_COLOR
          }

          if (record.props.labelColor !== STICKY_NOTE_TEXT_COLOR) {
            nextProps.labelColor = STICKY_NOTE_TEXT_COLOR
          }

          if (Object.keys(nextProps).length === 0) {
            return []
          }

          return [
            {
              id: record.id,
              type: 'note',
              props: nextProps
            }
          ]
        })
        const frameShapeUpdates: FrameShapeUpdate[] = records.flatMap((record) => {
          if (record.typeName !== 'shape' || record.type !== 'frame') {
            return []
          }

          if (record.props.name.trim().length > 0) {
            return []
          }

          return [
            {
              id: record.id,
              type: 'frame',
              props: {
                color: 'grey',
                name: (() => {
                  if (nextGeneratedGroupNumber === null) {
                    const match = /(\d+)$/.exec(nextGroupFrameLabel(editor))
                    nextGeneratedGroupNumber = match ? Number.parseInt(match[1] ?? '1', 10) : 1
                  }

                  const label = `Group ${nextGeneratedGroupNumber}`
                  nextGeneratedGroupNumber += 1

                  return label
                })()
              }
            }
          ]
        })

        if (drawShapeUpdates.length > 0) {
          editor.updateShapes(drawShapeUpdates)
        }

        if (noteShapeUpdates.length > 0) {
          editor.updateShapes(noteShapeUpdates)
        }

        if (frameShapeUpdates.length > 0) {
          editor.updateShapes(frameShapeUpdates)
        }
      }

      editor.on('created-shapes', handleCreatedShapes)

      const detachStoreListener = editor.store.listen(
        () => {
          const resolvedBoardTool = boardToolFromEditorToolId(editor.getCurrentToolId())

          if (resolvedBoardTool) {
            setActiveBoardTool((current) =>
              current === resolvedBoardTool ? current : resolvedBoardTool
            )
          }

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
          const nextFrameBounds = frameBoundsSnapshot(editor)
          const movedFrames = Array.from(nextFrameBounds.entries())
            .flatMap(([frameId, bounds]) => {
              const previousBounds = frameBoundsRef.current.get(frameId)

              if (!previousBounds) {
                return []
              }

              const deltaX = bounds.x - previousBounds.x
              const deltaY = bounds.y - previousBounds.y

              if (
                Math.abs(deltaX) <= FRAME_MOVE_EPSILON &&
                Math.abs(deltaY) <= FRAME_MOVE_EPSILON
              ) {
                return []
              }

              return [
                {
                  area: previousBounds.width * previousBounds.height,
                  deltaX,
                  deltaY,
                  previousBounds
                }
              ]
            })
            .sort((left, right) => right.area - left.area)
          const movedTileOffsets = new Map<string, { deltaX: number; deltaY: number }>()

          for (const movedFrame of movedFrames) {
            stateRef.current.tiles.forEach((tile) => {
              if (movedTileOffsets.has(tile.id)) {
                return
              }

              if (!tileCenterWithinBounds(tile, movedFrame.previousBounds)) {
                return
              }

              movedTileOffsets.set(tile.id, {
                deltaX: movedFrame.deltaX,
                deltaY: movedFrame.deltaY
              })
            })
          }

          const nextTiles =
            movedTileOffsets.size > 0
              ? stateRef.current.tiles.map((tile) => {
                  const offset = movedTileOffsets.get(tile.id)

                  if (!offset) {
                    return tile
                  }

                  return {
                    ...tile,
                    x: tile.x + offset.deltaX,
                    y: tile.y + offset.deltaY
                  }
                })
              : stateRef.current.tiles
          const nextBoardSnapshot = editor.getSnapshot()

          frameBoundsRef.current = nextFrameBounds

          updateState({
            ...stateRef.current,
            boardSnapshot: nextBoardSnapshot,
            tiles: nextTiles
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
        frameBoundsRef.current.clear()
        setSelectedCanvasNoteId(null)

        if (editorRef.current === editor) {
          editorRef.current = null
        }
      }
    }

    useImperativeHandle(ref, () => ({
      createTerminal: (provider = 'claude') => {
        createTerminalNearCenter(provider)
      },
      focusCanvas: () => {
        canvasActiveRef.current = true
        containerRef.current?.focus()
        editorRef.current?.focus()
      },
      focusSelectedTileEditor: () => {
        return focusSelectedTileEditor()
      },
      importDiagramSet: (envelope: CanvasDiagramEnvelope) => {
        importDiagramSet(envelope)
      },
      importExcalidrawContent: async (content: unknown, title?: string) => {
        await importExcalidrawContent(content, title)
      },
      spawnEmbedTile: (url: string) => {
        spawnEmbedTile(url)
      },
      spawnFileTile: (file: FileTreeNode) => {
        spawnFileTile(file)
      },
      spawnFileTileAtPoint: (file: FileTreeNode, clientX: number, clientY: number) => {
        spawnFileTileAtClientPoint(file, clientX, clientY)
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
      if (activeBoardTool !== 'draw') {
        return
      }

      editorRef.current?.setStyleForNextShapes(DefaultColorStyle, drawColor)
    }, [activeBoardTool, drawColor])

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
      const existingTileIdSet = new Set(state.tiles.map((tile) => tile.id))
      const nextSelectedTileIds = selectedTileIds.filter((tileId) => existingTileIdSet.has(tileId))

      if (!sameTileIdList(selectedTileIds, nextSelectedTileIds)) {
        setSelectedTileIds(nextSelectedTileIds)
      }

      const nextPrimaryTileId =
        selectedTileId && nextSelectedTileIds.includes(selectedTileId)
          ? selectedTileId
          : nextSelectedTileIds.length === 1
            ? nextSelectedTileIds[0]
            : null

      if (selectedTileId !== nextPrimaryTileId) {
        setSelectedTileId(nextPrimaryTileId)
      }

      if (hoveredTileId && !existingTileIdSet.has(hoveredTileId)) {
        setHoveredTileId(null)
      }
    }, [hoveredTileId, selectedTileId, selectedTileIds, state.tiles])

    useEffect(() => {
      if (activeBoardTool !== 'draw') {
        return
      }

      editorRef.current?.setStyleForNextShapes(DefaultSizeStyle, drawSize)
    }, [activeBoardTool, drawSize])

    useEffect(() => {
      if (!darkMode && drawColor === 'white') {
        applyDrawColor('black')
      }
    }, [darkMode, drawColor])

    useEffect(() => {
      function shouldPreferResolvedWheelOwner(
        activeOwner: WheelGestureOwner | null,
        resolvedOwner: WheelGestureOwner
      ) {
        if (!activeOwner) {
          return true
        }

        if (resolvedOwner.kind === 'board') {
          return true
        }

        if (activeOwner.kind === 'board') {
          return false
        }

        return activeOwner.element !== resolvedOwner.element
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
        const normalizedDeltaX = normalizeWheelDelta(event.deltaX, event.deltaMode)
        const normalizedDeltaY = normalizeWheelDelta(event.deltaY, event.deltaMode)

        if (!event.ctrlKey && !event.metaKey) {
          if (nativeWheelElement) {
            // Inside a native-wheel region (terminal, document pane, etc.).
            // Let the event propagate so the component's own handlers process
            // it — e.g. xterm mouse tracking in alt-screen mode, xterm
            // viewport scroll in normal mode, or native overflow scroll in
            // document viewers. Never fall through to canvas panning.
            clearWheelGestureOwner()
            return
          }

          if (!targetInsideCanvas && !activeWheelOwner) {
            return
          }

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
        const container = containerRef.current
        const targetNode = event.target as Node | null
        const targetInsideCanvas = Boolean(container && targetNode && container.contains(targetNode))

        lastPointerScrollActivationAtRef.current = targetInsideCanvas ? Date.now() : 0
        activeScrollCaptureElementRef.current =
          container && targetInsideCanvas ? wheelCaptureElementFromTarget(event.target, container) : null
        syncBoardKeyboardFocus(event.target)
      }

      function handleFocusIn(event: FocusEvent) {
        const container = containerRef.current
        const targetNode = event.target as Node | null
        const targetInsideCanvas = Boolean(container && targetNode && container.contains(targetNode))

        if (
          container &&
          targetInsideCanvas &&
          Date.now() - lastPointerScrollActivationAtRef.current <= POINTER_SCROLL_ACTIVATION_WINDOW_MS
        ) {
          activeScrollCaptureElementRef.current = wheelCaptureElementFromTarget(event.target, container)
        }

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
          if (dragConnectionRef.current || linkSourceTileId) {
            event.preventDefault()
            event.stopPropagation()
            setLinkSourceTileId(null)
            setActiveDragConnection(null)
            return
          }

          if (focusedTerminal) {
            event.preventDefault()
            setFocusedTerminal(null)
            return
          }

          if (selectedTileIds.length > 0) {
            event.preventDefault()
            event.stopPropagation()
            clearTileSelection()
          }

          return
        }

        if (event.key === 'Backspace' || event.key === 'Delete') {
          const selectedShapeIds = editorRef.current?.getSelectedShapeIds() ?? []

          if (selectedTileIds.length > 0) {
            event.preventDefault()
            event.stopPropagation()
            deleteTiles(selectedTileIds)
            return
          }

          if (selectedShapeIds.length > 0 && editorRef.current) {
            event.preventDefault()
            event.stopPropagation()
            editorRef.current.deleteShapes(selectedShapeIds)
          }

          return
        }

        if (event.key === 'Enter' && !event.shiftKey) {
          if (focusSelectedTileEditor()) {
            event.preventDefault()
            event.stopPropagation()
            return
          }

          if (startEditingSelectedRichTextShape()) {
            event.preventDefault()
            event.stopPropagation()
          }
          return
        }

        if (lowerKey === 't' && event.shiftKey) {
          event.preventDefault()
          event.stopPropagation()
          runShortcutAction('terminal-claude')
          return
        }

        if (lowerKey === 'c' && event.shiftKey) {
          event.preventDefault()
          event.stopPropagation()
          runShortcutAction('terminal-codex')
          return
        }

        if (lowerKey === 'l' && selectedTileId && selectedTileIds.length === 1) {
          const selectedTile = tileById(selectedTileId)

          if (isContextSourceTile(selectedTile)) {
            event.preventDefault()
            event.stopPropagation()
            toggleLinkMode(selectedTileId)
            return
          }
        }

        if (!nextTool) {
          return
        }

        event.preventDefault()
        event.stopPropagation()
        runShortcutAction(nextTool)
      }

      window.addEventListener('pointerdown', handlePointerContext, true)
      window.addEventListener('focusin', handleFocusIn, true)
      window.addEventListener('keydown', handleKeyDown, true)

      return () => {
        window.removeEventListener('pointerdown', handlePointerContext, true)
        window.removeEventListener('focusin', handleFocusIn, true)
        window.removeEventListener('keydown', handleKeyDown, true)
      }
    }, [focusedTerminal, linkSourceTileId, selectedTileId, selectedTileIds, shortcutsSuspended])

    useEffect(() => {
      function cancelActiveCanvasInteraction() {
        if (dragConnectionRef.current) {
          setLinkSourceTileId(null)
          setActiveDragConnection(null)
        }

        interactionRef.current = null
        setTileSelectionBox(null)
      }

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

        if (interaction.type === 'tile-select') {
          const point = pagePointFromClient(event.clientX, event.clientY)
          const nextSelectionBox = {
            startX: interaction.startX,
            startY: interaction.startY,
            currentX: point.x,
            currentY: point.y
          }

          setTileSelectionBox(nextSelectionBox)
          setTileSelection(tileIdsForSelectionBox(nextSelectionBox))
          return
        }

        const deltaX = (event.clientX - interaction.startClientX) / stateRef.current.viewport.zoom
        const deltaY = (event.clientY - interaction.startClientY) / stateRef.current.viewport.zoom

        if (interaction.type === 'drag') {
          updateState({
            ...stateRef.current,
            tiles: stateRef.current.tiles.map((tile) =>
              interaction.tileStarts.some((start) => start.id === tile.id)
                ? (() => {
                    const start = interaction.tileStarts.find((candidate) => candidate.id === tile.id) as {
                      id: string
                      x: number
                      y: number
                    }

                    return {
                      ...tile,
                      x: start.x + deltaX,
                      y: start.y + deltaY
                    }
                  })()
                : tile
            )
          })
          return
        }

        if (interaction.type === 'frame-drag') {
          moveFrameBundle(interaction, deltaX, deltaY)
          return
        }

        updateState({
          ...stateRef.current,
          tiles: stateRef.current.tiles.map((tile) => {
            if (tile.id !== interaction.tileId) {
              return tile
            }

            const minWidth = minTileWidthForTile(tile)
            const minHeight = minTileHeightForTile(tile)
            let nextX = interaction.startX
            let nextY = interaction.startY
            let nextWidth = interaction.startWidth
            let nextHeight = interaction.startHeight

            if (interaction.handle.includes('e')) {
              nextWidth = Math.max(minWidth, interaction.startWidth + deltaX)
            }

            if (interaction.handle.includes('s')) {
              nextHeight = Math.max(minHeight, interaction.startHeight + deltaY)
            }

            if (interaction.handle.includes('w')) {
              const width = Math.max(minWidth, interaction.startWidth - deltaX)
              nextX = interaction.startX + (interaction.startWidth - width)
              nextWidth = width
            }

            if (interaction.handle.includes('n')) {
              const height = Math.max(minHeight, interaction.startHeight - deltaY)
              nextY = interaction.startY + (interaction.startHeight - height)
              nextHeight = height
            }

            const nextNoteSizeMode =
              tile.type === 'note'
                ? tile.noteSizeMode === 'manual' ||
                  nextWidth < interaction.startWidth - 2 ||
                  nextHeight < interaction.startHeight - 2
                  ? 'manual'
                  : 'auto'
                : undefined

            return {
              ...tile,
              x: nextX,
              y: nextY,
              width: nextWidth,
              height: nextHeight,
              noteSizeMode: nextNoteSizeMode
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

        if (interaction.type === 'frame-drag') {
          const deltaX = (event.clientX - interaction.startClientX) / stateRef.current.viewport.zoom
          const deltaY = (event.clientY - interaction.startClientY) / stateRef.current.viewport.zoom

          moveFrameBundle(interaction, deltaX, deltaY, {
            immediate: true,
            snapToGrid: true
          })
          return
        }

        if (interaction.type === 'tile-select') {
          setTileSelectionBox(null)
          return
        }

        if (interaction.type === 'drag') {
          const draggedTileIds = interaction.tileStarts.map((tile) => tile.id)

          updateState(
            {
              ...stateRef.current,
              tiles: stateRef.current.tiles.map((tile) =>
                draggedTileIds.includes(tile.id)
                  ? {
                      ...tile,
                      x: snap(tile.x),
                      y: snap(tile.y)
                    }
                  : tile
              )
            },
            {
              immediate: true
            }
          )
          expandGroupsForTileIds(draggedTileIds)
          return
        }

        if (interaction.type === 'resize') {
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
          expandGroupsForTileIds([interaction.tileId])
        }
      }

      function handlePointerCancel() {
        cancelActiveCanvasInteraction()
      }

      function handleWindowBlur() {
        cancelActiveCanvasInteraction()
      }

      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp)
      window.addEventListener('pointercancel', handlePointerCancel)
      window.addEventListener('blur', handleWindowBlur)

      return () => {
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
        window.removeEventListener('pointercancel', handlePointerCancel)
        window.removeEventListener('blur', handleWindowBlur)
      }
    }, [onStateChange])

    function beginTileDrag(tile: CanvasTile, event: ReactPointerEvent<HTMLDivElement>) {
      const draggedTileIds =
        selectedTileIds.includes(tile.id) && selectedTileIds.length > 1 ? selectedTileIds : [tile.id]

      bringTilesToFront(draggedTileIds)
      interactionRef.current = {
        type: 'drag',
        startClientX: event.clientX,
        startClientY: event.clientY,
        tileStarts: stateRef.current.tiles
          .filter((candidate) => draggedTileIds.includes(candidate.id))
          .map((candidate) => ({
            id: candidate.id,
            x: candidate.x,
            y: candidate.y
          }))
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

    function deleteTiles(tileIds: string[]) {
      const normalizedTileIds = normalizedSelectedTileIds(tileIds)

      if (normalizedTileIds.length === 0) {
        return
      }

      const deletedTileIdSet = new Set(normalizedTileIds)

      updateState(
        {
          ...stateRef.current,
          tiles: stateRef.current.tiles
            .filter((tile) => !deletedTileIdSet.has(tile.id))
            .map((tile) =>
              tile.type === 'term'
                ? {
                    ...tile,
                    contextTileIds: (tile.contextTileIds ?? []).filter(
                      (contextTileId) => !deletedTileIdSet.has(contextTileId)
                    )
                  }
                : tile
            )
        },
        { immediate: true }
      )

      clearTileSelection()

      if (linkSourceTileId && deletedTileIdSet.has(linkSourceTileId)) {
        setLinkSourceTileId(null)
      }

      if (
        dragConnectionRef.current?.sourceKind === 'tile' &&
        deletedTileIdSet.has(dragConnectionRef.current.sourceTileId)
      ) {
        setActiveDragConnection(null)
      }

      setTileRefreshTokens((current) => {
        if (!normalizedTileIds.some((tileId) => tileId in current)) {
          return current
        }

        const next = { ...current }
        normalizedTileIds.forEach((tileId) => {
          delete next[tileId]
        })
        return next
      })

      setHoveredConnection((current) =>
        current &&
        (deletedTileIdSet.has(current.terminalTileId) ||
          (current.sourceKind === 'tile' && deletedTileIdSet.has(current.sourceTileId)))
          ? null
          : current
      )

      setHoveredTileId((current) => (current && deletedTileIdSet.has(current) ? null : current))
    }

    function deleteTile(tileId: string) {
      deleteTiles([tileId])
    }

    function createTerminalAt(clientX: number, clientY: number, provider: TerminalProvider = 'claude') {
      const point = pagePointFromClient(clientX, clientY)
      const frame = preferredTerminalFrame(
        point.x - DEFAULT_TERMINAL_WIDTH / 2,
        point.y - DEFAULT_TERMINAL_HEIGHT / 2
      )
      const tileId = `tile-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

      appendTile(
        {
          id: tileId,
          type: 'term',
          title: titleForTerminal(stateRef.current.tiles, provider),
          x: frame.x,
          y: frame.y,
          width: frame.width,
          height: frame.height,
          zIndex: nextZIndex(stateRef.current.tiles),
          sessionId: sessionId(),
          terminalNotifyOnComplete: false,
          terminalProvider: provider
        },
        { immediate: true }
      )
      setTileSelection([tileId])
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

      if (hasCollaboratorTerminalCardPayload(event.dataTransfer)) {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
        return
      }

      if (extractDroppedUrl(event.dataTransfer)) {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
        return
      }

      if (!activeWorkspacePath || !hasExternalPathPayload(event.dataTransfer)) {
        if (!activeWorkspacePath || droppedImportableAssetFiles(event.dataTransfer).length === 0) {
          return
        }

        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
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
        setTileSelection([tile.id])
        return
      }

      if (hasCollaboratorTerminalCardPayload(event.dataTransfer)) {
        event.preventDefault()
        event.stopPropagation()
        const payload = event.dataTransfer.getData(COLLABORATOR_TERMINAL_CARD_MIME)

        if (!payload) {
          return
        }

        const parsed = JSON.parse(payload) as TerminalCardTransferPayload
        const dropClientX = event.clientX
        const dropClientY = event.clientY

        void (async () => {
          const createdNode = await onCreateMarkdownCard({
            baseName: parsed.baseName,
            initialContent: parsed.content,
            targetDirectoryPath: parsed.targetDirectoryPath
          })

          if (!createdNode) {
            return
          }

          const point = pagePointFromClient(dropClientX, dropClientY)
          const tile = createTileFromFile(
            {
              fileKind: 'note',
              name: createdNode.name,
              path: createdNode.path
            },
            point.x,
            point.y,
            nextZIndex(stateRef.current.tiles)
          )

          appendTile(tile, { immediate: true })
          setTileSelection([tile.id])
        })()
        return
      }

      const droppedUrl = extractDroppedUrl(event.dataTransfer)

      if (droppedUrl) {
        event.preventDefault()
        event.stopPropagation()
        spawnEmbedTileAtClientPoint(droppedUrl.canonicalUrl, event.clientX, event.clientY)
        return
      }

      if (!activeWorkspacePath) {
        return
      }

      const externalPaths = externalPathsFromDataTransfer(event.dataTransfer)
      const externalDownload = externalDownloadFromDataTransfer(event.dataTransfer)

      if (externalPaths.length > 0 || externalDownload) {
        event.preventDefault()
        event.stopPropagation()

        const dropClientX = event.clientX
        const dropClientY = event.clientY

        void (async () => {
          const importedNodes =
            externalPaths.length > 0
              ? await onImportExternalPaths(
                  externalPaths,
                  importTargetDirectoryPath ?? activeWorkspacePath
                )
              : (() => {
                  return externalDownload
                    ? onImportExternalDownload(
                        externalDownload,
                        importTargetDirectoryPath ?? activeWorkspacePath
                      ).then((importedNode) => (importedNode ? [importedNode] : []))
                    : Promise.resolve([])
                })()
          const importedFiles = collectRenderableImportedFiles(await importedNodes)

          for (const [index, importedNode] of importedFiles.entries()) {
            const staggerOffset = index * 28

            spawnFileTileAtClientPoint(
              importedNode,
              dropClientX + staggerOffset,
              dropClientY + staggerOffset
            )
          }
        })()
        return
      }

      if (!activeWorkspacePath || droppedImportableAssetFiles(event.dataTransfer).length === 0) {
        return
      }

      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
      const assetFiles = droppedImportableAssetFiles(event.dataTransfer)

      if (assetFiles.length === 0) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      const dropClientX = event.clientX
      const dropClientY = event.clientY

      void (async () => {
        for (const [index, assetFile] of assetFiles.entries()) {
          const importedNode = await onImportAssetFile(assetFile)

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
    const frameBundleShells = frameBundleVisuals()
    const frameGroups = frameContextGroups()
    const zoomLabel = `${Math.round(state.viewport.zoom * 100)}%`
    const canZoomIn = state.viewport.zoom < MAX_ZOOM - CAMERA_EPSILON
    const canZoomOut = state.viewport.zoom > MIN_ZOOM + CAMERA_EPSILON
    const drawTheme = darkMode ? DefaultColorThemePalette.darkMode : DefaultColorThemePalette.lightMode
    const visibleDrawColorItems = DRAW_COLOR_ITEMS.filter((item) => darkMode || !item.hideInLightMode)
    const activeDrawColorItem =
      visibleDrawColorItems.find((item) => item.color === drawColor) ?? visibleDrawColorItems[0] ?? null
    const activeDrawColorLabel = activeDrawColorItem
      ? drawColorLabel(activeDrawColorItem, darkMode)
      : 'Ink'
    const activeDrawSizeItem =
      DRAW_SIZE_ITEMS.find((item) => item.size === drawSize) ?? DRAW_SIZE_ITEMS[1] ?? null
    const activeDrawSizeLabel = activeDrawSizeItem?.label ?? 'Medium'
    const terminalConnections = state.tiles.flatMap((terminalTile) => {
      if (terminalTile.type !== 'term') {
        return []
      }

      return [
        ...contextGroupsForTerminal(terminalTile).map((sourceGroup) => ({
          sourceGroup,
          sourceKind: 'group' as const,
          terminalTile
        })),
        ...contextTilesForTerminal(terminalTile).map((sourceTile) => ({
          sourceKind: 'tile' as const,
          sourceTile,
          terminalTile
        }))
      ]
    })
    const hoveredConnectionKey = hoveredConnection
      ? hoveredConnection.sourceKind === 'group'
        ? `group:${hoveredConnection.sourceGroupId}:${hoveredConnection.terminalTileId}`
        : terminalConnectionKey(hoveredConnection.sourceTileId, hoveredConnection.terminalTileId)
      : null
    const hoveredConnectionSourceTile =
      hoveredConnection?.sourceKind === 'tile' ? tileById(hoveredConnection.sourceTileId) : null
    const hoveredConnectionSourceGroup =
      hoveredConnection?.sourceKind === 'group'
        ? frameGroups.find((group) => group.id === hoveredConnection.sourceGroupId) ?? null
        : null
    const hoveredConnectionTerminalTile = hoveredConnection ? tileById(hoveredConnection.terminalTileId) : null
    const selectedTileIdSet = new Set(selectedTileIds)
    const multiSelectedTiles = selectedTileIds.length > 1
    const activeTileSelectionBounds = tileSelectionBox ? selectionBoxBounds(tileSelectionBox) : null

    return (
      <div
        ref={containerRef}
        data-canvas-surface="true"
        tabIndex={0}
        className={clsx(
          'canvas-surface relative h-full overflow-hidden bg-[var(--canvas-bg)] touch-none outline-none [overscroll-behavior:none]'
        )}
        onPointerDownCapture={(event) => {
          const target = event.target as HTMLElement

          if (target.closest('[data-tile-root="true"]') || target.closest('[data-canvas-ui="true"]')) {
            return
          }

          if (activeBoardTool === 'select' && isTileSelectionBackgroundTarget(target)) {
            beginTileSelection(event)
            return
          }

          clearTileSelection()
        }}
        onDoubleClick={(event: ReactMouseEvent<HTMLDivElement>) => {
          const target = event.target as HTMLElement

          if (target.closest('[data-tile-root="true"]') || target.closest('[data-canvas-ui="true"]')) {
            return
          }

          if (startEditingSelectedRichTextShape({ selectAll: true })) {
            event.preventDefault()
            event.stopPropagation()
            return
          }

          if (activeBoardTool !== 'hand') {
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
          <div className="flex min-h-10 w-10 max-w-[calc(100vw-1.5rem)] origin-top-right items-start overflow-hidden rounded-[var(--radius-surface)] border border-[color:var(--line)] bg-[color:var(--surface-overlay)] shadow-[0_10px_22px_rgba(15,23,42,0.12)] backdrop-blur transition-[width,max-height,border-radius] duration-200 ease-out max-h-10 group-hover:w-[28rem] group-hover:max-h-[26rem] group-hover:rounded-[var(--radius-surface)] group-focus-within:w-[28rem] group-focus-within:max-h-[26rem] group-focus-within:rounded-[var(--radius-surface)]">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center self-start text-[13px] font-semibold tracking-[0.2em] text-[var(--text-dim)]">
              ?
            </div>
            <div className="min-w-0 flex-1 self-stretch overflow-y-auto pr-3 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
              <div className="pt-2.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-faint)]">
                Shortcut Guide
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {APP_SHORTCUT_ITEMS.map((shortcut) => (
                  <div
                    key={shortcut.label}
                    className="flex min-h-[2.75rem] items-center justify-between gap-3 rounded-[var(--radius-control)] border border-[color:var(--line)] bg-[var(--surface-0)] px-3 py-2 text-left"
                  >
                    <span className="min-w-0 flex-1 whitespace-normal text-[11px] font-semibold uppercase leading-[1.35] tracking-[0.08em] text-[var(--text-dim)]">
                      {shortcut.label}
                    </span>
                    <span className="shrink-0 rounded-[var(--radius-control)] border border-[color:var(--line)] bg-[var(--surface-1)] px-2 py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--text-faint)]">
                      {shortcut.key}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-faint)]">
                Navigator
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {NAVIGATOR_SHORTCUT_ITEMS.map((shortcut) => (
                  <div
                    key={shortcut.label}
                    className="flex min-h-[2.75rem] items-center justify-between gap-3 rounded-[var(--radius-control)] border border-[color:var(--line)] bg-[var(--surface-0)] px-3 py-2 text-left"
                  >
                    <span className="min-w-0 flex-1 whitespace-normal text-[11px] font-semibold uppercase leading-[1.35] tracking-[0.08em] text-[var(--text-dim)]">
                      {shortcut.label}
                    </span>
                    <span className="shrink-0 rounded-[var(--radius-control)] border border-[color:var(--line)] bg-[var(--surface-1)] px-2 py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--text-faint)]">
                      {shortcut.key}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-faint)]">
                Preview
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {PREVIEW_SHORTCUT_ITEMS.map((shortcut) => (
                  <div
                    key={shortcut.label}
                    className="flex min-h-[2.75rem] items-center justify-between gap-3 rounded-[var(--radius-control)] border border-[color:var(--line)] bg-[var(--surface-0)] px-3 py-2 text-left"
                  >
                    <span className="min-w-0 flex-1 whitespace-normal text-[11px] font-semibold uppercase leading-[1.35] tracking-[0.08em] text-[var(--text-dim)]">
                      {shortcut.label}
                    </span>
                    <span className="shrink-0 rounded-[var(--radius-control)] border border-[color:var(--line)] bg-[var(--surface-1)] px-2 py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--text-faint)]">
                      {shortcut.key}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-faint)]">
                Canvas Tools
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
                        'flex min-h-[2.75rem] items-center justify-between gap-3 rounded-[var(--radius-control)] border px-3 py-2 text-left transition',
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
                          'shrink-0 rounded-[var(--radius-control)] border px-2 py-1 text-[10px] font-medium uppercase tracking-[0.12em]',
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
                  <span className="font-semibold text-[var(--text)]">Paste media or link:</span> press{' '}
                  <span className="font-[var(--font-mono)] text-[10px] tracking-[0.04em] text-[var(--text)]">
                    {PASTE_IMAGE_SHORTCUT_KEY}
                  </span>{' '}
                  with an image or a supported URL, or drop Finder files, folders, images, videos,
                  PDFs, spreadsheets, presentations, or URLs onto the canvas. External imports are saved in the
                  selected folder when possible, otherwise in{' '}
                  <span className="font-[var(--font-mono)] text-[10px] tracking-[0.04em] text-[var(--text)]">
                    the workspace root
                  </span>{' '}
                  . Clipboard/media imports still use{' '}
                  <span className="font-[var(--font-mono)] text-[10px] tracking-[0.04em] text-[var(--text)]">
                    .claude-canvas/assets
                  </span>{' '}
                  inside the active workspace.
                </div>
                <div>
                  <span className="font-semibold text-[var(--text)]">Send to a terminal:</span>{' '}
                  drag a file, image, video, PDF, spreadsheet, presentation, or frame bundle dot onto a terminal dot.
                </div>
                <div>
                  <span className="font-semibold text-[var(--text)]">Remove selected tile:</span> press{' '}
                  <span className="font-[var(--font-mono)] text-[10px] tracking-[0.04em] text-[var(--text)]">
                    Backspace
                  </span>{' '}
                  or{' '}
                  <span className="font-[var(--font-mono)] text-[10px] tracking-[0.04em] text-[var(--text)]">
                    Delete
                  </span>
                  .
                </div>
                <div>
                  <span className="font-semibold text-[var(--text)]">Edit selected note or code tile:</span>{' '}
                  press{' '}
                  <span className="font-[var(--font-mono)] text-[10px] tracking-[0.04em] text-[var(--text)]">
                    Enter
                  </span>{' '}
                  to jump into the file and start typing.
                </div>
                <div>
                  <span className="font-semibold text-[var(--text)]">Group bundle:</span> press{' '}
                  <span className="font-[var(--font-mono)] text-[10px] tracking-[0.04em] text-[var(--text)]">
                    G
                  </span>{' '}
                  or{' '}
                  <span className="font-[var(--font-mono)] text-[10px] tracking-[0.04em] text-[var(--text)]">
                    Shift+G
                  </span>{' '}
                  to draw a group, drop files inside it, then drag the blue handle into Claude.
                </div>
              </div>
            </div>
          </div>
        </div>

        {linkSourceTile ? (
          <div className="pointer-events-none absolute left-3 top-3 z-[210] rounded-[var(--radius-control)] border border-[color:var(--line)] bg-[color:var(--surface-overlay)] px-3 py-1.5 text-[11px] font-medium tracking-[0.12em] text-[var(--text-dim)] backdrop-blur">
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
          {activeTileSelectionBounds ? (
            <div
              className="absolute rounded-[10px] border border-[color:rgba(100,181,246,0.72)] bg-[color:rgba(100,181,246,0.12)] shadow-[0_0_0_1px_rgba(100,181,246,0.18)]"
              style={{
                left: activeTileSelectionBounds.left,
                top: activeTileSelectionBounds.top,
                width: Math.max(1, activeTileSelectionBounds.right - activeTileSelectionBounds.left),
                height: Math.max(1, activeTileSelectionBounds.bottom - activeTileSelectionBounds.top)
              }}
            />
          ) : null}

          <svg className="absolute inset-0 h-full w-full" style={{ overflow: 'visible' }}>
            {terminalConnections.map((connection) => {
              const start =
                connection.sourceKind === 'group'
                  ? connectorCenterForGroup(connection.sourceGroup)
                  : connectorCenterForTile(connection.sourceTile)
              const connectionKey =
                connection.sourceKind === 'group'
                  ? `group:${connection.sourceGroup.id}:${connection.terminalTile.id}`
                  : terminalConnectionKey(connection.sourceTile.id, connection.terminalTile.id)
              const isHoveredConnection =
                connection.sourceKind === 'tile' && hoveredConnectionKey === connectionKey
              const end = connectorCenterForTile(connection.terminalTile)
              const { path } = connectionCurve(start, end)
              const startX = start.x
              const startY = start.y
              const endX = end.x
              const endY = end.y

              if (connection.sourceKind === 'group') {
                return (
                  <g key={connectionKey}>
                    <path
                      d={path}
                      fill="none"
                      stroke="transparent"
                      strokeLinecap="round"
                      strokeWidth={14}
                      pointerEvents="stroke"
                      className="pointer-events-auto"
                      data-terminal-connection-key={connectionKey}
                      onPointerEnter={() =>
                        showHoveredGroupConnection(connection.sourceGroup, connection.terminalTile)
                      }
                      onPointerLeave={(event) =>
                        clearHoveredConnection(connectionKey, event.relatedTarget)
                      }
                    />
                    <path
                      d={path}
                      fill="none"
                      stroke="var(--link-line)"
                      strokeDasharray="10 6"
                      strokeLinecap="round"
                      strokeOpacity={0.92}
                      strokeWidth={2.25}
                    />
                    <circle cx={startX} cy={startY} fill="var(--link-line)" r={4.5} />
                    <circle cx={endX} cy={endY} fill="var(--link-line)" r={4} />
                  </g>
                )
              }

              const sourceTile = connection.sourceTile
              const terminalTile = connection.terminalTile

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
                      onPointerEnter={() => showHoveredTileConnection(sourceTile, terminalTile)}
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

          {frameBundleShells.map((group) => (
            <div
              key={`bundle-shell:${group.id}`}
              className="pointer-events-none absolute overflow-hidden rounded-[var(--radius-surface)] border border-[color:var(--line-strong)] bg-[color:color-mix(in_srgb,var(--surface-1)_90%,transparent)] shadow-[0_10px_22px_rgba(15,23,42,0.18)] transition"
              style={{
                left: group.x,
                top: group.y,
                width: group.width,
                height: group.height
              }}
            >
              <div className="flex h-8 items-center justify-between border-b border-[color:var(--line)] bg-[color:color-mix(in_srgb,var(--surface-2)_78%,var(--accent-soft))] px-3 text-[11px] font-semibold text-[var(--text)]">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-[3px] bg-[var(--accent)]" />
                  <span className="truncate">{group.label}</span>
                </div>
                <span className="shrink-0 text-[10px] font-medium text-[var(--text-faint)]">
                  {group.movableTiles.length}
                </span>
              </div>
              <div className="absolute inset-x-1.5 bottom-1.5 top-9 rounded-[var(--radius-control)] border border-[color:var(--line)] bg-[color:color-mix(in_srgb,var(--surface-0)_94%,transparent)]">
                {group.isEmpty ? (
                  <div className="flex h-full items-center justify-center text-[11px] font-medium text-[var(--text-faint)]">
                    Drop files into this group
                  </div>
                ) : null}
              </div>
            </div>
          ))}

          {frameBundleShells.map((group) => (
            <div
              key={`bundle-drag-handle:${group.id}`}
              className="pointer-events-auto absolute z-[206] flex h-8 items-center justify-between rounded-t-[12px] px-3 text-[11px] font-semibold text-[var(--text)] cursor-grab active:cursor-grabbing"
              style={{
                left: group.x,
                top: group.y,
                width: group.width
              }}
              title={`Drag ${group.label}`}
              onPointerDown={(event) => beginFrameBundleDrag(group, event)}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-[3px] bg-[var(--accent)]" />
                <span className="truncate">{group.label}</span>
              </div>
              <span className="shrink-0 text-[10px] font-medium text-[var(--text-faint)]">
                {group.movableTiles.length}
              </span>
            </div>
          ))}

          {frameGroups.map((group) => {
            const connector = connectorCenterForGroup(group)
            const isDraggingGroup =
              dragConnection?.sourceKind === 'group' && dragConnection.sourceGroupId === group.id

            return (
              <button
                key={group.id}
                className={clsx(
                  'pointer-events-auto absolute z-[205] flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-[color:var(--link-line)] shadow-[0_0_0_3px_var(--surface-0),0_0_0_7px_color-mix(in_srgb,var(--link-line)_24%,transparent)] transition',
                  isDraggingGroup
                    ? 'scale-[1.18]'
                    : 'hover:scale-110'
                )}
                style={{
                  left: connector.x - 12,
                  top: connector.y
                }}
                aria-label={`Attach bundle ${group.label} (${group.containedTiles.length}) to a terminal`}
                title={`Attach bundle ${group.label} (${group.containedTiles.length}) to a terminal`}
                onPointerDown={(event) => beginGroupConnectionDrag(group.id, event)}
              >
                <span className="pointer-events-none block h-2.5 w-2.5 rounded-full bg-white/95" />
              </button>
            )
          })}

          {state.tiles
            .slice()
            .sort((left, right) => left.zIndex - right.zIndex)
            .map((tile) => (
              (() => {
                const contextTiles = tile.type === 'term' ? contextTilesForTerminal(tile) : []
                const contextGroups = tile.type === 'term' ? contextGroupsForTerminal(tile) : []
                const hasLinkedContext = contextGroups.length > 0 || contextTiles.length > 0
                const terminalContextPrompt =
                  tile.type === 'term'
                    ? buildTerminalContextPrompt(tile, terminalProviderForTile(tile))
                    : ''
                const tileFileKind = fileKindForTile(tile)
                const isContextSource = isContextSourceTile(tile)
                const isPendingLinkSource = linkSourceTileId === tile.id
                const hasFileDocument = Boolean(tile.filePath)
                const tileRefreshToken = tileRefreshTokens[tile.id] ?? 0
                const isMarkdownTile = tileFileKind === 'note' && isMarkdownNotePath(tile.filePath)
                const isRenamingThisTile = renamingTileId === tile.id
                const renameExtension = tile.filePath ? splitFileName(fileNameFromPath(tile.filePath)).extension : ''
                const noteViewScale = tile.type === 'note' ? normalizedNoteViewScale(tile.noteViewScale) : 1
                const noteCanDecreaseViewScale = noteViewScale > NOTE_VIEW_SCALE_MIN + 0.01
                const noteCanIncreaseViewScale = noteViewScale < NOTE_VIEW_SCALE_MAX - 0.01
                const isTileSelected = selectedTileIdSet.has(tile.id)
                const isTilePrimarySelected = isTileSelected && !multiSelectedTiles && selectedTileId === tile.id
                const isTileGroupSelected = isTileSelected && multiSelectedTiles
                const isTilePointerHovered = hoveredTileId === tile.id
                const isTileHovered = hoveredTileId === tile.id && !isTileSelected
                const showFloatingTileChrome =
                  tile.type !== 'term' && (isRenamingThisTile || isTileSelected || isTilePointerHovered)
                const tileBodyClassName =
                  tile.type === 'term'
                    ? 'h-[calc(100%-37px)] overflow-hidden rounded-b-[var(--radius-surface)]'
                    : tile.type === 'note' ||
                        tile.type === 'embed' ||
                        tileFileKind === 'image' ||
                        tileFileKind === 'video'
                      ? 'h-full overflow-hidden'
                      : 'h-full p-2'
                const connectorLabel =
                  tile.type === 'term'
                    ? dragConnection?.sourceKind === 'group'
                      ? `Attach ${frameGroups.find((group) => group.id === dragConnection.sourceGroupId)?.label ?? 'group'} to ${tile.title}`
                      : linkSourceTile && linkSourceTile.id !== tile.id
                        ? `Attach ${linkSourceTile.title} to ${tile.title}`
                        : hasLinkedContext
                          ? `${tile.title} has linked context`
                          : `${tile.title} terminal connector`
                    : `Connect ${tile.title} to a terminal`

                return (
                  <div
                    key={tile.id}
                    data-tile-root="true"
                    data-tile-id={tile.id}
                    data-terminal-connector-id={tile.type === 'term' ? tile.id : undefined}
                    className={clsx(
                      'pointer-events-auto absolute overflow-visible rounded-[var(--radius-surface)] border bg-[var(--surface-0)] shadow-[0_18px_40px_rgba(0,0,0,0.22)]',
                      selectedTileId === tile.id && focusedTerminal?.tileId === tile.id
                        ? 'border-[color:var(--accent)] shadow-[0_0_0_1px_var(--accent-soft),0_10px_22px_rgba(0,0,0,0.22)]'
                        : isTilePrimarySelected
                          ? darkMode
                            ? 'border-[color:rgba(255,255,255,0.72)] shadow-[0_0_0_1px_rgba(255,255,255,0.48),0_8px_18px_rgba(0,0,0,0.24)]'
                            : 'border-[color:rgba(31,33,29,0.46)] shadow-[0_0_0_1px_rgba(31,33,29,0.18),0_8px_18px_rgba(0,0,0,0.18)]'
                          : isTileGroupSelected
                            ? 'border-[color:rgba(100,181,246,0.82)] shadow-[0_0_0_1px_rgba(100,181,246,0.58),0_8px_18px_rgba(0,0,0,0.24)]'
                          : isTileHovered
                            ? 'border-[color:rgba(100,181,246,0.42)] shadow-[0_0_0_1px_rgba(100,181,246,0.26),0_8px_18px_rgba(0,0,0,0.22)]'
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
                    onPointerEnter={() => {
                      setHoveredTileId(tile.id)
                    }}
                    onPointerLeave={() => {
                      setHoveredTileId((current) => (current === tile.id ? null : current))
                    }}
                    onPointerDownCapture={(event) => {
                      if (event.button !== 0) {
                        return
                      }

                      if (event.metaKey || event.ctrlKey || event.shiftKey) {
                        toggleTileSelection(tile.id)
                        if (tile.type !== 'term') {
                          setFocusedTerminal(null)
                        }
                        return
                      }

                      if (selectedTileIdSet.has(tile.id)) {
                        if (tile.type !== 'term') {
                          setFocusedTerminal(null)
                        }
                        return
                      }

                      setTileSelection([tile.id], {
                        preserveFocusedTerminal: tile.type === 'term' && focusedTerminal?.tileId === tile.id
                      })
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
                          : hasLinkedContext
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
                {tile.type === 'term' ? (
                  <div
                    className="flex items-center justify-between rounded-t-[var(--radius-surface)] border-b border-[color:var(--line)] bg-[var(--surface-1)] px-2.5 py-1.5"
                    onPointerDown={(event) => {
                      if (event.button !== 0) {
                        return
                      }

                      event.stopPropagation()
                      beginTileDrag(tile, event)
                    }}
                    onDoubleClick={() => {
                      if (tile.filePath && tileFileKind && !isMarkdownTile) {
                        onOpenFile({
                          kind: 'file',
                          name: tile.title,
                          path: tile.filePath,
                          fileKind: tileFileKind
                        })
                      }
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] font-medium text-[var(--text)]">
                        {tile.title}
                      </div>
                      <div className="truncate text-[10px] uppercase tracking-[0.14em] text-[var(--text-faint)]">
                        {tileSubtitleLabel(tile)}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {hasFileDocument ? (
                        <button
                          className="flex h-5 w-5 items-center justify-center rounded-[var(--radius-control)] border border-[color:var(--line)] bg-[var(--surface-0)] text-[11px] text-[var(--text-dim)] transition hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
                          onPointerDown={(event) => event.stopPropagation()}
                          title="Refresh file"
                          onClick={(event) => {
                            event.stopPropagation()
                            requestTileRefresh(tile.id)
                          }}
                        >
                          ↻
                        </button>
                      ) : null}
                      {hasFileDocument && tileFileKind ? (
                        <button
                          className="flex h-5 w-5 items-center justify-center rounded-[var(--radius-control)] border border-[color:var(--line)] bg-[var(--surface-0)] text-[11px] text-[var(--text-dim)] transition hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
                          onPointerDown={(event) => event.stopPropagation()}
                          title="Open preview"
                          onClick={(event) => {
                            event.stopPropagation()
                            onOpenFile({
                              kind: 'file',
                              name: tile.title,
                              path: tile.filePath as string,
                              fileKind: tileFileKind
                            })
                          }}
                        >
                          ↗
                        </button>
                      ) : null}
                      <button
                        className="flex h-5 w-5 items-center justify-center rounded-[var(--radius-control)] border border-[color:var(--line)] bg-[var(--surface-0)] text-[13px] leading-none text-[var(--text-dim)] transition hover:border-[color:var(--error-line)] hover:bg-[var(--error-bg)] hover:text-[var(--error-text)]"
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
                ) : (
                  <div
                    className={clsx(
                      'pointer-events-none absolute inset-x-0 top-0 z-30 px-2 transition duration-150 ease-out',
                      showFloatingTileChrome ? '-translate-y-[calc(100%+8px)] opacity-100' : '-translate-y-[calc(100%+4px)] opacity-0'
                    )}
                  >
                    <div className="flex items-start justify-between gap-3 rounded-[var(--radius-surface)] border border-[color:var(--line-strong)] bg-[color:var(--surface-overlay)] px-3.5 py-2.5 shadow-[0_6px_16px_rgba(15,23,42,0.08)] backdrop-blur-sm">
                      <div
                        className="pointer-events-auto min-w-0 flex-1 cursor-grab active:cursor-grabbing"
                        onPointerDown={(event) => {
                          if (event.button !== 0) {
                            return
                          }

                          event.stopPropagation()
                          beginTileDrag(tile, event)
                        }}
                        onDoubleClick={() => {
                          if (tile.filePath && tileFileKind && !isMarkdownTile) {
                            onOpenFile({
                              kind: 'file',
                              name: tile.title,
                              path: tile.filePath,
                              fileKind: tileFileKind
                            })
                          }
                        }}
                      >
                        {isRenamingThisTile && isMarkdownTile ? (
                          <div
                            className="flex items-center gap-1.5"
                            onPointerDown={(event) => event.stopPropagation()}
                            onDoubleClick={(event) => event.stopPropagation()}
                          >
                            <input
                              ref={renamingInputRef}
                              value={renamingValue}
                              onChange={(event) => {
                                setRenamingValue(event.target.value)
                              }}
                            className="min-w-0 flex-1 rounded-[var(--radius-control)] border border-[color:var(--accent)] bg-[var(--surface-0)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--text)] outline-none"
                              onBlur={cancelTileRename}
                              onKeyDown={(event) => {
                                event.stopPropagation()

                                if (event.key === 'Enter') {
                                  event.preventDefault()
                                  commitTileRename(tile)
                                  return
                                }

                                if (event.key === 'Escape') {
                                  event.preventDefault()
                                  cancelTileRename()
                                }
                              }}
                            />
                            {renameExtension ? (
                              <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-faint)]">
                                {renameExtension}
                              </span>
                            ) : null}
                          </div>
                        ) : (
                          <>
                            <button
                              type="button"
                              className={clsx(
                                'block max-w-full truncate bg-transparent p-0 text-left text-[13px] font-medium text-[var(--text)]',
                                isMarkdownTile && 'cursor-text'
                              )}
                              onPointerDown={(event) => {
                                event.stopPropagation()
                              }}
                              onDoubleClick={(event) => {
                                if (!isMarkdownTile) {
                                  return
                                }

                                event.preventDefault()
                                event.stopPropagation()
                                beginTileRename(tile)
                              }}
                              title={isMarkdownTile ? 'Double-click to rename this markdown file' : tile.title}
                            >
                              {tile.title}
                            </button>
                            <div className="truncate pt-0.5 text-[10px] uppercase tracking-[0.16em] text-[var(--text-faint)]">
                              {tileSubtitleLabel(tile)}
                            </div>
                          </>
                        )}
                      </div>
                      <div className="pointer-events-auto flex shrink-0 items-center gap-1">
                        {tile.type === 'note' ? (
                          <HoverTooltip
                            label="Decrease note text size"
                            placement="bottom"
                          >
                            <button
                              type="button"
                              aria-label="Decrease note text size"
                              data-managed-tooltip="custom"
                              disabled={!noteCanDecreaseViewScale}
                              className={clsx(
                                'flex h-7 min-w-7 items-center justify-center rounded-[var(--radius-control)] border border-white/10 bg-black/15 px-2 text-[11px] font-semibold text-[var(--text-faint)] transition',
                                noteCanDecreaseViewScale
                                  ? 'hover:bg-black/25 hover:text-[var(--text)]'
                                  : 'cursor-default opacity-45'
                              )}
                              onPointerDown={(event) => event.stopPropagation()}
                              onClick={(event) => {
                                event.stopPropagation()
                                adjustNoteViewScale(tile.id, -NOTE_VIEW_SCALE_STEP)
                              }}
                            >
                              A-
                            </button>
                          </HoverTooltip>
                        ) : null}
                        {tile.type === 'note' ? (
                          <HoverTooltip
                            label="Increase note text size"
                            placement="bottom"
                          >
                            <button
                              type="button"
                              aria-label="Increase note text size"
                              data-managed-tooltip="custom"
                              disabled={!noteCanIncreaseViewScale}
                              className={clsx(
                                'flex h-7 min-w-7 items-center justify-center rounded-[var(--radius-control)] border border-white/10 bg-black/15 px-2 text-[11px] font-semibold text-[var(--text-faint)] transition',
                                noteCanIncreaseViewScale
                                  ? 'hover:bg-black/25 hover:text-[var(--text)]'
                                  : 'cursor-default opacity-45'
                              )}
                              onPointerDown={(event) => event.stopPropagation()}
                              onClick={(event) => {
                                event.stopPropagation()
                                adjustNoteViewScale(tile.id, NOTE_VIEW_SCALE_STEP)
                              }}
                            >
                              A+
                            </button>
                          </HoverTooltip>
                        ) : null}
                        {hasFileDocument && tileFileKind ? (
                          <button
                            className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-control)] border border-white/10 bg-black/15 text-[11px] text-[var(--text-dim)] transition hover:bg-black/25 hover:text-[var(--text)]"
                            onPointerDown={(event) => event.stopPropagation()}
                            title="Open preview"
                            onClick={(event) => {
                              event.stopPropagation()
                              onOpenFile({
                                kind: 'file',
                                name: tile.title,
                                path: tile.filePath as string,
                                fileKind: tileFileKind
                              })
                            }}
                          >
                            ↗
                          </button>
                        ) : null}
                        {tile.type === 'embed' && tile.embedUrl ? (
                          <button
                            className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-control)] border border-white/10 bg-black/15 text-[11px] text-[var(--text-dim)] transition hover:bg-black/25 hover:text-[var(--text)]"
                            onPointerDown={(event) => event.stopPropagation()}
                            title="Open in browser"
                            onClick={(event) => {
                              event.stopPropagation()
                              void window.collaborator.openExternalUrl(tile.embedUrl as string)
                            }}
                          >
                            ↗
                          </button>
                        ) : null}
                        <button
                          className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-control)] border border-white/10 bg-black/15 text-[13px] leading-none text-[var(--text-dim)] transition hover:border-[color:var(--error-line)] hover:bg-[var(--error-bg)] hover:text-[var(--error-text)]"
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
                  </div>
                )}

                <div
                  className={tileBodyClassName}
                >
                  {tile.type === 'term' ? (
                    <div className="h-full min-h-0">
                      <TerminalPane
                        contextPrompt={terminalContextPrompt}
                        cwd={activeWorkspacePath}
                        darkMode={darkMode}
                        focusMode={
                          selectedTileId === tile.id && focusedTerminal?.tileId === tile.id
                            ? focusedTerminal.mode
                            : null
                        }
                        isSelected={selectedTileIdSet.has(tile.id)}
                        notifyOnComplete={Boolean(tile.terminalNotifyOnComplete)}
                        onCreateMarkdownCard={(options) => createMarkdownCardForTerminal(tile.id, options)}
                        onFocusModeChange={(mode) => {
                          focusTerminal(tile.id, mode)
                        }}
                        onToggleNotifyOnComplete={(enabled) => {
                          updateTile(
                            tile.id,
                            (currentTile) => ({
                              ...currentTile,
                              terminalNotifyOnComplete: enabled
                            }),
                            { immediate: true }
                          )
                        }}
                        provider={terminalProviderForTile(tile)}
                        sessionId={tile.sessionId as string}
                      />
                    </div>
                  ) : tile.type === 'embed' && tile.embedUrl ? (
                    <EmbedPane title={tile.title} url={tile.embedUrl} variant="tile" />
                  ) : tileFileKind && tile.filePath ? (
                    <DocumentPane
                      fileKind={tileFileKind}
                      filePath={tile.filePath}
                      noteSizingMode={tile.type === 'note' ? tile.noteSizeMode ?? 'auto' : undefined}
                      noteViewScale={tile.type === 'note' ? noteViewScale : undefined}
                      onNoteContentHeightChange={
                        tile.type === 'note'
                          ? (contentHeight) => {
                              handleNoteContentHeightChange(tile.id, contentHeight)
                            }
                          : undefined
                      }
                      onPrimaryHeadingChange={
                        tile.type === 'note'
                          ? (heading) => {
                              void handleNotePrimaryHeadingChange(tile, heading)
                            }
                          : undefined
                      }
                      officeViewer={officeViewer}
                      onSetPresentationEmbedUrl={
                        tile.type === 'presentation'
                          ? (url) => {
                              updateTile(
                                tile.id,
                                (currentTile) => ({
                                  ...currentTile,
                                  embedUrl: url ?? undefined
                                }),
                                { immediate: true }
                              )
                            }
                          : undefined
                      }
                      onImportImageFile={onImportImageFile}
                      onPassthroughScroll={panBy}
                      presentationEmbedUrl={tile.type === 'presentation' ? tile.embedUrl ?? null : null}
                      refreshToken={tileRefreshToken}
                      showTileRefreshButton={false}
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center rounded-[var(--radius-surface)] border border-[color:var(--error-line)] bg-[var(--error-bg)] p-4 text-center text-sm text-[var(--error-text)]">
                      This tile could not be rendered.
                    </div>
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
        hoveredConnectionTerminalTile?.type === 'term' &&
        (hoveredConnection.sourceKind === 'group'
          ? Boolean(hoveredConnectionSourceGroup)
          : isContextSourceTile(hoveredConnectionSourceTile)) ? (
          <div data-canvas-ui="true" className="pointer-events-none absolute inset-0 z-[210]">
            <button
              type="button"
              data-terminal-connection-key={hoveredConnectionKey ?? undefined}
              className="pointer-events-auto absolute flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-[color:var(--line-strong)] bg-[color:var(--surface-overlay)] text-[11px] leading-none text-[var(--text-dim)] shadow-[0_8px_18px_rgba(0,0,0,0.18)] backdrop-blur transition hover:border-[color:var(--error-line)] hover:bg-[var(--error-bg)] hover:text-[var(--error-text)]"
              style={{
                left: hoveredConnection.midpointX * state.viewport.zoom + state.viewport.panX,
                top: hoveredConnection.midpointY * state.viewport.zoom + state.viewport.panY
              }}
              aria-label={`Remove link from ${
                hoveredConnection.sourceKind === 'group'
                  ? hoveredConnectionSourceGroup?.label ?? 'bundle'
                  : hoveredConnectionSourceTile?.title ?? 'resource'
              } to ${hoveredConnectionTerminalTile.title}`}
              title={`Remove link from ${
                hoveredConnection.sourceKind === 'group'
                  ? hoveredConnectionSourceGroup?.label ?? 'bundle'
                  : hoveredConnectionSourceTile?.title ?? 'resource'
              } to ${hoveredConnectionTerminalTile.title}`}
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
                if (hoveredConnection.sourceKind === 'group' && hoveredConnectionSourceGroup) {
                  detachContextGroup(hoveredConnectionTerminalTile.id, hoveredConnectionSourceGroup.id)
                  return
                }

                if (hoveredConnectionSourceTile) {
                  detachContextTile(hoveredConnectionTerminalTile.id, hoveredConnectionSourceTile.id)
                }
              }}
            >
              <span className="pointer-events-none block leading-none">×</span>
            </button>
          </div>
        ) : null}

        {zoomIndicator ? (
          <div className="pointer-events-none absolute bottom-[6.65rem] right-3 z-[220] rounded-[var(--radius-control)] border border-[color:var(--line)] bg-[var(--surface-0)] px-3 py-1.5 text-[10px] font-medium tracking-[0.14em] text-[var(--text-dim)] shadow-[0_10px_22px_rgba(15,23,42,0.08)] backdrop-blur">
            {zoomIndicator}
          </div>
        ) : null}

        <div
          data-canvas-ui="true"
          className="absolute bottom-0 right-0 z-[220] overflow-hidden rounded-tl-[var(--radius-surface)] border-l border-t border-[color:var(--line)] bg-[color:var(--surface-overlay)] shadow-[0_-8px_24px_rgba(15,23,42,0.1)] backdrop-blur"
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
                      'flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)] border transition',
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
            <div className="border-b border-[color:var(--line)] px-3 py-2">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-faint)]">
                  Pen
                </div>
                <div className="truncate text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--text-dim)]">
                  {activeDrawColorLabel} / {activeDrawSizeLabel}
                </div>
              </div>
              <div className="mb-2 flex items-center gap-1.5">
                {visibleDrawColorItems.map((item) => {
                  const isActive = drawColor === item.color
                  const label = drawColorLabel(item, darkMode)
                  const showNeutralMarker = darkMode && item.color === 'black'
                  const swatchBackgroundColor =
                    item.color === 'white'
                      ? '#ffffff'
                      : item.color === 'black' && darkMode
                        ? '#ecece8'
                        : drawTheme[item.color].solid

                  return (
                    <HoverTooltip key={item.color} label={`Pen color ${label}`}>
                      <button
                        aria-label={`Pen color ${label}`}
                        data-managed-tooltip="custom"
                        className={clsx(
                          'relative flex h-7 w-7 items-center justify-center rounded-full border transition',
                          isActive
                            ? 'border-[color:var(--text)] bg-[var(--surface-0)] shadow-[0_0_0_1px_rgba(15,23,42,0.08)]'
                            : 'border-[color:var(--line)] bg-[var(--surface-0)] hover:border-[color:var(--line-strong)]'
                        )}
                        onClick={() => {
                          applyDrawColor(item.color)
                        }}
                        title={`Pen color: ${label}`}
                      >
                        <span
                          className={clsx(
                            'relative block h-4 w-4 rounded-full border',
                            item.color === 'white'
                              ? 'border-[color:var(--line-strong)]'
                              : item.color === 'black' && darkMode
                                ? 'border-[rgba(17,18,20,0.4)]'
                                : 'border-black/5'
                          )}
                          style={{
                            backgroundColor: swatchBackgroundColor
                          }}
                        >
                          {showNeutralMarker ? (
                            <span
                              className="pointer-events-none absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
                              style={{
                                backgroundColor: 'rgba(20, 21, 23, 0.68)'
                              }}
                            />
                          ) : null}
                        </span>
                        {isActive ? (
                          <span className="pointer-events-none absolute inset-0 rounded-full shadow-[inset_0_0_0_1px_var(--text)]" />
                        ) : null}
                      </button>
                    </HoverTooltip>
                  )
                })}
              </div>
              <div className="flex items-center gap-1.5">
                {DRAW_SIZE_ITEMS.map((item) => {
                  const isActive = drawSize === item.size

                  return (
                    <HoverTooltip key={item.size} label={`Pen thickness ${item.label}`}>
                      <button
                        aria-label={`Pen thickness ${item.label}`}
                        data-managed-tooltip="custom"
                        className={clsx(
                          'relative flex h-8 min-w-[2.5rem] items-center justify-center rounded-[var(--radius-control)] border px-2 transition',
                          isActive
                            ? 'border-[color:var(--text)] bg-[var(--surface-0)] text-[var(--text)]'
                            : 'border-[color:var(--line)] bg-[var(--surface-0)] text-[var(--text-dim)] hover:border-[color:var(--line-strong)] hover:text-[var(--text)]'
                        )}
                        onClick={() => {
                          applyDrawSize(item.size)
                        }}
                        title={`Pen thickness: ${item.label}`}
                      >
                        <span
                          className="block rounded-full bg-current"
                          style={{
                            height: item.previewSize,
                            width: 18
                          }}
                        />
                      </button>
                    </HoverTooltip>
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
                  className="flex items-center gap-2 rounded-[var(--radius-control)] border border-[color:var(--line)] bg-[var(--surface-0)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--text-dim)] transition hover:border-[color:var(--line-strong)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-45"
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
              className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)] border border-[color:var(--line)] bg-[var(--surface-0)] text-[1.35rem] font-light leading-none text-[var(--text-dim)] transition hover:border-[color:var(--line-strong)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-45"
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
              className="min-w-[6rem] rounded-[var(--radius-control)] border border-[color:var(--line)] bg-[var(--surface-0)] px-3.5 py-2.5 text-[0.95rem] font-medium leading-none tracking-[0.04em] text-[var(--text-dim)] transition hover:border-[color:var(--line-strong)] hover:text-[var(--text)]"
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
              className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)] border border-[color:var(--line)] bg-[var(--surface-0)] text-[1.35rem] font-light leading-none text-[var(--text-dim)] transition hover:border-[color:var(--line-strong)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-45"
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
