import { mergeAttributes, Node, nodeInputRule } from '@tiptap/core'

import type { FileTreeNode } from '@shared/types'

const COLLABORATOR_FILE_MIME = 'application/x-collaborator-file'
const IMAGE_MARKDOWN_INPUT_REGEX = /(?:^|\s)(!\[(.+|:?)]\((\S+)(?:(?:\s+)["'](\S+)["'])?\))$/
const REMOTE_IMAGE_PROTOCOL_PATTERN = /^(?:[a-z][a-z\d+\-.]*:|data:|blob:)/i
const IMAGE_EXTENSION_PATTERN = /\.(?:avif|gif|heic|jpeg|jpg|png|svg|webp)$/i
const MARKDOWN_IMAGE_REFERENCE_PATTERN = /!\[([^\]]*)\]\(([^)\n]+)\)/g
const fileUrlCache = new Map<string, Promise<string>>()
const imageDataUrlCache = new Map<string, Promise<string>>()

export interface MarkdownImageOptions {
  documentPath: string
  HTMLAttributes: Record<string, unknown>
}

export interface MarkdownImageAttrs {
  alt?: string | null
  height?: number | null
  src: string
  title?: string | null
  width?: number | null
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    image: {
      setImage: (options: MarkdownImageAttrs) => ReturnType
    }
  }
}

function normalizePath(path: string) {
  return path.replace(/\\/g, '/')
}

export function decodeMarkdownImagePath(path: string) {
  if (!path || REMOTE_IMAGE_PROTOCOL_PATTERN.test(path)) {
    return path
  }

  return normalizePath(path)
    .split('/')
    .map((segment) => {
      if (segment === '' || segment === '.' || segment === '..' || !segment.includes('%')) {
        return segment
      }

      let decoded = segment

      for (let index = 0; index < 6; index += 1) {
        try {
          const nextDecoded = decodeURIComponent(decoded)

          if (nextDecoded === decoded) {
            break
          }

          decoded = nextDecoded
        } catch {
          break
        }
      }

      return decoded
    })
    .join('/')
}

export function encodeMarkdownImagePath(path: string) {
  if (!path || REMOTE_IMAGE_PROTOCOL_PATTERN.test(path)) {
    return path
  }

  return decodeMarkdownImagePath(path)
    .split('/')
    .map((segment) => {
      if (segment === '' || segment === '.' || segment === '..') {
        return segment
      }

      try {
        return encodeURIComponent(decodeURIComponent(segment))
      } catch {
        return encodeURIComponent(segment)
      }
    })
    .join('/')
}

function fileNameFromPath(path: string) {
  const normalized = normalizePath(path)
  const segments = normalized.split('/').filter(Boolean)

  return segments[segments.length - 1] ?? path
}

export function imageFileCandidateFromPath(path: string) {
  return IMAGE_EXTENSION_PATTERN.test(path)
}

export function imageAltTextFromPath(path: string) {
  const fileName = fileNameFromPath(path)
  const extensionIndex = fileName.lastIndexOf('.')

  return extensionIndex <= 0 ? fileName : fileName.slice(0, extensionIndex)
}

function splitMarkdownImageTarget(rawTarget: string) {
  const trimmed = rawTarget.trim()
  const titleMatch = trimmed.match(/^(.*?)(?:\s+["']([^"']+)["'])$/)

  if (!titleMatch) {
    return {
      sourcePath: trimmed,
      title: null as string | null
    }
  }

  return {
    sourcePath: titleMatch[1].trim(),
    title: titleMatch[2] ?? null
  }
}

export function normalizeMarkdownImageReferences(markdown: string) {
  return markdown.replace(MARKDOWN_IMAGE_REFERENCE_PATTERN, (_match, altText: string, rawTarget: string) => {
    const { sourcePath, title } = splitMarkdownImageTarget(rawTarget)

    if (!sourcePath || REMOTE_IMAGE_PROTOCOL_PATTERN.test(sourcePath)) {
      return _match
    }

    if (!IMAGE_EXTENSION_PATTERN.test(sourcePath)) {
      return _match
    }

    const encodedSourcePath = encodeMarkdownImagePath(decodeMarkdownImagePath(sourcePath))

    return title
      ? `![${altText}](${encodedSourcePath} "${title}")`
      : `![${altText}](${encodedSourcePath})`
  })
}

function splitAbsolutePath(path: string) {
  const normalized = normalizePath(path)
  const windowsDriveMatch = normalized.match(/^[A-Za-z]:/)
  const root = windowsDriveMatch ? `${windowsDriveMatch[0]}/` : normalized.startsWith('/') ? '/' : ''
  const withoutRoot = root ? normalized.slice(root.length) : normalized

  return {
    parts: withoutRoot.split('/').filter(Boolean),
    root
  }
}

export function relativeImagePath(fromFilePath: string, toFilePath: string) {
  const fromDirectory = splitAbsolutePath(fromFilePath)
  const toTarget = splitAbsolutePath(toFilePath)

  if (fromDirectory.root !== toTarget.root) {
    return normalizePath(toFilePath)
  }

  const fromParts = fromDirectory.parts.slice(0, -1)
  const toParts = toTarget.parts
  let commonLength = 0

  while (
    commonLength < fromParts.length &&
    commonLength < toParts.length &&
    fromParts[commonLength] === toParts[commonLength]
  ) {
    commonLength += 1
  }

  const upwardSegments = fromParts.slice(commonLength).map(() => '..')
  const downwardSegments = toParts.slice(commonLength)
  const relativePath = [...upwardSegments, ...downwardSegments].join('/')

  return relativePath || fileNameFromPath(toFilePath)
}

function absolutePathFromFileUrl(url: string) {
  try {
    const parsed = new URL(url)

    if (parsed.protocol !== 'file:') {
      return null
    }

    const decodedPath = decodeURIComponent(parsed.pathname)

    return /^\/[A-Za-z]:/.test(decodedPath) ? decodedPath.slice(1) : decodedPath
  } catch {
    return null
  }
}

async function fileUrlForPath(filePath: string) {
  const cached = fileUrlCache.get(filePath)

  if (cached) {
    return cached
  }

  const request = window.collaborator.fileUrl(filePath)
  fileUrlCache.set(filePath, request)

  return request
}

async function imageDataUrlForPath(filePath: string) {
  const cached = imageDataUrlCache.get(filePath)

  if (cached) {
    return cached
  }

  const request = window.collaborator
    .readImageAsset(filePath)
    .then((image) => `data:${image.mimeType};base64,${image.base64}`)

  imageDataUrlCache.set(filePath, request)

  return request
}

async function resolvedImageDisplay(documentPath: string, sourcePath: string) {
  if (!sourcePath || REMOTE_IMAGE_PROTOCOL_PATTERN.test(sourcePath)) {
    return {
      absoluteImagePath: null,
      displayUrl: sourcePath
    }
  }

  try {
    const documentUrl = await fileUrlForPath(documentPath)
    const resolvedFileUrl = new URL(encodeMarkdownImagePath(sourcePath), documentUrl).toString()
    const absoluteImagePath = absolutePathFromFileUrl(resolvedFileUrl)

    if (!absoluteImagePath) {
      return {
        absoluteImagePath: null,
        displayUrl: resolvedFileUrl
      }
    }

    try {
      return {
        absoluteImagePath,
        displayUrl: await imageDataUrlForPath(absoluteImagePath)
      }
    } catch {
      return {
        absoluteImagePath,
        displayUrl: resolvedFileUrl
      }
    }
  } catch {
    return {
      absoluteImagePath: null,
      displayUrl: sourcePath
    }
  }
}

function draggedImagePayload(imagePath: string, altText: string | null) {
  return JSON.stringify({
    fileKind: 'image',
    name: altText?.trim() || fileNameFromPath(imagePath),
    path: imagePath
  } satisfies Pick<FileTreeNode, 'fileKind' | 'name' | 'path'>)
}

export const MarkdownImageExtension = Node.create<MarkdownImageOptions>({
  name: 'image',

  addOptions() {
    return {
      documentPath: '',
      HTMLAttributes: {}
    }
  },

  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      src: {
        default: null
      },
      alt: {
        default: null
      },
      title: {
        default: null
      },
      width: {
        default: null
      },
      height: {
        default: null
      }
    }
  },

  parseHTML() {
    return [
      {
        tag: 'img[src]:not([src^="data:"])'
      }
    ]
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    return ['img', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)]
  },

  parseMarkdown: (token: any, helpers: any) => {
    return helpers.createNode('image', {
      alt: token.text,
      src: decodeMarkdownImagePath(token.href),
      title: token.title
    })
  },

  renderMarkdown: (node: any) => {
    const sourcePath = encodeMarkdownImagePath(node.attrs?.src ?? '')
    const altText = node.attrs?.alt ?? ''
    const title = node.attrs?.title ?? ''

    return title ? `![${altText}](${sourcePath} "${title}")` : `![${altText}](${sourcePath})`
  },

  addNodeView() {
    const documentPath = this.options.documentPath

    return ({ HTMLAttributes, node }: { HTMLAttributes: Record<string, unknown>; node: any }) => {
      const wrapper = document.createElement('figure')
      const image = document.createElement('img')
      let currentSourcePath = String(node.attrs.src ?? '')

      wrapper.className = 'markdown-image-node'
      wrapper.contentEditable = 'false'
      wrapper.draggable = true
      image.className = 'markdown-image-node__image'
      wrapper.append(image)

      function applyDimensions(nextNode: typeof node) {
        const width = nextNode.attrs.width
        const height = nextNode.attrs.height

        image.style.width = typeof width === 'number' ? `${width}px` : ''
        image.style.height = typeof height === 'number' ? `${height}px` : ''
      }

      function applyBaseAttributes(nextNode: typeof node) {
        image.alt = String(nextNode.attrs.alt ?? '')
        image.title = String(nextNode.attrs.title ?? '')
        applyDimensions(nextNode)

        for (const [key, value] of Object.entries(HTMLAttributes)) {
          if (key === 'src' || key === 'alt' || key === 'title' || key === 'width' || key === 'height') {
            continue
          }

          if (value == null) {
            image.removeAttribute(key)
            continue
          }

          image.setAttribute(key, String(value))
        }
      }

      async function refreshImageSource(nextNode: typeof node) {
        const sourcePath = String(nextNode.attrs.src ?? '')
        currentSourcePath = sourcePath
        applyBaseAttributes(nextNode)

        const { absoluteImagePath, displayUrl } = await resolvedImageDisplay(documentPath, sourcePath)

        if (currentSourcePath !== sourcePath) {
          return
        }

        image.src = displayUrl

        if (absoluteImagePath) {
          wrapper.dataset.imagePath = absoluteImagePath
        } else {
          delete wrapper.dataset.imagePath
        }
      }

      wrapper.addEventListener('dragstart', (event) => {
        const imagePath = wrapper.dataset.imagePath

        if (!imagePath || !event.dataTransfer) {
          return
        }

        event.dataTransfer.effectAllowed = 'copy'
        event.dataTransfer.setData(
          COLLABORATOR_FILE_MIME,
          draggedImagePayload(imagePath, image.alt || null)
        )
        event.dataTransfer.setData('text/plain', imagePath)
        event.dataTransfer.setData('text/uri-list', image.src)

        try {
          event.dataTransfer.setDragImage(image, Math.min(image.width, 48), Math.min(image.height, 48))
        } catch {
          // Ignore platforms that don't support setting a custom drag image here.
        }
      })

      void refreshImageSource(node)

      return {
        dom: wrapper,
        update: (updatedNode: any) => {
          if (updatedNode.type !== node.type) {
            return false
          }

          void refreshImageSource(updatedNode)
          return true
        }
      }
    }
  },

  addCommands() {
    return {
      setImage:
        (options: MarkdownImageAttrs) =>
        ({ commands }: { commands: any }) => {
          return commands.insertContent({
            attrs: options,
            type: this.name
          })
        }
    }
  },

  addInputRules() {
    return [
      nodeInputRule({
        find: IMAGE_MARKDOWN_INPUT_REGEX,
        type: this.type,
        getAttributes: (match: string[]) => {
          const [, , altText, sourcePath, title] = match

          return {
            alt: altText,
            src: decodeMarkdownImagePath(sourcePath),
            title
          }
        }
      })
    ]
  }
})
