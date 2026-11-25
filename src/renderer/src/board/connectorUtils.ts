import type { DiagramGraph, DiagramNodeKind } from '@shared/beautifySchema'
import type {
  ConnectorRouting,
  FontId,
  PortSide,
  ShapeKind,
  ShapeNode
} from '../types/board'

const PORT_ORDER: PortSide[] = ['top', 'right', 'bottom', 'left']

function getShapeBoundingRect(
  s: Pick<ShapeNode, 'x' | 'y' | 'w' | 'h' | 'points' | 'controlPoint'>
): { x: number; y: number; w: number; h: number } {
  if (s.points && s.points.length >= 2) {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const [px, py] of s.points) {
      if (px < minX) minX = px
      if (py < minY) minY = py
      if (px > maxX) maxX = px
      if (py > maxY) maxY = py
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
  }
  let minX = Math.min(s.x, s.x + s.w)
  let maxX = Math.max(s.x, s.x + s.w)
  let minY = Math.min(s.y, s.y + s.h)
  let maxY = Math.max(s.y, s.y + s.h)
  if (s.controlPoint) {
    minX = Math.min(minX, s.controlPoint[0])
    maxX = Math.max(maxX, s.controlPoint[0])
    minY = Math.min(minY, s.controlPoint[1])
    maxY = Math.max(maxY, s.controlPoint[1])
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

export function isConnectorShape(
  s: Pick<ShapeNode, 'shape' | 'startBinding' | 'endBinding'>
): boolean {
  if (s.startBinding || s.endBinding) return true
  if (s.shape.startsWith('anim-line-')) return true
  return (
    s.shape === 'line' ||
    s.shape === 'dashed-line' ||
    s.shape === 'arrow' ||
    s.shape === 'arrow-bidirectional' ||
    s.shape === 'elbow' ||
    s.shape === 'curved-line' ||
    s.shape === 'curved-arrow' ||
    s.shape === 'polyline'
  )
}

export function getOppositePort(port: PortSide): PortSide {
  switch (port) {
    case 'top':
      return 'bottom'
    case 'bottom':
      return 'top'
    case 'left':
      return 'right'
    case 'right':
      return 'left'
  }
}

export function portNormal(port: PortSide): [number, number] {
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

export function getShapePorts(s: ShapeNode): Record<PortSide, { x: number; y: number }> {
  const b = getShapeBoundingRect(s)
  const w = Math.max(12, b.w)
  const h = Math.max(12, b.h)
  const raw: Record<PortSide, { x: number; y: number }> = {
    top: { x: b.x + w / 2, y: b.y },
    right: { x: b.x + w, y: b.y + h / 2 },
    bottom: { x: b.x + w / 2, y: b.y + h },
    left: { x: b.x, y: b.y + h / 2 }
  }
  if (!s.rotation) return raw
  const rad = (s.rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const cx = s.x + s.w / 2
  const cy = s.y + s.h / 2
  const rot = (pt: { x: number; y: number }): { x: number; y: number } => {
    const dx = pt.x - cx
    const dy = pt.y - cy
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos }
  }
  return {
    top: rot(raw.top),
    right: rot(raw.right),
    bottom: rot(raw.bottom),
    left: rot(raw.left)
  }
}

export interface ShapePortHandle {
  port: PortSide
  anchorX: number
  anchorY: number
  dotX: number
  dotY: number
}

/**
 * Computes the 4 visual circular connection handles pushed cleanly outside
 * the 8 square resize handles (`16px / zoom` outward along port normals).
 */
export function getShapePortHandles(s: ShapeNode, zoom: number): ShapePortHandle[] {
  const ports = getShapePorts(s)
  const offset = 16 / Math.max(0.25, zoom)
  const rad = s.rotation ? (s.rotation * Math.PI) / 180 : 0
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return PORT_ORDER.map((port) => {
    const anchor = ports[port]
    const [nx0, ny0] = portNormal(port)
    const nx = rad ? nx0 * cos - ny0 * sin : nx0
    const ny = rad ? nx0 * sin + ny0 * cos : ny0
    return {
      port,
      anchorX: anchor.x,
      anchorY: anchor.y,
      dotX: anchor.x + nx * offset,
      dotY: anchor.y + ny * offset
    }
  })
}

export function pickNearestPort(s: ShapeNode, pt: { x: number; y: number }): PortSide {
  const ports = getShapePorts(s)
  let bestPort: PortSide = 'left'
  let bestDist = Infinity
  for (const port of PORT_ORDER) {
    const p = ports[port]
    const d = Math.hypot(pt.x - p.x, pt.y - p.y)
    if (d < bestDist) {
      bestDist = d
      bestPort = port
    }
  }
  return bestPort
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

export function inferFreeEndPort(
  start: { x: number; y: number },
  end: { x: number; y: number },
  startPort: PortSide
): PortSide {
  const dx = end.x - start.x
  const dy = end.y - start.y
  if (Math.hypot(dx, dy) < 8) return getOppositePort(startPort)
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? 'left' : 'right'
  }
  return dy >= 0 ? 'top' : 'bottom'
}

/**
 * Computes React Flow-style orthogonal step waypoints between two anchored ports,
 * handling facing, perpendicular, same-side, and wrap-around opposing ports cleanly.
 */
export function computeOrthogonalRoute(
  start: { x: number; y: number },
  startPort: PortSide,
  end: { x: number; y: number },
  endPort: PortSide,
  stub = 26
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
      const midY =
        Math.abs(end.y - start.y) > 48 ? (start.y + end.y) / 2 : start.y - 68
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
      const midX =
        Math.abs(end.x - start.x) > 48 ? (start.x + end.x) / 2 : start.x + 68
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
    const forwardCorner =
      sxN * (end.x - start.x) >= stub && eyN * (start.y - end.y) >= stub
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
    const forwardCorner =
      syN * (end.y - start.y) >= stub && exN * (start.x - end.x) >= stub
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

export function computeCurvedControlPoint(
  start: { x: number; y: number },
  startPort: PortSide,
  end: { x: number; y: number },
  endPort: PortSide
): [number, number] {
  const dist = Math.hypot(end.x - start.x, end.y - start.y)
  const offset = Math.max(36, Math.min(180, dist * 0.45))
  const [sxN, syN] = portNormal(startPort)
  const [exN, eyN] = portNormal(endPort)
  const p1x = start.x + sxN * offset
  const p1y = start.y + syN * offset
  const p2x = end.x + exN * offset
  const p2y = end.y + eyN * offset
  let cx = (p1x + p2x) / 2
  let cy = (p1y + p2y) / 2

  const mx = (start.x + end.x) / 2
  const my = (start.y + end.y) / 2
  if (Math.hypot(cx - mx, cy - my) < 6) {
    // Gentle arc perpendicular to chord when ports cancel linearly
    const len = Math.max(1, dist)
    const nx = -(end.y - start.y) / len
    const ny = (end.x - start.x) / len
    cx = mx + nx * Math.min(48, Math.max(24, len * 0.16))
    cy = my + ny * Math.min(48, Math.max(24, len * 0.16))
  }

  return [Math.round(cx), Math.round(cy)]
}

function buildConnectorGeometryPatch(
  start: { x: number; y: number },
  startPort: PortSide,
  end: { x: number; y: number },
  endPort: PortSide,
  routing: ConnectorRouting
): Pick<ShapeNode, 'shape' | 'x' | 'y' | 'w' | 'h' | 'points' | 'controlPoint' | 'routing'> {
  if (routing === 'curved') {
    const cp = computeCurvedControlPoint(start, startPort, end, endPort)
    return {
      shape: 'curved-arrow',
      routing: 'curved',
      x: Math.round(start.x),
      y: Math.round(start.y),
      w: Math.round(end.x - start.x),
      h: Math.round(end.y - start.y),
      controlPoint: cp,
      points: undefined
    }
  }

  if (routing === 'straight') {
    return {
      shape: 'arrow',
      routing: 'straight',
      x: Math.round(start.x),
      y: Math.round(start.y),
      w: Math.round(end.x - start.x),
      h: Math.round(end.y - start.y),
      controlPoint: undefined,
      points: undefined
    }
  }

  const pts = computeOrthogonalRoute(start, startPort, end, endPort)
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  return {
    shape: 'polyline',
    routing: 'orthogonal',
    x: minX,
    y: minY,
    w: Math.max(4, Math.max(...xs) - minX),
    h: Math.max(4, Math.max(...ys) - minY),
    points: pts,
    controlPoint: undefined
  }
}

export function buildFlowConnectorNode(opts: {
  source: ShapeNode
  sourcePort: PortSide
  target?: ShapeNode
  targetPort?: PortSide
  freeEnd?: { x: number; y: number }
  routing?: ConnectorRouting
  color?: string
  strokeWidth?: number
  animated?: boolean
  fontFamily?: FontId
  layerId?: string
}): ShapeNode {
  const routing: ConnectorRouting = opts.routing ?? 'orthogonal'
  const startPt = getShapePorts(opts.source)[opts.sourcePort]
  const endPt = opts.target
    ? getShapePorts(opts.target)[opts.targetPort ?? pickNearestPort(opts.target, startPt)]
    : (opts.freeEnd ?? { x: startPt.x + 120, y: startPt.y })
  const endPort = opts.target
    ? (opts.targetPort ?? pickNearestPort(opts.target, startPt))
    : inferFreeEndPort(startPt, endPt, opts.sourcePort)

  const geom = buildConnectorGeometryPatch(startPt, opts.sourcePort, endPt, endPort, routing)
  return {
    id: `conn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    ...geom,
    color: opts.color ?? 'ink',
    fillColor: 'transparent',
    strokeWidth: opts.strokeWidth ?? 2.5,
    arrowStart: false,
    arrowEnd: true,
    ...(opts.animated ? { animated: true } : {}),
    startBinding: { shapeId: opts.source.id, port: opts.sourcePort },
    ...(opts.target ? { endBinding: { shapeId: opts.target.id, port: endPort } } : {}),
    fontFamily: opts.fontFamily,
    layerId: opts.layerId ?? opts.source.layerId
  }
}

function resolveConnectorEndpoints(
  conn: ShapeNode,
  shapeById: Map<string, ShapeNode>
): {
  start: { x: number; y: number }
  startPort: PortSide
  end: { x: number; y: number }
  endPort: PortSide
} {
  const fallbackStart =
    conn.points && conn.points.length >= 2
      ? { x: conn.points[0][0], y: conn.points[0][1] }
      : { x: conn.x, y: conn.y }
  const fallbackEnd =
    conn.points && conn.points.length >= 2
      ? {
          x: conn.points[conn.points.length - 1][0],
          y: conn.points[conn.points.length - 1][1]
        }
      : { x: conn.x + conn.w, y: conn.y + conn.h }

  const startShape = conn.startBinding ? shapeById.get(conn.startBinding.shapeId) : undefined
  const endShape = conn.endBinding ? shapeById.get(conn.endBinding.shapeId) : undefined

  const start =
    startShape && conn.startBinding
      ? getShapePorts(startShape)[conn.startBinding.port]
      : fallbackStart
  const end =
    endShape && conn.endBinding
      ? getShapePorts(endShape)[conn.endBinding.port]
      : fallbackEnd

  const startPort =
    conn.startBinding?.port ?? inferFreeEndPort(end, start, 'left')
  const endPort =
    conn.endBinding?.port ?? inferFreeEndPort(start, end, startPort)

  return { start, startPort, end, endPort }
}

function inferConnectorRouting(conn: ShapeNode): ConnectorRouting {
  if (conn.routing) return conn.routing
  if (conn.shape === 'curved-arrow' || conn.shape === 'curved-line') return 'curved'
  if (conn.shape === 'polyline' || conn.shape === 'elbow') return 'orthogonal'
  return 'straight'
}

export function recomputeConnectorGeometry(
  conn: ShapeNode,
  shapeById: Map<string, ShapeNode>
): ShapeNode {
  if (!conn.startBinding && !conn.endBinding) return conn
  const { start, startPort, end, endPort } = resolveConnectorEndpoints(conn, shapeById)
  const routing = inferConnectorRouting(conn)
  const geom = buildConnectorGeometryPatch(start, startPort, end, endPort, routing)
  return {
    ...conn,
    ...geom
  }
}

export function syncBoundConnectors(shapeNodes: ShapeNode[]): ShapeNode[] {
  const hasBound = shapeNodes.some((s) => Boolean(s.startBinding || s.endBinding))
  if (!hasBound) return shapeNodes
  const shapeById = new Map<string, ShapeNode>()
  for (const s of shapeNodes) {
    shapeById.set(s.id, s)
  }
  return shapeNodes.map((s) =>
    s.startBinding || s.endBinding ? recomputeConnectorGeometry(s, shapeById) : s
  )
}

export function convertConnectorRouting(
  conn: ShapeNode,
  nextRouting: ConnectorRouting,
  shapeById: Map<string, ShapeNode>
): ShapeNode {
  const { start, startPort, end, endPort } = resolveConnectorEndpoints(conn, shapeById)
  const geom = buildConnectorGeometryPatch(start, startPort, end, endPort, nextRouting)
  return {
    ...conn,
    ...geom
  }
}

export function remapDuplicatedConnectors(
  clonedShapes: ShapeNode[],
  idMap: Map<string, string>
): ShapeNode[] {
  const remapped = clonedShapes.map((s) => {
    if (!s.startBinding && !s.endBinding) return s
    return {
      ...s,
      ...(s.startBinding
        ? {
            startBinding: {
              ...s.startBinding,
              shapeId: idMap.get(s.startBinding.shapeId) ?? s.startBinding.shapeId
            }
          }
        : {}),
      ...(s.endBinding
        ? {
            endBinding: {
              ...s.endBinding,
              shapeId: idMap.get(s.endBinding.shapeId) ?? s.endBinding.shapeId
            }
          }
        : {})
    }
  })
  return syncBoundConnectors(remapped)
}

function mapShapeKindToElkKind(shape: ShapeKind): DiagramNodeKind {
  switch (shape) {
    case 'diamond':
    case 'rhombus':
      return 'diamond'
    case 'circle':
    case 'ellipse':
      return 'ellipse'
    case 'cylinder':
    case 'fc-database':
      return 'cylinder'
    case 'parallelogram':
    case 'fc-data':
      return 'parallelogram'
    case 'rect':
    case 'square':
      return 'rect'
    default:
      return 'rounded_rect'
  }
}

/**
 * Extracts a DiagramGraph for ELK.js layout when 2+ board shapes are linked by live connectors.
 */
export function buildGraphFromBoardShapes(
  selectedShapes: ShapeNode[],
  allBoardShapes: ShapeNode[] = selectedShapes
): {
  graph: DiagramGraph
  nodeIds: string[]
  edgeIds: string[]
  anchor: { x: number; y: number }
} | null {
  const nonConnectors = selectedShapes.filter((s) => !isConnectorShape(s))
  if (nonConnectors.length < 2) return null

  const nodeIdSet = new Set(nonConnectors.map((n) => n.id))
  const edgeMap = new Map<string, ShapeNode>()
  for (const c of allBoardShapes) {
    if (!isConnectorShape(c) || !c.startBinding || !c.endBinding) continue
    if (
      nodeIdSet.has(c.startBinding.shapeId) &&
      nodeIdSet.has(c.endBinding.shapeId) &&
      c.startBinding.shapeId !== c.endBinding.shapeId
    ) {
      edgeMap.set(c.id, c)
    }
  }
  if (edgeMap.size === 0) return null

  let minX = Infinity
  let minY = Infinity
  for (const n of nonConnectors) {
    const b = getShapeBoundingRect(n)
    if (b.x < minX) minX = b.x
    if (b.y < minY) minY = b.y
  }

  const graph: DiagramGraph = {
    direction: 'RIGHT',
    nodes: nonConnectors.map((n) => ({
      id: n.id,
      kind: mapShapeKindToElkKind(n.shape),
      label: n.label?.trim() || n.shape
    })),
    edges: Array.from(edgeMap.values()).map((c) => ({
      id: c.id,
      source: c.startBinding!.shapeId,
      target: c.endBinding!.shapeId,
      label: c.label?.trim() || undefined,
      style: c.strokeStyle ?? 'solid',
      directed: c.arrowEnd !== false,
      bidirectional: Boolean(c.arrowStart && c.arrowEnd !== false)
    }))
  }

  return {
    graph,
    nodeIds: nonConnectors.map((n) => n.id),
    edgeIds: Array.from(edgeMap.keys()),
    anchor: {
      x: Number.isFinite(minX) ? Math.round(minX) : 120,
      y: Number.isFinite(minY) ? Math.round(minY) : 120
    }
  }
}
