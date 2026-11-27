import type { InkPoint, ShapeKind } from '../types/board'
import { classifyClosedGeometricShape } from '../board/holdSnapClassifier'
import { detectLocalBasicShape } from './localShapeDetector'

export interface SnapResult {
  shape: ShapeKind
  shapeId?: string
  x: number
  y: number
  w: number
  h: number
  controlPoint?: [number, number]
}

export interface ClassifiedShape {
  shapeId: string
  x: number
  y: number
  w: number
  h: number
  controlPoint?: [number, number]
  isConnector?: boolean
}

const LINE_STRAIGHTNESS = 0.86
const MIN_SIZE = 20

function pathLength(pts: InkPoint[]): number {
  let len = 0
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
  }
  return len
}

function bounds(pts: InkPoint[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of pts) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return { minX, minY, maxX, maxY }
}

function polygonArea(pts: Array<[number, number]> | InkPoint[]): number {
  let a = 0
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1])
  }
  return Math.abs(a / 2)
}

function resamplePoints(pts: InkPoint[], count: number): Array<[number, number]> {
  if (pts.length === 0) return []
  if (pts.length === 1) return [[pts[0][0], pts[0][1]]]
  const total = pathLength(pts)
  if (total < 1e-3) return [[pts[0][0], pts[0][1]]]
  const step = total / (count - 1)
  const out: Array<[number, number]> = [[pts[0][0], pts[0][1]]]
  let distAcc = 0
  let prev: [number, number] = [pts[0][0], pts[0][1]]

  for (let i = 1; i < pts.length; i++) {
    const cur: [number, number] = [pts[i][0], pts[i][1]]
    let seg = Math.hypot(cur[0] - prev[0], cur[1] - prev[1])
    while (distAcc + seg >= step && out.length < count) {
      const t = (step - distAcc) / (seg || 1)
      const nx = prev[0] + t * (cur[0] - prev[0])
      const ny = prev[1] + t * (cur[1] - prev[1])
      out.push([nx, ny])
      prev = [nx, ny]
      seg = Math.hypot(cur[0] - prev[0], cur[1] - prev[1])
      distAcc = 0
    }
    distAcc += seg
    prev = cur
  }
  while (out.length < count) {
    const last = pts[pts.length - 1]
    out.push([last[0], last[1]])
  }
  return out
}

function countCorners(resampled: Array<[number, number]>): number {
  if (resampled.length < 8) return 0
  let corners = 0
  let cooldown = 0
  for (let i = 2; i < resampled.length - 2; i++) {
    const [ax, ay] = resampled[i - 2]
    const [bx, by] = resampled[i]
    const [cx, cy] = resampled[i + 2]
    const a1 = Math.atan2(by - ay, bx - ax)
    const a2 = Math.atan2(cy - by, cx - bx)
    let diff = Math.abs(a2 - a1)
    if (diff > Math.PI) diff = 2 * Math.PI - diff
    if (cooldown > 0) {
      cooldown--
      continue
    }
    if (diff > Math.PI / 4.8) {
      corners++
      cooldown = 3
    }
  }
  return corners
}

function minDistToPoint(pts: Array<[number, number]>, px: number, py: number): number {
  let best = Infinity
  for (const [x, y] of pts) {
    const d = Math.hypot(x - px, y - py)
    if (d < best) best = d
  }
  return best
}

function countRadialPeaks(radii: number[], threshold: number): number {
  if (radii.length < 12) return 0
  let peaks = 0
  let lastPeakIdx = -10
  for (let i = 0; i < radii.length; i++) {
    const prev = radii[(i - 2 + radii.length) % radii.length]
    const curr = radii[i]
    const next = radii[(i + 2) % radii.length]
    if (curr > prev && curr > next && curr > threshold && i - lastPeakIdx >= 4) {
      peaks++
      lastPeakIdx = i
    }
  }
  return peaks
}

function arrowIdFromVector(dx: number, dy: number): string {
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? 'arrow-right' : 'arrow-left'
  }
  return dy >= 0 ? 'arrow-down' : 'arrow-up'
}

/**
 * Classifies a closed freehand loop into an exact shapeLibrary.json shape ID.
 */
export function classifyClosedPolygon(points: InkPoint[]): ClassifiedShape | null {
  if (points.length < 4) return null
  const total = pathLength(points)
  if (total < MIN_SIZE * 2) return null

  const geo = classifyClosedGeometricShape(points.map(([x, y]) => ({ x, y })))
  if (geo) {
    return {
      shapeId: geo.libraryId,
      x: geo.x,
      y: geo.y,
      w: geo.w,
      h: geo.h
    }
  }

  const [sx, sy] = points[0]
  const [ex, ey] = points[points.length - 1]
  const endToStart = Math.hypot(ex - sx, ey - sy)
  const b = bounds(points)
  const w = b.maxX - b.minX
  const h = b.maxY - b.minY
  const diag = Math.hypot(w, h)

  const closed = endToStart < Math.max(36, diag * 0.36) && total > diag * 1.45
  if (!closed || w < MIN_SIZE || h < MIN_SIZE) return null

  const uni = resamplePoints(points, 64)
  const fill = polygonArea(uni) / (w * h)
  const corners = countCorners(uni)
  const aspect = w / h
  const cx = (b.minX + b.maxX) / 2
  const cy = (b.minY + b.maxY) / 2

  const radii = uni.map(([x, y]) => Math.hypot((x - cx) / (w / 2 || 1), (y - cy) / (h / 2 || 1)))
  const meanR = radii.reduce((a, r) => a + r, 0) / radii.length
  const varianceR = radii.reduce((a, r) => a + (r - meanR) ** 2, 0) / radii.length
  const stdR = Math.sqrt(varianceR)
  const minR = Math.min(...radii)
  const maxR = Math.max(...radii)
  const radialRange = (maxR - minR) / (maxR || 1)
  const peaks = countRadialPeaks(radii, meanR + 0.05)

  // 1. Stars (4, 5, or 6 pointed alternating peaks and deep valleys)
  if (peaks >= 4 && peaks <= 7 && radialRange > 0.28 && fill < 0.62 && corners >= 7) {
    const starId = peaks === 4 ? 'star-4' : peaks === 6 ? 'star-6' : 'star-5'
    return { shapeId: starId, x: b.minX, y: b.minY, w, h }
  }

  // 2. Heart (top center dip + narrow bottom apex)
  const topMidPts = uni.filter(([x, y]) => Math.abs(x - cx) < w * 0.18 && y < cy)
  const topSidePts = uni.filter(([x, y]) => Math.abs(x - cx) >= w * 0.18 && y < cy)
  const botPts = uni.filter(([, y]) => y > b.maxY - h * 0.2)
  if (topMidPts.length > 0 && topSidePts.length > 0 && botPts.length > 0) {
    const minMidY = Math.min(...topMidPts.map(([, y]) => y))
    const minSideY = Math.min(...topSidePts.map(([, y]) => y))
    const botSpan = Math.max(...botPts.map(([x]) => x)) - Math.min(...botPts.map(([x]) => x))
    if (
      minMidY - minSideY > h * 0.14 &&
      botSpan < w * 0.36 &&
      fill >= 0.45 &&
      fill <= 0.82
    ) {
      return { shapeId: 'heart', x: b.minX, y: b.minY, w, h }
    }
  }

  // 3. Cloud (multiple outward humps, wider than tall)
  if (peaks >= 4 && aspect >= 1.15 && radialRange >= 0.14 && radialRange <= 0.36 && fill >= 0.5 && fill <= 0.86) {
    return { shapeId: 'cloud', x: b.minX, y: b.minY, w, h }
  }

  // 4. Circle / Ellipse (low normalized radial variance)
  if (stdR < 0.18 && fill >= 0.62 && fill <= 0.87 && corners <= 3) {
    return {
      shapeId: aspect >= 0.8 && aspect <= 1.25 ? 'circle' : 'ellipse',
      x: b.minX,
      y: b.minY,
      w,
      h
    }
  }

  // 5. Diamond / Rhombus (4 midpoint hits, empty corners)
  const cornerDists = [
    minDistToPoint(uni, b.minX, b.minY),
    minDistToPoint(uni, b.maxX, b.minY),
    minDistToPoint(uni, b.maxX, b.maxY),
    minDistToPoint(uni, b.minX, b.maxY)
  ]
  const emptyCorners = cornerDists.filter((d) => d > diag * 0.16).length
  const midHits = [
    minDistToPoint(uni, cx, b.minY),
    minDistToPoint(uni, b.maxX, cy),
    minDistToPoint(uni, cx, b.maxY),
    minDistToPoint(uni, b.minX, cy)
  ].filter((d) => d < diag * 0.24).length
  if (emptyCorners >= 3 && midHits >= 3 && fill >= 0.36 && fill <= 0.66) {
    return { shapeId: 'rhombus', x: b.minX, y: b.minY, w, h }
  }

  // 6. Triangles (up, down, right-triangle)
  if (corners === 3 || (fill >= 0.32 && fill <= 0.64 && corners <= 4)) {
    const topBand = uni.filter(([, y]) => y <= b.minY + h * 0.22)
    const botBand = uni.filter(([, y]) => y >= b.maxY - h * 0.22)
    const topSpan =
      topBand.length > 0
        ? Math.max(...topBand.map(([x]) => x)) - Math.min(...topBand.map(([x]) => x))
        : w
    const botSpan =
      botBand.length > 0
        ? Math.max(...botBand.map(([x]) => x)) - Math.min(...botBand.map(([x]) => x))
        : w

    if (botSpan < w * 0.38 && topSpan > w * 0.55) {
      return { shapeId: 'triangle-down', x: b.minX, y: b.minY, w, h }
    }
    if (topSpan < w * 0.38 && botSpan > w * 0.55) {
      const topMeanX =
        topBand.reduce((acc, [x]) => acc + x, 0) / Math.max(1, topBand.length)
      if (Math.abs(topMeanX - b.minX) < w * 0.22) {
        return { shapeId: 'right-triangle', x: b.minX, y: b.minY, w, h }
      }
      return { shapeId: 'triangle', x: b.minX, y: b.minY, w, h }
    }
    return { shapeId: 'triangle', x: b.minX, y: b.minY, w, h }
  }

  // 7. Tall Cylinder
  if (h > w * 1.28 && fill >= 0.68) {
    return { shapeId: 'cylinder-3d', x: b.minX, y: b.minY, w, h }
  }

  // 8. Pentagon / Hexagon / Octagon
  if (corners === 5 && fill >= 0.58 && fill <= 0.84) {
    return { shapeId: 'pentagon', x: b.minX, y: b.minY, w, h }
  }
  if (corners === 6 && fill >= 0.62 && fill <= 0.86) {
    return { shapeId: 'hexagon', x: b.minX, y: b.minY, w, h }
  }
  if ((corners === 7 || corners === 8) && fill >= 0.72 && fill <= 0.9) {
    return { shapeId: 'octagon', x: b.minX, y: b.minY, w, h }
  }

  // 9. Parallelogram / Trapezoids / Rectangles / Rounded Rectangle / Stadium
  if (fill >= 0.64) {
    const topBand = uni.filter(([, y]) => y <= b.minY + h * 0.22)
    const botBand = uni.filter(([, y]) => y >= b.maxY - h * 0.22)
    if (topBand.length > 0 && botBand.length > 0) {
      const topMinX = Math.min(...topBand.map(([x]) => x))
      const topMaxX = Math.max(...topBand.map(([x]) => x))
      const botMinX = Math.min(...botBand.map(([x]) => x))
      const botMaxX = Math.max(...botBand.map(([x]) => x))
      const topW = topMaxX - topMinX
      const botW = botMaxX - botMinX

      if (topW < botW * 0.78 && topMinX > b.minX + w * 0.08 && topMaxX < b.maxX - w * 0.08) {
        return { shapeId: 'trapezoid', x: b.minX, y: b.minY, w, h }
      }
      if (botW < topW * 0.78 && botMinX > b.minX + w * 0.08 && botMaxX < b.maxX - w * 0.08) {
        return { shapeId: 'trapezoid-inverted', x: b.minX, y: b.minY, w, h }
      }
      const skew = Math.abs((topMinX + topMaxX) / 2 - (botMinX + botMaxX) / 2)
      if (Math.abs(topW - botW) < w * 0.28 && skew > w * 0.14) {
        return { shapeId: 'parallelogram', x: b.minX, y: b.minY, w, h }
      }
    }

    if (aspect > 2.1 && emptyCorners >= 3) {
      return { shapeId: 'stadium', x: b.minX, y: b.minY, w, h }
    }
    if (aspect >= 0.84 && aspect <= 1.18 && emptyCorners <= 2) {
      return { shapeId: 'square', x: b.minX, y: b.minY, w, h }
    }
    if (emptyCorners >= 2 && corners <= 6) {
      return { shapeId: 'rounded-rectangle', x: b.minX, y: b.minY, w, h }
    }
    return { shapeId: 'rectangle', x: b.minX, y: b.minY, w, h }
  }

  return null
}

/**
 * Classifies a single freehand stroke (open line/arrow/curved-arrow or closed geometric shape)
 * into a shapeLibrary.json shape ID.
 */
export function classifyStrokeShape(points: InkPoint[]): ClassifiedShape | null {
  if (points.length < 4) return null
  const local = detectLocalBasicShape(points)
  if (local && local.confidence >= 0.78) {
    return {
      shapeId: local.libraryId,
      x: local.x,
      y: local.y,
      w: local.w,
      h: local.h,
      ...(local.controlPoint ? { controlPoint: local.controlPoint } : {}),
      isConnector: local.isConnector
    }
  }
  const total = pathLength(points)
  if (total < MIN_SIZE * 2) return null

  const [sx, sy] = points[0]
  const [ex, ey] = points[points.length - 1]
  const endToStart = Math.hypot(ex - sx, ey - sy)

  if (endToStart / total > LINE_STRAIGHTNESS) {
    const dx = ex - sx
    const dy = ey - sy
    const b = bounds(points)
    const isHoriz = Math.abs(dy) <= Math.max(10, Math.abs(dx) * 0.2)
    const isVert = Math.abs(dx) <= Math.max(10, Math.abs(dy) * 0.2)
    const shapeId = isHoriz
      ? 'line-horizontal'
      : isVert
        ? 'line-vertical'
        : arrowIdFromVector(dx, dy)
    return {
      shapeId,
      x: b.minX,
      y: b.minY,
      w: Math.max(24, b.maxX - b.minX),
      h: Math.max(24, b.maxY - b.minY),
      isConnector: true
    }
  }

  return classifyClosedPolygon(points)
}

/**
 * Geometric primitive recognizer for writing pad stylus/pen input.
 */
export function snapShape(points: InkPoint[]): SnapResult | null {
  const local = detectLocalBasicShape(points)
  if (local && local.confidence >= 0.78) {
    return {
      shape: local.shapeKind,
      shapeId: local.libraryId,
      x: local.x,
      y: local.y,
      w: local.w,
      h: local.h,
      ...(local.controlPoint ? { controlPoint: local.controlPoint } : {})
    }
  }
  if (points.length < 4) return null
  const total = pathLength(points)
  if (total < MIN_SIZE * 2) return null

  const [sx, sy] = points[0]
  const [ex, ey] = points[points.length - 1]
  const endToStart = Math.hypot(ex - sx, ey - sy)

  if (endToStart / total > LINE_STRAIGHTNESS) {
    return { shape: 'arrow', shapeId: arrowIdFromVector(ex - sx, ey - sy), x: sx, y: sy, w: ex - sx, h: ey - sy }
  }

  const classified = classifyClosedPolygon(points)
  if (!classified) return null

  const legacyMap: Record<string, ShapeKind> = {
    rectangle: 'rect',
    square: 'rect',
    'rounded-rectangle': 'rounded-rect',
    stadium: 'rounded-rect',
    circle: 'circle',
    ellipse: 'circle',
    rhombus: 'diamond',
    triangle: 'triangle',
    parallelogram: 'parallelogram',
    cloud: 'cloud',
    'cylinder-3d': 'cylinder'
  }

  return {
    shape: legacyMap[classified.shapeId] ?? classified.shapeId,
    shapeId: classified.shapeId,
    x: classified.x,
    y: classified.y,
    w: classified.w,
    h: classified.h
  }
}
