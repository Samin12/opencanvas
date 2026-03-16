import type { TerminalActivityItem } from '@shared/types'

export const COLLABORATOR_TERMINAL_CARD_MIME = 'application/x-collaborator-terminal-card'

const ANSI_SEQUENCE_PATTERN =
  /\u001B(?:\][^\u0007]*(?:\u0007|\u001B\\)|P[\s\S]*?\u001B\\|[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g

export interface TerminalCardTransferPayload {
  baseName?: string
  content: string
  targetDirectoryPath?: string
}

type MarkdownBlock =
  | { kind: 'bullet'; label?: string; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string }

function sanitizeBaseName(value: string, fallback: string): string {
  const normalized = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return normalized.length > 0 ? normalized.slice(0, 72) : fallback
}

function firstMeaningfulLine(value: string): string | null {
  for (const line of cleanTerminalCardText(value).split('\n')) {
    const trimmed = line.trim().replace(/^[-*#>\d.\s]+/, '').trim()

    if (trimmed.length > 0) {
      return trimmed
    }
  }

  return null
}

function normalizeInlineWhitespace(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim()
}

function cleanTerminalCardText(value: string): string {
  const cleanedLines = value
    .replace(/\u001B\[(\d*)C/g, (_match, rawCount: string) =>
      ' '.repeat(Math.max(1, Number.parseInt(rawCount || '1', 10) || 1))
    )
    .replace(ANSI_SEQUENCE_PATTERN, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+$/g, ''))
    .filter((line) => {
      const trimmed = line.trim()
      const compact = trimmed.replace(/\s+/g, ' ')

      if (trimmed.length === 0) {
        return true
      }

      return !(
        /^[▐▛▜▝▘]+/u.test(trimmed) ||
        /^claude code v/i.test(compact) ||
        /^opus\b/i.test(compact) ||
        /^[/?] for shortcuts/i.test(compact) ||
        /^source:\s*claude session/i.test(compact)
      )
    })

  return cleanedLines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function normalizeComparableText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[—–]/g, '-')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function collapseWrappedFragments(fragments: string[]): string {
  return fragments
    .map((fragment) => normalizeInlineWhitespace(fragment))
    .filter((fragment) => fragment.length > 0)
    .join(' ')
    .replace(/\s+([,.;:!?])/g, '$1')
}

function looksStructuredBlock(value: string): boolean {
  const trimmed = value.trim()

  return (
    /^```/m.test(trimmed) ||
    /^diff\b/im.test(trimmed) ||
    /^(Read|Write|Update|Exit code)\b/m.test(trimmed) ||
    /<\/?(task-notification|tool-use|output-file|status|summary)>/i.test(trimmed) ||
    /^[|╭╰│─━]{3,}/m.test(trimmed)
  )
}

function nextNonEmptyLine(lines: string[], startIndex: number): string | null {
  for (let index = startIndex; index < lines.length; index += 1) {
    const candidate = normalizeInlineWhitespace(lines[index] ?? '')

    if (candidate.length > 0) {
      return candidate
    }
  }

  return null
}

function buildReadableBlocks(value: string, title: string): MarkdownBlock[] {
  const lines = cleanTerminalCardText(value).split('\n')
  const blocks: MarkdownBlock[] = []
  let paragraphParts: string[] = []
  let activeBullet: { label?: string; parts: string[] } | null = null

  function flushParagraph() {
    if (paragraphParts.length === 0) {
      return
    }

    const text = collapseWrappedFragments(paragraphParts)
    paragraphParts = []

    if (text.length > 0) {
      blocks.push({ kind: 'paragraph', text })
    }
  }

  function flushBullet() {
    if (!activeBullet) {
      return
    }

    const text = collapseWrappedFragments(activeBullet.parts)

    if (text.length > 0) {
      blocks.push({
        kind: 'bullet',
        label: activeBullet.label,
        text
      })
    }

    activeBullet = null
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = normalizeInlineWhitespace(lines[index] ?? '')

    if (line.length === 0) {
      flushBullet()
      flushParagraph()
      continue
    }

    const nextLine = nextNonEmptyLine(lines, index + 1)
    const bulletMatch = line.match(/^([-*+]|\d+\.)\s+(.+)$/)
    const sectionMatch = line.match(/^([A-Za-z][A-Za-z0-9&/ +'()-]{1,48})\s+[—-]\s+(.+)$/)
    const headingLike =
      !bulletMatch &&
      !sectionMatch &&
      line.length <= 56 &&
      /^[A-Z][A-Za-z0-9&/ +'()-]*$/.test(line) &&
      Boolean(nextLine?.match(/^([-*+]|\d+\.)\s+/))
    const colonHeading =
      !bulletMatch &&
      !sectionMatch &&
      line.length <= 88 &&
      /^[A-Z][^:]{0,86}:$/.test(line)

    if (headingLike || colonHeading) {
      flushBullet()
      flushParagraph()

      const headingText = line.endsWith(':') ? line.slice(0, -1).trim() : line

      if (normalizeComparableText(headingText) !== normalizeComparableText(title)) {
        blocks.push({ kind: 'heading', text: headingText })
      }

      continue
    }

    if (sectionMatch) {
      flushBullet()
      flushParagraph()
      activeBullet = {
        label: sectionMatch[1].trim(),
        parts: [sectionMatch[2].trim()]
      }
      continue
    }

    if (bulletMatch) {
      flushBullet()
      flushParagraph()
      activeBullet = {
        parts: [bulletMatch[2].trim()]
      }
      continue
    }

    if (activeBullet) {
      activeBullet.parts.push(line)
      continue
    }

    paragraphParts.push(line)
  }

  flushBullet()
  flushParagraph()

  if (
    blocks[0]?.kind === 'paragraph' &&
    normalizeComparableText(blocks[0].text) === normalizeComparableText(title)
  ) {
    blocks.shift()
  }

  return blocks
}

function readableMarkdownBody(value: string, title: string): string {
  const blocks = buildReadableBlocks(value, title)

  if (blocks.length === 0) {
    return normalizeInlineWhitespace(value)
  }

  const output: string[] = []

  for (const block of blocks) {
    const previous = output.at(-1)

    if (previous && previous !== '') {
      output.push('')
    }

    if (block.kind === 'heading') {
      output.push(`### ${block.text}`)
      continue
    }

    if (block.kind === 'bullet') {
      output.push(block.label ? `- **${block.label}**: ${block.text}` : `- ${block.text}`)
      continue
    }

    output.push(block.text)
  }

  return output.join('\n').trim()
}

function markdownBodyFromTerminalText(value: string, title: string): string {
  const cleanedValue = cleanTerminalCardText(value)

  if (looksStructuredBlock(cleanedValue)) {
    return ['```text', cleanedValue.trimEnd(), '```'].join('\n')
  }

  return readableMarkdownBody(cleanedValue, title)
}

function buildCardMarkdown(title: string, body: string): string {
  return [`## ${title}`, '', body].join('\n')
}

export function createActivityCardPayload(activity: TerminalActivityItem): {
  baseName: string
  content: string
} {
  const title = firstMeaningfulLine(activity.title) ?? 'Claude Card'
  const rawBody = activity.body.trim().length > 0 ? activity.body.trim() : activity.rawText.trim()
  const body = markdownBodyFromTerminalText(rawBody, title)

  return {
    baseName: sanitizeBaseName(title, 'Claude Card'),
    content: buildCardMarkdown(title, body)
  }
}

export function createSelectionCardPayload(selectionText: string): {
  baseName: string
  content: string
} {
  const title = firstMeaningfulLine(selectionText) ?? 'Claude Excerpt'
  const body = markdownBodyFromTerminalText(selectionText.trim(), title)

  return {
    baseName: sanitizeBaseName(title, 'Claude Excerpt'),
    content: buildCardMarkdown(title, body)
  }
}
