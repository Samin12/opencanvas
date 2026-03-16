import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { extname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

type PreviewAudience = 'local' | 'onlyoffice'

interface PreviewServerState {
  externalBaseUrl: string
  localBaseUrl: string
  pathsByToken: Map<string, string>
  port: number
  tokensByPath: Map<string, string>
}

const DEFAULT_LOCAL_HOST = '127.0.0.1'
const DEFAULT_BIND_HOST = '0.0.0.0'
const DEFAULT_ONLYOFFICE_ALIAS = 'host.docker.internal'

const MIME_TYPES = new Map<string, string>([
  ['.avi', 'video/x-msvideo'],
  ['.csv', 'text/csv; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.json', 'application/json; charset=utf-8'],
  ['.m4v', 'video/x-m4v'],
  ['.md', 'text/markdown; charset=utf-8'],
  ['.mkv', 'video/x-matroska'],
  ['.mov', 'video/quicktime'],
  ['.mp4', 'video/mp4'],
  ['.odp', 'application/vnd.oasis.opendocument.presentation'],
  ['.ods', 'application/vnd.oasis.opendocument.spreadsheet'],
  ['.pdf', 'application/pdf'],
  ['.png', 'image/png'],
  ['.ppt', 'application/vnd.ms-powerpoint'],
  ['.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ['.svg', 'image/svg+xml'],
  ['.tsv', 'text/tab-separated-values; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.webm', 'video/webm'],
  ['.webp', 'image/webp'],
  ['.xls', 'application/vnd.ms-excel'],
  ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
])

let previewServerPromise: Promise<PreviewServerState> | null = null

function headerContentType(filePath: string) {
  return MIME_TYPES.get(extname(filePath).toLowerCase()) ?? 'application/octet-stream'
}

function parseRequestedPort() {
  const rawValue = process.env.OPEN_CANVAS_PREVIEW_SERVER_PORT?.trim()

  if (!rawValue) {
    return 0
  }

  const parsed = Number(rawValue)

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

function previewAliasHost() {
  return process.env.OPEN_CANVAS_PREVIEW_HOST_ALIAS?.trim() || DEFAULT_ONLYOFFICE_ALIAS
}

function previewToken(state: PreviewServerState, filePath: string) {
  const resolvedPath = resolve(filePath)
  const existing = state.tokensByPath.get(resolvedPath)

  if (existing) {
    return existing
  }

  const token = randomUUID()
  state.tokensByPath.set(resolvedPath, token)
  state.pathsByToken.set(token, resolvedPath)
  return token
}

function setCommonHeaders(response: ServerResponse, filePath?: string) {
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,POST,OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type,Range')
  response.setHeader('Accept-Ranges', 'bytes')

  if (filePath) {
    response.setHeader('Content-Type', headerContentType(filePath))
  }
}

function parseRangeHeader(rangeHeader: string, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim())

  if (!match) {
    return null
  }

  const [, startText, endText] = match
  let start = startText ? Number(startText) : Number.NaN
  let end = endText ? Number(endText) : Number.NaN

  if (Number.isNaN(start) && Number.isNaN(end)) {
    return null
  }

  if (Number.isNaN(start)) {
    const suffixLength = end

    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return null
    }

    start = Math.max(size - suffixLength, 0)
    end = size - 1
  } else {
    if (Number.isNaN(end) || end >= size) {
      end = size - 1
    }

    if (start > end || start < 0) {
      return null
    }
  }

  return { end, start }
}

async function servePreviewFile(
  filePath: string,
  request: IncomingMessage,
  response: ServerResponse
) {
  try {
    const fileStats = await stat(filePath)

    if (!fileStats.isFile()) {
      response.statusCode = 404
      response.end('Not found')
      return
    }

    setCommonHeaders(response, filePath)
    response.setHeader('Cache-Control', 'private, max-age=60')
    response.setHeader('Last-Modified', new Date(fileStats.mtimeMs).toUTCString())

    const rangeHeader = request.headers.range

    if (typeof rangeHeader === 'string') {
      const range = parseRangeHeader(rangeHeader, fileStats.size)

      if (!range) {
        response.statusCode = 416
        response.setHeader('Content-Range', `bytes */${fileStats.size}`)
        response.end()
        return
      }

      response.statusCode = 206
      response.setHeader('Content-Length', String(range.end - range.start + 1))
      response.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${fileStats.size}`)

      if (request.method === 'HEAD') {
        response.end()
        return
      }

      createReadStream(filePath, { end: range.end, start: range.start }).pipe(response)
      return
    }

    response.statusCode = 200
    response.setHeader('Content-Length', String(fileStats.size))

    if (request.method === 'HEAD') {
      response.end()
      return
    }

    createReadStream(filePath).pipe(response)
  } catch {
    response.statusCode = 404
    response.end('Not found')
  }
}

function handleOnlyOfficeCallback(response: ServerResponse) {
  setCommonHeaders(response)
  response.statusCode = 200
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify({ error: 0 }))
}

async function requestHandler(
  state: PreviewServerState,
  request: IncomingMessage,
  response: ServerResponse
) {
  const url = new URL(request.url ?? '/', `http://${DEFAULT_LOCAL_HOST}`)

  if (request.method === 'OPTIONS') {
    setCommonHeaders(response)
    response.statusCode = 204
    response.end()
    return
  }

  if (url.pathname === '/health') {
    setCommonHeaders(response)
    response.statusCode = 200
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.end(JSON.stringify({ ok: true }))
    return
  }

  if (url.pathname === '/onlyoffice/callback') {
    handleOnlyOfficeCallback(response)
    return
  }

  const tokenMatch = /^\/files\/([^/]+)$/.exec(url.pathname)

  if (!tokenMatch) {
    response.statusCode = 404
    response.end('Not found')
    return
  }

  const filePath = state.pathsByToken.get(tokenMatch[1])

  if (!filePath) {
    response.statusCode = 404
    response.end('Not found')
    return
  }

  await servePreviewFile(filePath, request, response)
}

export async function ensurePreviewServer() {
  if (previewServerPromise) {
    return previewServerPromise
  }

  previewServerPromise = new Promise<PreviewServerState>((resolvePromise, rejectPromise) => {
    const requestedPort = parseRequestedPort()
    const server = createServer((request, response) => {
      void requestHandler(state, request, response).catch(() => {
        response.statusCode = 500
        response.end('Internal server error')
      })
    })

    server.once('error', (error) => {
      previewServerPromise = null
      rejectPromise(error)
    })

    const state: PreviewServerState = {
      externalBaseUrl: '',
      localBaseUrl: '',
      pathsByToken: new Map(),
      port: 0,
      tokensByPath: new Map()
    }

    server.listen(requestedPort, DEFAULT_BIND_HOST, () => {
      const address = server.address()

      if (!address || typeof address === 'string') {
        previewServerPromise = null
        rejectPromise(new Error('Preview server did not expose a TCP port'))
        return
      }

      state.port = address.port
      state.localBaseUrl = `http://${DEFAULT_LOCAL_HOST}:${address.port}`
      state.externalBaseUrl = `http://${previewAliasHost()}:${address.port}`
      resolvePromise(state)
    })
  })

  return previewServerPromise
}

export async function previewFileUrl(filePath: string, audience: PreviewAudience = 'local') {
  const state = await ensurePreviewServer()
  const token = previewToken(state, filePath)
  const baseUrl = audience === 'onlyoffice' ? state.externalBaseUrl : state.localBaseUrl

  return `${baseUrl}/files/${token}`
}

export async function previewServerHealthUrl() {
  const state = await ensurePreviewServer()
  return `${state.localBaseUrl}/health`
}

export async function previewServerCallbackUrl() {
  const state = await ensurePreviewServer()
  return `${state.externalBaseUrl}/onlyoffice/callback`
}
