import * as electron from 'electron'
import { spawn } from 'node:child_process'
import { access, chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { AppUpdateState } from '../shared/types'

const { app, BrowserWindow, Notification } = electron

const DEFAULT_RELEASE_REPO = process.env.OPEN_CANVAS_RELEASE_REPO?.trim() || 'Samin12/opencanvas'
const DEFAULT_RELEASES_API_URL =
  process.env.OPEN_CANVAS_RELEASES_API_URL?.trim() ||
  `https://api.github.com/repos/${DEFAULT_RELEASE_REPO}/releases/latest`
const UPDATE_CHECK_INTERVAL_MS = 1000 * 60 * 60 * 6
const DEV_UPDATE_CHECKS_ENABLED = process.env.OPEN_CANVAS_ENABLE_DEV_UPDATES === '1'

interface GitHubReleaseAsset {
  browser_download_url?: string
  name?: string
}

interface GitHubReleasePayload {
  assets?: GitHubReleaseAsset[]
  html_url?: string
  name?: string
  published_at?: string
  tag_name?: string
}

let checkTimer: NodeJS.Timeout | null = null
let currentCheckPromise: Promise<AppUpdateState> | null = null
let hasStartedUpdateChecks = false
let lastNativeNotificationVersion: string | null = null

let updateState: AppUpdateState = {
  currentVersion: app.getVersion(),
  detail: app.isPackaged || DEV_UPDATE_CHECKS_ENABLED
    ? undefined
    : 'Update checks run in packaged builds.',
  installSupported: false,
  status: app.isPackaged || DEV_UPDATE_CHECKS_ENABLED ? 'idle' : 'disabled'
}

function isUpdateCheckingEnabled(): boolean {
  return app.isPackaged || DEV_UPDATE_CHECKS_ENABLED
}

function appArchSuffix(): string | null {
  if (process.arch === 'arm64') {
    return 'arm64'
  }

  if (process.arch === 'x64') {
    return 'x64'
  }

  return null
}

function normalizeVersion(input: string | null | undefined): string | null {
  if (!input) {
    return null
  }

  const normalized = input.trim().replace(/^v/i, '')
  return normalized.length > 0 ? normalized : null
}

function compareVersions(left: string, right: string): number {
  const leftParts = left
    .split('-', 1)[0]
    .split('.')
    .map((part) => Number.parseInt(part, 10))
  const rightParts = right
    .split('-', 1)[0]
    .split('.')
    .map((part) => Number.parseInt(part, 10))
  const partCount = Math.max(leftParts.length, rightParts.length)

  for (let index = 0; index < partCount; index += 1) {
    const leftValue = Number.isFinite(leftParts[index]) ? leftParts[index] : 0
    const rightValue = Number.isFinite(rightParts[index]) ? rightParts[index] : 0

    if (leftValue !== rightValue) {
      return leftValue > rightValue ? 1 : -1
    }
  }

  return 0
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

async function resolveBundledInstallScriptPath(): Promise<string | null> {
  const candidatePath = app.isPackaged
    ? join(process.resourcesPath, 'install.sh')
    : join(app.getAppPath(), 'install.sh')

  try {
    await access(candidatePath, constants.R_OK)
    return candidatePath
  } catch {
    return null
  }
}

function selectMacDmgAsset(payload: GitHubReleasePayload): GitHubReleaseAsset | null {
  const dmgAssets = (payload.assets ?? []).filter(
    (asset) =>
      typeof asset.browser_download_url === 'string' &&
      asset.browser_download_url.endsWith('.dmg')
  )

  if (dmgAssets.length === 0) {
    return null
  }

  const preferredSuffix = appArchSuffix()

  if (!preferredSuffix) {
    return dmgAssets[0] ?? null
  }

  return (
    dmgAssets.find((asset) => asset.name?.endsWith(`-${preferredSuffix}.dmg`)) ??
    dmgAssets[0] ??
    null
  )
}

function emitUpdateState(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('app-update:state', updateState)
    }
  }
}

function setUpdateState(nextState: AppUpdateState): AppUpdateState {
  updateState = nextState
  emitUpdateState()
  return updateState
}

function maybeShowNativeNotification(nextState: AppUpdateState): void {
  if (
    nextState.status !== 'available' ||
    !nextState.latestVersion ||
    lastNativeNotificationVersion === nextState.latestVersion ||
    !Notification.isSupported()
  ) {
    return
  }

  lastNativeNotificationVersion = nextState.latestVersion

  const notification = new Notification({
    title: 'Open Canvas update available',
    body: `Version ${nextState.latestVersion} is ready to install.`
  })

  notification.on('click', () => {
    const targetWindow = BrowserWindow.getAllWindows()[0]
    targetWindow?.show()
    targetWindow?.focus()
  })
  notification.show()
}

async function fetchLatestRelease(): Promise<GitHubReleasePayload> {
  const response = await fetch(DEFAULT_RELEASES_API_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Open-Canvas-Updater'
    }
  })

  if (!response.ok) {
    throw new Error(`GitHub release metadata returned ${response.status}.`)
  }

  return (await response.json()) as GitHubReleasePayload
}

export function getAppUpdateState(): AppUpdateState {
  return updateState
}

export async function checkForAppUpdate(): Promise<AppUpdateState> {
  if (!isUpdateCheckingEnabled()) {
    return setUpdateState({
      currentVersion: app.getVersion(),
      detail: 'Update checks run in packaged builds.',
      installSupported: false,
      status: 'disabled'
    })
  }

  if (updateState.status === 'installing') {
    return updateState
  }

  if (currentCheckPromise) {
    return currentCheckPromise
  }

  currentCheckPromise = (async () => {
    const installScriptPath = await resolveBundledInstallScriptPath()
    const baseState = {
      checkedAt: updateState.checkedAt,
      currentVersion: app.getVersion(),
      installSupported: Boolean(installScriptPath)
    }

    setUpdateState({
      ...updateState,
      ...baseState,
      detail: undefined,
      status: 'checking'
    })

    try {
      const release = await fetchLatestRelease()
      const latestVersion = normalizeVersion(release.tag_name)

      if (!latestVersion) {
        throw new Error('The latest GitHub release is missing a valid version tag.')
      }

      const currentVersion = normalizeVersion(app.getVersion()) ?? app.getVersion()
      const checkedAt = new Date().toISOString()
      const dmgAsset = selectMacDmgAsset(release)

      if (compareVersions(latestVersion, currentVersion) <= 0) {
        return setUpdateState({
          ...baseState,
          checkedAt,
          currentVersion,
          detail: undefined,
          installSupported: Boolean(installScriptPath),
          latestVersion,
          releaseHtmlUrl: release.html_url,
          releaseName: release.name,
          releasePublishedAt: release.published_at,
          releaseTag: release.tag_name,
          status: 'not-available'
        })
      }

      const nextState = setUpdateState({
        ...baseState,
        checkedAt,
        currentVersion,
        detail:
          dmgAsset || !release.html_url
            ? undefined
            : 'A newer release exists, but no macOS DMG asset was attached to it.',
        installSupported: Boolean(installScriptPath && dmgAsset && release.html_url),
        latestVersion,
        releaseHtmlUrl: release.html_url,
        releaseName: release.name,
        releasePublishedAt: release.published_at,
        releaseTag: release.tag_name,
        status: 'available'
      })

      maybeShowNativeNotification(nextState)
      return nextState
    } catch (error) {
      return setUpdateState({
        ...baseState,
        checkedAt: new Date().toISOString(),
        currentVersion: app.getVersion(),
        detail:
          error instanceof Error && error.message ? error.message : 'The latest release could not be checked.',
        installSupported: Boolean(installScriptPath),
        status: 'error'
      })
    }
  })()

  try {
    return await currentCheckPromise
  } finally {
    currentCheckPromise = null
  }
}

export async function startAppUpdateChecks(): Promise<void> {
  if (hasStartedUpdateChecks) {
    return
  }

  hasStartedUpdateChecks = true

  if (!isUpdateCheckingEnabled()) {
    const installScriptPath = await resolveBundledInstallScriptPath()

    setUpdateState({
      currentVersion: app.getVersion(),
      detail: 'Update checks run in packaged builds.',
      installSupported: Boolean(installScriptPath),
      status: 'disabled'
    })
    return
  }

  void checkForAppUpdate()

  if (!checkTimer) {
    checkTimer = setInterval(() => {
      void checkForAppUpdate()
    }, UPDATE_CHECK_INTERVAL_MS)
  }
}

export async function installAvailableAppUpdate(): Promise<void> {
  if (updateState.status !== 'available' || !updateState.releaseHtmlUrl) {
    throw new Error('No installable update is currently available.')
  }

  const installScriptPath = await resolveBundledInstallScriptPath()

  if (!installScriptPath) {
    throw new Error('The packaged installer script is missing from this app build.')
  }

  const helperDirectory = await mkdtemp(join(tmpdir(), 'open-canvas-update-'))
  const helperScriptPath = join(helperDirectory, 'install-update.sh')
  const helperScript = `#!/usr/bin/env bash
set -euo pipefail

APP_PID=${process.pid}
INSTALL_SCRIPT=${shellQuote(installScriptPath)}
RELEASE_URL=${shellQuote(updateState.releaseHtmlUrl)}

while kill -0 "$APP_PID" 2>/dev/null; do
  sleep 1
done

export OPEN_CANVAS_OPEN_AFTER_INSTALL=1
/bin/bash "$INSTALL_SCRIPT" "$RELEASE_URL"
`

  await writeFile(helperScriptPath, helperScript, 'utf8')
  await chmod(helperScriptPath, 0o755)

  const child = spawn('/bin/bash', [helperScriptPath], {
    detached: true,
    stdio: 'ignore'
  })
  child.unref()

  setUpdateState({
    ...updateState,
    detail: `Installing Open Canvas ${updateState.latestVersion ?? ''} and relaunching…`.trim(),
    installSupported: true,
    status: 'installing'
  })

  app.quit()
}
