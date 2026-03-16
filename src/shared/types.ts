export type TileType = 'term' | 'note' | 'code' | 'image' | 'video' | 'pdf' | 'embed'

export type FileKind = 'note' | 'code' | 'image' | 'video' | 'pdf'
export type TerminalProvider = 'claude' | 'codex'

export interface CanvasTile {
  id: string
  type: TileType
  title: string
  x: number
  y: number
  width: number
  height: number
  zIndex: number
  contextTileIds?: string[]
  contextGroupIds?: string[]
  embedUrl?: string
  filePath?: string
  sessionId?: string
  terminalProvider?: TerminalProvider
}

export interface CanvasViewport {
  panX: number
  panY: number
  zoom: number
}

export interface CanvasState {
  version: number
  tiles: CanvasTile[]
  viewport: CanvasViewport
  boardSnapshot?: unknown
}

export interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  isMaximized: boolean
}

export type SidebarSide = 'left' | 'right'

export interface AppConfig {
  workspaces: string[]
  activeWorkspace: number
  windowState: WindowState
  ui: {
    darkMode: boolean
    sidebarCollapsed: boolean
    sidebarSide: SidebarSide
    sidebarWidth: number
  }
}

export interface FileTreeNode {
  descendantFileCount?: number
  extension?: string
  fileKind?: FileKind
  name: string
  path: string
  kind: 'file' | 'directory'
  children?: FileTreeNode[]
  updatedAt?: number
}

export interface TextFileDocument {
  path: string
  kind: FileKind
  content: string
  updatedAt: number
}

export interface ImageAssetData {
  base64: string
  mimeType: string
}

export interface BootstrapData {
  config: AppConfig
  canvasState: CanvasState
  terminalDependencies: TerminalDependencyState
}

export interface WorkspaceAssetImport {
  bytes: ArrayBuffer | Uint8Array | number[]
  fileName?: string | null
  mimeType?: string | null
}

export type WorkspaceImageImport = WorkspaceAssetImport

export interface CreateWorkspaceNoteOptions {
  baseName?: string
  initialContent?: string
  targetDirectoryPath?: string
}

export interface TerminalProviderDependencyState {
  command: string
  installed: boolean
  label: string
}

export interface TerminalDependencyState {
  providers: Record<TerminalProvider, TerminalProviderDependencyState>
  tmuxInstalled: boolean
}

export interface TerminalSessionSnapshot {
  buffer: string
  cwd: string
  provider: TerminalProvider
  sessionId: string
}

export type TerminalUiMode = 'chat' | 'shell'

export type TerminalActivityKind =
  | 'task'
  | 'read'
  | 'write'
  | 'output'
  | 'status'
  | 'error'
  | 'exit'
  | 'message'

export type TerminalActivityState = 'info' | 'working' | 'success' | 'error'

export interface TerminalActivityItem {
  body: string
  createdAt: number
  filePath?: string
  id: string
  kind: TerminalActivityKind
  outputPath?: string
  rawText: string
  state: TerminalActivityState
  title: string
}

export interface CanvasPinchPayload {
  clientX?: number
  clientY?: number
  delta?: number
  phase: 'begin' | 'update' | 'end'
  scale?: number
}

export interface CollaboratorApi {
  bootstrap: () => Promise<BootstrapData>
  readCanvasState: (workspacePath: string | null) => Promise<CanvasState>
  saveConfig: (config: AppConfig) => Promise<AppConfig>
  saveCanvasState: (workspacePath: string | null, state: CanvasState) => Promise<CanvasState>
  copyTextToClipboard: (text: string) => Promise<void>
  openPath: (targetPath: string) => Promise<void>
  pickWorkspaceDirectory: () => Promise<string | null>
  createWorkspaceNote: (
    workspacePath: string,
    options?: CreateWorkspaceNoteOptions
  ) => Promise<FileTreeNode>
  importWorkspaceAsset: (
    workspacePath: string,
    asset: WorkspaceAssetImport
  ) => Promise<FileTreeNode>
  importWorkspaceImage: (
    workspacePath: string,
    image: WorkspaceImageImport
  ) => Promise<FileTreeNode>
  moveWorkspaceNode: (
    workspacePath: string,
    sourcePath: string,
    targetDirectoryPath: string
  ) => Promise<FileTreeNode>
  readImageAsset: (filePath: string) => Promise<ImageAssetData>
  readWorkspaceTree: (workspacePath: string) => Promise<FileTreeNode[]>
  readTextFile: (filePath: string) => Promise<TextFileDocument>
  writeTextFile: (filePath: string, content: string) => Promise<TextFileDocument>
  onFileChanged: (filePath: string, listener: () => void) => () => void
  fileUrl: (filePath: string) => Promise<string>
  createTerminalSession: (options: {
    cols: number
    cwd?: string
    provider: TerminalProvider
    rows: number
    sessionId: string
  }) => Promise<TerminalSessionSnapshot>
  readTerminalActivity: (sessionId: string) => Promise<TerminalActivityItem[]>
  readTerminalHistory: (sessionId: string, limit?: number) => Promise<string>
  onTerminalActivity: (
    sessionId: string,
    listener: (activity: TerminalActivityItem) => void
  ) => () => void
  onTerminalData: (sessionId: string, listener: (data: string) => void) => () => void
  onTerminalExit: (
    sessionId: string,
    listener: (payload: { exitCode: number; signal?: number }) => void
  ) => () => void
  onCanvasPinch: (listener: (payload: CanvasPinchPayload) => void) => () => void
  releaseTerminalSession: (sessionId: string) => void
  resizeTerminalSession: (sessionId: string, cols: number, rows: number) => void
  writeTerminalInput: (sessionId: string, data: string) => void
}
