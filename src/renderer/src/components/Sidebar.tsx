import clsx from 'clsx'
import type { AppConfig, FileTreeNode } from '@shared/types'

import { FileTree } from './FileTree'

function workspaceLabel(workspacePath: string): string {
  const parts = workspacePath.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? workspacePath
}

interface SidebarProps {
  activeFilePath: string | null
  config: AppConfig
  darkMode: boolean
  loadingWorkspace: boolean
  onAddWorkspace: () => void
  onCreateTerminal: () => void
  onOpenSearch: () => void
  onPlaceFile: (node: FileTreeNode) => void
  onRemoveWorkspace: () => void
  onSelectFile: (node: FileTreeNode) => void
  onSelectWorkspace: (index: number) => void
  onToggleSidebar: () => void
  onToggleDarkMode: () => void
  sidebarCollapsed: boolean
  workspaceTree: FileTreeNode[]
}

export function Sidebar({
  activeFilePath,
  config,
  darkMode,
  loadingWorkspace,
  onAddWorkspace,
  onCreateTerminal,
  onOpenSearch,
  onPlaceFile,
  onRemoveWorkspace,
  onSelectFile,
  onSelectWorkspace,
  onToggleSidebar,
  onToggleDarkMode,
  sidebarCollapsed,
  workspaceTree
}: SidebarProps) {
  const activeWorkspacePath = config.workspaces[config.activeWorkspace] ?? null

  return (
    <aside className="glass-panel flex h-full min-w-0 flex-col rounded-[28px]">
      <div className="border-b border-[color:var(--line)] px-4 pb-4 pt-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.25em] text-[var(--text-faint)]">
              Navigator
            </div>
            <h1 className="mt-2 text-xl font-semibold tracking-tight text-[var(--text)]">
              Collaborator Clone
            </h1>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              className="rounded-full border border-[color:var(--line)] bg-[var(--surface-0)] px-3 py-1.5 text-xs text-[var(--text-dim)] transition hover:bg-[var(--surface-1)]"
              onClick={onOpenSearch}
            >
              Search
            </button>
            <button
              className={clsx(
                'rounded-full border px-3 py-1.5 text-xs transition',
                sidebarCollapsed
                  ? 'border-[color:var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                  : 'border-[color:var(--line)] bg-[var(--surface-0)] text-[var(--text-dim)] hover:bg-[var(--surface-1)]'
              )}
              onClick={onToggleSidebar}
            >
              {sidebarCollapsed ? 'Show Sidebar' : 'Hide Sidebar'}
            </button>
            <button
              className={clsx(
                'rounded-full border px-3 py-1.5 text-xs transition',
                darkMode
                  ? 'border-[color:var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                  : 'border-[color:var(--line)] bg-[var(--surface-0)] text-[var(--text-dim)] hover:bg-[var(--surface-1)]'
              )}
              onClick={onToggleDarkMode}
            >
              {darkMode ? 'Light Mode' : 'Dark Mode'}
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-[11px] uppercase tracking-[0.25em] text-[var(--text-faint)]">
            Workspace
          </div>
          <select
            className="w-full rounded-2xl border border-[color:var(--line)] bg-[var(--surface-0)] px-3 py-2.5 text-sm text-[var(--text)] outline-none transition focus:border-[color:var(--accent)]"
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
              className="flex-1 rounded-2xl border border-[color:var(--line)] bg-[var(--surface-0)] px-3 py-2 text-sm font-medium text-[var(--text)] transition hover:bg-[var(--surface-1)]"
              onClick={onAddWorkspace}
            >
              Add Workspace
            </button>
            <button
              className="rounded-2xl border border-[color:var(--line)] bg-[var(--surface-0)] px-3 py-2 text-sm text-[var(--text)] transition hover:bg-[var(--surface-1)]"
              onClick={onCreateTerminal}
            >
              New Terminal
            </button>
          </div>

          <div className="flex items-center justify-between rounded-2xl border border-[color:var(--line)] bg-[var(--surface-1)] px-3 py-3 text-xs text-[var(--text-dim)]">
            <span className="truncate">{activeWorkspacePath ?? 'Add a folder to start building a spatial workspace.'}</span>
            <button
              className="rounded-full border border-[color:var(--line)] bg-[var(--surface-0)] px-2.5 py-1 text-[11px] text-[var(--text-dim)] transition hover:bg-[var(--surface-1)] disabled:cursor-not-allowed disabled:opacity-40"
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
          <div className="text-[11px] uppercase tracking-[0.25em] text-[var(--text-faint)]">Files</div>
          {loadingWorkspace ? <div className="text-xs text-[var(--text-faint)]">Refreshing…</div> : null}
        </div>
        <div className="mb-3 rounded-2xl border border-[color:var(--line)] bg-[var(--surface-1)] px-3 py-2 text-xs text-[var(--text-dim)]">
          Click a file to preview it. Double-click or press Shift+Enter to open a fresh tile on the canvas.
        </div>
        {activeWorkspacePath ? (
          <FileTree
            activeFilePath={activeFilePath}
            darkMode={darkMode}
            nodes={workspaceTree}
            onPlaceFile={onPlaceFile}
            onSelectFile={onSelectFile}
          />
        ) : (
          <div className="rounded-2xl border border-dashed border-[color:var(--line-strong)] bg-[var(--surface-1)] p-4 text-sm text-[var(--text-dim)]">
            Add a workspace with <span className="text-[var(--text)]">Cmd+Shift+O</span> to populate
            the navigator.
          </div>
        )}
      </div>
    </aside>
  )
}
