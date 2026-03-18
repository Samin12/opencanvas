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
const NOTE_COMMAND_PATH = join('.claude', 'commands', 'canvas-note.md')
const CLAUDE_FILE_PATH = 'CLAUDE.md'
const AGENTS_FILE_PATH = 'AGENTS.md'
const DIAGRAM_CLAUDE_MARKER_START = '<!-- OPEN_CANVAS_DIAGRAMS:START -->'
const DIAGRAM_CLAUDE_MARKER_END = '<!-- OPEN_CANVAS_DIAGRAMS:END -->'
const NOTE_CLAUDE_MARKER_START = '<!-- OPEN_CANVAS_NOTES:START -->'
const NOTE_CLAUDE_MARKER_END = '<!-- OPEN_CANVAS_NOTES:END -->'
const NOTE_AGENTS_MARKER_START = '<!-- OPEN_CANVAS_NOTES_FOR_CODEX:START -->'
const NOTE_AGENTS_MARKER_END = '<!-- OPEN_CANVAS_NOTES_FOR_CODEX:END -->'
const DIAGRAM_SKILL_ROOT_SEGMENTS = ['.codex', 'skills', 'open-canvas-diagrams']
const NOTE_SKILL_ROOT_SEGMENTS = ['.codex', 'skills', 'open-canvas-workspace']
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

function skillRootCandidates(skillRootSegments: string[]) {
  const candidates = [
    join(process.resourcesPath, ...skillRootSegments),
    join(app.getAppPath(), ...skillRootSegments),
    join(process.cwd(), ...skillRootSegments)
  ]

  if (process.env.ELECTRON_RENDERER_URL) {
    candidates.unshift(join(process.cwd(), ...skillRootSegments))
    candidates.unshift(join(app.getAppPath(), ...skillRootSegments))
  }

  return Array.from(new Set(candidates))
}

async function readBundledSkillFile(skillRootSegments: string[], ...segments: string[]) {
  for (const rootPath of skillRootCandidates(skillRootSegments)) {
    const targetPath = join(rootPath, ...segments)

    if (!(await pathExists(targetPath))) {
      continue
    }

    return readFile(targetPath, 'utf8')
  }

  throw new Error(`Open Canvas skill assets could not be located: ${skillRootSegments.join('/')}`)
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

function mergeManagedSection(
  existingContent: string,
  managedSection: string,
  markerStart: string,
  markerEnd: string
) {
  const wrappedSection = `${markerStart}\n${managedSection.trim()}\n${markerEnd}`

  if (!existingContent.trim()) {
    return `${wrappedSection}\n`
  }

  const startIndex = existingContent.indexOf(markerStart)
  const endIndex = existingContent.indexOf(markerEnd)

  if (startIndex >= 0 && endIndex > startIndex) {
    const before = existingContent.slice(0, startIndex).trimEnd()
    const after = existingContent.slice(endIndex + markerEnd.length).trimStart()

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
  const noteCommandPath = join(resolvedWorkspacePath, NOTE_COMMAND_PATH)
  const claudePath = join(resolvedWorkspacePath, CLAUDE_FILE_PATH)
  const agentsPath = join(resolvedWorkspacePath, AGENTS_FILE_PATH)
  const emitterScriptPath = join(toolsDirectoryPath, 'emit_diagram_request.py')
  const schemaPath = join(toolsDirectoryPath, 'diagram-schema.md')
  const workspaceSkillDirectoryPath = join(
    resolvedWorkspacePath,
    '.codex',
    'skills',
    'open-canvas-workspace'
  )
  const workspaceSkillAgentsDirectoryPath = join(workspaceSkillDirectoryPath, 'agents')
  const workspaceSkillPath = join(workspaceSkillDirectoryPath, 'SKILL.md')
  const workspaceSkillOpenAiPath = join(workspaceSkillAgentsDirectoryPath, 'openai.yaml')

  await Promise.all([
    ensureDirectory(join(resolvedWorkspacePath, '.claude', 'commands')),
    ensureDirectory(requestsDirectoryPath),
    ensureDirectory(archiveDirectoryPath),
    ensureDirectory(failedDirectoryPath),
    ensureDirectory(toolsDirectoryPath),
    ensureDirectory(workspaceSkillAgentsDirectoryPath)
  ])

  const [
    commandTemplate,
    claudeTemplate,
    emitterScript,
    diagramSchema,
    noteCommandTemplate,
    noteClaudeTemplate,
    noteAgentsTemplate,
    noteSkillTemplate,
    noteSkillOpenAi
  ] = await Promise.all([
    readBundledSkillFile(DIAGRAM_SKILL_ROOT_SEGMENTS, 'workspace-templates', 'canvas-diagrams-command.md'),
    readBundledSkillFile(DIAGRAM_SKILL_ROOT_SEGMENTS, 'workspace-templates', 'claude-md-section.md'),
    readBundledSkillFile(DIAGRAM_SKILL_ROOT_SEGMENTS, 'scripts', 'emit_diagram_request.py'),
    readBundledSkillFile(DIAGRAM_SKILL_ROOT_SEGMENTS, 'references', 'diagram-schema.md'),
    readBundledSkillFile(NOTE_SKILL_ROOT_SEGMENTS, 'workspace-templates', 'canvas-note-command.md'),
    readBundledSkillFile(NOTE_SKILL_ROOT_SEGMENTS, 'workspace-templates', 'claude-md-section.md'),
    readBundledSkillFile(NOTE_SKILL_ROOT_SEGMENTS, 'workspace-templates', 'agents-md-section.md'),
    readBundledSkillFile(NOTE_SKILL_ROOT_SEGMENTS, 'SKILL.md'),
    readBundledSkillFile(NOTE_SKILL_ROOT_SEGMENTS, 'agents', 'openai.yaml')
  ])

  const diagramTemplateVariables = {
    EMITTER_PATH: '.claude-canvas/tools/emit_diagram_request.py',
    SCHEMA_PATH: '.claude-canvas/tools/diagram-schema.md',
    REQUESTS_PATH: '.claude-canvas/diagram-inbox/requests',
    QUEUE_INDEX_PATH: '.claude-canvas/diagram-inbox/index.json'
  }
  const noteTemplateVariables = {
    CLI_COMMAND: 'open-canvas-cli',
    NOTE_COMMAND_PATH: '.claude/commands/canvas-note.md'
  }

  await Promise.all([
    ensureFile(commandPath, renderTemplate(commandTemplate, diagramTemplateVariables)),
    ensureFile(emitterScriptPath, emitterScript),
    ensureFile(schemaPath, diagramSchema),
    ensureFile(noteCommandPath, renderTemplate(noteCommandTemplate, noteTemplateVariables)),
    ensureFile(workspaceSkillPath, renderTemplate(noteSkillTemplate, noteTemplateVariables)),
    ensureFile(workspaceSkillOpenAiPath, noteSkillOpenAi)
  ])

  const existingClaudeContent = (await pathExists(claudePath)) ? await readFile(claudePath, 'utf8') : ''
  const nextClaudeContent = mergeManagedSection(
    mergeManagedSection(
      existingClaudeContent,
      renderTemplate(claudeTemplate, diagramTemplateVariables),
      DIAGRAM_CLAUDE_MARKER_START,
      DIAGRAM_CLAUDE_MARKER_END
    ),
    renderTemplate(noteClaudeTemplate, noteTemplateVariables),
    NOTE_CLAUDE_MARKER_START,
    NOTE_CLAUDE_MARKER_END
  )
  await ensureFile(claudePath, nextClaudeContent)

  const existingAgentsContent = (await pathExists(agentsPath)) ? await readFile(agentsPath, 'utf8') : ''
  const nextAgentsContent = mergeManagedSection(
    existingAgentsContent,
    renderTemplate(noteAgentsTemplate, noteTemplateVariables),
    NOTE_AGENTS_MARKER_START,
    NOTE_AGENTS_MARKER_END
  )
  await ensureFile(agentsPath, nextAgentsContent)

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
