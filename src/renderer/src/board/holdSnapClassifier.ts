import type { InkPoint, ShapeKind, ShapeNode } from '../types/board'

export type HoldSnapKind =
  | 'line'
  | 'arrow'
  | 'rect'
  | 'diamond'
  | 'triangle'
  | 'right-triangle'
  | 'triangle-down'
  | 'parallelogram'
  | 'pentagon'
  | 'hexagon'
  | 'star-5'
  | 'circle'

export interface HoldSnapResult {
  kind: HoldSnapKind
  x: number
  y: number
  w: number
  h: number
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

/** Detect an open stroke with a straight shaft followed by an arrowhead barb reversal near the tip */
function detectArrow(pts: Point2D[], totalLen: number): HoldSnapResult | null {
  if (pts.length < 3 || totalLen < 40) return null

  const start = pts[0]
  // Find the point farthest from start — for a hand-drawn arrow drawn shaft-then-barb,
  // the arrowhead tip is the local distance maximum near 60%..95% of path length.
  let maxDist = 0
  let tipIdx = pts.length - 1
  let cumLen = 0
  let lenAtTip = 0
  for (let i = 1; i < pts.length; i++) {
    cumLen += dist(pts[i - 1], pts[i])
    const d = dist(start, pts[i])
    if (d > maxDist) {
      maxDist = d
      tipIdx = i
      lenAtTip = cumLen
    }
  }

  // Must have a meaningful trailing barb after the tip (between 4% and 42% of total stroke)
  const tailLen = totalLen - lenAtTip
  if (tipIdx < 1 || tipIdx >= pts.length - 1) return null
  if (tailLen < Math.max(10, totalLen * 0.04) || tailLen > totalLen * 0.42) return null

  // The shaft from start -> tip must be reasonably straight
  const shaftStraightness = maxDist / Math.max(1, lenAtTip)
  if (shaftStraightness < 0.86) return null

  // The barb after the tip must reverse direction relative to the shaft vector
  const tip = pts[tipIdx]
  const last = pts[pts.length - 1]
  const shaftDx = tip.x - start.x
  const shaftDy = tip.y - start.y
  const barbDx = last.x - tip.x
  const barbDy = last.y - tip.y
  const shaftNorm = Math.hypot(shaftDx, shaftDy)
  const barbNorm = Math.hypot(barbDx, barbDy)
  if (shaftNorm < 25 || barbNorm < 6) return null

  const cosAngle = (shaftDx * barbDx + shaftDy * barbDy) / (shaftNorm * barbNorm)
  // Reversal angle > 105° => cosAngle < -0.25
  if (cosAngle > -0.25) return null

  // Also ensure the final point stays close to the tip (it's a barb, not a U-turn back to start)
  if (dist(tip, last) > shaftNorm * 0.42) return null

  let dx = tip.x - start.x
  let dy = tip.y - start.y
  const angle = Math.atan2(Math.abs(dy), Math.abs(dx))
  if (angle < (6 * Math.PI) / 180) dy = 0
  else if (Math.abs(angle - Math.PI / 2) < (6 * Math.PI) / 180) dx = 0

  return {
    kind: 'arrow',
    x: Math.round(start.x),
    y: Math.round(start.y),
    w: Math.round(dx),
    h: Math.round(dy)
  }
}

/** Merge near-duplicate or nearly-collinear vertices on a closed polygon */
function cleanClosedCorners(raw: Point2D[], diag: number): Point2D[] {
  if (raw.length < 3) return raw
  // Remove closing duplicate if last is close to first
  const pts = [...raw]
  if (pts.length > 3 && dist(pts[0], pts[pts.length - 1]) < diag * 0.14) {
    pts.pop()
  }

  // Merge consecutive very close points
  const merged: Point2D[] = []
  const minEdge = Math.max(8, diag * 0.09)
  for (const p of pts) {
    if (merged.length === 0 || dist(merged[merged.length - 1], p) >= minEdge) {
      merged.push(p)
    }
  }
  if (merged.length > 3 && dist(merged[0], merged[merged.length - 1]) < minEdge) {
    merged.pop()
  }

  // Drop nearly-collinear vertices (interior angle > 152°)
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
      // Angle close to 180° => cosA close to -1
      if (cosA < -0.88) {
        poly.splice(i, 1)
        changed = true
        break
      }
    }
  }
  return poly
}

/**
 * Classifies a single freehand stroke during Hold-to-Snap into a crisp geometric primitive:
 * - Open strokes: straight `line` (> 0.90 straightness) or `arrow` (straight shaft + tip barb reversal).
 * - Closed strokes (start-to-end < 18% of total length):
 *   - `circle` (ellipse; aspect ratio 0.85..1.15 snapped to perfect circle) when normalized radial variance < 0.028.
 *   - `triangle` (3 corners), `diamond` (4 corners near bbox midpoints), `rect` (4 axis-aligned corners).
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

  // 1. Light RDP pass to eliminate hand jitter while keeping true corners
  const jitterEps = Math.max(1.8, diag * 0.015)
  const denoised = rdpSimplify(pts, jitterEps)

  // 2. Closed vs. Open check: start-to-end distance < 18% of total stroke length
  const startToEnd = dist(pts[0], pts[pts.length - 1])
  const isClosed = startToEnd < totalLen * 0.18 && b.w >= 18 && b.h >= 18

  if (!isClosed) {
    // Open stroke: check arrowhead reversal first, then straight line (> 0.90)
    const arrow = detectArrow(denoised, polylineLength(denoised))
    if (arrow) return arrow

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
        h: Math.round(dy)
      }
    }
    return null
  }

  // 3. Closed stroke: check normalized elliptical radial variance (< 0.028 => ellipse / circle)
  const cx = (b.minX + b.maxX) / 2
  const cy = (b.minY + b.maxY) / 2
  const rx = Math.max(1, b.w / 2)
  const ry = Math.max(1, b.h / 2)

  // Compute normalized radius r_i = hypot((x-cx)/rx, (y-cy)/ry); on a perfect ellipse r_i === 1
  const radii: number[] = []
  let meanR = 0
  let ellipseAbsErr = 0
  for (const p of pts) {
    const r = Math.hypot((p.x - cx) / rx, (p.y - cy) / ry)
    radii.push(r)
    meanR += r
    ellipseAbsErr += Math.abs(r - 1)
  }
  meanR /= Math.max(1, radii.length)
  ellipseAbsErr /= Math.max(1, radii.length)
  let variance = 0
  for (const r of radii) {
    const diff = r - meanR
    variance += diff * diff
  }
  variance /= Math.max(1, radii.length)

  // Aggressive RDP corner extraction for polygon detection
  const polyEps = Math.max(6, diag * 0.068)
  const aggressive = rdpSimplify(denoised, polyEps)
  const corners = cleanClosedCorners(aggressive, diag)

  // Measure how tightly the raw stroke hugs the extracted polygon edges (normalized by half-diag)
  const polygonFitError = (poly: Point2D[]): number => {
    if (poly.length < 3) return Infinity
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

  const aspect = b.w / Math.max(1, b.h)
  const polyErr = corners.length === 3 || corners.length === 4 ? polygonFitError(corners) : Infinity
  const isCleanCircle =
    variance < 0.028 && (corners.length >= 5 || ellipseAbsErr < polyErr * 0.9)

  if (isCleanCircle) {
    const isCircle = aspect >= 0.85 && aspect <= 1.15
    if (isCircle) {
      const d = Math.round((b.w + b.h) / 2)
      return {
        kind: 'circle',
        x: Math.round(cx - d / 2),
        y: Math.round(cy - d / 2),
        w: d,
        h: d,
        isPerfectCircle: true
      }
    }
    return {
      kind: 'circle',
      x: Math.round(b.minX),
      y: Math.round(b.minY),
      w: Math.round(b.w),
      h: Math.round(b.h),
      isPerfectCircle: false
    }
  }

  // 4. Polygons by aggressive RDP corner count
  if (corners.length === 3) {
    const topVerts = corners.filter((c) => c.y <= b.minY + b.h * 0.3)
    const botVerts = corners.filter((c) => c.y >= b.maxY - b.h * 0.3)
    let triKind: HoldSnapKind = 'triangle'
    if (topVerts.length === 2 && botVerts.length === 1) {
      triKind = 'triangle-down'
    } else if (topVerts.length === 1 && Math.abs(topVerts[0].x - b.minX) < b.w * 0.22) {
      triKind = 'right-triangle'
    }
    return {
      kind: triKind,
      x: Math.round(b.minX),
      y: Math.round(b.minY),
      w: Math.round(b.w),
      h: Math.round(b.h),
      confidence: Math.max(0.82, 1 - polyErr * 2)
    }
  }

  if (corners.length === 5 && polygonFitError(corners) < 0.14) {
    return {
      kind: 'pentagon',
      x: Math.round(b.minX),
      y: Math.round(b.minY),
      w: Math.round(b.w),
      h: Math.round(b.h),
      confidence: 0.85
    }
  }

  if (corners.length === 6 && polygonFitError(corners) < 0.14) {
    return {
      kind: 'hexagon',
      x: Math.round(b.minX),
      y: Math.round(b.minY),
      w: Math.round(b.w),
      h: Math.round(b.h),
      confidence: 0.86
    }
  }

  if (corners.length === 4) {
    // Check if the 4 corners sit near the 4 bounding-box edge midpoints (diamond) vs bbox corners (rect)
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
      for (const c of corners) {
        let best = Infinity
        for (const t of targets) {
          const d = dist(c, t)
          if (d < best) best = d
        }
        sum += best
      }
      return sum / corners.length
    }

    const midErr = avgDistToSet(edgeMidpoints)
    const cornerErr = avgDistToSet(bboxCorners)

    if (midErr < cornerErr * 0.85 && midErr < diag * 0.16) {
      return {
        kind: 'diamond',
        x: Math.round(b.minX),
        y: Math.round(b.minY),
        w: Math.round(b.w),
        h: Math.round(b.h)
      }
    }

    if (cornerErr < diag * 0.22) {
      const isSquare = aspect >= 0.85 && aspect <= 1.18
      const side = Math.round((b.w + b.h) / 2)
      return {
        kind: 'rect',
        x: isSquare ? Math.round(cx - side / 2) : Math.round(b.minX),
        y: isSquare ? Math.round(cy - side / 2) : Math.round(b.minY),
        w: isSquare ? side : Math.round(b.w),
        h: isSquare ? side : Math.round(b.h),
        confidence: Math.max(0.84, 1 - polyErr * 2)
      }
    }

    const sortedY = [...corners].sort((a, b2) => a.y - b2.y)
    const topP = sortedY.slice(0, 2).sort((a, b2) => a.x - b2.x)
    const botP = sortedY.slice(2, 4).sort((a, b2) => a.x - b2.x)
    const topW = topP[1].x - topP[0].x
    const botW = botP[1].x - botP[0].x
    const skew = Math.abs((topP[0].x + topP[1].x) / 2 - (botP[0].x + botP[1].x) / 2)
    if (Math.abs(topW - botW) < b.w * 0.26 && skew > b.w * 0.13) {
      return {
        kind: 'parallelogram',
        x: Math.round(b.minX),
        y: Math.round(b.minY),
        w: Math.round(b.w),
        h: Math.round(b.h),
        confidence: 0.84
      }
    }
  }

  // Secondary fallback for soft ellipses with slightly higher variance
  if (variance < 0.028) {
    const isCircle = aspect >= 0.85 && aspect <= 1.15
    const d = Math.round((b.w + b.h) / 2)
    return {
      kind: 'circle',
      x: isCircle ? Math.round(cx - d / 2) : Math.round(b.minX),
      y: isCircle ? Math.round(cy - d / 2) : Math.round(b.minY),
      w: isCircle ? d : Math.round(b.w),
      h: isCircle ? d : Math.round(b.h),
      isPerfectCircle: isCircle
    }
  }

  return null
}

/** Snaps an arrow or line's endpoints onto nearby existing shape edge anchors (N/E/S/W midpoints) */
export function snapConnectorToShapeAnchors(
  snapped: HoldSnapResult,
  existingShapes: ShapeNode[],
  tolerance = 28
): HoldSnapResult {
  if (snapped.kind !== 'line' && snapped.kind !== 'arrow') return snapped

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

  const p1 = findNearest({ x: snapped.x, y: snapped.y })
  const p2 = findNearest({ x: snapped.x + snapped.w, y: snapped.y + snapped.h })
  return {
    ...snapped,
    x: Math.round(p1.x),
    y: Math.round(p1.y),
    w: Math.round(p2.x - p1.x),
    h: Math.round(p2.y - p1.y)
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
    borderRadius: snapped.kind === 'rect' ? 6 : undefined,
    color,
    fillColor: 'transparent',
    strokeWidth: Math.max(2, Math.min(6, Math.round(size * 0.85 * 10) / 10)),
    strokeStyle: penType === 'dashed' ? 'dashed' : 'solid'
  }
}
