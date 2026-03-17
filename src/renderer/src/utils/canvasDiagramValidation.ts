import type {
  CanvasDiagramEdge,
  CanvasDiagramEnvelope,
  CanvasDiagramKind,
  CanvasDiagramNode,
  CanvasDiagramNodeKind,
  CanvasDiagramQueueFailureEntry,
  CanvasDiagramQueueIndex,
  CanvasDiagramQueueIndexEntry,
  CanvasDiagramSpec
} from '@shared/types'

export const MAX_DIAGRAMS_PER_REQUEST = 6
export const MAX_NODES_PER_DIAGRAM = 40
export const MAX_EDGES_PER_DIAGRAM = 80
export const MAX_LABEL_LENGTH = 140

const DIAGRAM_KINDS = new Set<CanvasDiagramKind>([
  'flowchart',
  'system-architecture',
  'mind-map',
  'sequence',
  'org-chart',
  'timeline'
])
const NODE_KINDS = new Set<CanvasDiagramNodeKind>([
  'process',
  'decision',
  'data',
  'actor',
  'service',
  'database',
  'document',
  'container',
  'note',
  'event'
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function validateNode(node: unknown, diagramTitle: string): string | null {
  if (!isRecord(node)) {
    return `Diagram "${diagramTitle}" contains a node that is not an object.`
  }

  if (!isString(node.id) || node.id.trim().length === 0) {
    return `Diagram "${diagramTitle}" contains a node with a missing id.`
  }

  if (!isString(node.label) || node.label.trim().length === 0) {
    return `Diagram "${diagramTitle}" contains a node with a missing label.`
  }

  if (node.label.length > MAX_LABEL_LENGTH) {
    return `Diagram "${diagramTitle}" has a node label longer than ${MAX_LABEL_LENGTH} characters.`
  }

  if (!isString(node.kind) || !NODE_KINDS.has(node.kind as CanvasDiagramNodeKind)) {
    return `Diagram "${diagramTitle}" contains an unsupported node kind.`
  }

  return null
}

function validateEdge(
  edge: unknown,
  diagramTitle: string,
  nodeIds: Set<string>
): string | null {
  if (!isRecord(edge)) {
    return `Diagram "${diagramTitle}" contains an edge that is not an object.`
  }

  if (!isString(edge.id) || edge.id.trim().length === 0) {
    return `Diagram "${diagramTitle}" contains an edge with a missing id.`
  }

  if (!isString(edge.from) || !nodeIds.has(edge.from)) {
    return `Diagram "${diagramTitle}" contains an edge with an unknown source node.`
  }

  if (!isString(edge.to) || !nodeIds.has(edge.to)) {
    return `Diagram "${diagramTitle}" contains an edge with an unknown target node.`
  }

  if (edge.label !== undefined && (!isString(edge.label) || edge.label.length > MAX_LABEL_LENGTH)) {
    return `Diagram "${diagramTitle}" contains an edge label that is invalid.`
  }

  return null
}

function validateDiagram(diagram: unknown): { error?: string; value?: CanvasDiagramSpec } {
  if (!isRecord(diagram)) {
    return { error: 'A diagram entry is not an object.' }
  }

  if (!isString(diagram.id) || diagram.id.trim().length === 0) {
    return { error: 'A diagram is missing its id.' }
  }

  if (!isString(diagram.title) || diagram.title.trim().length === 0) {
    return { error: 'A diagram is missing its title.' }
  }

  const diagramTitle = diagram.title

  if (!isString(diagram.kind) || !DIAGRAM_KINDS.has(diagram.kind as CanvasDiagramKind)) {
    return { error: `Diagram "${diagram.title ?? diagram.id}" uses an unsupported kind.` }
  }

  if (!Array.isArray(diagram.nodes) || diagram.nodes.length === 0) {
    return { error: `Diagram "${diagram.title}" must include at least one node.` }
  }

  if (diagram.nodes.length > MAX_NODES_PER_DIAGRAM) {
    return { error: `Diagram "${diagram.title}" exceeds the ${MAX_NODES_PER_DIAGRAM} node limit.` }
  }

  if (!Array.isArray(diagram.edges)) {
    return { error: `Diagram "${diagram.title}" must include an edges array.` }
  }

  if (diagram.edges.length > MAX_EDGES_PER_DIAGRAM) {
    return { error: `Diagram "${diagram.title}" exceeds the ${MAX_EDGES_PER_DIAGRAM} edge limit.` }
  }

  const nodeErrors = diagram.nodes
    .map((node) => validateNode(node, diagramTitle))
    .find((error): error is string => Boolean(error))

  if (nodeErrors) {
    return { error: nodeErrors }
  }

  const nodeIds = new Set((diagram.nodes as CanvasDiagramNode[]).map((node) => node.id))

  if (nodeIds.size !== diagram.nodes.length) {
    return { error: `Diagram "${diagram.title}" contains duplicate node ids.` }
  }

  const edgeErrors = diagram.edges
    .map((edge) => validateEdge(edge, diagramTitle, nodeIds))
    .find((error): error is string => Boolean(error))

  if (edgeErrors) {
    return { error: edgeErrors }
  }

  const layout =
    isString(diagram.layout) &&
    ['grid', 'flow', 'radial', 'sequence', 'tree', 'timeline'].includes(diagram.layout)
      ? (diagram.layout as CanvasDiagramSpec['layout'])
      : undefined

  return {
    value: {
      id: diagram.id,
      title: diagramTitle,
      kind: diagram.kind as CanvasDiagramKind,
      layout,
      summary: isString(diagram.summary) ? diagram.summary : undefined,
      nodes: diagram.nodes as CanvasDiagramNode[],
      edges: diagram.edges as CanvasDiagramEdge[]
    }
  }
}

export function validateCanvasDiagramEnvelope(input: unknown): {
  error?: string
  value?: CanvasDiagramEnvelope
} {
  if (!isRecord(input)) {
    return { error: 'The diagram request is not a JSON object.' }
  }

  if (input.version !== 1) {
    return { error: 'The diagram request version is unsupported.' }
  }

  if (input.skill !== 'open-canvas-diagrams') {
    return { error: 'The diagram request skill marker is invalid.' }
  }

  if (!isString(input.requestId) || input.requestId.trim().length === 0) {
    return { error: 'The diagram request is missing a requestId.' }
  }

  if (!isString(input.createdAt) || input.createdAt.trim().length === 0) {
    return { error: 'The diagram request is missing createdAt.' }
  }

  if (!isString(input.promptSummary) || input.promptSummary.trim().length === 0) {
    return { error: 'The diagram request is missing promptSummary.' }
  }

  if (!Array.isArray(input.diagrams) || input.diagrams.length === 0) {
    return { error: 'The diagram request must include at least one diagram.' }
  }

  if (input.diagrams.length > MAX_DIAGRAMS_PER_REQUEST) {
    return { error: `The diagram request exceeds the ${MAX_DIAGRAMS_PER_REQUEST} diagram limit.` }
  }

  const diagrams: CanvasDiagramSpec[] = []

  for (const diagram of input.diagrams) {
    const validated = validateDiagram(diagram)

    if (validated.error || !validated.value) {
      return { error: validated.error ?? 'A diagram is invalid.' }
    }

    diagrams.push(validated.value)
  }

  const diagramIds = new Set(diagrams.map((diagram) => diagram.id))

  if (diagramIds.size !== diagrams.length) {
    return { error: 'The diagram request contains duplicate diagram ids.' }
  }

  return {
    value: {
      version: 1,
      skill: 'open-canvas-diagrams',
      requestId: input.requestId,
      createdAt: input.createdAt,
      promptSummary: input.promptSummary,
      diagrams
    }
  }
}

export function parseCanvasDiagramEnvelopeJson(rawContent: string): {
  error?: string
  value?: CanvasDiagramEnvelope
} {
  try {
    return validateCanvasDiagramEnvelope(JSON.parse(rawContent))
  } catch {
    return { error: 'The diagram request file is not valid JSON.' }
  }
}

export function parseExcalidrawPayloadJson(rawContent: string): {
  error?: string
  value?: Record<string, unknown>
} {
  try {
    const parsed = JSON.parse(rawContent)

    if (
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      (
        (parsed as { type?: unknown }).type === 'excalidraw/clipboard' ||
        Array.isArray((parsed as { elements?: unknown }).elements)
      )
    ) {
      return {
        value: parsed as Record<string, unknown>
      }
    }

    return { error: 'The request is not Open Canvas or Excalidraw diagram JSON.' }
  } catch {
    return { error: 'The request file is not valid JSON.' }
  }
}

function validateQueueEntry(entry: unknown): entry is CanvasDiagramQueueIndexEntry {
  return Boolean(
    isRecord(entry) &&
      isString(entry.requestId) &&
      isString(entry.file) &&
      isString(entry.promptSummary) &&
      isString(entry.createdAt)
  )
}

function validateQueueFailureEntry(entry: unknown): entry is CanvasDiagramQueueFailureEntry {
  return Boolean(
    isRecord(entry) &&
      isString(entry.requestId) &&
      isString(entry.file) &&
      isString(entry.error) &&
      isString(entry.failedAt)
  )
}

export function normalizeCanvasDiagramQueueIndex(input: unknown): CanvasDiagramQueueIndex {
  if (!isRecord(input)) {
    return {
      version: 1,
      pending: [],
      processed: [],
      failed: []
    }
  }

  return {
    version: 1,
    pending: Array.isArray(input.pending) ? input.pending.filter(validateQueueEntry) : [],
    processed: Array.isArray(input.processed)
      ? input.processed.filter((entry): entry is string => isString(entry))
      : [],
    failed: Array.isArray(input.failed) ? input.failed.filter(validateQueueFailureEntry) : []
  }
}

export function parseCanvasDiagramQueueIndex(rawContent: string): CanvasDiagramQueueIndex {
  try {
    return normalizeCanvasDiagramQueueIndex(JSON.parse(rawContent))
  } catch {
    return {
      version: 1,
      pending: [],
      processed: [],
      failed: []
    }
  }
}

export function resolveWorkspaceRelativePath(workspacePath: string, relativePath: string) {
  const workspaceRoot = workspacePath.replace(/[\\/]+$/, '')
  const childPath = relativePath
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '')
    .replace(/\\/g, '/')
  return `${workspaceRoot}/${childPath}`
}
