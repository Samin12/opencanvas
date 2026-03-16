import { useEffect, useState } from 'react'

import { EmbedPane } from '../EmbedPane'
import { ErrorPane, FileViewerSurface, type ViewerVariant } from './FileViewerSurface'

import type { OfficeViewerBootstrap } from '@shared/types'
import { embedDescriptorFromUrl } from '../../utils/embedTiles'

export function PresentationPane({
  filePath,
  officeViewer: _officeViewer = null,
  onSetPresentationEmbedUrl,
  presentationEmbedUrl = null,
  refreshToken: _refreshToken = 0,
  showTileRefreshButton: _showTileRefreshButton = true,
  showViewerRefreshButton: _showViewerRefreshButton = true,
  variant = 'tile'
}: {
  filePath: string
  officeViewer?: OfficeViewerBootstrap | null
  onSetPresentationEmbedUrl?: (url: string | null) => void
  presentationEmbedUrl?: string | null
  refreshToken?: number
  showTileRefreshButton?: boolean
  showViewerRefreshButton?: boolean
  variant?: ViewerVariant
}) {
  const [draftUrl, setDraftUrl] = useState(presentationEmbedUrl ?? '')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isEditing, setIsEditing] = useState(false)

  useEffect(() => {
    setDraftUrl(presentationEmbedUrl ?? '')
    setErrorMessage(null)
    setIsEditing(false)
  }, [presentationEmbedUrl, filePath])

  const fileName = filePath.split(/[\\/]/).pop() ?? 'Presentation'
  const savedDescriptor = presentationEmbedUrl ? embedDescriptorFromUrl(presentationEmbedUrl) : null

  function saveEmbedUrl() {
    const nextDescriptor = embedDescriptorFromUrl(draftUrl)

    if (!nextDescriptor) {
      setErrorMessage('Paste a valid Google Slides, PowerPoint web embed, Slidev, or hosted slideshow URL.')
      return
    }

    onSetPresentationEmbedUrl?.(nextDescriptor.canonicalUrl)
    setErrorMessage(null)
    setIsEditing(false)
  }

  if (savedDescriptor && presentationEmbedUrl) {
    return (
      <div className="relative h-full">
        <EmbedPane
          headerActions={
            onSetPresentationEmbedUrl ? (
              <>
                <button
                  className="rounded-[4px] border border-[color:var(--line-strong)] bg-[var(--surface-0)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-dim)] transition hover:bg-[var(--surface-1)] hover:text-[var(--text)]"
                  onClick={() => setIsEditing((current) => !current)}
                  title="Change slideshow URL"
                >
                  {isEditing ? 'Close' : 'Change'}
                </button>
                <button
                  className="rounded-[4px] border border-[color:var(--line-strong)] bg-[var(--surface-0)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-dim)] transition hover:bg-[var(--surface-1)] hover:text-[var(--text)]"
                  onClick={() => {
                    onSetPresentationEmbedUrl(null)
                    setDraftUrl('')
                    setErrorMessage(null)
                    setIsEditing(false)
                  }}
                  title="Detach slideshow URL"
                >
                  Clear
                </button>
              </>
            ) : null
          }
          title={fileName}
          url={presentationEmbedUrl}
        />
        {isEditing ? (
          <div className="absolute inset-x-4 bottom-4 z-20 rounded-[6px] border border-[color:var(--line)] bg-[color:var(--surface-overlay)] p-3 shadow-[0_20px_40px_rgba(15,23,42,0.18)] backdrop-blur">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
              Change Slideshow URL
            </div>
            <div className="mt-2 flex gap-2">
              <input
                className="min-w-0 flex-1 rounded-[4px] border border-[color:var(--line)] bg-[var(--surface-0)] px-3 py-2 text-[13px] text-[var(--text)] outline-none transition focus:border-[color:var(--line-strong)]"
                onChange={(event) => setDraftUrl(event.target.value)}
                placeholder="Paste a Google Slides, PowerPoint web, or Slidev URL"
                value={draftUrl}
              />
              <button
                className="rounded-[4px] border border-[color:var(--line-strong)] bg-[var(--surface-0)] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-dim)] transition hover:bg-[var(--surface-1)] hover:text-[var(--text)]"
                onClick={saveEmbedUrl}
              >
                Save
              </button>
            </div>
            {errorMessage ? (
              <div className="mt-2 text-[12px] text-[var(--error-text)]">{errorMessage}</div>
            ) : (
              <div className="mt-2 text-[12px] text-[var(--text-dim)]">
                Works best with published Google Slides links, PowerPoint web embed links, and hosted Slidev decks.
              </div>
            )}
          </div>
        ) : null}
      </div>
    )
  }

  if (!onSetPresentationEmbedUrl) {
    return (
      <ErrorPane
        actions={
          <button
            className="rounded-[4px] border border-[color:var(--line-strong)] bg-[var(--surface-0)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-dim)] transition hover:bg-[var(--surface-1)] hover:text-[var(--text)]"
            onClick={() => {
              void window.collaborator.openPath(filePath)
            }}
          >
            Open externally
          </button>
        }
        message="Place this presentation on the canvas to attach a slideshow URL, or open the file externally."
        variant={variant}
      />
    )
  }

  return (
    <FileViewerSurface label="Presentation Surface" statusLabel="Attach slideshow" variant={variant}>
      <div className="flex h-full flex-col justify-center gap-4 bg-[var(--surface-0)] px-6 py-6">
        <div className="space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
            Slideshow Link
          </div>
          <div className="text-[14px] leading-6 text-[var(--text-dim)]">
            Paste a published Google Slides URL, a PowerPoint web embed URL, or a hosted Slidev deck URL to render this presentation directly on the canvas.
          </div>
        </div>
        <div className="flex gap-2">
          <input
            className="min-w-0 flex-1 rounded-[4px] border border-[color:var(--line)] bg-[var(--surface-0)] px-3 py-2 text-[13px] text-[var(--text)] outline-none transition focus:border-[color:var(--line-strong)]"
            onChange={(event) => setDraftUrl(event.target.value)}
            placeholder="https://docs.google.com/presentation/... or https://your-slides.example.com"
            value={draftUrl}
          />
          <button
            className="rounded-[4px] border border-[color:var(--line-strong)] bg-[var(--surface-0)] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-dim)] transition hover:bg-[var(--surface-1)] hover:text-[var(--text)]"
            onClick={saveEmbedUrl}
          >
            Attach
          </button>
        </div>
        {errorMessage ? (
          <div className="text-[12px] text-[var(--error-text)]">{errorMessage}</div>
        ) : (
          <div className="text-[12px] leading-5 text-[var(--text-dim)]">
            Keep the original `.pptx` as your source file, and link the published slideshow here for a stable in-canvas presentation view.
          </div>
        )}
        <div className="flex gap-2">
          <button
            className="rounded-[4px] border border-[color:var(--line-strong)] bg-[var(--surface-0)] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-dim)] transition hover:bg-[var(--surface-1)] hover:text-[var(--text)]"
            onClick={() => {
              void window.collaborator.openPath(filePath)
            }}
          >
            Open source file
          </button>
          <button
            className="rounded-[4px] border border-[color:var(--line-strong)] bg-[var(--surface-0)] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-dim)] transition hover:bg-[var(--surface-1)] hover:text-[var(--text)]"
            onClick={() => {
              void window.collaborator.openExternalUrl('https://support.google.com/docs/answer/183965?hl=en')
            }}
          >
            Google Slides help
          </button>
        </div>
      </div>
    </FileViewerSurface>
  )
}
