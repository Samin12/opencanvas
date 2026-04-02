import { useEffect, useState, type ReactNode } from 'react'

import clsx from 'clsx'

export type ViewerVariant = 'tile' | 'viewer'

interface ViewerSurfaceProps {
  children: ReactNode
  headerActions?: ReactNode
  label: string
  onRefresh?: () => void
  showTileRefreshButton?: boolean
  showViewerRefreshButton?: boolean
  statusLabel?: string
  variant: ViewerVariant
}

export function LoadingPane({ variant }: { variant: ViewerVariant }) {
  return (
    <div
      className={clsx(
        'flex h-full items-center justify-center rounded-[var(--radius-surface)] border border-[color:var(--line)] bg-[var(--surface-0)] text-sm text-[var(--text-dim)]'
      )}
    >
      Loading…
    </div>
  )
}

export function ErrorPane({
  actions,
  message = 'This file could not be opened.',
  variant
}: {
  actions?: ReactNode
  message?: string
  variant: ViewerVariant
}) {
  return (
    <div
      className={clsx(
        'flex h-full flex-col items-center justify-center gap-3 rounded-[var(--radius-surface)] border p-4 text-center text-sm',
        'border-[color:var(--error-line)] bg-[var(--error-bg)] text-[var(--error-text)]',
      )}
    >
      <div className="max-w-[36rem] leading-6">{message}</div>
      {actions ? <div className="flex flex-wrap items-center justify-center gap-2">{actions}</div> : null}
    </div>
  )
}

export function FileViewerSurface({
  children,
  headerActions,
  label,
  onRefresh,
  showTileRefreshButton = true,
  showViewerRefreshButton = true,
  statusLabel = 'Synced',
  variant
}: ViewerSurfaceProps) {
  const shouldShowViewerRefresh = variant === 'viewer' && showViewerRefreshButton && onRefresh
  const shouldShowTileRefresh = variant === 'tile' && showTileRefreshButton && onRefresh

  return (
    <div
      className={clsx(
        'relative flex h-full min-h-0 flex-col bg-[var(--surface-0)]',
        variant === 'viewer'
          ? 'overflow-hidden rounded-[var(--radius-surface)] border border-[color:var(--line)] shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]'
          : 'rounded-[var(--radius-surface)]'
      )}
    >
      {variant === 'viewer' ? (
        <div className="flex items-center justify-between border-b border-[color:var(--line)] bg-[color:var(--surface-1)]/82 px-4 py-2.5">
          <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">
            {label}
          </div>
          <div className="flex items-center gap-1.5">
            {headerActions}
            {shouldShowViewerRefresh ? (
              <button
                className="rounded-[var(--radius-control)] border border-[color:var(--line-strong)] bg-[var(--surface-0)] px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--text-dim)] transition hover:bg-[var(--surface-1)] hover:text-[var(--text)]"
                onClick={onRefresh}
                title="Refresh file"
              >
                Refresh
              </button>
            ) : null}
            <div className="rounded-[999px] border border-[color:var(--line)] bg-[var(--surface-0)] px-2 py-0.5 text-[8px] font-semibold uppercase tracking-[0.16em] text-[var(--text-dim)]">
              {statusLabel}
            </div>
          </div>
        </div>
      ) : null}
      {shouldShowTileRefresh ? (
        <button
          className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-[var(--radius-control)] border border-[color:var(--line)] bg-[color:var(--surface-overlay)] text-[12px] text-[var(--text-dim)] shadow-[0_4px_10px_rgba(15,23,42,0.08)] backdrop-blur transition hover:border-[color:var(--line-strong)] hover:text-[var(--text)]"
          onClick={onRefresh}
          title="Refresh file"
        >
          ↻
        </button>
      ) : null}
      {children}
    </div>
  )
}

export function useFileChangeSignal(filePath: string) {
  const [changeCount, setChangeCount] = useState(0)

  useEffect(() => {
    return window.collaborator.onFileChanged(filePath, () => {
      setChangeCount((current) => current + 1)
    })
  }, [filePath])

  return changeCount
}

export function cacheBustedFileUrl(fileUrl: string, version: number) {
  try {
    const nextUrl = new URL(fileUrl)
    nextUrl.searchParams.set('v', String(version))
    return nextUrl.toString()
  } catch {
    return fileUrl
  }
}
