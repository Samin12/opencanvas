import { unwatchFile, watchFile } from 'node:fs'
import { cp, lstat, mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import type {
  CreateWorkspaceDirectoryOptions,
  CreateWorkspaceFileOptions,
  CreateWorkspaceNoteOptions,
  FileKind,
  FileTreeNode,
  ImageAssetData,
  ImportWorkspaceDownloadOptions,
  ImportWorkspacePathsOptions,
  RestoreWorkspaceDeletedNodeOptions,
  RenameWorkspaceNodeOptions,
  TextFileDocument,
  WorkspaceDeletedNode,
  WorkspaceAssetImport,
  WorkspaceImageImport
} from '../shared/types'

const NOTE_EXTENSIONS = new Set(['.md', '.mdx', '.markdown', '.txt'])
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'])
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi'])
const PDF_EXTENSIONS = new Set(['.pdf'])
const SPREADSHEET_EXTENSIONS = new Set(['.csv', '.tsv', '.xls', '.xlsx', '.ods'])
const PRESENTATION_EXTENSIONS = new Set(['.ppt', '.pptx', '.odp'])
const IGNORED_NAMES = new Set(['.DS_Store'])
const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.trash',
  'node_modules',
  'dist',
  'out',
  '.venv',
  'venv',
  'env',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.tox',
  '.nox'
])
const WORKSPACE_METADATA_DIRECTORY = '.claude-canvas'
const WORKSPACE_TRASH_DIRECTORY = '.trash'
const WORKSPACE_ASSETS_DIRECTORY = 'assets'
const WORKSPACE_CANVAS_FILES_DIRECTORY = 'canvas-files'
const watchedFiles = new Map<string, Set<() => void>>()
const ASSET_MIME_EXTENSIONS = new Map<string, string>([
  ['image/gif', '.gif'],
  ['image/jpeg', '.jpg'],
  ['image/jpg', '.jpg'],
  ['image/png', '.png'],
  ['image/svg+xml', '.svg'],
  ['image/webp', '.webp'],
  ['video/mp4', '.mp4'],
  ['video/quicktime', '.mov'],
  ['video/webm', '.webm'],
  ['video/x-m4v', '.m4v'],
  ['application/pdf', '.pdf'],
  ['text/csv', '.csv'],
  ['text/tab-separated-values', '.tsv'],
  ['application/vnd.ms-excel', '.xls'],
  [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xlsx'
  ],
  ['application/vnd.oasis.opendocument.spreadsheet', '.ods'],
  ['application/vnd.ms-powerpoint', '.ppt'],
  [
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.pptx'
  ],
  ['application/vnd.oasis.opendocument.presentation', '.odp']
])
const IMAGE_EXTENSION_MIME_TYPES = new Map<string, string>(
  Array.from(ASSET_MIME_EXTENSIONS.entries())
    .filter(([_mimeType, extension]) => IMAGE_EXTENSIONS.has(extension))
    .map(([mimeType, extension]) => [extension, mimeType])
)

export function detectFileKind(filePath: string): FileKind {
  const extension = extname(filePath).toLowerCase()

  if (IMAGE_EXTENSIONS.has(extension)) {
    return 'image'
  }

  if (VIDEO_EXTENSIONS.has(extension)) {
    return 'video'
  }

  if (PDF_EXTENSIONS.has(extension)) {
    return 'pdf'
  }

  if (SPREADSHEET_EXTENSIONS.has(extension)) {
    return 'spreadsheet'
  }

  if (PRESENTATION_EXTENSIONS.has(extension)) {
    return 'presentation'
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

function isSameOrDescendantPath(candidatePath: string, targetPath: string) {
  const resolvedCandidatePath = resolve(candidatePath)
  const resolvedTargetPath = resolve(targetPath)
  const relativePath = relative(resolvedTargetPath, resolvedCandidatePath)

  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
}

function workspaceMetadataPath(workspacePath: string) {
  return join(resolve(workspacePath), WORKSPACE_METADATA_DIRECTORY)
}

function workspaceCanvasFilesPath(workspacePath: string) {
  return join(workspaceMetadataPath(workspacePath), WORKSPACE_CANVAS_FILES_DIRECTORY)
}

function workspaceTrashPath(workspacePath: string) {
  return join(workspaceMetadataPath(workspacePath), WORKSPACE_TRASH_DIRECTORY)
}

function normalizeNameSegment(input: string, fallback: string) {
  const normalized = input
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return normalized.length > 0 ? normalized : fallback
}

function validateWorkspaceNameSegment(input: string, label: string) {
  const normalized = input.trim()

  if (!normalized) {
    throw new Error(`${label} is required`)
  }

  if (normalized === '.' || normalized === '..') {
    throw new Error(`${label} is invalid`)
  }

  if (normalized.includes('/') || normalized.includes('\\')) {
    throw new Error(`${label} must be a single name, not a path`)
  }

  return normalizeNameSegment(normalized, label)
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
  let candidatePath = join(directoryPath, `${baseName}${extension}`)
  let suffix = 1

  while (await pathExists(candidatePath)) {
    candidatePath = join(directoryPath, `${baseName} (${suffix})${extension}`)
    suffix += 1
  }

  return candidatePath
}

async function pathsReferToSameNode(leftPath: string, rightPath: string) {
  try {
    const [resolvedLeftPath, resolvedRightPath] = await Promise.all([
      realpath(leftPath),
      realpath(rightPath)
    ])

    return resolvedLeftPath === resolvedRightPath
  } catch {
    return false
  }
}

function normalizeAssetExtension(extension: string): string | null {
  const normalized = extension.toLowerCase()

  return IMAGE_EXTENSIONS.has(normalized) ||
    VIDEO_EXTENSIONS.has(normalized) ||
    PDF_EXTENSIONS.has(normalized) ||
    SPREADSHEET_EXTENSIONS.has(normalized) ||
    PRESENTATION_EXTENSIONS.has(normalized)
    ? normalized
    : null
}

function assetImportExtension(input: Pick<WorkspaceAssetImport, 'fileName' | 'mimeType'>): string {
  const fileNameExtension = normalizeAssetExtension(extname(input.fileName ?? ''))

  if (fileNameExtension) {
    return fileNameExtension
  }

  const mimeExtension =
    typeof input.mimeType === 'string' ? ASSET_MIME_EXTENSIONS.get(input.mimeType.toLowerCase()) : null

  return mimeExtension ?? '.bin'
}

function assetImportBaseName(fileName?: string | null): string {
  const candidate = basename(fileName ?? '', extname(fileName ?? ''))
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return candidate.length > 0 ? candidate : 'Imported asset'
}

function downloadFileNameFromHeaders(contentDisposition: string | null): string | null {
  if (!contentDisposition) {
    return null
  }

  const utf8Match = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(contentDisposition)

  if (utf8Match) {
    const decoded = decodeURIComponent(utf8Match[1]).trim()
    return decoded.length > 0 ? decoded : null
  }

  const plainMatch = /filename\s*=\s*"?([^\";]+)"?/i.exec(contentDisposition)

  if (!plainMatch) {
    return null
  }

  const decoded = plainMatch[1].trim()
  return decoded.length > 0 ? decoded : null
}

function downloadTargetName(
  url: string,
  fileName: string | undefined,
  mimeType: string | null,
  contentDisposition: string | null
) {
  const headerName = downloadFileNameFromHeaders(contentDisposition)
  const urlName = (() => {
    try {
      const parsed = new URL(url)
      const pathName = basename(parsed.pathname)
      return pathName.length > 0 ? pathName : null
    } catch {
      return null
    }
  })()
  const rawName = (fileName ?? headerName ?? urlName ?? 'Downloaded file').trim()
  const normalizedBaseName = assetImportBaseName(rawName)
  const explicitExtension = extname(rawName)
  const mimeExtension =
    typeof mimeType === 'string' && mimeType.length > 0 ? ASSET_MIME_EXTENSIONS.get(mimeType.toLowerCase()) : null
  const extension = explicitExtension || mimeExtension || ''

  return {
    baseName: basename(normalizedBaseName, extname(normalizedBaseName)),
    extension
  }
}

function assetImportBytes(bytes: WorkspaceAssetImport['bytes']): Uint8Array {
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

  throw new Error('Unsupported asset bytes payload')
}

async function resolveStats(targetPath: string) {
  const currentStats = await lstat(targetPath)

  if (currentStats.isSymbolicLink()) {
    const resolvedStats = await stat(targetPath)
    return {
      stats: resolvedStats
    }
  }

  return {
    stats: currentStats
  }
}

async function buildNode(targetPath: string): Promise<FileTreeNode | null> {
  try {
    const { stats } = await resolveStats(targetPath)
    const createdAt = stats.birthtimeMs > 0 ? stats.birthtimeMs : stats.mtimeMs
    const name = basename(targetPath)

    if (IGNORED_NAMES.has(name)) {
      return null
    }

    if (stats.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(name)) {
        return null
      }

      const entries = await readdir(targetPath, { withFileTypes: true })
      const children = (
        await Promise.all(
          entries.map((entry) => buildNode(`${targetPath}/${entry.name}`))
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
        path: targetPath,
        kind: 'directory',
        children,
        updatedAt
      }
    }

    const extension = extname(targetPath).toLowerCase()

    return {
      name,
      path: targetPath,
      kind: 'file',
      extension,
      fileKind: detectFileKind(targetPath),
      size: stats.size,
      updatedAt: createdAt
    }
  } catch {
    return null
  }
}

async function ensureNode(targetPath: string) {
  const node = await buildNode(targetPath)

  if (!node) {
    throw new Error('Expected a workspace node')
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

export async function readFileMetadata(filePath: string) {
  const currentStats = await stat(filePath)

  return {
    extension: extname(filePath).toLowerCase(),
    size: currentStats.size,
    updatedAt: currentStats.mtimeMs
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
  options: CreateWorkspaceNoteOptions = {}
): Promise<FileTreeNode> {
  const resolvedWorkspacePath = resolve(workspacePath)
  const resolvedTargetDirectoryPath = resolve(options.targetDirectoryPath ?? workspacePath)

  if (!isWithinWorkspace(resolvedWorkspacePath, resolvedTargetDirectoryPath)) {
    throw new Error('Note target is outside the active workspace')
  }

  let targetDirectoryStats

  try {
    targetDirectoryStats = await stat(resolvedTargetDirectoryPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }

    await mkdir(resolvedTargetDirectoryPath, { recursive: true })
    targetDirectoryStats = await stat(resolvedTargetDirectoryPath)
  }

  if (!targetDirectoryStats.isDirectory()) {
    throw new Error('Note target must be a directory')
  }

  const baseName = (options.baseName ?? 'Untitled')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'Untitled'
  const targetPath = await createUniquePath(resolvedTargetDirectoryPath, baseName, '.md')

  await writeTextFileDocument(targetPath, options.initialContent ?? '')

  return ensureNode(targetPath)
}

export async function createWorkspaceFile(
  workspacePath: string,
  options: CreateWorkspaceFileOptions
): Promise<FileTreeNode> {
  const resolvedWorkspacePath = resolve(workspacePath)
  const resolvedTargetDirectoryPath = resolve(options.targetDirectoryPath ?? workspacePath)

  if (!isWithinWorkspace(resolvedWorkspacePath, resolvedTargetDirectoryPath)) {
    throw new Error('File target is outside the active workspace')
  }

  let targetDirectoryStats

  try {
    targetDirectoryStats = await stat(resolvedTargetDirectoryPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }

    await mkdir(resolvedTargetDirectoryPath, { recursive: true })
    targetDirectoryStats = await stat(resolvedTargetDirectoryPath)
  }

  if (!targetDirectoryStats.isDirectory()) {
    throw new Error('File target must be a directory')
  }

  const fileName = validateWorkspaceNameSegment(options.fileName, 'File name')
  const targetPath = join(resolvedTargetDirectoryPath, fileName)

  if (await pathExists(targetPath)) {
    throw new Error('A file or folder with that name already exists')
  }

  await writeTextFileDocument(targetPath, options.initialContent ?? '')

  return ensureNode(targetPath)
}

export async function createWorkspaceDirectory(
  workspacePath: string,
  options: CreateWorkspaceDirectoryOptions
): Promise<FileTreeNode> {
  const resolvedWorkspacePath = resolve(workspacePath)
  const resolvedTargetDirectoryPath = resolve(options.targetDirectoryPath ?? workspacePath)

  if (!isWithinWorkspace(resolvedWorkspacePath, resolvedTargetDirectoryPath)) {
    throw new Error('Folder target is outside the active workspace')
  }

  const targetDirectoryStats = await stat(resolvedTargetDirectoryPath)

  if (!targetDirectoryStats.isDirectory()) {
    throw new Error('Folder target must be a directory')
  }

  const directoryName = validateWorkspaceNameSegment(options.directoryName, 'Folder name')
  const targetPath = join(resolvedTargetDirectoryPath, directoryName)

  if (await pathExists(targetPath)) {
    throw new Error('A file or folder with that name already exists')
  }

  await mkdir(targetPath, { recursive: false })

  return ensureNode(targetPath)
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
    return ensureNode(resolvedSourcePath)
  }

  const relativeTargetPath = relative(resolvedSourcePath, resolvedTargetDirectoryPath)

  if (relativeTargetPath === '' || (!relativeTargetPath.startsWith('..') && !isAbsolute(relativeTargetPath))) {
    throw new Error('A folder cannot be moved into itself')
  }

  const sourceStats = await stat(resolvedSourcePath)
  const extension = sourceStats.isDirectory() ? '' : extname(resolvedSourcePath)
  const baseName = sourceStats.isDirectory()
    ? basename(resolvedSourcePath)
    : basename(resolvedSourcePath, extension)
  const targetPath = await createUniquePath(resolvedTargetDirectoryPath, baseName, extension)

  await rename(resolvedSourcePath, targetPath)

  return ensureNode(targetPath)
}

export async function renameWorkspaceNode(
  workspacePath: string,
  options: RenameWorkspaceNodeOptions
): Promise<FileTreeNode> {
  const resolvedWorkspacePath = resolve(workspacePath)
  const resolvedTargetPath = resolve(options.targetPath)

  if (!isWithinWorkspace(resolvedWorkspacePath, resolvedTargetPath)) {
    throw new Error('Rename target is outside the active workspace')
  }

  const nextName = validateWorkspaceNameSegment(options.nextName, 'Name')
  let nextPath = join(dirname(resolvedTargetPath), nextName)

  if (resolvedTargetPath === nextPath) {
    return ensureNode(resolvedTargetPath)
  }

  const isCaseOnlyRename =
    resolvedTargetPath.toLowerCase() === nextPath.toLowerCase() && resolvedTargetPath !== nextPath

  if (
    (await pathExists(nextPath)) &&
    !(isCaseOnlyRename && (await pathsReferToSameNode(resolvedTargetPath, nextPath)))
  ) {
    if (!options.dedupeConflicts) {
      throw new Error('A file or folder with that name already exists')
    }

    const sourceStats = await stat(resolvedTargetPath)
    const nextExtension = sourceStats.isDirectory() ? '' : extname(nextPath)
    nextPath = await createUniquePath(
      dirname(resolvedTargetPath),
      sourceStats.isDirectory() ? basename(nextPath) : basename(nextPath, nextExtension),
      nextExtension
    )
  }

  if (isCaseOnlyRename) {
    const nextExtension = extname(nextPath)
    const temporaryPath = await createUniquePath(
      dirname(resolvedTargetPath),
      `${basename(nextPath, nextExtension)} __rename__`,
      nextExtension
    )

    await rename(resolvedTargetPath, temporaryPath)
    await rename(temporaryPath, nextPath)
  } else {
    await rename(resolvedTargetPath, nextPath)
  }

  return ensureNode(nextPath)
}

export async function deleteWorkspaceNode(workspacePath: string, targetPath: string): Promise<void> {
  const resolvedWorkspacePath = resolve(workspacePath)
  const resolvedTargetPath = resolve(targetPath)

  if (!isWithinWorkspace(resolvedWorkspacePath, resolvedTargetPath)) {
    throw new Error('Delete target is outside the active workspace')
  }

  if (resolvedTargetPath === resolvedWorkspacePath) {
    throw new Error('The workspace root cannot be deleted from the file tree')
  }

  await rm(resolvedTargetPath, {
    force: false,
    recursive: true
  })
}

export async function trashWorkspaceNode(
  workspacePath: string,
  targetPath: string
): Promise<WorkspaceDeletedNode> {
  const resolvedWorkspacePath = resolve(workspacePath)
  const resolvedTargetPath = resolve(targetPath)

  if (!isWithinWorkspace(resolvedWorkspacePath, resolvedTargetPath)) {
    throw new Error('Delete target is outside the active workspace')
  }

  if (resolvedTargetPath === resolvedWorkspacePath) {
    throw new Error('The workspace root cannot be deleted from the file tree')
  }

  const sourceStats = await stat(resolvedTargetPath)
  const trashDirectoryPath = workspaceTrashPath(resolvedWorkspacePath)
  const extension = sourceStats.isDirectory() ? '' : extname(resolvedTargetPath)
  const trashTargetPath = await createUniquePath(
    await (async () => {
      await mkdir(trashDirectoryPath, { recursive: true })
      return trashDirectoryPath
    })(),
    basename(resolvedTargetPath, extension),
    extension
  )

  await rename(resolvedTargetPath, trashTargetPath)

  return {
    originalPath: resolvedTargetPath,
    trashPath: trashTargetPath
  }
}

export async function restoreWorkspaceDeletedNode(
  workspacePath: string,
  options: RestoreWorkspaceDeletedNodeOptions
): Promise<FileTreeNode> {
  const resolvedWorkspacePath = resolve(workspacePath)
  const resolvedOriginalPath = resolve(options.originalPath)
  const resolvedTrashPath = resolve(options.trashPath)
  const resolvedTrashRoot = workspaceTrashPath(resolvedWorkspacePath)

  if (!isWithinWorkspace(resolvedWorkspacePath, resolvedOriginalPath)) {
    throw new Error('Restore target is outside the active workspace')
  }

  if (!isSameOrDescendantPath(resolvedTrashPath, resolvedTrashRoot)) {
    throw new Error('Restore source is outside the workspace trash')
  }

  const sourceStats = await stat(resolvedTrashPath)
  const extension = sourceStats.isDirectory() ? '' : extname(resolvedOriginalPath)
  const restoreDirectoryPath = dirname(resolvedOriginalPath)

  await mkdir(restoreDirectoryPath, { recursive: true })

  const restoreTargetPath = (await pathExists(resolvedOriginalPath))
    ? await createUniquePath(
        restoreDirectoryPath,
        basename(resolvedOriginalPath, extension),
        extension
      )
    : resolvedOriginalPath

  await rename(resolvedTrashPath, restoreTargetPath)

  return ensureNode(restoreTargetPath)
}

export async function importWorkspaceImage(
  workspacePath: string,
  image: WorkspaceImageImport
): Promise<FileTreeNode> {
  return importWorkspaceAsset(workspacePath, image)
}

export async function importWorkspaceAsset(
  workspacePath: string,
  asset: WorkspaceAssetImport
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
    assetImportBaseName(asset.fileName),
    assetImportExtension(asset)
  )

  await writeFile(targetPath, assetImportBytes(asset.bytes))

  return ensureNode(targetPath)
}

export async function importWorkspacePaths(
  workspacePath: string,
  options: ImportWorkspacePathsOptions
): Promise<FileTreeNode[]> {
  const resolvedWorkspacePath = resolve(workspacePath)
  const resolvedTargetDirectoryPath = resolve(options.targetDirectoryPath ?? workspacePath)

  if (!isWithinWorkspace(resolvedWorkspacePath, resolvedTargetDirectoryPath)) {
    throw new Error('Import target is outside the active workspace')
  }

  const targetDirectoryStats = await stat(resolvedTargetDirectoryPath)

  if (!targetDirectoryStats.isDirectory()) {
    throw new Error('Import target must be a directory')
  }

  const sourcePaths = Array.from(
    new Set(
      (Array.isArray(options.sourcePaths) ? options.sourcePaths : [])
        .filter((sourcePath): sourcePath is string => typeof sourcePath === 'string' && sourcePath.trim().length > 0)
        .map((sourcePath) => resolve(sourcePath))
    )
  )

  if (sourcePaths.length === 0) {
    return []
  }

  const importedNodes: FileTreeNode[] = []

  for (const sourcePath of sourcePaths) {
    const sourceStats = await lstat(sourcePath)
    const extension = sourceStats.isDirectory() ? '' : extname(sourcePath)
    const baseName = sourceStats.isDirectory()
      ? basename(sourcePath)
      : basename(sourcePath, extension)
    const targetPath = await createUniquePath(resolvedTargetDirectoryPath, baseName, extension)

    await cp(sourcePath, targetPath, {
      errorOnExist: true,
      force: false,
      preserveTimestamps: true,
      recursive: true
    })

    importedNodes.push(await ensureNode(targetPath))
  }

  return importedNodes
}

export async function importWorkspaceDownload(
  workspacePath: string,
  options: ImportWorkspaceDownloadOptions
): Promise<FileTreeNode> {
  const resolvedWorkspacePath = resolve(workspacePath)
  const resolvedTargetDirectoryPath = resolve(options.targetDirectoryPath ?? workspacePath)

  if (!isWithinWorkspace(resolvedWorkspacePath, resolvedTargetDirectoryPath)) {
    throw new Error('Import target is outside the active workspace')
  }

  const targetDirectoryStats = await stat(resolvedTargetDirectoryPath)

  if (!targetDirectoryStats.isDirectory()) {
    throw new Error('Import target must be a directory')
  }

  const sourceUrl = typeof options.url === 'string' ? options.url.trim() : ''

  if (!sourceUrl) {
    throw new Error('Download import requires a URL')
  }

  const response = await fetch(sourceUrl)

  if (!response.ok) {
    throw new Error(`Download failed with status ${response.status}`)
  }

  const contentType = response.headers.get('content-type') ?? options.mimeType ?? null
  const targetName = downloadTargetName(
    sourceUrl,
    options.fileName,
    contentType,
    response.headers.get('content-disposition')
  )
  const targetPath = await createUniquePath(
    resolvedTargetDirectoryPath,
    targetName.baseName,
    targetName.extension
  )
  const responseBytes = new Uint8Array(await response.arrayBuffer())

  await writeFile(targetPath, responseBytes)

  return ensureNode(targetPath)
}

export function toFileUrl(filePath: string): string {
  return pathToFileURL(filePath).toString()
}
