import { useEffect, useState } from 'react'

import clsx from 'clsx'

import {
  cacheBustedFileUrl,
  ErrorPane,
  LoadingPane,
  useFileChangeSignal,
  type ViewerVariant
} from './FileViewerSurface'

const COLLABORATOR_FILE_MIME = 'application/x-collaborator-file'

export function VideoPane({
  filePath,
  refreshToken = 0,
  showTileRefreshButton = true,
  showViewerRefreshButton = true,
  variant = 'tile'
}: {
  filePath: string
  refreshToken?: number
  showTileRefreshButton?: boolean
  showViewerRefreshButton?: boolean
  variant?: ViewerVariant
}) {
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [reloadCount, setReloadCount] = useState(0)
  const [status, setStatus] = useState<'loading' | 'idle' | 'error'>('loading')
  const fileChangeCount = useFileChangeSignal(filePath)

  useEffect(() => {
    setVideoUrl(null)
    setStatus('loading')
  }, [filePath])

  useEffect(() => {
    if (refreshToken > 0) {
      setReloadCount((current) => current + 1)
    }
  }, [refreshToken])

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const nextVideoUrl = await window.collaborator.fileUrl(filePath)

        if (!cancelled) {
          setVideoUrl(cacheBustedFileUrl(nextVideoUrl, fileChangeCount + reloadCount + refreshToken))
          setStatus('idle')
        }
      } catch {
        if (!cancelled) {
          setStatus('error')
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [filePath, fileChangeCount, refreshToken, reloadCount])

  if (status === 'error') {
    return <ErrorPane variant={variant} />
  }

  if (!videoUrl || status === 'loading') {
    return <LoadingPane variant={variant} />
  }

  const dragPayload = JSON.stringify({
    fileKind: 'video',
    name: filePath.split(/[\\/]/).pop() ?? 'Video',
    path: filePath
  })

  return (
    <div
      className={clsx(
        'relative flex h-full items-center justify-center overflow-hidden bg-[var(--surface-1)]',
        variant === 'viewer'
          ? 'rounded-[var(--radius-surface)] border border-[color:var(--line)]'
          : 'rounded-[var(--radius-surface)]'
      )}
    >
      {(variant === 'tile' && showTileRefreshButton) ||
      (variant === 'viewer' && showViewerRefreshButton) ? (
        <button
          className={clsx(
            'absolute z-10 flex h-6 min-w-6 items-center justify-center rounded-[var(--radius-control)] border border-[color:var(--line)] bg-[color:var(--surface-overlay)] px-2 text-[11px] text-[var(--text-dim)] shadow-[0_4px_10px_rgba(15,23,42,0.08)] backdrop-blur transition hover:border-[color:var(--line-strong)] hover:text-[var(--text)]',
            variant === 'viewer' ? 'right-3 top-3' : 'right-2 top-2'
          )}
          onClick={() => setReloadCount((current) => current + 1)}
          title="Refresh video"
        >
          ↻
        </button>
      ) : null}
      <video
        key={`${fileChangeCount}:${reloadCount}`}
        src={videoUrl}
        controls
        preload="metadata"
        playsInline
        draggable
        className="h-full w-full bg-black/10 object-contain"
        onDragStart={(event) => {
          if (!event.dataTransfer) {
            return
          }

          event.dataTransfer.effectAllowed = 'copy'
          event.dataTransfer.setData(COLLABORATOR_FILE_MIME, dragPayload)
          event.dataTransfer.setData('text/plain', filePath)
        }}
      />
    </div>
  )
}
