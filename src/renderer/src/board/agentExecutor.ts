import type { AgentBoardMutation, AgentBoardSnapshot } from '@shared/agentSchema'
import { normalizeScene3DInput } from '@shared/scene3dSchema'
import type {
  BoardState,
  CanvasTransform,
  CodeNode,
  EquationNode,
  FontId,
  GraphNode,
  Scene3DNode,
  ShapeNode,
  TextNode,
  VideoNode
} from '../types/board'
import { parseAndCleanReactFlow, type CleanReactFlowResult } from './beautifyUtils'
import {
  buildFlowConnectorNode,
  isConnectorShape,
  recomputeConnectorGeometry,
  type ConnectableBoardElement
} from './connectorUtils'
import { compileFlowDiagramToBoardElements } from './nativeDiagramCompiler'
import { ensureBoardLayers, LAYER_OVERLAY_INK_ID, resolveTargetInkLayerId } from './layerUtils'
import {
  collectOccupiedBoardRects,
  findEmptyBoardRect,
  getSafeViewportScreenRect,
  planEmptyClusterLayout,
  rectsOverlap,
  type BoxRect,
  type ScreenSafeRect
} from './placementUtils'
import { compileSpatialScene } from './spatialSceneCompiler'
import { measureBoardText } from './vectorizeUtils'
import { unescapeLlmCode, unescapeLlmText } from '@shared/textUnescape'
import { mergeCodeVisualIntoGraphSpec, parseCodeOutputToVisuals } from './codeVisualParser'
import {
  GRAPH_PRESETS,
  is3DGraphChartType,
  resolveGraphChartType,
  type GraphChartType,
  type GraphPlotSpec
} from './graphPlotBuilder'

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

function getShapeWorldRect(s: ShapeNode): BoxRect {
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
      return {
        x: Math.round(minX),
        y: Math.round(minY),
        w: Math.max(8, Math.round(maxX - minX)),
        h: Math.max(8, Math.round(maxY - minY))
      }
    }
  }
  const minX = Math.min(s.x, s.x + s.w)
  const minY = Math.min(s.y, s.y + s.h)
  const maxX = Math.max(s.x, s.x + s.w)
  const maxY = Math.max(s.y, s.y + s.h)
  return {
    x: Math.round(minX),
    y: Math.round(minY),
    w: Math.max(8, Math.round(maxX - minX)),
    h: Math.max(8, Math.round(maxY - minY))
  }
}

function getTextWorldRect(t: TextNode): BoxRect {
  if (typeof t.w === 'number' && typeof t.h === 'number') {
    return { x: Math.round(t.x), y: Math.round(t.y), w: Math.round(t.w), h: Math.round(t.h) }
  }
  if (t.immersed) {
    const measured = measureBoardText(t.text || ' ', t.fontSize || 20, Boolean(t.bold), t.fontFamily || 'jakarta')
    return {
      x: Math.round(t.x),
      y: Math.round(t.y),
      w: Math.round(t.w ?? measured.w),
      h: Math.round(t.h ?? measured.h)
    }
  }
  return {
    x: Math.round(t.x),
    y: Math.round(t.y),
    w: Math.round(t.w ?? 340),
    h: Math.round(t.h ?? 220)
  }
}

function computeBoundsFromRects(rects: BoxRect[]): BoxRect | undefined {
  if (rects.length === 0) return undefined
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const r of rects) {
    minX = Math.min(minX, r.x)
    minY = Math.min(minY, r.y)
    maxX = Math.max(maxX, r.x + r.w)
    maxY = Math.max(maxY, r.y + r.h)
  }
  if (!Number.isFinite(minX)) return undefined
  return {
    x: Math.round(minX),
    y: Math.round(minY),
    w: Math.max(1, Math.round(maxX - minX)),
    h: Math.max(1, Math.round(maxY - minY))
  }
}

export function buildAgentBoardSnapshot(args: {
  board: BoardState
  boardId: string
  projectId?: string
  selectedIds: string[]
  selectionBounds?: { x: number; y: number; width: number; height: number }
  viewportCenter: { x: number; y: number }
  knowledgeSourceCount?: number
  suggestedEmptyArea?: { x: number; y: number; width: number; height: number }
  imageBase64?: string
}): AgentBoardSnapshot {
  const {
    board,
    boardId,
    projectId,
    selectedIds,
    selectionBounds,
    viewportCenter,
    knowledgeSourceCount,
    suggestedEmptyArea,
    imageBase64
  } = args
  const { layers, activeLayerId } = ensureBoardLayers(board)

  const groupMembers = new Map<string, { shapes: ShapeNode[]; texts: TextNode[] }>()
  for (const s of board.shapeNodes) {
    if (!s.vectorGroupId) continue
    let entry = groupMembers.get(s.vectorGroupId)
    if (!entry) {
      entry = { shapes: [], texts: [] }
      groupMembers.set(s.vectorGroupId, entry)
    }
    entry.shapes.push(s)
  }
  for (const t of board.textNodes) {
    if (!t.vectorGroupId) continue
    let entry = groupMembers.get(t.vectorGroupId)
    if (!entry) {
      entry = { shapes: [], texts: [] }
      groupMembers.set(t.vectorGroupId, entry)
    }
    entry.texts.push(t)
  }
  for (const gid of Object.keys(board.vectorDiagramMeta ?? {})) {
    if (!groupMembers.has(gid)) {
      groupMembers.set(gid, { shapes: [], texts: [] })
    }
  }

  const vectorGroups: NonNullable<AgentBoardSnapshot['vectorGroups']> = []
  for (const [gid, members] of groupMembers.entries()) {
    if (members.shapes.length === 0 && members.texts.length === 0) continue
    const rects: BoxRect[] = [
      ...members.shapes.map(getShapeWorldRect),
      ...members.texts.map(getTextWorldRect)
    ]
    const bounds = computeBoundsFromRects(rects)
    if (!bounds) continue
    const meta = board.vectorDiagramMeta?.[gid]
    const kind: 'spatial_scene' | 'diagram' | 'vector_group' =
      meta?.spatialScene || gid.startsWith('vspatial-')
        ? 'spatial_scene'
        : meta?.graph || gid.startsWith('vdiag-') || gid.startsWith('vflow-')
          ? 'diagram'
          : 'vector_group'
    const titleNode =
      members.texts.find((t) => t.id.startsWith('vtitle-') || t.style === 'h2') ??
      members.texts[0]
    const title =
      meta?.spatialScene?.title ||
      meta?.graph?.title ||
      titleNode?.text?.trim().slice(0, 80) ||
      (kind === 'spatial_scene' ? 'Vector Scene' : kind === 'diagram' ? 'Diagram' : 'Vector Group')
    const memberIds = [
      ...members.shapes.map((s) => s.id),
      ...members.texts.map((t) => t.id)
    ]
    vectorGroups.push({
      id: gid,
      title,
      kind,
      elementCount: members.shapes.length + members.texts.length,
      memberIds,
      x: bounds.x,
      y: bounds.y,
      w: bounds.w,
      h: bounds.h
    })
  }
  vectorGroups.sort((a, b) => a.y - b.y || a.x - b.x)

  const reactFlowDiagrams = board.diagramNodes.map((d) => ({
    id: d.id,
    title: d.title || 'Diagram',
    diagramType: 'reactflow',
    nodeCount: d.nodes.length,
    edgeCount: d.edges.length,
    x: Math.round(d.x),
    y: Math.round(d.y),
    w: Math.round(d.w),
    h: Math.round(d.h)
  }))

  const compiledDiagrams = vectorGroups
    .filter((g) => g.kind === 'spatial_scene' || g.kind === 'diagram')
    .map((g) => {
      const meta = board.vectorDiagramMeta?.[g.id]
      const members = groupMembers.get(g.id)
      const nonConnCount =
        members?.shapes.filter((s) => !isConnectorShape(s)).length ?? 0
      const connCount =
        members?.shapes.filter((s) => isConnectorShape(s)).length ?? 0
      return {
        id: g.id,
        title: g.title,
        diagramType: g.kind === 'spatial_scene' ? 'spatial_scene' : 'native_diagram',
        nodeCount: meta?.graph?.nodes?.length ?? nonConnCount,
        edgeCount: meta?.graph?.edges?.length ?? connCount,
        elementCount: g.elementCount,
        memberIds: g.memberIds,
        x: g.x,
        y: g.y,
        w: g.w,
        h: g.h
      }
    })

  const diagrams = [...reactFlowDiagrams, ...compiledDiagrams]
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .slice(0, 40)

  const shapeGroupById = new Map<string, string>()
  for (const s of board.shapeNodes) {
    if (s.vectorGroupId) shapeGroupById.set(s.id, s.vectorGroupId)
  }

  const connectors = board.shapeNodes
    .filter((s) => {
      if (!isConnectorShape(s)) return false
      if (!s.vectorGroupId) return true
      const srcG = s.startBinding ? shapeGroupById.get(s.startBinding.shapeId) : undefined
      const tgtG = s.endBinding ? shapeGroupById.get(s.endBinding.shapeId) : undefined
      return Boolean(s.startBinding && s.endBinding && srcG !== tgtG)
    })
    .slice(0, 60)
    .map((s) => {
      const r = getShapeWorldRect(s)
      return {
        id: s.id,
        ...(s.startBinding?.shapeId ? { sourceId: s.startBinding.shapeId } : {}),
        ...(s.endBinding?.shapeId ? { targetId: s.endBinding.shapeId } : {}),
        ...(s.startBinding?.port ? { sourcePort: s.startBinding.port } : {}),
        ...(s.endBinding?.port ? { targetPort: s.endBinding.port } : {}),
        ...(s.label ? { label: s.label } : {}),
        ...(s.routing ? { routing: s.routing } : {}),
        x: r.x,
        y: r.y,
        w: r.w,
        h: r.h
      }
    })

  const shapes = board.shapeNodes
    .filter((s) => !s.vectorGroupId && !isConnectorShape(s))
    .slice(0, 60)
    .map((s) => {
      const r = getShapeWorldRect(s)
      return {
        id: s.id,
        shape: s.shape,
        ...(s.label ? { label: s.label } : {}),
        x: r.x,
        y: r.y,
        w: r.w,
        h: r.h
      }
    })

  const images = (board.imageNodes ?? []).slice(0, 30).map((img) => ({
    id: img.id,
    ...(img.caption ? { caption: img.caption } : {}),
    x: Math.round(img.x),
    y: Math.round(img.y),
    w: Math.round(img.w ?? 360),
    h: Math.round(img.h ?? 260)
  }))

  const vectorArts = (board.vectorArtNodes ?? []).slice(0, 30).map((va) => ({
    id: va.id,
    x: Math.round(va.x),
    y: Math.round(va.y),
    w: Math.round(va.width),
    h: Math.round(va.height)
  }))

  const immersedTexts = board.textNodes
    .filter((t) => t.immersed && !t.vectorGroupId)
    .slice(0, 60)
    .map((t) => {
      const r = getTextWorldRect(t)
      return {
        id: t.id,
        textPreview: t.text.slice(0, 160),
        x: r.x,
        y: r.y,
        w: r.w,
        h: r.h
      }
    })

  const boardBounds = computeBoundsFromRects(collectOccupiedBoardRects(board))

  return {
    boardId,
    projectId,
    activeLayerId,
    knowledgeSourceCount: knowledgeSourceCount ?? 0,
    suggestedEmptyArea,
    boardBounds,
    layers: layers.map((l, idx) => ({
      id: l.id,
      name: l.name,
      kind: l.kind,
      visible: l.visible,
      locked: l.locked,
      opacity: l.opacity,
      order: idx
    })),
    selectedIds,
    selectionBounds,
    viewportCenter: {
      x: Math.round(viewportCenter.x),
      y: Math.round(viewportCenter.y)
    },
    strokesCount: board.strokes.length,
    notes: board.textNodes
      .filter((t) => !t.immersed)
      .slice(0, 60)
      .map((t) => ({
        id: t.id,
        title: t.title,
        contentPreview: t.text.slice(0, 240),
        x: Math.round(t.x),
        y: Math.round(t.y),
        w: Math.round(t.w ?? 260),
        h: Math.round(t.h ?? 160)
      })),
    diagrams,
    vectorGroups: vectorGroups.slice(0, 40),
    connectors,
    shapes,
    images,
    vectorArts,
    immersedTexts,
    codeCards: (board.codeNodes ?? []).slice(0, 30).map((c) => {
      const tab = c.tabs.find((t) => t.id === c.activeTabId) ?? c.tabs[0]
      return {
        id: c.id,
        title: c.title || tab?.title || 'Code Card',
        activeLanguage: tab?.language || 'python',
        codePreview: (tab?.code || '').slice(0, 900),
        lastError: tab?.output?.stderr || tab?.output?.error || undefined,
        lastOutput: tab?.output?.stdout?.slice(0, 300) || undefined,
        x: Math.round(c.x),
        y: Math.round(c.y),
        w: Math.round(c.w),
        h: Math.round(c.h)
      }
    }),
    equations: board.equationNodes.slice(0, 40).map((eq) => ({
      id: eq.id,
      latex: eq.latex,
      x: Math.round(eq.x),
      y: Math.round(eq.y),
      w: Math.round(eq.w ?? 220),
      h: Math.round(eq.h ?? 80)
    })),
    videos: (board.videoNodes ?? []).slice(0, 20).map((v) => ({
      id: v.id,
      title: v.title || 'YouTube Video',
      url: v.url,
      x: Math.round(v.x),
      y: Math.round(v.y)
    })),
    scenes3d: (board.scene3dNodes ?? []).slice(0, 20).map((s) => ({
      id: s.id,
      title: s.title || s.spec?.title || '3D Scene',
      preset: s.spec?.preset,
      elementCount: s.spec?.elements?.length ?? 0,
      x: Math.round(s.x),
      y: Math.round(s.y),
      w: Math.round(s.w),
      h: Math.round(s.h)
    })),
    graphs: (board.graphNodes ?? []).slice(0, 30).map((g) => ({
      id: g.id,
      title: g.title || g.spec?.title || 'Graph',
      chartType: resolveGraphChartType(g.spec),
      ...(g.linkedCodeNodeId ? { linkedCodeNodeId: g.linkedCodeNodeId } : {}),
      x: Math.round(g.x),
      y: Math.round(g.y),
      w: Math.round(g.w),
      h: Math.round(g.h)
    })),
    imageBase64
  }
}

interface PreparedCreation {
  key: string
  mutationIndex: number
  w: number
  h: number
  topMargin?: number
  explicitX?: number
  explicitY?: number
}

export function applyAgentMutationsToBoard(
  board: BoardState,
  mutations: AgentBoardMutation[],
  opts: {
    viewportCenter: { x: number; y: number }
    view?: CanvasTransform
    screenSafe?: ScreenSafeRect
    selectionBounds?: { x: number; y: number; width: number; height: number }
    fontFamily: FontId
    defaultInkColor?: string
    honorExplicitCoords?: boolean
  }
): {
  nextBoard: BoardState
  createdIds: string[]
  deletedIds: string[]
  appliedCount: number
  nextPan?: { panX: number; panY: number }
  createdBounds?: BoxRect
} {
  if (mutations.length === 0) {
    return { nextBoard: board, createdIds: [], deletedIds: [], appliedCount: 0 }
  }

  // Apply deletions before measuring occupied rects so replacement diagrams/scenes can land at selectionBounds
  const deletedIdSet = new Set<string>()
  for (const m of mutations) {
    if (m.type === 'delete_elements') {
      for (const id of m.elementIds) {
        if (id) deletedIdSet.add(id)
      }
    }
  }

  const deletedIds: string[] = []
  const filterDeleted = <T extends { id: string; vectorGroupId?: string }>(items: T[]): T[] => {
    if (deletedIdSet.size === 0) return [...items]
    const kept: T[] = []
    for (const item of items) {
      if (deletedIdSet.has(item.id) || (item.vectorGroupId && deletedIdSet.has(item.vectorGroupId))) {
        deletedIds.push(item.id)
      } else {
        kept.push(item)
      }
    }
    return kept
  }

  const ensured = ensureBoardLayers(board)
  let nextLayers = ensured.layers.map((l) => ({ ...l }))
  const nextActiveLayerId = ensured.activeLayerId
  const nextStrokes = filterDeleted(board.strokes)
  let nextTextNodes = filterDeleted(board.textNodes)
  let nextEquationNodes = filterDeleted(board.equationNodes)
  let nextShapeNodes = filterDeleted(board.shapeNodes)
  let nextDiagramNodes = filterDeleted(board.diagramNodes)
  let nextVectorArtNodes = filterDeleted(board.vectorArtNodes ?? [])
  const nextVectorDiagramMeta = { ...(board.vectorDiagramMeta ?? {}) }
  for (const gid of Object.keys(nextVectorDiagramMeta)) {
    const stillHasMember =
      nextShapeNodes.some((s) => s.vectorGroupId === gid) ||
      nextTextNodes.some((t) => t.vectorGroupId === gid)
    if (deletedIdSet.has(gid) || !stillHasMember) {
      delete nextVectorDiagramMeta[gid]
    }
  }
  let nextCodeNodes = filterDeleted(board.codeNodes ?? [])
  let nextVideoNodes = filterDeleted(board.videoNodes ?? [])
  let nextImageNodes = filterDeleted(board.imageNodes ?? [])
  let nextScene3dNodes = filterDeleted(board.scene3dNodes ?? [])
  let nextGraphNodes: GraphNode[] = filterDeleted(board.graphNodes ?? [])

  // Apply move_elements before measuring occupied rects so new items in the same batch see moved positions
  const movedSingleIds = new Set<string>()
  const rigidlyMovedGroups = new Set<string>()
  let movedCount = 0

  for (const m of mutations) {
    if (m.type !== 'move_elements') continue
    for (const mv of m.moves) {
      const groupShapes = nextShapeNodes.filter((s) => s.vectorGroupId === mv.id)
      const groupTexts = nextTextNodes.filter((t) => t.vectorGroupId === mv.id)
      if (groupShapes.length > 0 || groupTexts.length > 0) {
        const gBounds = computeBoundsFromRects([
          ...groupShapes.map(getShapeWorldRect),
          ...groupTexts.map(getTextWorldRect)
        ])
        if (!gBounds) continue
        const shiftX =
          typeof mv.x === 'number' ? Math.round(mv.x - gBounds.x) : Math.round(mv.dx ?? 0)
        const shiftY =
          typeof mv.y === 'number' ? Math.round(mv.y - gBounds.y) : Math.round(mv.dy ?? 0)
        if (shiftX !== 0 || shiftY !== 0) {
          nextShapeNodes = nextShapeNodes.map((s) => {
            if (s.vectorGroupId !== mv.id) return s
            movedSingleIds.add(s.id)
            return {
              ...s,
              x: Math.round(s.x + shiftX),
              y: Math.round(s.y + shiftY),
              ...(Array.isArray(s.points)
                ? {
                    points: s.points.map(([px, py]) => [
                      Math.round(px + shiftX),
                      Math.round(py + shiftY)
                    ] as [number, number])
                  }
                : {}),
              ...(s.controlPoint
                ? {
                    controlPoint: [
                      Math.round(s.controlPoint[0] + shiftX),
                      Math.round(s.controlPoint[1] + shiftY)
                    ] as [number, number]
                  }
                : {})
            }
          })
          nextTextNodes = nextTextNodes.map((t) => {
            if (t.vectorGroupId !== mv.id) return t
            movedSingleIds.add(t.id)
            return {
              ...t,
              x: Math.round(t.x + shiftX),
              y: Math.round(t.y + shiftY)
            }
          })
          const gMeta = nextVectorDiagramMeta[mv.id]
          if (gMeta?.anchor) {
            nextVectorDiagramMeta[mv.id] = {
              ...gMeta,
              anchor: {
                x: Math.round(gMeta.anchor.x + shiftX),
                y: Math.round(gMeta.anchor.y + shiftY)
              }
            }
          }
        }
        rigidlyMovedGroups.add(mv.id)
        movedCount += 1
        continue
      }

      const resolveMove = <T extends { id: string; x: number; y: number; w?: number; h?: number }>(
        item: T
      ): T => {
        const nextX =
          typeof mv.x === 'number' ? Math.round(mv.x) : Math.round(item.x + (mv.dx ?? 0))
        const nextY =
          typeof mv.y === 'number' ? Math.round(mv.y) : Math.round(item.y + (mv.dy ?? 0))
        return {
          ...item,
          x: nextX,
          y: nextY,
          ...(typeof mv.w === 'number' ? { w: Math.max(24, Math.round(mv.w)) } : {}),
          ...(typeof mv.h === 'number' ? { h: Math.max(24, Math.round(mv.h)) } : {})
        }
      }

      let matched = false
      nextTextNodes = nextTextNodes.map((t) => {
        if (t.id !== mv.id) return t
        matched = true
        return resolveMove(t)
      })
      if (!matched) {
        nextEquationNodes = nextEquationNodes.map((eq) => {
          if (eq.id !== mv.id) return eq
          matched = true
          return resolveMove(eq)
        })
      }
      if (!matched) {
        nextCodeNodes = nextCodeNodes.map((c) => {
          if (c.id !== mv.id) return c
          matched = true
          return resolveMove(c)
        })
      }
      if (!matched) {
        nextGraphNodes = nextGraphNodes.map((g) => {
          if (g.id !== mv.id) return g
          matched = true
          return resolveMove(g)
        })
      }
      if (!matched) {
        nextScene3dNodes = nextScene3dNodes.map((s3) => {
          if (s3.id !== mv.id) return s3
          matched = true
          return resolveMove(s3)
        })
      }
      if (!matched) {
        nextDiagramNodes = nextDiagramNodes.map((d) => {
          if (d.id !== mv.id) return d
          matched = true
          return resolveMove(d)
        })
      }
      if (!matched) {
        nextVideoNodes = nextVideoNodes.map((v) => {
          if (v.id !== mv.id) return v
          matched = true
          return resolveMove(v)
        })
      }
      if (!matched) {
        nextImageNodes = nextImageNodes.map((img) => {
          if (img.id !== mv.id) return img
          matched = true
          return resolveMove(img)
        })
      }
      if (!matched) {
        nextVectorArtNodes = nextVectorArtNodes.map((va) => {
          if (va.id !== mv.id) return va
          matched = true
          const nextX =
            typeof mv.x === 'number' ? Math.round(mv.x) : Math.round(va.x + (mv.dx ?? 0))
          const nextY =
            typeof mv.y === 'number' ? Math.round(mv.y) : Math.round(va.y + (mv.dy ?? 0))
          return {
            ...va,
            x: nextX,
            y: nextY,
            ...(typeof mv.w === 'number' ? { width: Math.max(24, Math.round(mv.w)) } : {}),
            ...(typeof mv.h === 'number' ? { height: Math.max(24, Math.round(mv.h)) } : {})
          }
        })
      }
      if (!matched) {
        nextShapeNodes = nextShapeNodes.map((s) => {
          if (s.id !== mv.id) return s
          matched = true
          const nextX =
            typeof mv.x === 'number' ? Math.round(mv.x) : Math.round(s.x + (mv.dx ?? 0))
          const nextY =
            typeof mv.y === 'number' ? Math.round(mv.y) : Math.round(s.y + (mv.dy ?? 0))
          const dx = nextX - s.x
          const dy = nextY - s.y
          const hasPts = Array.isArray(s.points) && s.points.length >= 2
          return {
            ...s,
            x: nextX,
            y: nextY,
            ...(!hasPts && typeof mv.w === 'number' ? { w: Math.round(mv.w) } : {}),
            ...(!hasPts && typeof mv.h === 'number' ? { h: Math.round(mv.h) } : {}),
            ...(hasPts
              ? {
                  points: s.points!.map(([px, py]) => [
                    Math.round(px + dx),
                    Math.round(py + dy)
                  ] as [number, number])
                }
              : {}),
            ...(s.controlPoint
              ? {
                  controlPoint: [
                    Math.round(s.controlPoint[0] + dx),
                    Math.round(s.controlPoint[1] + dy)
                  ] as [number, number]
                }
              : {})
          }
        })
      }
      if (matched) {
        movedSingleIds.add(mv.id)
        movedCount += 1
      }
    }
  }

  if (movedSingleIds.size > 0) {
    const connectableById = new Map<string, ConnectableBoardElement>()
    const shapeGroupLookup = new Map<string, string>()
    for (const s of nextShapeNodes) {
      connectableById.set(s.id, s)
      if (s.vectorGroupId) shapeGroupLookup.set(s.id, s.vectorGroupId)
    }
    for (const c of nextCodeNodes) connectableById.set(c.id, c)
    for (const s3 of nextScene3dNodes) connectableById.set(s3.id, s3)
    for (const g of nextGraphNodes) connectableById.set(g.id, g)
    for (const d of nextDiagramNodes) connectableById.set(d.id, d)
    for (const t of nextTextNodes) {
      connectableById.set(t.id, {
        id: t.id,
        x: t.x,
        y: t.y,
        w: t.w ?? 340,
        h: t.h ?? 220,
        layerId: t.layerId
      })
    }
    for (const eq of nextEquationNodes) {
      connectableById.set(eq.id, {
        id: eq.id,
        x: eq.x,
        y: eq.y,
        w: eq.w ?? 300,
        h: eq.h ?? 96
      })
    }
    for (const v of nextVideoNodes) {
      connectableById.set(v.id, { id: v.id, x: v.x, y: v.y, w: v.w ?? 480, h: v.h ?? 360 })
    }
    for (const img of nextImageNodes) {
      connectableById.set(img.id, {
        id: img.id,
        x: img.x,
        y: img.y,
        w: img.w ?? 360,
        h: img.h ?? 260,
        layerId: img.layerId
      })
    }

    nextShapeNodes = nextShapeNodes.map((s) => {
      if (!isConnectorShape(s) || (!s.startBinding && !s.endBinding)) return s
      const startId = s.startBinding?.shapeId
      const endId = s.endBinding?.shapeId
      if (
        !(startId && movedSingleIds.has(startId)) &&
        !(endId && movedSingleIds.has(endId))
      ) {
        return s
      }
      const sg = startId ? shapeGroupLookup.get(startId) : undefined
      const eg = endId ? shapeGroupLookup.get(endId) : undefined
      if (sg && eg && sg === eg && rigidlyMovedGroups.has(sg)) {
        return s
      }
      return recomputeConnectorGeometry(s, connectableById)
    })
  }

  const boardAfterDeletes: BoardState = {
    ...board,
    strokes: nextStrokes,
    textNodes: nextTextNodes,
    equationNodes: nextEquationNodes,
    shapeNodes: nextShapeNodes,
    diagramNodes: nextDiagramNodes,
    vectorArtNodes: nextVectorArtNodes,
    codeNodes: nextCodeNodes,
    videoNodes: nextVideoNodes,
    imageNodes: nextImageNodes,
    scene3dNodes: nextScene3dNodes,
    graphNodes: nextGraphNodes
  }
  const occupied = collectOccupiedBoardRects(boardAfterDeletes)
  const fallbackView: CanvasTransform = opts.view ?? {
    zoom: 1,
    panX: Math.round(640 - opts.viewportCenter.x),
    panY: Math.round(400 - opts.viewportCenter.y)
  }
  const screenSafe = opts.screenSafe ?? getSafeViewportScreenRect()

  // Pre-measure all standalone creations and resolve collision-free cluster placement
  const explicitPositions = new Map<number, { x: number; y: number }>()
  const rawExplicitItems: Array<{
    mutationIndex: number
    x: number
    y: number
    w: number
    h: number
    topMargin: number
  }> = []
  const clusterQueue: PreparedCreation[] = []
  const prebuiltNativeDiagrams = new Map<
    number,
    { parsed: CleanReactFlowResult; slotBounds?: { w: number; h: number } }
  >()
  const explicitGroupCount = mutations.filter(
    (mu) => 'x' in mu && 'y' in mu && typeof mu.x === 'number' && typeof mu.y === 'number'
  ).length
  let explicitGroupNextPan: { panX: number; panY: number } | undefined
  let explicitGroupBounds: BoxRect | undefined

  mutations.forEach((m, idx) => {
    if (m.type === 'add_note') {
      const w = Math.max(220, Math.round(m.w ?? 340))
      const h = Math.max(140, Math.round(m.h ?? 220))
      if (typeof m.x === 'number' && typeof m.y === 'number') {
        rawExplicitItems.push({ mutationIndex: idx, x: Math.round(m.x), y: Math.round(m.y), w, h, topMargin: 0 })
      } else {
        clusterQueue.push({ key: `m-${idx}`, mutationIndex: idx, w, h })
      }
    } else if (m.type === 'add_equation') {
      const w = Math.max(160, Math.round(m.w ?? 300))
      const h = Math.max(56, Math.round(m.h ?? 96))
      if (typeof m.x === 'number' && typeof m.y === 'number') {
        rawExplicitItems.push({ mutationIndex: idx, x: Math.round(m.x), y: Math.round(m.y), w, h, topMargin: 0 })
      } else {
        clusterQueue.push({ key: `m-${idx}`, mutationIndex: idx, w, h })
      }
    } else if (m.type === 'add_reactflow_diagram') {
      const parsed = parseAndCleanReactFlow(
        JSON.stringify({
          title: m.title,
          diagramType: m.diagramType ?? 'flowchart',
          direction: m.direction ?? 'TB',
          nodes: m.nodes.map((n) => ({
            id: n.id,
            type: n.kind || n.shape || 'process',
            label: n.label,
            description: n.subtitle
          })),
          edges: m.edges
        })
      )
      // Preserve edge dashed/dotted style from agent edge schema
      parsed.edges = parsed.edges.map((rfEdge, eIdx) => {
        const orig = m.edges[eIdx]
        return orig?.style === 'dashed' || orig?.style === 'dotted'
          ? {
              ...rfEdge,
              style: { ...(rfEdge.style ?? {}), strokeDasharray: orig.style === 'dotted' ? '2 6' : '8 6' }
            }
          : rfEdge
      })
      const slotBounds =
        !opts.honorExplicitCoords &&
        typeof m.x === 'number' &&
        typeof m.y === 'number' &&
        explicitGroupCount > 1
          ? { w: 520, h: 310 }
          : undefined
      const draft = compileFlowDiagramToBoardElements(
        parsed,
        { x: 0, y: 0, ...(slotBounds ?? {}) },
        {
          fontFamily: opts.fontFamily,
          direction: m.direction === 'LR' ? 'RIGHT' : m.direction === 'TB' ? 'DOWN' : undefined,
          animateFlow: Boolean(m.animated || m.edges.some((e) => e.animated))
        }
      )
      prebuiltNativeDiagrams.set(idx, { parsed, slotBounds })
      const w = draft.bounds.w
      const h = draft.bounds.h
      if (typeof m.x === 'number' && typeof m.y === 'number') {
        rawExplicitItems.push({ mutationIndex: idx, x: Math.round(m.x), y: Math.round(m.y), w, h, topMargin: 0 })
      } else {
        clusterQueue.push({
          key: `m-${idx}`,
          mutationIndex: idx,
          w,
          h
        })
      }
    } else if (m.type === 'add_spatial_scene') {
      const w = Math.max(320, Math.round(m.width ?? 540))
      const h = Math.max(280, Math.round(m.height ?? 440))
      if (typeof m.x === 'number' && typeof m.y === 'number') {
        rawExplicitItems.push({ mutationIndex: idx, x: Math.round(m.x), y: Math.round(m.y), w, h, topMargin: 0 })
      } else {
        clusterQueue.push({ key: `m-${idx}`, mutationIndex: idx, w, h })
      }
    } else if (m.type === 'add_code_card') {
      const w = Math.max(260, Math.round(m.w ?? 520))
      const h = Math.max(220, Math.round(m.h ?? 400))
      if (typeof m.x === 'number' && typeof m.y === 'number') {
        rawExplicitItems.push({ mutationIndex: idx, x: Math.round(m.x), y: Math.round(m.y), w, h, topMargin: 0 })
      } else {
        clusterQueue.push({ key: `m-${idx}`, mutationIndex: idx, w, h })
      }
    } else if (m.type === 'add_video_card') {
      const w = 480
      const h = 360
      if (typeof m.x === 'number' && typeof m.y === 'number') {
        rawExplicitItems.push({ mutationIndex: idx, x: Math.round(m.x), y: Math.round(m.y), w, h, topMargin: 0 })
      } else {
        clusterQueue.push({ key: `m-${idx}`, mutationIndex: idx, w, h })
      }
    } else if (m.type === 'add_graph_card') {
      if (!m.cardId) {
        const w = Math.max(320, Math.round(m.width ?? 520))
        const h = Math.max(240, Math.round(m.height ?? 380))
        if (typeof m.x === 'number' && typeof m.y === 'number') {
          rawExplicitItems.push({ mutationIndex: idx, x: Math.round(m.x), y: Math.round(m.y), w, h, topMargin: 0 })
        } else {
          clusterQueue.push({ key: `m-${idx}`, mutationIndex: idx, w, h })
        }
      }
    } else if (m.type === 'add_3d_scene') {
      const w = Math.max(280, Math.round(m.width ?? 480))
      const h = Math.max(220, Math.round(m.height ?? 380))
      if (typeof m.x === 'number' && typeof m.y === 'number') {
        rawExplicitItems.push({ mutationIndex: idx, x: Math.round(m.x), y: Math.round(m.y), w, h, topMargin: 0 })
      } else {
        clusterQueue.push({ key: `m-${idx}`, mutationIndex: idx, w, h })
      }
    }
  })

  if (opts.honorExplicitCoords && rawExplicitItems.length > 0) {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const it of rawExplicitItems) {
      explicitPositions.set(it.mutationIndex, { x: it.x, y: it.y })
      occupied.push({ x: it.x, y: it.y - it.topMargin, w: it.w, h: it.h })
      minX = Math.min(minX, it.x)
      minY = Math.min(minY, it.y - it.topMargin)
      maxX = Math.max(maxX, it.x + it.w)
      maxY = Math.max(maxY, it.y - it.topMargin + it.h)
    }
    if (Number.isFinite(minX)) {
      explicitGroupBounds = {
        x: minX,
        y: minY,
        w: Math.max(240, maxX - minX),
        h: Math.max(180, maxY - minY)
      }
    }
  } else if (rawExplicitItems.length === 1) {
    const item = rawExplicitItems[0]
    const explicitOk = !occupied.some((occ) =>
      rectsOverlap({ x: item.x, y: item.y - item.topMargin, w: item.w, h: item.h }, occ, 20)
    )
    if (explicitOk) {
      explicitPositions.set(item.mutationIndex, { x: item.x, y: item.y })
      occupied.push({ x: item.x, y: item.y - item.topMargin, w: item.w, h: item.h })
    } else {
      clusterQueue.push({
        key: `m-${item.mutationIndex}`,
        mutationIndex: item.mutationIndex,
        w: item.w,
        h: item.h,
        topMargin: item.topMargin
      })
    }
  } else if (rawExplicitItems.length > 1) {
    // Preserve relative structured layout (e.g., multi-column tutorial) and place in a free region if needed
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const it of rawExplicitItems) {
      minX = Math.min(minX, it.x)
      minY = Math.min(minY, it.y - it.topMargin)
      maxX = Math.max(maxX, it.x + it.w)
      maxY = Math.max(maxY, it.y - it.topMargin + it.h)
    }
    const groupW = Math.max(240, maxX - minX)
    const groupH = Math.max(180, maxY - minY)
    const anyCollision = rawExplicitItems.some((it) =>
      occupied.some((occ) =>
        rectsOverlap({ x: it.x, y: it.y - it.topMargin, w: it.w, h: it.h }, occ, 24)
      )
    )
    let dx = 0
    let dy = 0
    if (anyCollision) {
      const freeGroup = findEmptyBoardRect(occupied, groupW, groupH, fallbackView, screenSafe, {
        topMargin: 24,
        gap: 40
      })
      dx = freeGroup.x - minX
      dy = freeGroup.y - minY
      explicitGroupNextPan = freeGroup.nextPan
      explicitGroupBounds = { x: freeGroup.x, y: freeGroup.y, w: groupW, h: groupH }
    } else {
      explicitGroupBounds = { x: minX, y: minY, w: groupW, h: groupH }
    }
    for (const it of rawExplicitItems) {
      const placed = { x: Math.round(it.x + dx), y: Math.round(it.y + dy) }
      explicitPositions.set(it.mutationIndex, placed)
      occupied.push({ x: placed.x, y: placed.y - it.topMargin, w: it.w, h: it.h })
    }
  }

  // Order unpositioned items pedagogically unless wired together as a connected pipeline
  const hasPipelineConnectors = mutations.some((m) => m.type === 'add_connector')
  const typePriority = (idx: number): number => {
    const t = mutations[idx]?.type
    if (t === 'add_note') return 1
    if (
      t === 'add_spatial_scene' ||
      t === 'add_reactflow_diagram' ||
      t === 'add_3d_scene' ||
      t === 'add_graph_card'
    ) {
      return 2
    }
    if (t === 'add_equation') return 3
    if (t === 'add_code_card') return 4
    return 5
  }
  const orderedClusterQueue = hasPipelineConnectors
    ? [...clusterQueue].sort((a, b) => a.mutationIndex - b.mutationIndex)
    : [...clusterQueue].sort(
        (a, b) => typePriority(a.mutationIndex) - typePriority(b.mutationIndex) || a.mutationIndex - b.mutationIndex
      )

  const clusterLayout =
    orderedClusterQueue.length > 0
      ? planEmptyClusterLayout(
          occupied,
          orderedClusterQueue.map((c) => ({ key: c.key, w: c.w, h: c.h })),
          fallbackView,
          screenSafe,
          {
            gap: hasPipelineConnectors ? 48 : 28,
            clusterGap: 40,
            ...(hasPipelineConnectors ? { maxCols: Math.max(2, orderedClusterQueue.length) } : {})
          }
        )
      : null

  if (clusterLayout) {
    for (const item of orderedClusterQueue) {
      const pos = clusterLayout.positions[item.key]
      if (pos) {
        explicitPositions.set(item.mutationIndex, {
          x: pos.x,
          y: pos.y + (item.topMargin ?? 0)
        })
      }
    }
  }

  const createdIds: string[] = []
  let appliedCount = (deletedIds.length > 0 ? 1 : 0) + movedCount

  mutations.forEach((m, idx) => {
    if (m.type === 'delete_elements' || m.type === 'move_elements') return
    const now = Date.now()
    const resolvedPos = explicitPositions.get(idx) ?? {
      x: Math.round(opts.viewportCenter.x - 180),
      y: Math.round(opts.viewportCenter.y - 140)
    }

    switch (m.type) {
      case 'add_note': {
        const w = Math.max(220, Math.round(m.w ?? 340))
        const h = Math.max(140, Math.round(m.h ?? 220))
        const id = m.id?.trim() || uid('note')
        const node: TextNode = {
          id,
          x: resolvedPos.x,
          y: resolvedPos.y,
          w,
          h,
          title: m.title || 'AI Note',
          text: unescapeLlmText(m.content),
          fontSize: 15,
          color: 'ink',
          bg: m.color || undefined,
          source: 'ai',
          createdAt: now
        }
        nextTextNodes.push(node)
        createdIds.push(id)
        appliedCount += 1
        break
      }

      case 'add_equation': {
        const w = Math.max(160, Math.round(m.w ?? 300))
        const h = Math.max(56, Math.round(m.h ?? 96))
        const id = m.id?.trim() || uid('eq')
        const eq: EquationNode = {
          id,
          x: resolvedPos.x,
          y: resolvedPos.y,
          w,
          h,
          latex: m.latex,
          fontSize: 22,
          color: 'ink',
          createdAt: now
        }
        nextEquationNodes.push(eq)
        createdIds.push(id)
        appliedCount += 1
        break
      }

      case 'add_reactflow_diagram': {
        const entry = prebuiltNativeDiagrams.get(idx)
        if (!entry) break
        const targetLayerId =
          resolveTargetInkLayerId({ layers: nextLayers, activeLayerId: nextActiveLayerId }) ??
          LAYER_OVERLAY_INK_ID
        const compiled = compileFlowDiagramToBoardElements(
          entry.parsed,
          {
            x: resolvedPos.x,
            y: resolvedPos.y,
            ...(entry.slotBounds ?? {})
          },
          {
            fontFamily: opts.fontFamily,
            layerId: targetLayerId,
            existingGroupId: m.id?.trim() || undefined,
            direction:
              m.direction === 'LR' ? 'RIGHT' : m.direction === 'TB' ? 'DOWN' : undefined,
            animateFlow: Boolean(m.animated || m.edges.some((e) => e.animated))
          }
        )
        for (const s of compiled.shapes) {
          nextShapeNodes.push(s)
          createdIds.push(s.id)
        }
        for (const t of compiled.texts) {
          nextTextNodes.push(t)
          createdIds.push(t.id)
        }
        nextVectorDiagramMeta[compiled.groupId] = compiled.meta
        appliedCount += 1
        break
      }

      case 'add_spatial_scene': {
        const w = Math.max(320, Math.round(m.width ?? 540))
        const h = Math.max(280, Math.round(m.height ?? 440))
        const targetLayerId =
          resolveTargetInkLayerId({ layers: nextLayers, activeLayerId: nextActiveLayerId }) ??
          LAYER_OVERLAY_INK_ID
        const compiled = compileSpatialScene(
          m.scene,
          { x: resolvedPos.x, y: resolvedPos.y, width: w, height: h },
          opts.fontFamily,
          {
            measureText: (txt, fontSize, bold) => measureBoardText(txt, fontSize, bold, opts.fontFamily),
            existingGroupId: m.id?.trim() || undefined,
            layerId: targetLayerId
          }
        )
        for (const s of compiled.shapes) {
          nextShapeNodes.push(s)
          createdIds.push(s.id)
        }
        for (const t of compiled.texts) {
          nextTextNodes.push(t)
          createdIds.push(t.id)
        }
        nextVectorDiagramMeta[compiled.groupId] = {
          groupId: compiled.groupId,
          anchor: { x: compiled.bounds.x, y: compiled.bounds.y },
          spatialScene: m.scene
        }
        appliedCount += 1
        break
      }

      case 'add_code_card': {
        const id = m.id?.trim() || uid('code')
        const w = Math.max(260, Math.round(m.w ?? 520))
        const h = Math.max(220, Math.round(m.h ?? 400))
        const rawTabs = Array.isArray(m.tabs) && m.tabs.length > 0 ? m.tabs : null
        const tabs = rawTabs
          ? rawTabs.map((t, tIdx) => ({
              id: uid(`tab${tIdx + 1}`),
              title: t.title,
              language: t.language,
              code: unescapeLlmCode(t.code),
              stdin: t.stdin ?? '',
              upstreamTabId: t.upstreamTabId ?? (tIdx > 0 && m.pipelineMode ? 'prev' : null),
              output: null
            }))
          : [
              {
                id: uid('tab'),
                title: m.title,
                language: m.language,
                code: unescapeLlmCode(m.code),
                stdin: '',
                output: null
              }
            ]
        const card: CodeNode = {
          id,
          x: resolvedPos.x,
          y: resolvedPos.y,
          w,
          h,
          title: m.title,
          pipelineMode: Boolean(m.pipelineMode || (rawTabs && rawTabs.length > 1)),
          tabs,
          activeTabId: tabs[0].id,
          createdAt: now
        }
        nextCodeNodes.push(card)
        createdIds.push(id)
        appliedCount += 1
        break
      }

      case 'add_graph_card': {
        const VALID_TYPES = new Set<GraphChartType>([
          'function',
          'line',
          'smooth',
          'area',
          'bar',
          'histogram',
          'scatter',
          'pie',
          'violin',
          'box',
          'candlestick',
          'heatmap',
          'surface3d',
          'scatter3d',
          'line3d',
          'bar3d'
        ])
        const reqChartType =
          typeof m.chartType === 'string' && VALID_TYPES.has(m.chartType as GraphChartType)
            ? (m.chartType as GraphChartType)
            : undefined
        const fallbackPreset =
          (reqChartType
            ? GRAPH_PRESETS.find((p) => resolveGraphChartType(p.spec) === reqChartType)
            : undefined) ?? GRAPH_PRESETS[0]

        let resolvedSpec: GraphPlotSpec = { ...fallbackPreset.spec }
        let parsedFromPayload: ReturnType<typeof parseCodeOutputToVisuals> | null = null

        if (m.spec && (Array.isArray(m.spec.functions) || Array.isArray(m.spec.dataSeries))) {
          resolvedSpec = {
            ...fallbackPreset.spec,
            ...(m.spec as Partial<GraphPlotSpec>),
            ...(m.title ? { title: m.title } : {}),
            ...(reqChartType
              ? {
                  chartType: reqChartType,
                  mode: is3DGraphChartType(reqChartType)
                    ? '3d'
                    : reqChartType === 'function'
                      ? 'function'
                      : 'data'
                }
              : {})
          }
        } else {
          const payloadObj: Record<string, unknown> = {
            ...(m.data ?? {}),
            ...(reqChartType ? { type: reqChartType } : {}),
            ...(m.title ? { title: m.title } : {})
          }
          if (Object.keys(payloadObj).length > 0) {
            parsedFromPayload = parseCodeOutputToVisuals(JSON.stringify(payloadObj), m.title)
          }
          if (parsedFromPayload?.plot2d) {
            resolvedSpec = parsedFromPayload.plot2d
          } else if (reqChartType) {
            resolvedSpec = {
              ...fallbackPreset.spec,
              ...(m.title ? { title: m.title } : {}),
              chartType: reqChartType,
              mode: is3DGraphChartType(reqChartType)
                ? '3d'
                : reqChartType === 'function'
                  ? 'function'
                  : 'data'
            }
          }
        }

        const existingTarget = m.cardId
          ? nextGraphNodes.find((g) => g.id === m.cardId)
          : undefined
        if (existingTarget) {
          const mergedSpec = mergeCodeVisualIntoGraphSpec(
            existingTarget.spec,
            resolvedSpec,
            Boolean(reqChartType || parsedFromPayload?.hasExplicitChartType)
          )
          nextGraphNodes = nextGraphNodes.map((g) =>
            g.id === existingTarget.id
              ? {
                  ...g,
                  title: m.title || mergedSpec.title || g.title,
                  spec: mergedSpec
                }
              : g
          )
          createdIds.push(existingTarget.id)
          appliedCount += 1
          break
        }

        const w = Math.max(320, Math.round(m.width ?? 520))
        const h = Math.max(240, Math.round(m.height ?? 380))
        const id = m.id?.trim() || uid('graph')
        const graphNode: GraphNode = {
          id,
          x: resolvedPos.x,
          y: resolvedPos.y,
          w,
          h,
          title: m.title || resolvedSpec.title || 'Graph',
          spec: resolvedSpec,
          createdAt: now
        }
        nextGraphNodes.push(graphNode)
        createdIds.push(id)
        appliedCount += 1
        break
      }

      case 'add_3d_scene': {
        const w = Math.max(280, Math.round(m.width ?? 480))
        const h = Math.max(220, Math.round(m.height ?? 380))
        const normalizedSpec = normalizeScene3DInput(
          m.scene ?? { preset: m.preset || 'car', title: m.title, immersed: m.immersed }
        )
        const id = m.id?.trim() || uid('s3d')
        const sceneNode: Scene3DNode = {
          id,
          x: resolvedPos.x,
          y: resolvedPos.y,
          w,
          h,
          title: m.title || normalizedSpec.title || '3D Object',
          spec: { ...normalizedSpec, immersed: m.immersed ?? normalizedSpec.immersed ?? true },
          immersed: m.immersed ?? normalizedSpec.immersed ?? true,
          createdAt: now
        }
        nextScene3dNodes.push(sceneNode)
        createdIds.push(id)
        appliedCount += 1
        break
      }

      case 'patch_code_card': {
        let patched = false
        nextCodeNodes = nextCodeNodes.map((c) => {
          if (c.id !== m.cardId) return c
          patched = true
          const activeId = c.activeTabId || c.tabs[0]?.id
          const updatedTabs = c.tabs.map((tab) =>
            tab.id === activeId
              ? {
                  ...tab,
                  language: m.language ?? tab.language,
                  code: unescapeLlmCode(m.code),
                  output: null
                }
              : tab
          )
          createdIds.push(c.id)
          return {
            ...c,
            title: m.title ?? c.title,
            tabs: updatedTabs
          }
        })
        if (patched) appliedCount += 1
        break
      }

      case 'annotate_overlay': {
        const requestedLayer = m.layerId || LAYER_OVERLAY_INK_ID
        const exists = nextLayers.some((l) => l.id === requestedLayer && l.kind === 'ink')
        const resolvedFallback =
          resolveTargetInkLayerId({ layers: nextLayers, activeLayerId: nextActiveLayerId }) ??
          LAYER_OVERLAY_INK_ID
        const targetLayerId = exists ? requestedLayer : resolvedFallback
        nextLayers = nextLayers.map((l) =>
          l.id === targetLayerId ? { ...l, visible: true } : l
        )

        for (const a of m.annotations) {
          const color = a.color || opts.defaultInkColor || '#ef4444'
          if (a.kind === 'text') {
            const textStr = (a.text || 'Note').trim()
            const fontSize = a.fontSize ?? 16
            const measured = measureBoardText(textStr, fontSize, true, opts.fontFamily)
            const id = uid('ann-txt')
            const txt: TextNode = {
              id,
              x: Math.round(a.x),
              y: Math.round(a.y),
              w: Math.max(80, measured.w),
              h: Math.max(28, measured.h),
              text: textStr,
              style: 'body',
              bold: true,
              fontSize,
              color,
              immersed: true,
              fontFamily: opts.fontFamily,
              align: 'left',
              layerId: targetLayerId,
              source: 'ai',
              createdAt: now
            }
            nextTextNodes.push(txt)
            createdIds.push(id)
          } else if (a.kind === 'arrow') {
            const toX = a.toX ?? a.x + 90
            const toY = a.toY ?? a.y + 36
            const id = uid('ann-arr')
            const shape: ShapeNode = {
              id,
              shape: 'arrow',
              x: Math.round(a.x),
              y: Math.round(a.y),
              w: Math.round(toX - a.x),
              h: Math.round(toY - a.y),
              label: a.text || undefined,
              labelSize: a.fontSize,
              color,
              strokeWidth: a.strokeWidth ?? 2.5,
              strokeStyle: 'solid',
              layerId: targetLayerId
            }
            nextShapeNodes.push(shape)
            createdIds.push(id)
          } else if (a.kind === 'highlight_underline') {
            const toX = a.toX ?? a.x + (a.width ?? 140)
            const toY = a.toY ?? a.y
            const id = uid('ann-line')
            const shape: ShapeNode = {
              id,
              shape: 'line',
              x: Math.round(a.x),
              y: Math.round(a.y),
              w: Math.round(toX - a.x),
              h: Math.round(toY - a.y),
              color: a.color || '#f59e0b',
              strokeWidth: a.strokeWidth ?? 4,
              strokeStyle: 'solid',
              layerId: targetLayerId
            }
            nextShapeNodes.push(shape)
            createdIds.push(id)
          } else {
            const id = uid('ann-shp')
            const shape: ShapeNode = {
              id,
              shape: a.kind === 'circle' ? 'circle' : 'rect',
              x: Math.round(a.x),
              y: Math.round(a.y),
              w: Math.max(24, Math.round(a.width ?? 120)),
              h: Math.max(24, Math.round(a.height ?? 72)),
              label: a.text || undefined,
              labelSize: a.fontSize,
              color,
              fillColor: 'transparent',
              strokeWidth: a.strokeWidth ?? 2.5,
              strokeStyle: 'solid',
              borderRadius: a.kind === 'rect' ? 8 : undefined,
              layerId: targetLayerId
            }
            nextShapeNodes.push(shape)
            createdIds.push(id)
          }
        }
        appliedCount += 1
        break
      }

      case 'add_connector': {
        const findConnTarget = (id: string): ConnectableBoardElement | undefined => {
          const direct =
            nextShapeNodes.find((s) => s.id === id) ??
            nextCodeNodes.find((c) => c.id === id) ??
            nextScene3dNodes.find((s3) => s3.id === id) ??
            nextGraphNodes.find((g) => g.id === id) ??
            nextDiagramNodes.find((d) => d.id === id)
          if (direct) return direct

          const matchedText = nextTextNodes.find((t) => t.id === id)
          if (matchedText) {
            return {
              id: matchedText.id,
              x: matchedText.x,
              y: matchedText.y,
              w: matchedText.w ?? 340,
              h: matchedText.h ?? 220,
              layerId: matchedText.layerId
            }
          }

          const matchedEq = nextEquationNodes.find((eq) => eq.id === id)
          if (matchedEq) {
            return {
              id: matchedEq.id,
              x: matchedEq.x,
              y: matchedEq.y,
              w: matchedEq.w ?? 300,
              h: matchedEq.h ?? 96
            }
          }

          const frameShape = nextShapeNodes.find((s) => s.vectorGroupId === id && s.id.endsWith('-frame'))
          if (frameShape) return frameShape

          const groupShapes = nextShapeNodes.filter((s) => s.vectorGroupId === id)
          const groupTexts = nextTextNodes.filter((t) => t.vectorGroupId === id)
          if (groupShapes.length > 0 || groupTexts.length > 0) {
            const gBounds = computeBoundsFromRects([
              ...groupShapes.map(getShapeWorldRect),
              ...groupTexts.map(getTextWorldRect)
            ])
            if (gBounds) {
              return {
                id: groupShapes[0]?.id ?? groupTexts[0].id,
                x: gBounds.x,
                y: gBounds.y,
                w: gBounds.w,
                h: gBounds.h,
                layerId: groupShapes[0]?.layerId ?? groupTexts[0]?.layerId
              }
            }
          }
          return undefined
        }

        const sourceEl = findConnTarget(m.sourceId)
        const targetEl = findConnTarget(m.targetId)
        if (sourceEl && targetEl && sourceEl.id !== targetEl.id) {
          const sourcePort = m.sourcePort ?? 'right'
          const targetPort = m.targetPort ?? 'left'
          const layerId = nextLayers.some((l) => l.id === LAYER_OVERLAY_INK_ID)
            ? LAYER_OVERLAY_INK_ID
            : (sourceEl.layerId ?? LAYER_OVERLAY_INK_ID)
          const conn = buildFlowConnectorNode({
            source: sourceEl,
            sourcePort,
            target: targetEl,
            targetPort,
            routing: m.routing ?? 'orthogonal',
            color: m.color || '#06b6d4',
            animated: m.animated ?? true,
            fontFamily: opts.fontFamily,
            layerId
          })
          if (m.label) conn.label = m.label
          nextShapeNodes.push(conn)
          createdIds.push(conn.id)

          const isSourceCode = nextCodeNodes.some((c) => c.id === sourceEl.id)
          const isTargetCode = nextCodeNodes.some((c) => c.id === targetEl.id)
          const isSourceGraph = nextGraphNodes.some((g) => g.id === sourceEl.id)
          const isTargetGraph = nextGraphNodes.some((g) => g.id === targetEl.id)
          const isSource3D = nextScene3dNodes.some((s3) => s3.id === sourceEl.id)
          const isTarget3D = nextScene3dNodes.some((s3) => s3.id === targetEl.id)

          if (isSourceCode && isTargetGraph) {
            nextCodeNodes = nextCodeNodes.map((c) =>
              c.id === sourceEl.id ? { ...c, linkedGraphId: targetEl.id } : c
            )
            nextGraphNodes = nextGraphNodes.map((g) =>
              g.id === targetEl.id ? { ...g, linkedCodeNodeId: sourceEl.id } : g
            )
          } else if (isSourceGraph && isTargetCode) {
            nextCodeNodes = nextCodeNodes.map((c) =>
              c.id === targetEl.id ? { ...c, linkedGraphId: sourceEl.id } : c
            )
            nextGraphNodes = nextGraphNodes.map((g) =>
              g.id === sourceEl.id ? { ...g, linkedCodeNodeId: targetEl.id } : g
            )
          } else if (isSourceCode && isTarget3D) {
            nextCodeNodes = nextCodeNodes.map((c) =>
              c.id === sourceEl.id ? { ...c, linkedScene3DId: targetEl.id } : c
            )
          } else if (isSource3D && isTargetCode) {
            nextCodeNodes = nextCodeNodes.map((c) =>
              c.id === targetEl.id ? { ...c, linkedScene3DId: sourceEl.id } : c
            )
          }

          appliedCount += 1
        }
        break
      }

      case 'add_video_card': {
        const id = uid('video')
        const video: VideoNode = {
          id,
          x: resolvedPos.x,
          y: resolvedPos.y,
          w: 480,
          h: 360,
          url: m.url,
          videoId: m.videoId,
          title: m.title,
          createdAt: now
        }
        nextVideoNodes.push(video)
        createdIds.push(id)
        appliedCount += 1
        break
      }
    }
  })

  return {
    nextBoard: {
      ...board,
      layers: nextLayers,
      activeLayerId: nextActiveLayerId,
      strokes: nextStrokes,
      textNodes: nextTextNodes,
      equationNodes: nextEquationNodes,
      shapeNodes: nextShapeNodes,
      diagramNodes: nextDiagramNodes,
      vectorArtNodes: nextVectorArtNodes,
      vectorDiagramMeta: nextVectorDiagramMeta,
      codeNodes: nextCodeNodes,
      videoNodes: nextVideoNodes,
      imageNodes: nextImageNodes,
      scene3dNodes: nextScene3dNodes,
      graphNodes: nextGraphNodes
    },
    createdIds,
    deletedIds,
    appliedCount,
    nextPan: clusterLayout?.nextPan ?? explicitGroupNextPan,
    createdBounds: clusterLayout?.clusterBounds ?? explicitGroupBounds
  }
}
