export type TileType = 'term' | 'note' | 'code' | 'image'

export type FileKind = 'note' | 'code' | 'image'

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
  filePath?: string
  sessionId?: string
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
  name: string
  path: string
  kind: 'file' | 'directory'
  fileKind?: FileKind
  extension?: string
  children?: FileTreeNode[]
}

export interface TextFileDocument {
  path: string
  kind: FileKind
  content: string
  updatedAt: number
}

export interface BootstrapData {
  config: AppConfig
  canvasState: CanvasState
  terminalDependencies: TerminalDependencyState
}

export interface TerminalDependencyState {
  claudeCommand: string
  claudeInstalled: boolean
  tmuxInstalled: boolean
}

export interface TerminalSessionSnapshot {
  buffer: string
  cwd: string
  sessionId: string
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
  saveConfig: (config: AppConfig) => Promise<AppConfig>
  saveCanvasState: (state: CanvasState) => Promise<CanvasState>
  pickWorkspaceDirectory: () => Promise<string | null>
  createWorkspaceNote: (workspacePath: string) => Promise<FileTreeNode>
  moveWorkspaceNode: (
    workspacePath: string,
    sourcePath: string,
    targetDirectoryPath: string
  ) => Promise<FileTreeNode>
  readWorkspaceTree: (workspacePath: string) => Promise<FileTreeNode[]>
  readTextFile: (filePath: string) => Promise<TextFileDocument>
  writeTextFile: (filePath: string, content: string) => Promise<TextFileDocument>
  onFileChanged: (filePath: string, listener: () => void) => () => void
  fileUrl: (filePath: string) => Promise<string>
  createTerminalSession: (options: {
    cols: number
    cwd?: string
    rows: number
    sessionId: string
  }) => Promise<TerminalSessionSnapshot>
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
