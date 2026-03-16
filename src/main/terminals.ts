import * as electron from 'electron'
import * as nodePty from 'node-pty'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import type { TerminalDependencyState, TerminalSessionSnapshot } from '../shared/types'
import { APP_DIRECTORY } from './storage'

const { app, webContents } = electron
const require = createRequire(import.meta.url)

const MAX_BUFFER_SIZE = 2_000_000
const TMUX_HISTORY_LIMIT = '50000'
const TMUX_SOCKET_NAME = 'collaborator-clone'
const TERMINAL_SESSIONS_DIRECTORY = join(APP_DIRECTORY, 'terminal-sessions')
const TMUX_CONFIG_PATH = join(APP_DIRECTORY, 'tmux.conf')
const CLAUDE_START_COMMAND = process.env.COLLABORATOR_CLAUDE_COMMAND ?? 'claude'
const TMUX_DEFAULT_TERMINAL_CANDIDATES = ['tmux-256color', 'screen-256color', 'xterm-256color']
const TMUX_BINARY_CANDIDATES = [
  process.env.COLLABORATOR_TMUX_BIN,
  'tmux',
  '/opt/homebrew/bin/tmux',
  '/usr/local/bin/tmux',
  '/usr/bin/tmux'
].filter((value): value is string => Boolean(value))

function tmuxConfig(defaultTerminal: string): string {
  return `set -g status off
set -g prefix None
unbind-key C-b
set -g escape-time 0
set -g history-limit ${TMUX_HISTORY_LIMIT}
set -g default-terminal "${defaultTerminal}"
set -g mouse off
set -g alternate-screen off
set -g scroll-on-clear on
set -g focus-events on
set -g allow-passthrough on
set -g extended-keys on
`
}

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

function hasTerminfoEntry(name: string): boolean {
  const result = spawnSync('infocmp', [name], { stdio: 'ignore' })
  return result.status === 0
}

function resolveTmuxDefaultTerminal(): string {
  for (const candidate of TMUX_DEFAULT_TERMINAL_CANDIDATES) {
    if (hasTerminfoEntry(candidate)) {
      return candidate
    }
  }

  return 'xterm-256color'
}

function ensureTmuxConfig(defaultTerminal: string): void {
  ensureTerminalStorage()
  writeFileSync(TMUX_CONFIG_PATH, tmuxConfig(defaultTerminal), 'utf8')
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

function tmuxBaseArgs(defaultTerminal?: string): string[] {
  ensureTmuxConfig(defaultTerminal ?? resolveTmuxDefaultTerminal())
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

function runTmuxCommand(tmuxBinary: string, args: string[], defaultTerminal?: string): void {
  spawnSync(tmuxBinary, [...tmuxBaseArgs(defaultTerminal), ...args], { stdio: 'ignore' })
}

function tmuxTargetForSession(tmuxSessionName: string): string {
  return `${tmuxSessionName}:0.0`
}

function configureTmuxServer(tmuxBinary: string, defaultTerminal: string): void {
  runTmuxCommand(tmuxBinary, ['start-server'], defaultTerminal)
  runTmuxCommand(tmuxBinary, ['set-option', '-g', 'status', 'off'], defaultTerminal)
  runTmuxCommand(tmuxBinary, ['set-option', '-g', 'prefix', 'None'], defaultTerminal)
  runTmuxCommand(tmuxBinary, ['unbind-key', 'C-b'], defaultTerminal)
  runTmuxCommand(tmuxBinary, ['set-option', '-g', 'escape-time', '0'], defaultTerminal)
  runTmuxCommand(tmuxBinary, ['set-option', '-g', 'history-limit', TMUX_HISTORY_LIMIT], defaultTerminal)
  runTmuxCommand(tmuxBinary, ['set-option', '-g', 'default-terminal', defaultTerminal], defaultTerminal)
  runTmuxCommand(tmuxBinary, ['set-option', '-g', 'mouse', 'off'], defaultTerminal)
  runTmuxCommand(tmuxBinary, ['set-option', '-g', 'alternate-screen', 'off'], defaultTerminal)
  runTmuxCommand(tmuxBinary, ['set-option', '-g', 'scroll-on-clear', 'on'], defaultTerminal)
  runTmuxCommand(tmuxBinary, ['set-option', '-g', 'focus-events', 'on'], defaultTerminal)
  runTmuxCommand(tmuxBinary, ['set-option', '-g', 'allow-passthrough', 'on'], defaultTerminal)
  runTmuxCommand(tmuxBinary, ['set-option', '-g', 'extended-keys', 'on'], defaultTerminal)
  runTmuxCommand(tmuxBinary, ['set-option', '-gu', 'terminal-overrides'], defaultTerminal)
}

function primaryCommandName(command: string): string {
  const trimmed = command.trim()

  if (trimmed.length === 0) {
    return 'claude'
  }

  return trimmed.split(/\s+/)[0] ?? 'claude'
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function resolveCommandBinary(commandName: string): string | null {
  const result = spawnSync(defaultShell(), ['-lc', `command -v -- ${shellEscape(commandName)}`], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  })

  if (result.status !== 0) {
    return null
  }

  const resolved = result.stdout.trim().split('\n').at(-1)
  return resolved && resolved.length > 0 ? resolved : null
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

function terminalEnvironment(shell: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    COLORTERM: 'truecolor',
    SHELL: shell,
    TERM: 'xterm-256color'
  }

  delete env.CLAUDECODE

  return env
}

export function readTerminalDependencyState(): TerminalDependencyState {
  const claudeCommand = primaryCommandName(CLAUDE_START_COMMAND)

  return {
    tmuxInstalled: resolveTmuxBinary() !== null,
    claudeCommand,
    claudeInstalled: resolveCommandBinary(claudeCommand) !== null
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
  const cwd = resolveSessionCwd(options)
  ensureNodePtyHelperPermissions()

  if (!tmuxBinary) {
    throw new Error('tmux is required for terminal sessions. Install tmux and restart the app.')
  }

  const defaultTerminal = resolveTmuxDefaultTerminal()
  configureTmuxServer(tmuxBinary, defaultTerminal)
  const persisted = readPersistedTerminalSession(options.sessionId)
  const tmuxSessionName = persisted?.tmuxSessionName ?? tmuxSessionNameFor(options.sessionId)
  const sessionAlreadyExists = tmuxSessionExists(tmuxBinary, tmuxSessionName)
  const shouldAutoLaunchClaude = !sessionAlreadyExists && Boolean(options.cwd && existsSync(options.cwd))
  const pty = nodePty.spawn(
    tmuxBinary,
    [...tmuxBaseArgs(defaultTerminal), 'new-session', '-A', '-s', tmuxSessionName, '-c', cwd],
    {
      name: 'xterm-256color',
      cols: sanitizeSize(options.cols, 80),
      rows: sanitizeSize(options.rows, 24),
      cwd,
      env: terminalEnvironment(defaultShell())
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

export function readTerminalHistory(sessionId: string, limit = 50_000): string {
  const activeSession = sessions.get(sessionId)
  const persisted = readPersistedTerminalSession(sessionId)
  const tmuxSessionName = activeSession?.tmuxSessionName ?? persisted?.tmuxSessionName

  if (!tmuxSessionName) {
    return activeSession?.buffer ?? ''
  }

  const tmuxBinary = resolveTmuxBinary()

  if (!tmuxBinary) {
    return activeSession?.buffer ?? ''
  }

  const result = spawnSync(
    tmuxBinary,
    [
      ...tmuxBaseArgs(resolveTmuxDefaultTerminal()),
      'capture-pane',
      '-p',
      '-J',
      '-S',
      `-${Math.max(1, Math.floor(limit))}`,
      '-t',
      tmuxTargetForSession(tmuxSessionName)
    ],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }
  )

  if (result.status !== 0) {
    return activeSession?.buffer ?? ''
  }

  return result.stdout
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
