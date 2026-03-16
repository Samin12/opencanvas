import { copyFileSync, existsSync, renameSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_NAME = process.env.OPEN_CANVAS_DOCK_NAME?.trim() || 'Open Canvas'
const APP_BUNDLE_ID = 'com.saminyasar.opencanvas.dev'
const APP_ICON_NAME = 'open-canvas'

if (process.platform !== 'darwin') {
  process.exit(0)
}

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const distDirectory = resolve(projectRoot, 'node_modules/electron/dist')
const stockBundleName = 'Electron.app'
const renamedBundleName = `${APP_NAME}.app`
const stockElectronApp = resolve(distDirectory, stockBundleName)
const renamedElectronApp = resolve(distDirectory, renamedBundleName)
const electronPathFile = resolve(projectRoot, 'node_modules/electron/path.txt')

if (!existsSync(renamedElectronApp) && existsSync(stockElectronApp)) {
  renameSync(stockElectronApp, renamedElectronApp)
}

const electronApp = existsSync(renamedElectronApp) ? renamedElectronApp : stockElectronApp
const infoPlist = join(electronApp, 'Contents/Info.plist')
const executableDir = join(electronApp, 'Contents/MacOS')
const resourcesDir = join(electronApp, 'Contents/Resources')
const stockExecutablePath = join(executableDir, 'Electron')
const renamedExecutablePath = join(executableDir, APP_NAME)
const macIconScript = resolve(projectRoot, 'scripts/build-mac-icon.mjs')
const sourceIconPath = resolve(projectRoot, 'build/mac/icon.icns')
const bundledIconPath = join(resourcesDir, `${APP_ICON_NAME}.icns`)

if (!existsSync(infoPlist)) {
  throw new Error(`Electron dev bundle not found at ${infoPlist}`)
}

if (!existsSync(renamedExecutablePath) && existsSync(stockExecutablePath)) {
  renameSync(stockExecutablePath, renamedExecutablePath)
}

if (!existsSync(renamedExecutablePath)) {
  throw new Error(`Electron executable not found at ${renamedExecutablePath}`)
}

if (!existsSync(sourceIconPath)) {
  execFileSync(process.execPath, [macIconScript], {
    stdio: 'ignore'
  })
}

if (!existsSync(sourceIconPath)) {
  throw new Error(`Open Canvas icon not found at ${sourceIconPath}`)
}

copyFileSync(sourceIconPath, bundledIconPath)

function setPlistValue(plistPath, key, value) {
  execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, plistPath], {
    stdio: 'ignore'
  })
}

const plistUpdates = [
  ['CFBundleExecutable', APP_NAME],
  ['CFBundleDisplayName', APP_NAME],
  ['CFBundleName', APP_NAME],
  ['CFBundleIdentifier', APP_BUNDLE_ID],
  ['CFBundleIconFile', APP_ICON_NAME]
]

for (const [key, value] of plistUpdates) {
  try {
    setPlistValue(infoPlist, key, value)
  } catch {
    // Electron's dev bundle already includes these keys; if one update fails,
    // don't block the local dev launcher from starting.
  }
}

writeFileSync(electronPathFile, `${renamedBundleName}/Contents/MacOS/${APP_NAME}`)
