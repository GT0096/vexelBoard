import type {
  BoardState,
  ColorRole,
  FontId,
  InkPoint,
  ShapeKind,
  ShapeNode,
  Stroke,
  TextNode,
  VectorSvgPath
} from '../types/board'
import type { HybridCallout } from '@shared/beautifySchema'
import { resolveFontCss, resolveThemeTokens } from '../themes'
import { drawShape, drawVectorArt } from './render'
import { resolveBoardPalette } from './backgroundPresets'
import { drawLibraryShapeOnCanvas, getLibraryShape } from '../shapes/shapeLibrary'
import { classifyStrokeShape } from '../vision/shapeSnapper'
import { detectLocalBasicShape } from '../vision/localShapeDetector'

export interface VectorizeBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
  x: number
  y: number
  w: number
  h: number
}

export interface VectorizeImageResult {
  base64: string
  bounds: VectorizeBounds
  textHints: string
  colorHints: string[]
  dominantColor: ColorRole
  strokeCount: number
  shapeCount: number
  textCount: number
}

export interface VectorizeResult {
  shapes: ShapeNode[]
  texts: TextNode[]
  groupId: string
  sourceSvg?: string
  analysis?: string
  usedLocalFallback?: boolean
}

export interface CritiqueResponse {
  approved: boolean
  issues?: string
  svg?: string
}

const SVG_NS = 'http://www.w3.org/2000/svg'

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

/** Darken overly pale colors so vision models can read them clearly against white */
function contrastColorForVision(color: ColorRole): string {
  if (!color || color === 'ink') return '#0f172a'
  if (color === 'accent') return '#dc2626'
  const hex = color.trim()
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex)
  if (!m) return '#0f172a'
  let r: number
  let g: number
  let b: number
  if (m[1].length === 3) {
    r = parseInt(m[1][0] + m[1][0], 16)
    g = parseInt(m[1][1] + m[1][1], 16)
    b = parseInt(m[1][2] + m[1][2], 16)
  } else {
    r = parseInt(m[1].slice(0, 2), 16)
    g = parseInt(m[1].slice(2, 4), 16)
    b = parseInt(m[1].slice(4, 6), 16)
  }
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  if (lum > 0.78) {
    const f = 0.52
    return `rgb(${Math.round(r * f)}, ${Math.round(g * f)}, ${Math.round(b * f)})`
  }
  return hex
}

function normalizeColorRole(raw: unknown, fallback: ColorRole = 'ink'): ColorRole {
  if (typeof raw !== 'string') return fallback
  const c = raw.trim()
  if (!c) return fallback
  const lower = c.toLowerCase()
  if (
    lower === 'ink' ||
    lower === 'currentcolor' ||
    lower === 'black' ||
    lower === '#000' ||
    lower === '#000000' ||
    lower === '#0f172a' ||
    lower === '#111111' ||
    lower === '#111' ||
    lower === '#1e293b' ||
    lower === '#222' ||
    lower === '#222222' ||
    lower === '#333' ||
    lower === '#333333'
  ) {
    return 'ink'
  }
  if (lower === 'accent') return 'accent'
  if (lower === 'transparent' || lower === 'none') return 'transparent'
  if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(c)) return c
  if (/^rgba?\(\s*\d+/i.test(c)) return c
  return fallback
}

/** Validates an SVG path `d` attribute contains only safe SVG path commands and numbers */
export function sanitizeSvgPathData(d: unknown): string | null {
  if (typeof d !== 'string') return null
  const trimmed = d.trim()
  if (trimmed.length < 3 || trimmed.length > 8000) return null
  if (!/^[MmLlHhVvCcSsQqTtAaZz0-9.,+\-\sEe]+$/.test(trimmed)) return null
  if (!/[Mm]/.test(trimmed)) return null
  return trimmed
}

/* ------------------------------------------------------------------ */
/* 1. Render User Selection to High-Contrast Vision PNG                */
/* ------------------------------------------------------------------ */

export interface ColorRasterResult {
  base64Png: string
  ruledBase64Png: string
  anchor: { x: number; y: number }
  width: number
  height: number
  bounds: VectorizeBounds
  paletteHints: string[]
  isMonochrome: boolean
  textHints: string
  dominantColor: ColorRole
  strokeCount: number
  shapeCount: number
}

/**
 * Color-Preserving Selection Rasterizer:
 * Renders ONLY the selected strokes (plus optional selected shapes/texts) onto a pure #FFFFFF
 * offscreen HTML5 canvas with 36px padding, scaled to max 1024px on the longest edge,
 * strictly preserving each stroke's original color, width, and opacity (never flattening to monochrome).
 */
export function rasterizeSelectionColorPreserving(
  board: BoardState,
  selectedIds: string[],
  themeInk = '#111111',
  themeAccent = '#FF5E5B'
): ColorRasterResult | null {
  const idSet = new Set(selectedIds)
  const selStrokes = board.strokes.filter((s) => idSet.has(s.id))
  const selShapes = board.shapeNodes.filter((s) => idSet.has(s.id))
  const selVectorArts = (board.vectorArtNodes ?? []).filter((v) => idSet.has(v.id))
  const selTexts = board.textNodes.filter((t) => idSet.has(t.id))

  if (
    selStrokes.length === 0 &&
    selShapes.length === 0 &&
    selVectorArts.length === 0 &&
    selTexts.length === 0
  ) {
    return null
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const paletteSet = new Set<string>()
  const colorCounts = new Map<string, number>()

  const resolveExactStrokeColor = (c: ColorRole): string => {
    if (!c || c === 'ink') return themeInk === '#FFFDF7' || themeInk === '#FFFFFF' ? '#111111' : themeInk
    if (c === 'accent') return themeAccent
    return c
  }

  for (const st of selStrokes) {
    const resolved = resolveExactStrokeColor(st.color)
    paletteSet.add(resolved)
    const cKey = st.color || 'ink'
    colorCounts.set(cKey, (colorCounts.get(cKey) ?? 0) + 1)
    for (const [px, py] of st.points) {
      if (px < minX) minX = px
      if (py < minY) minY = py
      if (px > maxX) maxX = px
      if (py > maxY) maxY = py
    }
  }

  for (const s of selShapes) {
    paletteSet.add(resolveExactStrokeColor(s.color))
    if (s.fillColor && s.fillColor !== 'transparent' && s.fillColor !== 'none') {
      paletteSet.add(s.fillColor)
    }
    if (s.points && s.points.length > 0) {
      for (const [px, py] of s.points) {
        minX = Math.min(minX, px)
        minY = Math.min(minY, py)
        maxX = Math.max(maxX, px)
        maxY = Math.max(maxY, py)
      }
    } else {
      minX = Math.min(minX, s.x, s.x + s.w)
      maxX = Math.max(maxX, s.x, s.x + s.w)
      minY = Math.min(minY, s.y, s.y + s.h)
      maxY = Math.max(maxY, s.y, s.y + s.h)
      if (s.controlPoint) {
        minX = Math.min(minX, s.controlPoint[0])
        minY = Math.min(minY, s.controlPoint[1])
        maxX = Math.max(maxX, s.controlPoint[0])
        maxY = Math.max(maxY, s.controlPoint[1])
      }
    }
  }

  for (const va of selVectorArts) {
    minX = Math.min(minX, va.x)
    minY = Math.min(minY, va.y)
    maxX = Math.max(maxX, va.x + va.width)
    maxY = Math.max(maxY, va.y + va.height)
    for (const l of va.layers) {
      if (l.fill && l.fill !== 'none' && l.fill !== 'transparent') paletteSet.add(l.fill)
    }
  }

  const textHintsArr: string[] = []
  for (const t of selTexts) {
    textHintsArr.push(t.title ? `${t.title}: ${t.text}` : t.text)
    const tw = t.w ?? Math.max(80, Math.min(480, t.text.length * (t.fontSize || 18) * 0.62))
    const th = t.h ?? Math.max(28, (t.text.split('\n').length || 1) * (t.fontSize || 18) * 1.4)
    minX = Math.min(minX, t.x)
    minY = Math.min(minY, t.y)
    maxX = Math.max(maxX, t.x + tw)
    maxY = Math.max(maxY, t.y + th)
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null

  const pad = 36
  const bMinX = minX - pad
  const bMinY = minY - pad
  const bMaxX = maxX + pad
  const bMaxY = maxY + pad
  const worldW = Math.max(80, bMaxX - bMinX)
  const worldH = Math.max(80, bMaxY - bMinY)

  // Scale to max 1024px on the longest edge
  const maxEdge = 1024
  const scale = Math.min(1.5, maxEdge / Math.max(worldW, worldH))
  const canvasW = Math.max(64, Math.round(worldW * scale))
  const canvasH = Math.max(64, Math.round(worldH * scale))

  const canvas = document.createElement('canvas')
  canvas.width = canvasW
  canvas.height = canvasH
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null

  // Pure #FFFFFF background
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvasW, canvasH)

  ctx.save()
  ctx.scale(scale, scale)
  ctx.translate(-bMinX, -bMinY)

  // Render vectorArtNodes and shapes using the real high-fidelity board renderers
  // (never approximate svg-path, line, arrow, circle, or triangle shapes as rectangles!)
  const rasterTheme = {
    ...resolveThemeTokens('minimal-light'),
    ink: resolveExactStrokeColor('ink'),
    accent: themeAccent
  }
  const rasterPalette = resolveBoardPalette('#FFFFFF')
  const rasterFontCss = resolveFontCss('jakarta')

  for (const va of selVectorArts) {
    drawVectorArt(ctx, va, rasterTheme, rasterPalette)
  }

  for (const s of selShapes) {
    drawShape(ctx, s, rasterTheme, rasterFontCss, rasterPalette)
  }

  // Render selected strokes strictly preserving original color, width, and opacity
  for (const st of selStrokes) {
    if (st.points.length < 1) continue
    ctx.save()
    const col = resolveExactStrokeColor(st.color)
    const isHighlighter = st.penType === 'highlighter'
    ctx.globalAlpha = isHighlighter ? 0.36 : 1.0
    ctx.strokeStyle = col
    ctx.fillStyle = col
    const baseSize = st.size || 3
    ctx.lineWidth = isHighlighter
      ? Math.max(8, baseSize * 2.5)
      : st.penType === 'marker' || st.penType === 'brush'
        ? Math.max(3, baseSize * 1.45)
        : st.penType === 'pencil'
          ? Math.max(1.5, baseSize * 0.8)
          : Math.max(2, baseSize)
    ctx.lineCap = isHighlighter ? 'butt' : 'round'
    ctx.lineJoin = 'round'
    if (st.penType === 'dashed') ctx.setLineDash([Math.max(4, baseSize * 2.2), Math.max(4, baseSize * 1.6)])

    if (st.points.length === 1) {
      ctx.beginPath()
      ctx.arc(st.points[0][0], st.points[0][1], Math.max(1.5, ctx.lineWidth / 2), 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.beginPath()
      ctx.moveTo(st.points[0][0], st.points[0][1])
      for (let i = 1; i < st.points.length - 1; i++) {
        const mx = (st.points[i][0] + st.points[i + 1][0]) / 2
        const my = (st.points[i][1] + st.points[i + 1][1]) / 2
        ctx.quadraticCurveTo(st.points[i][0], st.points[i][1], mx, my)
      }
      const last = st.points[st.points.length - 1]
      ctx.lineTo(last[0], last[1])
      ctx.stroke()
    }
    ctx.restore()
  }

  // Render selected texts
  for (const t of selTexts) {
    ctx.save()
    ctx.fillStyle = resolveExactStrokeColor(t.color)
    ctx.font = `${t.bold ? 'bold ' : ''}${Math.max(16, t.fontSize || 18)}px sans-serif`
    ctx.textBaseline = 'top'
    const lines = t.text.split('\n')
    lines.forEach((line, idx) => ctx.fillText(line, t.x, t.y + idx * ((t.fontSize || 18) * 1.35)))
    ctx.restore()
  }

  ctx.restore()

  let dominantColor: ColorRole = 'ink'
  let maxColorCount = 0
  for (const [c, cnt] of colorCounts.entries()) {
    if (cnt > maxColorCount) {
      maxColorCount = cnt
      dominantColor = c
    }
  }

  const paletteHints = Array.from(paletteSet).slice(0, 12)
  const base64Png = canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '')

  // Create coordinate-ruled copy (0..1000 normalized grid ticks) for Vision LLM spatial accuracy
  const ruledCanvas = document.createElement('canvas')
  ruledCanvas.width = canvasW
  ruledCanvas.height = canvasH
  const rctx = ruledCanvas.getContext('2d')
  let ruledBase64Png = base64Png
  if (rctx) {
    rctx.drawImage(canvas, 0, 0)
    rctx.save()
    rctx.strokeStyle = 'rgba(148, 163, 184, 0.35)'
    rctx.lineWidth = 1
    rctx.setLineDash([4, 4])
    rctx.font = 'bold 11px monospace'
    rctx.fillStyle = 'rgba(71, 85, 105, 0.85)'
    for (const tick of [200, 400, 600, 800]) {
      const gx = (tick / 1000) * canvasW
      const gy = (tick / 1000) * canvasH
      rctx.beginPath()
      rctx.moveTo(gx, 0)
      rctx.lineTo(gx, canvasH)
      rctx.moveTo(0, gy)
      rctx.lineTo(canvasW, gy)
      rctx.stroke()
      rctx.fillText(String(tick), gx + 2, 12)
      rctx.fillText(String(tick), 3, gy - 3)
    }
    rctx.restore()
    ruledBase64Png = ruledCanvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '')
  }

  return {
    base64Png,
    ruledBase64Png,
    anchor: { x: Math.round(bMinX), y: Math.round(bMinY) },
    width: Math.round(worldW),
    height: Math.round(worldH),
    bounds: {
      minX: bMinX,
      minY: bMinY,
      maxX: bMaxX,
      maxY: bMaxY,
      x: bMinX,
      y: bMinY,
      w: worldW,
      h: worldH
    },
    paletteHints,
    isMonochrome: paletteHints.length <= 1,
    textHints: textHintsArr.join(' | '),
    dominantColor,
    strokeCount: selStrokes.length,
    shapeCount: selShapes.length
  }
}

let cachedMeasureCtx: CanvasRenderingContext2D | null = null

/** Measures multi-line text using the real Canvas2D font metrics */
export function measureBoardText(
  text: string,
  fontSize: number,
  bold: boolean,
  fontFamily: FontId
): { w: number; h: number } {
  if (!cachedMeasureCtx && typeof document !== 'undefined') {
    const c = document.createElement('canvas')
    cachedMeasureCtx = c.getContext('2d')
  }
  const lines = text.split('\n')
  if (!cachedMeasureCtx) {
    const longest = lines.reduce((m, l) => Math.max(m, l.length), 1)
    return {
      w: Math.max(24, Math.ceil(longest * fontSize * (bold ? 0.64 : 0.58)) + 8),
      h: Math.max(20, Math.ceil(lines.length * fontSize * 1.32))
    }
  }
  cachedMeasureCtx.font = `${bold ? 700 : 500} ${fontSize}px ${resolveFontCss(fontFamily)}`
  let maxW = 24
  for (const l of lines) {
    maxW = Math.max(maxW, Math.ceil(cachedMeasureCtx.measureText(l || ' ').width))
  }
  return {
    w: maxW + 8,
    h: Math.max(20, Math.ceil(lines.length * fontSize * 1.32))
  }
}

/**
 * Renders a side-by-side visual comparison PNG (`LEFT: Original Sketch` | `RIGHT: Compiled Vector`)
 * for the closed-loop Vision Critique & Self-Repair pass.
 */
export async function renderSpatialComparisonPng(
  originalBase64Png: string,
  compiled: { shapes: ShapeNode[]; texts: TextNode[] },
  worldBounds: { x: number; y: number; width: number; height: number },
  fontFamily: FontId
): Promise<string | null> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') return null
  const loadImage = (b64: string): Promise<HTMLImageElement | null> =>
    new Promise((resolve) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => resolve(null)
      img.src = `data:image/png;base64,${b64}`
    })

  const origImg = await loadImage(originalBase64Png)
  const halfW = 460
  const halfH = Math.max(260, Math.min(540, Math.round((halfW * worldBounds.height) / Math.max(1, worldBounds.width))))
  const headerH = 28
  const gap = 16
  const canvas = document.createElement('canvas')
  canvas.width = halfW * 2 + gap
  canvas.height = halfH + headerH
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  // Column headers
  ctx.fillStyle = '#0F172A'
  ctx.fillRect(0, 0, halfW, headerH)
  ctx.fillRect(halfW + gap, 0, halfW, headerH)
  ctx.fillStyle = '#FFFFFF'
  ctx.font = 'bold 12px sans-serif'
  ctx.textBaseline = 'middle'
  ctx.fillText('ORIGINAL SKETCH', 12, headerH / 2)
  ctx.fillText('COMPILED VECTOR RESULT', halfW + gap + 12, headerH / 2)

  // Left: original sketch
  if (origImg) {
    const scale = Math.min((halfW - 16) / Math.max(1, origImg.width), (halfH - 16) / Math.max(1, origImg.height))
    const dw = origImg.width * scale
    const dh = origImg.height * scale
    ctx.drawImage(origImg, (halfW - dw) / 2, headerH + (halfH - dh) / 2, dw, dh)
  }

  // Divider
  ctx.fillStyle = '#CBD5E1'
  ctx.fillRect(halfW, 0, gap, canvas.height)

  // Right: compiled shapes & immersed texts
  const pad = 20
  const rScale = Math.min(
    (halfW - pad * 2) / Math.max(1, worldBounds.width),
    (halfH - pad * 2) / Math.max(1, worldBounds.height)
  )
  const offsetX = halfW + gap + (halfW - worldBounds.width * rScale) / 2
  const offsetY = headerH + (halfH - worldBounds.height * rScale) / 2

  const lightTheme = { ...resolveThemeTokens('minimal-light'), ink: '#111111', accent: '#2563EB' }
  const lightPalette = resolveBoardPalette('#FFFFFF')
  const fCss = resolveFontCss(fontFamily)

  ctx.save()
  ctx.beginPath()
  ctx.rect(halfW + gap, headerH, halfW, halfH)
  ctx.clip()
  ctx.translate(offsetX, offsetY)
  ctx.scale(rScale, rScale)
  ctx.translate(-worldBounds.x, -worldBounds.y)

  for (const s of compiled.shapes) {
    drawShape(ctx, s, lightTheme, fCss, lightPalette)
  }
  for (const t of compiled.texts) {
    ctx.save()
    ctx.fillStyle =
      t.color === 'accent'
        ? '#2563EB'
        : t.color && t.color !== 'ink'
          ? t.color
          : '#111111'
    ctx.font = `${t.bold ? 700 : 500} ${t.fontSize || 20}px ${fCss}`
    ctx.textBaseline = 'top'
    t.text.split('\n').forEach((line, idx) => {
      ctx.fillText(line, t.x, t.y + idx * ((t.fontSize || 20) * 1.25))
    })
    ctx.restore()
  }
  ctx.restore()

  return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '')
}

/**
 * Overlays hybrid `callouts` as crisp native board-immersed TextNodes (no textbox!)
 * and pointer Arrow ShapeNodes aligned to the traced illustration bounds.
 */
export function buildHybridCalloutNodes(
  callouts: HybridCallout[],
  artRect: { x: number; y: number; width: number; height: number },
  fontFamily: FontId,
  groupId: string
): { shapes: ShapeNode[]; texts: TextNode[] } {
  const now = Date.now()
  const shapes: ShapeNode[] = []
  const texts: TextNode[] = []

  callouts.forEach((c, idx) => {
    const labelX = Math.round(artRect.x + c.normX * artRect.width)
    const labelY = Math.round(artRect.y + c.normY * artRect.height)
    const fontSize = clamp(Math.round(c.fontSize ?? 20), 14, 42)
    const color = normalizeColorRole(c.color, 'ink')

    texts.push({
      id: `vcall-t-${now}-${idx}`,
      x: labelX,
      y: labelY,
      text: c.text.trim(),
      style: fontSize >= 26 ? 'h2' : 'body',
      bold: c.bold !== false,
      fontSize,
      color,
      bg: 'transparent',
      immersed: true,
      fontFamily,
      align: 'left',
      source: 'ocr',
      createdAt: now + idx
    })

    if (
      typeof c.pointsToNormX === 'number' &&
      typeof c.pointsToNormY === 'number'
    ) {
      const targetX = Math.round(artRect.x + c.pointsToNormX * artRect.width)
      const targetY = Math.round(artRect.y + c.pointsToNormY * artRect.height)
      const estW = Math.max(36, c.text.length * fontSize * 0.58)
      const startX = targetX < labelX ? labelX - 8 : targetX > labelX + estW ? labelX + estW + 8 : Math.round(labelX + estW / 2)
      const startY = Math.round(labelY + fontSize * 0.65)
      if (Math.hypot(targetX - startX, targetY - startY) >= 14) {
        shapes.push({
          id: `vcall-a-${now}-${idx}`,
          shape: 'arrow',
          x: startX,
          y: startY,
          w: targetX - startX,
          h: targetY - startY,
          color: 'ink',
          fillColor: 'transparent',
          strokeWidth: 2.2,
          fontFamily,
          vectorGroupId: groupId
        })
      }
    }
  })

  return { shapes, texts }
}

export function renderSelectionForVectorize(
  board: BoardState,
  selectedIds: string[]
): VectorizeImageResult | null {
  const idSet = new Set(selectedIds)
  const selStrokes = board.strokes.filter((s) => idSet.has(s.id))
  const selShapes = board.shapeNodes.filter((s) => idSet.has(s.id))
  const selTexts = board.textNodes.filter((t) => idSet.has(t.id))
  const selEquations = board.equationNodes.filter((eq) => idSet.has(eq.id))

  if (
    selStrokes.length === 0 &&
    selShapes.length === 0 &&
    selTexts.length === 0 &&
    selEquations.length === 0
  ) {
    return null
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const distinctColors = new Set<string>()
  const colorCounts = new Map<string, number>()

  for (const st of selStrokes) {
    const cKey = st.color || 'ink'
    colorCounts.set(cKey, (colorCounts.get(cKey) ?? 0) + 1)
    if (st.color && st.color !== 'ink') distinctColors.add(st.color)
    for (const [px, py] of st.points) {
      if (px < minX) minX = px
      if (py < minY) minY = py
      if (px > maxX) maxX = px
      if (py > maxY) maxY = py
    }
  }

  for (const s of selShapes) {
    if (s.color && s.color !== 'ink') distinctColors.add(s.color)
    if (s.points && s.points.length > 0) {
      for (const [px, py] of s.points) {
        minX = Math.min(minX, px)
        minY = Math.min(minY, py)
        maxX = Math.max(maxX, px)
        maxY = Math.max(maxY, py)
      }
    } else {
      minX = Math.min(minX, s.x, s.x + s.w)
      maxX = Math.max(maxX, s.x, s.x + s.w)
      minY = Math.min(minY, s.y, s.y + s.h)
      maxY = Math.max(maxY, s.y, s.y + s.h)
      if (s.controlPoint) {
        minX = Math.min(minX, s.controlPoint[0])
        minY = Math.min(minY, s.controlPoint[1])
        maxX = Math.max(maxX, s.controlPoint[0])
        maxY = Math.max(maxY, s.controlPoint[1])
      }
    }
  }

  for (const t of selTexts) {
    const tw = t.w ?? Math.max(120, Math.min(480, t.text.length * (t.fontSize || 18) * 0.62))
    const th = t.h ?? Math.max(36, (t.text.split('\n').length || 1) * (t.fontSize || 18) * 1.45)
    minX = Math.min(minX, t.x)
    minY = Math.min(minY, t.y)
    maxX = Math.max(maxX, t.x + tw)
    maxY = Math.max(maxY, t.y + th)
  }

  for (const eq of selEquations) {
    minX = Math.min(minX, eq.x)
    minY = Math.min(minY, eq.y)
    maxX = Math.max(maxX, eq.x + (eq.w ?? 200))
    maxY = Math.max(maxY, eq.y + (eq.h ?? 60))
  }

  if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) {
    return null
  }

  const pad = 36
  minX -= pad
  minY -= pad
  maxX += pad
  maxY += pad

  const rawW = Math.max(120, maxX - minX)
  const rawH = Math.max(120, maxY - minY)
  const maxDim = 1200
  const scale = Math.min(1.5, Math.min(maxDim / rawW, maxDim / rawH))
  const canvasW = Math.round(rawW * scale)
  const canvasH = Math.round(rawH * scale)

  const canvas = document.createElement('canvas')
  canvas.width = canvasW
  canvas.height = canvasH
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvasW, canvasH)

  ctx.save()
  ctx.scale(scale, scale)
  ctx.translate(-minX, -minY)

  // 1. Existing shapes
  for (const s of selShapes) {
    ctx.save()
    const strokeCol = contrastColorForVision(s.color)
    ctx.strokeStyle = strokeCol
    ctx.lineWidth = Math.max(2.5, s.strokeWidth ?? 3)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    const x = s.w < 0 ? s.x + s.w : s.x
    const y = s.h < 0 ? s.y + s.h : s.y
    const w = Math.abs(s.w)
    const h = Math.abs(s.h)

    if (s.shape === 'svg-path' && (s.svgPaths?.length || s.svgPath)) {
      const vb = s.svgViewBox
      const [vbX, vbY, vbW, vbH] =
        vb && vb.length === 4 ? vb : [0, 0, vb?.[0] ?? 100, vb?.[1] ?? 100]
      const sx = w / Math.max(1, vbW)
      const sy = h / Math.max(1, vbH)
      const mat = new DOMMatrix().translate(x, y).scale(sx, sy).translate(-vbX, -vbY)
      const list: VectorSvgPath[] = s.svgPaths?.length
        ? s.svgPaths
        : s.svgPath
          ? [{ d: s.svgPath, fill: 'none', stroke: strokeCol }]
          : []
      for (const p of list) {
        try {
          const transformed = new Path2D()
          transformed.addPath(new Path2D(p.d), mat)
          if (p.fill && p.fill !== 'none' && p.fill !== 'transparent') {
            ctx.fillStyle = p.fill
            ctx.fill(transformed)
          }
          if (p.stroke !== 'none') {
            ctx.strokeStyle = p.stroke && p.stroke !== 'ink' ? contrastColorForVision(p.stroke) : strokeCol
            ctx.stroke(transformed)
          }
        } catch {
          /* ignore */
        }
      }
    } else if (s.shape === 'polyline' && s.points && s.points.length >= 2) {
      ctx.beginPath()
      ctx.moveTo(s.points[0][0], s.points[0][1])
      for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i][0], s.points[i][1])
      ctx.stroke()
    } else if (s.shape === 'curved-arrow' || s.shape === 'curved-line') {
      const x2 = s.x + s.w
      const y2 = s.y + s.h
      const cx = s.controlPoint?.[0] ?? (s.x + x2) / 2
      const cy = s.controlPoint?.[1] ?? (s.y + y2) / 2 - 40
      ctx.beginPath()
      ctx.moveTo(s.x, s.y)
      ctx.quadraticCurveTo(cx, cy, x2, y2)
      ctx.stroke()
    } else if (
      s.shape === 'arrow' ||
      s.shape === 'arrow-bidirectional' ||
      s.shape === 'line' ||
      s.shape === 'dashed-line' ||
      s.shape === 'elbow'
    ) {
      ctx.beginPath()
      ctx.moveTo(s.x, s.y)
      ctx.lineTo(s.x + s.w, s.y + s.h)
      ctx.stroke()
    } else {
      const lib = getLibraryShape(s.shape)
      if (lib) {
        drawLibraryShapeOnCanvas(
          ctx,
          lib,
          x,
          y,
          w,
          h,
          strokeCol,
          s.fillColor && s.fillColor !== 'transparent' ? s.fillColor : 'transparent',
          Math.max(2.5, s.strokeWidth ?? 3)
        )
      } else if (s.shape === 'circle') {
        ctx.beginPath()
        ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
        ctx.stroke()
      } else {
        ctx.strokeRect(x, y, w, h)
      }
    }

    if (s.label) {
      ctx.fillStyle = '#0f172a'
      ctx.font = 'bold 16px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(s.label, x + w / 2, y + h / 2)
    }
    ctx.restore()
  }

  // 2. Hand-drawn strokes preserving distinct colors
  for (const st of selStrokes) {
    if (st.points.length < 1) continue
    ctx.save()
    ctx.strokeStyle = contrastColorForVision(st.color)
    ctx.fillStyle = contrastColorForVision(st.color)
    ctx.lineWidth = Math.max(3, (st.size || 3) * 1.25)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    if (st.penType === 'dashed') ctx.setLineDash([10, 8])
    if (st.points.length === 1) {
      ctx.beginPath()
      ctx.arc(st.points[0][0], st.points[0][1], Math.max(2, ctx.lineWidth / 2), 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.beginPath()
      ctx.moveTo(st.points[0][0], st.points[0][1])
      for (let i = 1; i < st.points.length - 1; i++) {
        const mx = (st.points[i][0] + st.points[i + 1][0]) / 2
        const my = (st.points[i][1] + st.points[i + 1][1]) / 2
        ctx.quadraticCurveTo(st.points[i][0], st.points[i][1], mx, my)
      }
      const last = st.points[st.points.length - 1]
      ctx.lineTo(last[0], last[1])
      ctx.stroke()
    }
    ctx.restore()
  }

  // 3. Existing text nodes & equations
  const extractedTextHints: string[] = []
  for (const t of selTexts) {
    ctx.save()
    const content = t.title ? `${t.title}: ${t.text}` : t.text
    extractedTextHints.push(content)
    ctx.fillStyle = contrastColorForVision(t.color)
    ctx.font = `${t.bold ? 'bold ' : ''}${Math.max(16, t.fontSize || 18)}px sans-serif`
    ctx.textBaseline = 'top'
    const lines = (t.title ? `${t.title}\n${t.text}` : t.text).split('\n')
    const lh = Math.max(20, (t.fontSize || 18) * 1.35)
    lines.forEach((line, idx) => ctx.fillText(line, t.x, t.y + idx * lh))
    ctx.restore()
  }

  for (const eq of selEquations) {
    ctx.save()
    extractedTextHints.push(`Formula: ${eq.latex}`)
    ctx.fillStyle = '#0f172a'
    ctx.font = `bold ${Math.max(16, eq.fontSize || 18)}px monospace`
    ctx.textBaseline = 'top'
    ctx.fillText(eq.latex, eq.x, eq.y)
    ctx.restore()
  }

  ctx.restore()

  let dominantColor: ColorRole = 'ink'
  let maxColorCount = 0
  for (const [c, cnt] of colorCounts.entries()) {
    if (cnt > maxColorCount) {
      maxColorCount = cnt
      dominantColor = c
    }
  }

  const base64 = canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '')
  return {
    base64,
    bounds: {
      minX,
      minY,
      maxX,
      maxY,
      x: minX,
      y: minY,
      w: maxX - minX,
      h: maxY - minY
    },
    textHints: extractedTextHints.join(' | '),
    colorHints: Array.from(distinctColors).slice(0, 6),
    dominantColor,
    strokeCount: selStrokes.length,
    shapeCount: selShapes.length,
    textCount: selTexts.length + selEquations.length
  }
}

/* ------------------------------------------------------------------ */
/* 2. Pure Handwriting Fast-Path Detection & Immersed Text Builder     */
/* ------------------------------------------------------------------ */

export function looksLikePureHandwriting(
  board: BoardState,
  selectedIds: string[]
): boolean {
  const idSet = new Set(selectedIds)
  const selShapes = board.shapeNodes.filter((s) => idSet.has(s.id))
  const selStrokes = board.strokes.filter((s) => idSet.has(s.id))
  if (selShapes.length > 0 || selStrokes.length === 0) return false

  let largeGeometricCount = 0
  let longStraightCount = 0
  for (const st of selStrokes) {
    let sMinX = Infinity
    let sMinY = Infinity
    let sMaxX = -Infinity
    let sMaxY = -Infinity
    for (const [px, py] of st.points) {
      if (px < sMinX) sMinX = px
      if (py < sMinY) sMinY = py
      if (px > sMaxX) sMaxX = px
      if (py > sMaxY) sMaxY = py
    }
    const sw = sMaxX - sMinX
    const sh = sMaxY - sMinY
    const diag = Math.hypot(sw, sh)

    const det = detectLocalBasicShape(st.points as InkPoint[])
    if (det && det.confidence >= 0.78) {
      if (det.shapeKind === 'arrow' || det.shapeKind === 'curved-arrow') {
        if (diag >= 44) longStraightCount++
      } else if (det.shapeKind === 'line') {
        if (diag >= 120) longStraightCount++
      } else if (det.shapeKind === 'circle') {
        const bw = Math.abs(det.w)
        const bh = Math.abs(det.h)
        if (Math.min(bw, bh) >= 62 && bw * bh >= 4200) {
          largeGeometricCount++
        }
      } else {
        const bw = Math.abs(det.w)
        const bh = Math.abs(det.h)
        if (Math.min(bw, bh) >= 48) {
          largeGeometricCount++
        }
      }
    }
  }

  return largeGeometricCount === 0 && longStraightCount === 0
}

export function buildImmersedTextFromOcr(
  text: string,
  bounds: VectorizeBounds,
  fontFamily: FontId,
  color: ColorRole = 'ink'
): VectorizeResult {
  const now = Date.now()
  const cleanText = text.trim()
  const lines = cleanText.split('\n').filter((l) => l.trim().length > 0)
  const lineCount = Math.max(1, lines.length)
  const innerH = Math.max(24, bounds.h - 72)
  const estFontSize = clamp(Math.round((innerH / lineCount) * 0.68), 18, 44)
  const bold = lineCount === 1 && estFontSize >= 26 && cleanText.length <= 42

  return {
    shapes: [],
    texts: [
      {
        id: `vtxt-${now}-0`,
        x: Math.round(bounds.minX + 36),
        y: Math.round(bounds.minY + 36),
        text: cleanText,
        style: estFontSize >= 30 ? 'h1' : estFontSize >= 24 ? 'h2' : 'body',
        bold,
        italic: false,
        fontSize: estFontSize,
        color: color || 'ink',
        bg: 'transparent',
        immersed: true,
        fontFamily,
        align: 'left',
        source: 'ocr',
        createdAt: now
      }
    ],
    groupId: `vec-${now.toString(36)}`,
    analysis: 'Handwritten Text'
  }
}

/* ------------------------------------------------------------------ */
/* 3. JSON / SVG Payload Extraction                                    */
/* ------------------------------------------------------------------ */

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const cleaned = raw
    .replace(/^```(?:json|svg|xml)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim()

  const tryParse = (str: string): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(str)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      /* fallback */
    }
    return null
  }

  const direct = tryParse(cleaned)
  if (direct) return direct

  const firstBrace = cleaned.indexOf('{')
  const lastBrace = cleaned.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const slice = cleaned.slice(firstBrace, lastBrace + 1)
    const fromSlice = tryParse(slice)
    if (fromSlice) return fromSlice
    const noTrailingCommas = slice.replace(/,\s*([}\]])/g, '$1')
    const repaired = tryParse(noTrailingCommas)
    if (repaired) return repaired
  }
  return null
}

function extractRawSvgString(raw: string): string | null {
  const match = /<svg[\s\S]*?<\/svg>/i.exec(raw)
  return match ? match[0].trim() : null
}

export function parseCritiqueResponse(rawReply: string): CritiqueResponse | null {
  const parsed = extractJsonObject(rawReply)
  if (parsed) {
    const approved = Boolean(parsed.approved)
    const issues = typeof parsed.issues === 'string' ? parsed.issues.trim() : undefined
    const svg =
      typeof parsed.svg === 'string' && /<svg[\s\S]*<\/svg>/i.test(parsed.svg)
        ? extractRawSvgString(parsed.svg) ?? parsed.svg.trim()
        : undefined
    return { approved, issues, svg }
  }
  const directSvg = extractRawSvgString(rawReply)
  if (directSvg) {
    return { approved: false, svg: directSvg }
  }
  return null
}

/* ------------------------------------------------------------------ */
/* 4. Universal SVG-to-Board Decomposer (ZERO Hardcoded Templates!)    */
/* ------------------------------------------------------------------ */

function parseSvgTransform(attr: string | null): DOMMatrix {
  const mat = new DOMMatrix()
  if (!attr || !attr.trim()) return mat
  const regex = /([a-zA-Z]+)\s*\(([^)]*)\)/g
  let m: RegExpExecArray | null
  while ((m = regex.exec(attr)) !== null) {
    const fn = m[1].toLowerCase()
    const nums = m[2]
      .trim()
      .split(/[\s,]+/)
      .map(Number)
      .filter((v) => Number.isFinite(v))
    if (fn === 'translate' && nums.length >= 1) {
      mat.translateSelf(nums[0], nums[1] ?? 0)
    } else if (fn === 'scale' && nums.length >= 1) {
      mat.scaleSelf(nums[0], nums[1] ?? nums[0])
    } else if (fn === 'rotate' && nums.length >= 1) {
      if (nums.length >= 3) {
        mat.translateSelf(nums[1], nums[2])
        mat.rotateSelf(nums[0])
        mat.translateSelf(-nums[1], -nums[2])
      } else {
        mat.rotateSelf(nums[0])
      }
    } else if (fn === 'matrix' && nums.length === 6) {
      mat.multiplySelf(new DOMMatrix(nums))
    }
  }
  return mat
}

function applyPoint(mat: DOMMatrix, x: number, y: number): [number, number] {
  const pt = new DOMPoint(x, y).matrixTransform(mat)
  return [pt.x, pt.y]
}

function parseStyleMap(el: Element): Record<string, string> {
  const style: Record<string, string> = {}
  const raw = el.getAttribute('style')
  if (!raw) return style
  for (const part of raw.split(';')) {
    const idx = part.indexOf(':')
    if (idx <= 0) continue
    const k = part.slice(0, idx).trim().toLowerCase()
    const v = part.slice(idx + 1).trim()
    if (k && v) style[k] = v
  }
  return style
}

function getSvgAttr(
  el: Element,
  name: string,
  inherited: Record<string, string>
): string | undefined {
  const styleMap = parseStyleMap(el)
  if (styleMap[name] !== undefined) return styleMap[name]
  const attr = el.getAttribute(name)
  if (attr !== null && attr !== '') return attr
  return inherited[name]
}

function parsePointsList(raw: string | null): Array<[number, number]> {
  if (!raw) return []
  const nums = raw
    .trim()
    .split(/[\s,]+/)
    .map(Number)
    .filter((n) => Number.isFinite(n))
  const pts: Array<[number, number]> = []
  for (let i = 0; i + 1 < nums.length; i += 2) {
    pts.push([nums[i], nums[i + 1]])
  }
  return pts
}

function measureSvgPathGeometry(
  d: string
): {
  bbox: { x: number; y: number; w: number; h: number }
  start?: [number, number]
  startAngle?: number
  end?: [number, number]
  endAngle?: number
} | null {
  try {
    const host = document.createElementNS(SVG_NS, 'svg')
    host.setAttribute('width', '0')
    host.setAttribute('height', '0')
    host.style.position = 'fixed'
    host.style.left = '-99999px'
    host.style.top = '-99999px'
    host.style.visibility = 'hidden'
    host.style.pointerEvents = 'none'
    const pathEl = document.createElementNS(SVG_NS, 'path')
    pathEl.setAttribute('d', d)
    host.appendChild(pathEl)
    document.body.appendChild(host)
    try {
      const b = pathEl.getBBox()
      const totalLen = pathEl.getTotalLength()
      let start: [number, number] | undefined
      let startAngle: number | undefined
      let end: [number, number] | undefined
      let endAngle: number | undefined
      if (totalLen > 2) {
        const p0 = pathEl.getPointAtLength(0)
        const p1 = pathEl.getPointAtLength(Math.min(totalLen, 3))
        const pEndPrev = pathEl.getPointAtLength(Math.max(0, totalLen - 3))
        const pEnd = pathEl.getPointAtLength(totalLen)
        start = [p0.x, p0.y]
        startAngle = Math.atan2(p0.y - p1.y, p0.x - p1.x)
        end = [pEnd.x, pEnd.y]
        endAngle = Math.atan2(pEnd.y - pEndPrev.y, pEnd.x - pEndPrev.x)
      }
      return {
        bbox: {
          x: b.x,
          y: b.y,
          w: Math.max(2, b.width),
          h: Math.max(2, b.height)
        },
        start,
        startAngle,
        end,
        endAngle
      }
    } finally {
      host.remove()
    }
  } catch {
    return null
  }
}

interface RawParsedText {
  text: string
  x: number
  y: number
  fontSize: number
  bold: boolean
  italic: boolean
  anchor: 'start' | 'middle' | 'end'
  baseline: string
  color: ColorRole
}

interface RawArrowPoly {
  cx: number
  cy: number
  maxDim: number
  shapeId: string
}

/**
 * Universally decomposes ANY clean `<svg>` into native, individually editable board `ShapeNode`s
 * and frameless board-immersed `TextNode`s styled in the user's selected font.
 */
export function parseSvgToBoardElements(
  svgString: string,
  bounds: VectorizeBounds,
  fontFamily: FontId,
  defaultColor: ColorRole = 'ink',
  analysis?: string
): VectorizeResult | null {
  const cleanSvg = extractRawSvgString(svgString)
  if (!cleanSvg) return null

  const parser = new DOMParser()
  const doc = parser.parseFromString(cleanSvg, 'image/svg+xml')
  const svgEl = doc.querySelector('svg')
  if (!svgEl || doc.querySelector('parsererror')) return null

  // Determine SVG viewBox
  let vbX = 0
  let vbY = 0
  let vbW = 600
  let vbH = 450
  const vbAttr = svgEl.getAttribute('viewBox')
  if (vbAttr) {
    const parts = vbAttr
      .trim()
      .split(/[\s,]+/)
      .map(Number)
    if (parts.length === 4 && parts.every(Number.isFinite) && parts[2] > 0 && parts[3] > 0) {
      ;[vbX, vbY, vbW, vbH] = parts
    }
  } else {
    const wAttr = parseFloat(svgEl.getAttribute('width') || '')
    const hAttr = parseFloat(svgEl.getAttribute('height') || '')
    if (Number.isFinite(wAttr) && wAttr > 0) vbW = wAttr
    if (Number.isFinite(hAttr) && hAttr > 0) vbH = hAttr
  }

  // Uniform aspect-preserving mapping into user's canvas selection bounds
  const pad = 28
  const targetW = Math.max(120, bounds.w - pad * 2)
  const targetH = Math.max(120, bounds.h - pad * 2)
  const scale = Math.min(targetW / vbW, targetH / vbH)
  const offsetX = bounds.minX + pad + (targetW - vbW * scale) / 2
  const offsetY = bounds.minY + pad + (targetH - vbH * scale) / 2

  const rootMat = new DOMMatrix()
    .translate(offsetX, offsetY)
    .scale(scale, scale)
    .translate(-vbX, -vbY)

  const now = Date.now()
  const groupId = `vec-svg-${now.toString(36)}`
  const shapes: ShapeNode[] = []
  const rawTexts: RawParsedText[] = []
  const tinyArrowPolys: RawArrowPoly[] = []
  let seq = 0

  const walk = (node: Element, parentMat: DOMMatrix, inherited: Record<string, string>): void => {
    const tag = node.tagName.toLowerCase()
    if (
      tag === 'defs' ||
      tag === 'style' ||
      tag === 'title' ||
      tag === 'desc' ||
      tag === 'metadata' ||
      tag === 'marker' ||
      tag === 'clippath' ||
      tag === 'mask'
    ) {
      return
    }

    const localMat = parseSvgTransform(node.getAttribute('transform'))
    const mat = parentMat.multiply(localMat)

    const nextInherited: Record<string, string> = { ...inherited }
    const styleMap = parseStyleMap(node)
    for (const k of ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline']) {
      if (styleMap[k] !== undefined) nextInherited[k] = styleMap[k]
      else {
        const a = node.getAttribute(k)
        if (a !== null && a !== '') nextInherited[k] = a
      }
    }

    const fillRaw = getSvgAttr(node, 'fill', inherited)
    const strokeRaw = getSvgAttr(node, 'stroke', inherited)
    const swRaw = parseFloat(getSvgAttr(node, 'stroke-width', inherited) || '')
    const dashRaw = getSvgAttr(node, 'stroke-dasharray', inherited)
    const markerEnd = node.getAttribute('marker-end') || styleMap['marker-end']
    const markerStart = node.getAttribute('marker-start') || styleMap['marker-start']
    const hasArrowEnd = Boolean(markerEnd && markerEnd !== 'none')
    const hasArrowStart = Boolean(markerStart && markerStart !== 'none')

    const strokeStyle: 'solid' | 'dashed' | 'dotted' =
      dashRaw && dashRaw !== 'none'
        ? dashRaw.trim().startsWith('1') || dashRaw.trim().startsWith('2')
          ? 'dotted'
          : 'dashed'
        : 'solid'

    const matScale = Math.hypot(mat.a, mat.b) || scale
    const resolvedSw = clamp(Number.isFinite(swRaw) ? swRaw * (matScale / scale) : 2.5, 1.6, 6)

    if (tag === 'g' || tag === 'svg') {
      for (const child of Array.from(node.children)) {
        walk(child, mat, nextInherited)
      }
      return
    }

    if (tag === 'rect') {
      const rxRaw = parseFloat(node.getAttribute('x') || '0') || 0
      const ryRaw = parseFloat(node.getAttribute('y') || '0') || 0
      const rwRaw = parseFloat(node.getAttribute('width') || '0') || 0
      const rhRaw = parseFloat(node.getAttribute('height') || '0') || 0
      if (rwRaw <= 1 || rhRaw <= 1) return

      // Skip full-canvas opaque white/paper background rectangles
      const coversCanvas = rwRaw >= vbW * 0.9 && rhRaw >= vbH * 0.9
      const isWhiteBg =
        !strokeRaw ||
        strokeRaw === 'none' ||
        strokeRaw === 'transparent' ||
        (fillRaw && /^(#fff|#ffffff|white|rgb\(255)/i.test(fillRaw.trim()))
      if (coversCanvas && isWhiteBg) return

      const [x1, y1] = applyPoint(mat, rxRaw, ryRaw)
      const [x2, y2] = applyPoint(mat, rxRaw + rwRaw, ryRaw + rhRaw)
      const x = Math.round(Math.min(x1, x2))
      const y = Math.round(Math.min(y1, y2))
      const w = Math.max(4, Math.round(Math.abs(x2 - x1)))
      const h = Math.max(4, Math.round(Math.abs(y2 - y1)))

      const cornerR = parseFloat(node.getAttribute('rx') || node.getAttribute('ry') || '0') || 0
      const borderRadius = Math.max(0, Math.round(cornerR * matScale))
      const strokeColor =
        strokeRaw === 'none' ? 'transparent' : normalizeColorRole(strokeRaw, 'ink')
      const fillColor =
        fillRaw === undefined || fillRaw === '' || fillRaw === 'none' || fillRaw === 'transparent'
          ? 'transparent'
          : normalizeColorRole(fillRaw, 'transparent')

      shapes.push({
        id: `vsvg-r-${now}-${seq++}`,
        shape: 'rect',
        x,
        y,
        w,
        h,
        borderRadius,
        color: strokeColor === 'transparent' ? 'ink' : strokeColor,
        fillColor,
        strokeWidth: strokeRaw === 'none' ? 0 : resolvedSw,
        strokeStyle,
        fontFamily,
        vectorGroupId: groupId
      })
      return
    }

    if (tag === 'circle' || tag === 'ellipse') {
      const cxRaw = parseFloat(node.getAttribute('cx') || '0') || 0
      const cyRaw = parseFloat(node.getAttribute('cy') || '0') || 0
      const rxRaw =
        tag === 'circle'
          ? parseFloat(node.getAttribute('r') || '0') || 0
          : parseFloat(node.getAttribute('rx') || '0') || 0
      const ryRaw =
        tag === 'circle' ? rxRaw : parseFloat(node.getAttribute('ry') || '0') || 0
      if (rxRaw <= 0.5 || ryRaw <= 0.5) return

      const [x1, y1] = applyPoint(mat, cxRaw - rxRaw, cyRaw - ryRaw)
      const [x2, y2] = applyPoint(mat, cxRaw + rxRaw, cyRaw + ryRaw)
      const x = Math.round(Math.min(x1, x2))
      const y = Math.round(Math.min(y1, y2))
      const w = Math.max(4, Math.round(Math.abs(x2 - x1)))
      const h = Math.max(4, Math.round(Math.abs(y2 - y1)))
      const strokeColor = normalizeColorRole(strokeRaw, 'ink')
      const fillColor =
        fillRaw === undefined || fillRaw === '' || fillRaw === 'none' || fillRaw === 'transparent'
          ? 'transparent'
          : normalizeColorRole(fillRaw, 'transparent')

      shapes.push({
        id: `vsvg-c-${now}-${seq++}`,
        shape: 'circle',
        x,
        y,
        w,
        h,
        color: strokeColor,
        fillColor,
        strokeWidth: resolvedSw,
        strokeStyle,
        fontFamily,
        vectorGroupId: groupId
      })
      return
    }

    if (tag === 'line') {
      const lx1 = parseFloat(node.getAttribute('x1') || '0') || 0
      const ly1 = parseFloat(node.getAttribute('y1') || '0') || 0
      const lx2 = parseFloat(node.getAttribute('x2') || '0') || 0
      const ly2 = parseFloat(node.getAttribute('y2') || '0') || 0
      const [x1, y1] = applyPoint(mat, lx1, ly1)
      const [x2, y2] = applyPoint(mat, lx2, ly2)
      if (Math.hypot(x2 - x1, y2 - y1) < 3) return

      const strokeColor = normalizeColorRole(strokeRaw, 'ink')
      let kind: ShapeKind = strokeStyle === 'dashed' ? 'dashed-line' : 'line'
      let sx = x1
      let sy = y1
      let ex = x2
      let ey = y2
      if (hasArrowStart && hasArrowEnd) {
        kind = 'arrow-bidirectional'
      } else if (hasArrowEnd) {
        kind = 'arrow'
      } else if (hasArrowStart) {
        kind = 'arrow'
        sx = x2
        sy = y2
        ex = x1
        ey = y1
      }

      shapes.push({
        id: `vsvg-l-${now}-${seq++}`,
        shape: kind,
        x: Math.round(sx),
        y: Math.round(sy),
        w: Math.round(ex - sx),
        h: Math.round(ey - sy),
        color: strokeColor,
        fillColor: 'transparent',
        strokeWidth: resolvedSw,
        strokeStyle,
        fontFamily,
        vectorGroupId: groupId
      })
      return
    }

    if (tag === 'polyline') {
      const rawPts = parsePointsList(node.getAttribute('points'))
      if (rawPts.length < 2) return
      const pts = rawPts.map(([px, py]) => {
        const [tx, ty] = applyPoint(mat, px, py)
        return [Math.round(tx), Math.round(ty)] as [number, number]
      })
      const xs = pts.map((p) => p[0])
      const ys = pts.map((p) => p[1])
      const minX = Math.min(...xs)
      const minY = Math.min(...ys)

      shapes.push({
        id: `vsvg-pl-${now}-${seq++}`,
        shape: 'polyline',
        x: minX,
        y: minY,
        w: Math.max(4, Math.max(...xs) - minX),
        h: Math.max(4, Math.max(...ys) - minY),
        points: pts,
        arrowStart: hasArrowStart,
        arrowEnd: hasArrowEnd,
        color: normalizeColorRole(strokeRaw, 'ink'),
        fillColor: 'transparent',
        strokeWidth: resolvedSw,
        strokeStyle,
        fontFamily,
        vectorGroupId: groupId
      })
      return
    }

    if (tag === 'polygon') {
      const rawPts = parsePointsList(node.getAttribute('points'))
      if (rawPts.length < 3) return
      const pts = rawPts.map(([px, py]) => applyPoint(mat, px, py))
      const xs = pts.map((p) => p[0])
      const ys = pts.map((p) => p[1])
      const minX = Math.min(...xs)
      const minY = Math.min(...ys)
      const w = Math.max(2, Math.max(...xs) - minX)
      const h = Math.max(2, Math.max(...ys) - minY)

      const d =
        `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)} ` +
        pts
          .slice(1)
          .map(([px, py]) => `L ${px.toFixed(1)} ${py.toFixed(1)}`)
          .join(' ') +
        ' Z'

      const id = `vsvg-pg-${now}-${seq++}`
      const strokeColor = strokeRaw === 'none' ? 'none' : normalizeColorRole(strokeRaw, 'ink')
      const fillColor =
        fillRaw === 'none' || fillRaw === 'transparent'
          ? 'transparent'
          : normalizeColorRole(fillRaw, 'ink')

      shapes.push({
        id,
        shape: 'svg-path',
        x: Math.round(minX),
        y: Math.round(minY),
        w: Math.round(w),
        h: Math.round(h),
        svgViewBox: [minX, minY, w, h],
        svgPaths: [
          {
            d,
            fill: fillColor,
            stroke: strokeColor,
            strokeWidth: resolvedSw,
            dashed: strokeStyle === 'dashed'
          }
        ],
        color: strokeColor === 'none' ? 'ink' : strokeColor,
        fillColor,
        strokeWidth: resolvedSw,
        strokeStyle,
        fontFamily,
        vectorGroupId: groupId
      })

      // Track tiny triangles so we can merge them cleanly onto adjacent line/polyline tips
      if (rawPts.length === 3 && Math.max(w, h) <= 24) {
        tinyArrowPolys.push({
          cx: minX + w / 2,
          cy: minY + h / 2,
          maxDim: Math.max(w, h),
          shapeId: id
        })
      }
      return
    }

    if (tag === 'path') {
      const safeD = sanitizeSvgPathData(node.getAttribute('d'))
      if (!safeD) return
      const measured = measureSvgPathGeometry(safeD)
      if (!measured) return

      const { bbox } = measured
      const [x1, y1] = applyPoint(mat, bbox.x, bbox.y)
      const [x2, y2] = applyPoint(mat, bbox.x + bbox.w, bbox.y + bbox.h)
      const x = Math.round(Math.min(x1, x2))
      const y = Math.round(Math.min(y1, y2))
      const w = Math.max(4, Math.round(Math.abs(x2 - x1)))
      const h = Math.max(4, Math.round(Math.abs(y2 - y1)))

      const strokeColor = strokeRaw === 'none' ? 'none' : normalizeColorRole(strokeRaw, 'ink')
      const fillColor =
        fillRaw === undefined || fillRaw === '' || fillRaw === 'none' || fillRaw === 'transparent'
          ? 'transparent'
          : normalizeColorRole(fillRaw, 'transparent')

      const svgPaths: VectorSvgPath[] = [
        {
          d: safeD,
          fill: fillColor,
          stroke: strokeColor,
          strokeWidth: resolvedSw,
          dashed: strokeStyle === 'dashed'
        }
      ]

      // If path has marker-end / marker-start, append a crisp vector arrowhead at exact tangent
      const headLen = Math.max(7, 12 / Math.max(0.4, matScale))
      const makeHeadPath = (tip: [number, number], ang: number): string => {
        const a1 = ang - Math.PI / 6.5
        const a2 = ang + Math.PI / 6.5
        const p1x = tip[0] - headLen * Math.cos(a1)
        const p1y = tip[1] - headLen * Math.sin(a1)
        const p2x = tip[0] - headLen * Math.cos(a2)
        const p2y = tip[1] - headLen * Math.sin(a2)
        return `M ${tip[0].toFixed(1)} ${tip[1].toFixed(1)} L ${p1x.toFixed(1)} ${p1y.toFixed(1)} L ${p2x.toFixed(1)} ${p2y.toFixed(1)} Z`
      }
      if (hasArrowEnd && measured.end && measured.endAngle !== undefined) {
        svgPaths.push({
          d: makeHeadPath(measured.end, measured.endAngle),
          fill: strokeColor === 'none' ? 'ink' : strokeColor,
          stroke: 'none'
        })
      }
      if (hasArrowStart && measured.start && measured.startAngle !== undefined) {
        svgPaths.push({
          d: makeHeadPath(measured.start, measured.startAngle),
          fill: strokeColor === 'none' ? 'ink' : strokeColor,
          stroke: 'none'
        })
      }

      shapes.push({
        id: `vsvg-p-${now}-${seq++}`,
        shape: 'svg-path',
        x,
        y,
        w,
        h,
        svgViewBox: [bbox.x, bbox.y, bbox.w, bbox.h],
        svgPaths,
        color: strokeColor === 'none' ? 'ink' : strokeColor,
        fillColor,
        strokeWidth: resolvedSw,
        strokeStyle,
        fontFamily,
        vectorGroupId: groupId
      })
      return
    }

    if (tag === 'text') {
      const tspans = Array.from(node.querySelectorAll('tspan'))
      const textContent =
        tspans.length > 0
          ? tspans
              .map((ts) => (ts.textContent || '').trim())
              .filter(Boolean)
              .join('\n')
          : (node.textContent || '').replace(/\s+/g, ' ').trim()
      if (!textContent) return

      const txRaw = parseFloat(node.getAttribute('x') || '0') || 0
      const tyRaw = parseFloat(node.getAttribute('y') || '0') || 0
      const [cx, cy] = applyPoint(mat, txRaw, tyRaw)
      const fsAttr = parseFloat(getSvgAttr(node, 'font-size', inherited) || '20') || 20
      const fontSize = clamp(Math.round(fsAttr * matScale), 14, 48)
      const fw = String(getSvgAttr(node, 'font-weight', inherited) || '600').toLowerCase()
      const bold = fw === 'bold' || fw === 'bolder' || parseInt(fw, 10) >= 600
      const italic = String(getSvgAttr(node, 'font-style', inherited) || '').toLowerCase() === 'italic'
      const anchorRaw = String(getSvgAttr(node, 'text-anchor', inherited) || 'start').toLowerCase()
      const anchor: 'start' | 'middle' | 'end' =
        anchorRaw === 'middle' ? 'middle' : anchorRaw === 'end' ? 'end' : 'start'
      const baseline = String(getSvgAttr(node, 'dominant-baseline', inherited) || 'alphabetic').toLowerCase()
      const color = normalizeColorRole(fillRaw, defaultColor)

      rawTexts.push({
        text: textContent,
        x: cx,
        y: cy,
        fontSize,
        bold,
        italic,
        anchor,
        baseline,
        color
      })
    }
  }

  walk(svgEl, rootMat, {})

  // Merge tiny standalone arrowhead <polygon>s onto nearby line/polyline endpoints
  const consumedArrowPolyIds = new Set<string>()
  for (const ap of tinyArrowPolys) {
    for (const s of shapes) {
      if (s.shape === 'line' || s.shape === 'dashed-line') {
        const dEnd = Math.hypot(s.x + s.w - ap.cx, s.y + s.h - ap.cy)
        const dStart = Math.hypot(s.x - ap.cx, s.y - ap.cy)
        if (dEnd <= 16) {
          s.shape = 'arrow'
          consumedArrowPolyIds.add(ap.shapeId)
          break
        } else if (dStart <= 16) {
          s.shape = 'arrow'
          const ex = s.x + s.w
          const ey = s.y + s.h
          s.x = ex
          s.y = ey
          s.w = -s.w
          s.h = -s.h
          consumedArrowPolyIds.add(ap.shapeId)
          break
        }
      } else if (s.shape === 'polyline' && s.points && s.points.length >= 2) {
        const first = s.points[0]
        const last = s.points[s.points.length - 1]
        if (Math.hypot(last[0] - ap.cx, last[1] - ap.cy) <= 16) {
          s.arrowEnd = true
          consumedArrowPolyIds.add(ap.shapeId)
          break
        } else if (Math.hypot(first[0] - ap.cx, first[1] - ap.cy) <= 16) {
          s.arrowStart = true
          consumedArrowPolyIds.add(ap.shapeId)
          break
        }
      }
    }
  }

  const finalShapes =
    consumedArrowPolyIds.size > 0
      ? shapes.filter((s) => !consumedArrowPolyIds.has(s.id))
      : shapes

  // Attach centered in-shape <text> to its enclosing closed shape, and convert all external <text>
  // into frameless board-immersed TextNodes (zero textbox!)
  const texts: TextNode[] = []
  rawTexts.forEach((rt, idx) => {
    const lines = rt.text.split('\n')
    const estH = Math.max(rt.fontSize * 1.25, lines.length * rt.fontSize * 1.32)
    const longest = Math.max(1, ...lines.map((l) => l.length))
    const estW = Math.max(16, longest * rt.fontSize * 0.6)

    // Estimate visual center of the text
    const centerX =
      rt.anchor === 'middle' ? rt.x : rt.anchor === 'end' ? rt.x - estW / 2 : rt.x + estW / 2
    const centerY =
      rt.baseline === 'central' || rt.baseline === 'middle'
        ? rt.y
        : rt.baseline === 'hanging' || rt.baseline === 'text-before-edge'
          ? rt.y + estH / 2
          : rt.y - rt.fontSize * 0.35

    // Find smallest enclosing closed rect/circle that doesn't already have a label
    let hostShape: ShapeNode | null = null
    let hostArea = Infinity
    for (const s of finalShapes) {
      if (s.label) continue
      if (s.shape !== 'rect' && s.shape !== 'rounded-rect' && s.shape !== 'circle') continue
      const padIn = 4
      if (
        centerX >= s.x + padIn &&
        centerX <= s.x + s.w - padIn &&
        centerY >= s.y + padIn &&
        centerY <= s.y + s.h - padIn
      ) {
        const area = s.w * s.h
        // Make sure text is actually centered inside the shape (not an external label inside a huge outer frame)
        const nearCenter =
          Math.abs(centerX - (s.x + s.w / 2)) <= s.w * 0.34 &&
          Math.abs(centerY - (s.y + s.h / 2)) <= s.h * 0.34
        if (nearCenter && area < hostArea) {
          hostArea = area
          hostShape = s
        }
      }
    }

    if (hostShape) {
      hostShape.label = rt.text
      hostShape.labelSize = rt.fontSize
      hostShape.labelBold = rt.bold
      return
    }

    // Frameless board-immersed text!
    const topLeftX =
      rt.anchor === 'middle' ? rt.x - estW / 2 : rt.anchor === 'end' ? rt.x - estW : rt.x
    const topLeftY =
      rt.baseline === 'central' || rt.baseline === 'middle'
        ? rt.y - estH / 2
        : rt.baseline === 'hanging' || rt.baseline === 'text-before-edge'
          ? rt.y
          : rt.y - rt.fontSize * 0.92

    texts.push({
      id: `vsvg-t-${now}-${idx}`,
      x: Math.round(topLeftX),
      y: Math.round(topLeftY),
      text: rt.text,
      style: rt.fontSize >= 30 ? 'h1' : rt.fontSize >= 24 ? 'h2' : 'body',
      bold: rt.bold,
      italic: rt.italic,
      fontSize: rt.fontSize,
      color: rt.color,
      bg: 'transparent',
      immersed: true,
      fontFamily,
      align: rt.anchor === 'middle' ? 'center' : rt.anchor === 'end' ? 'right' : 'left',
      source: 'ocr',
      createdAt: now + idx
    })
  })

  if (finalShapes.length === 0 && texts.length === 0) {
    return null
  }

  return {
    shapes: finalShapes,
    texts,
    groupId,
    sourceSvg: cleanSvg,
    analysis
  }
}

/* ------------------------------------------------------------------ */
/* 5. Main AI Reply Parser (SVG-first + Text/JSON Fallbacks)           */
/* ------------------------------------------------------------------ */

export function parseAndBuildVectorDiagram(
  rawReply: string,
  bounds: VectorizeBounds,
  fontFamily: FontId,
  defaultColor: ColorRole = 'ink'
): VectorizeResult | null {
  const parsed = extractJsonObject(rawReply)

  // 1. Primary path: Agentic SVG inside JSON {"analysis": "...", "svg": "<svg>...</svg>"}
  if (parsed) {
    const analysis =
      typeof parsed.analysis === 'string' && parsed.analysis.trim()
        ? parsed.analysis.trim()
        : undefined

    // Pure handwriting shortcut
    const directText =
      (typeof parsed.recognizedText === 'string' && parsed.recognizedText.trim()) ||
      (typeof parsed.transcribedText === 'string' && parsed.transcribedText.trim()) ||
      (typeof parsed.text === 'string' && parsed.text.trim()) ||
      ''
    if (parsed.isTextOnly && directText) {
      return buildImmersedTextFromOcr(directText, bounds, fontFamily, defaultColor)
    }

    if (typeof parsed.svg === 'string' && parsed.svg.trim()) {
      const fromSvg = parseSvgToBoardElements(
        parsed.svg,
        bounds,
        fontFamily,
        defaultColor,
        analysis
      )
      if (fromSvg) return fromSvg
    }

    // Direct text fallback if JSON only returned text without SVG
    if (directText && !parsed.svg && !Array.isArray(parsed.nodes)) {
      return buildImmersedTextFromOcr(directText, bounds, fontFamily, defaultColor)
    }
  }

  // 2. Direct raw `<svg>...</svg>` even if model omitted JSON wrapper
  const rawSvg = extractRawSvgString(rawReply)
  if (rawSvg) {
    const fromRaw = parseSvgToBoardElements(rawSvg, bounds, fontFamily, defaultColor)
    if (fromRaw) return fromRaw
  }

  return null
}

/* ------------------------------------------------------------------ */
/* 6. Side-by-Side Visual Critique Image Builder (Agentic Loop!)       */
/* ------------------------------------------------------------------ */

function loadBase64Image(base64: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = `data:image/png;base64,${base64}`
  })
}

/**
 * Renders a side-by-side comparison PNG (LEFT = Original Sketch, RIGHT = Live Rendered Vector)
 * so the Visual Critic agent sees the EXACT board result and can repair any visual flaws.
 */
export async function renderSideBySideCritiqueImage(
  originalBase64: string,
  result: VectorizeResult,
  bounds: VectorizeBounds,
  fontFamily: FontId
): Promise<string | null> {
  const origImg = await loadBase64Image(originalBase64)
  if (!origImg) return null

  const panelW = Math.min(560, Math.max(320, origImg.width))
  const panelH = Math.round((origImg.height / Math.max(1, origImg.width)) * panelW)
  const headerH = 28
  const gap = 16
  const totalW = panelW * 2 + gap
  const totalH = panelH + headerH

  const canvas = document.createElement('canvas')
  canvas.width = totalW
  canvas.height = totalH
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  ctx.fillStyle = '#f8fafc'
  ctx.fillRect(0, 0, totalW, totalH)

  // Headers
  ctx.fillStyle = '#0f172a'
  ctx.font = '700 13px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('ORIGINAL SKETCH', panelW / 2, headerH / 2)
  ctx.fillText('GENERATED VECTOR', panelW + gap + panelW / 2, headerH / 2)

  // Left Panel: Original Sketch
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, headerH, panelW, panelH)
  ctx.drawImage(origImg, 0, headerH, panelW, panelH)
  ctx.strokeStyle = '#cbd5e1'
  ctx.lineWidth = 1.5
  ctx.strokeRect(0, headerH, panelW, panelH)

  // Right Panel: Live Rendered Vector using our ACTUAL drawShape + immersed text renderer
  const rightX = panelW + gap
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(rightX, headerH, panelW, panelH)

  const lightPalette = resolveBoardPalette('#ffffff')
  const lightTheme = resolveThemeTokens('#ffffff', 'neon', lightPalette)

  const fontCss = resolveFontCss(fontFamily)
  const scaleX = panelW / Math.max(1, bounds.w)
  const scaleY = panelH / Math.max(1, bounds.h)
  const scale = Math.min(scaleX, scaleY)

  ctx.save()
  ctx.beginPath()
  ctx.rect(rightX, headerH, panelW, panelH)
  ctx.clip()
  ctx.translate(rightX, headerH)
  ctx.scale(scale, scale)
  ctx.translate(-bounds.minX, -bounds.minY)

  for (const s of result.shapes) {
    drawShape(ctx, s, lightTheme, fontCss, lightPalette)
  }

  for (const t of result.texts) {
    ctx.save()
    const col =
      t.color === 'ink' ? '#111111' : t.color === 'accent' ? '#2563EB' : t.color
    ctx.fillStyle = col
    ctx.font = `${t.italic ? 'italic ' : ''}${t.bold ? '700' : '500'} ${t.fontSize || 20}px ${resolveFontCss(t.fontFamily, fontFamily)}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    const lines = t.text.split('\n')
    const lh = (t.fontSize || 20) * 1.32
    lines.forEach((line, idx) => ctx.fillText(line, t.x, t.y + idx * lh))
    ctx.restore()
  }

  ctx.restore()

  ctx.strokeStyle = '#cbd5e1'
  ctx.lineWidth = 1.5
  ctx.strokeRect(rightX, headerH, panelW, panelH)

  return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '')
}

/* ------------------------------------------------------------------ */
/* 7. Offline / No-AI Local Vector Fallback                            */
/* ------------------------------------------------------------------ */

function perpendicularDist(pt: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const l2 = dx * dx + dy * dy
  if (l2 === 0) return Math.hypot(pt[0] - a[0], pt[1] - a[1])
  const t = clamp(((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / l2, 0, 1)
  return Math.hypot(pt[0] - (a[0] + t * dx), pt[1] - (a[1] + t * dy))
}

function simplifyPoints(pts: Array<[number, number]>, epsilon: number): Array<[number, number]> {
  if (pts.length <= 2) return pts
  let maxDist = 0
  let maxIdx = 0
  const first = pts[0]
  const last = pts[pts.length - 1]
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpendicularDist(pts[i], first, last)
    if (d > maxDist) {
      maxDist = d
      maxIdx = i
    }
  }
  if (maxDist > epsilon) {
    const left = simplifyPoints(pts.slice(0, maxIdx + 1), epsilon)
    const right = simplifyPoints(pts.slice(maxIdx), epsilon)
    return [...left.slice(0, -1), ...right]
  }
  return [first, last]
}

function strokeToSmoothSvgPath(stroke: Stroke): {
  x: number
  y: number
  w: number
  h: number
  d: string
} | null {
  if (stroke.points.length < 2) return null
  const rawPts: Array<[number, number]> = stroke.points.map(([px, py]) => [px, py])
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [px, py] of rawPts) {
    minX = Math.min(minX, px)
    minY = Math.min(minY, py)
    maxX = Math.max(maxX, px)
    maxY = Math.max(maxY, py)
  }
  const w = Math.max(8, maxX - minX)
  const h = Math.max(8, maxY - minY)
  const diag = Math.hypot(w, h)
  const simplified = simplifyPoints(rawPts, Math.max(2.5, diag * 0.025))
  if (simplified.length < 2) return null

  const closed =
    Math.hypot(
      rawPts[0][0] - rawPts[rawPts.length - 1][0],
      rawPts[0][1] - rawPts[rawPts.length - 1][1]
    ) <
    diag * 0.16

  const nx = (px: number): string => (((px - minX) / w) * 100).toFixed(1)
  const ny = (py: number): string => (((py - minY) / h) * 100).toFixed(1)

  let d = `M ${nx(simplified[0][0])} ${ny(simplified[0][1])}`
  if (simplified.length === 2) {
    d += ` L ${nx(simplified[1][0])} ${ny(simplified[1][1])}`
  } else {
    for (let i = 1; i < simplified.length - 1; i++) {
      const cx = simplified[i][0]
      const cy = simplified[i][1]
      const mx = (cx + simplified[i + 1][0]) / 2
      const my = (cy + simplified[i + 1][1]) / 2
      d += ` Q ${nx(cx)} ${ny(cy)} ${nx(mx)} ${ny(my)}`
    }
    const last = simplified[simplified.length - 1]
    d += ` L ${nx(last[0])} ${ny(last[1])}`
  }
  if (closed) d += ' Z'

  return { x: Math.round(minX), y: Math.round(minY), w: Math.round(w), h: Math.round(h), d }
}

export function generateLocalVectorDiagram(
  board: BoardState,
  selectedIds: string[],
  fontFamily: FontId
): VectorizeResult {
  const idSet = new Set(selectedIds)
  const selStrokes = board.strokes.filter((s) => idSet.has(s.id))
  const selShapes = board.shapeNodes.filter((s) => idSet.has(s.id))
  const selTexts = board.textNodes.filter((t) => idSet.has(t.id))
  const groupId = `vec-loc-${Date.now().toString(36)}`
  const now = Date.now()
  const shapes: ShapeNode[] = []
  const texts: TextNode[] = []

  selShapes.forEach((s, idx) => {
    shapes.push({ ...s, id: `vshp-keep-${now}-${idx}`, fontFamily, vectorGroupId: groupId })
  })

  selTexts.forEach((t, idx) => {
    texts.push({ ...t, id: `vtxt-keep-${now}-${idx}`, bg: 'transparent', immersed: true, fontFamily })
  })

  selStrokes.forEach((st, idx) => {
    const snapped = classifyStrokeShape(st.points as InkPoint[])
    const color = st.color || 'ink'
    const strokeWidth = clamp(Math.round((st.size || 3) * 0.85 * 10) / 10, 2, 6)
    const strokeStyle = st.penType === 'dashed' ? 'dashed' : 'solid'

    if (snapped) {
      const kind: ShapeKind = snapped.isConnector
        ? snapped.shapeId.includes('arrow')
          ? 'arrow'
          : 'line'
        : getLibraryShape(snapped.shapeId)
          ? snapped.shapeId
          : 'rect'
      shapes.push({
        id: `vshp-loc-${now}-${idx}`,
        shape: kind,
        x: Math.round(snapped.x),
        y: Math.round(snapped.y),
        w: Math.round(snapped.w),
        h: Math.round(snapped.h),
        color,
        fillColor: 'transparent',
        strokeWidth,
        strokeStyle,
        fontFamily,
        vectorGroupId: groupId
      })
      return
    }

    const smooth = strokeToSmoothSvgPath(st)
    if (smooth) {
      shapes.push({
        id: `vpath-loc-${now}-${idx}`,
        shape: 'svg-path',
        x: smooth.x,
        y: smooth.y,
        w: smooth.w,
        h: smooth.h,
        color,
        fillColor: 'transparent',
        strokeWidth,
        strokeStyle,
        svgPaths: [{ d: smooth.d, fill: 'transparent', stroke: color, strokeWidth, dashed: strokeStyle === 'dashed' }],
        svgViewBox: [100, 100],
        fontFamily,
        vectorGroupId: groupId
      })
    }
  })

  return { shapes, texts, groupId, usedLocalFallback: true }
}
