import type { BoardState, InkPoint, ShapeKind } from '../types/board'

export interface RotationSnapshot {
  pivotX: number
  pivotY: number
  shapes: Array<{
    id: string
    shape: ShapeKind
    initX: number
    initY: number
    initW: number
    initH: number
    initRotation: number
    initControlPoint?: [number, number]
    initPoints?: Array<[number, number]>
  }>
  vectorArts: Array<{
    id: string
    initX: number
    initY: number
    initW: number
    initH: number
    initRotation: number
  }>
  texts: Array<{
    id: string
    initX: number
    initY: number
    initW: number
    initH: number
    initRotation: number
    immersed?: boolean
  }>
  equations: Array<{ id: string; initX: number; initY: number; initW: number; initH: number }>
  images: Array<{ id: string; initX: number; initY: number; initW: number; initH: number }>
  strokes: Array<{ id: string; initPoints: InkPoint[] }>
}

export function normalizeAngleDeg(deg: number): number {
  let a = deg % 360
  if (a <= -180) a += 360
  if (a > 180) a -= 360
  if (Math.abs(a) < 0.05 || Math.abs(Math.abs(a) - 360) < 0.05) return 0
  return Math.round(a * 10) / 10
}

export function rotatePointAround(
  px: number,
  py: number,
  cx: number,
  cy: number,
  rad: number
): [number, number] {
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const dx = px - cx
  const dy = py - cy
  return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos]
}

/**
 * True for native canvas shapes defined directly by endpoints/points rather than a centered box.
 * Library line shapes (`anim-line-*`) rotate around `(x + w/2, y + h/2)` via `s.rotation` in render.ts.
 */
export function isEndpointLinearShape(shape: ShapeKind): boolean {
  return (
    shape === 'line' ||
    shape === 'dashed-line' ||
    shape === 'arrow' ||
    shape === 'arrow-bidirectional' ||
    shape === 'elbow' ||
    shape === 'curved-line' ||
    shape === 'curved-arrow' ||
    shape === 'polyline'
  )
}

export function captureRotationSnapshot(
  board: BoardState,
  ids: string[],
  pivotX: number,
  pivotY: number
): RotationSnapshot {
  const idSet = new Set(ids)
  return {
    pivotX,
    pivotY,
    shapes: board.shapeNodes
      .filter((s) => idSet.has(s.id))
      .map((s) => ({
        id: s.id,
        shape: s.shape,
        initX: s.x,
        initY: s.y,
        initW: s.w,
        initH: s.h,
        initRotation: s.rotation ?? 0,
        initControlPoint: s.controlPoint
          ? ([s.controlPoint[0], s.controlPoint[1]] as [number, number])
          : undefined,
        initPoints: s.points
          ? s.points.map(([px, py]) => [px, py] as [number, number])
          : undefined
      })),
    vectorArts: (board.vectorArtNodes ?? [])
      .filter((v) => idSet.has(v.id))
      .map((v) => ({
        id: v.id,
        initX: v.x,
        initY: v.y,
        initW: v.width,
        initH: v.height,
        initRotation: v.rotation ?? 0
      })),
    texts: board.textNodes
      .filter((t) => idSet.has(t.id))
      .map((t) => {
        const estW =
          t.w ??
          (t.immersed
            ? Math.max(
                40,
                Math.min(
                  640,
                  Math.max(...t.text.split('\n').map((l) => l.length), 4) *
                    (t.fontSize || 20) *
                    0.62
                )
              )
            : 260)
        const estH =
          t.h ??
          (t.immersed
            ? Math.max(28, (t.text.split('\n').length || 1) * (t.fontSize || 20) * 1.4)
            : 120)
        return {
          id: t.id,
          initX: t.x,
          initY: t.y,
          initW: estW,
          initH: estH,
          initRotation: t.rotation ?? 0,
          immersed: t.immersed
        }
      }),
    equations: board.equationNodes
      .filter((e) => idSet.has(e.id))
      .map((e) => ({
        id: e.id,
        initX: e.x,
        initY: e.y,
        initW: e.w ?? 200,
        initH: e.h ?? 70
      })),
    images: (board.imageNodes ?? [])
      .filter((im) => idSet.has(im.id))
      .map((im) => ({
        id: im.id,
        initX: im.x,
        initY: im.y,
        initW: im.w,
        initH: im.h
      })),
    strokes: board.strokes
      .filter((st) => idSet.has(st.id))
      .map((st) => ({
        id: st.id,
        initPoints: st.points.map(([x, y, p]) => [x, y, p] as InkPoint)
      }))
  }
}

export function applyRotationDelta(
  board: BoardState,
  snap: RotationSnapshot,
  deltaDeg: number
): BoardState {
  const rad = (deltaDeg * Math.PI) / 180
  const { pivotX, pivotY } = snap
  const rotatedShapeIdSet = new Set(snap.shapes.map((s) => s.id))

  const shapeUpdates = new Map<string, Partial<BoardState['shapeNodes'][number]>>()
  for (const s of snap.shapes) {
    if (isEndpointLinearShape(s.shape)) {
      if (s.initPoints && s.initPoints.length >= 2) {
        const rotPts = s.initPoints.map(([px, py]) => {
          const [rx, ry] = rotatePointAround(px, py, pivotX, pivotY, rad)
          return [Math.round(rx), Math.round(ry)] as [number, number]
        })
        let minX = Infinity
        let minY = Infinity
        let maxX = -Infinity
        let maxY = -Infinity
        for (const [rx, ry] of rotPts) {
          if (rx < minX) minX = rx
          if (ry < minY) minY = ry
          if (rx > maxX) maxX = rx
          if (ry > maxY) maxY = ry
        }
        const orig = board.shapeNodes.find((n) => n.id === s.id)
        const startInside = Boolean(
          orig?.startBinding && rotatedShapeIdSet.has(orig.startBinding.shapeId)
        )
        const endInside = Boolean(orig?.endBinding && rotatedShapeIdSet.has(orig.endBinding.shapeId))
        shapeUpdates.set(s.id, {
          x: minX,
          y: minY,
          w: Math.max(1, maxX - minX),
          h: Math.max(1, maxY - minY),
          points: rotPts,
          ...(orig?.startBinding && !startInside && Math.abs(deltaDeg) > 0.5
            ? { startBinding: undefined }
            : {}),
          ...(orig?.endBinding && !endInside && Math.abs(deltaDeg) > 0.5
            ? { endBinding: undefined }
            : {})
        })
      } else {
        const [x1, y1] = rotatePointAround(s.initX, s.initY, pivotX, pivotY, rad)
        const [x2, y2] = rotatePointAround(
          s.initX + s.initW,
          s.initY + s.initH,
          pivotX,
          pivotY,
          rad
        )
        let nextCtrl = s.initControlPoint
        if (s.initControlPoint) {
          const [cx, cy] = rotatePointAround(
            s.initControlPoint[0],
            s.initControlPoint[1],
            pivotX,
            pivotY,
            rad
          )
          nextCtrl = [Math.round(cx), Math.round(cy)]
        }
        shapeUpdates.set(s.id, {
          x: Math.round(x1),
          y: Math.round(y1),
          w: Math.round(x2 - x1),
          h: Math.round(y2 - y1),
          ...(nextCtrl ? { controlPoint: nextCtrl } : {})
        })
      }
    } else {
      const cx = s.initX + s.initW / 2
      const cy = s.initY + s.initH / 2
      const [ncx, ncy] = rotatePointAround(cx, cy, pivotX, pivotY, rad)
      shapeUpdates.set(s.id, {
        x: Math.round(ncx - s.initW / 2),
        y: Math.round(ncy - s.initH / 2),
        rotation: normalizeAngleDeg(s.initRotation + deltaDeg)
      })
    }
  }

  const vectorArtUpdates = new Map<string, { x: number; y: number; rotation: number }>()
  for (const v of snap.vectorArts) {
    const cx = v.initX + v.initW / 2
    const cy = v.initY + v.initH / 2
    const [ncx, ncy] = rotatePointAround(cx, cy, pivotX, pivotY, rad)
    vectorArtUpdates.set(v.id, {
      x: Math.round(ncx - v.initW / 2),
      y: Math.round(ncy - v.initH / 2),
      rotation: normalizeAngleDeg(v.initRotation + deltaDeg)
    })
  }

  const textUpdates = new Map<string, { x: number; y: number; rotation: number }>()
  for (const t of snap.texts) {
    const cx = t.initX + t.initW / 2
    const cy = t.initY + t.initH / 2
    const [ncx, ncy] = rotatePointAround(cx, cy, pivotX, pivotY, rad)
    textUpdates.set(t.id, {
      x: Math.round(ncx - t.initW / 2),
      y: Math.round(ncy - t.initH / 2),
      rotation: normalizeAngleDeg(t.initRotation + deltaDeg)
    })
  }

  const eqUpdates = new Map<string, { x: number; y: number }>()
  for (const e of snap.equations) {
    const [ncx, ncy] = rotatePointAround(
      e.initX + e.initW / 2,
      e.initY + e.initH / 2,
      pivotX,
      pivotY,
      rad
    )
    eqUpdates.set(e.id, {
      x: Math.round(ncx - e.initW / 2),
      y: Math.round(ncy - e.initH / 2)
    })
  }

  const imgUpdates = new Map<string, { x: number; y: number }>()
  for (const im of snap.images) {
    const [ncx, ncy] = rotatePointAround(
      im.initX + im.initW / 2,
      im.initY + im.initH / 2,
      pivotX,
      pivotY,
      rad
    )
    imgUpdates.set(im.id, {
      x: Math.round(ncx - im.initW / 2),
      y: Math.round(ncy - im.initH / 2)
    })
  }

  const strokeUpdates = new Map<string, InkPoint[]>()
  for (const st of snap.strokes) {
    strokeUpdates.set(
      st.id,
      st.initPoints.map(([px, py, p]) => {
        const [rx, ry] = rotatePointAround(px, py, pivotX, pivotY, rad)
        return [Math.round(rx * 10) / 10, Math.round(ry * 10) / 10, p] as InkPoint
      })
    )
  }

  return {
    ...board,
    shapeNodes: board.shapeNodes.map((s) =>
      shapeUpdates.has(s.id) ? { ...s, ...shapeUpdates.get(s.id)! } : s
    ),
    vectorArtNodes: (board.vectorArtNodes ?? []).map((v) =>
      vectorArtUpdates.has(v.id) ? { ...v, ...vectorArtUpdates.get(v.id)! } : v
    ),
    textNodes: board.textNodes.map((t) =>
      textUpdates.has(t.id) ? { ...t, ...textUpdates.get(t.id)! } : t
    ),
    equationNodes: board.equationNodes.map((e) =>
      eqUpdates.has(e.id) ? { ...e, ...eqUpdates.get(e.id)! } : e
    ),
    imageNodes: (board.imageNodes ?? []).map((im) =>
      imgUpdates.has(im.id) ? { ...im, ...imgUpdates.get(im.id)! } : im
    ),
    strokes: board.strokes.map((st) =>
      strokeUpdates.has(st.id) ? { ...st, points: strokeUpdates.get(st.id)! } : st
    )
  }
}

export function applyGroupScale(
  board: BoardState,
  snap: RotationSnapshot,
  initBounds: { x: number; y: number; w: number; h: number },
  nextBounds: { x: number; y: number; w: number; h: number }
): BoardState {
  const sx = initBounds.w > 1 ? nextBounds.w / initBounds.w : 1
  const sy = initBounds.h > 1 ? nextBounds.h / initBounds.h : 1
  const mapX = (px: number): number => nextBounds.x + (px - initBounds.x) * sx
  const mapY = (py: number): number => nextBounds.y + (py - initBounds.y) * sy

  const shapeUpdates = new Map<string, Partial<BoardState['shapeNodes'][number]>>()
  for (const s of snap.shapes) {
    if (s.initPoints && s.initPoints.length >= 2) {
      const pts = s.initPoints.map(
        ([px, py]) => [Math.round(mapX(px)), Math.round(mapY(py))] as [number, number]
      )
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const [px, py] of pts) {
        if (px < minX) minX = px
        if (py < minY) minY = py
        if (px > maxX) maxX = px
        if (py > maxY) maxY = py
      }
      shapeUpdates.set(s.id, {
        x: minX,
        y: minY,
        w: Math.max(1, maxX - minX),
        h: Math.max(1, maxY - minY),
        points: pts
      })
    } else if (isEndpointLinearShape(s.shape)) {
      const x1 = mapX(s.initX)
      const y1 = mapY(s.initY)
      const x2 = mapX(s.initX + s.initW)
      const y2 = mapY(s.initY + s.initH)
      shapeUpdates.set(s.id, {
        x: Math.round(x1),
        y: Math.round(y1),
        w: Math.round(x2 - x1),
        h: Math.round(y2 - y1),
        ...(s.initControlPoint
          ? {
              controlPoint: [
                Math.round(mapX(s.initControlPoint[0])),
                Math.round(mapY(s.initControlPoint[1]))
              ] as [number, number]
            }
          : {})
      })
    } else {
      shapeUpdates.set(s.id, {
        x: Math.round(mapX(s.initX)),
        y: Math.round(mapY(s.initY)),
        w: Math.max(12, Math.round(s.initW * sx)),
        h: Math.max(12, Math.round(s.initH * sy))
      })
    }
  }

  const vectorArtUpdates = new Map<string, { x: number; y: number; width: number; height: number }>()
  for (const v of snap.vectorArts) {
    vectorArtUpdates.set(v.id, {
      x: Math.round(mapX(v.initX)),
      y: Math.round(mapY(v.initY)),
      width: Math.max(24, Math.round(v.initW * sx)),
      height: Math.max(24, Math.round(v.initH * sy))
    })
  }

  const textUpdates = new Map<string, { x: number; y: number }>()
  for (const t of snap.texts) {
    textUpdates.set(t.id, {
      x: Math.round(mapX(t.initX)),
      y: Math.round(mapY(t.initY))
    })
  }

  const imgUpdates = new Map<string, { x: number; y: number; w: number; h: number }>()
  for (const im of snap.images) {
    imgUpdates.set(im.id, {
      x: Math.round(mapX(im.initX)),
      y: Math.round(mapY(im.initY)),
      w: Math.max(40, Math.round(im.initW * sx)),
      h: Math.max(30, Math.round(im.initH * sy))
    })
  }

  const strokeUpdates = new Map<string, InkPoint[]>()
  for (const st of snap.strokes) {
    strokeUpdates.set(
      st.id,
      st.initPoints.map(
        ([px, py, p]) => [Math.round(mapX(px) * 10) / 10, Math.round(mapY(py) * 10) / 10, p] as InkPoint
      )
    )
  }

  return {
    ...board,
    shapeNodes: board.shapeNodes.map((s) =>
      shapeUpdates.has(s.id) ? { ...s, ...shapeUpdates.get(s.id)! } : s
    ),
    vectorArtNodes: (board.vectorArtNodes ?? []).map((v) =>
      vectorArtUpdates.has(v.id) ? { ...v, ...vectorArtUpdates.get(v.id)! } : v
    ),
    textNodes: board.textNodes.map((t) =>
      textUpdates.has(t.id) ? { ...t, ...textUpdates.get(t.id)! } : t
    ),
    imageNodes: (board.imageNodes ?? []).map((im) =>
      imgUpdates.has(im.id) ? { ...im, ...imgUpdates.get(im.id)! } : im
    ),
    strokes: board.strokes.map((st) =>
      strokeUpdates.has(st.id) ? { ...st, points: strokeUpdates.get(st.id)! } : st
    )
  }
}
