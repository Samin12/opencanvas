import * as electron from 'electron'

import type { AppConfig, CanvasState } from '../shared/types'

import { loadCanvasState, loadConfig, saveCanvasState, saveConfig } from './storage'
import {
  createOrAttachTerminalSession,
  releaseTerminalSession,
  resizeTerminalSession,
  writeTerminalInput
} from './terminals'
import {
  createWorkspaceNote,
  moveWorkspaceNode,
  readTextFileDocument,
  readWorkspaceTree,
  toFileUrl,
  writeTextFileDocument
} from './workspaces'

const { dialog, ipcMain } = electron

export function registerIpcHandlers(): void {
  ipcMain.handle('bootstrap', async () => {
    const [config, canvasState] = await Promise.all([loadConfig(), loadCanvasState()])

    return {
      config,
      canvasState
    }
  })

  ipcMain.handle('config:save', async (_event, config: AppConfig) => saveConfig(config))
  ipcMain.handle('canvas:save', async (_event, state: CanvasState) => saveCanvasState(state))
  ipcMain.handle('workspace:tree', async (_event, workspacePath: string) => readWorkspaceTree(workspacePath))
  ipcMain.handle('workspace:create-note', async (_event, workspacePath: string) =>
    createWorkspaceNote(workspacePath)
  )
  ipcMain.handle(
    'workspace:move-node',
    async (_event, workspacePath: string, sourcePath: string, targetDirectoryPath: string) =>
      moveWorkspaceNode(workspacePath, sourcePath, targetDirectoryPath)
  )
  ipcMain.handle('file:read', async (_event, filePath: string) => readTextFileDocument(filePath))
  ipcMain.handle('file:write', async (_event, filePath: string, content: string) =>
    writeTextFileDocument(filePath, content)
  )
  ipcMain.handle('file:url', async (_event, filePath: string) => toFileUrl(filePath))
  ipcMain.handle(
    'terminal:create',
    async (_event, options: { cols: number; cwd?: string; rows: number; sessionId: string }) =>
      createOrAttachTerminalSession(options)
  )
  ipcMain.on('terminal:write', (_event, sessionId: string, data: string) => {
    writeTerminalInput(sessionId, data)
  })
  ipcMain.on('terminal:release', (_event, sessionId: string) => {
    releaseTerminalSession(sessionId)
  })
  ipcMain.on('terminal:resize', (_event, sessionId: string, cols: number, rows: number) => {
    resizeTerminalSession(sessionId, cols, rows)
  })
  ipcMain.handle('workspace:pick', async () => {
    const selection = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Add Workspace'
    })

    if (selection.canceled || selection.filePaths.length === 0) {
      return null
    }

    return selection.filePaths[0]
  })
}
