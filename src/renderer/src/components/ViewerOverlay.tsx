import type { FileTreeNode } from '@shared/types'

import { DocumentPane } from './DocumentPane'

interface ViewerOverlayProps {
  file: FileTreeNode | null
  onClose: () => void
  onPlaceOnCanvas: (file: FileTreeNode) => void
}

export function ViewerOverlay({ file, onClose, onPlaceOnCanvas }: ViewerOverlayProps) {
  if (!file) {
    return null
  }

  return (
    <aside className="glass-panel absolute bottom-6 left-6 top-6 z-[240] flex w-[min(54vw,760px)] flex-col rounded-[18px]">
      <div className="flex items-start justify-between border-b border-slate-200 px-5 pb-4 pt-5">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.25em] text-slate-400">Preview</div>
          <div className="mt-2 truncate text-lg font-semibold text-slate-800">{file.name}</div>
          <div className="mt-1 truncate text-xs text-slate-500">{file.path}</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 transition hover:bg-slate-50"
            onClick={() => onPlaceOnCanvas(file)}
          >
            Place On Canvas
          </button>
          <div className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] text-slate-500">
            Esc
          </div>
          <button
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 transition hover:bg-slate-50"
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
