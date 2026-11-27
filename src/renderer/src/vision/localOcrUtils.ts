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
  /** 0-based line index per rendered image so wide-line chunks can be rejoined with spaces */
  lineIndices: number[]
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

interface LineBand {
  items: StrokeBBox[]
  minY: number
  maxY: number
  minX: number
  maxX: number
  cy: number
}

function addBoxToBand(band: LineBand, box: StrokeBBox): void {
  band.items.push(box)
  band.minY = Math.min(band.minY, box.minY)
  band.maxY = Math.max(band.maxY, box.maxY)
  band.minX = Math.min(band.minX, box.minX)
  band.maxX = Math.max(band.maxX, box.maxX)
  band.cy = band.items.reduce((acc, it) => acc + it.cy, 0) / band.items.length
}

function horizGapToBand(box: StrokeBBox, band: LineBand): number {
  let minGap = Infinity
  for (const it of band.items) {
    const gap = Math.max(0, Math.max(box.minX - it.maxX, it.minX - box.maxX))
    if (gap < minGap) minGap = gap
  }
  return minGap
}

/**
 * Segments freehand handwriting strokes into top-to-bottom horizontal lines
 * so single-line TrOCR (`Xenova/trocr-base-handwritten`, ONNX port of `microsoft/trocr-base-handwritten`)
 * can transcribe both single words and multi-line paragraphs accurately on CPU without any LLM API.
 */
export function segmentHandwritingStrokesIntoLines(strokes: Stroke[]): Stroke[][] {
  const boxes = strokes.map(getStrokeBBox).filter((b): b is StrokeBBox => b !== null)
  if (boxes.length === 0) return []

  const medianH = (() => {
    const heights = boxes.map((b) => b.h).sort((a, b) => a - b)
    return Math.max(16, heights[Math.floor(heights.length / 2)] || 24)
  })()

  // Pass 1: Separate primary character strokes from small diacritics/crossbars/punctuation
  const primaryAll = boxes.filter((b) => b.h >= medianH * 0.45)
  const primary = primaryAll.length > 0 ? primaryAll : boxes
  const small = primaryAll.length > 0 ? boxes.filter((b) => b.h < medianH * 0.45) : []

  primary.sort((a, b) => a.cy - b.cy)

  const bands: LineBand[] = []

  for (const box of primary) {
    let bestBand: LineBand | null = null
    let bestScore = -Infinity

    for (const band of bands) {
      const overlapTop = Math.max(band.minY, box.minY)
      const overlapBot = Math.min(band.maxY, box.maxY)
      const overlap = overlapBot - overlapTop
      const centerDist = Math.abs(box.cy - band.cy)
      const bandH = Math.max(12, band.maxY - band.minY)

      if (overlap > Math.min(box.h, bandH) * 0.25 || centerDist <= Math.max(medianH * 0.62, bandH * 0.48)) {
        const score = overlap - centerDist * 0.5
        if (score > bestScore) {
          bestScore = score
          bestBand = band
        }
      }
    }

    if (bestBand) {
      addBoxToBand(bestBand, box)
    } else {
      bands.push({
        items: [box],
        minY: box.minY,
        maxY: box.maxY,
        minX: box.minX,
        maxX: box.maxX,
        cy: box.cy
      })
    }
  }

  // Pass 2: Attach small strokes (dots on 'i'/'j', t-crossbars, dashes, punctuation)
  // using both vertical and horizontal proximity so diacritics never form spurious lines.
  for (const box of small) {
    let bestBand: LineBand | null = null
    let bestScore = -Infinity

    for (const band of bands) {
      const vTop = band.minY - medianH * 0.75
      const vBot = band.maxY + medianH * 0.45
      if (box.maxY < vTop || box.minY > vBot) continue

      const centerDist = Math.abs(box.cy - band.cy)
      const hGap = horizGapToBand(box, band)
      const horizBonus = hGap <= medianH * 1.5 ? medianH * 1.2 - hGap * 0.4 : -hGap * 0.25
      const score = horizBonus - centerDist
      if (score > bestScore) {
        bestScore = score
        bestBand = band
      }
    }

    if (bestBand) {
      addBoxToBand(bestBand, box)
    } else {
      bands.push({
        items: [box],
        minY: box.minY,
        maxY: box.maxY,
        minX: box.minX,
        maxX: box.maxX,
        cy: box.cy
      })
    }
  }

  // Pass 3: Merge adjacent bands whose vertical baselines are too close or strongly overlap
  bands.sort((a, b) => a.minY - b.minY)
  const mergedBands: LineBand[] = []
  for (const band of bands) {
    const prev = mergedBands[mergedBands.length - 1]
    if (prev) {
      const overlap = Math.min(prev.maxY, band.maxY) - Math.max(prev.minY, band.minY)
      const minBandH = Math.max(12, Math.min(prev.maxY - prev.minY, band.maxY - band.minY))
      if (Math.abs(band.cy - prev.cy) <= medianH * 0.52 || overlap > minBandH * 0.35) {
        for (const it of band.items) {
          addBoxToBand(prev, it)
        }
        continue
      }
    }
    mergedBands.push(band)
  }

  mergedBands.sort((a, b) => a.minY - b.minY)
  return mergedBands.map((band) => {
    // Sort strokes left-to-right within each line
    band.items.sort((a, b) => a.minX - b.minX)
    return band.items.map((it) => it.stroke)
  })
}

/**
 * Splits very wide single lines (aspect ratio > 9:1) into word-boundary chunks so
 * TrOCR's fixed 384x384 ViT encoder does not squash long sentences past legibility.
 * Overlapping strokes within multi-stroke letters are never split.
 */
function splitWideLineIntoChunks(lineStrokes: Stroke[]): Stroke[][] {
  if (lineStrokes.length < 2) return [lineStrokes]
  const boxes = lineStrokes.map(getStrokeBBox).filter((b): b is StrokeBBox => b !== null)
  if (boxes.length < 2) return [lineStrokes]

  boxes.sort((a, b) => a.minX - b.minX)
  let lineMinX = Infinity
  let lineMinY = Infinity
  let lineMaxX = -Infinity
  let lineMaxY = -Infinity
  for (const b of boxes) {
    if (b.minX < lineMinX) lineMinX = b.minX
    if (b.minY < lineMinY) lineMinY = b.minY
    if (b.maxX > lineMaxX) lineMaxX = b.maxX
    if (b.maxY > lineMaxY) lineMaxY = b.maxY
  }
  const rawW = Math.max(1, lineMaxX - lineMinX)
  const rawH = Math.max(12, lineMaxY - lineMinY)
  if (rawW / rawH <= 9.0) return [boxes.map((b) => b.stroke)]

  const minWordGap = Math.max(rawH * 0.55, 18)
  const minChunkW = rawH * 4.5
  const minRemainingW = rawH * 1.5

  const chunks: Stroke[][] = []
  let currentBoxes: StrokeBBox[] = [boxes[0]]
  let chunkMinX = boxes[0].minX
  let runningMaxX = boxes[0].maxX

  for (let i = 1; i < boxes.length; i++) {
    const b = boxes[i]
    const gap = b.minX - runningMaxX
    const currentChunkW = runningMaxX - chunkMinX
    const remainingW = lineMaxX - b.minX

    if (gap > minWordGap && currentChunkW > minChunkW && remainingW > minRemainingW) {
      chunks.push(currentBoxes.map((it) => it.stroke))
      currentBoxes = [b]
      chunkMinX = b.minX
      runningMaxX = b.maxX
    } else {
      currentBoxes.push(b)
      if (b.maxX > runningMaxX) runningMaxX = b.maxX
    }
  }
  if (currentBoxes.length > 0) {
    chunks.push(currentBoxes.map((it) => it.stroke))
  }
  return chunks.length > 0 ? chunks : [lineStrokes]
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

  const rawW = Math.max(20, maxX - minX)
  const rawH = Math.max(20, maxY - minY)

  // TrOCR (384x384 ViT) performs best with pure black ink (#000000) on clean white (#ffffff),
  // proportional padding, and consistent ~80px IAM-like text height with ~4.5-5.5px stroke width.
  const targetTextH = 80
  const scale = Math.max(0.2, Math.min(3.5, targetTextH / rawH))
  const padYPx = 24
  const padXPx = Math.max(32, Math.round(targetTextH * 0.45))
  const padX = padXPx / scale
  const padY = padYPx / scale
  const worldW = rawW + padX * 2
  const worldH = rawH + padY * 2

  const canvasW = Math.min(1600, Math.max(128, Math.round(worldW * scale)))
  const canvasH = Math.min(384, Math.max(80, Math.round(worldH * scale)))

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

  ctx.strokeStyle = '#000000'
  ctx.fillStyle = '#000000'
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  const baseTargetStrokePx = Math.max(3.2, Math.min(5.8, targetTextH * 0.062))

  for (const st of lineStrokes) {
    if (!st.points || st.points.length === 0) continue
    const sizeMod = Math.max(0.85, Math.min(1.25, (st.size || 3) / 3.2))
    const lw = (baseTargetStrokePx * sizeMod) / scale
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
 * Segments strokes into horizontal lines (chunking ultra-wide lines) and renders
 * high-contrast white-background PNGs ready for `window.glassAPI.runLocalOcr`.
 */
export function rasterizeStrokesForLocalOcr(strokes: Stroke[]): SegmentedOcrPayload | null {
  const lineGroups = segmentHandwritingStrokesIntoLines(strokes)
  if (lineGroups.length === 0) return null

  const imagesBase64: string[] = []
  const lineIndices: number[] = []
  const lineBounds: Array<{ minX: number; minY: number; maxX: number; maxY: number }> = []
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (let lineIdx = 0; lineIdx < lineGroups.length; lineIdx++) {
    const chunks = splitWideLineIntoChunks(lineGroups[lineIdx])
    for (const chunk of chunks) {
      const rendered = renderSingleLinePngBase64(chunk)
      if (!rendered) continue
      imagesBase64.push(rendered.base64)
      lineIndices.push(lineIdx)
      lineBounds.push(rendered.bounds)
      minX = Math.min(minX, rendered.bounds.minX)
      minY = Math.min(minY, rendered.bounds.minY)
      maxX = Math.max(maxX, rendered.bounds.maxX)
      maxY = Math.max(maxY, rendered.bounds.maxY)
    }
  }

  if (imagesBase64.length === 0) return null
  return {
    imagesBase64,
    lineIndices,
    lineBounds,
    overallBounds: { minX, minY, maxX, maxY }
  }
}

/**
 * Renders all handwriting strokes together in their natural multi-line layout onto a
 * high-contrast `#000000`-on-`#ffffff` PNG (raw base64, no data URI prefix) for Vision LLM API OCR.
 */
export function rasterizeStrokesBlockForApiOcr(
  strokes: Stroke[]
): { base64: string; bounds: { minX: number; minY: number; maxX: number; maxY: number } } | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const st of strokes) {
    if (!st.points || st.points.length === 0) continue
    for (const [x, y] of st.points) {
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null

  const rawW = Math.max(24, maxX - minX)
  const rawH = Math.max(24, maxY - minY)
  const padWorld = Math.max(24, Math.min(48, Math.min(rawW, rawH) * 0.25))
  const worldW = rawW + padWorld * 2
  const worldH = rawH + padWorld * 2

  const maxW = 1280
  const maxH = 1024
  let scale = Math.min(maxW / worldW, maxH / worldH)
  if (worldW * scale < 160 || worldH * scale < 96) {
    scale = Math.max(scale, Math.min(3.5, Math.max(160 / worldW, 96 / worldH)))
  }
  scale = Math.max(0.25, Math.min(3.5, scale))

  const canvasW = Math.min(maxW, Math.max(160, Math.round(worldW * scale)))
  const canvasH = Math.min(maxH, Math.max(96, Math.round(worldH * scale)))

  const canvas = document.createElement('canvas')
  canvas.width = canvasW
  canvas.height = canvasH
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvasW, canvasH)

  ctx.save()
  ctx.scale(scale, scale)
  ctx.translate(-(minX - padWorld), -(minY - padWorld))

  ctx.strokeStyle = '#000000'
  ctx.fillStyle = '#000000'
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  for (const st of strokes) {
    if (!st.points || st.points.length === 0) continue
    const lw = Math.max(2.6 / scale, Math.min(7 / scale, (st.size || 3) * 1.05))
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
