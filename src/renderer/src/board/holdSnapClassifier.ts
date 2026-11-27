import type { InkPoint, ShapeKind, ShapeNode } from '../types/board'

export type HoldSnapKind =
  | 'line'
  | 'arrow'
  | 'curved-arrow'
  | 'rect'
  | 'diamond'
  | 'triangle'
  | 'right-triangle'
  | 'triangle-down'
  | 'parallelogram'
  | 'trapezoid'
  | 'pentagon'
  | 'hexagon'
  | 'hexagon-vertical'
  | 'heptagon'
  | 'octagon'
  | 'star-5'
  | 'circle'

export interface HoldSnapResult {
  kind: HoldSnapKind
  x: number
  y: number
  w: number
  h: number
  /** For curved-arrow, quadratic Bezier control point in canvas coordinates */
  controlPoint?: [number, number]
  /** For triangles/diamonds/rects, exact bounding box; for line/arrow, (x,y) -> (x+w, y+h) */
  isPerfectCircle?: boolean
  confidence?: number
}

export interface Point2D {
  x: number
  y: number
}

function dist(a: Point2D, b: Point2D): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function polylineLength(pts: Point2D[]): number {
  let len = 0
  for (let i = 1; i < pts.length; i++) {
    len += dist(pts[i - 1], pts[i])
  }
  return len
}

function pointToLineDist(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l2 = dx * dx + dy * dy
  if (l2 < 1e-6) return dist(p, a)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** Ramer-Douglas-Peucker polyline simplification */
export function rdpSimplify(pts: Point2D[], epsilon: number): Point2D[] {
  if (pts.length <= 2) return pts
  let maxDist = -1
  let splitIdx = 0
  const first = pts[0]
  const last = pts[pts.length - 1]
  for (let i = 1; i < pts.length - 1; i++) {
    const d = pointToLineDist(pts[i], first, last)
    if (d > maxDist) {
      maxDist = d
      splitIdx = i
    }
  }
  if (maxDist > epsilon) {
    const left = rdpSimplify(pts.slice(0, splitIdx + 1), epsilon)
    const right = rdpSimplify(pts.slice(splitIdx), epsilon)
    return [...left.slice(0, -1), ...right]
  }
  return [first, last]
}

function computeBounds(pts: Point2D[]): {
  minX: number
  minY: number
  maxX: number
  maxY: number
  w: number
  h: number
} {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of pts) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY }
}

/** Uniformly resamples a polyline along arc length to `count` points */
export function resamplePolyline(pts: Point2D[], count: number): Point2D[] {
  if (pts.length === 0 || count <= 0) return []
  if (pts.length === 1 || count === 1) return [{ x: pts[0].x, y: pts[0].y }]
  const total = polylineLength(pts)
  if (total < 1e-4) {
    return Array.from({ length: count }, () => ({ x: pts[0].x, y: pts[0].y }))
  }
  const step = total / (count - 1)
  const out: Point2D[] = [{ x: pts[0].x, y: pts[0].y }]
  let acc = 0
  let prev: Point2D = { x: pts[0].x, y: pts[0].y }

  for (let i = 1; i < pts.length; i++) {
    const cur = pts[i]
    let seg = dist(prev, cur)
    while (acc + seg >= step && out.length < count) {
      const t = (step - acc) / (seg || 1)
      const nx = prev.x + t * (cur.x - prev.x)
      const ny = prev.y + t * (cur.y - prev.y)
      const np = { x: nx, y: ny }
      out.push(np)
      prev = np
      seg = dist(prev, cur)
      acc = 0
    }
    acc += seg
    prev = cur
  }
  while (out.length < count) {
    const last = pts[pts.length - 1]
    out.push({ x: last.x, y: last.y })
  }
  return out
}

export interface QuadraticBezierFit {
  controlPoint: [number, number]
  fitErr: number
  maxSagitta: number
  consistentBend: boolean
  chordLen: number
  arcLen: number
}

/**
 * Fits a single-arc quadratic Bezier (P0, C, P2) to an open stroke using its arc-length midpoint
 * and validates consistent single-sided curvature (rejecting S-curves and handwritten digits/letters).
 */
export function fitQuadraticBezierControlPoint(pts: Point2D[]): QuadraticBezierFit {
  const p0 = pts[0]
  const p2 = pts[pts.length - 1]
  const chordDx = p2.x - p0.x
  const chordDy = p2.y - p0.y
  const chordLen = Math.hypot(chordDx, chordDy)
  const arcLen = polylineLength(pts)

  if (pts.length < 3 || arcLen < 1e-3) {
    return {
      controlPoint: [(p0.x + p2.x) / 2, (p0.y + p2.y) / 2],
      fitErr: Infinity,
      maxSagitta: 0,
      consistentBend: false,
      chordLen,
      arcLen
    }
  }

  // Arc-length midpoint M -> C = 2*M - 0.5*(P0 + P2)
  const targetMid = arcLen * 0.5
  let acc = 0
  let midPt: Point2D = { x: (p0.x + p2.x) / 2, y: (p0.y + p2.y) / 2 }
  for (let i = 1; i < pts.length; i++) {
    const seg = dist(pts[i - 1], pts[i])
    if (acc + seg >= targetMid && seg > 1e-6) {
      const t = (targetMid - acc) / seg
      midPt = {
        x: pts[i - 1].x + t * (pts[i].x - pts[i - 1].x),
        y: pts[i - 1].y + t * (pts[i].y - pts[i - 1].y)
      }
      break
    }
    acc += seg
  }

  const cx = 2 * midPt.x - 0.5 * (p0.x + p2.x)
  const cy = 2 * midPt.y - 0.5 * (p0.y + p2.y)

  const uni = resamplePolyline(pts, 32)
  let maxSagitta = 0
  let posCount = 0
  let negCount = 0
  if (chordLen > 1e-4) {
    for (const p of uni) {
      const sd = ((p.x - p0.x) * chordDy - (p.y - p0.y) * chordDx) / chordLen
      if (Math.abs(sd) > Math.abs(maxSagitta)) {
        maxSagitta = sd
      }
      if (sd > 3) posCount++
      else if (sd < -3) negCount++
    }
  }
  const bendTotal = posCount + negCount
  const consistentBend =
    bendTotal > 0 && Math.max(posCount, negCount) / bendTotal >= 0.75

  // Sample quadratic Bezier (P0, C, P2) and compute mean normalized distance
  const bezSamples: Point2D[] = []
  const STEPS = 32
  for (let k = 0; k <= STEPS; k++) {
    const t = k / STEPS
    const mt = 1 - t
    bezSamples.push({
      x: mt * mt * p0.x + 2 * mt * t * cx + t * t * p2.x,
      y: mt * mt * p0.y + 2 * mt * t * cy + t * t * p2.y
    })
  }

  let errSum = 0
  for (const p of uni) {
    let best = Infinity
    for (let k = 0; k < STEPS; k++) {
      const d = pointToLineDist(p, bezSamples[k], bezSamples[k + 1])
      if (d < best) best = d
    }
    errSum += best
  }
  const fitErr = errSum / (uni.length * Math.max(1, arcLen))

  return {
    controlPoint: [cx, cy],
    fitErr,
    maxSagitta,
    consistentBend,
    chordLen,
    arcLen
  }
}

export interface DetectedSingleArrow {
  kind: 'arrow' | 'curved-arrow'
  x: number
  y: number
  w: number
  h: number
  controlPoint?: [number, number]
  confidence: number
}

/**
 * Detects a single-stroke straight `arrow` or single-arc `curved-arrow` (supports 1-barb and 2-barb heads).
 */
export function detectSingleStrokeArrowOrCurvedArrow(pts: Point2D[]): DetectedSingleArrow | null {
  if (pts.length < 3) return null
  const cumLens: number[] = [0]
  for (let i = 1; i < pts.length; i++) {
    cumLens.push(cumLens[i - 1] + dist(pts[i - 1], pts[i]))
  }
  const totalLen = cumLens[cumLens.length - 1]
  if (totalLen < 34) return null

  const start = pts[0]
  const candidates: number[] = []

  // Candidate (a): point farthest from start in [45%..96%] of arc length
  let maxDist = -1
  let farIdx = -1
  for (let i = 1; i < pts.length - 1; i++) {
    if (cumLens[i] < totalLen * 0.45 || cumLens[i] > totalLen * 0.96) continue
    const d = dist(start, pts[i])
    if (d > maxDist) {
      maxDist = d
      farIdx = i
    }
  }
  if (farIdx > 0) candidates.push(farIdx)

  // Candidate (b): last sharp direction reversal (> 98 deg) in final 48% of arc length
  let revIdx = -1
  for (let i = 1; i < pts.length - 1; i++) {
    if (cumLens[i] < totalLen * 0.52 || cumLens[i] > totalLen * 0.96) continue
    const inDx = pts[i].x - pts[i - 1].x
    const inDy = pts[i].y - pts[i - 1].y
    const outDx = pts[i + 1].x - pts[i].x
    const outDy = pts[i + 1].y - pts[i].y
    const n1 = Math.hypot(inDx, inDy)
    const n2 = Math.hypot(outDx, outDy)
    if (n1 >= 4 && n2 >= 4) {
      const cosTurn = (inDx * outDx + inDy * outDy) / (n1 * n2)
      if (cosTurn < -0.15) {
        revIdx = i
      }
    }
  }
  if (revIdx > 0 && !candidates.includes(revIdx)) {
    candidates.push(revIdx)
  }

  for (const tipIdx of candidates) {
    const tailLen = totalLen - cumLens[tipIdx]
    if (tailLen < Math.max(8, totalLen * 0.04) || tailLen > totalLen * 0.55) continue

    const shaftPts = pts.slice(0, tipIdx + 1)
    const shaftArcLen = cumLens[tipIdx]
    const tip = pts[tipIdx]

    // Scan all points after tipIdx so both 1-barb and 2-barb single-stroke heads work
    let bestBarbPt: Point2D | null = null
    let maxBarbDist = 0
    let firstBarbPt: Point2D | null = null
    for (let i = tipIdx + 1; i < pts.length; i++) {
      const bd = dist(tip, pts[i])
      if (!firstBarbPt && bd >= 5) {
        firstBarbPt = pts[i]
      }
      if (bd > maxBarbDist) {
        maxBarbDist = bd
        bestBarbPt = pts[i]
      }
    }
    if (!bestBarbPt || maxBarbDist < 6 || maxBarbDist > shaftArcLen * 0.48) continue

    const fit = fitQuadraticBezierControlPoint(shaftPts)
    const checkReversal = (fwdX: number, fwdY: number, minCos: number): boolean => {
      const fn = Math.hypot(fwdX, fwdY)
      if (fn < 1e-3) return false
      const refPt = firstBarbPt ?? bestBarbPt!
      const b1x = refPt.x - tip.x
      const b1y = refPt.y - tip.y
      const b1n = Math.hypot(b1x, b1y)
      const b2x = bestBarbPt!.x - tip.x
      const b2y = bestBarbPt!.y - tip.y
      const b2n = Math.hypot(b2x, b2y)
      const cos1 = b1n >= 5 ? (fwdX * b1x + fwdY * b1y) / (fn * b1n) : 1
      const cos2 = b2n >= 5 ? (fwdX * b2x + fwdY * b2y) / (fn * b2n) : 1
      return cos1 < minCos || cos2 < minCos
    }

    const straightness = fit.chordLen / Math.max(1, fit.arcLen)
    const sagittaLimit = Math.max(14, fit.chordLen * 0.12)

    // 1. Straight arrow
    if (fit.chordLen >= 26 && straightness >= 0.87 && Math.abs(fit.maxSagitta) < sagittaLimit) {
      let dx = tip.x - start.x
      let dy = tip.y - start.y
      if (checkReversal(dx, dy, -0.18)) {
        const angle = Math.atan2(Math.abs(dy), Math.abs(dx))
        if (angle < (6 * Math.PI) / 180) dy = 0
        else if (Math.abs(angle - Math.PI / 2) < (6 * Math.PI) / 180) dx = 0
        return {
          kind: 'arrow',
          x: Math.round(start.x),
          y: Math.round(start.y),
          w: Math.round(dx),
          h: Math.round(dy),
          confidence: Math.min(0.97, straightness)
        }
      }
    }

    // 2. Curved arrow (clean single-arc quadratic Bezier shaft)
    if (
      fit.chordLen >= 34 &&
      fit.arcLen / Math.max(1, fit.chordLen) <= 2.35 &&
      Math.abs(fit.maxSagitta) >= sagittaLimit &&
      fit.fitErr <= 0.095 &&
      fit.consistentBend
    ) {
      const [cx, cy] = fit.controlPoint
      let tanX = tip.x - cx
      let tanY = tip.y - cy
      if (Math.hypot(tanX, tanY) < 1e-3 && shaftPts.length >= 2) {
        tanX = tip.x - shaftPts[shaftPts.length - 2].x
        tanY = tip.y - shaftPts[shaftPts.length - 2].y
      }
      if (checkReversal(tanX, tanY, -0.15)) {
        return {
          kind: 'curved-arrow',
          x: Math.round(start.x),
          y: Math.round(start.y),
          w: Math.round(tip.x - start.x),
          h: Math.round(tip.y - start.y),
          controlPoint: [Math.round(cx), Math.round(cy)],
          confidence: Math.max(0.84, Math.min(0.96, 1 - fit.fitErr * 2.2))
        }
      }
    }
  }

  return null
}

/** Merge near-duplicate or nearly-collinear vertices on a closed polygon */
function cleanClosedCorners(
  raw: Point2D[],
  diag: number,
  minEdgeFactor = 0.085,
  collinearCos = -0.9
): Point2D[] {
  if (raw.length < 3) return raw
  const pts = [...raw]
  const minEdge = Math.max(8, diag * minEdgeFactor)
  if (pts.length > 3 && dist(pts[0], pts[pts.length - 1]) < Math.max(minEdge * 1.15, diag * 0.12)) {
    pts.pop()
  }

  const merged: Point2D[] = []
  for (const p of pts) {
    if (merged.length === 0 || dist(merged[merged.length - 1], p) >= minEdge) {
      merged.push(p)
    }
  }
  if (merged.length > 3 && dist(merged[0], merged[merged.length - 1]) < minEdge) {
    merged.pop()
  }

  let changed = true
  const poly = [...merged]
  while (changed && poly.length > 3) {
    changed = false
    for (let i = 0; i < poly.length; i++) {
      const prev = poly[(i - 1 + poly.length) % poly.length]
      const cur = poly[i]
      const next = poly[(i + 1) % poly.length]
      const v1x = prev.x - cur.x
      const v1y = prev.y - cur.y
      const v2x = next.x - cur.x
      const v2y = next.y - cur.y
      const n1 = Math.hypot(v1x, v1y)
      const n2 = Math.hypot(v2x, v2y)
      if (n1 < 1e-3 || n2 < 1e-3) {
        poly.splice(i, 1)
        changed = true
        break
      }
      const cosA = (v1x * v2x + v1y * v2y) / (n1 * n2)
      if (cosA < collinearCos) {
        poly.splice(i, 1)
        changed = true
        break
      }
    }
  }
  return poly
}

function isConvexPolygon(poly: Point2D[]): boolean {
  if (poly.length < 3) return false
  let sign = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const c = poly[(i + 2) % poly.length]
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
    if (Math.abs(cross) < 1e-3) continue
    const s = cross > 0 ? 1 : -1
    if (sign === 0) sign = s
    else if (sign !== s) return false
  }
  return sign !== 0
}

function polygonFitError(pts: Point2D[], poly: Point2D[], diag: number): number {
  if (poly.length < 3 || pts.length === 0) return Infinity
  let sum = 0
  for (const p of pts) {
    let best = Infinity
    for (let i = 0; i < poly.length; i++) {
      const d = pointToLineDist(p, poly[i], poly[(i + 1) % poly.length])
      if (d < best) best = d
    }
    sum += best
  }
  return sum / (pts.length * Math.max(1, diag * 0.5))
}

function cornerSharpnessRatio(uni: Point2D[], poly: Point2D[]): number {
  const n = uni.length
  if (n < 24 || poly.length < 3) return 1

  const step = 3
  const turns: number[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const prev = uni[(i - step + n) % n]
    const cur = uni[i]
    const next = uni[(i + step) % n]
    const v1x = cur.x - prev.x
    const v1y = cur.y - prev.y
    const v2x = next.x - cur.x
    const v2y = next.y - cur.y
    const l1 = Math.hypot(v1x, v1y)
    const l2 = Math.hypot(v2x, v2y)
    if (l1 < 1e-4 || l2 < 1e-4) {
      turns[i] = 0
    } else {
      const cosT = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (l1 * l2)))
      turns[i] = Math.acos(cosT)
    }
  }

  const vertexIndices: number[] = []
  for (const v of poly) {
    let bestIdx = 0
    let bestD = Infinity
    for (let i = 0; i < n; i++) {
      const d = dist(uni[i], v)
      if (d < bestD) {
        bestD = d
        bestIdx = i
      }
    }
    vertexIndices.push(bestIdx)
  }

  const circDist = (a: number, b: number): number => {
    const d = Math.abs(a - b)
    return Math.min(d, n - d)
  }

  const vertexTurns: number[] = []
  for (const vi of vertexIndices) {
    let peak = 0
    for (let off = -2; off <= 2; off++) {
      peak = Math.max(peak, turns[(vi + off + n) % n])
    }
    vertexTurns.push(peak)
  }

  const interiorTurns: number[] = []
  for (let i = 0; i < n; i++) {
    if (vertexIndices.every((vi) => circDist(i, vi) >= 4)) {
      interiorTurns.push(turns[i])
    }
  }
  if (interiorTurns.length === 0) return 1

  vertexTurns.sort((a, b) => a - b)
  interiorTurns.sort((a, b) => a - b)
  const medVertex = vertexTurns[Math.floor(vertexTurns.length / 2)]
  const medInterior = interiorTurns[Math.floor(interiorTurns.length / 2)]
  return medVertex / Math.max(0.03, medInterior)
}

function countRadialPeaksLocal(radii: number[], threshold: number): number {
  if (radii.length < 16) return 0
  let peaks = 0
  let firstIdx = -1
  let lastIdx = -10
  for (let i = 0; i < radii.length; i++) {
    const prev = radii[(i - 3 + radii.length) % radii.length]
    const curr = radii[i]
    const next = radii[(i + 3) % radii.length]
    if (
      curr >= prev &&
      curr > next &&
      curr > threshold &&
      i - lastIdx >= 8 &&
      (firstIdx === -1 || radii.length - i + firstIdx >= 8)
    ) {
      if (firstIdx === -1) firstIdx = i
      peaks++
      lastIdx = i
    }
  }
  return peaks
}

export interface ClassifiedClosedShape {
  kind: HoldSnapKind
  libraryId: string
  x: number
  y: number
  w: number
  h: number
  confidence: number
  isPerfectCircle?: boolean
}

/**
 * Classifies a closed geometric loop into polygons (triangle, rect, diamond, parallelogram,
 * trapezoid, pentagon, hexagon, hexagon-vertical, heptagon, octagon, star-5) or circle/ellipse.
 * Evaluates polygons before circles using pixel-normalized fit error and corner sharpness.
 */
export function classifyClosedGeometricShape(pts: Point2D[]): ClassifiedClosedShape | null {
  if (pts.length < 4) return null
  const b = computeBounds(pts)
  const diag = Math.hypot(b.w, b.h)
  const totalLen = polylineLength(pts)
  if (b.w < 18 || b.h < 18 || diag < 22 || totalLen < 28) return null

  const boxPerim = 2 * (b.w + b.h)
  if (totalLen > boxPerim * 1.48 || totalLen < boxPerim * 0.56) {
    return null
  }

  const uni = resamplePolyline(pts, 96)
  let signedArea = 0
  for (let i = 0; i < uni.length; i++) {
    const cur = uni[i]
    const nxt = uni[(i + 1) % uni.length]
    signedArea += cur.x * nxt.y - nxt.x * cur.y
  }
  const fillRatio = Math.abs(signedArea * 0.5) / Math.max(1, b.w * b.h)
  if (fillRatio < 0.24 || fillRatio > 1.08) return null

  const cx = (b.minX + b.maxX) / 2
  const cy = (b.minY + b.maxY) / 2
  const rx = Math.max(1, b.w / 2)
  const ry = Math.max(1, b.h / 2)
  const aspect = b.w / Math.max(1, b.h)

  const radii: number[] = []
  let meanR = 0
  let ellipsePixelErrSum = 0
  for (const p of uni) {
    const r = Math.hypot((p.x - cx) / rx, (p.y - cy) / ry)
    radii.push(r)
    meanR += r
    const dCenter = Math.hypot(p.x - cx, p.y - cy)
    ellipsePixelErrSum += r > 1e-4 ? (Math.abs(r - 1) * dCenter) / r : Math.min(rx, ry)
  }
  meanR /= radii.length
  const ellipseFitErr = ellipsePixelErrSum / (uni.length * Math.max(1, diag * 0.5))

  let radialVar = 0
  for (const r of radii) {
    const diff = r - meanR
    radialVar += diff * diff
  }
  radialVar /= radii.length

  const denoised = rdpSimplify(pts, Math.max(1.8, diag * 0.015))
  const cornersFine = cleanClosedCorners(
    rdpSimplify(denoised, Math.max(3.2, diag * 0.036)),
    diag,
    0.08,
    -0.945
  )
  const cornersCoarse = cleanClosedCorners(
    rdpSimplify(denoised, Math.max(5.5, diag * 0.062)),
    diag,
    0.1,
    -0.89
  )

  const minR = Math.min(...radii)
  const maxR = Math.max(...radii)
  const radialRange = (maxR - minR) / Math.max(1e-4, maxR)

  // 1. 5-Point Star (non-convex alternating peaks)
  if (
    cornersFine.length >= 8 &&
    cornersFine.length <= 12 &&
    !isConvexPolygon(cornersFine) &&
    fillRatio >= 0.24 &&
    fillRatio <= 0.58
  ) {
    const peaks = countRadialPeaksLocal(radii, meanR + 0.05)
    if (peaks === 5 && radialRange >= 0.25) {
      return {
        kind: 'star-5',
        libraryId: 'star-5',
        x: Math.round(b.minX),
        y: Math.round(b.minY),
        w: Math.round(b.w),
        h: Math.round(b.h),
        confidence: 0.86
      }
    }
  }

  // 2. Triangle (3 sharp corners)
  if (cornersCoarse.length === 3 && fillRatio >= 0.28 && fillRatio <= 0.68) {
    const err3 = polygonFitError(uni, cornersCoarse, diag)
    if (err3 < 0.13 && err3 < ellipseFitErr * 0.96) {
      const topVerts = cornersCoarse.filter((c) => c.y <= b.minY + b.h * 0.3)
      const botVerts = cornersCoarse.filter((c) => c.y >= b.maxY - b.h * 0.3)
      let triKind: HoldSnapKind = 'triangle'
      if (topVerts.length === 2 && botVerts.length === 1) {
        triKind = 'triangle-down'
      } else if (topVerts.length === 1 && Math.abs(topVerts[0].x - b.minX) < b.w * 0.22) {
        triKind = 'right-triangle'
      }
      return {
        kind: triKind,
        libraryId: triKind,
        x: Math.round(b.minX),
        y: Math.round(b.minY),
        w: Math.round(b.w),
        h: Math.round(b.h),
        confidence: Math.max(0.82, Math.min(0.97, 1 - err3 * 2.5))
      }
    }
  }

  // 3. 4-Sided Quadrilaterals (Diamond, Square/Rectangle, Parallelogram, Trapezoid)
  if (cornersCoarse.length === 4) {
    const err4 = polygonFitError(uni, cornersCoarse, diag)
    if (err4 < 0.13 && err4 < ellipseFitErr * 0.94) {
      const edgeMidpoints: Point2D[] = [
        { x: cx, y: b.minY },
        { x: b.maxX, y: cy },
        { x: cx, y: b.maxY },
        { x: b.minX, y: cy }
      ]
      const bboxCorners: Point2D[] = [
        { x: b.minX, y: b.minY },
        { x: b.maxX, y: b.minY },
        { x: b.maxX, y: b.maxY },
        { x: b.minX, y: b.maxY }
      ]
      const avgDistToSet = (targets: Point2D[]): number => {
        let sum = 0
        for (const c of cornersCoarse) {
          let best = Infinity
          for (const t of targets) {
            const d = dist(c, t)
            if (d < best) best = d
          }
          sum += best
        }
        return sum / 4
      }
      const midErr = avgDistToSet(edgeMidpoints)
      const cornerErr = avgDistToSet(bboxCorners)

      if (midErr < cornerErr * 0.85 && midErr < diag * 0.17) {
        return {
          kind: 'diamond',
          libraryId: 'rhombus',
          x: Math.round(b.minX),
          y: Math.round(b.minY),
          w: Math.round(b.w),
          h: Math.round(b.h),
          confidence: Math.max(0.84, Math.min(0.97, 1 - err4 * 2.5))
        }
      }

      const sortedY = [...cornersCoarse].sort((a, b2) => a.y - b2.y)
      const topP = sortedY.slice(0, 2).sort((a, b2) => a.x - b2.x)
      const botP = sortedY.slice(2, 4).sort((a, b2) => a.x - b2.x)
      const topW = topP[1].x - topP[0].x
      const botW = botP[1].x - botP[0].x
      const topFlat = Math.abs(topP[0].y - topP[1].y) < b.h * 0.25
      const botFlat = Math.abs(botP[0].y - botP[1].y) < b.h * 0.25
      const skew = Math.abs((topP[0].x + topP[1].x) / 2 - (botP[0].x + botP[1].x) / 2)

      if (topFlat && botFlat && Math.abs(topW - botW) < b.w * 0.26 && skew > b.w * 0.14) {
        return {
          kind: 'parallelogram',
          libraryId: 'parallelogram',
          x: Math.round(b.minX),
          y: Math.round(b.minY),
          w: Math.round(b.w),
          h: Math.round(b.h),
          confidence: 0.85
        }
      }
      if (
        topFlat &&
        botFlat &&
        topW < botW * 0.76 &&
        topP[0].x > b.minX + b.w * 0.08 &&
        topP[1].x < b.maxX - b.w * 0.08
      ) {
        return {
          kind: 'trapezoid',
          libraryId: 'trapezoid',
          x: Math.round(b.minX),
          y: Math.round(b.minY),
          w: Math.round(b.w),
          h: Math.round(b.h),
          confidence: 0.84
        }
      }

      if (cornerErr < diag * 0.22) {
        const isSquare = aspect >= 0.85 && aspect <= 1.18
        const side = Math.round((b.w + b.h) / 2)
        return {
          kind: 'rect',
          libraryId: isSquare ? 'square' : 'rectangle',
          x: isSquare ? Math.round(cx - side / 2) : Math.round(b.minX),
          y: isSquare ? Math.round(cy - side / 2) : Math.round(b.minY),
          w: isSquare ? side : Math.round(b.w),
          h: isSquare ? side : Math.round(b.h),
          confidence: Math.max(0.84, Math.min(0.98, 1 - err4 * 2.5))
        }
      }
    }
  }

  // 4. Higher Convex Polygons (Pentagon, Hexagon, Heptagon, Octagon) evaluated BEFORE Circle
  if (cornersFine.length >= 5 && cornersFine.length <= 8 && isConvexPolygon(cornersFine)) {
    const errPoly = polygonFitError(uni, cornersFine, diag)
    const sharpness = cornerSharpnessRatio(uni, cornersFine)
    const nSides = cornersFine.length

    if (errPoly < 0.085) {
      if (
        nSides === 5 &&
        fillRatio >= 0.5 &&
        fillRatio <= 0.88 &&
        (errPoly < ellipseFitErr * 0.88 || (sharpness >= 1.95 && errPoly < ellipseFitErr * 1.05))
      ) {
        return {
          kind: 'pentagon',
          libraryId: 'pentagon',
          x: Math.round(b.minX),
          y: Math.round(b.minY),
          w: Math.round(b.w),
          h: Math.round(b.h),
          confidence: Math.max(0.84, Math.min(0.95, 1 - errPoly * 2.5))
        }
      }

      if (
        nSides === 6 &&
        fillRatio >= 0.56 &&
        fillRatio <= 0.9 &&
        (errPoly < ellipseFitErr * 0.86 || (sharpness >= 2.05 && errPoly < ellipseFitErr * 1.02))
      ) {
        const sortedY = [...cornersFine].sort((a, b2) => a.y - b2.y)
        const isPointyTop =
          sortedY[1].y - sortedY[0].y > b.h * 0.1 &&
          sortedY[5].y - sortedY[4].y > b.h * 0.1 &&
          Math.abs(sortedY[0].x - cx) < b.w * 0.24 &&
          Math.abs(sortedY[5].x - cx) < b.w * 0.24
        const hexKind: HoldSnapKind = isPointyTop ? 'hexagon-vertical' : 'hexagon'
        return {
          kind: hexKind,
          libraryId: hexKind,
          x: Math.round(b.minX),
          y: Math.round(b.minY),
          w: Math.round(b.w),
          h: Math.round(b.h),
          confidence: Math.max(0.84, Math.min(0.95, 1 - errPoly * 2.5))
        }
      }

      if (
        nSides === 7 &&
        fillRatio >= 0.62 &&
        fillRatio <= 0.92 &&
        (errPoly < ellipseFitErr * 0.82 || (sharpness >= 2.15 && errPoly < ellipseFitErr * 0.98))
      ) {
        return {
          kind: 'heptagon',
          libraryId: 'heptagon',
          x: Math.round(b.minX),
          y: Math.round(b.minY),
          w: Math.round(b.w),
          h: Math.round(b.h),
          confidence: Math.max(0.83, Math.min(0.94, 1 - errPoly * 2.5))
        }
      }

      if (
        nSides === 8 &&
        fillRatio >= 0.66 &&
        fillRatio <= 0.93 &&
        (errPoly < ellipseFitErr * 0.82 || (sharpness >= 2.15 && errPoly < ellipseFitErr * 0.98))
      ) {
        return {
          kind: 'octagon',
          libraryId: 'octagon',
          x: Math.round(b.minX),
          y: Math.round(b.minY),
          w: Math.round(b.w),
          h: Math.round(b.h),
          confidence: Math.max(0.83, Math.min(0.94, 1 - errPoly * 2.5))
        }
      }
    }
  }

  // 5. Circle / Ellipse (only when no polygon won)
  if (radialVar < 0.032 && ellipseFitErr < 0.105 && fillRatio >= 0.58 && fillRatio <= 0.92) {
    const isCircle = aspect >= 0.82 && aspect <= 1.22
    const d = Math.round((b.w + b.h) / 2)
    return {
      kind: 'circle',
      libraryId: isCircle ? 'circle' : 'ellipse',
      x: isCircle ? Math.round(cx - d / 2) : Math.round(b.minX),
      y: isCircle ? Math.round(cy - d / 2) : Math.round(b.minY),
      w: isCircle ? d : Math.round(b.w),
      h: isCircle ? d : Math.round(b.h),
      confidence: Math.max(0.82, Math.min(0.98, 1 - radialVar * 6)),
      isPerfectCircle: isCircle
    }
  }

  return null
}

/**
 * Classifies a single freehand stroke during Hold-to-Snap into a crisp geometric primitive:
 * - Open strokes: straight `arrow` or `curved-arrow`, or straight `line` (> 0.90 straightness).
 * - Closed strokes: polygons (`triangle`, `rect`, `diamond`, `parallelogram`, `trapezoid`,
 *   `pentagon`, `hexagon`, `hexagon-vertical`, `heptagon`, `octagon`, `star-5`) or `circle`.
 */
export function classifyHoldStroke(rawPoints: InkPoint[] | Point2D[]): HoldSnapResult | null {
  if (!rawPoints || rawPoints.length < 4) return null

  const pts: Point2D[] = rawPoints.map((p) =>
    Array.isArray(p) ? { x: p[0], y: p[1] } : { x: p.x, y: p.y }
  )

  const totalLen = polylineLength(pts)
  const b = computeBounds(pts)
  const diag = Math.hypot(b.w, b.h)
  if (totalLen < 28 || diag < 22) return null

  const jitterEps = Math.max(1.8, diag * 0.015)
  const denoised = rdpSimplify(pts, jitterEps)

  const startToEnd = dist(pts[0], pts[pts.length - 1])
  const isClosed =
    b.w >= 18 &&
    b.h >= 18 &&
    totalLen > diag * 1.48 &&
    (startToEnd < totalLen * 0.22 || startToEnd < Math.max(28, diag * 0.3))

  if (!isClosed) {
    const arrow = detectSingleStrokeArrowOrCurvedArrow(denoised)
    if (arrow) {
      return {
        kind: arrow.kind,
        x: arrow.x,
        y: arrow.y,
        w: arrow.w,
        h: arrow.h,
        ...(arrow.controlPoint ? { controlPoint: arrow.controlPoint } : {}),
        confidence: arrow.confidence
      }
    }

    const directness = startToEnd / totalLen
    if (directness > 0.9) {
      let dx = pts[pts.length - 1].x - pts[0].x
      let dy = pts[pts.length - 1].y - pts[0].y
      const ang = Math.atan2(Math.abs(dy), Math.abs(dx))
      if (ang < (6 * Math.PI) / 180) dy = 0
      else if (Math.abs(ang - Math.PI / 2) < (6 * Math.PI) / 180) dx = 0
      return {
        kind: 'line',
        x: Math.round(pts[0].x),
        y: Math.round(pts[0].y),
        w: Math.round(dx),
        h: Math.round(dy),
        confidence: Math.min(0.98, directness)
      }
    }
    return null
  }

  const closed = classifyClosedGeometricShape(pts)
  if (!closed) return null
  return {
    kind: closed.kind,
    x: closed.x,
    y: closed.y,
    w: closed.w,
    h: closed.h,
    ...(closed.isPerfectCircle !== undefined ? { isPerfectCircle: closed.isPerfectCircle } : {}),
    confidence: closed.confidence
  }
}

/** Snaps an arrow, curved-arrow, or line's endpoints onto nearby existing shape edge anchors (N/E/S/W midpoints) */
export function snapConnectorToShapeAnchors(
  snapped: HoldSnapResult,
  existingShapes: ShapeNode[],
  tolerance = 28
): HoldSnapResult {
  if (snapped.kind !== 'line' && snapped.kind !== 'arrow' && snapped.kind !== 'curved-arrow') {
    return snapped
  }

  const anchors: Point2D[] = []
  for (const s of existingShapes) {
    const isConn =
      s.shape === 'line' ||
      s.shape === 'dashed-line' ||
      s.shape === 'arrow' ||
      s.shape === 'arrow-bidirectional' ||
      s.shape === 'polyline' ||
      s.shape === 'curved-arrow' ||
      s.shape === 'curved-line'
    if (isConn) continue
    const sx = s.w < 0 ? s.x + s.w : s.x
    const sy = s.h < 0 ? s.y + s.h : s.y
    const sw = Math.abs(s.w)
    const sh = Math.abs(s.h)
    anchors.push(
      { x: sx + sw / 2, y: sy },
      { x: sx + sw, y: sy + sh / 2 },
      { x: sx + sw / 2, y: sy + sh },
      { x: sx, y: sy + sh / 2 }
    )
  }

  if (anchors.length === 0) return snapped

  const findNearest = (pt: Point2D): Point2D => {
    let best = pt
    let bestD = tolerance
    for (const a of anchors) {
      const d = dist(pt, a)
      if (d < bestD) {
        bestD = d
        best = a
      }
    }
    return best
  }

  const origX2 = snapped.x + snapped.w
  const origY2 = snapped.y + snapped.h
  const p1 = findNearest({ x: snapped.x, y: snapped.y })
  const p2 = findNearest({ x: origX2, y: origY2 })

  let nextControlPoint = snapped.controlPoint
  if (snapped.controlPoint) {
    const shiftX = (p1.x - snapped.x + (p2.x - origX2)) / 2
    const shiftY = (p1.y - snapped.y + (p2.y - origY2)) / 2
    nextControlPoint = [
      Math.round(snapped.controlPoint[0] + shiftX),
      Math.round(snapped.controlPoint[1] + shiftY)
    ]
  }

  return {
    ...snapped,
    x: Math.round(p1.x),
    y: Math.round(p1.y),
    w: Math.round(p2.x - p1.x),
    h: Math.round(p2.y - p1.y),
    ...(nextControlPoint ? { controlPoint: nextControlPoint } : {})
  }
}

export function buildShapeNodeFromHoldSnap(
  snapped: HoldSnapResult,
  color: string,
  size: number,
  penType?: string
): ShapeNode {
  const shapeKind: ShapeKind =
    snapped.kind === 'line' && penType === 'dashed' ? 'dashed-line' : snapped.kind
  return {
    id: `hsnap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    shape: shapeKind,
    x: snapped.x,
    y: snapped.y,
    w: snapped.w,
    h: snapped.h,
    ...(snapped.controlPoint ? { controlPoint: snapped.controlPoint } : {}),
    borderRadius: snapped.kind === 'rect' ? 6 : undefined,
    color,
    fillColor: 'transparent',
    strokeWidth: Math.max(2, Math.min(6, Math.round(size * 0.85 * 10) / 10)),
    strokeStyle: penType === 'dashed' ? 'dashed' : 'solid'
  }
}
