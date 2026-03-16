import type { ReactNode } from 'react'

import clsx from 'clsx'
import type { AppConfig, FileTreeNode, SidebarSide } from '@shared/types'

import { FileTree } from './FileTree'

function SearchIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-[1.5]">
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.25 10.25L13.5 13.5" strokeLinecap="round" />
    </svg>
  )
}

function AddWorkspaceIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4.5 w-4.5 fill-none stroke-current stroke-[1.35]">
      <path d="M2.25 4.25A1.75 1.75 0 0 1 4 2.5H6.5L8 4h4A1.75 1.75 0 0 1 13.75 5.75V11.75A1.75 1.75 0 0 1 12 13.5H4A1.75 1.75 0 0 1 2.25 11.75V4.25Z" strokeLinejoin="round" />
      <path d="M11 8H8M9.5 6.5V9.5" strokeLinecap="round" />
    </svg>
  )
}

function NewNoteIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4.5 w-4.5 fill-none stroke-current stroke-[1.35]">
      <path d="M4 2.25H9.25L12.5 5.5V12A1.75 1.75 0 0 1 10.75 13.75H4A1.75 1.75 0 0 1 2.25 12V4A1.75 1.75 0 0 1 4 2.25Z" strokeLinejoin="round" />
      <path d="M9 2.75V5.75H12" strokeLinejoin="round" />
      <path d="M8 8H5M8 10.5H5" strokeLinecap="round" />
    </svg>
  )
}

function NewTerminalIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4.5 w-4.5 fill-none stroke-current stroke-[1.35]">
      <rect x="2" y="2.5" width="12" height="11" rx="2" />
      <path d="M4.5 6L6.75 8L4.5 10" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.25 10H11.5" strokeLinecap="round" />
    </svg>
  )
}

function SidebarIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-[1.3]">
      <rect x="1.75" y="2.25" width="12.5" height="11.5" rx="2.25" />
      <path d="M5.5 2.75V13.25" />
      {collapsed ? (
        <path d="M7.75 8H11.5M10 6.25L11.75 8L10 9.75" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M11.5 8H7.75M9.25 6.25L7.5 8L9.25 9.75" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  )
}

function SidebarSideIcon({ side }: { side: SidebarSide }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-[1.3]">
      <rect x="1.75" y="2.25" width="12.5" height="11.5" rx="2.25" />
      <path d={side === 'left' ? 'M5.5 2.75V13.25' : 'M10.5 2.75V13.25'} />
      <path
        d={
          side === 'left'
            ? 'M8.75 8H12M10.5 6.25L12.25 8L10.5 9.75'
            : 'M7.25 8H4M5.5 6.25L3.75 8L5.5 9.75'
        }
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ThemeIcon({ darkMode }: { darkMode: boolean }) {
  if (darkMode) {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-[1.35]">
        <path
          d="M10.9 1.75C8.25 2.1 6.2 4.35 6.2 7.15C6.2 10.2 8.7 12.65 11.75 12.65C12.35 12.65 12.95 12.55 13.45 12.35C12.55 13.45 11.15 14.1 9.6 14.1C6.85 14.1 4.6 11.9 4.6 9.1C4.6 6.15 6.95 3.7 9.85 3.7C10.2 3.7 10.55 3.75 10.9 3.85V1.75Z"
          strokeLinejoin="round"
        />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-[1.35]">
      <circle cx="8" cy="8" r="2.9" />
      <path d="M8 1.5V3.2M8 12.8V14.5M14.5 8H12.8M3.2 8H1.5M12.6 3.4L11.35 4.65M4.65 11.35L3.4 12.6M12.6 12.6L11.35 11.35M4.65 4.65L3.4 3.4" strokeLinecap="round" />
    </svg>
  )
}

function ActionIconButton({
  active = false,
  children,
  className,
  disabled = false,
  label,
  onClick
}: {
  active?: boolean
  children: ReactNode
  className?: string
  disabled?: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      aria-label={label}
      disabled={disabled}
      title={label}
      className={clsx(
        'flex h-8 w-8 items-center justify-center rounded-full border transition',
        active
          ? 'border-[color:var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
          : 'border-[color:var(--line)] bg-[var(--surface-0)] text-[var(--text-dim)] hover:bg-[var(--surface-1)]',
        'disabled:cursor-not-allowed disabled:opacity-40',
        className
      )}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

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
  onCreateNote: () => void
  onCreateTerminal: () => void
  onMoveFile: (sourcePath: string, targetDirectoryPath: string) => void
  onMoveSidebar: (side: SidebarSide) => void
  onOpenSearch: () => void
  onPlaceFile: (node: FileTreeNode) => void
  onRemoveWorkspace: () => void
  onSelectFile: (node: FileTreeNode) => void
  onSelectWorkspace: (index: number) => void
  onToggleSidebar: () => void
  onToggleDarkMode: () => void
  sidebarCollapsed: boolean
  sidebarSide: SidebarSide
  workspaceTree: FileTreeNode[]
}

export function Sidebar({
  activeFilePath,
  config,
  darkMode,
  loadingWorkspace,
  onAddWorkspace,
  onCreateNote,
  onCreateTerminal,
  onMoveFile,
  onMoveSidebar,
  onOpenSearch,
  onPlaceFile,
  onRemoveWorkspace,
  onSelectFile,
  onSelectWorkspace,
  onToggleSidebar,
  onToggleDarkMode,
  sidebarCollapsed,
  sidebarSide,
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
          <div className="flex items-center justify-end gap-1.5">
            <ActionIconButton label="Search (Cmd+K)" onClick={onOpenSearch}>
              <SearchIcon />
            </ActionIconButton>
            <ActionIconButton
              label={sidebarSide === 'left' ? 'Move Sidebar to the Right' : 'Move Sidebar to the Left'}
              onClick={() => onMoveSidebar(sidebarSide === 'left' ? 'right' : 'left')}
            >
              <SidebarSideIcon side={sidebarSide} />
            </ActionIconButton>
            <ActionIconButton
              active={sidebarCollapsed}
              label={sidebarCollapsed ? 'Show Sidebar' : 'Hide Sidebar'}
              onClick={onToggleSidebar}
            >
              <SidebarIcon collapsed={sidebarCollapsed} />
            </ActionIconButton>
            <ActionIconButton
              active={darkMode}
              label={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              onClick={onToggleDarkMode}
            >
              <ThemeIcon darkMode={darkMode} />
            </ActionIconButton>
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
            <ActionIconButton
              className="h-10 w-10 rounded-2xl"
              label="Add Workspace"
              onClick={onAddWorkspace}
            >
              <AddWorkspaceIcon />
            </ActionIconButton>
            <ActionIconButton
              className="h-10 w-10 rounded-2xl"
              disabled={!activeWorkspacePath}
              label="New Note"
              onClick={onCreateNote}
            >
              <NewNoteIcon />
            </ActionIconButton>
            <ActionIconButton
              className="h-10 w-10 rounded-2xl"
              disabled={!activeWorkspacePath}
              label="New Terminal"
              onClick={onCreateTerminal}
            >
              <NewTerminalIcon />
            </ActionIconButton>
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
            onMoveFile={onMoveFile}
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
