import type {
  Scene3DCamera,
  Scene3DColorMap,
  Scene3DElement,
  Scene3DSpec,
  Vec3
} from '@shared/scene3dSchema'

/* ---------------- Vector Math Helpers ---------------- */

const add3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const scale3 = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s]
const dot3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross3 = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]
]
const len3 = (a: Vec3): number => Math.hypot(a[0], a[1], a[2])
const norm3 = (a: Vec3): Vec3 => {
  const l = len3(a)
  return l > 1e-8 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 1, 0]
}

function rotateEulerDeg(v: Vec3, rotDeg: Vec3): Vec3 {
  let [x, y, z] = v
  const [rx, ry, rz] = rotDeg.map((d) => (d * Math.PI) / 180)
  if (Math.abs(rx) > 1e-5) {
    const c = Math.cos(rx)
    const s = Math.sin(rx)
    const ny = y * c - z * s
    const nz = y * s + z * c
    y = ny
    z = nz
  }
  if (Math.abs(ry) > 1e-5) {
    const c = Math.cos(ry)
    const s = Math.sin(ry)
    const nx = x * c + z * s
    const nz = -x * s + z * c
    x = nx
    z = nz
  }
  if (Math.abs(rz) > 1e-5) {
    const c = Math.cos(rz)
    const s = Math.sin(rz)
    const nx = x * c - y * s
    const ny = x * s + y * c
    x = nx
    y = ny
  }
  return [x, y, z]
}

function transformPoint(v: Vec3, pos: Vec3, rotDeg: Vec3, scale: Vec3): Vec3 {
  const scaled: Vec3 = [v[0] * scale[0], v[1] * scale[1], v[2] * scale[2]]
  const rotated = rotateEulerDeg(scaled, rotDeg)
  return [rotated[0] + pos[0], rotated[1] + pos[1], rotated[2] + pos[2]]
}

/* ---------------- Zero-Eval 3D Surface Expression Evaluator ---------------- */

type Token3D =
  | { type: 'num'; val: number }
  | { type: 'ident'; val: string }
  | { type: 'op'; val: '+' | '-' | '*' | '/' | '^' }
  | { type: 'lparen' }
  | { type: 'rparen' }
  | { type: 'comma' }

const exprCache = new Map<string, Token3D[]>()

function tokenizeSurfaceExpr(expr: string): Token3D[] {
  const cached = exprCache.get(expr)
  if (cached) return cached

  const cleaned = expr.replace(/^\s*z\s*=\s*/i, '').trim()
  const tokens: Token3D[] = []
  let i = 0
  while (i < cleaned.length) {
    const ch = cleaned[i]
    if (/\s/.test(ch)) {
      i++
      continue
    }
    if (/[0-9.]/.test(ch)) {
      let numStr = ''
      while (i < cleaned.length && /[0-9.]/.test(cleaned[i])) numStr += cleaned[i++]
      const v = Number(numStr)
      if (!Number.isFinite(v)) return []
      tokens.push({ type: 'num', val: v })
      continue
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let id = ''
      while (i < cleaned.length && /[a-zA-Z0-9_]/.test(cleaned[i])) id += cleaned[i++]
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

  const out: Token3D[] = []
  for (let k = 0; k < tokens.length; k++) {
    const cur = tokens[k]
    const prev = out[out.length - 1]
    if (prev) {
      const prevValueLike =
        prev.type === 'num' ||
        prev.type === 'rparen' ||
        (prev.type === 'ident' && cur.type !== 'lparen')
      const curStart = cur.type === 'num' || cur.type === 'ident' || cur.type === 'lparen'
      if (prevValueLike && curStart && prev.type !== 'ident') {
        out.push({ type: 'op', val: '*' })
      }
    }
    out.push(cur)
  }

  if (exprCache.size > 120) exprCache.clear()
  exprCache.set(expr, out)
  return out
}

function callSurfaceFn(name: string, args: number[]): number {
  const a = args[0] ?? Number.NaN
  switch (name.toLowerCase()) {
    case 'sin':
      return Math.sin(a)
    case 'cos':
      return Math.cos(a)
    case 'tan':
      return Math.tan(a)
    case 'sqrt':
      return Math.sqrt(Math.max(0, a))
    case 'exp':
      return Math.exp(a)
    case 'ln':
    case 'log':
      return Math.log(Math.max(1e-6, a))
    case 'abs':
      return Math.abs(a)
    case 'pow':
      return Math.pow(a, args[1] ?? 1)
    case 'min':
      return Math.min(...args)
    case 'max':
      return Math.max(...args)
    case 'sinc':
      return Math.abs(a) < 1e-6 ? 1 : Math.sin(Math.PI * a) / (Math.PI * a)
    case 'gaussian':
      return Math.exp(-0.5 * a * a)
    case 'sigmoid':
      return 1 / (1 + Math.exp(-a))
    case 'tanh':
      return Math.tanh(a)
    default:
      return Number.NaN
  }
}

export function evaluateSurfaceExpr3D(
  expr: string,
  xVal: number,
  yOrZVal: number,
  tVal: number
): number {
  const tokens = tokenizeSurfaceExpr(expr)
  if (tokens.length === 0) return 0
  let pos = 0
  const peek = (): Token3D | undefined => tokens[pos]
  const consume = (): Token3D | undefined => tokens[pos++]

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
    let left = parsePow()
    while (true) {
      const t = peek()
      if (!t || t.type !== 'op' || (t.val !== '*' && t.val !== '/')) break
      consume()
      const right = parsePow()
      left = t.val === '*' ? left * right : left / right
    }
    return left
  }

  const parsePow = (): number => {
    const base = parseUnary()
    const t = peek()
    if (t && t.type === 'op' && t.val === '^') {
      consume()
      return Math.pow(base, parsePow())
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
      if (peek()?.type === 'rparen') consume()
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
        if (peek()?.type === 'rparen') consume()
        return callSurfaceFn(tok.val, args)
      }
      const lower = tok.val.toLowerCase()
      if (lower === 'x') return xVal
      if (lower === 'y' || lower === 'z') return yOrZVal
      if (lower === 'r') return Math.hypot(xVal, yOrZVal)
      if (lower === 't') return tVal
      if (lower === 'pi') return Math.PI
      if (lower === 'e') return Math.E
      return 0
    }
    return 0
  }

  const res = parseExpr()
  return Number.isFinite(res) ? Math.max(-6, Math.min(6, res)) : 0
}

/* ---------------- Color & Shading Utilities ---------------- */

function parseHexColor(hex: string): [number, number, number] {
  const clean = hex.trim().replace('#', '')
  if (/^[0-9a-f]{3}$/i.test(clean)) {
    return [
      parseInt(clean[0] + clean[0], 16),
      parseInt(clean[1] + clean[1], 16),
      parseInt(clean[2] + clean[2], 16)
    ]
  }
  if (/^[0-9a-f]{6}$/i.test(clean)) {
    return [
      parseInt(clean.slice(0, 2), 16),
      parseInt(clean.slice(2, 4), 16),
      parseInt(clean.slice(4, 6), 16)
    ]
  }
  return [59, 130, 246]
}

function sampleColorMap(t: number, cmap: Scene3DColorMap): [number, number, number] {
  const u = Math.max(0, Math.min(1, t))
  if (cmap === 'coolwarm') {
    // Blue -> Light -> Red
    if (u < 0.5) {
      const k = u * 2
      return [Math.round(59 + 170 * k), Math.round(130 + 100 * k), Math.round(246 - 10 * k)]
    }
    const k = (u - 0.5) * 2
    return [Math.round(229 + 10 * k), Math.round(230 - 162 * k), Math.round(236 - 168 * k)]
  }
  if (cmap === 'emerald') {
    return [Math.round(6 + 46 * u), Math.round(78 + 160 * u), Math.round(59 + 95 * u)]
  }
  if (cmap === 'amber') {
    return [Math.round(124 + 128 * u), Math.round(45 + 175 * u), Math.round(18 + 60 * u)]
  }
  if (cmap === 'ocean') {
    return [Math.round(15 + 40 * u), Math.round(23 + 175 * u), Math.round(42 + 210 * u)]
  }
  // viridis-like gradient
  if (u < 0.5) {
    const k = u * 2
    return [Math.round(68 - 35 * k), Math.round(1 + 145 * k), Math.round(84 + 56 * k)]
  }
  const k = (u - 0.5) * 2
  return [Math.round(33 + 220 * k), Math.round(146 + 85 * k), Math.round(140 - 105 * k)]
}

/* ---------------- Mesh Triangle / Line / Label Buffers ---------------- */

interface RenderTriangle {
  pts: [Vec3, Vec3, Vec3]
  rgb: [number, number, number]
  opacity: number
  twoSided: boolean
  wireframe: boolean
  emissive: boolean
}

interface RenderPolyline {
  pts: Vec3[]
  color: string
  width: number
  dashed?: boolean
  pulseFlow?: boolean
  opacity?: number
}

interface RenderLabel {
  pos: Vec3
  text: string
  color: string
  fontSize: number
}

function pushQuad(
  tris: RenderTriangle[],
  a: Vec3,
  b: Vec3,
  c: Vec3,
  d: Vec3,
  rgb: [number, number, number],
  opacity: number,
  twoSided: boolean,
  wireframe: boolean,
  emissive: boolean
): void {
  tris.push({ pts: [a, b, c], rgb, opacity, twoSided, wireframe, emissive })
  tris.push({ pts: [a, c, d], rgb, opacity, twoSided, wireframe, emissive })
}

function buildBoxTris(
  size: Vec3,
  rgb: [number, number, number],
  opacity: number,
  twoSided: boolean,
  wireframe: boolean,
  emissive: boolean
): RenderTriangle[] {
  const hx = size[0] / 2
  const hy = size[1] / 2
  const hz = size[2] / 2
  const v: Vec3[] = [
    [-hx, -hy, hz],
    [hx, -hy, hz],
    [hx, hy, hz],
    [-hx, hy, hz],
    [-hx, -hy, -hz],
    [hx, -hy, -hz],
    [hx, hy, -hz],
    [-hx, hy, -hz]
  ]
  const tris: RenderTriangle[] = []
  pushQuad(tris, v[0], v[1], v[2], v[3], rgb, opacity, twoSided, wireframe, emissive) // +z
  pushQuad(tris, v[5], v[4], v[7], v[6], rgb, opacity, twoSided, wireframe, emissive) // -z
  pushQuad(tris, v[4], v[0], v[3], v[7], rgb, opacity, twoSided, wireframe, emissive) // -x
  pushQuad(tris, v[1], v[5], v[6], v[2], rgb, opacity, twoSided, wireframe, emissive) // +x
  pushQuad(tris, v[3], v[2], v[6], v[7], rgb, opacity, twoSided, wireframe, emissive) // +y
  pushQuad(tris, v[4], v[5], v[1], v[0], rgb, opacity, twoSided, wireframe, emissive) // -y
  return tris
}

function buildCylinderTris(
  rTop: number,
  rBot: number,
  height: number,
  segs: number,
  rgb: [number, number, number],
  opacity: number,
  twoSided: boolean,
  wireframe: boolean,
  emissive: boolean
): RenderTriangle[] {
  const tris: RenderTriangle[] = []
  const hy = height / 2
  const topCenter: Vec3 = [0, hy, 0]
  const botCenter: Vec3 = [0, -hy, 0]
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2
    const a1 = ((i + 1) / segs) * Math.PI * 2
    const c0 = Math.cos(a0)
    const s0 = Math.sin(a0)
    const c1 = Math.cos(a1)
    const s1 = Math.sin(a1)

    const b0: Vec3 = [c0 * rBot, -hy, s0 * rBot]
    const b1: Vec3 = [c1 * rBot, -hy, s1 * rBot]
    const t0: Vec3 = [c0 * rTop, hy, s0 * rTop]
    const t1: Vec3 = [c1 * rTop, hy, s1 * rTop]

    // Outward winding when Y is up and X/Z are right/forward
    pushQuad(tris, b1, b0, t0, t1, rgb, opacity, twoSided, wireframe, emissive)
    if (rTop > 1e-4) {
      tris.push({ pts: [topCenter, t1, t0], rgb, opacity, twoSided, wireframe, emissive })
    }
    if (rBot > 1e-4) {
      tris.push({ pts: [botCenter, b0, b1], rgb, opacity, twoSided, wireframe, emissive })
    }
  }
  return tris
}

function buildSphereTris(
  radius: number,
  latSegs: number,
  lonSegs: number,
  rgb: [number, number, number],
  opacity: number,
  twoSided: boolean,
  wireframe: boolean,
  emissive: boolean
): RenderTriangle[] {
  const tris: RenderTriangle[] = []
  for (let i = 0; i < latSegs; i++) {
    const p0 = (i / latSegs) * Math.PI
    const p1 = ((i + 1) / latSegs) * Math.PI
    for (let j = 0; j < lonSegs; j++) {
      const th0 = (j / lonSegs) * Math.PI * 2
      const th1 = ((j + 1) / lonSegs) * Math.PI * 2
      const pt = (p: number, th: number): Vec3 => [
        radius * Math.sin(p) * Math.cos(th),
        radius * Math.cos(p),
        radius * Math.sin(p) * Math.sin(th)
      ]
      const a = pt(p0, th0)
      const b = pt(p0, th1)
      const c = pt(p1, th1)
      const d = pt(p1, th0)
      if (i === 0) {
        tris.push({ pts: [a, c, d], rgb, opacity, twoSided, wireframe, emissive })
      } else if (i === latSegs - 1) {
        tris.push({ pts: [a, b, d], rgb, opacity, twoSided, wireframe, emissive })
      } else {
        pushQuad(tris, a, b, c, d, rgb, opacity, twoSided, wireframe, emissive)
      }
    }
  }
  return tris
}

function buildTorusTris(
  majorR: number,
  minorR: number,
  uSegs: number,
  vSegs: number,
  rgb: [number, number, number],
  opacity: number,
  twoSided: boolean,
  wireframe: boolean,
  emissive: boolean
): RenderTriangle[] {
  const tris: RenderTriangle[] = []
  const pt = (u: number, v: number): Vec3 => {
    const r = majorR + minorR * Math.cos(v)
    return [r * Math.cos(u), r * Math.sin(u), minorR * Math.sin(v)]
  }
  for (let i = 0; i < uSegs; i++) {
    const u0 = (i / uSegs) * Math.PI * 2
    const u1 = ((i + 1) / uSegs) * Math.PI * 2
    for (let j = 0; j < vSegs; j++) {
      const v0 = (j / vSegs) * Math.PI * 2
      const v1 = ((j + 1) / vSegs) * Math.PI * 2
      pushQuad(
        tris,
        pt(u0, v0),
        pt(u1, v0),
        pt(u1, v1),
        pt(u0, v1),
        rgb,
        opacity,
        twoSided,
        wireframe,
        emissive
      )
    }
  }
  return tris
}

function buildTubeAlongCurveTris(
  pts: Vec3[],
  tubeRadius: number,
  radialSegs: number,
  rgb: [number, number, number],
  opacity: number,
  twoSided: boolean,
  wireframe: boolean,
  emissive: boolean
): RenderTriangle[] {
  if (pts.length < 2) return []
  const rings: Vec3[][] = []
  for (let i = 0; i < pts.length; i++) {
    const tangent =
      i === 0
        ? norm3(sub3(pts[1], pts[0]))
        : i === pts.length - 1
          ? norm3(sub3(pts[i], pts[i - 1]))
          : norm3(sub3(pts[i + 1], pts[i - 1]))
    const upRef: Vec3 = Math.abs(tangent[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
    const n1 = norm3(cross3(tangent, upRef))
    const n2 = norm3(cross3(tangent, n1))
    const ring: Vec3[] = []
    for (let j = 0; j < radialSegs; j++) {
      const a = (j / radialSegs) * Math.PI * 2
      const offset = add3(scale3(n1, Math.cos(a) * tubeRadius), scale3(n2, Math.sin(a) * tubeRadius))
      ring.push(add3(pts[i], offset))
    }
    rings.push(ring)
  }
  const tris: RenderTriangle[] = []
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < radialSegs; j++) {
      const jNext = (j + 1) % radialSegs
      pushQuad(
        tris,
        rings[i][j],
        rings[i + 1][j],
        rings[i + 1][jNext],
        rings[i][jNext],
        rgb,
        opacity,
        twoSided,
        wireframe,
        emissive
      )
    }
  }
  return tris
}

function buildBetweenPointsTransform(from: Vec3, to: Vec3): {
  mid: Vec3
  length: number
  basisX: Vec3
  basisY: Vec3
  basisZ: Vec3
} {
  const diff = sub3(to, from)
  const length = Math.max(0.05, len3(diff))
  const basisY = norm3(diff)
  const ref: Vec3 = Math.abs(basisY[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
  const basisX = norm3(cross3(basisY, ref))
  const basisZ = norm3(cross3(basisX, basisY))
  const mid = scale3(add3(from, to), 0.5)
  return { mid, length, basisX, basisY, basisZ }
}

function compileElementToGeometry(
  el: Scene3DElement,
  timeSec: number,
  globalWireframe: boolean
): {
  tris: RenderTriangle[]
  polylines: RenderPolyline[]
  labels: RenderLabel[]
} {
  const tris: RenderTriangle[] = []
  const polylines: RenderPolyline[] = []
  const labels: RenderLabel[] = []

  const animPos: Vec3 = [0, 0, 0]
  const animRot: Vec3 = [0, 0, 0]
  if (el.anim?.rotateSpeed) {
    animRot[0] += el.anim.rotateSpeed[0] * timeSec * 45
    animRot[1] += el.anim.rotateSpeed[1] * timeSec * 45
    animRot[2] += el.anim.rotateSpeed[2] * timeSec * 45
  }
  if (el.anim?.oscillate) {
    const { axis, amp, freq, phase = 0 } = el.anim.oscillate
    const delta = Math.sin(timeSec * freq + phase) * amp
    if (axis === 'x') animPos[0] += delta
    else if (axis === 'y') animPos[1] += delta
    else animPos[2] += delta
  }

  const basePos = el.pos ?? [0, 0, 0]
  const pos: Vec3 = [
    basePos[0] + animPos[0],
    basePos[1] + animPos[1],
    basePos[2] + animPos[2]
  ]
  const baseRot = el.rot ?? [0, 0, 0]
  const rot: Vec3 = [
    baseRot[0] + animRot[0],
    baseRot[1] + animRot[1],
    baseRot[2] + animRot[2]
  ]
  const scale: Vec3 = el.scale ?? [1, 1, 1]
  const rgb = parseHexColor(el.color || '#3B82F6')
  const opacity = el.opacity ?? 1
  const twoSided = opacity < 0.99 || el.type === 'plane' || el.type === 'surface3d'
  const wireframe = Boolean(el.wireframe ?? globalWireframe)
  const emissive = Boolean(el.emissive)

  const pushTransformed = (localTris: RenderTriangle[]): void => {
    for (const t of localTris) {
      tris.push({
        ...t,
        pts: [
          transformPoint(t.pts[0], pos, rot, scale),
          transformPoint(t.pts[1], pos, rot, scale),
          transformPoint(t.pts[2], pos, rot, scale)
        ]
      })
    }
  }

  switch (el.type) {
    case 'box': {
      const sz = el.size ?? [1, 1, 1]
      pushTransformed(buildBoxTris(sz, rgb, opacity, twoSided, wireframe, emissive))
      break
    }

    case 'plane': {
      const sz = el.size ?? [4, 0.04, 4]
      const hx = sz[0] / 2
      const hz = sz[2] / 2
      const planeTris: RenderTriangle[] = []
      pushQuad(
        planeTris,
        [-hx, 0, -hz],
        [hx, 0, -hz],
        [hx, 0, hz],
        [-hx, 0, hz],
        rgb,
        opacity,
        true,
        wireframe,
        emissive
      )
      pushTransformed(planeTris)
      break
    }

    case 'sphere': {
      const r = el.radius ?? 0.45
      pushTransformed(buildSphereTris(r, 10, 14, rgb, opacity, twoSided, wireframe, emissive))
      break
    }

    case 'cylinder': {
      if (el.from && el.to) {
        const { length, basisX, basisY, basisZ } = buildBetweenPointsTransform(el.from, el.to)
        const r = el.radius ?? 0.06
        const local = buildCylinderTris(
          el.radiusTop ?? r,
          el.radiusBottom ?? r,
          length,
          12,
          rgb,
          opacity,
          twoSided,
          wireframe,
          emissive
        )
        const mid = scale3(add3(el.from, el.to), 0.5)
        for (const t of local) {
          const mapV = (v: Vec3): Vec3 =>
            add3(
              mid,
              add3(scale3(basisX, v[0]), add3(scale3(basisY, v[1]), scale3(basisZ, v[2])))
            )
          tris.push({ ...t, pts: [mapV(t.pts[0]), mapV(t.pts[1]), mapV(t.pts[2])] })
        }
      } else {
        const r = el.radius ?? 0.35
        const h = el.height ?? 1.0
        pushTransformed(
          buildCylinderTris(
            el.radiusTop ?? r,
            el.radiusBottom ?? r,
            h,
            14,
            rgb,
            opacity,
            twoSided,
            wireframe,
            emissive
          )
        )
      }
      break
    }

    case 'cone': {
      const r = el.radius ?? 0.4
      const h = el.height ?? 0.9
      pushTransformed(buildCylinderTris(0.001, r, h, 14, rgb, opacity, twoSided, wireframe, emissive))
      break
    }

    case 'torus': {
      const r = el.radius ?? 0.6
      const tr = el.tubeRadius ?? 0.16
      pushTransformed(buildTorusTris(r, tr, 18, 10, rgb, opacity, twoSided, wireframe, emissive))
      break
    }

    case 'wheel': {
      const r = el.radius ?? 0.36
      const tr = el.tubeRadius ?? r * 0.32
      const rimColor = parseHexColor(el.secondaryColor || '#CBD5E1')
      // Outer tire torus (around Z axis)
      pushTransformed(buildTorusTris(r, tr, 18, 8, rgb, opacity, false, wireframe, emissive))
      // Center hub
      const hubLocal = buildCylinderTris(r * 0.28, r * 0.28, tr * 1.4, 10, rimColor, 1, false, wireframe, false)
      // Rotate hub from Y axis onto Z axis
      for (const t of hubLocal) {
        const mapHub = (v: Vec3): Vec3 =>
          transformPoint(rotateEulerDeg(v, [90, 0, 0]), pos, rot, scale)
        tris.push({ ...t, pts: [mapHub(t.pts[0]), mapHub(t.pts[1]), mapHub(t.pts[2])] })
      }
      // Rotating spokes
      const spokeCount = el.spokes ?? 6
      for (let i = 0; i < spokeCount; i++) {
        const ang = (i / spokeCount) * Math.PI * 2
        const spokeLocal = buildBoxTris([r * 0.08, r * 1.55, tr * 0.45], rimColor, 1, false, wireframe, false)
        for (const t of spokeLocal) {
          const mapSpoke = (v: Vec3): Vec3 =>
            transformPoint(rotateEulerDeg(v, [0, 0, (ang * 180) / Math.PI]), pos, rot, scale)
          tris.push({ ...t, pts: [mapSpoke(t.pts[0]), mapSpoke(t.pts[1]), mapSpoke(t.pts[2])] })
        }
      }
      break
    }

    case 'spring': {
      const from = el.from ?? [-1, 0, 0]
      const to = el.to ?? [1, 0, 0]
      const { length, basisX, basisY, basisZ } = buildBetweenPointsTransform(from, to)
      const coilR = el.radius ?? 0.25
      const wireR = el.tubeRadius ?? 0.04
      const turns = el.turns ?? 7
      const totalPts = Math.min(84, turns * 8)
      const curvePts: Vec3[] = []
      for (let i = 0; i <= totalPts; i++) {
        const u = i / totalPts
        const theta = u * turns * Math.PI * 2
        const along = (u - 0.5) * length
        const p = add3(
          scale3(add3(from, to), 0.5),
          add3(
            scale3(basisY, along),
            add3(scale3(basisX, Math.cos(theta) * coilR), scale3(basisZ, Math.sin(theta) * coilR))
          )
        )
        curvePts.push(p)
      }
      const springTris = buildTubeAlongCurveTris(curvePts, wireR, 6, rgb, opacity, false, wireframe, emissive)
      tris.push(...springTris)
      break
    }

    case 'lens': {
      const r = el.radius ?? 0.65
      const h = el.height ?? 0.25
      const lensKind = el.lensKind ?? 'biconvex'
      const localTris = buildSphereTris(r, 10, 14, rgb, opacity === 1 ? 0.48 : opacity, true, wireframe, emissive)
      const squishY = lensKind === 'biconcave' ? 0.14 : Math.max(0.18, h / (r * 2))
      for (const t of localTris) {
        const sq = (v: Vec3): Vec3 => {
          const scaled: Vec3 = [v[0], v[1] * squishY, v[2]]
          // Flip axis so lens faces +X by default, then apply element transform
          const rotated = rotateEulerDeg(scaled, [0, 0, 90])
          return transformPoint(rotated, pos, rot, scale)
        }
        tris.push({ ...t, pts: [sq(t.pts[0]), sq(t.pts[1]), sq(t.pts[2])] })
      }
      break
    }

    case 'prism': {
      const sz = el.size ?? [0.9, 0.9, 0.8]
      const hx = sz[0] / 2
      const hy = sz[1] / 2
      const hz = sz[2] / 2
      const a0: Vec3 = [-hx, -hy, hz]
      const b0: Vec3 = [hx, -hy, hz]
      const c0: Vec3 = [0, hy, hz]
      const a1: Vec3 = [-hx, -hy, -hz]
      const b1: Vec3 = [hx, -hy, -hz]
      const c1: Vec3 = [0, hy, -hz]
      const pTris: RenderTriangle[] = [
        { pts: [a0, b0, c0], rgb, opacity: opacity === 1 ? 0.5 : opacity, twoSided: true, wireframe, emissive },
        { pts: [b1, a1, c1], rgb, opacity: opacity === 1 ? 0.5 : opacity, twoSided: true, wireframe, emissive }
      ]
      pushQuad(pTris, a0, b0, b1, a1, rgb, opacity === 1 ? 0.5 : opacity, true, wireframe, emissive)
      pushQuad(pTris, b0, c0, c1, b1, rgb, opacity === 1 ? 0.5 : opacity, true, wireframe, emissive)
      pushQuad(pTris, c0, a0, a1, c1, rgb, opacity === 1 ? 0.5 : opacity, true, wireframe, emissive)
      pushTransformed(pTris)
      break
    }

    case 'flask': {
      const r = el.radius ?? 0.55
      const h = el.height ?? 1.05
      const glassOp = el.opacity ?? 0.42
      const fill = el.fillLevel ?? 0.45
      const bodyH = h * 0.68
      const neckH = h * 0.34
      // Conical Erlenmeyer body (centered at base y = 0)
      const bodyTris = buildCylinderTris(r * 0.28, r, bodyH, 14, rgb, glassOp, true, wireframe, false)
      for (const t of bodyTris) {
        const shift = (v: Vec3): Vec3 =>
          transformPoint([v[0], v[1] + bodyH / 2, v[2]], pos, rot, scale)
        tris.push({ ...t, pts: [shift(t.pts[0]), shift(t.pts[1]), shift(t.pts[2])] })
      }
      // Cylindrical neck
      const neckTris = buildCylinderTris(r * 0.28, r * 0.28, neckH, 12, rgb, glassOp, true, wireframe, false)
      for (const t of neckTris) {
        const shift = (v: Vec3): Vec3 =>
          transformPoint([v[0], v[1] + bodyH + neckH / 2, v[2]], pos, rot, scale)
        tris.push({ ...t, pts: [shift(t.pts[0]), shift(t.pts[1]), shift(t.pts[2])] })
      }
      // Liquid inside conical body
      if (fill > 0.04) {
        const liqH = bodyH * Math.min(0.9, fill)
        const topR = r * (1 - (1 - 0.28) * (liqH / bodyH)) * 0.92
        const liqColor = parseHexColor(el.liquidColor || '#EC4899')
        const liqTris = buildCylinderTris(topR, r * 0.92, liqH, 12, liqColor, 0.78, true, wireframe, false)
        for (const t of liqTris) {
          const shift = (v: Vec3): Vec3 =>
            transformPoint([v[0], v[1] + liqH / 2 + 0.02, v[2]], pos, rot, scale)
          tris.push({ ...t, pts: [shift(t.pts[0]), shift(t.pts[1]), shift(t.pts[2])] })
        }
      }
      break
    }

    case 'arrow3d': {
      const from = el.from ?? [0, 0, 0]
      const to = el.to ?? [1.4, 0, 0]
      const diff = sub3(to, from)
      const totalLen = Math.max(0.15, len3(diff))
      const dir = norm3(diff)
      const headLen = Math.min(totalLen * 0.28, 0.34)
      const shaftEnd = sub3(to, scale3(dir, headLen))
      // Shaft cylinder
      const shaftTf = buildBetweenPointsTransform(from, shaftEnd)
      const shaftR = el.radius ?? 0.045
      const shaftTris = buildCylinderTris(shaftR, shaftR, shaftTf.length, 8, rgb, opacity, false, wireframe, true)
      for (const t of shaftTris) {
        const mapV = (v: Vec3): Vec3 =>
          add3(
            shaftTf.mid,
            add3(
              scale3(shaftTf.basisX, v[0]),
              add3(scale3(shaftTf.basisY, v[1]), scale3(shaftTf.basisZ, v[2]))
            )
          )
        tris.push({ ...t, pts: [mapV(t.pts[0]), mapV(t.pts[1]), mapV(t.pts[2])] })
      }
      // Cone head
      const headTf = buildBetweenPointsTransform(shaftEnd, to)
      const headTris = buildCylinderTris(0.001, shaftR * 2.5, headTf.length, 10, rgb, opacity, false, wireframe, true)
      for (const t of headTris) {
        const mapV = (v: Vec3): Vec3 =>
          add3(
            headTf.mid,
            add3(
              scale3(headTf.basisX, v[0]),
              add3(scale3(headTf.basisY, v[1]), scale3(headTf.basisZ, v[2]))
            )
          )
        tris.push({ ...t, pts: [mapV(t.pts[0]), mapV(t.pts[1]), mapV(t.pts[2])] })
      }
      if (el.anim?.pulseFlow) {
        polylines.push({
          pts: [from, to],
          color: el.color || '#EF4444',
          width: 2.2,
          pulseFlow: true,
          opacity: 0.9
        })
      }
      break
    }

    case 'curve3d': {
      const pts = el.points ?? []
      if (pts.length >= 2) {
        polylines.push({
          pts: pts.map((p) => transformPoint(p, pos, rot, scale)),
          color: el.color || '#EF4444',
          width: 2.6,
          dashed: el.dashed,
          pulseFlow: Boolean(el.anim?.pulseFlow),
          opacity
        })
      }
      break
    }

    case 'surface3d': {
      const expr = el.expr || 'sin(x)*cos(y)'
      const [xMin, xMax] = el.xRange ?? [-3, 3]
      const [zMin, zMax] = el.zRange ?? [-3, 3]
      const res = Math.min(28, Math.max(8, el.resolution ?? 18))
      const cmap: Scene3DColorMap = el.colorMap ?? 'coolwarm'

      const grid: Vec3[][] = []
      let minY = Infinity
      let maxY = -Infinity
      for (let ix = 0; ix <= res; ix++) {
        const row: Vec3[] = []
        const xv = xMin + ((xMax - xMin) * ix) / res
        for (let iz = 0; iz <= res; iz++) {
          const zv = zMin + ((zMax - zMin) * iz) / res
          const yv = evaluateSurfaceExpr3D(expr, xv, zv, timeSec)
          if (yv < minY) minY = yv
          if (yv > maxY) maxY = yv
          row.push([xv, yv, zv])
        }
        grid.push(row)
      }
      const span = Math.max(0.2, maxY - minY)
      for (let ix = 0; ix < res; ix++) {
        for (let iz = 0; iz < res; iz++) {
          const a = grid[ix][iz]
          const b = grid[ix + 1][iz]
          const c = grid[ix + 1][iz + 1]
          const d = grid[ix][iz + 1]
          const avgY = (a[1] + b[1] + c[1] + d[1]) / 4
          const normH = (avgY - minY) / span
          const cellRgb = sampleColorMap(normH, cmap)
          pushTransformed([
            { pts: [a, b, c], rgb: cellRgb, opacity, twoSided: true, wireframe, emissive: false },
            { pts: [a, c, d], rgb: cellRgb, opacity, twoSided: true, wireframe, emissive: false }
          ])
        }
      }
      break
    }

    case 'mesh': {
      const verts = el.vertices ?? []
      const faces = el.faces ?? []
      for (const f of faces) {
        if (f.length < 3) continue
        const p0 = verts[f[0]]
        if (!p0) continue
        for (let i = 1; i + 1 < f.length; i++) {
          const p1 = verts[f[i]]
          const p2 = verts[f[i + 1]]
          if (!p1 || !p2) continue
          pushTransformed([
            {
              pts: [p0, p1, p2],
              rgb,
              opacity,
              twoSided: true,
              wireframe,
              emissive
            }
          ])
        }
      }
      break
    }

    case 'label3d': {
      const txt = (el.text || el.label || '').trim()
      if (txt) {
        labels.push({
          pos,
          text: txt,
          color: el.color || '#0F172A',
          fontSize: el.fontSize ?? 12
        })
      }
      break
    }
  }

  return { tris, polylines, labels }
}

/* ---------------- Camera Projection & Full Canvas Renderer ---------------- */

export interface RenderScene3DThemeOpts {
  isLight?: boolean
  inkColor?: string
  accentColor?: string
}

export function renderScene3DToCanvas(
  ctx: CanvasRenderingContext2D,
  spec: Scene3DSpec,
  width: number,
  height: number,
  cameraOverride?: Partial<Scene3DCamera>,
  timeSec = 0,
  themeOpts?: RenderScene3DThemeOpts
): void {
  if (width <= 8 || height <= 8) return
  const isLight = themeOpts?.isLight ?? true
  const camYawDeg = cameraOverride?.yaw ?? spec.camera?.yaw ?? 38
  const camPitchDeg = cameraOverride?.pitch ?? spec.camera?.pitch ?? 24
  const camZoom = Math.max(0.25, Math.min(4, cameraOverride?.zoom ?? spec.camera?.zoom ?? 1))
  const camPanX = cameraOverride?.panX ?? spec.camera?.panX ?? 0
  const camPanY = cameraOverride?.panY ?? spec.camera?.panY ?? 0

  const yaw = (camYawDeg * Math.PI) / 180
  const pitch = (Math.max(-85, Math.min(85, camPitchDeg)) * Math.PI) / 180
  const cosY = Math.cos(yaw)
  const sinY = Math.sin(yaw)
  const cosP = Math.cos(pitch)
  const sinP = Math.sin(pitch)

  const fovScale = Math.min(width, height) * 0.24 * camZoom
  const cameraDist = 9.2
  const cx = width * 0.5 + camPanX
  const cy = height * 0.54 + camPanY

  const project = (world: Vec3): { sx: number; sy: number; cz: number; camPt: Vec3 } | null => {
    // Rotate around Y (yaw)
    const x1 = world[0] * cosY + world[2] * sinY
    const z1 = -world[0] * sinY + world[2] * cosY
    const y1 = world[1]
    // Rotate around X (pitch)
    const y2 = y1 * cosP - z1 * sinP
    const z2 = y1 * sinP + z1 * cosP
    const depth = cameraDist - z2
    if (depth <= 0.35) return null
    const perspective = cameraDist / depth
    return {
      sx: cx + x1 * fovScale * perspective,
      sy: cy - y2 * fovScale * perspective,
      cz: z2,
      camPt: [x1, y2, z2]
    }
  }

  // 1. Ground grid (subtle perspective reference)
  if (spec.showGrid !== false) {
    ctx.save()
    ctx.strokeStyle = isLight ? 'rgba(100, 116, 139, 0.24)' : 'rgba(148, 163, 184, 0.24)'
    ctx.lineWidth = 1
    const extent = 4
    for (let g = -extent; g <= extent; g++) {
      const a1 = project([g, -0.62, -extent])
      const a2 = project([g, -0.62, extent])
      if (a1 && a2) {
        ctx.beginPath()
        ctx.moveTo(a1.sx, a1.sy)
        ctx.lineTo(a2.sx, a2.sy)
        ctx.stroke()
      }
      const b1 = project([-extent, -0.62, g])
      const b2 = project([extent, -0.62, g])
      if (b1 && b2) {
        ctx.beginPath()
        ctx.moveTo(b1.sx, b1.sy)
        ctx.lineTo(b2.sx, b2.sy)
        ctx.stroke()
      }
    }
    ctx.restore()
  }

  // 2. Coordinate axes
  if (spec.showAxes !== false) {
    const origin = project([0, -0.62, 0])
    const axes: Array<{ to: Vec3; color: string; label: string }> = [
      { to: [2.2, -0.62, 0], color: '#EF4444', label: 'X' },
      { to: [0, 1.58, 0], color: '#10B981', label: 'Y' },
      { to: [0, -0.62, 2.2], color: '#3B82F6', label: 'Z' }
    ]
    if (origin) {
      ctx.save()
      ctx.font = '700 10px Inter, system-ui, sans-serif'
      for (const ax of axes) {
        const end = project(ax.to)
        if (!end) continue
        ctx.strokeStyle = ax.color
        ctx.lineWidth = 1.6
        ctx.globalAlpha = 0.72
        ctx.beginPath()
        ctx.moveTo(origin.sx, origin.sy)
        ctx.lineTo(end.sx, end.sy)
        ctx.stroke()
        ctx.fillStyle = ax.color
        ctx.globalAlpha = 0.9
        ctx.fillText(ax.label, end.sx + 4, end.sy + 3)
      }
      ctx.restore()
    }
  }

  // 3. Compile all elements
  const allTris: RenderTriangle[] = []
  const allLines: RenderPolyline[] = []
  const allLabels: RenderLabel[] = []
  const globalWire = Boolean(spec.wireframe)

  for (const el of spec.elements) {
    const compiled = compileElementToGeometry(el, timeSec, globalWire)
    allTris.push(...compiled.tris)
    allLines.push(...compiled.polylines)
    allLabels.push(...compiled.labels)
  }

  // 4. Project, shade & sort triangles back-to-front (Painter's algorithm)
  const lightDir = norm3([0.52, 0.78, 0.45])
  interface ProjectedTri {
    pts2d: Array<[number, number]>
    depth: number
    fillStyle: string
    strokeStyle: string
    wireframe: boolean
    opacity: number
  }
  const projectedTris: ProjectedTri[] = []

  for (const tri of allTris) {
    const p0 = project(tri.pts[0])
    const p1 = project(tri.pts[1])
    const p2 = project(tri.pts[2])
    if (!p0 || !p1 || !p2) continue

    // Screen-space signed area for back-face culling
    const area2 =
      (p1.sx - p0.sx) * (p2.sy - p0.sy) - (p1.sy - p0.sy) * (p2.sx - p0.sx)
    if (!tri.twoSided && area2 > 0) {
      continue
    }

    const edge1 = sub3(tri.pts[1], tri.pts[0])
    const edge2 = sub3(tri.pts[2], tri.pts[0])
    let normal = norm3(cross3(edge1, edge2))
    if (tri.twoSided && dot3(normal, lightDir) < 0) {
      normal = scale3(normal, -1)
    }

    const diffuse = Math.max(0, dot3(normal, lightDir))
    const halfVec = norm3(add3(lightDir, [0, 0.25, 0.95]))
    const specPow = Math.pow(Math.max(0, dot3(normal, halfVec)), 18) * 0.28
    const brightness = tri.emissive ? 1.1 : Math.min(1.18, 0.42 + 0.62 * diffuse + specPow)

    const r = Math.min(255, Math.max(0, Math.round(tri.rgb[0] * brightness)))
    const g = Math.min(255, Math.max(0, Math.round(tri.rgb[1] * brightness)))
    const b = Math.min(255, Math.max(0, Math.round(tri.rgb[2] * brightness)))

    const depth = (p0.cz + p1.cz + p2.cz) / 3
    projectedTris.push({
      pts2d: [
        [p0.sx, p0.sy],
        [p1.sx, p1.sy],
        [p2.sx, p2.sy]
      ],
      depth,
      fillStyle: `rgba(${r}, ${g}, ${b}, ${tri.opacity})`,
      strokeStyle: tri.wireframe
        ? `rgba(${r}, ${g}, ${b}, ${Math.min(1, tri.opacity + 0.2)})`
        : `rgba(${Math.max(0, r - 22)}, ${Math.max(0, g - 22)}, ${Math.max(0, b - 22)}, ${tri.opacity * 0.45})`,
      wireframe: tri.wireframe,
      opacity: tri.opacity
    })
  }

  projectedTris.sort((a, b) => a.depth - b.depth)

  for (const t of projectedTris) {
    ctx.beginPath()
    ctx.moveTo(t.pts2d[0][0], t.pts2d[0][1])
    ctx.lineTo(t.pts2d[1][0], t.pts2d[1][1])
    ctx.lineTo(t.pts2d[2][0], t.pts2d[2][1])
    ctx.closePath()
    if (!t.wireframe) {
      ctx.fillStyle = t.fillStyle
      ctx.fill()
    }
    ctx.strokeStyle = t.strokeStyle
    ctx.lineWidth = t.wireframe ? 1.15 : 0.65
    ctx.stroke()
  }

  // 5. Render 3D polylines / light rays / animated pulses
  for (const line of allLines) {
    const projPts = line.pts.map(project).filter((p): p is NonNullable<typeof p> => p !== null)
    if (projPts.length < 2) continue
    ctx.save()
    ctx.strokeStyle = line.color
    ctx.lineWidth = line.width
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.globalAlpha = line.opacity ?? 1
    if (line.dashed) ctx.setLineDash([6, 4])
    ctx.beginPath()
    ctx.moveTo(projPts[0].sx, projPts[0].sy)
    for (let i = 1; i < projPts.length; i++) {
      ctx.lineTo(projPts[i].sx, projPts[i].sy)
    }
    ctx.stroke()

    if (line.pulseFlow) {
      const segs = projPts.length - 1
      const progress = ((timeSec * 0.65) % 1) * segs
      const segIdx = Math.min(segs - 1, Math.floor(progress))
      const frac = progress - segIdx
      const a = projPts[segIdx]
      const b = projPts[segIdx + 1]
      const px = a.sx + (b.sx - a.sx) * frac
      const py = a.sy + (b.sy - a.sy) * frac
      ctx.setLineDash([])
      ctx.fillStyle = '#FFFFFF'
      ctx.strokeStyle = line.color
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(px, py, 4.2, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }
    ctx.restore()
  }

  // 6. Render 3D projected labels
  for (const lbl of allLabels) {
    const p = project(lbl.pos)
    if (!p) continue
    ctx.save()
    ctx.font = `700 ${lbl.fontSize}px Inter, system-ui, sans-serif`
    const metrics = ctx.measureText(lbl.text)
    const padX = 6
    const bw = metrics.width + padX * 2
    const bh = lbl.fontSize + 7
    const bx = p.sx - bw / 2
    const by = p.sy - bh / 2
    ctx.fillStyle = isLight ? 'rgba(255, 253, 247, 0.88)' : 'rgba(15, 23, 42, 0.85)'
    ctx.strokeStyle = lbl.color
    ctx.lineWidth = 1.25
    ctx.beginPath()
    ctx.roundRect(bx, by, bw, bh, 5)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = isLight ? lbl.color : '#F8FAFC'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(lbl.text, p.sx, p.sy + 0.5)
    ctx.restore()
  }
}
