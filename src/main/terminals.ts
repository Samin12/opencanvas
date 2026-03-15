import * as electron from 'electron'
import * as nodePty from 'node-pty'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import type { TerminalSessionSnapshot } from '../shared/types'
import { APP_DIRECTORY } from './storage'

const { app, webContents } = electron
const require = createRequire(import.meta.url)

const MAX_BUFFER_SIZE = 200_000
const TMUX_SOCKET_NAME = 'collaborator-clone'
const TERMINAL_SESSIONS_DIRECTORY = join(APP_DIRECTORY, 'terminal-sessions')
const TMUX_CONFIG_PATH = join(APP_DIRECTORY, 'tmux.conf')
const CLAUDE_START_COMMAND = process.env.COLLABORATOR_CLAUDE_COMMAND ?? 'claude'
const TMUX_BINARY_CANDIDATES = [
  process.env.COLLABORATOR_TMUX_BIN,
  'tmux',
  '/opt/homebrew/bin/tmux',
  '/usr/local/bin/tmux',
  '/usr/bin/tmux'
].filter((value): value is string => Boolean(value))

const TMUX_CONFIG = `set -g status off
set -g prefix None
unbind-key C-b
set -g escape-time 0
set -g history-limit 10000
set -g default-terminal "xterm-256color"
set -g mouse off
set -g focus-events on
set -g allow-passthrough on
set -g extended-keys on
set -ga terminal-overrides ",xterm-256color:smcup@:rmcup@"
`

interface ManagedTerminalSession {
  buffer: string
  cwd: string
  pty: nodePty.IPty
  sessionId: string
  tmuxSessionName: string
}

interface PersistedTerminalSessionMeta {
  createdAt: number
  cwd: string
  sessionId: string
  tmuxSessionName: string
  updatedAt: number
}

const sessions = new Map<string, ManagedTerminalSession>()

function broadcast(channel: string, payload: unknown): void {
  for (const contents of webContents.getAllWebContents()) {
    if (contents.getType() === 'window') {
      contents.send(channel, payload)
    }
  }
}

function appendToBuffer(buffer: string, chunk: string): string {
  const nextBuffer = buffer + chunk

  if (nextBuffer.length <= MAX_BUFFER_SIZE) {
    return nextBuffer
  }

  return nextBuffer.slice(nextBuffer.length - MAX_BUFFER_SIZE)
}

function defaultShell(): string {
  if (process.env.SHELL && process.env.SHELL.length > 0) {
    return process.env.SHELL
  }

  if (process.platform === 'darwin') {
    return '/bin/zsh'
  }

  return '/bin/bash'
}

function sanitizeSize(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback
  }

  return Math.max(2, Math.floor(value))
}

function sanitizeSessionId(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9_-]/g, '-')
}

function tmuxSessionNameFor(sessionId: string): string {
  return `collab-${sanitizeSessionId(sessionId)}`
}

function terminalSessionFilePath(sessionId: string): string {
  return join(TERMINAL_SESSIONS_DIRECTORY, `${sanitizeSessionId(sessionId)}.json`)
}

function ensureTerminalStorage(): void {
  mkdirSync(TERMINAL_SESSIONS_DIRECTORY, { recursive: true })
}

function ensureTmuxConfig(): void {
  ensureTerminalStorage()
  writeFileSync(TMUX_CONFIG_PATH, TMUX_CONFIG, 'utf8')
}

function readPersistedTerminalSession(
  sessionId: string
): PersistedTerminalSessionMeta | null {
  try {
    const content = readFileSync(terminalSessionFilePath(sessionId), 'utf8')
    const parsed = JSON.parse(content) as PersistedTerminalSessionMeta

    if (
      typeof parsed.cwd === 'string' &&
      typeof parsed.sessionId === 'string' &&
      typeof parsed.tmuxSessionName === 'string'
    ) {
      return parsed
    }

    return null
  } catch {
    return null
  }
}

function writePersistedTerminalSession(meta: PersistedTerminalSessionMeta): void {
  ensureTerminalStorage()
  writeFileSync(terminalSessionFilePath(meta.sessionId), `${JSON.stringify(meta, null, 2)}\n`, 'utf8')
}

function removePersistedTerminalSession(sessionId: string): void {
  rmSync(terminalSessionFilePath(sessionId), { force: true })
}

function tmuxBaseArgs(): string[] {
  ensureTmuxConfig()
  return ['-L', TMUX_SOCKET_NAME, '-f', TMUX_CONFIG_PATH]
}

function resolveTmuxBinary(): string | null {
  for (const candidate of TMUX_BINARY_CANDIDATES) {
    const result = spawnSync(candidate, ['-V'], { stdio: 'ignore' })

    if (result.status === 0) {
      return candidate
    }
  }

  return null
}

function tmuxSessionExists(tmuxBinary: string, tmuxSessionName: string): boolean {
  const result = spawnSync(tmuxBinary, [...tmuxBaseArgs(), 'has-session', '-t', tmuxSessionName], {
    stdio: 'ignore'
  })
  return result.status === 0
}

function resolveSessionCwd(options: {
  cwd?: string
  sessionId: string
}): string {
  const persisted = readPersistedTerminalSession(options.sessionId)

  if (persisted?.cwd && existsSync(persisted.cwd)) {
    return persisted.cwd
  }

  if (options.cwd && existsSync(options.cwd)) {
    return options.cwd
  }

  return homedir()
}

function persistTerminalSessionMeta(meta: {
  cwd: string
  sessionId: string
  tmuxSessionName: string
}): void {
  const existing = readPersistedTerminalSession(meta.sessionId)
  const now = Date.now()

  writePersistedTerminalSession({
    sessionId: meta.sessionId,
    cwd: meta.cwd,
    tmuxSessionName: meta.tmuxSessionName,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  })
}

function ensureNodePtyHelperPermissions(): void {
  if (process.platform === 'win32') {
    return
  }

  try {
    const nodePtyRoot = dirname(require.resolve('node-pty/package.json'))
    const helperPath = join(nodePtyRoot, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper')

    if (existsSync(helperPath)) {
      chmodSync(helperPath, 0o755)
    }
  } catch {
    // Ignore if the helper path cannot be resolved; spawn will surface the real error.
  }
}

export function createOrAttachTerminalSession(options: {
  cols: number
  cwd?: string
  rows: number
  sessionId: string
}): TerminalSessionSnapshot {
  const existing = sessions.get(options.sessionId)

  if (existing) {
    persistTerminalSessionMeta(existing)
    return {
      sessionId: existing.sessionId,
      cwd: existing.cwd,
      buffer: existing.buffer
    }
  }

  const tmuxBinary = resolveTmuxBinary()

  if (!tmuxBinary) {
    throw new Error('tmux is required for persistent terminal sessions but was not found.')
  }

  const persisted = readPersistedTerminalSession(options.sessionId)
  const cwd = resolveSessionCwd(options)
  const tmuxSessionName = persisted?.tmuxSessionName ?? tmuxSessionNameFor(options.sessionId)
  const sessionAlreadyExists = tmuxSessionExists(tmuxBinary, tmuxSessionName)
  const shouldAutoLaunchClaude = !sessionAlreadyExists && Boolean(options.cwd && existsSync(options.cwd))
  ensureNodePtyHelperPermissions()
  const pty = nodePty.spawn(
    tmuxBinary,
    [...tmuxBaseArgs(), 'new-session', '-A', '-s', tmuxSessionName, '-c', cwd],
    {
      name: 'xterm-256color',
      cols: sanitizeSize(options.cols, 80),
      rows: sanitizeSize(options.rows, 24),
      cwd,
      env: {
        ...process.env,
        COLORTERM: 'truecolor',
        SHELL: defaultShell(),
        TERM: 'xterm-256color'
      }
    }
  )

  const session: ManagedTerminalSession = {
    sessionId: options.sessionId,
    cwd,
    buffer: '',
    pty,
    tmuxSessionName
  }

  persistTerminalSessionMeta(session)

  pty.onData((data) => {
    session.buffer = appendToBuffer(session.buffer, data)
    broadcast(`terminal:data:${session.sessionId}`, data)
  })

  pty.onExit((event) => {
    broadcast(`terminal:exit:${session.sessionId}`, event)
    sessions.delete(session.sessionId)

    if (!tmuxSessionExists(tmuxBinary, session.tmuxSessionName)) {
      removePersistedTerminalSession(session.sessionId)
    }
  })

  sessions.set(options.sessionId, session)

  if (shouldAutoLaunchClaude) {
    setTimeout(() => {
      const activeSession = sessions.get(session.sessionId)

      if (!activeSession) {
        return
      }

      activeSession.pty.write(`${CLAUDE_START_COMMAND}\r`)
    }, 180)
  }

  return {
    sessionId: session.sessionId,
    cwd: session.cwd,
    buffer: session.buffer
  }
}

export function resizeTerminalSession(sessionId: string, cols: number, rows: number): void {
  const session = sessions.get(sessionId)

  if (!session) {
    return
  }

  session.pty.resize(sanitizeSize(cols, 80), sanitizeSize(rows, 24))
}

export function writeTerminalInput(sessionId: string, data: string): void {
  const session = sessions.get(sessionId)

  if (!session) {
    return
  }

  session.pty.write(data)
}

export function releaseTerminalSession(sessionId: string): void {
  const session = sessions.get(sessionId)

  if (!session) {
    return
  }

  sessions.delete(sessionId)

  try {
    session.pty.kill()
  } catch {
    // Best effort cleanup.
  }
}

export function disposeTerminalSessions(): void {
  for (const sessionId of sessions.keys()) {
    releaseTerminalSession(sessionId)
  }
}

app.on('before-quit', () => {
  disposeTerminalSessions()
})
