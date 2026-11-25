import type { InkPoint, ShapeKind, ShapeNode, Stroke } from '../types/board'
import { rdpSimplify, type Point2D } from '../board/holdSnapClassifier'
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

  // Pentagon & Hexagon
  const regPoly = (sides: number, rot = -Math.PI / 2): Array<[number, number]> =>
    Array.from({ length: sides }, (_, i) => {
      const a = rot + (i / sides) * Math.PI * 2
      return [50 + Math.cos(a) * 50, 50 + Math.sin(a) * 50]
    })
  list.push(makePolygonTemplate('pentagon', 'pentagon', regPoly(5)))
  list.push(makePolygonTemplate('hexagon', 'hexagon', regPoly(6)))

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
 * Recognizes: line, arrow, elbow, circle, ellipse, square, rectangle, rounded-rect,
 * triangle, triangle-down, right-triangle, diamond/rhombus, pentagon, hexagon, star-5, parallelogram, trapezoid.
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

  // Allow natural hand-drawn loop closure (gap up to 24% of path length or 32% of diagonal when stroke wraps around)
  const isClosed =
    w >= 18 &&
    h >= 18 &&
    totalLen > diag * 1.48 &&
    (startToEnd < totalLen * 0.22 || startToEnd < Math.max(28, diag * 0.3))

  const denoised = rdpSimplify(pts, Math.max(1.8, diag * 0.015))

  if (!isClosed) {
    // 1. Check single-stroke arrow (straight shaft + tip barb reversal)
    let maxDistFromStart = 0
    let tipIdx = -1
    let cumLen = 0
    let lenAtTip = 0
    for (let i = 1; i < denoised.length; i++) {
      cumLen += Math.hypot(denoised[i].x - denoised[i - 1].x, denoised[i].y - denoised[i - 1].y)
      const d = Math.hypot(denoised[i].x - start.x, denoised[i].y - start.y)
      if (d > maxDistFromStart) {
        maxDistFromStart = d
        tipIdx = i
        lenAtTip = cumLen
      }
    }
    const denoisedLen = cumLen
    if (tipIdx > 0 && tipIdx < denoised.length - 1) {
      const tailLen = denoisedLen - lenAtTip
      const shaftStraightness = maxDistFromStart / Math.max(1, lenAtTip)
      if (
        shaftStraightness >= 0.86 &&
        tailLen >= Math.max(10, denoisedLen * 0.04) &&
        tailLen <= denoisedLen * 0.42
      ) {
        const tip = denoised[tipIdx]
        const last = denoised[denoised.length - 1]
        const sdx = tip.x - start.x
        const sdy = tip.y - start.y
        const bdx = last.x - tip.x
        const bdy = last.y - tip.y
        const sn = Math.hypot(sdx, sdy)
        const bn = Math.hypot(bdx, bdy)
        if (sn >= 24 && bn >= 6) {
          const cosA = (sdx * bdx + sdy * bdy) / (sn * bn)
          if (cosA < -0.25 && Math.hypot(last.x - tip.x, last.y - tip.y) <= sn * 0.44) {
            let dx = tip.x - start.x
            let dy = tip.y - start.y
            const ang = Math.atan2(Math.abs(dy), Math.abs(dx))
            if (ang < (6 * Math.PI) / 180) dy = 0
            else if (Math.abs(ang - Math.PI / 2) < (6 * Math.PI) / 180) dx = 0
            return {
              shapeKind: 'arrow',
              libraryId: 'arrow',
              x: Math.round(start.x),
              y: Math.round(start.y),
              w: Math.round(dx),
              h: Math.round(dy),
              confidence: Math.min(0.97, shaftStraightness),
              isConnector: true
            }
          }
        }
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

  // Reject multi-loop scribbles or cursive words (totalLen way larger than perimeter of bounding box)
  const boxPerim = 2 * (w + h)
  if (totalLen > boxPerim * 1.48 || totalLen < boxPerim * 0.56) {
    return null
  }

  // Closed shape geometric + $P cloud hybrid analysis
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const rx = Math.max(1, w / 2)
  const ry = Math.max(1, h / 2)
  const aspect = w / Math.max(1, h)

  // Signed shoelace area ratio (filters figure-8s or collapsed loops)
  let signedArea = 0
  for (let i = 0; i < pts.length; i++) {
    const cur = pts[i]
    const nxt = pts[(i + 1) % pts.length]
    signedArea += cur.x * nxt.y - nxt.x * cur.y
  }
  const fillRatio = Math.abs(signedArea * 0.5) / Math.max(1, w * h)
  if (fillRatio < 0.24 || fillRatio > 1.08) return null

  let meanR = 0
  let ellipseAbsErr = 0
  const radii: number[] = []
  for (const p of pts) {
    const r = Math.hypot((p.x - cx) / rx, (p.y - cy) / ry)
    radii.push(r)
    meanR += r
    ellipseAbsErr += Math.abs(r - 1)
  }
  meanR /= radii.length
  ellipseAbsErr /= radii.length
  let radialVar = 0
  for (const r of radii) {
    radialVar += (r - meanR) * (r - meanR)
  }
  radialVar /= radii.length

  // Extract clean corners via RDP
  const polyRaw = rdpSimplify(denoised, Math.max(5.5, diag * 0.064))
  const corners: Point2D[] = []
  const minEdge = Math.max(8, diag * 0.095)
  for (const p of polyRaw) {
    if (corners.length === 0 || Math.hypot(corners[corners.length - 1].x - p.x, corners[corners.length - 1].y - p.y) >= minEdge) {
      corners.push(p)
    }
  }
  if (corners.length > 2 && Math.hypot(corners[0].x - corners[corners.length - 1].x, corners[0].y - corners[corners.length - 1].y) < minEdge * 1.15) {
    corners.pop()
  }
  // Prune nearly collinear vertices
  let changed = true
  while (changed && corners.length > 3) {
    changed = false
    for (let i = 0; i < corners.length; i++) {
      const prev = corners[(i - 1 + corners.length) % corners.length]
      const cur = corners[i]
      const next = corners[(i + 1) % corners.length]
      const v1x = prev.x - cur.x
      const v1y = prev.y - cur.y
      const v2x = next.x - cur.x
      const v2y = next.y - cur.y
      const n1 = Math.hypot(v1x, v1y)
      const n2 = Math.hypot(v2x, v2y)
      if (n1 < 1e-3 || n2 < 1e-3 || (v1x * v2x + v1y * v2y) / (n1 * n2) < -0.87) {
        corners.splice(i, 1)
        changed = true
        break
      }
    }
  }

  const polygonFitErr = (() => {
    if (corners.length < 3) return Infinity
    let sum = 0
    for (const p of pts) {
      let best = Infinity
      for (let i = 0; i < corners.length; i++) {
        best = Math.min(best, pointToSegDist(p, corners[i], corners[(i + 1) % corners.length]))
      }
      sum += best
    }
    return sum / (pts.length * Math.max(1, diag * 0.5))
  })()

  const cloudMatch = matchPointCloudShape([rawPoints])

  // 1. Circle / Ellipse
  if (
    radialVar < 0.032 &&
    fillRatio >= 0.58 &&
    fillRatio <= 0.9 &&
    (corners.length >= 5 || ellipseAbsErr < polygonFitErr * 0.92 || cloudMatch?.name === 'circle')
  ) {
    const isPerfect = aspect >= 0.82 && aspect <= 1.22
    const d = Math.round((w + h) / 2)
    const conf = Math.max(0.82, Math.min(0.98, 1 - radialVar * 6))
    return {
      shapeKind: 'circle',
      libraryId: isPerfect ? 'circle' : 'ellipse',
      x: isPerfect ? Math.round(cx - d / 2) : Math.round(minX),
      y: isPerfect ? Math.round(cy - d / 2) : Math.round(minY),
      w: isPerfect ? d : Math.round(w),
      h: isPerfect ? d : Math.round(h),
      confidence: conf,
      isPerfectCircle: isPerfect
    }
  }

  // 2. Triangle (3 sharp corners + tight edge fit)
  if (corners.length === 3 && polygonFitErr < 0.14 && fillRatio >= 0.3 && fillRatio <= 0.68) {
    const topVerts = corners.filter((c) => c.y <= minY + h * 0.3)
    const botVerts = corners.filter((c) => c.y >= maxY - h * 0.3)
    let libId = 'triangle'
    let kind: ShapeKind = 'triangle'
    if (topVerts.length === 2 && botVerts.length === 1) {
      libId = 'triangle-down'
      kind = getLibraryShape('triangle-down') ? 'triangle-down' : 'triangle'
    } else if (topVerts.length === 1 && Math.abs(topVerts[0].x - minX) < w * 0.22) {
      libId = 'right-triangle'
      kind = getLibraryShape('right-triangle') ? 'right-triangle' : 'triangle'
    }
    return {
      shapeKind: kind,
      libraryId: libId,
      x: Math.round(minX),
      y: Math.round(minY),
      w: Math.round(w),
      h: Math.round(h),
      confidence: Math.max(0.82, Math.min(0.97, 1 - polygonFitErr * 2.5))
    }
  }

  // 3. 4-Corner Quadrilaterals: Square, Rectangle, Diamond, Parallelogram, Trapezoid
  if (corners.length === 4 && polygonFitErr < 0.14) {
    const edgeMidpoints: Point2D[] = [
      { x: cx, y: minY },
      { x: maxX, y: cy },
      { x: cx, y: maxY },
      { x: minX, y: cy }
    ]
    const bboxCorners: Point2D[] = [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY }
    ]
    const avgDist = (targets: Point2D[]): number => {
      let s = 0
      for (const c of corners) {
        let b = Infinity
        for (const t of targets) b = Math.min(b, Math.hypot(c.x - t.x, c.y - t.y))
        s += b
      }
      return s / 4
    }
    const midErr = avgDist(edgeMidpoints)
    const boxErr = avgDist(bboxCorners)

    if (midErr < boxErr * 0.85 && midErr < diag * 0.17) {
      return {
        shapeKind: 'diamond',
        libraryId: 'rhombus',
        x: Math.round(minX),
        y: Math.round(minY),
        w: Math.round(w),
        h: Math.round(h),
        confidence: Math.max(0.84, Math.min(0.97, 1 - polygonFitErr * 2.5))
      }
    }

    if (boxErr < diag * 0.2) {
      const isSquare = aspect >= 0.85 && aspect <= 1.18
      const side = Math.round((w + h) / 2)
      return {
        shapeKind: 'rect',
        libraryId: isSquare ? 'square' : 'rectangle',
        x: isSquare ? Math.round(cx - side / 2) : Math.round(minX),
        y: isSquare ? Math.round(cy - side / 2) : Math.round(minY),
        w: isSquare ? side : Math.round(w),
        h: isSquare ? side : Math.round(h),
        confidence: Math.max(0.84, Math.min(0.98, 1 - polygonFitErr * 2.5))
      }
    }

    // Check parallelogram / trapezoid
    const sortedByY = [...corners].sort((a, b) => a.y - b.y)
    const topPair = sortedByY.slice(0, 2).sort((a, b) => a.x - b.x)
    const botPair = sortedByY.slice(2, 4).sort((a, b) => a.x - b.x)
    const topW = topPair[1].x - topPair[0].x
    const botW = botPair[1].x - botPair[0].x
    const topMid = (topPair[0].x + topPair[1].x) / 2
    const botMid = (botPair[0].x + botPair[1].x) / 2

    if (Math.abs(topW - botW) < w * 0.25 && Math.abs(topMid - botMid) > w * 0.12) {
      return {
        shapeKind: 'parallelogram',
        libraryId: 'parallelogram',
        x: Math.round(minX),
        y: Math.round(minY),
        w: Math.round(w),
        h: Math.round(h),
        confidence: 0.85
      }
    }
    if (topW < botW * 0.78 && getLibraryShape('trapezoid')) {
      return {
        shapeKind: 'trapezoid',
        libraryId: 'trapezoid',
        x: Math.round(minX),
        y: Math.round(minY),
        w: Math.round(w),
        h: Math.round(h),
        confidence: 0.84
      }
    }
  }

  // 4. Pentagon / Hexagon / 5-Point Star
  if (corners.length === 5 && polygonFitErr < 0.13 && fillRatio >= 0.55) {
    const kind: ShapeKind = getLibraryShape('pentagon') ? 'pentagon' : 'rect'
    return {
      shapeKind: kind,
      libraryId: 'pentagon',
      x: Math.round(minX),
      y: Math.round(minY),
      w: Math.round(w),
      h: Math.round(h),
      confidence: 0.84
    }
  }
  if (corners.length === 6 && polygonFitErr < 0.13 && fillRatio >= 0.6) {
    const kind: ShapeKind = getLibraryShape('hexagon') ? 'hexagon' : 'rect'
    return {
      shapeKind: kind,
      libraryId: 'hexagon',
      x: Math.round(minX),
      y: Math.round(minY),
      w: Math.round(w),
      h: Math.round(h),
      confidence: 0.85
    }
  }
  if (
    corners.length >= 8 &&
    corners.length <= 11 &&
    fillRatio >= 0.26 &&
    fillRatio <= 0.58 &&
    cloudMatch?.name === 'star-5' &&
    cloudMatch.score >= 0.65
  ) {
    const kind: ShapeKind = getLibraryShape('star-5') ? 'star-5' : 'diamond'
    return {
      shapeKind: kind,
      libraryId: 'star-5',
      x: Math.round(minX),
      y: Math.round(minY),
      w: Math.round(w),
      h: Math.round(h),
      confidence: 0.83
    }
  }

  // 5. Fallback to high-confidence $P point cloud match if polygon fit was borderline
  if (cloudMatch && cloudMatch.score >= 0.78 && polygonFitErr < 0.18) {
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

/**
 * Detects multi-stroke arrows (1 straight shaft stroke + 1 V-shaped or 2-barb arrowhead strokes near an endpoint)
 * and multi-stroke polygons (e.g. 3 strokes forming a triangle or 4 strokes forming a rectangle).
 */
export function analyzeSelectionLocally(
  strokes: Stroke[],
  existingShapes: ShapeNode[] = []
): LocalSelectionAnalysis {
  const consumedStrokeIds = new Set<string>()
  const shapes: ShapeNode[] = [...existingShapes]
  const now = Date.now()
  let seq = 0

  // Step 1: Detect 2-stroke arrows (straight shaft + V-chevron head near shaft start or end)
  for (let i = 0; i < strokes.length; i++) {
    const shaft = strokes[i]
    if (consumedStrokeIds.has(shaft.id) || shaft.points.length < 2) continue
    const detShaft = detectLocalBasicShape(shaft.points)
    if (!detShaft || detShaft.shapeKind !== 'line') continue

    const sx = detShaft.x
    const sy = detShaft.y
    const ex = detShaft.x + detShaft.w
    const ey = detShaft.y + detShaft.h
    const shaftLen = Math.hypot(detShaft.w, detShaft.h)
    if (shaftLen < 32) continue

    for (let j = 0; j < strokes.length; j++) {
      if (i === j) continue
      const head = strokes[j]
      if (consumedStrokeIds.has(head.id) || head.points.length < 3) continue
      let hMinX = Infinity
      let hMinY = Infinity
      let hMaxX = -Infinity
      let hMaxY = -Infinity
      for (const [px, py] of head.points) {
        hMinX = Math.min(hMinX, px)
        hMinY = Math.min(hMinY, py)
        hMaxX = Math.max(hMaxX, px)
        hMaxY = Math.max(hMaxY, py)
      }
      const headDiag = Math.hypot(hMaxX - hMinX, hMaxY - hMinY)
      if (headDiag < 10 || headDiag > shaftLen * 0.65) continue

      const headPts: Point2D[] = head.points.map(([x, y]) => ({ x, y }))
      const simpHead = rdpSimplify(headPts, Math.max(2, headDiag * 0.08))
      if (simpHead.length >= 3 && simpHead.length <= 4) {
        const apex = simpHead[1]
        const distEnd = Math.hypot(apex.x - ex, apex.y - ey)
        const distStart = Math.hypot(apex.x - sx, apex.y - sy)
        const tol = Math.max(22, shaftLen * 0.16)
        if (distEnd <= tol || distStart <= tol) {
          consumedStrokeIds.add(shaft.id)
          consumedStrokeIds.add(head.id)
          const fromX = distEnd <= distStart ? sx : ex
          const fromY = distEnd <= distStart ? sy : ey
          const toX = distEnd <= distStart ? ex : sx
          const toY = distEnd <= distStart ? ey : sy
          shapes.push({
            id: `lshp-${now}-${seq++}`,
            shape: 'arrow',
            x: Math.round(fromX),
            y: Math.round(fromY),
            w: Math.round(toX - fromX),
            h: Math.round(toY - fromY),
            color: shaft.color || 'ink',
            fillColor: 'transparent',
            strokeWidth: Math.max(2, Math.min(6, Math.round((shaft.size || 3) * 0.85 * 10) / 10)),
            strokeStyle: shaft.penType === 'dashed' ? 'dashed' : 'solid'
          })
          break
        }
      }
    }
  }

  // Step 2: Detect single-stroke shapes & connectors (excluding tiny letter-sized strokes if surrounded by text)
  const strokeBoxes = strokes.map((st) => {
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
    return { st, minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY }
  })

  for (const item of strokeBoxes) {
    if (consumedStrokeIds.has(item.st.id)) continue
    const det = detectLocalBasicShape(item.st.points)
    if (!det || det.confidence < 0.8) continue

    // Avoid mistaking a tiny handwritten letter 'o' or 'l' inside a word for a diagram shape
    const diag = Math.hypot(item.w, item.h)
    const nearbySmallCount = strokeBoxes.filter(
      (other) =>
        other.st.id !== item.st.id &&
        Math.hypot(other.w, other.h) < 55 &&
        Math.abs((other.minY + other.maxY) / 2 - (item.minY + item.maxY) / 2) < 42 &&
        Math.abs((other.minX + other.maxX) / 2 - (item.minX + item.maxX) / 2) < 120
    ).length

    if (diag < 48 && nearbySmallCount >= 2) {
      continue
    }

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
      borderRadius: det.shapeKind === 'rect' ? 6 : undefined,
      color: item.st.color || 'ink',
      fillColor: 'transparent',
      strokeWidth: Math.max(2, Math.min(6, Math.round((item.st.size || 3) * 0.85 * 10) / 10)),
      strokeStyle: item.st.penType === 'dashed' ? 'dashed' : 'solid'
    })
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
