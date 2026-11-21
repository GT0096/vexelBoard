import { z } from 'zod'
import type { ProviderId } from './ipc'

export const DiagramDirectionSchema = z.enum(['RIGHT', 'DOWN', 'LEFT', 'UP'])
export type DiagramDirection = z.infer<typeof DiagramDirectionSchema>

export const DiagramNodeKindSchema = z.enum([
  'rect',
  'rounded_rect',
  'diamond',
  'ellipse',
  'cylinder',
  'parallelogram',
  'group'
])
export type DiagramNodeKind = z.infer<typeof DiagramNodeKindSchema>

export const DiagramGraphNodeSchema = z.object({
  id: z.string().min(1),
  kind: DiagramNodeKindSchema.default('rounded_rect'),
  label: z.string().default(''),
  parentId: z.string().nullable().optional(),
  fillColor: z.string().optional(),
  strokeColor: z.string().optional(),
  /** Optional relative position hint 0..1 to help preserve user order */
  orderHint: z.number().optional()
})
export type DiagramGraphNode = z.infer<typeof DiagramGraphNodeSchema>

export const DiagramGraphEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  label: z.string().optional(),
  style: z.enum(['solid', 'dashed', 'dotted']).default('solid'),
  directed: z.boolean().default(true),
  bidirectional: z.boolean().optional()
})
export type DiagramGraphEdge = z.infer<typeof DiagramGraphEdgeSchema>

export const DiagramGraphSchema = z.object({
  direction: DiagramDirectionSchema.default('RIGHT'),
  title: z.string().optional(),
  nodes: z.array(DiagramGraphNodeSchema).min(1),
  edges: z.array(DiagramGraphEdgeSchema).default([])
})
export type DiagramGraph = z.infer<typeof DiagramGraphSchema>

/* ------------------------------------------------------------------ */
/* Universal Composable Spatial Scene Schema (0..1000 Coordinates)     */
/* Handles stacks, queues, arrays, tables, open containers, axes,     */
/* Venn diagrams, timelines, math/geometry & spatial diagrams cleanly */
/* without any hardcoded templates or raw LLM-written <svg> paths.    */
/* ------------------------------------------------------------------ */

export const SpatialCellStripSchema = z.object({
  type: z.literal('cell_strip'),
  id: z.string().min(1),
  orientation: z.enum(['vertical', 'horizontal']),
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  h: z.number().positive(),
  cells: z.array(z.string()).min(1),
  /** Open channel extensions on start (top/left) or end (bottom/right), e.g. ['start'] for open-top stack */
  openEnds: z.array(z.enum(['start', 'end'])).optional(),
  /** Extension length of open side rails in 0..1000 space (default auto ~22% of cell size) */
  wallExtension: z.number().nonnegative().optional(),
  /** Optional explicit gap between adjacent cells in 0..1000 space (enables gapped molecular/codon/node chains) */
  cellGap: z.number().nonnegative().optional(),
  /** Optional connector arrows between consecutive cells in a gapped strip */
  connectorArrows: z.enum(['none', 'forward', 'bidirectional', 'circular']).optional(),
  cellFill: z.string().optional(),
  stroke: z.string().optional(),
  labelFontSize: z.number().optional()
})
export type SpatialCellStrip = z.infer<typeof SpatialCellStripSchema>

export const SpatialShapeSchema = z.object({
  type: z.literal('shape'),
  id: z.string().min(1),
  /** Any built-in geometric primitive OR any registered Vexelboard shape library ID */
  kind: z.string().min(1).default('rect'),
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  h: z.number().positive(),
  /** Optional open sides for rectangular containers (e.g. ['top'] for an open beaker/tray) */
  openSides: z.array(z.enum(['top', 'bottom', 'left', 'right'])).optional(),
  label: z.string().optional(),
  labelSize: z.number().positive().optional(),
  labelColor: z.string().optional(),
  fill: z.string().optional(),
  fillOpacity: z.number().min(0).max(1).optional(),
  stroke: z.string().optional(),
  strokeWidth: z.number().positive().optional(),
  strokeStyle: z.enum(['solid', 'dashed', 'dotted']).optional(),
  dashed: z.boolean().optional(),
  borderRadius: z.number().nonnegative().optional(),
  rotation: z.number().optional(),
  animated: z.boolean().optional(),
  animationMode: z.enum(['pulse', 'dash', 'both']).optional(),
  pulseColor: z.string().optional(),
  flowStage: z.number().int().nonnegative().optional()
})
export type SpatialShape = z.infer<typeof SpatialShapeSchema>

export const SpatialPathLayerSchema = z.object({
  d: z.string().min(1),
  fill: z.string().optional(),
  stroke: z.string().optional(),
  strokeWidth: z.number().positive().optional(),
  dashed: z.boolean().optional()
})
export type SpatialPathLayer = z.infer<typeof SpatialPathLayerSchema>

export const SpatialPathSchema = z.object({
  type: z.literal('svg_path'),
  id: z.string().min(1),
  d: z.string().min(1).optional(),
  paths: z.array(SpatialPathLayerSchema).optional(),
  viewBox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  x: z.number().default(0),
  y: z.number().default(0),
  w: z.number().positive().default(1000),
  h: z.number().positive().default(1000),
  fill: z.string().optional(),
  fillOpacity: z.number().min(0).max(1).optional(),
  stroke: z.string().optional(),
  strokeWidth: z.number().positive().optional(),
  strokeStyle: z.enum(['solid', 'dashed', 'dotted']).optional(),
  rotation: z.number().optional(),
  label: z.string().optional(),
  animated: z.boolean().optional(),
  animationMode: z.enum(['pulse', 'dash', 'both']).optional(),
  pulseColor: z.string().optional(),
  flowStage: z.number().int().nonnegative().optional()
})
export type SpatialPath = z.infer<typeof SpatialPathSchema>

export const SpatialConnectorSchema = z.object({
  type: z.literal('connector'),
  id: z.string().min(1),
  /** 2+ waypoints in 0..1000 normalized scene coordinates */
  points: z.array(z.tuple([z.number(), z.number()])).min(2),
  curved: z.boolean().optional(),
  arrowStart: z.boolean().optional(),
  arrowEnd: z.boolean().default(true),
  style: z.enum(['solid', 'dashed', 'dotted']).default('solid'),
  label: z.string().optional(),
  stroke: z.string().optional(),
  strokeWidth: z.number().positive().optional(),
  animated: z.boolean().optional(),
  animationMode: z.enum(['pulse', 'dash', 'both']).optional(),
  pulseColor: z.string().optional(),
  flowStage: z.number().int().nonnegative().optional(),
  fromId: z.string().optional(),
  toId: z.string().optional()
})
export type SpatialConnector = z.infer<typeof SpatialConnectorSchema>

export const SpatialTextSchema = z.object({
  type: z.literal('text'),
  id: z.string().min(1),
  x: z.number(),
  y: z.number(),
  text: z.string().min(1),
  fontSize: z.number().optional(),
  bold: z.boolean().optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
  color: z.string().optional()
})
export type SpatialText = z.infer<typeof SpatialTextSchema>

export const SpatialElementSchema = z.discriminatedUnion('type', [
  SpatialCellStripSchema,
  SpatialShapeSchema,
  SpatialConnectorSchema,
  SpatialTextSchema,
  SpatialPathSchema
])
export type SpatialElement = z.infer<typeof SpatialElementSchema>

export const SpatialSceneSchema = z.object({
  title: z.string().optional(),
  elements: z.array(SpatialElementSchema).min(1)
})
export type SpatialScene = z.infer<typeof SpatialSceneSchema>

export const IllustrationStyleSchema = z.enum([
  'flat_vector',
  'clean_line_art',
  'editorial_poster'
])
export type IllustrationStyle = z.infer<typeof IllustrationStyleSchema>

export const IllustrationBriefSchema = z.object({
  subject: z.string().min(1),
  composition: z.string().default('centered'),
  style: IllustrationStyleSchema.default('flat_vector'),
  paletteHex: z.array(z.string()).max(12).default([]),
  isMonochromeLineSketch: z.boolean().default(false)
})
export type IllustrationBrief = z.infer<typeof IllustrationBriefSchema>

export const HybridCalloutSchema = z.object({
  text: z.string().min(1),
  normX: z.number().min(0).max(1),
  normY: z.number().min(0).max(1),
  pointsToNormX: z.number().min(0).max(1).nullable().optional(),
  pointsToNormY: z.number().min(0).max(1).nullable().optional(),
  fontSize: z.number().optional(),
  bold: z.boolean().optional(),
  color: z.string().optional()
})
export type HybridCallout = z.infer<typeof HybridCalloutSchema>

export const SmartClassificationSchema = z.discriminatedUnion('category', [
  z.object({
    category: z.literal('spatial_scene'),
    scene: SpatialSceneSchema
  }),
  z.object({
    category: z.literal('diagram'),
    graph: DiagramGraphSchema
  }),
  z.object({
    category: z.literal('illustration'),
    brief: IllustrationBriefSchema
  }),
  z.object({
    category: z.literal('hybrid'),
    brief: IllustrationBriefSchema,
    callouts: z.array(HybridCalloutSchema).default([])
  }),
  z.object({
    category: z.literal('text'),
    recognizedText: z.string().min(1)
  })
])
export type SmartClassification = z.infer<typeof SmartClassificationSchema>

export const VectorCritiqueResultSchema = z.object({
  approved: z.boolean(),
  issues: z.array(z.string()).default([]),
  repairedScene: SpatialSceneSchema.optional(),
  repairedGraph: DiagramGraphSchema.optional()
})
export type VectorCritiqueResult = z.infer<typeof VectorCritiqueResultSchema>

export const VectorPathLayerSchema = z.object({
  id: z.string().min(1),
  d: z.string().min(1),
  fill: z.string(),
  stroke: z.string().optional(),
  strokeWidth: z.number().optional()
})
export type VectorPathLayer = z.infer<typeof VectorPathLayerSchema>

export type SmartBeautifyMode = 'auto' | 'trace_only' | 'flat_vector' | 'clean_line_art' | 'editorial_poster'

export interface SmartBeautifyRequest {
  /** Clean cropped color-preserving PNG (base64 without data: prefix) for tracing/refinement */
  base64Png: string
  /** Optional 0..1000 coordinate-ruled PNG to boost Vision LLM spatial coordinate precision */
  ruledBase64Png?: string
  width: number
  height: number
  mode?: SmartBeautifyMode
  /** Active AI provider config (unused when mode === 'trace_only') */
  provider?: ProviderId
  model?: string
  ollamaHost?: string
  temperature?: number
  /** Optional local ComfyUI endpoint for offline ControlNet Scribble refinement */
  comfyUiUrl?: string
  /** Optional hints from selected strokes/colors/texts */
  textHints?: string
  paletteHints?: string[]
  isMonochromeHint?: boolean
}

export interface SmartBeautifyResponse {
  ok: boolean
  error?: string
  category?: 'spatial_scene' | 'diagram' | 'illustration' | 'hybrid' | 'text'
  spatialScene?: SpatialScene
  graph?: DiagramGraph
  brief?: IllustrationBrief
  callouts?: HybridCallout[]
  recognizedText?: string
  /** Traced vector artwork payload for illustration / hybrid / trace_only */
  vectorArt?: {
    viewBoxWidth: number
    viewBoxHeight: number
    layers: VectorPathLayer[]
    refinementUsed: 'cloud' | 'local_comfyui' | 'trace_only'
  }
}

export interface VectorCritiqueRequest {
  /** Side-by-side PNG: LEFT = Original Sketch | RIGHT = Compiled Vector */
  comparisonBase64Png: string
  category: 'spatial_scene' | 'diagram'
  scene?: SpatialScene
  graph?: DiagramGraph
  provider?: ProviderId
  model?: string
  ollamaHost?: string
  textHints?: string
}

export interface VectorCritiqueResponse {
  ok: boolean
  approved: boolean
  issues: string[]
  repairedScene?: SpatialScene
  repairedGraph?: DiagramGraph
  error?: string
}


/**
 * Normalizes common LLM structural variations (e.g., grouped { cellStrips, connectors, texts },
 * openEnds: ['top'], connector waypoints/from/to, shape kind aliases) into SpatialSceneSchema shape.
 */
export function normalizeSpatialSceneInput(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const obj = raw as Record<string, unknown>

  const unwrap =
    !Array.isArray(obj.elements) &&
    !Array.isArray(obj.cellStrips) &&
    !Array.isArray(obj.shapes) &&
    !Array.isArray(obj.connectors) &&
    !Array.isArray(obj.texts) &&
    !Array.isArray(obj.paths) &&
    !Array.isArray(obj.svg_paths) &&
    !Array.isArray(obj.curves) &&
    obj.scene &&
    typeof obj.scene === 'object' &&
    !Array.isArray(obj.scene)
      ? (obj.scene as Record<string, unknown>)
      : obj

  let rawElements: Array<Record<string, unknown>> = []
  if (Array.isArray(unwrap.elements)) {
    rawElements = unwrap.elements.filter(
      (e): e is Record<string, unknown> => Boolean(e && typeof e === 'object')
    )
  } else {
    const pushGroup = (key: string, forcedType: string): void => {
      const list = unwrap[key]
      if (!Array.isArray(list)) return
      for (const item of list) {
        if (item && typeof item === 'object') {
          rawElements.push({ ...(item as Record<string, unknown>), type: forcedType })
        }
      }
    }
    pushGroup('cellStrips', 'cell_strip')
    pushGroup('cell_strips', 'cell_strip')
    pushGroup('shapes', 'shape')
    pushGroup('connectors', 'connector')
    pushGroup('curves', 'curve')
    pushGroup('paths', 'svg_path')
    pushGroup('svg_paths', 'svg_path')
    pushGroup('svgPaths', 'svg_path')
    pushGroup('texts', 'text')
  }

  const normalizedElements = rawElements.map((el, idx) => {
    const rawType = String(el.type ?? '').trim().toLowerCase()
    const id = typeof el.id === 'string' && el.id.trim() ? el.id.trim() : `el-${idx + 1}`

    if (
      rawType === 'cell_strip' ||
      rawType === 'cellstrip' ||
      rawType === 'strip' ||
      rawType === 'stack' ||
      rawType === 'queue' ||
      rawType === 'array' ||
      Array.isArray(el.cells)
    ) {
      const w = Math.max(20, Number(el.w ?? 200) || 200)
      const h = Math.max(20, Number(el.h ?? 200) || 200)
      const rawOrient = String(el.orientation ?? '').trim().toLowerCase()
      const orientation: 'vertical' | 'horizontal' = rawOrient.startsWith('h')
        ? 'horizontal'
        : rawOrient.startsWith('v')
          ? 'vertical'
          : w > h * 1.4
            ? 'horizontal'
            : 'vertical'
      const cells = Array.isArray(el.cells)
        ? el.cells
            .map((c) => {
              if (typeof c === 'string') return c
              if (typeof c === 'number' || typeof c === 'boolean') return String(c)
              if (c && typeof c === 'object') {
                const o = c as Record<string, unknown>
                const txt = o.label ?? o.text ?? o.value ?? o.name
                return txt !== undefined ? String(txt) : ''
              }
              return ''
            })
            .filter((s) => s.length > 0)
        : []
      const openEnds = Array.isArray(el.openEnds)
        ? Array.from(
            new Set(
              el.openEnds
                .map((e) => String(e).trim().toLowerCase())
                .map((e) => {
                  if (e === 'start' || e === 'top' || e === 'left') return 'start'
                  if (e === 'end' || e === 'bottom' || e === 'right') return 'end'
                  return null
                })
                .filter((e): e is 'start' | 'end' => e !== null)
            )
          )
        : undefined
      return {
        ...el,
        type: 'cell_strip' as const,
        id,
        orientation,
        x: Number(el.x ?? 0) || 0,
        y: Number(el.y ?? 0) || 0,
        w,
        h,
        cells,
        ...(openEnds && openEnds.length > 0 ? { openEnds } : {})
      }
    }

    if (
      rawType === 'svg_path' ||
      rawType === 'svg-path' ||
      rawType === 'path' ||
      typeof el.d === 'string' ||
      Array.isArray(el.paths)
    ) {
      const rawStyle = String(el.strokeStyle ?? el.style ?? (el.dashed ? 'dashed' : 'solid'))
        .trim()
        .toLowerCase()
      const strokeStyle: 'solid' | 'dashed' | 'dotted' =
        rawStyle === 'dashed' || rawStyle === 'dotted' ? rawStyle : 'solid'
      return {
        ...el,
        type: 'svg_path' as const,
        id,
        x: Number(el.x ?? 0) || 0,
        y: Number(el.y ?? 0) || 0,
        w: Math.max(8, Number(el.w ?? 1000) || 1000),
        h: Math.max(8, Number(el.h ?? 1000) || 1000),
        strokeStyle
      }
    }

    const isCurveAlias = rawType === 'curve' || rawType === 'wave' || rawType === 'spline'

    if (
      rawType === 'connector' ||
      rawType === 'arrow' ||
      rawType === 'line' ||
      rawType === 'edge' ||
      isCurveAlias ||
      Array.isArray(el.points) ||
      Array.isArray(el.waypoints) ||
      (Array.isArray(el.from) && Array.isArray(el.to)) ||
      (el.x1 !== undefined && el.y1 !== undefined && el.x2 !== undefined && el.y2 !== undefined)
    ) {
      const toPt = (p: unknown): [number, number] | null => {
        if (Array.isArray(p) && p.length >= 2) {
          const x = Number(p[0])
          const y = Number(p[1])
          return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null
        }
        if (p && typeof p === 'object') {
          const o = p as Record<string, unknown>
          const x = Number(o.x)
          const y = Number(o.y)
          return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null
        }
        return null
      }

      let candidatePts: unknown[] = []
      if (Array.isArray(el.points) && el.points.length >= 2) {
        candidatePts = el.points
      } else if (Array.isArray(el.waypoints) && el.waypoints.length >= 2) {
        candidatePts = el.waypoints
      } else if (Array.isArray(el.from) && Array.isArray(el.to)) {
        const mid = Array.isArray(el.waypoints) ? el.waypoints : []
        candidatePts = [el.from, ...mid, el.to]
      } else if (
        el.x1 !== undefined &&
        el.y1 !== undefined &&
        el.x2 !== undefined &&
        el.y2 !== undefined
      ) {
        candidatePts = [
          [el.x1, el.y1],
          [el.x2, el.y2]
        ]
      }
      const points = candidatePts.map(toPt).filter((p): p is [number, number] => p !== null)

      const rawStyle = String(el.style ?? el.strokeStyle ?? (el.dashed ? 'dashed' : 'solid'))
        .trim()
        .toLowerCase()
      const style: 'solid' | 'dashed' | 'dotted' =
        rawStyle === 'dashed' || rawStyle === 'dotted' ? rawStyle : 'solid'

      const arrowEnd =
        el.arrowEnd !== undefined
          ? Boolean(el.arrowEnd)
          : el.directed !== undefined
            ? Boolean(el.directed)
            : !isCurveAlias && rawType !== 'line'

      return {
        ...el,
        type: 'connector' as const,
        id,
        points,
        ...(isCurveAlias && el.curved === undefined ? { curved: true } : {}),
        arrowEnd,
        style
      }
    }

    if (
      rawType === 'text' ||
      rawType === 'label' ||
      (typeof (el.text ?? el.content) === 'string' &&
        el.w === undefined &&
        el.h === undefined &&
        el.r === undefined &&
        el.rx === undefined)
    ) {
      const text = String(el.text ?? el.label ?? el.content ?? '').trim()
      return {
        ...el,
        type: 'text' as const,
        id,
        x: Number(el.x ?? 0) || 0,
        y: Number(el.y ?? 0) || 0,
        text
      }
    }

    const rawKindSource = String(
      el.kind ??
        (rawType && rawType !== 'shape' ? rawType : el.r !== undefined ? 'circle' : 'rect')
    )
      .trim()
      .toLowerCase()
    const normalizedKey = rawKindSource.replace(/[\s-]+/g, '_')
    const kindAliases: Record<string, string> = {
      rect: 'rect',
      rectangle: 'rect',
      box: 'rect',
      square: 'rect',
      rounded_rect: 'rounded_rect',
      rounded: 'rounded_rect',
      roundedrectangle: 'rounded_rect',
      pill: 'rounded_rect',
      ellipse: 'ellipse',
      circle: 'circle',
      oval: 'ellipse',
      diamond: 'diamond',
      rhombus: 'diamond',
      triangle: 'triangle',
      cylinder: 'cylinder',
      db: 'cylinder',
      database: 'cylinder',
      parallelogram: 'parallelogram',
      star: 'star-5',
      star5: 'star-5',
      star_5: 'star-5',
      sphere: 'sphere3d',
      cube: 'cube3d'
    }
    const kind =
      kindAliases[normalizedKey] ??
      (rawKindSource.replace(/[\s_]+/g, '-') || 'rect')

    let x = Number(el.x ?? 0) || 0
    let y = Number(el.y ?? 0) || 0
    let w = Math.max(6, Number(el.w ?? 120) || 120)
    let h = Math.max(6, Number(el.h ?? 80) || 80)

    if (
      el.cx !== undefined &&
      el.cy !== undefined &&
      Number.isFinite(Number(el.cx)) &&
      Number.isFinite(Number(el.cy)) &&
      (el.r !== undefined || el.rx !== undefined || el.ry !== undefined)
    ) {
      const rx = Math.max(4, Number(el.rx ?? el.r ?? 40) || 40)
      const ry = Math.max(4, Number(el.ry ?? el.r ?? rx) || rx)
      x = Number(el.cx) - rx
      y = Number(el.cy) - ry
      w = rx * 2
      h = ry * 2
    }

    return {
      ...el,
      type: 'shape' as const,
      id,
      kind,
      x,
      y,
      w,
      h
    }
  })

  return {
    title: typeof unwrap.title === 'string' ? unwrap.title : undefined,
    elements: normalizedElements
  }
}
