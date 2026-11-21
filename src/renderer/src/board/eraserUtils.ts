import type {
  InkPoint,
  Stroke,
  ShapeNode,
  TextNode,
  EquationNode,
  DiagramNode,
  CodeNode,
  VectorArtNode
} from '../types/board'

export interface BoundsRect {
  minX: number
  minY: number
  maxX: number
  maxY: number
  x: number
  y: number
  w: number
  h: number
}

/**
 * Calculates distance from point (px, py) to line segment between (x1, y1) and (x2, y2).
 */
export function pointToSegmentDistance(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const dx = x2 - x1
  const dy = y2 - y1
  const l2 = dx * dx + dy * dy
  if (l2 === 0) return Math.hypot(px - x1, py - y1)
  let t = ((px - x1) * dx + (py - y1) * dy) / l2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

/**
 * Erases points of strokes that fall within a circle of radius R centered at (cx, cy).
 * If the eraser cuts through the middle of a stroke, it splits the stroke into multiple
 * separate continuous strokes with the same styling (color, size), exactly like erasing on paper.
 */
export function eraseStrokesAtPoint(
  strokes: Stroke[],
  cx: number,
  cy: number,
  radius: number
): Stroke[] {
  const result: Stroke[] = []

  for (const s of strokes) {
    if (s.points.length === 0) continue

    // Quick bounding box check
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const [x, y] of s.points) {
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }

    const pad = radius + (s.size || 4)
    if (cx < minX - pad || cx > maxX + pad || cy < minY - pad || cy > maxY + pad) {
      // Stroke is outside the eraser circle bounding box
      result.push(s)
      continue
    }

    // Point-by-point paper rub check
    const survivingSegments: InkPoint[][] = []
    let currentSegment: InkPoint[] = []
    const effectiveRadius = radius + (s.size || 4) * 0.35

    for (let i = 0; i < s.points.length; i++) {
      const pt = s.points[i]
      const dist = Math.hypot(pt[0] - cx, pt[1] - cy)

      // Also check segment to previous point for fast lines
      let segHit = false
      if (i > 0) {
        const prev = s.points[i - 1]
        if (pointToSegmentDistance(cx, cy, prev[0], prev[1], pt[0], pt[1]) <= effectiveRadius) {
          segHit = true
        }
      }

      if (dist > effectiveRadius && !segHit) {
        currentSegment.push(pt)
      } else {
        if (currentSegment.length >= 2) {
          survivingSegments.push(currentSegment)
        }
        currentSegment = []
      }
    }

    if (currentSegment.length >= 2) {
      survivingSegments.push(currentSegment)
    }

    if (survivingSegments.length === 1 && survivingSegments[0].length === s.points.length) {
      // No points were erased
      result.push(s)
    } else {
      // Split stroke into surviving continuous segments
      survivingSegments.forEach((seg, idx) => {
        result.push({
          ...s,
          id: idx === 0 ? s.id : `${s.id}-s${idx}-${Date.now().toString(36)}`,
          points: seg
        })
      })
    }
  }

  return result
}

/**
 * Sweeps the eraser along a path between (fromX, fromY) and (toX, toY) in small increments
 * to ensure that fast mouse/stylus movements produce a completely smooth, continuous paper erase.
 */
export function eraseStrokesAlongPath(
  strokes: Stroke[],
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  radius: number
): Stroke[] {
  const dist = Math.hypot(toX - fromX, toY - fromY)
  const steps = Math.max(1, Math.ceil(dist / Math.max(6, radius * 0.35)))
  let currentStrokes = strokes
  for (let step = 0; step <= steps; step++) {
    const t = step / steps
    const cx = fromX + (toX - fromX) * t
    const cy = fromY + (toY - fromY) * t
    currentStrokes = eraseStrokesAtPoint(currentStrokes, cx, cy, radius)
  }
  return currentStrokes
}

export function getShapeBoundingRect(s: ShapeNode): BoundsRect {
  if (s.points && s.points.length > 0) {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const [px, py] of s.points) {
      if (px < minX) minX = px
      if (py < minY) minY = py
      if (px > maxX) maxX = px
      if (py > maxY) maxY = py
    }
    return { minX, minY, maxX, maxY, x: minX, y: minY, w: maxX - minX, h: maxY - minY }
  }
  let minX = Math.min(s.x, s.x + s.w)
  let maxX = Math.max(s.x, s.x + s.w)
  let minY = Math.min(s.y, s.y + s.h)
  let maxY = Math.max(s.y, s.y + s.h)
  if (s.controlPoint) {
    minX = Math.min(minX, s.controlPoint[0])
    maxX = Math.max(maxX, s.controlPoint[0])
    minY = Math.min(minY, s.controlPoint[1])
    maxY = Math.max(maxY, s.controlPoint[1])
  }
  return { minX, minY, maxX, maxY, x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/**
 * Erases shapes whose bounding bounds or borders are touched by the eraser circle.
 */
export function eraseShapesAlongPath(
  shapes: ShapeNode[],
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  radius: number
): ShapeNode[] {
  return shapes.filter((s) => {
    const b = getShapeBoundingRect(s)
    const { minX, maxX, minY, maxY } = b

    // For polylines, check distance to actual segments
    if (s.points && s.points.length >= 2) {
      for (let i = 1; i < s.points.length; i++) {
        const [x1, y1] = s.points[i - 1]
        const [x2, y2] = s.points[i]
        if (
          pointToSegmentDistance(toX, toY, x1, y1, x2, y2) <= radius + 4 ||
          pointToSegmentDistance(fromX, fromY, x1, y1, x2, y2) <= radius + 4
        ) {
          return false
        }
      }
      return true
    }

    // Check if either end of the sweep or midpoints touch the shape
    const distToShape = (px: number, py: number): boolean => {
      if (px >= minX && px <= maxX && py >= minY && py <= maxY) return true
      const nearX = Math.max(minX, Math.min(px, maxX))
      const nearY = Math.max(minY, Math.min(py, maxY))
      return Math.hypot(px - nearX, py - nearY) <= radius
    }

    if (distToShape(toX, toY) || distToShape(fromX, fromY)) return false
    const midX = (fromX + toX) / 2
    const midY = (fromY + toY) / 2
    if (distToShape(midX, midY)) return false

    return true
  })
}

/* ------------------------------------------------------------------ */
/* Section / Marquee Intersection Helpers (Delete in one go)           */
/* ------------------------------------------------------------------ */

export function normalizeRect(x1: number, y1: number, x2: number, y2: number): BoundsRect {
  const minX = Math.min(x1, x2)
  const minY = Math.min(y1, y2)
  const maxX = Math.max(x1, x2)
  const maxY = Math.max(y1, y2)
  return {
    minX,
    minY,
    maxX,
    maxY,
    x: minX,
    y: minY,
    w: maxX - minX,
    h: maxY - minY
  }
}

export function isShapeInRect(s: ShapeNode, r: BoundsRect): boolean {
  const b = getShapeBoundingRect(s)
  return !(b.maxX < r.minX || b.minX > r.maxX || b.maxY < r.minY || b.minY > r.maxY)
}

export function isStrokeInRect(s: Stroke, r: BoundsRect): boolean {
  return s.points.some(([x, y]) => x >= r.minX && x <= r.maxX && y >= r.minY && y <= r.maxY)
}

export function isTextInRect(t: TextNode, r: BoundsRect): boolean {
  const estW = t.immersed
    ? Math.max(40, Math.min(600, Math.max(...t.text.split('\n').map((l) => l.length), 4) * (t.fontSize || 20) * 0.6))
    : 240
  const estH = t.immersed
    ? Math.max(28, (t.text.split('\n').length || 1) * (t.fontSize || 20) * 1.4)
    : 120
  const w = t.w || estW
  const h = t.h || estH
  return !(t.x + w < r.minX || t.x > r.maxX || t.y + h < r.minY || t.y > r.maxY)
}

export function isEquationInRect(eq: EquationNode, r: BoundsRect): boolean {
  const w = eq.w || 200
  const h = eq.h || 80
  return !(eq.x + w < r.minX || eq.x > r.maxX || eq.y + h < r.minY || eq.y > r.maxY)
}

export function isDiagramInRect(d: DiagramNode, r: BoundsRect): boolean {
  const w = Math.max(200, d.w || 640)
  const h = Math.max(140, d.h || 440)
  return !(d.x + w < r.minX || d.x > r.maxX || d.y + h < r.minY || d.y > r.maxY)
}

export function isCodeInRect(c: CodeNode, r: BoundsRect): boolean {
  const w = Math.max(260, c.w || 560)
  const h = Math.max(200, c.h || 420)
  return !(c.x + w < r.minX || c.x > r.maxX || c.y + h < r.minY || c.y > r.maxY)
}

export function isVectorArtInRect(v: VectorArtNode, r: BoundsRect): boolean {
  const minX = Math.min(v.x, v.x + v.width)
  const maxX = Math.max(v.x, v.x + v.width)
  const minY = Math.min(v.y, v.y + v.height)
  const maxY = Math.max(v.y, v.y + v.height)
  return !(maxX < r.minX || minX > r.maxX || maxY < r.minY || minY > r.maxY)
}

export function eraseVectorArtAlongPath(
  arts: VectorArtNode[],
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  radius: number
): VectorArtNode[] {
  return arts.filter((v) => {
    const minX = Math.min(v.x, v.x + v.width)
    const maxX = Math.max(v.x, v.x + v.width)
    const minY = Math.min(v.y, v.y + v.height)
    const maxY = Math.max(v.y, v.y + v.height)
    const touches = (px: number, py: number): boolean => {
      if (px >= minX && px <= maxX && py >= minY && py <= maxY) return true
      const nx = Math.max(minX, Math.min(px, maxX))
      const ny = Math.max(minY, Math.min(py, maxY))
      return Math.hypot(px - nx, py - ny) <= radius
    }
    return !touches(toX, toY) && !touches(fromX, fromY)
  })
}
