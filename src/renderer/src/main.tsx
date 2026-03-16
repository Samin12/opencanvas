import React from 'react'
import ReactDOM from 'react-dom/client'
import '@xterm/xterm/css/xterm.css'
import 'tldraw/tldraw.css'

import './index.css'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Renderer root element was not found.')
}

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`
  }

  return typeof error === 'string' ? error : JSON.stringify(error, null, 2)
}

function renderFatal(error: unknown) {
  const message = errorMessage(error)

  console.error('Renderer bootstrap failed:', error)

  ReactDOM.createRoot(rootElement!).render(
    <div
      style={{
        display: 'flex',
        minHeight: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px',
        background: '#0b0f14',
        color: '#eceff3',
        fontFamily: '"IBM Plex Sans", "Avenir Next", sans-serif'
      }}
    >
      <div
        style={{
          maxWidth: '720px',
          width: '100%',
          border: '1px solid rgba(156, 163, 175, 0.32)',
          background: 'rgba(17, 20, 25, 0.94)',
          boxShadow: '0 24px 56px rgba(0, 0, 0, 0.34)',
          padding: '24px',
          borderRadius: '12px'
        }}
      >
        <div
          style={{
            fontSize: '12px',
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: '#717a88',
            marginBottom: '16px'
          }}
        >
          Renderer Error
        </div>
        <div style={{ fontSize: '28px', fontWeight: 600, lineHeight: 1, marginBottom: '16px' }}>
          Open Canvas could not load.
        </div>
        <pre
          style={{
            margin: 0,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontFamily: '"IBM Plex Mono", "SFMono-Regular", monospace',
            fontSize: '13px',
            lineHeight: 1.6,
            color: '#d3d8e3'
          }}
        >
          {message}
        </pre>
      </div>
    </div>
  )
}

void import('./App')
  .then(({ default: App }) => {
    ReactDOM.createRoot(rootElement!).render(<App />)
  })
  .catch((error) => {
    renderFatal(error)
  })
