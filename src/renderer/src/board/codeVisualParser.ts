import { normalizeScene3DInput, type Scene3DSpec, type Vec3 } from '@shared/scene3dSchema'
import {
  buildScene3DFromGraphSpec,
  GRAPH_SERIES_COLORS,
  is3DGraphChartType,
  resolveGraphChartType,
  type GraphAxisStyle,
  type GraphChartType,
  type GraphLegendPosition,
  type GraphPlotSpec,
  type OhlcCandle
} from './graphPlotBuilder'
import type { CodeTabItem } from '../types/board'

export interface ParsedCodeVisuals {
  plot2d: GraphPlotSpec | null
  scene3d: Scene3DSpec | null
  hasExplicitChartType?: boolean
  detectedKind: 'plot2d' | 'scene3d' | 'numeric_table' | null
}

function encodeUtf8Base64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i])
  }
  if (typeof btoa === 'function') return btoa(bin)
  return Buffer.from(bytes).toString('base64')
}

/**
 * Wraps user Python code in a renderer-side AST runner so that:
 * - Upstream stdin JSON/hashmaps are pre-parsed into `INPUT` / `DATA` / `PREV` and matching variables,
 *   while `sys.stdin` is normalized to the clean JSON payload so manual `json.loads(sys.stdin.read())` also works.
 * - Functions (`def compute():` or `def transform(data):`) are invoked automatically ONLY if the user
 *   didn't already call them, preventing duplicate execution / multi-line stdout crashes.
 * - Simple top-level arrays (`x = [...]`, `y = [...]`) or returned/assigned dicts emit JSON to stdout cleanly.
 */
export function wrapCodeForAutoOutput(language: string, code: string): string {
  const lang = (language || '').trim().toLowerCase()
  if (lang !== 'python' && lang !== 'py' && lang !== 'python3') {
    return code
  }
  if (code.includes('__VGB_AUTO_RUNNER__')) {
    return code
  }
  const b64 = encodeUtf8Base64(code)
  return `# __VGB_AUTO_RUNNER__
import ast as _vgb_ast, base64 as _vgb_b64, io as _vgb_io, json as _vgb_json, sys as _vgb_sys

_VGB_PLOT_KEYS = {
    'x', 'y', 'z', 'open', 'high', 'low', 'close', 'values', 'data',
    'series', 'labels', 'categories', 'expr', 'expr3d', 'functions',
    'type', 'chartType', 'pie', 'bins', 'elements', 'points3d'
}

_VGB_TOP_ARRAY_KEYS = (
    'x', 'y', 'z', 'open', 'high', 'low', 'close',
    'values', 'data', 'series', 'labels', 'categories',
    'expr', 'expr3d', 'type', 'chartType', 'title', 'xLabel', 'yLabel'
)

def _vgb_to_jsonable(v, depth=0):
    if depth > 6:
        return str(v)
    if v is None or isinstance(v, (bool, int, float, str)):
        return v
    if isinstance(v, dict):
        return {str(k): _vgb_to_jsonable(val, depth + 1) for k, val in v.items()}
    if isinstance(v, (list, tuple, set)):
        return [_vgb_to_jsonable(x, depth + 1) for x in v]
    tolist = getattr(v, 'tolist', None)
    if callable(tolist):
        return _vgb_to_jsonable(tolist(), depth + 1)
    isoformat = getattr(v, 'isoformat', None)
    if callable(isoformat):
        return isoformat()
    try:
        return list(v)
    except Exception:
        return str(v)

def _vgb_is_plot_dict(obj):
    if not isinstance(obj, dict) or len(obj) == 0:
        return False
    keys = {str(k) for k in obj.keys()}
    if keys & _VGB_PLOT_KEYS:
        return True
    return all(isinstance(v, (int, float)) for v in obj.values())

def _vgb_parse_stdin(raw_in):
    stripped = (raw_in or '').strip()
    if not stripped:
        return None, None
    lines = [ln.strip() for ln in raw_in.splitlines() if ln.strip()]
    for ln in reversed(lines):
        try:
            parsed = _vgb_json.loads(ln)
            if isinstance(parsed, (dict, list)):
                return parsed, ln
        except Exception:
            pass
        try:
            lit = _vgb_ast.literal_eval(ln)
            if isinstance(lit, (dict, list)):
                j = _vgb_to_jsonable(lit)
                return j, _vgb_json.dumps(j)
        except Exception:
            pass
    try:
        parsed = _vgb_json.loads(stripped)
        if isinstance(parsed, (dict, list)):
            return parsed, stripped
    except Exception:
        pass
    try:
        lit = _vgb_ast.literal_eval(stripped)
        if isinstance(lit, (dict, list)):
            j = _vgb_to_jsonable(lit)
            return j, _vgb_json.dumps(j)
    except Exception:
        pass
    return None, None

def _vgb_main():
    raw_stdin = _vgb_sys.stdin.read() if _vgb_sys.stdin else ''
    _vgb_input, _vgb_clean_json = _vgb_parse_stdin(raw_stdin)
    _vgb_sys.stdin = _vgb_io.StringIO(_vgb_clean_json if _vgb_clean_json is not None else raw_stdin)

    src = _vgb_b64.b64decode("${b64}").decode("utf-8")
    try:
        tree = _vgb_ast.parse(src, filename="main.py")
    except SyntaxError as _syn_err:
        if "return" in str(_syn_err) and "outside function" in str(_syn_err):
            wrapped = "def __vgb_top__():\\n" + "\\n".join("    " + ln for ln in src.splitlines()) + "\\n"
            tree = _vgb_ast.parse(wrapped, filename="main.py")
        else:
            raise

    ns = {
        "__name__": "__main__",
        "__file__": "main.py",
        "INPUT": _vgb_input,
        "DATA": _vgb_input,
        "PREV": _vgb_input
    }
    if isinstance(_vgb_input, dict):
        for k, v in _vgb_input.items():
            if isinstance(k, str) and k.isidentifier() and k not in ns:
                ns[k] = v

    pre_snapshot = {k: ns.get(k) for k in _VGB_TOP_ARRAY_KEYS if k in ns}

    called_fns = set()
    for node in _vgb_ast.walk(tree):
        if isinstance(node, _vgb_ast.Call) and isinstance(node.func, _vgb_ast.Name):
            called_fns.add(node.func.id)

    fn_defs = []
    assign_names = []
    for stmt in tree.body:
        if isinstance(stmt, _vgb_ast.FunctionDef):
            arg_names = [a.arg for a in stmt.args.args]
            req_args = len(arg_names) - len(stmt.args.defaults)
            fn_defs.append((stmt.name, req_args, arg_names))
        elif isinstance(stmt, _vgb_ast.Assign):
            for t in stmt.targets:
                if isinstance(t, _vgb_ast.Name):
                    assign_names.append(t.id)

    last_val = None
    if tree.body and isinstance(tree.body[-1], _vgb_ast.Expr):
        if len(tree.body) > 1:
            exec(compile(_vgb_ast.Module(body=tree.body[:-1], type_ignores=[]), "main.py", "exec"), ns)
        expr_ast = _vgb_ast.Expression(body=tree.body[-1].value)
        _vgb_ast.fix_missing_locations(expr_ast)
        last_val = eval(compile(expr_ast, "main.py", "eval"), ns)
    else:
        exec(compile(tree, "main.py", "exec"), ns)

    if not _vgb_is_plot_dict(last_val):
        for var_name in reversed(assign_names):
            cand = ns.get(var_name)
            if _vgb_is_plot_dict(cand):
                last_val = cand
                break

    if not _vgb_is_plot_dict(last_val):
        for fn_name, req_args, arg_names in reversed(fn_defs):
            if fn_name in called_fns:
                continue
            fn = ns.get(fn_name)
            if not callable(fn):
                continue
            cand = None
            if req_args <= 0:
                cand = fn()
            elif req_args == 1 and _vgb_input is not None:
                cand = fn(_vgb_input)
            elif isinstance(_vgb_input, dict) and all(a in _vgb_input for a in arg_names[:req_args]):
                cand = fn(**{k: _vgb_input[k] for k in arg_names if k in _vgb_input})
            if _vgb_is_plot_dict(cand):
                last_val = cand
                break

    if not _vgb_is_plot_dict(last_val):
        assembled = {}
        changed_any = False
        for k in _VGB_TOP_ARRAY_KEYS:
            if k in ns and not callable(ns[k]):
                if k not in pre_snapshot or ns[k] is not pre_snapshot[k] or ns[k] != pre_snapshot[k]:
                    changed_any = True
                assembled[k] = ns[k]
        if changed_any and _vgb_is_plot_dict(assembled):
            last_val = assembled

    if _vgb_is_plot_dict(last_val):
        print(_vgb_json.dumps(_vgb_to_jsonable(last_val)), flush=True)

_vgb_main()
`
}

const VALID_CHART_TYPES = new Set<GraphChartType>([
  'function',
  'line',
  'smooth',
  'area',
  'bar',
  'histogram',
  'scatter',
  'pie',
  'violin',
  'box',
  'candlestick',
  'heatmap',
  'surface3d',
  'scatter3d',
  'line3d',
  'bar3d'
])

/**
 * Normalizes Python dict repr (`{'x': [1, 2], 'ok': True, 'none': None}`)
 * and Node console object literals (`{ x: [1, 2] }`) into strict JSON.
 */
function coerceLiteralObjectToJson(rawBlock: string): string {
  let out = ''
  let i = 0
  let inDouble = false
  let inSingle = false
  const n = rawBlock.length

  while (i < n) {
    const ch = rawBlock[i]
    if (inDouble) {
      out += ch
      if (ch === '\\' && i + 1 < n) {
        out += rawBlock[++i]
      } else if (ch === '"') {
        inDouble = false
      }
      i++
      continue
    }
    if (inSingle) {
      if (ch === '\\' && i + 1 < n) {
        const nxt = rawBlock[++i]
        if (nxt === "'") out += "'"
        else if (nxt === '"') out += '\\"'
        else out += '\\' + nxt
      } else if (ch === "'") {
        inSingle = false
        out += '"'
      } else if (ch === '"') {
        out += '\\"'
      } else {
        out += ch
      }
      i++
      continue
    }

    if (ch === '"') {
      inDouble = true
      out += ch
      i++
      continue
    }
    if (ch === "'") {
      inSingle = true
      out += '"'
      i++
      continue
    }

    // Outside strings: check keywords & numpy/tuple helpers
    const rest = rawBlock.slice(i)
    const pyBoolMatch = rest.match(/^(True|False|None|NaN|Infinity|-Infinity|undefined)\b/)
    if (pyBoolMatch) {
      const kw = pyBoolMatch[1]
      out += kw === 'True' ? 'true' : kw === 'False' ? 'false' : 'null'
      i += kw.length
      continue
    }

    // np.array([...]) or array([...])
    const arrMatch = rest.match(/^(?:np\.)?array\s*\(/)
    if (arrMatch) {
      i += arrMatch[0].length
      // Skip until matching ')'
      let depth = 1
      let inner = ''
      while (i < n && depth > 0) {
        const c = rawBlock[i++]
        if (c === '(') depth++
        else if (c === ')') {
          depth--
          if (depth === 0) break
        }
        inner += c
      }
      out += coerceLiteralObjectToJson(inner)
      continue
    }

    // Unquoted object key `{ foo: ... }` or `, foo: ...`
    if (/[A-Za-z_]/.test(ch)) {
      const idMatch = rest.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:/)
      if (idMatch) {
        out += `"${idMatch[1]}":`
        i += idMatch[0].length
        continue
      }
    }

    // Python tuple syntax `(1, 2, 3)` when after `:`, `[`, `,`, `=`
    if (ch === '(') {
      const prevNonSpace = out.trimEnd().slice(-1)
      if (prevNonSpace === ':' || prevNonSpace === '[' || prevNonSpace === ',') {
        let depth = 1
        let j = i + 1
        let inner = ''
        while (j < n && depth > 0) {
          const c = rawBlock[j++]
          if (c === '(') depth++
          else if (c === ')') {
            depth--
            if (depth === 0) break
          }
          inner += c
        }
        out += `[${coerceLiteralObjectToJson(inner)}]`
        i = j
        continue
      }
    }

    out += ch
    i++
  }

  // Strip trailing commas before `}` or `]` outside strings
  return out.replace(/,\s*([}\]])/g, '$1')
}

function tryParseObjectCandidate(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    try {
      const normalized = coerceLiteralObjectToJson(text)
      const parsed = JSON.parse(normalized)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      return null
    }
  }
  return null
}

function tryExtractHashmapObjects(raw: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = []
  const trimmed = raw.trim()
  if (!trimmed) return found

  const direct = tryParseObjectCandidate(trimmed)
  if (direct) {
    found.push(direct)
    return found
  }

  // Scan top-level balanced `{ ... }` blocks across single or multiple lines (skip braces inside quotes)
  let inSingle = false
  let inDouble = false
  let depth = 0
  let startIdx = -1

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]
    if (inDouble) {
      if (ch === '\\') i++
      else if (ch === '"') inDouble = false
      continue
    }
    if (inSingle) {
      if (ch === '\\') i++
      else if (ch === "'") inSingle = false
      continue
    }
    if (ch === '"') {
      inDouble = true
      continue
    }
    if (ch === "'") {
      inSingle = true
      continue
    }
    if (ch === '{') {
      if (depth === 0) startIdx = i
      depth++
    } else if (ch === '}' && depth > 0) {
      depth--
      if (depth === 0 && startIdx >= 0) {
        const block = trimmed.slice(startIdx, i + 1)
        const obj = tryParseObjectCandidate(block)
        if (obj) found.push(obj)
        startIdx = -1
      }
    }
  }

  // Prefer most recent printed/returned hashmap first
  return found.reverse()
}

function toFiniteNumberArray(raw: unknown): number[] {
  if (!Array.isArray(raw)) return []
  return raw.map((v) => Number(v)).filter((n) => Number.isFinite(n))
}

function toStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.map((v) => String(v))
}

function parseChartTypeOverride(obj: Record<string, unknown>): GraphChartType | undefined {
  const raw =
    typeof obj.chartType === 'string'
      ? obj.chartType
      : typeof obj.type === 'string' && obj.type !== 'plot2d' && obj.type !== 'plot3d' && obj.type !== 'graph'
        ? obj.type
        : typeof obj.dataKind === 'string'
          ? obj.dataKind
          : undefined
  if (!raw) return undefined
  const clean = raw.trim().toLowerCase().replace(/[\s_-]+/g, '')
  const map: Record<string, GraphChartType> = {
    function: 'function',
    fn: 'function',
    line: 'line',
    smooth: 'smooth',
    spline: 'smooth',
    area: 'area',
    bar: 'bar',
    bars: 'bar',
    hist: 'histogram',
    histogram: 'histogram',
    scatter: 'scatter',
    points: 'scatter',
    pie: 'pie',
    donut: 'pie',
    violin: 'violin',
    box: 'box',
    boxplot: 'box',
    candlestick: 'candlestick',
    candle: 'candlestick',
    ohlc: 'candlestick',
    stock: 'candlestick',
    heatmap: 'heatmap',
    surface: 'surface3d',
    surface3d: 'surface3d',
    scatter3d: 'scatter3d',
    line3d: 'line3d',
    curve3d: 'line3d',
    bar3d: 'bar3d'
  }
  const resolved = map[clean]
  return resolved && VALID_CHART_TYPES.has(resolved) ? resolved : undefined
}

function applyCommonStylingOverrides(
  spec: GraphPlotSpec,
  obj: Record<string, unknown>
): GraphPlotSpec {
  const axisStyle =
    obj.axisStyle === 'origin' ||
    obj.axisStyle === 'frame' ||
    obj.axisStyle === 'box' ||
    obj.axisStyle === 'none'
      ? (obj.axisStyle as GraphAxisStyle)
      : spec.axisStyle

  const legendPos =
    obj.legendPosition === 'bottom' ||
    obj.legendPosition === 'top' ||
    obj.legendPosition === 'right' ||
    obj.legendPosition === 'inside'
      ? (obj.legendPosition as GraphLegendPosition)
      : spec.legendPosition

  const colorsArr = Array.isArray(obj.colors) ? obj.colors.map(String) : null

  return {
    ...spec,
    xLabel: typeof obj.xLabel === 'string' ? obj.xLabel : spec.xLabel,
    yLabel: typeof obj.yLabel === 'string' ? obj.yLabel : spec.yLabel,
    zLabel: typeof obj.zLabel === 'string' ? obj.zLabel : spec.zLabel,
    axisStyle,
    axisColor: typeof obj.axisColor === 'string' ? obj.axisColor : spec.axisColor,
    gridColor: typeof obj.gridColor === 'string' ? obj.gridColor : spec.gridColor,
    backgroundColor: typeof obj.backgroundColor === 'string' ? obj.backgroundColor : spec.backgroundColor,
    textColor: typeof obj.textColor === 'string' ? obj.textColor : spec.textColor,
    showGrid: obj.showGrid === false ? false : spec.showGrid,
    showLegend: obj.showLegend === false ? false : spec.showLegend,
    legendPosition: legendPos,
    bins: typeof obj.bins === 'number' ? obj.bins : spec.bins,
    showKde: typeof obj.showKde === 'boolean' ? obj.showKde : spec.showKde,
    showTrendline: typeof obj.showTrendline === 'boolean' ? obj.showTrendline : spec.showTrendline,
    donut: typeof obj.donut === 'boolean' ? obj.donut : spec.donut,
    bullColor: typeof obj.bullColor === 'string' ? obj.bullColor : spec.bullColor,
    bearColor: typeof obj.bearColor === 'string' ? obj.bearColor : spec.bearColor,
    xMin: typeof obj.xMin === 'number' ? obj.xMin : spec.xMin,
    xMax: typeof obj.xMax === 'number' ? obj.xMax : spec.xMax,
    yMin: typeof obj.yMin === 'number' ? obj.yMin : spec.yMin,
    yMax: typeof obj.yMax === 'number' ? obj.yMax : spec.yMax,
    dataSeries: colorsArr
      ? spec.dataSeries.map((d, i) => ({
          ...d,
          color: colorsArr[i % colorsArr.length],
          sliceColors: colorsArr
        }))
      : spec.dataSeries
  }
}

/**
 * Converts ANY hashmap shape returned/printed by Python or JS into a GraphPlotSpec:
 * - `{ expr: 'x^2 + 1' }` or `{ y: 'sin(2*x)' }`
 * - `{ expr3d: 'sin(x)*cos(y)' }` or `{ z: [[...], [...]] }`
 * - `{ x: [...], y: [...], z: [...] }` (3D scatter / line / bar / surface)
 * - `{ x: [...], open: [...], high: [...], low: [...], close: [...] }` (Stock candlesticks)
 * - `{ x: [...], y: [...] }` or `{ x: [...], s1: [...], s2: [...] }`
 * - `{ x: [...] }` / `{ values: [...] }` / `{ data: [...] }` (1D for bar / histogram / pie / violin / box)
 * - Scalar map `{ "Mon": 120, "Tue": 135, ... }`
 */
function normalizeHashmapToGraphSpec(
  obj: Record<string, unknown>,
  fallbackTitle?: string
): { spec: GraphPlotSpec; hasExplicitType: boolean } | null {
  const title =
    typeof obj.title === 'string' && obj.title.trim() ? obj.title : fallbackTitle || 'Code Graph Output'
  const explicitType = parseChartTypeOverride(obj)
  const singleColor = typeof obj.color === 'string' ? obj.color : GRAPH_SERIES_COLORS[0]

  // 1. 3D formula `{ expr3d: 'sin(x)*cos(y)' }` or `{ z: 'sin(x)*cos(y)' }`
  if (typeof obj.expr3d === 'string' || typeof obj.z === 'string') {
    const formula = String(obj.expr3d || obj.z)
    const spec: GraphPlotSpec = {
      title,
      mode: '3d',
      chartType: explicitType ?? 'surface3d',
      xMin: typeof obj.xMin === 'number' ? obj.xMin : -3.2,
      xMax: typeof obj.xMax === 'number' ? obj.xMax : 3.2,
      yMin: typeof obj.yMin === 'number' ? obj.yMin : -3.2,
      yMax: typeof obj.yMax === 'number' ? obj.yMax : 3.2,
      xLabel: 'x',
      yLabel: 'y',
      zLabel: `z = ${formula}`,
      axisStyle: 'box',
      showGrid: true,
      showLegend: true,
      expr3d: formula,
      functions: [],
      dataKind: 'line',
      categoriesText: '',
      dataSeries: []
    }
    return { spec: applyCommonStylingOverrides(spec, obj), hasExplicitType: Boolean(explicitType) || true }
  }

  // 2. 2D z-matrix `{ z: [[...], [...]] }` -> Heatmap or 3D Surface
  if (Array.isArray(obj.z) && Array.isArray(obj.z[0])) {
    const zMatrix = (obj.z as unknown[]).map((row) => toFiniteNumberArray(row)).filter((r) => r.length > 0)
    if (zMatrix.length > 0) {
      const ct = explicitType ?? 'surface3d'
      const xLabels = Array.isArray(obj.x) ? toStringArray(obj.x) : []
      const yLabels = Array.isArray(obj.y) ? toStringArray(obj.y) : []
      const spec: GraphPlotSpec = {
        title,
        mode: ct === 'heatmap' ? 'data' : '3d',
        chartType: ct,
        xMin: 0,
        xMax: zMatrix[0].length,
        yMin: 0,
        yMax: zMatrix.length,
        xLabel: 'x',
        yLabel: 'y',
        zLabel: 'z',
        axisStyle: 'box',
        showGrid: true,
        showLegend: true,
        zMatrix,
        functions: [],
        dataKind: 'line',
        categoriesText: xLabels.join(', '),
        dataSeries: yLabels.map((lbl, i) => ({
          id: `row-${i}`,
          label: lbl,
          valuesText: (zMatrix[i] ?? []).join(', '),
          color: GRAPH_SERIES_COLORS[i % GRAPH_SERIES_COLORS.length]
        }))
      }
      return { spec: applyCommonStylingOverrides(spec, obj), hasExplicitType: Boolean(explicitType) || true }
    }
  }

  // 3. Function equation `{ expr: 'x^2 - 3*x' }` or `{ y: 'sin(2*x)' }` or `{ functions: [...] }`
  if (typeof obj.expr === 'string' || typeof obj.y === 'string' || Array.isArray(obj.functions)) {
    const rawFns = Array.isArray(obj.functions)
      ? obj.functions
      : [{ expr: String(obj.expr || obj.y), label: String(obj.expr || obj.y), color: singleColor }]
    const spec: GraphPlotSpec = {
      title,
      mode: 'function',
      chartType: explicitType ?? 'function',
      xMin: typeof obj.xMin === 'number' ? obj.xMin : -6,
      xMax: typeof obj.xMax === 'number' ? obj.xMax : 6,
      yMin: typeof obj.yMin === 'number' ? obj.yMin : -4,
      yMax: typeof obj.yMax === 'number' ? obj.yMax : 4,
      xLabel: 'x',
      yLabel: 'f(x)',
      axisStyle: 'origin',
      showGrid: true,
      showLegend: true,
      functions: rawFns.map((f, i) => {
        const fo = (f && typeof f === 'object' ? f : {}) as Record<string, unknown>
        const expr = typeof fo.expr === 'string' ? fo.expr : 'x'
        return {
          id: typeof fo.id === 'string' ? fo.id : `fn-${i + 1}`,
          label: typeof fo.label === 'string' ? fo.label : expr,
          expr,
          color: typeof fo.color === 'string' ? fo.color : GRAPH_SERIES_COLORS[i % GRAPH_SERIES_COLORS.length],
          dashed: Boolean(fo.dashed)
        }
      }),
      dataKind: 'line',
      categoriesText: '',
      dataSeries: []
    }
    return { spec: applyCommonStylingOverrides(spec, obj), hasExplicitType: true }
  }

  // 4. Stock OHLC `{ open, high, low, close }` (+ optional x / dates)
  if (
    Array.isArray(obj.open) &&
    Array.isArray(obj.high) &&
    Array.isArray(obj.low) &&
    Array.isArray(obj.close)
  ) {
    const o = toFiniteNumberArray(obj.open)
    const h = toFiniteNumberArray(obj.high)
    const l = toFiniteNumberArray(obj.low)
    const c = toFiniteNumberArray(obj.close)
    const len = Math.min(o.length, h.length, l.length, c.length)
    if (len > 0) {
      const labels = Array.isArray(obj.x)
        ? toStringArray(obj.x)
        : Array.isArray(obj.labels)
          ? toStringArray(obj.labels)
          : []
      const ohlcData: OhlcCandle[] = Array.from({ length: len }, (_, i) => ({
        label: labels[i] ?? `T${i + 1}`,
        open: o[i],
        high: h[i],
        low: l[i],
        close: c[i]
      }))
      const spec: GraphPlotSpec = {
        title,
        mode: 'data',
        chartType: explicitType ?? 'candlestick',
        xMin: 0,
        xMax: len,
        yMin: Math.min(...l),
        yMax: Math.max(...h),
        xLabel: 'Session',
        yLabel: 'Price',
        axisStyle: 'frame',
        showGrid: true,
        showLegend: true,
        bullColor: typeof obj.bullColor === 'string' ? obj.bullColor : '#10B981',
        bearColor: typeof obj.bearColor === 'string' ? obj.bearColor : '#EF4444',
        ohlcData,
        functions: [],
        dataKind: 'line',
        categoriesText: ohlcData.map((d) => d.label).join(', '),
        dataSeries: [
          {
            id: 'close',
            label: 'Close',
            valuesText: c.slice(0, len).join(', '),
            color: '#10B981'
          }
        ]
      }
      return { spec: applyCommonStylingOverrides(spec, obj), hasExplicitType: Boolean(explicitType) || true }
    }
  }

  // 5. 3D coordinate hashmap `{ x, y, z }` (1D arrays)
  if (Array.isArray(obj.z)) {
    const zs = toFiniteNumberArray(obj.z)
    if (zs.length > 0) {
      const xs = Array.isArray(obj.x) ? toFiniteNumberArray(obj.x) : zs.map((_, i) => i)
      const ys = Array.isArray(obj.y) ? toFiniteNumberArray(obj.y) : zs.map(() => 0)
      const ct = explicitType && is3DGraphChartType(explicitType) ? explicitType : 'scatter3d'
      const spec: GraphPlotSpec = {
        title,
        mode: '3d',
        chartType: ct,
        xMin: xs.length > 0 ? Math.min(...xs) : 0,
        xMax: xs.length > 0 ? Math.max(...xs) : 1,
        yMin: ys.length > 0 ? Math.min(...ys) : 0,
        yMax: ys.length > 0 ? Math.max(...ys) : 1,
        zMin: Math.min(...zs),
        zMax: Math.max(...zs),
        xLabel: 'x',
        yLabel: 'y',
        zLabel: 'z',
        axisStyle: 'box',
        showGrid: true,
        showLegend: true,
        functions: [],
        dataKind: 'scatter',
        categoriesText: '',
        dataSeries: [
          {
            id: 's3d',
            label: title,
            xValuesText: xs.join(', '),
            valuesText: ys.join(', '),
            zValuesText: zs.join(', '),
            color: singleColor
          }
        ]
      }
      return { spec: applyCommonStylingOverrides(spec, obj), hasExplicitType: true }
    }
  }

  // 6. Multi-series or `{ x, y }` hashmap (including `{ x: [...], raw: [...], smooth: [...] }` or `{ y: { s1: [...], s2: [...] } }`)
  const rawX = Array.isArray(obj.x)
    ? obj.x
    : Array.isArray(obj.labels)
      ? obj.labels
      : Array.isArray(obj.categories)
        ? obj.categories
        : null
  const xNums = rawX ? toFiniteNumberArray(rawX) : []
  const isNumericX = Boolean(rawX && rawX.length > 0 && xNums.length === rawX.length)
  const xLabels = rawX ? rawX.map(String) : []

  const seriesList: GraphPlotSpec['dataSeries'] = []

  if (Array.isArray(obj.dataSeries)) {
    obj.dataSeries.forEach((rawD, idx) => {
      if (!rawD || typeof rawD !== 'object') return
      const doj = rawD as Record<string, unknown>
      seriesList.push({
        id: typeof doj.id === 'string' ? doj.id : `ds-${idx + 1}`,
        label: typeof doj.label === 'string' ? doj.label : `Series ${idx + 1}`,
        valuesText: typeof doj.valuesText === 'string' ? doj.valuesText : '',
        xValuesText: typeof doj.xValuesText === 'string' ? doj.xValuesText : undefined,
        zValuesText: typeof doj.zValuesText === 'string' ? doj.zValuesText : undefined,
        color: typeof doj.color === 'string' ? doj.color : GRAPH_SERIES_COLORS[idx % GRAPH_SERIES_COLORS.length]
      })
    })
  } else if (Array.isArray(obj.series)) {
    obj.series.forEach((rawS, idx) => {
      if (!rawS || typeof rawS !== 'object') return
      const sObj = rawS as Record<string, unknown>
      const vals = Array.isArray(sObj.values)
        ? toFiniteNumberArray(sObj.values)
        : Array.isArray(sObj.y)
          ? toFiniteNumberArray(sObj.y)
          : []
      const sx = Array.isArray(sObj.x) ? toFiniteNumberArray(sObj.x) : xNums
      if (vals.length > 0) {
        seriesList.push({
          id: `s-${idx + 1}`,
          label: typeof sObj.label === 'string' ? sObj.label : `Series ${idx + 1}`,
          valuesText: vals.join(', '),
          ...(sx.length === vals.length ? { xValuesText: sx.join(', ') } : {}),
          color: typeof sObj.color === 'string' ? sObj.color : GRAPH_SERIES_COLORS[idx % GRAPH_SERIES_COLORS.length]
        })
      }
    })
  } else if (Array.isArray(obj.y)) {
    const ys = toFiniteNumberArray(obj.y)
    if (ys.length > 0) {
      seriesList.push({
        id: 'y',
        label: typeof obj.yLabel === 'string' ? obj.yLabel : 'y',
        valuesText: ys.join(', '),
        ...(isNumericX && xNums.length === ys.length ? { xValuesText: xNums.join(', ') } : {}),
        color: singleColor
      })
    }
  } else if (obj.y && typeof obj.y === 'object' && !Array.isArray(obj.y)) {
    Object.entries(obj.y as Record<string, unknown>).forEach(([k, v], idx) => {
      const vals = toFiniteNumberArray(v)
      if (vals.length > 0) {
        seriesList.push({
          id: `y-${idx}`,
          label: k,
          valuesText: vals.join(', '),
          ...(isNumericX && xNums.length === vals.length ? { xValuesText: xNums.join(', ') } : {}),
          color: GRAPH_SERIES_COLORS[idx % GRAPH_SERIES_COLORS.length]
        })
      }
    })
  } else {
    // Check extra array keys alongside `x` (e.g. `{'x': t, 'raw': [...], 'smooth': [...]}`) or 1D `{ 'values': [...] }` / `{ 'data': [...] }`
    const skip = new Set(['x', 'labels', 'categories', 'colors', 'color', 'type', 'chartType', 'title'])
    let idx = 0
    for (const [k, v] of Object.entries(obj)) {
      if (skip.has(k) || !Array.isArray(v)) continue
      const vals = toFiniteNumberArray(v)
      if (vals.length > 0) {
        seriesList.push({
          id: `k-${idx}`,
          label: k === 'values' || k === 'data' ? 'Value' : k,
          valuesText: vals.join(', '),
          ...(isNumericX && xNums.length === vals.length ? { xValuesText: xNums.join(', ') } : {}),
          color: idx === 0 && typeof obj.color === 'string' ? obj.color : GRAPH_SERIES_COLORS[idx % GRAPH_SERIES_COLORS.length]
        })
        idx++
      }
    }
  }

  // 7. Only `{ x: [...] }` (no y/series keys) -> treat `x` as 1D data values (great for Histogram / Bar / Pie / Violin / Box!)
  let is1DOnly = false
  if (seriesList.length === 0 && rawX) {
    if (isNumericX && xNums.length > 0) {
      is1DOnly = true
      seriesList.push({
        id: 'x-only',
        label: typeof obj.xLabel === 'string' ? obj.xLabel : 'x',
        valuesText: xNums.join(', '),
        color: singleColor,
        sliceColors: GRAPH_SERIES_COLORS
      })
    }
  }

  // 8. Flat scalar hashmap like `{"Python": 45, "TS": 30, "Rust": 25}` -> categories + values
  if (seriesList.length === 0) {
    const scalarEntries = Object.entries(obj).filter(
      ([k, v]) => typeof v === 'number' && Number.isFinite(v) && k !== 'bins' && k !== 'xMin' && k !== 'xMax'
    )
    if (scalarEntries.length >= 2) {
      const keys = scalarEntries.map(([k]) => k)
      const vals = scalarEntries.map(([, v]) => v as number)
      const ct = explicitType ?? 'bar'
      const spec: GraphPlotSpec = {
        title,
        mode: 'data',
        chartType: ct,
        xMin: 0,
        xMax: vals.length,
        yMin: Math.min(0, ...vals),
        yMax: Math.max(...vals),
        xLabel: '',
        yLabel: 'Value',
        axisStyle: ct === 'pie' ? 'none' : 'frame',
        showGrid: ct !== 'pie',
        showLegend: true,
        functions: [],
        dataKind: ct === 'pie' ? 'bar' : 'bar',
        categoriesText: keys.join(', '),
        dataSeries: [
          {
            id: 'map-vals',
            label: title,
            valuesText: vals.join(', '),
            color: singleColor,
            sliceColors: GRAPH_SERIES_COLORS
          }
        ]
      }
      return { spec: applyCommonStylingOverrides(spec, obj), hasExplicitType: Boolean(explicitType) }
    }
  }

  if (seriesList.length === 0) return null

  const ct: GraphChartType = explicitType ?? (is1DOnly ? 'bar' : 'line')
  const allYVals = seriesList.flatMap((s) =>
    s.valuesText.split(',').map((n) => Number(n.trim())).filter(Number.isFinite)
  )
  const spec: GraphPlotSpec = {
    title,
    mode: is3DGraphChartType(ct) ? '3d' : 'data',
    chartType: ct,
    xMin: isNumericX && !is1DOnly ? Math.min(...xNums) : 0,
    xMax: isNumericX && !is1DOnly ? Math.max(...xNums) : Math.max(1, (is1DOnly ? seriesList[0].valuesText.split(',').length : xLabels.length || allYVals.length) - 1),
    yMin: allYVals.length > 0 ? Math.min(...allYVals) : 0,
    yMax: allYVals.length > 0 ? Math.max(...allYVals) : 10,
    xLabel: typeof obj.xLabel === 'string' ? obj.xLabel : 'x',
    yLabel: typeof obj.yLabel === 'string' ? obj.yLabel : 'y',
    axisStyle: ct === 'pie' ? 'none' : 'frame',
    showGrid: ct !== 'pie',
    showLegend: true,
    functions: [],
    dataKind: ct === 'bar' || ct === 'scatter' || ct === 'smooth' ? ct : 'line',
    categoriesText: is1DOnly
      ? (Array.isArray(obj.labels) ? toStringArray(obj.labels) : Array.isArray(obj.categories) ? toStringArray(obj.categories) : []).join(', ')
      : xLabels.join(', '),
    dataSeries: seriesList
  }

  return {
    spec: applyCommonStylingOverrides(spec, obj),
    hasExplicitType: Boolean(explicitType)
  }
}

function parseNumericRowsFromStdout(stdout: string): {
  headers: string[] | null
  rows: number[][]
} {
  const lines = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('//'))

  let headers: string[] | null = null
  const rows: number[][] = []

  for (const line of lines) {
    const parts = line.includes(',')
      ? line.split(',').map((s) => s.trim())
      : line.split(/\s+/).map((s) => s.trim())
    if (parts.length === 0) continue

    const nums = parts.map((p) => Number(p))
    if (nums.every((n) => Number.isFinite(n))) {
      rows.push(nums)
    } else if (rows.length === 0 && !headers && parts.length >= 2) {
      headers = parts
    }
  }
  return { headers, rows }
}

/**
 * Inspects a code card's stdout (JSON, Python dict, console.log object, or CSV/TSV)
 * to extract 2D/3D GraphPlotSpec and/or Scene3DSpec.
 */
export function parseCodeOutputToVisuals(stdout: string, title?: string): ParsedCodeVisuals {
  if (!stdout || !stdout.trim()) {
    return { plot2d: null, scene3d: null, detectedKind: null }
  }

  let plot2d: GraphPlotSpec | null = null
  let hasExplicitChartType = false
  let scene3d: Scene3DSpec | null = null

  // 1. Check JSON / Python dict / JS object hashmaps in stdout
  const hashmaps = tryExtractHashmapObjects(stdout)
  for (const obj of hashmaps) {
    if (
      !scene3d &&
      (obj.type === 'scene3d' ||
        obj.kind === 'scene3d' ||
        typeof obj.preset === 'string' ||
        Array.isArray(obj.elements))
    ) {
      const normalized = normalizeScene3DInput(obj)
      if (normalized.elements.length > 0) {
        scene3d = normalized
      }
    }
    if (!plot2d) {
      const res = normalizeHashmapToGraphSpec(obj, title)
      if (res) {
        plot2d = res.spec
        hasExplicitChartType = res.hasExplicitType
      }
    }
    if (!scene3d && Array.isArray(obj.points3d) && obj.points3d.length >= 2) {
      const pts: Vec3[] = obj.points3d
        .filter((p): p is number[] => Array.isArray(p) && p.length >= 3)
        .map((p) => [Number(p[0]) || 0, Number(p[1]) || 0, Number(p[2]) || 0])
      if (pts.length >= 2) {
        scene3d = {
          title: typeof obj.title === 'string' ? obj.title : title || '3D Trajectory Output',
          preset: 'custom',
          immersed: true,
          showAxes: true,
          showGrid: true,
          animate: true,
          camera: { yaw: 38, pitch: 24, zoom: 1 },
          elements: [
            { id: 'traj-curve', type: 'curve3d', points: pts, color: '#2563EB', anim: { pulseFlow: true } },
            { id: 'traj-start', type: 'sphere', pos: pts[0], radius: 0.14, color: '#10B981' },
            { id: 'traj-end', type: 'sphere', pos: pts[pts.length - 1], radius: 0.16, color: '#EF4444' }
          ]
        }
      }
    }
  }

  if (plot2d && !scene3d && is3DGraphChartType(resolveGraphChartType(plot2d))) {
    scene3d = buildScene3DFromGraphSpec(plot2d)
  }

  if (plot2d && scene3d) {
    const is3dPlot = is3DGraphChartType(resolveGraphChartType(plot2d))
    return {
      plot2d,
      scene3d,
      hasExplicitChartType,
      detectedKind: is3dPlot ? 'scene3d' : 'plot2d'
    }
  }
  if (scene3d) {
    return { plot2d: null, scene3d, hasExplicitChartType, detectedKind: 'scene3d' }
  }
  if (plot2d) {
    return { plot2d, scene3d: null, hasExplicitChartType, detectedKind: 'plot2d' }
  }

  // 2. Numeric table / CSV / TSV fallback
  const { headers, rows } = parseNumericRowsFromStdout(stdout)
  if (rows.length >= 2) {
    const cols = rows[0].length
    const limited = rows.slice(0, 150)

    if (cols === 1) {
      const yVals = limited.map((r) => r[0])
      plot2d = {
        title: title ? `${title} · Series` : 'Code Numeric Output',
        mode: 'data',
        chartType: 'line',
        xMin: 0,
        xMax: yVals.length - 1,
        yMin: Math.min(...yVals),
        yMax: Math.max(...yVals),
        xLabel: 'Index',
        yLabel: headers?.[0] || 'Value',
        axisStyle: 'frame',
        showGrid: true,
        showLegend: true,
        functions: [],
        dataKind: 'line',
        categoriesText: limited.map((_, idx) => String(idx)).join(', '),
        dataSeries: [
          {
            id: 'col-0',
            label: headers?.[0] || 'Value',
            valuesText: yVals.map((v) => Number(v.toFixed(4))).join(', '),
            color: GRAPH_SERIES_COLORS[0]
          }
        ]
      }
    } else if (cols === 2) {
      const xVals = limited.map((r) => r[0])
      const yVals = limited.map((r) => r[1])
      plot2d = {
        title: title ? `${title} · 2D Plot` : 'Code 2D Output Plot',
        mode: 'data',
        chartType: 'line',
        xMin: Math.min(...xVals),
        xMax: Math.max(...xVals),
        yMin: Math.min(...yVals),
        yMax: Math.max(...yVals),
        xLabel: headers?.[0] || 'x',
        yLabel: headers?.[1] || 'y',
        axisStyle: 'frame',
        showGrid: true,
        showLegend: true,
        functions: [],
        dataKind: 'line',
        categoriesText: xVals.map((v) => String(Number(v.toFixed(3)))).join(', '),
        dataSeries: [
          {
            id: 'col-1',
            label: headers?.[1] || 'y',
            xValuesText: xVals.map((v) => Number(v.toFixed(4))).join(', '),
            valuesText: yVals.map((v) => Number(v.toFixed(4))).join(', '),
            color: GRAPH_SERIES_COLORS[0]
          }
        ]
      }
    } else if (cols >= 3) {
      const xs = limited.map((r) => r[0])
      const ys = limited.map((r) => r[1])
      const zs = limited.map((r) => r[2])
      plot2d = {
        title: title ? `${title} · 3D Plot` : 'Code 3D Output',
        mode: '3d',
        chartType: 'line3d',
        xMin: Math.min(...xs),
        xMax: Math.max(...xs),
        yMin: Math.min(...ys),
        yMax: Math.max(...ys),
        zMin: Math.min(...zs),
        zMax: Math.max(...zs),
        xLabel: headers?.[0] || 'x',
        yLabel: headers?.[1] || 'y',
        zLabel: headers?.[2] || 'z',
        axisStyle: 'box',
        showGrid: true,
        showLegend: true,
        functions: [],
        dataKind: 'line',
        categoriesText: '',
        dataSeries: [
          {
            id: 'xyz',
            label: 'Trajectory',
            xValuesText: xs.map((v) => Number(v.toFixed(4))).join(', '),
            valuesText: ys.map((v) => Number(v.toFixed(4))).join(', '),
            zValuesText: zs.map((v) => Number(v.toFixed(4))).join(', '),
            color: GRAPH_SERIES_COLORS[0]
          }
        ]
      }
      scene3d = buildScene3DFromGraphSpec(plot2d)
    }

    if (plot2d || scene3d) {
      return { plot2d, scene3d, hasExplicitChartType: false, detectedKind: 'numeric_table' }
    }
  }

  return { plot2d: null, scene3d: null, detectedKind: null }
}

/**
 * Merges newly parsed Code Output visuals into an existing connected GraphNode's spec,
 * replacing placeholder sin(x) data while preserving the user's chosen chart type & theme styling.
 */
export function mergeCodeVisualIntoGraphSpec(
  existing: GraphPlotSpec,
  incoming: GraphPlotSpec,
  hasExplicitTypeInCode = false
): GraphPlotSpec {
  const existingType = resolveGraphChartType(existing)
  const incomingType = resolveGraphChartType(incoming)

  let nextType: GraphChartType
  if (hasExplicitTypeInCode || is3DGraphChartType(incomingType) || existingType === 'function') {
    nextType = incomingType
  } else {
    nextType = existingType
  }

  const nextMode = is3DGraphChartType(nextType)
    ? '3d'
    : nextType === 'function'
      ? 'function'
      : 'data'

  return {
    ...incoming,
    chartType: nextType,
    mode: nextMode,
    dataKind:
      nextType === 'bar' || nextType === 'scatter' || nextType === 'smooth'
        ? nextType
        : incoming.dataKind,
    backgroundColor: incoming.backgroundColor ?? existing.backgroundColor,
    axisColor: incoming.axisColor ?? existing.axisColor,
    gridColor: incoming.gridColor ?? existing.gridColor,
    textColor: incoming.textColor ?? existing.textColor,
    legendPosition: incoming.legendPosition ?? existing.legendPosition,
    bullColor: incoming.bullColor ?? existing.bullColor,
    bearColor: incoming.bearColor ?? existing.bearColor,
    bins: incoming.bins ?? existing.bins,
    showKde: incoming.showKde ?? existing.showKde,
    donut: incoming.donut ?? existing.donut,
    showTrendline: incoming.showTrendline ?? existing.showTrendline,
    // Preserve custom series colors if same number of series and code didn't specify custom colors
    dataSeries: incoming.dataSeries.map((ds, i) => ({
      ...ds,
      color: existing.dataSeries[i]?.color ?? ds.color
    }))
  }
}

/* ---------------- Ready-to-Run Code Snippets ---------------- */

export interface CodePipelinePreset {
  id: string
  name: string
  description: string
  tabs: Omit<CodeTabItem, 'id' | 'output'>[]
}

export const CODE_PIPELINE_PRESETS: CodePipelinePreset[] = [
  {
    id: 'car_3d_kinematics',
    name: '3D Car Dynamics',
    description: 'Builds an interactive 3D Car + velocity/drag vectors',
    tabs: [
      {
        title: '1_physics.py',
        language: 'python',
        color: '#dbeafe',
        code: `import json

mass = 1350.0
v0 = 28.0
f_drag = 0.5 * 1.225 * 0.68 * (v0 ** 2)
ke_kj = 0.5 * mass * (v0 ** 2) / 1000.0

print(json.dumps({"v": v0, "f_drag": round(f_drag, 1), "ke_kj": round(ke_kj, 1)}))
`
      },
      {
        title: '2_render_car_3d.py',
        language: 'python',
        color: '#dcfce7',
        visualMode: 'scene3d',
        code: `import json, sys

data = json.loads(sys.stdin.read().strip())
drag_len = min(2.4, max(0.7, data["f_drag"] / 250.0))

scene = {
    "type": "scene3d",
    "preset": "car",
    "title": f'Car @ {data["v"]} m/s (KE={data["ke_kj"]} kJ)',
    "elements": [
        {"id": "vec-vel", "type": "arrow3d", "from": [2.2, 0.12, 0], "to": [3.75, 0.12, 0], "color": "#10B981", "anim": {"pulseFlow": True}},
        {"id": "vec-drag", "type": "arrow3d", "from": [-1.35, 0.65, 0], "to": [-1.35 - drag_len, 0.65, 0], "color": "#F59E0B"}
    ]
}
print(json.dumps(scene))
`
      }
    ]
  },
  {
    id: 'projectile_3d_pipeline',
    name: '3D Trajectory Output',
    description: 'Simulates a 3D helical curve using hashmap {x, y, z}',
    tabs: [
      {
        title: 'helix_3d.py',
        language: 'python',
        color: '#ede9fe',
        visualMode: 'scene3d',
        code: `import math

def build_3d_helix():
    xs, ys, zs = [], [], []
    for i in range(42):
        t = i * 0.22
        xs.append(round(math.cos(t * 2.0) * 1.4, 3))
        ys.append(round(math.sin(t * 2.0) * 1.4, 3))
        zs.append(round(-1.5 + t * 0.45, 3))
    # Return or print any hashmap: x, y, z (supports 3D Scatter, Line, Bar, Surface!)
    return {"x": xs, "y": ys, "z": zs, "type": "line3d", "title": "3D Charged Particle Helix"}
`
      }
    ]
  },
  {
    id: 'signal_2d_pipeline',
    name: 'Configurable Hashmap Plot',
    description: 'Returns a Python dict/hashmap {x, y} that directly updates the connected Graph',
    tabs: [
      {
        title: 'plot_hashmap.py',
        language: 'python',
        color: '#dcfce7',
        visualMode: 'plot2d',
        code: `import math

def compute_graph():
    # Edit x / y, stock data {open, high, low, close}, or 3D {x, y, z} — return the dict at the end!
    x = [round(i * 0.4, 2) for i in range(-10, 11)]
    y = [round(0.25 * (v ** 2) - 2.0, 3) for v in x]
    return {
        "title": "f(x) = 0.25x^2 - 2",
        "x": x,
        "y": y,
        "xLabel": "x",
        "yLabel": "y"
    }
`
      }
    ]
  }
]
