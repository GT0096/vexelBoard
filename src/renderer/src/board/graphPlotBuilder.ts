import type { Scene3DElement, Scene3DSpec, Vec3 } from '@shared/scene3dSchema'
import type { FontId, ShapeNode, TextNode, VectorDiagramMeta } from '../types/board'

export type GraphPlotMode = 'function' | 'data' | '3d'
export type GraphDataChartKind = 'line' | 'smooth' | 'bar' | 'scatter'
export type GraphChartType =
  | 'function'
  | 'line'
  | 'smooth'
  | 'area'
  | 'bar'
  | 'histogram'
  | 'scatter'
  | 'pie'
  | 'violin'
  | 'box'
  | 'candlestick'
  | 'heatmap'
  | 'surface3d'
  | 'scatter3d'
  | 'line3d'
  | 'bar3d'

export type GraphAxisStyle = 'origin' | 'frame' | 'box' | 'none'
export type GraphLegendPosition = 'bottom' | 'top' | 'right' | 'inside'

export interface GraphChartTypeMeta {
  id: GraphChartType
  label: string
  group: '2d-fn' | '2d-data' | '2d-stat' | '3d'
  description: string
}

export const GRAPH_CHART_TYPES: GraphChartTypeMeta[] = [
  { id: 'function', label: 'y = f(x) Function', group: '2d-fn', description: 'GeoGebra-style symbolic curve plotter' },
  { id: 'line', label: 'Line Chart', group: '2d-data', description: 'Piecewise connected series' },
  { id: 'smooth', label: 'Smooth Spline', group: '2d-data', description: 'Catmull-Rom smooth curve' },
  { id: 'area', label: 'Area Chart', group: '2d-data', description: 'Filled area beneath series' },
  { id: 'bar', label: 'Bar Chart', group: '2d-data', description: 'Single or grouped vertical bars' },
  { id: 'histogram', label: 'Histogram', group: '2d-stat', description: 'Frequency bins + optional KDE' },
  { id: 'scatter', label: 'Scatter Plot', group: '2d-data', description: '2D (x, y) markers + trendline' },
  { id: 'pie', label: 'Pie / Donut', group: '2d-stat', description: 'Proportional wedge breakdown' },
  { id: 'violin', label: 'Violin Plot', group: '2d-stat', description: 'Kernel density + IQR quartile box' },
  { id: 'box', label: 'Box Plot', group: '2d-stat', description: 'Median, quartiles & whiskers' },
  { id: 'candlestick', label: 'Stock Candlestick', group: '2d-data', description: 'OHLC financial candles & wicks' },
  { id: 'heatmap', label: '2D Heatmap', group: '2d-stat', description: 'Color-coded z(x, y) matrix' },
  { id: 'surface3d', label: '3D Surface', group: '3d', description: 'Interactive 3D z = f(x, y) mesh' },
  { id: 'scatter3d', label: '3D Scatter', group: '3d', description: 'Orbitable 3D (x, y, z) points' },
  { id: 'line3d', label: '3D Trajectory', group: '3d', description: '3D curve path across (x, y, z)' },
  { id: 'bar3d', label: '3D Bar Columns', group: '3d', description: '3D vertical columns on (x, y)' }
]

export interface OhlcCandle {
  label: string
  open: number
  high: number
  low: number
  close: number
}

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
  xValuesText?: string
  zValuesText?: string
  color: string
  sliceColors?: string[]
}

export interface GraphPlotSpec {
  title: string
  mode: GraphPlotMode
  chartType?: GraphChartType
  xMin: number
  xMax: number
  yMin: number
  yMax: number
  zMin?: number
  zMax?: number
  xLabel: string
  yLabel: string
  zLabel?: string
  axisStyle: GraphAxisStyle
  axisColor?: string
  gridColor?: string
  backgroundColor?: string
  textColor?: string
  showGrid: boolean
  showLegend: boolean
  legendPosition?: GraphLegendPosition
  autoScale?: boolean
  bins?: number
  showKde?: boolean
  showTrendline?: boolean
  donut?: boolean
  expr3d?: string
  zMatrix?: number[][]
  ohlcData?: OhlcCandle[]
  bullColor?: string
  bearColor?: string
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
  '#0891B2',
  '#EC4899',
  '#6366F1'
]

export const GRAPH_COLOR_PALETTES: Array<{ id: string; name: string; colors: string[] }> = [
  {
    id: 'plotly',
    name: 'Plotly Vivid',
    colors: ['#636EFA', '#EF553B', '#00CC96', '#AB63FA', '#FFA15A', '#19D3F3', '#FF6692']
  },
  {
    id: 'geogebra',
    name: 'GeoGebra Classic',
    colors: ['#1565C0', '#2E7D32', '#C62828', '#6A1B9A', '#EF6C00', '#00838F']
  },
  {
    id: 'viridis',
    name: 'Viridis Science',
    colors: ['#440154', '#3B528B', '#21918C', '#5EC962', '#FDE725']
  },
  {
    id: 'financial',
    name: 'Market Desk',
    colors: ['#10B981', '#EF4444', '#0EA5E9', '#F59E0B', '#64748B']
  },
  {
    id: 'sunset',
    name: 'Warm Sunset',
    colors: ['#F43F5E', '#FB923C', '#FACC15', '#A855F7', '#EC4899']
  }
]

export function resolveGraphChartType(spec: GraphPlotSpec): GraphChartType {
  if (spec.chartType) return spec.chartType
  if (spec.mode === '3d') return 'surface3d'
  if (spec.mode === 'function') return 'function'
  return spec.dataKind || 'line'
}

export function is3DGraphChartType(ct: GraphChartType): boolean {
  return ct === 'surface3d' || ct === 'scatter3d' || ct === 'line3d' || ct === 'bar3d'
}

export const GRAPH_PRESETS: GraphPreset[] = [
  {
    id: 'sine-cosine',
    name: 'Sin & Cos',
    description: 'GeoGebra 4-quadrant curves',
    spec: {
      title: 'Sinusoidal PE Spectrum',
      mode: 'function',
      chartType: 'function',
      xMin: -6.3,
      xMax: 6.3,
      yMin: -1.4,
      yMax: 1.4,
      xLabel: 'x (rad)',
      yLabel: 'f(x)',
      axisStyle: 'origin',
      showGrid: true,
      showLegend: true,
      legendPosition: 'bottom',
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
    id: 'stock-candlestick',
    name: 'Stock OHLC',
    description: 'Candlestick market price action',
    spec: {
      title: 'NVDA Daily Price Action',
      mode: 'data',
      chartType: 'candlestick',
      xMin: 0,
      xMax: 8,
      yMin: 110,
      yMax: 145,
      xLabel: 'Session',
      yLabel: 'Price ($)',
      axisStyle: 'frame',
      showGrid: true,
      showLegend: true,
      legendPosition: 'bottom',
      bullColor: '#10B981',
      bearColor: '#EF4444',
      ohlcData: [
        { label: 'Mon', open: 118, high: 124, low: 116, close: 123 },
        { label: 'Tue', open: 123, high: 127, low: 120, close: 121 },
        { label: 'Wed', open: 121, high: 129, low: 119, close: 128 },
        { label: 'Thu', open: 128, high: 134, low: 126, close: 133 },
        { label: 'Fri', open: 133, high: 136, low: 129, close: 130 },
        { label: 'Mon2', open: 130, high: 139, low: 129, close: 138 },
        { label: 'Tue2', open: 138, high: 142, low: 135, close: 141 }
      ],
      functions: [],
      dataKind: 'line',
      categoriesText: 'Mon, Tue, Wed, Thu, Fri, Mon2, Tue2',
      dataSeries: [{ id: 'd1', label: 'Close', valuesText: '123, 121, 128, 133, 130, 138, 141', color: '#10B981' }]
    }
  },
  {
    id: 'histogram-dist',
    name: 'Histogram',
    description: 'Binned distribution + KDE curve',
    spec: {
      title: 'Sample Distribution + KDE',
      mode: 'data',
      chartType: 'histogram',
      xMin: 0,
      xMax: 100,
      yMin: 0,
      yMax: 10,
      xLabel: 'Value',
      yLabel: 'Count',
      axisStyle: 'frame',
      showGrid: true,
      showLegend: true,
      legendPosition: 'bottom',
      bins: 8,
      showKde: true,
      functions: [],
      dataKind: 'bar',
      categoriesText: '',
      dataSeries: [
        {
          id: 'd1',
          label: 'Latency (ms)',
          valuesText: '14, 18, 21, 22, 24, 25, 27, 28, 29, 31, 32, 33, 35, 36, 38, 40, 42, 43, 47, 51, 54, 59, 64, 71',
          color: '#636EFA'
        }
      ]
    }
  },
  {
    id: 'bar-benchmark',
    name: 'Bar Chart',
    description: 'Grouped category bars',
    spec: {
      title: 'Model Throughput Comparison',
      mode: 'data',
      chartType: 'bar',
      xMin: 0,
      xMax: 4,
      yMin: 0,
      yMax: 100,
      xLabel: 'Model',
      yLabel: 'Score (%)',
      axisStyle: 'frame',
      showGrid: true,
      showLegend: true,
      legendPosition: 'bottom',
      functions: [],
      dataKind: 'bar',
      categoriesText: 'Baseline, Attn, MoE, Ours',
      dataSeries: [
        { id: 'd1', label: 'Accuracy', valuesText: '64, 78, 84, 92', color: '#10B981' },
        { id: 'd2', label: 'Speedup', valuesText: '50, 62, 81, 88', color: '#2563EB' }
      ]
    }
  },
  {
    id: 'pie-share',
    name: 'Pie / Donut',
    description: 'Proportional wedge chart',
    spec: {
      title: 'Compute Budget Breakdown',
      mode: 'data',
      chartType: 'pie',
      xMin: 0,
      xMax: 5,
      yMin: 0,
      yMax: 100,
      xLabel: '',
      yLabel: '',
      axisStyle: 'none',
      showGrid: false,
      showLegend: true,
      legendPosition: 'right',
      donut: true,
      functions: [],
      dataKind: 'bar',
      categoriesText: 'Attention, FFN, Embeddings, LayerNorm, I/O',
      dataSeries: [
        {
          id: 'd1',
          label: 'Share (%)',
          valuesText: '38, 34, 14, 6, 8',
          color: '#636EFA',
          sliceColors: ['#636EFA', '#00CC96', '#AB63FA', '#FFA15A', '#EF553B']
        }
      ]
    }
  },
  {
    id: 'scatter-trend',
    name: 'Scatter + Fit',
    description: '2D scatter points & linear regression',
    spec: {
      title: 'Scaling Law Scatter',
      mode: 'data',
      chartType: 'scatter',
      xMin: 0,
      xMax: 10,
      yMin: 0,
      yMax: 10,
      xLabel: 'Compute (log FLOPs)',
      yLabel: 'Eval Score',
      axisStyle: 'frame',
      showGrid: true,
      showLegend: true,
      showTrendline: true,
      functions: [],
      dataKind: 'scatter',
      categoriesText: '',
      dataSeries: [
        {
          id: 'd1',
          label: 'Runs',
          xValuesText: '1, 1.8, 2.5, 3.2, 4.1, 5.0, 5.8, 6.7, 7.4, 8.5, 9.2',
          valuesText: '18, 26, 31, 42, 46, 55, 61, 69, 73, 84, 91',
          color: '#2563EB'
        },
        {
          id: 'd2',
          label: 'Tuned',
          xValuesText: '1.5, 2.8, 4.4, 6.0, 7.8, 9.0',
          valuesText: '28, 41, 56, 70, 82, 95',
          color: '#EF4444'
        }
      ]
    }
  },
  {
    id: 'violin-dist',
    name: 'Violin Plot',
    description: 'Density violin + quartile box',
    spec: {
      title: 'Latency Distributions by Engine',
      mode: 'data',
      chartType: 'violin',
      xMin: 0,
      xMax: 3,
      yMin: 0,
      yMax: 100,
      xLabel: 'Engine',
      yLabel: 'Latency (ms)',
      axisStyle: 'frame',
      showGrid: true,
      showLegend: true,
      functions: [],
      dataKind: 'line',
      categoriesText: 'PyTorch, TensorRT, WebGPU',
      dataSeries: [
        {
          id: 'd1',
          label: 'PyTorch',
          valuesText: '44, 48, 52, 54, 55, 58, 60, 62, 66, 72, 78',
          color: '#EF553B'
        },
        {
          id: 'd2',
          label: 'TensorRT',
          valuesText: '18, 21, 22, 24, 25, 27, 28, 30, 34, 38',
          color: '#00CC96'
        },
        {
          id: 'd3',
          label: 'WebGPU',
          valuesText: '26, 31, 34, 36, 39, 41, 43, 47, 52',
          color: '#636EFA'
        }
      ]
    }
  },
  {
    id: 'surface-3d',
    name: '3D Surface',
    description: 'Interactive 3D z = f(x, y)',
    spec: {
      title: '3D Wave Interference Surface',
      mode: '3d',
      chartType: 'surface3d',
      xMin: -3.2,
      xMax: 3.2,
      yMin: -3.2,
      yMax: 3.2,
      zMin: -1.5,
      zMax: 1.5,
      xLabel: 'x',
      yLabel: 'y',
      zLabel: 'z = sin(x)*cos(y)',
      axisStyle: 'box',
      showGrid: true,
      showLegend: true,
      expr3d: 'sin(x)*cos(y)*0.9',
      functions: [],
      dataKind: 'line',
      categoriesText: '',
      dataSeries: []
    }
  },
  {
    id: 'scatter-3d',
    name: '3D Helix',
    description: 'Orbitable 3D (x, y, z) trajectory',
    spec: {
      title: '3D Lorenz / Helical Trajectory',
      mode: '3d',
      chartType: 'line3d',
      xMin: -3,
      xMax: 3,
      yMin: -3,
      yMax: 3,
      zMin: -2,
      zMax: 4,
      xLabel: 'x',
      yLabel: 'y',
      zLabel: 'z',
      axisStyle: 'box',
      showGrid: true,
      showLegend: true,
      functions: [],
      dataKind: 'line',
      categoriesText: '',
      dataSeries: [
        {
          id: 'd1',
          label: 'Trajectory (x, y, z)',
          xValuesText: '1.5, 1.2, 0.5, -0.4, -1.1, -1.5, -1.3, -0.6, 0.3, 1.1, 1.5, 1.2, 0.4, -0.5, -1.2',
          valuesText: '0, 0.9, 1.4, 1.4, 0.9, 0.1, -0.8, -1.4, -1.5, -1.0, -0.1, 0.8, 1.4, 1.4, 0.9',
          zValuesText: '-1.2, -0.9, -0.6, -0.3, 0, 0.3, 0.6, 0.9, 1.2, 1.5, 1.8, 2.1, 2.4, 2.7, 3.0',
          color: '#2563EB'
        }
      ]
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
    return []
  }

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
        (prev.val === 'x' || prev.val === 'y' || prev.val === 'pi' || prev.val === 'PI' || prev.val === 'e') &&
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

export function evaluateMathExpr(rawExpr: string, xVal: number, yVal = 0): number {
  const cleaned = rawExpr.replace(/^\s*[yz]\s*=\s*/i, '').trim()
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
      if (lower === 'y') return yVal
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

export function formatTickNumber(n: number): string {
  if (!Number.isFinite(n)) return ''
  if (Math.abs(n) < 1e-9) return '0'
  if (Math.abs(n) >= 10000 || (Math.abs(n) > 0 && Math.abs(n) < 0.001)) {
    return n.toExponential(1)
  }
  const rounded = Math.round(n * 100) / 100
  if (Math.abs(rounded - Math.round(rounded)) < 1e-6) return String(Math.round(rounded))
  return String(rounded).replace(/(\.\d*?[1-9])0+$/, '$1')
}

export function parseNumberList(raw: string): number[] {
  return (raw || '')
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n))
}

export function parseLabelList(raw: string): string[] {
  return (raw || '')
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

function quantileSorted(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0
  if (sorted.length === 1) return sorted[0]
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  const t = pos - lo
  return sorted[lo] * (1 - t) + sorted[hi] * t
}

function computeKdeCurve(
  values: number[],
  evalPoints: number[]
): { densities: number[]; bandwidth: number } {
  const n = values.length
  if (n === 0) return { densities: evalPoints.map(() => 0), bandwidth: 1 }
  const mean = values.reduce((a, b) => a + b, 0) / n
  const variance = values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / Math.max(1, n)
  const std = Math.sqrt(variance)
  const minV = Math.min(...values)
  const maxV = Math.max(...values)
  const span = Math.max(1e-4, maxV - minV)
  // Silverman's rule of thumb with floor
  const bw = Math.max(span * 0.08, (std > 1e-6 ? 1.06 * std * Math.pow(n, -0.2) : span * 0.2))
  const norm = 1 / (n * bw * Math.sqrt(2 * Math.PI))
  const densities = evalPoints.map((x) => {
    let sum = 0
    for (let i = 0; i < n; i++) {
      const z = (x - values[i]) / bw
      sum += Math.exp(-0.5 * z * z)
    }
    return sum * norm
  })
  return { densities, bandwidth: bw }
}

function heatColormap(t: number): { fill: string; isDark: boolean } {
  const c = Math.max(0, Math.min(1, t))
  // Viridis-inspired 4-stop gradient: #440154 -> #31688E -> #35B779 -> #FDE725
  let r: number
  let g: number
  let b: number
  if (c < 0.33) {
    const u = c / 0.33
    r = Math.round(68 + (49 - 68) * u)
    g = Math.round(1 + (104 - 1) * u)
    b = Math.round(84 + (142 - 84) * u)
  } else if (c < 0.67) {
    const u = (c - 0.33) / 0.34
    r = Math.round(49 + (53 - 49) * u)
    g = Math.round(104 + (183 - 104) * u)
    b = Math.round(142 + (121 - 142) * u)
  } else {
    const u = (c - 0.67) / 0.33
    r = Math.round(53 + (253 - 53) * u)
    g = Math.round(183 + (231 - 183) * u)
    b = Math.round(121 + (37 - 121) * u)
  }
  const lum = 0.299 * r + 0.587 * g + 0.114 * b
  return { fill: `rgb(${r},${g},${b})`, isDark: lum < 145 }
}

export function synthesizeOhlcFromValues(
  values: number[],
  labels: string[]
): OhlcCandle[] {
  if (values.length === 0) return []
  return values.map((closeVal, idx) => {
    const prev = idx > 0 ? values[idx - 1] : closeVal * 0.992
    const open = Number(prev.toFixed(3))
    const close = Number(closeVal.toFixed(3))
    const bodySpan = Math.abs(close - open)
    const wickPad = Math.max(bodySpan * 0.45, Math.abs(close) * 0.008, 0.25)
    const high = Number((Math.max(open, close) + wickPad).toFixed(3))
    const low = Number((Math.min(open, close) - wickPad * 0.9).toFixed(3))
    return {
      label: labels[idx] ?? `T${idx + 1}`,
      open,
      high,
      low,
      close
    }
  })
}

export interface PreviewGraphPath {
  d: string
  color: string
  dashed?: boolean
  strokeWidth?: number
  fill?: string
  fillOpacity?: number
}

export interface PreviewGraphBar {
  x: number
  y: number
  w: number
  h: number
  color: string
  strokeColor?: string
  opacity?: number
  label?: string
}

export interface PreviewGraphWick {
  x1: number
  y1: number
  x2: number
  y2: number
  color: string
  strokeWidth?: number
}

export interface PreviewGraphSlice {
  d: string
  labelX: number
  labelY: number
  pctLabel: string
  name: string
  value: number
  color: string
}

export interface PreviewGraphCell {
  x: number
  y: number
  w: number
  h: number
  fill: string
  textColor: string
  valueLabel: string
}

export interface PreviewGraphHoverPoint {
  cx: number
  cy: number
  title: string
  lines: string[]
  color: string
}

export interface GraphPreviewModel {
  chartType: GraphChartType
  is3D: boolean
  xMin: number
  xMax: number
  yMin: number
  yMax: number
  xAxisY: number
  yAxisX: number
  gridLinesX: number[]
  gridLinesY: number[]
  paths: PreviewGraphPath[]
  bars: PreviewGraphBar[]
  wicks: PreviewGraphWick[]
  slices: PreviewGraphSlice[]
  cells: PreviewGraphCell[]
  dots: Array<{ cx: number; cy: number; r?: number; color: string }>
  xTicks: Array<{ pos: number; label: string }>
  yTicks: Array<{ pos: number; label: string }>
  legend: Array<{ label: string; color: string; dashed?: boolean }>
  hoverPoints: PreviewGraphHoverPoint[]
  viewW: number
  viewH: number
  plotX: number
  plotY: number
  plotW: number
  plotH: number
}

export function buildGraphPreviewModel(
  spec: GraphPlotSpec,
  viewW = 380,
  viewH = 240
): GraphPreviewModel {
  const chartType = resolveGraphChartType(spec)
  const is3D = is3DGraphChartType(chartType)

  const legendPos = spec.legendPosition ?? 'bottom'
  const reserveRightLegend = spec.showLegend && legendPos === 'right' ? 92 : 0
  const reserveTopLegend = spec.showLegend && legendPos === 'top' ? 18 : 0
  const reserveBottomLegend = spec.showLegend && legendPos === 'bottom' ? 20 : 0

  const plotX = 46
  const plotY = (spec.title.trim() ? 24 : 12) + reserveTopLegend
  const plotW = Math.max(80, viewW - plotX - 16 - reserveRightLegend)
  const plotH = Math.max(60, viewH - plotY - 26 - reserveBottomLegend)

  let xMin = Number.isFinite(spec.xMin) ? spec.xMin : -5
  let xMax = Number.isFinite(spec.xMax) ? spec.xMax : 5
  if (xMax <= xMin) xMax = xMin + 1

  let yMin = Number.isFinite(spec.yMin) ? spec.yMin : -2
  let yMax = Number.isFinite(spec.yMax) ? spec.yMax : 2
  if (yMax <= yMin) yMax = yMin + 1

  const categories = parseLabelList(spec.categoriesText)
  const parsedSeries = spec.dataSeries.map((ds) => ({
    ...ds,
    vals: parseNumberList(ds.valuesText),
    xs: ds.xValuesText ? parseNumberList(ds.xValuesText) : []
  }))

  const paths: PreviewGraphPath[] = []
  const bars: PreviewGraphBar[] = []
  const wicks: PreviewGraphWick[] = []
  const slices: PreviewGraphSlice[] = []
  const cells: PreviewGraphCell[] = []
  const dots: GraphPreviewModel['dots'] = []
  const legend: GraphPreviewModel['legend'] = []
  const hoverPoints: PreviewGraphHoverPoint[] = []
  const gridLinesX: number[] = []
  const gridLinesY: number[] = []
  const xTicks: Array<{ pos: number; label: string }> = []
  const yTicks: Array<{ pos: number; label: string }> = []

  const buildEmpty = (): GraphPreviewModel => ({
    chartType,
    is3D,
    xMin,
    xMax,
    yMin,
    yMax,
    xAxisY: plotY + plotH,
    yAxisX: plotX,
    gridLinesX,
    gridLinesY,
    paths,
    bars,
    wicks,
    slices,
    cells,
    dots,
    xTicks,
    yTicks,
    legend,
    hoverPoints,
    viewW,
    viewH,
    plotX,
    plotY,
    plotW,
    plotH
  })

  if (is3D) {
    return buildEmpty()
  }

  // Detect numeric X if categories are numeric OR series have explicit xValuesText
  const numericCategories =
    categories.length >= 2 && categories.every((c) => Number.isFinite(Number(c)))
      ? categories.map((c) => Number(c))
      : null

  const getSeriesXY = (s: (typeof parsedSeries)[number]): Array<{ x: number; y: number; label: string }> => {
    const pts: Array<{ x: number; y: number; label: string }> = []
    for (let i = 0; i < s.vals.length; i++) {
      const y = s.vals[i]
      const x =
        s.xs.length === s.vals.length
          ? s.xs[i]
          : numericCategories && numericCategories.length === s.vals.length
            ? numericCategories[i]
            : i
      const label =
        s.xs.length === s.vals.length
          ? formatTickNumber(s.xs[i])
          : categories[i] ?? String(i + 1)
      pts.push({ x, y, label })
    }
    return pts
  }

  // Pie / Donut Chart
  if (chartType === 'pie') {
    const firstSeries = parsedSeries[0]
    const vals = firstSeries?.vals ?? []
    const posVals = vals.map((v) => Math.max(0, v))
    const total = posVals.reduce((a, b) => a + b, 0)
    if (total > 0) {
      const cx = plotX + plotW / 2
      const cy = plotY + plotH / 2
      const outerR = Math.max(24, Math.min(plotW, plotH) * 0.44)
      const innerR = spec.donut ? outerR * 0.52 : 0
      const palette = firstSeries?.sliceColors?.length
        ? firstSeries.sliceColors
        : GRAPH_SERIES_COLORS
      let startAngle = -Math.PI / 2

      posVals.forEach((v, idx) => {
        const frac = v / total
        const sweep = frac * Math.PI * 2
        const endAngle = startAngle + sweep
        const color = palette[idx % palette.length]
        const name = categories[idx] || `Slice ${idx + 1}`
        legend.push({ label: `${name} (${Math.round(frac * 100)}%)`, color })

        const x0 = cx + Math.cos(startAngle) * outerR
        const y0 = cy + Math.sin(startAngle) * outerR
        const x1 = cx + Math.cos(endAngle) * outerR
        const y1 = cy + Math.sin(endAngle) * outerR
        const largeArc = sweep > Math.PI ? 1 : 0

        let d: string
        if (posVals.length === 1) {
          d = `M ${cx} ${cy - outerR} A ${outerR} ${outerR} 0 1 1 ${cx - 0.01} ${cy - outerR} Z`
        } else if (innerR > 0) {
          const ix1 = cx + Math.cos(endAngle) * innerR
          const iy1 = cy + Math.sin(endAngle) * innerR
          const ix0 = cx + Math.cos(startAngle) * innerR
          const iy0 = cy + Math.sin(startAngle) * innerR
          d = `M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${outerR} ${outerR} 0 ${largeArc} 1 ${x1.toFixed(1)} ${y1.toFixed(1)} L ${ix1.toFixed(1)} ${iy1.toFixed(1)} A ${innerR} ${innerR} 0 ${largeArc} 0 ${ix0.toFixed(1)} ${iy0.toFixed(1)} Z`
        } else {
          d = `M ${cx.toFixed(1)} ${cy.toFixed(1)} L ${x0.toFixed(1)} ${y0.toFixed(1)} A ${outerR} ${outerR} 0 ${largeArc} 1 ${x1.toFixed(1)} ${y1.toFixed(1)} Z`
        }

        const mid = startAngle + sweep / 2
        const labelR = innerR > 0 ? (outerR + innerR) / 2 : outerR * 0.65
        const lx = cx + Math.cos(mid) * labelR
        const ly = cy + Math.sin(mid) * labelR
        const pct = `${Math.round(frac * 100)}%`
        slices.push({
          d,
          labelX: lx,
          labelY: ly,
          pctLabel: frac >= 0.05 ? pct : '',
          name,
          value: v,
          color
        })
        hoverPoints.push({
          cx: lx,
          cy: ly,
          title: name,
          lines: [`Value: ${formatTickNumber(v)}`, `Share: ${(frac * 100).toFixed(1)}%`],
          color
        })
        startAngle = endAngle
      })
    }
    return buildEmpty()
  }

  // Heatmap
  if (chartType === 'heatmap') {
    const matrix: number[][] =
      spec.zMatrix && spec.zMatrix.length > 0
        ? spec.zMatrix
        : parsedSeries.map((s) => s.vals).filter((r) => r.length > 0)

    if (matrix.length > 0) {
      const nRows = matrix.length
      const nCols = Math.max(...matrix.map((r) => r.length))
      const flat = matrix.flat().filter(Number.isFinite)
      const minZ = flat.length > 0 ? Math.min(...flat) : 0
      const maxZ = flat.length > 0 ? Math.max(...flat) : 1
      const zSpan = Math.max(1e-6, maxZ - minZ)

      const cellW = plotW / Math.max(1, nCols)
      const cellH = plotH / Math.max(1, nRows)
      for (let c = 0; c < nCols; c++) {
        const px = plotX + (c + 0.5) * cellW
        xTicks.push({ pos: px, label: categories[c] ?? String(c + 1) })
      }
      for (let r = 0; r < nRows; r++) {
        const py = plotY + (r + 0.5) * cellH
        yTicks.push({ pos: py, label: parsedSeries[r]?.label ?? `R${r + 1}` })
        for (let c = 0; c < nCols; c++) {
          const val = matrix[r]?.[c] ?? 0
          const { fill, isDark } = heatColormap((val - minZ) / zSpan)
          const cx = plotX + c * cellW
          const cy = plotY + r * cellH
          cells.push({
            x: cx,
            y: cy,
            w: cellW,
            h: cellH,
            fill,
            textColor: isDark ? '#F8FAFC' : '#0F172A',
            valueLabel: formatTickNumber(val)
          })
          hoverPoints.push({
            cx: cx + cellW / 2,
            cy: cy + cellH / 2,
            title: `(${categories[c] ?? c + 1}, ${parsedSeries[r]?.label ?? `R${r + 1}`})`,
            lines: [`z = ${formatTickNumber(val)}`],
            color: fill
          })
        }
      }
    }
    return buildEmpty()
  }

  // Histogram
  if (chartType === 'histogram') {
    const allVals = parsedSeries.flatMap((s) => s.vals)
    const fallbackVals = numericCategories && allVals.length === 0 ? numericCategories : allVals
    if (fallbackVals.length > 0) {
      const dataMin = Math.min(...fallbackVals)
      const dataMax = Math.max(...fallbackVals)
      const pad = dataMax === dataMin ? 1 : 0
      xMin = dataMin - pad
      xMax = dataMax + pad
      const nBins = Math.max(3, Math.min(40, Math.round(spec.bins ?? 10)))
      const binWidth = (xMax - xMin) / nBins
      const counts = new Array<number>(nBins).fill(0)
      for (const v of fallbackVals) {
        const idx = Math.min(nBins - 1, Math.max(0, Math.floor((v - xMin) / binWidth)))
        counts[idx]++
      }
      const maxCount = Math.max(1, ...counts)
      yMin = 0
      yMax = Math.ceil(maxCount * 1.15)

      const mapX = (x: number): number => plotX + ((x - xMin) / (xMax - xMin)) * plotW
      const mapY = (y: number): number => plotY + plotH - ((y - yMin) / (yMax - yMin)) * plotH

      for (let i = 0; i <= 4; i++) {
        const xv = xMin + ((xMax - xMin) * i) / 4
        const px = mapX(xv)
        gridLinesX.push(px)
        xTicks.push({ pos: px, label: formatTickNumber(xv) })
        const yv = yMin + ((yMax - yMin) * i) / 4
        const py = mapY(yv)
        gridLinesY.push(py)
        yTicks.push({ pos: py, label: formatTickNumber(yv) })
      }

      const barColor = parsedSeries[0]?.color || GRAPH_SERIES_COLORS[0]
      legend.push({ label: parsedSeries[0]?.label || 'Histogram', color: barColor })
      const zeroY = mapY(0)

      for (let i = 0; i < nBins; i++) {
        const bx0 = xMin + i * binWidth
        const bx1 = bx0 + binWidth
        const px0 = mapX(bx0) + 1
        const px1 = mapX(bx1) - 1
        const py = mapY(counts[i])
        const bw = Math.max(3, px1 - px0)
        bars.push({
          x: px0,
          y: py,
          w: bw,
          h: Math.max(0, zeroY - py),
          color: barColor,
          opacity: 0.82
        })
        hoverPoints.push({
          cx: px0 + bw / 2,
          cy: py,
          title: `Bin [${formatTickNumber(bx0)}, ${formatTickNumber(bx1)})`,
          lines: [`Count: ${counts[i]}`],
          color: barColor
        })
      }

      if (spec.showKde) {
        const samples = 64
        const evalXs = Array.from({ length: samples + 1 }, (_, i) => xMin + ((xMax - xMin) * i) / samples)
        const { densities } = computeKdeCurve(fallbackVals, evalXs)
        const scale = fallbackVals.length * binWidth
        const kdePts: Array<[number, number]> = evalXs.map((xv, i) => [
          Math.round(mapX(xv) * 10) / 10,
          Math.round(mapY(Math.min(yMax, densities[i] * scale)) * 10) / 10
        ])
        paths.push({
          d: catmullRomSvgPath(kdePts),
          color: '#EF4444',
          strokeWidth: 2.2
        })
        legend.push({ label: 'KDE', color: '#EF4444' })
      }
      return { ...buildEmpty(), xAxisY: zeroY, yAxisX: xMin <= 0 && xMax >= 0 ? mapX(0) : plotX }
    }
    return buildEmpty()
  }

  // Candlestick Stock Chart
  if (chartType === 'candlestick') {
    const rawVals = parsedSeries[0]?.vals ?? []
    const candles: OhlcCandle[] =
      spec.ohlcData && spec.ohlcData.length > 0
        ? spec.ohlcData
        : synthesizeOhlcFromValues(rawVals, categories)
    if (candles.length > 0) {
      const minLow = Math.min(...candles.map((c) => c.low))
      const maxHigh = Math.max(...candles.map((c) => c.high))
      const pad = Math.max(0.5, (maxHigh - minLow) * 0.12)
      yMin = minLow - pad
      yMax = maxHigh + pad
      xMin = 0
      xMax = candles.length

      const mapX = (x: number): number => plotX + ((x - xMin) / (xMax - xMin)) * plotW
      const mapY = (y: number): number => plotY + plotH - ((y - yMin) / (yMax - yMin)) * plotH

      const tickStride = Math.max(1, Math.ceil(candles.length / 6))
      candles.forEach((c, idx) => {
        if (idx % tickStride === 0 || idx === candles.length - 1) {
          const px = mapX(idx + 0.5)
          gridLinesX.push(px)
          xTicks.push({ pos: px, label: c.label })
        }
      })
      for (let i = 0; i <= 4; i++) {
        const yv = yMin + ((yMax - yMin) * i) / 4
        const py = mapY(yv)
        gridLinesY.push(py)
        yTicks.push({ pos: py, label: formatTickNumber(yv) })
      }

      const bull = spec.bullColor || '#10B981'
      const bear = spec.bearColor || '#EF4444'
      legend.push({ label: 'Bullish', color: bull }, { label: 'Bearish', color: bear })

      const slotW = plotW / Math.max(1, candles.length)
      const bodyW = Math.max(4, Math.min(26, slotW * 0.58))
      candles.forEach((c, idx) => {
        const cx = mapX(idx + 0.5)
        const isBull = c.close >= c.open
        const col = isBull ? bull : bear
        const yHigh = mapY(c.high)
        const yLow = mapY(c.low)
        const yOpen = mapY(c.open)
        const yClose = mapY(c.close)

        wicks.push({ x1: cx, y1: yHigh, x2: cx, y2: yLow, color: col, strokeWidth: 1.8 })
        bars.push({
          x: cx - bodyW / 2,
          y: Math.min(yOpen, yClose),
          w: bodyW,
          h: Math.max(2, Math.abs(yClose - yOpen)),
          color: col,
          strokeColor: col,
          opacity: 0.92
        })
        hoverPoints.push({
          cx,
          cy: yClose,
          title: c.label,
          lines: [
            `O: ${formatTickNumber(c.open)}  H: ${formatTickNumber(c.high)}`,
            `L: ${formatTickNumber(c.low)}  C: ${formatTickNumber(c.close)}`
          ],
          color: col
        })
      })
      return { ...buildEmpty(), xAxisY: plotY + plotH, yAxisX: plotX }
    }
    return buildEmpty()
  }

  // Violin & Box Statistical Plots
  if (chartType === 'violin' || chartType === 'box') {
    const valid = parsedSeries.filter((s) => s.vals.length > 0)
    if (valid.length > 0) {
      const allVals = valid.flatMap((s) => s.vals)
      const minV = Math.min(...allVals)
      const maxV = Math.max(...allVals)
      const pad = Math.max(0.5, (maxV - minV) * 0.14)
      yMin = minV - pad
      yMax = maxV + pad
      xMin = 0
      xMax = valid.length

      const mapX = (x: number): number => plotX + ((x - xMin) / (xMax - xMin)) * plotW
      const mapY = (y: number): number => plotY + plotH - ((y - yMin) / (yMax - yMin)) * plotH

      for (let i = 0; i <= 4; i++) {
        const yv = yMin + ((yMax - yMin) * i) / 4
        const py = mapY(yv)
        gridLinesY.push(py)
        yTicks.push({ pos: py, label: formatTickNumber(yv) })
      }

      const slotW = plotW / valid.length
      valid.forEach((s, idx) => {
        const sorted = [...s.vals].sort((a, b) => a - b)
        const minS = sorted[0]
        const maxS = sorted[sorted.length - 1]
        const q1 = quantileSorted(sorted, 0.25)
        const med = quantileSorted(sorted, 0.5)
        const q3 = quantileSorted(sorted, 0.75)
        const iqr = q3 - q1
        const wLo = sorted.find((v) => v >= q1 - 1.5 * iqr) ?? minS
        const wHi = [...sorted].reverse().find((v) => v <= q3 + 1.5 * iqr) ?? maxS

        const cx = mapX(idx + 0.5)
        const label = s.label || categories[idx] || `Group ${idx + 1}`
        gridLinesX.push(cx)
        xTicks.push({ pos: cx, label })
        legend.push({ label, color: s.color })

        if (chartType === 'violin') {
          const steps = 28
          const loEval = minS - pad * 0.4
          const hiEval = maxS + pad * 0.4
          const evalYs = Array.from({ length: steps + 1 }, (_, k) => loEval + ((hiEval - loEval) * k) / steps)
          const { densities } = computeKdeCurve(sorted, evalYs)
          const maxD = Math.max(1e-6, ...densities)
          const halfW = Math.min(34, slotW * 0.36)
          const rightPts: Array<[number, number]> = evalYs.map((yv, k) => [
            Math.round((cx + (densities[k] / maxD) * halfW) * 10) / 10,
            Math.round(mapY(yv) * 10) / 10
          ])
          const leftPts: Array<[number, number]> = [...evalYs].reverse().map((yv, k) => [
            Math.round((cx - (densities[steps - k] / maxD) * halfW) * 10) / 10,
            Math.round(mapY(yv) * 10) / 10
          ])
          const polyPts = [...rightPts, ...leftPts]
          paths.push({
            d: `M ${polyPts[0][0]} ${polyPts[0][1]} ` + polyPts.slice(1).map((p) => `L ${p[0]} ${p[1]}`).join(' ') + ' Z',
            color: s.color,
            fill: s.color,
            fillOpacity: 0.28,
            strokeWidth: 2
          })
        }

        // Whiskers + IQR Box + Median Bar
        const boxW = chartType === 'violin' ? Math.max(6, Math.min(12, slotW * 0.12)) : Math.max(12, Math.min(36, slotW * 0.44))
        wicks.push({ x1: cx, y1: mapY(wHi), x2: cx, y2: mapY(wLo), color: '#334155', strokeWidth: 1.6 })
        if (chartType === 'box') {
          wicks.push({ x1: cx - boxW * 0.35, y1: mapY(wHi), x2: cx + boxW * 0.35, y2: mapY(wHi), color: '#334155', strokeWidth: 1.6 })
          wicks.push({ x1: cx - boxW * 0.35, y1: mapY(wLo), x2: cx + boxW * 0.35, y2: mapY(wLo), color: '#334155', strokeWidth: 1.6 })
        }
        const yQ3 = mapY(q3)
        const yQ1 = mapY(q1)
        bars.push({
          x: cx - boxW / 2,
          y: yQ3,
          w: boxW,
          h: Math.max(3, yQ1 - yQ3),
          color: chartType === 'violin' ? '#1E293B' : s.color,
          opacity: chartType === 'violin' ? 0.85 : 0.72
        })
        const yMed = mapY(med)
        wicks.push({
          x1: cx - boxW / 2,
          y1: yMed,
          x2: cx + boxW / 2,
          y2: yMed,
          color: chartType === 'violin' ? '#FFFFFF' : '#111111',
          strokeWidth: 2.2
        })
        // Outliers
        for (const v of sorted) {
          if (v < wLo || v > wHi) {
            dots.push({ cx, cy: mapY(v), r: 3.2, color: s.color })
          }
        }
        hoverPoints.push({
          cx,
          cy: yMed,
          title: label,
          lines: [
            `Median: ${formatTickNumber(med)}`,
            `Q1–Q3: ${formatTickNumber(q1)} – ${formatTickNumber(q3)}`,
            `Min–Max: ${formatTickNumber(minS)} – ${formatTickNumber(maxS)}`
          ],
          color: s.color
        })
      })
      return { ...buildEmpty(), xAxisY: plotY + plotH, yAxisX: plotX }
    }
    return buildEmpty()
  }

  // Remaining 2D Charts: function | line | smooth | area | bar | scatter
  const hasSymbolicFunctions =
    chartType === 'function' && spec.functions.some((f) => f.expr.trim().length > 0)
  const hasExplicitNumericX =
    !hasSymbolicFunctions &&
    chartType !== 'bar' &&
    (parsedSeries.some((s) => s.xs.length === s.vals.length && s.xs.length > 0) || numericCategories !== null)

  if (!hasSymbolicFunctions) {
    const allXY = parsedSeries.flatMap(getSeriesXY)
    if (allXY.length > 0) {
      if (spec.autoScale !== false) {
        const minV = Math.min(...allXY.map((p) => p.y))
        const maxV = Math.max(...allXY.map((p) => p.y))
        yMin = chartType === 'bar' || chartType === 'area' ? Math.min(0, minV) : minV >= 0 && minV < maxV * 0.2 ? 0 : minV - Math.max(0.2, (maxV - minV) * 0.08)
        yMax = maxV + Math.max(0.5, (maxV - yMin) * 0.14)
        if (yMax <= yMin) yMax = yMin + 1
      }
      if (hasExplicitNumericX) {
        const minXVal = Math.min(...allXY.map((p) => p.x))
        const maxXVal = Math.max(...allXY.map((p) => p.x))
        const xPad = maxXVal === minXVal ? 1 : (maxXVal - minXVal) * 0.04
        if (spec.autoScale !== false) {
          xMin = minXVal - xPad
          xMax = maxXVal + xPad
        }
      } else {
        const count = Math.max(2, categories.length, ...parsedSeries.map((s) => s.vals.length))
        xMin = 0
        xMax = chartType === 'bar' ? count : count - 1
      }
    }
  }

  const mapX = (x: number): number => plotX + ((x - xMin) / (xMax - xMin)) * plotW
  const mapY = (y: number): number => plotY + plotH - ((y - yMin) / (yMax - yMin)) * plotH

  const xAxisY =
    spec.axisStyle === 'origin' && yMin <= 0 && yMax >= 0 ? mapY(0) : plotY + plotH
  const yAxisX =
    spec.axisStyle === 'origin' && xMin <= 0 && xMax >= 0 ? mapX(0) : plotX

  if (hasSymbolicFunctions || hasExplicitNumericX) {
    const xSteps = 4
    for (let i = 0; i <= xSteps; i++) {
      const xv = xMin + ((xMax - xMin) * i) / xSteps
      const px = mapX(xv)
      gridLinesX.push(px)
      xTicks.push({ pos: px, label: formatTickNumber(xv) })
    }
  } else {
    const nCat = Math.max(1, categories.length, ...parsedSeries.map((s) => s.vals.length))
    const stride = Math.max(1, Math.ceil(nCat / 8))
    for (let i = 0; i < nCat; i += stride) {
      const pos = chartType === 'bar' ? mapX(i + 0.5) : mapX(i)
      gridLinesX.push(pos)
      xTicks.push({ pos, label: categories[i] ?? String(i + 1) })
    }
  }

  for (let i = 0; i <= 4; i++) {
    const yv = yMin + ((yMax - yMin) * i) / 4
    const py = mapY(yv)
    gridLinesY.push(py)
    yTicks.push({ pos: py, label: formatTickNumber(yv) })
  }

  if (hasSymbolicFunctions) {
    const samples = 200
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

      const segs: Array<Array<[number, number]>> = []
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
        const px = Math.round(mapX(xv) * 10) / 10
        const py = Math.round(mapY(clampedY) * 10) / 10
        curSeg.push([px, py])
        if (i % 8 === 0) {
          hoverPoints.push({
            cx: px,
            cy: py,
            title: fn.label || fn.expr,
            lines: [`x = ${formatTickNumber(xv)}`, `y = ${formatTickNumber(yv)}`],
            color: fn.color
          })
        }
      }
      if (curSeg.length >= 2) segs.push(curSeg)

      if (segs.length > 0) {
        const d = segs
          .map((seg) => `M ${seg[0][0]} ${seg[0][1]} ` + seg.slice(1).map((p) => `L ${p[0]} ${p[1]}`).join(' '))
          .join(' ')
        paths.push({ d, color: fn.color, dashed: fn.dashed, strokeWidth: 2.6 })
      }
    }
  } else {
    const nSer = Math.max(1, parsedSeries.length)
    parsedSeries.forEach((ds, sIdx) => {
      if (ds.vals.length === 0) return
      const ptsData = getSeriesXY(ds)
      legend.push({ label: ds.label || `Series ${sIdx + 1}`, color: ds.color })

      if (chartType === 'bar') {
        const groupW = plotW / Math.max(1, xMax)
        const slotW = groupW * 0.72
        const barW = Math.max(6, Math.min(48, (slotW - (nSer - 1) * 4) / nSer))
        const totalGroupBarW = barW * nSer + Math.max(0, nSer - 1) * 4
        const zeroY = mapY(Math.max(yMin, Math.min(yMax, 0)))

        ptsData.forEach((pt, idx) => {
          const cx = mapX(idx + 0.5) - totalGroupBarW / 2 + sIdx * (barW + 4)
          const vy = mapY(pt.y)
          const col =
            nSer === 1 && ds.sliceColors?.length
              ? ds.sliceColors[idx % ds.sliceColors.length]
              : ds.color
          bars.push({
            x: Math.round(cx * 10) / 10,
            y: Math.round(Math.min(zeroY, vy) * 10) / 10,
            w: Math.round(barW * 10) / 10,
            h: Math.max(2, Math.round(Math.abs(zeroY - vy) * 10) / 10),
            color: col
          })
          hoverPoints.push({
            cx: cx + barW / 2,
            cy: vy,
            title: `${ds.label} · ${pt.label}`,
            lines: [`Value: ${formatTickNumber(pt.y)}`],
            color: col
          })
        })
      } else {
        const pts: Array<[number, number]> = ptsData.map((p) => [
          Math.round(mapX(p.x) * 10) / 10,
          Math.round(mapY(p.y) * 10) / 10
        ])
        pts.forEach(([px, py], i) => {
          const showDot = chartType === 'scatter' || pts.length <= 28
          if (showDot) {
            dots.push({ cx: px, cy: py, r: chartType === 'scatter' ? 4.2 : 3, color: ds.color })
          }
          hoverPoints.push({
            cx: px,
            cy: py,
            title: ds.label || `Series ${sIdx + 1}`,
            lines: [`x: ${ptsData[i].label}`, `y: ${formatTickNumber(ptsData[i].y)}`],
            color: ds.color
          })
        })

        if (chartType === 'area' && pts.length >= 2) {
          const zeroY = mapY(Math.max(yMin, Math.min(yMax, 0)))
          const lineD = `M ${pts[0][0]} ${pts[0][1]} ` + pts.slice(1).map((p) => `L ${p[0]} ${p[1]}`).join(' ')
          const areaD = `${lineD} L ${pts[pts.length - 1][0]} ${zeroY} L ${pts[0][0]} ${zeroY} Z`
          paths.push({ d: areaD, color: 'transparent', fill: ds.color, fillOpacity: 0.22, strokeWidth: 0 })
          paths.push({ d: lineD, color: ds.color, strokeWidth: 2.5 })
        } else if (chartType === 'line' && pts.length >= 2) {
          paths.push({
            d: `M ${pts[0][0]} ${pts[0][1]} ` + pts.slice(1).map((p) => `L ${p[0]} ${p[1]}`).join(' '),
            color: ds.color,
            strokeWidth: 2.6
          })
        } else if ((chartType === 'smooth' || chartType === 'function') && pts.length >= 2) {
          paths.push({
            d: catmullRomSvgPath(pts),
            color: ds.color,
            strokeWidth: 2.6
          })
        }

        // Optional linear trendline on scatter / line
        if (spec.showTrendline && ptsData.length >= 2) {
          const n = ptsData.length
          const sx = ptsData.reduce((a, p) => a + p.x, 0)
          const sy = ptsData.reduce((a, p) => a + p.y, 0)
          const sxx = ptsData.reduce((a, p) => a + p.x * p.x, 0)
          const sxy = ptsData.reduce((a, p) => a + p.x * p.y, 0)
          const denom = n * sxx - sx * sx
          if (Math.abs(denom) > 1e-9) {
            const slope = (n * sxy - sx * sy) / denom
            const intercept = (sy - slope * sx) / n
            const yStart = Math.max(yMin, Math.min(yMax, slope * xMin + intercept))
            const yEnd = Math.max(yMin, Math.min(yMax, slope * xMax + intercept))
            paths.push({
              d: `M ${mapX(xMin).toFixed(1)} ${mapY(yStart).toFixed(1)} L ${mapX(xMax).toFixed(1)} ${mapY(yEnd).toFixed(1)}`,
              color: ds.color,
              dashed: true,
              strokeWidth: 1.8
            })
          }
        }
      }
    })
  }

  return {
    chartType,
    is3D,
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
    wicks,
    slices,
    cells,
    dots,
    xTicks,
    yTicks,
    legend,
    hoverPoints,
    viewW,
    viewH,
    plotX,
    plotY,
    plotW,
    plotH
  }
}

/* ---------------- Build Interactive 3D Scene from GraphPlotSpec ---------------- */

export function buildScene3DFromGraphSpec(spec: GraphPlotSpec): Scene3DSpec {
  const chartType = resolveGraphChartType(spec)
  const elements: Scene3DElement[] = []
  const baseColor = spec.dataSeries[0]?.color || '#2563EB'

  const seriesPoints = spec.dataSeries
    .map((ds) => {
      const xs = ds.xValuesText ? parseNumberList(ds.xValuesText) : []
      const ys = parseNumberList(ds.valuesText)
      const zs = ds.zValuesText ? parseNumberList(ds.zValuesText) : []
      return { ds, xs, ys, zs }
    })
    .filter((s) => s.ys.length > 0 || s.zs.length > 0)

  const norm = (val: number, min: number, max: number, span: number): number => {
    const d = max - min
    if (!Number.isFinite(d) || Math.abs(d) < 1e-9) return 0
    return ((val - min) / d - 0.5) * span
  }

  // Case A: Explicit zMatrix heightfield grid -> colored 3D mesh
  if (spec.zMatrix && spec.zMatrix.length >= 2) {
    const rows = spec.zMatrix.length
    const cols = Math.max(...spec.zMatrix.map((r) => r.length))
    if (cols >= 2) {
      const flat = spec.zMatrix.flat().filter(Number.isFinite)
      const zMin = flat.length > 0 ? Math.min(...flat) : -1
      const zMax = flat.length > 0 ? Math.max(...flat) : 1
      const verts: Vec3[] = []
      const faces: number[][] = []
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const zVal = spec.zMatrix[r]?.[c] ?? zMin
          verts.push([
            norm(c, 0, cols - 1, 4.4),
            norm(zVal, zMin, zMax, 2.4) + 0.5,
            norm(r, 0, rows - 1, 4.4)
          ])
        }
      }
      for (let r = 0; r < rows - 1; r++) {
        for (let c = 0; c < cols - 1; c++) {
          const a = r * cols + c
          const b = a + 1
          const d = (r + 1) * cols + c
          const e = d + 1
          faces.push([a, b, e, d])
        }
      }
      elements.push({
        id: 'matrix-surface',
        type: 'mesh',
        vertices: verts,
        faces,
        color: baseColor
      })
    }
  } else if (seriesPoints.length > 0) {
    // Case B: Scattered / Trajectory / Bars (x, y, z) triples from dataSeries
    const allTriples: Array<{ x: number; y: number; z: number; color: string; label: string }> = []
    seriesPoints.forEach((s, sIdx) => {
      const hasExplicitZ = s.zs.length > 0
      const len = hasExplicitZ
        ? Math.max(s.ys.length, s.zs.length)
        : Math.max(s.xs.length, s.ys.length)
      for (let i = 0; i < len; i++) {
        const x = s.xs.length > i ? s.xs[i] : i
        const y = hasExplicitZ ? (s.ys.length > i ? s.ys[i] : i) : sIdx
        const z = hasExplicitZ ? (s.zs.length > i ? s.zs[i] : 0) : (s.ys.length > i ? s.ys[i] : 0)
        allTriples.push({ x, y, z, color: s.ds.color || baseColor, label: s.ds.label })
      }
    })
    const xs = allTriples.map((p) => p.x)
    const ys = allTriples.map((p) => p.y)
    const zs = allTriples.map((p) => p.z)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    const minZ = Math.min(...zs)
    const maxZ = Math.max(...zs)

    const toScenePosRaw = (p: { x: number; y: number; z: number }): Vec3 => [
      norm(p.x, minX, maxX, 4.2),
      norm(p.z, minZ, maxZ, 2.4) + 0.55,
      norm(p.y, minY, maxY, 3.8)
    ]
    const rawScenePts = allTriples.map((p) => toScenePosRaw(p))
    const sceneXs = rawScenePts.map((pt) => pt[0])
    const sceneZs = rawScenePts.map((pt) => pt[2])
    const midSceneX = (Math.min(...sceneXs) + Math.max(...sceneXs)) / 2
    const midSceneZ = (Math.min(...sceneZs) + Math.max(...sceneZs)) / 2

    const toScenePos = (p: { x: number; y: number; z: number }): Vec3 => {
      const sp = toScenePosRaw(p)
      return [sp[0] - midSceneX, sp[1], sp[2] - midSceneZ]
    }

    if (chartType === 'surface3d' && allTriples.length >= 4) {
      // Inverse-distance weighted grid surface from scattered (x, y, z)
      const gN = 12
      const verts: Vec3[] = []
      const faces: number[][] = []
      const xSpan = Math.max(1e-4, maxX - minX)
      const ySpan = Math.max(1e-4, maxY - minY)
      for (let gy = 0; gy < gN; gy++) {
        for (let gx = 0; gx < gN; gx++) {
          const rx = minX + (xSpan * gx) / (gN - 1)
          const ry = minY + (ySpan * gy) / (gN - 1)
          let wSum = 0
          let zSum = 0
          for (const pt of allTriples) {
            const d2 = Math.pow((pt.x - rx) / xSpan, 2) + Math.pow((pt.y - ry) / ySpan, 2)
            const w = 1 / (0.015 + d2)
            wSum += w
            zSum += w * pt.z
          }
          const rz = wSum > 0 ? zSum / wSum : minZ
          verts.push([
            norm(gx, 0, gN - 1, 4.4),
            norm(rz, minZ, maxZ, 2.2) + 0.55,
            norm(gy, 0, gN - 1, 4.4)
          ])
        }
      }
      for (let r = 0; r < gN - 1; r++) {
        for (let c = 0; c < gN - 1; c++) {
          const a = r * gN + c
          faces.push([a, a + 1, a + gN + 1, a + gN])
        }
      }
      elements.push({ id: 'idw-surface', type: 'mesh', vertices: verts, faces, color: baseColor })
    } else if (chartType === 'bar3d') {
      allTriples.slice(0, 60).forEach((p, idx) => {
        const sp = toScenePos(p)
        const baseY = -0.65
        const h = Math.max(0.18, sp[1] - baseY)
        elements.push({
          id: `b3d-${idx}`,
          type: 'box',
          pos: [sp[0], baseY + h / 2, sp[2]],
          size: [0.28, h, 0.28],
          color: p.color
        })
      })
    } else if (chartType === 'line3d') {
      seriesPoints.forEach((s, sIdx) => {
        const hasExplicitZ = s.zs.length > 0
        const len = hasExplicitZ
          ? Math.max(s.ys.length, s.zs.length)
          : Math.max(s.xs.length, s.ys.length)
        const pts: Vec3[] = []
        for (let i = 0; i < len; i++) {
          pts.push(
            toScenePos({
              x: s.xs.length > i ? s.xs[i] : i,
              y: hasExplicitZ ? (s.ys.length > i ? s.ys[i] : i) : sIdx,
              z: hasExplicitZ ? (s.zs.length > i ? s.zs[i] : 0) : (s.ys.length > i ? s.ys[i] : 0)
            })
          )
        }
        if (pts.length >= 2) {
          elements.push({
            id: `l3d-${sIdx}`,
            type: 'curve3d',
            points: pts,
            color: s.ds.color || baseColor,
            anim: { pulseFlow: true }
          })
          elements.push({
            id: `l3d-start-${sIdx}`,
            type: 'sphere',
            pos: pts[0],
            radius: 0.11,
            color: '#10B981'
          })
          elements.push({
            id: `l3d-end-${sIdx}`,
            type: 'sphere',
            pos: pts[pts.length - 1],
            radius: 0.12,
            color: '#EF4444'
          })
        }
      })
    } else {
      // scatter3d
      allTriples.slice(0, 100).forEach((p, idx) => {
        const sp = toScenePos(p)
        elements.push({
          id: `s3-${idx}`,
          type: 'sphere',
          pos: sp,
          radius: 0.12,
          color: p.color
        })
        elements.push({
          id: `s3-drop-${idx}`,
          type: 'curve3d',
          points: [[sp[0], -0.65, sp[2]], sp],
          color: '#94A3B8'
        })
      })
    }
  } else {
    // Case C: Analytic 3D surface formula
    elements.push({
      id: 'fn-surface3d',
      type: 'surface3d',
      expr: spec.expr3d || spec.functions[0]?.expr || 'sin(x)*cos(y)*0.9',
      xRange: [spec.xMin || -3, spec.xMax || 3],
      zRange: [spec.yMin || -3, spec.yMax || 3],
      resolution: 18,
      color: spec.functions[0]?.color || baseColor
    })
  }

  return {
    title: spec.title || '3D Graph',
    preset: 'custom',
    immersed: false,
    showAxes: spec.axisStyle !== 'none',
    showGrid: spec.showGrid !== false,
    animate: true,
    camera: { yaw: 40, pitch: 26, zoom: 1 },
    elements
  }
}

/* Legacy compatibility wrapper (unified GraphNode now supersedes fragmented shapes) */
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
  const groupId = `graph-${Date.now().toString(36)}`
  return {
    shapes: [
      {
        id: `${groupId}-frame`,
        shape: 'rounded-rect',
        x: cardX,
        y: cardY,
        w: cardW,
        h: cardH,
        borderRadius: 14,
        color: opts.inkColor || '#111111',
        fillColor: spec.backgroundColor || '#FFFFFF',
        strokeWidth: 2,
        vectorGroupId: groupId,
        layerId: opts.layerId
      }
    ],
    texts: [],
    groupId,
    meta: { groupId, anchor: { x: cardX, y: cardY } },
    bounds: { x: cardX, y: cardY, width: cardW, height: cardH }
  }
}
