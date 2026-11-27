import { getStroke } from 'perfect-freehand'
import type {
  CanvasTransform,
  InkPoint,
  PenType,
  PortSide,
  ShapeKind,
  ShapeNode,
  Stroke,
  VectorArtNode,
  VectorPathLayer
} from '../types/board'
import { colorFor, resolveFontCss, type ThemeTokens } from '../themes'
import { isLightColor, type BoardPalette } from './backgroundPresets'
import { drawLibraryShapeOnCanvas, getLibraryShape } from '../shapes/shapeLibrary'
import {
  computeOrthogonalRoute,
  getShapePortHandles,
  type ConnectableBoardElement
} from './connectorUtils'
import {
  computePointAlongPolyline,
  computePointAlongQuadraticCurve,
  computePulseWaveState
} from './animatedArchitectureBuilder'

/* ------------------------------------------------------------------ */
/* Viewport Transforms                                                 */
/* ------------------------------------------------------------------ */

export function screenToCanvas(
  sx: number,
  sy: number,
  view: CanvasTransform
): { x: number; y: number } {
  return {
    x: (sx - view.panX) / view.zoom,
    y: (sy - view.panY) / view.zoom
  }
}

export function canvasToScreen(
  cx: number,
  cy: number,
  view: CanvasTransform
): { x: number; y: number } {
  return {
    x: cx * view.zoom + view.panX,
    y: cy * view.zoom + view.panY
  }
}

/* ------------------------------------------------------------------ */
/* Freehand strokes (Writing Pad / Stylus)                             */
/* ------------------------------------------------------------------ */

const outlineCache = new WeakMap<Stroke, Path2D>()

function outlineToPath(outline: number[][]): Path2D {
  const path = new Path2D()
  if (!outline.length) return path
  path.moveTo(outline[0][0], outline[0][1])
  for (let i = 1; i < outline.length; i++) {
    const [x0, y0] = outline[i]
    const [x1, y1] = outline[(i + 1) % outline.length]
    path.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2)
  }
  path.closePath()
  return path
}

function dashedCenterlinePath(points: InkPoint[]): Path2D {
  const path = new Path2D()
  if (points.length === 0) return path
  path.moveTo(points[0][0], points[0][1])
  if (points.length === 1) {
    path.lineTo(points[0][0] + 0.01, points[0][1] + 0.01)
    return path
  }
  for (let i = 1; i < points.length - 1; i++) {
    const [x0, y0] = points[i]
    const [x1, y1] = points[i + 1]
    path.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2)
  }
  const lastPt = points[points.length - 1]
  path.lineTo(lastPt[0], lastPt[1])
  return path
}

export function strokePath(
  points: InkPoint[],
  size: number,
  last = true,
  penType: PenType = 'fountain'
): Path2D {
  if (penType === 'dashed') {
    return dashedCenterlinePath(points)
  }

  const optsByType: Record<Exclude<PenType, 'dashed'>, Parameters<typeof getStroke>[1]> = {
    ballpoint: {
      size: Math.max(1.5, size * 0.85),
      thinning: 0.12,
      smoothing: 0.55,
      streamline: 0.5,
      simulatePressure: false,
      last,
      start: { taper: 0, cap: true },
      end: { taper: 0, cap: true }
    },
    fountain: {
      size,
      thinning: 0.6,
      smoothing: 0.55,
      streamline: 0.45,
      simulatePressure: true,
      last,
      start: { taper: size * 1.5, cap: true },
      end: { taper: size * 1.5, cap: true }
    },
    pencil: {
      size: Math.max(1.2, size * 0.75),
      thinning: 0.34,
      smoothing: 0.36,
      streamline: 0.36,
      simulatePressure: true,
      last,
      start: { taper: size * 0.65, cap: true },
      end: { taper: size * 0.85, cap: true }
    },
    brush: {
      size: Math.max(2.5, size * 1.55),
      thinning: 0.72,
      smoothing: 0.65,
      streamline: 0.52,
      simulatePressure: true,
      last,
      start: { taper: size * 2.2, cap: true },
      end: { taper: size * 2.6, cap: true }
    },
    marker: {
      size: Math.max(3, size * 1.45),
      thinning: 0.18,
      smoothing: 0.42,
      streamline: 0.35,
      simulatePressure: true,
      last,
      start: { taper: 0, cap: true },
      end: { taper: 0, cap: true }
    },
    highlighter: {
      size: Math.max(8, size * 2.5),
      thinning: 0,
      smoothing: 0.35,
      streamline: 0.5,
      simulatePressure: false,
      last,
      start: { taper: 0, cap: false },
      end: { taper: 0, cap: false }
    }
  }

  const outline = getStroke(points, optsByType[penType])
  return outlineToPath(outline)
}

const strokeBoundsCache = new WeakMap<
  Stroke,
  { minX: number; minY: number; maxX: number; maxY: number }
>()

export function getStrokeBoundsCached(s: Stroke): {
  minX: number
  minY: number
  maxX: number
  maxY: number
} {
  let b = strokeBoundsCache.get(s)
  if (b) return b
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const pad = Math.max(4, (s.size || 4) * 1.5)
  for (const [px, py] of s.points) {
    if (px < minX) minX = px
    if (py < minY) minY = py
    if (px > maxX) maxX = px
    if (py > maxY) maxY = py
  }
  b = Number.isFinite(minX)
    ? { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad }
    : { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  strokeBoundsCache.set(s, b)
  return b
}

export function isBoundsInViewport(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  vp: { minX: number; minY: number; maxX: number; maxY: number }
): boolean {
  return !(maxX < vp.minX || minX > vp.maxX || maxY < vp.minY || minY > vp.maxY)
}

function cachedStrokePath(stroke: Stroke): Path2D {
  let p = outlineCache.get(stroke)
  if (!p) {
    p = strokePath(stroke.points, stroke.size, true, stroke.penType ?? 'fountain')
    outlineCache.set(stroke, p)
  }
  return p
}

function applyInkStyle(ctx: CanvasRenderingContext2D, theme: ThemeTokens, color: string): void {
  ctx.fillStyle = color
  ctx.strokeStyle = color
  if (theme.contrastShadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.85)'
    ctx.shadowBlur = 6
    ctx.shadowOffsetY = 1.5
  } else if (theme.glow > 0) {
    ctx.shadowColor = color
    ctx.shadowBlur = theme.glow
    ctx.shadowOffsetY = 0
  } else {
    ctx.shadowBlur = 0
  }
}

export function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  theme: ThemeTokens,
  override?: { color?: string; alpha?: number; live?: boolean }
): void {
  const penType: PenType = stroke.penType ?? 'fountain'
  ctx.save()
  const baseAlpha = penType === 'highlighter' ? 0.36 : penType === 'pencil' ? 0.86 : 1
  ctx.globalAlpha = (override?.alpha ?? 1) * baseAlpha
  applyInkStyle(ctx, theme, override?.color ?? colorFor(theme, stroke.color))
  if (penType === 'highlighter' || penType === 'pencil') {
    ctx.shadowBlur = 0
  }
  const path = override?.live
    ? strokePath(stroke.points, stroke.size, false, penType)
    : cachedStrokePath(stroke)
  if (penType === 'dashed') {
    const dashLen = Math.max(4, stroke.size * 2.2)
    const gapLen = Math.max(4, stroke.size * 1.6)
    ctx.lineWidth = Math.max(1.5, stroke.size * 0.85)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.setLineDash([dashLen, gapLen])
    ctx.stroke(path)
  } else {
    ctx.fill(path)
  }
  ctx.restore()
}

/* ------------------------------------------------------------------ */
/* Shapes Rendering Engine (2D, 3D Isometric, System Design)          */
/* ------------------------------------------------------------------ */

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2)
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, rr)
}

function traceRoundedPolyline(
  ctx: CanvasRenderingContext2D,
  pts: Array<[number, number]>,
  cornerRadius = 10
): void {
  if (pts.length < 2) return
  ctx.beginPath()
  ctx.moveTo(pts[0][0], pts[0][1])
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1]
    const curr = pts[i]
    const next = pts[i + 1]
    const d1 = Math.hypot(curr[0] - prev[0], curr[1] - prev[1])
    const d2 = Math.hypot(next[0] - curr[0], next[1] - curr[1])
    const r = Math.min(cornerRadius, d1 * 0.4, d2 * 0.4)
    if (r >= 1.5) {
      ctx.arcTo(curr[0], curr[1], next[0], next[1], r)
    } else {
      ctx.lineTo(curr[0], curr[1])
    }
  }
  const last = pts[pts.length - 1]
  ctx.lineTo(last[0], last[1])
}

function drawTravelingPulsePoint(
  ctx: CanvasRenderingContext2D,
  pt: { x: number; y: number },
  color: string,
  radius: number,
  alpha: number,
  isHead: boolean
): void {
  ctx.save()
  ctx.setLineDash([])
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  if (isHead) {
    // Outer soft halo
    ctx.globalAlpha = 0.28 * alpha
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(pt.x, pt.y, radius * 2.1, 0, Math.PI * 2)
    ctx.fill()

    // Colored signal orb with crisp white rim
    ctx.globalAlpha = alpha
    ctx.fillStyle = color
    ctx.strokeStyle = '#FFFFFF'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()

    // White-hot core
    ctx.fillStyle = '#FFFFFF'
    ctx.beginPath()
    ctx.arc(pt.x, pt.y, Math.max(1.6, radius * 0.42), 0, Math.PI * 2)
    ctx.fill()
  } else {
    ctx.globalAlpha = alpha
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

function drawTravelingPulseOnPolyline(
  ctx: CanvasRenderingContext2D,
  pts: Array<[number, number]>,
  progress: number,
  color: string,
  strokeWidth = 2.5
): void {
  if (pts.length < 2) return
  const headRadius = Math.max(4.5, Math.min(8, strokeWidth * 1.9))
  for (let k = 5; k >= 1; k--) {
    const tailT = progress - k * 0.032
    if (tailT < 0) continue
    const tailPt = computePointAlongPolyline(pts, tailT)
    const ratio = (6 - k) / 6
    drawTravelingPulsePoint(ctx, tailPt, color, headRadius * (0.38 + ratio * 0.42), ratio * 0.55, false)
  }
  const headPt = computePointAlongPolyline(pts, progress)
  drawTravelingPulsePoint(ctx, headPt, color, headRadius, 1, true)
}

function drawTravelingPulseOnQuadratic(
  ctx: CanvasRenderingContext2D,
  p0: [number, number],
  ctrl: [number, number],
  p2: [number, number],
  progress: number,
  color: string,
  strokeWidth = 2.5
): void {
  const headRadius = Math.max(4.5, Math.min(8, strokeWidth * 1.9))
  for (let k = 5; k >= 1; k--) {
    const tailT = progress - k * 0.032
    if (tailT < 0) continue
    const tailPt = computePointAlongQuadraticCurve(p0, ctrl, p2, tailT)
    const ratio = (6 - k) / 6
    drawTravelingPulsePoint(ctx, tailPt, color, headRadius * (0.38 + ratio * 0.42), ratio * 0.55, false)
  }
  const headPt = computePointAlongQuadraticCurve(p0, ctrl, p2, progress)
  drawTravelingPulsePoint(ctx, headPt, color, headRadius, 1, true)
}

export function drawShape(
  ctx: CanvasRenderingContext2D,
  s: ShapeNode,
  theme: ThemeTokens,
  fontCss: string,
  palette?: BoardPalette,
  animTimeMs = 0
): void {
  const strokeColor =
    s.color === 'ink' && palette
      ? palette.shapeStroke
      : s.color === 'accent' && palette
        ? palette.accent
        : colorFor(theme, s.color)
  const isTransparentFill = s.fillColor === 'transparent' || s.fillColor === 'none'
  const fillOpacity =
    s.fillOpacity !== undefined ? Math.max(0, Math.min(1, s.fillOpacity)) : 1
  const fillColor = isTransparentFill
    ? 'transparent'
    : (s.fillColor || palette?.shapeFill || 'rgba(255, 229, 102, 0.9)')
  const rgbaAlphaMatch = s.fillColor
    ? /^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([0-9.]+)\s*\)$/i.exec(s.fillColor.trim())
    : null
  const isTranslucentFill =
    (rgbaAlphaMatch ? Number(rgbaAlphaMatch[1]) < 0.55 : false) || fillOpacity < 0.45
  const labelColor =
    isTransparentFill || isTranslucentFill
      ? (palette?.ink ?? strokeColor)
      : s.fillColor
        ? isLightColor(s.fillColor)
          ? '#111111'
          : '#FFFDF7'
        : (palette?.shapeText ?? strokeColor)

  const resolvedFontCss = s.fontFamily ? resolveFontCss(s.fontFamily) : fontCss

  ctx.save()
  applyInkStyle(ctx, theme, strokeColor)
  ctx.lineWidth = s.strokeWidth ?? 3
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  if (s.strokeStyle === 'dashed') {
    ctx.setLineDash([8, 6])
  } else if (s.strokeStyle === 'dotted') {
    ctx.setLineDash([2, 6])
  }

  if (s.rotation) {
    const cx = s.x + s.w / 2
    const cy = s.y + s.h / 2
    ctx.translate(cx, cy)
    ctx.rotate((s.rotation * Math.PI) / 180)
    ctx.translate(-cx, -cy)
  }

  const isAnimated = Boolean(s.animated || s.shape.startsWith('anim-line-'))
  const isConnectorLine =
    Boolean(s.startBinding || s.endBinding) ||
    s.shape.startsWith('anim-line-') ||
    s.shape === 'line' ||
    s.shape === 'dashed-line' ||
    s.shape === 'arrow' ||
    s.shape === 'arrow-bidirectional' ||
    s.shape === 'elbow' ||
    s.shape === 'curved-arrow' ||
    s.shape === 'curved-line' ||
    s.shape === 'polyline'
  const isConnector = isConnectorLine || s.shape === 'actor'
  const wave = computePulseWaveState(animTimeMs, s.flowStage, s.flowTotalStages)
  const pulseColor =
    s.pulseColor ||
    (s.color !== 'ink' && s.color !== 'accent'
      ? strokeColor
      : (palette?.accent ?? '#3B82F6'))
  const usePulseOrb = isAnimated && s.animationMode !== 'dash'
  const useMarchingDash =
    isAnimated &&
    (s.animationMode === 'dash' ||
      s.animationMode === 'both' ||
      (!s.animationMode && typeof s.flowStage !== 'number' && !isConnectorLine))

  if (useMarchingDash) {
    const flowDash = s.strokeStyle === 'dotted' ? [3, 6] : [10, 6]
    const flowCycle = s.strokeStyle === 'dotted' ? 9 : 16
    ctx.setLineDash(flowDash)
    ctx.lineDashOffset = -((animTimeMs / 24) % flowCycle)
  }

  if (
    isAnimated &&
    !isConnectorLine &&
    typeof s.flowStage === 'number' &&
    wave.active &&
    s.shape !== 'ml-neural-net'
  ) {
    ctx.save()
    ctx.setLineDash([])
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
    ctx.strokeStyle = pulseColor
    ctx.globalAlpha = 0.36 * Math.sin(wave.progress * Math.PI)
    ctx.lineWidth = 5
    const rx = s.w < 0 ? s.x + s.w : s.x
    const ry = s.h < 0 ? s.y + s.h : s.y
    const rw = Math.abs(s.w)
    const rh = Math.abs(s.h)
    roundedRect(ctx, rx - 3, ry - 3, rw + 6, rh + 6, (s.borderRadius ?? 10) + 3)
    ctx.stroke()
    ctx.restore()
  }

  const fillShapePath = (): void => {
    if (isTransparentFill || fillOpacity <= 0) return
    ctx.save()
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
    if (fillOpacity < 1) {
      ctx.globalAlpha *= fillOpacity
    }
    ctx.fillStyle = fillColor
    ctx.fill()
    ctx.restore()
  }

  const drawArrowHead = (tipX: number, tipY: number, angle: number, head: number): void => {
    ctx.save()
    ctx.setLineDash([])
    ctx.fillStyle = strokeColor
    ctx.beginPath()
    ctx.moveTo(tipX, tipY)
    ctx.lineTo(tipX - head * Math.cos(angle - Math.PI / 7), tipY - head * Math.sin(angle - Math.PI / 7))
    ctx.lineTo(tipX - head * Math.cos(angle + Math.PI / 7), tipY - head * Math.sin(angle + Math.PI / 7))
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }

  let labelX = s.x + s.w / 2
  let labelY = s.y + s.h / 2

  const shape: ShapeKind = s.shape

  switch (shape) {
    /* ---- 2D Basic ---- */
    case 'rect': {
      const r = s.borderRadius ?? 8
      if (r <= 0) {
        ctx.lineJoin = 'miter'
        ctx.beginPath()
        ctx.rect(s.x, s.y, s.w, s.h)
      } else {
        roundedRect(ctx, s.x, s.y, s.w, s.h, r)
      }
      fillShapePath()
      ctx.stroke()
      break
    }

    case 'rounded-rect': {
      const r = s.borderRadius ?? Math.min(24, Math.min(Math.abs(s.w), Math.abs(s.h)) / 3)
      roundedRect(ctx, s.x, s.y, s.w, s.h, r)
      fillShapePath()
      ctx.stroke()
      break
    }

    case 'circle':
      ctx.beginPath()
      ctx.ellipse(s.x + s.w / 2, s.y + s.h / 2, Math.abs(s.w / 2), Math.abs(s.h / 2), 0, 0, Math.PI * 2)
      fillShapePath()
      ctx.stroke()
      break

    case 'diamond':
      ctx.beginPath()
      ctx.moveTo(s.x + s.w / 2, s.y)
      ctx.lineTo(s.x + s.w, s.y + s.h / 2)
      ctx.lineTo(s.x + s.w / 2, s.y + s.h)
      ctx.lineTo(s.x, s.y + s.h / 2)
      ctx.closePath()
      fillShapePath()
      ctx.stroke()
      break

    case 'triangle':
      ctx.beginPath()
      ctx.moveTo(s.x + s.w / 2, s.y)
      ctx.lineTo(s.x + s.w, s.y + s.h)
      ctx.lineTo(s.x, s.y + s.h)
      ctx.closePath()
      fillShapePath()
      ctx.stroke()
      labelY += s.h * 0.15
      break

    case 'parallelogram': {
      const skew = s.w * 0.2
      ctx.beginPath()
      ctx.moveTo(s.x + skew, s.y)
      ctx.lineTo(s.x + s.w, s.y)
      ctx.lineTo(s.x + s.w - skew, s.y + s.h)
      ctx.lineTo(s.x, s.y + s.h)
      ctx.closePath()
      fillShapePath()
      ctx.stroke()
      break
    }

    /* ---- System Design & Architecture ---- */
    case 'cylinder': {
      // Database storage
      const ry = Math.min(22, s.h * 0.18)
      ctx.beginPath()
      // Body
      ctx.moveTo(s.x, s.y + ry)
      ctx.lineTo(s.x, s.y + s.h - ry)
      ctx.ellipse(s.x + s.w / 2, s.y + s.h - ry, s.w / 2, ry, 0, 0, Math.PI, false)
      ctx.lineTo(s.x + s.w, s.y + ry)
      fillShapePath()
      ctx.stroke()

      // Top ellipse
      ctx.beginPath()
      ctx.ellipse(s.x + s.w / 2, s.y + ry, s.w / 2, ry, 0, 0, Math.PI * 2)
      fillShapePath()
      ctx.stroke()

      // Middle indicator line
      ctx.beginPath()
      ctx.ellipse(s.x + s.w / 2, s.y + s.h * 0.55, s.w / 2, ry, 0, 0, Math.PI, false)
      ctx.stroke()
      break
    }

    case 'cloud': {
      // Cloud infrastructure
      const rx = s.w / 2
      const ry = s.h / 2
      const cx = s.x + rx
      const cy = s.y + ry
      ctx.beginPath()
      ctx.arc(cx - rx * 0.45, cy + ry * 0.1, ry * 0.45, 0.5 * Math.PI, 1.5 * Math.PI)
      ctx.arc(cx - rx * 0.15, cy - ry * 0.35, ry * 0.55, 1.0 * Math.PI, 1.9 * Math.PI)
      ctx.arc(cx + rx * 0.35, cy - ry * 0.2, ry * 0.48, 1.4 * Math.PI, 0.2 * Math.PI)
      ctx.arc(cx + rx * 0.45, cy + ry * 0.2, ry * 0.4, 1.8 * Math.PI, 0.5 * Math.PI)
      ctx.closePath()
      fillShapePath()
      ctx.stroke()
      break
    }

    case 'server': {
      // Server rack
      roundedRect(ctx, s.x, s.y, s.w, s.h, 10)
      fillShapePath()
      ctx.stroke()
      // Rack horizontal dividers
      const step = s.h / 4
      for (let i = 1; i < 4; i++) {
        ctx.beginPath()
        ctx.moveTo(s.x, s.y + step * i)
        ctx.lineTo(s.x + s.w, s.y + step * i)
        ctx.stroke()
        // LED indicator
        ctx.beginPath()
        ctx.arc(s.x + 16, s.y + step * i - step / 2, 3.5, 0, Math.PI * 2)
        ctx.fill()
      }
      break
    }

    case 'queue': {
      // Message queue (tube)
      const ry = s.h / 2
      ctx.beginPath()
      ctx.moveTo(s.x + 18, s.y)
      ctx.lineTo(s.x + s.w - 18, s.y)
      ctx.ellipse(s.x + s.w - 18, s.y + ry, 18, ry, 0, -Math.PI / 2, Math.PI / 2)
      ctx.lineTo(s.x + 18, s.y + s.h)
      ctx.ellipse(s.x + 18, s.y + ry, 18, ry, 0, Math.PI / 2, -Math.PI / 2, true)
      fillShapePath()
      ctx.stroke()
      // Segments
      const slots = 3
      for (let i = 1; i <= slots; i++) {
        const sx = s.x + (s.w / (slots + 1)) * i
        ctx.beginPath()
        ctx.ellipse(sx, s.y + ry, 10, ry, 0, -Math.PI / 2, Math.PI / 2)
        ctx.stroke()
      }
      break
    }

    case 'actor': {
      // User / Client icon
      const headR = Math.min(18, s.w * 0.16)
      const headY = s.y + headR + 4
      // Head
      ctx.beginPath()
      ctx.arc(s.x + s.w / 2, headY, headR, 0, Math.PI * 2)
      fillShapePath()
      ctx.stroke()
      // Spine
      const spineTop = headY + headR
      const spineBot = s.y + s.h * 0.65
      ctx.beginPath()
      ctx.moveTo(s.x + s.w / 2, spineTop)
      ctx.lineTo(s.x + s.w / 2, spineBot)
      // Arms
      const armY = spineTop + (spineBot - spineTop) * 0.35
      ctx.moveTo(s.x + s.w * 0.2, armY)
      ctx.lineTo(s.x + s.w * 0.8, armY)
      // Legs
      ctx.moveTo(s.x + s.w / 2, spineBot)
      ctx.lineTo(s.x + s.w * 0.25, s.y + s.h)
      ctx.moveTo(s.x + s.w / 2, spineBot)
      ctx.lineTo(s.x + s.w * 0.75, s.y + s.h)
      ctx.stroke()
      labelY = s.y + s.h + 14
      break
    }

    case 'component': {
      // Component UML
      roundedRect(ctx, s.x + 14, s.y, s.w - 14, s.h, 8)
      fillShapePath()
      ctx.stroke()
      // Left tabs
      const tabH = s.h * 0.2
      roundedRect(ctx, s.x, s.y + s.h * 0.2, 28, tabH, 3)
      fillShapePath()
      ctx.stroke()
      roundedRect(ctx, s.x, s.y + s.h * 0.6, 28, tabH, 3)
      fillShapePath()
      ctx.stroke()
      break
    }

    /* ---- 3D Isometric Shapes ---- */
    case 'cube3d': {
      // 3D Isometric Block
      const isoDx = s.w * 0.5
      const isoDy = s.h * 0.25
      const isoH = s.h * 0.55
      const topCx = s.x + isoDx
      const topCy = s.y + isoDy

      // Top face
      ctx.beginPath()
      ctx.moveTo(topCx, s.y)
      ctx.lineTo(s.x + s.w, topCy)
      ctx.lineTo(topCx, topCy + isoDy)
      ctx.lineTo(s.x, topCy)
      ctx.closePath()
      fillShapePath()
      ctx.stroke()

      // Left face
      ctx.beginPath()
      ctx.moveTo(s.x, topCy)
      ctx.lineTo(topCx, topCy + isoDy)
      ctx.lineTo(topCx, topCy + isoDy + isoH)
      ctx.lineTo(s.x, topCy + isoH)
      ctx.closePath()
      fillShapePath()
      ctx.stroke()

      // Right face
      ctx.beginPath()
      ctx.moveTo(topCx, topCy + isoDy)
      ctx.lineTo(s.x + s.w, topCy)
      ctx.lineTo(s.x + s.w, topCy + isoH)
      ctx.lineTo(topCx, topCy + isoDy + isoH)
      ctx.closePath()
      fillShapePath()
      ctx.stroke()

      labelY = topCy + isoDy + isoH * 0.35
      break
    }

    case 'cylinder3d':
    case 'sphere3d': {
      // Shaded 3D Sphere
      ctx.beginPath()
      const radius = Math.min(s.w, s.h) / 2
      ctx.arc(s.x + s.w / 2, s.y + s.h / 2, radius, 0, Math.PI * 2)
      if (!isTransparentFill && fillOpacity > 0) {
        ctx.save()
        if (fillOpacity < 1) {
          ctx.globalAlpha *= fillOpacity
        }
        const grad = ctx.createRadialGradient(
          s.x + s.w * 0.38,
          s.y + s.h * 0.38,
          radius * 0.1,
          s.x + s.w / 2,
          s.y + s.h / 2,
          radius
        )
        grad.addColorStop(0, 'rgba(255,255,255,0.65)')
        grad.addColorStop(0.55, fillColor)
        grad.addColorStop(1, strokeColor)
        ctx.fillStyle = grad
        ctx.fill()
        ctx.restore()
      }
      ctx.stroke()
      break
    }

    /* ---- ML & Neural Architecture Blocks ---- */
    case 'ml-neural-net': {
      const rx = s.w < 0 ? s.x + s.w : s.x
      const ry = s.h < 0 ? s.y + s.h : s.y
      const rw = Math.max(24, Math.abs(s.w))
      const rh = Math.max(24, Math.abs(s.h))
      const cornerR = s.borderRadius ?? 10

      if (isAnimated && wave.active) {
        ctx.save()
        ctx.setLineDash([])
        ctx.shadowColor = 'transparent'
        ctx.shadowBlur = 0
        ctx.strokeStyle = pulseColor
        ctx.globalAlpha = 0.42 * Math.sin(wave.progress * Math.PI)
        ctx.lineWidth = 6
        roundedRect(ctx, rx - 3, ry - 3, rw + 6, rh + 6, cornerR + 3)
        ctx.stroke()
        ctx.restore()
      }

      roundedRect(ctx, rx, ry, rw, rh, cornerR)
      fillShapePath()
      ctx.stroke()

      const hasTopTitle = Boolean(s.label && s.label.trim().length > 0 && rh >= 68)
      const yFractions = hasTopTitle ? [0.38, 0.61, 0.84] : [0.22, 0.5, 0.78]
      const counts = rw >= 130 ? [4, 5, 4] : [3, 4, 3]
      const neuronR = Math.max(3, Math.min(6.8, Math.min(rw, rh) * 0.055))

      const layers: Array<Array<[number, number]>> = yFractions.map((yf, layerIdx) => {
        const count = counts[layerIdx]
        const yPos = ry + rh * yf
        const padX = rw * (count >= 5 ? 0.14 : 0.2)
        const span = Math.max(8, rw - padX * 2)
        const pts: Array<[number, number]> = []
        for (let i = 0; i < count; i++) {
          const xPos = count === 1 ? rx + rw / 2 : rx + padX + (span * i) / (count - 1)
          pts.push([xPos, yPos])
        }
        return pts
      })

      // Active wave band sweeping through layers 0 -> 1 -> 2
      const activeBand = isAnimated && wave.active ? wave.progress * 2 : -1

      // Draw inter-layer weight edges
      ctx.save()
      if (s.strokeStyle !== 'dashed') {
        ctx.setLineDash([])
      }
      for (let l = 0; l < layers.length - 1; l++) {
        const fromLayer = layers[l]
        const toLayer = layers[l + 1]
        const edgeActive =
          activeBand >= 0 && activeBand >= l - 0.35 && activeBand <= l + 1.15
        ctx.strokeStyle = edgeActive ? pulseColor : strokeColor
        ctx.lineWidth = edgeActive ? 1.65 : 1.1
        ctx.globalAlpha = edgeActive ? 0.88 : 0.45
        ctx.beginPath()
        for (const [fx, fy] of fromLayer) {
          for (const [tx, ty] of toLayer) {
            ctx.moveTo(fx, fy)
            ctx.lineTo(tx, ty)
          }
        }
        ctx.stroke()
      }

      // Draw neuron nodes
      ctx.setLineDash([])
      for (let l = 0; l < layers.length; l++) {
        const layerDist = activeBand >= 0 ? Math.abs(activeBand - l) : 99
        const isNeuronFiring = layerDist < 0.65
        for (const [nx, ny] of layers[l]) {
          ctx.beginPath()
          ctx.arc(nx, ny, isNeuronFiring ? neuronR * 1.18 : neuronR, 0, Math.PI * 2)
          ctx.fillStyle = isNeuronFiring ? pulseColor : '#FFFFFF'
          ctx.globalAlpha = 1
          ctx.fill()
          ctx.lineWidth = 1.4
          ctx.strokeStyle = strokeColor
          ctx.stroke()
        }
      }
      ctx.restore()

      if (hasTopTitle) {
        labelY = ry + Math.min(20, rh * 0.17)
      }
      break
    }

    case 'ml-token-vector': {
      const rx = s.w < 0 ? s.x + s.w : s.x
      const ry = s.h < 0 ? s.y + s.h : s.y
      const rw = Math.max(18, Math.abs(s.w))
      const rh = Math.max(12, Math.abs(s.h))
      roundedRect(ctx, rx, ry, rw, rh, s.borderRadius ?? 4)
      fillShapePath()
      ctx.stroke()

      // Draw 3 inner embedding cells [■ ■ ■]
      const cellSize = Math.max(4, Math.min(rh * 0.46, rw * 0.18))
      const cy = ry + (rh - cellSize) / 2
      const cellCenters = [0.23, 0.5, 0.77]
      ctx.save()
      ctx.setLineDash([])
      for (let i = 0; i < cellCenters.length; i++) {
        const cx = rx + rw * cellCenters[i] - cellSize / 2
        const firing = isAnimated && wave.active
        ctx.fillStyle = firing ? pulseColor : '#D8B4FE'
        ctx.strokeStyle = strokeColor
        ctx.lineWidth = 1.25
        roundedRect(ctx, cx, cy, cellSize, cellSize, 1.5)
        ctx.fill()
        ctx.stroke()
      }
      ctx.restore()
      break
    }

    case 'ml-adder': {
      const cx = s.x + s.w / 2
      const cy = s.y + s.h / 2
      const rx = Math.max(6, Math.abs(s.w / 2))
      const ry = Math.max(6, Math.abs(s.h / 2))
      ctx.beginPath()
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
      fillShapePath()
      ctx.stroke()

      const arm = Math.min(rx, ry) * 0.48
      ctx.save()
      ctx.setLineDash([])
      ctx.strokeStyle = strokeColor
      ctx.lineWidth = Math.max(1.8, (s.strokeWidth ?? 2.2) * 0.95)
      ctx.beginPath()
      ctx.moveTo(cx - arm, cy)
      ctx.lineTo(cx + arm, cy)
      ctx.moveTo(cx, cy - arm)
      ctx.lineTo(cx, cy + arm)
      ctx.stroke()
      ctx.restore()
      break
    }

    /* ---- Connectors ---- */
    case 'line':
    case 'dashed-line':
    case 'arrow':
    case 'arrow-bidirectional':
    case 'elbow': {
      const x2 = s.x + s.w
      const y2 = s.y + s.h
      const len = Math.hypot(s.w, s.h)
      const angle = Math.atan2(s.h, s.w)
      const head = Math.min(18, Math.max(11, len * 0.14))
      const hasEndArrow =
        shape === 'arrow' || shape === 'arrow-bidirectional'
          ? s.arrowEnd !== false
          : Boolean(s.arrowEnd)
      const hasStartArrow =
        shape === 'arrow-bidirectional'
          ? s.arrowStart !== false
          : Boolean(s.arrowStart)

      if (shape === 'dashed-line' && !useMarchingDash) {
        ctx.setLineDash([8, 6])
      }

      ctx.beginPath()
      if (shape === 'elbow') {
        const midX = s.x + s.w * 0.5
        ctx.moveTo(s.x, s.y)
        ctx.lineTo(midX, s.y)
        ctx.lineTo(midX, y2)
        ctx.lineTo(x2, y2)
      } else {
        const trimStart = hasStartArrow && len > head * 1.6 ? head * 0.72 : 0
        const trimEnd = hasEndArrow && len > head * 1.2 ? head * 0.72 : 0
        ctx.moveTo(s.x + Math.cos(angle) * trimStart, s.y + Math.sin(angle) * trimStart)
        ctx.lineTo(x2 - Math.cos(angle) * trimEnd, y2 - Math.sin(angle) * trimEnd)
      }
      ctx.stroke()
      ctx.setLineDash([])
      ctx.lineDashOffset = 0

      // Arrowheads
      if (hasEndArrow) {
        drawArrowHead(x2, y2, angle, head)
      }
      if (hasStartArrow) {
        drawArrowHead(s.x, s.y, angle + Math.PI, head)
      }

      if (usePulseOrb && wave.active) {
        const pulsePts: Array<[number, number]> =
          shape === 'elbow'
            ? [
                [s.x, s.y],
                [s.x + s.w * 0.5, s.y],
                [s.x + s.w * 0.5, y2],
                [x2, y2]
              ]
            : [
                [s.x, s.y],
                [x2, y2]
              ]
        drawTravelingPulseOnPolyline(ctx, pulsePts, wave.progress, pulseColor, s.strokeWidth ?? 2.5)
      }

      labelX = s.x + s.w / 2
      labelY = s.y + s.h / 2
      break
    }

    case 'curved-line':
    case 'curved-arrow': {
      const x2 = s.x + s.w
      const y2 = s.y + s.h
      const cx = s.controlPoint?.[0] ?? (s.x + x2) / 2
      const cy = s.controlPoint?.[1] ?? (s.y + y2) / 2 - 40
      const hasEndArrow = shape === 'curved-arrow' ? s.arrowEnd !== false : Boolean(s.arrowEnd)
      const hasStartArrow = Boolean(s.arrowStart)

      ctx.beginPath()
      ctx.moveTo(s.x, s.y)
      ctx.quadraticCurveTo(cx, cy, x2, y2)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.lineDashOffset = 0

      if (hasEndArrow) {
        const angle = Math.atan2(y2 - cy, x2 - cx)
        const head = Math.min(18, Math.max(11, Math.hypot(s.w, s.h) * 0.14))
        drawArrowHead(x2, y2, angle, head)
      }
      if (hasStartArrow) {
        const startAngle = Math.atan2(s.y - cy, s.x - cx)
        const head = Math.min(18, Math.max(11, Math.hypot(s.w, s.h) * 0.14))
        drawArrowHead(s.x, s.y, startAngle, head)
      }

      if (usePulseOrb && wave.active) {
        drawTravelingPulseOnQuadratic(
          ctx,
          [s.x, s.y],
          [cx, cy],
          [x2, y2],
          wave.progress,
          pulseColor,
          s.strokeWidth ?? 2.5
        )
      }

      // Midpoint of quadratic Bézier at t=0.5
      labelX = 0.25 * s.x + 0.5 * cx + 0.25 * x2
      labelY = 0.25 * s.y + 0.5 * cy + 0.25 * y2
      break
    }

    case 'polyline': {
      const pts = s.points && s.points.length >= 2 ? s.points : [[s.x, s.y], [s.x + s.w, s.y + s.h]] as Array<[number, number]>
      const head = Math.max(11, Math.min(16, (s.strokeWidth ?? 3) * 4.2))
      const hasEndArrow = s.arrowEnd !== false && pts.length >= 2
      const hasStartArrow = Boolean(s.arrowStart) && pts.length >= 2

      // Trim start/end slightly inside arrowheads so line cap never pokes past tip
      const drawPts = pts.map(([px, py]) => [px, py] as [number, number])
      if (hasEndArrow) {
        const prev = drawPts[drawPts.length - 2]
        const end = drawPts[drawPts.length - 1]
        const segLen = Math.hypot(end[0] - prev[0], end[1] - prev[1])
        if (segLen > head) {
          const ang = Math.atan2(end[1] - prev[1], end[0] - prev[0])
          drawPts[drawPts.length - 1] = [
            end[0] - Math.cos(ang) * head * 0.72,
            end[1] - Math.sin(ang) * head * 0.72
          ]
        }
      }
      if (hasStartArrow) {
        const start = drawPts[0]
        const next = drawPts[1]
        const segLen = Math.hypot(next[0] - start[0], next[1] - start[1])
        if (segLen > head) {
          const ang = Math.atan2(next[1] - start[1], next[0] - start[0])
          drawPts[0] = [
            start[0] + Math.cos(ang) * head * 0.72,
            start[1] + Math.sin(ang) * head * 0.72
          ]
        }
      }

      ctx.save()
      const useSmoothCorners = s.routing === 'orthogonal' && drawPts.length >= 3
      if (useSmoothCorners) {
        ctx.lineJoin = 'round'
        ctx.lineCap = 'round'
        traceRoundedPolyline(ctx, drawPts, 10)
      } else {
        ctx.lineJoin = s.routing === 'curved' ? 'round' : 'miter'
        ctx.lineCap = s.routing === 'curved' ? 'round' : 'square'
        ctx.beginPath()
        ctx.moveTo(drawPts[0][0], drawPts[0][1])
        for (let i = 1; i < drawPts.length; i++) {
          ctx.lineTo(drawPts[i][0], drawPts[i][1])
        }
      }
      ctx.stroke()
      ctx.restore()
      ctx.setLineDash([])
      ctx.lineDashOffset = 0

      if (hasEndArrow) {
        const prev = pts[pts.length - 2]
        const end = pts[pts.length - 1]
        drawArrowHead(end[0], end[1], Math.atan2(end[1] - prev[1], end[0] - prev[0]), head)
      }
      if (hasStartArrow) {
        const start = pts[0]
        const next = pts[1]
        drawArrowHead(start[0], start[1], Math.atan2(start[1] - next[1], start[0] - next[0]), head)
      }

      if (usePulseOrb && wave.active) {
        drawTravelingPulseOnPolyline(ctx, pts, wave.progress, pulseColor, s.strokeWidth ?? 2.5)
      }

      // Place label on the longest segment midpoint for clean flow badge readability
      let bestMid: [number, number] = pts[Math.floor(pts.length / 2)]
      let bestSegLen = -1
      for (let i = 0; i < pts.length - 1; i++) {
        const segLen = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
        if (segLen > bestSegLen) {
          bestSegLen = segLen
          bestMid = [(pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2]
        }
      }
      labelX = bestMid[0]
      labelY = bestMid[1]
      break
    }

    case 'svg-path': {
      const x = s.w < 0 ? s.x + s.w : s.x
      const y = s.h < 0 ? s.y + s.h : s.y
      const w = Math.max(4, Math.abs(s.w))
      const h = Math.max(4, Math.abs(s.h))
      const vb = s.svgViewBox
      const [vbX, vbY, vbW, vbH] =
        vb && vb.length === 4 ? vb : [0, 0, vb?.[0] ?? 100, vb?.[1] ?? 100]
      const sx = w / Math.max(1, vbW)
      const sy = h / Math.max(1, vbH)
      const matrix = new DOMMatrix().translate(x, y).scale(sx, sy).translate(-vbX, -vbY)

      const pathList = s.svgPaths?.length
        ? s.svgPaths
        : s.svgPath
          ? [{ d: s.svgPath, fill: fillColor, stroke: strokeColor, strokeWidth: s.strokeWidth ?? 2.5 }]
          : []

      for (const p of pathList) {
        try {
          const transformed = new Path2D()
          transformed.addPath(new Path2D(p.d), matrix)

          const pFill =
            !p.fill || p.fill === 'none' || p.fill === 'transparent'
              ? null
              : p.fill === 'ink'
                ? strokeColor
                : p.fill === 'accent'
                  ? (palette?.accent ?? theme.accent)
                  : p.fill
          if (pFill && fillOpacity > 0) {
            ctx.save()
            ctx.shadowColor = 'transparent'
            ctx.shadowBlur = 0
            if (fillOpacity < 1) {
              ctx.globalAlpha *= fillOpacity
            }
            ctx.fillStyle = pFill
            ctx.fill(transformed)
            ctx.restore()
          }

          if (p.stroke !== 'none') {
            ctx.save()
            const pStroke =
              !p.stroke || p.stroke === 'ink'
                ? strokeColor
                : p.stroke === 'accent'
                  ? (palette?.accent ?? theme.accent)
                  : p.stroke
            ctx.strokeStyle = pStroke
            ctx.lineWidth = p.strokeWidth ?? s.strokeWidth ?? 2.5
            ctx.lineCap = 'round'
            ctx.lineJoin = 'round'
            if (isAnimated) {
              const flowDash = s.strokeStyle === 'dotted' ? [3, 6] : [10, 6]
              const flowCycle = s.strokeStyle === 'dotted' ? 9 : 16
              ctx.setLineDash(flowDash)
              ctx.lineDashOffset = -((animTimeMs / 24) % flowCycle)
            } else if (p.dashed || s.strokeStyle === 'dashed') {
              ctx.setLineDash([8, 6])
            } else if (s.strokeStyle === 'dotted') {
              ctx.setLineDash([2, 6])
            } else {
              ctx.setLineDash([])
            }
            ctx.stroke(transformed)
            ctx.restore()
          }
        } catch {
          /* ignore malformed SVG path */
        }
      }
      labelX = x + w / 2
      labelY = y + h / 2
      break
    }

    default: {
      const libShape = getLibraryShape(shape)
      if (libShape) {
        const res = drawLibraryShapeOnCanvas(
          ctx,
          libShape,
          s.x,
          s.y,
          s.w,
          s.h,
          strokeColor,
          fillColor,
          s.strokeWidth ?? 3,
          fillOpacity,
          isAnimated,
          animTimeMs
        )
        labelX = res.labelX
        labelY = res.labelY
      } else {
        roundedRect(ctx, s.x, s.y, s.w, s.h, 8)
        fillShapePath()
        ctx.stroke()
      }
      break
    }
  }

  // Label text
  if (s.label) {
    ctx.shadowBlur = theme.contrastShadow ? 6 : 0
    const isShortCellLabel = s.label.trim().length <= 4 && !isConnector
    const autoSize = isConnectorLine
      ? 12
      : isShortCellLabel
        ? Math.max(16, Math.min(34, Math.min(Math.abs(s.h) * 0.52, Math.abs(s.w) * 0.42)))
        : Math.max(13, Math.min(20, Math.abs(s.h) * 0.28))
    const size = s.labelSize ?? Math.round(autoSize)
    const weight = s.labelBold === false ? 500 : 700
    ctx.font = `${weight} ${size}px ${resolvedFontCss}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const maxW = isConnectorLine ? 180 : Math.max(100, Math.abs(s.w) * 0.88)
    const lines = wrapText(ctx, s.label, maxW)
    if (isConnectorLine && lines.length > 0) {
      let maxMeasured = 24
      for (const l of lines) {
        const w = ctx.measureText(l).width
        if (w > maxMeasured) maxMeasured = w
      }
      const pillW = maxMeasured + 12
      const pillH = lines.length * size * 1.2 + 6
      ctx.save()
      ctx.shadowBlur = 0
      ctx.fillStyle = palette?.bg && palette.bg !== 'transparent' ? palette.bg : '#FFFDF7'
      ctx.strokeStyle = strokeColor
      ctx.lineWidth = 1.25
      ctx.setLineDash([])
      ctx.beginPath()
      ctx.roundRect(labelX - pillW / 2, labelY - pillH / 2, pillW, pillH, 6)
      ctx.fill()
      ctx.stroke()
      ctx.restore()
    }
    const resolvedLabelColor =
      s.labelColor && s.labelColor !== 'auto'
        ? s.labelColor === 'ink'
          ? (palette?.ink ?? strokeColor)
          : s.labelColor === 'accent'
            ? (palette?.accent ?? theme.accent)
            : s.labelColor
        : isConnector
          ? (palette?.ink ?? strokeColor)
          : labelColor
    ctx.fillStyle = resolvedLabelColor
    lines.forEach((line, i, arr) => {
      const offset = (i - (arr.length - 1) / 2) * size * 1.2
      ctx.fillText(line, labelX, labelY + offset)
    })
  }
  ctx.restore()
}

export function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    const test = line ? `${line} ${w}` : w
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line)
      line = w
    } else {
      line = test
    }
  }
  if (line) lines.push(line)
  return lines
}

/* ------------------------------------------------------------------ */
/* High-FPS Cached Vector Art Renderer (WeakMap<VectorPathLayer, Path2D>) */
/* ------------------------------------------------------------------ */

const vectorLayerPathCache = new WeakMap<VectorPathLayer, Path2D>()

function cachedVectorLayerPath(layer: VectorPathLayer): Path2D | null {
  let cached = vectorLayerPathCache.get(layer)
  if (cached) return cached
  try {
    cached = new Path2D(layer.d)
    vectorLayerPathCache.set(layer, cached)
    return cached
  } catch {
    return null
  }
}

export function drawVectorArt(
  ctx: CanvasRenderingContext2D,
  art: VectorArtNode,
  theme: ThemeTokens,
  palette?: BoardPalette
): void {
  if (!art.layers || art.layers.length === 0) return
  const sx = art.width / Math.max(1, art.viewBoxWidth)
  const sy = art.height / Math.max(1, art.viewBoxHeight)

  ctx.save()
  if (art.rotation) {
    const cx = art.x + art.width / 2
    const cy = art.y + art.height / 2
    ctx.translate(cx, cy)
    ctx.rotate((art.rotation * Math.PI) / 180)
    ctx.translate(-cx, -cy)
  }
  ctx.translate(art.x, art.y)
  ctx.scale(sx, sy)
  ctx.shadowBlur = 0
  ctx.shadowColor = 'transparent'

  for (const layer of art.layers) {
    const path = cachedVectorLayerPath(layer)
    if (!path) continue
    if (layer.fill && layer.fill !== 'none' && layer.fill !== 'transparent') {
      ctx.fillStyle =
        layer.fill === 'ink'
          ? (palette?.ink ?? theme.ink)
          : layer.fill === 'accent'
            ? (palette?.accent ?? theme.accent)
            : layer.fill
      ctx.fill(path)
    }
    if (layer.stroke && layer.stroke !== 'none' && layer.stroke !== 'transparent') {
      ctx.strokeStyle =
        layer.stroke === 'ink'
          ? (palette?.ink ?? theme.ink)
          : layer.stroke === 'accent'
            ? (palette?.accent ?? theme.accent)
            : layer.stroke
      const avgScale = Math.max(0.05, Math.sqrt(Math.abs(sx * sy)))
      ctx.lineWidth = (layer.strokeWidth ?? 2) / avgScale
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.stroke(path)
    }
  }
  ctx.restore()
}

/**
 * Draws the 4 circular React Flow-style connection ports around a hovered/selected board shape.
 */
export function drawShapeConnectionPorts(
  ctx: CanvasRenderingContext2D,
  shape: ConnectableBoardElement,
  zoom: number,
  opts?: {
    hoveredPort?: PortSide | null
    activeSourcePort?: PortSide | null
    snapPort?: PortSide | null
    accentColor?: string
  }
): void {
  const handles = getShapePortHandles(shape, zoom)
  const z = Math.max(0.25, zoom)
  const ringColor = opts?.accentColor || '#06b6d4'

  ctx.save()
  for (const h of handles) {
    const isHighlighted =
      opts?.hoveredPort === h.port ||
      opts?.activeSourcePort === h.port ||
      opts?.snapPort === h.port
    const radius = (isHighlighted ? 6.5 : 5) / z

    // Subtle stem connecting border anchor to interactive port dot
    ctx.strokeStyle = isHighlighted ? ringColor : 'rgba(6, 182, 212, 0.55)'
    ctx.lineWidth = 1.4 / z
    ctx.setLineDash([2.5 / z, 2.5 / z])
    ctx.beginPath()
    ctx.moveTo(h.anchorX, h.anchorY)
    ctx.lineTo(h.dotX, h.dotY)
    ctx.stroke()
    ctx.setLineDash([])

    if (isHighlighted) {
      ctx.fillStyle = 'rgba(6, 182, 212, 0.22)'
      ctx.beginPath()
      ctx.arc(h.dotX, h.dotY, radius + 4 / z, 0, Math.PI * 2)
      ctx.fill()
    }

    ctx.fillStyle = isHighlighted ? ringColor : '#FFFFFF'
    ctx.strokeStyle = isHighlighted ? '#111111' : ringColor
    ctx.lineWidth = 2 / z
    ctx.beginPath()
    ctx.arc(h.dotX, h.dotY, radius, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }
  ctx.restore()
}

/**
 * Draws live orthogonal connection wire preview while dragging from a shape port.
 */
export function drawLiveConnectionPreview(
  ctx: CanvasRenderingContext2D,
  start: { x: number; y: number },
  startPort: PortSide,
  end: { x: number; y: number },
  endPort: PortSide,
  zoom: number,
  color = '#06b6d4'
): void {
  const pts = computeOrthogonalRoute(start, startPort, end, endPort)
  if (pts.length < 2) return
  const z = Math.max(0.25, zoom)

  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 2.5 / z
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.setLineDash([6 / z, 4 / z])
  traceRoundedPolyline(ctx, pts, 10)
  ctx.stroke()
  ctx.setLineDash([])

  const prev = pts[pts.length - 2]
  const tip = pts[pts.length - 1]
  const angle = Math.atan2(tip[1] - prev[1], tip[0] - prev[0])
  const head = 12 / z
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(tip[0], tip[1])
  ctx.lineTo(tip[0] - head * Math.cos(angle - Math.PI / 7), tip[1] - head * Math.sin(angle - Math.PI / 7))
  ctx.lineTo(tip[0] - head * Math.cos(angle + Math.PI / 7), tip[1] - head * Math.sin(angle + Math.PI / 7))
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

/** Subtle animated snap pulse feedback rendered during Hold-to-Snap */
export function drawHoldSnapPulse(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  elapsedMs: number,
  zoom: number,
  accentColor: string
): void {
  const t = Math.min(1, Math.max(0, elapsedMs / 420))
  const r = (8 + t * 22) / zoom
  const alpha = (1 - t) * 0.75
  ctx.save()
  ctx.strokeStyle = accentColor
  ctx.globalAlpha = alpha
  ctx.lineWidth = 2.5 / zoom
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

/* ------------------------------------------------------------------ */
/* Selection Bounding Box & Handles                                   */
/* ------------------------------------------------------------------ */

export function drawSelectionBox(
  ctx: CanvasRenderingContext2D,
  bounds: { x: number; y: number; w: number; h: number },
  accentColor: string
): void {
  ctx.save()
  ctx.strokeStyle = accentColor
  ctx.lineWidth = 1.5
  ctx.setLineDash([6, 4])
  ctx.strokeRect(bounds.x, bounds.y, bounds.w, bounds.h)
  ctx.setLineDash([])

  // 8 handles (4 corners + 4 midpoints)
  const handleSize = 8
  const half = handleSize / 2
  ctx.fillStyle = '#FFFFFF'
  ctx.strokeStyle = accentColor
  ctx.lineWidth = 2

  const pts = [
    [bounds.x, bounds.y],
    [bounds.x + bounds.w / 2, bounds.y],
    [bounds.x + bounds.w, bounds.y],
    [bounds.x + bounds.w, bounds.y + bounds.h / 2],
    [bounds.x + bounds.w, bounds.y + bounds.h],
    [bounds.x + bounds.w / 2, bounds.y + bounds.h],
    [bounds.x, bounds.y + bounds.h],
    [bounds.x, bounds.y + bounds.h / 2]
  ]

  for (const [hx, hy] of pts) {
    ctx.fillRect(hx - half, hy - half, handleSize, handleSize)
    ctx.strokeRect(hx - half, hy - half, handleSize, handleSize)
  }
  ctx.restore()
}

/* ------------------------------------------------------------------ */
/* OCR / Strokes Image Crop Helper                                    */
/* ------------------------------------------------------------------ */

export interface OcrCrop {
  base64: string
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export function strokesBounds(
  strokes: Stroke[]
): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const s of strokes)
    for (const [x, y] of s.points) {
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  return { minX, minY, maxX, maxY }
}

export function strokesToOcrImage(strokes: Stroke[]): OcrCrop {
  const b = strokesBounds(strokes)
  const pad = 12
  const minX = b.minX - pad
  const minY = b.minY - pad
  const maxX = b.maxX + pad
  const maxY = b.maxY + pad
  const w = Math.max(1, maxX - minX)
  const h = Math.max(1, maxY - minY)
  const scale = Math.min(4, Math.max(0.5, 140 / Math.max(h, 40)))
  const margin = 24
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(w * scale + margin * 2)
  canvas.height = Math.ceil(h * scale + margin * 2)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.strokeStyle = '#FFFFFF'
  ctx.fillStyle = '#FFFFFF'
  ctx.lineWidth = 5
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const tx = (x: number): number => (x - minX) * scale + margin
  const ty = (y: number): number => (y - minY) * scale + margin
  for (const s of strokes) {
    const pts = s.points
    if (pts.length === 1) {
      ctx.beginPath()
      ctx.arc(tx(pts[0][0]), ty(pts[0][1]), 4, 0, Math.PI * 2)
      ctx.fill()
      continue
    }
    ctx.beginPath()
    ctx.moveTo(tx(pts[0][0]), ty(pts[0][1]))
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2
      const my = (pts[i][1] + pts[i + 1][1]) / 2
      ctx.quadraticCurveTo(tx(pts[i][0]), ty(pts[i][1]), tx(mx), ty(my))
    }
    const last = pts[pts.length - 1]
    ctx.lineTo(tx(last[0]), ty(last[1]))
    ctx.stroke()
  }
  const base64 = canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '')
  return { base64, minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY }
}
