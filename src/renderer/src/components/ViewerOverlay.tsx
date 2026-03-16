import { memo } from 'react'

import type { FileTreeNode } from '@shared/types'

import { DocumentPane } from './DocumentPane'

interface ViewerOverlayProps {
  file: FileTreeNode | null
  onClose: () => void
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

function viewerKindLabel(file: FileTreeNode): string {
  if (file.fileKind === 'note') {
    return 'Note'
  }

  if (file.fileKind === 'image') {
    return 'Image'
  }

  return 'Code'
}

function ViewerOverlayComponent({ file, onClose, onPlaceOnCanvas }: ViewerOverlayProps) {
  if (!file) {
    return null
  }

  return (
    <div
      className="absolute inset-0 z-[290] bg-[color:var(--overlay)]/90 backdrop-blur-[3px]"
      onClick={onClose}
    >
      <aside
        className="glass-panel absolute inset-y-4 left-4 flex w-[min(60vw,920px)] min-w-[640px] flex-col overflow-hidden rounded-[14px] border border-[color:var(--line-strong)] shadow-[0_28px_80px_rgba(0,0,0,0.34)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-[color:var(--line)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--surface-1)_92%,transparent),var(--surface-0))] px-6 pb-5 pt-6">
          <div className="flex items-start justify-between gap-6">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <div className="font-['IBM_Plex_Mono','SFMono-Regular','Menlo',monospace] text-[11px] uppercase tracking-[0.18em] text-[var(--text-faint)]">
                  Preview
                </div>
                <div className="rounded-[999px] border border-[color:var(--line)] bg-[var(--surface-0)] px-2.5 py-1 font-['IBM_Plex_Mono','SFMono-Regular','Menlo',monospace] text-[10px] uppercase tracking-[0.14em] text-[var(--text-dim)]">
                  {viewerKindLabel(file)}
                </div>
              </div>
              <div className="mt-4 truncate text-[2.1rem] font-semibold leading-[0.92] tracking-[-0.05em] text-[var(--text)]">
                {file.name}
              </div>
              <div className="mt-4 rounded-[10px] border border-[color:var(--line)] bg-[color:var(--surface-overlay)] px-3.5 py-3">
                <div className="font-['IBM_Plex_Mono','SFMono-Regular','Menlo',monospace] text-[10px] uppercase tracking-[0.14em] text-[var(--text-faint)]">
                  Source
                </div>
                <div className="mt-1 truncate font-['IBM_Plex_Mono','SFMono-Regular','Menlo',monospace] text-[12px] text-[var(--text-dim)]">
                  {file.path}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2 self-start">
              <button
                className="inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-[10px] border border-[color:var(--accent)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--accent-soft)_84%,transparent),color-mix(in_srgb,var(--surface-0)_92%,var(--accent-soft)))] px-4 text-sm font-medium text-[var(--text)] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition hover:-translate-y-px hover:border-[color:var(--accent)] hover:shadow-[0_10px_24px_rgba(0,0,0,0.18)]"
                onClick={() => {
                  onPlaceOnCanvas(file)
                  onClose()
                }}
              >
                <PlaceIcon />
                <span>Add To Canvas</span>
              </button>
              <div className="hidden rounded-[8px] border border-[color:var(--line)] bg-[var(--surface-0)] px-3 py-1.5 font-['IBM_Plex_Mono','SFMono-Regular','Menlo',monospace] text-[11px] uppercase tracking-[0.14em] text-[var(--text-faint)] sm:block">
                Esc
              </div>
              <button
                className="inline-flex h-11 items-center whitespace-nowrap rounded-[10px] border border-[color:var(--line-strong)] bg-[var(--surface-0)] px-4 text-sm text-[var(--text)] transition hover:bg-[var(--surface-1)]"
                onClick={onClose}
              >
                Close
              </button>
            </div>
          </div>
        </div>
        <div className="min-h-0 flex-1 p-5">
          <DocumentPane fileKind={file.fileKind ?? 'code'} filePath={file.path} variant="viewer" />
        </div>
      </aside>
    </div>
  )
}

export const ViewerOverlay = memo(ViewerOverlayComponent, (previous, next) => {
  return previous.file?.path === next.file?.path && previous.file?.fileKind === next.file?.fileKind
})
