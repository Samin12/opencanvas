import { useEffect, useState } from 'react'

import { EmbedPane } from '../EmbedPane'
import { OnlyOfficePane } from './OnlyOfficePane'
import { PdfPane } from './PdfPane'
import type { ViewerVariant } from './FileViewerSurface'

import type { OfficeViewerBootstrap, PresentationPreviewResult } from '@shared/types'
import { embedDescriptorFromUrl } from '../../utils/embedTiles'

function ActionButton({
  children,
  onClick
}: {
  children: string
  onClick: () => void
}) {
  return (
    <button
      className="rounded-[4px] border border-[color:var(--line-strong)] bg-[var(--surface-0)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-dim)] transition hover:bg-[var(--surface-1)] hover:text-[var(--text)]"
      onClick={onClick}
    >
      {children}
    </button>
  )
}

export function PresentationPane({
  filePath,
  officeViewer = null,
  onSetPresentationEmbedUrl,
  presentationEmbedUrl = null,
  refreshToken = 0,
  showTileRefreshButton = true,
  showViewerRefreshButton = true,
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
  const [pdfPreview, setPdfPreview] = useState<PresentationPreviewResult | null>(null)
  const [pdfPreviewLoading, setPdfPreviewLoading] = useState(false)
  const [pdfPreviewMessage, setPdfPreviewMessage] = useState<string | null>(null)

  useEffect(() => {
    setDraftUrl(presentationEmbedUrl ?? '')
    setErrorMessage(null)
    setIsEditing(false)
    setPdfPreview(null)
    setPdfPreviewLoading(false)
    setPdfPreviewMessage(null)
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

  async function openPdfPreview() {
    if (pdfPreviewLoading) {
      return
    }

    setPdfPreviewLoading(true)
    setPdfPreviewMessage(null)

    try {
      const nextPreview = await window.collaborator.ensurePresentationPreview(filePath)
      setPdfPreview(nextPreview)

      if (nextPreview.status === 'ready' && nextPreview.filePath) {
        setPdfPreviewMessage(nextPreview.detail ?? null)
        return
      }

      setPdfPreviewMessage(
        nextPreview.detail ?? 'A PDF preview could not be generated for this presentation.'
      )
    } finally {
      setPdfPreviewLoading(false)
    }
  }

  const attachLinkAction = onSetPresentationEmbedUrl ? (
    <ActionButton
      onClick={() => {
        setIsEditing((current) => !current)
      }}
    >
      {isEditing ? 'Close link' : 'Attach link'}
    </ActionButton>
  ) : null

  const pdfPreviewAction = (
    <ActionButton
      onClick={() => {
        void openPdfPreview()
      }}
    >
      {pdfPreviewLoading ? 'Rendering…' : 'PDF preview'}
    </ActionButton>
  )

  if (savedDescriptor && presentationEmbedUrl) {
    return (
      <div className="relative h-full">
        <EmbedPane
          headerActions={
            onSetPresentationEmbedUrl ? (
              <>
                <ActionButton
                  onClick={() => {
                    setIsEditing((current) => !current)
                  }}
                >
                  {isEditing ? 'Close' : 'Change'}
                </ActionButton>
                <ActionButton
                  onClick={() => {
                    onSetPresentationEmbedUrl(null)
                    setDraftUrl('')
                    setErrorMessage(null)
                    setIsEditing(false)
                  }}
                >
                  Clear
                </ActionButton>
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

  if (pdfPreview?.status === 'ready' && pdfPreview.filePath) {
    return (
      <div className="relative h-full">
        <PdfPane
          filePath={pdfPreview.filePath}
          headerActions={
            <>
              <ActionButton
                onClick={() => {
                  setPdfPreview(null)
                  setPdfPreviewMessage(null)
                }}
              >
                Office view
              </ActionButton>
              {attachLinkAction}
            </>
          }
          showTileRefreshButton={showTileRefreshButton}
          showViewerRefreshButton={showViewerRefreshButton}
          title={fileName}
          variant={variant}
        />
        {pdfPreviewMessage ? (
          <div className="pointer-events-none absolute bottom-4 left-4 z-20 max-w-[28rem] rounded-[6px] border border-[color:var(--line)] bg-[color:var(--surface-overlay)] px-3 py-2 text-[12px] leading-5 text-[var(--text-dim)] shadow-[0_20px_40px_rgba(15,23,42,0.18)] backdrop-blur">
            {pdfPreviewMessage}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="relative h-full">
      <OnlyOfficePane
        filePath={filePath}
        headerActions={attachLinkAction}
        kindLabel="Presentation Surface"
        officeViewer={officeViewer}
        refreshToken={refreshToken}
        showTileRefreshButton={showTileRefreshButton}
        showViewerRefreshButton={showViewerRefreshButton}
        unavailableActions={
          <>
            {pdfPreviewAction}
            {attachLinkAction}
          </>
        }
        variant={variant}
      />
      {pdfPreviewMessage && !isEditing ? (
        <div className="absolute inset-x-4 bottom-4 z-20 rounded-[6px] border border-[color:var(--line)] bg-[color:var(--surface-overlay)] px-3 py-2 text-[12px] leading-5 text-[var(--text-dim)] shadow-[0_20px_40px_rgba(15,23,42,0.18)] backdrop-blur">
          {pdfPreviewMessage}
        </div>
      ) : null}
      {isEditing && onSetPresentationEmbedUrl ? (
        <div className="absolute inset-x-4 bottom-4 z-20 rounded-[6px] border border-[color:var(--line)] bg-[color:var(--surface-overlay)] p-3 shadow-[0_20px_40px_rgba(15,23,42,0.18)] backdrop-blur">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
            Attach Slideshow URL
          </div>
          <div className="mt-2 flex gap-2">
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
              Save
            </button>
          </div>
          {errorMessage ? (
            <div className="mt-2 text-[12px] text-[var(--error-text)]">{errorMessage}</div>
          ) : (
            <div className="mt-2 text-[12px] leading-5 text-[var(--text-dim)]">
              Local `.pptx` files now open directly on the canvas. Attach a published slideshow URL only when you want a Google Slides or hosted web presentation view instead.
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
