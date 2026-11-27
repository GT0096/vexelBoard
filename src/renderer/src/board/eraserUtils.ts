import type {
  BoardState,
  InkPoint,
  Stroke,
  ShapeNode,
  TextNode,
  EquationNode,
  DiagramNode,
  CodeNode,
  GraphNode,
  Scene3DNode,
  VideoNode,
  ImageNode,
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

export function isVideoInRect(v: VideoNode, r: BoundsRect): boolean {
  const w = Math.max(300, v.w || 540)
  const h = Math.max(240, v.h || 460)
  return !(v.x + w < r.minX || v.x > r.maxX || v.y + h < r.minY || v.y > r.maxY)
}

export function isImageInRect(img: ImageNode, r: BoundsRect): boolean {
  const w = Math.max(40, img.w || 320)
  const h = Math.max(40, img.h || 240)
  return !(img.x + w < r.minX || img.x > r.maxX || img.y + h < r.minY || img.y > r.maxY)
}

export function isScene3DInRect(s3d: Scene3DNode, r: BoundsRect): boolean {
  const w = Math.max(120, s3d.w || 460)
  const h = Math.max(100, s3d.h || 360)
  return !(s3d.x + w < r.minX || s3d.x > r.maxX || s3d.y + h < r.minY || s3d.y > r.maxY)
}

export function isGraphInRect(g: GraphNode, r: BoundsRect): boolean {
  const w = Math.max(140, g.w || 500)
  const h = Math.max(120, g.h || 360)
  return !(g.x + w < r.minX || g.x > r.maxX || g.y + h < r.minY || g.y > r.maxY)
}

export function isPointInPolygon(px: number, py: number, poly: Array<[number, number]>): boolean {
  if (poly.length < 3) return false
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    const intersect =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-9) + xi
    if (intersect) inside = !inside
  }
  return inside
}

function isBoxSelectedByLasso(
  x: number,
  y: number,
  w: number,
  h: number,
  poly: Array<[number, number]>,
  polyBounds: BoundsRect,
  strictEnclosure: boolean
): boolean {
  const minX = Math.min(x, x + w)
  const maxX = Math.max(x, x + w)
  const minY = Math.min(y, y + h)
  const maxY = Math.max(y, y + h)

  if (
    maxX < polyBounds.minX ||
    minX > polyBounds.maxX ||
    maxY < polyBounds.minY ||
    minY > polyBounds.maxY
  ) {
    return false
  }

  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const samplePts: Array<[number, number]> = [
    [cx, cy],
    [minX + (maxX - minX) * 0.2, minY + (maxY - minY) * 0.2],
    [minX + (maxX - minX) * 0.8, minY + (maxY - minY) * 0.2],
    [minX + (maxX - minX) * 0.8, minY + (maxY - minY) * 0.8],
    [minX + (maxX - minX) * 0.2, minY + (maxY - minY) * 0.8]
  ]

  if (strictEnclosure) {
    // Must fit well inside the loop's bounding box and have its center + majority of interior points inside the polygon
    const pad = 4
    if (
      minX < polyBounds.minX - pad ||
      maxX > polyBounds.maxX + pad ||
      minY < polyBounds.minY - pad ||
      maxY > polyBounds.maxY + pad
    ) {
      return false
    }
    const insideCount = samplePts.filter(([sx, sy]) => isPointInPolygon(sx, sy, poly)).length
    return isPointInPolygon(cx, cy, poly) && insideCount >= 4
  }

  return samplePts.some(([sx, sy]) => isPointInPolygon(sx, sy, poly))
}

/**
 * iPad-style Pen Lasso Selection:
 * Finds all editable board elements enclosed by (or touched by, in dedicated Lasso mode) a drawn pen loop.
 */
export function findElementsInLasso(
  board: BoardState,
  rawPoints: InkPoint[],
  opts?: {
    strictEnclosure?: boolean
    isLayerEditable?: (layerId?: string) => boolean
    cardsEditable?: boolean
    excludeStrokeId?: string
  }
): string[] {
  if (!rawPoints || rawPoints.length < 6) return []
  const strict = Boolean(opts?.strictEnclosure)
  const canEditLayer = opts?.isLayerEditable ?? (() => true)
  const cardsOk = opts?.cardsEditable ?? true

  // Subsample polygon for fast point-in-polygon checks
  const step = Math.max(1, Math.floor(rawPoints.length / 72))
  const poly: Array<[number, number]> = []
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i < rawPoints.length; i += step) {
    const [x, y] = rawPoints[i]
    poly.push([x, y])
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  const polyBounds: BoundsRect = {
    minX,
    minY,
    maxX,
    maxY,
    x: minX,
    y: minY,
    w: maxX - minX,
    h: maxY - minY
  }
  if (polyBounds.w < 16 || polyBounds.h < 16) return []

  const selected: string[] = []

  for (const s of board.shapeNodes) {
    if (!canEditLayer(s.layerId)) continue
    const b = getShapeBoundingRect(s)
    if (isBoxSelectedByLasso(b.x, b.y, Math.max(12, b.w), Math.max(12, b.h), poly, polyBounds, strict)) {
      selected.push(s.id)
    }
  }

  for (const v of board.vectorArtNodes ?? []) {
    if (!canEditLayer(v.layerId)) continue
    if (isBoxSelectedByLasso(v.x, v.y, v.width, v.height, poly, polyBounds, strict)) {
      selected.push(v.id)
    }
  }

  for (const t of board.textNodes) {
    const ok = t.immersed ? canEditLayer(t.layerId) : cardsOk
    if (!ok) continue
    const estW =
      t.w ??
      (t.immersed
        ? Math.max(40, Math.min(600, Math.max(...t.text.split('\n').map((l) => l.length), 4) * (t.fontSize || 20) * 0.6))
        : 240)
    const estH =
      t.h ?? (t.immersed ? Math.max(28, (t.text.split('\n').length || 1) * (t.fontSize || 20) * 1.4) : 120)
    if (isBoxSelectedByLasso(t.x, t.y, estW, estH, poly, polyBounds, strict)) {
      selected.push(t.id)
    }
  }

  if (cardsOk) {
    for (const eq of board.equationNodes) {
      if (isBoxSelectedByLasso(eq.x, eq.y, eq.w || 200, eq.h || 80, poly, polyBounds, strict)) {
        selected.push(eq.id)
      }
    }
    for (const d of board.diagramNodes ?? []) {
      if (isBoxSelectedByLasso(d.x, d.y, d.w || 640, d.h || 440, poly, polyBounds, strict)) {
        selected.push(d.id)
      }
    }
    for (const c of board.codeNodes ?? []) {
      if (isBoxSelectedByLasso(c.x, c.y, c.w || 560, c.h || 420, poly, polyBounds, strict)) {
        selected.push(c.id)
      }
    }
    for (const vid of board.videoNodes ?? []) {
      if (isBoxSelectedByLasso(vid.x, vid.y, vid.w || 540, vid.h || 460, poly, polyBounds, strict)) {
        selected.push(vid.id)
      }
    }
    for (const img of board.imageNodes ?? []) {
      if (isBoxSelectedByLasso(img.x, img.y, img.w || 320, img.h || 240, poly, polyBounds, strict)) {
        selected.push(img.id)
      }
    }
    for (const s3d of board.scene3dNodes ?? []) {
      if (isBoxSelectedByLasso(s3d.x, s3d.y, s3d.w || 460, s3d.h || 360, poly, polyBounds, strict)) {
        selected.push(s3d.id)
      }
    }
    for (const gr of board.graphNodes ?? []) {
      if (isBoxSelectedByLasso(gr.x, gr.y, gr.w || 500, gr.h || 360, poly, polyBounds, strict)) {
        selected.push(gr.id)
      }
    }
  }

  for (const st of board.strokes) {
    if (st.id === opts?.excludeStrokeId || !canEditLayer(st.layerId) || st.points.length === 0) continue
    let sMinX = Infinity
    let sMinY = Infinity
    let sMaxX = -Infinity
    let sMaxY = -Infinity
    let inCount = 0
    const sStep = Math.max(1, Math.floor(st.points.length / 20))
    let tested = 0
    for (let i = 0; i < st.points.length; i += sStep) {
      const [px, py] = st.points[i]
      if (px < sMinX) sMinX = px
      if (py < sMinY) sMinY = py
      if (px > sMaxX) sMaxX = px
      if (py > sMaxY) sMaxY = py
      if (
        px >= polyBounds.minX &&
        px <= polyBounds.maxX &&
        py >= polyBounds.minY &&
        py <= polyBounds.maxY &&
        isPointInPolygon(px, py, poly)
      ) {
        inCount++
      }
      tested++
    }
    if (strict) {
      if (
        sMinX >= polyBounds.minX - 6 &&
        sMaxX <= polyBounds.maxX + 6 &&
        sMinY >= polyBounds.minY - 6 &&
        sMaxY <= polyBounds.maxY + 6 &&
        inCount >= Math.max(1, Math.ceil(tested * 0.75))
      ) {
        selected.push(st.id)
      }
    } else if (inCount >= Math.max(1, Math.ceil(tested * 0.3))) {
      selected.push(st.id)
    }
  }

  return selected
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
