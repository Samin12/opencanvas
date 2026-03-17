#!/usr/bin/env node

import http from 'node:http'

import {
  activateOpenCanvasApp,
  addWorkspace,
  clearCanvas,
  enqueueDiagramRequest,
  getStatus,
  listWorkspaces,
  useWorkspace
} from './open-canvas-control.mjs'

const DEFAULT_PORT = Number.parseInt(process.env.OPEN_CANVAS_CONTROL_PORT ?? '45452', 10)
const HOST = process.env.OPEN_CANVAS_CONTROL_HOST ?? '127.0.0.1'

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  })
  response.end(`${JSON.stringify(payload, null, 2)}\n`)
}

function parseJsonBody(request) {
  return new Promise((resolve, reject) => {
    let chunks = ''

    request.setEncoding('utf8')
    request.on('data', (chunk) => {
      chunks += chunk

      if (chunks.length > 2_000_000) {
        reject(new Error('Request body is too large.'))
        request.destroy()
      }
    })
    request.on('end', () => {
      if (!chunks.trim()) {
        resolve({})
        return
      }

      try {
        resolve(JSON.parse(chunks))
      } catch {
        reject(new Error('Request body must be valid JSON.'))
      }
    })
    request.on('error', reject)
  })
}

function normalizeUrlPath(requestUrl) {
  try {
    return new URL(requestUrl, `http://${HOST}:${DEFAULT_PORT}`).pathname
  } catch {
    return requestUrl
  }
}

async function handleRequest(request, response) {
  const method = request.method ?? 'GET'
  const pathname = normalizeUrlPath(request.url ?? '/')

  try {
    if (method === 'GET' && pathname === '/health') {
      sendJson(response, 200, { ok: true })
      return
    }

    if (method === 'GET' && pathname === '/status') {
      sendJson(response, 200, await getStatus())
      return
    }

    if (method === 'GET' && pathname === '/workspaces') {
      sendJson(response, 200, { workspaces: await listWorkspaces() })
      return
    }

    if (method === 'POST' && pathname === '/app/open') {
      await activateOpenCanvasApp()
      sendJson(response, 200, { ok: true })
      return
    }

    if (method === 'POST' && pathname === '/workspace/add') {
      const body = await parseJsonBody(request)
      sendJson(response, 200, await addWorkspace(body.path, { select: Boolean(body.select) }))
      return
    }

    if (method === 'POST' && pathname === '/workspace/use') {
      const body = await parseJsonBody(request)
      sendJson(response, 200, await useWorkspace(body.workspace ?? body.selection))
      return
    }

    if (method === 'POST' && pathname === '/canvas/clear') {
      const body = await parseJsonBody(request)
      sendJson(response, 200, await clearCanvas(body.workspace))
      return
    }

    if (method === 'POST' && pathname === '/diagram/enqueue') {
      const body = await parseJsonBody(request)
      sendJson(
        response,
        200,
        await enqueueDiagramRequest({
          inputPath: typeof body.inputPath === 'string' ? body.inputPath : undefined,
          payload:
            body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)
              ? body.payload
              : undefined,
          requestId: typeof body.requestId === 'string' ? body.requestId : undefined,
          summary: typeof body.summary === 'string' ? body.summary : undefined,
          workspace: typeof body.workspace === 'string' ? body.workspace : undefined
        })
      )
      return
    }

    sendJson(response, 404, {
      error: 'Not found.',
      method,
      path: pathname
    })
  } catch (error) {
    sendJson(response, 400, {
      error: error instanceof Error ? error.message : 'Open Canvas control request failed.'
    })
  }
}

const server = http.createServer((request, response) => {
  void handleRequest(request, response)
})

server.listen(DEFAULT_PORT, HOST, () => {
  process.stdout.write(
    `Open Canvas control server listening on http://${HOST}:${DEFAULT_PORT}\n`
  )
})
