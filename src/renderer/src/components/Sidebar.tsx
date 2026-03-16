import { memo, useState, type ReactNode } from 'react'

import clsx from 'clsx'
import type { AppConfig, FileTreeNode, SidebarSide } from '@shared/types'

import logoMark from '../assets/claude-canvas-logo.svg'
import { FileKindIcon, FileTree } from './FileTree'
import { HoverTooltip } from './HoverTooltip'
import { composeTooltipLabel } from '../utils/buttonTooltips'

const IS_MAC_PLATFORM =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform)
const MODIFIER_KEY = IS_MAC_PLATFORM ? 'Cmd' : 'Ctrl'
const SEARCH_SHORTCUT_KEY = `${MODIFIER_KEY}+K / ${MODIFIER_KEY}+O`
const SEARCH_SHORTCUT_HINT = `${MODIFIER_KEY}+K/O`
const CREATE_NOTE_SHORTCUT_KEY = `${MODIFIER_KEY}+N`
const CREATE_TERMINAL_SHORTCUT_KEY = 'Shift+T'
const ADD_WORKSPACE_SHORTCUT_KEY = `${MODIFIER_KEY}+Shift+O`
const TOGGLE_DARK_MODE_SHORTCUT_KEY = `${MODIFIER_KEY}+Shift+D`
const SIDEBAR_LEFT_SHORTCUT_KEY = IS_MAC_PLATFORM ? 'Cmd+\u2190' : null
const SIDEBAR_RIGHT_SHORTCUT_KEY = IS_MAC_PLATFORM ? 'Cmd+\u2192' : null
const SIDEBAR_TOGGLE_SHORTCUT_KEY = IS_MAC_PLATFORM ? 'Cmd+\u2193' : null

function SearchIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-[1.5]">
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.25 10.25L13.5 13.5" strokeLinecap="round" />
    </svg>
  )
}

function TreeViewIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="h-4 w-4 fill-none stroke-current stroke-[1.35] [stroke-linecap:round] [stroke-linejoin:round]"
    >
      <rect x="2.25" y="2.75" width="4" height="3.75" rx="0.8" />
      <rect x="2.25" y="9.5" width="4" height="3.75" rx="0.8" />
      <rect x="9.75" y="6.1" width="4" height="3.75" rx="0.8" />
      <path d="M6.25 4.65H8.1V8H9.75" />
    </svg>
  )
}

function RecentFilesIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="h-4 w-4 fill-none stroke-current stroke-[1.35] [stroke-linecap:round] [stroke-linejoin:round]"
    >
      <path d="M4 2.5H8.9L12.5 6.05V12A1.5 1.5 0 0 1 11 13.5H4A1.5 1.5 0 0 1 2.5 12V4A1.5 1.5 0 0 1 4 2.5Z" />
      <path d="M8.7 2.75V6H12" />
      <path d="M5.1 8H9.9" />
      <path d="M5.1 10.1H9.9" />
      <path d="M5.1 12.2H8.1" />
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5 fill-none stroke-current stroke-[1.45]">
      <circle cx="8" cy="8" r="5.1" />
      <path d="M8 5.25V8.2L10.2 9.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function SortArrowIcon({ ascending }: { ascending: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={clsx('h-3.5 w-3.5 fill-current transition-transform', ascending && 'rotate-180')}
    >
      <path d="M8 11.9L3.8 6.8H12.2L8 11.9Z" />
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

function ChevronDownIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="h-4 w-4 fill-none stroke-current stroke-[1.4] [stroke-linecap:round] [stroke-linejoin:round]"
    >
      <path d="m4.5 6.25 3.5 3.5 3.5-3.5" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="h-4.5 w-4.5 fill-none stroke-current stroke-[1.35] [stroke-linecap:round] [stroke-linejoin:round]"
    >
      <path d="M3.5 4.5H12.5" />
      <path d="M6 2.75H10" />
      <path d="M5 4.5V12a1.25 1.25 0 0 0 1.25 1.25h3.5A1.25 1.25 0 0 0 11 12V4.5" />
      <path d="M6.75 6.5V11" />
      <path d="M9.25 6.5V11" />
    </svg>
  )
}

function FolderOpenIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="h-4.5 w-4.5 fill-none stroke-current stroke-[1.35] [stroke-linecap:round] [stroke-linejoin:round]"
    >
      <path d="M2.25 4.25A1.75 1.75 0 0 1 4 2.5H6.35L7.75 4H12A1.75 1.75 0 0 1 13.75 5.75V11.75A1.75 1.75 0 0 1 12 13.5H4A1.75 1.75 0 0 1 2.25 11.75V4.25Z" />
      <path d="M8.25 6.25H11.75V9.75" />
      <path d="M7.25 10.75L11.75 6.25" />
    </svg>
  )
}

function CopyIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="h-4.5 w-4.5 fill-none stroke-current stroke-[1.35] [stroke-linecap:round] [stroke-linejoin:round]"
    >
      <rect x="5.25" y="3.25" width="7.5" height="9.5" rx="1.5" />
      <path d="M3.25 10.75V5A1.75 1.75 0 0 1 5 3.25" />
    </svg>
  )
}

function SidebarIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-[1.3]">
      <rect x="1.75" y="2.25" width="12.5" height="11.5" rx="1.1" />
      <path d="M5.5 2.75V13.25" />
      {collapsed ? (
        <path d="M7.75 8H11.5M10 6.25L11.75 8L10 9.75" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M11.5 8H7.75M9.25 6.25L7.5 8L9.25 9.75" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  )
}

function DockSidePreviewIcon({ side }: { side: SidebarSide }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-[1.3]">
      <rect x="1.75" y="2.25" width="12.5" height="11.5" rx="1.1" />
      <path d={side === 'left' ? 'M5.25 2.75V13.25' : 'M10.75 2.75V13.25'} />
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
  onClick,
  shortcut
}: {
  active?: boolean
  children: ReactNode
  className?: string
  disabled?: boolean
  label: string
  onClick: () => void
  shortcut?: string | null
}) {
  return (
    <HoverTooltip label={label} shortcut={shortcut}>
      <div className="flex">
        <button
          aria-label={label}
          data-managed-tooltip="custom"
          data-shortcut={shortcut ?? undefined}
          disabled={disabled}
          className={clsx(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-[4px] border transition',
            active
              ? 'border-[color:var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
              : 'border-[color:var(--line)] bg-[var(--surface-0)] text-[var(--text-dim)] hover:border-[color:var(--line-strong)] hover:bg-[var(--surface-1)] hover:text-[var(--text)]',
            'disabled:cursor-not-allowed disabled:opacity-40',
            className
          )}
          onClick={onClick}
        >
          {children}
        </button>
      </div>
    </HoverTooltip>
  )
}

function HeaderIconButton({
  active = false,
  children,
  label,
  onClick,
  shortcut
}: {
  active?: boolean
  children: ReactNode
  label: string
  onClick: () => void
  shortcut?: string | null
}) {
  return (
    <HoverTooltip label={label} placement="bottom" shortcut={shortcut}>
      <button
        aria-label={label}
        data-managed-tooltip="custom"
        data-shortcut={shortcut ?? undefined}
        className={clsx(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] border transition',
          active
            ? 'border-[color:var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
            : 'border-[color:var(--line)] bg-[var(--surface-0)] text-[var(--text-dim)] hover:border-[color:var(--line-strong)] hover:text-[var(--text)]'
        )}
        onClick={onClick}
      >
        {children}
      </button>
    </HoverTooltip>
  )
}

function PanelIconButton({
  disabled = false,
  label,
  onClick,
  children,
  shortcut
}: {
  disabled?: boolean
  label: string
  onClick: () => void
  children: ReactNode
  shortcut?: string | null
}) {
  return (
    <HoverTooltip label={label} placement="bottom" shortcut={shortcut}>
      <button
        aria-label={label}
        data-managed-tooltip="custom"
        data-shortcut={shortcut ?? undefined}
        disabled={disabled}
        className="flex h-7 w-7 items-center justify-center rounded-[4px] border border-[color:var(--line)] bg-[var(--surface-0)] text-[var(--text-dim)] transition hover:border-[color:var(--line-strong)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-40"
        onClick={onClick}
      >
        {children}
      </button>
    </HoverTooltip>
  )
}

function workspaceLabel(workspacePath: string): string {
  const parts = workspacePath.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? workspacePath
}

type FileBrowserMode = 'recent' | 'tree'

function flattenWorkspaceFiles(nodes: FileTreeNode[]): FileTreeNode[] {
  const files: FileTreeNode[] = []

  for (const node of nodes) {
    if (node.kind === 'file') {
      files.push(node)
      continue
    }

    if (node.children) {
      files.push(...flattenWorkspaceFiles(node.children))
    }
  }

  return files
}

function matchesFileQuery(node: FileTreeNode, query: string) {
  const haystack = `${node.name} ${node.path}`.toLowerCase()
  return haystack.includes(query)
}

function relativeDirectoryLabel(workspacePath: string | null, filePath: string) {
  if (!workspacePath) {
    return filePath
  }

  const normalizedWorkspacePath = workspacePath.replace(/\\/g, '/')
  const normalizedFilePath = filePath.replace(/\\/g, '/')

  if (!normalizedFilePath.startsWith(normalizedWorkspacePath)) {
    return filePath
  }

  const relativePath = normalizedFilePath.slice(normalizedWorkspacePath.length).replace(/^\/+/, '')
  const parts = relativePath.split('/').filter(Boolean)

  if (parts.length <= 1) {
    return 'Workspace root'
  }

  return parts.slice(0, -1).join(' / ')
}

function recentBucketLabel(updatedAt?: number) {
  if (!updatedAt) {
    return 'Earlier'
  }

  const today = new Date()
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const yesterdayStart = todayStart - 24 * 60 * 60 * 1000

  if (updatedAt >= todayStart) {
    return 'Today'
  }

  if (updatedAt >= yesterdayStart) {
    return 'Yesterday'
  }

  return 'Earlier'
}

function buildRecentGroups(files: FileTreeNode[], ascending: boolean) {
  const order = ascending ? ['Earlier', 'Yesterday', 'Today'] : ['Today', 'Yesterday', 'Earlier']
  const groups = new Map<string, FileTreeNode[]>()

  for (const label of order) {
    groups.set(label, [])
  }

  for (const file of files) {
    const label = recentBucketLabel(file.updatedAt)
    groups.get(label)?.push(file)
  }

  return order
    .map((label) => ({
      label,
      files: groups.get(label) ?? []
    }))
    .filter((group) => group.files.length > 0)
}

function formatRecentTimestamp(updatedAt?: number) {
  if (!updatedAt) {
    return 'Unknown'
  }

  const bucket = recentBucketLabel(updatedAt)

  if (bucket === 'Earlier') {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric'
    }).format(updatedAt)
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(updatedAt)
}

interface SidebarProps {
  activeTreePath: string | null
  config: AppConfig
  darkMode: boolean
  loadingWorkspace: boolean
  onAddWorkspace: () => void
  onCopyWorkspacePath: () => void
  onCreateNote: () => void
  onCreateTerminal: () => void
  onMoveFile: (sourcePath: string, targetDirectoryPath: string) => void
  onMoveSidebar: (side: SidebarSide) => void
  onOpenSearch: () => void
  onOpenWorkspacePath: () => void
  onPlaceFile: (node: FileTreeNode) => void
  onRemoveWorkspace: () => void
  onSelectNode: (node: FileTreeNode) => void
  onSelectWorkspace: (index: number) => void
  terminalDependencyMessage: string | null
  terminalReady: boolean
  onToggleSidebar: () => void
  onToggleDarkMode: () => void
  sidebarCollapsed: boolean
  sidebarSide: SidebarSide
  sidebarWidth: number
  workspaceTree: FileTreeNode[]
}

function SidebarComponent({
  activeTreePath,
  config,
  darkMode,
  loadingWorkspace,
  onAddWorkspace,
  onCopyWorkspacePath,
  onCreateNote,
  onCreateTerminal,
  onMoveFile,
  onMoveSidebar,
  onOpenSearch,
  onOpenWorkspacePath,
  onPlaceFile,
  onRemoveWorkspace,
  onSelectNode,
  onSelectWorkspace,
  terminalDependencyMessage,
  terminalReady,
  onToggleSidebar,
  onToggleDarkMode,
  sidebarCollapsed,
  sidebarSide,
  sidebarWidth,
  workspaceTree
}: SidebarProps) {
  const activeWorkspacePath = config.workspaces[config.activeWorkspace] ?? null
  const [fileBrowserMode, setFileBrowserMode] = useState<FileBrowserMode>('tree')
  const [fileQuery, setFileQuery] = useState('')
  const [recentAscending, setRecentAscending] = useState(false)
  const compactBrowserChrome = sidebarWidth < 340
  const normalizedFileQuery = fileQuery.trim().toLowerCase()
  const workspaceFiles = flattenWorkspaceFiles(workspaceTree)
  const searchFieldLabel = fileBrowserMode === 'recent' ? 'Search recent files' : 'Search files and folders'
  const searchPlaceholder = compactBrowserChrome ? 'Search…' : `${searchFieldLabel}…`
  const visibleRecentFiles = workspaceFiles
    .filter((node) => (normalizedFileQuery ? matchesFileQuery(node, normalizedFileQuery) : true))
    .sort((left, right) => {
      const leftUpdatedAt = left.updatedAt ?? 0
      const rightUpdatedAt = right.updatedAt ?? 0

      if (leftUpdatedAt !== rightUpdatedAt) {
        return recentAscending ? leftUpdatedAt - rightUpdatedAt : rightUpdatedAt - leftUpdatedAt
      }

      return left.name.localeCompare(right.name)
    })
  const recentGroups = buildRecentGroups(visibleRecentFiles, recentAscending)

  return (
    <aside className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-r border-[color:var(--line)] bg-[var(--surface-1)]">
      <div className="relative shrink-0 border-b border-[color:var(--line)] px-3.5 pb-3 pt-[40px]">
        <div aria-hidden="true" className="app-drag-region absolute inset-x-0 top-0 h-10" />
        <div className="app-drag-region flex items-start gap-2.5">
          <img
            src={logoMark}
            alt="Open Canvas logo"
            className="h-8 w-8 shrink-0 rounded-[4px] border border-[color:var(--line)] bg-[var(--surface-0)]"
          />
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-faint)]">
              Navigator
            </div>
            <h1 className="mt-0.5 font-[var(--font-display)] text-[1.15rem] font-semibold leading-[1.05] tracking-[-0.035em] text-[var(--text)]">
              Open Canvas
            </h1>
          </div>
          <div className="app-no-drag flex shrink-0 items-center gap-1">
            <HeaderIconButton
              active={sidebarSide === 'left'}
              label="Dock navigator on the left"
              shortcut={SIDEBAR_LEFT_SHORTCUT_KEY}
              onClick={() => onMoveSidebar('left')}
            >
              <DockSidePreviewIcon side="left" />
            </HeaderIconButton>
            <HeaderIconButton
              active={sidebarSide === 'right'}
              label="Dock navigator on the right"
              shortcut={SIDEBAR_RIGHT_SHORTCUT_KEY}
              onClick={() => onMoveSidebar('right')}
            >
              <DockSidePreviewIcon side="right" />
            </HeaderIconButton>
            <HeaderIconButton
              label={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
              shortcut={SIDEBAR_TOGGLE_SHORTCUT_KEY}
              onClick={onToggleSidebar}
            >
              <SidebarIcon collapsed={sidebarCollapsed} />
            </HeaderIconButton>
          </div>
        </div>

        <div className="app-no-drag mt-3 space-y-2">
          <div className="flex items-stretch gap-2">
            <div className="relative min-w-0 flex-1">
              <select
                className="h-10 w-full appearance-none rounded-[4px] border border-[color:var(--line)] bg-[var(--surface-0)] px-3 pr-10 text-[13px] font-medium text-[var(--text)] outline-none transition focus:border-[color:var(--accent)]"
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
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[var(--text-faint)]">
                <ChevronDownIcon />
              </span>
            </div>
            <HoverTooltip label="Add workspace folder" placement="bottom" shortcut={ADD_WORKSPACE_SHORTCUT_KEY}>
              <button
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[4px] border border-[color:var(--line)] bg-[var(--surface-0)] text-[var(--text-dim)] transition hover:border-[color:var(--line-strong)] hover:bg-[var(--surface-1)] hover:text-[var(--text)]"
                onClick={onAddWorkspace}
                data-managed-tooltip="custom"
                data-shortcut={ADD_WORKSPACE_SHORTCUT_KEY}
                aria-label="Add workspace folder"
              >
                <AddWorkspaceIcon />
              </button>
            </HoverTooltip>
            <HoverTooltip label="Remove active workspace" placement="bottom">
              <button
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[4px] border border-[color:var(--line)] bg-[var(--surface-0)] text-[var(--text-dim)] transition hover:border-[color:var(--line-strong)] hover:bg-[var(--surface-1)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-40"
                onClick={onRemoveWorkspace}
                disabled={!activeWorkspacePath}
                data-managed-tooltip="custom"
                aria-label="Remove active workspace"
              >
                <TrashIcon />
              </button>
            </HoverTooltip>
          </div>

          <div className="flex items-center gap-2 rounded-[4px] border border-[color:var(--line)] bg-[var(--surface-0)] px-2.5 py-2 text-[12px] text-[var(--text-dim)]">
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-faint)]">
                Workspace root
              </div>
              <div
                className="mt-0.5 truncate text-[12px] text-[var(--text-dim)]"
                title={activeWorkspacePath ?? 'Add a folder to start building a spatial workspace.'}
              >
                {activeWorkspacePath ?? 'Add a folder to start building a spatial workspace.'}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <PanelIconButton
                disabled={!activeWorkspacePath}
                label="Open workspace root in Finder"
                onClick={onOpenWorkspacePath}
              >
                <FolderOpenIcon />
              </PanelIconButton>
              <PanelIconButton
                disabled={!activeWorkspacePath}
                label="Copy workspace root path"
                onClick={onCopyWorkspacePath}
              >
                <CopyIcon />
              </PanelIconButton>
            </div>
          </div>

          {terminalDependencyMessage ? (
            <div className="rounded-[4px] border border-amber-500/20 bg-[rgba(120,53,15,0.12)] px-3 py-2.5 text-[12px] leading-5 text-[var(--text-dim)]">
              {terminalDependencyMessage}
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col bg-[var(--surface-1)]">
        <div className="shrink-0 border-b border-[color:var(--line)] bg-[var(--surface-1)] px-3.5 py-3">
          <div className="mb-2.5 flex items-center justify-between px-0.5">
            <div className="flex items-center gap-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-faint)]">
                Files
              </div>
            </div>
            {loadingWorkspace ? (
              <div className="text-[11px] text-[var(--text-faint)]">Refreshing…</div>
            ) : activeWorkspacePath ? (
              <div className="rounded-[4px] border border-[color:var(--line)] bg-[var(--surface-0)] px-2 py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--text-faint)]">
                {workspaceFiles.length}
                {compactBrowserChrome ? '' : ' Files'}
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-[4px] border border-[color:var(--line)] bg-[var(--surface-0)] p-1">
              <HoverTooltip label="Show recent files">
                <button
                  aria-label="Show recent files"
                  data-managed-tooltip="custom"
                  className={clsx(
                    'flex h-8 w-8 items-center justify-center rounded-[3px] transition',
                    fileBrowserMode === 'recent'
                      ? 'bg-[var(--surface-2)] text-[var(--text)]'
                      : 'text-[var(--text-faint)] hover:bg-[var(--surface-0)] hover:text-[var(--text)]'
                  )}
                  onClick={() => setFileBrowserMode('recent')}
                >
                  <RecentFilesIcon />
                </button>
              </HoverTooltip>
              <HoverTooltip label="Show folder tree">
                <button
                  aria-label="Show folder tree"
                  data-managed-tooltip="custom"
                  className={clsx(
                    'flex h-8 w-8 items-center justify-center rounded-[3px] transition',
                    fileBrowserMode === 'tree'
                      ? 'bg-[var(--surface-2)] text-[var(--text)]'
                      : 'text-[var(--text-faint)] hover:bg-[var(--surface-0)] hover:text-[var(--text)]'
                  )}
                  onClick={() => setFileBrowserMode('tree')}
                >
                  <TreeViewIcon />
                </button>
              </HoverTooltip>
              <HoverTooltip
                label={
                  fileBrowserMode === 'recent'
                    ? 'Toggle recent-file sort order'
                    : 'Open recent files sorted by date'
                }
              >
                <button
                  aria-label="Sort recent files"
                  data-managed-tooltip="custom"
                  className={clsx(
                    'flex h-8 w-8 items-center justify-center rounded-[3px] transition',
                    fileBrowserMode === 'recent'
                      ? 'bg-[var(--surface-2)] text-[var(--text)]'
                      : 'text-[var(--text-faint)] hover:bg-[var(--surface-0)] hover:text-[var(--text)]'
                  )}
                  onClick={() => {
                    if (fileBrowserMode !== 'recent') {
                      setFileBrowserMode('recent')
                      return
                    }

                    setRecentAscending((current) => !current)
                  }}
                >
                  <span className="relative flex h-4.5 w-4.5 items-center justify-center">
                    <ClockIcon />
                    <span className="absolute -bottom-1 -right-1">
                      <SortArrowIcon ascending={recentAscending} />
                    </span>
                  </span>
                </button>
              </HoverTooltip>
            </div>
            <div className="relative min-w-0 flex-1">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[var(--text-faint)]">
                <SearchIcon />
              </span>
              {!compactBrowserChrome ? (
                <span className="pointer-events-none absolute right-3 top-1/2 flex h-5 min-w-[3.5rem] -translate-y-1/2 items-center justify-center rounded-[4px] border border-[color:var(--line)] bg-[var(--surface-1)] px-1.5 text-[9px] font-medium leading-none text-[var(--text-faint)] opacity-80">
                  {SEARCH_SHORTCUT_HINT}
                </span>
              ) : null}
              <input
                aria-label={searchFieldLabel}
                value={fileQuery}
                onChange={(event) => setFileQuery(event.target.value)}
                placeholder={searchPlaceholder}
                title={composeTooltipLabel(searchFieldLabel, SEARCH_SHORTCUT_KEY)}
                className={clsx(
                  'h-10 w-full rounded-[4px] border border-[color:var(--line)] bg-[var(--surface-0)] pl-10 text-[13px] text-[var(--text)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-[color:var(--accent)]',
                  compactBrowserChrome ? 'pr-3' : 'pr-[6.75rem]'
                )}
              />
            </div>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[var(--surface-1)] px-3.5 py-3">
          {activeWorkspacePath ? (
            fileBrowserMode === 'recent' ? (
              workspaceFiles.length === 0 ? (
                <div className="rounded-[4px] border border-dashed border-[color:var(--line-strong)] bg-[var(--surface-0)] p-4 text-sm text-[var(--text-dim)]">
                  This workspace is empty.
                </div>
              ) : recentGroups.length > 0 ? (
                <div className="space-y-4">
                  {recentGroups.map((group) => (
                    <section key={group.label}>
                      <div className="mb-2 flex items-center justify-between px-1">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-faint)]">
                          {group.label}
                        </div>
                        <div className="rounded-[4px] border border-[color:var(--line)] bg-[var(--surface-0)] px-2 py-0.5 text-[10px] font-medium leading-none text-[var(--text-faint)]">
                          {group.files.length}
                        </div>
                      </div>
                      <div className="space-y-1">
                        {group.files.map((file) => (
                          <button
                            key={file.path}
                            className={clsx(
                              'flex w-full items-center gap-2.5 rounded-[4px] border border-transparent px-2.5 py-2 text-left transition',
                              activeTreePath === file.path
                                ? 'border-[color:var(--line)] bg-[var(--surface-selected)] text-[var(--text)]'
                                : 'text-[var(--text-dim)] hover:bg-[var(--surface-0)]'
                            )}
                            onClick={() => onSelectNode(file)}
                            onDoubleClick={(event) => {
                              event.preventDefault()
                              onPlaceFile(file)
                            }}
                            title="Click to preview. Double-click or press Shift+Enter to place on canvas."
                          >
                            <FileKindIcon darkMode={darkMode} fileKind={file.fileKind} />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[13px] font-medium text-[var(--text)]">
                                {file.name}
                              </div>
                              <div className="truncate text-[11px] text-[var(--text-faint)]">
                                {relativeDirectoryLabel(activeWorkspacePath, file.path)}
                              </div>
                            </div>
                            <div className="shrink-0 text-[11px] text-[var(--text-faint)]">
                              {formatRecentTimestamp(file.updatedAt)}
                            </div>
                          </button>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              ) : (
                <div className="rounded-[4px] border border-dashed border-[color:var(--line-strong)] bg-[var(--surface-0)] p-4 text-sm text-[var(--text-dim)]">
                  No recent files match <span className="text-[var(--text)]">“{fileQuery.trim()}”</span>.
                </div>
              )
            ) : (
              <FileTree
                activePath={activeTreePath}
                darkMode={darkMode}
                nodes={workspaceTree}
                query={fileQuery}
                onMoveFile={onMoveFile}
                onPlaceFile={onPlaceFile}
                onSelectNode={onSelectNode}
              />
            )
          ) : (
            <div className="rounded-[4px] border border-dashed border-[color:var(--line-strong)] bg-[var(--surface-0)] p-4 text-sm text-[var(--text-dim)]">
              Add a workspace with{' '}
              <span className="font-[var(--font-mono)] text-[var(--text)]">Cmd+Shift+O</span> to populate the navigator.
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-[color:var(--line)] bg-[var(--surface-2)] px-3.5 py-3">
        <div className="grid grid-cols-5 gap-2">
          <ActionIconButton
            label="Search Files"
            onClick={onOpenSearch}
            shortcut={SEARCH_SHORTCUT_KEY}
          >
            <SearchIcon />
          </ActionIconButton>
          <ActionIconButton
            label="Add Workspace"
            onClick={onAddWorkspace}
            shortcut={ADD_WORKSPACE_SHORTCUT_KEY}
          >
            <AddWorkspaceIcon />
          </ActionIconButton>
          <ActionIconButton
            disabled={!activeWorkspacePath}
            label="New Markdown Note"
            onClick={onCreateNote}
            shortcut={CREATE_NOTE_SHORTCUT_KEY}
          >
            <NewNoteIcon />
          </ActionIconButton>
          <ActionIconButton
            disabled={!activeWorkspacePath || !terminalReady}
            label="New Terminal"
            onClick={onCreateTerminal}
            shortcut={CREATE_TERMINAL_SHORTCUT_KEY}
          >
            <NewTerminalIcon />
          </ActionIconButton>
          <ActionIconButton
            active={darkMode}
            label={darkMode ? 'Switch To Light Mode' : 'Switch To Dark Mode'}
            onClick={onToggleDarkMode}
            shortcut={TOGGLE_DARK_MODE_SHORTCUT_KEY}
          >
            <ThemeIcon darkMode={darkMode} />
          </ActionIconButton>
        </div>
      </div>
    </aside>
  )
}

export const Sidebar = memo(SidebarComponent, (previous, next) => {
  return (
    previous.activeTreePath === next.activeTreePath &&
    previous.config === next.config &&
    previous.darkMode === next.darkMode &&
    previous.loadingWorkspace === next.loadingWorkspace &&
    previous.sidebarCollapsed === next.sidebarCollapsed &&
    previous.sidebarSide === next.sidebarSide &&
    previous.sidebarWidth === next.sidebarWidth &&
    previous.workspaceTree === next.workspaceTree
  )
})
