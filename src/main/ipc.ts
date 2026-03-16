import * as electron from 'electron'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import type { AppConfig, CanvasState, WorkspaceImageImport } from '../shared/types'

import { loadCanvasState, loadConfig, saveCanvasState, saveConfig } from './storage'
import {
  createOrAttachTerminalSession,
  readTerminalHistory,
  readTerminalDependencyState,
  releaseTerminalSession,
  resizeTerminalSession,
  writeTerminalInput
} from './terminals'
import {
  createWorkspaceNote,
  importWorkspaceImage,
  moveWorkspaceNode,
  readImageAssetData,
  readTextFileDocument,
  readWorkspaceTree,
  subscribeToFileChanges,
  toFileUrl,
  writeTextFileDocument
} from './workspaces'

const { clipboard, dialog, ipcMain, shell } = electron
const fileWatchSubscriptions = new Map<string, () => void>()
const watchedSenders = new Set<number>()

function fileWatchKey(senderId: number, filePath: string): string {
  return `${senderId}:${resolve(filePath)}`
}

function disposeFileWatch(key: string): void {
  const dispose = fileWatchSubscriptions.get(key)

  if (!dispose) {
    return
  }

  fileWatchSubscriptions.delete(key)
  dispose()
}

export function registerIpcHandlers(): void {
  ipcMain.handle('bootstrap', async () => {
    const [config, canvasState] = await Promise.all([loadConfig(), loadCanvasState()])

    return {
      config,
      canvasState,
      terminalDependencies: readTerminalDependencyState()
    }
  })

  ipcMain.handle('config:save', async (_event, config: AppConfig) => saveConfig(config))
  ipcMain.handle('canvas:save', async (_event, state: CanvasState) => saveCanvasState(state))
  ipcMain.handle('system:copy-text', async (_event, text: string) => {
    clipboard.writeText(text)
  })
  ipcMain.handle('system:open-path', async (_event, targetPath: string) => {
    const resolvedTargetPath = resolve(targetPath)

    if (!existsSync(resolvedTargetPath)) {
      throw new Error('The workspace path does not exist on disk.')
    }

    const errorMessage = await shell.openPath(resolvedTargetPath)

    if (errorMessage) {
      try {
        shell.showItemInFolder(resolvedTargetPath)
        return
      } catch {
        throw new Error(errorMessage)
      }
    }
  })
  ipcMain.handle('workspace:tree', async (_event, workspacePath: string) => readWorkspaceTree(workspacePath))
  ipcMain.handle(
    'workspace:create-note',
    async (_event, workspacePath: string, targetDirectoryPath?: string) =>
      createWorkspaceNote(workspacePath, targetDirectoryPath)
  )
  ipcMain.handle(
    'workspace:import-image',
    async (_event, workspacePath: string, image: WorkspaceImageImport) =>
      importWorkspaceImage(workspacePath, image)
  )
  ipcMain.handle(
    'workspace:move-node',
    async (_event, workspacePath: string, sourcePath: string, targetDirectoryPath: string) =>
      moveWorkspaceNode(workspacePath, sourcePath, targetDirectoryPath)
  )
  ipcMain.handle('file:read', async (_event, filePath: string) => readTextFileDocument(filePath))
  ipcMain.handle('file:image-data', async (_event, filePath: string) => readImageAssetData(filePath))
  ipcMain.handle('file:write', async (_event, filePath: string, content: string) =>
    writeTextFileDocument(filePath, content)
  )
  ipcMain.on('file:watch', (event, filePath: string) => {
    const sender = event.sender
    const key = fileWatchKey(sender.id, filePath)

    if (fileWatchSubscriptions.has(key)) {
      return
    }

    if (!watchedSenders.has(sender.id)) {
      watchedSenders.add(sender.id)
      sender.once('destroyed', () => {
        watchedSenders.delete(sender.id)

        for (const existingKey of Array.from(fileWatchSubscriptions.keys())) {
          if (existingKey.startsWith(`${sender.id}:`)) {
            disposeFileWatch(existingKey)
          }
        }
      })
    }

    const resolvedFilePath = resolve(filePath)
    const stopWatching = subscribeToFileChanges(resolvedFilePath, () => {
      if (!sender.isDestroyed()) {
        sender.send('file:changed', filePath)
      }
    })

    fileWatchSubscriptions.set(key, stopWatching)
  })
  ipcMain.on('file:unwatch', (event, filePath: string) => {
    disposeFileWatch(fileWatchKey(event.sender.id, filePath))
  })
  ipcMain.handle('file:url', async (_event, filePath: string) => toFileUrl(filePath))
  ipcMain.handle(
    'terminal:create',
    async (_event, options: { cols: number; cwd?: string; rows: number; sessionId: string }) =>
      createOrAttachTerminalSession(options)
  )
  ipcMain.handle('terminal:history', async (_event, sessionId: string, limit?: number) =>
    readTerminalHistory(sessionId, limit)
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
