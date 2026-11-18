import rawLibrary from './shapeLibrary.json'

export type ShapePathRole = 'fill' | 'none' | 'shade' | 'light' | 'solid'
export type ShapeDashKind = 'dash' | 'dot' | 'dashdot'

export interface ShapePathSpec {
  d: string
  fill: ShapePathRole
  rule?: 'evenodd' | 'nonzero'
  dash?: ShapeDashKind
  stroke?: 'none' | string
  sw?: number
}

export interface LibraryShapeDef {
  id: string
  name: string
  category: string
  sources: ('miro' | 'drawio')[]
  size: [number, number]
  paths: ShapePathSpec[]
  text?: [number, number, number, number]
  defaultFill?: string
  defaultLabel?: string
  aliases: string[]
  tags: string[]
}

export interface ShapeCategoryDef {
  id: string
  name: string
  description: string
  count: number
}

export interface ShapeLibraryFile {
  $schema?: string
  name: string
  description: string
  version: number
  viewBox: string
  generatedBy: string
  count: number
  categories: ShapeCategoryDef[]
  shapes: LibraryShapeDef[]
}

const CATEGORY_DESCRIPTION_OVERRIDES: Record<string, string> = {
  basic: 'Basic geometric shapes and containers',
  polygons: 'Regular polygons and star variants',
  arrows: 'Directional block arrows and indicators',
  lines: 'Connector lines, arrows, and curves',
  flowchart: 'Full ANSI / ISO flowchart shapes',
  threeD: 'Cube, cylinder, cone, pyramid, and sphere shapes',
  mockup: 'UI controls and device wireframe frames'
}

function sanitizeDisplayText(text: string): string {
  return text
    .replace(/\s*\((?:Miro|draw\.io|diagrams\.net)\)\s*/gi, '')
    .replace(/\b(?:Miro|draw\.io|diagrams\.net)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export const ANIMATED_LINE_SHAPES: LibraryShapeDef[] = [
  {
    id: 'anim-line-flow',
    name: 'Flowing Line',
    category: 'lines',
    sources: [],
    size: [160, 44],
    paths: [{ d: 'M 6 50 L 94 50', fill: 'none', dash: 'dash' }],
    defaultLabel: '',
    aliases: ['flowing line', 'animated line'],
    tags: ['line', 'connector', 'animated', 'flow', 'dashed']
  },
  {
    id: 'anim-line-arrow',
    name: 'Animated Flow Arrow',
    category: 'lines',
    sources: [],
    size: [160, 48],
    paths: [
      { d: 'M 6 50 L 90 50', fill: 'none', dash: 'dash' },
      { d: 'M 74 34 L 92 50 L 74 66', fill: 'none' }
    ],
    defaultLabel: '',
    aliases: ['animated arrow', 'flow arrow'],
    tags: ['line', 'arrow', 'connector', 'animated', 'flow']
  },
  {
    id: 'anim-line-double-arrow',
    name: 'Bidirectional Flow Line',
    category: 'lines',
    sources: [],
    size: [160, 48],
    paths: [
      { d: 'M 10 50 L 90 50', fill: 'none', dash: 'dash' },
      { d: 'M 26 34 L 8 50 L 26 66', fill: 'none' },
      { d: 'M 74 34 L 92 50 L 74 66', fill: 'none' }
    ],
    defaultLabel: '',
    aliases: ['bidirectional flow', 'double arrow line'],
    tags: ['line', 'arrow', 'bidirectional', 'animated', 'connector']
  },
  {
    id: 'anim-line-dotted',
    name: 'Dotted Pulse Line',
    category: 'lines',
    sources: [],
    size: [160, 48],
    paths: [
      { d: 'M 6 50 L 92 50', fill: 'none', dash: 'dot' },
      { d: 'M 76 36 L 92 50 L 76 64', fill: 'none' }
    ],
    defaultLabel: '',
    aliases: ['dotted pulse', 'animated dotted line'],
    tags: ['line', 'dotted', 'pulse', 'animated', 'connector']
  },
  {
    id: 'anim-line-elbow',
    name: 'Animated Elbow Connector',
    category: 'lines',
    sources: [],
    size: [150, 90],
    paths: [
      { d: 'M 8 80 L 50 80 L 50 20 L 92 20', fill: 'none', dash: 'dash' },
      { d: 'M 76 8 L 92 20 L 76 32', fill: 'none' }
    ],
    defaultLabel: '',
    aliases: ['animated elbow', 'step up connector'],
    tags: ['line', 'elbow', 'step', 'orthogonal', 'animated', 'connector']
  },
  {
    id: 'anim-line-step-down',
    name: 'Animated Step-Down Line',
    category: 'lines',
    sources: [],
    size: [150, 90],
    paths: [
      { d: 'M 8 20 L 50 20 L 50 80 L 92 80', fill: 'none', dash: 'dash' },
      { d: 'M 76 68 L 92 80 L 76 92', fill: 'none' }
    ],
    defaultLabel: '',
    aliases: ['step down line', 'orthogonal connector'],
    tags: ['line', 'step', 'elbow', 'animated', 'connector']
  },
  {
    id: 'anim-line-curve',
    name: 'Animated S-Curve Connector',
    category: 'lines',
    sources: [],
    size: [150, 90],
    paths: [
      { d: 'M 8 80 C 50 80 50 20 92 20', fill: 'none', dash: 'dash' },
      { d: 'M 76 8 L 92 20 L 76 32', fill: 'none' }
    ],
    defaultLabel: '',
    aliases: ['animated curve', 'bezier connector'],
    tags: ['line', 'curve', 'bezier', 'animated', 'connector']
  },
  {
    id: 'anim-line-circuit',
    name: 'Circuit Pulse Bus',
    category: 'lines',
    sources: [],
    size: [160, 48],
    paths: [
      { d: 'M 14 50 L 86 50', fill: 'none', dash: 'dashdot' },
      { d: 'M 8 50 A 3 3 0 1 0 14 50 A 3 3 0 1 0 8 50', fill: 'solid' },
      { d: 'M 86 50 A 3 3 0 1 0 92 50 A 3 3 0 1 0 86 50', fill: 'solid' }
    ],
    defaultLabel: '',
    aliases: ['circuit bus', 'node link', 'pulse bus'],
    tags: ['line', 'circuit', 'bus', 'endpoints', 'animated', 'connector']
  },
  {
    id: 'anim-line-wave',
    name: 'Animated Wave Stream',
    category: 'lines',
    sources: [],
    size: [160, 56],
    paths: [
      { d: 'M 6 50 Q 28 20 50 50 T 94 50', fill: 'none', dash: 'dash' },
      { d: 'M 78 36 L 94 50 L 78 64', fill: 'none' }
    ],
    defaultLabel: '',
    aliases: ['wave stream', 'signal wave'],
    tags: ['line', 'wave', 'signal', 'stream', 'animated']
  },
  {
    id: 'anim-line-fork',
    name: 'Animated Branch / Fork',
    category: 'lines',
    sources: [],
    size: [150, 100],
    paths: [
      { d: 'M 8 50 L 48 50', fill: 'none', dash: 'dash' },
      { d: 'M 48 22 L 48 78', fill: 'none', dash: 'dash' },
      { d: 'M 48 22 L 90 22', fill: 'none', dash: 'dash' },
      { d: 'M 48 78 L 90 78', fill: 'none', dash: 'dash' },
      { d: 'M 78 12 L 92 22 L 78 32', fill: 'none' },
      { d: 'M 78 68 L 92 78 L 78 88', fill: 'none' }
    ],
    defaultLabel: '',
    aliases: ['branch connector', 'fork line'],
    tags: ['line', 'fork', 'branch', 'split', 'animated']
  },
  {
    id: 'anim-line-loop',
    name: 'Animated Feedback Loop',
    category: 'lines',
    sources: [],
    size: [150, 84],
    paths: [
      { d: 'M 16 65 L 84 65 C 94 65 94 25 84 25 L 22 25', fill: 'none', dash: 'dash' },
      { d: 'M 36 13 L 18 25 L 36 37', fill: 'none' }
    ],
    defaultLabel: '',
    aliases: ['feedback loop', 'return arrow'],
    tags: ['line', 'loop', 'feedback', 'return', 'animated']
  },
  {
    id: 'anim-line-diagonal',
    name: 'Animated Diagonal Vector',
    category: 'lines',
    sources: [],
    size: [130, 100],
    paths: [
      { d: 'M 12 86 L 88 14', fill: 'none', dash: 'dash' },
      { d: 'M 68 14 L 88 14 L 88 34', fill: 'none' }
    ],
    defaultLabel: '',
    aliases: ['diagonal vector', 'slope line'],
    tags: ['line', 'diagonal', 'vector', 'arrow', 'animated']
  }
]

export const SHAPE_LIBRARY: ShapeLibraryFile = rawLibrary as unknown as ShapeLibraryFile
export const SHAPE_CATEGORIES: ShapeCategoryDef[] = SHAPE_LIBRARY.categories.map((cat) => ({
  ...cat,
  description: CATEGORY_DESCRIPTION_OVERRIDES[cat.id] ?? sanitizeDisplayText(cat.description)
}))
export const ALL_LIBRARY_SHAPES: LibraryShapeDef[] = SHAPE_LIBRARY.shapes.map((s) => ({
  ...s,
  name: sanitizeDisplayText(s.name)
}))

export const SHAPE_BY_ID: Map<string, LibraryShapeDef> = new Map([
  ...ALL_LIBRARY_SHAPES.map((s) => [s.id.toLowerCase(), s] as const),
  ...ANIMATED_LINE_SHAPES.map((s) => [s.id.toLowerCase(), s] as const)
])

export const SHAPE_BY_ALIAS: Map<string, LibraryShapeDef> = (() => {
  const map = new Map<string, LibraryShapeDef>()
  for (const s of [...ALL_LIBRARY_SHAPES, ...ANIMATED_LINE_SHAPES]) {
    for (const alias of s.aliases ?? []) {
      const key = alias.toLowerCase().trim()
      if (key && !map.has(key)) {
        map.set(key, s)
      }
    }
  }
  return map
})()

/**
 * Resolves a shape definition by exact ID, lowercase ID, or registered alias.
 */
export function getLibraryShape(idOrAlias: string): LibraryShapeDef | undefined {
  if (!idOrAlias) return undefined
  const trimmed = idOrAlias.trim()
  const lower = trimmed.toLowerCase()
  return (
    SHAPE_BY_ID.get(lower) ??
    SHAPE_BY_ALIAS.get(lower) ??
    SHAPE_BY_ALIAS.get(lower.replace(/[\s_]+/g, '-'))
  )
}

export function resolvePathFill(
  role: ShapePathRole,
  fillColor: string,
  strokeColor: string
): string {
  switch (role) {
    case 'fill':
      return fillColor
    case 'none':
      return 'none'
    case 'shade':
      return 'rgba(0, 0, 0, 0.28)'
    case 'light':
      return 'rgba(255, 255, 255, 0.22)'
    case 'solid':
      return strokeColor
  }
}

export function resolveDashArray(dash?: ShapeDashKind): string | undefined {
  if (dash === 'dash') return '6 4'
  if (dash === 'dot') return '2 3'
  if (dash === 'dashdot') return '6 3 2 3'
  return undefined
}

function resolveDashSegments(dash?: ShapeDashKind): number[] {
  if (dash === 'dash') return [8, 5]
  if (dash === 'dot') return [2, 4]
  if (dash === 'dashdot') return [8, 4, 2, 4]
  return []
}

/**
 * Renders any library shape onto a Canvas2D context using Path2D + DOMMatrix
 * so strokes remain crisp and non-scaling across arbitrary aspect ratios.
 */
export function drawLibraryShapeOnCanvas(
  ctx: CanvasRenderingContext2D,
  shape: LibraryShapeDef,
  x: number,
  y: number,
  w: number,
  h: number,
  strokeColor: string,
  fillColor: string,
  strokeWidth = 3
): { labelX: number; labelY: number } {
  const rx = w < 0 ? x + w : x
  const ry = h < 0 ? y + h : y
  const rw = Math.max(1, Math.abs(w))
  const rh = Math.max(1, Math.abs(h))

  const matrix = new DOMMatrix().translate(rx, ry).scale(rw / 100, rh / 100)

  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  for (const p of shape.paths) {
    const scaledPath = new Path2D()
    scaledPath.addPath(new Path2D(p.d), matrix)

    const pathFill = resolvePathFill(p.fill, fillColor, strokeColor)
    if (pathFill !== 'none') {
      ctx.fillStyle = pathFill
      ctx.fill(scaledPath, p.rule ?? 'nonzero')
    }

    const pathStroke = p.stroke === 'none' ? 'none' : (p.stroke ?? strokeColor)
    if (pathStroke !== 'none') {
      ctx.strokeStyle = pathStroke
      ctx.lineWidth = (p.sw ?? 1) * strokeWidth
      ctx.setLineDash(resolveDashSegments(p.dash))
      ctx.stroke(scaledPath)
    }
  }

  ctx.restore()

  const [tx, ty, tw, th] = shape.text ?? [8, 8, 84, 84]
  return {
    labelX: rx + ((tx + tw / 2) / 100) * rw,
    labelY: ry + ((ty + th / 2) / 100) * rh
  }
}

function escapeAttr(val: string): string {
  return val.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Generates an inline nested <svg> block for any library shape suitable for SVG export.
 */
export function renderLibraryShapeSvgGroup(
  shape: LibraryShapeDef,
  x: number,
  y: number,
  w: number,
  h: number,
  strokeColor: string,
  fillColor: string,
  strokeWidth = 2.5
): string {
  const rx = w < 0 ? x + w : x
  const ry = h < 0 ? y + h : y
  const rw = Math.max(1, Math.abs(w))
  const rh = Math.max(1, Math.abs(h))

  const paths = shape.paths
    .map((p) => {
      const pathStroke = p.stroke === 'none' ? 'none' : (p.stroke ?? strokeColor)
      const pathFill = resolvePathFill(p.fill, fillColor, strokeColor)
      const sw = pathStroke === 'none' ? 0 : (p.sw ?? 1) * strokeWidth
      const dash = resolveDashArray(p.dash)
      const ruleAttr = p.rule ? ` fill-rule="${p.rule}"` : ''
      const dashAttr = dash ? ` stroke-dasharray="${dash}"` : ''
      return `    <path d="${escapeAttr(p.d)}" fill="${escapeAttr(pathFill)}"${ruleAttr} stroke="${escapeAttr(pathStroke)}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"${dashAttr} vector-effect="non-scaling-stroke" />`
    })
    .join('\n')

  return `  <svg x="${rx}" y="${ry}" width="${rw}" height="${rh}" viewBox="0 0 100 100" preserveAspectRatio="none">\n${paths}\n  </svg>\n`
}
