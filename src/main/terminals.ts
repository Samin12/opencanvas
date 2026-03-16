import * as electron from 'electron'
import * as nodePty from 'node-pty'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import type {
  TerminalActivityItem,
  TerminalActivityState,
  TerminalDependencyState,
  TerminalProvider,
  TerminalSessionSnapshot
} from '../shared/types'
import { APP_DIRECTORY } from './storage'

const { app, webContents } = electron
const require = createRequire(import.meta.url)

const MAX_BUFFER_SIZE = 2_000_000
const MAX_ACTIVITY_ITEMS = 240
const ACTIVITY_REPLAY_SUPPRESSION_MS = 1_500
const TMUX_HISTORY_LIMIT = '50000'
const TMUX_SOCKET_NAME = process.env.OPEN_CANVAS_TMUX_SOCKET?.trim() || 'collaborator-clone'
const TERMINAL_SESSIONS_DIRECTORY = join(APP_DIRECTORY, 'terminal-sessions')
const TMUX_CONFIG_PATH = join(APP_DIRECTORY, 'tmux.conf')
const TERMINAL_START_COMMANDS: Record<TerminalProvider, string> = {
  claude: process.env.COLLABORATOR_CLAUDE_COMMAND ?? 'claude',
  codex: process.env.COLLABORATOR_CODEX_COMMAND ?? 'codex'
}
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

interface TerminalActivityParserState {
  afterClaudePrompt: boolean
  captureReplayCounts: Map<string, number> | null
  nextId: number
  pendingBlockLines: string[] | null
  pendingMessageLines: string[] | null
  pendingText: string
  replaySuppressionCounts: Map<string, number>
  replaySuppressionUntil: number
}

interface ManagedTerminalSession {
  activities: TerminalActivityItem[]
  buffer: string
  cwd: string
  parser: TerminalActivityParserState
  pty: nodePty.IPty
  provider: TerminalProvider
  sessionId: string
  tmuxSessionName: string
}

interface PersistedTerminalSessionMeta {
  createdAt: number
  cwd: string
  provider: TerminalProvider
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

function stripAnsi(text: string): string {
  return text
    .replace(/\u001B\[(\d*)C/g, (_match, rawCount: string) => ' '.repeat(Math.max(1, Number.parseInt(rawCount || '1', 10) || 1)))
    .replace(
    // Strip common CSI/OSC/DCS terminal escapes before activity parsing.
    /\u001B(?:\][^\u0007]*(?:\u0007|\u001B\\)|P[\s\S]*?\u001B\\|[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g,
    ''
    )
}

function normalizeTerminalText(text: string): string {
  return stripAnsi(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function makeParserState(): TerminalActivityParserState {
  return {
    afterClaudePrompt: false,
    captureReplayCounts: null,
    nextId: 1,
    pendingBlockLines: null,
    pendingMessageLines: null,
    pendingText: '',
    replaySuppressionCounts: new Map(),
    replaySuppressionUntil: 0
  }
}

function activityStateForStatus(status: string | null): TerminalActivityState {
  const normalizedStatus = status?.trim().toLowerCase() ?? ''

  if (
    normalizedStatus.includes('fail') ||
    normalizedStatus.includes('error') ||
    normalizedStatus.includes('killed')
  ) {
    return 'error'
  }

  if (
    normalizedStatus.includes('done') ||
    normalizedStatus.includes('complete') ||
    normalizedStatus.includes('success')
  ) {
    return 'success'
  }

  if (normalizedStatus.length > 0) {
    return 'working'
  }

  return 'info'
}

function extractTaggedValue(block: string, tagName: string): string | undefined {
  const match = block.match(new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, 'i'))
  const value = match?.[1]?.trim()
  return value && value.length > 0 ? value : undefined
}

function capitalize(value: string): string {
  if (value.length === 0) {
    return value
  }

  return `${value[0].toUpperCase()}${value.slice(1)}`
}

function providerLabel(provider: TerminalProvider): string {
  return provider === 'codex' ? 'Codex' : 'Claude Code'
}

function providerCommand(provider: TerminalProvider): string {
  return TERMINAL_START_COMMANDS[provider]
}

function providerCommandName(provider: TerminalProvider): string {
  return primaryCommandName(providerCommand(provider))
}

function messageTitle(body: string, provider: TerminalProvider): string {
  for (const line of body.split('\n')) {
    const trimmed = line.trim().replace(/^[-*#>\d.\s]+/, '').trim()

    if (trimmed.length > 0) {
      return trimmed.length > 88 ? `${trimmed.slice(0, 87)}…` : trimmed
    }
  }

  return provider === 'codex' ? 'Codex Response' : 'Claude Response'
}

function stripClaudeLeadMarker(value: string): string {
  return value.replace(/^[⏺●•]\s+/u, '')
}

function normalizeClaudeMessageLine(line: string): string {
  return line.replace(/\s+$/g, '').replace(/^\s{0,2}/, '')
}

function isClaudeUiBoundaryLine(trimmed: string): boolean {
  return (
    /^[╭╰│]/u.test(trimmed) ||
    /^[▐▛▜▝▘]+/u.test(trimmed) ||
    /^[─━]{8,}$/u.test(trimmed) ||
    /^claude code v/i.test(trimmed) ||
    /^codex cli\b/i.test(trimmed) ||
    /^opus\b/i.test(trimmed) ||
    /^esc to interrupt/i.test(trimmed) ||
    /^[/?] for shortcuts/i.test(trimmed)
  )
}

function isClaudePromptLine(trimmed: string): boolean {
  return /^(❯|›|>)\s*/u.test(trimmed)
}

function isClaudeMessageStart(line: string): boolean {
  const trimmed = line.trim()

  if (!/^[⏺●•]\s+/u.test(trimmed)) {
    return false
  }

  return parseLineActivity(trimmed) === null
}

function createMessageActivity(body: string, provider: TerminalProvider) {
  const trimmedBody = body.trim()

  if (trimmedBody.length === 0) {
    return null
  }

  return {
    body: trimmedBody,
    item: {
      body: trimmedBody,
      kind: 'message' as const,
      rawText: trimmedBody,
      state: 'info' as const,
      title: messageTitle(trimmedBody, provider)
    },
    key: `message:${trimmedBody}`
  }
}

function flushPendingMessage(session: ManagedTerminalSession, shouldBroadcast: boolean): void {
  if (!session.parser.pendingMessageLines) {
    return
  }

  const body = session.parser.pendingMessageLines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  session.parser.pendingMessageLines = null

  const parsed = createMessageActivity(body, session.provider)

  if (parsed) {
    pushActivity(session, parsed, shouldBroadcast)
  }

  session.parser.afterClaudePrompt = false
}

function readLikePath(value: string): string | undefined {
  const trimmed = value.trim()

  if (trimmed.length === 0) {
    return undefined
  }

  if (
    trimmed.startsWith('/') ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('../') ||
    trimmed.includes('.')
  ) {
    return trimmed
  }

  return undefined
}

function parseTaskNotification(block: string) {
  const summary = extractTaggedValue(block, 'summary')
  const status = extractTaggedValue(block, 'status')
  const outputPath = extractTaggedValue(block, 'output-file')
  const toolUse = extractTaggedValue(block, 'tool-use')
  const taskId = extractTaggedValue(block, 'task-id')
  const state = activityStateForStatus(status ?? null)
  const statusLabel = status ? capitalize(status) : 'Update'
  const title =
    summary ??
    (outputPath ? `${statusLabel}: output ready` : taskId ? `${statusLabel}: ${taskId}` : statusLabel)
  const body = [
    summary,
    toolUse ? `Tool: ${toolUse}` : null,
    outputPath ? `Output: ${outputPath}` : null,
    status ? `Status: ${status}` : null
  ]
    .filter((value): value is string => Boolean(value))
    .join('\n')

  return {
    body,
    filePath: outputPath,
    item: {
      body,
      kind: outputPath ? ('output' as const) : ('task' as const),
      outputPath,
      rawText: block.trim(),
      state,
      title
    },
    key: `task:${taskId ?? summary ?? block.trim()}`
  }
}

function parseLineActivity(line: string) {
  const trimmed = stripClaudeLeadMarker(line.trim())

  if (trimmed.length === 0) {
    return null
  }

  const readMatch = trimmed.match(/^Read\s+(.+)$/i)

  if (readMatch) {
    const filePath = readLikePath(readMatch[1] ?? '')
    return {
      body: trimmed,
      filePath,
      item: {
        body: trimmed,
        kind: 'read' as const,
        rawText: trimmed,
        state: 'info' as const,
        title: filePath ? `Read ${filePath}` : 'Read'
      },
      key: `read:${trimmed}`
    }
  }

  const actionMatch = trimmed.match(/^(Write|Update)\((.+?)\)/i)

  if (actionMatch) {
    const filePath = readLikePath(actionMatch[2] ?? '')
    return {
      body: trimmed,
      filePath,
      item: {
        body: trimmed,
        kind: 'write' as const,
        rawText: trimmed,
        state: 'working' as const,
        title: filePath ? `${capitalize(actionMatch[1] ?? 'Write')} ${filePath}` : trimmed
      },
      key: `write:${trimmed}`
    }
  }

  const exitMatch = trimmed.match(/^Exit code\s+(-?\d+)/i)

  if (exitMatch) {
    const exitCode = Number.parseInt(exitMatch[1] ?? '0', 10)
    return {
      body: trimmed,
      item: {
        body: trimmed,
        kind: 'exit' as const,
        rawText: trimmed,
        state: exitCode === 0 ? ('success' as const) : ('error' as const),
        title: exitCode === 0 ? 'Command exited successfully' : `Command exited with code ${exitCode}`
      },
      key: `exit:${trimmed}`
    }
  }

  if (/error/i.test(trimmed) || /failed/i.test(trimmed)) {
    return {
      body: trimmed,
      item: {
        body: trimmed,
        kind: 'error' as const,
        rawText: trimmed,
        state: 'error' as const,
        title: trimmed
      },
      key: `error:${trimmed}`
    }
  }

  if (/^Done\./.test(trimmed) || /^\*\s+/.test(trimmed)) {
    return {
      body: trimmed,
      item: {
        body: trimmed,
        kind: 'status' as const,
        rawText: trimmed,
        state: 'success' as const,
        title: trimmed
      },
      key: `status:${trimmed}`
    }
  }

  return null
}

function pushActivity(
  session: ManagedTerminalSession,
  parsed: {
    body: string
    filePath?: string
    item: Omit<TerminalActivityItem, 'createdAt' | 'filePath' | 'id'>
    key: string
  },
  shouldBroadcast: boolean
): void {
  const now = Date.now()

  if (session.parser.captureReplayCounts) {
    session.parser.captureReplayCounts.set(
      parsed.key,
      (session.parser.captureReplayCounts.get(parsed.key) ?? 0) + 1
    )
  }

  if (session.parser.replaySuppressionUntil > now) {
    const remaining = session.parser.replaySuppressionCounts.get(parsed.key) ?? 0

    if (remaining > 0) {
      if (remaining === 1) {
        session.parser.replaySuppressionCounts.delete(parsed.key)
      } else {
        session.parser.replaySuppressionCounts.set(parsed.key, remaining - 1)
      }

      return
    }
  }

  const activity: TerminalActivityItem = {
    ...parsed.item,
    createdAt: now,
    filePath: parsed.filePath,
    id: `${session.sessionId}-activity-${session.parser.nextId++}`
  }

  session.activities = [...session.activities.slice(-(MAX_ACTIVITY_ITEMS - 1)), activity]

  if (shouldBroadcast) {
    broadcast(`terminal:activity:${session.sessionId}`, activity)
  }
}

function processNormalizedLine(
  session: ManagedTerminalSession,
  line: string,
  shouldBroadcast: boolean
): void {
  const trimmed = line.trim()

  if (session.parser.pendingMessageLines) {
    if (trimmed.length === 0) {
      if (session.parser.pendingMessageLines.at(-1) !== '') {
        session.parser.pendingMessageLines.push('')
      }
      return
    }

    const parsedLine = parseLineActivity(line)

    if (
      parsedLine ||
      line.includes('<task-notification>') ||
      isClaudePromptLine(trimmed) ||
      isClaudeUiBoundaryLine(trimmed) ||
      isClaudeMessageStart(line)
    ) {
      flushPendingMessage(session, shouldBroadcast)

      if (isClaudePromptLine(trimmed)) {
        session.parser.afterClaudePrompt = true
      }

      if (!parsedLine && !line.includes('<task-notification>') && !isClaudeMessageStart(line)) {
        return
      }
    } else {
      session.parser.pendingMessageLines.push(normalizeClaudeMessageLine(line))
      return
    }
  }

  if (session.parser.pendingBlockLines) {
    session.parser.pendingBlockLines.push(line)

    if (line.includes('</task-notification>')) {
      const block = session.parser.pendingBlockLines.join('\n')
      session.parser.pendingBlockLines = null
      pushActivity(session, parseTaskNotification(block), shouldBroadcast)
    }

    return
  }

  if (isClaudePromptLine(trimmed)) {
    session.parser.afterClaudePrompt = true
    return
  }

  if (trimmed.length === 0 || isClaudeUiBoundaryLine(trimmed)) {
    return
  }

  if (line.includes('<task-notification>')) {
    session.parser.afterClaudePrompt = false

    if (line.includes('</task-notification>')) {
      pushActivity(session, parseTaskNotification(line), shouldBroadcast)
      return
    }

    session.parser.pendingBlockLines = [line]
    return
  }

  const parsed = parseLineActivity(line)

  if (parsed) {
    session.parser.afterClaudePrompt = false
    pushActivity(session, parsed, shouldBroadcast)
    return
  }

  if (isClaudeMessageStart(line)) {
    session.parser.afterClaudePrompt = false
    session.parser.pendingMessageLines = [normalizeClaudeMessageLine(stripClaudeLeadMarker(line.trim()))]
    return
  }

  if (session.parser.afterClaudePrompt) {
    session.parser.pendingMessageLines = [normalizeClaudeMessageLine(line)]
    session.parser.afterClaudePrompt = false
  }
}

function ingestTerminalText(
  session: ManagedTerminalSession,
  text: string,
  shouldBroadcast: boolean
): void {
  session.parser.pendingText += normalizeTerminalText(text)
  const lines = session.parser.pendingText.split('\n')
  session.parser.pendingText = lines.pop() ?? ''

  for (const line of lines) {
    processNormalizedLine(session, line, shouldBroadcast)
  }
}

function readTerminalHistoryForTmuxSession(
  tmuxSessionName: string,
  fallback = '',
  limit = 50_000
): string {
  const tmuxBinary = resolveTmuxBinary()

  if (!tmuxBinary) {
    return fallback
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
    return fallback
  }

  return result.stdout
}

function initializeSessionActivities(session: ManagedTerminalSession): void {
  session.activities = []
  session.parser = makeParserState()

  const history = readTerminalHistoryForTmuxSession(session.tmuxSessionName, session.buffer)

  if (history.length === 0) {
    return
  }

  session.parser.captureReplayCounts = new Map()
  ingestTerminalText(session, history, false)
  flushPendingMessage(session, false)
  session.parser.pendingBlockLines = null
  session.parser.pendingText = ''
  session.parser.replaySuppressionCounts = session.parser.captureReplayCounts ?? new Map()
  session.parser.captureReplayCounts = null
  session.parser.replaySuppressionUntil = Date.now() + ACTIVITY_REPLAY_SUPPRESSION_MS
}

function resyncSessionActivitiesFromHistory(session: ManagedTerminalSession): void {
  initializeSessionActivities(session)
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
    const parsed = JSON.parse(content) as Partial<PersistedTerminalSessionMeta>

    if (
      typeof parsed.cwd === 'string' &&
      typeof parsed.sessionId === 'string' &&
      typeof parsed.tmuxSessionName === 'string'
    ) {
      return {
        createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : Date.now(),
        cwd: parsed.cwd,
        provider: parsed.provider === 'codex' ? 'codex' : 'claude',
        sessionId: parsed.sessionId,
        tmuxSessionName: parsed.tmuxSessionName,
        updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now()
      }
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
  provider: TerminalProvider
  sessionId: string
  tmuxSessionName: string
}): void {
  const existing = readPersistedTerminalSession(meta.sessionId)
  const now = Date.now()

  writePersistedTerminalSession({
    sessionId: meta.sessionId,
    cwd: meta.cwd,
    provider: meta.provider,
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
  return {
    tmuxInstalled: resolveTmuxBinary() !== null,
    providers: {
      claude: {
        command: providerCommandName('claude'),
        installed: resolveCommandBinary(providerCommandName('claude')) !== null,
        label: 'Claude Code'
      },
      codex: {
        command: providerCommandName('codex'),
        installed: resolveCommandBinary(providerCommandName('codex')) !== null,
        label: 'Codex'
      }
    }
  }
}

export function createOrAttachTerminalSession(options: {
  cols: number
  cwd?: string
  provider: TerminalProvider
  rows: number
  sessionId: string
}): TerminalSessionSnapshot {
  const existing = sessions.get(options.sessionId)

  if (existing) {
    persistTerminalSessionMeta(existing)
    return {
      sessionId: existing.sessionId,
      cwd: existing.cwd,
      buffer: existing.buffer,
      provider: existing.provider
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
  const provider = persisted?.provider ?? options.provider
  const commandName = providerCommandName(provider)

  if (resolveCommandBinary(commandName) === null) {
    throw new Error(`${providerLabel(provider)} requires ${commandName}. Install it and restart the app.`)
  }

  const tmuxSessionName = persisted?.tmuxSessionName ?? tmuxSessionNameFor(options.sessionId)
  const sessionAlreadyExists = tmuxSessionExists(tmuxBinary, tmuxSessionName)
  const shouldAutoLaunchProvider = !sessionAlreadyExists && Boolean(options.cwd && existsSync(options.cwd))
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
    activities: [],
    sessionId: options.sessionId,
    cwd,
    buffer: '',
    parser: makeParserState(),
    pty,
    provider,
    tmuxSessionName
  }

  persistTerminalSessionMeta(session)
  initializeSessionActivities(session)

  pty.onData((data) => {
    session.buffer = appendToBuffer(session.buffer, data)
    ingestTerminalText(session, data, true)
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

  if (shouldAutoLaunchProvider) {
    setTimeout(() => {
      const activeSession = sessions.get(session.sessionId)

      if (!activeSession) {
        return
      }

      activeSession.pty.write(`${providerCommand(activeSession.provider)}\r`)
    }, 180)
  }

  return {
    sessionId: session.sessionId,
    cwd: session.cwd,
    buffer: session.buffer,
    provider: session.provider
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

export function readTerminalActivity(sessionId: string): TerminalActivityItem[] {
  const session = sessions.get(sessionId)

  if (session) {
    resyncSessionActivitiesFromHistory(session)
    return session.activities
  }

  const persisted = readPersistedTerminalSession(sessionId)

  if (!persisted) {
    return []
  }

  const hydratedSession: ManagedTerminalSession = {
    activities: [],
    buffer: '',
    cwd: persisted.cwd,
    parser: makeParserState(),
    pty: null as unknown as nodePty.IPty,
    provider: persisted.provider,
    sessionId: persisted.sessionId,
    tmuxSessionName: persisted.tmuxSessionName
  }

  initializeSessionActivities(hydratedSession)
  return hydratedSession.activities
}

export function readTerminalHistory(sessionId: string, limit = 50_000): string {
  const activeSession = sessions.get(sessionId)
  const persisted = readPersistedTerminalSession(sessionId)
  const tmuxSessionName = activeSession?.tmuxSessionName ?? persisted?.tmuxSessionName

  if (!tmuxSessionName) {
    return activeSession?.buffer ?? ''
  }

  return readTerminalHistoryForTmuxSession(tmuxSessionName, activeSession?.buffer ?? '', limit)
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
