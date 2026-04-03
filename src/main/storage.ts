import {
  copyFile,
  mkdir,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { AppConfig, CanvasState, WindowState } from "../shared/types";

export const APP_DIRECTORY =
  process.env.OPEN_CANVAS_APP_DIRECTORY &&
  process.env.OPEN_CANVAS_APP_DIRECTORY.trim().length > 0
    ? process.env.OPEN_CANVAS_APP_DIRECTORY
    : join(homedir(), ".collaborator-clone");
const CONFIG_PATH = join(APP_DIRECTORY, "config.json");
const CONFIG_PREVIOUS_PATH = join(APP_DIRECTORY, "config.previous.json");
const LEGACY_CANVAS_STATE_PATH = join(APP_DIRECTORY, "canvas-state.json");
const WORKSPACE_METADATA_DIRECTORY = ".claude-canvas";
const WORKSPACE_CANVAS_STATE_FILE = "canvas.json";
const WORKSPACE_CANVAS_PREVIOUS_STATE_FILE = "canvas.previous.json";

const DEFAULT_WINDOW_STATE: WindowState = {
  width: 1480,
  height: 920,
  isMaximized: false,
};

const DEFAULT_CONFIG: AppConfig = {
  workspaces: [],
  activeWorkspace: 0,
  windowState: DEFAULT_WINDOW_STATE,
  ui: {
    darkMode: true,
    navigatorZoom: 1,
    sidebarCollapsed: false,
    sidebarSide: "left",
    sidebarWidth: 320,
  },
};

async function ensureDirectory(targetPath: string): Promise<void> {
  await mkdir(dirname(targetPath), { recursive: true });
}

async function readJson<T>(targetPath: string, fallback: T): Promise<T> {
  try {
    const content = await readFile(targetPath, "utf8");
    return JSON.parse(content) as T;
  } catch {
    return fallback;
  }
}

type JsonReadResult<T> =
  | { kind: "ok"; value: T }
  | { kind: "missing"; value: T }
  | { kind: "invalid"; value: T; error: unknown };

async function readJsonResult<T>(
  targetPath: string,
  fallback: T,
): Promise<JsonReadResult<T>> {
  try {
    const content = await readFile(targetPath, "utf8");

    try {
      return {
        kind: "ok",
        value: JSON.parse(content) as T,
      };
    } catch (error) {
      return {
        kind: "invalid",
        value: fallback,
        error,
      };
    }
  } catch (error) {
    const code =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof (error as { code?: unknown }).code === "string"
        ? (error as { code: string }).code
        : null;

    if (code === "ENOENT") {
      return {
        kind: "missing",
        value: fallback,
      };
    }

    return {
      kind: "invalid",
      value: fallback,
      error,
    };
  }
}

async function preservePreviousFile(
  targetPath: string,
  previousPath: string,
  nextContent: string,
): Promise<void> {
  try {
    const currentContent = await readFile(targetPath, "utf8");

    if (currentContent === nextContent) {
      return;
    }

    await ensureDirectory(previousPath);
    await writeFile(previousPath, currentContent, "utf8");
  } catch (error) {
    const code =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof (error as { code?: unknown }).code === "string"
        ? (error as { code: string }).code
        : null;

    if (code === "ENOENT") {
      return;
    }

    throw error;
  }
}

async function writeJson(
  targetPath: string,
  value: unknown,
  options?: { previousPath?: string },
): Promise<void> {
  await ensureDirectory(targetPath);
  const content = `${JSON.stringify(value, null, 2)}\n`;

  if (options?.previousPath) {
    await preservePreviousFile(targetPath, options.previousPath, content);
  }

  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, content, "utf8");
  await rename(tempPath, targetPath);
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

function sanitizeWindowState(
  value: Partial<WindowState> | undefined,
): WindowState {
  return {
    width:
      typeof value?.width === "number"
        ? value.width
        : DEFAULT_WINDOW_STATE.width,
    height:
      typeof value?.height === "number"
        ? value.height
        : DEFAULT_WINDOW_STATE.height,
    isMaximized: Boolean(value?.isMaximized),
    x: typeof value?.x === "number" ? value.x : undefined,
    y: typeof value?.y === "number" ? value.y : undefined,
  };
}

function sanitizeConfig(input: Partial<AppConfig> | undefined): AppConfig {
  const workspaces = Array.isArray(input?.workspaces)
    ? input.workspaces.filter(
        (workspace): workspace is string => typeof workspace === "string",
      )
    : [];

  const activeWorkspace =
    typeof input?.activeWorkspace === "number"
      ? Math.min(
          Math.max(input.activeWorkspace, 0),
          Math.max(workspaces.length - 1, 0),
        )
      : 0;

  return {
    workspaces,
    activeWorkspace,
    windowState: sanitizeWindowState(input?.windowState),
    ui: {
      darkMode: Boolean(input?.ui?.darkMode),
      navigatorZoom:
        typeof input?.ui?.navigatorZoom === "number" &&
        Number.isFinite(input.ui.navigatorZoom)
          ? Math.min(Math.max(input.ui.navigatorZoom, 0.85), 1.35)
          : DEFAULT_CONFIG.ui.navigatorZoom,
      sidebarCollapsed:
        typeof input?.ui?.sidebarCollapsed === "boolean"
          ? input.ui.sidebarCollapsed
          : Boolean(
              (input?.ui as { canvasCollapsed?: boolean } | undefined)
                ?.canvasCollapsed,
            ),
      sidebarSide: input?.ui?.sidebarSide === "right" ? "right" : "left",
      sidebarWidth:
        typeof input?.ui?.sidebarWidth === "number"
          ? Math.min(Math.max(input.ui.sidebarWidth, 240), 480)
          : DEFAULT_CONFIG.ui.sidebarWidth,
    },
  };
}

function sanitizeCanvasState(
  input: Partial<CanvasState> | undefined,
): CanvasState {
  return {
    version: 1,
    tiles: Array.isArray(input?.tiles)
      ? input.tiles
          .filter(
            (tile) =>
              tile &&
              typeof tile.id === "string" &&
              typeof tile.type === "string",
          )
          .map((tile, index) => ({
            id: tile.id,
            type: tile.type,
            title:
              typeof tile.title === "string" ? tile.title : `Tile ${index + 1}`,
            x: typeof tile.x === "number" ? tile.x : 0,
            y: typeof tile.y === "number" ? tile.y : 0,
            width: typeof tile.width === "number" ? tile.width : 440,
            height: typeof tile.height === "number" ? tile.height : 540,
            zIndex: typeof tile.zIndex === "number" ? tile.zIndex : index + 1,
            contextTileIds: Array.isArray(tile.contextTileIds)
              ? tile.contextTileIds.filter(
                  (value): value is string => typeof value === "string",
                )
              : undefined,
            contextGroupIds: Array.isArray(tile.contextGroupIds)
              ? tile.contextGroupIds.filter(
                  (value): value is string => typeof value === "string",
                )
              : undefined,
            embedUrl:
              typeof tile.embedUrl === "string" ? tile.embedUrl : undefined,
            filePath:
              typeof tile.filePath === "string" ? tile.filePath : undefined,
            noteCollapsed:
              tile.type === "note" ? Boolean(tile.noteCollapsed) : undefined,
            noteExpandedHeight:
              tile.type === "note" &&
              typeof tile.noteExpandedHeight === "number" &&
              Number.isFinite(tile.noteExpandedHeight)
                ? Math.max(140, tile.noteExpandedHeight)
                : undefined,
            noteSizeMode:
              tile.type === "note"
                ? tile.noteSizeMode === "manual"
                  ? "manual"
                  : "auto"
                : undefined,
            noteViewScale:
              tile.type === "note"
                ? typeof tile.noteViewScale === "number" &&
                  Number.isFinite(tile.noteViewScale)
                  ? Math.min(1.45, Math.max(0.85, tile.noteViewScale))
                  : 1
                : undefined,
            sessionId:
              typeof tile.sessionId === "string" ? tile.sessionId : undefined,
            terminalNotifyOnComplete:
              tile.type === "term"
                ? Boolean(tile.terminalNotifyOnComplete)
                : undefined,
            terminalProvider:
              tile.type === "term"
                ? tile.terminalProvider === "codex"
                  ? "codex"
                  : "claude"
                : undefined,
          }))
      : [],
    viewport: {
      panX: typeof input?.viewport?.panX === "number" ? input.viewport.panX : 0,
      panY: typeof input?.viewport?.panY === "number" ? input.viewport.panY : 0,
      zoom: typeof input?.viewport?.zoom === "number" ? input.viewport.zoom : 1,
    },
    boardSnapshot:
      input?.boardSnapshot && typeof input.boardSnapshot === "object"
        ? input.boardSnapshot
        : undefined,
  };
}

export function createDefaultCanvasState(): CanvasState {
  return sanitizeCanvasState(undefined);
}

function workspaceCanvasStatePath(workspacePath: string): string {
  return join(
    workspacePath,
    WORKSPACE_METADATA_DIRECTORY,
    WORKSPACE_CANVAS_STATE_FILE,
  );
}

function workspacePreviousCanvasStatePath(workspacePath: string): string {
  return join(
    workspacePath,
    WORKSPACE_METADATA_DIRECTORY,
    WORKSPACE_CANVAS_PREVIOUS_STATE_FILE,
  );
}

function workspaceCorruptCanvasStatePath(workspacePath: string): string {
  return join(
    workspacePath,
    WORKSPACE_METADATA_DIRECTORY,
    `canvas.corrupt-${Date.now()}.json`,
  );
}

async function preserveCorruptFile(
  sourcePath: string,
  corruptPath: string,
): Promise<void> {
  try {
    await ensureDirectory(corruptPath);
    await copyFile(sourcePath, corruptPath);
  } catch {
    // Keep going if the corrupt payload cannot be copied.
  }
}

export async function loadConfig(): Promise<AppConfig> {
  await mkdir(APP_DIRECTORY, { recursive: true });
  const result = await readJsonResult<Partial<AppConfig> | undefined>(
    CONFIG_PATH,
    DEFAULT_CONFIG,
  );

  if (result.kind === "missing") {
    await writeJson(CONFIG_PATH, DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }

  if (result.kind === "invalid") {
    await preserveCorruptFile(
      CONFIG_PATH,
      join(APP_DIRECTORY, `config.corrupt-${Date.now()}.json`),
    );

    const backup = await readJsonResult<Partial<AppConfig> | undefined>(
      CONFIG_PREVIOUS_PATH,
      DEFAULT_CONFIG,
    );

    if (backup.kind === "ok") {
      const restored = sanitizeConfig(backup.value);
      await writeJson(CONFIG_PATH, restored);
      return restored;
    }

    throw new Error("The app config is corrupted and no previous backup exists.");
  }

  return sanitizeConfig(result.value);
}

export async function saveConfig(config: AppConfig): Promise<AppConfig> {
  const sanitized = sanitizeConfig(config);
  await writeJson(CONFIG_PATH, sanitized, { previousPath: CONFIG_PREVIOUS_PATH });
  return sanitized;
}

export async function migrateLegacyCanvasStateToWorkspace(
  workspacePath: string | null | undefined,
): Promise<void> {
  if (!workspacePath) {
    return;
  }

  const workspaceCanvasPath = workspaceCanvasStatePath(workspacePath);

  if (await pathExists(workspaceCanvasPath)) {
    return;
  }

  if (!(await pathExists(LEGACY_CANVAS_STATE_PATH))) {
    return;
  }

  const legacyState = await readJsonResult<Partial<CanvasState> | undefined>(
    LEGACY_CANVAS_STATE_PATH,
    createDefaultCanvasState(),
  );

  if (legacyState.kind === "invalid") {
    return;
  }

  const state = sanitizeCanvasState(legacyState.value);
  await writeJson(workspaceCanvasPath, state);

  try {
    await rename(
      LEGACY_CANVAS_STATE_PATH,
      join(APP_DIRECTORY, `canvas-state.migrated-backup-${Date.now()}.json`),
    );
  } catch {
    // If the backup step fails, keep the migrated workspace canvas and continue.
  }
}

export async function loadCanvasState(
  workspacePath?: string | null,
): Promise<CanvasState> {
  if (!workspacePath) {
    return createDefaultCanvasState();
  }

  const targetPath = workspaceCanvasStatePath(workspacePath);
  const previousPath = workspacePreviousCanvasStatePath(workspacePath);
  const result = await readJsonResult<Partial<CanvasState> | undefined>(
    targetPath,
    createDefaultCanvasState(),
  );

  if (result.kind === "missing") {
    const emptyState = createDefaultCanvasState();
    await writeJson(targetPath, emptyState);
    return emptyState;
  }

  if (result.kind === "invalid") {
    await preserveCorruptFile(targetPath, workspaceCorruptCanvasStatePath(workspacePath));

    const backup = await readJsonResult<Partial<CanvasState> | undefined>(
      previousPath,
      createDefaultCanvasState(),
    );

    if (backup.kind === "ok") {
      const restored = sanitizeCanvasState(backup.value);
      await writeJson(targetPath, restored);
      return restored;
    }

    throw new Error(
      `The workspace canvas is corrupted at ${targetPath} and no previous backup exists.`,
    );
  }

  return sanitizeCanvasState(result.value);
}

export async function saveCanvasState(
  workspacePath: string | null | undefined,
  state: CanvasState,
): Promise<CanvasState> {
  const sanitized = sanitizeCanvasState(state);

  if (!workspacePath) {
    return sanitized;
  }

  await writeJson(workspaceCanvasStatePath(workspacePath), sanitized, {
    previousPath: workspacePreviousCanvasStatePath(workspacePath),
  });
  return sanitized;
}
