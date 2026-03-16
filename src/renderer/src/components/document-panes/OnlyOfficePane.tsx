import { useEffect, useId, useMemo, useRef, useState } from 'react'

import { ErrorPane, FileViewerSurface, LoadingPane, type ViewerVariant } from './FileViewerSurface'

import type { OfficeViewerBootstrap, OfficeViewerSession } from '@shared/types'

const DOCS_API_SCRIPT_PATH = '/web-apps/apps/api/documents/api.js'
const onlyOfficeScriptPromises = new Map<string, Promise<void>>()

declare global {
  interface Window {
    DocsAPI?: {
      DocEditor: new (
        elementId: string,
        config: Record<string, unknown>
      ) => { destroyEditor?: () => void }
    }
  }
}

function fileExtension(filePath: string) {
  const match = /\.([^.]+)$/.exec(filePath)
  return match?.[1]?.toLowerCase() ?? ''
}

function loadOnlyOfficeApi(documentServerUrl: string) {
  const scriptUrl = `${documentServerUrl}${DOCS_API_SCRIPT_PATH}`
  const existingPromise = onlyOfficeScriptPromises.get(scriptUrl)

  if (existingPromise) {
    return existingPromise
  }

  const promise = new Promise<void>((resolve, reject) => {
    if (window.DocsAPI) {
      resolve()
      return
    }

    const existingScript = document.querySelector<HTMLScriptElement>(`script[src="${scriptUrl}"]`)

    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(), { once: true })
      existingScript.addEventListener('error', () => reject(new Error('Failed to load ONLYOFFICE')), {
        once: true
      })
      return
    }

    const script = document.createElement('script')
    script.src = scriptUrl
    script.async = true
    script.onload = () => {
      if (window.DocsAPI) {
        resolve()
        return
      }

      reject(new Error('ONLYOFFICE loaded without exposing DocsAPI'))
    }
    script.onerror = () => {
      reject(new Error('Failed to load ONLYOFFICE'))
    }
    document.head.appendChild(script)
  })

  onlyOfficeScriptPromises.set(scriptUrl, promise)
  return promise
}

function ActionButton({
  children,
  onClick
}: {
  children: string
  onClick: () => void
}) {
  return (
    <button
      className="rounded-[4px] border border-[color:var(--line-strong)] bg-[var(--surface-0)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-dim)] transition hover:bg-[var(--surface-1)] hover:text-[var(--text)]"
      onClick={onClick}
    >
      {children}
    </button>
  )
}

export function OnlyOfficePane({
  filePath,
  kindLabel,
  officeViewer = null,
  refreshToken = 0,
  showTileRefreshButton = true,
  showViewerRefreshButton = true,
  variant = 'tile'
}: {
  filePath: string
  kindLabel: 'Presentation Surface' | 'Spreadsheet Surface'
  officeViewer?: OfficeViewerBootstrap | null
  refreshToken?: number
  showTileRefreshButton?: boolean
  showViewerRefreshButton?: boolean
  variant?: ViewerVariant
}) {
  const elementId = useId().replace(/:/g, '-')
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [session, setSession] = useState<OfficeViewerSession | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable' | 'error'>('loading')
  const [unavailableMessage, setUnavailableMessage] = useState(
    'The ONLYOFFICE document server is unavailable. Run `npm run office:up` in the project root, then refresh this tile.'
  )
  const [reloadCount, setReloadCount] = useState(0)

  useEffect(() => {
    if (refreshToken > 0) {
      setReloadCount((current) => current + 1)
    }
  }, [refreshToken])

  useEffect(() => {
    let cancelled = false

    setSession(null)
    setStatus('loading')

    async function load() {
      try {
        const bootstrap =
          reloadCount > 0 || !officeViewer
            ? await window.collaborator.readOfficeViewerBootstrap(reloadCount > 0)
            : officeViewer

        if (cancelled) {
          return
        }

        if (bootstrap.status === 'disabled') {
          setUnavailableMessage(
            'The ONLYOFFICE viewer is disabled for this build. Open this file externally or enable the document server.'
          )
          setStatus('unavailable')
          return
        }

        if (bootstrap.status !== 'ready' || !bootstrap.baseUrl) {
          setUnavailableMessage(
            'The ONLYOFFICE document server is unavailable. Run `npm run office:up` in the project root, then refresh this tile.'
          )
          setStatus('unavailable')
          return
        }

        const nextSession = await window.collaborator.getOfficeViewerSession(filePath)

        if (!cancelled) {
          setSession(nextSession)
          setStatus('ready')
        }
      } catch (error) {
        if (!cancelled) {
          setStatus(
            error instanceof Error && /unavailable/i.test(error.message) ? 'unavailable' : 'error'
          )
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [filePath, officeViewer, reloadCount])

  useEffect(() => {
    if (status !== 'ready' || !session || !hostRef.current) {
      return
    }

    let cancelled = false
    let editorInstance: { destroyEditor?: () => void } | null = null

    const hostElement = hostRef.current
    hostElement.innerHTML = ''

    void loadOnlyOfficeApi(session.documentServerUrl)
      .then(() => {
        if (cancelled || !window.DocsAPI) {
          return
        }

        const config = {
          document: {
            fileType: fileExtension(session.filePath),
            key: session.documentKey,
            permissions: {
              chat: false,
              comment: false,
              copy: true,
              download: true,
              edit: false,
              fillForms: false,
              modifyContentControl: false,
              modifyFilter: false,
              print: true,
              review: false
            },
            title: session.title,
            url: session.documentUrl
          },
          documentType: session.documentType,
          editorConfig: {
            callbackUrl: session.callbackUrl,
            customization: {
              autosave: false,
              compactHeader: true,
              compactToolbar: true,
              feedback: false,
              forcesave: false,
              help: false,
              hideRightMenu: false,
              hideRulers: true
            },
            lang: 'en',
            mode: 'view'
          },
          height: '100%',
          type: 'desktop',
          width: '100%'
        }

        editorInstance = new window.DocsAPI.DocEditor(elementId, config)
      })
      .catch(() => {
        if (!cancelled) {
          setStatus('error')
        }
      })

    return () => {
      cancelled = true
      editorInstance?.destroyEditor?.()
      hostElement.innerHTML = ''
    }
  }, [elementId, session, status])

  const unavailableActions = useMemo(
    () => (
      <>
        <ActionButton
          onClick={() => {
            void window.collaborator.openPath(filePath)
          }}
        >
          Open externally
        </ActionButton>
        <ActionButton
          onClick={() => {
            void window.collaborator.openExternalUrl('https://api.onlyoffice.com/docs/docs-api/get-started/')
          }}
        >
          Setup docs
        </ActionButton>
      </>
    ),
    [filePath]
  )

  if (status === 'loading') {
    return <LoadingPane variant={variant} />
  }

  if (status === 'unavailable') {
    return (
      <ErrorPane
        actions={unavailableActions}
        message={unavailableMessage}
        variant={variant}
      />
    )
  }

  if (status === 'error' || !session) {
    return (
      <ErrorPane
        actions={unavailableActions}
        message="This office document could not be rendered. Open it externally or verify the ONLYOFFICE server is reachable."
        variant={variant}
      />
    )
  }

  return (
    <FileViewerSurface
      label={kindLabel}
      onRefresh={() => setReloadCount((current) => current + 1)}
      showTileRefreshButton={showTileRefreshButton}
      showViewerRefreshButton={showViewerRefreshButton}
      statusLabel="Read only"
      variant={variant}
    >
      <div className="min-h-0 flex-1 bg-[var(--surface-0)]">
        <div ref={hostRef} id={elementId} className="h-full w-full" />
      </div>
    </FileViewerSurface>
  )
}
