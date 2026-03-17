import { type Editor } from 'tldraw'
import {
  createBindingId,
  createShapeId,
  toRichText,
  type TLArrowShape,
  type TLBindingCreate,
  type TLFrameShape,
  type TLGeoShape,
  type TLNoteShape,
  type TLShapePartial,
  type TLTextShape
} from '@tldraw/tlschema'

import type { CanvasDiagramEnvelope, CanvasDiagramNode, CanvasDiagramSpec } from '@shared/types'

type Point = { x: number; y: number }
type NodeLayout = { height: number; width: number; x: number; y: number }
type TextLabelLayout = { text: string; x: number; y: number }
type DiagramLayoutPlan = {
  frameHeight: number
  frameWidth: number
  headings: TextLabelLayout[]
  nodes: Map<string, NodeLayout>
}

const FRAME_GAP = 160
const FRAME_PADDING_X = 72
const FRAME_PADDING_Y = 96
const FRAME_HEADER_HEIGHT = 72
const HORIZONTAL_GAP = 84
const VERTICAL_GAP = 68
const DEFAULT_FRAME_SIZES: Record<CanvasDiagramSpec['kind'], { height: number; width: number }> = {
  flowchart: { width: 1200, height: 760 },
  'system-architecture': { width: 1200, height: 760 },
  'mind-map': { width: 1100, height: 760 },
  sequence: { width: 1400, height: 900 },
  'org-chart': { width: 1200, height: 760 },
  timeline: { width: 1200, height: 760 }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function estimateTextLines(label: string, width: number) {
  const normalized = label.trim()

  if (!normalized) {
    return 1
  }

  const charactersPerLine = Math.max(8, Math.floor(width / 9))
  return Math.max(
    1,
    normalized
      .split('\n')
      .map((line) => Math.max(1, Math.ceil(line.length / charactersPerLine)))
      .reduce((count, current) => count + current, 0)
  )
}

function nodeDimensions(node: CanvasDiagramNode) {
  const baseWidth = clamp(140 + node.label.length * 5.2, 180, 320)
  const lineCount = estimateTextLines(node.label, baseWidth - 24)

  if (node.kind === 'note') {
    return {
      width: clamp(baseWidth + 10, 220, 320),
      height: clamp(140 + (lineCount - 1) * 24, 140, 240)
    }
  }

  return {
    width: baseWidth,
    height: clamp(92 + (lineCount - 1) * 22, 92, 180)
  }
}

function orderWeight(node: CanvasDiagramNode) {
  return typeof node.order === 'number' ? node.order : Number.MAX_SAFE_INTEGER
}

function sortNodes(nodes: CanvasDiagramNode[]) {
  return [...nodes].sort((left, right) => {
    if (orderWeight(left) !== orderWeight(right)) {
      return orderWeight(left) - orderWeight(right)
    }

    return left.label.localeCompare(right.label)
  })
}

function titleForVariant(existingTitles: Set<string>, baseTitle: string) {
  const trimmedBaseTitle = baseTitle.trim() || 'Diagram'

  if (!existingTitles.has(trimmedBaseTitle)) {
    existingTitles.add(trimmedBaseTitle)
    return trimmedBaseTitle
  }

  let suffix = 2

  while (existingTitles.has(`${trimmedBaseTitle} · ${suffix}`)) {
    suffix += 1
  }

  const nextTitle = `${trimmedBaseTitle} · ${suffix}`
  existingTitles.add(nextTitle)
  return nextTitle
}

function graphLevels(diagram: CanvasDiagramSpec) {
  const outgoing = new Map<string, string[]>()
  const incomingCount = new Map<string, number>()

  diagram.nodes.forEach((node) => {
    outgoing.set(node.id, [])
    incomingCount.set(node.id, 0)
  })

  diagram.edges.forEach((edge) => {
    outgoing.get(edge.from)?.push(edge.to)
    incomingCount.set(edge.to, (incomingCount.get(edge.to) ?? 0) + 1)
  })

  const rootIds = sortNodes(
    diagram.nodes.filter((node) => (incomingCount.get(node.id) ?? 0) === 0)
  ).map((node) => node.id)

  const queue = rootIds.length > 0 ? [...rootIds] : [diagram.nodes[0]?.id].filter(Boolean) as string[]
  const levels = new Map<string, number>()

  queue.forEach((nodeId) => levels.set(nodeId, 0))

  while (queue.length > 0) {
    const currentId = queue.shift() ?? ''
    const currentLevel = levels.get(currentId) ?? 0

    for (const nextId of outgoing.get(currentId) ?? []) {
      const nextLevel = currentLevel + 1
      const existingLevel = levels.get(nextId)

      if (existingLevel === undefined || nextLevel > existingLevel) {
        levels.set(nextId, nextLevel)
        queue.push(nextId)
      }
    }
  }

  diagram.nodes.forEach((node) => {
    if (!levels.has(node.id)) {
      levels.set(node.id, 0)
    }
  })

  return levels
}

function layoutLayeredDiagram(diagram: CanvasDiagramSpec) {
  const levels = graphLevels(diagram)
  const groups = new Map<number, CanvasDiagramNode[]>()

  sortNodes(diagram.nodes).forEach((node) => {
    const level = levels.get(node.id) ?? 0
    const current = groups.get(level) ?? []
    current.push(node)
    groups.set(level, current)
  })

  const orderedLevels = Array.from(groups.keys()).sort((left, right) => left - right)
  const nodes = new Map<string, NodeLayout>()
  let maxWidth = 0
  let currentY = FRAME_PADDING_Y

  orderedLevels.forEach((level) => {
    const levelNodes = groups.get(level) ?? []
    const levelWidths = levelNodes.map((node) => nodeDimensions(node))
    const rowWidth =
      levelWidths.reduce((total, current) => total + current.width, 0) +
      Math.max(0, levelNodes.length - 1) * HORIZONTAL_GAP
    const rowHeight = levelWidths.reduce((height, current) => Math.max(height, current.height), 0)
    let currentX = FRAME_PADDING_X

    levelNodes.forEach((node, index) => {
      const { width, height } = levelWidths[index] ?? nodeDimensions(node)
      nodes.set(node.id, {
        x: currentX,
        y: currentY,
        width,
        height
      })
      currentX += width + HORIZONTAL_GAP
    })

    maxWidth = Math.max(maxWidth, rowWidth)
    currentY += rowHeight + VERTICAL_GAP
  })

  return finalizeLayout(diagram, {
    nodes,
    headings: [],
    contentWidth: maxWidth,
    contentHeight: currentY - FRAME_PADDING_Y
  })
}

function layoutGroupedColumnsDiagram(diagram: CanvasDiagramSpec, key: 'cluster' | 'lane') {
  const groups = new Map<string, CanvasDiagramNode[]>()

  sortNodes(diagram.nodes).forEach((node) => {
    const groupKey = (typeof node[key] === 'string' && node[key]?.trim()) || 'General'
    const current = groups.get(groupKey) ?? []
    current.push(node)
    groups.set(groupKey, current)
  })

  const orderedGroups = Array.from(groups.entries()).sort(([left], [right]) => left.localeCompare(right))
  const nodes = new Map<string, NodeLayout>()
  const headings: TextLabelLayout[] = []
  let currentX = FRAME_PADDING_X
  let maxHeight = 0

  orderedGroups.forEach(([groupLabel, groupNodes]) => {
    const dimensions = groupNodes.map((node) => nodeDimensions(node))
    const columnWidth = dimensions.reduce((width, current) => Math.max(width, current.width), 0)
    let currentY = FRAME_PADDING_Y + 36

    headings.push({
      text: groupLabel,
      x: currentX,
      y: FRAME_PADDING_Y - 6
    })

    groupNodes.forEach((node, index) => {
      const { width, height } = dimensions[index] ?? nodeDimensions(node)
      nodes.set(node.id, {
        x: currentX + (columnWidth - width) / 2,
        y: currentY,
        width,
        height
      })
      currentY += height + VERTICAL_GAP
    })

    maxHeight = Math.max(maxHeight, currentY - FRAME_PADDING_Y)
    currentX += columnWidth + HORIZONTAL_GAP
  })

  return finalizeLayout(diagram, {
    nodes,
    headings,
    contentWidth: currentX - FRAME_PADDING_X - HORIZONTAL_GAP,
    contentHeight: maxHeight
  })
}

function layoutMindMapDiagram(diagram: CanvasDiagramSpec) {
  const ordered = sortNodes(diagram.nodes)
  const root = ordered[0]
  const others = ordered.slice(1)
  const nodes = new Map<string, NodeLayout>()
  const rootSize = nodeDimensions(root)

  nodes.set(root.id, {
    x: FRAME_PADDING_X + 360,
    y: FRAME_PADDING_Y + 220,
    width: rootSize.width,
    height: rootSize.height
  })

  others.forEach((node, index) => {
    const { width, height } = nodeDimensions(node)
    const angle = (Math.PI * 2 * index) / Math.max(others.length, 1)
    const radius = others.length > 8 ? 340 : 280
    const centerX = FRAME_PADDING_X + 410 + Math.cos(angle) * radius
    const centerY = FRAME_PADDING_Y + 260 + Math.sin(angle) * radius

    nodes.set(node.id, {
      x: centerX - width / 2,
      y: centerY - height / 2,
      width,
      height
    })
  })

  return finalizeLayout(diagram, {
    nodes,
    headings: [],
    contentWidth: 920,
    contentHeight: 700
  })
}

function layoutSequenceDiagram(diagram: CanvasDiagramSpec) {
  const lanes = new Map<string, CanvasDiagramNode[]>()

  sortNodes(diagram.nodes).forEach((node) => {
    const lane = (typeof node.lane === 'string' && node.lane.trim()) || 'Main'
    const current = lanes.get(lane) ?? []
    current.push(node)
    lanes.set(lane, current)
  })

  const headings: TextLabelLayout[] = []
  const nodes = new Map<string, NodeLayout>()
  let currentX = FRAME_PADDING_X
  let maxHeight = 0

  Array.from(lanes.entries()).forEach(([laneLabel, laneNodes]) => {
    const laneWidth = laneNodes.reduce((width, node) => Math.max(width, nodeDimensions(node).width), 200)

    headings.push({
      text: laneLabel,
      x: currentX,
      y: FRAME_PADDING_Y - 6
    })

    laneNodes.forEach((node, index) => {
      const { width, height } = nodeDimensions(node)
      const y = FRAME_PADDING_Y + 50 + index * (height + VERTICAL_GAP)

      nodes.set(node.id, {
        x: currentX + (laneWidth - width) / 2,
        y,
        width,
        height
      })

      maxHeight = Math.max(maxHeight, y + height - FRAME_PADDING_Y)
    })

    currentX += laneWidth + HORIZONTAL_GAP
  })

  return finalizeLayout(diagram, {
    nodes,
    headings,
    contentWidth: currentX - FRAME_PADDING_X - HORIZONTAL_GAP,
    contentHeight: maxHeight + 40
  })
}

function layoutTimelineDiagram(diagram: CanvasDiagramSpec) {
  const ordered = sortNodes(diagram.nodes)
  const nodes = new Map<string, NodeLayout>()
  let currentX = FRAME_PADDING_X
  let maxHeight = 0

  ordered.forEach((node, index) => {
    const { width, height } = nodeDimensions(node)
    const offsetY = index % 2 === 0 ? FRAME_PADDING_Y + 120 : FRAME_PADDING_Y + 260
    nodes.set(node.id, {
      x: currentX,
      y: offsetY,
      width,
      height
    })
    currentX += width + HORIZONTAL_GAP
    maxHeight = Math.max(maxHeight, offsetY + height - FRAME_PADDING_Y)
  })

  return finalizeLayout(diagram, {
    nodes,
    headings: [],
    contentWidth: currentX - FRAME_PADDING_X - HORIZONTAL_GAP,
    contentHeight: maxHeight + 80
  })
}

function finalizeLayout(
  diagram: CanvasDiagramSpec,
  input: {
    contentHeight: number
    contentWidth: number
    headings: TextLabelLayout[]
    nodes: Map<string, NodeLayout>
  }
): DiagramLayoutPlan {
  const defaultSize = DEFAULT_FRAME_SIZES[diagram.kind]
  let maxRight = 0
  let maxBottom = 0

  input.nodes.forEach((layout) => {
    maxRight = Math.max(maxRight, layout.x + layout.width)
    maxBottom = Math.max(maxBottom, layout.y + layout.height)
  })

  input.headings.forEach((heading) => {
    maxRight = Math.max(maxRight, heading.x + 240)
    maxBottom = Math.max(maxBottom, heading.y + 28)
  })

  return {
    nodes: input.nodes,
    headings: input.headings,
    frameWidth: Math.max(defaultSize.width, maxRight + FRAME_PADDING_X),
    frameHeight: Math.max(defaultSize.height, maxBottom + FRAME_PADDING_Y),
  }
}

function layoutDiagram(diagram: CanvasDiagramSpec) {
  switch (diagram.kind) {
    case 'mind-map':
      return layoutMindMapDiagram(diagram)
    case 'sequence':
      return layoutSequenceDiagram(diagram)
    case 'timeline':
      return layoutTimelineDiagram(diagram)
    case 'system-architecture':
      if (diagram.nodes.some((node) => typeof node.cluster === 'string' && node.cluster.trim().length > 0)) {
        return layoutGroupedColumnsDiagram(diagram, 'cluster')
      }

      return layoutLayeredDiagram(diagram)
    case 'flowchart':
    case 'org-chart':
      return layoutLayeredDiagram(diagram)
    default:
      return layoutLayeredDiagram(diagram)
  }
}

function pagePointForNode(layout: NodeLayout, anchor: Point) {
  return {
    x: layout.x + layout.width * anchor.x,
    y: layout.y + layout.height * anchor.y
  }
}

function anchorsForLayouts(source: NodeLayout, target: NodeLayout) {
  const sourceCenter = {
    x: source.x + source.width / 2,
    y: source.y + source.height / 2
  }
  const targetCenter = {
    x: target.x + target.width / 2,
    y: target.y + target.height / 2
  }
  const deltaX = targetCenter.x - sourceCenter.x
  const deltaY = targetCenter.y - sourceCenter.y

  if (Math.abs(deltaX) >= Math.abs(deltaY)) {
    return deltaX >= 0
      ? {
          sourceAnchor: { x: 1, y: 0.5 },
          targetAnchor: { x: 0, y: 0.5 }
        }
      : {
          sourceAnchor: { x: 0, y: 0.5 },
          targetAnchor: { x: 1, y: 0.5 }
        }
  }

  return deltaY >= 0
    ? {
        sourceAnchor: { x: 0.5, y: 1 },
        targetAnchor: { x: 0.5, y: 0 }
      }
    : {
        sourceAnchor: { x: 0.5, y: 0 },
        targetAnchor: { x: 0.5, y: 1 }
      }
}

function geoForNodeKind(node: CanvasDiagramNode) {
  switch (node.kind) {
    case 'decision':
      return 'diamond'
    case 'data':
    case 'document':
      return 'trapezoid'
    case 'database':
      return 'oval'
    case 'actor':
      return 'ellipse'
    case 'event':
      return 'hexagon'
    default:
      return 'rectangle'
  }
}

function columnGridPositions(plans: DiagramLayoutPlan[], centerX: number, centerY: number) {
  const rows: DiagramLayoutPlan[][] = []

  for (let index = 0; index < plans.length; index += 2) {
    rows.push(plans.slice(index, index + 2))
  }

  const rowSizes = rows.map((row) => ({
    width:
      row.reduce((width, plan) => width + plan.frameWidth, 0) +
      Math.max(0, row.length - 1) * FRAME_GAP,
    height: row.reduce((height, plan) => Math.max(height, plan.frameHeight), 0)
  }))
  const totalWidth = rowSizes.reduce((width, row) => Math.max(width, row.width), 0)
  const totalHeight =
    rowSizes.reduce((height, row) => height + row.height, 0) + Math.max(0, rowSizes.length - 1) * FRAME_GAP
  const placements: Point[] = []
  let currentY = centerY - totalHeight / 2

  rows.forEach((row, rowIndex) => {
    const rowWidth = rowSizes[rowIndex]?.width ?? 0
    let currentX = centerX - totalWidth / 2 + (totalWidth - rowWidth) / 2

    row.forEach((plan) => {
      placements.push({
        x: currentX,
        y: currentY
      })
      currentX += plan.frameWidth + FRAME_GAP
    })

    currentY += (rowSizes[rowIndex]?.height ?? 0) + FRAME_GAP
  })

  return placements
}

export function renderCanvasDiagramSet(
  editor: Editor,
  envelope: CanvasDiagramEnvelope,
  options: { centerX: number; centerY: number }
) {
  const pageId = editor.getCurrentPageId()
  const existingTitles = new Set(
    editor
      .getCurrentPageShapes()
      .filter((shape) => shape.type === 'frame')
      .map((shape) => {
        const frame = shape as TLFrameShape
        return frame.props.name.trim()
      })
      .filter(Boolean)
  )
  const diagrams = envelope.diagrams.map((diagram) => ({
    diagram,
    layout: layoutDiagram(diagram)
  }))
  const placements = columnGridPositions(
    diagrams.map((entry) => entry.layout),
    options.centerX,
    options.centerY
  )

  diagrams.forEach(({ diagram, layout }, index) => {
    const placement = placements[index] ?? { x: options.centerX, y: options.centerY }
    const frameId = createShapeId()
    const frameTitle = titleForVariant(existingTitles, diagram.title)

    editor.createShapes([
      {
        id: frameId,
        type: 'frame',
        parentId: pageId,
        x: placement.x,
        y: placement.y,
        props: {
          w: layout.frameWidth,
          h: layout.frameHeight,
          color: 'grey',
          name: frameTitle
        }
      } satisfies TLShapePartial<TLFrameShape>
    ])

    const childShapes: Array<
      TLShapePartial<TLGeoShape | TLNoteShape | TLTextShape | TLArrowShape>
    > = []
    const bindings: TLBindingCreate[] = []
    const shapeIdsByNodeId = new Map<string, TLGeoShape['id'] | TLNoteShape['id']>()

    layout.headings.forEach((heading) => {
      childShapes.push({
        id: createShapeId(),
        type: 'text',
        parentId: frameId,
        x: heading.x,
        y: heading.y,
        props: {
          color: 'black',
          size: 'm',
          font: 'draw',
          textAlign: 'middle',
          w: 220,
          autoSize: false,
          scale: 1,
          richText: toRichText(heading.text)
        }
      } satisfies TLShapePartial<TLTextShape>)
    })

    diagram.nodes.forEach((node) => {
      const nodeId = createShapeId()
      const nodeLayout = layout.nodes.get(node.id)

      if (!nodeLayout) {
        return
      }

      shapeIdsByNodeId.set(node.id, nodeId)

      if (node.kind === 'note') {
        childShapes.push({
          id: nodeId,
          type: 'note',
          parentId: frameId,
          x: nodeLayout.x,
          y: nodeLayout.y,
          props: {
            color: 'yellow',
            labelColor: 'black',
            size: 'm',
            font: 'draw',
            fontSizeAdjustment: 0,
            align: 'middle',
            verticalAlign: 'middle',
            growY: Math.max(0, nodeLayout.height - 140),
            url: '',
            scale: 1,
            richText: toRichText(node.label)
          }
        } satisfies TLShapePartial<TLNoteShape>)
        return
      }

      childShapes.push({
        id: nodeId,
        type: 'geo',
        parentId: frameId,
        x: nodeLayout.x,
        y: nodeLayout.y,
        props: {
          geo: geoForNodeKind(node),
          dash: 'solid',
          url: '',
          w: nodeLayout.width,
          h: nodeLayout.height,
          growY: 0,
          scale: 1,
          labelColor: 'black',
          color: 'black',
          fill: node.emphasis === 'high' ? 'solid' : 'semi',
          size: 'm',
          font: 'draw',
          align: 'middle',
          verticalAlign: 'middle',
          richText: toRichText(node.label)
        }
      } satisfies TLShapePartial<TLGeoShape>)
    })

    diagram.edges.forEach((edge) => {
      const sourceLayout = layout.nodes.get(edge.from)
      const targetLayout = layout.nodes.get(edge.to)
      const sourceShapeId = shapeIdsByNodeId.get(edge.from)
      const targetShapeId = shapeIdsByNodeId.get(edge.to)

      if (!sourceLayout || !targetLayout || !sourceShapeId || !targetShapeId) {
        return
      }

      const { sourceAnchor, targetAnchor } = anchorsForLayouts(sourceLayout, targetLayout)
      const arrowId = createShapeId()
      const arrowKind = diagram.kind === 'mind-map' || diagram.kind === 'sequence' || diagram.kind === 'timeline'
        ? 'arc'
        : 'elbow'

      childShapes.push({
        id: arrowId,
        type: 'arrow',
        parentId: frameId,
        x: 0,
        y: 0,
        props: {
          kind: arrowKind,
          labelColor: 'black',
          color: 'black',
          fill: 'none',
          dash: edge.style === 'dashed' ? 'dashed' : 'solid',
          size: 'm',
          arrowheadStart: edge.direction === 'two-way' ? 'arrow' : 'none',
          arrowheadEnd: 'arrow',
          font: 'draw',
          start: pagePointForNode(sourceLayout, sourceAnchor),
          end: pagePointForNode(targetLayout, targetAnchor),
          bend: 0,
          richText: toRichText(edge.label ?? ''),
          labelPosition: 0.5,
          scale: 1,
          elbowMidPoint: 0.5
        }
      } satisfies TLShapePartial<TLArrowShape>)

      bindings.push(
        {
          id: createBindingId(),
          type: 'arrow',
          fromId: arrowId,
          toId: sourceShapeId,
          props: {
            terminal: 'start',
            normalizedAnchor: sourceAnchor,
            isExact: false,
            isPrecise: true,
            snap: 'none'
          }
        },
        {
          id: createBindingId(),
          type: 'arrow',
          fromId: arrowId,
          toId: targetShapeId,
          props: {
            terminal: 'end',
            normalizedAnchor: targetAnchor,
            isExact: false,
            isPrecise: true,
            snap: 'none'
          }
        }
      )
    })

    if (childShapes.length > 0) {
      editor.createShapes(childShapes)
    }

    if (bindings.length > 0) {
      editor.createBindings(bindings)
    }
  })
}
