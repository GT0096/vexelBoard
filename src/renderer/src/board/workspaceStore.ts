import {
  EMPTY_BOARD,
  type BoardLayer,
  type BoardState,
  type CanvasTransform,
  type ChatMessage,
  type GraphNode
} from '../types/board'
import { ensureBoardLayers } from './layerUtils'
import { GRAPH_PRESETS } from './graphPlotBuilder'
import { unescapeLlmCode, unescapeLlmText } from '@shared/textUnescape'
import type {
  OverallHistoryEntry,
  OverallHistorySummary,
  ProjectChatStore,
  ProjectChatThread,
  ProjectItem,
  SectionElementBreakdown,
  SectionItem
} from '@shared/ipc'

const LEGACY_BOARD_KEY = 'vgb.board'
const BOARD_PREFIX = 'vgb.board.'
const CHAT_PREFIX = 'vgb.chat.'
const PROJECT_CHAT_PREFIX = 'vgb.chat.project.'
const VIEW_PREFIX = 'vgb.view.'
const PROJECTS_KEY = 'vgb.projects'
const SECTIONS_KEY = 'vgb.sections'
const MIGRATED_KEY = 'vgb.workspace_migrated_v1'
export const LAST_SECTION_KEY = 'vgb.lastSectionId'
export const ACTIVE_CHAT_PROJECT_KEY = 'vgb.activeChatProjectId'

export const PROJECT_COLORS = [
  '#FF5E5B',
  '#2563EB',
  '#F59E0B',
  '#10B981',
  '#8B5CF6',
  '#EC4899'
] as const

export function normalizeBoardState(parsed?: Partial<BoardState> | null): BoardState {
  if (!parsed) return EMPTY_BOARD
  const { layers, activeLayerId } = ensureBoardLayers({
    layers: parsed.layers,
    activeLayerId: parsed.activeLayerId
  })

  // Auto-heal any legacy spatial cell-strip connectors that drew arrows through cell text
  const rawShapes = parsed.shapeNodes ?? []
  const cellBoundsByGroup = new Map<
    string,
    { minX: number; minY: number; maxX: number; maxY: number }
  >()
  for (const s of rawShapes) {
    if (!s.vectorGroupId || !s.id.startsWith('vsp-cell-')) continue
    const prev = cellBoundsByGroup.get(s.vectorGroupId)
    const x1 = Math.min(s.x, s.x + s.w)
    const y1 = Math.min(s.y, s.y + s.h)
    const x2 = Math.max(s.x, s.x + s.w)
    const y2 = Math.max(s.y, s.y + s.h)
    if (!prev) {
      cellBoundsByGroup.set(s.vectorGroupId, { minX: x1, minY: y1, maxX: x2, maxY: y2 })
    } else {
      prev.minX = Math.min(prev.minX, x1)
      prev.minY = Math.min(prev.minY, y1)
      prev.maxX = Math.max(prev.maxX, x2)
      prev.maxY = Math.max(prev.maxY, y2)
    }
  }
  const cleanedShapes = rawShapes.filter((s) => {
    if (!s.vectorGroupId || !s.id.startsWith('vsp-conn-')) return true
    const cb = cellBoundsByGroup.get(s.vectorGroupId)
    if (!cb) return true
    const x1 = s.x
    const y1 = s.y
    const x2 = s.x + s.w
    const y2 = s.y + s.h
    const startInside =
      x1 >= cb.minX - 4 && x1 <= cb.maxX + 4 && y1 >= cb.minY + 4 && y1 <= cb.maxY - 4
    const endInside =
      x2 >= cb.minX - 4 && x2 <= cb.maxX + 4 && y2 >= cb.minY + 4 && y2 <= cb.maxY - 4
    return !(startInside && endInside)
  })

  const baseTextNodes = (parsed.textNodes ?? []).map((t) =>
    typeof t.text === 'string' && (t.text.includes('\\n') || t.text.includes('\\t'))
      ? { ...t, text: unescapeLlmText(t.text) }
      : t
  )

  // Auto-migrate legacy fragmented graphs (`vectorGroupId: 'graph-...'`) into unified GraphNode cards
  const legacyGraphGroupIds = new Set<string>()
  for (const s of cleanedShapes) {
    if (s.vectorGroupId?.startsWith('graph-')) legacyGraphGroupIds.add(s.vectorGroupId)
  }
  const migratedGraphNodes: GraphNode[] = [...(parsed.graphNodes ?? [])]
  const shapeIdToGraphId = new Map<string, string>()
  const groupIdToGraphId = new Map<string, string>()
  const nextVectorMeta = { ...(parsed.vectorDiagramMeta ?? {}) }

  if (legacyGraphGroupIds.size > 0) {
    const baseTemplate = GRAPH_PRESETS[0].spec
    for (const gid of legacyGraphGroupIds) {
      const grpShapes = cleanedShapes.filter((s) => s.vectorGroupId === gid)
      const grpTexts = baseTextNodes.filter((t) => t.vectorGroupId === gid)
      const frame = grpShapes.find((s) => s.id.endsWith('-frame')) ?? grpShapes[0]
      if (!frame) continue
      const titleNode = grpTexts.find((t) => t.id.endsWith('-title'))
      const graphId = gid
      groupIdToGraphId.set(gid, graphId)
      for (const s of grpShapes) {
        shapeIdToGraphId.set(s.id, graphId)
      }
      if (!migratedGraphNodes.some((g) => g.id === graphId)) {
        migratedGraphNodes.push({
          id: graphId,
          x: Math.round(frame.x),
          y: Math.round(frame.y),
          w: Math.max(360, Math.round(frame.w || 500)),
          h: Math.max(260, Math.round(frame.h || 340)),
          title: titleNode?.text || 'Graph',
          spec: {
            ...baseTemplate,
            title: titleNode?.text || baseTemplate.title,
            functions: baseTemplate.functions.map((f) => ({ ...f })),
            dataSeries: baseTemplate.dataSeries.map((d) => ({ ...d }))
          },
          createdAt: Date.now()
        })
      }
      delete nextVectorMeta[gid]
    }
  }

  const finalShapes = cleanedShapes
    .filter((s) => !s.vectorGroupId || !legacyGraphGroupIds.has(s.vectorGroupId))
    .map((s) => {
      const nextStart =
        s.startBinding && shapeIdToGraphId.has(s.startBinding.shapeId)
          ? { ...s.startBinding, shapeId: shapeIdToGraphId.get(s.startBinding.shapeId)! }
          : s.startBinding
      const nextEnd =
        s.endBinding && shapeIdToGraphId.has(s.endBinding.shapeId)
          ? { ...s.endBinding, shapeId: shapeIdToGraphId.get(s.endBinding.shapeId)! }
          : s.endBinding
      if (nextStart !== s.startBinding || nextEnd !== s.endBinding) {
        return { ...s, startBinding: nextStart, endBinding: nextEnd }
      }
      return s
    })

  const finalTexts = baseTextNodes.filter(
    (t) => !t.vectorGroupId || !legacyGraphGroupIds.has(t.vectorGroupId)
  )

  return {
    strokes: parsed.strokes ?? [],
    textNodes: finalTexts,
    equationNodes: parsed.equationNodes ?? [],
    shapeNodes: finalShapes,
    diagramNodes: parsed.diagramNodes ?? [],
    vectorArtNodes: parsed.vectorArtNodes ?? [],
    vectorDiagramMeta: nextVectorMeta,
    codeNodes: (parsed.codeNodes ?? []).map((c) => ({
      ...c,
      linkedGraphId:
        c.linkedGraphId ??
        (c.linkedGraphGroupId ? groupIdToGraphId.get(c.linkedGraphGroupId) : undefined),
      tabs: (c.tabs ?? []).map((tab) =>
        typeof tab.code === 'string' && (tab.code.includes('\\n') || tab.code.includes('\\t'))
          ? { ...tab, code: unescapeLlmCode(tab.code) }
          : tab
      )
    })),
    videoNodes: parsed.videoNodes ?? [],
    imageNodes: parsed.imageNodes ?? [],
    scene3dNodes: parsed.scene3dNodes ?? [],
    graphNodes: migratedGraphNodes,
    layers,
    activeLayerId
  }
}

export function isBoardEmpty(board: BoardState): boolean {
  return (
    board.strokes.length === 0 &&
    board.textNodes.length === 0 &&
    board.equationNodes.length === 0 &&
    board.shapeNodes.length === 0 &&
    board.diagramNodes.length === 0 &&
    (board.vectorArtNodes?.length ?? 0) === 0 &&
    (board.codeNodes?.length ?? 0) === 0 &&
    (board.videoNodes?.length ?? 0) === 0 &&
    (board.imageNodes?.length ?? 0) === 0 &&
    (board.scene3dNodes?.length ?? 0) === 0 &&
    (board.graphNodes?.length ?? 0) === 0
  )
}

export function loadSectionBoardLocal(sectionId: string): BoardState {
  try {
    const raw = localStorage.getItem(`${BOARD_PREFIX}${sectionId}`)
    if (raw) return normalizeBoardState(JSON.parse(raw))
    if (sectionId === 'default-board') {
      const legacy = localStorage.getItem(LEGACY_BOARD_KEY)
      if (legacy) return normalizeBoardState(JSON.parse(legacy))
    }
    return EMPTY_BOARD
  } catch {
    return EMPTY_BOARD
  }
}

export function saveSectionBoardLocal(sectionId: string, board: BoardState): void {
  try {
    localStorage.setItem(`${BOARD_PREFIX}${sectionId}`, JSON.stringify(board))
    if (sectionId === 'default-board') {
      localStorage.setItem(LEGACY_BOARD_KEY, JSON.stringify(board))
    }
  } catch {
    /* quota exceeded — ignore */
  }
}

export function loadSectionChatLocal(sectionId: string): ChatMessage[] {
  try {
    const raw = localStorage.getItem(`${CHAT_PREFIX}${sectionId}`)
    return raw ? (JSON.parse(raw) as ChatMessage[]) : []
  } catch {
    return []
  }
}

export function saveSectionChatLocal(sectionId: string, messages: ChatMessage[]): void {
  try {
    localStorage.setItem(`${CHAT_PREFIX}${sectionId}`, JSON.stringify(messages.slice(-80)))
  } catch {
    /* ignore */
  }
}

export function getProjectChatStorageKey(projectId: string): string {
  return `${PROJECT_CHAT_PREFIX}${projectId}`
}

export function getActiveChatProjectId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_CHAT_PROJECT_KEY)
  } catch {
    return null
  }
}

export function setActiveChatProjectId(projectId: string | null): void {
  try {
    if (projectId) localStorage.setItem(ACTIVE_CHAT_PROJECT_KEY, projectId)
    else localStorage.removeItem(ACTIVE_CHAT_PROJECT_KEY)
  } catch {
    /* ignore */
  }
}

export function deriveThreadTitle(messages: ChatMessage[], fallback = 'New Chat'): string {
  const firstUser = messages.find((m) => m.role === 'user')?.content?.trim()
  if (!firstUser) return fallback
  const singleLine = firstUser.replace(/\s+/g, ' ')
  return singleLine.length > 38 ? `${singleLine.slice(0, 38)}…` : singleLine
}

export function estimateThreadTokens(messages: ChatMessage[]): number {
  if (!messages || messages.length === 0) return 0
  // Matches the 10-message LLM context window used by the chat panel
  const windowMsgs = messages.slice(-10)
  const chars = windowMsgs.reduce((sum, m) => sum + (m.content?.length ?? 0), 0)
  return Math.max(1, Math.round(chars / 4))
}

export function createChatThread(title = 'New Chat'): ProjectChatThread {
  const now = Date.now()
  return {
    id: `thread-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    title,
    messages: [],
    createdAt: now,
    updatedAt: now
  }
}

export function createEmptyProjectChatStore(initialMessages: ChatMessage[] = []): ProjectChatStore {
  const now = Date.now()
  const hasMsgs = initialMessages.length > 0
  const thread: ProjectChatThread = {
    id: 'thread-default',
    title: hasMsgs ? deriveThreadTitle(initialMessages, 'Chat 1') : 'Chat 1',
    messages: initialMessages,
    createdAt: initialMessages[0]?.timestamp ?? now,
    updatedAt: hasMsgs ? (initialMessages[initialMessages.length - 1]?.timestamp ?? now) : 0
  }
  return {
    activeThreadId: thread.id,
    threads: [thread]
  }
}

function normalizeProjectChatStore(raw: unknown): ProjectChatStore {
  if (Array.isArray(raw)) {
    return createEmptyProjectChatStore(raw as ChatMessage[])
  }
  if (raw && typeof raw === 'object') {
    const obj = raw as Partial<ProjectChatStore>
    if (Array.isArray(obj.threads) && obj.threads.length > 0) {
      const threads = obj.threads.map((t) => {
        const msgs = Array.isArray(t.messages) ? t.messages : []
        return {
          id: t.id || `thread-${Date.now().toString(36)}`,
          title: t.title || 'Chat',
          ...(t.color ? { color: t.color } : {}),
          messages: msgs,
          createdAt: typeof t.createdAt === 'number' ? t.createdAt : Date.now(),
          updatedAt:
            typeof t.updatedAt === 'number'
              ? t.updatedAt
              : msgs.length > 0
                ? (msgs[msgs.length - 1]?.timestamp ?? Date.now())
                : 0
        }
      })
      const activeThreadId =
        typeof obj.activeThreadId === 'string' && threads.some((t) => t.id === obj.activeThreadId)
          ? obj.activeThreadId
          : threads[0].id
      return { activeThreadId, threads }
    }
  }
  return createEmptyProjectChatStore()
}

export function loadProjectChatStoreLocal(
  projectId: string,
  legacySectionIds?: string[]
): ProjectChatStore {
  if (!projectId) return createEmptyProjectChatStore()
  try {
    const raw = localStorage.getItem(getProjectChatStorageKey(projectId))
    if (raw) {
      const normalized = normalizeProjectChatStore(JSON.parse(raw))
      // Persist upgraded format if it was a legacy array
      if (Array.isArray(JSON.parse(raw))) {
        saveProjectChatStoreLocal(projectId, normalized)
      }
      return normalized
    }
    if (legacySectionIds && legacySectionIds.length > 0) {
      const migrated: ChatMessage[] = []
      for (const sid of legacySectionIds) {
        const secMsgs = loadSectionChatLocal(sid)
        if (secMsgs.length > 0) migrated.push(...secMsgs)
      }
      if (migrated.length > 0) {
        migrated.sort((a, b) => a.timestamp - b.timestamp)
        const store = createEmptyProjectChatStore(migrated)
        saveProjectChatStoreLocal(projectId, store)
        return store
      }
    }
    return createEmptyProjectChatStore()
  } catch {
    return createEmptyProjectChatStore()
  }
}

export function saveProjectChatStoreLocal(projectId: string, store: ProjectChatStore): void {
  if (!projectId) return
  try {
    const trimmed: ProjectChatStore = {
      activeThreadId: store.activeThreadId,
      threads: (store.threads || []).slice(0, 40).map((t) => ({
        ...t,
        messages: (t.messages || []).slice(-120)
      }))
    }
    localStorage.setItem(getProjectChatStorageKey(projectId), JSON.stringify(trimmed))
  } catch {
    /* ignore */
  }
}

export async function fetchProjectChatStore(
  projectId: string,
  legacySectionIds?: string[]
): Promise<ProjectChatStore> {
  if (!projectId) return createEmptyProjectChatStore()
  const local = loadProjectChatStoreLocal(projectId, legacySectionIds)
  const api = window.glassAPI
  if (api?.getProjectChatStore) {
    try {
      const dbStore = normalizeProjectChatStore(await api.getProjectChatStore(projectId))
      const dbMsgTotal = dbStore.threads.reduce((acc, t) => acc + t.messages.length, 0)
      const localMsgTotal = local.threads.reduce((acc, t) => acc + t.messages.length, 0)
      const dbNewestMsg = Math.max(
        0,
        ...dbStore.threads.map((t) => (t.messages.length > 0 ? t.updatedAt || 0 : 0))
      )
      const localNewestMsg = Math.max(
        0,
        ...local.threads.map((t) => (t.messages.length > 0 ? t.updatedAt || 0 : 0))
      )

      const preferDb =
        (dbMsgTotal > 0 && localMsgTotal === 0) ||
        dbMsgTotal > localMsgTotal ||
        (dbMsgTotal > 0 && dbMsgTotal === localMsgTotal && dbNewestMsg >= localNewestMsg) ||
        (dbMsgTotal === 0 &&
          localMsgTotal === 0 &&
          dbStore.threads.length >= local.threads.length)

      if (preferDb) {
        if (dbMsgTotal > 0 || dbStore.threads.length > 1) {
          saveProjectChatStoreLocal(projectId, dbStore)
        }
        return dbStore
      } else if (
        api.saveProjectChatStore &&
        (localMsgTotal > dbMsgTotal ||
          (localMsgTotal > 0 && localNewestMsg > dbNewestMsg) ||
          (dbMsgTotal === 0 && local.threads.length > dbStore.threads.length))
      ) {
        await api.saveProjectChatStore(projectId, local)
      }
    } catch {
      /* fallback to local */
    }
  }
  return local
}

export async function persistProjectChatStore(
  projectId: string,
  store: ProjectChatStore
): Promise<void> {
  if (!projectId) return
  const trimmed: ProjectChatStore = {
    activeThreadId: store.activeThreadId,
    threads: (store.threads || []).slice(0, 40).map((t) => ({
      ...t,
      messages: (t.messages || []).slice(-120)
    }))
  }
  saveProjectChatStoreLocal(projectId, trimmed)
  if (window.glassAPI?.saveProjectChatStore) {
    try {
      await window.glassAPI.saveProjectChatStore(projectId, trimmed)
    } catch {
      /* ignore */
    }
  }
}

export function loadProjectChatLocal(projectId: string, legacySectionIds?: string[]): ChatMessage[] {
  const store = loadProjectChatStoreLocal(projectId, legacySectionIds)
  const active = store.threads.find((t) => t.id === store.activeThreadId) || store.threads[0]
  return active?.messages ?? []
}

export function saveProjectChatLocal(projectId: string, messages: ChatMessage[]): void {
  const store = loadProjectChatStoreLocal(projectId)
  const now = Date.now()
  const next: ProjectChatStore = {
    activeThreadId: store.activeThreadId,
    threads: store.threads.map((t) =>
      t.id === store.activeThreadId ? { ...t, messages: messages.slice(-120), updatedAt: now } : t
    )
  }
  saveProjectChatStoreLocal(projectId, next)
}

export async function fetchProjectChat(
  projectId: string,
  legacySectionIds?: string[]
): Promise<ChatMessage[]> {
  const store = await fetchProjectChatStore(projectId, legacySectionIds)
  const active = store.threads.find((t) => t.id === store.activeThreadId) || store.threads[0]
  return active?.messages ?? []
}

export async function persistProjectChat(projectId: string, messages: ChatMessage[]): Promise<void> {
  const store = loadProjectChatStoreLocal(projectId)
  const now = Date.now()
  const next: ProjectChatStore = {
    activeThreadId: store.activeThreadId,
    threads: store.threads.map((t) =>
      t.id === store.activeThreadId ? { ...t, messages: messages.slice(-120), updatedAt: now } : t
    )
  }
  await persistProjectChatStore(projectId, next)
}

export function loadSectionViewLocal(sectionId: string): CanvasTransform {
  try {
    const raw = localStorage.getItem(`${VIEW_PREFIX}${sectionId}`)
    if (!raw) return { zoom: 1.0, panX: 0, panY: 0 }
    const parsed = JSON.parse(raw) as Partial<CanvasTransform>
    return {
      zoom: typeof parsed.zoom === 'number' && Number.isFinite(parsed.zoom) ? parsed.zoom : 1.0,
      panX: typeof parsed.panX === 'number' && Number.isFinite(parsed.panX) ? parsed.panX : 0,
      panY: typeof parsed.panY === 'number' && Number.isFinite(parsed.panY) ? parsed.panY : 0
    }
  } catch {
    return { zoom: 1.0, panX: 0, panY: 0 }
  }
}

export function saveSectionViewLocal(sectionId: string, view: CanvasTransform): void {
  try {
    localStorage.setItem(`${VIEW_PREFIX}${sectionId}`, JSON.stringify(view))
  } catch {
    /* ignore */
  }
}

export function buildElementsForDb(
  board: BoardState
): Array<{ id: string; kind: string; x: number; y: number; w?: number; h?: number; text?: string; raw: unknown }> {
  const elements: Array<{
    id: string
    kind: string
    x: number
    y: number
    w?: number
    h?: number
    text?: string
    raw: unknown
  }> = []

  board.textNodes.forEach((n) =>
    elements.push({ id: n.id, kind: 'text', x: n.x, y: n.y, w: n.w, h: n.h, text: `${n.title || ''}\n${n.text}`, raw: n })
  )
  board.equationNodes.forEach((n) =>
    elements.push({ id: n.id, kind: 'equation', x: n.x, y: n.y, w: n.w, h: n.h, text: n.latex, raw: n })
  )
  board.diagramNodes.forEach((n) =>
    elements.push({ id: n.id, kind: 'diagram', x: n.x, y: n.y, w: n.w, h: n.h, text: n.title, raw: n })
  )
  board.shapeNodes.forEach((n) =>
    elements.push({ id: n.id, kind: 'shape', x: n.x, y: n.y, w: n.w, h: n.h, text: n.label, raw: n })
  )
  board.vectorArtNodes?.forEach((n) =>
    elements.push({
      id: n.id,
      kind: 'vector_art',
      x: n.x,
      y: n.y,
      w: n.width,
      h: n.height,
      text: n.sourceMeta?.brief?.subject || 'Vector Artwork',
      raw: n
    })
  )
  board.codeNodes?.forEach((n) =>
    elements.push({
      id: n.id,
      kind: 'code',
      x: n.x,
      y: n.y,
      w: n.w,
      h: n.h,
      text: n.tabs?.map((t) => `${t.title}\n${t.code}`).join('\n'),
      raw: n
    })
  )
  board.videoNodes?.forEach((n) =>
    elements.push({
      id: n.id,
      kind: 'video',
      x: n.x,
      y: n.y,
      w: n.w,
      h: n.h,
      text: n.title || n.url,
      raw: n
    })
  )
  board.imageNodes?.forEach((n) =>
    elements.push({
      id: n.id,
      kind: 'image',
      x: n.x,
      y: n.y,
      w: n.w,
      h: n.h,
      text: n.caption || 'Image Snippet',
      raw: n
    })
  )
  board.scene3dNodes?.forEach((n) =>
    elements.push({
      id: n.id,
      kind: 'scene3d',
      x: n.x,
      y: n.y,
      w: n.w,
      h: n.h,
      text: n.title || n.spec?.title || '3D Scene',
      raw: n
    })
  )
  board.graphNodes?.forEach((n) =>
    elements.push({
      id: n.id,
      kind: 'graph',
      x: n.x,
      y: n.y,
      w: n.w,
      h: n.h,
      text: n.title || n.spec?.title || 'Graph',
      raw: n
    })
  )
  board.strokes.forEach((st) => {
    const first = st.points[0] ?? [0, 0]
    elements.push({
      id: st.id,
      kind: 'stroke',
      x: first[0],
      y: first[1],
      text: '',
      raw: st
    })
  })

  if (board.layers && board.layers.length > 0) {
    elements.push({
      id: '__board_layers__',
      kind: 'board_meta',
      x: 0,
      y: 0,
      text: '',
      raw: {
        kind: 'board_meta',
        layers: board.layers,
        activeLayerId: board.activeLayerId
      }
    })
  }

  return elements
}

export function reconstructBoardFromDbElements(rows: unknown[]): BoardState {
  if (!Array.isArray(rows) || rows.length === 0) return EMPTY_BOARD
  const board: BoardState = {
    strokes: [],
    textNodes: [],
    equationNodes: [],
    shapeNodes: [],
    diagramNodes: [],
    vectorArtNodes: [],
    vectorDiagramMeta: {},
    codeNodes: [],
    videoNodes: [],
    imageNodes: [],
    scene3dNodes: [],
    graphNodes: []
  }

  for (const rawItem of rows) {
    if (!rawItem || typeof rawItem !== 'object') continue
    const item = rawItem as Record<string, unknown>
    if (item.kind === 'board_meta' && Array.isArray(item.layers)) {
      board.layers = item.layers as BoardLayer[]
      if (typeof item.activeLayerId === 'string') {
        board.activeLayerId = item.activeLayerId
      }
    } else if (item.kind === 'vector_art' && Array.isArray(item.layers)) {
      board.vectorArtNodes!.push(rawItem as NonNullable<BoardState['vectorArtNodes']>[number])
    } else if (item.spec && typeof item.spec === 'object' && 'elements' in (item.spec as object)) {
      board.scene3dNodes!.push(rawItem as NonNullable<BoardState['scene3dNodes']>[number])
    } else if (
      item.spec &&
      typeof item.spec === 'object' &&
      ('chartType' in (item.spec as object) || 'mode' in (item.spec as object))
    ) {
      board.graphNodes!.push(rawItem as NonNullable<BoardState['graphNodes']>[number])
    } else if (Array.isArray(item.points) && typeof item.size === 'number') {
      board.strokes.push(rawItem as BoardState['strokes'][number])
    } else if (typeof item.text === 'string' && typeof item.fontSize === 'number' && 'source' in item) {
      board.textNodes.push(rawItem as BoardState['textNodes'][number])
    } else if (typeof item.latex === 'string') {
      board.equationNodes.push(rawItem as BoardState['equationNodes'][number])
    } else if (Array.isArray(item.nodes) && Array.isArray(item.edges)) {
      board.diagramNodes.push(rawItem as BoardState['diagramNodes'][number])
    } else if (typeof item.shape === 'string') {
      board.shapeNodes.push(rawItem as BoardState['shapeNodes'][number])
    } else if (Array.isArray(item.tabs) && typeof item.activeTabId === 'string') {
      board.codeNodes!.push(rawItem as NonNullable<BoardState['codeNodes']>[number])
    } else if (typeof item.videoId === 'string' && typeof item.url === 'string') {
      board.videoNodes!.push(rawItem as NonNullable<BoardState['videoNodes']>[number])
    } else if (typeof item.src === 'string' && typeof item.w === 'number' && typeof item.h === 'number') {
      board.imageNodes!.push(rawItem as NonNullable<BoardState['imageNodes']>[number])
    }
  }
  return normalizeBoardState(board)
}

export function computeSectionBreakdown(board: BoardState): {
  breakdown: SectionElementBreakdown
  total: number
  previewText?: string
} {
  const breakdown: SectionElementBreakdown = {
    notes: board.textNodes.length,
    diagrams: board.diagramNodes.length,
    equations: board.equationNodes.length,
    code: board.codeNodes?.length ?? 0,
    videos: board.videoNodes?.length ?? 0,
    shapes: board.shapeNodes.length,
    strokes: board.strokes.length,
    images: board.imageNodes?.length ?? 0
  }
  const total =
    breakdown.notes +
    breakdown.diagrams +
    breakdown.equations +
    breakdown.code +
    breakdown.videos +
    breakdown.shapes +
    breakdown.strokes +
    (breakdown.images ?? 0)

  const firstNote = board.textNodes[board.textNodes.length - 1]
  const firstDiagram = board.diagramNodes[board.diagramNodes.length - 1]
  const firstCode = board.codeNodes?.[board.codeNodes.length - 1]
  const previewSource =
    firstNote?.title ||
    firstNote?.text ||
    firstDiagram?.title ||
    firstCode?.title ||
    board.equationNodes[0]?.latex ||
    board.videoNodes?.[0]?.title

  const previewText = previewSource ? previewSource.replace(/\s+/g, ' ').trim().slice(0, 120) : undefined
  return { breakdown, total, previewText }
}

function readLocalProjects(): ProjectItem[] {
  try {
    const raw = localStorage.getItem(PROJECTS_KEY)
    return raw ? (JSON.parse(raw) as ProjectItem[]) : []
  } catch {
    return []
  }
}

function writeLocalProjects(projects: ProjectItem[]): void {
  try {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects))
  } catch {
    /* ignore */
  }
}

function readLocalSections(): SectionItem[] {
  try {
    const raw = localStorage.getItem(SECTIONS_KEY)
    return raw ? (JSON.parse(raw) as SectionItem[]) : []
  } catch {
    return []
  }
}

function writeLocalSections(sections: SectionItem[]): void {
  try {
    localStorage.setItem(SECTIONS_KEY, JSON.stringify(sections))
  } catch {
    /* ignore */
  }
}

/**
 * Ensures any legacy single-board data (`vgb.board` / `'default-board'`) is cleanly
 * represented as a Project + Section so the user never loses prior creations.
 */
export async function ensureWorkspaceMigrated(): Promise<void> {
  if (localStorage.getItem(MIGRATED_KEY)) return

  try {
    const legacyRaw = localStorage.getItem(LEGACY_BOARD_KEY)
    const legacyBoard = legacyRaw ? normalizeBoardState(JSON.parse(legacyRaw)) : EMPTY_BOARD

    if (!isBoardEmpty(legacyBoard)) {
      saveSectionBoardLocal('default-board', legacyBoard)
      const api = window.glassAPI

      if (api?.listProjects && api?.createProject && api?.createSection && api?.saveBoardStore) {
        const existingProjects = await api.listProjects()
        if (existingProjects.length === 0) {
          await api.createProject({
            id: 'proj-general',
            title: 'General Workspace',
            description: 'Your previously created notes, diagrams & study materials',
            color: '#00F5D4'
          })
          await api.createSection({
            id: 'default-board',
            projectId: 'proj-general',
            title: 'Main Study Board',
            description: 'Existing whiteboard workspace'
          })
        }
        await api.saveBoardStore('default-board', 'Main Study Board', buildElementsForDb(legacyBoard))
      } else {
        const localProjects = readLocalProjects()
        if (localProjects.length === 0) {
          const now = Date.now()
          writeLocalProjects([
            {
              id: 'proj-general',
              title: 'General Workspace',
              description: 'Your previously created notes, diagrams & study materials',
              color: '#00F5D4',
              createdAt: now,
              updatedAt: now
            }
          ])
          writeLocalSections([
            {
              id: 'default-board',
              projectId: 'proj-general',
              title: 'Main Study Board',
              description: 'Existing whiteboard workspace',
              createdAt: now,
              updatedAt: now
            }
          ])
        }
      }
    }
    localStorage.setItem(MIGRATED_KEY, '1')
  } catch {
    /* ignore migration issues */
  }
}

export async function fetchProjects(): Promise<ProjectItem[]> {
  await ensureWorkspaceMigrated()
  const api = window.glassAPI
  if (api?.listProjects) {
    try {
      const dbProjects = await api.listProjects()
      writeLocalProjects(dbProjects)
      return dbProjects
    } catch {
      /* fallback below */
    }
  }
  const projects = readLocalProjects()
  const sections = readLocalSections()
  return projects
    .map((p) => {
      const pSecs = sections.filter((s) => s.projectId === p.id)
      const elCount = pSecs.reduce((acc, s) => acc + computeSectionBreakdown(loadSectionBoardLocal(s.id)).total, 0)
      return {
        ...p,
        sectionCount: pSecs.length,
        elementCount: elCount
      }
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function createNewProject(input: {
  title: string
  description?: string
  color?: string
}): Promise<ProjectItem> {
  const id = `proj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const api = window.glassAPI
  if (api?.createProject) {
    const created = await api.createProject({ id, ...input })
    const projects = readLocalProjects().filter((p) => p.id !== created.id)
    writeLocalProjects([created, ...projects])
    return created
  }
  const now = Date.now()
  const created: ProjectItem = {
    id,
    title: input.title.trim() || 'Untitled Project',
    description: input.description?.trim() || undefined,
    color: input.color || '#00F5D4',
    createdAt: now,
    updatedAt: now,
    sectionCount: 0,
    elementCount: 0
  }
  writeLocalProjects([created, ...readLocalProjects()])
  return created
}

export async function editProject(
  projectId: string,
  patch: { title?: string; description?: string; color?: string }
): Promise<ProjectItem | null> {
  const api = window.glassAPI
  if (api?.updateProject) {
    const updated = await api.updateProject(projectId, patch)
    if (updated) {
      writeLocalProjects(readLocalProjects().map((p) => (p.id === projectId ? updated : p)))
    }
    return updated
  }
  const list = readLocalProjects()
  let result: ProjectItem | null = null
  const next = list.map((p) => {
    if (p.id !== projectId) return p
    result = {
      ...p,
      ...patch,
      title: patch.title !== undefined ? patch.title.trim() || p.title : p.title,
      updatedAt: Date.now()
    }
    return result
  })
  writeLocalProjects(next)
  return result
}

export async function removeProject(projectId: string): Promise<void> {
  const api = window.glassAPI
  const sections = await fetchSections(projectId)
  if (api?.deleteProject) {
    await api.deleteProject(projectId)
  }
  writeLocalProjects(readLocalProjects().filter((p) => p.id !== projectId))
  writeLocalSections(readLocalSections().filter((s) => s.projectId !== projectId))
  try {
    localStorage.removeItem(getProjectChatStorageKey(projectId))
  } catch {
    /* ignore */
  }
  for (const s of sections) {
    try {
      localStorage.removeItem(`${BOARD_PREFIX}${s.id}`)
      localStorage.removeItem(`${CHAT_PREFIX}${s.id}`)
      localStorage.removeItem(`${VIEW_PREFIX}${s.id}`)
    } catch {
      /* ignore */
    }
  }
}

export async function fetchSections(projectId?: string): Promise<SectionItem[]> {
  await ensureWorkspaceMigrated()
  const api = window.glassAPI
  if (api?.listSections) {
    try {
      const dbSections = await api.listSections(projectId)
      if (!projectId) writeLocalSections(dbSections)
      return dbSections.map((s) => {
        if ((s.elementCount ?? 0) === 0) {
          const localBoard = loadSectionBoardLocal(s.id)
          if (!isBoardEmpty(localBoard)) {
            const localInfo = computeSectionBreakdown(localBoard)
            return {
              ...s,
              elementCount: localInfo.total,
              breakdown: localInfo.breakdown,
              previewText: localInfo.previewText
            }
          }
        }
        return s
      })
    } catch {
      /* fallback below */
    }
  }
  const all = readLocalSections()
  const filtered = projectId ? all.filter((s) => s.projectId === projectId) : all
  return filtered
    .map((s) => {
      const info = computeSectionBreakdown(loadSectionBoardLocal(s.id))
      return {
        ...s,
        elementCount: info.total,
        breakdown: info.breakdown,
        previewText: info.previewText
      }
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function createNewSection(input: {
  projectId: string
  title: string
  description?: string
  color?: string
}): Promise<SectionItem> {
  const id = `sec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const api = window.glassAPI
  if (api?.createSection) {
    const created = await api.createSection({ id, ...input })
    writeLocalSections([created, ...readLocalSections().filter((s) => s.id !== created.id)])
    return created
  }
  const now = Date.now()
  const created: SectionItem = {
    id,
    projectId: input.projectId,
    title: input.title.trim() || 'Untitled Section',
    description: input.description?.trim() || undefined,
    color: input.color,
    createdAt: now,
    updatedAt: now,
    elementCount: 0,
    breakdown: { notes: 0, diagrams: 0, equations: 0, code: 0, videos: 0, shapes: 0, strokes: 0, images: 0 }
  }
  writeLocalSections([created, ...readLocalSections()])
  writeLocalProjects(
    readLocalProjects().map((p) => (p.id === input.projectId ? { ...p, updatedAt: now } : p))
  )
  return created
}

export async function editSection(
  sectionId: string,
  patch: { title?: string; description?: string; color?: string }
): Promise<SectionItem | null> {
  const api = window.glassAPI
  if (api?.updateSection) {
    const updated = await api.updateSection(sectionId, patch)
    if (updated) {
      writeLocalSections(readLocalSections().map((s) => (s.id === sectionId ? updated : s)))
    }
    return updated
  }
  let result: SectionItem | null = null
  const next = readLocalSections().map((s) => {
    if (s.id !== sectionId) return s
    result = {
      ...s,
      ...patch,
      title: patch.title !== undefined ? patch.title.trim() || s.title : s.title,
      updatedAt: Date.now()
    }
    return result
  })
  writeLocalSections(next)
  return result
}

export async function removeSection(sectionId: string): Promise<void> {
  const api = window.glassAPI
  if (api?.deleteSection) {
    await api.deleteSection(sectionId)
  }
  writeLocalSections(readLocalSections().filter((s) => s.id !== sectionId))
  try {
    localStorage.removeItem(`${BOARD_PREFIX}${sectionId}`)
    localStorage.removeItem(`${CHAT_PREFIX}${sectionId}`)
    localStorage.removeItem(`${VIEW_PREFIX}${sectionId}`)
    if (localStorage.getItem(LAST_SECTION_KEY) === sectionId) {
      localStorage.removeItem(LAST_SECTION_KEY)
    }
  } catch {
    /* ignore */
  }
}

export async function fetchOverallHistory(limit = 120): Promise<OverallHistorySummary> {
  await ensureWorkspaceMigrated()
  const api = window.glassAPI
  if (api?.getOverallHistory) {
    try {
      const dbSummary = await api.getOverallHistory(limit)
      return dbSummary
    } catch {
      /* fallback below */
    }
  }

  // Pure localStorage fallback if glassAPI is unavailable
  const projects = await fetchProjects()
  const sections = await fetchSections()
  const projectMap = new Map(projects.map((p) => [p.id, p]))
  const entries: OverallHistoryEntry[] = []

  let totalNotes = 0
  let totalDiagrams = 0
  let totalEquations = 0
  let totalCode = 0
  let totalVideos = 0
  let totalElements = 0

  for (const sec of sections) {
    const proj = projectMap.get(sec.projectId)
    const board = loadSectionBoardLocal(sec.id)
    totalNotes += board.textNodes.length
    totalDiagrams += board.diagramNodes.length
    totalEquations += board.equationNodes.length
    totalCode += board.codeNodes?.length ?? 0
    totalVideos += board.videoNodes?.length ?? 0
    totalElements += computeSectionBreakdown(board).total

    for (const t of board.textNodes) {
      entries.push({
        id: `el-${t.id}`,
        entryType: 'element',
        kind: 'text',
        title: t.title || t.text.split('\n')[0]?.slice(0, 64) || 'Text Note',
        snippet: t.text.replace(/\s+/g, ' ').trim().slice(0, 140),
        boardId: sec.id,
        sectionTitle: sec.title,
        projectId: proj?.id,
        projectTitle: proj?.title,
        projectColor: proj?.color,
        timestamp: t.createdAt || sec.updatedAt
      })
    }
    for (const d of board.diagramNodes) {
      entries.push({
        id: `el-${d.id}`,
        entryType: 'element',
        kind: 'diagram',
        title: d.title || 'Interactive Diagram',
        snippet: `${d.nodes.length} nodes`,
        boardId: sec.id,
        sectionTitle: sec.title,
        projectId: proj?.id,
        projectTitle: proj?.title,
        projectColor: proj?.color,
        timestamp: d.createdAt || sec.updatedAt
      })
    }
    for (const eq of board.equationNodes) {
      entries.push({
        id: `el-${eq.id}`,
        entryType: 'element',
        kind: 'equation',
        title: 'Math Equation',
        snippet: eq.latex,
        boardId: sec.id,
        sectionTitle: sec.title,
        projectId: proj?.id,
        projectTitle: proj?.title,
        projectColor: proj?.color,
        timestamp: eq.createdAt || sec.updatedAt
      })
    }
    for (const c of board.codeNodes ?? []) {
      entries.push({
        id: `el-${c.id}`,
        entryType: 'element',
        kind: 'code',
        title: c.title || 'Code Studio',
        snippet: c.tabs.map((tab) => tab.title).join(', '),
        boardId: sec.id,
        sectionTitle: sec.title,
        projectId: proj?.id,
        projectTitle: proj?.title,
        projectColor: proj?.color,
        timestamp: c.createdAt || sec.updatedAt
      })
    }
    for (const v of board.videoNodes ?? []) {
      entries.push({
        id: `el-${v.id}`,
        entryType: 'element',
        kind: 'video',
        title: v.title || 'YouTube Study Hub',
        snippet: v.url,
        boardId: sec.id,
        sectionTitle: sec.title,
        projectId: proj?.id,
        projectTitle: proj?.title,
        projectColor: proj?.color,
        timestamp: v.createdAt || sec.updatedAt
      })
    }
  }

  entries.sort((a, b) => b.timestamp - a.timestamp)

  return {
    totalProjects: projects.length,
    totalSections: sections.length,
    totalElements,
    totalNotes,
    totalDiagrams,
    totalEquations,
    totalCode,
    totalVideos,
    totalSources: 0,
    entries: entries.slice(0, limit)
  }
}
