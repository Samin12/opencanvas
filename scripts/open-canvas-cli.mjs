#!/usr/bin/env node

import {
  activateOpenCanvasApp,
  addWorkspace,
  addFileToCanvas,
  addUrlToCanvas,
  clearCanvas,
  createNote,
  enqueueDiagramRequest,
  getStatus,
  listWorkspaces,
  useWorkspace
} from './open-canvas-control.mjs'

function printHelp() {
  console.log(`Open Canvas CLI

Usage:
  npm run cli -- status
  npm run cli -- open
  npm run cli -- workspace list
  npm run cli -- workspace add <path> [--select]
  npm run cli -- workspace use <path-or-index>
  npm run cli -- canvas clear [--workspace <path-or-index>]
  npm run cli -- canvas add-file --path <file> [--workspace <path-or-index>] [--title <text>] [--x <number>] [--y <number>]
  npm run cli -- canvas add-url --url <url> [--workspace <path-or-index>] [--title <text>] [--x <number>] [--y <number>]
  npm run cli -- note create --title <text> [--target-dir <dir>] [--workspace <path-or-index>] [--input <markdown-file>] [--x <number>] [--y <number>]
  npm run cli -- diagram enqueue --input <json-file> [--workspace <path-or-index>] [--summary <text>] [--request-id <id>]

Notes:
  - \`open\` focuses the running Open Canvas app on macOS. It does not start the dev server.
  - \`note create\` also places the new markdown file onto the canvas. Pass content via \`--input\` or pipe markdown into stdin.
  - \`canvas add-url\` creates a new embed tile for Google Slides and other supported URLs.
  - \`diagram enqueue\` accepts either Open Canvas semantic JSON or Excalidraw clipboard JSON.
`)
}

function parseOptions(args) {
  const options = {}
  const positionals = []

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index]

    if (!current.startsWith('--')) {
      positionals.push(current)
      continue
    }

    const key = current.slice(2)
    const next = args[index + 1]

    if (!next || next.startsWith('--')) {
      options[key] = true
      continue
    }

    options[key] = next
    index += 1
  }

  return { options, positionals }
}

async function main() {
  const [, , command, subcommand, ...rest] = process.argv

  try {
    if (!command || command === 'help' || command === '--help' || command === '-h') {
      printHelp()
      return
    }

    if (command === 'status') {
      const status = await getStatus()
      console.log(`App directory: ${status.appDirectory}`)
      console.log(`Config path: ${status.configPath}`)
      console.log(`Workspaces: ${status.workspaceCount}`)
      console.log(`Active workspace: ${status.activeWorkspace ?? '(none)'}`)
      console.log(`Canvas tiles: ${status.canvasTileCount}`)
      console.log(`Diagram queue pending: ${status.queuePendingCount}`)
      console.log(`Diagram queue processed: ${status.queueProcessedCount}`)
      console.log(`Diagram queue failed: ${status.queueFailedCount}`)
      return
    }

    if (command === 'open') {
      await activateOpenCanvasApp()
      console.log('Open Canvas activated.')
      return
    }

    if (command === 'workspace' && subcommand === 'list') {
      const workspaces = await listWorkspaces()

      if (workspaces.length === 0) {
        console.log('No workspaces configured.')
        return
      }

      workspaces.forEach((workspace) => {
        const marker = workspace.active ? '*' : ' '
        console.log(`${marker} [${workspace.index}] ${workspace.path}`)
      })
      return
    }

    if (command === 'workspace' && subcommand === 'add') {
      const { options, positionals } = parseOptions(rest)
      const result = await addWorkspace(positionals[0], {
        select: Boolean(options.select)
      })
      console.log(`Workspace ready: ${result.workspacePath}`)
      console.log(`Active workspace: ${result.activeWorkspace}`)
      return
    }

    if (command === 'workspace' && subcommand === 'use') {
      const { positionals } = parseOptions(rest)
      const result = await useWorkspace(positionals[0])
      console.log(`Active workspace: ${result.activeWorkspace}`)
      return
    }

    if (command === 'canvas' && subcommand === 'clear') {
      const { options } = parseOptions(rest)
      const result = await clearCanvas(options.workspace)
      console.log(`Canvas cleared: ${result.workspacePath}`)
      return
    }

    if (command === 'canvas' && subcommand === 'add-file') {
      const { options } = parseOptions(rest)

      if (typeof options.path !== 'string' || options.path.trim().length === 0) {
        throw new Error('The `canvas add-file` command requires --path <file>.')
      }

      const x = typeof options.x === 'string' ? Number.parseFloat(options.x) : undefined
      const y = typeof options.y === 'string' ? Number.parseFloat(options.y) : undefined
      const result = await addFileToCanvas({
        filePath: options.path,
        title: typeof options.title === 'string' ? options.title : undefined,
        workspace: typeof options.workspace === 'string' ? options.workspace : undefined,
        x: Number.isFinite(x) ? x : undefined,
        y: Number.isFinite(y) ? y : undefined
      })
      console.log(`Placed file on canvas: ${result.filePath}`)
      console.log(`Workspace: ${result.workspacePath}`)
      console.log(`Tile: ${result.tileId}`)
      return
    }

    if (command === 'canvas' && subcommand === 'add-url') {
      const { options } = parseOptions(rest)

      if (typeof options.url !== 'string' || options.url.trim().length === 0) {
        throw new Error('The `canvas add-url` command requires --url <url>.')
      }

      const x = typeof options.x === 'string' ? Number.parseFloat(options.x) : undefined
      const y = typeof options.y === 'string' ? Number.parseFloat(options.y) : undefined
      const result = await addUrlToCanvas({
        title: typeof options.title === 'string' ? options.title : undefined,
        url: options.url,
        workspace: typeof options.workspace === 'string' ? options.workspace : undefined,
        x: Number.isFinite(x) ? x : undefined,
        y: Number.isFinite(y) ? y : undefined
      })
      console.log(`Placed URL on canvas: ${result.url}`)
      console.log(`Workspace: ${result.workspacePath}`)
      console.log(`Tile: ${result.tileId}`)
      return
    }

    if (command === 'note' && subcommand === 'create') {
      const { options } = parseOptions(rest)

      if (typeof options.title !== 'string' || options.title.trim().length === 0) {
        throw new Error('The `note create` command requires --title <text>.')
      }

      const x = typeof options.x === 'string' ? Number.parseFloat(options.x) : undefined
      const y = typeof options.y === 'string' ? Number.parseFloat(options.y) : undefined
      const result = await createNote({
        inputPath: typeof options.input === 'string' ? options.input : undefined,
        targetDirectory:
          typeof options['target-dir'] === 'string' ? options['target-dir'] : undefined,
        title: options.title,
        workspace: typeof options.workspace === 'string' ? options.workspace : undefined,
        x: Number.isFinite(x) ? x : undefined,
        y: Number.isFinite(y) ? y : undefined
      })
      console.log(`Created note: ${result.notePath}`)
      console.log(`Workspace: ${result.workspacePath}`)
      console.log(`Tile: ${result.tileId}`)
      return
    }

    if (command === 'diagram' && subcommand === 'enqueue') {
      const { options } = parseOptions(rest)
      const result = await enqueueDiagramRequest({
        inputPath: typeof options.input === 'string' ? options.input : undefined,
        requestId: typeof options['request-id'] === 'string' ? options['request-id'] : undefined,
        summary: typeof options.summary === 'string' ? options.summary : undefined,
        workspace: typeof options.workspace === 'string' ? options.workspace : undefined
      })
      console.log(`Enqueued diagram request: ${result.requestId}`)
      console.log(`Workspace: ${result.workspacePath}`)
      console.log(`Request: ${result.requestPath}`)
      return
    }

    throw new Error('Unknown command. Run `npm run cli -- help`.')
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Open Canvas CLI failed.')
    process.exitCode = 1
  }
}

void main()
