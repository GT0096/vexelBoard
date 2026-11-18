import dagre from '@dagrejs/dagre'
import { Position, type Node, type Edge } from '@xyflow/react'

export interface LayoutOptions {
  direction?: 'TB' | 'LR'
  nodeWidth?: number
  nodeHeight?: number
  rankSep?: number
  nodeSep?: number
}

function getNodeBox(node: Node): { x: number; y: number; w: number; h: number; cx: number; cy: number } {
  const data = (node.data ?? {}) as Record<string, unknown>
  const w =
    typeof node.width === 'number' && node.width > 0
      ? node.width
      : typeof data.w === 'number' && data.w > 0
        ? data.w
        : 140
  const h =
    typeof node.height === 'number' && node.height > 0
      ? node.height
      : typeof data.h === 'number' && data.h > 0
        ? data.h
        : 75
  const x = node.position?.x ?? 0
  const y = node.position?.y ?? 0
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 }
}

function isDiamondShape(node: Node): boolean {
  const data = (node.data ?? {}) as Record<string, unknown>
  const raw = String(data.shapeId ?? node.type ?? '').toLowerCase()
  return raw === 'decision' || raw === 'rhombus' || raw === 'fc-decision' || raw.includes('diamond')
}

/**
 * Routes each edge through the handle (top/right/bottom/left) that matches
 * the actual spatial geometry between source and target nodes.
 */
export function assignSmartEdgeHandles(nodes: Node[], edges: Edge[]): Edge[] {
  if (edges.length === 0 || nodes.length === 0) return edges
  const nodeMap = new Map<string, Node>()
  const boxMap = new Map<string, ReturnType<typeof getNodeBox>>()
  for (const n of nodes) {
    nodeMap.set(n.id, n)
    boxMap.set(n.id, getNodeBox(n))
  }

  // Group outgoing edges per source to inspect multi-branch fan-out
  const outgoingDeltas = new Map<string, Array<{ edgeId: string; dx: number; dy: number }>>()
  for (const edge of edges) {
    const srcBox = boxMap.get(edge.source)
    const tgtBox = boxMap.get(edge.target)
    if (!srcBox || !tgtBox) continue
    const list = outgoingDeltas.get(edge.source) ?? []
    list.push({ edgeId: edge.id, dx: tgtBox.cx - srcBox.cx, dy: tgtBox.cy - srcBox.cy })
    outgoingDeltas.set(edge.source, list)
  }

  return edges.map((edge) => {
    const srcNode = nodeMap.get(edge.source)
    const srcBox = boxMap.get(edge.source)
    const tgtBox = boxMap.get(edge.target)
    if (!srcNode || !srcBox || !tgtBox) return edge

    const dx = tgtBox.cx - srcBox.cx
    const dy = tgtBox.cy - srcBox.cy
    const diamond = isDiamondShape(srcNode)
    const branches = outgoingDeltas.get(edge.source) ?? []

    let sourceHandle: string
    let targetHandle: string

    // Multi-branch diamond fan-out (e.g. D branching up-right to F and right to E)
    if (
      diamond &&
      dx > 25 &&
      dy < -25 &&
      branches.some((b) => b.edgeId !== edge.id && b.dx > 25 && b.dy > dy + 25)
    ) {
      sourceHandle = 'out-top'
      targetHandle = 'in-left'
    } else if (
      diamond &&
      dx > 25 &&
      dy > 25 &&
      branches.some((b) => b.edgeId !== edge.id && b.dx > 25 && b.dy < dy - 25) &&
      Math.abs(dy) > Math.abs(dx) * 0.45
    ) {
      sourceHandle = 'out-bottom'
      targetHandle = 'in-left'
    } else if (Math.abs(dx) >= Math.abs(dy) * 0.55) {
      if (dx >= 0) {
        sourceHandle = 'out-right'
        targetHandle = 'in-left'
      } else {
        sourceHandle = 'out-left'
        targetHandle = 'in-right'
      }
    } else if (dy >= 0) {
      sourceHandle = 'out-bottom'
      targetHandle = 'in-top'
    } else {
      sourceHandle = 'out-top'
      targetHandle = 'in-bottom'
    }

    return {
      ...edge,
      sourceHandle,
      targetHandle
    }
  })
}

/**
 * Preserves the user's drawn 2D spatial orientation and relative positions
 * while normalizing padding, snapping near-aligned rows/columns, separating any
 * slight overlaps without swapping orientation, and assigning 4-way edge handles.
 */
export function preserveAndTidySpatialLayout(
  nodes: Node[],
  edges: Edge[],
  targetBounds?: { w?: number; h?: number }
): { nodes: Node[]; edges: Edge[] } {
  if (nodes.length === 0) return { nodes, edges }

  // 1. Scale up tiny normalized coordinate sets (e.g. 0..1 or 0..100 grids) if needed
  const boxes = nodes.map(getNodeBox)
  const rawMinX = Math.min(...boxes.map((b) => b.x))
  const rawMinY = Math.min(...boxes.map((b) => b.y))
  const rawMaxX = Math.max(...boxes.map((b) => b.x))
  const rawMaxY = Math.max(...boxes.map((b) => b.y))
  const spanX = Math.max(1, rawMaxX - rawMinX)
  const spanY = Math.max(1, rawMaxY - rawMinY)

  let scaleX = 1
  let scaleY = 1
  if (nodes.length >= 2 && targetBounds?.w && targetBounds?.h && spanX < 120 && targetBounds.w > 260) {
    scaleX = (targetBounds.w * 0.72) / spanX
    scaleY = spanY < 120 && targetBounds.h > 200 ? (targetBounds.h * 0.72) / spanY : scaleX
  }

  let working = nodes.map((n, idx) => {
    const b = boxes[idx]
    return {
      ...n,
      position: {
        x: Math.round((b.x - rawMinX) * scaleX + 48),
        y: Math.round((b.y - rawMinY) * scaleY + 56)
      }
    }
  })

  // 2. Gentle axis alignment snapping (snap near-aligned columns and rows by center)
  if (working.length >= 2) {
    const snapAxis = (axis: 'x' | 'y', threshold: number): void => {
      const entries = working.map((n, idx) => {
        const b = getNodeBox(n)
        return { idx, center: axis === 'x' ? b.cx : b.cy, size: axis === 'x' ? b.w : b.h }
      })
      entries.sort((a, b) => a.center - b.center)
      const groups: Array<typeof entries> = []
      for (const item of entries) {
        const last = groups[groups.length - 1]
        if (last && Math.abs(item.center - last[last.length - 1].center) <= threshold) {
          last.push(item)
        } else {
          groups.push([item])
        }
      }
      for (const group of groups) {
        if (group.length < 2) continue
        const avgCenter = group.reduce((s, g) => s + g.center, 0) / group.length
        for (const item of group) {
          const cur = working[item.idx]
          working[item.idx] = {
            ...cur,
            position: {
              x: axis === 'x' ? Math.round(avgCenter - item.size / 2) : cur.position.x,
              y: axis === 'y' ? Math.round(avgCenter - item.size / 2) : cur.position.y
            }
          }
        }
      }
    }
    snapAxis('x', 36)
    snapAxis('y', 32)
  }

  // 3. Non-rotating overlap resolution (nudge overlapping boxes along their separation axis)
  const gapX = 42
  const gapY = 28
  for (let pass = 0; pass < 4; pass++) {
    let moved = false
    for (let i = 0; i < working.length; i++) {
      for (let j = i + 1; j < working.length; j++) {
        const a = getNodeBox(working[i])
        const b = getNodeBox(working[j])
        const overlapX = (a.w + b.w) / 2 + gapX - Math.abs(b.cx - a.cx)
        const overlapY = (a.h + b.h) / 2 + gapY - Math.abs(b.cy - a.cy)
        if (overlapX > 0 && overlapY > 0) {
          moved = true
          // Push apart along the axis where nodes already have less overlap (preserves L-R / T-B order)
          if (overlapX <= overlapY) {
            const dir = b.cx >= a.cx ? 1 : -1
            const shift = Math.ceil(overlapX / 2)
            working[i] = {
              ...working[i],
              position: { x: working[i].position.x - dir * shift, y: working[i].position.y }
            }
            working[j] = {
              ...working[j],
              position: { x: working[j].position.x + dir * shift, y: working[j].position.y }
            }
          } else {
            const dir = b.cy >= a.cy ? 1 : -1
            const shift = Math.ceil(overlapY / 2)
            working[i] = {
              ...working[i],
              position: { x: working[i].position.x, y: working[i].position.y - dir * shift }
            }
            working[j] = {
              ...working[j],
              position: { x: working[j].position.x, y: working[j].position.y + dir * shift }
            }
          }
        }
      }
    }
    if (!moved) break
  }

  // 4. Re-normalize top-left padding after nudge
  const finalMinX = Math.min(...working.map((n) => n.position.x))
  const finalMinY = Math.min(...working.map((n) => n.position.y))
  working = working.map((n) => ({
    ...n,
    position: {
      x: Math.round(n.position.x - finalMinX + 48),
      y: Math.round(n.position.y - finalMinY + 56)
    }
  }))

  return {
    nodes: working,
    edges: assignSmartEdgeHandles(working, edges)
  }
}

/**
 * Automatically calculates tidy, collision-free, hierarchical positions for React Flow nodes.
 */
export function layoutReactFlowElements(
  nodes: Node[],
  edges: Edge[],
  opts: LayoutOptions = {}
): { nodes: Node[]; edges: Edge[] } {
  if (nodes.length === 0) return { nodes, edges }

  const direction = opts.direction ?? 'TB'
  const defaultWidth = opts.nodeWidth ?? 200
  const defaultHeight = opts.nodeHeight ?? 75
  const rankSep = opts.rankSep ?? 65
  const nodeSep = opts.nodeSep ?? 45

  const dagreGraph = new dagre.graphlib.Graph()
  dagreGraph.setDefaultEdgeLabel(() => ({}))

  const isHorizontal = direction === 'LR'
  dagreGraph.setGraph({
    rankdir: direction,
    ranksep: rankSep,
    nodesep: nodeSep,
    marginx: 30,
    marginy: 30
  })

  // Add nodes to dagre
  nodes.forEach((node) => {
    const w = (typeof node.width === 'number' ? node.width : defaultWidth) || defaultWidth
    const h = (typeof node.height === 'number' ? node.height : defaultHeight) || defaultHeight
    dagreGraph.setNode(node.id, { width: w, height: h })
  })

  // Add edges to dagre
  edges.forEach((edge) => {
    if (edge.source && edge.target) {
      dagreGraph.setEdge(edge.source, edge.target)
    }
  })

  dagre.layout(dagreGraph)

  const newNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id)
    if (!nodeWithPosition) return node

    const w = (typeof node.width === 'number' ? node.width : defaultWidth) || defaultWidth
    const h = (typeof node.height === 'number' ? node.height : defaultHeight) || defaultHeight

    // Dagre returns center coordinates, React Flow expects top-left coordinates
    const x = Math.round(nodeWithPosition.x - w / 2)
    const y = Math.round(nodeWithPosition.y - h / 2)

    return {
      ...node,
      targetPosition: isHorizontal ? Position.Left : Position.Top,
      sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
      position: { x, y }
    }
  })

  return { nodes: newNodes, edges: assignSmartEdgeHandles(newNodes, edges) }
}
