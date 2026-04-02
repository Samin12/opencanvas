import { memo, useEffect, useRef, useState } from 'react'

import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal } from '@xterm/xterm'

import type { TerminalProvider, TerminalUiMode } from '@shared/types'

interface TerminalPaneProps {
  canvasZoom: number
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

type TerminalStatus = 'connecting' | 'live' | 'error'

const DATA_BUFFER_FLUSH_MS = 5
const DEFAULT_TERMINAL_FONT_SIZE = 12.5
const DEFAULT_TERMINAL_LINE_HEIGHT = 1.45
const TERMINAL_WHEEL_LINE_HEIGHT_PX = 40
const CODEX_LIGHT_MODE_MINIMUM_CONTRAST_RATIO = 7
const IS_MAC =
  typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac')

function terminalTheme(darkMode: boolean, provider: TerminalProvider) {
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

  if (provider === 'codex') {
    return {
      background: '#ffffff',
      foreground: '#111111',
      cursor: '#111111',
      cursorAccent: '#ffffff',
      selectionBackground: 'rgba(17, 17, 17, 0.14)',
      selectionForeground: '#111111',
      black: '#111111',
      red: '#991b1b',
      green: '#166534',
      yellow: '#92400e',
      blue: '#1d4ed8',
      magenta: '#7c3aed',
      cyan: '#0f766e',
      white: '#334155',
      brightBlack: '#475569',
      brightRed: '#b91c1c',
      brightGreen: '#15803d',
      brightYellow: '#a16207',
      brightBlue: '#1e40af',
      brightMagenta: '#6d28d9',
      brightCyan: '#115e59',
      brightWhite: '#0f172a'
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

function minimumContrastRatio(darkMode: boolean, provider: TerminalProvider) {
  if (!darkMode && provider === 'codex') {
    return CODEX_LIGHT_MODE_MINIMUM_CONTRAST_RATIO
  }

  return 1
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

function normalizeWheelDelta(delta: number, deltaMode: number) {
  if (deltaMode === 1) {
    return delta * 16
  }

  if (deltaMode === 2) {
    return delta * 120
  }

  return delta
}

function wheelDeltaToLineCount(delta: number, deltaMode: number) {
  const normalizedDelta = normalizeWheelDelta(delta, deltaMode)

  if (normalizedDelta === 0) {
    return 0
  }

  const nextLineCount = Math.round(normalizedDelta / TERMINAL_WHEEL_LINE_HEIGHT_PX)

  if (nextLineCount === 0) {
    return normalizedDelta > 0 ? 1 : -1
  }

  return nextLineCount
}

function statusLabel(status: TerminalStatus, statusMessage: string | null) {
  if (status === 'error' && statusMessage) {
    return statusMessage
  }

  if (status === 'error') {
    return 'Unable to start terminal'
  }

  if (status === 'connecting') {
    return statusMessage ?? 'Connecting terminal...'
  }

  return null
}

function normalizedCanvasZoom(zoom: number) {
  if (!Number.isFinite(zoom) || zoom <= 0) {
    return 1
  }

  return zoom
}

function TerminalPaneComponent(props: TerminalPaneProps) {
  const {
    canvasZoom,
    contextPrompt,
    cwd,
    darkMode,
    focusMode,
    isSelected,
    onFocusModeChange,
    provider,
    sessionId
  } =
    props
  const hostRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const flushTimerRef = useRef<number | null>(null)
  const reconnectTimerRef = useRef<number | null>(null)
  const bufferedChunksRef = useRef<string[]>([])
  const contextPromptRef = useRef(contextPrompt)
  const isSelectedRef = useRef(isSelected)
  const [status, setStatus] = useState<TerminalStatus>('connecting')
  const [statusMessage, setStatusMessage] = useState<string | null>('Connecting terminal...')
  const effectiveCanvasZoom = normalizedCanvasZoom(canvasZoom)

  function focusShell() {
    onFocusModeChange('shell')
    window.requestAnimationFrame(() => {
      terminalRef.current?.focus()
    })
  }

  useEffect(() => {
    isSelectedRef.current = isSelected
  }, [isSelected])

  useEffect(() => {
    contextPromptRef.current = contextPrompt
  }, [contextPrompt])

  useEffect(() => {
    const host = hostRef.current

    if (!host) {
      return
    }

    const term = new Terminal({
      allowProposedApi: true,
      allowTransparency: true,
      convertEol: false,
      cursorBlink: true,
      cursorStyle: 'block',
      drawBoldTextInBrightColors: false,
      fontFamily: '"SF Mono", "JetBrains Mono", "SFMono-Regular", "Menlo", "Consolas", monospace',
      fontSize: DEFAULT_TERMINAL_FONT_SIZE * effectiveCanvasZoom,
      fontWeight: '400',
      fontWeightBold: '600',
      lineHeight: DEFAULT_TERMINAL_LINE_HEIGHT,
      macOptionIsMeta: true,
      minimumContrastRatio: minimumContrastRatio(darkMode, provider),
      scrollOnEraseInDisplay: true,
      scrollOnUserInput: false,
      scrollback: 200_000,
      smoothScrollDuration: 0,
      theme: terminalTheme(darkMode, provider)
    })

    const fitAddon = new FitAddon()
    const unicode11Addon = new Unicode11Addon()

    term.loadAddon(fitAddon)
    term.loadAddon(unicode11Addon)
    term.unicode.activeVersion = '11'

    try {
      const webglAddon = new WebglAddon()
      webglAddon.onContextLoss(() => {
        webglAddon.dispose()
      })
      term.loadAddon(webglAddon)
    } catch {
      // Fall back to xterm's default renderer when WebGL is unavailable.
    }

    term.open(host)
    terminalRef.current = term
    fitRef.current = fitAddon
    syncTerminalWheelAttributes(host, isSelectedRef.current)

    fitAddon.fit()
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (!terminalRef.current || !fitRef.current) {
          return
        }

        fitRef.current.fit()
        window.collaborator.resizeTerminalSession(sessionId, terminalRef.current.cols, terminalRef.current.rows)
      })
    })

    if (isSelectedRef.current) {
      term.focus()
    }

    const copySelectionToClipboard = () => {
      const selection = term.getSelection()

      if (!selection) {
        return false
      }

      void navigator.clipboard.writeText(selection).catch(() => {})
      return true
    }

    const pasteClipboardText = async () => {
      try {
        const text = await navigator.clipboard.readText()

        if (text) {
          window.collaborator.writeTerminalInput(sessionId, text)
        }
      } catch {
        // Clipboard access can fail outside a user gesture.
      }
    }

    let suppressPasteEvent = false

    term.attachCustomKeyEventHandler((event) => {
      const primaryModifier = IS_MAC ? event.metaKey : event.ctrlKey

      if (event.type === 'keydown' && primaryModifier) {
        const key = event.key.toLowerCase()

        if (key === 'c' && copySelectionToClipboard()) {
          return false
        }

        if (key === 'v') {
          suppressPasteEvent = true
          void pasteClipboardText()
          return false
        }

        if (!IS_MAC && event.shiftKey) {
          if (key === 'c' && copySelectionToClipboard()) {
            return false
          }

          if (key === 'v') {
            suppressPasteEvent = true
            void pasteClipboardText()
            return false
          }
        }
      }

      if (event.type === 'keydown' && event.shiftKey && event.key === 'Insert') {
        suppressPasteEvent = true
        void pasteClipboardText()
        return false
      }

      if (event.type === 'keydown' && event.metaKey) {
        if (event.key === 't' || (event.key >= '1' && event.key <= '9')) {
          return false
        }
      }

      return true
    })

    const handleCopy = (event: ClipboardEvent) => {
      const selection = term.getSelection()

      if (!selection) {
        return
      }

      event.clipboardData?.setData('text/plain', selection)
      event.preventDefault()
      event.stopImmediatePropagation()
    }

    const handlePaste = (event: ClipboardEvent) => {
      if (suppressPasteEvent) {
        suppressPasteEvent = false
        event.preventDefault()
        event.stopImmediatePropagation()
        return
      }

      const text = event.clipboardData?.getData('text/plain')

      if (!text) {
        return
      }

      window.collaborator.writeTerminalInput(sessionId, text)
      event.preventDefault()
      event.stopImmediatePropagation()
    }

    document.addEventListener('copy', handleCopy)
    host.addEventListener('paste', handlePaste as EventListener)

    const handleWheel = (event: WheelEvent) => {
      const viewport = host.querySelector<HTMLElement>('.xterm-viewport')

      if (!viewport || !(event.target instanceof Node) || !viewport.contains(event.target)) {
        return
      }

      const lineCount = wheelDeltaToLineCount(event.deltaY, event.deltaMode)

      if (lineCount === 0) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      term.scrollLines(lineCount)
    }

    host.addEventListener('wheel', handleWheel, { capture: true, passive: false })

    const flushBufferedData = () => {
      flushTimerRef.current = null

      if (bufferedChunksRef.current.length === 0) {
        return
      }

      const payload = bufferedChunksRef.current.join('')
      bufferedChunksRef.current = []
      term.write(payload)
    }

    const queueData = (data: string) => {
      bufferedChunksRef.current.push(data)

      if (flushTimerRef.current !== null) {
        return
      }

      flushTimerRef.current = window.setTimeout(flushBufferedData, DATA_BUFFER_FLUSH_MS)
    }

    const disposeData = term.onData((data) => {
      window.collaborator.writeTerminalInput(sessionId, data)
    })

    const disposeResize = term.onResize(({ cols, rows }) => {
      window.collaborator.resizeTerminalSession(sessionId, cols, rows)
    })

    const detachTerminalData = window.collaborator.onTerminalData(sessionId, (data) => {
      queueData(data)
    })

    const handleWindowFocus = () => {
      if (isSelectedRef.current) {
        term.focus()
      }
    }

    window.addEventListener('focus', handleWindowFocus)

    let cancelled = false

    async function connect(options?: { reset?: boolean; statusMessage?: string }) {
      try {
        setStatus('connecting')
        setStatusMessage(options?.statusMessage ?? 'Connecting terminal...')

        const snapshot = await window.collaborator.createTerminalSession({
          sessionId,
          contextPrompt: contextPromptRef.current,
          cwd: cwd ?? undefined,
          provider,
          cols: term.cols,
          rows: term.rows
        })

        if (cancelled) {
          return
        }

        if (options?.reset) {
          term.reset()
        }

        if (snapshot.buffer.length > 0) {
          queueData(snapshot.buffer)
        }

        setStatus('live')
        setStatusMessage(null)
        fitAddon.fit()
        window.collaborator.resizeTerminalSession(sessionId, term.cols, term.rows)

        if (isSelectedRef.current) {
          term.focus()
        }
      } catch (error) {
        if (cancelled) {
          return
        }

        const message =
          error instanceof Error ? error.message : 'Unable to start terminal session.'

        setStatus('error')
        setStatusMessage(message)
        term.reset()
        term.write(`\x1b[31m${message}\x1b[0m`)
      }
    }

    const detachTerminalExit = window.collaborator.onTerminalExit(sessionId, () => {
      if (cancelled) {
        return
      }

      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current)
      }

      reconnectTimerRef.current = window.setTimeout(() => {
        void connect({
          reset: true,
          statusMessage: 'Restarting terminal...'
        })
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

      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current)
        flushTimerRef.current = null
      }

      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }

      bufferedChunksRef.current = []
      resizeObserver.disconnect()
      window.removeEventListener('focus', handleWindowFocus)
      document.removeEventListener('copy', handleCopy)
      host.removeEventListener('paste', handlePaste as EventListener)
      host.removeEventListener('wheel', handleWheel, true)
      detachTerminalData()
      detachTerminalExit()
      disposeData.dispose()
      disposeResize.dispose()
      window.collaborator.releaseTerminalSession(sessionId)
      term.dispose()
      terminalRef.current = null
      fitRef.current = null
    }
  }, [cwd, provider, sessionId])

  useEffect(() => {
    if (typeof window.collaborator.syncTerminalContext !== 'function') {
      return
    }

    void window.collaborator.syncTerminalContext(sessionId, contextPrompt)
  }, [contextPrompt, sessionId])

  useEffect(() => {
    if (!hostRef.current) {
      return
    }

    syncTerminalWheelAttributes(hostRef.current, isSelected)

    if (!isSelected || focusMode !== 'shell') {
      return
    }

    window.requestAnimationFrame(() => {
      terminalRef.current?.focus()
    })
  }, [focusMode, isSelected])

  useEffect(() => {
    if (!terminalRef.current) {
      return
    }

    terminalRef.current.options.minimumContrastRatio = minimumContrastRatio(darkMode, provider)
    terminalRef.current.options.theme = terminalTheme(darkMode, provider)
    terminalRef.current.options.fontSize = DEFAULT_TERMINAL_FONT_SIZE * effectiveCanvasZoom
    terminalRef.current.options.lineHeight = DEFAULT_TERMINAL_LINE_HEIGHT

    window.requestAnimationFrame(() => {
      if (!terminalRef.current || !fitRef.current) {
        return
      }

      fitRef.current.fit()
      window.collaborator.resizeTerminalSession(sessionId, terminalRef.current.cols, terminalRef.current.rows)
    })
  }, [darkMode, effectiveCanvasZoom, provider, sessionId])

  const nextStatusLabel = statusLabel(status, statusMessage)

  return (
    <div
      className="terminal-pane relative h-full w-full overflow-hidden rounded-b-[var(--radius-surface)] bg-[var(--surface-0)]"
      onKeyDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div
        ref={hostRef}
        className="h-full w-full"
        onMouseDown={(event) => {
          event.stopPropagation()
          focusShell()
        }}
      />

      {nextStatusLabel ? (
        <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex justify-start">
          <div className="rounded-full border border-black/8 bg-[color:color-mix(in_srgb,var(--surface-overlay)_88%,transparent)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)] shadow-[0_8px_18px_rgba(0,0,0,0.08)] backdrop-blur-sm">
            {nextStatusLabel}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export const TerminalPane = memo(TerminalPaneComponent, (previous, next) => {
  return (
    previous.canvasZoom === next.canvasZoom &&
    previous.contextPrompt === next.contextPrompt &&
    previous.cwd === next.cwd &&
    previous.darkMode === next.darkMode &&
    previous.focusMode === next.focusMode &&
    previous.isSelected === next.isSelected &&
    previous.onFocusModeChange === next.onFocusModeChange &&
    previous.provider === next.provider &&
    previous.sessionId === next.sessionId
  )
})
