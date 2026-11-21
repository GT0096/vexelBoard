import type {
  DiagramDirection,
  DiagramGraph,
  DiagramGraphEdge,
  DiagramGraphNode,
  DiagramNodeKind
} from '@shared/beautifySchema'
import type { FontId, PortSide, ShapeKind, ShapeNode, TextNode } from '../types/board'

function pickPortForPoint(node: ShapeNode, pt: [number, number]): PortSide {
  const ports: Array<[PortSide, number, number]> = [
    ['top', node.x + node.w / 2, node.y],
    ['right', node.x + node.w, node.y + node.h / 2],
    ['bottom', node.x + node.w / 2, node.y + node.h],
    ['left', node.x, node.y + node.h / 2]
  ]
  let bestPort: PortSide = 'left'
  let bestDist = Infinity
  for (const [port, px, py] of ports) {
    const d = Math.hypot(pt[0] - px, pt[1] - py)
    if (d < bestDist) {
      bestDist = d
      bestPort = port
    }
  }
  return bestPort
}

export interface MeasuredSize {
  width: number
  height: number
}

export interface ElkPoint {
  x: number
  y: number
}

export interface ElkEdgeSection {
  id: string
  startPoint: ElkPoint
  endPoint: ElkPoint
  bendPoints?: ElkPoint[]
}

export interface ElkLayoutNode {
  id: string
  x?: number
  y?: number
  width?: number
  height?: number
  children?: ElkLayoutNode[]
  edges?: ElkLayoutEdge[]
}

export interface ElkLayoutEdge {
  id: string
  sources: string[]
  targets: string[]
  sections?: ElkEdgeSection[]
  container?: string
}

export interface ElkGraphPayload {
  id: string
  layoutOptions: Record<string, string>
  children: Array<{
    id: string
    width?: number
    height?: number
    layoutOptions?: Record<string, string>
    children?: unknown[]
    edges?: unknown[]
  }>
  edges: Array<{
    id: string
    sources: string[]
    targets: string[]
  }>
}

export interface FlattenedDiagramLayout {
  shapes: ShapeNode[]
  texts: TextNode[]
  groupId: string
  width: number
  height: number
}

const KIND_TO_SHAPE: Record<DiagramNodeKind, ShapeKind> = {
  rect: 'rect',
  rounded_rect: 'rounded-rect',
  diamond: 'diamond',
  ellipse: 'circle',
  cylinder: 'cylinder',
  parallelogram: 'parallelogram',
  group: 'rect'
}

const FONT_CSS_MAP: Record<FontId, string> = {
  jakarta: '"Plus Jakarta Sans", sans-serif',
  caveat: '"Caveat", cursive',
  grotesk: '"Space Grotesk", sans-serif',
  mono: '"JetBrains Mono", monospace',
  serif: '"Georgia", "Times New Roman", serif'
}

/**
 * Measures real label dimensions in the renderer using CanvasRenderingContext2D.measureText
 * with the active canvas font so text never overflows node boxes.
 */
export function measureDiagramNodeLabels(
  graph: DiagramGraph,
  fontFamily: FontId
): Record<string, MeasuredSize> {
  const sizes: Record<string, MeasuredSize> = {}
  const fontCss = FONT_CSS_MAP[fontFamily] ?? FONT_CSS_MAP.jakarta

  let ctx: CanvasRenderingContext2D | null = null
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas')
    ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.font = `700 16px ${fontCss}`
    }
  }

  for (const node of graph.nodes) {
    if (node.kind === 'group') {
      sizes[node.id] = { width: 220, height: 140 }
      continue
    }

    const label = (node.label || '').trim()
    const lines = label ? label.split('\n') : ['']
    let maxLineW = 48
    for (const line of lines) {
      const w = ctx ? ctx.measureText(line).width : line.length * 10
      if (w > maxLineW) maxLineW = w
    }

    const isShortSingle = label.length > 0 && label.length <= 3 && lines.length === 1
    if (node.kind === 'diamond') {
      const w = Math.max(108, Math.min(260, Math.round(maxLineW * 1.65 + 44)))
      const h = Math.max(76, Math.min(180, Math.round(lines.length * 24 + 54)))
      sizes[node.id] = { width: w, height: h }
    } else if (node.kind === 'ellipse') {
      const d = isShortSingle
        ? 56
        : Math.max(72, Math.min(220, Math.round(maxLineW + 44)))
      const h = isShortSingle ? 56 : Math.max(54, Math.round(lines.length * 24 + 34))
      sizes[node.id] = { width: d, height: h }
    } else if (node.kind === 'cylinder') {
      const w = Math.max(110, Math.min(240, Math.round(maxLineW + 48)))
      const h = Math.max(76, Math.round(lines.length * 22 + 54))
      sizes[node.id] = { width: w, height: h }
    } else {
      const w = isShortSingle
        ? 96
        : Math.max(116, Math.min(280, Math.round(maxLineW + 44)))
      const h = Math.max(50, Math.round(lines.length * 24 + 28))
      sizes[node.id] = { width: w, height: h }
    }
  }

  return sizes
}

/**
 * Builds an ELK layered orthogonal hierarchical graph input from our Zod-validated DiagramGraph.
 */
export function buildElkGraphInput(
  graph: DiagramGraph,
  measuredSizes: Record<string, MeasuredSize>,
  directionOverride?: DiagramDirection
): ElkGraphPayload {
  const direction = directionOverride ?? graph.direction ?? 'RIGHT'
  const nodeById = new Map<string, DiagramGraphNode>()
  for (const n of graph.nodes) nodeById.set(n.id, n)

  const childrenByParent = new Map<string, DiagramGraphNode[]>()
  const rootNodes: DiagramGraphNode[] = []

  for (const n of graph.nodes) {
    if (n.parentId && n.parentId !== n.id && nodeById.has(n.parentId)) {
      const list = childrenByParent.get(n.parentId) ?? []
      list.push(n)
      childrenByParent.set(n.parentId, list)
    } else {
      rootNodes.push(n)
    }
  }

  const buildNode = (n: DiagramGraphNode): ElkGraphPayload['children'][number] => {
    const kids = childrenByParent.get(n.id) ?? []
    if (kids.length > 0 || n.kind === 'group') {
      return {
        id: n.id,
        layoutOptions: {
          'elk.padding': '[top=40,left=24,bottom=24,right=24]',
          'elk.spacing.nodeNode': '32',
          'elk.layered.spacing.nodeNodeBetweenLayers': '48'
        },
        children: kids.map(buildNode)
      }
    }
    const sz = measuredSizes[n.id] ?? { width: 136, height: 56 }
    return {
      id: n.id,
      width: sz.width,
      height: sz.height
    }
  }

  const validEdges = (graph.edges ?? []).filter(
    (e) => nodeById.has(e.source) && nodeById.has(e.target) && e.source !== e.target
  )

  return {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction,
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.spacing.nodeNode': '42',
      'elk.layered.spacing.nodeNodeBetweenLayers': '68',
      'elk.layered.spacing.edgeNodeBetweenLayers': '28',
      'elk.spacing.edgeEdge': '18',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF'
    },
    children: rootNodes.map(buildNode),
    edges: validEdges.map((e) => ({
      id: e.id,
      sources: [e.source],
      targets: [e.target]
    }))
  }
}

/**
 * Flattens ELK hierarchical child `(x, y)` coordinates and orthogonal edge sections
 * (`startPoint`, `bendPoints`, `endPoint`) into world-anchored native board shapes & immersed labels.
 */
export function flattenElkLayoutResult(
  elkOut: ElkLayoutNode,
  graph: DiagramGraph,
  anchor: { x: number; y: number },
  fontFamily: FontId,
  existingGroupId?: string
): FlattenedDiagramLayout {
  const now = Date.now()
  const groupId = existingGroupId ?? `velk-${now.toString(36)}`
  const nodeById = new Map<string, DiagramGraphNode>()
  for (const n of graph.nodes) nodeById.set(n.id, n)

  const edgeById = new Map<string, DiagramGraphEdge>()
  for (const e of graph.edges ?? []) edgeById.set(e.id, e)

  const groupShapes: ShapeNode[] = []
  const nodeShapes: ShapeNode[] = []
  const edgeShapes: ShapeNode[] = []
  const texts: TextNode[] = []
  const nodeShapeByGraphId = new Map<string, ShapeNode>()

  // Track absolute origin of every container (so container-relative edges flatten accurately)
  const containerOrigin = new Map<string, { x: number; y: number }>()
  containerOrigin.set('root', { x: anchor.x, y: anchor.y })

  const allLaidOutEdges: Array<{ edge: ElkLayoutEdge; offsetX: number; offsetY: number }> = []

  const walkNode = (elkNode: ElkLayoutNode, parentX: number, parentY: number): void => {
    const absX = Math.round(parentX + (elkNode.x ?? 0))
    const absY = Math.round(parentY + (elkNode.y ?? 0))
    const w = Math.max(32, Math.round(elkNode.width ?? 120))
    const h = Math.max(32, Math.round(elkNode.height ?? 56))
    containerOrigin.set(elkNode.id, { x: absX, y: absY })

    const meta = nodeById.get(elkNode.id)
    if (meta) {
      const isGroup = meta.kind === 'group' || (elkNode.children && elkNode.children.length > 0)
      if (isGroup) {
        groupShapes.push({
          id: `vgrp-${groupId}-${meta.id}`,
          shape: 'rect',
          x: absX,
          y: absY,
          w,
          h,
          borderRadius: 10,
          color: meta.strokeColor || 'ink',
          fillColor: meta.fillColor || 'rgba(148, 163, 184, 0.10)',
          strokeWidth: 2,
          strokeStyle: 'dashed',
          fontFamily,
          vectorGroupId: groupId
        })
        if (meta.label.trim()) {
          texts.push({
            id: `vgrptxt-${groupId}-${meta.id}`,
            x: absX + 12,
            y: absY + 8,
            text: meta.label.trim(),
            style: 'h2',
            bold: true,
            fontSize: 15,
            color: 'ink',
            bg: 'transparent',
            immersed: true,
            fontFamily,
            align: 'left',
            source: 'ocr',
            createdAt: now
          })
        }
      } else {
        const shapeKind = KIND_TO_SHAPE[meta.kind] ?? 'rounded-rect'
        const isSharpRect = meta.kind === 'rect'
        const createdNode: ShapeNode = {
          id: `vnode-${groupId}-${meta.id}`,
          shape: shapeKind,
          x: absX,
          y: absY,
          w,
          h,
          borderRadius: isSharpRect ? 0 : shapeKind === 'rounded-rect' ? 10 : undefined,
          label: meta.label.trim() || undefined,
          labelBold: true,
          color: meta.strokeColor || 'ink',
          fillColor: meta.fillColor || '#FEF9C3',
          strokeWidth: 2.5,
          fontFamily,
          vectorGroupId: groupId
        }
        nodeShapes.push(createdNode)
        nodeShapeByGraphId.set(meta.id, createdNode)
      }
    }

    if (elkNode.edges) {
      for (const e of elkNode.edges) {
        allLaidOutEdges.push({ edge: e, offsetX: absX, offsetY: absY })
      }
    }

    if (elkNode.children) {
      for (const ch of elkNode.children) {
        walkNode(ch, absX, absY)
      }
    }
  }

  // Walk root children & collect root edges
  if (elkOut.edges) {
    for (const e of elkOut.edges) {
      allLaidOutEdges.push({ edge: e, offsetX: anchor.x, offsetY: anchor.y })
    }
  }
  for (const child of elkOut.children ?? []) {
    walkNode(child, anchor.x, anchor.y)
  }

  // Flatten orthogonal edge sections
  for (const { edge, offsetX, offsetY } of allLaidOutEdges) {
    const meta = edgeById.get(edge.id)
    const origin =
      edge.container && containerOrigin.has(edge.container)
        ? containerOrigin.get(edge.container)!
        : { x: offsetX, y: offsetY }

    const sec = edge.sections?.[0]
    if (!sec) continue

    const pts: Array<[number, number]> = [
      [Math.round(origin.x + sec.startPoint.x), Math.round(origin.y + sec.startPoint.y)],
      ...(sec.bendPoints ?? []).map(
        (bp) => [Math.round(origin.x + bp.x), Math.round(origin.y + bp.y)] as [number, number]
      ),
      [Math.round(origin.x + sec.endPoint.x), Math.round(origin.y + sec.endPoint.y)]
    ]

    const xs = pts.map((p) => p[0])
    const ys = pts.map((p) => p[1])
    const minX = Math.min(...xs)
    const minY = Math.min(...ys)

    const srcShape = nodeShapeByGraphId.get(edge.sources?.[0] ?? '')
    const tgtShape = nodeShapeByGraphId.get(edge.targets?.[0] ?? '')

    edgeShapes.push({
      id: `vedge-${groupId}-${edge.id}`,
      shape: 'polyline',
      routing: 'orthogonal',
      x: minX,
      y: minY,
      w: Math.max(4, Math.max(...xs) - minX),
      h: Math.max(4, Math.max(...ys) - minY),
      points: pts,
      arrowEnd: meta ? meta.directed !== false : true,
      arrowStart: Boolean(meta?.bidirectional),
      ...(srcShape ? { startBinding: { shapeId: srcShape.id, port: pickPortForPoint(srcShape, pts[0]) } } : {}),
      ...(tgtShape ? { endBinding: { shapeId: tgtShape.id, port: pickPortForPoint(tgtShape, pts[pts.length - 1]) } } : {}),
      strokeStyle: meta?.style ?? 'solid',
      label: meta?.label?.trim() || undefined,
      color: 'ink',
      fillColor: 'transparent',
      strokeWidth: 2.5,
      fontFamily,
      vectorGroupId: groupId
    })
  }

  // Optional diagram title cleanly above the layout
  if (graph.title && graph.title.trim()) {
    texts.push({
      id: `vtitle-${groupId}`,
      x: Math.round(anchor.x),
      y: Math.round(anchor.y - 36),
      text: graph.title.trim(),
      style: 'h2',
      bold: true,
      fontSize: 22,
      color: 'ink',
      bg: 'transparent',
      immersed: true,
      fontFamily,
      align: 'left',
      source: 'ocr',
      createdAt: now
    })
  }

  return {
    // Draw group frames behind nodes, and edges cleanly alongside
    shapes: [...groupShapes, ...nodeShapes, ...edgeShapes],
    texts,
    groupId,
    width: Math.round(elkOut.width ?? 400),
    height: Math.round(elkOut.height ?? 300)
  }
}

/* ------------------------------------------------------------------ */
/* Persistent ELK.js Renderer Web Worker Client (<20ms local re-layout) */
/* ------------------------------------------------------------------ */

let sharedElkWorker: Worker | null = null
let elkReqCounter = 0
const pendingElkRequests = new Map<
  number,
  { resolve: (out: ElkLayoutNode) => void; reject: (err: Error) => void }
>()

function getElkWorker(): Worker {
  if (!sharedElkWorker) {
    sharedElkWorker = new Worker(new URL('../workers/elkLayout.worker.ts', import.meta.url), {
      type: 'module'
    })
    sharedElkWorker.onmessage = (
      e: MessageEvent<{ reqId: number; ok: boolean; layout?: ElkLayoutNode; error?: string }>
    ) => {
      const pending = pendingElkRequests.get(e.data.reqId)
      if (!pending) return
      pendingElkRequests.delete(e.data.reqId)
      if (e.data.ok && e.data.layout) {
        pending.resolve(e.data.layout)
      } else {
        pending.reject(new Error(e.data.error || 'ELK layout worker failed'))
      }
    }
    sharedElkWorker.onerror = (err) => {
      for (const [, p] of pendingElkRequests) {
        p.reject(new Error(err.message || 'ELK worker crashed'))
      }
      pendingElkRequests.clear()
      sharedElkWorker?.terminate()
      sharedElkWorker = null
    }
  }
  return sharedElkWorker
}

export async function layoutDiagramWithElkWorker(
  graph: DiagramGraph,
  anchor: { x: number; y: number },
  fontFamily: FontId,
  opts?: { directionOverride?: DiagramDirection; existingGroupId?: string }
): Promise<FlattenedDiagramLayout> {
  const measured = measureDiagramNodeLabels(graph, fontFamily)
  const elkInput = buildElkGraphInput(graph, measured, opts?.directionOverride)

  const reqId = ++elkReqCounter
  const worker = getElkWorker()
  const elkOut = await new Promise<ElkLayoutNode>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      if (pendingElkRequests.has(reqId)) {
        pendingElkRequests.delete(reqId)
        reject(new Error('ELK layout timed out'))
      }
    }, 10_000)

    pendingElkRequests.set(reqId, {
      resolve: (out) => {
        window.clearTimeout(timer)
        resolve(out)
      },
      reject: (err) => {
        window.clearTimeout(timer)
        reject(err)
      }
    })
    worker.postMessage({ reqId, graph: elkInput })
  })

  return flattenElkLayoutResult(elkOut, graph, anchor, fontFamily, opts?.existingGroupId)
}
