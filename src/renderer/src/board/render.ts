import { getStroke } from 'perfect-freehand'
import type {
  CanvasTransform,
  InkPoint,
  PenType,
  ShapeKind,
  ShapeNode,
  Stroke
} from '../types/board'
import { colorFor, type ThemeTokens } from '../themes'
import { isLightColor, type BoardPalette } from './backgroundPresets'
import { drawLibraryShapeOnCanvas, getLibraryShape } from '../shapes/shapeLibrary'

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
  ctx.globalAlpha = (override?.alpha ?? 1) * (penType === 'highlighter' ? 0.36 : 1)
  applyInkStyle(ctx, theme, override?.color ?? colorFor(theme, stroke.color))
  if (penType === 'highlighter') {
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

export function drawShape(
  ctx: CanvasRenderingContext2D,
  s: ShapeNode,
  theme: ThemeTokens,
  fontCss: string,
  palette?: BoardPalette
): void {
  const strokeColor =
    s.color === 'ink' && palette
      ? palette.shapeStroke
      : s.color === 'accent' && palette
        ? palette.accent
        : colorFor(theme, s.color)
  const fillColor = s.fillColor || palette?.shapeFill || 'rgba(255, 229, 102, 0.9)'
  const labelColor = s.fillColor
    ? isLightColor(s.fillColor)
      ? '#111111'
      : '#FFFDF7'
    : (palette?.shapeText ?? strokeColor)

  ctx.save()
  applyInkStyle(ctx, theme, strokeColor)
  ctx.lineWidth = s.strokeWidth ?? 3
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  const isConnector =
    s.shape === 'line' ||
    s.shape === 'dashed-line' ||
    s.shape === 'arrow' ||
    s.shape === 'arrow-bidirectional' ||
    s.shape === 'elbow' ||
    s.shape === 'actor'

  const fillShapePath = (): void => {
    ctx.save()
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
    ctx.fillStyle = fillColor
    ctx.fill()
    ctx.restore()
  }

  let labelX = s.x + s.w / 2
  let labelY = s.y + s.h / 2

  const shape: ShapeKind = s.shape

  switch (shape) {
    /* ---- 2D Basic ---- */
    case 'rect':
      roundedRect(ctx, s.x, s.y, s.w, s.h, 8)
      fillShapePath()
      ctx.stroke()
      break

    case 'rounded-rect':
      roundedRect(ctx, s.x, s.y, s.w, s.h, Math.min(24, Math.min(s.w, s.h) / 3))
      fillShapePath()
      ctx.stroke()
      break

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
      ctx.stroke()
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

      if (shape === 'dashed-line') {
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
        ctx.moveTo(s.x, s.y)
        ctx.lineTo(x2, y2)
      }
      ctx.stroke()
      ctx.setLineDash([])

      // Arrowheads
      if (shape === 'arrow' || shape === 'arrow-bidirectional') {
        const angle = Math.atan2(s.h, s.w)
        const head = Math.min(20, Math.max(12, Math.hypot(s.w, s.h) * 0.16))
        ctx.beginPath()
        ctx.moveTo(x2, y2)
        ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 7), y2 - head * Math.sin(angle - Math.PI / 7))
        ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 7), y2 - head * Math.sin(angle + Math.PI / 7))
        ctx.closePath()
        ctx.fill()

        if (shape === 'arrow-bidirectional') {
          const startAngle = angle + Math.PI
          ctx.beginPath()
          ctx.moveTo(s.x, s.y)
          ctx.lineTo(s.x - head * Math.cos(startAngle - Math.PI / 7), s.y - head * Math.sin(startAngle - Math.PI / 7))
          ctx.lineTo(s.x - head * Math.cos(startAngle + Math.PI / 7), s.y - head * Math.sin(startAngle + Math.PI / 7))
          ctx.closePath()
          ctx.fill()
        }
      }

      labelX = s.x + s.w / 2
      labelY = s.y + s.h / 2 - 14
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
          s.strokeWidth ?? 3
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
    ctx.fillStyle = theme.contrastShadow
      ? '#FFFFFF'
      : isConnector
        ? (palette?.ink ?? strokeColor)
        : labelColor
    const size = Math.max(13, Math.min(18, Math.abs(s.h) * 0.22))
    ctx.font = `700 ${size}px ${fontCss}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const maxW = Math.max(120, Math.abs(s.w) * 0.85)
    wrapText(ctx, s.label, maxW, size * 1.2).forEach((line, i, arr) => {
      const offset = (i - (arr.length - 1) / 2) * size * 1.2
      ctx.fillText(line, labelX, labelY + offset)
    })
  }
  ctx.restore()
}

export function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  _lh: number
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
