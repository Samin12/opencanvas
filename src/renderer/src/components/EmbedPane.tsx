import { memo } from 'react'

import clsx from 'clsx'

import { embedDescriptorFromUrl } from '../utils/embedTiles'

interface EmbedPaneProps {
  title: string
  url: string
}

function EmbedPaneComponent({ title, url }: EmbedPaneProps) {
  const descriptor = embedDescriptorFromUrl(url)

  if (!descriptor) {
    return (
      <div className="flex h-full items-center justify-center rounded-[4px] border border-[color:var(--error-line)] bg-[var(--error-bg)] p-4 text-center text-sm text-[var(--error-text)]">
        This link could not be embedded on the canvas.
      </div>
    )
  }

  if (descriptor.renderKind === 'video') {
    return (
      <div className="relative flex h-full items-center justify-center overflow-hidden rounded-[4px] bg-black/90">
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

  return (
    <div
      className={clsx(
        'relative h-full overflow-hidden rounded-[4px] border border-[color:var(--line)] bg-[var(--surface-0)]',
        descriptor.renderKind === 'pdf' ? 'bg-white' : 'bg-[var(--surface-0)]'
      )}
    >
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

export const EmbedPane = memo(EmbedPaneComponent, (previous, next) => {
  return previous.title === next.title && previous.url === next.url
})
