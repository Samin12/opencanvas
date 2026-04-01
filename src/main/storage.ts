import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import type { AppConfig, CanvasState, WindowState } from '../shared/types'

export const APP_DIRECTORY =
  process.env.OPEN_CANVAS_APP_DIRECTORY && process.env.OPEN_CANVAS_APP_DIRECTORY.trim().length > 0
    ? process.env.OPEN_CANVAS_APP_DIRECTORY
    : join(homedir(), '.collaborator-clone')
const CONFIG_PATH = join(APP_DIRECTORY, 'config.json')
const LEGACY_CANVAS_STATE_PATH = join(APP_DIRECTORY, 'canvas-state.json')
const WORKSPACE_METADATA_DIRECTORY = '.claude-canvas'
const WORKSPACE_CANVAS_STATE_FILE = 'canvas.json'

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

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath)
    return true
  } catch {
    return false
  }
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
            contextGroupIds: Array.isArray(tile.contextGroupIds)
              ? tile.contextGroupIds.filter((value): value is string => typeof value === 'string')
              : undefined,
            embedUrl: typeof tile.embedUrl === 'string' ? tile.embedUrl : undefined,
            filePath: typeof tile.filePath === 'string' ? tile.filePath : undefined,
            noteSizeMode:
              tile.type === 'note'
                ? tile.noteSizeMode === 'manual'
                  ? 'manual'
                  : 'auto'
                : undefined,
            sessionId: typeof tile.sessionId === 'string' ? tile.sessionId : undefined,
            terminalNotifyOnComplete:
              tile.type === 'term' ? Boolean(tile.terminalNotifyOnComplete) : undefined,
            terminalProvider:
              tile.type === 'term'
                ? tile.terminalProvider === 'codex'
                  ? 'codex'
                  : 'claude'
                : undefined
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

export function createDefaultCanvasState(): CanvasState {
  return sanitizeCanvasState(undefined)
}

function workspaceCanvasStatePath(workspacePath: string): string {
  return join(workspacePath, WORKSPACE_METADATA_DIRECTORY, WORKSPACE_CANVAS_STATE_FILE)
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

export async function migrateLegacyCanvasStateToWorkspace(
  workspacePath: string | null | undefined
): Promise<void> {
  if (!workspacePath) {
    return
  }

  const workspaceCanvasPath = workspaceCanvasStatePath(workspacePath)

  if (await pathExists(workspaceCanvasPath)) {
    return
  }

  if (!(await pathExists(LEGACY_CANVAS_STATE_PATH))) {
    return
  }

  const state = sanitizeCanvasState(await readJson(LEGACY_CANVAS_STATE_PATH, createDefaultCanvasState()))
  await writeJson(workspaceCanvasPath, state)

  try {
    await rename(
      LEGACY_CANVAS_STATE_PATH,
      join(APP_DIRECTORY, `canvas-state.migrated-backup-${Date.now()}.json`)
    )
  } catch {
    // If the backup step fails, keep the migrated workspace canvas and continue.
  }
}

export async function loadCanvasState(workspacePath?: string | null): Promise<CanvasState> {
  if (!workspacePath) {
    return createDefaultCanvasState()
  }

  const targetPath = workspaceCanvasStatePath(workspacePath)
  const state = sanitizeCanvasState(await readJson(targetPath, createDefaultCanvasState()))
  await writeJson(targetPath, state)
  return state
}

export async function saveCanvasState(
  workspacePath: string | null | undefined,
  state: CanvasState
): Promise<CanvasState> {
  const sanitized = sanitizeCanvasState(state)

  if (!workspacePath) {
    return sanitized
  }

  await writeJson(workspaceCanvasStatePath(workspacePath), sanitized)
  return sanitized
}
