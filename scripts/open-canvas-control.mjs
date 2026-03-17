import { spawn } from 'node:child_process'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

export const APP_DIRECTORY =
  process.env.OPEN_CANVAS_APP_DIRECTORY && process.env.OPEN_CANVAS_APP_DIRECTORY.trim().length > 0
    ? process.env.OPEN_CANVAS_APP_DIRECTORY
    : join(homedir(), '.collaborator-clone')
export const CONFIG_PATH = join(APP_DIRECTORY, 'config.json')
const WORKSPACE_METADATA_DIRECTORY = '.claude-canvas'
const WORKSPACE_CANVAS_STATE_FILE = 'canvas.json'
const DIAGRAM_INBOX_DIRECTORY = join(WORKSPACE_METADATA_DIRECTORY, 'diagram-inbox')
const DIAGRAM_REQUESTS_DIRECTORY = join(DIAGRAM_INBOX_DIRECTORY, 'requests')
const DIAGRAM_INDEX_PATH = join(DIAGRAM_INBOX_DIRECTORY, 'index.json')

const DEFAULT_CONFIG = {
  workspaces: [],
  activeWorkspace: 0,
  windowState: {
    width: 1480,
    height: 920,
    isMaximized: false
  },
  ui: {
    darkMode: true,
    sidebarCollapsed: false,
    sidebarSide: 'left',
    sidebarWidth: 320
  }
}

export const EMPTY_CANVAS_STATE = {
  version: 1,
  tiles: [],
  viewport: {
    panX: 0,
    panY: 0,
    zoom: 1
  }
}

export async function pathExists(targetPath) {
  try {
    await stat(targetPath)
    return true
  } catch {
    return false
  }
}

async function ensureParentDirectory(targetPath) {
  await mkdir(dirname(targetPath), { recursive: true })
}

async function readJson(targetPath, fallback) {
  try {
    const content = await readFile(targetPath, 'utf8')
    return JSON.parse(content)
  } catch {
    return fallback
  }
}

async function writeJson(targetPath, value) {
  await ensureParentDirectory(targetPath)
  await writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

export function sanitizeConfig(input) {
  const workspaces = Array.isArray(input?.workspaces)
    ? input.workspaces.filter((workspace) => typeof workspace === 'string')
    : []

  const activeWorkspace =
    typeof input?.activeWorkspace === 'number'
      ? Math.min(Math.max(input.activeWorkspace, 0), Math.max(workspaces.length - 1, 0))
      : 0

  return {
    ...DEFAULT_CONFIG,
    ...input,
    workspaces,
    activeWorkspace,
    windowState: {
      ...DEFAULT_CONFIG.windowState,
      ...(input?.windowState ?? {})
    },
    ui: {
      ...DEFAULT_CONFIG.ui,
      ...(input?.ui ?? {})
    }
  }
}

export async function loadConfig() {
  await mkdir(APP_DIRECTORY, { recursive: true })
  const config = sanitizeConfig(await readJson(CONFIG_PATH, DEFAULT_CONFIG))
  await writeJson(CONFIG_PATH, config)
  return config
}

export async function saveConfig(config) {
  const sanitized = sanitizeConfig(config)
  await writeJson(CONFIG_PATH, sanitized)
  return sanitized
}

export function activeWorkspacePath(config) {
  return config.workspaces[config.activeWorkspace] ?? null
}

function normalizeWorkspaceInput(input) {
  if (typeof input !== 'string' || input.trim().length === 0) {
    return null
  }

  return input.trim()
}

export function resolveWorkspaceSelection(config, input) {
  const normalized = normalizeWorkspaceInput(input)

  if (!normalized) {
    return activeWorkspacePath(config)
  }

  if (/^\d+$/.test(normalized)) {
    const index = Number.parseInt(normalized, 10)
    return config.workspaces[index] ?? null
  }

  const resolvedInput = resolve(normalized)
  return (
    config.workspaces.find((workspacePath) => resolve(workspacePath) === resolvedInput) ??
    resolvedInput
  )
}

export async function readCanvasState(workspacePath) {
  if (!workspacePath) {
    return EMPTY_CANVAS_STATE
  }

  return readJson(
    join(workspacePath, WORKSPACE_METADATA_DIRECTORY, WORKSPACE_CANVAS_STATE_FILE),
    EMPTY_CANVAS_STATE
  )
}

export function defaultQueueIndex() {
  return {
    version: 1,
    pending: [],
    processed: [],
    failed: []
  }
}

export async function readQueueIndex(workspacePath) {
  if (!workspacePath) {
    return defaultQueueIndex()
  }

  return readJson(join(workspacePath, DIAGRAM_INDEX_PATH), defaultQueueIndex())
}

async function writeAtomicText(targetPath, content) {
  await ensureParentDirectory(targetPath)
  const tempPath = `${targetPath}.tmp`
  await writeFile(tempPath, content, 'utf8')
  await rename(tempPath, targetPath)
}

export async function ensureDiagramInbox(workspacePath) {
  await mkdir(join(workspacePath, DIAGRAM_REQUESTS_DIRECTORY), { recursive: true })
  await mkdir(join(workspacePath, DIAGRAM_INBOX_DIRECTORY, 'archive'), { recursive: true })
  await mkdir(join(workspacePath, DIAGRAM_INBOX_DIRECTORY, 'failed'), { recursive: true })

  const indexPath = join(workspacePath, DIAGRAM_INDEX_PATH)

  if (!(await pathExists(indexPath))) {
    await writeJson(indexPath, defaultQueueIndex())
  }

  return indexPath
}

export async function readPayloadFromInputPath(inputPath) {
  const content = await readFile(resolve(inputPath), 'utf8')

  if (!content.trim()) {
    throw new Error('No diagram JSON payload was provided.')
  }

  const payload = JSON.parse(content)

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Diagram payload must be a JSON object.')
  }

  return payload
}

export async function readPayloadFromStdin() {
  const content = await new Promise((resolveContent, rejectContent) => {
    let chunks = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => {
      chunks += chunk
    })
    process.stdin.on('end', () => resolveContent(chunks))
    process.stdin.on('error', rejectContent)
  })

  if (!content.trim()) {
    throw new Error('No diagram JSON payload was provided.')
  }

  const payload = JSON.parse(content)

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Diagram payload must be a JSON object.')
  }

  return payload
}

function nowIso() {
  return new Date().toISOString()
}

export async function activateOpenCanvasApp() {
  if (process.platform !== 'darwin') {
    throw new Error('The open command currently supports macOS only.')
  }

  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('osascript', ['-e', 'tell application "Open Canvas" to activate'], {
      stdio: 'ignore'
    })

    child.once('error', rejectPromise)
    child.once('exit', (code) => {
      if (code === 0) {
        resolvePromise()
        return
      }

      rejectPromise(new Error('Open Canvas could not be activated. Start the app first.'))
    })
  })
}

export async function getStatus() {
  const config = await loadConfig()
  const workspacePath = activeWorkspacePath(config)
  const queueIndex = await readQueueIndex(workspacePath)
  const canvasState = await readCanvasState(workspacePath)

  return {
    appDirectory: APP_DIRECTORY,
    configPath: CONFIG_PATH,
    workspaceCount: config.workspaces.length,
    activeWorkspace: workspacePath,
    canvasTileCount: Array.isArray(canvasState.tiles) ? canvasState.tiles.length : 0,
    queuePendingCount: Array.isArray(queueIndex.pending) ? queueIndex.pending.length : 0,
    queueProcessedCount: Array.isArray(queueIndex.processed) ? queueIndex.processed.length : 0,
    queueFailedCount: Array.isArray(queueIndex.failed) ? queueIndex.failed.length : 0
  }
}

export async function listWorkspaces() {
  const config = await loadConfig()

  return config.workspaces.map((workspacePath, index) => ({
    index,
    path: workspacePath,
    active: index === config.activeWorkspace
  }))
}

export async function addWorkspace(workspacePathInput, { select = false } = {}) {
  const workspacePath = resolve(workspacePathInput)

  if (!(await pathExists(workspacePath))) {
    throw new Error(`Workspace path does not exist: ${workspacePath}`)
  }

  const config = await loadConfig()
  const existingIndex = config.workspaces.findIndex(
    (currentPath) => resolve(currentPath) === workspacePath
  )

  let nextConfig = config

  if (existingIndex === -1) {
    nextConfig = {
      ...config,
      workspaces: [...config.workspaces, workspacePath]
    }
  }

  if (select || existingIndex === -1) {
    const nextIndex = existingIndex === -1 ? nextConfig.workspaces.length - 1 : existingIndex
    nextConfig = {
      ...nextConfig,
      activeWorkspace: nextIndex
    }
  }

  await saveConfig(nextConfig)

  return {
    activeWorkspace: activeWorkspacePath(nextConfig),
    workspacePath
  }
}

export async function useWorkspace(selection) {
  const config = await loadConfig()
  const selectedPath = resolveWorkspaceSelection(config, selection)

  if (!selectedPath) {
    throw new Error('The requested workspace was not found.')
  }

  if (!(await pathExists(selectedPath))) {
    throw new Error(`Workspace path does not exist: ${selectedPath}`)
  }

  const existingIndex = config.workspaces.findIndex(
    (workspacePath) => resolve(workspacePath) === resolve(selectedPath)
  )

  const nextConfig =
    existingIndex >= 0
      ? {
          ...config,
          activeWorkspace: existingIndex
        }
      : {
          ...config,
          workspaces: [...config.workspaces, resolve(selectedPath)],
          activeWorkspace: config.workspaces.length
        }

  await saveConfig(nextConfig)

  return {
    activeWorkspace: activeWorkspacePath(nextConfig)
  }
}

export async function clearCanvas(workspaceSelection) {
  const config = await loadConfig()
  const workspacePath = resolveWorkspaceSelection(config, workspaceSelection)

  if (!workspacePath) {
    throw new Error('No active workspace is configured.')
  }

  await writeJson(
    join(workspacePath, WORKSPACE_METADATA_DIRECTORY, WORKSPACE_CANVAS_STATE_FILE),
    EMPTY_CANVAS_STATE
  )

  return { workspacePath }
}

export async function enqueueDiagramRequest({
  inputPath,
  payload,
  requestId,
  summary,
  workspace
}) {
  const config = await loadConfig()
  const workspacePath = resolveWorkspaceSelection(config, workspace)

  if (!workspacePath) {
    throw new Error('No workspace is available for diagram enqueue.')
  }

  const nextPayload =
    payload ??
    (inputPath ? await readPayloadFromInputPath(inputPath) : await readPayloadFromStdin())

  const nextRequestId =
    (typeof requestId === 'string' && requestId) ||
    (typeof nextPayload.requestId === 'string' && nextPayload.requestId) ||
    `req_${Math.random().toString(36).slice(2, 14)}`
  const createdAt =
    (typeof nextPayload.createdAt === 'string' && nextPayload.createdAt) || nowIso()
  const promptSummary =
    (typeof summary === 'string' && summary) ||
    (typeof nextPayload.promptSummary === 'string' && nextPayload.promptSummary) ||
    'Open Canvas diagram request'

  nextPayload.version = 1
  nextPayload.skill = 'open-canvas-diagrams'
  nextPayload.requestId = nextRequestId
  nextPayload.createdAt = createdAt
  nextPayload.promptSummary = promptSummary

  await ensureDiagramInbox(workspacePath)

  const requestFileName = `${nextRequestId}.oc-diagrams.json`
  const requestPath = join(workspacePath, DIAGRAM_REQUESTS_DIRECTORY, requestFileName)
  const requestRelativePath = `.claude-canvas/diagram-inbox/requests/${requestFileName}`
  const indexPath = join(workspacePath, DIAGRAM_INDEX_PATH)
  const index = await readQueueIndex(workspacePath)

  const nextPending = Array.isArray(index.pending)
    ? index.pending.filter((entry) => entry?.requestId !== nextRequestId)
    : []

  nextPending.push({
    requestId: nextRequestId,
    file: requestRelativePath,
    promptSummary,
    createdAt
  })

  const nextIndex = {
    version: 1,
    pending: nextPending,
    processed: Array.isArray(index.processed)
      ? index.processed.filter((entry) => entry !== nextRequestId)
      : [],
    failed: Array.isArray(index.failed)
      ? index.failed.filter((entry) => entry?.requestId !== nextRequestId)
      : []
  }

  await writeAtomicText(requestPath, `${JSON.stringify(nextPayload, null, 2)}\n`)
  await writeJson(indexPath, nextIndex)

  return {
    requestId: nextRequestId,
    requestPath,
    workspacePath
  }
}
