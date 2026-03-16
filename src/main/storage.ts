import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import type { AppConfig, CanvasState, WindowState } from '../shared/types'

export const APP_DIRECTORY = join(homedir(), '.collaborator-clone')
const CONFIG_PATH = join(APP_DIRECTORY, 'config.json')
const CANVAS_STATE_PATH = join(APP_DIRECTORY, 'canvas-state.json')

const DEFAULT_WINDOW_STATE: WindowState = {
  width: 1480,
  height: 920,
  isMaximized: false
}

const DEFAULT_CONFIG: AppConfig = {
  workspaces: [],
  activeWorkspace: 0,
  windowState: DEFAULT_WINDOW_STATE,
  ui: {
    darkMode: true,
    sidebarCollapsed: false,
    sidebarSide: 'left',
    sidebarWidth: 320
  }
}

const DEFAULT_CANVAS_STATE: CanvasState = {
  version: 1,
  tiles: [],
  viewport: {
    panX: 0,
    panY: 0,
    zoom: 1
  },
  boardSnapshot: undefined
}

async function ensureDirectory(targetPath: string): Promise<void> {
  await mkdir(dirname(targetPath), { recursive: true })
}

async function readJson<T>(targetPath: string, fallback: T): Promise<T> {
  try {
    const content = await readFile(targetPath, 'utf8')
    return JSON.parse(content) as T
  } catch {
    return fallback
  }
}

async function writeJson(targetPath: string, value: unknown): Promise<void> {
  await ensureDirectory(targetPath)
  await writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function sanitizeWindowState(value: Partial<WindowState> | undefined): WindowState {
  return {
    width: typeof value?.width === 'number' ? value.width : DEFAULT_WINDOW_STATE.width,
    height: typeof value?.height === 'number' ? value.height : DEFAULT_WINDOW_STATE.height,
    isMaximized: Boolean(value?.isMaximized),
    x: typeof value?.x === 'number' ? value.x : undefined,
    y: typeof value?.y === 'number' ? value.y : undefined
  }
}

function sanitizeConfig(input: Partial<AppConfig> | undefined): AppConfig {
  const workspaces = Array.isArray(input?.workspaces)
    ? input.workspaces.filter((workspace): workspace is string => typeof workspace === 'string')
    : []

  const activeWorkspace = typeof input?.activeWorkspace === 'number'
    ? Math.min(Math.max(input.activeWorkspace, 0), Math.max(workspaces.length - 1, 0))
    : 0

  return {
    workspaces,
    activeWorkspace,
    windowState: sanitizeWindowState(input?.windowState),
    ui: {
      darkMode: Boolean(input?.ui?.darkMode),
      sidebarCollapsed:
        typeof input?.ui?.sidebarCollapsed === 'boolean'
          ? input.ui.sidebarCollapsed
          : Boolean((input?.ui as { canvasCollapsed?: boolean } | undefined)?.canvasCollapsed),
      sidebarSide: input?.ui?.sidebarSide === 'right' ? 'right' : 'left',
      sidebarWidth:
        typeof input?.ui?.sidebarWidth === 'number'
          ? Math.min(Math.max(input.ui.sidebarWidth, 240), 480)
          : DEFAULT_CONFIG.ui.sidebarWidth
    }
  }
}

function sanitizeCanvasState(input: Partial<CanvasState> | undefined): CanvasState {
  return {
    version: 1,
    tiles: Array.isArray(input?.tiles)
      ? input.tiles
          .filter((tile) => tile && typeof tile.id === 'string' && typeof tile.type === 'string')
          .map((tile, index) => ({
            id: tile.id,
            type: tile.type,
            title: typeof tile.title === 'string' ? tile.title : `Tile ${index + 1}`,
            x: typeof tile.x === 'number' ? tile.x : 0,
            y: typeof tile.y === 'number' ? tile.y : 0,
            width: typeof tile.width === 'number' ? tile.width : 440,
            height: typeof tile.height === 'number' ? tile.height : 540,
            zIndex: typeof tile.zIndex === 'number' ? tile.zIndex : index + 1,
            contextTileIds: Array.isArray(tile.contextTileIds)
              ? tile.contextTileIds.filter((value): value is string => typeof value === 'string')
              : undefined,
            filePath: typeof tile.filePath === 'string' ? tile.filePath : undefined,
            sessionId: typeof tile.sessionId === 'string' ? tile.sessionId : undefined
          }))
      : [],
    viewport: {
      panX: typeof input?.viewport?.panX === 'number' ? input.viewport.panX : 0,
      panY: typeof input?.viewport?.panY === 'number' ? input.viewport.panY : 0,
      zoom: typeof input?.viewport?.zoom === 'number' ? input.viewport.zoom : 1
    },
    boardSnapshot:
      input?.boardSnapshot && typeof input.boardSnapshot === 'object'
        ? input.boardSnapshot
        : undefined
  }
}

export async function loadConfig(): Promise<AppConfig> {
  await mkdir(APP_DIRECTORY, { recursive: true })
  const config = sanitizeConfig(await readJson(CONFIG_PATH, DEFAULT_CONFIG))
  await writeJson(CONFIG_PATH, config)
  return config
}

export async function saveConfig(config: AppConfig): Promise<AppConfig> {
  const sanitized = sanitizeConfig(config)
  await writeJson(CONFIG_PATH, sanitized)
  return sanitized
}

export async function loadCanvasState(): Promise<CanvasState> {
  await mkdir(APP_DIRECTORY, { recursive: true })
  const state = sanitizeCanvasState(await readJson(CANVAS_STATE_PATH, DEFAULT_CANVAS_STATE))
  await writeJson(CANVAS_STATE_PATH, state)
  return state
}

export async function saveCanvasState(state: CanvasState): Promise<CanvasState> {
  const sanitized = sanitizeCanvasState(state)
  await writeJson(CANVAS_STATE_PATH, sanitized)
  return sanitized
}
