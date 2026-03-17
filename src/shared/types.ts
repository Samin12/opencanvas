export type TileType =
  | 'term'
  | 'note'
  | 'code'
  | 'image'
  | 'video'
  | 'pdf'
  | 'spreadsheet'
  | 'presentation'
  | 'embed'

export type FileKind = 'note' | 'code' | 'image' | 'video' | 'pdf' | 'spreadsheet' | 'presentation'
export type TerminalProvider = 'claude' | 'codex'
export type OfficeDocumentKind = 'spreadsheet' | 'presentation'
export type OfficeViewerStatus = 'ready' | 'unreachable' | 'disabled'

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
  size?: number
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

export interface FileMetadata {
  extension: string
  size: number
  updatedAt: number
}

export interface OfficeViewerBootstrap {
  baseUrl?: string
  status: OfficeViewerStatus
}

export interface OfficeViewerSession {
  callbackUrl: string
  documentKey: string
  documentServerUrl: string
  documentType: 'cell' | 'slide'
  documentUrl: string
  filePath: string
  kind: OfficeDocumentKind
  title: string
}

export interface BootstrapData {
  config: AppConfig
  canvasState: CanvasState
  officeViewer: OfficeViewerBootstrap
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

export interface CreateWorkspaceFileOptions {
  fileName: string
  initialContent?: string
  targetDirectoryPath?: string
}

export interface CreateWorkspaceDirectoryOptions {
  directoryName: string
  targetDirectoryPath?: string
}

export interface RenameWorkspaceNodeOptions {
  nextName: string
  targetPath: string
}

export type CanvasDiagramKind =
  | 'flowchart'
  | 'system-architecture'
  | 'mind-map'
  | 'sequence'
  | 'org-chart'
  | 'timeline'

export type CanvasDiagramNodeKind =
  | 'process'
  | 'decision'
  | 'data'
  | 'actor'
  | 'service'
  | 'database'
  | 'document'
  | 'container'
  | 'note'
  | 'event'

export type CanvasDiagramLayoutKind = 'grid' | 'flow' | 'radial' | 'sequence' | 'tree' | 'timeline'

export interface CanvasDiagramNode {
  cluster?: string
  emphasis?: 'normal' | 'high'
  id: string
  kind: CanvasDiagramNodeKind
  label: string
  lane?: string
  order?: number
  parentId?: string
}

export interface CanvasDiagramEdge {
  direction?: 'one-way' | 'two-way'
  from: string
  id: string
  label?: string
  style?: 'solid' | 'dashed'
  to: string
}

export interface CanvasDiagramSpec {
  id: string
  kind: CanvasDiagramKind
  layout?: CanvasDiagramLayoutKind
  nodes: CanvasDiagramNode[]
  edges: CanvasDiagramEdge[]
  summary?: string
  title: string
}

export interface CanvasDiagramEnvelope {
  createdAt: string
  diagrams: CanvasDiagramSpec[]
  promptSummary: string
  requestId: string
  skill: 'open-canvas-diagrams'
  version: 1
}

export interface CanvasDiagramQueueIndexEntry {
  createdAt: string
  file: string
  promptSummary: string
  requestId: string
}

export interface CanvasDiagramQueueFailureEntry {
  error: string
  failedAt: string
  file: string
  requestId: string
}

export interface CanvasDiagramQueueIndex {
  failed: CanvasDiagramQueueFailureEntry[]
  pending: CanvasDiagramQueueIndexEntry[]
  processed: string[]
  version: 1
}

export interface EnsureWorkspaceDiagramToolsResult {
  claudePath: string
  commandPath: string
  queueIndexPath: string
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
  copyHtmlToClipboard: (html: string, text?: string) => Promise<void>
  openPath: (targetPath: string) => Promise<void>
  revealPath: (targetPath: string) => Promise<void>
  pickWorkspaceDirectory: () => Promise<string | null>
  createWorkspaceNote: (
    workspacePath: string,
    options?: CreateWorkspaceNoteOptions
  ) => Promise<FileTreeNode>
  createWorkspaceFile: (
    workspacePath: string,
    options: CreateWorkspaceFileOptions
  ) => Promise<FileTreeNode>
  createWorkspaceDirectory: (
    workspacePath: string,
    options: CreateWorkspaceDirectoryOptions
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
  renameWorkspaceNode: (
    workspacePath: string,
    options: RenameWorkspaceNodeOptions
  ) => Promise<FileTreeNode>
  deleteWorkspaceNode: (workspacePath: string, targetPath: string) => Promise<void>
  readImageAsset: (filePath: string) => Promise<ImageAssetData>
  readFileMetadata: (filePath: string) => Promise<FileMetadata>
  readWorkspaceTree: (workspacePath: string) => Promise<FileTreeNode[]>
  readTextFile: (filePath: string) => Promise<TextFileDocument>
  writeTextFile: (filePath: string, content: string) => Promise<TextFileDocument>
  ensureWorkspaceDiagramTools: (workspacePath: string) => Promise<EnsureWorkspaceDiagramToolsResult>
  onFileChanged: (filePath: string, listener: () => void) => () => void
  fileUrl: (filePath: string) => Promise<string>
  previewFileUrl: (filePath: string) => Promise<string>
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
  readOfficeViewerBootstrap: (force?: boolean) => Promise<OfficeViewerBootstrap>
  getOfficeViewerSession: (filePath: string) => Promise<OfficeViewerSession>
  openExternalUrl: (url: string) => Promise<void>
  releaseTerminalSession: (sessionId: string) => void
  resizeTerminalSession: (sessionId: string, cols: number, rows: number) => void
  writeTerminalInput: (sessionId: string, data: string) => void
}
