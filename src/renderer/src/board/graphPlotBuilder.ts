import type { FontId, ShapeNode, TextNode, VectorDiagramMeta } from '../types/board'

export type GraphPlotMode = 'function' | 'data'
export type GraphDataChartKind = 'line' | 'smooth' | 'bar' | 'scatter'
export type GraphAxisStyle = 'origin' | 'frame'

export interface GraphFunctionSeries {
  id: string
  label: string
  expr: string
  color: string
  dashed?: boolean
}

export interface GraphDataSeries {
  id: string
  label: string
  valuesText: string
  color: string
}

export interface GraphPlotSpec {
  title: string
  mode: GraphPlotMode
  xMin: number
  xMax: number
  yMin: number
  yMax: number
  xLabel: string
  yLabel: string
  axisStyle: GraphAxisStyle
  showGrid: boolean
  showLegend: boolean
  functions: GraphFunctionSeries[]
  dataKind: GraphDataChartKind
  categoriesText: string
  dataSeries: GraphDataSeries[]
}

export interface GraphPreset {
  id: string
  name: string
  description: string
  spec: GraphPlotSpec
}

export const GRAPH_SERIES_COLORS = [
  '#2563EB',
  '#EF4444',
  '#10B981',
  '#8B5CF6',
  '#F59E0B',
  '#0891B2'
]

export const GRAPH_PRESETS: GraphPreset[] = [
  {
    id: 'sine-cosine',
    name: 'Sin & Cos Waves',
    description: '4-quadrant sinusoidal waves',
    spec: {
      title: 'Sinusoidal PE Spectrum',
      mode: 'function',
      xMin: -6.3,
      xMax: 6.3,
      yMin: -1.4,
      yMax: 1.4,
      xLabel: 'pos / rad',
      yLabel: 'Amplitude',
      axisStyle: 'origin',
      showGrid: true,
      showLegend: true,
      functions: [
        { id: 'f1', label: 'sin(x)', expr: 'sin(x)', color: '#2563EB' },
        { id: 'f2', label: 'cos(x)', expr: 'cos(x)', color: '#10B981', dashed: true }
      ],
      dataKind: 'line',
      categoriesText: '1, 2, 3, 4, 5',
      dataSeries: [{ id: 'd1', label: 'Series 1', valuesText: '1, 3, 2, 5, 4', color: '#2563EB' }]
    }
  },
  {
    id: 'lr-cosine',
    name: 'LR Cosine Decay',
    description: 'Warmup + cosine schedule',
    spec: {
      title: 'LR Warmup + Cosine Decay',
      mode: 'function',
      xMin: 0,
      xMax: 10,
      yMin: 0,
      yMax: 1.15,
      xLabel: 'Step (k)',
      yLabel: 'LR Scale',
      axisStyle: 'frame',
      showGrid: true,
      showLegend: true,
      functions: [
        {
          id: 'f1',
          label: 'Warmup + Cosine',
          expr: 'warmup_cosine(x, 2, 10)',
          color: '#8B5CF6'
        }
      ],
      dataKind: 'line',
      categoriesText: '0, 2k, 4k, 6k, 8k, 10k',
      dataSeries: [{ id: 'd1', label: 'LR', valuesText: '0, 1, 0.9, 0.65, 0.25, 0.05', color: '#8B5CF6' }]
    }
  },
  {
    id: 'activations',
    name: 'Sigmoid vs SiLU',
    description: 'ML activation curves',
    spec: {
      title: 'Activation Functions',
      mode: 'function',
      xMin: -5,
      xMax: 5,
      yMin: -0.6,
      yMax: 3.5,
      xLabel: 'x',
      yLabel: 'f(x)',
      axisStyle: 'origin',
      showGrid: true,
      showLegend: true,
      functions: [
        { id: 'f1', label: 'SiLU / Swish', expr: 'silu(x)', color: '#2563EB' },
        { id: 'f2', label: 'Sigmoid', expr: 'sigmoid(x)', color: '#EF4444' },
        { id: 'f3', label: 'ReLU', expr: 'relu(x)', color: '#10B981', dashed: true }
      ],
      dataKind: 'line',
      categoriesText: '1, 2, 3, 4, 5',
      dataSeries: [{ id: 'd1', label: 'Loss', valuesText: '2.4, 1.5, 0.9, 0.6, 0.45', color: '#2563EB' }]
    }
  },
  {
    id: 'gaussian',
    name: 'Gaussian Bell',
    description: 'Normal distribution N(0, 1)',
    spec: {
      title: 'Gaussian Distribution N(0,1)',
      mode: 'function',
      xMin: -4,
      xMax: 4,
      yMin: 0,
      yMax: 0.48,
      xLabel: 'z',
      yLabel: 'p(z)',
      axisStyle: 'origin',
      showGrid: true,
      showLegend: true,
      functions: [{ id: 'f1', label: 'N(0, 1)', expr: 'gaussian(x)', color: '#0891B2' }],
      dataKind: 'line',
      categoriesText: '-2σ, -σ, 0, +σ, +2σ',
      dataSeries: [{ id: 'd1', label: 'Density', valuesText: '0.05, 0.24, 0.4, 0.24, 0.05', color: '#0891B2' }]
    }
  },
  {
    id: 'train-loss',
    name: 'Train vs Val Loss',
    description: 'Smooth metric comparison',
    spec: {
      title: 'Training vs Validation Loss',
      mode: 'data',
      xMin: 0,
      xMax: 6,
      yMin: 0,
      yMax: 3,
      xLabel: 'Epoch',
      yLabel: 'Loss',
      axisStyle: 'frame',
      showGrid: true,
      showLegend: true,
      functions: [{ id: 'f1', label: 'exp(-x)', expr: 'exp(-x)', color: '#2563EB' }],
      dataKind: 'smooth',
      categoriesText: 'E1, E2, E3, E4, E5, E6',
      dataSeries: [
        { id: 'd1', label: 'Train Loss', valuesText: '2.6, 1.7, 1.1, 0.72, 0.48, 0.34', color: '#2563EB' },
        { id: 'd2', label: 'Val Loss', valuesText: '2.7, 1.9, 1.35, 0.98, 0.82, 0.78', color: '#EF4444' }
      ]
    }
  },
  {
    id: 'bar-benchmark',
    name: 'Bar Comparison',
    description: 'Grouped bar chart',
    spec: {
      title: 'Throughput Comparison',
      mode: 'data',
      xMin: 0,
      xMax: 4,
      yMin: 0,
      yMax: 100,
      xLabel: 'Model',
      yLabel: 'Score (%)',
      axisStyle: 'frame',
      showGrid: true,
      showLegend: true,
      functions: [{ id: 'f1', label: 'x', expr: 'x', color: '#2563EB' }],
      dataKind: 'bar',
      categoriesText: 'Baseline, Attn, MoE, Ours',
      dataSeries: [
        { id: 'd1', label: 'Accuracy', valuesText: '64, 78, 84, 92', color: '#10B981' },
        { id: 'd2', label: 'Speedup', valuesText: '50, 62, 81, 88', color: '#2563EB' }
      ]
    }
  },
  {
    id: 'blank-axes',
    name: 'Blank Axes',
    description: 'Clean coordinate plane',
    spec: {
      title: 'Coordinate Plane',
      mode: 'function',
      xMin: -5,
      xMax: 5,
      yMin: -5,
      yMax: 5,
      xLabel: 'x',
      yLabel: 'y',
      axisStyle: 'origin',
      showGrid: true,
      showLegend: false,
      functions: [],
      dataKind: 'line',
      categoriesText: '1, 2, 3, 4',
      dataSeries: []
    }
  }
]

/* ---------------- Safe Zero-Eval Math Expression Parser ---------------- */

type Token =
  | { type: 'num'; val: number }
  | { type: 'ident'; val: string }
  | { type: 'op'; val: '+' | '-' | '*' | '/' | '^' }
  | { type: 'lparen' }
  | { type: 'rparen' }
  | { type: 'comma' }

function tokenizeExpr(expr: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  const s = expr.trim()
  while (i < s.length) {
    const ch = s[i]
    if (/\s/.test(ch)) {
      i++
      continue
    }
    if (/[0-9.]/.test(ch)) {
      let numStr = ''
      while (i < s.length && /[0-9.]/.test(s[i])) {
        numStr += s[i++]
      }
      if (i < s.length && (s[i] === 'e' || s[i] === 'E')) {
        const next = s[i + 1]
        if (next && (/[0-9]/.test(next) || ((next === '+' || next === '-') && /[0-9]/.test(s[i + 2] || '')))) {
          numStr += s[i++]
          if (s[i] === '+' || s[i] === '-') numStr += s[i++]
          while (i < s.length && /[0-9]/.test(s[i])) numStr += s[i++]
        }
      }
      const val = Number(numStr)
      if (!Number.isFinite(val)) return []
      tokens.push({ type: 'num', val })
      continue
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let id = ''
      while (i < s.length && /[a-zA-Z0-9_]/.test(s[i])) id += s[i++]
      tokens.push({ type: 'ident', val: id })
      continue
    }
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '^') {
      tokens.push({ type: 'op', val: ch })
      i++
      continue
    }
    if (ch === '(') {
      tokens.push({ type: 'lparen' })
      i++
      continue
    }
    if (ch === ')') {
      tokens.push({ type: 'rparen' })
      i++
      continue
    }
    if (ch === ',') {
      tokens.push({ type: 'comma' })
      i++
      continue
    }
    // Unsupported char
    return []
  }

  // Insert implicit '*' between (num | rparen | non-call ident) and (ident | lparen | num)
  const out: Token[] = []
  for (let k = 0; k < tokens.length; k++) {
    const cur = tokens[k]
    const prev = out[out.length - 1]
    if (prev) {
      const prevValueLike =
        prev.type === 'num' ||
        prev.type === 'rparen' ||
        (prev.type === 'ident' && cur.type !== 'lparen')
      const curFactorStart = cur.type === 'num' || cur.type === 'ident' || cur.type === 'lparen'
      if (prevValueLike && curFactorStart && prev.type !== 'ident') {
        out.push({ type: 'op', val: '*' })
      } else if (
        prev.type === 'ident' &&
        (prev.val === 'x' || prev.val === 'pi' || prev.val === 'PI' || prev.val === 'e') &&
        cur.type === 'num'
      ) {
        out.push({ type: 'op', val: '*' })
      }
    }
    out.push(cur)
  }
  return out
}

function callMathFn(name: string, args: number[]): number {
  const a = args[0] ?? Number.NaN
  switch (name.toLowerCase()) {
    case 'sin':
      return Math.sin(a)
    case 'cos':
      return Math.cos(a)
    case 'tan':
      return Math.tan(a)
    case 'asin':
      return Math.asin(a)
    case 'acos':
      return Math.acos(a)
    case 'atan':
      return args.length >= 2 ? Math.atan2(a, args[1]) : Math.atan(a)
    case 'sinh':
      return Math.sinh(a)
    case 'cosh':
      return Math.cosh(a)
    case 'tanh':
      return Math.tanh(a)
    case 'exp':
      return Math.exp(a)
    case 'ln':
    case 'log':
      return args.length >= 2 ? Math.log(a) / Math.log(args[1]) : Math.log(a)
    case 'log2':
      return Math.log2(a)
    case 'log10':
      return Math.log10(a)
    case 'sqrt':
      return Math.sqrt(a)
    case 'abs':
      return Math.abs(a)
    case 'floor':
      return Math.floor(a)
    case 'ceil':
      return Math.ceil(a)
    case 'round':
      return Math.round(a)
    case 'sign':
      return Math.sign(a)
    case 'min':
      return Math.min(...args)
    case 'max':
      return Math.max(...args)
    case 'pow':
      return Math.pow(a, args[1] ?? 1)
    case 'step':
      return a >= (args[1] ?? 0) ? 1 : 0
    case 'sinc':
      return Math.abs(a) < 1e-6 ? 1 : Math.sin(Math.PI * a) / (Math.PI * a)
    case 'sigmoid':
    case 'sig':
      return 1 / (1 + Math.exp(-a))
    case 'relu':
      return Math.max(0, a)
    case 'leaky_relu':
      return a >= 0 ? a : 0.1 * a
    case 'silu':
    case 'swish':
      return a / (1 + Math.exp(-a))
    case 'gelu':
      return 0.5 * a * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (a + 0.044715 * a * a * a)))
    case 'softplus':
      return Math.log(1 + Math.exp(a))
    case 'gaussian':
    case 'normpdf': {
      const mu = args[1] ?? 0
      const sigma = Math.max(1e-4, args[2] ?? 1)
      const z = (a - mu) / sigma
      return Math.exp(-0.5 * z * z) / (sigma * Math.sqrt(2 * Math.PI))
    }
    case 'warmup_cosine': {
      const warmup = Math.max(0.001, args[1] ?? 2)
      const total = Math.max(warmup + 0.001, args[2] ?? 10)
      if (a < 0) return 0
      if (a <= warmup) return a / warmup
      if (a >= total) return 0.05
      const t = (a - warmup) / (total - warmup)
      return 0.05 + 0.95 * 0.5 * (1 + Math.cos(Math.PI * t))
    }
    default:
      return Number.NaN
  }
}

export function evaluateMathExpr(rawExpr: string, xVal: number): number {
  const cleaned = rawExpr.replace(/^\s*y\s*=\s*/i, '').trim()
  if (!cleaned) return Number.NaN
  const tokens = tokenizeExpr(cleaned)
  if (tokens.length === 0) return Number.NaN

  let pos = 0
  const peek = (): Token | undefined => tokens[pos]
  const consume = (): Token | undefined => tokens[pos++]

  const parseExpr = (): number => {
    let left = parseTerm()
    while (true) {
      const t = peek()
      if (!t || t.type !== 'op' || (t.val !== '+' && t.val !== '-')) break
      consume()
      const right = parseTerm()
      left = t.val === '+' ? left + right : left - right
    }
    return left
  }

  const parseTerm = (): number => {
    let left = parsePower()
    while (true) {
      const t = peek()
      if (!t || t.type !== 'op' || (t.val !== '*' && t.val !== '/')) break
      consume()
      const right = parsePower()
      left = t.val === '*' ? left * right : left / right
    }
    return left
  }

  const parsePower = (): number => {
    const base = parseUnary()
    const t = peek()
    if (t && t.type === 'op' && t.val === '^') {
      consume()
      const exp = parsePower()
      return Math.pow(base, exp)
    }
    return base
  }

  const parseUnary = (): number => {
    const t = peek()
    if (t && t.type === 'op' && (t.val === '+' || t.val === '-')) {
      consume()
      const v = parseUnary()
      return t.val === '-' ? -v : v
    }
    return parsePrimary()
  }

  const parsePrimary = (): number => {
    const tok = peek()
    if (!tok) return Number.NaN
    if (tok.type === 'num') {
      consume()
      return tok.val
    }
    if (tok.type === 'lparen') {
      consume()
      const v = parseExpr()
      if (peek()?.type !== 'rparen') return Number.NaN
      consume()
      return v
    }
    if (tok.type === 'ident') {
      consume()
      if (peek()?.type === 'lparen') {
        consume()
        const args: number[] = []
        if (peek()?.type !== 'rparen') {
          args.push(parseExpr())
          while (peek()?.type === 'comma') {
            consume()
            args.push(parseExpr())
          }
        }
        if (peek()?.type !== 'rparen') return Number.NaN
        consume()
        return callMathFn(tok.val, args)
      }
      const lower = tok.val.toLowerCase()
      if (lower === 'x') return xVal
      if (lower === 'pi') return Math.PI
      if (lower === 'e') return Math.E
      return Number.NaN
    }
    return Number.NaN
  }

  const val = parseExpr()
  return pos === tokens.length ? val : Number.NaN
}

/* ---------------- Formatting & Coordinate Mapping Helpers ---------------- */

function formatTickNumber(n: number): string {
  if (Math.abs(n) < 1e-9) return '0'
  const rounded = Math.round(n * 100) / 100
  if (Math.abs(rounded - Math.round(rounded)) < 1e-6) return String(Math.round(rounded))
  return String(rounded).replace(/(\.\d*?[1-9])0+$/, '$1')
}

export function parseNumberList(raw: string): number[] {
  return raw
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n))
}

export function parseLabelList(raw: string): string[] {
  return raw
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function catmullRomSvgPath(pts: Array<[number, number]>): string {
  if (pts.length === 0) return ''
  if (pts.length === 1) return `M ${pts[0][0]} ${pts[0][1]}`
  if (pts.length === 2) return `M ${pts[0][0]} ${pts[0][1]} L ${pts[1][0]} ${pts[1][1]}`
  let d = `M ${Math.round(pts[0][0] * 10) / 10} ${Math.round(pts[0][1] * 10) / 10}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(pts.length - 1, i + 2)]
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6
    d += ` C ${Math.round(cp1x * 10) / 10} ${Math.round(cp1y * 10) / 10}, ${Math.round(cp2x * 10) / 10} ${Math.round(cp2y * 10) / 10}, ${Math.round(p2[0] * 10) / 10} ${Math.round(p2[1] * 10) / 10}`
  }
  return d
}

export interface PreviewGraphPath {
  d: string
  color: string
  dashed?: boolean
  strokeWidth?: number
  fill?: string
}

export interface GraphPreviewModel {
  xMin: number
  xMax: number
  yMin: number
  yMax: number
  xAxisY: number
  yAxisX: number
  gridLinesX: number[]
  gridLinesY: number[]
  paths: PreviewGraphPath[]
  bars: Array<{ x: number; y: number; w: number; h: number; color: string; label?: string }>
  dots: Array<{ cx: number; cy: number; color: string }>
  xTicks: Array<{ pos: number; label: string }>
  yTicks: Array<{ pos: number; label: string }>
  legend: Array<{ label: string; color: string; dashed?: boolean }>
  viewW: number
  viewH: number
  plotX: number
  plotY: number
  plotW: number
  plotH: number
}

export function buildGraphPreviewModel(
  spec: GraphPlotSpec,
  viewW = 320,
  viewH = 200
): GraphPreviewModel {
  const plotX = 42
  const plotY = 20
  const plotW = viewW - 60
  const plotH = viewH - 52

  let xMin = Number.isFinite(spec.xMin) ? spec.xMin : -5
  let xMax = Number.isFinite(spec.xMax) ? spec.xMax : 5
  if (xMax <= xMin) xMax = xMin + 1

  let yMin = Number.isFinite(spec.yMin) ? spec.yMin : -2
  let yMax = Number.isFinite(spec.yMax) ? spec.yMax : 2
  if (yMax <= yMin) yMax = yMin + 1

  // Auto-range Y from numeric data series when in data mode
  const categories = parseLabelList(spec.categoriesText)
  const parsedSeries = spec.dataSeries.map((ds) => ({
    ...ds,
    vals: parseNumberList(ds.valuesText)
  }))

  if (spec.mode === 'data') {
    const allVals = parsedSeries.flatMap((s) => s.vals)
    if (allVals.length > 0) {
      const minV = Math.min(...allVals)
      const maxV = Math.max(...allVals)
      yMin = spec.dataKind === 'bar' ? Math.min(0, minV) : minV >= 0 && minV < maxV * 0.25 ? 0 : minV
      yMax = maxV + Math.max(0.5, (maxV - yMin) * 0.14)
      if (yMax <= yMin) yMax = yMin + 1
    }
    const count = Math.max(
      2,
      categories.length,
      ...parsedSeries.map((s) => s.vals.length)
    )
    xMin = 0
    xMax = spec.dataKind === 'bar' ? count : count - 1
  }

  const mapX = (x: number): number => plotX + ((x - xMin) / (xMax - xMin)) * plotW
  const mapY = (y: number): number => plotY + plotH - ((y - yMin) / (yMax - yMin)) * plotH

  const xAxisY =
    spec.axisStyle === 'origin' && yMin <= 0 && yMax >= 0 ? mapY(0) : plotY + plotH
  const yAxisX =
    spec.axisStyle === 'origin' && xMin <= 0 && xMax >= 0 ? mapX(0) : plotX

  const gridLinesX: number[] = []
  const gridLinesY: number[] = []
  const xTicks: Array<{ pos: number; label: string }> = []
  const yTicks: Array<{ pos: number; label: string }> = []

  if (spec.mode === 'data') {
    const nCat = Math.max(1, categories.length, ...parsedSeries.map((s) => s.vals.length))
    for (let i = 0; i < nCat; i++) {
      const pos = spec.dataKind === 'bar' ? mapX(i + 0.5) : mapX(i)
      gridLinesX.push(pos)
      xTicks.push({ pos, label: categories[i] ?? String(i + 1) })
    }
  } else {
    const xStepCount = 4
    for (let i = 0; i <= xStepCount; i++) {
      const xv = xMin + ((xMax - xMin) * i) / xStepCount
      const px = mapX(xv)
      gridLinesX.push(px)
      xTicks.push({ pos: px, label: formatTickNumber(xv) })
    }
  }

  const yStepCount = 4
  for (let i = 0; i <= yStepCount; i++) {
    const yv = yMin + ((yMax - yMin) * i) / yStepCount
    const py = mapY(yv)
    gridLinesY.push(py)
    yTicks.push({ pos: py, label: formatTickNumber(yv) })
  }

  const paths: PreviewGraphPath[] = []
  const bars: GraphPreviewModel['bars'] = []
  const dots: GraphPreviewModel['dots'] = []
  const legend: GraphPreviewModel['legend'] = []

  if (spec.mode === 'function') {
    const samples = 180
    const ySpan = yMax - yMin
    const minClampY = yMin - ySpan * 0.25
    const maxClampY = yMax + ySpan * 0.25

    for (const fn of spec.functions) {
      if (!fn.expr.trim()) continue
      legend.push({
        label: fn.label.trim() || fn.expr.trim(),
        color: fn.color,
        dashed: fn.dashed
      })

      let segs: Array<Array<[number, number]>> = []
      let curSeg: Array<[number, number]> = []
      let prevRawY: number | null = null

      for (let i = 0; i <= samples; i++) {
        const xv = xMin + ((xMax - xMin) * i) / samples
        const yv = evaluateMathExpr(fn.expr, xv)
        const jump =
          prevRawY !== null && Number.isFinite(yv) && Math.abs(yv - prevRawY) > ySpan * 1.4
        if (!Number.isFinite(yv) || yv < minClampY || yv > maxClampY || jump) {
          if (curSeg.length >= 2) segs.push(curSeg)
          curSeg = []
          prevRawY = Number.isFinite(yv) ? yv : null
          continue
        }
        prevRawY = yv
        const clampedY = Math.max(yMin, Math.min(yMax, yv))
        curSeg.push([Math.round(mapX(xv) * 10) / 10, Math.round(mapY(clampedY) * 10) / 10])
      }
      if (curSeg.length >= 2) segs.push(curSeg)

      if (segs.length > 0) {
        const d = segs
          .map((seg) => `M ${seg[0][0]} ${seg[0][1]} ` + seg.slice(1).map((p) => `L ${p[0]} ${p[1]}`).join(' '))
          .join(' ')
        paths.push({ d, color: fn.color, dashed: fn.dashed, strokeWidth: 2.8 })
      }
    }
  } else {
    const nSer = Math.max(1, parsedSeries.length)
    parsedSeries.forEach((ds, sIdx) => {
      if (ds.vals.length === 0) return
      legend.push({ label: ds.label || `Series ${sIdx + 1}`, color: ds.color })

      if (spec.dataKind === 'bar') {
        const groupW = plotW / Math.max(1, xMax)
        const slotW = groupW * 0.72
        const barW = Math.max(8, Math.min(48, (slotW - (nSer - 1) * 4) / nSer))
        const totalGroupBarW = barW * nSer + Math.max(0, nSer - 1) * 4
        const zeroY = mapY(Math.max(yMin, Math.min(yMax, 0)))

        ds.vals.forEach((v, idx) => {
          const cx = mapX(idx + 0.5) - totalGroupBarW / 2 + sIdx * (barW + 4)
          const vy = mapY(v)
          bars.push({
            x: Math.round(cx * 10) / 10,
            y: Math.round(Math.min(zeroY, vy) * 10) / 10,
            w: Math.round(barW * 10) / 10,
            h: Math.max(2, Math.round(Math.abs(zeroY - vy) * 10) / 10),
            color: ds.color
          })
        })
      } else {
        const pts: Array<[number, number]> = ds.vals.map((v, idx) => [
          Math.round(mapX(idx) * 10) / 10,
          Math.round(mapY(v) * 10) / 10
        ])
        for (const [px, py] of pts) {
          dots.push({ cx: px, cy: py, color: ds.color })
        }
        if (spec.dataKind === 'line' && pts.length >= 2) {
          paths.push({
            d: `M ${pts[0][0]} ${pts[0][1]} ` + pts.slice(1).map((p) => `L ${p[0]} ${p[1]}`).join(' '),
            color: ds.color,
            strokeWidth: 2.8
          })
        } else if (spec.dataKind === 'smooth' && pts.length >= 2) {
          paths.push({
            d: catmullRomSvgPath(pts),
            color: ds.color,
            strokeWidth: 2.8
          })
        }
      }
    })
  }

  return {
    xMin,
    xMax,
    yMin,
    yMax,
    xAxisY,
    yAxisX,
    gridLinesX,
    gridLinesY,
    paths,
    bars,
    dots,
    xTicks,
    yTicks,
    legend,
    viewW,
    viewH,
    plotX,
    plotY,
    plotW,
    plotH
  }
}

export function compileGraphToBoardElements(
  spec: GraphPlotSpec,
  anchor: { x: number; y: number; width?: number; height?: number },
  opts: { fontFamily: FontId; layerId: string; inkColor?: string }
): {
  shapes: ShapeNode[]
  texts: TextNode[]
  groupId: string
  meta: VectorDiagramMeta
  bounds: { x: number; y: number; width: number; height: number }
} {
  const cardW = Math.round(anchor.width ?? 480)
  const cardH = Math.round(anchor.height ?? 320)
  const cardX = Math.round(anchor.x)
  const cardY = Math.round(anchor.y)
  const ink = opts.inkColor || '#111111'
  const now = Date.now()
  const groupId = `graph-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const gid = (suffix: string): string => `${groupId}-${suffix}`

  const preview = buildGraphPreviewModel(spec, 460, 260)
  const padL = cardX + 58
  const padT = cardY + (spec.title.trim() ? 48 : 26)
  const padR = cardX + cardW - 26
  const padB = cardY + cardH - (spec.showLegend && preview.legend.length > 0 ? 52 : 34)
  const plotW = Math.max(120, padR - padL)
  const plotH = Math.max(90, padB - padT)

  const scaleX = (px: number): number =>
    Math.round(padL + ((px - preview.plotX) / Math.max(1, preview.plotW)) * plotW)
  const scaleY = (py: number): number =>
    Math.round(padT + ((py - preview.plotY) / Math.max(1, preview.plotH)) * plotH)

  const shapes: ShapeNode[] = []
  const texts: TextNode[] = []

  // 1. Clean Neo-Brutalist Card Frame
  shapes.push({
    id: gid('frame'),
    shape: 'rounded-rect',
    x: cardX,
    y: cardY,
    w: cardW,
    h: cardH,
    borderRadius: 14,
    color: ink,
    fillColor: '#FFFFFF',
    strokeWidth: 2,
    vectorGroupId: groupId,
    layerId: opts.layerId
  })

  // Title text
  if (spec.title.trim()) {
    texts.push({
      id: gid('title'),
      x: cardX + 18,
      y: cardY + 12,
      w: cardW - 36,
      h: 24,
      text: spec.title.trim(),
      style: 'h3',
      bold: true,
      fontSize: 15,
      color: ink,
      immersed: true,
      fontFamily: opts.fontFamily,
      align: 'center',
      vectorGroupId: groupId,
      layerId: opts.layerId,
      source: 'manual',
      createdAt: now
    })
  }

  // 2. Subtle Gridlines (single svg-path node so lines move/rotate cleanly)
  if (spec.showGrid) {
    const gridSegs: string[] = []
    for (const gx of preview.gridLinesX) {
      const sx = scaleX(gx)
      gridSegs.push(`M ${sx - padL} 0 V ${plotH}`)
    }
    for (const gy of preview.gridLinesY) {
      const sy = scaleY(gy)
      gridSegs.push(`M 0 ${sy - padT} H ${plotW}`)
    }
    if (gridSegs.length > 0) {
      shapes.push({
        id: gid('grid'),
        shape: 'svg-path',
        x: padL,
        y: padT,
        w: plotW,
        h: plotH,
        svgViewBox: [0, 0, plotW, plotH],
        svgPaths: [
          {
            d: gridSegs.join(' '),
            fill: 'none',
            stroke: '#CBD5E1',
            strokeWidth: 1,
            dashed: true
          }
        ],
        color: '#CBD5E1',
        fillColor: 'transparent',
        strokeWidth: 1,
        vectorGroupId: groupId,
        layerId: opts.layerId
      })
    }
  }

  // 3. Axes (Origin cross or L-frame)
  const axisXCoord = scaleX(preview.yAxisX)
  const axisYCoord = scaleY(preview.xAxisY)
  shapes.push({
    id: gid('axis-x'),
    shape: 'arrow',
    x: padL,
    y: axisYCoord,
    w: plotW,
    h: 0,
    arrowEnd: true,
    color: ink,
    fillColor: 'transparent',
    strokeWidth: 2,
    vectorGroupId: groupId,
    layerId: opts.layerId
  })
  shapes.push({
    id: gid('axis-y'),
    shape: 'arrow',
    x: axisXCoord,
    y: padT + plotH,
    w: 0,
    h: -plotH,
    arrowEnd: true,
    color: ink,
    fillColor: 'transparent',
    strokeWidth: 2,
    vectorGroupId: groupId,
    layerId: opts.layerId
  })

  // 4. Function / Line / Smooth Curve SVG Layers
  preview.paths.forEach((p, idx) => {
    const vbX = preview.plotX
    const vbY = preview.plotY
    const vbW = preview.plotW
    const vbH = preview.plotH
    shapes.push({
      id: gid(`curve-${idx}`),
      shape: 'svg-path',
      x: padL,
      y: padT,
      w: plotW,
      h: plotH,
      svgViewBox: [vbX, vbY, vbW, vbH],
      svgPaths: [
        {
          d: p.d,
          fill: 'none',
          stroke: p.color,
          strokeWidth: p.strokeWidth ?? 3,
          dashed: p.dashed
        }
      ],
      color: p.color,
      fillColor: 'transparent',
      strokeWidth: p.strokeWidth ?? 3,
      strokeStyle: p.dashed ? 'dashed' : 'solid',
      vectorGroupId: groupId,
      layerId: opts.layerId
    })
  })

  // 5. Data Bars & Scatter Dots
  preview.bars.forEach((b, idx) => {
    const bx = scaleX(b.x)
    const by = scaleY(b.y)
    const bw = Math.max(8, Math.round((b.w / Math.max(1, preview.plotW)) * plotW))
    const bh = Math.max(3, Math.round((b.h / Math.max(1, preview.plotH)) * plotH))
    shapes.push({
      id: gid(`bar-${idx}`),
      shape: 'rounded-rect',
      x: bx,
      y: by,
      w: bw,
      h: bh,
      borderRadius: 4,
      color: ink,
      fillColor: b.color,
      fillOpacity: 0.86,
      strokeWidth: 1.5,
      vectorGroupId: groupId,
      layerId: opts.layerId
    })
  })

  preview.dots.forEach((dot, idx) => {
    const cx = scaleX(dot.cx)
    const cy = scaleY(dot.cy)
    const r = spec.dataKind === 'scatter' ? 6 : 4.5
    shapes.push({
      id: gid(`dot-${idx}`),
      shape: 'circle',
      x: Math.round(cx - r),
      y: Math.round(cy - r),
      w: Math.round(r * 2),
      h: Math.round(r * 2),
      color: '#FFFFFF',
      fillColor: dot.color,
      strokeWidth: 1.5,
      vectorGroupId: groupId,
      layerId: opts.layerId
    })
  })

  // 6. Tick Labels & Axis Labels
  preview.xTicks.forEach((tk, idx) => {
    const tx = scaleX(tk.pos)
    texts.push({
      id: gid(`xtick-${idx}`),
      x: tx - 22,
      y: padT + plotH + 4,
      w: 44,
      h: 16,
      text: tk.label,
      style: 'body',
      fontSize: 10,
      color: '#475569',
      immersed: true,
      fontFamily: opts.fontFamily,
      align: 'center',
      vectorGroupId: groupId,
      layerId: opts.layerId,
      source: 'manual',
      createdAt: now
    })
  })

  preview.yTicks.forEach((tk, idx) => {
    const ty = scaleY(tk.pos)
    texts.push({
      id: gid(`ytick-${idx}`),
      x: cardX + 8,
      y: ty - 8,
      w: Math.max(30, padL - cardX - 12),
      h: 16,
      text: tk.label,
      style: 'body',
      fontSize: 10,
      color: '#475569',
      immersed: true,
      fontFamily: opts.fontFamily,
      align: 'right',
      vectorGroupId: groupId,
      layerId: opts.layerId,
      source: 'manual',
      createdAt: now
    })
  })

  if (spec.xLabel.trim()) {
    texts.push({
      id: gid('xlabel'),
      x: padL + plotW - 76,
      y: Math.max(padT + 4, axisYCoord - 18),
      w: 74,
      h: 16,
      text: spec.xLabel.trim(),
      style: 'body',
      bold: true,
      fontSize: 11,
      color: ink,
      immersed: true,
      fontFamily: opts.fontFamily,
      align: 'right',
      vectorGroupId: groupId,
      layerId: opts.layerId,
      source: 'manual',
      createdAt: now
    })
  }

  if (spec.yLabel.trim()) {
    texts.push({
      id: gid('ylabel'),
      x: Math.max(cardX + 12, axisXCoord + 6),
      y: padT + 2,
      w: 92,
      h: 16,
      text: spec.yLabel.trim(),
      style: 'body',
      bold: true,
      fontSize: 11,
      color: ink,
      immersed: true,
      fontFamily: opts.fontFamily,
      align: 'left',
      vectorGroupId: groupId,
      layerId: opts.layerId,
      source: 'manual',
      createdAt: now
    })
  }

  // 7. Compact Bottom Legend
  if (spec.showLegend && preview.legend.length > 0) {
    const colW = Math.min(130, Math.floor((cardW - 36) / Math.max(1, preview.legend.length)))
    const startX = cardX + Math.round((cardW - colW * preview.legend.length) / 2)
    const legY = cardY + cardH - 22
    preview.legend.forEach((item, idx) => {
      const lx = startX + idx * colW
      shapes.push({
        id: gid(`leg-swatch-${idx}`),
        shape: 'line',
        x: lx,
        y: legY + 7,
        w: 18,
        h: 0,
        color: item.color,
        strokeWidth: 3,
        strokeStyle: item.dashed ? 'dashed' : 'solid',
        fillColor: 'transparent',
        vectorGroupId: groupId,
        layerId: opts.layerId
      })
      texts.push({
        id: gid(`leg-txt-${idx}`),
        x: lx + 22,
        y: legY,
        w: colW - 24,
        h: 16,
        text: item.label,
        style: 'body',
        bold: true,
        fontSize: 11,
        color: ink,
        immersed: true,
        fontFamily: opts.fontFamily,
        align: 'left',
        vectorGroupId: groupId,
        layerId: opts.layerId,
        source: 'manual',
        createdAt: now
      })
    })
  }

  return {
    shapes,
    texts,
    groupId,
    meta: {
      groupId,
      anchor: { x: cardX, y: cardY }
    },
    bounds: { x: cardX, y: cardY, width: cardW, height: cardH }
  }
}
