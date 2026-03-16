import { memo, useEffect, useState } from 'react'

import type { FileTreeNode } from '@shared/types'

import { DocumentPane } from './DocumentPane'
import { composeTooltipLabel } from '../utils/buttonTooltips'

interface ViewerOverlayProps {
  file: FileTreeNode | null
  onClose: () => void
  onImportImageFile?: (file: File) => Promise<{ name: string; path: string } | null>
  onPlaceOnCanvas: (file: FileTreeNode) => void
}

function PlaceIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-[1.4]">
      <path d="M2.5 8H10.75" strokeLinecap="round" />
      <path d="M8.5 5.75L10.75 8L8.5 10.25" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="11.25" y="3" width="2.75" height="10" rx="0.85" />
    </svg>
  )
}

function RefreshIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="h-4 w-4 fill-none stroke-current stroke-[1.45] [stroke-linecap:round] [stroke-linejoin:round]"
    >
      <path d="M13 4.75V8h-3.25" />
      <path d="M3 11.25V8h3.25" />
      <path d="M4.15 6.2A4.25 4.25 0 0 1 12.55 5" />
      <path d="M11.85 9.8A4.25 4.25 0 0 1 3.45 11" />
    </svg>
  )
}

function viewerKindLabel(file: FileTreeNode): string {
  if (file.fileKind === 'note') {
    return 'Note'
  }

  if (file.fileKind === 'image') {
    return 'Image'
  }

  return 'Code'
}

function ViewerOverlayComponent({
  file,
  onClose,
  onImportImageFile,
  onPlaceOnCanvas
}: ViewerOverlayProps) {
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => {
    setRefreshToken(0)
  }, [file?.path])

  if (!file) {
    return null
  }

  return (
    <div
      className="absolute inset-0 z-[290] bg-[color:var(--overlay)]/90 backdrop-blur-[3px]"
      onClick={onClose}
    >
      <aside
        className="glass-panel absolute inset-y-4 left-4 flex w-[min(60vw,920px)] min-w-[640px] flex-col overflow-hidden rounded-[6px] border border-[color:var(--line-strong)] shadow-[0_28px_80px_rgba(0,0,0,0.34)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-[color:var(--line)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--surface-1)_92%,transparent),var(--surface-0))] px-6 pb-5 pt-6">
          <div className="flex items-start justify-between gap-6">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-faint)]">
                  Preview
                </div>
                <div className="rounded-[4px] border border-[color:var(--line)] bg-[var(--surface-0)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-dim)]">
                  {viewerKindLabel(file)}
                </div>
              </div>
              <div className="mt-4 truncate px-0.5 pb-1 pt-0.5 font-[var(--font-display)] text-[2.1rem] font-semibold leading-[1.02] tracking-[-0.05em] text-[var(--text)]">
                {file.name}
              </div>
              <div className="mt-4 rounded-[4px] border border-[color:var(--line)] bg-[color:var(--surface-overlay)] px-3.5 py-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
                  Source
                </div>
                <div className="mt-1 truncate font-[var(--font-mono)] text-[12px] text-[var(--text-dim)]">
                  {file.path}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2 self-start">
              <button
                className="inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-[4px] border border-[color:var(--line-strong)] bg-[var(--surface-0)] px-4 text-sm text-[var(--text)] transition hover:bg-[var(--surface-1)]"
                onClick={() => setRefreshToken((current) => current + 1)}
                title="Refresh file"
              >
                <RefreshIcon />
                <span>Refresh</span>
              </button>
              <button
                className="inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-[4px] border border-[color:var(--accent)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--accent-soft)_84%,transparent),color-mix(in_srgb,var(--surface-0)_92%,var(--accent-soft)))] px-4 text-sm font-medium text-[var(--text)] transition hover:border-[color:var(--accent)]"
                data-shortcut="Shift+Enter"
                onClick={() => {
                  onPlaceOnCanvas(file)
                  onClose()
                }}
                title={composeTooltipLabel('Add to canvas', 'Shift+Enter')}
              >
                <PlaceIcon />
                <span>Add To Canvas</span>
              </button>
              <div className="hidden rounded-[4px] border border-[color:var(--line)] bg-[var(--surface-0)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)] sm:block">
                Esc
              </div>
              <button
                className="inline-flex h-11 items-center whitespace-nowrap rounded-[4px] border border-[color:var(--line-strong)] bg-[var(--surface-0)] px-4 text-sm text-[var(--text)] transition hover:bg-[var(--surface-1)]"
                onClick={onClose}
                data-shortcut="Esc"
                title={composeTooltipLabel('Close preview', 'Esc')}
              >
                Close
              </button>
            </div>
          </div>
        </div>
        <div className="min-h-0 flex-1 p-5">
          <DocumentPane
            fileKind={file.fileKind ?? 'code'}
            filePath={file.path}
            onImportImageFile={onImportImageFile}
            refreshToken={refreshToken}
            showViewerRefreshButton={false}
            variant="viewer"
          />
        </div>
      </aside>
    </div>
  )
}

export const ViewerOverlay = memo(ViewerOverlayComponent, (previous, next) => {
  return previous.file?.path === next.file?.path && previous.file?.fileKind === next.file?.fileKind
})
