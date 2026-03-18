import * as electron from 'electron'
import { join } from 'node:path'

import type { CanvasPinchPayload } from '../shared/types'
import { registerIpcHandlers } from './ipc'
import { ensurePreviewServer } from './previewServer'
import { loadConfig, saveConfig } from './storage'

const { app, BrowserWindow, screen, shell } = electron
type AppWindow = InstanceType<typeof BrowserWindow>
const INSTANCE_LABEL = process.env.OPEN_CANVAS_INSTANCE_LABEL?.trim()
const APP_NAME = INSTANCE_LABEL ? `Open Canvas (${INSTANCE_LABEL})` : 'Open Canvas'

app.setName(APP_NAME)

let mainWindow: AppWindow | null = null

type NativeInputEvent = Electron.InputEvent & Record<string, unknown>

function bundledResourcePath(...segments: string[]) {
  const basePath = app.isPackaged ? process.resourcesPath : app.getAppPath()
  return join(basePath, ...segments)
}

function readNumericField(
  input: NativeInputEvent,
  fieldNames: string[]
): number | undefined {
  for (const fieldName of fieldNames) {
    const value = input[fieldName]

    if (typeof value === 'number' && Number.isFinite(value)) {
      return value
    }
  }

  return undefined
}

function toCanvasPinchPayload(
  window: AppWindow,
  input: NativeInputEvent
): CanvasPinchPayload | null {
  const phase =
    input.type === 'gesturePinchBegin'
      ? 'begin'
      : input.type === 'gesturePinchUpdate'
        ? 'update'
        : input.type === 'gesturePinchEnd'
          ? 'end'
          : null

  if (!phase) {
    return null
  }

  const cursorPoint = screen.getCursorScreenPoint()
  const contentBounds = window.getContentBounds()
  const rawScale = readNumericField(input, ['scale', 'zoomFactor'])
  const magnification = readNumericField(input, ['magnification'])
  const delta = readNumericField(input, ['delta', 'deltaY', 'wheelDeltaY', 'magnification'])

  return {
    phase,
    clientX: cursorPoint.x - contentBounds.x,
    clientY: cursorPoint.y - contentBounds.y,
    scale:
      typeof rawScale === 'number'
        ? rawScale
        : typeof magnification === 'number'
          ? 1 + magnification
          : undefined,
    delta
  }
}

async function createMainWindow(): Promise<void> {
  const config = await loadConfig()
  const iconPath = bundledResourcePath('resources', 'claude-canvas-icon.png')
  let hasLoadedMainDocument = false

  mainWindow = new BrowserWindow({
    x: config.windowState.x,
    y: config.windowState.y,
    width: config.windowState.width,
    height: config.windowState.height,
    minWidth: 1120,
    minHeight: 760,
    show: false,
    backgroundColor: config.ui.darkMode ? '#090b0d' : '#ece8df',
    title: APP_NAME,
    titleBarStyle: 'hiddenInset',
    icon: iconPath,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      plugins: true,
      sandbox: false
    }
  })

  if (config.windowState.isMaximized) {
    mainWindow.maximize()
  }

  mainWindow.webContents.on('before-input-event', (event, input) => {
    const payload = toCanvasPinchPayload(mainWindow as AppWindow, input as unknown as NativeInputEvent)

    if (!payload) {
      return
    }

    event.preventDefault()
    mainWindow?.webContents.send('canvas:pinch', payload)
  })

  mainWindow.webContents.once('did-finish-load', () => {
    hasLoadedMainDocument = true
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!hasLoadedMainDocument) {
      return
    }

    event.preventDefault()

    if (/^https?:/i.test(url)) {
      void shell.openExternal(url)
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) {
      void shell.openExternal(url)
    }

    return {
      action: 'deny'
    }
  })

  mainWindow.on('close', async () => {
    if (!mainWindow) {
      return
    }

    const bounds = mainWindow.getBounds()
    const latestConfig = await loadConfig()

    await saveConfig({
      ...latestConfig,
      windowState: {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        isMaximized: mainWindow.isMaximized()
      }
    })
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    await mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  if (process.platform === 'darwin' && app.dock) {
    const dockIcon = electron.nativeImage.createFromPath(
      bundledResourcePath('resources', 'claude-canvas-icon.png')
    )

    if (!dockIcon.isEmpty()) {
      app.dock.setIcon(dockIcon)
    }
  }

  await ensurePreviewServer()

  registerIpcHandlers()
  await createMainWindow()

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
