import * as electron from 'electron'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'

import type { CanvasDiagramQueueIndex, EnsureWorkspaceDiagramToolsResult } from '../shared/types'

const { app } = electron

const WORKSPACE_METADATA_DIRECTORY = '.claude-canvas'
const DIAGRAM_INBOX_DIRECTORY = 'diagram-inbox'
const DIAGRAM_REQUESTS_DIRECTORY = 'requests'
const DIAGRAM_ARCHIVE_DIRECTORY = 'archive'
const DIAGRAM_FAILED_DIRECTORY = 'failed'
const DIAGRAM_TOOLS_DIRECTORY = 'tools'
const DIAGRAM_COMMAND_PATH = join('.claude', 'commands', 'canvas-diagrams.md')
const CLAUDE_FILE_PATH = 'CLAUDE.md'
const CLAUDE_MARKER_START = '<!-- OPEN_CANVAS_DIAGRAMS:START -->'
const CLAUDE_MARKER_END = '<!-- OPEN_CANVAS_DIAGRAMS:END -->'
const SKILL_ROOT_SEGMENTS = ['.codex', 'skills', 'open-canvas-diagrams']
const DEFAULT_QUEUE_INDEX: CanvasDiagramQueueIndex = {
  version: 1,
  pending: [],
  processed: [],
  failed: []
}

async function pathExists(targetPath: string) {
  try {
    await stat(targetPath)
    return true
  } catch {
    return false
  }
}

function skillRootCandidates() {
  const candidates = [
    join(process.resourcesPath, ...SKILL_ROOT_SEGMENTS),
    join(app.getAppPath(), ...SKILL_ROOT_SEGMENTS),
    join(process.cwd(), ...SKILL_ROOT_SEGMENTS)
  ]

  if (process.env.ELECTRON_RENDERER_URL) {
    candidates.unshift(join(process.cwd(), ...SKILL_ROOT_SEGMENTS))
    candidates.unshift(join(app.getAppPath(), ...SKILL_ROOT_SEGMENTS))
  }

  return Array.from(new Set(candidates))
}

async function readBundledSkillFile(...segments: string[]) {
  for (const rootPath of skillRootCandidates()) {
    const targetPath = join(rootPath, ...segments)

    if (!(await pathExists(targetPath))) {
      continue
    }

    return readFile(targetPath, 'utf8')
  }

  throw new Error('Open Canvas diagram skill assets could not be located.')
}

function normalizeQueueIndex(input: unknown): CanvasDiagramQueueIndex {
  if (!input || typeof input !== 'object') {
    return DEFAULT_QUEUE_INDEX
  }

  const value = input as Partial<CanvasDiagramQueueIndex>

  return {
    version: 1,
    pending: Array.isArray(value.pending)
      ? value.pending.filter(
          (entry): entry is CanvasDiagramQueueIndex['pending'][number] =>
            Boolean(
              entry &&
                typeof entry === 'object' &&
                typeof entry.requestId === 'string' &&
                typeof entry.file === 'string' &&
                typeof entry.promptSummary === 'string' &&
                typeof entry.createdAt === 'string'
            )
        )
      : [],
    processed: Array.isArray(value.processed)
      ? value.processed.filter((entry): entry is string => typeof entry === 'string')
      : [],
    failed: Array.isArray(value.failed)
      ? value.failed.filter(
          (entry): entry is CanvasDiagramQueueIndex['failed'][number] =>
            Boolean(
              entry &&
                typeof entry === 'object' &&
                typeof entry.requestId === 'string' &&
                typeof entry.file === 'string' &&
                typeof entry.error === 'string' &&
                typeof entry.failedAt === 'string'
            )
        )
      : []
  }
}

async function ensureDirectory(targetPath: string): Promise<void> {
  await mkdir(targetPath, { recursive: true })
}

async function ensureFile(targetPath: string, content: string): Promise<void> {
  await mkdir(dirname(targetPath), { recursive: true })
  await writeFile(targetPath, content, 'utf8')
}

function mergeManagedClaudeSection(existingContent: string, managedSection: string) {
  const wrappedSection = `${CLAUDE_MARKER_START}\n${managedSection.trim()}\n${CLAUDE_MARKER_END}`

  if (!existingContent.trim()) {
    return `${wrappedSection}\n`
  }

  const startIndex = existingContent.indexOf(CLAUDE_MARKER_START)
  const endIndex = existingContent.indexOf(CLAUDE_MARKER_END)

  if (startIndex >= 0 && endIndex > startIndex) {
    const before = existingContent.slice(0, startIndex).trimEnd()
    const after = existingContent.slice(endIndex + CLAUDE_MARKER_END.length).trimStart()

    return [before, wrappedSection, after].filter(Boolean).join('\n\n').trimEnd() + '\n'
  }

  return `${existingContent.trimEnd()}\n\n${wrappedSection}\n`
}

function renderTemplate(
  template: string,
  variables: Record<string, string>
): string {
  return Object.entries(variables).reduce(
    (content, [key, value]) => content.replaceAll(`{{${key}}}`, value),
    template
  )
}

export async function ensureWorkspaceDiagramTools(
  workspacePath: string
): Promise<EnsureWorkspaceDiagramToolsResult> {
  const resolvedWorkspacePath = resolve(workspacePath)

  if (!resolvedWorkspacePath || !isAbsolute(resolvedWorkspacePath)) {
    throw new Error('The workspace path is invalid.')
  }

  const metadataDirectoryPath = join(resolvedWorkspacePath, WORKSPACE_METADATA_DIRECTORY)
  const inboxDirectoryPath = join(metadataDirectoryPath, DIAGRAM_INBOX_DIRECTORY)
  const requestsDirectoryPath = join(inboxDirectoryPath, DIAGRAM_REQUESTS_DIRECTORY)
  const archiveDirectoryPath = join(inboxDirectoryPath, DIAGRAM_ARCHIVE_DIRECTORY)
  const failedDirectoryPath = join(inboxDirectoryPath, DIAGRAM_FAILED_DIRECTORY)
  const toolsDirectoryPath = join(metadataDirectoryPath, DIAGRAM_TOOLS_DIRECTORY)
  const queueIndexPath = join(inboxDirectoryPath, 'index.json')
  const commandPath = join(resolvedWorkspacePath, DIAGRAM_COMMAND_PATH)
  const claudePath = join(resolvedWorkspacePath, CLAUDE_FILE_PATH)
  const emitterScriptPath = join(toolsDirectoryPath, 'emit_diagram_request.py')
  const schemaPath = join(toolsDirectoryPath, 'diagram-schema.md')

  await Promise.all([
    ensureDirectory(join(resolvedWorkspacePath, '.claude', 'commands')),
    ensureDirectory(requestsDirectoryPath),
    ensureDirectory(archiveDirectoryPath),
    ensureDirectory(failedDirectoryPath),
    ensureDirectory(toolsDirectoryPath)
  ])

  const [commandTemplate, claudeTemplate, emitterScript, diagramSchema] = await Promise.all([
    readBundledSkillFile('workspace-templates', 'canvas-diagrams-command.md'),
    readBundledSkillFile('workspace-templates', 'claude-md-section.md'),
    readBundledSkillFile('scripts', 'emit_diagram_request.py'),
    readBundledSkillFile('references', 'diagram-schema.md')
  ])

  const templateVariables = {
    EMITTER_PATH: '.claude-canvas/tools/emit_diagram_request.py',
    SCHEMA_PATH: '.claude-canvas/tools/diagram-schema.md',
    REQUESTS_PATH: '.claude-canvas/diagram-inbox/requests',
    QUEUE_INDEX_PATH: '.claude-canvas/diagram-inbox/index.json'
  }

  await Promise.all([
    ensureFile(commandPath, renderTemplate(commandTemplate, templateVariables)),
    ensureFile(emitterScriptPath, emitterScript),
    ensureFile(schemaPath, diagramSchema)
  ])

  const existingClaudeContent = (await pathExists(claudePath)) ? await readFile(claudePath, 'utf8') : ''
  await ensureFile(claudePath, mergeManagedClaudeSection(existingClaudeContent, renderTemplate(claudeTemplate, templateVariables)))

  let existingQueueIndex = DEFAULT_QUEUE_INDEX

  if (await pathExists(queueIndexPath)) {
    try {
      existingQueueIndex = normalizeQueueIndex(JSON.parse(await readFile(queueIndexPath, 'utf8')))
    } catch {
      existingQueueIndex = DEFAULT_QUEUE_INDEX
    }
  }

  await ensureFile(queueIndexPath, `${JSON.stringify(existingQueueIndex, null, 2)}\n`)

  return {
    commandPath,
    claudePath,
    queueIndexPath
  }
}
