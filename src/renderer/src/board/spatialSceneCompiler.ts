import type {
  SpatialCellStrip,
  SpatialConnector,
  SpatialPath,
  SpatialScene,
  SpatialShape,
  SpatialText
} from '@shared/beautifySchema'
import type {
  FontId,
  PortSide,
  ShapeKind,
  ShapeNode,
  ShapePortBinding,
  TextNode
} from '../types/board'

export interface SpatialCompileOptions {
  measureText?: (text: string, fontSize: number, bold: boolean) => { w: number; h: number }
  existingGroupId?: string
  layerId?: string
}

export interface SpatialCompileResult {
  shapes: ShapeNode[]
  texts: TextNode[]
  groupId: string
  bounds: { x: number; y: number; width: number; height: number }
}

interface BoxObstacle {
  id: string
  x: number
  y: number
  w: number
  h: number
  openEnds?: Array<'start' | 'end'>
  orientation?: 'vertical' | 'horizontal'
}

interface TextRect {
  x: number
  y: number
  w: number
  h: number
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function defaultMeasureText(text: string, fontSize: number, bold: boolean): { w: number; h: number } {
  const lines = text.split('\n')
  const longest = lines.reduce((m, l) => Math.max(m, l.length), 1)
  const charFactor = bold ? 0.64 : 0.58
  return {
    w: Math.max(24, Math.ceil(longest * fontSize * charFactor) + 8),
    h: Math.max(20, Math.ceil(lines.length * fontSize * 1.32))
  }
}

function mapKind(kind: string): ShapeKind {
  const norm = kind.trim().toLowerCase()
  switch (norm) {
    case 'rounded_rect':
    case 'rounded-rect':
      return 'rounded-rect'
    case 'ellipse':
    case 'circle':
      return 'circle'
    case 'star':
    case 'star5':
    case 'star_5':
      return 'star-5'
    case 'sphere':
    case 'sphere3d':
      return 'sphere3d'
    case 'cube':
    case 'cube3d':
      return 'cube3d'
    case 'cylinder3d':
    case 'cylinder-3d':
      return 'cylinder3d'
    default:
      return (norm.replace(/_/g, '-') || 'rounded-rect') as ShapeKind
  }
}

function interpolateCatmullRomSpline(
  pts: Array<[number, number]>,
  samplesPerSeg = 10
): Array<[number, number]> {
  if (pts.length < 3) return pts
  const out: Array<[number, number]> = []
  const n = pts.length
  const getPt = (i: number): [number, number] => {
    if (i < 0) return [2 * pts[0][0] - pts[1][0], 2 * pts[0][1] - pts[1][1]]
    if (i >= n) return [2 * pts[n - 1][0] - pts[n - 2][0], 2 * pts[n - 1][1] - pts[n - 2][1]]
    return pts[i]
  }
  for (let i = 0; i < n - 1; i++) {
    const p0 = getPt(i - 1)
    const p1 = getPt(i)
    const p2 = getPt(i + 1)
    const p3 = getPt(i + 2)
    for (let s = 0; s < samplesPerSeg; s++) {
      const t = s / samplesPerSeg
      const t2 = t * t
      const t3 = t2 * t
      const x =
        0.5 *
        (2 * p1[0] +
          (-p0[0] + p2[0]) * t +
          (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
          (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3)
      const y =
        0.5 *
        (2 * p1[1] +
          (-p0[1] + p2[1]) * t +
          (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
          (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
      out.push([Math.round(x), Math.round(y)])
    }
  }
  out.push([Math.round(pts[n - 1][0]), Math.round(pts[n - 1][1])])
  return out
}

function rectsOverlap(a: TextRect, b: TextRect, margin = 4): boolean {
  return (
    a.x < b.x + b.w + margin &&
    a.x + a.w + margin > b.x &&
    a.y < b.y + b.h + margin &&
    a.y + a.h + margin > b.y
  )
}

function snapConnectorSegmentAngles(pts: Array<[number, number]>, angleTolDeg = 7): Array<[number, number]> {
  if (pts.length < 2) return pts
  const tanTol = Math.tan((angleTolDeg * Math.PI) / 180)
  const out: Array<[number, number]> = [[pts[0][0], pts[0][1]]]
  for (let i = 1; i < pts.length; i++) {
    const prev = out[out.length - 1]
    const cur: [number, number] = [pts[i][0], pts[i][1]]
    const dx = cur[0] - prev[0]
    const dy = cur[1] - prev[1]
    if (Math.abs(dx) > 4 && Math.abs(dy) <= Math.abs(dx) * tanTol) {
      cur[1] = prev[1]
    } else if (Math.abs(dy) > 4 && Math.abs(dx) <= Math.abs(dy) * tanTol) {
      cur[0] = prev[0]
    }
    if (Math.hypot(cur[0] - prev[0], cur[1] - prev[1]) >= 2) {
      out.push(cur)
    }
  }
  return out.length >= 2 ? out : [[pts[0][0], pts[0][1]], [pts[pts.length - 1][0], pts[pts.length - 1][1]]]
}

function edgeAnchorsForBox(b: BoxObstacle): Array<{ x: number; y: number }> {
  const anchors: Array<{ x: number; y: number }> = [
    { x: b.x + b.w / 2, y: b.y }, // top center
    { x: b.x + b.w, y: b.y + b.h / 2 }, // right center
    { x: b.x + b.w / 2, y: b.y + b.h }, // bottom center
    { x: b.x, y: b.y + b.h / 2 } // left center
  ]
  return anchors
}

function snapEndpointToBoxes(
  pt: [number, number],
  boxes: BoxObstacle[],
  preferredId?: string,
  tol = 22
): [number, number] {
  const candidates = preferredId ? boxes.filter((b) => b.id === preferredId) : boxes
  const pool = candidates.length > 0 ? candidates : boxes
  let best = pt
  let bestD = tol
  for (const box of pool) {
    for (const a of edgeAnchorsForBox(box)) {
      const d = Math.hypot(pt[0] - a.x, pt[1] - a.y)
      if (d < bestD) {
        bestD = d
        best = [Math.round(a.x), Math.round(a.y)]
      }
    }
  }
  return best
}

function normalizeAxisAlignment(
  strips: SpatialCellStrip[],
  shapes: SpatialShape[],
  tol = 20
): { strips: SpatialCellStrip[]; shapes: SpatialShape[] } {
  const sCopy = strips.map((s) => ({ ...s }))
  const shCopy = shapes.map((s) => ({ ...s }))
  const alignableBoxes: Array<{ x: number; y: number; w: number; h: number }> = [
    ...sCopy,
    ...shCopy.filter((sh) => sh.kind === 'rect' || sh.kind === 'rounded_rect')
  ]

  // Only align rectangular flow/grid blocks of comparable size so concentric shells/particles are untouched
  for (let i = 0; i < alignableBoxes.length; i++) {
    for (let j = i + 1; j < alignableBoxes.length; j++) {
      if (
        Math.abs(alignableBoxes[i].x - alignableBoxes[j].x) <= tol &&
        Math.abs(alignableBoxes[i].w - alignableBoxes[j].w) <= tol * 2
      ) {
        alignableBoxes[j].x = alignableBoxes[i].x
      }
      if (
        Math.abs(alignableBoxes[i].y - alignableBoxes[j].y) <= tol &&
        Math.abs(alignableBoxes[i].h - alignableBoxes[j].h) <= tol * 2
      ) {
        alignableBoxes[j].y = alignableBoxes[i].y
      }
      if (Math.abs(alignableBoxes[i].w - alignableBoxes[j].w) <= tol) {
        alignableBoxes[j].w = alignableBoxes[i].w
      }
    }
  }
  return { strips: sCopy, shapes: shCopy }
}

function distPointToBox(pt: [number, number], b: Pick<ShapeNode, 'x' | 'y' | 'w' | 'h'>): number {
  const minX = Math.min(b.x, b.x + b.w)
  const maxX = Math.max(b.x, b.x + b.w)
  const minY = Math.min(b.y, b.y + b.h)
  const maxY = Math.max(b.y, b.y + b.h)
  const dx = Math.max(minX - pt[0], 0, pt[0] - maxX)
  const dy = Math.max(minY - pt[1], 0, pt[1] - maxY)
  return Math.hypot(dx, dy)
}

function pickNearestShapePort(
  pt: [number, number],
  s: Pick<ShapeNode, 'x' | 'y' | 'w' | 'h'>
): { port: PortSide; dist: number } {
  const x = Math.min(s.x, s.x + s.w)
  const y = Math.min(s.y, s.y + s.h)
  const w = Math.abs(s.w)
  const h = Math.abs(s.h)
  const ports: Array<[PortSide, number, number]> = [
    ['top', x + w / 2, y],
    ['right', x + w, y + h / 2],
    ['bottom', x + w / 2, y + h],
    ['left', x, y + h / 2]
  ]
  let bestPort: PortSide = 'left'
  let bestDist = Infinity
  for (const [port, px, py] of ports) {
    const d = Math.hypot(pt[0] - px, pt[1] - py)
    if (d < bestDist) {
      bestDist = d
      bestPort = port
    }
  }
  return { port: bestPort, dist: bestDist }
}

/**
 * Compiles a structured SpatialScene (0..1000 coordinates) into clean, aligned,
 * non-overlapping Vexelboard native ShapeNodes + board-immersed TextNodes.
 */
export function compileSpatialScene(
  scene: SpatialScene,
  anchor: { x: number; y: number; width: number; height: number },
  fontFamily: FontId,
  options?: SpatialCompileOptions
): SpatialCompileResult {
  const now = Date.now()
  const groupId = options?.existingGroupId ?? `vspatial-${now.toString(36)}`
  const layerId = options?.layerId
  const measure = options?.measureText ?? defaultMeasureText

  // Enforce a comfortable readable minimum canvas scale without losing placement center
  const minDim = Math.max(1, Math.min(anchor.width, anchor.height))
  const boost = minDim < 220 ? Math.min(1.8, 240 / minDim) : 1
  const worldW = Math.round(Math.max(220, anchor.width * boost))
  const worldH = Math.round(Math.max(180, anchor.height * boost))
  const centerX = anchor.x + anchor.width / 2
  const centerY = anchor.y + anchor.height / 2
  const originX = Math.round(centerX - worldW / 2)
  const originY = Math.round(centerY - worldH / 2)

  const toWorldX = (nx: number): number => Math.round(originX + (nx / 1000) * worldW)
  const toWorldY = (ny: number): number => Math.round(originY + (ny / 1000) * worldH)
  const toWorldW = (nw: number): number => Math.max(8, Math.round((nw / 1000) * worldW))
  const toWorldH = (nh: number): number => Math.max(8, Math.round((nh / 1000) * worldH))

  const rawStrips = scene.elements.filter((e): e is SpatialCellStrip => e.type === 'cell_strip')
  const rawShapes = scene.elements.filter((e): e is SpatialShape => e.type === 'shape')
  const rawPaths = scene.elements.filter((e): e is SpatialPath => e.type === 'svg_path')
  const rawConnectors = scene.elements.filter((e): e is SpatialConnector => e.type === 'connector')
  const rawTexts = scene.elements.filter((e): e is SpatialText => e.type === 'text')

  const aligned = normalizeAxisAlignment(rawStrips, rawShapes)
  const compiledShapes: ShapeNode[] = []
  const compiledTexts: TextNode[] = []
  const obstacles: BoxObstacle[] = []
  const stripInteriorRects: Array<{ x: number; y: number; w: number; h: number }> = []
  const shapeNodeBySceneId = new Map<string, ShapeNode>()
  const bindableShapeNodes: ShapeNode[] = []

  // 1. Compile Cell Strips (Stacks, Queues, Arrays, Tables, Memory Frames)
  aligned.strips.forEach((strip, sIdx) => {
    const sx = toWorldX(strip.x)
    const sy = toWorldY(strip.y)
    let sw = toWorldW(strip.w)
    let sh = toWorldH(strip.h)
    const n = Math.max(1, strip.cells.length)

    if (strip.orientation === 'vertical') {
      const cellH = Math.max(38, Math.round(sh / n))
      sh = cellH * n
      sw = Math.max(64, sw)
      const stroke = strip.stroke || 'ink'
      const cellFill = strip.cellFill || 'rgba(148, 163, 184, 0.20)'
      const autoLabelSize = clamp(
        strip.labelFontSize ?? Math.round(Math.min(26, cellH * 0.46)),
        14,
        28
      )

      strip.cells.forEach((cellLabel, cIdx) => {
        compiledShapes.push({
          id: `vsp-cell-${now}-${sIdx}-${cIdx}`,
          shape: 'rect',
          x: sx,
          y: sy + cIdx * cellH,
          w: sw,
          h: cellH,
          label: cellLabel.trim(),
          labelSize: autoLabelSize,
          labelBold: true,
          borderRadius: 0,
          color: stroke,
          fillColor: cellFill,
          strokeWidth: 2.5,
          fontFamily,
          vectorGroupId: groupId,
          ...(layerId ? { layerId } : {})
        })
      })

      const ext = Math.max(
        20,
        Math.round(strip.wallExtension ? (strip.wallExtension / 1000) * worldH : cellH * 0.42)
      )
      if (strip.openEnds?.includes('start')) {
        compiledShapes.push(
          {
            id: `vsp-wall-${now}-${sIdx}-tl`,
            shape: 'line',
            x: sx,
            y: sy - ext,
            w: 0,
            h: ext,
            color: stroke,
            strokeWidth: 2.5,
            arrowEnd: false,
            vectorGroupId: groupId,
            ...(layerId ? { layerId } : {})
          },
          {
            id: `vsp-wall-${now}-${sIdx}-tr`,
            shape: 'line',
            x: sx + sw,
            y: sy - ext,
            w: 0,
            h: ext,
            color: stroke,
            strokeWidth: 2.5,
            arrowEnd: false,
            vectorGroupId: groupId,
            ...(layerId ? { layerId } : {})
          }
        )
      }
      if (strip.openEnds?.includes('end')) {
        compiledShapes.push(
          {
            id: `vsp-wall-${now}-${sIdx}-bl`,
            shape: 'line',
            x: sx,
            y: sy + sh,
            w: 0,
            h: ext,
            color: stroke,
            strokeWidth: 2.5,
            arrowEnd: false,
            vectorGroupId: groupId,
            ...(layerId ? { layerId } : {})
          },
          {
            id: `vsp-wall-${now}-${sIdx}-br`,
            shape: 'line',
            x: sx + sw,
            y: sy + sh,
            w: 0,
            h: ext,
            color: stroke,
            strokeWidth: 2.5,
            arrowEnd: false,
            vectorGroupId: groupId,
            ...(layerId ? { layerId } : {})
          }
        )
      }

      obstacles.push({
        id: strip.id,
        x: sx,
        y: strip.openEnds?.includes('start') ? sy - Math.round(ext * 0.4) : sy,
        w: sw,
        h: sh + (strip.openEnds?.includes('start') ? Math.round(ext * 0.4) : 0),
        openEnds: strip.openEnds,
        orientation: 'vertical'
      })
      stripInteriorRects.push({ x: sx, y: sy, w: sw, h: sh })
    } else {
      // Horizontal cell strip (Queues, Arrays, Buffers, Timelines — or Linked List node chains)
      const cellW = Math.max(44, Math.round(sw / n))
      sw = cellW * n
      sh = Math.max(48, sh)
      const stroke = strip.stroke || 'ink'
      const contextStr = `${scene.title || ''} ${strip.id}`
      const isLinkedListStrip =
        !/queue|fifo|stack|lifo|array|buffer|table/i.test(contextStr) &&
        (/linked\s*list|singly|doubly|circular\s*list|\bdll\b|\bsll\b|\bcll\b/i.test(contextStr) ||
          strip.cells.some((c) => /^head$/i.test(c.trim())))

      const wantsGappedChain =
        (typeof strip.cellGap === 'number' && strip.cellGap > 0) ||
        (strip.connectorArrows !== undefined && strip.connectorArrows !== 'none') ||
        (strip.connectorArrows === undefined && isLinkedListStrip)

      if (wantsGappedChain && n >= 2) {
        const nodeGap =
          typeof strip.cellGap === 'number' && strip.cellGap > 0
            ? Math.max(8, Math.round((strip.cellGap / 1000) * worldW))
            : Math.max(42, Math.round(cellW * 0.44))
        const isBidirectional =
          strip.connectorArrows === 'bidirectional' ||
          (!strip.connectorArrows && /doubly|\bdll\b/i.test(contextStr))
        const isCircular =
          strip.connectorArrows === 'circular' ||
          (!strip.connectorArrows && /circular|\bcll\b/i.test(contextStr))
        const hasChainArrows = strip.connectorArrows !== 'none'
        const cellFill = strip.cellFill || '#FEF9C3'
        const autoLabelSize = clamp(
          strip.labelFontSize ?? Math.round(Math.min(20, sh * 0.36)),
          13,
          22
        )

        strip.cells.forEach((cellLabel, cIdx) => {
          const nodeX = sx + cIdx * (cellW + nodeGap)
          compiledShapes.push({
            id: `vsp-cell-${now}-${sIdx}-${cIdx}`,
            shape: 'rounded-rect',
            x: nodeX,
            y: sy,
            w: cellW,
            h: sh,
            label: cellLabel.trim(),
            labelSize: autoLabelSize,
            labelBold: true,
            borderRadius: 8,
            color: stroke,
            fillColor: cellFill,
            strokeWidth: 2.5,
            fontFamily,
            vectorGroupId: groupId,
            ...(layerId ? { layerId } : {})
          })

          if (hasChainArrows && cIdx < n - 1) {
            const nextX = sx + (cIdx + 1) * (cellW + nodeGap)
            const midY = sy + Math.round(sh / 2)
            compiledShapes.push({
              id: `vsp-ll-ptr-${now}-${sIdx}-${cIdx}`,
              shape: isBidirectional ? 'arrow-bidirectional' : 'arrow',
              x: nodeX + cellW + 4,
              y: midY,
              w: Math.max(12, nextX - 4 - (nodeX + cellW + 4)),
              h: 0,
              startBinding: { shapeId: `vsp-cell-${now}-${sIdx}-${cIdx}`, port: 'right' },
              endBinding: { shapeId: `vsp-cell-${now}-${sIdx}-${cIdx + 1}`, port: 'left' },
              color: stroke,
              fillColor: 'transparent',
              strokeWidth: 2.5,
              fontFamily,
              vectorGroupId: groupId,
              ...(layerId ? { layerId } : {})
            })
          }
        })

        if (isCircular) {
          const firstMidX = sx + Math.round(cellW / 2)
          const lastMidX = sx + (n - 1) * (cellW + nodeGap) + Math.round(cellW / 2)
          const botY = sy + sh + 28
          compiledShapes.push({
            id: `vsp-ll-circ-${now}-${sIdx}`,
            shape: 'polyline',
            x: lastMidX,
            y: sy + sh,
            w: firstMidX - lastMidX,
            h: 0,
            points: [
              [lastMidX, sy + sh],
              [lastMidX, botY],
              [firstMidX, botY],
              [firstMidX, sy + sh]
            ],
            arrowStart: false,
            arrowEnd: true,
            routing: 'orthogonal',
            color: stroke,
            fillColor: 'transparent',
            strokeWidth: 2.5,
            fontFamily,
            vectorGroupId: groupId,
            ...(layerId ? { layerId } : {})
          })
        }

        const totalSpannedW = n * cellW + (n - 1) * nodeGap
        obstacles.push({
          id: strip.id,
          x: sx,
          y: sy,
          w: totalSpannedW,
          h: sh,
          openEnds: strip.openEnds,
          orientation: 'horizontal'
        })
        stripInteriorRects.push({ x: sx - 8, y: sy - 6, w: totalSpannedW + 16, h: sh + 12 })
        return
      }

      const cellFill = strip.cellFill || 'rgba(148, 163, 184, 0.20)'
      const autoLabelSize = clamp(
        strip.labelFontSize ?? Math.round(Math.min(26, sh * 0.44)),
        14,
        28
      )

      strip.cells.forEach((cellLabel, cIdx) => {
        compiledShapes.push({
          id: `vsp-cell-${now}-${sIdx}-${cIdx}`,
          shape: 'rect',
          x: sx + cIdx * cellW,
          y: sy,
          w: cellW,
          h: sh,
          label: cellLabel.trim(),
          labelSize: autoLabelSize,
          labelBold: true,
          borderRadius: 0,
          color: stroke,
          fillColor: cellFill,
          strokeWidth: 2.5,
          fontFamily,
          vectorGroupId: groupId,
          ...(layerId ? { layerId } : {})
        })
      })

      const ext = Math.max(
        22,
        Math.round(strip.wallExtension ? (strip.wallExtension / 1000) * worldW : cellW * 0.45)
      )
      if (strip.openEnds?.includes('start')) {
        compiledShapes.push(
          {
            id: `vsp-wall-${now}-${sIdx}-lt`,
            shape: 'line',
            x: sx - ext,
            y: sy,
            w: ext,
            h: 0,
            color: stroke,
            strokeWidth: 2.5,
            arrowEnd: false,
            vectorGroupId: groupId,
            ...(layerId ? { layerId } : {})
          },
          {
            id: `vsp-wall-${now}-${sIdx}-lb`,
            shape: 'line',
            x: sx - ext,
            y: sy + sh,
            w: ext,
            h: 0,
            color: stroke,
            strokeWidth: 2.5,
            arrowEnd: false,
            vectorGroupId: groupId,
            ...(layerId ? { layerId } : {})
          }
        )
      }
      if (strip.openEnds?.includes('end')) {
        compiledShapes.push(
          {
            id: `vsp-wall-${now}-${sIdx}-rt`,
            shape: 'line',
            x: sx + sw,
            y: sy,
            w: ext,
            h: 0,
            color: stroke,
            strokeWidth: 2.5,
            arrowEnd: false,
            vectorGroupId: groupId,
            ...(layerId ? { layerId } : {})
          },
          {
            id: `vsp-wall-${now}-${sIdx}-rb`,
            shape: 'line',
            x: sx + sw,
            y: sy + sh,
            w: ext,
            h: 0,
            color: stroke,
            strokeWidth: 2.5,
            arrowEnd: false,
            vectorGroupId: groupId,
            ...(layerId ? { layerId } : {})
          }
        )
      }

      obstacles.push({
        id: strip.id,
        x: sx,
        y: sy,
        w: sw,
        h: sh,
        openEnds: strip.openEnds,
        orientation: 'horizontal'
      })
      stripInteriorRects.push({ x: sx, y: sy, w: sw, h: sh })
    }
  })

  // 2. Compile Generic Geometric Shapes (including Open-Sided Containers)
  aligned.shapes.forEach((sh, idx) => {
    const wx = toWorldX(sh.x)
    const wy = toWorldY(sh.y)
    const ww = toWorldW(sh.w)
    const wh = toWorldH(sh.h)
    const stroke = sh.stroke || 'ink'
    const open = new Set(sh.openSides ?? [])

    if (sh.kind === 'rect' && open.size > 0 && open.size < 4) {
      if (!open.has('top')) {
        compiledShapes.push({
          id: `vsp-edge-${now}-${idx}-t`,
          shape: 'line',
          x: wx,
          y: wy,
          w: ww,
          h: 0,
          color: stroke,
          strokeWidth: 2.5,
          strokeStyle: sh.dashed ? 'dashed' : 'solid',
          arrowEnd: false,
          vectorGroupId: groupId,
          ...(layerId ? { layerId } : {})
        })
      }
      if (!open.has('bottom')) {
        compiledShapes.push({
          id: `vsp-edge-${now}-${idx}-b`,
          shape: 'line',
          x: wx,
          y: wy + wh,
          w: ww,
          h: 0,
          color: stroke,
          strokeWidth: 2.5,
          strokeStyle: sh.dashed ? 'dashed' : 'solid',
          arrowEnd: false,
          vectorGroupId: groupId,
          ...(layerId ? { layerId } : {})
        })
      }
      if (!open.has('left')) {
        compiledShapes.push({
          id: `vsp-edge-${now}-${idx}-l`,
          shape: 'line',
          x: wx,
          y: wy,
          w: 0,
          h: wh,
          color: stroke,
          strokeWidth: 2.5,
          strokeStyle: sh.dashed ? 'dashed' : 'solid',
          arrowEnd: false,
          vectorGroupId: groupId,
          ...(layerId ? { layerId } : {})
        })
      }
      if (!open.has('right')) {
        compiledShapes.push({
          id: `vsp-edge-${now}-${idx}-r`,
          shape: 'line',
          x: wx + ww,
          y: wy,
          w: 0,
          h: wh,
          color: stroke,
          strokeWidth: 2.5,
          strokeStyle: sh.dashed ? 'dashed' : 'solid',
          arrowEnd: false,
          vectorGroupId: groupId,
          ...(layerId ? { layerId } : {})
        })
      }
      if (sh.label && sh.label.trim()) {
        const fs = 16
        const dims = measure(sh.label.trim(), fs, true)
        compiledTexts.push({
          id: `vsp-shlbl-${groupId}-${idx}`,
          x: Math.round(wx + ww / 2 - dims.w / 2),
          y: Math.round(wy + wh / 2 - dims.h / 2),
          text: sh.label.trim(),
          style: 'body',
          bold: true,
          fontSize: fs,
          color: 'ink',
          bg: 'transparent',
          immersed: true,
          fontFamily,
          align: 'center',
          vectorGroupId: groupId,
          source: 'ocr',
          createdAt: now + idx,
          ...(layerId ? { layerId } : {})
        })
      }
    } else {
      const strokeStyle = sh.strokeStyle ?? (sh.dashed ? 'dashed' : 'solid')
      const createdShape: ShapeNode = {
        id: `vsp-shp-${now}-${idx}`,
        shape: mapKind(sh.kind),
        x: wx,
        y: wy,
        w: ww,
        h: wh,
        ...(sh.label ? { label: sh.label.trim() } : {}),
        ...(sh.labelSize !== undefined ? { labelSize: sh.labelSize } : {}),
        ...(sh.labelColor ? { labelColor: sh.labelColor } : {}),
        ...(sh.borderRadius !== undefined ? { borderRadius: sh.borderRadius } : {}),
        color: stroke,
        fillColor: sh.fill || (sh.dashed ? 'transparent' : '#FEF9C3'),
        ...(sh.fillOpacity !== undefined ? { fillOpacity: sh.fillOpacity } : {}),
        strokeWidth: sh.strokeWidth ?? 2.5,
        strokeStyle,
        ...(sh.rotation !== undefined ? { rotation: sh.rotation } : {}),
        ...(sh.animated !== undefined ? { animated: sh.animated } : {}),
        ...(sh.animationMode ? { animationMode: sh.animationMode } : {}),
        ...(sh.pulseColor ? { pulseColor: sh.pulseColor } : {}),
        ...(sh.flowStage !== undefined ? { flowStage: sh.flowStage } : {}),
        fontFamily,
        vectorGroupId: groupId,
        ...(layerId ? { layerId } : {})
      }
      compiledShapes.push(createdShape)
      shapeNodeBySceneId.set(sh.id, createdShape)
      bindableShapeNodes.push(createdShape)
    }

    obstacles.push({ id: sh.id, x: wx, y: wy, w: ww, h: wh })
  })

  // 2.5 Compile Arbitrary Custom SVG Vector Paths (Organs, Membranes, Orbitals, Energy Barriers, Chemical Structures)
  rawPaths.forEach((p, idx) => {
    const px = toWorldX(p.x ?? 0)
    const py = toWorldY(p.y ?? 0)
    const pw = toWorldW(p.w ?? 1000)
    const ph = toWorldH(p.h ?? 1000)
    const createdPath: ShapeNode = {
      id: `vsp-path-${now}-${idx}`,
      shape: 'svg-path',
      x: px,
      y: py,
      w: pw,
      h: ph,
      svgViewBox: p.viewBox ?? [0, 0, 1000, 1000],
      ...(p.d ? { svgPath: p.d } : {}),
      ...(p.paths && p.paths.length > 0 ? { svgPaths: p.paths } : {}),
      color: p.stroke || 'ink',
      fillColor: p.fill || 'transparent',
      ...(p.fillOpacity !== undefined ? { fillOpacity: p.fillOpacity } : {}),
      strokeWidth: p.strokeWidth ?? 2.5,
      strokeStyle: p.strokeStyle ?? 'solid',
      ...(p.rotation !== undefined ? { rotation: p.rotation } : {}),
      ...(p.label ? { label: p.label.trim() } : {}),
      ...(p.animated !== undefined ? { animated: p.animated } : {}),
      ...(p.animationMode ? { animationMode: p.animationMode } : {}),
      ...(p.pulseColor ? { pulseColor: p.pulseColor } : {}),
      ...(p.flowStage !== undefined ? { flowStage: p.flowStage } : {}),
      fontFamily,
      vectorGroupId: groupId,
      ...(layerId ? { layerId } : {})
    }
    compiledShapes.push(createdPath)
    shapeNodeBySceneId.set(p.id, createdPath)
    if ((p.w ?? 1000) < 750 || (p.h ?? 1000) < 750) {
      obstacles.push({ id: p.id, x: px, y: py, w: pw, h: ph })
    }
  })

  // 3. Compile Connectors (Straight Arrows, Bent Orthogonal Polylines, Curved Splines & Waves)
  rawConnectors.forEach((conn, idx) => {
    let worldPts: Array<[number, number]> = conn.points.map(([px, py]) => [
      toWorldX(px),
      toWorldY(py)
    ])
    if (!conn.curved) {
      worldPts = snapConnectorSegmentAngles(worldPts, 7)
    }

    // Drop rogue internal connectors whose start AND end both lie inside a cell_strip interior
    // (prevents arrows from slashing across cell labels like "Head | Node 1 | Node 2" or "Front | Rear")
    if (worldPts.length >= 2) {
      const pStart = worldPts[0]
      const pEnd = worldPts[worldPts.length - 1]
      const isInsideSingleStrip = stripInteriorRects.some(
        (sr) =>
          pStart[0] >= sr.x - 4 &&
          pStart[0] <= sr.x + sr.w + 4 &&
          pStart[1] >= sr.y + 4 &&
          pStart[1] <= sr.y + sr.h - 4 &&
          pEnd[0] >= sr.x - 4 &&
          pEnd[0] <= sr.x + sr.w + 4 &&
          pEnd[1] >= sr.y + 4 &&
          pEnd[1] <= sr.y + sr.h - 4
      )
      if (isInsideSingleStrip) {
        return
      }
    }

    // Snap first and last points to nearby box anchors if within 22px (or linked by fromId/toId)
    if (worldPts.length >= 2) {
      if (conn.fromId) {
        worldPts[0] = snapEndpointToBoxes(worldPts[0], obstacles, conn.fromId, 34)
      }
      if (conn.toId) {
        worldPts[worldPts.length - 1] = snapEndpointToBoxes(
          worldPts[worldPts.length - 1],
          obstacles,
          conn.toId,
          34
        )
      }
    }

    const stroke = conn.stroke || 'ink'
    const strokeStyle = conn.style ?? 'solid'
    const connSw = conn.strokeWidth ?? 2.5
    const hasEnd = conn.arrowEnd !== false
    const hasStart = Boolean(conn.arrowStart)
    const animProps = {
      ...(conn.animated !== undefined ? { animated: conn.animated } : {}),
      ...(conn.animationMode ? { animationMode: conn.animationMode } : {}),
      ...(conn.pulseColor ? { pulseColor: conn.pulseColor } : {}),
      ...(conn.flowStage !== undefined ? { flowStage: conn.flowStage } : {})
    }

    const resolveBindingForPoint = (
      pt: [number, number],
      preferredId?: string
    ): ShapePortBinding | undefined => {
      if (preferredId && shapeNodeBySceneId.has(preferredId)) {
        const pref = shapeNodeBySceneId.get(preferredId)!
        const picked = pickNearestShapePort(pt, pref)
        if (picked.dist <= 40 || distPointToBox(pt, pref) <= 28) {
          return { shapeId: pref.id, port: picked.port }
        }
      }
      let bestShape: ShapeNode | undefined
      let bestPort: PortSide = 'left'
      let bestBoxDist = 28.001
      for (const cand of bindableShapeNodes) {
        const dBox = distPointToBox(pt, cand)
        if (dBox < bestBoxDist) {
          bestBoxDist = dBox
          bestShape = cand
          bestPort = pickNearestShapePort(pt, cand).port
        }
      }
      return bestShape ? { shapeId: bestShape.id, port: bestPort } : undefined
    }

    if (worldPts.length === 2) {
      const [p0, p1] = worldPts
      const kind: ShapeKind =
        hasStart && hasEnd
          ? 'arrow-bidirectional'
          : hasEnd || hasStart
            ? 'arrow'
            : strokeStyle === 'dashed'
              ? 'dashed-line'
              : 'line'
      const reversed = hasStart && !hasEnd
      const startPt = reversed ? p1 : p0
      const endPt = reversed ? p0 : p1
      const rawStartBind = resolveBindingForPoint(startPt, reversed ? conn.toId : conn.fromId)
      const rawEndBind = resolveBindingForPoint(endPt, reversed ? conn.fromId : conn.toId)
      const avoidSelf =
        rawStartBind && rawEndBind && rawStartBind.shapeId === rawEndBind.shapeId
      compiledShapes.push({
        id: `vsp-conn-${now}-${idx}`,
        shape: kind,
        x: startPt[0],
        y: startPt[1],
        w: endPt[0] - startPt[0],
        h: endPt[1] - startPt[1],
        ...(!avoidSelf && rawStartBind ? { startBinding: rawStartBind } : {}),
        ...(!avoidSelf && rawEndBind ? { endBinding: rawEndBind } : {}),
        color: stroke,
        fillColor: 'transparent',
        strokeWidth: connSw,
        strokeStyle,
        ...animProps,
        ...(conn.label ? { label: conn.label.trim() } : {}),
        fontFamily,
        vectorGroupId: groupId,
        ...(layerId ? { layerId } : {})
      })
    } else if (conn.curved && worldPts.length === 3) {
      const [p0, ctrl, p2] = worldPts
      const rawStartBind = resolveBindingForPoint(p0, conn.fromId)
      const rawEndBind = resolveBindingForPoint(p2, conn.toId)
      const avoidSelf =
        rawStartBind && rawEndBind && rawStartBind.shapeId === rawEndBind.shapeId
      compiledShapes.push({
        id: `vsp-conn-${now}-${idx}`,
        shape: hasEnd || hasStart ? 'curved-arrow' : 'curved-line',
        x: p0[0],
        y: p0[1],
        w: p2[0] - p0[0],
        h: p2[1] - p0[1],
        controlPoint: [ctrl[0], ctrl[1]],
        arrowStart: hasStart,
        arrowEnd: hasEnd,
        ...(!avoidSelf && rawStartBind ? { startBinding: rawStartBind } : {}),
        ...(!avoidSelf && rawEndBind ? { endBinding: rawEndBind } : {}),
        color: stroke,
        fillColor: 'transparent',
        strokeWidth: connSw,
        strokeStyle,
        ...animProps,
        ...(conn.label ? { label: conn.label.trim() } : {}),
        fontFamily,
        vectorGroupId: groupId,
        ...(layerId ? { layerId } : {})
      })
    } else {
      const renderPts =
        conn.curved && worldPts.length >= 4
          ? interpolateCatmullRomSpline(worldPts, 10)
          : worldPts
      const firstPt = renderPts[0]
      const lastPt = renderPts[renderPts.length - 1]
      const rawStartBind = firstPt ? resolveBindingForPoint(firstPt, conn.fromId) : undefined
      const rawEndBind = lastPt ? resolveBindingForPoint(lastPt, conn.toId) : undefined
      const avoidSelf =
        rawStartBind && rawEndBind && rawStartBind.shapeId === rawEndBind.shapeId
      compiledShapes.push({
        id: `vsp-conn-${now}-${idx}`,
        shape: 'polyline',
        x: renderPts[0][0],
        y: renderPts[0][1],
        w: renderPts[renderPts.length - 1][0] - renderPts[0][0],
        h: renderPts[renderPts.length - 1][1] - renderPts[0][1],
        points: renderPts,
        ...(conn.curved ? { routing: 'curved' as const } : {}),
        arrowStart: hasStart,
        arrowEnd: hasEnd,
        ...(!avoidSelf && rawStartBind ? { startBinding: rawStartBind } : {}),
        ...(!avoidSelf && rawEndBind ? { endBinding: rawEndBind } : {}),
        color: stroke,
        fillColor: 'transparent',
        strokeWidth: connSw,
        strokeStyle,
        ...animProps,
        ...(conn.label ? { label: conn.label.trim() } : {}),
        fontFamily,
        vectorGroupId: groupId,
        ...(layerId ? { layerId } : {})
      })
    }
  })

  // Synchronize wave stage totals across animated elements when explicit flowStages are present
  let maxStage = -1
  for (const s of compiledShapes) {
    if (typeof s.flowStage === 'number' && s.flowStage > maxStage) {
      maxStage = s.flowStage
    }
  }
  if (maxStage >= 0) {
    const totalStages = Math.max(2, maxStage + 1)
    for (const s of compiledShapes) {
      if (typeof s.flowStage === 'number') {
        s.flowTotalStages = totalStages
      }
    }
  }

  // 4. Compile Frameless Board-Immersed Texts with Collision Avoidance
  const placedTextRects: TextRect[] = []
  rawTexts.forEach((t, idx) => {
    const cleanText = t.text.trim()
    if (!cleanText) return
    const scaleFactor = clamp(Math.min(worldW, worldH) / 480, 0.85, 1.45)
    const fontSize = clamp(Math.round((t.fontSize ?? 20) * scaleFactor), 15, 34)
    const bold = t.bold !== false
    const dims = measure(cleanText, fontSize, bold)

    const rawX = toWorldX(t.x)
    const rawY = toWorldY(t.y)
    let tx =
      t.align === 'center'
        ? Math.round(rawX - dims.w / 2)
        : t.align === 'right'
          ? Math.round(rawX - dims.w)
          : rawX
    let ty = Math.round(rawY - dims.h / 2)

    // Avoid colliding with solid box walls / cells (nudge along shortest escape vector)
    const pad = 10
    for (const box of obstacles) {
      const candidate: TextRect = { x: tx, y: ty, w: dims.w, h: dims.h }
      if (!rectsOverlap(candidate, box, 4)) continue

      const leftShift = box.x - pad - dims.w - tx
      const rightShift = box.x + box.w + pad - tx
      const upShift = box.y - pad - dims.h - ty
      const downShift = box.y + box.h + pad - ty

      const shifts = [
        { dx: leftShift, dy: 0, cost: Math.abs(leftShift) },
        { dx: rightShift, dy: 0, cost: Math.abs(rightShift) },
        { dx: 0, dy: upShift, cost: Math.abs(upShift) },
        { dx: 0, dy: downShift, cost: Math.abs(downShift) }
      ].sort((a, b) => a.cost - b.cost)

      if (shifts[0].cost <= 110) {
        tx += Math.round(shifts[0].dx)
        ty += Math.round(shifts[0].dy)
      }
    }

    // Avoid overlapping previously placed text labels
    for (const prev of placedTextRects) {
      const cur: TextRect = { x: tx, y: ty, w: dims.w, h: dims.h }
      if (rectsOverlap(cur, prev, 4)) {
        ty = Math.round(prev.y + prev.h + 8)
      }
    }

    placedTextRects.push({ x: tx, y: ty, w: dims.w, h: dims.h })

    compiledTexts.push({
      id: `vsp-txt-${groupId}-${idx}`,
      x: tx,
      y: ty,
      text: cleanText,
      style: fontSize >= 26 ? 'h2' : 'body',
      bold,
      fontSize,
      color: t.color || 'ink',
      bg: 'transparent',
      immersed: true,
      fontFamily,
      align: t.align ?? 'left',
      vectorGroupId: groupId,
      source: 'ocr',
      createdAt: now + idx + 20,
      ...(layerId ? { layerId } : {})
    })
  })

  // Compute compiled world bounds
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const s of compiledShapes) {
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
    }
  }
  for (let i = 0; i < compiledTexts.length; i++) {
    const t = compiledTexts[i]
    const dims = measure(t.text, t.fontSize, Boolean(t.bold))
    minX = Math.min(minX, t.x)
    minY = Math.min(minY, t.y)
    maxX = Math.max(maxX, t.x + dims.w)
    maxY = Math.max(maxY, t.y + dims.h)
  }

  return {
    shapes: compiledShapes,
    texts: compiledTexts,
    groupId,
    bounds: Number.isFinite(minX)
      ? {
          x: Math.round(minX),
          y: Math.round(minY),
          width: Math.max(40, Math.round(maxX - minX)),
          height: Math.max(40, Math.round(maxY - minY))
        }
      : { x: originX, y: originY, width: worldW, height: worldH }
  }
}
