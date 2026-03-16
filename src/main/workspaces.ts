import { unwatchFile, watchFile } from 'node:fs'
import { lstat, mkdir, readdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import type {
  FileKind,
  FileTreeNode,
  ImageAssetData,
  TextFileDocument,
  WorkspaceImageImport
} from '../shared/types'

const NOTE_EXTENSIONS = new Set(['.md', '.mdx', '.markdown', '.txt'])
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'])
const IGNORED_NAMES = new Set(['.DS_Store'])
const IGNORED_DIRECTORIES = new Set(['.claude-canvas', '.git', 'node_modules', 'dist', 'out'])
const WORKSPACE_METADATA_DIRECTORY = '.claude-canvas'
const WORKSPACE_ASSETS_DIRECTORY = 'assets'
const watchedFiles = new Map<string, Set<() => void>>()
const IMAGE_MIME_EXTENSIONS = new Map<string, string>([
  ['image/gif', '.gif'],
  ['image/jpeg', '.jpg'],
  ['image/jpg', '.jpg'],
  ['image/png', '.png'],
  ['image/svg+xml', '.svg'],
  ['image/webp', '.webp']
])
const IMAGE_EXTENSION_MIME_TYPES = new Map<string, string>(
  Array.from(IMAGE_MIME_EXTENSIONS.entries()).map(([mimeType, extension]) => [extension, mimeType])
)

export function detectFileKind(filePath: string): FileKind {
  const extension = extname(filePath).toLowerCase()

  if (IMAGE_EXTENSIONS.has(extension)) {
    return 'image'
  }

  if (NOTE_EXTENSIONS.has(extension)) {
    return 'note'
  }

  return 'code'
}

function isWithinWorkspace(workspacePath: string, targetPath: string) {
  const workspaceRoot = resolve(workspacePath)
  const candidatePath = resolve(targetPath)
  const relativePath = relative(workspaceRoot, candidatePath)

  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
}

async function pathExists(targetPath: string) {
  try {
    await stat(targetPath)
    return true
  } catch {
    return false
  }
}

async function createUniquePath(directoryPath: string, baseName: string, extension: string) {
  let suffix = 1
  let candidatePath = join(directoryPath, `${baseName}${extension}`)

  while (await pathExists(candidatePath)) {
    suffix += 1
    candidatePath = join(directoryPath, `${baseName} ${suffix}${extension}`)
  }

  return candidatePath
}

function normalizeImageExtension(extension: string): string | null {
  const normalized = extension.toLowerCase()

  return IMAGE_EXTENSIONS.has(normalized) ? normalized : null
}

function imageImportExtension(input: Pick<WorkspaceImageImport, 'fileName' | 'mimeType'>): string {
  const fileNameExtension = normalizeImageExtension(extname(input.fileName ?? ''))

  if (fileNameExtension) {
    return fileNameExtension
  }

  const mimeExtension =
    typeof input.mimeType === 'string' ? IMAGE_MIME_EXTENSIONS.get(input.mimeType.toLowerCase()) : null

  return mimeExtension ?? '.png'
}

function imageImportBaseName(fileName?: string | null): string {
  const candidate = basename(fileName ?? '', extname(fileName ?? ''))
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return candidate.length > 0 ? candidate : 'Pasted image'
}

function imageImportBytes(bytes: WorkspaceImageImport['bytes']): Uint8Array {
  if (bytes instanceof ArrayBuffer) {
    return new Uint8Array(bytes)
  }

  if (ArrayBuffer.isView(bytes)) {
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }

  if (Array.isArray(bytes)) {
    return Uint8Array.from(bytes)
  }

  if (bytes && typeof bytes === 'object' && 'length' in bytes) {
    return Uint8Array.from(Array.from(bytes as ArrayLike<number>))
  }

  throw new Error('Unsupported image bytes payload')
}

async function resolveStats(targetPath: string) {
  const currentStats = await lstat(targetPath)

  if (currentStats.isSymbolicLink()) {
    const resolvedPath = await realpath(targetPath)
    const resolvedStats = await stat(resolvedPath)
    return {
      path: resolvedPath,
      stats: resolvedStats
    }
  }

  return {
    path: targetPath,
    stats: currentStats
  }
}

async function buildNode(targetPath: string): Promise<FileTreeNode | null> {
  try {
    const { path, stats } = await resolveStats(targetPath)
    const createdAt = stats.birthtimeMs > 0 ? stats.birthtimeMs : stats.mtimeMs
    const name = basename(targetPath)

    if (IGNORED_NAMES.has(name)) {
      return null
    }

    if (stats.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(name)) {
        return null
      }

      const entries = await readdir(path, { withFileTypes: true })
      const children = (
        await Promise.all(
          entries.map((entry) => buildNode(`${path}/${entry.name}`))
        )
      ).filter((child): child is FileTreeNode => child !== null)

      children.sort((left, right) => {
        if (left.kind !== right.kind) {
          return left.kind === 'directory' ? -1 : 1
        }

        return left.name.localeCompare(right.name)
      })

      const descendantFileCount = children.reduce((count, child) => {
        if (child.kind === 'file') {
          return count + 1
        }

        return count + (child.descendantFileCount ?? 0)
      }, 0)
      const updatedAt = Math.max(createdAt, ...children.map((child) => child.updatedAt ?? 0))

      return {
        descendantFileCount,
        name,
        path,
        kind: 'directory',
        children,
        updatedAt
      }
    }

    const extension = extname(path).toLowerCase()

    return {
      name,
      path,
      kind: 'file',
      extension,
      fileKind: detectFileKind(path),
      updatedAt: createdAt
    }
  } catch {
    return null
  }
}

async function ensureFileNode(targetPath: string) {
  const node = await buildNode(targetPath)

  if (!node || node.kind !== 'file') {
    throw new Error('Expected a file node')
  }

  return node
}

export async function readWorkspaceTree(workspacePath: string): Promise<FileTreeNode[]> {
  const entries = await readdir(workspacePath, { withFileTypes: true })

  const nodes = (
    await Promise.all(entries.map((entry) => buildNode(`${workspacePath}/${entry.name}`)))
  ).filter((node): node is FileTreeNode => node !== null)

  nodes.sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === 'directory' ? -1 : 1
    }

    return left.name.localeCompare(right.name)
  })

  return nodes
}

export async function readTextFileDocument(filePath: string): Promise<TextFileDocument> {
  const content = await readFile(filePath, 'utf8')
  const currentStats = await stat(filePath)

  return {
    path: filePath,
    kind: detectFileKind(filePath),
    content,
    updatedAt: currentStats.mtimeMs
  }
}

export async function readImageAssetData(filePath: string): Promise<ImageAssetData> {
  const bytes = await readFile(filePath)
  const extension = extname(filePath).toLowerCase()

  return {
    base64: bytes.toString('base64'),
    mimeType: IMAGE_EXTENSION_MIME_TYPES.get(extension) ?? 'application/octet-stream'
  }
}

export async function writeTextFileDocument(
  filePath: string,
  content: string
): Promise<TextFileDocument> {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, content, 'utf8')
  return readTextFileDocument(filePath)
}

export function subscribeToFileChanges(filePath: string, listener: () => void): () => void {
  const resolvedFilePath = resolve(filePath)
  let listeners = watchedFiles.get(resolvedFilePath)

  if (!listeners) {
    listeners = new Set()
    watchedFiles.set(resolvedFilePath, listeners)
    watchFile(resolvedFilePath, { interval: 250 }, (current, previous) => {
      if (
        current.mtimeMs === previous.mtimeMs &&
        current.size === previous.size &&
        current.nlink === previous.nlink
      ) {
        return
      }

      const currentListeners = watchedFiles.get(resolvedFilePath)

      if (!currentListeners) {
        return
      }

      for (const notify of currentListeners) {
        notify()
      }
    })
  }

  listeners.add(listener)

  return () => {
    const currentListeners = watchedFiles.get(resolvedFilePath)

    if (!currentListeners) {
      return
    }

    currentListeners.delete(listener)

    if (currentListeners.size === 0) {
      watchedFiles.delete(resolvedFilePath)
      unwatchFile(resolvedFilePath)
    }
  }
}

export async function createWorkspaceNote(
  workspacePath: string,
  targetDirectoryPath = workspacePath
): Promise<FileTreeNode> {
  const resolvedWorkspacePath = resolve(workspacePath)
  const resolvedTargetDirectoryPath = resolve(targetDirectoryPath)

  if (!isWithinWorkspace(resolvedWorkspacePath, resolvedTargetDirectoryPath)) {
    throw new Error('Note target is outside the active workspace')
  }

  const targetDirectoryStats = await stat(resolvedTargetDirectoryPath)

  if (!targetDirectoryStats.isDirectory()) {
    throw new Error('Note target must be a directory')
  }

  const targetPath = await createUniquePath(resolvedTargetDirectoryPath, 'Untitled', '.md')

  await writeTextFileDocument(targetPath, '')

  return ensureFileNode(targetPath)
}

export async function moveWorkspaceNode(
  workspacePath: string,
  sourcePath: string,
  targetDirectoryPath: string
): Promise<FileTreeNode> {
  const resolvedWorkspacePath = resolve(workspacePath)
  const resolvedSourcePath = resolve(sourcePath)
  const resolvedTargetDirectoryPath = resolve(targetDirectoryPath)

  if (
    !isWithinWorkspace(resolvedWorkspacePath, resolvedSourcePath) ||
    !isWithinWorkspace(resolvedWorkspacePath, resolvedTargetDirectoryPath)
  ) {
    throw new Error('Move target is outside the active workspace')
  }

  const targetDirectoryStats = await stat(resolvedTargetDirectoryPath)

  if (!targetDirectoryStats.isDirectory()) {
    throw new Error('Move target must be a directory')
  }

  if (dirname(resolvedSourcePath) === resolvedTargetDirectoryPath) {
    return ensureFileNode(resolvedSourcePath)
  }

  const extension = extname(resolvedSourcePath)
  const baseName = basename(resolvedSourcePath, extension)
  const targetPath = await createUniquePath(resolvedTargetDirectoryPath, baseName, extension)

  await rename(resolvedSourcePath, targetPath)

  return ensureFileNode(targetPath)
}

export async function importWorkspaceImage(
  workspacePath: string,
  image: WorkspaceImageImport
): Promise<FileTreeNode> {
  const resolvedWorkspacePath = resolve(workspacePath)
  const assetsDirectoryPath = join(
    resolvedWorkspacePath,
    WORKSPACE_METADATA_DIRECTORY,
    WORKSPACE_ASSETS_DIRECTORY
  )

  await mkdir(assetsDirectoryPath, { recursive: true })

  const targetPath = await createUniquePath(
    assetsDirectoryPath,
    imageImportBaseName(image.fileName),
    imageImportExtension(image)
  )

  await writeFile(targetPath, imageImportBytes(image.bytes))

  return ensureFileNode(targetPath)
}

export function toFileUrl(filePath: string): string {
  return pathToFileURL(filePath).toString()
}
