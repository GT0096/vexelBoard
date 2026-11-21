import type { DiagramDirection, DiagramGraph, DiagramNodeKind } from '@shared/beautifySchema'
import type {
  FontId,
  PortSide,
  ShapeKind,
  ShapeNode,
  Stroke,
  TextNode,
  VectorDiagramMeta
} from '../types/board'

const STAGE_PULSE_PALETTE = [
  '#3B82F6', // Stage 0: Electric Blue
  '#6366F1', // Stage 1: Indigo
  '#8B5CF6', // Stage 2: Vivid Violet
  '#F97316', // Stage 3: Routed Orange
  '#10B981', // Stage 4: Emerald Green
  '#06B6D4'  // Stage 5: Cyan
] as const

export interface FlowNodeInput {
  id: string
  type?: string
  position?: { x: number; y: number }
  width?: number
  height?: number
  style?: { width?: unknown; height?: unknown }
  data?: Record<string, unknown>
}

export interface FlowEdgeInput {
  id?: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
  label?: unknown
  animated?: boolean
  style?: unknown
}

export interface CompileNativeDiagramOptions {
  fontFamily?: FontId
  layerId?: string
  defaultFillColor?: string
  existingGroupId?: string
  animateFlow?: boolean
  direction?: DiagramDirection
  originalStrokes?: Stroke[]
  originalShapes?: ShapeNode[]
  originalTexts?: TextNode[]
}

export interface NativeBoardDiagramResult {
  groupId: string
  title: string
  shapes: ShapeNode[]
  texts: TextNode[]
  meta: VectorDiagramMeta
  bounds: { x: number; y: number; w: number; h: number }
}

interface MappedNodeStyle {
  shape: ShapeKind
  w: number
  h: number
  fillColor: string
  borderRadius?: number
  strokeStyle?: 'solid' | 'dashed' | 'dotted'
  elkKind: DiagramNodeKind
  isGroup?: boolean
}

function parseNumericDim(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v
  if (typeof v === 'string') {
    const n = Number.parseFloat(v)
    if (Number.isFinite(n) && n > 0) return n
  }
  return undefined
}

function resolveNativeNodeSpec(
  rawType: string,
  defaultFillColor: string,
  explicitColor?: string
): MappedNodeStyle {
  const lower = rawType.trim().toLowerCase()
  const chosenFill =
    explicitColor && explicitColor !== 'ink' && explicitColor !== 'accent'
      ? explicitColor
      : defaultFillColor

  if (
    lower === 'ml-neural-net' ||
    lower === 'neural-net' ||
    lower === 'ffn' ||
    lower === 'mlp'
  ) {
    return {
      shape: 'ml-neural-net',
      w: 204,
      h: 132,
      borderRadius: 10,
      fillColor: explicitColor || '#E0F2FE',
      elkKind: 'rounded_rect'
    }
  }
  if (lower === 'ml-token-vector' || lower === 'token-vector') {
    return {
      shape: 'ml-token-vector',
      w: 96,
      h: 38,
      borderRadius: 4,
      fillColor: explicitColor || '#FCE7F3',
      elkKind: 'rounded_rect'
    }
  }
  if (lower === 'ml-adder' || lower === 'adder') {
    return {
      shape: 'ml-adder',
      w: 46,
      h: 46,
      fillColor: explicitColor || '#FFFFFF',
      elkKind: 'ellipse'
    }
  }
  if (
    lower === 'decision' ||
    lower === 'diamond' ||
    lower === 'rhombus' ||
    lower === 'fc-decision'
  ) {
    return {
      shape: 'diamond',
      w: 170,
      h: 112,
      fillColor: explicitColor || '#FEF3C7',
      elkKind: 'diamond'
    }
  }
  if (
    lower === 'database' ||
    lower === 'cylinder' ||
    lower === 'cylinder-3d' ||
    lower === 'fc-database'
  ) {
    return {
      shape: 'cylinder',
      w: 144,
      h: 116,
      fillColor: explicitColor || '#DBEAFE',
      elkKind: 'cylinder'
    }
  }
  if (lower === 'cloud') {
    return {
      shape: 'cloud',
      w: 184,
      h: 110,
      fillColor: explicitColor || '#E0F2FE',
      elkKind: 'rounded_rect'
    }
  }
  if (
    lower === 'inputoutput' ||
    lower === 'parallelogram' ||
    lower === 'fc-data'
  ) {
    return {
      shape: 'parallelogram',
      w: 174,
      h: 82,
      fillColor: explicitColor || '#E9D5FF',
      elkKind: 'parallelogram'
    }
  }
  if (lower === 'document' || lower === 'fc-document') {
    return {
      shape: 'fc-document',
      w: 168,
      h: 102,
      fillColor: explicitColor || '#FEF9C3',
      elkKind: 'rounded_rect'
    }
  }
  if (lower === 'actor' || lower === 'uml-actor' || lower === 'user') {
    return {
      shape: 'actor',
      w: 96,
      h: 118,
      fillColor: explicitColor || '#FDE68A',
      elkKind: 'rect'
    }
  }
  if (lower === 'startend' || lower === 'stadium' || lower === 'fc-terminator') {
    return {
      shape: 'rounded-rect',
      w: 164,
      h: 68,
      borderRadius: 34,
      fillColor: explicitColor || '#DCFCE7',
      elkKind: 'rounded_rect'
    }
  }
  if (
    lower === 'circle' ||
    lower === 'statecircle' ||
    lower === 'ellipse' ||
    lower === 'sphere'
  ) {
    return {
      shape: 'circle',
      w: 118,
      h: 118,
      fillColor: explicitColor || '#F3E8FF',
      elkKind: 'ellipse'
    }
  }
  if (lower === 'sticky' || lower === 'uml-note') {
    return {
      shape: 'rect',
      w: 182,
      h: 94,
      borderRadius: 6,
      fillColor: explicitColor || '#FEF08A',
      elkKind: 'rect'
    }
  }
  if (lower === 'group') {
    return {
      shape: 'rounded-rect',
      w: 300,
      h: 200,
      borderRadius: 12,
      strokeStyle: 'dashed',
      fillColor: explicitColor || 'rgba(148, 163, 184, 0.10)',
      elkKind: 'group',
      isGroup: true
    }
  }
  if (lower === 'server' || lower === 'net-server') {
    return {
      shape: 'server',
      w: 136,
      h: 118,
      fillColor: explicitColor || '#E2E8F0',
      elkKind: 'rect'
    }
  }
  if (lower === 'queue' || lower === 'net-queue') {
    return {
      shape: 'queue',
      w: 170,
      h: 82,
      fillColor: explicitColor || '#FED7AA',
      elkKind: 'rounded_rect'
    }
  }
  if (lower === 'component' || lower === 'uml-component') {
    return {
      shape: 'component',
      w: 174,
      h: 90,
      fillColor: explicitColor || '#CCFBF1',
      elkKind: 'rect'
    }
  }
  if (lower === 'rectangle' || lower === 'rect' || lower === 'square') {
    return {
      shape: 'rect',
      w: 168,
      h: 80,
      borderRadius: 0,
      fillColor: chosenFill,
      elkKind: 'rect'
    }
  }
  if (
    lower &&
    lower !== 'process' &&
    lower !== 'custom' &&
    lower !== 'rounded-rectangle' &&
    lower !== 'rounded-rect' &&
    lower.includes('-')
  ) {
    return {
      shape: rawType.trim() as ShapeKind,
      w: 156,
      h: 94,
      fillColor: chosenFill,
      elkKind: 'rounded_rect'
    }
  }
  return {
    shape: 'rounded-rect',
    w: 174,
    h: 82,
    borderRadius: 12,
    fillColor: chosenFill,
    elkKind: 'rounded_rect'
  }
}

function parseHandlePort(handle?: string | null): PortSide | undefined {
  if (!handle) return undefined
  const h = handle.toLowerCase()
  if (h.includes('top')) return 'top'
  if (h.includes('right')) return 'right'
  if (h.includes('bottom')) return 'bottom'
  if (h.includes('left')) return 'left'
  return undefined
}

function portNormal(port: PortSide): [number, number] {
  switch (port) {
    case 'top':
      return [0, -1]
    case 'right':
      return [1, 0]
    case 'bottom':
      return [0, 1]
    case 'left':
      return [-1, 0]
  }
}

function getBoxPorts(s: Pick<ShapeNode, 'x' | 'y' | 'w' | 'h'>): Record<PortSide, { x: number; y: number }> {
  const w = Math.max(12, Math.abs(s.w))
  const h = Math.max(12, Math.abs(s.h))
  const x = s.w < 0 ? s.x + s.w : s.x
  const y = s.h < 0 ? s.y + s.h : s.y
  return {
    top: { x: x + w / 2, y },
    right: { x: x + w, y: y + h / 2 },
    bottom: { x: x + w / 2, y: y + h },
    left: { x, y: y + h / 2 }
  }
}

function cleanOrthogonalPoints(pts: Array<[number, number]>): Array<[number, number]> {
  const rounded: Array<[number, number]> = pts.map(([x, y]) => [Math.round(x), Math.round(y)])
  const deduped: Array<[number, number]> = []
  for (const pt of rounded) {
    const prev = deduped[deduped.length - 1]
    if (!prev || Math.hypot(pt[0] - prev[0], pt[1] - prev[1]) >= 0.5) {
      deduped.push(pt)
    }
  }
  if (deduped.length <= 2) return deduped

  const simplified: Array<[number, number]> = [deduped[0]]
  for (let i = 1; i < deduped.length - 1; i++) {
    const a = simplified[simplified.length - 1]
    const b = deduped[i]
    const c = deduped[i + 1]
    const collinearX = Math.abs(a[0] - b[0]) < 1 && Math.abs(b[0] - c[0]) < 1
    const collinearY = Math.abs(a[1] - b[1]) < 1 && Math.abs(b[1] - c[1]) < 1
    if (!collinearX && !collinearY) {
      simplified.push(b)
    }
  }
  simplified.push(deduped[deduped.length - 1])
  return simplified
}

function computeOrthogonalRoute(
  start: { x: number; y: number },
  startPort: PortSide,
  end: { x: number; y: number },
  endPort: PortSide,
  stub = 24
): Array<[number, number]> {
  const [sxN, syN] = portNormal(startPort)
  const [exN, eyN] = portNormal(endPort)
  const sOut: [number, number] = [start.x + sxN * stub, start.y + syN * stub]
  const eIn: [number, number] = [end.x + exN * stub, end.y + eyN * stub]

  const startHoriz = startPort === 'left' || startPort === 'right'
  const endHoriz = endPort === 'left' || endPort === 'right'

  let raw: Array<[number, number]>
  if (startHoriz && endHoriz) {
    const facingToward =
      sxN * exN < 0 &&
      ((sxN > 0 && end.x - start.x >= stub * 2) || (sxN < 0 && start.x - end.x >= stub * 2))
    if (facingToward) {
      const midX = (sOut[0] + eIn[0]) / 2
      raw = [
        [start.x, start.y],
        [midX, start.y],
        [midX, end.y],
        [end.x, end.y]
      ]
    } else if (sxN * exN > 0) {
      const edgeX = sxN > 0 ? Math.max(sOut[0], eIn[0]) : Math.min(sOut[0], eIn[0])
      raw = [
        [start.x, start.y],
        [edgeX, start.y],
        [edgeX, end.y],
        [end.x, end.y]
      ]
    } else {
      const midY = Math.abs(end.y - start.y) > 48 ? (start.y + end.y) / 2 : start.y - 68
      raw = [
        [start.x, start.y],
        sOut,
        [sOut[0], midY],
        [eIn[0], midY],
        eIn,
        [end.x, end.y]
      ]
    }
  } else if (!startHoriz && !endHoriz) {
    const facingToward =
      syN * eyN < 0 &&
      ((syN > 0 && end.y - start.y >= stub * 2) || (syN < 0 && start.y - end.y >= stub * 2))
    if (facingToward) {
      const midY = (sOut[1] + eIn[1]) / 2
      raw = [
        [start.x, start.y],
        [start.x, midY],
        [end.x, midY],
        [end.x, end.y]
      ]
    } else if (syN * eyN > 0) {
      const edgeY = syN > 0 ? Math.max(sOut[1], eIn[1]) : Math.min(sOut[1], eIn[1])
      raw = [
        [start.x, start.y],
        [start.x, edgeY],
        [end.x, edgeY],
        [end.x, end.y]
      ]
    } else {
      const midX = Math.abs(end.x - start.x) > 48 ? (start.x + end.x) / 2 : start.x + 68
      raw = [
        [start.x, start.y],
        sOut,
        [midX, sOut[1]],
        [midX, eIn[1]],
        eIn,
        [end.x, end.y]
      ]
    }
  } else if (startHoriz && !endHoriz) {
    const forwardCorner = sxN * (end.x - start.x) >= stub && eyN * (start.y - end.y) >= stub
    if (forwardCorner) {
      raw = [
        [start.x, start.y],
        [end.x, start.y],
        [end.x, end.y]
      ]
    } else {
      raw = [
        [start.x, start.y],
        sOut,
        [sOut[0], eIn[1]],
        eIn,
        [end.x, end.y]
      ]
    }
  } else {
    const forwardCorner = syN * (end.y - start.y) >= stub && exN * (start.x - end.x) >= stub
    if (forwardCorner) {
      raw = [
        [start.x, start.y],
        [start.x, end.y],
        [end.x, end.y]
      ]
    } else {
      raw = [
        [start.x, start.y],
        sOut,
        [eIn[0], sOut[1]],
        eIn,
        [end.x, end.y]
      ]
    }
  }

  return cleanOrthogonalPoints(raw)
}

function applyTopologicalWaveStages(
  nodeShapes: ShapeNode[],
  edgeShapes: ShapeNode[]
): void {
  if (nodeShapes.length === 0) return

  const outgoing = new Map<string, string[]>()
  const inDegree = new Map<string, number>()
  for (const n of nodeShapes) {
    outgoing.set(n.id, [])
    inDegree.set(n.id, 0)
  }

  for (const e of edgeShapes) {
    const src = e.startBinding?.shapeId
    const tgt = e.endBinding?.shapeId
    if (src && tgt && src !== tgt && outgoing.has(src) && inDegree.has(tgt)) {
      outgoing.get(src)!.push(tgt)
      inDegree.set(tgt, (inDegree.get(tgt) ?? 0) + 1)
    }
  }

  const nodeStage = new Map<string, number>()
  const queue: string[] = []
  for (const [nid, deg] of inDegree.entries()) {
    if (deg === 0) {
      nodeStage.set(nid, 0)
      queue.push(nid)
    }
  }
  if (queue.length === 0 && nodeShapes.length > 0) {
    nodeStage.set(nodeShapes[0].id, 0)
    queue.push(nodeShapes[0].id)
  }

  const maxDepth = Math.max(8, nodeShapes.length + 2)
  while (queue.length > 0) {
    const curr = queue.shift()!
    const currStage = nodeStage.get(curr) ?? 0
    if (currStage >= maxDepth) continue
    for (const nxt of outgoing.get(curr) ?? []) {
      const nextStage = currStage + 1
      if (!nodeStage.has(nxt) || (nodeStage.get(nxt)! < nextStage && nextStage <= maxDepth)) {
        nodeStage.set(nxt, nextStage)
        queue.push(nxt)
      }
    }
  }

  let maxStage = 0
  for (const stg of nodeStage.values()) {
    if (stg > maxStage) maxStage = stg
  }
  edgeShapes.forEach((e, idx) => {
    const src = e.startBinding?.shapeId
    const stg = src && nodeStage.has(src) ? nodeStage.get(src)! : idx % 4
    if (stg > maxStage) maxStage = stg
  })

  const totalStages = Math.max(2, maxStage + 1)

  for (const n of nodeShapes) {
    const stg = nodeStage.get(n.id) ?? 0
    n.animated = true
    n.flowStage = Math.min(totalStages - 1, stg)
    n.flowTotalStages = totalStages
    n.pulseColor = STAGE_PULSE_PALETTE[stg % STAGE_PULSE_PALETTE.length]
  }

  edgeShapes.forEach((e, idx) => {
    const src = e.startBinding?.shapeId
    const stg = src && nodeStage.has(src) ? nodeStage.get(src)! : idx % 4
    e.animated = true
    e.animationMode = 'pulse'
    e.flowStage = stg
    e.flowTotalStages = totalStages
    e.pulseColor = STAGE_PULSE_PALETTE[stg % STAGE_PULSE_PALETTE.length]
  })
}

/**
 * Compiles any structured flow diagram (nodes + edges + optional positions) directly
 * into native canvas-embedded `ShapeNode`s, frameless immersed title `TextNode`s,
 * live `startBinding`/`endBinding` orthogonal `polyline` connectors, and `VectorDiagramMeta`.
 * Pure & zero runtime imports so it works in both renderer and Node test runner.
 */
export function compileFlowDiagramToBoardElements(
  flow: {
    title?: string
    diagramType?: string
    nodes: FlowNodeInput[]
    edges: FlowEdgeInput[]
  },
  origin: { x: number; y: number; w?: number; h?: number },
  opts?: CompileNativeDiagramOptions
): NativeBoardDiagramResult {
  const now = Date.now()
  const groupId =
    opts?.existingGroupId ??
    `vdiag-${now.toString(36)}-${Math.random().toString(36).slice(2, 5)}`
  const fontFamily: FontId = opts?.fontFamily ?? 'jakarta'
  const layerId = opts?.layerId
  const defaultFillColor = opts?.defaultFillColor ?? '#FEF9C3'
  const cleanTitle = (flow.title ?? '').trim()

  const rawNodes = Array.isArray(flow.nodes) ? flow.nodes : []
  const rawEdges = Array.isArray(flow.edges) ? flow.edges : []

  interface DraftNode {
    inputId: string
    shapeId: string
    spec: MappedNodeStyle
    label: string
    strokeColor: string
    x: number
    y: number
    w: number
    h: number
    explicitFontFamily?: FontId
    explicitTextColor?: string
    animated?: boolean
  }

  const drafts: DraftNode[] = rawNodes.map((n, idx) => {
    const data = (n.data ?? {}) as Record<string, unknown>
    const rawType = String(data.shapeId ?? n.type ?? 'rounded-rect')
    const explicitBg =
      typeof data.bg === 'string' && data.bg
        ? data.bg
        : typeof data.fillColor === 'string' && data.fillColor
          ? data.fillColor
          : undefined
    const explicitStroke =
      typeof data.color === 'string' && data.color ? data.color : undefined
    const spec = resolveNativeNodeSpec(rawType, defaultFillColor, explicitBg)

    const rawLabel = typeof data.label === 'string' ? data.label.trim() : ''
    const rawDesc = typeof data.description === 'string' ? data.description.trim() : ''
    const label = rawLabel || rawDesc || ''

    const explicitW =
      parseNumericDim(n.width) ?? parseNumericDim(data.w) ?? parseNumericDim(n.style?.width)
    const explicitH =
      parseNumericDim(n.height) ?? parseNumericDim(data.h) ?? parseNumericDim(n.style?.height)

    const isFixedIcon =
      spec.shape === 'ml-adder' || spec.shape === 'ml-token-vector' || spec.shape === 'actor'
    const textMinW = label
      ? Math.min(260, Math.max(88, Math.round(label.length * 8.4 + 44)))
      : 64
    const w = isFixedIcon
      ? Math.round(Math.max(spec.w, explicitW ?? 0))
      : Math.round(Math.max(spec.w, explicitW ?? 0, textMinW))

    const approxLines = label
      ? Math.max(1, Math.ceil((label.length * 8.2) / Math.max(76, w - 34)))
      : 1
    const h = isFixedIcon
      ? Math.round(Math.max(spec.h, explicitH ?? 0))
      : Math.round(Math.max(spec.h, explicitH ?? 0, approxLines * 22 + 30))

    const posX =
      typeof n.position?.x === 'number' && Number.isFinite(n.position.x)
        ? n.position.x
        : (idx % 3) * 230
    const posY =
      typeof n.position?.y === 'number' && Number.isFinite(n.position.y)
        ? n.position.y
        : Math.floor(idx / 3) * 145

    return {
      inputId: n.id,
      shapeId: `vnode-${groupId}-${idx}-${n.id.replace(/[^a-zA-Z0-9_-]/g, '')}`,
      spec,
      label,
      strokeColor: explicitStroke || 'ink',
      x: posX,
      y: posY,
      w,
      h,
      explicitFontFamily:
        typeof data.fontFamily === 'string' ? (data.fontFamily as FontId) : undefined,
      explicitTextColor:
        typeof data.textColor === 'string' && data.textColor !== 'auto'
          ? data.textColor
          : undefined,
      animated: Boolean(data.animated)
    }
  })

  // Normalize layout coordinates to origin.x, origin.y + titleOffsetY
  const titleOffsetY = cleanTitle ? 42 : 0
  if (drafts.length > 0) {
    let minX = Infinity
    let minY = Infinity
    let maxRight = -Infinity
    let maxBottom = -Infinity
    for (const d of drafts) {
      if (d.x < minX) minX = d.x
      if (d.y < minY) minY = d.y
      if (d.x + d.w > maxRight) maxRight = d.x + d.w
      if (d.y + d.h > maxBottom) maxBottom = d.y + d.h
    }

    const rawSpanW = Math.max(1, maxRight - minX)
    const rawSpanH = Math.max(1, maxBottom - minY)

    // If caller specifies explicit slot bounds (e.g. tutorial column cardW x 320), fit cleanly
    const hasConstrainedW = typeof origin.w === 'number' && origin.w > 0
    const hasConstrainedH = typeof origin.h === 'number' && origin.h > 0

    let scaleX = 1
    let scaleY = 1
    if (hasConstrainedW && hasConstrainedH) {
      const availW = Math.max(260, origin.w! - 24)
      const availH = Math.max(180, origin.h! - titleOffsetY - 16)
      if (rawSpanW > availW) scaleX = availW / rawSpanW
      if (rawSpanH > availH) scaleY = availH / rawSpanH
      const uniformScale = Math.min(scaleX, scaleY)
      if (uniformScale < 1) {
        for (const d of drafts) {
          d.w = Math.max(82, Math.round(d.w * uniformScale))
          d.h = Math.max(42, Math.round(d.h * uniformScale))
        }
        scaleX = uniformScale
        scaleY = uniformScale
      }
    }

    for (const d of drafts) {
      d.x = Math.round(origin.x + (d.x - minX) * scaleX)
      d.y = Math.round(origin.y + titleOffsetY + (d.y - minY) * scaleY)
    }

    // Gentle non-overlap relaxation when unconstrained so enlarged boxes never touch
    if (!hasConstrainedW || !hasConstrainedH) {
      const nonGroups = drafts.filter((d) => !d.spec.isGroup)
      const minGap = 28
      for (let iter = 0; iter < 8; iter++) {
        let moved = false
        for (let i = 0; i < nonGroups.length; i++) {
          for (let j = i + 1; j < nonGroups.length; j++) {
            const a = nonGroups[i]
            const b = nonGroups[j]
            const overlapX =
              Math.min(a.x + a.w, b.x + b.w) + minGap - Math.max(a.x, b.x)
            const overlapY =
              Math.min(a.y + a.h, b.y + b.h) + minGap - Math.max(a.y, b.y)
            if (overlapX > 0 && overlapY > 0) {
              moved = true
              const acx = a.x + a.w / 2
              const bcx = b.x + b.w / 2
              const acy = a.y + a.h / 2
              const bcy = b.y + b.h / 2
              if (Math.abs(bcx - acx) >= Math.abs(bcy - acy)) {
                const shift = Math.ceil(overlapX / 2)
                if (bcx >= acx) {
                  a.x = Math.max(origin.x, a.x - Math.floor(shift / 2))
                  b.x += shift
                } else {
                  b.x = Math.max(origin.x, b.x - Math.floor(shift / 2))
                  a.x += shift
                }
              } else {
                const shift = Math.ceil(overlapY / 2)
                if (bcy >= acy) {
                  a.y = Math.max(origin.y + titleOffsetY, a.y - Math.floor(shift / 2))
                  b.y += shift
                } else {
                  b.y = Math.max(origin.y + titleOffsetY, b.y - Math.floor(shift / 2))
                  a.y += shift
                }
              }
            }
          }
        }
        if (!moved) break
      }
    }
  }

  // Build native ShapeNodes for nodes (group containers first, then foreground shapes)
  const groupShapes: ShapeNode[] = []
  const nodeShapes: ShapeNode[] = []
  const shapeByInputId = new Map<string, ShapeNode>()
  const elkNodes: DiagramGraph['nodes'] = []

  drafts.forEach((d) => {
    const nodeShape: ShapeNode = {
      id: d.shapeId,
      shape: d.spec.shape,
      x: d.x,
      y: d.y,
      w: d.w,
      h: d.h,
      ...(d.label ? { label: d.label, labelBold: true } : {}),
      ...(d.spec.borderRadius !== undefined ? { borderRadius: d.spec.borderRadius } : {}),
      color: d.strokeColor,
      fillColor: d.spec.fillColor,
      strokeWidth: d.spec.isGroup ? 2 : 2.5,
      strokeStyle: d.spec.strokeStyle ?? 'solid',
      fontFamily: d.explicitFontFamily ?? fontFamily,
      ...(d.explicitTextColor ? { labelColor: d.explicitTextColor } : {}),
      ...(d.animated ? { animated: true } : {}),
      vectorGroupId: groupId,
      ...(layerId ? { layerId } : {})
    }
    shapeByInputId.set(d.inputId, nodeShape)
    if (d.spec.isGroup) {
      groupShapes.push(nodeShape)
    } else {
      nodeShapes.push(nodeShape)
      elkNodes.push({
        id: d.shapeId,
        kind: d.spec.elkKind,
        label: d.label || d.spec.shape,
        fillColor: d.spec.fillColor,
        strokeColor: d.strokeColor
      })
    }
  })

  // Build native bound orthogonal polyline connectors for edges
  const edgeShapes: ShapeNode[] = []
  const elkEdges: DiagramGraph['edges'] = []

  rawEdges.forEach((edge, idx) => {
    const sourceShape = shapeByInputId.get(edge.source)
    const targetShape = shapeByInputId.get(edge.target)
    if (!sourceShape || !targetShape || sourceShape.id === targetShape.id) return

    const srcCx = sourceShape.x + sourceShape.w / 2
    const srcCy = sourceShape.y + sourceShape.h / 2
    const tgtCx = targetShape.x + targetShape.w / 2
    const tgtCy = targetShape.y + targetShape.h / 2
    const dx = tgtCx - srcCx
    const dy = tgtCy - srcCy

    const autoSrcPort: PortSide =
      Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : dy >= 0 ? 'bottom' : 'top'
    const autoTgtPort: PortSide =
      Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'left' : 'right') : dy >= 0 ? 'top' : 'bottom'

    const sourcePort = parseHandlePort(edge.sourceHandle) ?? autoSrcPort
    const targetPort = parseHandlePort(edge.targetHandle) ?? autoTgtPort

    const startPt = getBoxPorts(sourceShape)[sourcePort]
    const endPt = getBoxPorts(targetShape)[targetPort]
    const pts = computeOrthogonalRoute(startPt, sourcePort, endPt, targetPort)

    const xs = pts.map((p) => p[0])
    const ys = pts.map((p) => p[1])
    const minX = Math.min(...xs)
    const minY = Math.min(...ys)

    const styleObj =
      edge.style && typeof edge.style === 'object'
        ? (edge.style as Record<string, unknown>)
        : undefined
    const rawStrokeStyle =
      typeof edge.style === 'string' ? edge.style.toLowerCase() : undefined
    const strokeStyle: 'solid' | 'dashed' | 'dotted' =
      rawStrokeStyle === 'dotted'
        ? 'dotted'
        : rawStrokeStyle === 'dashed' || Boolean(styleObj?.strokeDasharray)
          ? 'dashed'
          : 'solid'

    const rawColor =
      typeof styleObj?.stroke === 'string' &&
      styleObj.stroke &&
      styleObj.stroke.toLowerCase() !== '#38bdf8'
        ? styleObj.stroke
        : 'ink'

    const edgeLabel = typeof edge.label === 'string' ? edge.label.trim() : ''
    const edgeId = `vedge-${groupId}-${idx}`

    edgeShapes.push({
      id: edgeId,
      shape: 'polyline',
      routing: 'orthogonal',
      x: minX,
      y: minY,
      w: Math.max(4, Math.max(...xs) - minX),
      h: Math.max(4, Math.max(...ys) - minY),
      points: pts,
      arrowStart: false,
      arrowEnd: true,
      startBinding: { shapeId: sourceShape.id, port: sourcePort },
      endBinding: { shapeId: targetShape.id, port: targetPort },
      strokeStyle,
      ...(edgeLabel ? { label: edgeLabel, labelBold: true } : {}),
      color: rawColor,
      fillColor: 'transparent',
      strokeWidth: 2.5,
      ...(edge.animated ? { animated: true, animationMode: 'pulse' as const } : {}),
      fontFamily,
      vectorGroupId: groupId,
      ...(layerId ? { layerId } : {})
    })

    elkEdges.push({
      id: edgeId,
      source: sourceShape.id,
      target: targetShape.id,
      ...(edgeLabel ? { label: edgeLabel } : {}),
      style: strokeStyle,
      directed: true
    })
  })

  // Apply stage-synchronized wave propagation if requested or any edge is animated
  if (opts?.animateFlow || rawEdges.some((e) => Boolean(e.animated))) {
    applyTopologicalWaveStages(nodeShapes, edgeShapes)
  }

  // Emit frameless immersed title TextNode if present
  const texts: TextNode[] = []
  if (cleanTitle) {
    texts.push({
      id: `vtitle-${groupId}`,
      x: Math.round(origin.x),
      y: Math.round(origin.y),
      text: cleanTitle,
      style: 'h2',
      bold: true,
      fontSize: 20,
      color: 'ink',
      bg: 'transparent',
      immersed: true,
      fontFamily,
      align: 'left',
      vectorGroupId: groupId,
      source: 'ocr',
      createdAt: now,
      ...(layerId ? { layerId } : {})
    })
  }

  // Infer overall flow direction for ELK re-layout toggles
  let inferredDirection: DiagramDirection = opts?.direction ?? 'DOWN'
  if (!opts?.direction && drafts.length >= 2) {
    let minX = Infinity
    let maxRight = -Infinity
    let minY = Infinity
    let maxBottom = -Infinity
    for (const d of drafts) {
      if (d.x < minX) minX = d.x
      if (d.x + d.w > maxRight) maxRight = d.x + d.w
      if (d.y < minY) minY = d.y
      if (d.y + d.h > maxBottom) maxBottom = d.y + d.h
    }
    inferredDirection = maxRight - minX > (maxBottom - minY) * 1.1 ? 'RIGHT' : 'DOWN'
  }

  const shapes: ShapeNode[] = [...groupShapes, ...nodeShapes, ...edgeShapes]

  // Compute exact world bounding box covering all emitted shapes & texts
  let bMinX = Infinity
  let bMinY = Infinity
  let bMaxX = -Infinity
  let bMaxY = -Infinity

  for (const s of shapes) {
    if (s.points && s.points.length > 0) {
      for (const [px, py] of s.points) {
        if (px < bMinX) bMinX = px
        if (py < bMinY) bMinY = py
        if (px > bMaxX) bMaxX = px
        if (py > bMaxY) bMaxY = py
      }
    } else {
      const x1 = Math.min(s.x, s.x + s.w)
      const x2 = Math.max(s.x, s.x + s.w)
      const y1 = Math.min(s.y, s.y + s.h)
      const y2 = Math.max(s.y, s.y + s.h)
      if (x1 < bMinX) bMinX = x1
      if (y1 < bMinY) bMinY = y1
      if (x2 > bMaxX) bMaxX = x2
      if (y2 > bMaxY) bMaxY = y2
    }
  }
  for (const t of texts) {
    const estW = Math.max(120, Math.round(t.text.length * 11))
    const estH = 32
    if (t.x < bMinX) bMinX = t.x
    if (t.y < bMinY) bMinY = t.y
    if (t.x + estW > bMaxX) bMaxX = t.x + estW
    if (t.y + estH > bMaxY) bMaxY = t.y + estH
  }

  if (!Number.isFinite(bMinX)) {
    bMinX = Math.round(origin.x)
    bMinY = Math.round(origin.y)
    bMaxX = bMinX + 260
    bMaxY = bMinY + 180
  }

  const meta: VectorDiagramMeta = {
    groupId,
    anchor: { x: Math.round(origin.x), y: Math.round(origin.y) },
    ...(elkNodes.length > 0
      ? {
          graph: {
            direction: inferredDirection,
            ...(cleanTitle ? { title: cleanTitle } : {}),
            nodes: elkNodes,
            edges: elkEdges
          }
        }
      : {}),
    ...(opts?.originalStrokes ? { originalStrokes: opts.originalStrokes } : {}),
    ...(opts?.originalShapes ? { originalShapes: opts.originalShapes } : {}),
    ...(opts?.originalTexts ? { originalTexts: opts.originalTexts } : {})
  }

  return {
    groupId,
    title: cleanTitle || 'Diagram',
    shapes,
    texts,
    meta,
    bounds: {
      x: Math.round(bMinX),
      y: Math.round(bMinY),
      w: Math.max(180, Math.round(bMaxX - bMinX)),
      h: Math.max(120, Math.round(bMaxY - bMinY))
    }
  }
}
