import { basename, extname, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { stat } from 'node:fs/promises'

import type { OfficeViewerBootstrap, OfficeViewerSession, OfficeViewerStatus } from '../shared/types'

import { previewFileUrl, previewServerCallbackUrl } from './previewServer'

const HEALTHCHECK_TIMEOUT_MS = 2500
const HEALTHCHECK_CACHE_TTL_MS = 15_000

let bootstrapCache:
  | {
      expiresAt: number
      promise: Promise<OfficeViewerBootstrap> | null
      value: OfficeViewerBootstrap | null
    }
  | null = null

function normalizedOnlyOfficeUrl() {
  const configuredUrl = process.env.OPEN_CANVAS_ONLYOFFICE_URL?.trim()
  return configuredUrl ? configuredUrl.replace(/\/+$/, '') : null
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

async function fetchOfficeViewerBootstrap(): Promise<OfficeViewerBootstrap> {
  const baseUrl = normalizedOnlyOfficeUrl()

  if (!baseUrl) {
    return {
      status: 'disabled'
    }
  }

  try {
    const response = await fetchWithTimeout(`${baseUrl}/web-apps/apps/api/documents/api.js`)

    return {
      baseUrl,
      status: response.ok ? 'ready' : 'unreachable'
    }
  } catch {
    return {
      baseUrl,
      status: 'unreachable'
    }
  }
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
