function looksAbsolutePath(value: string) {
  return /^\/|^[A-Za-z]:[\\/]/.test(value)
}

export interface ExternalDownloadDescriptor {
  fileName?: string
  mimeType?: string | null
  url: string
}

function decodeFileUrl(value: string) {
  try {
    const parsed = new URL(value)

    if (parsed.protocol !== 'file:') {
      return null
    }

    const nextPath = decodeURIComponent(parsed.pathname)

    if (looksAbsolutePath(nextPath)) {
      return nextPath
    }

    return null
  } catch {
    return null
  }
}

function pathFromFileLike(file: File | null | undefined) {
  const candidate = (file as File & { path?: string } | null | undefined)?.path
  return typeof candidate === 'string' && looksAbsolutePath(candidate) ? candidate : null
}

function parseDownloadUrlValue(rawValue: string): ExternalDownloadDescriptor | null {
  const trimmed = rawValue.trim()

  if (!trimmed) {
    return null
  }

  const firstSeparatorIndex = trimmed.indexOf(':')
  const secondSeparatorIndex =
    firstSeparatorIndex >= 0 ? trimmed.indexOf(':', firstSeparatorIndex + 1) : -1

  if (firstSeparatorIndex <= 0 || secondSeparatorIndex <= firstSeparatorIndex) {
    return null
  }

  const mimeType = trimmed.slice(0, firstSeparatorIndex).trim() || null
  const fileName = trimmed.slice(firstSeparatorIndex + 1, secondSeparatorIndex).trim()
  const url = trimmed.slice(secondSeparatorIndex + 1).trim()

  if (!url) {
    return null
  }

  try {
    const parsed = new URL(url)

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }

    return {
      fileName: fileName || undefined,
      mimeType,
      url: parsed.toString()
    }
  } catch {
    return null
  }
}

export function externalPathsFromDataTransfer(dataTransfer: DataTransfer | null) {
  if (!dataTransfer) {
    return []
  }

  const directPaths = Array.from(dataTransfer.files ?? [])
    .map((file) => pathFromFileLike(file))
    .filter((path): path is string => Boolean(path))

  if (directPaths.length > 0) {
    return Array.from(new Set(directPaths))
  }

  const itemPaths = Array.from(dataTransfer.items ?? [])
    .map((item) => pathFromFileLike(item.getAsFile()))
    .filter((path): path is string => Boolean(path))

  if (itemPaths.length > 0) {
    return Array.from(new Set(itemPaths))
  }

  const uriList = dataTransfer.getData('text/uri-list')

  if (!uriList) {
    return []
  }

  return Array.from(
    new Set(
      uriList
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#'))
        .map((line) => decodeFileUrl(line))
        .filter((path): path is string => Boolean(path))
    )
  )
}

export function externalDownloadFromDataTransfer(
  dataTransfer: DataTransfer | null
): ExternalDownloadDescriptor | null {
  if (!dataTransfer) {
    return null
  }

  const directDownloadUrl = dataTransfer.getData('DownloadURL')

  if (directDownloadUrl) {
    return parseDownloadUrlValue(directDownloadUrl)
  }

  const publicUrl = dataTransfer.getData('public.url')
  const publicUrlName = dataTransfer.getData('public.url-name')

  if (publicUrl && publicUrlName.trim()) {
    try {
      const parsed = new URL(publicUrl)

      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return {
          fileName: publicUrlName?.trim() || undefined,
          mimeType: null,
          url: parsed.toString()
        }
      }
    } catch {
      return null
    }
  }

  return null
}

export function hasExternalPathPayload(dataTransfer: DataTransfer | null) {
  if (!dataTransfer) {
    return false
  }

  if (externalPathsFromDataTransfer(dataTransfer).length > 0) {
    return true
  }

  if (externalDownloadFromDataTransfer(dataTransfer)) {
    return true
  }

  const transferTypes = Array.from(dataTransfer.types ?? [])

  if (
    transferTypes.includes('DownloadURL') ||
    transferTypes.includes('Files') ||
    transferTypes.includes('public.file-url') ||
    transferTypes.includes('text/uri-list')
  ) {
    return true
  }

  return Array.from(dataTransfer.items ?? []).some((item) => item.kind === 'file')
}
