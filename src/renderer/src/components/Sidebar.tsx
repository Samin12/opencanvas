import type { AppConfig, FileTreeNode } from '@shared/types'

import { FileTree } from './FileTree'

function workspaceLabel(workspacePath: string): string {
  const parts = workspacePath.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? workspacePath
}

interface SidebarProps {
  activeFilePath: string | null
  config: AppConfig
  loadingWorkspace: boolean
  onAddWorkspace: () => void
  onCreateTerminal: () => void
  onOpenSearch: () => void
  onPlaceFile: (node: FileTreeNode) => void
  onRemoveWorkspace: () => void
  onSelectFile: (node: FileTreeNode) => void
  onSelectWorkspace: (index: number) => void
  workspaceTree: FileTreeNode[]
}

export function Sidebar({
  activeFilePath,
  config,
  loadingWorkspace,
  onAddWorkspace,
  onCreateTerminal,
  onOpenSearch,
  onPlaceFile,
  onRemoveWorkspace,
  onSelectFile,
  onSelectWorkspace,
  workspaceTree
}: SidebarProps) {
  const activeWorkspacePath = config.workspaces[config.activeWorkspace] ?? null

  return (
    <aside className="glass-panel flex h-full min-w-0 flex-col rounded-[28px]">
      <div className="border-b border-slate-200 px-4 pb-4 pt-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.25em] text-slate-400">Navigator</div>
            <h1 className="mt-2 text-xl font-semibold tracking-tight text-slate-800">
              Collaborator Clone
            </h1>
          </div>
          <button
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 transition hover:bg-slate-50"
            onClick={onOpenSearch}
          >
            Search
          </button>
        </div>

        <div className="space-y-2">
          <div className="text-[11px] uppercase tracking-[0.25em] text-slate-400">Workspace</div>
          <select
            className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-amber-300"
            value={config.activeWorkspace}
            onChange={(event) => onSelectWorkspace(Number(event.target.value))}
            disabled={config.workspaces.length === 0}
          >
            {config.workspaces.length === 0 ? (
              <option value={0}>No workspace selected</option>
            ) : (
              config.workspaces.map((workspace, index) => (
                <option key={workspace} value={index}>
                  {workspaceLabel(workspace)}
                </option>
              ))
            )}
          </select>

          <div className="flex gap-2">
            <button
              className="flex-1 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              onClick={onAddWorkspace}
            >
              Add Workspace
            </button>
            <button
              className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
              onClick={onCreateTerminal}
            >
              New Terminal
            </button>
          </div>

          <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white/70 px-3 py-3 text-xs text-slate-500">
            <span className="truncate">{activeWorkspacePath ?? 'Add a folder to start building a spatial workspace.'}</span>
            <button
              className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              onClick={onRemoveWorkspace}
              disabled={!activeWorkspacePath}
            >
              Remove
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-3 py-4">
        <div className="mb-3 flex items-center justify-between px-1">
          <div className="text-[11px] uppercase tracking-[0.25em] text-slate-400">Files</div>
          {loadingWorkspace ? <div className="text-xs text-slate-400">Refreshing…</div> : null}
        </div>
        <div className="mb-3 rounded-2xl border border-slate-200 bg-white/70 px-3 py-2 text-xs text-slate-500">
          Click a file to preview it. Double-click to place another version on the canvas.
        </div>
        {activeWorkspacePath ? (
          <FileTree
            activeFilePath={activeFilePath}
            nodes={workspaceTree}
            onPlaceFile={onPlaceFile}
            onSelectFile={onSelectFile}
          />
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 p-4 text-sm text-slate-500">
            Add a workspace with <span className="text-slate-700">Cmd+Shift+O</span> to populate the
            navigator.
          </div>
        )}
      </div>
    </aside>
  )
}
