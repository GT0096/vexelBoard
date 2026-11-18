/* eslint-disable @typescript-eslint/explicit-function-return-type */
/**
 * Shape Library Generator
 * -----------------------
 * Builds `src/renderer/src/shapes/shapeLibrary.json`, a catalog of the shapes
 * found in the Miro shape panel and the draw.io (diagrams.net) built-in
 * geometric / diagram palettes: General, Basic, Misc, Advanced, Arrows,
 * Flowchart, UML, BPMN, Entity Relation, Network (generic) and Mockups.
 *
 * Every shape is described as one or more SVG paths in a normalised
 * 100 x 100 coordinate space. The renderer stretches that box to the node size
 * (preserveAspectRatio="none") and uses non-scaling strokes, which matches how
 * Miro and draw.io resize shapes.
 *
 * Path `fill` roles:
 *   fill  -> node fill colour        none   -> no fill (outline only)
 *   shade -> darker face (3D side)   light  -> lighter face (3D top)
 *   solid -> filled with the stroke/accent colour
 *
 * Run:  node scripts/generate-shape-library.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(__dirname, '../src/renderer/src/shapes/shapeLibrary.json')
const SCHEMA_OUT = resolve(__dirname, '../src/renderer/src/shapes/shapeLibrary.schema.json')

/* ------------------------------------------------------------------ */
/* Geometry helpers                                                    */
/* ------------------------------------------------------------------ */
const r2 = (n) => Math.round(n * 100) / 100
const pt = ([x, y]) => `${r2(x)} ${r2(y)}`

/** Closed polygon */
const P = (pts) => 'M' + pts.map(pt).join(' L') + ' Z'
/** Open polyline */
const PL = (pts) => 'M' + pts.map(pt).join(' L')
/** Ellipse as two arcs */
const E = (cx, cy, rx, ry) =>
  `M${r2(cx - rx)} ${r2(cy)} A${r2(rx)} ${r2(ry)} 0 1 0 ${r2(cx + rx)} ${r2(cy)} A${r2(rx)} ${r2(ry)} 0 1 0 ${r2(cx - rx)} ${r2(cy)} Z`
/** Rectangle */
const R = (x, y, w, h) => P([[x, y], [x + w, y], [x + w, y + h], [x, y + h]])
/** Rounded rectangle */
const RR = (x, y, w, h, r) => {
  const rr = Math.min(r, w / 2, h / 2)
  return (
    `M${r2(x + rr)} ${r2(y)} H${r2(x + w - rr)} A${r2(rr)} ${r2(rr)} 0 0 1 ${r2(x + w)} ${r2(y + rr)} ` +
    `V${r2(y + h - rr)} A${r2(rr)} ${r2(rr)} 0 0 1 ${r2(x + w - rr)} ${r2(y + h)} ` +
    `H${r2(x + rr)} A${r2(rr)} ${r2(rr)} 0 0 1 ${r2(x)} ${r2(y + h - rr)} ` +
    `V${r2(y + rr)} A${r2(rr)} ${r2(rr)} 0 0 1 ${r2(x + rr)} ${r2(y)} Z`
  )
}

/** Scale an arbitrary point list so its bounding box fills 0..100 */
const fit = (pts) => {
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const w = Math.max(...xs) - minX || 1
  const h = Math.max(...ys) - minY || 1
  return pts.map(([x, y]) => [((x - minX) / w) * 100, ((y - minY) / h) * 100])
}

const regularPts = (n, rot = -90) =>
  Array.from({ length: n }, (_, i) => {
    const a = ((rot + (360 * i) / n) * Math.PI) / 180
    return [Math.cos(a), Math.sin(a)]
  })

const regular = (n, rot = -90) => P(fit(regularPts(n, rot)))

const star = (n, inner, rot = -90) => {
  const pts = []
  for (let i = 0; i < n * 2; i++) {
    const rad = i % 2 === 0 ? 1 : inner
    const a = ((rot + (180 * i) / n) * Math.PI) / 180
    pts.push([rad * Math.cos(a), rad * Math.sin(a)])
  }
  return P(fit(pts))
}

/** Ring segment from angle a0 to a1 (degrees, clockwise on screen) */
const ringArc = (cx, cy, Ro, Ri, a0, a1) => {
  const p = (r, a) => [cx + r * Math.cos((a * Math.PI) / 180), cy + r * Math.sin((a * Math.PI) / 180)]
  const large = a1 - a0 > 180 ? 1 : 0
  return (
    `M${pt(p(Ro, a0))} A${Ro} ${Ro} 0 ${large} 1 ${pt(p(Ro, a1))} ` +
    `L${pt(p(Ri, a1))} A${Ri} ${Ri} 0 ${large} 0 ${pt(p(Ri, a0))} Z`
  )
}

const polar = (cx, cy, r, deg) => [cx + r * Math.cos((deg * Math.PI) / 180), cy + r * Math.sin((deg * Math.PI) / 180)]

/* Point-list transforms (only for polygon shapes) */
const flipX = (pts) => pts.map(([x, y]) => [100 - x, y])
const rotUp = (pts) => pts.map(([x, y]) => [y, 100 - x]) // right-pointing -> up-pointing
const rotDown = (pts) => pts.map(([x, y]) => [100 - y, x]) // right-pointing -> down-pointing

/* Mini command-path builder that supports transforms (M, L, Q, C, Z) */
const cmdPath = (cmds, tf = (p) => p) =>
  cmds
    .map((c) => {
      const [op, ...nums] = c
      if (op === 'Z') return 'Z'
      const out = []
      for (let i = 0; i < nums.length; i += 2) out.push(pt(tf([nums[i], nums[i + 1]])))
      return op + out.join(' ')
    })
    .join(' ')
const tfFlipX = ([x, y]) => [100 - x, y]
const tfUp = ([x, y]) => [y, 100 - x]
const tfDown = ([x, y]) => [100 - y, x]
const tfInto = (bx, by, bw, bh) => ([x, y]) => [bx + (x / 100) * bw, by + (y / 100) * bh]

/* Path role shorthands */
const f = (d, extra = {}) => ({ d, fill: 'fill', ...extra })
const n = (d, extra = {}) => ({ d, fill: 'none', ...extra })
const sh = (d, extra = {}) => ({ d, fill: 'shade', ...extra })
const lt = (d, extra = {}) => ({ d, fill: 'light', ...extra })
const so = (d, extra = {}) => ({ d, fill: 'solid', ...extra })

/* ------------------------------------------------------------------ */
/* Reusable outlines                                                   */
/* ------------------------------------------------------------------ */
const CIRCLE = E(50, 50, 50, 50)
const DIAMOND = P([[50, 0], [100, 50], [50, 100], [0, 50]])
const STADIUM = 'M25 0 H75 A25 50 0 0 1 75 100 H25 A25 50 0 0 1 25 0 Z'
const CLOUD =
  'M25 90 C10 90 0 80 0 66 C0 52 10 44 22 44 C20 28 32 16 48 16 C60 16 70 24 74 34 C88 32 100 44 100 60 C100 77 88 90 72 90 Z'
const DOC_CMDS = [['M', 0, 0], ['L', 100, 0], ['L', 100, 84], ['C', 80, 72, 65, 72, 50, 84], ['C', 35, 96, 18, 96, 0, 86], ['Z']]
const DOCUMENT = cmdPath(DOC_CMDS)
const WAVE = 'M0 10 C25 -5 25 25 50 10 C75 -5 75 25 100 10 V90 C75 105 75 75 50 90 C25 105 25 75 0 90 Z'
const CYL_V = 'M0 12 A50 12 0 0 1 100 12 V88 A50 12 0 0 1 0 88 Z'
const CYL_V_TOP = 'M0 12 A50 12 0 0 0 100 12'
const CYL_H = 'M12 0 H88 A12 50 0 0 1 88 100 H12 A12 50 0 0 1 12 0 Z'
const CYL_H_FRONT = 'M88 0 A12 50 0 0 0 88 100'
const NOTE = P([[0, 0], [80, 0], [100, 20], [100, 100], [0, 100]])
const NOTE_FOLD = PL([[80, 0], [80, 20], [100, 20]])
const HOURGLASS_TOP = P([[0, 0], [100, 0], [50, 50]])
const HOURGLASS_BOTTOM = P([[50, 50], [100, 100], [0, 100]])
const ARROW_R = [[0, 30], [60, 30], [60, 0], [100, 50], [60, 100], [60, 70], [0, 70]]
const CALLOUT_ARROW_R = [[0, 0], [60, 0], [60, 30], [75, 30], [75, 15], [100, 50], [75, 85], [75, 70], [60, 70], [60, 100], [0, 100]]
const CURVED_ARROW_R = [['M', 0, 100], ['Q', 0, 20, 70, 20], ['L', 70, 0], ['L', 100, 30], ['L', 70, 60], ['L', 70, 40], ['Q', 20, 40, 20, 100], ['Z']]
const LIGHTNING = [[38, 0], [78, 0], [56, 38], [86, 38], [22, 100], [40, 52], [12, 52]]
const ENVELOPE_FLAP = PL([[0, 0], [50, 55], [100, 0]])
const CROSS = [[35, 0], [65, 0], [65, 35], [100, 35], [100, 65], [65, 65], [65, 100], [35, 100], [35, 65], [0, 65], [0, 35], [35, 35]]
const X_SHAPE = [[20, 0], [50, 30], [80, 0], [100, 20], [70, 50], [100, 80], [80, 100], [50, 70], [20, 100], [0, 80], [30, 50], [0, 20]]
const BRACE_L = 'M60 0 Q40 0 40 10 V40 Q40 50 20 50 Q40 50 40 60 V90 Q40 100 60 100'
const BRACE_R = 'M40 0 Q60 0 60 10 V40 Q60 50 80 50 Q60 50 60 60 V90 Q60 100 40 100'

const gear = (teeth = 8) => {
  const pts = []
  const step = 360 / teeth
  for (let i = 0; i < teeth; i++) {
    const a = i * step - 90
    pts.push(polar(50, 50, 38, a - step * 0.5))
    pts.push(polar(50, 50, 38, a - step * 0.22))
    pts.push(polar(50, 50, 50, a - step * 0.15))
    pts.push(polar(50, 50, 50, a + step * 0.15))
    pts.push(polar(50, 50, 38, a + step * 0.22))
  }
  return P(pts)
}

const explosion = () => {
  const radii = [1, 0.62, 0.92, 0.55, 1, 0.68, 0.85, 0.5, 0.97, 0.6, 0.9, 0.58, 1, 0.66, 0.88, 0.52, 0.95, 0.63, 0.86, 0.55, 1, 0.6]
  const pts = radii.map((r, i) => {
    const a = ((-90 + (360 * i) / radii.length) * Math.PI) / 180
    return [r * Math.cos(a), r * Math.sin(a)]
  })
  return P(fit(pts))
}

const sunRays = () => {
  const rays = []
  for (let i = 0; i < 8; i++) {
    const a = i * 45
    rays.push(P([polar(50, 50, 50, a), polar(50, 50, 33, a - 12), polar(50, 50, 33, a + 12)]))
  }
  return rays.join(' ')
}

const gridLines = (cols, rows, headerY = null) => {
  const parts = []
  for (let c = 1; c < cols; c++) parts.push(`M${r2((100 * c) / cols)} 0 V100`)
  for (let r = 1; r < rows; r++) parts.push(`M0 ${r2((100 * r) / rows)} H100`)
  if (headerY !== null) parts.push(`M0 ${headerY} H100`)
  return parts.join(' ')
}

/* ------------------------------------------------------------------ */
/* Categories                                                          */
/* ------------------------------------------------------------------ */
const categories = [
  { id: 'basic', name: 'Basic Shapes', description: 'Miro basic shapes + draw.io General / Basic palette' },
  { id: 'polygons', name: 'Polygons & Stars', description: 'Regular polygons and star variants (draw.io Basic)' },
  { id: 'arrows', name: 'Block Arrows', description: 'Miro arrows + draw.io Arrows palette' },
  { id: 'lines', name: 'Lines & Connectors', description: 'draw.io General line / arrow / curve shapes' },
  { id: 'flowchart', name: 'Flowchart', description: 'Full ANSI / ISO flowchart set (Miro + draw.io Flowchart)' },
  { id: 'callouts', name: 'Callouts & Bubbles', description: 'Speech, thought and line callouts' },
  { id: 'brackets', name: 'Brackets & Annotations', description: 'Braces, brackets, parentheses, annotations' },
  { id: 'containers', name: 'Containers & Tables', description: 'Swimlanes, frames, folders, lists, tables' },
  { id: 'threeD', name: '3D Shapes', description: 'Cube, cylinder, cone, pyramid, sphere (draw.io Basic / Advanced)' },
  { id: 'symbols', name: 'Symbols & Icons', description: 'Heart, lightning, gear, pin, flag, check and more' },
  { id: 'uml', name: 'UML', description: 'Class, use case, activity, state, sequence & component shapes' },
  { id: 'bpmn', name: 'BPMN', description: 'Activities, events, gateways, data & pools' },
  { id: 'er', name: 'Entity Relation', description: 'Chen notation entities, attributes, relationships, tables' },
  { id: 'network', name: 'Network & Infra', description: 'Generic servers, devices, network gear' },
  { id: 'mockup', name: 'Wireframe / Mockup', description: 'UI controls and device frames (Miro wireframes + draw.io Mockups)' }
]

/* ------------------------------------------------------------------ */
/* Shape definitions                                                   */
/* ------------------------------------------------------------------ */
const shapes = []
const MD = ['miro', 'drawio']
const D = ['drawio']
const M = ['miro']

/**
 * add(id, name, category, sources, size, paths, opts)
 * opts: { tags, aliases, text:[x,y,w,h], defaultFill, defaultLabel }
 */
function add(id, name, category, sources, size, paths, opts = {}) {
  if (shapes.some((s) => s.id === id)) throw new Error(`Duplicate shape id: ${id}`)
  shapes.push({
    id,
    name,
    category,
    sources,
    size,
    paths,
    ...(opts.text ? { text: opts.text } : {}),
    ...(opts.defaultFill ? { defaultFill: opts.defaultFill } : {}),
    ...(opts.defaultLabel !== undefined ? { defaultLabel: opts.defaultLabel } : {}),
    aliases: opts.aliases ?? [],
    tags: opts.tags ?? []
  })
}

/* ---------- Basic ---------- */
add('rectangle', 'Rectangle', 'basic', MD, [140, 80], [f(R(0, 0, 100, 100))], { aliases: ['rect', 'box'] })
add('square', 'Square', 'basic', D, [90, 90], [f(R(0, 0, 100, 100))])
add('rounded-rectangle', 'Rounded Rectangle', 'basic', MD, [140, 80], [f(RR(0, 0, 100, 100, 14))], { aliases: ['rounded-rect', 'roundrect'] })
add('ellipse', 'Ellipse', 'basic', MD, [140, 90], [f(CIRCLE)], { aliases: ['oval'] })
add('circle', 'Circle', 'basic', MD, [90, 90], [f(CIRCLE)])
add('triangle', 'Triangle', 'basic', MD, [100, 90], [f(P([[50, 0], [100, 100], [0, 100]]))], { text: [20, 45, 60, 50] })
add('triangle-down', 'Inverted Triangle', 'basic', D, [100, 90], [f(P([[0, 0], [100, 0], [50, 100]]))], { text: [20, 5, 60, 50] })
add('right-triangle', 'Right Triangle', 'basic', D, [100, 90], [f(P([[0, 0], [100, 100], [0, 100]]))], { text: [5, 45, 55, 50], aliases: ['orthogonal-triangle'] })
add('rhombus', 'Rhombus / Diamond', 'basic', MD, [110, 90], [f(DIAMOND)], { text: [22, 22, 56, 56], aliases: ['diamond'] })
add('parallelogram', 'Parallelogram', 'basic', MD, [140, 80], [f(P([[20, 0], [100, 0], [80, 100], [0, 100]]))], { text: [18, 5, 64, 90] })
add('parallelogram-left', 'Parallelogram (Left)', 'basic', D, [140, 80], [f(P([[0, 0], [80, 0], [100, 100], [20, 100]]))], { text: [18, 5, 64, 90] })
add('trapezoid', 'Trapezoid', 'basic', MD, [140, 80], [f(P([[20, 0], [80, 0], [100, 100], [0, 100]]))], { text: [18, 5, 64, 90] })
add('trapezoid-inverted', 'Inverted Trapezoid', 'basic', D, [140, 80], [f(P([[0, 0], [100, 0], [80, 100], [20, 100]]))], { text: [18, 5, 64, 90] })
add('cross', 'Cross / Plus', 'basic', MD, [90, 90], [f(P(CROSS))], { aliases: ['plus'], text: [35, 35, 30, 30] })
add('x-shape', 'X Shape', 'basic', D, [90, 90], [f(P(X_SHAPE))], { aliases: ['times'] })
add('half-circle', 'Half Circle', 'basic', D, [120, 60], [f('M0 100 A50 100 0 0 1 100 100 Z')], { text: [15, 35, 70, 60], aliases: ['semicircle'] })
add('quarter-circle', 'Quarter Circle', 'basic', D, [90, 90], [f('M0 100 V0 A100 100 0 0 1 100 100 Z')], { text: [5, 40, 60, 55] })
add('pie', 'Pie (Three Quarter)', 'basic', D, [90, 90], [f('M50 50 L50 0 A50 50 0 1 0 100 50 Z')], { aliases: ['three-quarter-circle', 'partial-circle'] })
add('chord', 'Chord', 'basic', D, [90, 90], [f('M14.64 14.64 A50 50 0 1 0 85.36 14.64 Z')])
add('donut', 'Donut / Ring', 'basic', D, [90, 90], [f(E(50, 50, 50, 50) + ' ' + E(50, 50, 26, 26), { rule: 'evenodd' })], { text: [30, 35, 40, 30] })
add('block-arc', 'Block Arc', 'basic', D, [120, 60], [f('M0 100 A50 100 0 0 1 100 100 L75 100 A25 50 0 0 0 25 100 Z')], { text: [10, 80, 80, 20] })
add('arc', 'Arc', 'basic', D, [100, 60], [n('M5 95 A45 90 0 0 1 95 95')])
add('frame', 'Frame', 'basic', D, [120, 90], [f(R(0, 0, 100, 100) + ' ' + R(12, 12, 76, 76), { rule: 'evenodd' })])
add('plaque', 'Plaque', 'basic', D, [140, 80], [f('M10 0 H90 A10 10 0 0 0 100 10 V90 A10 10 0 0 0 90 100 H10 A10 10 0 0 0 0 90 V10 A10 10 0 0 0 10 0 Z')])
add('snip-diagonal-rect', 'Diagonal Snip Rectangle', 'basic', D, [140, 80], [f(P([[15, 0], [100, 0], [100, 85], [85, 100], [0, 100], [0, 15]]))])
add('snip-corner-rect', 'Snip Corner Rectangle', 'basic', D, [140, 80], [f(P([[0, 0], [85, 0], [100, 15], [100, 100], [0, 100]]))])
add('snip-same-side-rect', 'Snip Same-Side Rectangle', 'basic', D, [140, 80], [f(P([[15, 0], [85, 0], [100, 15], [100, 100], [0, 100], [0, 15]]))])
add('round-corner-rect', 'One Side Rounded Rectangle', 'basic', D, [140, 80], [f('M0 0 H80 A20 20 0 0 1 100 20 V100 H0 Z')])
add('diagonal-rounded-rect', 'Diagonal Rounded Rectangle', 'basic', D, [140, 80], [f('M20 0 H100 V80 A20 20 0 0 1 80 100 H0 V20 A20 20 0 0 1 20 0 Z')])
add('stadium', 'Stadium / Pill', 'basic', MD, [150, 60], [f(STADIUM)], { aliases: ['pill', 'capsule'] })
add('pointed-oval', 'Pointed Oval / Lens', 'basic', D, [140, 80], [f('M0 50 Q50 -20 100 50 Q50 120 0 50 Z')], { aliases: ['lens', 'vesica'] })
add('corner', 'Corner (L-Shape)', 'basic', D, [90, 90], [f(P([[0, 0], [30, 0], [30, 70], [100, 70], [100, 100], [0, 100]]))], { aliases: ['l-shape'] })
add('tee', 'Tee (T-Shape)', 'basic', D, [100, 90], [f(P([[0, 0], [100, 0], [100, 30], [65, 30], [65, 100], [35, 100], [35, 30], [0, 30]]))], { aliases: ['t-shape'] })
add('layered-rect', 'Layered Rectangle', 'basic', D, [140, 90], [f(R(20, 0, 80, 80)), f(R(10, 10, 80, 80)), f(R(0, 20, 80, 80))], { text: [0, 20, 80, 80] })
add('partial-rect', 'Partial Rectangle', 'basic', D, [140, 80], [n(PL([[0, 100], [0, 0], [100, 0], [100, 100]]))])
add('dashed-rect', 'Dashed Rectangle', 'basic', D, [140, 80], [f(R(0, 0, 100, 100), { dash: 'dash' })])
add('text', 'Text', 'basic', MD, [140, 40], [n(R(0, 0, 100, 100), { stroke: 'none' })], { defaultLabel: 'Text', aliases: ['label'] })
add('textbox', 'Text Box', 'basic', D, [180, 90], [n(R(0, 0, 100, 100), { dash: 'dot' })], { defaultLabel: 'Heading\nBody text', text: [5, 5, 90, 90] })
add('sticky-note', 'Sticky Note', 'basic', M, [120, 120], [f(R(0, 0, 100, 100), { stroke: 'none' }), sh(P([[85, 100], [100, 85], [100, 100]]))], { defaultFill: '#fef08a', aliases: ['post-it'] })
add('miro-card', 'Card (Miro)', 'basic', M, [180, 90], [f(R(0, 0, 100, 100)), so(R(0, 0, 4, 100))], { text: [8, 8, 88, 84] })
add('banner', 'Banner', 'basic', D, [160, 70], [f(P([[0, 0], [100, 0], [88, 50], [100, 100], [0, 100], [12, 50]]))], { text: [14, 5, 72, 90] })
add('ribbon', 'Ribbon', 'basic', D, [180, 70], [
  sh(P([[0, 25], [18, 25], [18, 100], [0, 100], [8, 62]])),
  sh(P([[100, 25], [82, 25], [82, 100], [100, 100], [92, 62]])),
  f(R(12, 0, 76, 80))
], { text: [14, 5, 72, 70] })
add('shield', 'Shield', 'basic', D, [90, 100], [f('M50 0 L100 15 V45 C100 75 75 92 50 100 C25 92 0 75 0 45 V15 Z')], { text: [15, 15, 70, 55] })
add('cloud', 'Cloud', 'basic', MD, [140, 90], [f(CLOUD)], { text: [18, 30, 66, 55] })
add('wave', 'Wave / Tape', 'basic', D, [140, 80], [f(WAVE)], { aliases: ['tape'], text: [5, 15, 90, 70] })
add('double-wave', 'Double Wave', 'basic', D, [140, 80], [f('M0 15 C15 0 35 0 50 15 C65 30 85 30 100 15 V85 C85 70 65 70 50 85 C35 100 15 100 0 85 Z')], { text: [5, 20, 90, 60] })
add('can', 'Can / Cylinder', 'basic', MD, [90, 110], [f(CYL_V), n(CYL_V_TOP)], { aliases: ['cylinder'], text: [5, 28, 90, 62] })

/* ---------- Polygons & Stars ---------- */
add('pentagon', 'Pentagon', 'polygons', MD, [100, 95], [f(regular(5))], { text: [20, 25, 60, 60] })
add('hexagon', 'Hexagon', 'polygons', MD, [120, 90], [f(P([[25, 0], [75, 0], [100, 50], [75, 100], [25, 100], [0, 50]]))], { text: [20, 10, 60, 80] })
add('hexagon-vertical', 'Hexagon (Vertical)', 'polygons', D, [90, 110], [f(P([[50, 0], [100, 25], [100, 75], [50, 100], [0, 75], [0, 25]]))], { text: [10, 25, 80, 50] })
add('heptagon', 'Heptagon', 'polygons', D, [100, 100], [f(regular(7))], { text: [18, 20, 64, 60] })
add('octagon', 'Octagon', 'polygons', MD, [100, 100], [f(P([[30, 0], [70, 0], [100, 30], [100, 70], [70, 100], [30, 100], [0, 70], [0, 30]]))], { text: [12, 12, 76, 76] })
add('decagon', 'Decagon', 'polygons', D, [100, 100], [f(regular(10))], { text: [12, 12, 76, 76] })
add('dodecagon', 'Dodecagon', 'polygons', D, [100, 100], [f(regular(12))], { text: [12, 12, 76, 76] })
for (const [pts, inner] of [[3, 0.35], [4, 0.4], [5, 0.42], [6, 0.55], [7, 0.55], [8, 0.62], [10, 0.7], [12, 0.75], [16, 0.8], [24, 0.85], [32, 0.88]]) {
  add(`star-${pts}`, `${pts}-Point Star`, 'polygons', pts === 5 ? MD : D, [100, 100], [f(star(pts, inner))], {
    aliases: pts === 5 ? ['star'] : [],
    text: [28, 30, 44, 44]
  })
}
add('explosion', 'Explosion / Burst', 'polygons', D, [130, 110], [f(explosion())], { aliases: ['burst', 'starburst'], text: [25, 25, 50, 50] })
add('seal', 'Seal / Badge', 'polygons', D, [100, 100], [f(star(20, 0.88))], { text: [20, 20, 60, 60] })

/* ---------- Block Arrows ---------- */
add('arrow-right', 'Arrow Right', 'arrows', MD, [140, 70], [f(P(ARROW_R))], { aliases: ['arrow', 'single-arrow'], text: [2, 30, 70, 40] })
add('arrow-left', 'Arrow Left', 'arrows', MD, [140, 70], [f(P(flipX(ARROW_R)))], { text: [28, 30, 70, 40] })
add('arrow-up', 'Arrow Up', 'arrows', MD, [70, 140], [f(P(rotUp(ARROW_R)))], { text: [30, 28, 40, 70] })
add('arrow-down', 'Arrow Down', 'arrows', MD, [70, 140], [f(P(rotDown(ARROW_R)))], { text: [30, 2, 40, 70] })
const LR = [[0, 50], [25, 0], [25, 30], [75, 30], [75, 0], [100, 50], [75, 100], [75, 70], [25, 70], [25, 100]]
add('arrow-left-right', 'Left-Right Arrow', 'arrows', MD, [160, 70], [f(P(LR))], { aliases: ['double-arrow', 'two-way-arrow'], text: [20, 30, 60, 40] })
add('arrow-up-down', 'Up-Down Arrow', 'arrows', D, [70, 160], [f(P(rotUp(LR)))], { text: [30, 20, 40, 60] })
add('arrow-quad', 'Quad Arrow', 'arrows', D, [110, 110], [f(P([[50, 0], [70, 20], [60, 20], [60, 40], [80, 40], [80, 30], [100, 50], [80, 70], [80, 60], [60, 60], [60, 80], [70, 80], [50, 100], [30, 80], [40, 80], [40, 60], [20, 60], [20, 70], [0, 50], [20, 30], [20, 40], [40, 40], [40, 20], [30, 20]]))], { aliases: ['four-way-arrow'] })
add('arrow-tri', 'Left-Right-Up Arrow', 'arrows', D, [120, 100], [f(P([[50, 0], [70, 20], [60, 20], [60, 60], [80, 60], [80, 50], [100, 70], [80, 90], [80, 80], [20, 80], [20, 90], [0, 70], [20, 50], [20, 60], [40, 60], [40, 20], [30, 20]]))], { aliases: ['three-way-arrow'] })
add('arrow-left-up', 'Left-Up Arrow', 'arrows', D, [100, 100], [f(P([[0, 75], [20, 55], [20, 67], [67, 67], [67, 20], [55, 20], [75, 0], [95, 20], [83, 20], [83, 83], [20, 83], [20, 95]]))])
add('arrow-bent-up', 'Bent-Up Arrow', 'arrows', D, [100, 100], [f(P([[0, 70], [60, 70], [60, 25], [45, 25], [70, 0], [95, 25], [80, 25], [80, 100], [0, 100]]))])
add('arrow-bent', 'Bent Arrow', 'arrows', D, [110, 100], [f('M0 100 V50 Q0 20 30 20 H70 V0 L100 32 L70 64 V44 H34 Q24 44 24 54 V100 Z')], { aliases: ['bend-arrow'] })
add('arrow-bend-double', 'Bend Double Arrow', 'arrows', D, [110, 100], [f(P([[0, 30], [20, 10], [20, 22], [78, 22], [78, 80], [90, 80], [70, 100], [50, 80], [62, 80], [62, 38], [20, 38], [20, 50]]))])
add('arrow-u-turn', 'U-Turn Arrow', 'arrows', D, [110, 100], [f('M0 100 V40 Q0 0 40 0 H55 Q95 0 95 40 V55 H100 L80 80 L60 55 H70 V40 Q70 25 55 25 H40 Q25 25 25 40 V100 Z')])
add('arrow-circular', 'Circular Arrow', 'arrows', D, [100, 100], [
  f(ringArc(50, 50, 46, 30, 150, 390)),
  f(P([polar(50, 50, 54, 390), polar(50, 50, 22, 390), polar(50, 50, 38, 425)]))
], { aliases: ['cycle-arrow', 'refresh'] })
add('arrow-notched', 'Notched Arrow', 'arrows', D, [140, 70], [f(P([[0, 30], [60, 30], [60, 0], [100, 50], [60, 100], [60, 70], [0, 70], [15, 50]]))], { text: [15, 30, 55, 40] })
add('arrow-striped', 'Striped Arrow', 'arrows', D, [140, 70], [f(R(0, 30, 6, 40)), f(R(10, 30, 6, 40)), f(P([[20, 30], [60, 30], [60, 0], [100, 50], [60, 100], [60, 70], [20, 70]]))], { text: [22, 30, 50, 40] })
add('arrow-sharp', 'Sharp Arrow', 'arrows', D, [140, 70], [f(P([[0, 20], [55, 20], [45, 0], [100, 50], [45, 100], [55, 80], [0, 80]]))], { text: [2, 22, 60, 56] })
add('arrow-wedge', 'Wedge Arrow', 'arrows', D, [140, 70], [f(P([[0, 0], [100, 50], [0, 100], [20, 50]]))])
add('arrow-jump-in', 'Jump-In Arrow', 'arrows', D, [110, 100], [f('M0 100 Q10 20 65 25 L60 5 L100 40 L52 70 L58 48 Q25 45 0 100 Z')])
add('chevron', 'Chevron / Step', 'arrows', MD, [140, 70], [f(P([[0, 0], [75, 0], [100, 50], [75, 100], [0, 100], [25, 50]]))], { aliases: ['step'], text: [25, 10, 50, 80] })
add('chevron-left', 'Chevron Left', 'arrows', D, [140, 70], [f(P(flipX([[0, 0], [75, 0], [100, 50], [75, 100], [0, 100], [25, 50]])))], { text: [25, 10, 50, 80] })
add('pentagon-arrow', 'Pentagon Arrow / Home Plate', 'arrows', MD, [140, 70], [f(P([[0, 0], [75, 0], [100, 50], [75, 100], [0, 100]]))], { aliases: ['home-plate', 'process-step'], text: [5, 10, 70, 80] })
add('callout-arrow-right', 'Callout Arrow Right', 'arrows', D, [150, 80], [f(P(CALLOUT_ARROW_R))], { text: [2, 5, 56, 90] })
add('callout-arrow-left', 'Callout Arrow Left', 'arrows', D, [150, 80], [f(P(flipX(CALLOUT_ARROW_R)))], { text: [42, 5, 56, 90] })
add('callout-arrow-up', 'Callout Arrow Up', 'arrows', D, [80, 150], [f(P(rotUp(CALLOUT_ARROW_R)))], { text: [5, 42, 90, 56] })
add('callout-arrow-down', 'Callout Arrow Down', 'arrows', D, [80, 150], [f(P(rotDown(CALLOUT_ARROW_R)))], { text: [5, 2, 90, 56] })
add('callout-arrow-left-right', 'Callout Double Arrow', 'arrows', D, [170, 80], [f(P([[0, 50], [15, 15], [15, 30], [25, 30], [25, 0], [75, 0], [75, 30], [85, 30], [85, 15], [100, 50], [85, 85], [85, 70], [75, 70], [75, 100], [25, 100], [25, 70], [15, 70], [15, 85]]))], { text: [27, 5, 46, 90] })
add('callout-arrow-quad', 'Callout Quad Arrow', 'arrows', D, [120, 120], [f(P([[50, 0], [65, 15], [57, 15], [57, 30], [70, 30], [70, 43], [85, 43], [85, 35], [100, 50], [85, 65], [85, 57], [70, 57], [70, 70], [57, 70], [57, 85], [65, 85], [50, 100], [35, 85], [43, 85], [43, 70], [30, 70], [30, 57], [15, 57], [15, 65], [0, 50], [15, 35], [15, 43], [30, 43], [30, 30], [43, 30], [43, 15], [35, 15]]))], { text: [30, 30, 40, 40] })
add('arrow-curved-right', 'Curved Right Arrow', 'arrows', D, [110, 100], [f(cmdPath(CURVED_ARROW_R))])
add('arrow-curved-left', 'Curved Left Arrow', 'arrows', D, [110, 100], [f(cmdPath(CURVED_ARROW_R, tfFlipX))])
add('arrow-curved-up', 'Curved Up Arrow', 'arrows', D, [100, 110], [f(cmdPath(CURVED_ARROW_R, tfUp))])
add('arrow-curved-down', 'Curved Down Arrow', 'arrows', D, [100, 110], [f(cmdPath(CURVED_ARROW_R, tfDown))])

/* ---------- Lines & Connectors ---------- */
add('line-horizontal', 'Horizontal Line', 'lines', MD, [160, 20], [n('M0 50 H100')], { aliases: ['line'] })
add('line-vertical', 'Vertical Line', 'lines', D, [20, 160], [n('M50 0 V100')])
add('line-diagonal', 'Diagonal Line', 'lines', D, [120, 120], [n('M0 100 L100 0')])
add('line-dashed', 'Dashed Line', 'lines', MD, [160, 20], [n('M0 50 H100', { dash: 'dash' })])
add('line-dotted', 'Dotted Line', 'lines', D, [160, 20], [n('M0 50 H100', { dash: 'dot' })])
add('arrow-line', 'Arrow Line', 'lines', MD, [160, 30], [n('M0 50 H90'), so(P([[82, 15], [100, 50], [82, 85]]))], { aliases: ['connector-arrow'] })
add('arrow-line-double', 'Bidirectional Arrow Line', 'lines', MD, [160, 30], [n('M10 50 H90'), so(P([[18, 15], [0, 50], [18, 85]])), so(P([[82, 15], [100, 50], [82, 85]]))])
add('arrow-line-open', 'Open Arrow Line', 'lines', D, [160, 30], [n('M0 50 H98 M82 15 L100 50 L82 85')])
add('line-curve', 'Curve', 'lines', D, [140, 80], [n('M0 90 C30 -20 70 120 100 10')], { aliases: ['curved-line'] })
add('line-elbow', 'Elbow Connector', 'lines', D, [140, 80], [n('M0 10 H50 V90 H92'), so(P([[88, 78], [100, 90], [88, 100]]))], { aliases: ['orthogonal-connector'] })
add('line-crossbar', 'Crossbar', 'lines', D, [160, 30], [n('M0 50 H100 M0 15 V85 M100 15 V85')])
add('line-dot-ends', 'Line with Dot Ends', 'lines', D, [160, 30], [n('M8 50 H92'), so(E(5, 50, 5, 25)), so(E(95, 50, 5, 25))])
add('line-zigzag', 'Zigzag Line', 'lines', D, [160, 40], [n(PL([[0, 50], [12.5, 10], [25, 90], [37.5, 10], [50, 90], [62.5, 10], [75, 90], [87.5, 10], [100, 50]]))])
add('line-link', 'Link (Thick Arrow)', 'lines', D, [160, 40], [f(P([[0, 35], [80, 35], [80, 15], [100, 50], [80, 85], [80, 65], [0, 65]]))])

/* ---------- Flowchart ---------- */
add('fc-process', 'Process', 'flowchart', MD, [140, 70], [f(R(0, 0, 100, 100))], { aliases: ['flowchart-process'] })
add('fc-alternate-process', 'Alternate Process', 'flowchart', MD, [140, 70], [f(RR(0, 0, 100, 100, 18))])
add('fc-decision', 'Decision', 'flowchart', MD, [120, 90], [f(DIAMOND)], { text: [22, 22, 56, 56] })
add('fc-terminator', 'Terminator', 'flowchart', MD, [140, 60], [f(STADIUM)], { aliases: ['terminal', 'start-end'] })
add('fc-start-1', 'Start 1 (Ellipse)', 'flowchart', D, [120, 70], [f(CIRCLE)])
add('fc-start-2', 'Start 2 (Circle)', 'flowchart', D, [70, 70], [f(CIRCLE)])
add('fc-data', 'Data (Input / Output)', 'flowchart', MD, [140, 70], [f(P([[20, 0], [100, 0], [80, 100], [0, 100]]))], { aliases: ['io', 'input-output'], text: [18, 5, 64, 90] })
add('fc-predefined-process', 'Predefined Process', 'flowchart', MD, [140, 70], [f(R(0, 0, 100, 100)), n('M12 0 V100 M88 0 V100')], { aliases: ['subroutine'], text: [14, 5, 72, 90] })
add('fc-internal-storage', 'Internal Storage', 'flowchart', MD, [110, 90], [f(R(0, 0, 100, 100)), n('M15 0 V100 M0 18 H100')], { text: [18, 22, 78, 74] })
add('fc-document', 'Document', 'flowchart', MD, [140, 80], [f(DOCUMENT)], { text: [5, 5, 90, 70] })
add('fc-multi-document', 'Multi-Document', 'flowchart', MD, [140, 90], [
  f(cmdPath(DOC_CMDS, tfInto(14, 0, 86, 82))),
  f(cmdPath(DOC_CMDS, tfInto(7, 8, 86, 82))),
  f(cmdPath(DOC_CMDS, tfInto(0, 16, 86, 82)))
], { text: [3, 20, 80, 55] })
add('fc-manual-input', 'Manual Input', 'flowchart', MD, [140, 70], [f(P([[0, 28], [100, 0], [100, 100], [0, 100]]))], { text: [5, 30, 90, 65] })
add('fc-manual-operation', 'Manual Operation', 'flowchart', MD, [140, 70], [f(P([[0, 0], [100, 0], [80, 100], [20, 100]]))], { text: [18, 5, 64, 90] })
add('fc-preparation', 'Preparation', 'flowchart', MD, [140, 70], [f(P([[20, 0], [80, 0], [100, 50], [80, 100], [20, 100], [0, 50]]))], { text: [18, 5, 64, 90] })
add('fc-delay', 'Delay', 'flowchart', MD, [120, 70], [f('M0 0 H60 A40 50 0 0 1 60 100 H0 Z')], { text: [5, 5, 80, 90] })
add('fc-display', 'Display', 'flowchart', MD, [140, 70], [f('M0 50 L20 0 H80 A20 50 0 0 1 80 100 H20 Z')], { text: [18, 5, 70, 90] })
add('fc-stored-data', 'Stored Data', 'flowchart', MD, [140, 70], [f('M15 0 H100 A15 50 0 0 0 100 100 H15 A15 50 0 0 1 15 0 Z')], { aliases: ['data-storage'], text: [10, 5, 75, 90] })
add('fc-database', 'Database (Magnetic Disk)', 'flowchart', MD, [90, 100], [f(CYL_V), n(CYL_V_TOP)], { aliases: ['magnetic-disk'], text: [5, 28, 90, 62] })
add('fc-direct-access-storage', 'Direct Access Storage', 'flowchart', MD, [140, 70], [f(CYL_H), n(CYL_H_FRONT)], { aliases: ['direct-data', 'magnetic-drum'], text: [10, 5, 70, 90] })
add('fc-sequential-data', 'Sequential Data (Magnetic Tape)', 'flowchart', MD, [90, 90], [f('M50 100 A50 50 0 1 1 100 50 L100 100 Z')], { aliases: ['magnetic-tape'], text: [15, 15, 70, 70] })
add('fc-paper-tape', 'Paper Tape (Punched Tape)', 'flowchart', MD, [140, 80], [f(WAVE)], { aliases: ['punched-tape'], text: [5, 15, 90, 70] })
add('fc-card', 'Card (Punched Card)', 'flowchart', MD, [120, 80], [f(P([[20, 0], [100, 0], [100, 100], [0, 100], [0, 25]]))], { aliases: ['punched-card', 'card'] })
add('fc-loop-limit', 'Loop Limit', 'flowchart', MD, [140, 70], [f(P([[20, 0], [80, 0], [100, 25], [100, 100], [0, 100], [0, 25]]))])
add('fc-off-page-reference', 'Off-Page Reference', 'flowchart', MD, [80, 90], [f(P([[0, 0], [100, 0], [100, 65], [50, 100], [0, 65]]))], { aliases: ['off-page-connector'], text: [5, 5, 90, 60] })
add('fc-on-page-reference', 'On-Page Reference (Connector)', 'flowchart', MD, [60, 60], [f(CIRCLE)], { aliases: ['connector'] })
add('fc-or', 'Or', 'flowchart', MD, [70, 70], [f(CIRCLE), n('M50 0 V100 M0 50 H100')], { defaultLabel: '' })
add('fc-summing-junction', 'Summing Junction', 'flowchart', MD, [70, 70], [f(CIRCLE), n('M14.64 14.64 L85.36 85.36 M85.36 14.64 L14.64 85.36')], { defaultLabel: '' })
add('fc-collate', 'Collate', 'flowchart', MD, [80, 90], [f(HOURGLASS_TOP), f(HOURGLASS_BOTTOM)], { defaultLabel: '' })
add('fc-sort', 'Sort', 'flowchart', MD, [90, 100], [f(DIAMOND), n('M0 50 H100')], { defaultLabel: '' })
add('fc-merge', 'Merge (Storage)', 'flowchart', MD, [100, 80], [f(P([[0, 0], [100, 0], [50, 100]]))], { text: [20, 5, 60, 45] })
add('fc-extract', 'Extract (Measurement)', 'flowchart', MD, [100, 80], [f(P([[50, 0], [100, 100], [0, 100]]))], { text: [20, 50, 60, 45] })
add('fc-transfer', 'Transfer', 'flowchart', D, [140, 80], [f(P([[0, 25], [55, 25], [55, 0], [100, 50], [55, 100], [55, 75], [0, 75]]))], { text: [2, 27, 60, 46] })
add('fc-parallel-mode', 'Parallel Mode', 'flowchart', D, [160, 40], [n('M0 15 H100 M0 85 H100 M8 0 V30 M92 70 V100')], { defaultLabel: '' })
add('fc-annotation-1', 'Annotation 1', 'flowchart', D, [100, 80], [n('M30 0 H0 V100 H30')], { text: [8, 5, 90, 90] })
add('fc-annotation-2', 'Annotation 2', 'flowchart', D, [120, 80], [n('M50 0 H40 Q30 0 30 10 V40 Q30 50 20 50 Q30 50 30 60 V90 Q30 100 40 100 H50 M0 50 H20')], { text: [36, 5, 64, 90] })

/* ---------- Callouts ---------- */
add('callout-rect', 'Rectangle Callout', 'callouts', MD, [150, 100], [f(P([[0, 0], [100, 0], [100, 70], [45, 70], [25, 100], [30, 70], [0, 70]]))], { aliases: ['speech-bubble', 'callout'], text: [5, 5, 90, 60] })
add('callout-rounded-rect', 'Rounded Rectangle Callout', 'callouts', MD, [150, 100], [f('M10 0 H90 Q100 0 100 10 V60 Q100 70 90 70 H45 L25 100 L30 70 H10 Q0 70 0 60 V10 Q0 0 10 0 Z')], { aliases: ['wedge-round-rect-callout', 'comment'], text: [5, 5, 90, 60] })
add('callout-oval', 'Oval Callout', 'callouts', D, [150, 100], [f('M28.87 66.72 A50 35 0 1 1 41.32 69.47 L20 100 Z')], { aliases: ['speech-oval'], text: [15, 10, 70, 50] })
add('callout-cloud', 'Cloud Callout (Thought)', 'callouts', MD, [150, 110], [
  f(cmdPath([['M', 25, 90], ['C', 10, 90, 0, 80, 0, 66], ['C', 0, 52, 10, 44, 22, 44], ['C', 20, 28, 32, 16, 48, 16], ['C', 60, 16, 70, 24, 74, 34], ['C', 88, 32, 100, 44, 100, 60], ['C', 100, 77, 88, 90, 72, 90], ['Z']], tfInto(0, 0, 100, 78))),
  f(E(22, 85, 7, 5)),
  f(E(10, 95, 4, 3))
], { aliases: ['thought-bubble'], text: [18, 22, 66, 45] })
add('callout-line', 'Line Callout', 'callouts', D, [160, 100], [f(R(0, 0, 70, 60)), n('M70 30 L100 95')], { text: [3, 3, 64, 54] })
add('callout-corner', 'Corner Callout', 'callouts', D, [150, 100], [f(P([[0, 0], [100, 0], [100, 70], [20, 70], [0, 100]]))], { text: [5, 5, 90, 60] })
add('callout-left', 'Left Pointer Callout', 'callouts', D, [160, 80], [f(P([[15, 0], [100, 0], [100, 100], [15, 100], [15, 65], [0, 50], [15, 35]]))], { text: [20, 5, 76, 90] })
add('callout-double', 'Double Line Callout', 'callouts', D, [160, 100], [f(R(0, 0, 70, 60)), n('M70 20 L85 20 L100 95 M70 40 L85 40')], { text: [3, 3, 64, 54] })
add('callout-explosion', 'Explosion Callout', 'callouts', D, [150, 120], [f(explosion())], { text: [25, 25, 50, 50] })

/* ---------- Brackets & Annotations ---------- */
add('brace-left', 'Left Brace', 'brackets', MD, [40, 120], [n(BRACE_L)], { defaultLabel: '', aliases: ['curly-brace-left'] })
add('brace-right', 'Right Brace', 'brackets', MD, [40, 120], [n(BRACE_R)], { defaultLabel: '', aliases: ['curly-brace-right'] })
add('brace-pair', 'Double Brace', 'brackets', D, [140, 90], [n('M15 0 Q5 0 5 10 V40 Q5 50 0 50 Q5 50 5 60 V90 Q5 100 15 100 M85 0 Q95 0 95 10 V40 Q95 50 100 50 Q95 50 95 60 V90 Q95 100 85 100')], { text: [10, 5, 80, 90] })
add('brace-top', 'Top Brace', 'brackets', D, [140, 40], [n('M0 60 Q0 40 10 40 H40 Q50 40 50 20 Q50 40 60 40 H90 Q100 40 100 60')], { defaultLabel: '' })
add('bracket-left', 'Left Bracket', 'brackets', MD, [30, 120], [n('M80 0 H30 V100 H80')], { defaultLabel: '' })
add('bracket-right', 'Right Bracket', 'brackets', MD, [30, 120], [n('M20 0 H70 V100 H20')], { defaultLabel: '' })
add('bracket-pair', 'Double Bracket', 'brackets', D, [140, 90], [n('M10 0 H0 V100 H10 M90 0 H100 V100 H90')], { text: [5, 5, 90, 90] })
add('parenthesis-left', 'Left Parenthesis', 'brackets', D, [30, 120], [n('M80 0 Q0 50 80 100')], { defaultLabel: '' })
add('parenthesis-right', 'Right Parenthesis', 'brackets', D, [30, 120], [n('M20 0 Q100 50 20 100')], { defaultLabel: '' })
add('parenthesis-pair', 'Double Parenthesis', 'brackets', D, [140, 90], [n('M10 0 Q-5 50 10 100 M90 0 Q105 50 90 100')], { text: [5, 5, 90, 90] })
add('annotation-bracket', 'Annotation (Open Bracket)', 'brackets', D, [120, 80], [n('M20 0 H0 V100 H20')], { aliases: ['comment-bracket'], text: [6, 5, 94, 90] })

/* ---------- Containers & Tables ---------- */
add('container', 'Container', 'containers', MD, [240, 160], [f(R(0, 0, 100, 100))], { text: [2, 2, 96, 15] })
add('swimlane-vertical', 'Swimlane (Vertical)', 'containers', D, [200, 260], [f(R(0, 0, 100, 100)), lt(R(0, 0, 100, 12)), n('M0 12 H100')], { aliases: ['swimlane'], text: [2, 0, 96, 12] })
add('swimlane-horizontal', 'Swimlane (Horizontal)', 'containers', D, [300, 140], [f(R(0, 0, 100, 100)), lt(R(0, 0, 10, 100)), n('M10 0 V100')], { text: [0, 2, 10, 96] })
add('pool-lanes', 'Pool with Lanes', 'containers', D, [320, 200], [f(R(0, 0, 100, 100)), lt(R(0, 0, 8, 100)), n('M8 0 V100 M8 50 H100 M8 0 H100')], { text: [0, 2, 8, 96] })
add('folder', 'Folder', 'containers', D, [140, 100], [f(P([[0, 15], [0, 100], [100, 100], [100, 15], [45, 15], [38, 0], [0, 0]]))], { text: [5, 20, 90, 75] })
add('tab-container', 'Tab', 'containers', D, [160, 100], [f(P([[0, 0], [40, 0], [40, 15], [100, 15], [100, 100], [0, 100]])), n('M0 15 H40')], { text: [2, 0, 38, 15] })
add('list', 'List', 'containers', D, [160, 140], [f(R(0, 0, 100, 100)), lt(R(0, 0, 100, 20)), n('M0 20 H100 M0 46.67 H100 M0 73.33 H100')], { text: [3, 0, 94, 20] })
add('table-2x2', 'Table 2x2', 'containers', MD, [180, 100], [f(R(0, 0, 100, 100)), n(gridLines(2, 2))], { defaultLabel: '' })
add('table-3x3', 'Table 3x3', 'containers', MD, [210, 120], [f(R(0, 0, 100, 100)), lt(R(0, 0, 100, 33.33)), n(gridLines(3, 3))], { defaultLabel: '' })
add('table-4x4', 'Table 4x4', 'containers', D, [240, 140], [f(R(0, 0, 100, 100)), lt(R(0, 0, 100, 25)), n(gridLines(4, 4))], { defaultLabel: '' })
add('grid-frame', 'Kanban / Column Frame', 'containers', M, [300, 180], [f(R(0, 0, 100, 100)), n('M33.33 0 V100 M66.67 0 V100 M0 14 H100')], { defaultLabel: 'To Do        Doing        Done', text: [2, 0, 96, 14] })
add('image-placeholder', 'Image', 'containers', MD, [140, 100], [f(R(0, 0, 100, 100)), n(PL([[5, 90], [35, 45], [55, 70], [70, 55], [95, 90]])), so(E(75, 25, 8, 10))], { defaultLabel: '' })

/* ---------- 3D Shapes ---------- */
add('cube', 'Cube', 'threeD', MD, [110, 110], [f(R(0, 20, 80, 80)), lt(P([[0, 20], [20, 0], [100, 0], [80, 20]])), sh(P([[80, 20], [100, 0], [100, 80], [80, 100]]))], { aliases: ['box-3d'], text: [3, 25, 74, 70] })
add('isometric-cube', 'Isometric Cube', 'threeD', D, [100, 110], [lt(P([[50, 0], [100, 25], [50, 50], [0, 25]])), f(P([[0, 25], [50, 50], [50, 100], [0, 75]])), sh(P([[50, 50], [100, 25], [100, 75], [50, 100]]))], { aliases: ['isocube'], defaultLabel: '' })
add('cylinder-3d', 'Cylinder', 'threeD', MD, [90, 110], [f(CYL_V), lt('M0 12 A50 12 0 0 1 100 12 A50 12 0 0 1 0 12 Z')], { text: [5, 28, 90, 62] })
add('cylinder-horizontal', 'Horizontal Cylinder', 'threeD', D, [140, 70], [f(CYL_H), lt('M88 0 A12 50 0 0 1 88 100 A12 50 0 0 1 88 0 Z')], { text: [10, 5, 70, 90] })
add('cone', 'Cone', 'threeD', D, [100, 110], [f('M50 0 L100 85 A50 15 0 0 1 0 85 Z')], { text: [20, 50, 60, 35] })
add('pyramid', 'Pyramid', 'threeD', D, [110, 100], [f(P([[50, 0], [100, 80], [60, 100], [0, 80]])), sh(P([[50, 0], [100, 80], [60, 100]]))], { defaultLabel: '' })
add('sphere', 'Sphere', 'threeD', D, [100, 100], [f(CIRCLE), n('M0 50 A50 16 0 0 0 100 50', { dash: 'dash' }), lt(E(35, 30, 14, 9), { stroke: 'none' })], { defaultLabel: '' })
add('parallelepiped', 'Parallelepiped', 'threeD', D, [140, 90], [f(P([[0, 25], [75, 25], [75, 100], [0, 100]])), lt(P([[0, 25], [25, 0], [100, 0], [75, 25]])), sh(P([[75, 25], [100, 0], [100, 75], [75, 100]]))], { text: [3, 30, 69, 65] })
add('cuboid-flat', 'Flat Box / Slab', 'threeD', D, [160, 70], [f(P([[0, 35], [85, 35], [85, 100], [0, 100]])), lt(P([[0, 35], [15, 0], [100, 0], [85, 35]])), sh(P([[85, 35], [100, 0], [100, 65], [85, 100]]))], { text: [3, 38, 79, 58] })

/* ---------- Symbols & Icons ---------- */
add('heart', 'Heart', 'symbols', D, [100, 90], [f('M50 95 C20 70 0 50 0 28 C0 10 14 0 28 0 C40 0 48 8 50 18 C52 8 60 0 72 0 C86 0 100 10 100 28 C100 50 80 70 50 95 Z')], { text: [18, 15, 64, 45] })
add('lightning', 'Lightning Bolt', 'symbols', D, [80, 110], [f(P(LIGHTNING))], { aliases: ['flash', 'bolt'], defaultLabel: '' })
add('drop', 'Drop', 'symbols', D, [80, 110], [f('M50 0 C50 0 90 45 90 65 A40 35 0 0 1 10 65 C10 45 50 0 50 0 Z')], { aliases: ['teardrop'], text: [20, 50, 60, 35] })
add('moon', 'Moon / Crescent', 'symbols', D, [80, 100], [f('M70 5 A50 50 0 1 0 70 95 A55 55 0 0 1 70 5 Z')], { aliases: ['crescent'], defaultLabel: '' })
add('sun', 'Sun', 'symbols', D, [100, 100], [so(sunRays()), f(E(50, 50, 28, 28))], { text: [30, 30, 40, 40] })
add('smiley', 'Smiley', 'symbols', D, [90, 90], [f(CIRCLE), so(E(35, 38, 6, 8)), so(E(65, 38, 6, 8)), n('M28 62 Q50 85 72 62')], { defaultLabel: '' })
add('no-symbol', 'No Symbol', 'symbols', D, [90, 90], [f(E(50, 50, 50, 50) + ' ' + E(50, 50, 36, 36), { rule: 'evenodd' }), f(P([[22, 30], [30, 22], [78, 70], [70, 78]]))], { aliases: ['prohibited'], defaultLabel: '' })
add('checkmark', 'Checkmark / Tick', 'symbols', D, [100, 80], [f(P([[0, 55], [15, 40], [38, 62], [85, 10], [100, 25], [38, 90]]))], { aliases: ['tick', 'check'], defaultLabel: '' })
add('minus', 'Minus', 'symbols', D, [100, 30], [f(R(0, 25, 100, 50))], { defaultLabel: '' })
add('gear', 'Gear', 'symbols', D, [100, 100], [f(gear(8) + ' ' + E(50, 50, 16, 16), { rule: 'evenodd' })], { aliases: ['cog', 'settings'], defaultLabel: '' })
add('location-pin', 'Location Pin', 'symbols', D, [80, 110], [f('M50 100 C50 100 8 58 8 38 A42 38 0 1 1 92 38 C92 58 50 100 50 100 Z'), lt(E(50, 38, 16, 14))], { aliases: ['map-marker'], defaultLabel: '' })
add('flag', 'Flag', 'symbols', D, [90, 110], [f(P([[12, 0], [95, 0], [78, 23], [95, 46], [16, 46], [16, 100], [12, 100]]))], { text: [18, 3, 60, 40] })
add('bookmark', 'Bookmark', 'symbols', D, [70, 100], [f(P([[0, 0], [100, 0], [100, 100], [50, 75], [0, 100]]))], { text: [8, 8, 84, 55] })
add('tag', 'Tag / Label', 'symbols', D, [140, 70], [f(P([[25, 0], [100, 0], [100, 100], [25, 100], [0, 50]])), lt(E(22, 50, 5, 10))], { text: [32, 10, 64, 80] })
add('envelope', 'Envelope / Message', 'symbols', D, [130, 90], [f(R(0, 0, 100, 100)), n(ENVELOPE_FLAP)], { aliases: ['mail', 'message'], defaultLabel: '' })
add('clock', 'Clock', 'symbols', D, [90, 90], [f(CIRCLE), n('M50 15 V50 L72 62')], { aliases: ['time'], defaultLabel: '' })
add('hourglass', 'Hourglass', 'symbols', D, [80, 100], [f(HOURGLASS_TOP), f(HOURGLASS_BOTTOM), n('M0 0 H100 M0 100 H100')], { defaultLabel: '' })
add('lock', 'Lock', 'symbols', D, [80, 100], [n('M25 45 V28 A25 25 0 0 1 75 28 V45'), f(RR(5, 45, 90, 55, 8)), so(E(50, 68, 7, 6))], { defaultLabel: '' })
add('key', 'Key', 'symbols', D, [130, 60], [f(E(22, 50, 22, 40) + ' ' + E(18, 50, 8, 14), { rule: 'evenodd' }), f(P([[42, 40], [100, 40], [100, 60], [90, 60], [90, 80], [80, 80], [80, 60], [70, 60], [70, 75], [60, 75], [60, 60], [42, 60]]))], { defaultLabel: '' })
add('lightbulb', 'Light Bulb', 'symbols', D, [80, 110], [f('M30 72 C30 60 5 50 5 30 A45 30 0 0 1 95 30 C95 50 70 60 70 72 Z'), f(R(30, 76, 40, 9)), f(R(34, 88, 32, 9))], { aliases: ['idea'], defaultLabel: '' })
add('trophy', 'Trophy', 'symbols', D, [90, 100], [n('M20 10 H5 Q5 40 30 42 M80 10 H95 Q95 40 70 42'), f('M20 0 H80 V25 Q80 55 50 60 Q20 55 20 25 Z'), f(R(44, 60, 12, 20)), f(R(25, 80, 50, 20))], { defaultLabel: '' })
add('battery', 'Battery', 'symbols', D, [130, 60], [f(RR(0, 10, 90, 80, 8)), so(R(90, 32, 10, 36)), so(R(6, 20, 50, 60))], { defaultLabel: '' })
add('puzzle-piece', 'Puzzle Piece', 'symbols', D, [100, 100], [f('M0 20 H35 Q30 0 50 0 Q70 0 65 20 H100 V45 Q80 40 80 60 Q80 80 100 75 V100 H0 Z')], { text: [10, 30, 60, 60] })
add('crown', 'Crown', 'symbols', D, [110, 80], [f(P([[0, 20], [25, 55], [50, 0], [75, 55], [100, 20], [90, 100], [10, 100]]))], { defaultLabel: '' })
add('thumbs-up', 'Thumbs Up', 'symbols', D, [90, 90], [f('M0 45 H20 V100 H0 Z'), f('M25 45 L45 0 Q60 0 58 20 L55 38 H92 Q100 40 98 50 L88 92 Q85 100 75 100 H25 Z')], { aliases: ['like'], defaultLabel: '' })
add('magnifier', 'Magnifier / Search', 'symbols', D, [90, 90], [f(E(40, 40, 36, 36) + ' ' + E(40, 40, 26, 26), { rule: 'evenodd' }), f(P([[62, 70], [70, 62], [100, 92], [92, 100]]))], { aliases: ['search'], defaultLabel: '' })
add('question-circle', 'Help / Question', 'symbols', D, [80, 80], [f(CIRCLE)], { defaultLabel: '?' })
add('info-circle', 'Info', 'symbols', D, [80, 80], [f(CIRCLE)], { defaultLabel: 'i' })
add('warning-triangle', 'Warning', 'symbols', D, [100, 90], [f(P([[50, 0], [100, 100], [0, 100]]))], { defaultLabel: '!', text: [30, 40, 40, 55] })

/* ---------- UML ---------- */
add('uml-class', 'Class', 'uml', MD, [180, 140], [f(R(0, 0, 100, 100)), n('M0 22 H100 M0 62 H100')], { defaultLabel: 'ClassName', text: [2, 0, 96, 22] })
add('uml-interface', 'Interface', 'uml', MD, [180, 120], [f(R(0, 0, 100, 100)), n('M0 30 H100')], { defaultLabel: '«interface»\nName', text: [2, 0, 96, 30] })
add('uml-abstract-class', 'Abstract Class', 'uml', D, [180, 140], [f(R(0, 0, 100, 100), { dash: 'dash' }), n('M0 22 H100 M0 62 H100')], { defaultLabel: '«abstract»\nName', text: [2, 0, 96, 22] })
add('uml-enumeration', 'Enumeration', 'uml', D, [160, 120], [f(R(0, 0, 100, 100)), n('M0 30 H100')], { defaultLabel: '«enumeration»\nName', text: [2, 0, 96, 30] })
add('uml-object', 'Object / Instance', 'uml', D, [160, 70], [f(R(0, 0, 100, 100))], { defaultLabel: 'obj : Class' })
add('uml-package', 'Package', 'uml', MD, [180, 130], [f(P([[0, 0], [40, 0], [40, 15], [100, 15], [100, 100], [0, 100]])), n('M0 15 H40')], { text: [5, 20, 90, 75] })
add('uml-component', 'Component', 'uml', MD, [160, 90], [f(R(10, 0, 90, 100)), f(R(0, 20, 20, 15)), f(R(0, 62, 20, 15))], { text: [24, 5, 72, 90] })
add('uml-component-2', 'Component (UML 2)', 'uml', D, [160, 90], [f(R(0, 0, 100, 100)), n(R(80, 10, 14, 22) + ' ' + R(76, 14, 8, 5) + ' ' + R(76, 23, 8, 5))], { text: [5, 5, 72, 90] })
add('uml-node', 'Node (3D Box)', 'uml', MD, [160, 110], [f(R(0, 15, 85, 85)), lt(P([[0, 15], [15, 0], [100, 0], [85, 15]])), sh(P([[85, 15], [100, 0], [100, 85], [85, 100]]))], { text: [3, 20, 79, 76] })
add('uml-artifact', 'Artifact', 'uml', D, [120, 140], [f(NOTE), n(NOTE_FOLD)], { defaultLabel: '«artifact»\nfile.jar' })
add('uml-actor', 'Actor', 'uml', MD, [50, 100], [f(E(50, 12, 24, 12)), n('M50 24 V65 M10 38 H90 M50 65 L15 100 M50 65 L85 100')], { aliases: ['stick-figure'], defaultLabel: '' })
add('uml-use-case', 'Use Case', 'uml', MD, [160, 80], [f(CIRCLE)], { aliases: ['usecase'] })
add('uml-note', 'Note', 'uml', MD, [140, 90], [f(NOTE), n(NOTE_FOLD)], { aliases: ['note', 'comment'], text: [5, 5, 75, 90] })
add('uml-lifeline', 'Lifeline', 'uml', D, [120, 240], [f(R(0, 0, 100, 16)), n('M50 16 V100', { dash: 'dash' })], { text: [2, 0, 96, 16] })
add('uml-activation', 'Activation Bar', 'uml', D, [16, 100], [f(R(0, 0, 100, 100))], { defaultLabel: '' })
add('uml-destruction', 'Destruction (X)', 'uml', D, [40, 40], [n('M0 0 L100 100 M100 0 L0 100', { sw: 1.6 })], { defaultLabel: '' })
add('uml-initial-state', 'Initial State', 'uml', MD, [36, 36], [so(CIRCLE)], { defaultLabel: '' })
add('uml-final-state', 'Final State', 'uml', MD, [40, 40], [f(CIRCLE), so(E(50, 50, 30, 30))], { defaultLabel: '' })
add('uml-state', 'State', 'uml', MD, [150, 70], [f(RR(0, 0, 100, 100, 30))])
add('uml-composite-state', 'Composite State', 'uml', D, [220, 150], [f(RR(0, 0, 100, 100, 10)), n('M0 18 H100')], { text: [2, 0, 96, 18] })
add('uml-decision', 'Decision / Merge', 'uml', MD, [50, 50], [f(DIAMOND)], { defaultLabel: '', aliases: ['merge'] })
add('uml-fork-join-h', 'Fork / Join (Horizontal)', 'uml', MD, [160, 10], [so(R(0, 0, 100, 100))], { defaultLabel: '', aliases: ['fork', 'join', 'sync-bar'] })
add('uml-fork-join-v', 'Fork / Join (Vertical)', 'uml', D, [10, 160], [so(R(0, 0, 100, 100))], { defaultLabel: '' })
add('uml-action', 'Action', 'uml', MD, [150, 70], [f(RR(0, 0, 100, 100, 20))])
add('uml-send-signal', 'Send Signal', 'uml', D, [150, 70], [f(P([[0, 0], [80, 0], [100, 50], [80, 100], [0, 100]]))], { text: [5, 5, 72, 90] })
add('uml-accept-event', 'Accept Event', 'uml', D, [150, 70], [f(P([[0, 0], [100, 0], [100, 100], [0, 100], [20, 50]]))], { aliases: ['receive-signal'], text: [22, 5, 74, 90] })
add('uml-time-event', 'Time Event', 'uml', D, [50, 60], [f(HOURGLASS_TOP), f(HOURGLASS_BOTTOM)], { defaultLabel: '' })
add('uml-flow-final', 'Flow Final', 'uml', D, [40, 40], [f(CIRCLE), n('M14.64 14.64 L85.36 85.36 M85.36 14.64 L14.64 85.36')], { defaultLabel: '' })
add('uml-shallow-history', 'Shallow History', 'uml', D, [40, 40], [f(CIRCLE)], { defaultLabel: 'H' })
add('uml-deep-history', 'Deep History', 'uml', D, [40, 40], [f(CIRCLE)], { defaultLabel: 'H*' })
add('uml-entry-point', 'Entry Point', 'uml', D, [30, 30], [f(CIRCLE)], { defaultLabel: '' })
add('uml-exit-point', 'Exit Point', 'uml', D, [30, 30], [f(CIRCLE), n('M14.64 14.64 L85.36 85.36 M85.36 14.64 L14.64 85.36')], { defaultLabel: '' })
add('uml-terminate', 'Terminate', 'uml', D, [40, 40], [n('M0 0 L100 100 M100 0 L0 100')], { defaultLabel: '' })
add('uml-frame', 'Frame (Fragment)', 'uml', D, [260, 160], [f(R(0, 0, 100, 100)), n(PL([[0, 18], [28, 18], [34, 10], [34, 0]]))], { defaultLabel: 'alt', text: [1, 0, 30, 18] })
add('uml-boundary', 'Boundary', 'uml', D, [100, 80], [n('M0 15 V85 M0 50 H24'), f(E(62, 50, 38, 47.5))], { defaultLabel: '' })
add('uml-control', 'Control', 'uml', D, [80, 88], [f(E(50, 55, 50, 45)), n('M40 0 L56 10 L40 20')], { defaultLabel: '' })
add('uml-entity', 'Entity', 'uml', D, [80, 88], [f(E(50, 45, 50, 45)), n('M0 98 H100')], { defaultLabel: '' })
add('uml-provided-interface', 'Provided Interface (Lollipop)', 'uml', D, [80, 40], [n('M0 50 H60'), f(E(80, 50, 20, 40))], { aliases: ['lollipop'], defaultLabel: '' })
add('uml-required-interface', 'Required Interface (Socket)', 'uml', D, [80, 40], [n('M0 50 H58 M80 10 A20 40 0 0 0 80 90')], { aliases: ['socket'], defaultLabel: '' })
add('uml-port', 'Port', 'uml', D, [20, 20], [f(R(0, 0, 100, 100))], { defaultLabel: '' })
add('uml-database', 'Database (UML)', 'uml', D, [90, 100], [f(CYL_V), n(CYL_V_TOP)], { text: [5, 28, 90, 62] })

/* ---------- BPMN ---------- */
const BPMN_X = 'M35 35 L65 65 M65 35 L35 65'
const BPMN_PLUS = 'M50 28 V72 M28 50 H72'
add('bpmn-task', 'Task', 'bpmn', MD, [150, 80], [f(RR(0, 0, 100, 100, 12))], { aliases: ['activity'] })
add('bpmn-subprocess', 'Sub-Process', 'bpmn', MD, [150, 90], [f(RR(0, 0, 100, 100, 12)), n(R(43, 76, 14, 18) + ' M50 79 V91 M45 85 H55')], { text: [5, 5, 90, 68] })
add('bpmn-call-activity', 'Call Activity', 'bpmn', D, [150, 80], [f(RR(0, 0, 100, 100, 12), { sw: 2.6 })])
add('bpmn-transaction', 'Transaction', 'bpmn', D, [150, 90], [f(RR(0, 0, 100, 100, 12)), n(RR(4, 6, 92, 88, 9))], { text: [8, 10, 84, 80] })
add('bpmn-event-start', 'Start Event', 'bpmn', MD, [50, 50], [f(CIRCLE)], { defaultLabel: '' })
add('bpmn-event-intermediate', 'Intermediate Event', 'bpmn', MD, [50, 50], [f(CIRCLE), n(E(50, 50, 40, 40))], { defaultLabel: '' })
add('bpmn-event-end', 'End Event', 'bpmn', MD, [50, 50], [f(CIRCLE, { sw: 2.8 })], { defaultLabel: '' })
add('bpmn-event-message', 'Message Event', 'bpmn', D, [50, 50], [f(CIRCLE), n(R(25, 32, 50, 36) + ' ' + PL([[25, 32], [50, 52], [75, 32]]))], { defaultLabel: '' })
add('bpmn-event-timer', 'Timer Event', 'bpmn', D, [50, 50], [f(CIRCLE), n(E(50, 50, 40, 40)), n(E(50, 50, 28, 28) + ' M50 30 V50 L64 58')], { defaultLabel: '' })
add('bpmn-event-error', 'Error Event', 'bpmn', D, [50, 50], [f(CIRCLE, { sw: 2.8 }), n(P([[28, 72], [40, 30], [55, 55], [72, 28], [60, 70], [45, 45]]))], { defaultLabel: '' })
add('bpmn-event-signal', 'Signal Event', 'bpmn', D, [50, 50], [f(CIRCLE), n(P([[50, 24], [74, 68], [26, 68]]))], { defaultLabel: '' })
add('bpmn-event-escalation', 'Escalation Event', 'bpmn', D, [50, 50], [f(CIRCLE), n(P([[50, 22], [70, 74], [50, 58], [30, 74]]))], { defaultLabel: '' })
add('bpmn-event-conditional', 'Conditional Event', 'bpmn', D, [50, 50], [f(CIRCLE), n(R(30, 25, 40, 50) + ' M36 36 H64 M36 46 H64 M36 56 H64 M36 66 H64')], { defaultLabel: '' })
add('bpmn-event-terminate', 'Terminate Event', 'bpmn', D, [50, 50], [f(CIRCLE, { sw: 2.8 }), so(E(50, 50, 26, 26))], { defaultLabel: '' })
add('bpmn-gateway-exclusive', 'Exclusive Gateway (XOR)', 'bpmn', MD, [60, 60], [f(DIAMOND), n(BPMN_X, { sw: 1.8 })], { aliases: ['xor', 'gateway'], defaultLabel: '' })
add('bpmn-gateway-parallel', 'Parallel Gateway (AND)', 'bpmn', MD, [60, 60], [f(DIAMOND), n(BPMN_PLUS, { sw: 1.8 })], { aliases: ['and-gateway'], defaultLabel: '' })
add('bpmn-gateway-inclusive', 'Inclusive Gateway (OR)', 'bpmn', MD, [60, 60], [f(DIAMOND), n(E(50, 50, 20, 20), { sw: 1.8 })], { aliases: ['or-gateway'], defaultLabel: '' })
add('bpmn-gateway-event', 'Event-Based Gateway', 'bpmn', D, [60, 60], [f(DIAMOND), n(E(50, 50, 22, 22) + ' ' + E(50, 50, 17, 17)), n(regular(5).replace(/[\d.]+ [\d.]+/g, (m) => { const [x, y] = m.split(' ').map(Number); return `${r2(38 + x * 0.24)} ${r2(38 + y * 0.24)}` }))], { defaultLabel: '' })
add('bpmn-gateway-complex', 'Complex Gateway', 'bpmn', D, [60, 60], [f(DIAMOND), n('M50 28 V72 M28 50 H72 M34 34 L66 66 M66 34 L34 66', { sw: 1.6 })], { defaultLabel: '' })
add('bpmn-data-object', 'Data Object', 'bpmn', MD, [60, 80], [f(NOTE), n(NOTE_FOLD)], { defaultLabel: '' })
add('bpmn-data-input', 'Data Input', 'bpmn', D, [60, 80], [f(NOTE), n(NOTE_FOLD), n(P([[10, 15], [25, 15], [25, 8], [40, 22], [25, 36], [25, 29], [10, 29]]))], { defaultLabel: '' })
add('bpmn-data-output', 'Data Output', 'bpmn', D, [60, 80], [f(NOTE), n(NOTE_FOLD), so(P([[10, 15], [25, 15], [25, 8], [40, 22], [25, 36], [25, 29], [10, 29]]))], { defaultLabel: '' })
add('bpmn-data-store', 'Data Store', 'bpmn', MD, [80, 80], [f(CYL_V), n(CYL_V_TOP + ' M0 20 A50 12 0 0 0 100 20 M0 28 A50 12 0 0 0 100 28')], { defaultLabel: '' })
add('bpmn-pool', 'Pool', 'bpmn', MD, [360, 140], [f(R(0, 0, 100, 100)), n('M7 0 V100')], { text: [0, 2, 7, 96] })
add('bpmn-pool-lanes', 'Pool with 2 Lanes', 'bpmn', D, [360, 200], [f(R(0, 0, 100, 100)), n('M7 0 V100 M14 0 V100 M7 50 H100')], { text: [0, 2, 7, 96] })
add('bpmn-group', 'Group', 'bpmn', D, [200, 140], [n(RR(0, 0, 100, 100, 8), { dash: 'dashdot' })], { text: [2, 2, 96, 18] })
add('bpmn-text-annotation', 'Text Annotation', 'bpmn', MD, [140, 70], [n('M20 0 H0 V100 H20')], { text: [6, 5, 94, 90] })
add('bpmn-message', 'Message', 'bpmn', D, [60, 40], [f(R(0, 0, 100, 100)), n(ENVELOPE_FLAP)], { defaultLabel: '' })
add('bpmn-conversation', 'Conversation', 'bpmn', D, [60, 52], [f(P([[25, 0], [75, 0], [100, 50], [75, 100], [25, 100], [0, 50]]))], { defaultLabel: '' })
add('bpmn-choreography-task', 'Choreography Task', 'bpmn', D, [150, 100], [f(RR(0, 0, 100, 100, 10)), lt(R(0, 0, 100, 20)), lt(R(0, 80, 100, 20)), n('M0 20 H100 M0 80 H100')], { text: [5, 22, 90, 56] })

/* ---------- Entity Relation ---------- */
add('er-entity', 'Entity', 'er', MD, [140, 70], [f(R(0, 0, 100, 100))])
add('er-weak-entity', 'Weak Entity', 'er', MD, [140, 70], [f(R(0, 0, 100, 100)), n(R(5, 9, 90, 82))], { text: [8, 12, 84, 76] })
add('er-attribute', 'Attribute', 'er', MD, [120, 60], [f(CIRCLE)])
add('er-key-attribute', 'Key Attribute', 'er', MD, [120, 60], [f(CIRCLE), n('M30 72 H70')])
add('er-partial-key-attribute', 'Partial Key Attribute', 'er', D, [120, 60], [f(CIRCLE), n('M30 72 H70', { dash: 'dash' })])
add('er-multivalued-attribute', 'Multivalued Attribute', 'er', MD, [120, 60], [f(CIRCLE), n(E(50, 50, 44, 38))])
add('er-derived-attribute', 'Derived Attribute', 'er', MD, [120, 60], [f(CIRCLE, { dash: 'dash' })])
add('er-relationship', 'Relationship', 'er', MD, [130, 80], [f(DIAMOND)], { text: [22, 22, 56, 56] })
add('er-identifying-relationship', 'Identifying Relationship', 'er', MD, [130, 80], [f(DIAMOND), n(P([[50, 10], [90, 50], [50, 90], [10, 50]]))], { text: [25, 25, 50, 50] })
add('er-associative-entity', 'Associative Entity', 'er', D, [140, 80], [f(R(0, 0, 100, 100)), n(P([[50, 5], [95, 50], [50, 95], [5, 50]]))], { text: [25, 25, 50, 50] })
add('er-table', 'Table (Entity with Fields)', 'er', MD, [180, 140], [f(R(0, 0, 100, 100)), lt(R(0, 0, 100, 20)), n('M0 20 H100 M0 46.67 H100 M0 73.33 H100 M18 20 V100')], { defaultLabel: 'TableName', text: [2, 0, 96, 20] })
add('er-subtype', 'Subtype / Inheritance Circle', 'er', D, [40, 40], [f(CIRCLE)], { defaultLabel: 'd' })

/* ---------- Network & Infrastructure ---------- */
add('net-server', 'Server', 'network', MD, [70, 100], [f(RR(15, 0, 70, 100, 5)), n('M15 25 H85 M15 50 H85 M15 75 H85'), so(E(75, 12, 3, 2.5)), so(E(75, 37, 3, 2.5)), so(E(75, 62, 3, 2.5))], { defaultLabel: '' })
add('net-server-rack', 'Server Rack', 'network', D, [90, 120], [f(R(0, 0, 100, 100)), n('M0 16 H100 M0 32 H100 M0 48 H100 M0 64 H100 M0 80 H100'), so(E(88, 8, 3, 2.5)), so(E(88, 24, 3, 2.5)), so(E(88, 40, 3, 2.5)), so(E(88, 56, 3, 2.5)), so(E(88, 72, 3, 2.5))], { defaultLabel: '' })
add('net-desktop', 'Desktop / Monitor', 'network', MD, [110, 100], [f(RR(0, 0, 100, 72, 4)), n(R(5, 5, 90, 60)), f(P([[42, 72], [58, 72], [62, 90], [38, 90]])), f(RR(25, 90, 50, 10, 3))], { aliases: ['computer', 'pc'], defaultLabel: '' })
add('net-laptop', 'Laptop', 'network', MD, [120, 80], [f(RR(10, 0, 80, 72, 4)), n(R(15, 6, 70, 60)), f(P([[0, 78], [100, 78], [94, 100], [6, 100]]))], { defaultLabel: '' })
add('net-mobile', 'Mobile Phone', 'network', MD, [50, 90], [f(RR(0, 0, 100, 100, 18)), n(R(10, 12, 80, 72)), n(E(50, 92, 6, 3.5))], { aliases: ['phone', 'smartphone'], defaultLabel: '' })
add('net-tablet', 'Tablet', 'network', D, [90, 110], [f(RR(0, 0, 100, 100, 8)), n(R(8, 8, 84, 80)), n(E(50, 94, 4, 3))], { defaultLabel: '' })
add('net-router', 'Router', 'network', MD, [110, 70], [f('M0 30 A50 20 0 0 1 100 30 V70 A50 20 0 0 1 0 70 Z'), n('M0 30 A50 20 0 0 0 100 30'), n('M30 22 L45 30 M70 22 L55 30 M40 42 L30 46 M60 42 L70 46', { sw: 1.4 })], { defaultLabel: '' })
add('net-switch', 'Switch', 'network', MD, [120, 60], [lt(P([[15, 0], [100, 0], [85, 40], [0, 40]])), f(R(0, 40, 85, 60)), sh(P([[85, 40], [100, 0], [100, 60], [85, 100]])), n('M30 12 H60 M55 7 L62 12 L55 17 M70 28 H40 M45 23 L38 28 L45 33')], { aliases: ['hub'], defaultLabel: '' })
add('net-firewall', 'Firewall', 'network', MD, [110, 90], [f(R(0, 0, 100, 100)), n('M0 25 H100 M0 50 H100 M0 75 H100 M35 0 V25 M70 0 V25 M18 25 V50 M52 25 V50 M86 25 V50 M35 50 V75 M70 50 V75 M18 75 V100 M52 75 V100 M86 75 V100')], { defaultLabel: '' })
add('net-load-balancer', 'Load Balancer', 'network', D, [90, 90], [f(CIRCLE), n('M20 50 H45 M45 50 L75 28 M45 50 H78 M45 50 L75 72'), so(P([[70, 22], [80, 26], [74, 34]])), so(P([[74, 45], [82, 50], [74, 55]])), so(P([[74, 66], [80, 74], [70, 78]]))], { defaultLabel: '' })
add('net-globe', 'Internet / Globe', 'network', MD, [90, 90], [f(CIRCLE), n(E(50, 50, 22, 50) + ' M0 50 H100 M8 25 H92 M8 75 H92 M50 0 V100')], { aliases: ['internet', 'www'], defaultLabel: '' })
add('net-storage', 'Storage Array', 'network', D, [90, 110], [
  f('M0 70 A50 10 0 0 1 100 70 V90 A50 10 0 0 1 0 90 Z'), n('M0 70 A50 10 0 0 0 100 70'),
  f('M0 40 A50 10 0 0 1 100 40 V60 A50 10 0 0 1 0 60 Z'), n('M0 40 A50 10 0 0 0 100 40'),
  f('M0 10 A50 10 0 0 1 100 10 V30 A50 10 0 0 1 0 30 Z'), n('M0 10 A50 10 0 0 0 100 10')
], { aliases: ['disk-array', 'san'], defaultLabel: '' })
add('net-queue', 'Message Queue', 'network', MD, [150, 60], [f(R(0, 0, 100, 100)), n('M25 0 V100 M50 0 V100 M75 0 V100')], { aliases: ['queue'], defaultLabel: '' })
add('net-user', 'User', 'network', MD, [70, 80], [f(E(50, 25, 25, 25)), f('M5 100 Q5 55 50 55 Q95 55 95 100 Z')], { aliases: ['person'], defaultLabel: '' })
add('net-users', 'User Group', 'network', D, [100, 80], [f(E(30, 28, 16, 20)), f('M0 100 Q0 58 30 58 Q60 58 60 100 Z'), f(E(68, 22, 18, 22)), f('M36 100 Q36 52 68 52 Q100 52 100 100 Z')], { aliases: ['team', 'group-of-users'], defaultLabel: '' })
add('net-wifi', 'Wi-Fi / Wireless', 'network', D, [90, 70], [n('M5 35 Q50 -10 95 35 M20 55 Q50 22 80 55 M35 75 Q50 58 65 75'), so(E(50, 90, 7, 9))], { aliases: ['wireless'], defaultLabel: '' })
add('net-printer', 'Printer', 'network', D, [100, 90], [f(R(20, 0, 60, 30)), f(RR(0, 30, 100, 45, 6)), f(R(20, 60, 60, 40)), n('M30 75 H70 M30 87 H70')], { defaultLabel: '' })
add('net-container', 'Container (Docker)', 'network', D, [100, 90], [f(R(0, 30, 100, 70)), n('M20 30 V100 M40 30 V100 M60 30 V100 M80 30 V100'), f(R(20, 5, 40, 25)), n('M40 5 V30')], { defaultLabel: '' })
add('net-function', 'Function / Lambda', 'network', D, [90, 90], [f(RR(0, 0, 100, 100, 12)), n('M25 85 L45 50 L30 15 H45 L75 85 H62 L47 52 L37 85 Z')], { aliases: ['lambda', 'serverless'], defaultLabel: '' })
add('net-api', 'API Hexagon', 'network', D, [100, 86], [f(P([[25, 0], [75, 0], [100, 50], [75, 100], [25, 100], [0, 50]]))], { defaultLabel: 'API' })
add('net-satellite-dish', 'Antenna / Dish', 'network', D, [90, 100], [f('M5 10 A55 55 0 0 0 80 85 Z'), n('M42 48 L75 15 M45 85 L50 100 H20 L30 75')], { defaultLabel: '' })

/* ---------- Wireframe / Mockup ---------- */
add('mock-button', 'Button', 'mockup', MD, [120, 40], [f(RR(0, 0, 100, 100, 20))], { defaultLabel: 'Button', defaultFill: '#2563eb' })
add('mock-text-input', 'Text Input', 'mockup', MD, [200, 40], [f(RR(0, 0, 100, 100, 6)), n('M6 25 V75')], { defaultLabel: 'Placeholder', text: [8, 0, 90, 100] })
add('mock-textarea', 'Text Area', 'mockup', D, [200, 100], [f(RR(0, 0, 100, 100, 4)), n('M92 82 L96 86 M86 88 L96 78')], { defaultLabel: 'Multi-line text...', text: [4, 4, 92, 80] })
add('mock-checkbox', 'Checkbox', 'mockup', MD, [140, 30], [f(RR(0, 15, 16, 70, 3)), n(PL([[3, 50], [7, 68], [13, 30]]))], { defaultLabel: 'Option', text: [20, 0, 80, 100] })
add('mock-radio', 'Radio Button', 'mockup', MD, [140, 30], [f(E(8, 50, 8, 37)), so(E(8, 50, 4, 18))], { defaultLabel: 'Option', text: [20, 0, 80, 100] })
add('mock-toggle', 'Toggle Switch', 'mockup', MD, [70, 34], [f('M25 0 H75 A25 50 0 0 1 75 100 H25 A25 50 0 0 1 25 0 Z'), so(E(73, 50, 20, 40))], { defaultLabel: '' })
add('mock-slider', 'Slider', 'mockup', MD, [180, 30], [n('M0 50 H100'), so('M0 45 H55 V55 H0 Z'), f(E(55, 50, 7, 40))], { defaultLabel: '' })
add('mock-dropdown', 'Dropdown / Select', 'mockup', MD, [180, 40], [f(RR(0, 0, 100, 100, 6)), n('M82 0 V100 M87 40 L91 60 L95 40')], { defaultLabel: 'Select…', text: [5, 0, 75, 100] })
add('mock-progress-bar', 'Progress Bar', 'mockup', MD, [200, 20], [f(RR(0, 0, 100, 100, 50)), so(RR(0, 0, 60, 100, 50))], { defaultLabel: '' })
add('mock-browser-window', 'Browser Window', 'mockup', MD, [320, 220], [f(R(0, 0, 100, 100)), lt(R(0, 0, 100, 10)), n('M0 10 H100'), so(E(4, 5, 1.4, 2)), so(E(8.5, 5, 1.4, 2)), so(E(13, 5, 1.4, 2)), n(RR(20, 2.5, 60, 5, 2))], { defaultLabel: '', aliases: ['browser'] })
add('mock-mobile-frame', 'Mobile Device Frame', 'mockup', MD, [180, 340], [f(RR(0, 0, 100, 100, 10)), n(R(6, 8, 88, 82)), n(RR(38, 3, 24, 2, 1)), n(E(50, 95, 5, 2.6))], { defaultLabel: '', aliases: ['iphone', 'android-frame'] })
add('mock-tablet-frame', 'Tablet Device Frame', 'mockup', D, [300, 380], [f(RR(0, 0, 100, 100, 6)), n(R(5, 5, 90, 88)), n(E(50, 96.5, 2.5, 2))], { defaultLabel: '' })
add('mock-image', 'Image Placeholder', 'mockup', MD, [160, 110], [f(R(0, 0, 100, 100)), n('M0 0 L100 100 M100 0 L0 100')], { defaultLabel: '' })
add('mock-tabs', 'Tabs', 'mockup', D, [300, 140], [f(R(0, 18, 100, 82)), lt(R(0, 0, 25, 18)), n(R(0, 0, 25, 18) + ' ' + R(25, 0, 25, 18) + ' ' + R(50, 0, 25, 18))], { defaultLabel: 'Tab 1     Tab 2     Tab 3', text: [0, 0, 75, 18] })
add('mock-search-box', 'Search Box', 'mockup', MD, [200, 40], [f(STADIUM), n(E(90, 45, 4, 20) + ' M93 60 L96 75')], { defaultLabel: 'Search', text: [8, 0, 76, 100] })
add('mock-avatar', 'Avatar', 'mockup', MD, [60, 60], [f(CIRCLE), lt(E(50, 38, 18, 18)), lt('M20 85 Q20 60 50 60 Q80 60 80 85 A42 42 0 0 1 20 85 Z')], { defaultLabel: '' })
add('mock-video-player', 'Video Player', 'mockup', D, [240, 150], [f(R(0, 0, 100, 100)), so(P([[42, 30], [62, 45], [42, 60]])), n('M0 85 H100'), so(R(0, 84, 40, 2))], { defaultLabel: '' })
add('mock-modal', 'Modal Dialog', 'mockup', MD, [280, 180], [f(RR(0, 0, 100, 100, 4)), n('M0 18 H100 M92 6 L96 12 M96 6 L92 12'), f(RR(68, 78, 26, 14, 4))], { defaultLabel: 'Dialog title', text: [3, 0, 80, 18] })
add('mock-hamburger-menu', 'Hamburger Menu', 'mockup', D, [40, 34], [n('M0 10 H100 M0 50 H100 M0 90 H100', { sw: 1.6 })], { defaultLabel: '' })
add('mock-scrollbar', 'Scrollbar', 'mockup', D, [16, 160], [f(RR(0, 0, 100, 100, 50)), so(RR(10, 10, 80, 30, 40))], { defaultLabel: '' })
add('mock-tooltip', 'Tooltip', 'mockup', D, [150, 60], [f('M6 0 H94 Q100 0 100 6 V69 Q100 75 94 75 H58 L50 100 L42 75 H6 Q0 75 0 69 V6 Q0 0 6 0 Z')], { defaultLabel: 'Tooltip', text: [4, 4, 92, 66] })
add('mock-badge', 'Badge / Chip', 'mockup', MD, [90, 30], [f(STADIUM)], { defaultLabel: 'Badge' })
add('mock-card', 'Content Card', 'mockup', MD, [200, 220], [f(RR(0, 0, 100, 100, 5)), lt(R(0, 0, 100, 45)), n('M8 60 H80 M8 70 H92 M8 80 H60')], { defaultLabel: 'Card title', text: [6, 46, 88, 12] })
add('mock-navbar', 'Navigation Bar', 'mockup', D, [360, 50], [f(R(0, 0, 100, 100)), so(E(5, 50, 2.5, 18)), n('M60 50 H68 M73 50 H81 M86 50 H94')], { defaultLabel: 'Brand', text: [10, 0, 40, 100] })
add('mock-table', 'Data Table', 'mockup', D, [300, 160], [f(R(0, 0, 100, 100)), lt(R(0, 0, 100, 20)), n('M0 20 H100 M0 40 H100 M0 60 H100 M0 80 H100 M33 0 V100 M66 0 V100')], { defaultLabel: '' })

/* ------------------------------------------------------------------ */
/* Emit                                                                 */
/* ------------------------------------------------------------------ */
const out = {
  $schema: './shapeLibrary.schema.json',
  name: 'Virtual Board Shape Library',
  description:
    'Shapes from the Miro shape panel and the draw.io / diagrams.net built-in General, Basic, Misc, Advanced, Arrows, Flowchart, UML, BPMN, Entity Relation, Network and Mockup palettes. Geometry is defined in a 100x100 box and stretched to the node size.',
  version: 1,
  viewBox: '0 0 100 100',
  generatedBy: 'scripts/generate-shape-library.mjs',
  count: shapes.length,
  categories: categories.map((c) => ({ ...c, count: shapes.filter((s) => s.category === c.id).length })),
  shapes
}

for (const c of out.categories) if (c.count === 0) throw new Error(`Empty category ${c.id}`)
for (const s of shapes) if (!categories.some((c) => c.id === s.category)) throw new Error(`Unknown category for ${s.id}`)

const schema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'Virtual Board Shape Library',
  type: 'object',
  required: ['name', 'version', 'viewBox', 'count', 'categories', 'shapes'],
  properties: {
    $schema: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string' },
    version: { type: 'integer' },
    viewBox: { type: 'string' },
    generatedBy: { type: 'string' },
    count: { type: 'integer' },
    categories: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'name', 'description', 'count'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          count: { type: 'integer' }
        }
      }
    },
    shapes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'name', 'category', 'sources', 'size', 'paths', 'aliases', 'tags'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          category: { type: 'string' },
          sources: {
            type: 'array',
            items: { type: 'string', enum: ['miro', 'drawio'] }
          },
          size: {
            type: 'array',
            items: { type: 'number' },
            minItems: 2,
            maxItems: 2
          },
          paths: {
            type: 'array',
            items: {
              type: 'object',
              required: ['d', 'fill'],
              properties: {
                d: { type: 'string' },
                fill: { type: 'string', enum: ['fill', 'none', 'shade', 'light', 'solid'] },
                rule: { type: 'string', enum: ['evenodd', 'nonzero'] },
                dash: { type: 'string', enum: ['dash', 'dot', 'dashdot'] },
                stroke: { type: 'string' },
                sw: { type: 'number' }
              }
            }
          },
          text: {
            type: 'array',
            items: { type: 'number' },
            minItems: 4,
            maxItems: 4
          },
          defaultFill: { type: 'string' },
          defaultLabel: { type: 'string' },
          aliases: { type: 'array', items: { type: 'string' } },
          tags: { type: 'array', items: { type: 'string' } }
        }
      }
    }
  }
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8')
writeFileSync(SCHEMA_OUT, JSON.stringify(schema, null, 2) + '\n', 'utf8')
console.log(`Wrote ${shapes.length} shapes in ${categories.length} categories -> ${OUT}`)
console.log(`Wrote JSON schema -> ${SCHEMA_OUT}`)
for (const c of out.categories) console.log(`  ${c.name.padEnd(26)} ${c.count}`)
