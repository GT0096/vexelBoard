import type { Stroke } from '../types/board'

export interface StrokeBBox {
  stroke: Stroke
  minX: number
  minY: number
  maxX: number
  maxY: number
  cy: number
  h: number
}

export interface SegmentedOcrPayload {
  imagesBase64: string[]
  lineBounds: Array<{ minX: number; minY: number; maxX: number; maxY: number }>
  overallBounds: { minX: number; minY: number; maxX: number; maxY: number }
}

function getStrokeBBox(stroke: Stroke): StrokeBBox | null {
  if (!stroke.points || stroke.points.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of stroke.points) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  const pad = Math.max(2, (stroke.size || 3) * 0.6)
  minX -= pad
  minY -= pad
  maxX += pad
  maxY += pad
  return {
    stroke,
    minX,
    minY,
    maxX,
    maxY,
    cy: (minY + maxY) / 2,
    h: Math.max(6, maxY - minY)
  }
}

/**
 * Segments freehand handwriting strokes into top-to-bottom horizontal lines
 * so single-line TrOCR (`Xenova/trocr-small-handwritten`) can transcribe both single words
 * and multi-line paragraphs accurately on CPU without any LLM API.
 */
export function segmentHandwritingStrokesIntoLines(strokes: Stroke[]): Stroke[][] {
  const boxes = strokes.map(getStrokeBBox).filter((b): b is StrokeBBox => b !== null)
  if (boxes.length === 0) return []

  // Sort by vertical center top-to-bottom
  boxes.sort((a, b) => a.cy - b.cy)

  const medianH = (() => {
    const heights = boxes.map((b) => b.h).sort((a, b) => a - b)
    return Math.max(16, heights[Math.floor(heights.length / 2)] || 24)
  })()

  interface LineBand {
    items: StrokeBBox[]
    minY: number
    maxY: number
    cy: number
  }

  const bands: LineBand[] = []

  for (const box of boxes) {
    let bestBand: LineBand | null = null
    let bestScore = -Infinity

    for (const band of bands) {
      const overlapTop = Math.max(band.minY, box.minY)
      const overlapBot = Math.min(band.maxY, box.maxY)
      const overlap = overlapBot - overlapTop
      const centerDist = Math.abs(box.cy - band.cy)
      const bandH = Math.max(12, band.maxY - band.minY)

      // Dots on 'i'/'j', t-crosses, or accents sit slightly above or overlap vertically
      const isDiacritic =
        box.h <= medianH * 0.55 &&
        box.maxY >= band.minY - medianH * 0.65 &&
        box.minY <= band.maxY + medianH * 0.35

      if (overlap > Math.min(box.h, bandH) * 0.25 || centerDist <= Math.max(medianH * 0.62, bandH * 0.48) || isDiacritic) {
        const score = overlap - centerDist * 0.5
        if (score > bestScore) {
          bestScore = score
          bestBand = band
        }
      }
    }

    if (bestBand) {
      bestBand.items.push(box)
      bestBand.minY = Math.min(bestBand.minY, box.minY)
      bestBand.maxY = Math.max(bestBand.maxY, box.maxY)
      bestBand.cy = bestBand.items.reduce((acc, it) => acc + it.cy, 0) / bestBand.items.length
    } else {
      bands.push({
        items: [box],
        minY: box.minY,
        maxY: box.maxY,
        cy: box.cy
      })
    }
  }

  bands.sort((a, b) => a.minY - b.minY)
  return bands.map((band) => {
    // Sort strokes left-to-right within each line
    band.items.sort((a, b) => a.minX - b.minX)
    return band.items.map((it) => it.stroke)
  })
}

function renderSingleLinePngBase64(
  lineStrokes: Stroke[]
): { base64: string; bounds: { minX: number; minY: number; maxX: number; maxY: number } } | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const st of lineStrokes) {
    for (const [x, y] of st.points) {
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null

  const rawW = Math.max(24, maxX - minX)
  const rawH = Math.max(20, maxY - minY)

  // TrOCR performs best with dark ink (#0f172a) on clean white (#ffffff) with generous horizontal/vertical margin
  // and target height ~96..128px (ViT patch grid 384x384).
  const padX = Math.max(22, rawH * 0.45)
  const padY = Math.max(18, rawH * 0.38)
  const worldW = rawW + padX * 2
  const worldH = rawH + padY * 2

  const targetH = 112
  const scale = Math.max(0.75, Math.min(2.4, targetH / Math.max(36, worldH)))
  const canvasW = Math.min(1600, Math.max(128, Math.round(worldW * scale)))
  const canvasH = Math.min(512, Math.max(64, Math.round(worldH * scale)))

  const canvas = document.createElement('canvas')
  canvas.width = canvasW
  canvas.height = canvasH
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvasW, canvasH)

  ctx.save()
  ctx.scale(scale, scale)
  ctx.translate(-(minX - padX), -(minY - padY))

  ctx.strokeStyle = '#0f172a'
  ctx.fillStyle = '#0f172a'
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  for (const st of lineStrokes) {
    if (!st.points || st.points.length === 0) continue
    const lw = Math.max(2.6, Math.min(6.5, (st.size || 3) * 1.05))
    ctx.lineWidth = lw
    if (st.points.length === 1) {
      ctx.beginPath()
      ctx.arc(st.points[0][0], st.points[0][1], lw * 0.6, 0, Math.PI * 2)
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
  }

  ctx.restore()

  const base64 = canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '')
  return {
    base64,
    bounds: { minX, minY, maxX, maxY }
  }
}

/**
 * Segments strokes into horizontal lines and renders high-contrast white-background PNGs
 * ready for `window.glassAPI.runLocalOcr`.
 */
export function rasterizeStrokesForLocalOcr(strokes: Stroke[]): SegmentedOcrPayload | null {
  const lineGroups = segmentHandwritingStrokesIntoLines(strokes)
  if (lineGroups.length === 0) return null

  const imagesBase64: string[] = []
  const lineBounds: Array<{ minX: number; minY: number; maxX: number; maxY: number }> = []
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const group of lineGroups) {
    const rendered = renderSingleLinePngBase64(group)
    if (!rendered) continue
    imagesBase64.push(rendered.base64)
    lineBounds.push(rendered.bounds)
    minX = Math.min(minX, rendered.bounds.minX)
    minY = Math.min(minY, rendered.bounds.minY)
    maxX = Math.max(maxX, rendered.bounds.maxX)
    maxY = Math.max(maxY, rendered.bounds.maxY)
  }

  if (imagesBase64.length === 0) return null
  return {
    imagesBase64,
    lineBounds,
    overallBounds: { minX, minY, maxX, maxY }
  }
}
