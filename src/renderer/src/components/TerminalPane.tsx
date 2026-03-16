import { memo, useEffect, useRef, useState } from 'react'

import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'

interface TerminalPaneProps {
  cwd: string | null
  darkMode: boolean
  sessionId: string
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
      foreground: '#d3d8e3',
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
      brightWhite: '#f8fafc'
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

function TerminalPaneComponent({ cwd, darkMode, sessionId }: TerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const scrollbarTrackRef = useRef<HTMLDivElement>(null)
  const dragCleanupRef = useRef<(() => void) | null>(null)
  const historyRequestIdRef = useRef(0)
  const terminalRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyText, setHistoryText] = useState('')
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [status, setStatus] = useState<'connecting' | 'live' | 'exited' | 'error'>('connecting')
  const [scrollMetrics, setScrollMetrics] = useState({
    maxViewportY: 0,
    rows: 0,
    viewportY: 0
  })
  const statusMeta = terminalStatusMeta(status)

  function syncScrollMetrics(activeTerminal: Terminal | null) {
    if (!activeTerminal) {
      setScrollMetrics({
        maxViewportY: 0,
        rows: 0,
        viewportY: 0
      })
      return
    }

    const buffer = activeTerminal.buffer.active

    setScrollMetrics({
      maxViewportY: buffer.baseY,
      rows: activeTerminal.rows,
      viewportY: buffer.viewportY
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
    const targetLine = Math.round(ratio * terminal.buffer.active.baseY)

    terminal.scrollToLine(targetLine)
    syncScrollMetrics(terminal)
  }

  function stopScrollbarDrag() {
    dragCleanupRef.current?.()
    dragCleanupRef.current = null
  }

  function closeHistory() {
    setHistoryOpen(false)
    window.requestAnimationFrame(() => {
      terminalRef.current?.focus()
    })
  }

  async function loadHistory() {
    const requestId = historyRequestIdRef.current + 1
    historyRequestIdRef.current = requestId
    setHistoryOpen(true)
    setHistoryLoading(true)
    setHistoryError(null)

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
      fontSize: 11.5,
      lineHeight: 1.35,
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
    host.setAttribute('data-native-wheel', 'true')
    host.querySelector<HTMLElement>('.xterm-viewport')?.setAttribute('data-scroll-lock', 'true')
    host.querySelector<HTMLElement>('.xterm-viewport')?.setAttribute('data-native-wheel', 'true')
    fitAddon.fit()
    terminal.focus()

    terminalRef.current = terminal
    fitRef.current = fitAddon

    const disposeData = terminal.onData((data) => {
      window.collaborator.writeTerminalInput(sessionId, data)
    })

    const disposeScroll = terminal.onScroll(() => {
      syncScrollMetrics(terminal)
    })

    const detachTerminalData = window.collaborator.onTerminalData(sessionId, (data) => {
      terminal.write(data)
      window.requestAnimationFrame(() => {
        syncScrollMetrics(terminal)
      })
    })

    let cancelled = false
    let reconnectTimer: number | null = null

    async function connect(options?: { reset?: boolean }) {
      try {
        setStatus('connecting')
        const snapshot = await window.collaborator.createTerminalSession({
          sessionId,
          cwd: cwd ?? undefined,
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
      stopScrollbarDrag()
      detachTerminalData()
      detachTerminalExit()
      disposeData.dispose()
      disposeScroll.dispose()
      window.collaborator.releaseTerminalSession(sessionId)
      terminal.dispose()
      terminalRef.current = null
      fitRef.current = null
      syncScrollMetrics(null)
    }
  }, [cwd, sessionId])

  useEffect(() => {
    return () => {
      stopScrollbarDrag()
    }
  }, [])

  useEffect(() => {
    historyRequestIdRef.current += 1
    setHistoryOpen(false)
    setHistoryLoading(false)
    setHistoryText('')
    setHistoryError(null)
  }, [sessionId])

  useEffect(() => {
    if (!terminalRef.current) {
      return
    }

    terminalRef.current.options.theme = terminalTheme(darkMode)
  }, [darkMode])

  const thumbHeightPercent =
    scrollMetrics.maxViewportY > 0
      ? Math.max(8, (scrollMetrics.rows / (scrollMetrics.rows + scrollMetrics.maxViewportY)) * 100)
      : 100
  const thumbTopPercent =
    scrollMetrics.maxViewportY > 0
      ? (scrollMetrics.viewportY / scrollMetrics.maxViewportY) * (100 - thumbHeightPercent)
      : 0

  return (
    <div
      className="terminal-pane relative flex h-full flex-col overflow-hidden rounded-[4px] border border-[color:var(--line)] bg-[var(--surface-0)]"
      data-native-wheel="true"
      data-shortcut-lock="true"
      data-scroll-lock="true"
      onKeyDown={(event) => event.stopPropagation()}
      onMouseDown={() => terminalRef.current?.focus()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="flex items-center justify-between border-b border-[color:var(--line)] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
        <span>Terminal</span>
        <div className="inline-flex items-center gap-2">
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
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={`h-1.5 w-1.5 rounded-full ${statusMeta.dotClassName}`}
            />
            {statusMeta.label}
          </span>
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        <div ref={hostRef} className="min-h-0 h-full px-1.5 py-1.5" data-shortcut-lock="true" />
        {historyOpen ? (
          <div
            className="absolute inset-0 z-30 flex flex-col bg-[color:var(--surface-overlay)] backdrop-blur-sm"
            data-native-wheel="true"
            data-scroll-lock="true"
            data-shortcut-lock="true"
            onMouseDown={(event) => event.stopPropagation()}
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
              className="min-h-0 flex-1 overflow-auto px-3 py-3"
              data-native-wheel="true"
              data-scroll-lock="true"
            >
              {historyLoading ? (
                <div className="text-[12px] text-[var(--text-dim)]">Loading tmux history…</div>
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
        {scrollMetrics.maxViewportY > 0 ? (
          <div
            ref={scrollbarTrackRef}
            className="absolute bottom-2 right-1.5 top-2 z-20 w-3 rounded-full bg-[rgba(15,23,42,0.08)]"
            onPointerDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
              scrollTerminalToClientY(event.clientY)
              beginScrollbarDrag(event.pointerId)
            }}
          >
            <div
              className="absolute left-[2px] right-[2px] rounded-full bg-[var(--line-strong)] transition-colors hover:bg-[var(--text-faint)]"
              style={{
                height: `${thumbHeightPercent}%`,
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
    </div>
  )
}

export const TerminalPane = memo(TerminalPaneComponent, (previous, next) => {
  return (
    previous.cwd === next.cwd &&
    previous.darkMode === next.darkMode &&
    previous.sessionId === next.sessionId
  )
})
