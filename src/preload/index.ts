import * as electron from 'electron'

import type {
  AppConfig,
  BootstrapData,
  CanvasPinchPayload,
  CanvasState,
  CollaboratorApi,
  CreateWorkspaceDirectoryOptions,
  CreateWorkspaceFileOptions,
  CreateWorkspaceNoteOptions,
  EnsureWorkspaceDiagramToolsResult,
  FileMetadata,
  FileTreeNode,
  ImageAssetData,
  OfficeViewerBootstrap,
  OfficeViewerSession,
  RenameWorkspaceNodeOptions,
  TerminalActivityItem,
  TerminalSessionSnapshot,
  TextFileDocument,
  WorkspaceAssetImport,
  WorkspaceImageImport
} from '../shared/types'

const { contextBridge, ipcRenderer } = electron

if ('webFrame' in electron && electron.webFrame) {
  try {
    electron.webFrame.setVisualZoomLevelLimits(1, 1)
  } catch {
    // Ignore unsupported environments; the renderer still handles canvas zoom itself.
  }
}

const api: CollaboratorApi = {
  bootstrap: () => ipcRenderer.invoke('bootstrap') as Promise<BootstrapData>,
  readCanvasState: (workspacePath: string | null) =>
    ipcRenderer.invoke('canvas:read', workspacePath) as Promise<CanvasState>,
  copyTextToClipboard: (text: string) => ipcRenderer.invoke('system:copy-text', text) as Promise<void>,
  copyHtmlToClipboard: (html: string, text?: string) =>
    ipcRenderer.invoke('system:copy-html', html, text) as Promise<void>,
  readOfficeViewerBootstrap: (force?: boolean) =>
    ipcRenderer.invoke('office:bootstrap', Boolean(force)) as Promise<OfficeViewerBootstrap>,
  getOfficeViewerSession: (filePath: string) =>
    ipcRenderer.invoke('office:session', filePath) as Promise<OfficeViewerSession>,
  createTerminalSession: (options) =>
    ipcRenderer.invoke('terminal:create', options) as Promise<TerminalSessionSnapshot>,
  readTerminalActivity: (sessionId: string) =>
    ipcRenderer.invoke('terminal:activity', sessionId) as Promise<TerminalActivityItem[]>,
  readTerminalHistory: (sessionId: string, limit?: number) =>
    ipcRenderer.invoke('terminal:history', sessionId, limit) as Promise<string>,
  onTerminalActivity: (sessionId, listener) => {
    const channel = `terminal:activity:${sessionId}`
    const handler = (_event: Electron.IpcRendererEvent, activity: TerminalActivityItem) =>
      listener(activity)

    ipcRenderer.on(channel, handler)

    return () => {
      ipcRenderer.off(channel, handler)
    }
  },
  onTerminalData: (sessionId, listener) => {
    const channel = `terminal:data:${sessionId}`
    const handler = (_event: Electron.IpcRendererEvent, data: string) => listener(data)

    ipcRenderer.on(channel, handler)

    return () => {
      ipcRenderer.off(channel, handler)
    }
  },
  onTerminalExit: (sessionId, listener) => {
    const channel = `terminal:exit:${sessionId}`
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: { exitCode: number; signal?: number }
    ) => listener(payload)

    ipcRenderer.on(channel, handler)

    return () => {
      ipcRenderer.off(channel, handler)
    }
  },
  onCanvasPinch: (listener) => {
    const channel = 'canvas:pinch'
    const handler = (_event: Electron.IpcRendererEvent, payload: CanvasPinchPayload) =>
      listener(payload)

    ipcRenderer.on(channel, handler)

    return () => {
      ipcRenderer.off(channel, handler)
    }
  },
  saveConfig: (config: AppConfig) => ipcRenderer.invoke('config:save', config) as Promise<AppConfig>,
  saveCanvasState: (workspacePath: string | null, state: CanvasState) =>
    ipcRenderer.invoke('canvas:save', workspacePath, state) as Promise<CanvasState>,
  openPath: (targetPath: string) => ipcRenderer.invoke('system:open-path', targetPath) as Promise<void>,
  revealPath: (targetPath: string) =>
    ipcRenderer.invoke('system:reveal-path', targetPath) as Promise<void>,
  openExternalUrl: (url: string) =>
    ipcRenderer.invoke('system:open-external-url', url) as Promise<void>,
  pickWorkspaceDirectory: () => ipcRenderer.invoke('workspace:pick') as Promise<string | null>,
  createWorkspaceNote: (workspacePath: string, options?: CreateWorkspaceNoteOptions) =>
    ipcRenderer.invoke('workspace:create-note', workspacePath, options) as Promise<FileTreeNode>,
  createWorkspaceFile: (workspacePath: string, options: CreateWorkspaceFileOptions) =>
    ipcRenderer.invoke('workspace:create-file', workspacePath, options) as Promise<FileTreeNode>,
  createWorkspaceDirectory: (workspacePath: string, options: CreateWorkspaceDirectoryOptions) =>
    ipcRenderer.invoke('workspace:create-directory', workspacePath, options) as Promise<FileTreeNode>,
  importWorkspaceAsset: (workspacePath: string, asset: WorkspaceAssetImport) =>
    ipcRenderer.invoke('workspace:import-asset', workspacePath, asset) as Promise<FileTreeNode>,
  importWorkspaceImage: (workspacePath: string, image: WorkspaceImageImport) =>
    ipcRenderer.invoke('workspace:import-image', workspacePath, image) as Promise<FileTreeNode>,
  moveWorkspaceNode: (workspacePath: string, sourcePath: string, targetDirectoryPath: string) =>
    ipcRenderer.invoke(
      'workspace:move-node',
      workspacePath,
      sourcePath,
      targetDirectoryPath
    ) as Promise<FileTreeNode>,
  renameWorkspaceNode: (workspacePath: string, options: RenameWorkspaceNodeOptions) =>
    ipcRenderer.invoke('workspace:rename-node', workspacePath, options) as Promise<FileTreeNode>,
  deleteWorkspaceNode: (workspacePath: string, targetPath: string) =>
    ipcRenderer.invoke('workspace:delete-node', workspacePath, targetPath) as Promise<void>,
  readImageAsset: (filePath: string) =>
    ipcRenderer.invoke('file:image-data', filePath) as Promise<ImageAssetData>,
  readFileMetadata: (filePath: string) =>
    ipcRenderer.invoke('file:metadata', filePath) as Promise<FileMetadata>,
  readWorkspaceTree: (workspacePath: string) =>
    ipcRenderer.invoke('workspace:tree', workspacePath) as Promise<FileTreeNode[]>,
  readTextFile: (filePath: string) =>
    ipcRenderer.invoke('file:read', filePath) as Promise<TextFileDocument>,
  writeTextFile: (filePath: string, content: string) =>
    ipcRenderer.invoke('file:write', filePath, content) as Promise<TextFileDocument>,
  ensureWorkspaceDiagramTools: (workspacePath: string) =>
    ipcRenderer.invoke(
      'workspace:ensure-diagram-tools',
      workspacePath
    ) as Promise<EnsureWorkspaceDiagramToolsResult>,
  onFileChanged: (filePath, listener) => {
    const channel = 'file:changed'
    const handler = (_event: Electron.IpcRendererEvent, changedFilePath: string) => {
      if (changedFilePath === filePath) {
        listener()
      }
    }

    ipcRenderer.on(channel, handler)
    ipcRenderer.send('file:watch', filePath)

    return () => {
      ipcRenderer.off(channel, handler)
      ipcRenderer.send('file:unwatch', filePath)
    }
  },
  fileUrl: (filePath: string) => ipcRenderer.invoke('file:url', filePath) as Promise<string>,
  previewFileUrl: (filePath: string) =>
    ipcRenderer.invoke('file:preview-url', filePath) as Promise<string>,
  releaseTerminalSession: (sessionId: string) => {
    ipcRenderer.send('terminal:release', sessionId)
  },
  resizeTerminalSession: (sessionId: string, cols: number, rows: number) => {
    ipcRenderer.send('terminal:resize', sessionId, cols, rows)
  },
  writeTerminalInput: (sessionId: string, data: string) => {
    ipcRenderer.send('terminal:write', sessionId, data)
  }
}

contextBridge.exposeInMainWorld('collaborator', api)
