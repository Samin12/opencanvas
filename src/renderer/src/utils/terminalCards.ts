import type { TerminalActivityItem } from '@shared/types'

function sanitizeBaseName(value: string, fallback: string): string {
  const normalized = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return normalized.length > 0 ? normalized.slice(0, 72) : fallback
}

function firstMeaningfulLine(value: string): string | null {
  for (const line of value.split('\n')) {
    const trimmed = line.trim().replace(/^[-*#>\d.\s]+/, '').trim()

    if (trimmed.length > 0) {
      return trimmed
    }
  }

  return null
}

function formatSourceFooter(sourceLabel: string) {
  return ['---', `Source: Claude session ${sourceLabel}`].join('\n')
}

function looksStructuredBlock(value: string): boolean {
  const trimmed = value.trim()

  return (
    trimmed.includes('\n') ||
    /^diff\b/im.test(trimmed) ||
    /^(Read|Write|Update|Exit code)\b/m.test(trimmed) ||
    trimmed.includes('<task-notification>')
  )
}

export function createActivityCardPayload(activity: TerminalActivityItem, sourceLabel: string): {
  baseName: string
  content: string
} {
  const title = firstMeaningfulLine(activity.title) ?? 'Claude Card'
  const body = activity.body.trim().length > 0 ? activity.body.trim() : activity.rawText.trim()

  return {
    baseName: sanitizeBaseName(title, 'Claude Card'),
    content: [`# ${title}`, '', body, '', formatSourceFooter(sourceLabel)].join('\n')
  }
}

export function createSelectionCardPayload(selectionText: string, sourceLabel: string): {
  baseName: string
  content: string
} {
  const title = firstMeaningfulLine(selectionText) ?? 'Claude Excerpt'
  const body = looksStructuredBlock(selectionText)
    ? ['```text', selectionText.trimEnd(), '```'].join('\n')
    : selectionText.trim()

  return {
    baseName: sanitizeBaseName(title, 'Claude Excerpt'),
    content: [`# ${title}`, '', body, '', formatSourceFooter(sourceLabel)].join('\n')
  }
}
