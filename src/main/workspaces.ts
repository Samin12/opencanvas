import { lstat, mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname } from 'node:path'
import { pathToFileURL } from 'node:url'

import type { FileKind, FileTreeNode, TextFileDocument } from '../shared/types'

const NOTE_EXTENSIONS = new Set(['.md', '.mdx', '.markdown', '.txt'])
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'])
const IGNORED_NAMES = new Set(['.DS_Store'])
const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'out'])

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

      return {
        name,
        path,
        kind: 'directory',
        children
      }
    }

    const extension = extname(path).toLowerCase()

    return {
      name,
      path,
      kind: 'file',
      extension,
      fileKind: detectFileKind(path)
    }
  } catch {
    return null
  }
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

export async function writeTextFileDocument(
  filePath: string,
  content: string
): Promise<TextFileDocument> {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, content, 'utf8')
  return readTextFileDocument(filePath)
}

export function toFileUrl(filePath: string): string {
  return pathToFileURL(filePath).toString()
}
