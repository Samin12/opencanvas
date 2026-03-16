import { memo } from 'react'

import type { FileTreeNode } from '@shared/types'

import { DocumentPane } from './DocumentPane'

interface ViewerOverlayProps {
  file: FileTreeNode | null
  onClose: () => void
  onPlaceOnCanvas: (file: FileTreeNode) => void
}

function ViewerOverlayComponent({ file, onClose, onPlaceOnCanvas }: ViewerOverlayProps) {
  if (!file) {
    return null
  }

  return (
    <aside className="glass-panel absolute bottom-6 left-6 top-6 z-[240] flex w-[min(54vw,760px)] flex-col rounded-[18px]">
      <div className="flex items-start justify-between border-b border-[color:var(--line)] px-5 pb-4 pt-5">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.25em] text-[var(--text-faint)]">Preview</div>
          <div className="mt-2 truncate text-lg font-semibold text-[var(--text)]">{file.name}</div>
          <div className="mt-1 truncate text-xs text-[var(--text-dim)]">{file.path}</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="rounded-full border border-[color:var(--line)] bg-[var(--surface-0)] px-3 py-1.5 text-xs text-[var(--text-dim)] transition hover:bg-[var(--surface-1)]"
            onClick={() => onPlaceOnCanvas(file)}
          >
            Place On Canvas
          </button>
          <div className="rounded-full border border-[color:var(--line)] bg-[var(--surface-0)] px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] text-[var(--text-faint)]">
            Esc
          </div>
          <button
            className="rounded-full border border-[color:var(--line)] bg-[var(--surface-0)] px-3 py-1.5 text-xs text-[var(--text)] transition hover:bg-[var(--surface-1)]"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 p-4">
        <DocumentPane fileKind={file.fileKind ?? 'code'} filePath={file.path} variant="viewer" />
      </div>
    </aside>
  )
}

export const ViewerOverlay = memo(ViewerOverlayComponent, (previous, next) => {
  return previous.file?.path === next.file?.path && previous.file?.fileKind === next.file?.fileKind
})
