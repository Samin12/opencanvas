import * as electron from 'electron'
import { createHash } from 'node:crypto'
import { execFile, spawnSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

import type { PresentationPreviewResult } from '../shared/types'

const { app } = electron

const PREVIEW_DIRECTORY_NAME = 'presentation-previews'
const CONVERSION_TIMEOUT_MS = 120_000

function execFileAsync(file: string, args: string[], timeoutMs = CONVERSION_TIMEOUT_MS) {
  return new Promise<{ stdout: string; stderr: string }>((resolvePromise, rejectPromise) => {
    execFile(file, args, { timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error) {
        rejectPromise(error)
        return
      }

      resolvePromise({
        stderr,
        stdout
      })
    })
  })
}

async function pathExists(targetPath: string) {
  try {
    await stat(targetPath)
    return true
  } catch {
    return false
  }
}

function availableCommand(commandName: string) {
  const result = spawnSync('/usr/bin/env', ['which', commandName], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  })

  if (result.status !== 0) {
    return null
  }

  const commandPath = result.stdout.trim()
  return commandPath.length > 0 ? commandPath : null
}

function keynoteAvailable() {
  if (process.platform !== 'darwin') {
    return false
  }

  const result = spawnSync(
    '/usr/bin/osascript',
    ['-e', 'tell application "Keynote" to version'],
    {
      stdio: ['ignore', 'ignore', 'ignore']
    }
  )

  return result.status === 0
}

function previewOutputPath(filePath: string, mtimeMs: number, size: number) {
  const hash = createHash('sha1')
    .update(`${resolve(filePath)}:${mtimeMs}:${size}`)
    .digest('hex')

  return join(app.getPath('userData'), PREVIEW_DIRECTORY_NAME, `${hash}.pdf`)
}

async function exportWithLibreOffice(commandPath: string, filePath: string, outputPath: string) {
  const tempDirectory = await mkdtemp(join(tmpdir(), 'open-canvas-presentation-preview-'))

  try {
    await execFileAsync(commandPath, ['--headless', '--convert-to', 'pdf', '--outdir', tempDirectory, filePath])

    const convertedPath = join(tempDirectory, `${basename(filePath, extname(filePath))}.pdf`)

    if (!(await pathExists(convertedPath))) {
      throw new Error('LibreOffice did not produce a PDF preview.')
    }

    await copyFile(convertedPath, outputPath)
  } finally {
    await rm(tempDirectory, { force: true, recursive: true })
  }
}

async function exportWithKeynote(filePath: string, outputPath: string) {
  const script = [
    'tell application "Keynote"',
    `set sourcePresentation to open POSIX file "${filePath.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`,
    `export sourcePresentation to POSIX file "${outputPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}" as PDF`,
    'close sourcePresentation saving no',
    'end tell'
  ]

  await execFileAsync(
    '/usr/bin/osascript',
    script.flatMap((line) => ['-e', line])
  )

  if (!(await pathExists(outputPath))) {
    throw new Error('Keynote did not produce a PDF preview.')
  }
}

export async function ensurePresentationPreview(filePath: string): Promise<PresentationPreviewResult> {
  const resolvedFilePath = resolve(filePath)
  const sourceStats = await stat(resolvedFilePath)

  if (!sourceStats.isFile()) {
    return {
      detail: 'The presentation file does not exist on disk.',
      status: 'error'
    }
  }

  const outputPath = previewOutputPath(resolvedFilePath, sourceStats.mtimeMs, sourceStats.size)
  await mkdir(join(app.getPath('userData'), PREVIEW_DIRECTORY_NAME), { recursive: true })

  if (await pathExists(outputPath)) {
    const libreOfficeCommand = availableCommand('soffice') ?? availableCommand('libreoffice')

    return {
      filePath: outputPath,
      source: libreOfficeCommand ? 'libreoffice' : keynoteAvailable() ? 'keynote' : undefined,
      status: 'ready'
    }
  }

  const libreOfficeCommand = availableCommand('soffice') ?? availableCommand('libreoffice')

  try {
    if (libreOfficeCommand) {
      await exportWithLibreOffice(libreOfficeCommand, resolvedFilePath, outputPath)
      return {
        detail: 'Rendered from the source presentation as a local PDF preview.',
        filePath: outputPath,
        source: 'libreoffice',
        status: 'ready'
      }
    }

    if (keynoteAvailable()) {
      await exportWithKeynote(resolvedFilePath, outputPath)
      return {
        detail: 'Rendered from the source presentation through Keynote as a local PDF preview.',
        filePath: outputPath,
        source: 'keynote',
        status: 'ready'
      }
    }
  } catch (error) {
    return {
      detail:
        error instanceof Error && error.message
          ? error.message
          : 'The presentation preview could not be generated.',
      status: 'error'
    }
  }

  return {
    detail:
      process.platform === 'darwin'
        ? 'Install Docker for ONLYOFFICE, install LibreOffice, or keep Keynote available to generate a PDF preview.'
        : 'Install Docker for ONLYOFFICE or install LibreOffice to generate a PDF preview.',
    status: 'unavailable'
  }
}
