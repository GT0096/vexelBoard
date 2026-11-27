import type { InkPoint, ShapeKind, ShapeNode, Stroke } from '../types/board'
import {
  classifyClosedGeometricShape,
  detectSingleStrokeArrowOrCurvedArrow,
  fitQuadraticBezierControlPoint,
  rdpSimplify,
  type Point2D
} from '../board/holdSnapClassifier'
import { getLibraryShape } from '../shapes/shapeLibrary'

/* ========================================================================== */
/* $P Point-Cloud + Geometric Hybrid Local Shape Recognizer (Zero LLM API!)   */
/* ========================================================================== */

export interface CloudPoint {
  x: number
  y: number
  strokeId: number
}

export interface LocalDetectedShape {
  shapeKind: ShapeKind
  libraryId: string
  x: number
  y: number
  w: number
  h: number
  controlPoint?: [number, number]
  confidence: number
  isConnector?: boolean
  isPerfectCircle?: boolean
}

export interface LocalLabelCluster {
  strokes: Stroke[]
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
  hostShapeIndex?: number
}

export interface LocalSelectionAnalysis {
  shapes: ShapeNode[]
  consumedStrokeIds: Set<string>
  labelClusters: LocalLabelCluster[]
  unclassifiedStrokes: Stroke[]
  isPureBasicShapesAndLabels: boolean
  isPureHandwriting: boolean
}

const NUM_CLOUD_POINTS = 48

function euclidean(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function cloudPathLength(points: CloudPoint[]): number {
  let d = 0
  for (let i = 1; i < points.length; i++) {
    if (points[i].strokeId === points[i - 1].strokeId) {
      d += euclidean(points[i - 1], points[i])
    }
  }
  return d
}

function resampleCloud(points: CloudPoint[], n = NUM_CLOUD_POINTS): CloudPoint[] {
  if (points.length === 0) return []
  const total = cloudPathLength(points)
  if (total < 1e-4) {
    return Array.from({ length: n }, () => ({ ...points[0] }))
  }
  const interval = total / (n - 1)
  let acc = 0
  const src = points.map((p) => ({ ...p }))
  const out: CloudPoint[] = [{ ...src[0] }]

  for (let i = 1; i < src.length; i++) {
    if (src[i].strokeId === src[i - 1].strokeId) {
      const d = euclidean(src[i - 1], src[i])
      if (acc + d >= interval && d > 1e-6) {
        const qx = src[i - 1].x + ((interval - acc) / d) * (src[i].x - src[i - 1].x)
        const qy = src[i - 1].y + ((interval - acc) / d) * (src[i].y - src[i - 1].y)
        const q: CloudPoint = { x: qx, y: qy, strokeId: src[i].strokeId }
        out.push(q)
        src.splice(i, 0, q)
        acc = 0
      } else {
        acc += d
      }
    }
  }
  while (out.length < n) {
    const last = src[src.length - 1]
    out.push({ ...last })
  }
  return out.slice(0, n)
}

function normalizeCloud(points: CloudPoint[]): CloudPoint[] {
  const resampled = resampleCloud(points, NUM_CLOUD_POINTS)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of resampled) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  const scale = Math.max(maxX - minX, maxY - minY, 1e-4)
  let cx = 0
  let cy = 0
  const scaled = resampled.map((p) => {
    const nx = (p.x - minX) / scale
    const ny = (p.y - minY) / scale
    cx += nx
    cy += ny
    return { x: nx, y: ny, strokeId: p.strokeId }
  })
  cx /= scaled.length
  cy /= scaled.length
  return scaled.map((p) => ({ x: p.x - cx, y: p.y - cy, strokeId: p.strokeId }))
}

function cloudDistance(pts1: CloudPoint[], pts2: CloudPoint[], start: number): number {
  const n = pts1.length
  const matched = new Uint8Array(n)
  let sum = 0
  let i = start
  do {
    let idx = -1
    let minD = Infinity
    for (let j = 0; j < n; j++) {
      if (!matched[j]) {
        const d = euclidean(pts1[i], pts2[j])
        if (d < minD) {
          minD = d
          idx = j
        }
      }
    }
    if (idx >= 0) matched[idx] = 1
    const weight = 1 - ((i - start + n) % n) / n
    sum += weight * (minD === Infinity ? 0 : minD)
    i = (i + 1) % n
  } while (i !== start)
  return sum
}

function greedyCloudMatch(pts1: CloudPoint[], pts2: CloudPoint[]): number {
  const n = pts1.length
  const step = Math.max(1, Math.floor(Math.pow(n, 0.5)))
  let min = Infinity
  for (let i = 0; i < n; i += step) {
    const d1 = cloudDistance(pts1, pts2, i)
    const d2 = cloudDistance(pts2, pts1, i)
    min = Math.min(min, d1, d2)
  }
  return min
}

interface CloudTemplate {
  name: string
  shapeKind: ShapeKind
  points: CloudPoint[]
}

function makePolygonTemplate(
  name: string,
  shapeKind: ShapeKind,
  vertices: Array<[number, number]>
): CloudTemplate {
  const raw: CloudPoint[] = []
  for (let i = 0; i < vertices.length; i++) {
    const [x1, y1] = vertices[i]
    const [x2, y2] = vertices[(i + 1) % vertices.length]
    for (let s = 0; s < 16; s++) {
      const t = s / 16
      raw.push({ x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t, strokeId: 1 })
    }
  }
  return { name, shapeKind, points: normalizeCloud(raw) }
}

function buildTemplates(): CloudTemplate[] {
  const list: CloudTemplate[] = []

  // Circle
  const circlePts: CloudPoint[] = []
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2
    circlePts.push({ x: Math.cos(a) * 50, y: Math.sin(a) * 50, strokeId: 1 })
  }
  list.push({ name: 'circle', shapeKind: 'circle', points: normalizeCloud(circlePts) })

  // Square / Rectangle
  list.push(
    makePolygonTemplate('square', 'rect', [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100]
    ])
  )
  list.push(
    makePolygonTemplate('rectangle', 'rect', [
      [0, 0],
      [160, 0],
      [160, 90],
      [0, 90]
    ])
  )

  // Triangles
  list.push(
    makePolygonTemplate('triangle', 'triangle', [
      [50, 0],
      [100, 88],
      [0, 88]
    ])
  )
  list.push(
    makePolygonTemplate('triangle-down', 'triangle-down', [
      [0, 0],
      [100, 0],
      [50, 88]
    ])
  )
  list.push(
    makePolygonTemplate('right-triangle', 'right-triangle', [
      [0, 0],
      [0, 100],
      [100, 100]
    ])
  )

  // Diamond / Rhombus
  list.push(
    makePolygonTemplate('rhombus', 'diamond', [
      [50, 0],
      [100, 50],
      [50, 100],
      [0, 50]
    ])
  )

  // Pentagon, Hexagon, Heptagon & Octagon
  const regPoly = (sides: number, rot = -Math.PI / 2): Array<[number, number]> =>
    Array.from({ length: sides }, (_, i) => {
      const a = rot + (i / sides) * Math.PI * 2
      return [50 + Math.cos(a) * 50, 50 + Math.sin(a) * 50]
    })
  list.push(makePolygonTemplate('pentagon', 'pentagon', regPoly(5)))
  list.push(makePolygonTemplate('hexagon', 'hexagon', regPoly(6, 0)))
  list.push(makePolygonTemplate('heptagon', 'heptagon', regPoly(7)))
  list.push(makePolygonTemplate('octagon', 'octagon', regPoly(8, Math.PI / 8)))

  // 5-Point Star
  const star5: Array<[number, number]> = []
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i / 10) * Math.PI * 2
    const r = i % 2 === 0 ? 50 : 21
    star5.push([50 + Math.cos(a) * r, 50 + Math.sin(a) * r])
  }
  list.push(makePolygonTemplate('star-5', 'star-5', star5))

  // Parallelogram & Trapezoid
  list.push(
    makePolygonTemplate('parallelogram', 'parallelogram', [
      [25, 0],
      [125, 0],
      [100, 80],
      [0, 80]
    ])
  )
  list.push(
    makePolygonTemplate('trapezoid', 'trapezoid', [
      [22, 0],
      [78, 0],
      [100, 75],
      [0, 75]
    ])
  )

  return list
}

let cachedTemplates: CloudTemplate[] | null = null
function getTemplates(): CloudTemplate[] {
  if (!cachedTemplates) cachedTemplates = buildTemplates()
  return cachedTemplates
}

/** Matches normalized $P point cloud against canonical shape templates */
export function matchPointCloudShape(
  strokes: Array<InkPoint[] | Point2D[]>
): { name: string; shapeKind: ShapeKind; score: number } | null {
  const cloud: CloudPoint[] = []
  strokes.forEach((pts, sIdx) => {
    for (const p of pts) {
      const x = Array.isArray(p) ? p[0] : p.x
      const y = Array.isArray(p) ? p[1] : p.y
      cloud.push({ x, y, strokeId: sIdx + 1 })
    }
  })
  if (cloud.length < 6) return null
  const candidate = normalizeCloud(cloud)
  let best: CloudTemplate | null = null
  let bestDist = Infinity
  for (const tpl of getTemplates()) {
    const d = greedyCloudMatch(candidate, tpl.points)
    if (d < bestDist) {
      bestDist = d
      best = tpl
    }
  }
  if (!best) return null
  // Convert $P distance into 0..1 confidence score
  const score = Math.max(0, Math.min(1, (2.4 - bestDist) / 2.0))
  return { name: best.name, shapeKind: best.shapeKind, score }
}

function pointToSegDist(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l2 = dx * dx + dy * dy
  if (l2 < 1e-6) return Math.hypot(p.x - a.x, p.y - a.y)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/**
 * High-precision local single-stroke shape detector (Zero LLM API).
 * Recognizes: line, arrow, curved-arrow, circle, ellipse, square, rectangle,
 * triangle, triangle-down, right-triangle, diamond/rhombus, pentagon, hexagon,
 * hexagon-vertical, heptagon, octagon, star-5, parallelogram, trapezoid.
 */
export function detectLocalBasicShape(rawPoints: InkPoint[]): LocalDetectedShape | null {
  if (!rawPoints || rawPoints.length < 4) return null

  const pts: Point2D[] = rawPoints.map(([x, y]) => ({ x, y }))
  let totalLen = 0
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
    if (i > 0) totalLen += Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y)
  }

  const w = maxX - minX
  const h = maxY - minY
  const diag = Math.hypot(w, h)
  if (totalLen < 28 || diag < 20) return null

  const start = pts[0]
  const end = pts[pts.length - 1]
  const startToEnd = Math.hypot(end.x - start.x, end.y - start.y)

  // Allow natural hand-drawn loop closure (gap up to 22% of path length or 30% of diagonal)
  const isClosed =
    w >= 18 &&
    h >= 18 &&
    totalLen > diag * 1.48 &&
    (startToEnd < totalLen * 0.22 || startToEnd < Math.max(28, diag * 0.3))

  const denoised = rdpSimplify(pts, Math.max(1.8, diag * 0.015))

  if (!isClosed) {
    // 1. Single-stroke straight arrow or curved-arrow (1-barb or 2-barb)
    const arrow = detectSingleStrokeArrowOrCurvedArrow(denoised)
    if (arrow) {
      return {
        shapeKind: arrow.kind,
        libraryId: arrow.kind,
        x: arrow.x,
        y: arrow.y,
        w: arrow.w,
        h: arrow.h,
        ...(arrow.controlPoint ? { controlPoint: arrow.controlPoint } : {}),
        confidence: arrow.confidence,
        isConnector: true
      }
    }

    // 2. Straight line check (high directness + low perpendicular deviation)
    const directness = startToEnd / totalLen
    if (directness >= 0.91 && diag >= 26) {
      let maxDev = 0
      for (const p of pts) {
        maxDev = Math.max(maxDev, pointToSegDist(p, start, end))
      }
      if (maxDev <= Math.max(9, diag * 0.075)) {
        let dx = end.x - start.x
        let dy = end.y - start.y
        const ang = Math.atan2(Math.abs(dy), Math.abs(dx))
        if (ang < (5.5 * Math.PI) / 180) dy = 0
        else if (Math.abs(ang - Math.PI / 2) < (5.5 * Math.PI) / 180) dx = 0
        return {
          shapeKind: 'line',
          libraryId: 'line',
          x: Math.round(start.x),
          y: Math.round(start.y),
          w: Math.round(dx),
          h: Math.round(dy),
          confidence: Math.min(0.98, directness),
          isConnector: true
        }
      }
    }
    return null
  }

  // Closed shape geometric classification (polygons evaluated before circles)
  const closed = classifyClosedGeometricShape(pts)
  if (closed) {
    const resolvedKind: ShapeKind =
      closed.kind === 'circle' ||
      closed.kind === 'rect' ||
      closed.kind === 'diamond' ||
      closed.kind === 'triangle' ||
      closed.kind === 'parallelogram' ||
      getLibraryShape(closed.libraryId)
        ? (closed.kind as ShapeKind)
        : 'rect'
    return {
      shapeKind: resolvedKind,
      libraryId: closed.libraryId,
      x: closed.x,
      y: closed.y,
      w: closed.w,
      h: closed.h,
      confidence: closed.confidence,
      ...(closed.isPerfectCircle !== undefined ? { isPerfectCircle: closed.isPerfectCircle } : {})
    }
  }

  // Fallback to strict $P point-cloud match only for borderline non-circular polygons
  const boxPerim = 2 * (w + h)
  if (totalLen > boxPerim * 1.48 || totalLen < boxPerim * 0.56) {
    return null
  }
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const rx = Math.max(1, w / 2)
  const ry = Math.max(1, h / 2)
  const radii = pts.map((p) => Math.hypot((p.x - cx) / rx, (p.y - cy) / ry))
  const meanR = radii.reduce((a, r) => a + r, 0) / radii.length
  const radialVar = radii.reduce((a, r) => a + (r - meanR) * (r - meanR), 0) / radii.length
  const aspect = w / Math.max(1, h)

  const cloudMatch = matchPointCloudShape([rawPoints])
  if (cloudMatch && cloudMatch.score >= 0.82 && (cloudMatch.name !== 'circle' || radialVar < 0.025)) {
    const isSq = cloudMatch.name === 'square' && aspect >= 0.84 && aspect <= 1.18
    const side = Math.round((w + h) / 2)
    return {
      shapeKind: cloudMatch.shapeKind,
      libraryId: cloudMatch.name,
      x: isSq ? Math.round(cx - side / 2) : Math.round(minX),
      y: isSq ? Math.round(cy - side / 2) : Math.round(minY),
      w: isSq ? side : Math.round(w),
      h: isSq ? side : Math.round(h),
      confidence: cloudMatch.score
    }
  }

  return null
}

interface AnalyzedArrowShaft {
  isCurved: boolean
  start: Point2D
  end: Point2D
  arcLen: number
  controlPoint?: [number, number]
  /** Forward unit tangent arriving at `end` */
  endTangent: Point2D
  /** Forward unit tangent arriving at `start` (pointing outward from shaft at `start`) */
  startTangent: Point2D
}

function normVec2(x: number, y: number): Point2D {
  const n = Math.hypot(x, y)
  return n > 1e-4 ? { x: x / n, y: y / n } : { x: 1, y: 0 }
}

function analyzeOpenArrowShaft(rawPoints: InkPoint[]): AnalyzedArrowShaft | null {
  if (!rawPoints || rawPoints.length < 2) return null
  const pts: Point2D[] = rawPoints.map(([x, y]) => ({ x, y }))
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let totalLen = 0
  for (let i = 0; i < pts.length; i++) {
    minX = Math.min(minX, pts[i].x)
    minY = Math.min(minY, pts[i].y)
    maxX = Math.max(maxX, pts[i].x)
    maxY = Math.max(maxY, pts[i].y)
    if (i > 0) totalLen += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  }
  const w = maxX - minX
  const h = maxY - minY
  const diag = Math.hypot(w, h)
  const start = pts[0]
  const end = pts[pts.length - 1]
  const startToEnd = Math.hypot(end.x - start.x, end.y - start.y)

  const isClosed =
    w >= 18 &&
    h >= 18 &&
    totalLen > diag * 1.48 &&
    (startToEnd < totalLen * 0.22 || startToEnd < Math.max(28, diag * 0.3))
  if (isClosed) return null

  const fit = fitQuadraticBezierControlPoint(pts)
  const straightness = fit.chordLen / Math.max(1, fit.arcLen)
  const sagittaLimit = Math.max(14, fit.chordLen * 0.12)

  if (fit.chordLen >= 30 && straightness >= 0.89 && Math.abs(fit.maxSagitta) < sagittaLimit) {
    return {
      isCurved: false,
      start,
      end,
      arcLen: fit.arcLen,
      endTangent: normVec2(end.x - start.x, end.y - start.y),
      startTangent: normVec2(start.x - end.x, start.y - end.y)
    }
  }

  if (
    fit.chordLen >= 34 &&
    fit.arcLen / Math.max(1, fit.chordLen) <= 2.35 &&
    Math.abs(fit.maxSagitta) >= sagittaLimit &&
    fit.fitErr <= 0.095 &&
    fit.consistentBend
  ) {
    const [cx, cy] = fit.controlPoint
    const endDx = Math.hypot(end.x - cx, end.y - cy) > 1e-3 ? end.x - cx : end.x - start.x
    const endDy = Math.hypot(end.x - cx, end.y - cy) > 1e-3 ? end.y - cy : end.y - start.y
    const startDx = Math.hypot(start.x - cx, start.y - cy) > 1e-3 ? start.x - cx : start.x - end.x
    const startDy = Math.hypot(start.x - cx, start.y - cy) > 1e-3 ? start.y - cy : start.y - end.y
    return {
      isCurved: true,
      start,
      end,
      arcLen: fit.arcLen,
      controlPoint: [Math.round(cx), Math.round(cy)],
      endTangent: normVec2(endDx, endDy),
      startTangent: normVec2(startDx, startDy)
    }
  }

  return null
}

/**
 * Detects multi-stroke arrows (straight & curved, 2-stroke V-head & 3-stroke 2-barb),
 * multi-stroke closed polygons (3..8 straight strokes), and single-stroke shapes/connectors
 * while protecting handwritten `l`, `i`, `o` strokes from false snapping.
 */
export function analyzeSelectionLocally(
  strokes: Stroke[],
  existingShapes: ShapeNode[] = []
): LocalSelectionAnalysis {
  const consumedStrokeIds = new Set<string>()
  const shapes: ShapeNode[] = [...existingShapes]
  const now = Date.now()
  let seq = 0

  interface StrokeGeomBox {
    st: Stroke
    minX: number
    minY: number
    maxX: number
    maxY: number
    w: number
    h: number
    cx: number
    cy: number
    diag: number
  }

  const strokeBoxes: StrokeGeomBox[] = strokes.map((st) => {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const [x, y] of st.points) {
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
    if (!Number.isFinite(minX)) {
      minX = minY = maxX = maxY = 0
    }
    const w = maxX - minX
    const h = maxY - minY
    return {
      st,
      minX,
      minY,
      maxX,
      maxY,
      w,
      h,
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
      diag: Math.hypot(w, h)
    }
  })

  const findArrowheadAtTip = (
    shaftIdx: number,
    tip: Point2D,
    fwdTan: Point2D,
    shaftArcLen: number,
    extraExcludedIds?: Set<string>
  ): number[] => {
    const tol = Math.max(26, shaftArcLen * 0.22)

    // A) 2-stroke V-chevron / curve arrowhead
    for (let j = 0; j < strokes.length; j++) {
      if (j === shaftIdx) continue
      const head = strokes[j]
      if (consumedStrokeIds.has(head.id) || extraExcludedIds?.has(head.id) || head.points.length < 3) {
        continue
      }
      const hb = strokeBoxes[j]
      if (hb.diag < 9 || hb.diag > shaftArcLen * 0.65) continue

      let minDistToTip = Infinity
      for (const [px, py] of head.points) {
        const d = Math.hypot(px - tip.x, py - tip.y)
        if (d < minDistToTip) minDistToTip = d
      }
      if (minDistToTip > tol) continue

      // Check that the head's arms sweep backward relative to fwdTan and have perpendicular spread
      const headPts: Point2D[] = head.points.map(([x, y]) => ({ x, y }))
      const simpHead = rdpSimplify(headPts, Math.max(2, hb.diag * 0.08))
      let backwardHits = 0
      let minPerp = Infinity
      let maxPerp = -Infinity
      for (const hp of simpHead) {
        const dx = hp.x - tip.x
        const dy = hp.y - tip.y
        const d = Math.hypot(dx, dy)
        const perp = fwdTan.x * dy - fwdTan.y * dx
        minPerp = Math.min(minPerp, perp)
        maxPerp = Math.max(maxPerp, perp)
        if (d >= 5) {
          const cos = (dx * fwdTan.x + dy * fwdTan.y) / d
          if (cos < 0.2) backwardHits++
        }
      }
      if (simpHead.length >= 3 && simpHead.length <= 5 && backwardHits >= 2 && maxPerp - minPerp >= 6) {
        return [j]
      }
    }

    // B) 3-stroke 2-barb arrowhead (two short strokes meeting near tip on opposite sides)
    interface BarbCand {
      idx: number
      cross: number
      distToTip: number
    }
    const barbs: BarbCand[] = []
    for (let j = 0; j < strokes.length; j++) {
      if (j === shaftIdx) continue
      const barb = strokes[j]
      if (consumedStrokeIds.has(barb.id) || extraExcludedIds?.has(barb.id) || barb.points.length < 2) {
        continue
      }
      let len = 0
      for (let k = 1; k < barb.points.length; k++) {
        len += Math.hypot(
          barb.points[k][0] - barb.points[k - 1][0],
          barb.points[k][1] - barb.points[k - 1][1]
        )
      }
      if (len < 8 || len > shaftArcLen * 0.55) continue
      const p0 = { x: barb.points[0][0], y: barb.points[0][1] }
      const p1 = {
        x: barb.points[barb.points.length - 1][0],
        y: barb.points[barb.points.length - 1][1]
      }
      const chord = Math.hypot(p1.x - p0.x, p1.y - p0.y)
      if (chord < 6 || chord / len < 0.76) continue

      const d0 = Math.hypot(p0.x - tip.x, p0.y - tip.y)
      const d1 = Math.hypot(p1.x - tip.x, p1.y - tip.y)
      const minD = Math.min(d0, d1)
      if (minD > tol) continue

      const nearPt = d0 <= d1 ? p0 : p1
      const farPt = d0 <= d1 ? p1 : p0
      const away = normVec2(farPt.x - nearPt.x, farPt.y - nearPt.y)
      const cos = fwdTan.x * away.x + fwdTan.y * away.y
      if (cos >= -0.12) continue

      const cross = fwdTan.x * away.y - fwdTan.y * away.x
      if (Math.abs(cross) < 0.15) continue
      barbs.push({ idx: j, cross, distToTip: minD })
    }

    if (barbs.length >= 2) {
      barbs.sort((a, b) => a.distToTip - b.distToTip)
      for (let a = 0; a < barbs.length; a++) {
        for (let b = a + 1; b < barbs.length; b++) {
          if (barbs[a].cross * barbs[b].cross < 0) {
            return [barbs[a].idx, barbs[b].idx]
          }
        }
      }
    }

    return []
  }

  // Step 1: Detect multi-stroke straight & curved arrows (2-stroke V-head or 3-stroke 2-barb)
  for (let i = 0; i < strokes.length; i++) {
    const shaft = strokes[i]
    if (consumedStrokeIds.has(shaft.id) || shaft.points.length < 2) continue
    const analyzed = analyzeOpenArrowShaft(shaft.points)
    if (!analyzed) continue

    const endHeadIdxs = findArrowheadAtTip(i, analyzed.end, analyzed.endTangent, analyzed.arcLen)
    const endExcl = new Set(endHeadIdxs.map((idx) => strokes[idx].id))
    const startHeadIdxs = findArrowheadAtTip(
      i,
      analyzed.start,
      analyzed.startTangent,
      analyzed.arcLen,
      endExcl
    )

    if (endHeadIdxs.length === 0 && startHeadIdxs.length === 0) continue

    consumedStrokeIds.add(shaft.id)
    for (const idx of endHeadIdxs) consumedStrokeIds.add(strokes[idx].id)
    for (const idx of startHeadIdxs) consumedStrokeIds.add(strokes[idx].id)

    const hasEnd = endHeadIdxs.length > 0
    const hasStart = startHeadIdxs.length > 0
    const strokeWidth = Math.max(2, Math.min(6, Math.round((shaft.size || 3) * 0.85 * 10) / 10))
    const strokeStyle = shaft.penType === 'dashed' ? 'dashed' : 'solid'

    if (analyzed.isCurved) {
      const from = !hasEnd && hasStart ? analyzed.end : analyzed.start
      const to = !hasEnd && hasStart ? analyzed.start : analyzed.end
      shapes.push({
        id: `lshp-${now}-${seq++}`,
        shape: 'curved-arrow',
        x: Math.round(from.x),
        y: Math.round(from.y),
        w: Math.round(to.x - from.x),
        h: Math.round(to.y - from.y),
        ...(analyzed.controlPoint ? { controlPoint: analyzed.controlPoint } : {}),
        arrowEnd: true,
        ...(hasEnd && hasStart ? { arrowStart: true } : {}),
        color: shaft.color || 'ink',
        fillColor: 'transparent',
        strokeWidth,
        strokeStyle
      })
    } else {
      const from = !hasEnd && hasStart ? analyzed.end : analyzed.start
      const to = !hasEnd && hasStart ? analyzed.start : analyzed.end
      shapes.push({
        id: `lshp-${now}-${seq++}`,
        shape: hasEnd && hasStart ? 'arrow-bidirectional' : 'arrow',
        x: Math.round(from.x),
        y: Math.round(from.y),
        w: Math.round(to.x - from.x),
        h: Math.round(to.y - from.y),
        color: shaft.color || 'ink',
        fillColor: 'transparent',
        strokeWidth,
        strokeStyle
      })
    }
  }

  // Step 1B: Detect multi-stroke closed polygons (3..8 separate straight line strokes forming a closed loop)
  interface LineSegInfo {
    strokeIdx: number
    endpoints: [Point2D, Point2D]
    len: number
  }
  const lineSegs: LineSegInfo[] = []
  for (let i = 0; i < strokes.length; i++) {
    const st = strokes[i]
    if (consumedStrokeIds.has(st.id) || st.points.length < 2) continue
    const b = strokeBoxes[i]
    if (b.diag < 22) continue
    let len = 0
    for (let k = 1; k < st.points.length; k++) {
      len += Math.hypot(st.points[k][0] - st.points[k - 1][0], st.points[k][1] - st.points[k - 1][1])
    }
    const p0 = { x: st.points[0][0], y: st.points[0][1] }
    const p1 = { x: st.points[st.points.length - 1][0], y: st.points[st.points.length - 1][1] }
    const chord = Math.hypot(p1.x - p0.x, p1.y - p0.y)
    if (chord < 20 || chord / Math.max(1, len) < 0.88) continue
    let maxDev = 0
    for (const [px, py] of st.points) {
      maxDev = Math.max(maxDev, pointToSegDist({ x: px, y: py }, p0, p1))
    }
    if (maxDev <= Math.max(10, b.diag * 0.08)) {
      lineSegs.push({ strokeIdx: i, endpoints: [p0, p1], len })
    }
  }

  if (lineSegs.length >= 3 && lineSegs.length <= 40) {
    const segConsumed = new Set<number>()

    const endpointsMatch = (a: Point2D, b: Point2D, lenA: number, lenB: number): boolean => {
      const tol = Math.max(22, Math.min(lenA, lenB) * 0.42)
      return Math.hypot(a.x - b.x, a.y - b.y) <= tol
    }

    for (let startSeg = 0; startSeg < lineSegs.length; startSeg++) {
      if (segConsumed.has(startSeg) || consumedStrokeIds.has(strokes[lineSegs[startSeg].strokeIdx].id)) {
        continue
      }

      const startEndPt = lineSegs[startSeg].endpoints[0]
      let foundCycle: Array<{ segIdx: number; enterEnd: 0 | 1 }> | null = null

      const dfs = (
        curSeg: number,
        exitEnd: 0 | 1,
        path: Array<{ segIdx: number; enterEnd: 0 | 1 }>,
        visited: Set<number>
      ): void => {
        if (foundCycle) return
        const curPt = lineSegs[curSeg].endpoints[exitEnd]

        if (
          path.length >= 3 &&
          endpointsMatch(curPt, startEndPt, lineSegs[curSeg].len, lineSegs[startSeg].len)
        ) {
          foundCycle = [...path]
          return
        }
        if (path.length >= 8) return

        for (let nxt = 0; nxt < lineSegs.length; nxt++) {
          if (visited.has(nxt) || segConsumed.has(nxt)) continue
          if (consumedStrokeIds.has(strokes[lineSegs[nxt].strokeIdx].id)) continue
          const sNxt = lineSegs[nxt]
          for (const enterEnd of [0, 1] as const) {
            if (endpointsMatch(curPt, sNxt.endpoints[enterEnd], lineSegs[curSeg].len, sNxt.len)) {
              visited.add(nxt)
              path.push({ segIdx: nxt, enterEnd })
              dfs(nxt, enterEnd === 0 ? 1 : 0, path, visited)
              path.pop()
              visited.delete(nxt)
              if (foundCycle) return
            }
          }
        }
      }

      const visited = new Set<number>([startSeg])
      dfs(startSeg, 1, [{ segIdx: startSeg, enterEnd: 0 }], visited)

      if (foundCycle) {
        const cycle = foundCycle as Array<{ segIdx: number; enterEnd: 0 | 1 }>
        const polyPts: Point2D[] = []
        let minX = Infinity
        let minY = Infinity
        let maxX = -Infinity
        let maxY = -Infinity

        for (const step of cycle) {
          const seg = lineSegs[step.segIdx]
          const a = seg.endpoints[step.enterEnd]
          const b = seg.endpoints[step.enterEnd === 0 ? 1 : 0]
          for (let s = 0; s < 10; s++) {
            const t = s / 10
            const px = a.x + (b.x - a.x) * t
            const py = a.y + (b.y - a.y) * t
            polyPts.push({ x: px, y: py })
            minX = Math.min(minX, px)
            minY = Math.min(minY, py)
            maxX = Math.max(maxX, px)
            maxY = Math.max(maxY, py)
          }
        }
        if (polyPts.length > 0) polyPts.push({ ...polyPts[0] })

        const cw = maxX - minX
        const ch = maxY - minY
        if (cw >= 32 && ch >= 32 && Math.hypot(cw, ch) >= 48) {
          const classified = classifyClosedGeometricShape(polyPts)
          if (classified && classified.kind !== 'circle') {
            for (const step of cycle) {
              segConsumed.add(step.segIdx)
              consumedStrokeIds.add(strokes[lineSegs[step.segIdx].strokeIdx].id)
            }
            const firstStroke = strokes[lineSegs[cycle[0].segIdx].strokeIdx]
            shapes.push({
              id: `lshp-${now}-${seq++}`,
              shape: classified.kind as ShapeKind,
              x: classified.x,
              y: classified.y,
              w: classified.w,
              h: classified.h,
              borderRadius: classified.kind === 'rect' ? 6 : undefined,
              color: firstStroke.color || 'ink',
              fillColor: 'transparent',
              strokeWidth: Math.max(
                2,
                Math.min(6, Math.round((firstStroke.size || 3) * 0.85 * 10) / 10)
              ),
              strokeStyle: firstStroke.penType === 'dashed' ? 'dashed' : 'solid'
            })
          }
        }
      }
    }
  }

  // Step 2: Two-pass single-stroke detection with strong l / i / o handwriting protection
  const preDetected = strokeBoxes.map((b) =>
    consumedStrokeIds.has(b.st.id) ? null : detectLocalBasicShape(b.st.points)
  )

  const emitSingleStrokeShape = (item: StrokeGeomBox, det: LocalDetectedShape): void => {
    consumedStrokeIds.add(item.st.id)
    const shapeKind: ShapeKind =
      det.shapeKind === 'line' && item.st.penType === 'dashed' ? 'dashed-line' : det.shapeKind
    shapes.push({
      id: `lshp-${now}-${seq++}`,
      shape: shapeKind,
      x: det.x,
      y: det.y,
      w: det.w,
      h: det.h,
      ...(det.controlPoint ? { controlPoint: det.controlPoint } : {}),
      borderRadius: det.shapeKind === 'rect' ? 6 : undefined,
      color: item.st.color || 'ink',
      fillColor: 'transparent',
      strokeWidth: Math.max(2, Math.min(6, Math.round((item.st.size || 3) * 0.85 * 10) / 10)),
      strokeStyle: item.st.penType === 'dashed' ? 'dashed' : 'solid'
    })
  }

  const hasSameHeightBaselineNeighbor = (idx: number, item: StrokeGeomBox): boolean => {
    for (let j = 0; j < strokeBoxes.length; j++) {
      if (j === idx) continue
      const other = strokeBoxes[j]
      if (consumedStrokeIds.has(other.st.id)) continue
      const otherDet = preDetected[j]
      if (otherDet && otherDet.confidence >= 0.78 && otherDet.shapeKind !== 'line' && otherDet.shapeKind !== 'circle') {
        continue
      }
      const hRatio = other.h / Math.max(1, item.h)
      const hGap = Math.max(0, Math.max(other.minX - item.maxX, item.minX - other.maxX))
      if (
        hRatio >= 0.45 &&
        hRatio <= 1.85 &&
        Math.abs(other.cy - item.cy) <= Math.max(36, item.h * 0.65) &&
        hGap <= Math.max(55, item.h * 1.15)
      ) {
        return true
      }
    }
    return false
  }

  // Pass 2A: Arrows, curved-arrows, angular polygons, and clearly large standalone circles
  for (let i = 0; i < strokeBoxes.length; i++) {
    const item = strokeBoxes[i]
    const det = preDetected[i]
    if (consumedStrokeIds.has(item.st.id) || !det || det.confidence < 0.78) continue

    if (det.shapeKind === 'arrow' || det.shapeKind === 'curved-arrow') {
      emitSingleStrokeShape(item, det)
      continue
    }

    if (det.shapeKind !== 'line' && det.shapeKind !== 'circle') {
      if (item.diag >= 44 && Math.min(Math.abs(det.w), Math.abs(det.h)) >= 28) {
        emitSingleStrokeShape(item, det)
      }
      continue
    }

    if (
      det.shapeKind === 'circle' &&
      Math.min(item.w, item.h) >= 68 &&
      !hasSameHeightBaselineNeighbor(i, item)
    ) {
      emitSingleStrokeShape(item, det)
    }
  }

  // Pass 2B: Guarded pass for remaining `line` and smaller `circle` candidates (blocks l / i / o)
  const closedContainers = (): ShapeNode[] =>
    shapes.filter(
      (s) =>
        s.shape !== 'line' &&
        s.shape !== 'dashed-line' &&
        s.shape !== 'arrow' &&
        s.shape !== 'arrow-bidirectional' &&
        s.shape !== 'curved-arrow' &&
        s.shape !== 'curved-line' &&
        s.shape !== 'elbow'
    )

  for (let i = 0; i < strokeBoxes.length; i++) {
    const item = strokeBoxes[i]
    const det = preDetected[i]
    if (consumedStrokeIds.has(item.st.id) || !det || det.confidence < 0.78) continue
    if (det.shapeKind !== 'line' && det.shapeKind !== 'circle') continue

    // Guard 1: Dot-over-stem 'i' / 'j'
    if (
      det.shapeKind === 'line' &&
      Math.abs(det.h) >= Math.abs(det.w) * 1.8 &&
      item.diag < 145
    ) {
      const hasDotAbove = strokeBoxes.some(
        (other, j) =>
          j !== i &&
          !consumedStrokeIds.has(other.st.id) &&
          other.diag <= 24 &&
          other.w <= 22 &&
          other.h <= 22 &&
          other.maxY <= item.minY + 14 &&
          other.minY >= item.minY - Math.max(48, item.h * 0.78) &&
          Math.abs(other.cx - item.cx) <= Math.max(28, item.h * 0.48)
      )
      if (hasDotAbove) continue
    }

    // Guard 2: Inside-container label guard (unless wide/tall divider line)
    let isSmallLabelInsideBox = false
    for (const box of closedContainers()) {
      const bx = Math.min(box.x, box.x + box.w)
      const by = Math.min(box.y, box.y + box.h)
      const bw = Math.abs(box.w)
      const bh = Math.abs(box.h)
      if (item.cx >= bx + 4 && item.cx <= bx + bw - 4 && item.cy >= by + 4 && item.cy <= by + bh - 4) {
        const isDivider =
          det.shapeKind === 'line' && (item.w >= bw * 0.72 || item.h >= bh * 0.72)
        if (!isDivider) {
          isSmallLabelInsideBox = true
          break
        }
      }
    }
    if (isSmallLabelInsideBox) continue

    // Guard 3: Scale-adaptive horizontal text-run / word guard
    if (
      (det.shapeKind === 'line' && item.diag < 145) ||
      (det.shapeKind === 'circle' && item.diag < 115)
    ) {
      let adjNonShapeCount = 0
      let adjSmallCount = 0
      for (let j = 0; j < strokeBoxes.length; j++) {
        if (j === i) continue
        const other = strokeBoxes[j]
        if (consumedStrokeIds.has(other.st.id)) continue
        const sameBaseline =
          Math.abs(other.cy - item.cy) <= Math.max(44, item.h * 0.9) &&
          other.h <= Math.max(125, item.h * 2.5)
        if (!sameBaseline) continue

        const hGap = Math.max(0, Math.max(other.minX - item.maxX, item.minX - other.maxX))
        const otherDet = preDetected[j]
        const otherIsNonShape = !otherDet || otherDet.confidence < 0.78
        if (otherIsNonShape && hGap <= Math.max(72, item.h * 1.85)) {
          adjNonShapeCount++
        }
        if (other.diag < 130 && hGap <= Math.max(80, item.h * 2.0)) {
          adjSmallCount++
        }
      }
      if (adjNonShapeCount >= 1 || adjSmallCount >= 2) {
        continue
      }
    }

    // Guard 4: Minimum standalone size guard
    if (det.shapeKind === 'circle' && Math.min(item.w, item.h) < 40) continue
    if (det.shapeKind === 'line' && item.diag < 48) continue
    const unconsumedCount = strokeBoxes.filter((b) => !consumedStrokeIds.has(b.st.id)).length
    if (
      det.shapeKind === 'line' &&
      Math.abs(det.h) > Math.abs(det.w) * 2 &&
      item.diag < 64 &&
      unconsumedCount > 1
    ) {
      continue
    }

    emitSingleStrokeShape(item, det)
  }

  // Step 3: Remaining strokes — check if they are handwritten labels inside closed shapes or standalone handwriting
  const remaining = strokes.filter((s) => !consumedStrokeIds.has(s.id))
  const labelClusters: LocalLabelCluster[] = []
  const unassignedStrokes: Stroke[] = []

  const closedShapeIndices = shapes
    .map((s, idx) => ({ s, idx }))
    .filter(
      ({ s }) =>
        s.shape !== 'line' &&
        s.shape !== 'dashed-line' &&
        s.shape !== 'arrow' &&
        s.shape !== 'arrow-bidirectional' &&
        s.shape !== 'curved-arrow' &&
        s.shape !== 'curved-line' &&
        s.shape !== 'elbow'
    )

  const byHost = new Map<number, Stroke[]>()
  for (const st of remaining) {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const [x, y] of st.points) {
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    let bestIdx: number | undefined
    let bestArea = Infinity
    for (const { s, idx } of closedShapeIndices) {
      const sx = Math.min(s.x, s.x + s.w)
      const sy = Math.min(s.y, s.y + s.h)
      const sw = Math.abs(s.w)
      const sh = Math.abs(s.h)
      if (cx >= sx + 4 && cx <= sx + sw - 4 && cy >= sy + 4 && cy <= sy + sh - 4) {
        const area = sw * sh
        if (area < bestArea) {
          bestArea = area
          bestIdx = idx
        }
      }
    }
    if (bestIdx !== undefined) {
      const arr = byHost.get(bestIdx) ?? []
      arr.push(st)
      byHost.set(bestIdx, arr)
    } else {
      unassignedStrokes.push(st)
    }
  }

  for (const [hostIdx, group] of byHost.entries()) {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const st of group) {
      for (const [x, y] of st.points) {
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
    }
    labelClusters.push({
      strokes: group,
      bounds: { minX, minY, maxX, maxY },
      hostShapeIndex: hostIdx
    })
  }

  // Check if unassignedStrokes look like small handwriting vs large complex organic drawing
  let largeUnclassifiedCount = 0
  for (const st of unassignedStrokes) {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const [x, y] of st.points) {
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
    if (Math.hypot(maxX - minX, maxY - minY) > 135) {
      largeUnclassifiedCount++
    }
  }

  if (unassignedStrokes.length > 0 && shapes.length > 0 && largeUnclassifiedCount === 0) {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const st of unassignedStrokes) {
      for (const [x, y] of st.points) {
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
    }
    labelClusters.push({
      strokes: unassignedStrokes,
      bounds: { minX, minY, maxX, maxY }
    })
  }

  const isPureHandwriting = shapes.length === 0 && remaining.length > 0 && largeUnclassifiedCount === 0
  const isPureBasicShapesAndLabels =
    shapes.length > 0 && (unassignedStrokes.length === 0 || largeUnclassifiedCount === 0)

  return {
    shapes,
    consumedStrokeIds,
    labelClusters,
    unclassifiedStrokes: largeUnclassifiedCount > 0 ? unassignedStrokes : [],
    isPureBasicShapesAndLabels,
    isPureHandwriting
  }
}
