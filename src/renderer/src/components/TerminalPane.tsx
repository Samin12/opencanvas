import { memo, useEffect, useRef, useState } from 'react'

import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'

interface TerminalPaneProps {
  cwd: string | null
  darkMode: boolean
  sessionId: string
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
    selectionBackground: 'rgba(148, 163, 184, 0.18)',
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
  const terminalRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const [status, setStatus] = useState<'connecting' | 'live' | 'exited' | 'error'>('connecting')

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
      scrollback: 5000,
      smoothScrollDuration: 0,
      theme: terminalTheme(darkMode)
    })

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(host)
    fitAddon.fit()
    terminal.focus()

    terminalRef.current = terminal
    fitRef.current = fitAddon

    const disposeData = terminal.onData((data) => {
      window.collaborator.writeTerminalInput(sessionId, data)
    })

    const detachTerminalData = window.collaborator.onTerminalData(sessionId, (data) => {
      terminal.write(data)
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
    })

    resizeObserver.observe(host)
    void connect()

    return () => {
      cancelled = true
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer)
      }
      resizeObserver.disconnect()
      detachTerminalData()
      detachTerminalExit()
      disposeData.dispose()
      window.collaborator.releaseTerminalSession(sessionId)
      terminal.dispose()
      terminalRef.current = null
      fitRef.current = null
    }
  }, [cwd, sessionId])

  useEffect(() => {
    if (!terminalRef.current) {
      return
    }

    terminalRef.current.options.theme = terminalTheme(darkMode)
  }, [darkMode])

  return (
    <div
      className="terminal-pane flex h-full flex-col overflow-hidden rounded-[6px] border border-[color:var(--line)] bg-[var(--surface-0)]"
      data-scroll-lock="true"
      onMouseDown={() => terminalRef.current?.focus()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="flex items-center justify-between border-b border-[color:var(--line)] px-3 py-1.5 font-['IBM_Plex_Mono','SFMono-Regular','Menlo',monospace] text-[10px] uppercase tracking-[0.14em] text-[var(--text-faint)]">
        <span>Terminal</span>
        <span>
          {status === 'connecting'
            ? 'Connecting'
            : status === 'live'
              ? 'Live'
              : status === 'exited'
                ? 'Exited'
                : 'Error'}
        </span>
      </div>
      <div ref={hostRef} className="min-h-0 flex-1 px-1.5 py-1.5" />
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
