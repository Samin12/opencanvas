import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const MAX_DIAGRAMS = 6
const MAX_NODES = 40
const MAX_EDGES = 80
const FIXTURE_DIRECTORY = new URL('../resources/diagram-fixtures/', import.meta.url)
const VALID_DIAGRAM_KINDS = new Set([
  'flowchart',
  'system-architecture',
  'mind-map',
  'sequence',
  'org-chart',
  'timeline'
])
const VALID_NODE_KINDS = new Set([
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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function validateEnvelope(envelope) {
  assert(envelope && typeof envelope === 'object' && !Array.isArray(envelope), 'Envelope must be an object')
  assert(envelope.version === 1, 'Envelope version must be 1')
  assert(envelope.skill === 'open-canvas-diagrams', 'Envelope skill marker must be open-canvas-diagrams')
  assert(typeof envelope.requestId === 'string' && envelope.requestId.length > 0, 'Envelope requestId missing')
  assert(typeof envelope.createdAt === 'string' && envelope.createdAt.length > 0, 'Envelope createdAt missing')
  assert(typeof envelope.promptSummary === 'string' && envelope.promptSummary.length > 0, 'Envelope promptSummary missing')
  assert(Array.isArray(envelope.diagrams) && envelope.diagrams.length > 0, 'Envelope must contain diagrams')
  assert(envelope.diagrams.length <= MAX_DIAGRAMS, 'Envelope exceeds max diagram count')

  for (const diagram of envelope.diagrams) {
    assert(typeof diagram.id === 'string' && diagram.id.length > 0, 'Diagram id missing')
    assert(typeof diagram.title === 'string' && diagram.title.length > 0, 'Diagram title missing')
    assert(VALID_DIAGRAM_KINDS.has(diagram.kind), `Unsupported diagram kind: ${diagram.kind}`)
    assert(Array.isArray(diagram.nodes) && diagram.nodes.length > 0, `Diagram ${diagram.id} needs nodes`)
    assert(diagram.nodes.length <= MAX_NODES, `Diagram ${diagram.id} exceeds max nodes`)
    assert(Array.isArray(diagram.edges), `Diagram ${diagram.id} needs edges array`)
    assert(diagram.edges.length <= MAX_EDGES, `Diagram ${diagram.id} exceeds max edges`)

    const nodeIds = new Set()
    for (const node of diagram.nodes) {
      assert(typeof node.id === 'string' && node.id.length > 0, `Diagram ${diagram.id} has node without id`)
      assert(!nodeIds.has(node.id), `Diagram ${diagram.id} has duplicate node id ${node.id}`)
      nodeIds.add(node.id)
      assert(typeof node.label === 'string' && node.label.length > 0, `Node ${node.id} missing label`)
      assert(node.label.length <= 140, `Node ${node.id} label exceeds 140 characters`)
      assert(VALID_NODE_KINDS.has(node.kind), `Node ${node.id} has unsupported kind ${node.kind}`)
    }

    for (const edge of diagram.edges) {
      assert(typeof edge.id === 'string' && edge.id.length > 0, `Diagram ${diagram.id} has edge without id`)
      assert(nodeIds.has(edge.from), `Edge ${edge.id} references missing source ${edge.from}`)
      assert(nodeIds.has(edge.to), `Edge ${edge.id} references missing target ${edge.to}`)
      if (edge.label !== undefined) {
        assert(typeof edge.label === 'string' && edge.label.length <= 140, `Edge ${edge.id} label invalid`)
      }
    }
  }
}

function smokeConvert(envelope) {
  const primitives = []

  for (const diagram of envelope.diagrams) {
    primitives.push({ type: 'frame', id: diagram.id })

    for (const node of diagram.nodes) {
      primitives.push({
        type: node.kind === 'note' ? 'note' : 'geo',
        id: node.id
      })
    }

    for (const edge of diagram.edges) {
      primitives.push({ type: 'arrow', id: edge.id })
      primitives.push({ type: 'binding', id: `${edge.id}:start` })
      primitives.push({ type: 'binding', id: `${edge.id}:end` })
    }
  }

  return primitives
}

async function readFixtures() {
  const files = (await readdir(FIXTURE_DIRECTORY)).filter((file) => file.endsWith('.json')).sort()
  const fixtures = []

  for (const file of files) {
    const content = await readFile(join(FIXTURE_DIRECTORY.pathname, file), 'utf8')
    fixtures.push({
      file,
      value: JSON.parse(content)
    })
  }

  return fixtures
}

function buildInvalidFixtures(baseEnvelope) {
  const tooManyNodes = structuredClone(baseEnvelope)
  tooManyNodes.diagrams[0].nodes = Array.from({ length: MAX_NODES + 1 }, (_, index) => ({
    id: `n${index}`,
    label: `Node ${index}`,
    kind: 'process'
  }))
  tooManyNodes.diagrams[0].edges = []

  const danglingEdge = structuredClone(baseEnvelope)
  danglingEdge.diagrams[0].edges = [
    {
      id: 'bad-edge',
      from: danglingEdge.diagrams[0].nodes[0].id,
      to: 'missing-node'
    }
  ]

  const tooManyDiagrams = {
    ...baseEnvelope,
    diagrams: Array.from({ length: MAX_DIAGRAMS + 1 }, (_, index) => ({
      ...structuredClone(baseEnvelope.diagrams[0]),
      id: `diagram-${index}`,
      title: `Diagram ${index}`
    }))
  }

  return [
    { label: 'too many nodes', value: tooManyNodes },
    { label: 'dangling edge', value: danglingEdge },
    { label: 'too many diagrams', value: tooManyDiagrams }
  ]
}

const fixtures = await readFixtures()

assert(fixtures.length >= 6, 'Expected at least one fixture per supported diagram kind.')

for (const fixture of fixtures) {
  validateEnvelope(fixture.value)
  const primitives = smokeConvert(fixture.value)
  assert(primitives.some((item) => item.type === 'frame'), `${fixture.file} did not emit a frame primitive`)
  assert(primitives.some((item) => item.type === 'geo' || item.type === 'note'), `${fixture.file} did not emit node primitives`)
}

for (const invalidFixture of buildInvalidFixtures(fixtures[0]?.value)) {
  let failed = false

  try {
    validateEnvelope(invalidFixture.value)
  } catch {
    failed = true
  }

  assert(failed, `Invalid fixture case "${invalidFixture.label}" should fail validation`)
}

console.log(`Validated ${fixtures.length} diagram fixtures and smoke-checked primitive conversion.`)
