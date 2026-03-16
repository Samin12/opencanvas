export type EmbedRenderKind = 'iframe' | 'pdf' | 'video'

export interface EmbedDescriptor {
  canonicalUrl: string
  hostLabel: string
  renderKind: EmbedRenderKind
  sourceUrl: string
  title: string
}

const REMOTE_VIDEO_EXTENSION_PATTERN = /\.(?:m4v|mov|mp4|webm)(?:[?#].*)?$/i
const REMOTE_PDF_EXTENSION_PATTERN = /\.pdf(?:[?#].*)?$/i

function titleCaseSegment(value: string) {
  return value
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ')
}

function hostLabel(url: URL) {
  return url.hostname.replace(/^www\./i, '')
}

function normalizeHttpUrl(rawValue: string) {
  const trimmed = rawValue.trim()

  if (!trimmed) {
    return null
  }

  const candidates = trimmed.includes('://') ? [trimmed] : [`https://${trimmed}`]

  for (const candidate of candidates) {
    try {
      const parsed = new URL(candidate)

      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed
      }
    } catch {
      continue
    }
  }

  return null
}

function youtubeVideoId(url: URL) {
  const hostname = url.hostname.replace(/^www\./i, '').toLowerCase()

  if (hostname === 'youtu.be') {
    return url.pathname.split('/').filter(Boolean)[0] ?? null
  }

  if (hostname !== 'youtube.com' && hostname !== 'm.youtube.com') {
    return null
  }

  if (url.pathname === '/watch') {
    return url.searchParams.get('v')
  }

  const segments = url.pathname.split('/').filter(Boolean)

  if (segments[0] === 'shorts' || segments[0] === 'embed' || segments[0] === 'live') {
    return segments[1] ?? null
  }

  return null
}

function vimeoVideoId(url: URL) {
  const hostname = url.hostname.replace(/^www\./i, '').toLowerCase()

  if (hostname !== 'vimeo.com' && hostname !== 'player.vimeo.com') {
    return null
  }

  const match = url.pathname.match(/\/(?:video\/)?(\d+)/)
  return match?.[1] ?? null
}

function loomVideoId(url: URL) {
  const hostname = url.hostname.replace(/^www\./i, '').toLowerCase()

  if (hostname !== 'loom.com') {
    return null
  }

  const match = url.pathname.match(/\/(?:share|embed)\/([a-zA-Z0-9]+)/)
  return match?.[1] ?? null
}

function figmaEmbedUrl(url: URL) {
  const hostname = url.hostname.replace(/^www\./i, '').toLowerCase()

  if (hostname !== 'figma.com') {
    return null
  }

  return `https://www.figma.com/embed?embed_host=open_canvas&url=${encodeURIComponent(url.toString())}`
}

function googleSlidesEmbedUrl(url: URL) {
  const hostname = url.hostname.replace(/^www\./i, '').toLowerCase()

  if (hostname !== 'docs.google.com') {
    return null
  }

  const segments = url.pathname.split('/').filter(Boolean)

  if (segments[0] !== 'presentation') {
    return null
  }

  const embedPath = url.pathname
    .replace(/\/edit(?:\/.*)?$/i, '/embed')
    .replace(/\/present(?:\/.*)?$/i, '/embed')
    .replace(/\/pub(?:\/.*)?$/i, '/embed')

  const nextUrl = new URL(url.toString())
  nextUrl.pathname = embedPath

  if (!/\/embed$/i.test(nextUrl.pathname)) {
    nextUrl.pathname = `${nextUrl.pathname.replace(/\/+$/g, '')}/embed`
  }

  return nextUrl.toString()
}

function powerPointEmbedUrl(url: URL) {
  const hostname = url.hostname.replace(/^www\./i, '').toLowerCase()

  if (
    hostname === 'onedrive.live.com' ||
    hostname === 'view.officeapps.live.com' ||
    hostname.endsWith('.sharepoint.com')
  ) {
    return url.toString()
  }

  return null
}

export function embedDescriptorFromUrl(rawValue: string): EmbedDescriptor | null {
  const parsed = normalizeHttpUrl(rawValue)

  if (!parsed) {
    return null
  }

  const canonicalUrl = parsed.toString()
  const sourceHost = hostLabel(parsed)
  const youtubeId = youtubeVideoId(parsed)

  if (youtubeId) {
    return {
      canonicalUrl,
      hostLabel: sourceHost,
      renderKind: 'iframe',
      sourceUrl: `https://www.youtube.com/embed/${youtubeId}`,
      title: 'YouTube'
    }
  }

  const vimeoId = vimeoVideoId(parsed)

  if (vimeoId) {
    return {
      canonicalUrl,
      hostLabel: sourceHost,
      renderKind: 'iframe',
      sourceUrl: `https://player.vimeo.com/video/${vimeoId}`,
      title: 'Vimeo'
    }
  }

  const loomId = loomVideoId(parsed)

  if (loomId) {
    return {
      canonicalUrl,
      hostLabel: sourceHost,
      renderKind: 'iframe',
      sourceUrl: `https://www.loom.com/embed/${loomId}`,
      title: 'Loom'
    }
  }

  const figmaUrl = figmaEmbedUrl(parsed)

  if (figmaUrl) {
    return {
      canonicalUrl,
      hostLabel: sourceHost,
      renderKind: 'iframe',
      sourceUrl: figmaUrl,
      title: 'Figma'
    }
  }

  const slidesUrl = googleSlidesEmbedUrl(parsed)

  if (slidesUrl) {
    return {
      canonicalUrl,
      hostLabel: 'docs.google.com',
      renderKind: 'iframe',
      sourceUrl: slidesUrl,
      title: 'Google Slides'
    }
  }

  const powerPointUrl = powerPointEmbedUrl(parsed)

  if (powerPointUrl) {
    return {
      canonicalUrl,
      hostLabel: sourceHost,
      renderKind: 'iframe',
      sourceUrl: powerPointUrl,
      title: 'PowerPoint'
    }
  }

  if (REMOTE_VIDEO_EXTENSION_PATTERN.test(parsed.pathname)) {
    return {
      canonicalUrl,
      hostLabel: sourceHost,
      renderKind: 'video',
      sourceUrl: canonicalUrl,
      title: 'Video'
    }
  }

  if (REMOTE_PDF_EXTENSION_PATTERN.test(parsed.pathname)) {
    return {
      canonicalUrl,
      hostLabel: sourceHost,
      renderKind: 'pdf',
      sourceUrl: canonicalUrl,
      title: 'PDF'
    }
  }

  return {
    canonicalUrl,
    hostLabel: sourceHost,
    renderKind: 'iframe',
    sourceUrl: canonicalUrl,
    title: titleCaseSegment(sourceHost.replace(/\.[a-z0-9-]+$/i, '')) || 'Embed'
  }
}

export function extractDroppedUrl(dataTransfer: DataTransfer | null) {
  if (!dataTransfer) {
    return null
  }

  const uriList = dataTransfer.getData('text/uri-list').trim()

  if (uriList) {
    const firstUrl = uriList
      .split('\n')
      .map((entry) => entry.trim())
      .find((entry) => entry.length > 0 && !entry.startsWith('#'))

    if (firstUrl) {
      return embedDescriptorFromUrl(firstUrl)
    }
  }

  const text = dataTransfer.getData('text/plain').trim()

  return text ? embedDescriptorFromUrl(text) : null
}

export function extractPastedUrl(clipboardData: DataTransfer | null) {
  if (!clipboardData) {
    return null
  }

  const rawUrl = clipboardData.getData('text/uri-list') || clipboardData.getData('text/plain')
  return rawUrl ? embedDescriptorFromUrl(rawUrl) : null
}
