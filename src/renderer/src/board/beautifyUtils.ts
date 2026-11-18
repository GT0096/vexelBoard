import type { BoardState, DiagramNode, InkPoint } from '../types/board'
import type { Node as RFNode, Edge as RFEdge } from '@xyflow/react'
import { MarkerType } from '@xyflow/react'
import { layoutReactFlowElements, preserveAndTidySpatialLayout } from './flowLayout'
import {
  drawLibraryShapeOnCanvas,
  getLibraryShape,
  SHAPE_BY_ID,
  type LibraryShapeDef
} from '../shapes/shapeLibrary'
import { classifyClosedPolygon, classifyStrokeShape } from '../vision/shapeSnapper'

export interface CreateDiagramArgs {
  title?: string
  diagramType?: string
  layoutDirection?: 'TB' | 'LR'
  nodes: Array<{
    id?: string | number
    type?: string
    label?: string
    name?: string
    title?: string
    description?: string
    desc?: string
    subline?: string
    x?: number
    y?: number
    color?: string
    width?: number
    height?: number
    data?: Record<string, unknown>
  }>
  edges?: Array<{
    id?: string
    source?: string | number
    target?: string | number
    from?: string | number
    to?: string | number
    label?: string
    text?: string
    animated?: boolean
    color?: string
  }>
}

export interface DiagramImageResult {
  base64: string
  bounds: {
    minX: number
    minY: number
    maxX: number
    maxY: number
    w: number
    h: number
    x: number
    y: number
  }
  textHints: string
  strokeCount: number
  shapeCount: number
  textCount: number
}

export type DetectedDiagramType =
  | 'flowchart'
  | 'architecture'
  | 'circuit'
  | 'ui'
  | 'sequence'
  | 'er'
  | 'other'

export interface CleanReactFlowResult {
  title: string
  nodes: RFNode[]
  edges: RFEdge[]
  diagramType: DetectedDiagramType
  isTextOnly?: boolean
  recognizedText?: string
  preservePositions?: boolean
}

/**
 * Renders all selected strokes, shapes, and texts onto a high-contrast canvas image
 * tailored for multimodal vision models (Gemma 4 on Ollama cloud, GPT-4o, Gemini 2.5, Claude).
 */
export function renderSelectedDiagramToImage(
  board: BoardState,
  selectedIds: string[],
  _themeTokens?: unknown
): DiagramImageResult | null {
  const idSet = new Set(selectedIds)
  const selStrokes = board.strokes.filter((s) => idSet.has(s.id))
  const selShapes = board.shapeNodes.filter((s) => idSet.has(s.id))
  const selTexts = board.textNodes.filter((t) => idSet.has(t.id))
  const selEquations = board.equationNodes.filter((eq) => idSet.has(eq.id))

  if (
    selStrokes.length === 0 &&
    selShapes.length === 0 &&
    selTexts.length === 0 &&
    selEquations.length === 0
  ) {
    return null
  }

  // Calculate bounding box
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const st of selStrokes) {
    for (const [px, py] of st.points) {
      if (px < minX) minX = px
      if (py < minY) minY = py
      if (px > maxX) maxX = px
      if (py > maxY) maxY = py
    }
  }

  for (const s of selShapes) {
    const sx1 = Math.min(s.x, s.x + s.w)
    const sx2 = Math.max(s.x, s.x + s.w)
    const sy1 = Math.min(s.y, s.y + s.h)
    const sy2 = Math.max(s.y, s.y + s.h)
    if (sx1 < minX) minX = sx1
    if (sy1 < minY) minY = sy1
    if (sx2 > maxX) maxX = sx2
    if (sy2 > maxY) maxY = sy2
  }

  for (const t of selTexts) {
    const tw = t.w ?? 220
    const th = t.h ?? 80
    if (t.x < minX) minX = t.x
    if (t.y < minY) minY = t.y
    if (t.x + tw > maxX) maxX = t.x + tw
    if (t.y + th > maxY) maxY = t.y + th
  }

  for (const eq of selEquations) {
    const ew = eq.w ?? 200
    const eh = eq.h ?? 60
    if (eq.x < minX) minX = eq.x
    if (eq.y < minY) minY = eq.y
    if (eq.x + ew > maxX) maxX = eq.x + ew
    if (eq.y + eh > maxY) maxY = eq.y + eh
  }

  if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) {
    return null
  }

  const pad = 48
  minX -= pad
  minY -= pad
  maxX += pad
  maxY += pad

  const rawW = Math.max(120, maxX - minX)
  const rawH = Math.max(120, maxY - minY)

  // Target max dimension ~1280px for optimal vision model accuracy & token speed
  const maxDim = 1280
  const scale = Math.min(1.5, Math.min(maxDim / rawW, maxDim / rawH))
  const canvasW = Math.round(rawW * scale)
  const canvasH = Math.round(rawH * scale)

  const canvas = document.createElement('canvas')
  canvas.width = canvasW
  canvas.height = canvasH
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null

  // Crisp white background for optimal vision model and OCR detection (Gemma 4, Claude, GPT-4o)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvasW, canvasH)

  ctx.save()
  ctx.scale(scale, scale)
  ctx.translate(-minX, -minY)

  // 1. Draw geometric shapes
  for (const s of selShapes) {
    ctx.save()
    ctx.strokeStyle = '#0284c7'
    ctx.lineWidth = Math.max(3, s.strokeWidth ?? 3)
    ctx.fillStyle = s.fillColor && s.fillColor !== 'transparent' ? s.fillColor : 'rgba(2, 132, 199, 0.08)'

    const x = s.w < 0 ? s.x + s.w : s.x
    const y = s.h < 0 ? s.y + s.h : s.y
    const w = Math.abs(s.w)
    const h = Math.abs(s.h)

    ctx.beginPath()
    if (s.shape === 'rect' || s.shape === 'component') {
      ctx.strokeRect(x, y, w, h)
      ctx.fillRect(x, y, w, h)
    } else if (s.shape === 'rounded-rect' || s.shape === 'actor') {
      const r = Math.min(16, w / 4, h / 4)
      ctx.roundRect(x, y, w, h, r)
      ctx.stroke()
      ctx.fill()
    } else if (s.shape === 'circle' || s.shape === 'sphere3d') {
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
      ctx.stroke()
      ctx.fill()
    } else if (s.shape === 'diamond') {
      ctx.moveTo(x + w / 2, y)
      ctx.lineTo(x + w, y + h / 2)
      ctx.lineTo(x + w / 2, y + h)
      ctx.lineTo(x, y + h / 2)
      ctx.closePath()
      ctx.stroke()
      ctx.fill()
    } else if (s.shape === 'cylinder' || s.shape === 'cylinder3d') {
      const ry = Math.min(18, h / 5)
      ctx.beginPath()
      ctx.ellipse(x + w / 2, y + ry, w / 2, ry, 0, 0, Math.PI * 2)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(x, y + ry)
      ctx.lineTo(x, y + h - ry)
      ctx.ellipse(x + w / 2, y + h - ry, w / 2, ry, 0, 0, Math.PI)
      ctx.lineTo(x + w, y + ry)
      ctx.stroke()
    } else if (s.shape === 'arrow' || s.shape === 'line' || s.shape === 'elbow') {
      ctx.beginPath()
      ctx.moveTo(s.x, s.y)
      ctx.lineTo(s.x + s.w, s.y + s.h)
      ctx.stroke()
      // Draw arrowhead
      const angle = Math.atan2(s.h, s.w)
      const headlen = 16
      ctx.beginPath()
      ctx.moveTo(s.x + s.w, s.y + s.h)
      ctx.lineTo(
        s.x + s.w - headlen * Math.cos(angle - Math.PI / 6),
        s.y + s.h - headlen * Math.sin(angle - Math.PI / 6)
      )
      ctx.moveTo(s.x + s.w, s.y + s.h)
      ctx.lineTo(
        s.x + s.w - headlen * Math.cos(angle + Math.PI / 6),
        s.y + s.h - headlen * Math.sin(angle + Math.PI / 6)
      )
      ctx.stroke()
    } else {
      const libShape = getLibraryShape(s.shape)
      if (libShape) {
        drawLibraryShapeOnCanvas(
          ctx,
          libShape,
          x,
          y,
          w,
          h,
          '#0284c7',
          s.fillColor && s.fillColor !== 'transparent' ? s.fillColor : 'rgba(2, 132, 199, 0.08)',
          Math.max(3, s.strokeWidth ?? 3)
        )
      } else {
        ctx.strokeRect(x, y, w, h)
      }
    }

    if (s.label) {
      ctx.fillStyle = '#0f172a'
      ctx.font = 'bold 16px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(s.label, x + w / 2, y + h / 2)
    }
    ctx.restore()
  }

  // 2. Draw user hand strokes with clear dark ink
  for (const st of selStrokes) {
    if (st.points.length < 2) continue
    ctx.save()
    ctx.strokeStyle = '#0f172a'
    ctx.lineWidth = Math.max(3.5, (st.size || 3) * 1.3)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    ctx.beginPath()
    ctx.moveTo(st.points[0][0], st.points[0][1])
    for (let i = 1; i < st.points.length; i++) {
      ctx.lineTo(st.points[i][0], st.points[i][1])
    }
    ctx.stroke()
    ctx.restore()
  }

  // 3. Draw text nodes with crisp readability
  const extractedTextHints: string[] = []
  for (const t of selTexts) {
    ctx.save()
    const content = t.title ? `${t.title}: ${t.text}` : t.text
    extractedTextHints.push(content)
    ctx.fillStyle = '#0f172a'
    ctx.font = `bold ${Math.max(16, t.fontSize || 16)}px sans-serif`
    ctx.textBaseline = 'top'
    ctx.fillText(t.title ?? t.text, t.x, t.y)
    ctx.restore()
  }

  for (const eq of selEquations) {
    ctx.save()
    extractedTextHints.push(`Formula: ${eq.latex}`)
    ctx.fillStyle = '#a7f3d0'
    ctx.font = `bold ${Math.max(16, eq.fontSize || 18)}px monospace`
    ctx.textBaseline = 'top'
    ctx.fillText(eq.latex, eq.x, eq.y)
    ctx.restore()
  }

  ctx.restore()

  const dataUrl = canvas.toDataURL('image/png')
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '')

  return {
    base64,
    bounds: {
      minX,
      minY,
      maxX,
      maxY,
      w: maxX - minX,
      h: maxY - minY,
      x: minX,
      y: minY
    },
    textHints: extractedTextHints.join(' | '),
    strokeCount: selStrokes.length,
    shapeCount: selShapes.length,
    textCount: selTexts.length + selEquations.length
  }
}

export interface ParseReactFlowOptions {
  preservePositions?: boolean
  targetBounds?: { w?: number; h?: number }
  localFallback?: CleanReactFlowResult
}

/**
 * Parses, sanitizes, and prepares React Flow nodes and edges from AI JSON output.
 */
export function parseAndCleanReactFlow(raw: string, opts?: ParseReactFlowOptions): CleanReactFlowResult {
  let cleaned = (raw || '').trim()

  // Remove potential markdown code fences
  const jsonFenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(cleaned)
  if (jsonFenced && jsonFenced[1].trim()) {
    cleaned = jsonFenced[1].trim()
  }

  interface RawNode {
    id?: string | number
    type?: string
    label?: string
    name?: string
    title?: string
    description?: string
    desc?: string
    subline?: string
    x?: number
    y?: number
    width?: number
    height?: number
    color?: string
    position?: { x?: number; y?: number }
    data?: Record<string, unknown>
  }

  interface RawEdge {
    id?: string
    source?: string | number
    target?: string | number
    from?: string | number
    to?: string | number
    label?: string
    text?: string
    animated?: boolean
  }

  interface RawFlowData {
    title?: string
    diagramType?: string
    orientation?: string
    direction?: string
    layoutDirection?: string
    isTextOnly?: boolean
    recognizedText?: string
    text?: string
    nodes?: RawNode[]
    edges?: RawEdge[]
  }

  let parsed: RawFlowData | null = null

  // 1. Try direct JSON parse or regex extract
  let rawJsonObj: unknown = null
  try {
    rawJsonObj = JSON.parse(cleaned)
  } catch {
    const startIdx = cleaned.indexOf('{')
    const endIdx = cleaned.lastIndexOf('}')
    if (startIdx >= 0 && endIdx > startIdx) {
      try {
        rawJsonObj = JSON.parse(cleaned.slice(startIdx, endIdx + 1))
      } catch {
        /* proceed to fallback */
      }
    }
  }

  // 2. Unwrap Agentic tool_calls, "tool": "create_diagram", or direct diagram object
  if (rawJsonObj && typeof rawJsonObj === 'object') {
    const obj = rawJsonObj as Record<string, unknown>
    if (obj.isTextOnly === true && typeof (obj.recognizedText ?? obj.text) === 'string') {
      return {
        title: 'Recognized Text',
        nodes: [],
        edges: [],
        diagramType: 'flowchart',
        isTextOnly: true,
        recognizedText: String(obj.recognizedText ?? obj.text ?? '').trim()
      }
    }
    if (obj.tool_calls && Array.isArray(obj.tool_calls) && obj.tool_calls[0]) {
      const tc = obj.tool_calls[0] as Record<string, unknown>
      const fn = (tc.function || tc) as Record<string, unknown>
      const fnArgs = fn.arguments || fn.parameters
      parsed = (typeof fnArgs === 'string' ? JSON.parse(fnArgs) : fnArgs) as RawFlowData
    } else if (obj.tool === 'create_diagram' || obj.name === 'create_diagram') {
      const toolArgs = obj.arguments || obj.parameters
      parsed = (typeof toolArgs === 'string' ? JSON.parse(toolArgs) : toolArgs) as RawFlowData
    } else if (obj.function && typeof obj.function === 'object') {
      const fn = obj.function as Record<string, unknown>
      const fnArgs = fn.arguments || fn.parameters
      parsed = (typeof fnArgs === 'string' ? JSON.parse(fnArgs) : fnArgs) as RawFlowData
    } else if (Array.isArray(obj.nodes)) {
      parsed = obj as RawFlowData
    } else if (obj.diagram && typeof obj.diagram === 'object') {
      parsed = obj.diagram as RawFlowData
    } else if (typeof (obj.recognizedText ?? obj.text) === 'string') {
      return {
        title: 'Recognized Text',
        nodes: [],
        edges: [],
        diagramType: 'flowchart',
        isTextOnly: true,
        recognizedText: String(obj.recognizedText ?? obj.text ?? '').trim()
      }
    }
  }

  if (parsed?.isTextOnly && typeof (parsed.recognizedText ?? parsed.text) === 'string') {
    return {
      title: 'Recognized Text',
      nodes: [],
      edges: [],
      diagramType: 'flowchart',
      isTextOnly: true,
      recognizedText: String(parsed.recognizedText ?? parsed.text ?? '').trim()
    }
  }

  // Fallback if parsing completely failed
  if (!parsed || !Array.isArray(parsed.nodes) || parsed.nodes.length === 0) {
    return createDefaultFallbackFlow(cleaned)
  }

  const title = (parsed.title || '✨ Interactive Diagram').trim()
  const rawType = (parsed.diagramType || 'flowchart').toLowerCase()
  const diagramType: DetectedDiagramType =
    rawType.includes('arch')
      ? 'architecture'
      : rawType.includes('circuit')
        ? 'circuit'
        : rawType.includes('ui')
          ? 'ui'
          : rawType.includes('seq')
            ? 'sequence'
            : rawType.includes('er')
              ? 'er'
              : 'flowchart'

  const idMap = new Map<string, string>()

  const resolveSemanticToLibraryId = (lower: string): string | null => {
    if (lower.includes('start') || lower.includes('end') || lower.includes('terminal')) {
      return 'stadium'
    }
    if (lower.includes('decision') || lower.includes('condition') || lower.includes('diamond')) {
      return 'rhombus'
    }
    if (
      lower.includes('database') ||
      lower.includes('store') ||
      lower.includes('table') ||
      lower.includes('sql') ||
      lower.includes('repo')
    ) {
      return 'cylinder-3d'
    }
    if (
      lower.includes('cloud') ||
      lower.includes('api') ||
      lower.includes('gateway') ||
      lower.includes('network') ||
      lower.includes('aws')
    ) {
      return 'cloud'
    }
    if (
      lower.includes('doc') ||
      lower.includes('file') ||
      lower.includes('spec') ||
      lower.includes('paper')
    ) {
      return 'fc-document'
    }
    if (
      lower.includes('io') ||
      lower.includes('input') ||
      lower.includes('output') ||
      lower.includes('parallelogram') ||
      lower.includes('display')
    ) {
      return 'parallelogram'
    }
    if (
      lower.includes('actor') ||
      lower.includes('user') ||
      lower.includes('person') ||
      lower.includes('human') ||
      lower.includes('role') ||
      lower.includes('client')
    ) {
      return 'uml-actor'
    }
    if (lower.includes('note') || lower.includes('memo')) {
      return 'uml-note'
    }
    if (lower.includes('process') || lower.includes('step') || lower.includes('action')) {
      return 'rounded-rectangle'
    }
    return null
  }

  // Normalize nodes onto Miro & draw.io library shapes (while preserving sticky/group/circle/custom)
  const nodes: RFNode[] = parsed.nodes.map((n, idx) => {
    const rawId = String(n.id ?? idx + 1).trim()
    const safeId = `node-${rawId || idx + 1}`
    idMap.set(rawId, safeId)

    const rawNodeType = (n.type || 'process').trim()
    const lower = rawNodeType.toLowerCase()
    let type: string
    let matchedLibShape: LibraryShapeDef | undefined

    if (lower === 'sticky' || lower.includes('sticky') || lower.includes('postit')) {
      type = 'sticky'
    } else if (
      lower === 'group' ||
      lower.includes('group') ||
      lower.includes('frame') ||
      lower.includes('boundary') ||
      lower.includes('subgraph')
    ) {
      type = 'group'
    } else if (lower === 'custom') {
      type = 'custom'
    } else {
      const directLib = SHAPE_BY_ID.get(lower) ?? getLibraryShape(rawNodeType)
      if (directLib && (SHAPE_BY_ID.has(lower) || lower.includes('-'))) {
        matchedLibShape = directLib
        type = directLib.id
      } else {
        const mappedId = resolveSemanticToLibraryId(lower)
        const mappedLib = mappedId ? getLibraryShape(mappedId) : directLib
        if (mappedLib) {
          matchedLibShape = mappedLib
          type = mappedLib.id
        } else if (lower.includes('circle') || lower.includes('round') || lower.includes('state')) {
          matchedLibShape = getLibraryShape('circle')
          type = matchedLibShape ? matchedLibShape.id : 'circle'
        } else {
          matchedLibShape = getLibraryShape('rounded-rectangle')
          type = matchedLibShape ? matchedLibShape.id : 'rounded-rectangle'
        }
      }
    }

    const explicitLabel = n.label ?? n.name ?? n.title
    const label =
      explicitLabel !== undefined
        ? String(explicitLabel).trim()
        : matchedLibShape?.defaultLabel !== undefined
          ? matchedLibShape.defaultLabel
          : matchedLibShape?.name ?? `Step ${idx + 1}`

    let description = String(n.description ?? n.desc ?? n.subline ?? '').trim()
    const labelLower = label.toLowerCase()
    const descLower = description.toLowerCase()
    if (
      descLower === labelLower ||
      descLower === `document ${labelLower}` ||
      descLower === `node ${labelLower}` ||
      descLower === `shape ${labelLower}` ||
      descLower === `step ${labelLower}` ||
      descLower === `process ${labelLower}` ||
      descLower === `circle ${labelLower}`
    ) {
      description = ''
    }

    // Prevent plain labeled boxes ("E", "F") from rendering as wavy document shapes in Beautify mode
    if (
      opts?.preservePositions &&
      type === 'fc-document' &&
      label.length <= 3 &&
      !descLower.includes('doc') &&
      !opts.localFallback?.nodes.some((ln) => ln.type === 'fc-document')
    ) {
      const rectLib = getLibraryShape('rectangle')
      if (rectLib) {
        matchedLibShape = rectLib
        type = rectLib.id
      }
    }

    const posX =
      typeof n.position?.x === 'number'
        ? n.position.x
        : typeof n.x === 'number'
          ? n.x
          : 100 + (idx % 3) * 220
    const posY =
      typeof n.position?.y === 'number'
        ? n.position.y
        : typeof n.y === 'number'
          ? n.y
          : 80 + Math.floor(idx / 3) * 140

    const resolvedW =
      typeof n.width === 'number'
        ? n.width
        : typeof n.data?.w === 'number'
          ? n.data.w
          : matchedLibShape?.size[0]
    const resolvedH =
      typeof n.height === 'number'
        ? n.height
        : typeof n.data?.h === 'number'
          ? n.data.h
          : matchedLibShape?.size[1]

    const libSize = matchedLibShape
      ? {
          w: resolvedW,
          h: resolvedH,
          shapeId: (n.data?.shapeId as string | undefined) ?? matchedLibShape.id
        }
      : {}

    return {
      id: safeId,
      type,
      position: { x: posX, y: posY },
      ...(matchedLibShape && resolvedW && resolvedH
        ? { width: resolvedW, height: resolvedH, style: { width: resolvedW, height: resolvedH } }
        : {}),
      data: {
        label,
        description,
        color: n.color || (n.data?.color as string | undefined),
        ...libSize,
        ...(n.data || {})
      }
    }
  })

  // Normalize edges (never invent fake sequential edges when none were drawn)
  const rawEdges = Array.isArray(parsed.edges) ? parsed.edges : []
  const edges: RFEdge[] = []

  rawEdges.forEach((e, idx) => {
    const srcRaw = String(e.source ?? e.from ?? '').trim()
    const tgtRaw = String(e.target ?? e.to ?? '').trim()
    const src = idMap.get(srcRaw) || (nodes.some((n) => n.id === srcRaw) ? srcRaw : null)
    const tgt = idMap.get(tgtRaw) || (nodes.some((n) => n.id === tgtRaw) ? tgtRaw : null)

    if (src && tgt && src !== tgt) {
      const edgeLabel = String(e.label ?? e.text ?? '').trim()
      edges.push({
        id: `e-${src}-${tgt}-${idx}`,
        source: src,
        target: tgt,
        type: 'smoothstep',
        label: edgeLabel || undefined,
        animated: Boolean(e.animated),
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 16,
          height: 16,
          color: '#38bdf8'
        },
        style: { stroke: '#38bdf8', strokeWidth: 2 }
      })
    }
  })

  const explicitPosCount = parsed.nodes.filter(
    (n) =>
      (typeof n.position?.x === 'number' && typeof n.position?.y === 'number') ||
      (typeof n.x === 'number' && typeof n.y === 'number')
  ).length

  const hasDistinctPositions =
    explicitPosCount >= 2 &&
    (() => {
      const xs = new Set(nodes.map((n) => Math.round(n.position.x)))
      const ys = new Set(nodes.map((n) => Math.round(n.position.y)))
      return xs.size > 1 || ys.size > 1
    })()

  // Preserve spatial orientation when real node coordinates exist (or match local fallback geometry)
  const canUseLocalFallback =
    !hasDistinctPositions &&
    Boolean(opts?.preservePositions) &&
    Boolean(opts?.localFallback && opts.localFallback.nodes.length === nodes.length)

  if (
    nodes.length > 0 &&
    (hasDistinctPositions || canUseLocalFallback) &&
    (opts?.preservePositions || explicitPosCount === parsed.nodes.length)
  ) {
    let positionedNodes = nodes
    if (canUseLocalFallback && opts?.localFallback) {
      const fallbackNodes = opts.localFallback.nodes
      positionedNodes = nodes.map((n, i) => ({
        ...n,
        position: { ...fallbackNodes[i].position }
      }))
    }
    const tidied = preserveAndTidySpatialLayout(positionedNodes, edges, opts?.targetBounds)
    return {
      title,
      nodes: tidied.nodes,
      edges: tidied.edges,
      diagramType,
      preservePositions: true
    }
  }

  if (edges.length > 0) {
    const rawDir = (parsed.layoutDirection || parsed.direction || parsed.orientation || '').toLowerCase()
    const widerThanTall = Boolean(
      opts?.targetBounds?.w && opts?.targetBounds?.h && opts.targetBounds.w > opts.targetBounds.h * 1.15
    )
    const layoutDirection: 'LR' | 'TB' =
      rawDir.includes('lr') ||
      rawDir.includes('left') ||
      rawDir.includes('horiz') ||
      diagramType === 'architecture' ||
      (!rawDir && widerThanTall)
        ? 'LR'
        : 'TB'
    const laidOut = layoutReactFlowElements(nodes, edges, { direction: layoutDirection })
    return {
      title,
      nodes: laidOut.nodes,
      edges: laidOut.edges,
      diagramType
    }
  }

  // Unlinked shapes: preserve drawn relative positions & sizes inside the diagram container
  const hasAnyPos = explicitPosCount > 0
  if (hasAnyPos && nodes.length > 0) {
    const minX = Math.min(...nodes.map((n) => n.position.x))
    const minY = Math.min(...nodes.map((n) => n.position.y))
    const normalized = nodes.map((n) => ({
      ...n,
      position: {
        x: Math.round(n.position.x - minX + 40),
        y: Math.round(n.position.y - minY + 50)
      }
    }))
    return {
      title,
      nodes: normalized,
      edges: [],
      diagramType,
      preservePositions: true
    }
  }

  return {
    title,
    nodes,
    edges: [],
    diagramType
  }
}

/**
 * Builds a complete immersed DiagramNode from cleaned React Flow data.
 */
export function buildDiagramNodeFromData(
  parsedFlow: CleanReactFlowResult,
  targetBounds?: { x: number; y: number; w?: number; h?: number }
): DiagramNode {
  let minNodeLeft = Infinity
  let minNodeTop = Infinity
  let maxNodeRight = -Infinity
  let maxNodeBottom = -Infinity

  for (const n of parsedFlow.nodes) {
    const nw =
      typeof n.width === 'number'
        ? n.width
        : typeof n.data?.w === 'number'
          ? (n.data.w as number)
          : 150
    const nh =
      typeof n.height === 'number'
        ? n.height
        : typeof n.data?.h === 'number'
          ? (n.data.h as number)
          : 80
    const nx = n.position?.x ?? 0
    const ny = n.position?.y ?? 0
    if (nx < minNodeLeft) minNodeLeft = nx
    if (ny < minNodeTop) minNodeTop = ny
    if (nx + nw > maxNodeRight) maxNodeRight = nx + nw
    if (ny + nh > maxNodeBottom) maxNodeBottom = ny + nh
  }

  const hasNodes = parsedFlow.nodes.length > 0 && Number.isFinite(minNodeLeft)
  const offsetX = hasNodes ? 32 - minNodeLeft : 0
  const offsetY = hasNodes ? 32 - minNodeTop : 0
  const normalizedNodes = hasNodes
    ? parsedFlow.nodes.map((n) => ({
        ...n,
        position: {
          x: Math.round((n.position?.x ?? 0) + offsetX),
          y: Math.round((n.position?.y ?? 0) + offsetY)
        }
      }))
    : parsedFlow.nodes

  const contentW = hasNodes ? Math.max(200, maxNodeRight - minNodeLeft) : (targetBounds?.w ?? 420)
  const contentH = hasNodes ? Math.max(140, maxNodeBottom - minNodeTop) : (targetBounds?.h ?? 280)
  const cardW = Math.max(260, Math.round(contentW + 64))
  const cardH = Math.max(180, Math.round(contentH + 64))

  const posX = targetBounds?.x ?? 120
  const posY = targetBounds?.y ?? 100

  return {
    id: `diag-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title: parsedFlow.title || 'Interactive Diagram',
    nodes: normalizedNodes,
    edges: parsedFlow.edges,
    x: Math.round(posX),
    y: Math.round(posY),
    w: cardW,
    h: cardH,
    createdAt: Date.now()
  }
}

/**
 * Generates ready-to-use professional diagram templates (Flowchart, Architecture, Mindmap, ERD, User Journey).
 */
export function buildTemplateDiagram(
  templateId: string,
  targetBounds?: { x: number; y: number }
): DiagramNode {
  const posX = targetBounds?.x ?? 150
  const posY = targetBounds?.y ?? 100

  if (templateId === 'microservices') {
    const raw: CreateDiagramArgs = {
      title: 'Cloud Microservices Architecture',
      diagramType: 'architecture',
      nodes: [
        { id: 'client', type: 'actor', label: 'Web / Mobile Client', description: 'HTTPS / WSS' },
        { id: 'gateway', type: 'cloud', label: 'API Gateway', description: 'Reverse Proxy & Rate Limit' },
        { id: 'auth', type: 'process', label: 'Auth Service', description: 'OAuth2 / JWT' },
        { id: 'core', type: 'process', label: 'Core Backend API', description: 'Business Logic' },
        { id: 'db', type: 'database', label: 'PostgreSQL DB', description: 'Relational Store' },
        { id: 'cache', type: 'database', label: 'Redis Cache', description: 'Session & Hot Data' }
      ],
      edges: [
        { id: 'e1', source: 'client', target: 'gateway', label: 'HTTPS' },
        { id: 'e2', source: 'gateway', target: 'auth', label: 'Validate Token' },
        { id: 'e3', source: 'gateway', target: 'core', label: 'Forward Request' },
        { id: 'e4', source: 'core', target: 'db', label: 'SQL Query' },
        { id: 'e5', source: 'core', target: 'cache', label: 'Cache Lookup' }
      ]
    }
    const parsed = parseAndCleanReactFlow(JSON.stringify(raw))
    return buildDiagramNodeFromData(parsed, { x: posX, y: posY, w: 760, h: 540 })
  }

  if (templateId === 'mindmap') {
    const raw: CreateDiagramArgs = {
      title: 'Brainstorm & Mindmap',
      diagramType: 'mindmap',
      nodes: [
        { id: 'center', type: 'circle', label: 'Core Vision', description: 'Central Theme' },
        { id: 'branch1', type: 'sticky', label: 'Architecture', description: 'React Flow + Dagre' },
        { id: 'branch2', type: 'sticky', label: 'AI Engine', description: 'Gemma 4 Vision on Cloud' },
        { id: 'branch3', type: 'sticky', label: 'Miro Board UI', description: 'Glassmorphism Left Dock' },
        { id: 'branch4', type: 'sticky', label: 'Collaboration', description: 'Live sync & multi-screen' }
      ],
      edges: [
        { id: 'm1', source: 'center', target: 'branch1' },
        { id: 'm2', source: 'center', target: 'branch2' },
        { id: 'm3', source: 'center', target: 'branch3' },
        { id: 'm4', source: 'center', target: 'branch4' }
      ]
    }
    const parsed = parseAndCleanReactFlow(JSON.stringify(raw))
    return buildDiagramNodeFromData(parsed, { x: posX, y: posY, w: 680, h: 480 })
  }

  if (templateId === 'erd') {
    const raw: CreateDiagramArgs = {
      title: 'Entity Relationship Diagram (ERD)',
      diagramType: 'er',
      nodes: [
        { id: 'users', type: 'database', label: 'Users Table', description: 'id, email, password_hash, created_at' },
        { id: 'orders', type: 'database', label: 'Orders Table', description: 'id, user_id, total_amount, status' },
        { id: 'items', type: 'database', label: 'Order Items Table', description: 'id, order_id, product_id, qty' },
        { id: 'products', type: 'database', label: 'Products Table', description: 'id, title, price_cents, stock' }
      ],
      edges: [
        { id: 'er1', source: 'users', target: 'orders', label: '1 to Many' },
        { id: 'er2', source: 'orders', target: 'items', label: '1 to Many' },
        { id: 'er3', source: 'products', target: 'items', label: '1 to Many' }
      ]
    }
    const parsed = parseAndCleanReactFlow(JSON.stringify(raw))
    return buildDiagramNodeFromData(parsed, { x: posX, y: posY, w: 720, h: 500 })
  }

  if (templateId === 'user_journey') {
    const raw: CreateDiagramArgs = {
      title: 'User Journey & Onboarding Funnel',
      diagramType: 'flowchart',
      nodes: [
        { id: 'step1', type: 'actor', label: 'Visitor', description: 'Visits Landing Page' },
        { id: 'step2', type: 'inputOutput', label: 'Sign Up Form', description: 'Email & Password Entry' },
        { id: 'step3', type: 'decision', label: 'Email Verified?', description: 'OTP Check' },
        { id: 'step4', type: 'process', label: 'Guided Onboarding', description: 'Product Tour & Quick Setup' },
        { id: 'step5', type: 'startEnd', label: 'Active User', description: 'Completes First Workflow' }
      ],
      edges: [
        { id: 'uj1', source: 'step1', target: 'step2' },
        { id: 'uj2', source: 'step2', target: 'step3' },
        { id: 'uj3', source: 'step3', target: 'step4', label: 'Yes' },
        { id: 'uj4', source: 'step3', target: 'step2', label: 'Resend' },
        { id: 'uj5', source: 'step4', target: 'step5' }
      ]
    }
    const parsed = parseAndCleanReactFlow(JSON.stringify(raw))
    return buildDiagramNodeFromData(parsed, { x: posX, y: posY, w: 720, h: 500 })
  }

  // Default Standard Flowchart template
  const defaultRaw: CreateDiagramArgs = {
    title: 'Standard Process Flowchart',
    diagramType: 'flowchart',
    nodes: [
      { id: 'start', type: 'startEnd', label: 'Start Flow', description: 'Event or Trigger' },
      { id: 'step1', type: 'process', label: 'Process Action', description: 'Execute step logic' },
      { id: 'decision', type: 'decision', label: 'Condition Check?', description: 'Validate input' },
      { id: 'success', type: 'process', label: 'Success Handler', description: 'Commit transaction' },
      { id: 'fallback', type: 'process', label: 'Error / Retry', description: 'Rollback & alert' },
      { id: 'end', type: 'startEnd', label: 'Finish Process', description: 'Return result' }
    ],
    edges: [
      { id: 'fe1', source: 'start', target: 'step1' },
      { id: 'fe2', source: 'step1', target: 'decision' },
      { id: 'fe3', source: 'decision', target: 'success', label: 'Valid' },
      { id: 'fe4', source: 'decision', target: 'fallback', label: 'Invalid' },
      { id: 'fe5', source: 'success', target: 'end' },
      { id: 'fe6', source: 'fallback', target: 'end' }
    ]
  }
  const parsed = parseAndCleanReactFlow(JSON.stringify(defaultRaw))
  return buildDiagramNodeFromData(parsed, { x: posX, y: posY, w: 720, h: 520 })
}


/**
 * Creates a clean default flow from raw text if model output could not be parsed as JSON.
 */
function createDefaultFallbackFlow(rawText: string): CleanReactFlowResult {
  const clean = rawText.replace(/```[\s\S]*?```/g, '').trim()
  const lines = clean
    .split('\n')
    .map((l) => l.replace(/^[-*•\d\.\s]+/, '').trim())
    .filter((l) => l.length > 0)
    .slice(0, 6)

  const steps = lines.length >= 2 ? lines : ['Initialize Concept', 'Process Logic', 'Complete & Verify']

  const nodes: RFNode[] = steps.map((step, idx) => ({
    id: `node-${idx + 1}`,
    type: idx === 0 ? 'startEnd' : idx === steps.length - 1 ? 'startEnd' : 'process',
    position: { x: 200, y: 50 + idx * 110 },
    data: {
      label: step.slice(0, 48),
      description: idx === 0 ? 'Start' : idx === steps.length - 1 ? 'Finish' : 'Action Step'
    }
  }))

  const edges: RFEdge[] = []
  for (let i = 0; i < nodes.length - 1; i++) {
    edges.push({
      id: `e-${i + 1}-${i + 2}`,
      source: nodes[i].id,
      target: nodes[i + 1].id,
      type: 'smoothstep',
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 16,
        height: 16,
        color: '#38bdf8'
      },
      style: { stroke: '#38bdf8', strokeWidth: 2 }
    })
  }

  const laidOut = layoutReactFlowElements(nodes, edges, { direction: 'TB' })

  return {
    title: '✨ Process Flow',
    nodes: laidOut.nodes,
    edges: laidOut.edges,
    diagramType: 'flowchart'
  }
}

/**
 * Smart local generator that directly analyzes canvas strokes and shapes
 * to convert sketches into implemented `shapeLibrary.json` shapes (or detects
 * pure handwritten text so the caller can OCR it cleanly).
 */
export function generateSmartLocalReactFlowDiagram(
  board: BoardState,
  selectedIds: string[]
): CleanReactFlowResult {
  const idSet = new Set(selectedIds)
  const selShapes = board.shapeNodes.filter((s) => idSet.has(s.id))
  const selTexts = board.textNodes.filter((t) => idSet.has(t.id))
  const selEquations = board.equationNodes.filter((eq) => idSet.has(eq.id))
  const selStrokes = board.strokes.filter((s) => idSet.has(s.id))

  const nodes: RFNode[] = []
  const edges: RFEdge[] = []

  const legacyShapeMap: Record<string, string> = {
    rect: 'rectangle',
    'rounded-rect': 'rounded-rectangle',
    diamond: 'rhombus',
    cylinder: 'cylinder-3d',
    cylinder3d: 'cylinder-3d',
    sphere3d: 'sphere',
    cube3d: 'cube',
    actor: 'uml-actor',
    component: 'uml-component',
    queue: 'net-queue',
    server: 'net-server',
    line: 'line-horizontal',
    'dashed-line': 'line-dashed',
    arrow: 'arrow-right',
    'arrow-bidirectional': 'arrow-left-right',
    elbow: 'line-elbow'
  }

  interface DetectedBox {
    id: string
    shapeId: string
    x: number
    y: number
    w: number
    h: number
    label?: string
  }

  const detectedBoxes: DetectedBox[] = []

  // 1. Convert existing canvas ShapeNodes into their exact library shapes
  selShapes.forEach((s, idx) => {
    const mappedId = legacyShapeMap[s.shape] ?? s.shape
    const libMatch: LibraryShapeDef | undefined =
      getLibraryShape(mappedId) || getLibraryShape('rectangle')
    const shapeId = libMatch?.id ?? 'rectangle'
    const w = Math.max(60, Math.round(Math.abs(s.w) || libMatch?.size[0] || 140))
    const h = Math.max(45, Math.round(Math.abs(s.h) || libMatch?.size[1] || 80))
    const x = Math.round(s.w < 0 ? s.x + s.w : s.x)
    const y = Math.round(s.h < 0 ? s.y + s.h : s.y)
    const nodeId = `shape-${s.id || idx}`

    detectedBoxes.push({ id: nodeId, shapeId, x, y, w, h, label: s.label })
    nodes.push({
      id: nodeId,
      type: shapeId,
      position: { x, y },
      width: w,
      height: h,
      style: { width: w, height: h },
      data: {
        label: s.label ?? libMatch?.defaultLabel ?? libMatch?.name ?? 'Shape',
        description: '',
        w,
        h,
        shapeId
      }
    })
  })

  // 1b. Convert any equations in selection
  selEquations.forEach((eq) => {
    nodes.push({
      id: `eq-${eq.id}`,
      type: 'custom',
      position: { x: Math.round(eq.x), y: Math.round(eq.y) },
      data: {
        label: eq.latex || 'Equation',
        description: 'Formula'
      }
    })
  })

  // 2. Analyze raw strokes into multi-stroke & single-stroke library shapes
  interface StrokeStats {
    idx: number
    points: InkPoint[]
    minX: number
    minY: number
    maxX: number
    maxY: number
    w: number
    h: number
    cx: number
    cy: number
    perim: number
    diag: number
    startPt: [number, number]
    endPt: [number, number]
    isStraight: boolean
    isClosed: boolean
    angleRad: number
  }

  const statsList: StrokeStats[] = []
  selStrokes.forEach((st, idx) => {
    if (st.points.length < 2) return
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    let perim = 0
    for (let i = 0; i < st.points.length; i++) {
      const [px, py] = st.points[i]
      if (px < minX) minX = px
      if (py < minY) minY = py
      if (px > maxX) maxX = px
      if (py > maxY) maxY = py
      if (i > 0) {
        const [prevX, prevY] = st.points[i - 1]
        perim += Math.hypot(px - prevX, py - prevY)
      }
    }
    const w = maxX - minX
    const h = maxY - minY
    const diag = Math.hypot(w, h)
    const pStart = st.points[0]
    const pEnd = st.points[st.points.length - 1]
    const endDist = Math.hypot(pEnd[0] - pStart[0], pEnd[1] - pStart[1])
    const isStraight = perim > 20 && endDist / perim > 0.85
    const isClosed = perim > 50 && endDist < Math.max(36, diag * 0.36) && w >= 20 && h >= 20

    statsList.push({
      idx,
      points: st.points,
      minX,
      minY,
      maxX,
      maxY,
      w,
      h,
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
      perim,
      diag,
      startPt: [pStart[0], pStart[1]],
      endPt: [pEnd[0], pEnd[1]],
      isStraight,
      isClosed,
      angleRad: Math.atan2(pEnd[1] - pStart[1], pEnd[0] - pStart[0])
    })
  })

  const used = new Set<number>()

  const distToBox = (px: number, py: number, b: DetectedBox): number => {
    const dx = Math.max(b.x - px, 0, px - (b.x + b.w))
    const dy = Math.max(b.y - py, 0, py - (b.y + b.h))
    return Math.hypot(dx, dy)
  }

  const pushDetectedShape = (
    shapeId: string,
    x: number,
    y: number,
    rawW: number,
    rawH: number
  ): void => {
    const lib = getLibraryShape(shapeId) || getLibraryShape('rectangle')!
    const w = Math.max(lib.id.startsWith('line-') ? 80 : 60, Math.round(rawW))
    const h = Math.max(lib.id.startsWith('line-') ? 24 : 45, Math.round(rawH))
    const rx = Math.round(x)
    const ry = Math.round(y)

    const insideText = selTexts.find(
      (t) => t.x >= rx - 24 && t.x <= rx + w + 24 && t.y >= ry - 24 && t.y <= ry + h + 24
    )
    const label = insideText
      ? insideText.title || insideText.text.split('\n')[0].slice(0, 40)
      : lib.defaultLabel !== undefined
        ? lib.defaultLabel
        : ''

    const id = `node-shape-${nodes.length + 1}`
    detectedBoxes.push({ id, shapeId: lib.id, x: rx, y: ry, w, h, label })
    nodes.push({
      id,
      type: lib.id,
      position: { x: rx, y: ry },
      width: w,
      height: h,
      style: { width: w, height: h },
      data: {
        label,
        description: '',
        w,
        h,
        shapeId: lib.id
      }
    })
  }

  // 2a. Crossing straight-line pairs -> 'cross' or 'x-shape'
  for (let i = 0; i < statsList.length; i++) {
    const a = statsList[i]
    if (used.has(a.idx) || !a.isStraight || a.diag < 28) continue
    for (let j = i + 1; j < statsList.length; j++) {
      const b = statsList[j]
      if (used.has(b.idx) || !b.isStraight || b.diag < 28) continue
      const centerDist = Math.hypot(a.cx - b.cx, a.cy - b.cy)
      if (centerDist > Math.max(a.diag, b.diag) * 0.32) continue
      let angleDiff = Math.abs(a.angleRad - b.angleRad)
      if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff
      if (angleDiff > Math.PI / 2) angleDiff = Math.PI - angleDiff
      if (angleDiff >= Math.PI / 4) {
        const minX = Math.min(a.minX, b.minX)
        const minY = Math.min(a.minY, b.minY)
        const maxX = Math.max(a.maxX, b.maxX)
        const maxY = Math.max(a.maxY, b.maxY)
        const degA = Math.abs((a.angleRad * 180) / Math.PI) % 180
        const degB = Math.abs((b.angleRad * 180) / Math.PI) % 180
        const isDiagA = degA > 20 && degA < 70 || degA > 110 && degA < 160
        const isDiagB = degB > 20 && degB < 70 || degB > 110 && degB < 160
        used.add(a.idx)
        used.add(b.idx)
        pushDetectedShape(isDiagA && isDiagB ? 'x-shape' : 'cross', minX, minY, maxX - minX, maxY - minY)
        break
      }
    }
  }

  // 2b. Stacked top oval + body stroke -> 'cylinder-3d'
  for (let i = 0; i < statsList.length; i++) {
    const top = statsList[i]
    if (used.has(top.idx) || !top.isClosed || top.h > top.w * 0.65) continue
    for (let j = 0; j < statsList.length; j++) {
      if (i === j) continue
      const body = statsList[j]
      if (used.has(body.idx) || body.h < top.h * 1.2) continue
      const widthMatch = Math.abs(top.w - body.w) < Math.max(top.w, body.w) * 0.35
      const centerMatch = Math.abs(top.cx - body.cx) < top.w * 0.35
      const stacked = body.minY >= top.minY - 8 && body.minY <= top.maxY + 24
      if (widthMatch && centerMatch && stacked) {
        const minX = Math.min(top.minX, body.minX)
        const minY = Math.min(top.minY, body.minY)
        const maxX = Math.max(top.maxX, body.maxX)
        const maxY = Math.max(top.maxY, body.maxY)
        used.add(top.idx)
        used.add(body.idx)
        pushDetectedShape('cylinder-3d', minX, minY, maxX - minX, maxY - minY)
        break
      }
    }
  }

  // 2c. Multi-stroke closed loops (2..5 connected open strokes forming a polygon)
  const stitchTolerance = 30
  for (let i = 0; i < statsList.length; i++) {
    const first = statsList[i]
    if (used.has(first.idx) || first.isClosed || first.diag < 22) continue

    const chain: StrokeStats[] = [first]
    const chainPts: InkPoint[] = [...first.points]
    const chainUsed = new Set<number>([first.idx])
    let closedLoop = false

    for (let step = 0; step < 4; step++) {
      const curEnd = chainPts[chainPts.length - 1]
      const startPt = chainPts[0]
      if (
        chain.length >= 2 &&
        Math.hypot(curEnd[0] - startPt[0], curEnd[1] - startPt[1]) < stitchTolerance
      ) {
        closedLoop = true
        break
      }

      let bestNext: StrokeStats | null = null
      let bestDist = stitchTolerance
      let reverseNext = false

      for (const cand of statsList) {
        if (used.has(cand.idx) || chainUsed.has(cand.idx) || cand.isClosed || cand.diag < 20) {
          continue
        }
        const dStart = Math.hypot(cand.startPt[0] - curEnd[0], cand.startPt[1] - curEnd[1])
        const dEnd = Math.hypot(cand.endPt[0] - curEnd[0], cand.endPt[1] - curEnd[1])
        if (dStart < bestDist) {
          bestDist = dStart
          bestNext = cand
          reverseNext = false
        }
        if (dEnd < bestDist) {
          bestDist = dEnd
          bestNext = cand
          reverseNext = true
        }
      }

      if (!bestNext) break
      chain.push(bestNext)
      chainUsed.add(bestNext.idx)
      const ptsToAppend = reverseNext ? [...bestNext.points].reverse() : bestNext.points
      chainPts.push(...ptsToAppend)

      const newEnd = chainPts[chainPts.length - 1]
      if (
        chain.length >= 2 &&
        Math.hypot(newEnd[0] - chainPts[0][0], newEnd[1] - chainPts[0][1]) < stitchTolerance
      ) {
        closedLoop = true
        break
      }
    }

    if (closedLoop) {
      const classified = classifyClosedPolygon(chainPts)
      if (classified) {
        for (const member of chain) used.add(member.idx)
        pushDetectedShape(classified.shapeId, classified.x, classified.y, classified.w, classified.h)
      }
    }
  }

  // 2d. Single-stroke closed shapes
  for (const st of statsList) {
    if (used.has(st.idx)) continue
    const classified = classifyClosedPolygon(st.points)
    if (classified) {
      used.add(st.idx)
      pushDetectedShape(classified.shapeId, classified.x, classified.y, classified.w, classified.h)
    }
  }

  // 2e. Open connector lines / arrows (straight & elbow splines + branching T-junctions)
  interface ConnectorCandidate {
    points: InkPoint[]
    startPt: [number, number]
    endPt: [number, number]
    minX: number
    minY: number
    w: number
    h: number
    shapeId: string
    hasArrowTip: boolean
    srcBox: DetectedBox | null
    tgtBox: DetectedBox | null
  }

  const connectors: ConnectorCandidate[] = []

  for (const st of statsList) {
    if (used.has(st.idx) || st.perim < 32) continue
    const insideExistingBox = detectedBoxes.some(
      (b) =>
        st.minX >= b.x - 10 &&
        st.maxX <= b.x + b.w + 10 &&
        st.minY >= b.y - 10 &&
        st.maxY <= b.y + b.h + 10 &&
        st.w * st.h < b.w * b.h * 0.7
    )
    if (insideExistingBox) {
      used.add(st.idx)
      continue
    }

    const endDist = Math.hypot(st.endPt[0] - st.startPt[0], st.endPt[1] - st.startPt[1])
    // Accept straight shafts AND L/elbow-bent open connector strokes (excluding tiny stray ticks)
    const isConnectorStroke = st.isStraight || (!st.isClosed && st.diag >= 30 && endDist >= 22)
    if (isConnectorStroke) {
      used.add(st.idx)
      let hasArrowTip = false
      for (const tip of statsList) {
        if (used.has(tip.idx) || tip.diag > st.diag * 0.5 || tip.diag < 10) continue
        const nearEnd =
          Math.hypot(tip.cx - st.endPt[0], tip.cy - st.endPt[1]) < Math.max(28, tip.diag * 0.9)
        if (nearEnd) {
          used.add(tip.idx)
          hasArrowTip = true
          break
        }
      }

      const cls = classifyStrokeShape(st.points)
      const dx = st.endPt[0] - st.startPt[0]
      const dy = st.endPt[1] - st.startPt[1]
      let shapeId = cls?.shapeId ?? 'line-horizontal'
      if (hasArrowTip) {
        shapeId =
          Math.abs(dx) >= Math.abs(dy)
            ? dx >= 0
              ? 'arrow-right'
              : 'arrow-left'
            : dy >= 0
              ? 'arrow-down'
              : 'arrow-up'
      }

      connectors.push({
        points: st.points,
        startPt: st.startPt,
        endPt: st.endPt,
        minX: st.minX,
        minY: st.minY,
        w: st.w,
        h: st.h,
        shapeId,
        hasArrowTip,
        srcBox: null,
        tgtBox: null
      })
    }
  }

  const findNearestBox = (px: number, py: number, maxDist = 68): DetectedBox | null => {
    let best: DetectedBox | null = null
    let bestD = maxDist
    for (const b of detectedBoxes) {
      const d = distToBox(px, py, b)
      if (d < bestD) {
        bestD = d
        best = b
      }
    }
    return best
  }

  const minDistToPolyline = (pts: InkPoint[], px: number, py: number): number => {
    let best = Infinity
    for (const [qx, qy] of pts) {
      const d = Math.hypot(qx - px, qy - py)
      if (d < best) best = d
    }
    return best
  }

  // First pass: bind direct start->end box pairs
  for (const cc of connectors) {
    if (detectedBoxes.length >= 2) {
      cc.srcBox = findNearestBox(cc.startPt[0], cc.startPt[1])
      cc.tgtBox = findNearestBox(cc.endPt[0], cc.endPt[1])
    }
  }

  // Second pass: resolve T-junction / shared-spine branches (e.g. trunk from A splitting to D & C)
  for (let pass = 0; pass < 2; pass++) {
    for (const cc of connectors) {
      if (cc.srcBox) continue
      for (const parent of connectors) {
        if (parent === cc || !parent.srcBox) continue
        if (
          minDistToPolyline(parent.points, cc.startPt[0], cc.startPt[1]) < 32 ||
          minDistToPolyline(parent.points, cc.endPt[0], cc.endPt[1]) < 32
        ) {
          cc.srcBox = parent.srcBox
          break
        }
      }
    }
  }

  // Emit deduplicated edges or standalone unattached arrows/lines
  const seenEdges = new Set<string>()
  connectors.forEach((cc, edgeIdx) => {
    if (cc.srcBox && cc.tgtBox && cc.srcBox.id !== cc.tgtBox.id) {
      const key = `${cc.srcBox.id}->${cc.tgtBox.id}`
      if (!seenEdges.has(key)) {
        seenEdges.add(key)
        edges.push({
          id: `e-line-${edgeIdx}-${cc.srcBox.id}-${cc.tgtBox.id}`,
          source: cc.srcBox.id,
          target: cc.tgtBox.id,
          type: 'smoothstep',
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 16,
            height: 16,
            color: '#38bdf8'
          },
          style: { stroke: '#38bdf8', strokeWidth: 2.2 }
        })
      }
      return
    }

    if (cc.hasArrowTip || Math.hypot(cc.w, cc.h) > 45) {
      pushDetectedShape(cc.shapeId, cc.minX, cc.minY, cc.w, cc.h)
    }
  })

  // 3. If no shapes were detected at all, treat strokes as handwritten text rather than fake boxes
  if (nodes.length === 0) {
    return {
      title: 'Handwritten Text',
      nodes: [],
      edges: [],
      diagramType: 'flowchart',
      isTextOnly: true
    }
  }

  if (edges.length > 0) {
    const tidied = preserveAndTidySpatialLayout(nodes, edges)
    return {
      title: '✨ Beautified Diagram',
      nodes: tidied.nodes,
      edges: tidied.edges,
      diagramType: 'flowchart',
      preservePositions: true
    }
  }

  // Unlinked shapes: keep relative drawn positions and sizes inside diagram container
  const minNodeX = Math.min(...nodes.map((n) => n.position.x))
  const minNodeY = Math.min(...nodes.map((n) => n.position.y))
  const normalizedNodes = nodes.map((n) => ({
    ...n,
    position: {
      x: Math.round(n.position.x - minNodeX + 40),
      y: Math.round(n.position.y - minNodeY + 50)
    }
  }))

  return {
    title: '✨ Beautified Shapes',
    nodes: normalizedNodes,
    edges: [],
    diagramType: 'flowchart',
    preservePositions: true
  }
}
