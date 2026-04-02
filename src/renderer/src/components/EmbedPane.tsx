import { memo, type ReactNode } from 'react'

import clsx from 'clsx'

import { PdfPane } from './document-panes/PdfPane'
import { embedDescriptorFromUrl } from '../utils/embedTiles'

interface EmbedPaneProps {
  headerActions?: ReactNode
  title: string
  url: string
  variant?: 'tile' | 'viewer'
}

function OpenExternalButton({ url }: { url: string }) {
  return (
    <button
      className="rounded-[var(--radius-control)] border border-[color:var(--line-strong)] bg-[var(--surface-0)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-dim)] transition hover:bg-[var(--surface-1)] hover:text-[var(--text)]"
      onClick={() => {
        void window.collaborator.openExternalUrl(url)
      }}
      title="Open in browser"
    >
      Open
    </button>
  )
}

function EmbedPaneComponent({ headerActions, title, url, variant = 'tile' }: EmbedPaneProps) {
  const descriptor = embedDescriptorFromUrl(url)

  if (!descriptor) {
    return (
      <div className="flex h-full items-center justify-center rounded-[var(--radius-surface)] border border-[color:var(--error-line)] bg-[var(--error-bg)] p-4 text-center text-sm text-[var(--error-text)]">
        This link could not be embedded on the canvas.
      </div>
    )
  }

  if (descriptor.renderKind === 'video') {
    return (
      <div className="relative flex h-full items-center justify-center overflow-hidden rounded-[var(--radius-surface)] bg-black/90">
        {variant === 'viewer' ? (
          <div className="absolute right-3 top-3 z-10">
            <OpenExternalButton url={descriptor.canonicalUrl} />
          </div>
        ) : null}
        <video
          src={descriptor.sourceUrl}
          controls
          preload="metadata"
          playsInline
          className="h-full w-full bg-black object-contain"
        />
      </div>
    )
  }

  if (descriptor.renderKind === 'pdf') {
    return (
      <div className="h-full">
        <PdfPane sourceUrl={descriptor.sourceUrl} title={title || descriptor.title} variant={variant} />
      </div>
    )
  }

  if (variant === 'tile') {
    return (
      <div className="relative h-full overflow-hidden rounded-[var(--radius-surface)] bg-[var(--surface-0)]">
        <iframe
          key={descriptor.sourceUrl}
          src={descriptor.sourceUrl}
          title={title || descriptor.title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          className="h-full w-full border-0"
          referrerPolicy="no-referrer-when-downgrade"
        />
      </div>
    )
  }

  return (
    <div
      className={clsx(
        'relative h-full overflow-hidden rounded-[var(--radius-surface)] border border-[color:var(--line)] bg-[var(--surface-0)]',
        'bg-[var(--surface-0)]'
      )}
    >
      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between border-b border-[color:var(--line)] bg-[color:var(--surface-overlay)] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)] backdrop-blur">
        <span className="truncate">{descriptor.hostLabel}</span>
        <div className="flex items-center gap-2">
          {headerActions}
          <OpenExternalButton url={descriptor.canonicalUrl} />
        </div>
      </div>
      <iframe
        key={descriptor.sourceUrl}
        src={descriptor.sourceUrl}
        title={title || descriptor.title}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        className="h-full w-full border-0"
        referrerPolicy="no-referrer-when-downgrade"
      />
      <div className="pointer-events-none absolute inset-x-3 bottom-3 rounded-[var(--radius-control)] border border-[color:var(--line)] bg-[color:var(--surface-overlay)] px-3 py-2 text-[11px] text-[var(--text-dim)] backdrop-blur">
        If this page stays blank, the site blocked iframe embedding. Use Open to continue in your browser.
      </div>
    </div>
  )
}

export const EmbedPane = memo(EmbedPaneComponent, (previous, next) => {
  return (
    previous.title === next.title &&
    previous.url === next.url &&
    previous.variant === next.variant &&
    previous.headerActions === next.headerActions
  )
})
