import { existsSync, renameSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_NAME = process.env.OPEN_CANVAS_DOCK_NAME?.trim() || 'Open Canvas'

if (process.platform !== 'darwin') {
  process.exit(0)
}

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const electronApp = resolve(projectRoot, 'node_modules/electron/dist/Electron.app')
const infoPlist = join(electronApp, 'Contents/Info.plist')
const executableDir = join(electronApp, 'Contents/MacOS')
const electronPathFile = resolve(projectRoot, 'node_modules/electron/path.txt')
const stockExecutablePath = join(executableDir, 'Electron')
const renamedExecutablePath = join(executableDir, APP_NAME)

if (!existsSync(infoPlist)) {
  throw new Error(`Electron dev bundle not found at ${infoPlist}`)
}

if (!existsSync(renamedExecutablePath) && existsSync(stockExecutablePath)) {
  renameSync(stockExecutablePath, renamedExecutablePath)
}

if (!existsSync(renamedExecutablePath)) {
  throw new Error(`Electron executable not found at ${renamedExecutablePath}`)
}

function setPlistValue(plistPath, key, value) {
  execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, plistPath], {
    stdio: 'ignore'
  })
}

const plistUpdates = [
  ['CFBundleExecutable', APP_NAME],
  ['CFBundleDisplayName', APP_NAME],
  ['CFBundleName', APP_NAME]
]

for (const [key, value] of plistUpdates) {
  try {
    setPlistValue(infoPlist, key, value)
  } catch {
    // Electron's dev bundle already includes these keys; if one update fails,
    // don't block the local dev launcher from starting.
  }
}

writeFileSync(electronPathFile, `Electron.app/Contents/MacOS/${APP_NAME}`)
