import * as electron from 'electron'
import { spawn, spawnSync } from 'node:child_process'
import { basename, extname, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { stat } from 'node:fs/promises'

import type { OfficeViewerBootstrap, OfficeViewerSession, OfficeViewerStatus } from '../shared/types'

import { previewFileUrl, previewServerCallbackUrl } from './previewServer'

const { app } = electron

const DEFAULT_ONLYOFFICE_URL = 'http://127.0.0.1:8080'
const HEALTHCHECK_TIMEOUT_MS = 2500
const HEALTHCHECK_CACHE_TTL_MS = 15_000
const OFFICE_BOOT_TIMEOUT_MS = 20_000
const OFFICE_BOOT_POLL_INTERVAL_MS = 1200

let bootstrapCache:
  | {
      expiresAt: number
      promise: Promise<OfficeViewerBootstrap> | null
      value: OfficeViewerBootstrap | null
    }
  | null = null

function normalizedOnlyOfficeUrl() {
  const configuredUrl = process.env.OPEN_CANVAS_ONLYOFFICE_URL?.trim()

  if (configuredUrl?.toLowerCase() === 'disabled') {
    return null
  }

  return configuredUrl ? configuredUrl.replace(/\/+$/, '') : DEFAULT_ONLYOFFICE_URL
}

function officeExtension(filePath: string) {
  return extname(filePath).toLowerCase()
}

function officeDocumentType(filePath: string): OfficeViewerSession['documentType'] {
  const extension = officeExtension(filePath)

  if (extension === '.csv' || extension === '.tsv' || extension === '.xls' || extension === '.xlsx' || extension === '.ods') {
    return 'cell'
  }

  if (extension === '.ppt' || extension === '.pptx' || extension === '.odp') {
    return 'slide'
  }

  throw new Error('This file type is not supported by the office viewer.')
}

function officeDocumentKind(filePath: string): OfficeViewerSession['kind'] {
  return officeDocumentType(filePath) === 'cell' ? 'spreadsheet' : 'presentation'
}

async function fetchWithTimeout(url: string) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HEALTHCHECK_TIMEOUT_MS)

  try {
    return await fetch(url, { signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function pathExists(targetPath: string) {
  try {
    await stat(targetPath)
    return true
  } catch {
    return false
  }
}

function bundledComposeFileCandidates() {
  return Array.from(
    new Set([
      join(process.cwd(), 'docker-compose.onlyoffice.yml'),
      join(app.getAppPath(), 'docker-compose.onlyoffice.yml'),
      join(process.resourcesPath, 'docker-compose.onlyoffice.yml')
    ])
  )
}

async function resolveComposeFilePath() {
  for (const candidate of bundledComposeFileCandidates()) {
    if (await pathExists(candidate)) {
      return candidate
    }
  }

  return null
}

function dockerInstalled() {
  const result = spawnSync('docker', ['--version'], {
    stdio: 'ignore'
  })

  return !result.error && result.status === 0
}

async function officeViewerMetadata(baseUrl: string | null) {
  const composeFilePath = await resolveComposeFilePath()
  const setupCommand = composeFilePath
    ? `docker compose -f "${composeFilePath}" up -d`
    : 'npm run office:up'
  const dockerAvailable = dockerInstalled()

  if (!baseUrl) {
    return {
      detail: 'The ONLYOFFICE viewer is disabled for this build. Open this file externally or enable the document server.',
      setupAvailable: false,
      setupCommand
    }
  }

  if (composeFilePath && dockerAvailable) {
    return {
      detail: `The ONLYOFFICE document server is unavailable. Start it with \`${setupCommand}\`, then refresh this tile.`,
      setupAvailable: true,
      setupCommand
    }
  }

  if (composeFilePath) {
    return {
      detail: `Install Docker Desktop or Docker Engine, then run \`${setupCommand}\` to enable in-canvas Office viewing.`,
      setupAvailable: false,
      setupCommand
    }
  }

  return {
    detail:
      'The ONLYOFFICE helper is unavailable in this build. Open the file externally, or run `npm run office:up` from the repository root when developing locally.',
    setupAvailable: false,
    setupCommand
  }
}

async function fetchOfficeViewerBootstrap(): Promise<OfficeViewerBootstrap> {
  const baseUrl = normalizedOnlyOfficeUrl()
  const metadata = await officeViewerMetadata(baseUrl)

  if (!baseUrl) {
    return {
      detail: metadata.detail,
      setupAvailable: metadata.setupAvailable,
      setupCommand: metadata.setupCommand,
      status: 'disabled'
    }
  }

  try {
    const response = await fetchWithTimeout(`${baseUrl}/web-apps/apps/api/documents/api.js`)

    return {
      baseUrl,
      detail: response.ok ? undefined : metadata.detail,
      setupAvailable: metadata.setupAvailable,
      setupCommand: metadata.setupCommand,
      status: response.ok ? 'ready' : 'unreachable'
    }
  } catch {
    return {
      baseUrl,
      detail: metadata.detail,
      setupAvailable: metadata.setupAvailable,
      setupCommand: metadata.setupCommand,
      status: 'unreachable'
    }
  }
}

function sleep(durationMs: number) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, durationMs)
  })
}

async function runOfficeViewerSetup(composeFilePath: string) {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn('docker', ['compose', '-f', composeFilePath, 'up', '-d'], {
      stdio: 'ignore'
    })

    child.once('error', rejectPromise)
    child.once('exit', (code) => {
      if (code === 0) {
        resolvePromise()
        return
      }

      rejectPromise(new Error('The ONLYOFFICE helper could not be started.'))
    })
  })
}

export async function readOfficeViewerBootstrap(options?: {
  force?: boolean
}): Promise<OfficeViewerBootstrap> {
  const force = Boolean(options?.force)
  const now = Date.now()

  if (!force && bootstrapCache?.value && bootstrapCache.expiresAt > now) {
    return bootstrapCache.value
  }

  if (!force && bootstrapCache?.promise) {
    return bootstrapCache.promise
  }

  const promise = fetchOfficeViewerBootstrap().then((value) => {
    bootstrapCache = {
      expiresAt: Date.now() + HEALTHCHECK_CACHE_TTL_MS,
      promise: null,
      value
    }
    return value
  })

  bootstrapCache = {
    expiresAt: now + HEALTHCHECK_CACHE_TTL_MS,
    promise,
    value: force ? null : bootstrapCache?.value ?? null
  }

  try {
    return await promise
  } catch (error) {
    bootstrapCache = null
    throw error
  }
}

export async function readOfficeViewerStatus(): Promise<OfficeViewerStatus> {
  const bootstrap = await readOfficeViewerBootstrap()
  return bootstrap.status
}

export async function ensureOfficeViewer(): Promise<OfficeViewerBootstrap> {
  const initialBootstrap = await readOfficeViewerBootstrap({ force: true })

  if (initialBootstrap.status === 'ready') {
    return initialBootstrap
  }

  const composeFilePath = await resolveComposeFilePath()

  if (!composeFilePath || !dockerInstalled()) {
    return initialBootstrap
  }

  try {
    await runOfficeViewerSetup(composeFilePath)
  } catch {
    return readOfficeViewerBootstrap({ force: true })
  }

  const startTime = Date.now()

  while (Date.now() - startTime < OFFICE_BOOT_TIMEOUT_MS) {
    const bootstrap = await readOfficeViewerBootstrap({ force: true })

    if (bootstrap.status === 'ready') {
      return bootstrap
    }

    await sleep(OFFICE_BOOT_POLL_INTERVAL_MS)
  }

  const bootstrap = await readOfficeViewerBootstrap({ force: true })

  if (bootstrap.status !== 'ready') {
    return {
      ...bootstrap,
      detail:
        bootstrap.detail ??
        'The ONLYOFFICE helper is still starting. Wait a few seconds, then retry.'
    }
  }

  return bootstrap
}

export async function createOfficeViewerSession(filePath: string): Promise<OfficeViewerSession> {
  const resolvedFilePath = resolve(filePath)
  const officeViewer = await readOfficeViewerBootstrap()

  if (officeViewer.status !== 'ready' || !officeViewer.baseUrl) {
    throw new Error('The ONLYOFFICE document server is unavailable.')
  }

  const fileStats = await stat(resolvedFilePath)
  const documentType = officeDocumentType(resolvedFilePath)
  const documentUrl = await previewFileUrl(resolvedFilePath, 'onlyoffice')
  const callbackUrl = await previewServerCallbackUrl()
  const hash = createHash('sha1')
    .update(`${resolvedFilePath}:${fileStats.mtimeMs}:${fileStats.size}`)
    .digest('hex')

  return {
    callbackUrl,
    documentKey: hash,
    documentServerUrl: officeViewer.baseUrl,
    documentType,
    documentUrl,
    filePath: resolvedFilePath,
    kind: officeDocumentKind(resolvedFilePath),
    title: basename(resolvedFilePath)
  }
}
