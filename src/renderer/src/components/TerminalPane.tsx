import { memo, useEffect, useRef, useState, type DragEvent as ReactDragEvent } from 'react'

import clsx from 'clsx'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'

import type { TerminalActivityItem, TerminalProvider, TerminalUiMode } from '@shared/types'

import {
  COLLABORATOR_TERMINAL_CARD_MIME,
  createActivityCardPayload,
  createSelectionCardPayload
} from '../utils/terminalCards'

interface TerminalPaneProps {
  contextPrompt?: string
  cwd: string | null
  darkMode: boolean
  focusMode: TerminalUiMode | null
  isSelected: boolean
  notifyOnComplete: boolean
  onCreateMarkdownCard: (options: {
    baseName?: string
    content: string
    targetDirectoryPath?: string
  }) => Promise<void>
  onFocusModeChange: (mode: TerminalUiMode) => void
  onToggleNotifyOnComplete: (enabled: boolean) => void
  provider: TerminalProvider
  sessionId: string
}

const DEFAULT_TERMINAL_FONT_SIZE = 12.5
const MIN_TERMINAL_FONT_SIZE = 10
const MAX_TERMINAL_FONT_SIZE = 19
const COMPLETION_CHIME_MIN_INTERVAL_MS = 1500

function terminalProviderUiLabel(provider: TerminalProvider) {
  return provider === 'codex' ? 'Codex' : 'Claude'
}

function terminalProviderFullLabel(provider: TerminalProvider) {
  return provider === 'codex' ? 'Codex' : 'Claude Code'
}

function terminalStatusMeta(status: 'connecting' | 'live' | 'exited' | 'error') {
  if (status === 'live') {
    return {
      dotClassName: 'bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.16)]',
      label: 'Live'
    }
  }

  if (status === 'connecting') {
    return {
      dotClassName: 'bg-amber-400 shadow-[0_0_0_3px_rgba(251,191,36,0.14)]',
      label: 'Connecting'
    }
  }

  if (status === 'exited') {
    return {
      dotClassName: 'bg-slate-400 shadow-[0_0_0_3px_rgba(148,163,184,0.14)]',
      label: 'Exited'
    }
  }

  return {
    dotClassName: 'bg-rose-500 shadow-[0_0_0_3px_rgba(244,63,94,0.14)]',
    label: 'Error'
  }
}

function terminalTheme(darkMode: boolean) {
  if (darkMode) {
    return {
      background: '#0d1014',
      foreground: '#e7edf8',
      cursor: '#f4f5f7',
      cursorAccent: '#0d1014',
      selectionBackground: 'rgba(120, 136, 160, 0.22)',
      black: '#090b0d',
      red: '#f87171',
      green: '#7dd3a6',
      yellow: '#facc15',
      blue: '#7dd3fc',
      magenta: '#d8b4fe',
      cyan: '#67e8f9',
      white: '#dbe4f0',
      brightBlack: '#7f8ba0',
      brightRed: '#fca5a5',
      brightGreen: '#bbf7d0',
      brightYellow: '#fde68a',
      brightBlue: '#bfdbfe',
      brightMagenta: '#e9d5ff',
      brightCyan: '#a5f3fc',
      brightWhite: '#ffffff'
    }
  }

  return {
    background: '#fffdfa',
    foreground: '#3b4455',
    cursor: '#1f2937',
    cursorAccent: '#fffdfa',
    selectionBackground: 'rgba(100, 116, 139, 0.24)',
    selectionForeground: '#1f2937',
    black: '#1f2937',
    red: '#dc2626',
    green: '#15803d',
    yellow: '#b45309',
    blue: '#2563eb',
    magenta: '#9333ea',
    cyan: '#0f766e',
    white: '#e5e7eb',
    brightBlack: '#6b7280',
    brightRed: '#ef4444',
    brightGreen: '#16a34a',
    brightYellow: '#d97706',
    brightBlue: '#3b82f6',
    brightMagenta: '#a855f7',
    brightCyan: '#14b8a6',
    brightWhite: '#f8fafc'
  }
}

function activityAccent(activity: TerminalActivityItem) {
  if (activity.state === 'error') {
    return 'border-[color:var(--error-line)] bg-[var(--error-bg)] text-[var(--error-text)]'
  }

  if (activity.state === 'success') {
    return 'border-emerald-500/20 bg-emerald-500/8 text-emerald-700 dark:text-emerald-200'
  }

  if (activity.state === 'working') {
    return 'border-amber-500/20 bg-amber-500/8 text-amber-700 dark:text-amber-200'
  }

  return 'border-[color:var(--line)] bg-[var(--surface-0)] text-[var(--text-dim)]'
}

function shouldPlayCompletionChime(
  activity: TerminalActivityItem,
  _provider: TerminalProvider
) {
  return (
    activity.state === 'success' &&
    (activity.kind === 'status' || activity.kind === 'task' || activity.kind === 'exit')
  )
}

function completionAudioContext(audioContextRef: { current: AudioContext | null }) {
  if (typeof window === 'undefined') {
    return null
  }

  const AudioContextCtor =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext

  if (!AudioContextCtor) {
    return null
  }

  if (!audioContextRef.current) {
    audioContextRef.current = new AudioContextCtor()
  }

  return audioContextRef.current
}

function playCompletionChime(audioContextRef: { current: AudioContext | null }) {
  const audioContext = completionAudioContext(audioContextRef)

  if (!audioContext) {
    return
  }

  if (audioContext.state === 'suspended') {
    void audioContext.resume()
  }

  const startAt = audioContext.currentTime + 0.02
  const notes = [
    { duration: 0.12, frequency: 740, gain: 0.045, offset: 0 },
    { duration: 0.18, frequency: 987, gain: 0.035, offset: 0.11 }
  ]

  notes.forEach((note) => {
    const oscillator = audioContext.createOscillator()
    const gainNode = audioContext.createGain()

    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(note.frequency, startAt + note.offset)
    gainNode.gain.setValueAtTime(0.0001, startAt + note.offset)
    gainNode.gain.exponentialRampToValueAtTime(note.gain, startAt + note.offset + 0.02)
    gainNode.gain.exponentialRampToValueAtTime(0.0001, startAt + note.offset + note.duration)

    oscillator.connect(gainNode)
    gainNode.connect(audioContext.destination)
    oscillator.start(startAt + note.offset)
    oscillator.stop(startAt + note.offset + note.duration + 0.03)
  })
}

function syncTerminalWheelAttributes(host: HTMLDivElement | null, enabled: boolean) {
  if (!host) {
    return
  }

  const viewport = host.querySelector<HTMLElement>('.xterm-viewport')

  if (enabled) {
    host.setAttribute('data-native-wheel', 'true')
    host.setAttribute('data-shortcut-lock', 'true')
    viewport?.setAttribute('data-native-wheel', 'true')
    viewport?.setAttribute('data-scroll-lock', 'true')
    return
  }

  host.removeAttribute('data-native-wheel')
  host.removeAttribute('data-shortcut-lock')
  viewport?.removeAttribute('data-native-wheel')
  viewport?.removeAttribute('data-scroll-lock')
}

function TerminalPaneComponent({
  contextPrompt,
  cwd,
  darkMode,
  focusMode,
  isSelected,
  notifyOnComplete,
  onCreateMarkdownCard,
  onFocusModeChange,
  onToggleNotifyOnComplete,
  provider,
  sessionId
}: TerminalPaneProps) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const historyBodyRef = useRef<HTMLDivElement>(null)
  const historyLoadingRef = useRef(false)
  const historyOpenRef = useRef(false)
  const historyScrollToBottomRef = useRef(false)
  const scrollbarTrackRef = useRef<HTMLDivElement>(null)
  const dragCleanupRef = useRef<(() => void) | null>(null)
  const activityRefreshTimerRef = useRef<number | null>(null)
  const historyRequestIdRef = useRef(0)
  const activityRequestIdRef = useRef(0)
  const completionAudioContextRef = useRef<AudioContext | null>(null)
  const lastCompletionChimeAtRef = useRef(0)
  const pendingSelectionCardTextRef = useRef('')
  const terminalRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const [layout, setLayout] = useState<'split' | 'stack'>('split')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyText, setHistoryText] = useState('')
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [activities, setActivities] = useState<TerminalActivityItem[]>([])
  const [activityLoading, setActivityLoading] = useState(false)
  const [activityError, setActivityError] = useState<string | null>(null)
  const [activityOpen, setActivityOpen] = useState(false)
  const [composerValue, setComposerValue] = useState('')
  const [sessionCwd, setSessionCwd] = useState<string | null>(cwd)
  const [selectedText, setSelectedText] = useState('')
  const [creatingCardKey, setCreatingCardKey] = useState<string | null>(null)
  const [terminalFontSize, setTerminalFontSize] = useState(DEFAULT_TERMINAL_FONT_SIZE)
  const [status, setStatus] = useState<'connecting' | 'live' | 'exited' | 'error'>('connecting')
  const [scrollMetrics, setScrollMetrics] = useState({
    bufferType: 'normal' as 'normal' | 'alternate',
    maxViewportY: 0,
    normalMaxViewportY: 0,
    rows: 0,
    viewportY: 0
  })
  const statusMeta = terminalStatusMeta(status)
  const providerLabel = terminalProviderUiLabel(provider)
  const providerFullLabel = terminalProviderFullLabel(provider)
  const shellFocusActive = isSelected && focusMode === 'shell' && !historyOpen
  const terminalWheelActive = isSelected && !historyOpen
  const chatFocusActive = isSelected && focusMode === 'chat' && !historyOpen
  const historyFocusActive = isSelected && historyOpen
  const hasLinkedContextPrompt = Boolean(contextPrompt?.trim())

  function primeCompletionChime() {
    const audioContext = completionAudioContext(completionAudioContextRef)

    if (audioContext?.state === 'suspended') {
      void audioContext.resume()
    }
  }

  function maybePlayCompletionChime(activity: TerminalActivityItem) {
    if (!notifyOnComplete || !shouldPlayCompletionChime(activity, provider)) {
      return
    }

    const now = Date.now()

    if (now - lastCompletionChimeAtRef.current < COMPLETION_CHIME_MIN_INTERVAL_MS) {
      return
    }

    lastCompletionChimeAtRef.current = now
    playCompletionChime(completionAudioContextRef)
  }

  function composedPrompt(prompt: string) {
    const nextPrompt = prompt.trim()

    if (nextPrompt.length === 0) {
      return ''
    }

    const nextContextPrompt = contextPrompt?.trim()

    if (!nextContextPrompt) {
      return nextPrompt
    }

    return `${nextContextPrompt}\n\nCurrent request:\n${nextPrompt}`
  }

  function submitComposerPrompt(prompt: string) {
    const nextPrompt = composedPrompt(prompt)

    if (nextPrompt.length === 0) {
      return
    }

    // Tmux/xterm expects carriage return semantics for a real "press Enter".
    window.collaborator.writeTerminalInput(sessionId, `${nextPrompt}\r`)
  }

  function syncScrollMetrics(activeTerminal: Terminal | null) {
    if (!activeTerminal) {
      setScrollMetrics({
        bufferType: 'normal',
        maxViewportY: 0,
        normalMaxViewportY: 0,
        rows: 0,
        viewportY: 0
      })
      return
    }

    const activeBuffer = activeTerminal.buffer.active
    const normalBuffer = activeTerminal.buffer.normal

    setScrollMetrics({
      bufferType: activeBuffer.type,
      maxViewportY: activeBuffer.baseY,
      normalMaxViewportY: normalBuffer.baseY,
      rows: activeTerminal.rows,
      viewportY: activeBuffer.viewportY
    })
  }

  function scrollTerminalToClientY(clientY: number) {
    const track = scrollbarTrackRef.current
    const terminal = terminalRef.current

    if (!track || !terminal) {
      return
    }

    const rect = track.getBoundingClientRect()

    if (rect.height <= 0) {
      return
    }

    const ratio = Math.min(Math.max((clientY - rect.top) / rect.height, 0), 1)
    terminal.scrollToLine(Math.round(ratio * terminal.buffer.active.baseY))
    syncScrollMetrics(terminal)
  }

  function stopScrollbarDrag() {
    dragCleanupRef.current?.()
    dragCleanupRef.current = null
  }

  function beginScrollbarDrag(pointerId: number) {
    stopScrollbarDrag()

    const handlePointerMove = (event: PointerEvent) => {
      scrollTerminalToClientY(event.clientY)
    }

    const handlePointerUp = (event: PointerEvent) => {
      if (event.pointerId === pointerId) {
        stopScrollbarDrag()
      }
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)

    dragCleanupRef.current = () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }
  }

  function focusShell() {
    onFocusModeChange('shell')
    window.requestAnimationFrame(() => {
      terminalRef.current?.focus()
    })
  }

  function focusChat() {
    onFocusModeChange('chat')
    window.requestAnimationFrame(() => {
      composerRef.current?.focus()
    })
  }

  function adjustTerminalFontSize(delta: number) {
    setTerminalFontSize((current) =>
      Math.min(MAX_TERMINAL_FONT_SIZE, Math.max(MIN_TERMINAL_FONT_SIZE, current + delta))
    )
  }

  function resetTerminalFontSize() {
    setTerminalFontSize(DEFAULT_TERMINAL_FONT_SIZE)
  }

  function stopScheduledActivityRefresh() {
    if (activityRefreshTimerRef.current !== null) {
      window.clearTimeout(activityRefreshTimerRef.current)
      activityRefreshTimerRef.current = null
    }
  }

  function scheduleActivityRefresh() {
    stopScheduledActivityRefresh()
    activityRefreshTimerRef.current = window.setTimeout(() => {
      activityRefreshTimerRef.current = null
      void refreshActivities()
    }, 260)
  }

  async function refreshActivities() {
    const requestId = activityRequestIdRef.current + 1
    activityRequestIdRef.current = requestId
    setActivityLoading(true)
    setActivityError(null)

    try {
      const nextActivities = await window.collaborator.readTerminalActivity(sessionId)

      if (activityRequestIdRef.current !== requestId) {
        return
      }

      setActivities(nextActivities)
    } catch (error) {
      if (activityRequestIdRef.current !== requestId) {
        return
      }

      setActivityError(
        error instanceof Error ? error.message : `Unable to load ${providerLabel} activity for this terminal.`
      )
    } finally {
      if (activityRequestIdRef.current === requestId) {
        setActivityLoading(false)
      }
    }
  }

  function closeHistory() {
    setHistoryOpen(false)
    window.requestAnimationFrame(() => {
      if (focusMode === 'chat') {
        composerRef.current?.focus()
      } else {
        terminalRef.current?.focus()
      }
    })
  }

  async function loadHistory(options?: { scrollToBottom?: boolean }) {
    const requestId = historyRequestIdRef.current + 1
    historyRequestIdRef.current = requestId
    historyScrollToBottomRef.current = options?.scrollToBottom ?? true
    setHistoryOpen(true)
    setHistoryLoading(true)
    setHistoryError(null)
    onFocusModeChange('chat')

    try {
      const nextHistory = await window.collaborator.readTerminalHistory(sessionId, 50_000)

      if (historyRequestIdRef.current !== requestId) {
        return
      }

      setHistoryText(nextHistory)
    } catch (error) {
      if (historyRequestIdRef.current !== requestId) {
        return
      }

      setHistoryError(
        error instanceof Error ? error.message : 'Unable to read tmux history for this terminal.'
      )
    } finally {
      if (historyRequestIdRef.current === requestId) {
        setHistoryLoading(false)
      }
    }
  }

  async function createCardFromActivity(activity: TerminalActivityItem) {
    setCreatingCardKey(activity.id)

    try {
      await onCreateMarkdownCard({
        ...createActivityCardPayload(activity),
        targetDirectoryPath: sessionCwd ?? undefined
      })
    } finally {
      setCreatingCardKey((current) => (current === activity.id ? null : current))
    }
  }

  function handleActivityDragStart(
    event: ReactDragEvent<HTMLDivElement>,
    activity: TerminalActivityItem
  ) {
    const payload = {
      ...createActivityCardPayload(activity),
      targetDirectoryPath: sessionCwd ?? undefined
    }

    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData(COLLABORATOR_TERMINAL_CARD_MIME, JSON.stringify(payload))
    event.dataTransfer.setData('text/plain', payload.baseName ?? 'Terminal Card')
  }

  async function createCardFromSelection() {
    const nextSelection = (
      terminalRef.current?.getSelection() ||
      pendingSelectionCardTextRef.current ||
      selectedText
    ).trim()

    if (nextSelection.length === 0) {
      return
    }

    setCreatingCardKey('selection')

    try {
      await onCreateMarkdownCard({
        ...createSelectionCardPayload(nextSelection),
        targetDirectoryPath: sessionCwd ?? undefined
      })
    } finally {
      setCreatingCardKey((current) => (current === 'selection' ? null : current))
    }
  }

  useEffect(() => {
    const body = bodyRef.current

    if (!body) {
      return
    }

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]

      if (!entry) {
        return
      }

      const nextLayout =
        entry.contentRect.width < 660 || entry.contentRect.height < 360 ? 'stack' : 'split'

      setLayout(nextLayout)
    })

    resizeObserver.observe(body)

    return () => {
      resizeObserver.disconnect()
    }
  }, [])

  useEffect(() => {
    const host = hostRef.current

    if (!host) {
      return
    }

    const terminal = new Terminal({
      allowTransparency: true,
      cursorBlink: true,
      cursorStyle: 'block',
      convertEol: false,
      drawBoldTextInBrightColors: false,
      fontFamily: '"SFMono-Regular", "IBM Plex Mono", Menlo, monospace',
      fontSize: terminalFontSize,
      lineHeight: 1.45,
      macOptionIsMeta: true,
      scrollOnEraseInDisplay: true,
      scrollOnUserInput: false,
      scrollback: 20000,
      smoothScrollDuration: 0,
      theme: terminalTheme(darkMode)
    })

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(host)
    fitAddon.fit()

    terminalRef.current = terminal
    fitRef.current = fitAddon
    syncTerminalWheelAttributes(host, terminalWheelActive)

    const disposeData = terminal.onData((data) => {
      window.collaborator.writeTerminalInput(sessionId, data)
    })

    const disposeScroll = terminal.onScroll(() => {
      syncScrollMetrics(terminal)
    })
    const disposeBufferChange = terminal.buffer.onBufferChange(() => {
      syncScrollMetrics(terminal)
    })

    const disposeSelection = terminal.onSelectionChange(() => {
      const nextSelection = terminal.getSelection()
      setSelectedText(nextSelection)

      if (nextSelection.trim().length > 0) {
        pendingSelectionCardTextRef.current = nextSelection
      }
    })

    const detachTerminalData = window.collaborator.onTerminalData(sessionId, (data) => {
      terminal.write(data)
      window.requestAnimationFrame(() => {
        syncScrollMetrics(terminal)
      })
      scheduleActivityRefresh()
    })

    const detachTerminalActivity = window.collaborator.onTerminalActivity(sessionId, (activity) => {
      setActivities((current) => [...current.slice(-179), activity])
      maybePlayCompletionChime(activity)
    })

    let cancelled = false
    let reconnectTimer: number | null = null

    async function connect(options?: { reset?: boolean }) {
      try {
        setStatus('connecting')
        const snapshot = await window.collaborator.createTerminalSession({
          sessionId,
          cwd: cwd ?? undefined,
          provider,
          cols: terminal.cols,
          rows: terminal.rows
        })

        if (cancelled) {
          return
        }

        if (options?.reset) {
          terminal.reset()
        }

        if (snapshot.buffer.length > 0) {
          terminal.write(snapshot.buffer)
        }

        setSessionCwd(snapshot.cwd)

        await refreshActivities()

        setStatus('live')
        fitAddon.fit()
        window.collaborator.resizeTerminalSession(sessionId, terminal.cols, terminal.rows)
        window.requestAnimationFrame(() => {
          syncScrollMetrics(terminal)
        })
      } catch (error) {
        if (cancelled) {
          return
        }

        setStatus('error')
        terminal.write(
          `\r\n\x1b[31m${error instanceof Error ? error.message : 'Unable to start terminal session.'}\x1b[0m\r\n`
        )
      }
    }

    const detachTerminalExit = window.collaborator.onTerminalExit(sessionId, () => {
      if (cancelled) {
        return
      }

      setStatus('connecting')

      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer)
      }

      reconnectTimer = window.setTimeout(() => {
        void connect({ reset: true })
      }, 140)
    })

    const resizeObserver = new ResizeObserver(() => {
      if (!terminalRef.current || !fitRef.current) {
        return
      }

      fitRef.current.fit()
      window.collaborator.resizeTerminalSession(sessionId, terminalRef.current.cols, terminalRef.current.rows)
      syncScrollMetrics(terminalRef.current)
    })

    resizeObserver.observe(host)
    void connect()

    return () => {
      cancelled = true
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer)
      }
      resizeObserver.disconnect()
      stopScheduledActivityRefresh()
      stopScrollbarDrag()
      detachTerminalActivity()
      detachTerminalData()
      detachTerminalExit()
      disposeData.dispose()
      disposeScroll.dispose()
      disposeBufferChange.dispose()
      disposeSelection.dispose()
      window.collaborator.releaseTerminalSession(sessionId)
      terminal.dispose()
      terminalRef.current = null
      fitRef.current = null
      syncScrollMetrics(null)
    }
  }, [cwd, notifyOnComplete, provider, sessionId])

  useEffect(() => {
    syncTerminalWheelAttributes(hostRef.current, terminalWheelActive)

    if (shellFocusActive) {
      terminalRef.current?.focus()
    }
  }, [shellFocusActive, terminalWheelActive])

  useEffect(() => {
    if (!chatFocusActive || historyOpen) {
      return
    }

    composerRef.current?.focus()
  }, [chatFocusActive, historyOpen])

  useEffect(() => {
    historyOpenRef.current = historyOpen
  }, [historyOpen])

  useEffect(() => {
    historyLoadingRef.current = historyLoading
  }, [historyLoading])

  useEffect(() => {
    if (!historyOpen || historyLoading || !historyScrollToBottomRef.current) {
      return
    }

    const historyBody = historyBodyRef.current

    if (!historyBody) {
      return
    }

    window.requestAnimationFrame(() => {
      historyBody.scrollTop = historyBody.scrollHeight
      historyScrollToBottomRef.current = false
    })
  }, [historyLoading, historyOpen, historyText])

  useEffect(() => {
    return () => {
      stopScheduledActivityRefresh()
      stopScrollbarDrag()
    }
  }, [])

  useEffect(() => {
    return () => {
      const audioContext = completionAudioContextRef.current

      if (!audioContext) {
        return
      }

      void audioContext.close().catch(() => {
        // Ignore audio shutdown issues during unmount.
      })
      completionAudioContextRef.current = null
    }
  }, [])

  useEffect(() => {
    historyRequestIdRef.current += 1
    activityRequestIdRef.current += 1
    setHistoryOpen(false)
    setHistoryLoading(false)
    setHistoryText('')
    setHistoryError(null)
    setActivityLoading(false)
    setActivityError(null)
    setActivities([])
    setSelectedText('')
    setSessionCwd(cwd)
    stopScheduledActivityRefresh()
    stopScrollbarDrag()
    historyScrollToBottomRef.current = false
    pendingSelectionCardTextRef.current = ''
    setComposerValue('')
  }, [sessionId])

  useEffect(() => {
    if (!terminalRef.current) {
      return
    }

    terminalRef.current.options.theme = terminalTheme(darkMode)
  }, [darkMode])

  useEffect(() => {
    const terminal = terminalRef.current
    const fitAddon = fitRef.current

    if (!terminal || !fitAddon) {
      return
    }

    terminal.options.fontSize = terminalFontSize
    fitAddon.fit()
    window.collaborator.resizeTerminalSession(sessionId, terminal.cols, terminal.rows)
    syncScrollMetrics(terminal)
  }, [sessionId, terminalFontSize])

  const hasVisibleTerminalScrollback =
    scrollMetrics.maxViewportY > 0 || scrollMetrics.normalMaxViewportY > 0
  const effectiveMaxY = scrollMetrics.maxViewportY > 0
    ? scrollMetrics.maxViewportY
    : scrollMetrics.normalMaxViewportY
  const thumbHeightPercent =
    effectiveMaxY > 0
      ? Math.max(8, (scrollMetrics.rows / (scrollMetrics.rows + effectiveMaxY)) * 100)
      : 100
  const thumbTopPercent =
    scrollMetrics.maxViewportY > 0
      ? (scrollMetrics.viewportY / scrollMetrics.maxViewportY) * (100 - thumbHeightPercent)
      : 0

  return (
    <div
      className="terminal-pane relative flex h-full flex-col overflow-hidden rounded-[4px] border border-[color:var(--line)] bg-[var(--surface-0)]"
      onKeyDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[color:var(--line)] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
        <div className="inline-flex items-center gap-2">
          <span>{providerFullLabel}</span>
          <div className="inline-flex items-center gap-1 rounded-[4px] border border-[color:var(--line)] bg-[var(--surface-0)] px-1 py-1">
            <button
              type="button"
              className="rounded-[4px] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-[var(--text-dim)] transition hover:bg-[var(--surface-2)] hover:text-[var(--text)] disabled:opacity-40"
              disabled={terminalFontSize <= MIN_TERMINAL_FONT_SIZE}
              title="Decrease terminal text size"
              onClick={() => {
                adjustTerminalFontSize(-1)
              }}
              onMouseDown={(event) => event.stopPropagation()}
            >
              A-
            </button>
            <button
              type="button"
              className="rounded-[4px] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-[var(--text-faint)] transition hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
              title="Reset terminal text size"
              onClick={() => {
                resetTerminalFontSize()
              }}
              onMouseDown={(event) => event.stopPropagation()}
            >
              {Math.round(terminalFontSize)}
            </button>
            <button
              type="button"
              className="rounded-[4px] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-[var(--text-dim)] transition hover:bg-[var(--surface-2)] hover:text-[var(--text)] disabled:opacity-40"
              disabled={terminalFontSize >= MAX_TERMINAL_FONT_SIZE}
              title="Increase terminal text size"
              onClick={() => {
                adjustTerminalFontSize(1)
              }}
              onMouseDown={(event) => event.stopPropagation()}
            >
              A+
            </button>
          </div>
          <button
            type="button"
            className="rounded-[4px] border border-[color:var(--line)] bg-[var(--surface-0)] px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--text-dim)] transition hover:border-[color:var(--line-strong)] hover:text-[var(--text)]"
            onClick={() => {
              void loadHistory()
            }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            History
          </button>
          <button
            type="button"
            className="rounded-[4px] border border-[color:var(--line)] bg-[var(--surface-0)] px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--text-dim)] transition hover:border-[color:var(--line-strong)] hover:text-[var(--text)]"
            onClick={() => {
              setActivityOpen((current) => !current)
              onFocusModeChange('chat')
            }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            {activityOpen ? 'Hide Activity' : 'Show Activity'}
          </button>
          <button
            type="button"
            role="switch"
            aria-checked={notifyOnComplete}
            className={clsx(
              'inline-flex items-center gap-2 rounded-[999px] border px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] transition',
              notifyOnComplete
                ? 'border-[color:var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                : 'border-[color:var(--line)] bg-[var(--surface-0)] text-[var(--text-dim)] hover:border-[color:var(--line-strong)] hover:text-[var(--text)]'
            )}
            title="Play a chime when this terminal reports a completed task"
            onClick={() => {
              const nextEnabled = !notifyOnComplete

              if (nextEnabled) {
                primeCompletionChime()
              }

              onToggleNotifyOnComplete(nextEnabled)
            }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <span>Chime</span>
            <span
              aria-hidden="true"
              className={clsx(
                'relative h-3.5 w-6 rounded-full transition',
                notifyOnComplete ? 'bg-[var(--accent)]' : 'bg-[var(--surface-2)]'
              )}
            >
              <span
                className={clsx(
                  'absolute top-[1px] h-3 w-3 rounded-full bg-white shadow-[0_1px_2px_rgba(15,23,42,0.18)] transition',
                  notifyOnComplete ? 'left-[11px]' : 'left-[1px]'
                )}
              />
            </span>
          </button>
          <button
            type="button"
            className="rounded-[4px] border border-[color:var(--line)] bg-[var(--surface-0)] px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--text-dim)] transition hover:border-[color:var(--line-strong)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-45"
            disabled={selectedText.trim().length === 0 || creatingCardKey === 'selection'}
            onClick={() => {
              void createCardFromSelection()
            }}
            onMouseDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
              pendingSelectionCardTextRef.current =
                terminalRef.current?.getSelection() || pendingSelectionCardTextRef.current || selectedText
            }}
          >
            {creatingCardKey === 'selection' ? 'Saving...' : 'Selection to Card'}
          </button>
        </div>
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 rounded-full ${statusMeta.dotClassName}`}
          />
          {statusMeta.label}
        </span>
      </div>

      <div
        ref={bodyRef}
        className={clsx(
          'min-h-0 flex flex-1',
          activityOpen ? (layout === 'split' ? 'flex-row' : 'flex-col') : 'flex-col'
        )}
        onMouseDown={(event) => {
          if (event.button !== 0) {
            return
          }

          event.stopPropagation()
          focusShell()
        }}
      >
        <div
          className={clsx(
            'relative min-h-0 flex-1',
            activityOpen && layout === 'split' && 'border-r border-[color:var(--line)]',
            activityOpen && layout === 'stack' && 'border-b border-[color:var(--line)]'
          )}
          data-native-wheel={terminalWheelActive ? 'true' : undefined}
          data-scroll-lock={terminalWheelActive ? 'true' : undefined}
        >
          <div
            ref={hostRef}
            className="min-h-0 h-full px-1.5 py-1.5"
            onMouseDown={(event) => {
              event.stopPropagation()
              focusShell()
            }}
          />

          {historyOpen ? (
            <div
              className="absolute inset-0 z-30 flex flex-col bg-[color:var(--surface-overlay)] backdrop-blur-sm"
              data-native-wheel={historyFocusActive ? 'true' : undefined}
              data-scroll-lock={historyFocusActive ? 'true' : undefined}
              data-shortcut-lock="true"
              onMouseDown={(event) => {
                event.stopPropagation()
                onFocusModeChange('chat')
              }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-[color:var(--line)] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
                <span>Tmux History</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="rounded-[4px] border border-[color:var(--line)] bg-[var(--surface-0)] px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--text-dim)] transition hover:border-[color:var(--line-strong)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-45"
                    disabled={historyLoading}
                    onClick={() => {
                      void loadHistory()
                    }}
                  >
                    Refresh
                  </button>
                  <button
                    type="button"
                    className="rounded-[4px] border border-[color:var(--line)] bg-[var(--surface-0)] px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--text-dim)] transition hover:border-[color:var(--line-strong)] hover:text-[var(--text)]"
                    onClick={closeHistory}
                  >
                    Close
                  </button>
                </div>
              </div>
              <div
                ref={historyBodyRef}
                className="min-h-0 flex-1 overflow-x-hidden overflow-y-scroll px-3 py-3"
                data-native-wheel={historyFocusActive ? 'true' : undefined}
                data-scroll-lock={historyFocusActive ? 'true' : undefined}
                style={{ scrollbarGutter: 'stable' }}
              >
                {historyLoading ? (
                  <div className="text-[12px] text-[var(--text-dim)]">Loading tmux history...</div>
                ) : historyError ? (
                  <div className="text-[12px] text-[var(--error-text)]">{historyError}</div>
                ) : (
                  <pre className="m-0 whitespace-pre-wrap break-words font-[var(--font-mono)] text-[12px] leading-6 text-[var(--text)]">
                    {historyText.length > 0
                      ? historyText
                      : 'No tmux history is available for this terminal yet.'}
                  </pre>
                )}
              </div>
            </div>
          ) : null}

          {!historyOpen && hasVisibleTerminalScrollback ? (
            <div
              ref={scrollbarTrackRef}
              className={clsx(
                'absolute bottom-2 right-1 top-2 z-20 w-[10px] rounded-full transition-opacity duration-150',
                isSelected ? 'opacity-100' : 'opacity-0 hover:opacity-70'
              )}
              style={{ background: 'rgba(15, 23, 42, 0.06)' }}
              onPointerDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
                scrollTerminalToClientY(event.clientY)
                beginScrollbarDrag(event.pointerId)
              }}
              title="Scroll terminal output"
            >
              <div
                className="absolute left-[1.5px] right-[1.5px] rounded-full bg-[var(--text-faint)] transition-colors hover:bg-[var(--text-dim)]"
                style={{
                  height: `${thumbHeightPercent}%`,
                  minHeight: '24px',
                  top: `${thumbTopPercent}%`
                }}
                onPointerDown={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  beginScrollbarDrag(event.pointerId)
                }}
              />
            </div>
          ) : null}

        </div>

        {activityOpen ? (
          <div
            className={clsx(
              'flex min-h-0 flex-col bg-[var(--surface-1)]',
              layout === 'split' ? 'w-[min(20rem,42%)]' : 'h-[42%] w-full'
            )}
            data-native-wheel={chatFocusActive ? 'true' : undefined}
            data-scroll-lock={chatFocusActive ? 'true' : undefined}
            onMouseDown={(event) => {
              event.stopPropagation()
              onFocusModeChange('chat')
            }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[color:var(--line)] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
              <span>{providerLabel} Activity</span>
              <button
                type="button"
                className="rounded-[4px] border border-[color:var(--line)] bg-[var(--surface-0)] px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--text-dim)] transition hover:border-[color:var(--line-strong)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-45"
                disabled={activityLoading}
                onClick={() => {
                  void refreshActivities()
                }}
              >
                Refresh
              </button>
            </div>
            <div
              className="min-h-0 flex-1 space-y-2 overflow-auto px-3 py-3"
              data-native-wheel={chatFocusActive ? 'true' : undefined}
              data-scroll-lock={chatFocusActive ? 'true' : undefined}
            >
              {activityLoading ? (
                <div className="rounded-[4px] border border-[color:var(--line)] bg-[var(--surface-0)] px-3 py-3 text-[12px] text-[var(--text-dim)]">
                  Loading {providerLabel} activity...
                </div>
              ) : activityError ? (
                <div className="rounded-[4px] border border-[color:var(--error-line)] bg-[var(--error-bg)] px-3 py-3 text-[12px] text-[var(--error-text)]">
                  {activityError}
                </div>
              ) : activities.length === 0 ? (
                <div className="rounded-[4px] border border-dashed border-[color:var(--line-strong)] bg-[var(--surface-0)] px-3 py-3 text-[12px] text-[var(--text-dim)]">
                  {providerLabel} activity will appear here once the terminal starts emitting structured output.
                </div>
              ) : (
                activities
                  .slice()
                  .reverse()
                  .map((activity) => (
                    <div
                      key={activity.id}
                      draggable
                      className={clsx(
                        'rounded-[4px] border px-3 py-3 shadow-[0_4px_10px_rgba(15,23,42,0.05)] cursor-grab active:cursor-grabbing',
                        activityAccent(activity)
                      )}
                      title="Drag to the canvas to create a markdown card"
                      onDragStart={(event) => {
                        handleActivityDragStart(event, activity)
                      }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.14em]">
                            {activity.kind}
                          </div>
                          <div className="mt-1 text-[13px] font-medium text-[var(--text)]">
                            {activity.title}
                          </div>
                          <div className="mt-2 whitespace-pre-wrap break-words font-[var(--font-mono)] text-[11px] leading-5 text-[var(--text-dim)]">
                            {(activity.body || activity.rawText).trim() || activity.title}
                          </div>
                          {activity.filePath ? (
                            <button
                              type="button"
                              className="mt-2 rounded-[4px] border border-[color:var(--line)] bg-[var(--surface-0)] px-2 py-1 text-[10px] font-medium text-[var(--text-dim)] transition hover:border-[color:var(--line-strong)] hover:text-[var(--text)]"
                              onClick={() => {
                                void window.collaborator.openPath(activity.filePath as string)
                              }}
                            >
                              Open {activity.filePath}
                            </button>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          className="shrink-0 rounded-[4px] border border-[color:var(--line)] bg-[var(--surface-0)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-dim)] transition hover:border-[color:var(--line-strong)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-45"
                          disabled={creatingCardKey === activity.id}
                          onClick={() => {
                            void createCardFromActivity(activity)
                          }}
                        >
                          {creatingCardKey === activity.id ? 'Saving...' : 'New Card'}
                        </button>
                      </div>
                    </div>
                  ))
              )}
            </div>
          </div>
        ) : null}
      </div>

      <div
        className={clsx(
          'border-t border-[color:var(--line)] px-3 py-2',
          chatFocusActive ? 'bg-[var(--surface-selected)]' : 'bg-[var(--surface-0)]'
        )}
        onMouseDown={(event) => {
          event.stopPropagation()
          focusChat()
        }}
      >
        <div className="mb-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
          <span>{focusMode === 'shell' && isSelected ? `${providerLabel} terminal` : `${providerLabel} composer`}</span>
          <span>
            {selectedText.trim().length > 0
              ? 'Selection ready to save'
              : hasLinkedContextPrompt
                ? 'Linked context prepends on send'
                : `Enter sends to ${providerLabel}`}
          </span>
        </div>
        <div className="flex items-end gap-2">
          <textarea
            ref={composerRef}
            value={composerValue}
            rows={2}
            placeholder={`Ask ${providerLabel} about the linked context, then turn the useful bits into markdown cards.`}
            className={clsx(
              'min-h-[3.25rem] flex-1 rounded-[6px] border bg-[var(--surface-0)] px-3 py-2 text-[13px] leading-5 text-[var(--text)] outline-none transition placeholder:text-[var(--text-faint)]',
              chatFocusActive
                ? 'border-[color:var(--accent)] shadow-[0_0_0_1px_var(--accent-soft)]'
                : 'border-[color:var(--line)] focus:border-[color:var(--accent)]'
            )}
            onChange={(event) => {
              setComposerValue(event.target.value)
            }}
            onFocus={focusChat}
            onKeyDown={(event) => {
              event.stopPropagation()

              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                submitComposerPrompt(composerValue)
                setComposerValue('')
              }
            }}
          />
          <button
            type="button"
            className="rounded-[6px] border border-[color:var(--accent)] bg-[var(--accent)] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
            disabled={composerValue.trim().length === 0}
            onClick={() => {
              submitComposerPrompt(composerValue)
              setComposerValue('')
            }}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}

export const TerminalPane = memo(TerminalPaneComponent, (previous, next) => {
  return (
    previous.contextPrompt === next.contextPrompt &&
    previous.cwd === next.cwd &&
    previous.darkMode === next.darkMode &&
    previous.focusMode === next.focusMode &&
    previous.isSelected === next.isSelected &&
    previous.notifyOnComplete === next.notifyOnComplete &&
    previous.onCreateMarkdownCard === next.onCreateMarkdownCard &&
    previous.onFocusModeChange === next.onFocusModeChange &&
    previous.onToggleNotifyOnComplete === next.onToggleNotifyOnComplete &&
    previous.provider === next.provider &&
    previous.sessionId === next.sessionId
  )
})
