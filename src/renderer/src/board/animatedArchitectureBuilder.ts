import type { FontId, ShapeNode, TextNode } from '../types/board'

export const STAGE_PULSE_PALETTE = [
  '#3B82F6', // Stage 0/1: Electric Blue
  '#6366F1', // Stage 2: Indigo Purple
  '#8B5CF6', // Stage 3: Vivid Violet
  '#F97316', // Stage 4: Routed Orange
  '#10B981', // Stage 5: Emerald Green
  '#06B6D4'  // Stage 6: Cyan
] as const

export interface PathSamplePoint {
  x: number
  y: number
  angle: number
  totalLength: number
}

/**
 * Computes the exact world (x, y) coordinate and tangent angle at normalized
 * arc-length progress `t in [0, 1]` along a multi-segment polyline.
 */
export function computePointAlongPolyline(
  pts: Array<[number, number]>,
  t: number
): PathSamplePoint {
  if (pts.length === 0) return { x: 0, y: 0, angle: 0, totalLength: 0 }
  if (pts.length === 1) return { x: pts[0][0], y: pts[0][1], angle: 0, totalLength: 0 }

  const clampedT = Math.max(0, Math.min(1, t))
  const segLengths: number[] = []
  let totalLength = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const len = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
    segLengths.push(len)
    totalLength += len
  }

  if (totalLength <= 0.001) {
    return { x: pts[0][0], y: pts[0][1], angle: 0, totalLength: 0 }
  }

  const targetDist = clampedT * totalLength
  let acc = 0
  for (let i = 0; i < segLengths.length; i++) {
    const segLen = segLengths[i]
    if (acc + segLen >= targetDist || i === segLengths.length - 1) {
      const localT = segLen > 0.0001 ? Math.max(0, Math.min(1, (targetDist - acc) / segLen)) : 0
      const p0 = pts[i]
      const p1 = pts[i + 1]
      const dx = p1[0] - p0[0]
      const dy = p1[1] - p0[1]
      return {
        x: p0[0] + dx * localT,
        y: p0[1] + dy * localT,
        angle: Math.atan2(dy, dx),
        totalLength
      }
    }
    acc += segLen
  }

  const last = pts[pts.length - 1]
  const prev = pts[pts.length - 2]
  return {
    x: last[0],
    y: last[1],
    angle: Math.atan2(last[1] - prev[1], last[0] - prev[0]),
    totalLength
  }
}

/**
 * Evaluates a quadratic Bézier curve `(p0, ctrl, p2)` at `t in [0, 1]`.
 */
export function computePointAlongQuadraticCurve(
  p0: [number, number],
  ctrl: [number, number],
  p2: [number, number],
  t: number
): { x: number; y: number; angle: number } {
  const u = Math.max(0, Math.min(1, t))
  const inv = 1 - u
  const x = inv * inv * p0[0] + 2 * inv * u * ctrl[0] + u * u * p2[0]
  const y = inv * inv * p0[1] + 2 * inv * u * ctrl[1] + u * u * p2[1]
  const dx = 2 * inv * (ctrl[0] - p0[0]) + 2 * u * (p2[0] - ctrl[0])
  const dy = 2 * inv * (ctrl[1] - p0[1]) + 2 * u * (p2[1] - ctrl[1])
  return { x, y, angle: Math.atan2(dy, dx) }
}

/**
 * Computes whether a stage-synchronized connector/node is currently active
 * in the global wave cycle and its normalized progress `progress in [0, 1]`.
 */
export function computePulseWaveState(
  animTimeMs: number,
  flowStage?: number,
  flowTotalStages?: number,
  stageDurationMs = 920
): { active: boolean; progress: number } {
  if (
    typeof flowStage === 'number' &&
    typeof flowTotalStages === 'number' &&
    flowTotalStages > 1
  ) {
    const totalCycleMs = Math.max(1, flowTotalStages) * stageDurationMs
    const cyclePos = ((animTimeMs % totalCycleMs) + totalCycleMs) % totalCycleMs
    const stageFloat = cyclePos / stageDurationMs
    const currentStage = Math.floor(stageFloat)
    return {
      active: currentStage === flowStage,
      progress: stageFloat - currentStage
    }
  }
  const period = 1350
  const progress = (((animTimeMs % period) + period) % period) / period
  return { active: true, progress }
}

function isConnector(s: ShapeNode): boolean {
  if (s.startBinding || s.endBinding) return true
  if (s.shape.startsWith('anim-line-')) return true
  return (
    s.shape === 'line' ||
    s.shape === 'dashed-line' ||
    s.shape === 'arrow' ||
    s.shape === 'arrow-bidirectional' ||
    s.shape === 'elbow' ||
    s.shape === 'curved-line' ||
    s.shape === 'curved-arrow' ||
    s.shape === 'polyline'
  )
}

function getBoxBounds(s: ShapeNode): { minX: number; minY: number; maxX: number; maxY: number } {
  if (s.points && s.points.length >= 2) {
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
    return { minX, minY, maxX, maxY }
  }
  return {
    minX: Math.min(s.x, s.x + s.w),
    minY: Math.min(s.y, s.y + s.h),
    maxX: Math.max(s.x, s.x + s.w),
    maxY: Math.max(s.y, s.y + s.h)
  }
}

function distToBox(px: number, py: number, b: { minX: number; minY: number; maxX: number; maxY: number }): number {
  const cx = Math.max(b.minX, Math.min(px, b.maxX))
  const cy = Math.max(b.minY, Math.min(py, b.maxY))
  return Math.hypot(px - cx, py - cy)
}

/**
 * Automatically assigns topological wave stages (`flowStage`, `flowTotalStages`, `pulseColor`,
 * `animated: true`, `animationMode: 'pulse'`) across a connected diagram of board shapes
 * so signal packets propagate sequentially from inputs through intermediate blocks to outputs.
 */
export function assignTopologicalFlowStages(
  allShapes: ShapeNode[],
  targetIds?: string[]
): ShapeNode[] {
  const idSet = targetIds && targetIds.length > 0 ? new Set(targetIds) : null
  const scopeShapes = idSet ? allShapes.filter((s) => idSet.has(s.id)) : allShapes
  const nodes = scopeShapes.filter((s) => !isConnector(s))
  const scopeNodeIds = new Set(nodes.map((n) => n.id))

  // Include any connector in scope OR binding two nodes in scope
  const connectors = allShapes.filter((s) => {
    if (!isConnector(s)) return false
    if (idSet && idSet.has(s.id)) return true
    if (
      s.startBinding &&
      s.endBinding &&
      scopeNodeIds.has(s.startBinding.shapeId) &&
      scopeNodeIds.has(s.endBinding.shapeId)
    ) {
      return true
    }
    return false
  })

  if (connectors.length === 0) {
    return allShapes.map((s) =>
      !idSet || idSet.has(s.id)
        ? { ...s, animated: true, animationMode: 'pulse' }
        : s
    )
  }

  const nodeBounds = new Map<string, { minX: number; minY: number; maxX: number; maxY: number }>()
  for (const n of nodes) {
    // Skip huge background container frames when matching spatial endpoints
    if (Math.abs(n.w) > 360 && Math.abs(n.h) > 360) continue
    nodeBounds.set(n.id, getBoxBounds(n))
  }

  const findNearestNodeId = (pt: [number, number], excludeId?: string): string | undefined => {
    let bestId: string | undefined
    let bestD = 36
    for (const [nid, b] of nodeBounds.entries()) {
      if (nid === excludeId) continue
      const d = distToBox(pt[0], pt[1], b)
      if (d < bestD) {
        bestD = d
        bestId = nid
      }
    }
    return bestId
  }

  const edgeEndpoints = new Map<string, { src?: string; tgt?: string }>()
  const outgoing = new Map<string, string[]>()
  const inDegree = new Map<string, number>()
  for (const n of nodes) {
    outgoing.set(n.id, [])
    inDegree.set(n.id, 0)
  }

  for (const c of connectors) {
    const startPt: [number, number] =
      c.points && c.points.length >= 2 ? c.points[0] : [c.x, c.y]
    const endPt: [number, number] =
      c.points && c.points.length >= 2
        ? c.points[c.points.length - 1]
        : [c.x + c.w, c.y + c.h]

    const src = c.startBinding?.shapeId ?? findNearestNodeId(startPt)
    const tgt = c.endBinding?.shapeId ?? findNearestNodeId(endPt, src)
    edgeEndpoints.set(c.id, { src, tgt })

    if (src && tgt && src !== tgt && outgoing.has(src) && inDegree.has(tgt)) {
      outgoing.get(src)!.push(tgt)
      inDegree.set(tgt, (inDegree.get(tgt) ?? 0) + 1)
    }
  }

  // Topological BFS level assignment
  const nodeStage = new Map<string, number>()
  const queue: string[] = []
  for (const [nid, deg] of inDegree.entries()) {
    if (deg === 0) {
      nodeStage.set(nid, 0)
      queue.push(nid)
    }
  }
  if (queue.length === 0 && nodes.length > 0) {
    nodeStage.set(nodes[0].id, 0)
    queue.push(nodes[0].id)
  }

  const maxDepth = Math.max(8, nodes.length + 2)
  while (queue.length > 0) {
    const curr = queue.shift()!
    const currStage = nodeStage.get(curr) ?? 0
    if (currStage >= maxDepth) continue
    for (const nxt of outgoing.get(curr) ?? []) {
      const nextStage = currStage + 1
      if (!nodeStage.has(nxt) || (nodeStage.get(nxt)! < nextStage && nextStage <= maxDepth)) {
        nodeStage.set(nxt, nextStage)
        queue.push(nxt)
      }
    }
  }

  const connStageMap = new Map<string, number>()
  let maxStage = 0
  connectors.forEach((c, idx) => {
    const ep = edgeEndpoints.get(c.id)
    const stg =
      ep?.src && nodeStage.has(ep.src)
        ? nodeStage.get(ep.src)!
        : ep?.tgt && nodeStage.has(ep.tgt)
          ? Math.max(0, nodeStage.get(ep.tgt)! - 1)
          : idx % 4
    connStageMap.set(c.id, stg)
    if (stg > maxStage) maxStage = stg
  })
  for (const stg of nodeStage.values()) {
    if (stg > maxStage) maxStage = stg
  }

  const totalStages = Math.max(2, maxStage + 1)
  const connIdSet = new Set(connectors.map((c) => c.id))

  return allShapes.map((s) => {
    if (connIdSet.has(s.id)) {
      const stg = connStageMap.get(s.id) ?? 0
      return {
        ...s,
        animated: true,
        animationMode: 'pulse',
        flowStage: stg,
        flowTotalStages: totalStages,
        pulseColor: STAGE_PULSE_PALETTE[stg % STAGE_PULSE_PALETTE.length]
      }
    }
    if (scopeNodeIds.has(s.id) && nodeStage.has(s.id)) {
      const stg = nodeStage.get(s.id)!
      return {
        ...s,
        animated: true,
        flowStage: Math.min(totalStages - 1, stg),
        flowTotalStages: totalStages,
        pulseColor: STAGE_PULSE_PALETTE[stg % STAGE_PULSE_PALETTE.length]
      }
    }
    return s
  })
}

/**
 * Builds the complete, stage-synchronized "Transformer vs. Mixture of Experts" animated
 * architecture diagram on the board (matching the reference video with traveling signal packets,
 * residual skip-connection bypasses, dense FFN neural network vs. MoE Router + 4 Experts).
 */
export function buildTransformerVsMoEAnimatedDiagram(
  origin: { x: number; y: number },
  fontFamily: FontId = 'jakarta',
  layerId = 'layer-base-ink'
): {
  shapes: ShapeNode[]
  texts: TextNode[]
  groupId: string
  bounds: { x: number; y: number; width: number; height: number }
} {
  const now = Date.now()
  const groupId = `varch-${now.toString(36)}`
  const shapes: ShapeNode[] = []
  const texts: TextNode[] = []
  const totalStages = 6

  let seq = 0
  const nextId = (prefix: string): string => `${prefix}-${now.toString(36)}-${++seq}`

  const addShape = (partial: Omit<ShapeNode, 'id' | 'fontFamily' | 'layerId' | 'vectorGroupId'>): ShapeNode => {
    const node: ShapeNode = {
      id: nextId('arch'),
      fontFamily,
      layerId,
      vectorGroupId: groupId,
      ...partial
    }
    shapes.push(node)
    return node
  }

  const addText = (partial: {
    x: number
    y: number
    text: string
    fontSize?: number
    bold?: boolean
    color?: string
  }): void => {
    texts.push({
      id: nextId('archtxt'),
      x: Math.round(partial.x),
      y: Math.round(partial.y),
      text: partial.text,
      style: (partial.fontSize ?? 16) >= 20 ? 'h2' : 'body',
      bold: partial.bold !== false,
      fontSize: partial.fontSize ?? 16,
      color: partial.color ?? 'ink',
      bg: 'transparent',
      immersed: true,
      fontFamily,
      align: 'left',
      vectorGroupId: groupId,
      layerId,
      source: 'ai',
      createdAt: now + seq
    })
  }

  const addWire = (
    pts: Array<[number, number]>,
    stage: number,
    pulseColor: string,
    opts?: { arrowEnd?: boolean; dashed?: boolean; animated?: boolean }
  ): void => {
    const isAnim = opts?.animated !== false
    const xs = pts.map((p) => p[0])
    const ys = pts.map((p) => p[1])
    const minX = Math.min(...xs)
    const minY = Math.min(...ys)
    addShape({
      shape: 'polyline',
      x: minX,
      y: minY,
      w: Math.max(4, Math.max(...xs) - minX),
      h: Math.max(4, Math.max(...ys) - minY),
      points: pts,
      routing: 'orthogonal',
      color: opts?.dashed ? '#94A3B8' : 'ink',
      fillColor: 'transparent',
      strokeWidth: opts?.dashed ? 1.8 : 2.4,
      strokeStyle: opts?.dashed ? 'dashed' : 'solid',
      arrowStart: false,
      arrowEnd: opts?.arrowEnd ?? true,
      animated: isAnim,
      animationMode: 'pulse',
      flowStage: stage,
      flowTotalStages: totalStages,
      pulseColor
    })
  }

  // Top comparison header
  addText({
    x: origin.x + 280,
    y: origin.y,
    text: 'Transformer  vs.  Mixture of Experts (Animated Signal Flow)',
    fontSize: 22,
    bold: true
  })

  const buildArchitectureColumn = (colX: number, kind: 'transformer' | 'moe'): void => {
    const colW = 500
    const colY = origin.y + 42
    const colH = 815
    const cx = colX + colW / 2
    const isMoE = kind === 'moe'

    // 1. Outer column frame
    addShape({
      shape: 'rounded-rect',
      x: colX,
      y: colY,
      w: colW,
      h: colH,
      borderRadius: 20,
      color: isMoE ? '#0284C7' : '#16A34A',
      fillColor: isMoE ? '#F0F9FF' : '#F0FDF4',
      fillOpacity: 0.45,
      strokeWidth: 2.5
    })

    // Column Header Pill
    addShape({
      shape: 'rounded-rect',
      x: cx - 125,
      y: colY + 14,
      w: 250,
      h: 40,
      borderRadius: 12,
      label: isMoE ? 'Mixture of Experts' : 'Transformer',
      labelSize: 18,
      labelBold: true,
      color: 'ink',
      fillColor: isMoE ? '#BAE6FD' : '#BBF7D0',
      strokeWidth: 2.2
    })

    // Inputs Section
    addText({
      x: cx - 28,
      y: colY + 64,
      text: 'Inputs',
      fontSize: 15,
      bold: true
    })

    const tokOffsets = [-150, -50, 50, 150]
    const inputTokY = colY + 90
    const posEmbedY = colY + 150

    for (const dx of tokOffsets) {
      const tx = cx + dx - 34
      addShape({
        shape: 'ml-token-vector',
        x: tx,
        y: inputTokY,
        w: 68,
        h: 26,
        color: 'ink',
        fillColor: '#FCE7F3',
        strokeWidth: 2
      })
      // Converging wire to Positional embedding (Stage 0: Blue)
      addWire(
        [
          [cx + dx, inputTokY + 26],
          [cx + dx, inputTokY + 42],
          [cx, inputTokY + 42],
          [cx, posEmbedY]
        ],
        0,
        '#3B82F6',
        { arrowEnd: true }
      )
    }

    // Positional embedding pill
    addShape({
      shape: 'rounded-rect',
      x: cx - 105,
      y: posEmbedY,
      w: 210,
      h: 34,
      borderRadius: 9,
      label: 'Positional embedding',
      labelSize: 13,
      labelBold: true,
      color: 'ink',
      fillColor: '#BAE6FD',
      strokeWidth: 2,
      animated: true,
      flowStage: 0,
      flowTotalStages: totalStages,
      pulseColor: '#3B82F6'
    })

    // Decoder Block Dashed Container
    const decX = colX + 26
    const decY = colY + 206
    const decW = colW - 52
    const decH = 492
    addShape({
      shape: 'rounded-rect',
      x: decX,
      y: decY,
      w: decW,
      h: decH,
      borderRadius: 14,
      color: '#D97706',
      fillColor: '#FFFBEB',
      fillOpacity: 0.45,
      strokeWidth: 2,
      strokeStyle: 'dashed'
    })
    addText({
      x: decX + decW - 108,
      y: decY + 12,
      text: 'Decoder block',
      fontSize: 13,
      bold: true
    })

    // Split junction 1
    const split1Y = decY + 22
    const ln1Y = decY + 42
    const attnY = decY + 96
    const add1Y = decY + 152
    const bypassX = decX + 36

    // Wire from Positional Embedding to Split 1 -> Layer Norm 1 (Stage 1: Blue)
    addWire(
      [
        [cx, posEmbedY + 34],
        [cx, ln1Y]
      ],
      1,
      '#3B82F6',
      { arrowEnd: true }
    )

    // Split 1 junction dot
    addShape({
      shape: 'circle',
      x: cx - 4,
      y: split1Y - 4,
      w: 8,
      h: 8,
      color: 'ink',
      fillColor: '#111111',
      strokeWidth: 1.5
    })

    // Residual Skip-Connection Bypass 1 (Stage 1: Blue — synchronized with Self-Attention)
    addWire(
      [
        [cx, split1Y],
        [bypassX, split1Y],
        [bypassX, add1Y + 14],
        [cx - 14, add1Y + 14]
      ],
      1,
      '#3B82F6',
      { arrowEnd: true }
    )

    // Layer norm 1
    addShape({
      shape: 'rounded-rect',
      x: cx - 88,
      y: ln1Y,
      w: 176,
      h: 32,
      borderRadius: 16,
      label: 'Layer norm',
      labelSize: 13,
      labelBold: true,
      color: 'ink',
      fillColor: '#FBCFE8',
      strokeWidth: 2
    })

    addWire(
      [
        [cx, ln1Y + 32],
        [cx, attnY]
      ],
      1,
      '#3B82F6',
      { arrowEnd: true }
    )

    // Masked self-attention
    addShape({
      shape: 'rounded-rect',
      x: cx - 108,
      y: attnY,
      w: 216,
      h: 34,
      borderRadius: 10,
      label: 'Masked self-attention',
      labelSize: 13,
      labelBold: true,
      color: 'ink',
      fillColor: '#FEF08A',
      strokeWidth: 2,
      animated: true,
      flowStage: 1,
      flowTotalStages: totalStages,
      pulseColor: '#3B82F6'
    })

    addWire(
      [
        [cx, attnY + 34],
        [cx, add1Y]
      ],
      1,
      '#3B82F6',
      { arrowEnd: true }
    )

    // Residual Adder 1 (+)
    addShape({
      shape: 'ml-adder',
      x: cx - 14,
      y: add1Y,
      w: 28,
      h: 28,
      color: 'ink',
      fillColor: '#FFFFFF',
      strokeWidth: 2
    })

    // Stage 2: Split 2 -> Layer norm 2 + Residual Bypass 2 (Purple #6366F1)
    const split2Y = add1Y + 42
    const ln2Y = add1Y + 58
    const add2Y = decY + decH - 42

    addShape({
      shape: 'circle',
      x: cx - 4,
      y: split2Y - 4,
      w: 8,
      h: 8,
      color: 'ink',
      fillColor: '#111111',
      strokeWidth: 1.5
    })

    // Residual Skip-Connection Bypass 2 (Stage 2: Purple)
    addWire(
      [
        [cx, split2Y],
        [bypassX, split2Y],
        [bypassX, add2Y + 14],
        [cx - 14, add2Y + 14]
      ],
      2,
      '#6366F1',
      { arrowEnd: true }
    )

    addWire(
      [
        [cx, add1Y + 28],
        [cx, ln2Y]
      ],
      2,
      '#6366F1',
      { arrowEnd: true }
    )

    // Layer norm 2
    addShape({
      shape: 'rounded-rect',
      x: cx - 88,
      y: ln2Y,
      w: 176,
      h: 32,
      borderRadius: 16,
      label: 'Layer norm',
      labelSize: 13,
      labelBold: true,
      color: 'ink',
      fillColor: '#FBCFE8',
      strokeWidth: 2
    })

    if (!isMoE) {
      // Transformer: Dense Feed-Forward Network block
      const ffnY = ln2Y + 52
      const ffnW = 224
      const ffnH = 148
      addWire(
        [
          [cx, ln2Y + 32],
          [cx, ffnY]
        ],
        2,
        '#6366F1',
        { arrowEnd: true }
      )

      addShape({
        shape: 'ml-neural-net',
        x: cx - ffnW / 2,
        y: ffnY,
        w: ffnW,
        h: ffnH,
        color: '#0284C7',
        fillColor: '#E0F2FE',
        strokeWidth: 2,
        animated: true,
        flowStage: 3,
        flowTotalStages: totalStages,
        pulseColor: '#3B82F6'
      })

      addText({
        x: cx + ffnW / 2 + 12,
        y: ffnY + 56,
        text: 'Feed forward',
        fontSize: 12,
        bold: true
      })
      addText({
        x: cx + ffnW / 2 + 12,
        y: ffnY + 74,
        text: 'network',
        fontSize: 12,
        bold: true
      })

      // Stage 4: FFN -> Adder 2
      addWire(
        [
          [cx, ffnY + ffnH],
          [cx, add2Y]
        ],
        4,
        '#3B82F6',
        { arrowEnd: true }
      )
    } else {
      // Mixture of Experts: Router -> 4 Expert FFNs (Sparse Selective Routing!)
      const routerY = ln2Y + 46
      addWire(
        [
          [cx, ln2Y + 32],
          [cx, routerY]
        ],
        2,
        '#6366F1',
        { arrowEnd: true }
      )

      // Router Pill
      addShape({
        shape: 'rounded-rect',
        x: cx - 64,
        y: routerY,
        w: 128,
        h: 30,
        borderRadius: 9,
        label: 'Router',
        labelSize: 13,
        labelBold: true,
        color: 'ink',
        fillColor: '#BAE6FD',
        strokeWidth: 2,
        animated: true,
        flowStage: 2,
        flowTotalStages: totalStages,
        pulseColor: '#6366F1'
      })

      // 4 Expert Mini Neural-Net Blocks (Experts 1 & 3 active, 2 & 4 idle)
      const expW = 78
      const expH = 82
      const expGap = 14
      const totalExpW = 4 * expW + 3 * expGap
      const expStartX = cx - totalExpW / 2 + 16
      const expY = routerY + 54
      const activeExperts = [
        { active: true, color: '#F97316', fill: '#FFEDD5' },
        { active: false, color: '#64748B', fill: '#F1F5F9' },
        { active: true, color: '#10B981', fill: '#D1FAE5' },
        { active: false, color: '#64748B', fill: '#F1F5F9' }
      ]

      activeExperts.forEach((exp, idx) => {
        const ex = expStartX + idx * (expW + expGap)
        const expCenterX = ex + expW / 2

        // Fan-out wire from Router to Expert
        addWire(
          [
            [cx, routerY + 30],
            [cx, routerY + 42],
            [expCenterX, routerY + 42],
            [expCenterX, expY]
          ],
          3,
          exp.color,
          { arrowEnd: true, dashed: !exp.active, animated: exp.active }
        )

        addShape({
          shape: 'ml-neural-net',
          x: ex,
          y: expY,
          w: expW,
          h: expH,
          color: exp.color,
          fillColor: exp.fill,
          strokeWidth: exp.active ? 2.2 : 1.5,
          strokeStyle: exp.active ? 'solid' : 'dashed',
          animated: exp.active,
          flowStage: 3,
          flowTotalStages: totalStages,
          pulseColor: exp.color
        })

        // Fan-in wire from Expert to Adder 2
        addWire(
          [
            [expCenterX, expY + expH],
            [expCenterX, add2Y - 14],
            [cx, add2Y - 14],
            [cx, add2Y]
          ],
          4,
          exp.color,
          { arrowEnd: true, dashed: !exp.active, animated: exp.active }
        )
      })
    }

    // Residual Adder 2 (+)
    addShape({
      shape: 'ml-adder',
      x: cx - 14,
      y: add2Y,
      w: 28,
      h: 28,
      color: 'ink',
      fillColor: '#FFFFFF',
      strokeWidth: 2
    })

    // Stage 5: Decoder block * N -> 4 Output Token Embedding Boxes
    const decNY = decY + decH + 22
    addWire(
      [
        [cx, add2Y + 28],
        [cx, decNY]
      ],
      5,
      '#10B981',
      { arrowEnd: true }
    )

    addShape({
      shape: 'rounded-rect',
      x: cx - 105,
      y: decNY,
      w: 210,
      h: 34,
      borderRadius: 9,
      label: 'Decoder block * N',
      labelSize: 13,
      labelBold: true,
      color: 'ink',
      fillColor: '#FEF08A',
      strokeWidth: 2,
      animated: true,
      flowStage: 5,
      flowTotalStages: totalStages,
      pulseColor: '#10B981'
    })

    const outTokY = decNY + 54
    for (const dx of tokOffsets) {
      const tx = cx + dx - 34
      addWire(
        [
          [cx, decNY + 34],
          [cx, decNY + 44],
          [cx + dx, decNY + 44],
          [cx + dx, outTokY]
        ],
        5,
        '#10B981',
        { arrowEnd: true }
      )
      addShape({
        shape: 'ml-token-vector',
        x: tx,
        y: outTokY,
        w: 68,
        h: 26,
        color: 'ink',
        fillColor: '#FCE7F3',
        strokeWidth: 2
      })
    }
  }

  buildArchitectureColumn(origin.x, 'transformer')
  buildArchitectureColumn(origin.x + 540, 'moe')

  return {
    shapes,
    texts,
    groupId,
    bounds: {
      x: origin.x,
      y: origin.y,
      width: 1040,
      height: 865
    }
  }
}
