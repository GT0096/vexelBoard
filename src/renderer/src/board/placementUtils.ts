import type { BoardState, CanvasTransform } from '../types/board'

export interface BoxRect {
  x: number
  y: number
  w: number
  h: number
}

export interface ScreenSafeRect {
  left: number
  top: number
  right: number
  bottom: number
}

export function rectsOverlap(a: BoxRect, b: BoxRect, gap = 0): boolean {
  return (
    a.x < b.x + b.w + gap &&
    a.x + a.w + gap > b.x &&
    a.y < b.y + b.h + gap &&
    a.y + a.h + gap > b.y
  )
}

export function getSafeViewportScreenRect(): ScreenSafeRect {
  const winW = typeof window !== 'undefined' ? window.innerWidth : 1280
  const winH = typeof window !== 'undefined' ? window.innerHeight : 800
  let left = 84
  let right = winW - 28
  const top = 68
  const bottom = Math.max(top + 220, winH - 96)

  if (typeof document !== 'undefined') {
    const chatEl = document.querySelector('.floating-ai-window')
    if (chatEl) {
      const chatRect = chatEl.getBoundingClientRect()
      if (chatRect.width > 0 && chatRect.height > 0) {
        if (chatRect.left >= winW * 0.4) {
          right = Math.min(right, Math.round(chatRect.left - 18))
        } else if (chatRect.right <= winW * 0.6) {
          left = Math.max(left, Math.round(chatRect.right + 18))
        }
      }
    }
  }

  if (right - left < 240) {
    left = 24
    right = Math.max(left + 260, winW - 24)
  }

  return { left, top, right, bottom }
}

/**
 * Collects bounding rectangles for every visual entity on the board so new creations
 * always land in genuinely empty canvas space without colliding with existing ink or cards.
 */
export function collectOccupiedBoardRects(
  board: BoardState,
  opts?: { getDomSize?: (id: string) => { w: number; h: number } | null }
): BoxRect[] {
  const rects: BoxRect[] = []
  const getDom =
    opts?.getDomSize ??
    (typeof document !== 'undefined'
      ? (id: string) => {
          const el = document.getElementById(id)
          if (!el || el.offsetWidth <= 0 || el.offsetHeight <= 0) return null
          return { w: el.offsetWidth, h: el.offsetHeight }
        }
      : undefined)

  for (const t of board.textNodes) {
    const dom = getDom?.(t.id)
    const tw = t.w ?? dom?.w ?? (t.immersed ? Math.max(60, t.text.length * 10) : 340)
    const th = t.h ?? dom?.h ?? (t.immersed ? 36 : 220)
    rects.push({ x: t.x, y: t.y, w: tw, h: th })
  }

  for (const eq of board.equationNodes) {
    const dom = getDom?.(eq.id)
    const ew = eq.w ?? dom?.w ?? 260
    const eh = eq.h ?? dom?.h ?? 90
    rects.push({ x: eq.x, y: eq.y, w: ew, h: eh })
  }

  for (const d of board.diagramNodes ?? []) {
    const dw = d.w ?? 640
    const dh = d.h ?? 460
    rects.push({ x: d.x, y: d.y - 48, w: dw, h: dh + 48 })
  }

  for (const c of board.codeNodes ?? []) {
    const cw = c.w ?? 560
    const ch = c.h ?? 420
    rects.push({ x: c.x, y: c.y, w: cw, h: ch })
  }

  for (const v of board.videoNodes ?? []) {
    const vw = v.w ?? 540
    const vh = v.h ?? 460
    rects.push({ x: v.x, y: v.y, w: vw, h: vh })
  }

  for (const img of board.imageNodes ?? []) {
    const iw = img.w ?? 360
    const ih = img.h ?? 260
    rects.push({ x: img.x, y: img.y, w: iw, h: ih })
  }

  for (const s3d of board.scene3dNodes ?? []) {
    const sw = s3d.w ?? 460
    const sh = s3d.h ?? 360
    rects.push({ x: s3d.x, y: s3d.y, w: sw, h: sh })
  }

  for (const gr of board.graphNodes ?? []) {
    const gw = gr.w ?? 500
    const gh = gr.h ?? 360
    rects.push({ x: gr.x, y: gr.y, w: gw, h: gh })
  }

  for (const va of board.vectorArtNodes ?? []) {
    const vw = Math.max(24, Math.abs(va.width))
    const vh = Math.max(24, Math.abs(va.height))
    rects.push({ x: va.x, y: va.y, w: vw, h: vh })
  }

  for (const s of board.shapeNodes) {
    if (Array.isArray(s.points) && s.points.length >= 2) {
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
      if (s.controlPoint) {
        minX = Math.min(minX, s.controlPoint[0])
        minY = Math.min(minY, s.controlPoint[1])
        maxX = Math.max(maxX, s.controlPoint[0])
        maxY = Math.max(maxY, s.controlPoint[1])
      }
      if (Number.isFinite(minX)) {
        rects.push({
          x: minX - 8,
          y: minY - 8,
          w: Math.max(16, maxX - minX + 16),
          h: Math.max(16, maxY - minY + 16)
        })
        continue
      }
    }
    const sx = s.w < 0 ? s.x + s.w : s.x
    const sy = s.h < 0 ? s.y + s.h : s.y
    const sw = Math.max(12, Math.abs(s.w))
    const sh = Math.max(12, Math.abs(s.h))
    rects.push({ x: sx, y: sy, w: sw, h: sh })
  }

  for (const st of board.strokes) {
    if (st.points.length === 0) continue
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const [px, py] of st.points) {
      if (px < minX) minX = px
      if (py < minY) minY = py
      if (px > maxX) maxX = px
      if (py > maxY) maxY = py
    }
    const pad = Math.max(6, (st.size || 4) + 4)
    rects.push({
      x: minX - pad,
      y: minY - pad,
      w: Math.max(16, maxX - minX + pad * 2),
      h: Math.max(16, maxY - minY + pad * 2)
    })
  }

  return rects
}

/**
 * Searches visible viewport center, adjacent safe slots, viewport scan grid, and outward spiral
 * over the infinite canvas to allocate a clean non-overlapping rectangle of size (itemW, itemH).
 */
export function findEmptyBoardRect(
  occupied: BoxRect[],
  itemW: number,
  itemH: number,
  view: CanvasTransform,
  screenSafe: ScreenSafeRect,
  opts?: { topMargin?: number; gap?: number }
): { x: number; y: number; nextPan?: { panX: number; panY: number } } {
  const topMargin = opts?.topMargin ?? 0
  const gap = opts?.gap ?? 24
  const zoom = Math.max(0.15, view.zoom)

  const viewMinX = (screenSafe.left - view.panX) / zoom
  const viewMaxX = (screenSafe.right - view.panX) / zoom
  const viewMinY = (screenSafe.top - view.panY) / zoom
  const viewMaxY = (screenSafe.bottom - view.panY) / zoom
  const viewCenterX = (viewMinX + viewMaxX) / 2
  const viewCenterY = (viewMinY + viewMaxY) / 2

  const isFree = (candX: number, candY: number): boolean => {
    const candidate: BoxRect = {
      x: candX,
      y: candY - topMargin,
      w: itemW,
      h: itemH + topMargin
    }
    for (const occ of occupied) {
      if (rectsOverlap(candidate, occ, gap)) {
        return false
      }
    }
    return true
  }

  const fitsInSafeView = (candX: number, candY: number): boolean =>
    candX >= viewMinX - 4 &&
    candX + itemW <= viewMaxX + 4 &&
    candY - topMargin >= viewMinY - 4 &&
    candY + itemH <= viewMaxY + 4

  // 1. Prefer safe viewport center when empty
  const centerCandX = Math.round(
    Math.max(viewMinX, Math.min(viewMaxX - itemW, viewCenterX - itemW / 2))
  )
  const centerCandY = Math.round(
    Math.max(viewMinY + topMargin, Math.min(viewMaxY - itemH, viewCenterY - itemH / 2))
  )
  if (isFree(centerCandX, centerCandY)) {
    return { x: centerCandX, y: centerCandY }
  }

  // 2. Clean slots adjacent to occupied rects within safe visible viewport
  const visibleAnchored: Array<{ x: number; y: number }> = []
  for (const occ of occupied) {
    visibleAnchored.push(
      { x: Math.round(occ.x + occ.w + gap), y: Math.round(occ.y + topMargin) },
      { x: Math.round(occ.x), y: Math.round(occ.y + occ.h + gap + topMargin) },
      { x: Math.round(occ.x - gap - itemW), y: Math.round(occ.y + topMargin) },
      { x: Math.round(occ.x), y: Math.round(occ.y - gap - itemH) }
    )
  }
  visibleAnchored.sort((a, b) => a.y - b.y || a.x - b.x)
  for (const c of visibleAnchored) {
    if (fitsInSafeView(c.x, c.y) && isFree(c.x, c.y)) {
      return { x: c.x, y: c.y }
    }
  }

  // 3. Top-to-bottom scan inside safe visible viewport
  const scanMaxX = viewMaxX - itemW
  const scanMaxY = viewMaxY - itemH
  const scanMinY = viewMinY + topMargin
  if (scanMaxX >= viewMinX && scanMaxY >= scanMinY) {
    const step = 28
    for (let cy = Math.round(scanMinY); cy <= scanMaxY; cy += step) {
      for (let cx = Math.round(viewMinX); cx <= scanMaxX; cx += step) {
        if (isFree(cx, cy)) {
          return { x: cx, y: cy }
        }
      }
    }
  }

  // 4. Viewport is full: search right/below/around occupied items in world space and pan to it
  let chosenX = centerCandX
  let chosenY = centerCandY
  const fallbackCandidates: Array<{ x: number; y: number }> = []
  for (const occ of occupied) {
    fallbackCandidates.push(
      { x: Math.round(occ.x + occ.w + gap), y: Math.round(occ.y + topMargin) },
      { x: Math.round(occ.x), y: Math.round(occ.y + occ.h + gap + topMargin) }
    )
  }
  fallbackCandidates.sort((a, b) => {
    const da = Math.hypot(a.x + itemW / 2 - viewCenterX, a.y + itemH / 2 - viewCenterY)
    const db = Math.hypot(b.x + itemW / 2 - viewCenterX, b.y + itemH / 2 - viewCenterY)
    return da - db
  })

  let foundOffscreen = false
  for (const c of fallbackCandidates) {
    if (isFree(c.x, c.y)) {
      chosenX = c.x
      chosenY = c.y
      foundOffscreen = true
      break
    }
  }

  if (!foundOffscreen) {
    const stepX = Math.max(140, Math.round(itemW * 0.65))
    const stepY = Math.max(120, Math.round((itemH + topMargin) * 0.65))
    outer: for (let ring = 1; ring <= 32; ring++) {
      for (let gy = -ring; gy <= ring; gy++) {
        for (let gx = -ring; gx <= ring; gx++) {
          if (Math.abs(gx) !== ring && Math.abs(gy) !== ring) continue
          const cx = Math.round(centerCandX + gx * stepX)
          const cy = Math.round(centerCandY + gy * stepY)
          if (isFree(cx, cy)) {
            chosenX = cx
            chosenY = cy
            break outer
          }
        }
      }
    }
  }

  const targetScreenCenterX = (screenSafe.left + screenSafe.right) / 2
  const targetScreenCenterY = (screenSafe.top + screenSafe.bottom) / 2
  return {
    x: chosenX,
    y: chosenY,
    nextPan: {
      panX: Math.round(targetScreenCenterX - (chosenX + itemW / 2) * zoom),
      panY: Math.round(targetScreenCenterY - (chosenY + itemH / 2) * zoom)
    }
  }
}

export interface ClusterLayoutItem {
  key: string
  w: number
  h: number
}

/**
 * Arranges multiple related items (e.g., visual diagram + explanatory note + equation)
 * side-by-side in a cohesive grid, allocates ONE guaranteed-empty area on the infinite board
 * for the whole cluster, and returns world (x, y) coordinates per key plus optional `nextPan`.
 */
export function planEmptyClusterLayout(
  occupied: BoxRect[],
  items: ClusterLayoutItem[],
  view: CanvasTransform,
  screenSafe: ScreenSafeRect,
  opts?: { gap?: number; clusterGap?: number }
): {
  positions: Record<string, { x: number; y: number }>
  clusterBounds: BoxRect
  nextPan?: { panX: number; panY: number }
} {
  if (items.length === 0) {
    return { positions: {}, clusterBounds: { x: 0, y: 0, w: 0, h: 0 } }
  }

  const itemGap = opts?.gap ?? 28
  const clusterGap = opts?.clusterGap ?? 36
  const relPositions: Record<string, { x: number; y: number }> = {}
  let clusterW = 0
  let clusterH = 0

  if (items.length === 1) {
    relPositions[items[0].key] = { x: 0, y: 0 }
    clusterW = items[0].w
    clusterH = items[0].h
  } else {
    // 2 columns max so visuals sit left and companion cards stack cleanly right
    const cols = 2
    const rows: Array<ClusterLayoutItem[]> = []
    for (let i = 0; i < items.length; i += cols) {
      rows.push(items.slice(i, i + cols))
    }

    const colWidths: number[] = [0, 0]
    for (const row of rows) {
      row.forEach((it, cIdx) => {
        colWidths[cIdx] = Math.max(colWidths[cIdx], it.w)
      })
    }

    let curY = 0
    for (const row of rows) {
      let curX = 0
      let rowH = 0
      row.forEach((it, cIdx) => {
        relPositions[it.key] = { x: curX, y: curY }
        curX += colWidths[cIdx] + itemGap
        rowH = Math.max(rowH, it.h)
      })
      clusterW = Math.max(clusterW, curX - itemGap)
      clusterH += rowH + itemGap
      curY += rowH + itemGap
    }
    clusterH = Math.max(0, clusterH - itemGap)
  }

  const placement = findEmptyBoardRect(occupied, clusterW, clusterH, view, screenSafe, {
    topMargin: 24,
    gap: clusterGap
  })

  const positions: Record<string, { x: number; y: number }> = {}
  for (const it of items) {
    const rel = relPositions[it.key] ?? { x: 0, y: 0 }
    positions[it.key] = {
      x: Math.round(placement.x + rel.x),
      y: Math.round(placement.y + rel.y)
    }
  }

  return {
    positions,
    clusterBounds: {
      x: placement.x,
      y: placement.y,
      w: clusterW,
      h: clusterH
    },
    nextPan: placement.nextPan
  }
}
