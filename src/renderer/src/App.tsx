import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { BoxSelect, Focus, Loader2, Sparkles, Trash2, X } from 'lucide-react'
import type {
  BoardState,
  CanvasTransform,
  ChatMessage,
  CodeNode,
  CodeTabItem,
  DiagramNode,
  EquationNode,
  EraserMode,
  InkPoint,
  ShapeNode,
  Stroke,
  TextNode,
  Toast,
  ToolType,
  VideoNode,
  VideoTabItem,
  WritingPadDetection
} from './types/board'
import { FONTS, resolveThemeTokens } from './themes'
import {
  drawShape,
  drawStroke,
  screenToCanvas,
  strokesToOcrImage
} from './board/render'
import {
  renderSelectedDiagramToImage,
  parseAndCleanReactFlow,
  generateSmartLocalReactFlowDiagram,
  buildDiagramNodeFromData,
  buildTemplateDiagram,
  type CleanReactFlowResult
} from './board/beautifyUtils'
import {
  BoundsRect,
  eraseStrokesAlongPath,
  eraseShapesAlongPath,
  normalizeRect,
  isShapeInRect,
  isStrokeInRect,
  isTextInRect,
  isEquationInRect,
  isDiagramInRect,
  isCodeInRect
} from './board/eraserUtils'
import { useBoard, useSettings } from './board/useBoard'
import { useAiReadiness } from './board/useAiReadiness'
import {
  LAST_SECTION_KEY,
  createChatThread,
  createEmptyProjectChatStore,
  createNewSection,
  deriveThreadTitle,
  fetchProjectChatStore,
  fetchSections,
  getProjectChatStorageKey,
  loadProjectChatStoreLocal,
  loadSectionViewLocal,
  persistProjectChatStore,
  saveSectionViewLocal,
  setActiveChatProjectId
} from './board/workspaceStore'
import {
  DEFAULT_PROVIDER_MODELS,
  type ChatAttachment,
  type ProjectChatStore,
  type ProjectItem,
  type SectionItem
} from '@shared/ipc'
import { resolveBoardPalette } from './board/backgroundPresets'
import { Toolbar } from './components/Toolbar'
import { LeftDockToolbar } from './components/LeftDockToolbar'
import { TopBar } from './components/TopBar'
import { HomeHub } from './components/HomeHub'
import { RightPanel } from './components/RightPanel'
import { CanvasElements } from './components/CanvasElements'
import { KnowledgeHub } from './components/KnowledgeHub'
import { SettingsModal } from './components/SettingsModal'
import { Toasts } from './components/Toasts'

export interface DragSnapshot {
  shapes: Array<{ id: string; initX: number; initY: number }>
  texts: Array<{ id: string; initX: number; initY: number }>
  equations: Array<{ id: string; initX: number; initY: number }>
  diagrams: Array<{ id: string; initX: number; initY: number }>
  codes: Array<{ id: string; initX: number; initY: number }>
  videos?: Array<{ id: string; initX: number; initY: number }>
  strokes: Array<{ id: string; initPoints: InkPoint[] }>
}

export interface ShapeDragState {
  kind: 'move' | 'shape-resize'
  handle?: 'nw' | 'ne' | 'se' | 'sw'
  targetId?: string
  initX?: number
  initY?: number
  initW?: number
  initH?: number
  startPinchX: number
  startPinchY: number
  snapshots?: DragSnapshot
}

function getSelectionBounds(board: BoardState, ids: string[]): BoundsRect | null {
  if (!ids || ids.length === 0) return null
  const idSet = new Set(ids)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let found = false

  for (const s of board.shapeNodes) {
    if (idSet.has(s.id)) {
      found = true
      const sx = s.w < 0 ? s.x + s.w : s.x
      const sy = s.h < 0 ? s.y + s.h : s.y
      const sw = Math.abs(s.w)
      const sh = Math.abs(s.h)
      if (sx < minX) minX = sx
      if (sy < minY) minY = sy
      if (sx + sw > maxX) maxX = sx + sw
      if (sy + sh > maxY) maxY = sy + sh
    }
  }

  for (const t of board.textNodes) {
    if (idSet.has(t.id)) {
      found = true
      const tw = t.w ?? 260
      const th = t.h ?? 120
      if (t.x < minX) minX = t.x
      if (t.y < minY) minY = t.y
      if (t.x + tw > maxX) maxX = t.x + tw
      if (t.y + th > maxY) maxY = t.y + th
    }
  }

  for (const eq of board.equationNodes) {
    if (idSet.has(eq.id)) {
      found = true
      const ew = eq.w ?? 200
      const eh = eq.h ?? 80
      if (eq.x < minX) minX = eq.x
      if (eq.y < minY) minY = eq.y
      if (eq.x + ew > maxX) maxX = eq.x + ew
      if (eq.y + eh > maxY) maxY = eq.y + eh
    }
  }

  for (const d of board.diagramNodes ?? []) {
    if (idSet.has(d.id)) {
      found = true
      const dw = d.w ?? 640
      const dh = d.h ?? 440
      if (d.x < minX) minX = d.x
      if (d.y < minY) minY = d.y
      if (d.x + dw > maxX) maxX = d.x + dw
      if (d.y + dh > maxY) maxY = d.y + dh
    }
  }

  for (const c of board.codeNodes ?? []) {
    if (idSet.has(c.id)) {
      found = true
      const cw = c.w ?? 560
      const ch = c.h ?? 420
      if (c.x < minX) minX = c.x
      if (c.y < minY) minY = c.y
      if (c.x + cw > maxX) maxX = c.x + cw
      if (c.y + ch > maxY) maxY = c.y + ch
    }
  }

  for (const st of board.strokes) {
    if (idSet.has(st.id)) {
      for (const [px, py] of st.points) {
        found = true
        if (px < minX) minX = px
        if (py < minY) minY = py
        if (px > maxX) maxX = px
        if (py > maxY) maxY = py
      }
    }
  }

  if (!found || minX === Infinity) return null

  return {
    minX,
    minY,
    maxX,
    maxY,
    x: minX,
    y: minY,
    w: maxX - minX,
    h: maxY - minY
  }
}

interface BoxRect {
  x: number
  y: number
  w: number
  h: number
}

function rectsOverlap(a: BoxRect, b: BoxRect, gap = 0): boolean {
  return (
    a.x < b.x + b.w + gap &&
    a.x + a.w + gap > b.x &&
    a.y < b.y + b.h + gap &&
    a.y + a.h + gap > b.y
  )
}

function getOccupiedBoardRects(board: BoardState): BoxRect[] {
  const rects: BoxRect[] = []

  for (const t of board.textNodes) {
    const el = document.getElementById(t.id)
    const tw = t.w ?? (el && el.offsetWidth > 0 ? el.offsetWidth : 340)
    const th = t.h ?? (el && el.offsetHeight > 0 ? el.offsetHeight : 220)
    rects.push({ x: t.x, y: t.y, w: tw, h: th })
  }

  for (const eq of board.equationNodes) {
    const el = document.getElementById(eq.id)
    const ew = eq.w ?? (el && el.offsetWidth > 0 ? el.offsetWidth : 240)
    const eh = eq.h ?? (el && el.offsetHeight > 0 ? el.offsetHeight : 90)
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

  for (const s of board.shapeNodes) {
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

function getSafeViewportScreenRect(): { left: number; top: number; right: number; bottom: number } {
  const winW = typeof window !== 'undefined' ? window.innerWidth : 1280
  const winH = typeof window !== 'undefined' ? window.innerHeight : 800
  let left = 84
  let right = winW - 28
  const top = 68
  const bottom = Math.max(top + 220, winH - 96)

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

  if (right - left < 240) {
    left = 24
    right = Math.max(left + 260, winW - 24)
  }

  return { left, top, right, bottom }
}

function findFreeBoardPlacement(
  board: BoardState,
  itemW: number,
  itemH: number,
  view: CanvasTransform,
  opts?: { topMargin?: number; gap?: number }
): { x: number; y: number; nextPan?: { panX: number; panY: number } } {
  const topMargin = opts?.topMargin ?? 0
  const gap = opts?.gap ?? 24
  const occupied = getOccupiedBoardRects(board)
  const screenSafe = getSafeViewportScreenRect()
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

  // 1. Prefer safe viewport center when empty/unoccupied
  const centerCandX = Math.round(
    Math.max(viewMinX, Math.min(viewMaxX - itemW, viewCenterX - itemW / 2))
  )
  const centerCandY = Math.round(
    Math.max(viewMinY + topMargin, Math.min(viewMaxY - itemH, viewCenterY - itemH / 2))
  )
  if (isFree(centerCandX, centerCandY)) {
    return { x: centerCandX, y: centerCandY }
  }

  // 2. Try clean slots aligned beside/below existing items within the safe viewport
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

  // 3. Scan a grid across the visible safe viewport (top-to-bottom, left-to-right)
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

  // 4. Visible viewport is full: find nearest open space adjacent to existing items and pan to it
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
    const stepX = Math.max(120, Math.round(itemW * 0.6))
    const stepY = Math.max(100, Math.round((itemH + topMargin) * 0.6))
    outer: for (let ring = 1; ring <= 24; ring++) {
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

export default function App(): React.JSX.Element {
  const [settings, patchSettings] = useSettings()

  // Workspace Navigation: Start on Home Hub (Welcome + Overall History + Projects/Sections)
  const [activeProject, setActiveProject] = useState<ProjectItem | null>(null)
  const [activeSection, setActiveSection] = useState<SectionItem | null>(null)
  const [projectSections, setProjectSections] = useState<SectionItem[]>([])
  const [lastSectionId, setLastSectionId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(LAST_SECTION_KEY)
    } catch {
      return null
    }
  })

  const { board, boardRef, update, pushHistory, undo, canUndo, redo, canRedo, clear, flushSave } = useBoard(
    activeSection?.id ?? null,
    activeSection?.title ?? 'Untitled Section'
  )

  // Tool & Canvas State
  const [activeTool, setActiveTool] = useState<ToolType>('select')
  const [penColor, setPenColor] = useState<string>('ink')
  const [writingPadDetection, setWritingPadDetection] = useState<WritingPadDetection>('none')
  const [eraserSize, setEraserSize] = useState<number>(36)
  const [eraserMode, setEraserMode] = useState<EraserMode>('paper')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const selectedId = selectedIds[0] ?? null
  const setSelectedId = useCallback((id: string | null) => {
    setSelectedIds(id ? [id] : [])
  }, [])
  const [view, setView] = useState<CanvasTransform>({ zoom: 1.0, panX: 0, panY: 0 })
  const [isSpacePanning, setIsSpacePanning] = useState(false)

  // Modals & Panels
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(false)
  const [isDetachedChat, setIsDetachedChat] = useState(false)
  const [isKnowledgeHubOpen, setIsKnowledgeHubOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTrigger, setSettingsTrigger] = useState(0)
  const [toasts, setToasts] = useState<Toast[]>([])

  // AI & Chat State (multi-thread per project)
  const [chatStore, setChatStore] = useState<ProjectChatStore>(() => createEmptyProjectChatStore())
  const chatStoreRef = useRef(chatStore)
  chatStoreRef.current = chatStore
  const hydratedChatProjectIdRef = useRef<string | null>(null)
  const chatLoadSeqRef = useRef(0)
  const activeThread =
    chatStore.threads.find((t) => t.id === chatStore.activeThreadId) || chatStore.threads[0]
  const messages = activeThread?.messages ?? []
  const [aiBusy, setAiBusy] = useState(false)
  const [isBeautifying, setIsBeautifying] = useState(false)
  const aiReadiness = useAiReadiness(settings.ai)
  const isAiConfigured = aiReadiness.isAiConfigured
  const effectiveWritingPadDetection: WritingPadDetection = isAiConfigured
    ? writingPadDetection
    : 'none'
  const isAiConfiguredRef = useRef(isAiConfigured)
  const aiReasonRef = useRef(aiReadiness.reason)

  useEffect(() => {
    isAiConfiguredRef.current = isAiConfigured
    aiReasonRef.current = aiReadiness.reason
  }, [isAiConfigured, aiReadiness.reason])

  // Window State
  const [clickThrough, setClickThrough] = useState(false)
  const [isMaximized, setIsMaximized] = useState(false)

  // DOM Refs
  const committedCanvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const penColorRef = useRef(penColor)
  penColorRef.current = penColor
  const eraserSizeRef = useRef(eraserSize)
  eraserSizeRef.current = eraserSize
  const eraserModeRef = useRef(eraserMode)
  eraserModeRef.current = eraserMode
  const viewRef = useRef(view)
  viewRef.current = view
  const selectedIdsRef = useRef(selectedIds)
  selectedIdsRef.current = selectedIds
  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId
  const activeToolRef = useRef(activeTool)
  activeToolRef.current = activeTool
  const activeSectionRef = useRef(activeSection)
  activeSectionRef.current = activeSection

  // Mouse / Tablet Drawing Pointer Refs
  const isPointerDownRef = useRef(false)
  const isSpacePressedRef = useRef(false)
  const isPanningDragRef = useRef(false)
  const activeStrokeRef = useRef<Stroke | null>(null)
  const panStartRef = useRef<{ clientX: number; clientY: number; initPanX: number; initPanY: number } | null>(null)
  const lastEraserPointRef = useRef<{ x: number; y: number } | null>(null)
  const mouseCanvasPosRef = useRef<{ x: number; y: number } | null>(null)
  const selectionBoxRef = useRef<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null)

  // Element Selection & Drag Refs
  const shapeDragRef = useRef<ShapeDragState | null>(null)
  const pendingOcrStrokeIdsRef = useRef<string[]>([])
  const ocrTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (ocrTimerRef.current !== null) {
        window.clearTimeout(ocrTimerRef.current)
      }
    }
  }, [])

  const boardPalette = useMemo(
    () => resolveBoardPalette(settings.backgroundColor),
    [settings.backgroundColor]
  )
  const themeTokens = useMemo(
    () => resolveThemeTokens(settings.backgroundColor, settings.theme, boardPalette),
    [settings.backgroundColor, settings.theme, boardPalette]
  )
  const fontCss = FONTS[settings.font].css

  /* ---------------- Sync HTML body attributes ---------------- */
  useEffect(() => {
    document.body.setAttribute('data-theme', settings.theme)
    document.body.setAttribute('data-font', settings.font)
  }, [settings.theme, settings.font])

  /* ---------------- Toasts helper ---------------- */
  const addToast = useCallback((kind: 'info' | 'success' | 'error', message: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    setToasts((ts) => [...ts, { id, kind, message }])
    window.setTimeout(() => {
      setToasts((ts) => ts.filter((t) => t.id !== id))
    }, 3800)
  }, [])

  /* ---------------- IPC click-through & maximize listener ---------------- */
  useEffect(() => {
    const api = window.glassAPI
    if (!api) return
    api.isMaximized?.().then((val) => setIsMaximized(!!val))
    const unmax = api.onMaximizedChanged?.((val) => setIsMaximized(val))
    const unclick = api.onClickThroughChanged((val) => setClickThrough(val))
    return () => {
      unmax?.()
      unclick?.()
    }
  }, [])

  /* ---------------- Canvas Resize Handler ---------------- */
  const updateCanvasSizes = useCallback(() => {
    const w = window.innerWidth
    const h = window.innerHeight
    if (committedCanvasRef.current) {
      if (committedCanvasRef.current.width !== w || committedCanvasRef.current.height !== h) {
        committedCanvasRef.current.width = w
        committedCanvasRef.current.height = h
      }
    }
  }, [])

  useEffect(() => {
    updateCanvasSizes()
    window.addEventListener('resize', updateCanvasSizes)
    return () => window.removeEventListener('resize', updateCanvasSizes)
  }, [updateCanvasSizes, activeSection?.id])

  const activeProjectId = activeProject?.id || activeSection?.projectId || null

  // Persist per-project multi-thread chat store only after it has hydrated for the active project
  useEffect(() => {
    if (!activeProjectId || hydratedChatProjectIdRef.current !== activeProjectId) return
    const t = window.setTimeout(() => {
      if (hydratedChatProjectIdRef.current === activeProjectId) {
        void persistProjectChatStore(activeProjectId, chatStore)
      }
    }, 150)
    return () => window.clearTimeout(t)
  }, [chatStore, activeProjectId])

  useEffect(() => {
    const flushChatOnUnload = (): void => {
      if (activeProjectId && hydratedChatProjectIdRef.current === activeProjectId) {
        void persistProjectChatStore(activeProjectId, chatStoreRef.current)
      }
    }
    window.addEventListener('beforeunload', flushChatOnUnload)
    return () => window.removeEventListener('beforeunload', flushChatOnUnload)
  }, [activeProjectId])

  useEffect(() => {
    if (!activeProjectId) return
    const key = getProjectChatStorageKey(activeProjectId)
    const onStorage = (e: StorageEvent): void => {
      if (e.key === key && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue) as ProjectChatStore
          if (parsed && Array.isArray(parsed.threads) && parsed.threads.length > 0) {
            hydratedChatProjectIdRef.current = activeProjectId
            chatStoreRef.current = parsed
            setChatStore(parsed)
          }
        } catch {
          /* ignore */
        }
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [activeProjectId])

  useEffect(() => {
    if (!activeSection?.id) return
    const t = window.setTimeout(() => {
      saveSectionViewLocal(activeSection.id, view)
    }, 300)
    return () => window.clearTimeout(t)
  }, [view, activeSection?.id])

  const handleOpenSection = useCallback(
    async (
      section: SectionItem,
      project: ProjectItem | null,
      opts?: { openChat?: boolean; threadId?: string; newThread?: boolean }
    ) => {
      const targetProjectId = project?.id || section.projectId || 'proj-general'
      const prevProjectId = activeProject?.id || activeSection?.projectId || null

      if (activeSection?.id && activeSection.id !== section.id) {
        await flushSave()
        saveSectionViewLocal(activeSection.id, viewRef.current)
      }
      if (
        prevProjectId &&
        prevProjectId !== targetProjectId &&
        hydratedChatProjectIdRef.current === prevProjectId
      ) {
        await persistProjectChatStore(prevProjectId, chatStoreRef.current)
      }

      const needsChatHydration =
        prevProjectId !== targetProjectId ||
        hydratedChatProjectIdRef.current !== targetProjectId ||
        Boolean(opts?.newThread) ||
        Boolean(opts?.threadId)
      const loadSeq = ++chatLoadSeqRef.current
      if (prevProjectId !== targetProjectId || hydratedChatProjectIdRef.current !== targetProjectId) {
        hydratedChatProjectIdRef.current = null
      }

      setActiveProject(project)
      setActiveSection(section)
      setActiveChatProjectId(targetProjectId)
      setSelectedIds([])
      setIsKnowledgeHubOpen(false)
      if (opts?.openChat) {
        setIsRightPanelOpen(true)
      }
      setView(loadSectionViewLocal(section.id))
      try {
        localStorage.setItem(LAST_SECTION_KEY, section.id)
      } catch {
        /* ignore */
      }
      setLastSectionId(section.id)

      if (prevProjectId !== targetProjectId) {
        const previewLocal = loadProjectChatStoreLocal(targetProjectId, [section.id])
        chatStoreRef.current = previewLocal
        setChatStore(previewLocal)
      }

      let secs: SectionItem[] = [section]
      if (targetProjectId) {
        try {
          const fetched = await fetchSections(targetProjectId)
          if (fetched.length > 0) secs = fetched
        } catch {
          /* keep fallback */
        }
      }
      if (chatLoadSeqRef.current !== loadSeq) return
      setProjectSections(secs)

      if (!needsChatHydration) return

      // Load confined project multi-thread chat store from SQLite before allowing writes
      const legacyIds = Array.from(new Set([section.id, ...secs.map((s) => s.id)]))
      const loaded = await fetchProjectChatStore(targetProjectId, legacyIds)
      if (chatLoadSeqRef.current !== loadSeq) return

      let finalStore = loaded
      if (opts?.newThread) {
        const created = createChatThread(`Chat ${loaded.threads.length + 1}`)
        finalStore = { activeThreadId: created.id, threads: [created, ...loaded.threads] }
      } else if (opts?.threadId && loaded.threads.some((t) => t.id === opts.threadId)) {
        finalStore = { ...loaded, activeThreadId: opts.threadId }
      }

      hydratedChatProjectIdRef.current = targetProjectId
      chatStoreRef.current = finalStore
      setChatStore(finalStore)

      if (opts?.newThread || opts?.threadId) {
        void persistProjectChatStore(targetProjectId, finalStore)
      }
    },
    [activeProject?.id, activeSection?.id, activeSection?.projectId, flushSave]
  )

  const handleGoHome = useCallback(async () => {
    const targetProjectId = activeProject?.id || activeSection?.projectId || null
    if (activeSection?.id) {
      await flushSave()
      saveSectionViewLocal(activeSection.id, viewRef.current)
    }
    if (targetProjectId && hydratedChatProjectIdRef.current === targetProjectId) {
      await persistProjectChatStore(targetProjectId, chatStoreRef.current)
    }
    hydratedChatProjectIdRef.current = null
    chatLoadSeqRef.current++
    setSelectedIds([])
    setIsRightPanelOpen(false)
    setIsKnowledgeHubOpen(false)
    setActiveSection(null)
    setActiveProject(null)
  }, [activeProject?.id, activeSection?.id, activeSection?.projectId, flushSave])

  const updateAndPersistChatStore = useCallback(
    (projectId: string | null, updater: (prev: ProjectChatStore) => ProjectChatStore): ProjectChatStore => {
      const next = updater(chatStoreRef.current)
      chatStoreRef.current = next
      setChatStore(next)
      if (projectId && hydratedChatProjectIdRef.current === projectId) {
        void persistProjectChatStore(projectId, next)
      }
      return next
    },
    []
  )

  const handleSelectChatThread = useCallback(
    (threadId: string) => {
      updateAndPersistChatStore(activeProjectId, (prev) => {
        if (!prev.threads.some((t) => t.id === threadId)) return prev
        return { ...prev, activeThreadId: threadId }
      })
    },
    [activeProjectId, updateAndPersistChatStore]
  )

  const handleCreateChatThread = useCallback(
    (title?: string) => {
      updateAndPersistChatStore(activeProjectId, (prev) => {
        const nextNum = prev.threads.length + 1
        const created = createChatThread(title?.trim() || `Chat ${nextNum}`)
        return {
          activeThreadId: created.id,
          threads: [created, ...prev.threads]
        }
      })
      addToast('info', 'Started a fresh chat thread (low token context)')
    },
    [activeProjectId, addToast, updateAndPersistChatStore]
  )

  const handleRenameChatThread = useCallback(
    (threadId: string, title: string) => {
      const clean = title.trim()
      if (!clean) return
      updateAndPersistChatStore(activeProjectId, (prev) => ({
        ...prev,
        threads: prev.threads.map((t) =>
          t.id === threadId ? { ...t, title: clean, updatedAt: Date.now() } : t
        )
      }))
    },
    [activeProjectId, updateAndPersistChatStore]
  )

  const handleDeleteChatThread = useCallback(
    (threadId: string) => {
      updateAndPersistChatStore(activeProjectId, (prev) => {
        const remaining = prev.threads.filter((t) => t.id !== threadId)
        if (remaining.length === 0) {
          const fresh = createChatThread('Chat 1')
          return { activeThreadId: fresh.id, threads: [fresh] }
        }
        const nextActive =
          prev.activeThreadId === threadId ? remaining[0].id : prev.activeThreadId
        return { activeThreadId: nextActive, threads: remaining }
      })
    },
    [activeProjectId, updateAndPersistChatStore]
  )

  const handleQuickCreateSection = useCallback(
    async (title: string) => {
      const targetProjectId = activeProject?.id || activeSection?.projectId
      if (!targetProjectId) return
      const created = await createNewSection({ projectId: targetProjectId, title })
      await handleOpenSection(created, activeProject)
    },
    [activeProject, activeSection?.projectId, handleOpenSection]
  )

  /* ---------------- AI Chat, Whiteboard as Context & Knowledge Hub ---------------- */
  const summarizeCurrentBoard = useCallback((): string => {
    const current = boardRef.current
    const parts: string[] = []

    if (current.textNodes.length > 0) {
      parts.push(`Text Notes (${current.textNodes.length}):`)
      current.textNodes.forEach((t, i) => {
        parts.push(
          `  ${i + 1}. [${t.title || 'Note'}] at (${Math.round(t.x)}, ${Math.round(t.y)}): ${t.text.slice(0, 300)}`
        )
      })
    }

    if (current.diagramNodes && current.diagramNodes.length > 0) {
      parts.push(`Diagrams (${current.diagramNodes.length}):`)
      current.diagramNodes.forEach((d, i) => {
        parts.push(
          `  ${i + 1}. [Diagram: ${d.title || 'Untitled'}] at (${Math.round(d.x)}, ${Math.round(d.y)}) with ${d.nodes.length} nodes and ${d.edges.length} connections.`
        )
      })
    }

    if (current.equationNodes.length > 0) {
      parts.push(`LaTeX Equations (${current.equationNodes.length}):`)
      current.equationNodes.forEach((e, i) => {
        parts.push(`  ${i + 1}. ${e.latex}`)
      })
    }

    if (current.codeNodes && current.codeNodes.length > 0) {
      parts.push(`Code Blocks (${current.codeNodes.length}):`)
      current.codeNodes.forEach((c, i) => {
        parts.push(
          `  ${i + 1}. [${c.title || 'Code Studio'}] tabs: ${c.tabs.map((t) => t.title).join(', ')}`
        )
      })
    }

    if (current.videoNodes && current.videoNodes.length > 0) {
      parts.push(`YouTube Videos (${current.videoNodes.length}):`)
      current.videoNodes.forEach((v, i) => {
        parts.push(`  ${i + 1}. [${v.title || 'Video'}] URL: ${v.url}`)
      })
    }

    return parts.length > 0 ? parts.join('\n') : 'Whiteboard is currently empty.'
  }, [boardRef])

  const handleSendChatMessage = useCallback(
    async (
      query: string,
      attachments?: ChatAttachment[],
      options?: { sourceIds?: string[]; includeProjectContext?: boolean }
    ) => {
      if (!isAiConfiguredRef.current) {
        addToast('info', aiReasonRef.current || 'Configure AI Settings to enable AI features.')
        setSettingsOpen(true)
        return
      }
      const api = window.glassAPI
      if (!api) {
        addToast('error', 'AI IPC bridge unavailable')
        return
      }

      const requestProjectId = activeProjectId
      const targetThreadId = activeThread?.id || chatStoreRef.current.activeThreadId
      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: query,
        timestamp: Date.now(),
        sectionId: activeSection?.id,
        sectionTitle: activeSection?.title
      }
      const nextWithUser = [...messages, userMsg]
      updateAndPersistChatStore(requestProjectId, (prev) => ({
        ...prev,
        threads: prev.threads.map((t) => {
          if (t.id !== targetThreadId) return t
          const updatedMsgs = [...t.messages, userMsg]
          const isDefaultTitle = /^(Chat \d+|New Chat)$/i.test(t.title.trim())
          return {
            ...t,
            title: isDefaultTitle ? deriveThreadTitle(updatedMsgs, t.title) : t.title,
            messages: updatedMsgs,
            updatedAt: userMsg.timestamp
          }
        })
      }))
      setAiBusy(true)

      const currentSettings = settingsRef.current
      const activeProvider = currentSettings.ai.provider
      const activeModel =
        activeProvider === 'ollama'
          ? currentSettings.ai.ollamaModel
          : currentSettings.ai.byokModels[activeProvider]

      try {
        const history = nextWithUser.slice(-10).map((m) => ({ role: m.role, content: m.content }))
        const boardContext = summarizeCurrentBoard()
        const res = await api.runAI({
          provider: activeProvider,
          model: activeModel,
          ollamaHost: currentSettings.ai.ollamaHost,
          temperature: currentSettings.ai.temperature,
          isChat: true,
          prompt: query,
          chatHistory: history,
          boardContext,
          projectId: requestProjectId ?? undefined,
          sectionId: activeSection?.id,
          includeProjectContext: options?.includeProjectContext ?? true,
          sourceIds: options?.sourceIds,
          attachments
        })

        if (res.ok && res.reply) {
          const aiMsg: ChatMessage = {
            id: `ai-${Date.now()}`,
            role: 'assistant',
            content: res.reply,
            timestamp: Date.now(),
            sectionId: activeSection?.id,
            sectionTitle: activeSection?.title
          }
          if (hydratedChatProjectIdRef.current === requestProjectId) {
            updateAndPersistChatStore(requestProjectId, (prev) => ({
              ...prev,
              threads: prev.threads.map((t) =>
                t.id === targetThreadId
                  ? { ...t, messages: [...t.messages, aiMsg], updatedAt: aiMsg.timestamp }
                  : t
              )
            }))
          } else if (requestProjectId) {
            const latest = await fetchProjectChatStore(requestProjectId)
            const nextStore: ProjectChatStore = {
              ...latest,
              threads: latest.threads.map((t) =>
                t.id === targetThreadId
                  ? { ...t, messages: [...t.messages, aiMsg], updatedAt: aiMsg.timestamp }
                  : t
              )
            }
            await persistProjectChatStore(requestProjectId, nextStore)
          }
        } else {
          addToast('error', `AI: ${res.error || 'Empty response'}`)
        }
      } catch (err) {
        addToast('error', `AI request failed: ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        setAiBusy(false)
      }
    },
    [
      activeThread?.id,
      messages,
      addToast,
      summarizeCurrentBoard,
      activeProjectId,
      activeSection?.id,
      activeSection?.title,
      updateAndPersistChatStore
    ]
  )

  const handleGenerateTutorial = useCallback(
    async (topic: string) => {
      if (!isAiConfiguredRef.current) {
        addToast('info', aiReasonRef.current || 'Configure AI Settings to enable AI features.')
        setSettingsOpen(true)
        return
      }
      const api = window.glassAPI
      if (!api) {
        addToast('error', 'AI bridge unavailable')
        return
      }

      setAiBusy(true)
      const shortTitle = topic.split('\n')[0].slice(0, 60)
      addToast('info', `Planning visual tutorial on "${shortTitle}"...`)

      const currentSettings = settingsRef.current
      const activeProvider = currentSettings.ai.provider
      const activeModel =
        activeProvider === 'ollama'
          ? currentSettings.ai.ollamaModel
          : currentSettings.ai.byokModels[activeProvider]

      try {
        const boardContext = summarizeCurrentBoard()
        const res = await api.runAI({
          provider: activeProvider,
          model: activeModel,
          ollamaHost: currentSettings.ai.ollamaHost,
          temperature: currentSettings.ai.temperature,
          isTutorial: true,
          tutorialTopic: topic,
          boardContext
        })

        if (!res.ok || !res.tutorial) {
          addToast('error', res.error || 'Failed to generate visual tutorial.')
          return
        }

        const tut = res.tutorial
        const curView = viewRef.current
        const placement = findFreeBoardPlacement(boardRef.current, 540, 220, curView, {
          gap: 32
        })
        const startX = placement.x
        const startY = placement.y

        // Header Banner Note
        const headerNode: TextNode = {
          id: `tut-header-${Date.now()}`,
          x: startX,
          y: startY,
          w: 540,
          h: 170,
          text: `# 🎓 Tutorial: ${tut.topic}\n\n> ${tut.overview}\n\n*Follow the visual cards & interactive diagrams below.*`,
          title: `Tutorial: ${tut.topic}`,
          fontSize: 15,
          color: 'accent',
          bg: undefined,
          source: 'ai',
          createdAt: Date.now()
        }

        const newTextNodes: TextNode[] = [headerNode]
        const newDiagramNodes: DiagramNode[] = []
        const newEquationNodes: EquationNode[] = []
        const newCodeNodes: CodeNode[] = []
        const newShapeNodes: ShapeNode[] = []

        const stepY = startY + 210

        tut.steps.forEach((st, i) => {
          const cardX = startX + i * 520
          const bullets = st.keyPoints?.map((k) => `- ${k}`).join('\n') || ''
          const cardText = `### ${st.title}\n\n${st.explanation}\n\n${bullets}`

          newTextNodes.push({
            id: `tut-step-${Date.now()}-${i}`,
            x: cardX,
            y: stepY,
            w: 460,
            h: 260,
            text: cardText,
            title: st.title,
            fontSize: 14,
            color: 'ink',
            bg: undefined,
            source: 'ai',
            createdAt: Date.now() + i
          })

          if (i < tut.steps.length - 1) {
            newShapeNodes.push({
              id: `tut-arrow-${Date.now()}-${i}`,
              shape: 'arrow',
              x: cardX + 468,
              y: stepY + 125,
              w: 44,
              h: 0,
              color: 'accent',
              strokeWidth: 3
            })
          }

          // Interactive Diagram Node for each step
          let diagramSource = ''
          if (Array.isArray(st.diagramNodes) && st.diagramNodes.length > 0) {
            diagramSource = JSON.stringify({
              title: st.title,
              diagramType: 'flowchart',
              nodes: st.diagramNodes,
              edges: st.diagramEdges || []
            })
          } else {
            diagramSource = st.diagramMermaid || `${st.title}\n${st.explanation}`
          }

          const parsedFlow = parseAndCleanReactFlow(diagramSource)
          const diagNode = buildDiagramNodeFromData(parsedFlow, {
            x: cardX,
            y: stepY + 330,
            w: 460,
            h: 320
          })
          newDiagramNodes.push(diagNode)

          if (st.equationLatex) {
            newEquationNodes.push({
              id: `tut-eq-${Date.now()}-${i}`,
              x: cardX,
              y: stepY + 680,
              w: 460,
              latex: st.equationLatex,
              fontSize: 20,
              color: 'accent',
              createdAt: Date.now() + i
            })
          }

          if (st.codeSnippet && st.codeSnippet.code) {
            const tabId = `tab-${Date.now()}-${i}`
            newCodeNodes.push({
              id: `tut-code-${Date.now()}-${i}`,
              x: cardX,
              y: stepY + (st.equationLatex ? 780 : 680),
              w: 460,
              h: 280,
              title: `${st.title} Code`,
              tabs: [
                {
                  id: tabId,
                  title: `${st.codeSnippet.language || 'code'}.py`,
                  language: st.codeSnippet.language || 'python',
                  code: st.codeSnippet.code
                }
              ],
              activeTabId: tabId,
              createdAt: Date.now() + i
            })
          }
        })

        update((b) => ({
          ...b,
          textNodes: [...b.textNodes, ...newTextNodes],
          diagramNodes: [...(b.diagramNodes ?? []), ...newDiagramNodes],
          equationNodes: [...b.equationNodes, ...newEquationNodes],
          codeNodes: [...(b.codeNodes ?? []), ...newCodeNodes],
          shapeNodes: [...b.shapeNodes, ...newShapeNodes]
        }))

        if (placement.nextPan) {
          setView((v) => ({
            ...v,
            panX: placement.nextPan!.panX,
            panY: placement.nextPan!.panY
          }))
        }

        window.glassAPI?.recordHistoryEvent?.({
          boardId: activeSection?.id || 'default-board',
          eventType: 'create',
          elementId: headerNode.id,
          description: `Created interactive whiteboard tutorial on: ${shortTitle}`,
          timestamp: Date.now()
        })

        addToast('success', `Created ${tut.steps.length}-step visual tutorial with diagrams on board!`)
      } catch (err: any) {
        addToast('error', `Tutorial generation error: ${err?.message || err}`)
      } finally {
        setAiBusy(false)
      }
    },
    [addToast, update, summarizeCurrentBoard, activeSection?.id]
  )

  const handleAddYouTubeToCanvas = useCallback(
    (urlOrId = '', title?: string) => {
      const trimmed = (urlOrId || '').trim()
      const match = trimmed
        ? trimmed.match(
          /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/|live\/))([a-zA-Z0-9_-]{11})/
        ) || (/^[a-zA-Z0-9_-]{11}$/.test(trimmed) ? [null, trimmed] : null)
        : null
      const videoId = match?.[1] || ''
      const cleanUrl = videoId
        ? trimmed.startsWith('http')
          ? trimmed
          : `https://www.youtube.com/watch?v=${videoId}`
        : ''

      const curView = viewRef.current
      const cardW = 540
      const cardH = 460
      const placement = findFreeBoardPlacement(boardRef.current, cardW, cardH, curView, {
        gap: 28
      })

      const tabId = `vtab-${Date.now().toString(36)}`
      const tabTitle = title || (videoId ? `YouTube (${videoId})` : 'Video 1')
      const initialTab: VideoTabItem = {
        id: tabId,
        title: tabTitle,
        url: cleanUrl,
        videoId,
        currentTime: 0
      }

      const newVideo: VideoNode = {
        id: `video-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        x: placement.x,
        y: placement.y,
        w: cardW,
        h: cardH,
        url: cleanUrl,
        videoId,
        title: title || 'YouTube Study Hub',
        currentTime: 0,
        tabs: [initialTab],
        activeTabId: tabId,
        createdAt: Date.now()
      }

      update((b) => ({
        ...b,
        videoNodes: [...(b.videoNodes ?? []), newVideo]
      }))
      setSelectedId(newVideo.id)
      setSelectedIds([newVideo.id])
      setActiveTool('select')

      if (placement.nextPan) {
        setView((v) => ({
          ...v,
          panX: placement.nextPan!.panX,
          panY: placement.nextPan!.panY
        }))
      }

      window.glassAPI?.recordHistoryEvent?.({
        boardId: activeSection?.id || 'default-board',
        eventType: 'create',
        elementId: newVideo.id,
        description: `Added YouTube study container (${tabTitle})`,
        timestamp: Date.now()
      })

      addToast('success', 'Added interactive YouTube container — paste any link or watch & take notes!')
    },
    [update, addToast, activeSection?.id]
  )

  const handleInsertToNotes = useCallback(
    (text: string, title?: string) => {
      const curView = viewRef.current
      const zoom = Math.max(0.15, curView.zoom)
      const screenSafe = getSafeViewportScreenRect()
      const availW = Math.max(260, screenSafe.right - screenSafe.left)
      const availH = Math.max(200, screenSafe.bottom - screenSafe.top)

      // Compact fixed-size scrollable section fitted well inside the visible viewport
      const noteW = Math.round(
        Math.min(Math.max(240, availW / zoom - 24), Math.min(420, Math.max(280, (availW * 0.44) / zoom)))
      )
      const noteH = Math.round(
        Math.min(Math.max(180, availH / zoom - 24), Math.min(320, Math.max(200, (availH * 0.42) / zoom)))
      )

      const placement = findFreeBoardPlacement(boardRef.current, noteW, noteH, curView, {
        gap: 24
      })

      const node: TextNode = {
        id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        x: placement.x,
        y: placement.y,
        w: noteW,
        h: noteH,
        text,
        title,
        style: 'body',
        fontSize: 15,
        color: 'ink',
        bg: undefined,
        source: 'ai',
        createdAt: Date.now()
      }
      update((b) => ({ ...b, textNodes: [...b.textNodes, node] }))
      setSelectedIds([node.id])
      if (placement.nextPan) {
        setView((v) => ({
          ...v,
          panX: placement.nextPan!.panX,
          panY: placement.nextPan!.panY
        }))
      }
      addToast('success', 'Inserted resizable note section in free board space')
    },
    [update, addToast]
  )

  const handleNotebookAction = useCallback(
    async (
      actionType: 'study_guide' | 'faq' | 'podcast' | 'recall' | 'patterns',
      customQuery?: string,
      activeSourceIds?: string[]
    ) => {
      if (!isAiConfiguredRef.current) {
        addToast('info', aiReasonRef.current || 'Configure AI Settings to enable AI features.')
        setSettingsOpen(true)
        return
      }
      const api = window.glassAPI
      if (!api) return

      setAiBusy(true)
      const currentSettings = settingsRef.current
      const activeProvider = currentSettings.ai.provider
      const activeModel =
        activeProvider === 'ollama'
          ? currentSettings.ai.ollamaModel
          : currentSettings.ai.byokModels[activeProvider]

      try {
        let actionPrompt = ''
        if (actionType === 'study_guide') {
          actionPrompt =
            'Create a comprehensive, beautifully structured Study Guide summarizing all core definitions, architectures, key takeaways, and formulas from active knowledge sources.'
        } else if (actionType === 'faq') {
          actionPrompt =
            'Generate an in-depth FAQ and Practice Self-Quiz with 5 key review questions and answer rationales for active recall.'
        } else if (actionType === 'podcast') {
          actionPrompt =
            'Write a lively 2-host podcast discussion script (Host 1: curious learner, Host 2: domain expert) explaining the concepts intuitively.'
        } else if (actionType === 'recall') {
          const events = (await api.getHistoryEvents?.(activeSection?.id || 'default-board', 40)) || []
          const eventSummary = events
            .map(
              (e) =>
                `- ${new Date(e.timestamp).toLocaleTimeString()}: ${e.eventType} (${e.description || e.elementId})`
            )
            .join('\n')
          actionPrompt = customQuery
            ? `Answer the user's question about their whiteboard context & history: "${customQuery}".\n\nChronological history:\n${eventSummary || 'No logged events yet — infer progression from board notes & positions.'}`
            : `Trace my line of thought on this board based on element history & spatial layout:\n${eventSummary || 'Infer chronological progression from the board items.'}\n\nExplain how I arrived at these conclusions, what was built first, and how the ideas connect.`
        } else if (actionType === 'patterns') {
          const boardContext = summarizeCurrentBoard()
          actionPrompt = `Analyze everything on this whiteboard:\n\n${boardContext}\n\nFind recurring patterns, concept relationships, potential architecture gaps, and contradictions.`
        }

        const boardContext = summarizeCurrentBoard()
        const res = await api.runAI({
          provider: activeProvider,
          model: activeModel,
          ollamaHost: currentSettings.ai.ollamaHost,
          temperature: currentSettings.ai.temperature,
          isChat: true,
          prompt: actionPrompt,
          boardContext,
          projectId: activeProjectId ?? undefined,
          sectionId: activeSection?.id,
          sourceIds: activeSourceIds
        })

        if (res.ok && res.reply) {
          const title = customQuery
            ? `Board Recall: ${customQuery.slice(0, 32)}`
            : actionType === 'study_guide'
              ? 'Study Guide'
              : actionType === 'faq'
                ? 'FAQ & Quiz'
                : actionType === 'podcast'
                  ? 'Podcast Script'
                  : actionType === 'recall'
                    ? 'Line of Thought (Recall)'
                    : 'Concept Patterns & Synergy'

          handleInsertToNotes(res.reply, title)
          addToast('success', `Created ${title} and added to whiteboard notes!`)
        } else {
          addToast('error', res.error || 'Failed to complete synthesis.')
        }
      } catch (err: any) {
        addToast('error', `Synthesis error: ${err?.message || err}`)
      } finally {
        setAiBusy(false)
      }
    },
    [addToast, handleInsertToNotes, summarizeCurrentBoard, activeProjectId, activeSection?.id]
  )

  const handleInsertDiagram = useCallback(
    async (text: string) => {
      if (!isAiConfiguredRef.current) {
        addToast('info', aiReasonRef.current || 'Configure AI Settings to enable AI features.')
        setSettingsOpen(true)
        return
      }
      const startView = viewRef.current
      const screenStart = getSafeViewportScreenRect()
      const startZoom = Math.max(0.15, startView.zoom)
      const cx = Math.round(((screenStart.left + screenStart.right) / 2 - startView.panX) / startZoom - 300)
      const cy = Math.round(((screenStart.top + screenStart.bottom) / 2 - startView.panY) / startZoom - 210)

      setAiBusy(true)
      addToast('info', '✨ Generating interactive React Flow diagram...')

      const currentSettings = settingsRef.current
      const activeProvider = currentSettings.ai.provider
      const activeModel =
        activeProvider === 'ollama'
          ? currentSettings.ai.ollamaModel
          : currentSettings.ai.byokModels[activeProvider] || DEFAULT_PROVIDER_MODELS[activeProvider]

      let parsedFlow: CleanReactFlowResult | null = null
      const api = window.glassAPI

      try {
        if (api) {
          const res = await api.runAI({
            provider: activeProvider,
            model: activeModel,
            ollamaHost: currentSettings.ai.ollamaHost,
            temperature: currentSettings.ai.temperature,
            isChat: false,
            prompt: `DIAGRAM_GEN: ${text.slice(0, 1200)}`,
            cursorX: cx,
            cursorY: cy,
            canvasWidth: window.innerWidth,
            canvasHeight: window.innerHeight
          })

          if (res && res.ok && res.reply && res.reply.trim().length > 0) {
            parsedFlow = parseAndCleanReactFlow(res.reply)
          }
        }
      } catch (err) {
        console.warn('AI Diagram generation notice:', err)
      } finally {
        setAiBusy(false)
      }

      if (!parsedFlow) {
        parsedFlow = parseAndCleanReactFlow(text)
      }

      const curView = viewRef.current
      const zoom = Math.max(0.15, curView.zoom)
      const screenSafe = getSafeViewportScreenRect()
      const availW = Math.max(300, screenSafe.right - screenSafe.left)
      const availH = Math.max(240, screenSafe.bottom - screenSafe.top)
      const maxDiagW = Math.max(300, Math.round((availW * 0.78) / zoom))
      const maxDiagH = Math.max(220, Math.round((availH * 0.72) / zoom))

      const draftNode = buildDiagramNodeFromData(parsedFlow, {
        x: 0,
        y: 0,
        w: Math.min(580, maxDiagW),
        h: Math.min(420, maxDiagH)
      })
      const finalW = Math.min(draftNode.w, maxDiagW)
      const finalH = Math.min(draftNode.h, maxDiagH)

      const placement = findFreeBoardPlacement(boardRef.current, finalW, finalH, curView, {
        topMargin: 48,
        gap: 28
      })

      const newDiagNode: DiagramNode = {
        ...draftNode,
        x: placement.x,
        y: placement.y,
        w: finalW,
        h: finalH
      }

      update((b) => ({
        ...b,
        diagramNodes: [...(b.diagramNodes ?? []), newDiagNode]
      }))
      setSelectedId(newDiagNode.id)
      setSelectedIds([newDiagNode.id])
      if (placement.nextPan) {
        setView((v) => ({
          ...v,
          panX: placement.nextPan!.panX,
          panY: placement.nextPan!.panY
        }))
      }
      addToast('success', `✨ Created ${newDiagNode.title} in free board space!`)
    },
    [update, addToast, setSelectedId, setSelectedIds]
  )

  /* ---------------- Left Dock Toolbar Handlers ---------------- */
  const handleAddShapeNode = useCallback(
    (
      shapeType: string,
      options?: {
        label?: string
        description?: string
        color?: string
        w?: number
        h?: number
        shapeId?: string
        animated?: boolean
      }
    ) => {
      const curBoard = boardRef.current
      const currentSelected = selectedIdRef.current
      const selectedDiag = curBoard.diagramNodes?.find((d) => d.id === currentSelected)
      const fallbackLabel = `${shapeType.charAt(0).toUpperCase() + shapeType.slice(1)} Step`
      const resolvedLabel = options?.label ?? fallbackLabel
      const sizeStyle =
        options?.w && options?.h ? { width: options.w, height: options.h } : undefined

      if (selectedDiag) {
        // Add shape node into the currently active diagram
        const newNodeId = `node-${Date.now().toString(36)}`
        const nodeCount = selectedDiag.nodes.length
        const posX = 180 + (nodeCount % 3) * 160
        const posY = 120 + Math.floor(nodeCount / 3) * 120

        const newNode = {
          id: newNodeId,
          type: shapeType,
          position: { x: posX, y: posY },
          ...(sizeStyle ? { style: sizeStyle } : {}),
          data: {
            label: resolvedLabel,
            description: options?.description || '',
            color: options?.color,
            bg: options?.color,
            w: options?.w,
            h: options?.h,
            shapeId: options?.shapeId,
            ...(options?.animated ? { animated: true } : {})
          }
        }

        update((b) => ({
          ...b,
          diagramNodes: (b.diagramNodes ?? []).map((d) =>
            d.id === selectedDiag.id ? { ...d, nodes: [...d.nodes, newNode] } : d
          )
        }))
        pushHistory()
        addToast('success', `Added ${options?.label || shapeType} to active diagram`)
      } else {
        // Create a new immersed diagram node at the center of the viewport containing this shape
        const cx = Math.round((window.innerWidth / 2 - viewRef.current.panX) / viewRef.current.zoom - 260)
        const cy = Math.round((window.innerHeight / 2 - viewRef.current.panY) / viewRef.current.zoom - 180)

        const newNode = {
          id: 'node-1',
          type: shapeType,
          position: { x: 200, y: 140 },
          ...(sizeStyle ? { style: sizeStyle } : {}),
          data: {
            label: resolvedLabel,
            description: options?.description || '',
            color: options?.color,
            bg: options?.color,
            w: options?.w,
            h: options?.h,
            shapeId: options?.shapeId,
            ...(options?.animated ? { animated: true } : {})
          }
        }

        const newDiag: DiagramNode = {
          id: `diag-${Date.now()}`,
          title: options?.label ? `${options.label} Diagram` : 'Interactive Diagram',
          nodes: [newNode],
          edges: [],
          x: cx,
          y: cy,
          w: Math.max(580, (options?.w ?? 140) + 360),
          h: Math.max(400, (options?.h ?? 90) + 260),
          createdAt: Date.now()
        }

        update((b) => ({
          ...b,
          diagramNodes: [...(b.diagramNodes ?? []), newDiag]
        }))
        setSelectedId(newDiag.id)
        setSelectedIds([newDiag.id])
        pushHistory()
        addToast('success', `Created diagram with ${options?.label || shapeType}`)
      }
    },
    [update, setSelectedId, setSelectedIds, pushHistory, addToast]
  )

  const handleAddStickyNote = useCallback(
    (color: string) => {
      handleAddShapeNode('sticky', {
        label: 'Quick Note',
        description: 'Double click to write your thought...',
        color
      })
    },
    [handleAddShapeNode]
  )

  const handleAddTemplate = useCallback(
    (templateId: string) => {
      const cx = Math.round((window.innerWidth / 2 - viewRef.current.panX) / viewRef.current.zoom - 340)
      const cy = Math.round((window.innerHeight / 2 - viewRef.current.panY) / viewRef.current.zoom - 240)

      const templateDiag = buildTemplateDiagram(templateId, { x: cx, y: cy })

      update((b) => ({
        ...b,
        diagramNodes: [...(b.diagramNodes ?? []), templateDiag]
      }))
      setSelectedId(templateDiag.id)
      setSelectedIds([templateDiag.id])
      setActiveTool('select')
      pushHistory()
      addToast('success', `✨ Created ${templateDiag.title} template!`)
    },
    [update, setSelectedId, setSelectedIds, pushHistory, addToast]
  )

  const handleAddCodeNode = useCallback(
    (initialTab?: CodeTabItem) => {
      const curView = viewRef.current
      const existingCount = boardRef.current.codeNodes?.length ?? 0
      const cardW = 580
      const cardH = 440
      const placement = findFreeBoardPlacement(boardRef.current, cardW, cardH, curView, {
        gap: 28
      })

      const tab: CodeTabItem = initialTab
        ? {
          ...initialTab,
          id: `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
        }
        : {
          id: `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          title: 'main.py',
          language: 'python',
          code: `# Python 3 — Press Ctrl+Enter or click Run\ndef greet(name: str) -> str:\n    return f"Hello, {name}!"\n\nprint(greet("Vexelboard"))\n`,
          stdin: '',
          output: null
        }

      const containerTitle = initialTab?.title || `Coding Tab ${existingCount + 1}`

      const newCodeNode: CodeNode = {
        id: `code-${Date.now().toString(36)}`,
        x: placement.x,
        y: placement.y,
        w: cardW,
        h: cardH,
        title: containerTitle,
        tabs: [tab],
        activeTabId: tab.id,
        createdAt: Date.now()
      }

      update((b) => ({
        ...b,
        codeNodes: [...(b.codeNodes ?? []), newCodeNode]
      }))
      setSelectedId(newCodeNode.id)
      setSelectedIds([newCodeNode.id])
      setActiveTool('select')
      if (placement.nextPan) {
        setView((v) => ({
          ...v,
          panX: placement.nextPan!.panX,
          panY: placement.nextPan!.panY
        }))
      }
      addToast('success', `Added "${containerTitle}" container — drag or resize anywhere`)
    },
    [update, setSelectedId, setSelectedIds, addToast]
  )

  /* ---------------- Multi-Screen Detached Chat Action Listener ---------------- */
  useEffect(() => {
    const api = window.glassAPI
    if (!api) return
    api.isDetachedChat?.().then((val) => setIsDetachedChat(!!val))
    const unDetached = api.onDetachedChatChanged?.((val) => setIsDetachedChat(val))
    const unAction = api.onDetachedAction?.((action) => {
      if (action.type === 'insertToNotes' && action.text) {
        handleInsertToNotes(action.text, action.title)
      } else if (action.type === 'insertDiagram' && action.text) {
        handleInsertDiagram(action.text)
      } else if (action.type === 'settingsUpdated' && action.ai) {
        patchSettings({ ai: action.ai })
      } else if (action.type === 'openKnowledgeHub') {
        setIsKnowledgeHubOpen(true)
      } else if (action.type === 'generateTutorial') {
        handleGenerateTutorial(action.topic || 'Current Whiteboard Context')
      } else if (action.type === 'addYouTubeToCanvas') {
        handleAddYouTubeToCanvas(action.url || '', action.title)
      }
    })
    return () => {
      unDetached?.()
      unAction?.()
    }
  }, [handleInsertToNotes, handleInsertDiagram, handleGenerateTutorial, handleAddYouTubeToCanvas, patchSettings])

  /* ---------------- Diagram Beautification & Handwriting Conversion ---------------- */
  const handleBeautifySelected = useCallback(async () => {
    if (!isAiConfiguredRef.current) {
      addToast('info', aiReasonRef.current || 'Configure AI Settings to enable AI features.')
      setSettingsOpen(true)
      return
    }
    // Cancel any pending debounced OCR so Beautify processes the full stroke set once
    if (ocrTimerRef.current !== null) {
      window.clearTimeout(ocrTimerRef.current)
      ocrTimerRef.current = null
      pendingOcrStrokeIdsRef.current = []
    }

    const currentSelectedIds = selectedIdsRef.current
    const curBoard = boardRef.current

    // If nothing currently selected, check if board has strokes or shapes to automatically select
    let targetIds = currentSelectedIds
    if (targetIds.length === 0) {
      if (curBoard.strokes.length > 0 || curBoard.shapeNodes.length > 0) {
        targetIds = [
          ...curBoard.strokes.map((s) => s.id),
          ...curBoard.shapeNodes.map((s) => s.id),
          ...curBoard.textNodes.map((t) => t.id),
          ...curBoard.equationNodes.map((eq) => eq.id)
        ]
        setSelectedIds(targetIds)
      } else {
        addToast('info', 'Draw a sketch or handwriting using the pen, then click Beautify!')
        return
      }
    }

    const bounds = getSelectionBounds(curBoard, targetIds)
    if (!bounds) {
      addToast('error', 'Could not determine boundaries of selected drawing.')
      return
    }

    const prepared = renderSelectedDiagramToImage(curBoard, targetIds, themeTokens)
    if (!prepared || !prepared.base64) {
      addToast('error', 'Could not render drawing for beautification.')
      return
    }

    const localResult = generateSmartLocalReactFlowDiagram(curBoard, targetIds)

    setIsBeautifying(true)
    setAiBusy(true)
    addToast('info', '✨ Beautifying drawing into clean shapes or text...')

    let parsedFlow: CleanReactFlowResult | null = null

    const api = window.glassAPI
    if (api) {
      const currentSettings = settingsRef.current
      const activeProvider = currentSettings.ai.provider
      const activeModel =
        activeProvider === 'ollama'
          ? currentSettings.ai.ollamaModel
          : currentSettings.ai.byokModels[activeProvider] || DEFAULT_PROVIDER_MODELS[activeProvider]

      try {
        const localHint =
          localResult.nodes.length > 0
            ? `Locally detected geometric shapes: ${localResult.nodes
              .map(
                (n) =>
                  `${n.type} (${n.data?.w ?? ''}x${n.data?.h ?? ''}) at (${n.position.x},${n.position.y})`
              )
              .join(', ')}.`
            : 'No closed geometric containers were detected locally; if the image is pure handwritten text, return {"isTextOnly": true, "recognizedText": "..."}.'

        const promptContext = [
          `Hand-drawn elements: ${prepared.strokeCount} strokes, ${prepared.shapeCount} shapes.`,
          localHint,
          prepared.textHints ? `Extracted textual notes/labels: ${prepared.textHints}` : '',
          `Bounding dimensions: ~${Math.round(bounds.w)}px wide by ~${Math.round(bounds.h)}px high (preserve exact 2D orientation and relative x/y layout).`
        ]
          .filter(Boolean)
          .join('\n')

        const res = await api.runAI({
          provider: activeProvider,
          model: activeModel,
          ollamaHost: currentSettings.ai.ollamaHost,
          isBeautifyDiagram: true,
          imageBase64: prepared.base64,
          prompt: promptContext,
          cursorX: Math.round(bounds.x + bounds.w / 2),
          cursorY: Math.round(bounds.y + bounds.h / 2),
          canvasWidth: window.innerWidth,
          canvasHeight: window.innerHeight
        })

        if (res && res.ok && res.reply && res.reply.trim().length > 0) {
          parsedFlow = parseAndCleanReactFlow(res.reply, {
            preservePositions: true,
            targetBounds: { w: bounds.w, h: bounds.h },
            localFallback: localResult
          })
        } else {
          throw new Error(res?.error || 'AI could not recognize drawing')
        }
      } catch (err: unknown) {
        console.warn('AI Beautify fallback:', err)
        const errMsg = (err as Error)?.message || 'AI unavailable'

        if (localResult.isTextOnly && prepared.strokeCount > 0) {
          try {
            const ocrRes = await api.runAI({
              provider: activeProvider,
              model: activeModel,
              ollamaHost: currentSettings.ai.ollamaHost,
              isHandwritingOCR: true,
              imageBase64: prepared.base64
            })
            if (ocrRes.ok && ocrRes.recognizedText?.trim()) {
              parsedFlow = {
                title: 'Recognized Text',
                nodes: [],
                edges: [],
                diagramType: 'flowchart',
                isTextOnly: true,
                recognizedText: ocrRes.recognizedText.trim()
              }
            }
          } catch {
            /* fall through to local result */
          }
        }

        if (!parsedFlow) {
          parsedFlow = localResult
          if (localResult.nodes.length > 0) {
            addToast('info', `AI notice: ${errMsg}. Converted drawn strokes using local shape library.`)
          }
        }
      } finally {
        setIsBeautifying(false)
        setAiBusy(false)
      }
    } else {
      parsedFlow = localResult
      setIsBeautifying(false)
      setAiBusy(false)
    }

    if (!parsedFlow) {
      parsedFlow = localResult
    }

    const idSet = new Set(targetIds)

    // Case 1: Pure handwritten text -> convert into a clean TextNode
    if (parsedFlow.isTextOnly && parsedFlow.recognizedText) {
      const textNode: TextNode = {
        id: `ocr-${Date.now()}`,
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        w: Math.max(240, Math.min(640, Math.round(bounds.w + 40))),
        text: parsedFlow.recognizedText,
        style: 'body',
        fontSize: 20,
        color: 'ink',
        source: 'ocr',
        createdAt: Date.now()
      }
      update((b) => ({
        ...b,
        strokes: b.strokes.filter((s) => !idSet.has(s.id)),
        shapeNodes: b.shapeNodes.filter((s) => !idSet.has(s.id)),
        textNodes: [...b.textNodes.filter((t) => !idSet.has(t.id)), textNode],
        equationNodes: b.equationNodes.filter((eq) => !idSet.has(eq.id))
      }))
      setSelectedId(textNode.id)
      setSelectedIds([textNode.id])
      pushHistory()
      addToast('success', '✨ Converted handwritten text into clean text! (Ctrl+Z to undo)')
      return
    }

    const effectiveFlow = parsedFlow.nodes.length > 0 ? parsedFlow : localResult
    if (effectiveFlow.nodes.length === 0) {
      addToast(
        'info',
        'No geometric shapes detected and handwriting OCR requires an AI vision provider in Settings.'
      )
      return
    }

    const newDiagNode = buildDiagramNodeFromData(effectiveFlow, {
      x: bounds.x,
      y: bounds.y,
      w: bounds.w,
      h: bounds.h
    })

    update((b) => ({
      ...b,
      strokes: b.strokes.filter((s) => !idSet.has(s.id)),
      shapeNodes: b.shapeNodes.filter((s) => !idSet.has(s.id)),
      textNodes: b.textNodes.filter((t) => !idSet.has(t.id)),
      equationNodes: b.equationNodes.filter((eq) => !idSet.has(eq.id)),
      diagramNodes: [...(b.diagramNodes ?? []), newDiagNode]
    }))

    setSelectedId(newDiagNode.id)
    setSelectedIds([newDiagNode.id])
    setActiveTool('select')
    pushHistory()
    addToast('success', `✨ Beautified sketch into ${newDiagNode.title}! (Ctrl+Z to undo)`)
  }, [update, pushHistory, addToast, setSelectedId, themeTokens])

  /* ---------------- Infinite Board: Fit to Content ---------------- */
  const handleFitToContent = useCallback(() => {
    const curBoard = boardRef.current
    const allX: number[] = []
    const allY: number[] = []

    for (const s of curBoard.strokes) {
      for (const [x, y] of s.points) {
        allX.push(x)
        allY.push(y)
      }
    }
    for (const sh of curBoard.shapeNodes) {
      allX.push(sh.x, sh.x + sh.w)
      allY.push(sh.y, sh.y + sh.h)
    }
    for (const t of curBoard.textNodes) {
      allX.push(t.x, t.x + (t.w ?? 260))
      allY.push(t.y, t.y + (t.h ?? 120))
    }
    for (const eq of curBoard.equationNodes) {
      allX.push(eq.x, eq.x + (eq.w ?? 200))
      allY.push(eq.y, eq.y + (eq.h ?? 80))
    }
    for (const d of curBoard.diagramNodes ?? []) {
      allX.push(d.x, d.x + (d.w ?? 640))
      allY.push(d.y, d.y + (d.h ?? 440))
    }
    for (const c of curBoard.codeNodes ?? []) {
      allX.push(c.x, c.x + (c.w ?? 560))
      allY.push(c.y, c.y + (c.h ?? 420))
    }
    for (const v of curBoard.videoNodes ?? []) {
      allX.push(v.x, v.x + (v.w ?? 540))
      allY.push(v.y, v.y + (v.h ?? 460))
    }

    if (allX.length === 0) {
      setView({ zoom: 1.0, panX: 0, panY: 0 })
      return
    }

    const minX = Math.min(...allX)
    const maxX = Math.max(...allX)
    const minY = Math.min(...allY)
    const maxY = Math.max(...allY)

    const contentW = Math.max(100, maxX - minX)
    const contentH = Math.max(100, maxY - minY)

    const availW = window.innerWidth - 60
    const availH = window.innerHeight - 120

    const scaleX = availW / (contentW + 160)
    const scaleY = availH / (contentH + 160)
    const nextZoom = Math.min(1.5, Math.max(0.25, Math.min(scaleX, scaleY)))

    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2

    const screenCenterX = window.innerWidth / 2
    const screenCenterY = window.innerHeight / 2

    const nextPanX = Math.round(screenCenterX - centerX * nextZoom)
    const nextPanY = Math.round(screenCenterY - centerY * nextZoom)

    setView({ zoom: nextZoom, panX: nextPanX, panY: nextPanY })
    addToast('info', 'Whiteboard view fitted to content')
  }, [addToast])

  /* ---------------- Multi-Element Group Drag Helpers ---------------- */
  const startMoveDrag = useCallback((targetIds: string[], startX: number, startY: number) => {
    pushHistory()
    const curBoard = boardRef.current
    const idSet = new Set(targetIds)
    const snapshots: DragSnapshot = {
      shapes: curBoard.shapeNodes
        .filter((s) => idSet.has(s.id))
        .map((s) => ({ id: s.id, initX: s.x, initY: s.y })),
      texts: curBoard.textNodes
        .filter((t) => idSet.has(t.id))
        .map((t) => ({ id: t.id, initX: t.x, initY: t.y })),
      equations: curBoard.equationNodes
        .filter((e) => idSet.has(e.id))
        .map((e) => ({ id: e.id, initX: e.x, initY: e.y })),
      diagrams: (curBoard.diagramNodes ?? [])
        .filter((d) => idSet.has(d.id))
        .map((d) => ({ id: d.id, initX: d.x, initY: d.y })),
      codes: (curBoard.codeNodes ?? [])
        .filter((c) => idSet.has(c.id))
        .map((c) => ({ id: c.id, initX: c.x, initY: c.y })),
      videos: (curBoard.videoNodes ?? [])
        .filter((v) => idSet.has(v.id))
        .map((v) => ({ id: v.id, initX: v.x, initY: v.y })),
      strokes: curBoard.strokes
        .filter((st) => idSet.has(st.id))
        .map((st) => ({
          id: st.id,
          initPoints: st.points.map(([x, y, p]) => [x, y, p] as InkPoint)
        }))
    }

    shapeDragRef.current = {
      kind: 'move',
      startPinchX: startX,
      startPinchY: startY,
      snapshots
    }
  }, [pushHistory])

  const applyMoveDelta = useCallback(
    (dx: number, dy: number) => {
      const drag = shapeDragRef.current
      if (!drag || drag.kind !== 'move' || !drag.snapshots) return
      const { shapes, texts, equations, diagrams, codes, videos, strokes } = drag.snapshots

      const shapeMap = new Map(shapes.map((s) => [s.id, { x: Math.round(s.initX + dx), y: Math.round(s.initY + dy) }]))
      const textMap = new Map(texts.map((t) => [t.id, { x: Math.round(t.initX + dx), y: Math.round(t.initY + dy) }]))
      const eqMap = new Map(equations.map((e) => [e.id, { x: Math.round(e.initX + dx), y: Math.round(e.initY + dy) }]))
      const diagMap = new Map((diagrams ?? []).map((d) => [d.id, { x: Math.round(d.initX + dx), y: Math.round(d.initY + dy) }]))
      const codeMap = new Map((codes ?? []).map((c) => [c.id, { x: Math.round(c.initX + dx), y: Math.round(c.initY + dy) }]))
      const videoMap = new Map((videos ?? []).map((v) => [v.id, { x: Math.round(v.initX + dx), y: Math.round(v.initY + dy) }]))
      const strokeMap = new Map(
        strokes.map((st) => [
          st.id,
          st.initPoints.map(([x, y, p]) => [Math.round(x + dx), Math.round(y + dy), p] as InkPoint)
        ])
      )

      update(
        (b) => ({
          ...b,
          shapeNodes: b.shapeNodes.map((s) => (shapeMap.has(s.id) ? { ...s, ...shapeMap.get(s.id)! } : s)),
          textNodes: b.textNodes.map((t) => (textMap.has(t.id) ? { ...t, ...textMap.get(t.id)! } : t)),
          equationNodes: b.equationNodes.map((e) => (eqMap.has(e.id) ? { ...e, ...eqMap.get(e.id)! } : e)),
          diagramNodes: (b.diagramNodes ?? []).map((d) => (diagMap.has(d.id) ? { ...d, ...diagMap.get(d.id)! } : d)),
          codeNodes: (b.codeNodes ?? []).map((c) => (codeMap.has(c.id) ? { ...c, ...codeMap.get(c.id)! } : c)),
          videoNodes: (b.videoNodes ?? []).map((v) => (videoMap.has(v.id) ? { ...v, ...videoMap.get(v.id)! } : v)),
          strokes: b.strokes.map((st) => (strokeMap.has(st.id) ? { ...st, points: strokeMap.get(st.id)! } : st))
        }),
        { history: false }
      )
    },
    [update]
  )

  const getCanvasCursor = (): string => {
    if (isPanningDragRef.current || panStartRef.current) return 'grabbing'
    if (isSpacePanning || activeTool === 'pan') return 'grab'
    if (shapeDragRef.current?.kind === 'move') return 'grabbing'
    if (activeTool === 'select') {
      if (mouseCanvasPosRef.current && selectedIdsRef.current.length > 0) {
        const bounds = getSelectionBounds(boardRef.current, selectedIdsRef.current)
        if (bounds) {
          const m = mouseCanvasPosRef.current
          const pad = 10 / viewRef.current.zoom
          if (
            m.x >= bounds.minX - pad &&
            m.x <= bounds.maxX + pad &&
            m.y >= bounds.minY - pad &&
            m.y <= bounds.maxY + pad
          ) {
            return 'move'
          }
        }
      }
      return 'default'
    }
    if (activeTool === 'pen') return 'crosshair'
    if (activeTool === 'text') return 'text'
    if (activeTool === 'equation') return 'crosshair'
    if (activeTool === 'eraser') {
      return eraserMode === 'paper' ? 'none' : 'crosshair'
    }
    return 'default'
  }

  /* ---------------- Pointer Events (Writing Pad / Stylus / Mouse) ---------------- */
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    isPointerDownRef.current = true

    // Infinite Pan check: Hand tool, spacebar held, middle click (button 1), or Alt+click
    if (
      activeTool === 'pan' ||
      isSpacePressedRef.current ||
      e.button === 1 ||
      (e.altKey && activeTool !== 'pen')
    ) {
      isPanningDragRef.current = true
      panStartRef.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        initPanX: viewRef.current.panX,
        initPanY: viewRef.current.panY
      }
      return
    }

    const canvasPt = screenToCanvas(e.clientX, e.clientY, viewRef.current)
    mouseCanvasPosRef.current = { x: canvasPt.x, y: canvasPt.y }

    if (activeTool === 'pen') {
      const p: [number, number, number] = [canvasPt.x, canvasPt.y, e.pressure || 0.5]
      const stroke: Stroke = {
        id: `st-${Date.now()}`,
        points: [p],
        color: penColorRef.current,
        size: settingsRef.current.inkSize,
        penType: settingsRef.current.penType ?? 'fountain'
      }
      activeStrokeRef.current = stroke
      return
    }

    if (activeTool === 'text') {
      const newNode: TextNode = {
        id: `text-${Date.now()}`,
        x: Math.round(canvasPt.x),
        y: Math.round(canvasPt.y),
        text: 'Type your note here...',
        style: 'body',
        fontSize: 18,
        color: 'ink',
        source: 'manual',
        createdAt: Date.now()
      }
      update((b) => ({ ...b, textNodes: [...b.textNodes, newNode] }))
      setSelectedIds([newNode.id])
      setActiveTool('select')
      return
    }

    if (activeTool === 'equation') {
      const newEq: EquationNode = {
        id: `eq-${Date.now()}`,
        x: Math.round(canvasPt.x),
        y: Math.round(canvasPt.y),
        latex: 'f(x) = \\sigma(W x + b)',
        fontSize: 22,
        color: 'ink',
        createdAt: Date.now()
      }
      update((b) => ({ ...b, equationNodes: [...b.equationNodes, newEq] }))
      setSelectedIds([newEq.id])
      setActiveTool('select')
      return
    }

    if (activeTool === 'select') {
      const curBoard = boardRef.current

      // 1. Check if clicked near a corner resize handle of an already selected single shape
      const currentSelected = selectedIdsRef.current
      if (currentSelected.length === 1) {
        const hitTol = 14 / viewRef.current.zoom
        for (const s of curBoard.shapeNodes) {
          if (!currentSelected.includes(s.id)) continue
          const pad = 4
          const sx = s.w < 0 ? s.x + s.w : s.x
          const sy = s.h < 0 ? s.y + s.h : s.y
          const sw = Math.abs(s.w)
          const sh = Math.abs(s.h)

          const corners: Array<{ handle: 'nw' | 'ne' | 'se' | 'sw'; x: number; y: number }> = [
            { handle: 'nw', x: sx - pad, y: sy - pad },
            { handle: 'ne', x: sx + sw + pad, y: sy - pad },
            { handle: 'se', x: sx + sw + pad, y: sy + sh + pad },
            { handle: 'sw', x: sx - pad, y: sy + sh + pad }
          ]

          for (const c of corners) {
            if (Math.hypot(canvasPt.x - c.x, canvasPt.y - c.y) <= hitTol) {
              pushHistory()
              shapeDragRef.current = {
                targetId: s.id,
                kind: 'shape-resize',
                handle: c.handle,
                initX: s.x,
                initY: s.y,
                initW: s.w,
                initH: s.h,
                startPinchX: canvasPt.x,
                startPinchY: canvasPt.y
              }
              return
            }
          }
        }
      }

      // 2. Check shape hit
      const hitShape = [...curBoard.shapeNodes].reverse().find((s) => {
        const sw = Math.max(20, Math.abs(s.w))
        const sh = Math.max(20, Math.abs(s.h))
        const sx = s.w < 0 ? s.x + s.w : s.x
        const sy = s.h < 0 ? s.y + s.h : s.y
        return canvasPt.x >= sx && canvasPt.x <= sx + sw && canvasPt.y >= sy && canvasPt.y <= sy + sh
      })

      if (hitShape) {
        if (e.shiftKey) {
          const next = currentSelected.includes(hitShape.id)
            ? currentSelected.filter((id) => id !== hitShape.id)
            : [...currentSelected, hitShape.id]
          setSelectedIds(next)
          if (next.includes(hitShape.id)) {
            startMoveDrag(next, canvasPt.x, canvasPt.y)
          }
        } else {
          // If hit shape is part of an existing multi-selection, drag the entire diagram!
          if (currentSelected.includes(hitShape.id) && currentSelected.length > 1) {
            startMoveDrag(currentSelected, canvasPt.x, canvasPt.y)
          } else {
            setSelectedIds([hitShape.id])
            startMoveDrag([hitShape.id], canvasPt.x, canvasPt.y)
          }
        }
        return
      }

      // 3. Check stroke hit (e.g., drawn arrows or connector lines)
      const hitStroke = [...curBoard.strokes].reverse().find((st) => {
        return st.points.some(([px, py]) => Math.hypot(canvasPt.x - px, canvasPt.y - py) <= 12 / viewRef.current.zoom)
      })

      if (hitStroke) {
        if (e.shiftKey) {
          const next = currentSelected.includes(hitStroke.id)
            ? currentSelected.filter((id) => id !== hitStroke.id)
            : [...currentSelected, hitStroke.id]
          setSelectedIds(next)
          if (next.includes(hitStroke.id)) {
            startMoveDrag(next, canvasPt.x, canvasPt.y)
          }
        } else {
          if (currentSelected.includes(hitStroke.id) && currentSelected.length > 1) {
            startMoveDrag(currentSelected, canvasPt.x, canvasPt.y)
          } else {
            setSelectedIds([hitStroke.id])
            startMoveDrag([hitStroke.id], canvasPt.x, canvasPt.y)
          }
        }
        return
      }

      // 4. Check if clicked inside existing multi-selection bounding box (e.g. gaps between diagram levels/arrows)
      if (currentSelected.length > 1) {
        const bounds = getSelectionBounds(curBoard, currentSelected)
        if (bounds) {
          const pad = 12 / viewRef.current.zoom
          if (
            canvasPt.x >= bounds.minX - pad &&
            canvasPt.x <= bounds.maxX + pad &&
            canvasPt.y >= bounds.minY - pad &&
            canvasPt.y <= bounds.maxY + pad
          ) {
            startMoveDrag(currentSelected, canvasPt.x, canvasPt.y)
            return
          }
        }
      }

      // 5. Background drag: Marquee selection or Pan
      if (e.button === 1 || e.altKey) {
        panStartRef.current = {
          clientX: e.clientX,
          clientY: e.clientY,
          initPanX: viewRef.current.panX,
          initPanY: viewRef.current.panY
        }
      } else {
        if (!e.shiftKey) {
          setSelectedIds([])
        }
        selectionBoxRef.current = {
          startX: canvasPt.x,
          startY: canvasPt.y,
          currentX: canvasPt.x,
          currentY: canvasPt.y
        }
      }
      return
    }

    if (activeTool === 'eraser') {
      if (eraserModeRef.current === 'section' || e.shiftKey) {
        // Section selection marquee for diagram deletion in one go
        selectionBoxRef.current = {
          startX: canvasPt.x,
          startY: canvasPt.y,
          currentX: canvasPt.x,
          currentY: canvasPt.y
        }
      } else {
        // Paper-like eraser: continuously trims/splits strokes at circle radius
        lastEraserPointRef.current = { x: canvasPt.x, y: canvasPt.y }
        const r = eraserSizeRef.current / 2
        update(
          (b) => {
            const nextStrokes = eraseStrokesAlongPath(b.strokes, canvasPt.x, canvasPt.y, canvasPt.x, canvasPt.y, r)
            const nextShapes = eraseShapesAlongPath(b.shapeNodes, canvasPt.x, canvasPt.y, canvasPt.x, canvasPt.y, r)
            return { ...b, strokes: nextStrokes, shapeNodes: nextShapes }
          },
          { history: true }
        )
      }
    }
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    // Handle pan dragging across any tool or space gesture
    const panStart = panStartRef.current
    if (panStart) {
      const dx = e.clientX - panStart.clientX
      const dy = e.clientY - panStart.clientY
      const nextPanX = Math.round(panStart.initPanX + dx)
      const nextPanY = Math.round(panStart.initPanY + dy)
      setView((v) => ({
        ...v,
        panX: nextPanX,
        panY: nextPanY
      }))
      return
    }

    const canvasPt = screenToCanvas(e.clientX, e.clientY, viewRef.current)
    mouseCanvasPosRef.current = { x: canvasPt.x, y: canvasPt.y }

    if (!isPointerDownRef.current) return

    if (activeTool === 'pen' && activeStrokeRef.current) {
      const p: [number, number, number] = [canvasPt.x, canvasPt.y, e.pressure || 0.5]
      activeStrokeRef.current.points.push(p)
      return
    }

    if (activeTool === 'eraser') {
      if (selectionBoxRef.current) {
        selectionBoxRef.current.currentX = canvasPt.x
        selectionBoxRef.current.currentY = canvasPt.y
      } else if (eraserModeRef.current === 'paper' && lastEraserPointRef.current) {
        const p0 = lastEraserPointRef.current
        const p1 = canvasPt
        const r = eraserSizeRef.current / 2
        update(
          (b) => {
            const nextStrokes = eraseStrokesAlongPath(b.strokes, p0.x, p0.y, p1.x, p1.y, r)
            const nextShapes = eraseShapesAlongPath(b.shapeNodes, p0.x, p0.y, p1.x, p1.y, r)
            return { ...b, strokes: nextStrokes, shapeNodes: nextShapes }
          },
          { history: false }
        )
        lastEraserPointRef.current = { x: canvasPt.x, y: canvasPt.y }
      }
      return
    }

    if (activeTool === 'select') {
      if (selectionBoxRef.current) {
        selectionBoxRef.current.currentX = canvasPt.x
        selectionBoxRef.current.currentY = canvasPt.y
        const rect = normalizeRect(
          selectionBoxRef.current.startX,
          selectionBoxRef.current.startY,
          selectionBoxRef.current.currentX,
          selectionBoxRef.current.currentY
        )
        const curBoard = boardRef.current
        const ids: string[] = []
        for (const s of curBoard.shapeNodes) {
          if (isShapeInRect(s, rect)) ids.push(s.id)
        }
        for (const t of curBoard.textNodes) {
          if (isTextInRect(t, rect)) ids.push(t.id)
        }
        for (const eq of curBoard.equationNodes) {
          if (isEquationInRect(eq, rect)) ids.push(eq.id)
        }
        for (const d of curBoard.diagramNodes ?? []) {
          if (isDiagramInRect(d, rect)) ids.push(d.id)
        }
        for (const c of curBoard.codeNodes ?? []) {
          if (isCodeInRect(c, rect)) ids.push(c.id)
        }
        for (const st of curBoard.strokes) {
          if (isStrokeInRect(st, rect)) ids.push(st.id)
        }
        setSelectedIds(ids)
      } else if (shapeDragRef.current) {
        const drag = shapeDragRef.current
        const dx = canvasPt.x - drag.startPinchX
        const dy = canvasPt.y - drag.startPinchY

        if (drag.kind === 'move') {
          applyMoveDelta(dx, dy)
        } else if (
          drag.kind === 'shape-resize' &&
          drag.targetId &&
          drag.handle &&
          drag.initW !== undefined &&
          drag.initH !== undefined &&
          drag.initX !== undefined &&
          drag.initY !== undefined
        ) {
          let newX = drag.initX
          let newY = drag.initY
          let newW = drag.initW
          let newH = drag.initH
          const targetId = drag.targetId

          if (drag.handle === 'se') {
            newW = drag.initW + dx
            newH = drag.initH + dy
          } else if (drag.handle === 'ne') {
            newW = drag.initW + dx
            newH = drag.initH - dy
            newY = drag.initY + dy
          } else if (drag.handle === 'sw') {
            newW = drag.initW - dx
            newH = drag.initH + dy
            newX = drag.initX + dx
          } else if (drag.handle === 'nw') {
            newW = drag.initW - dx
            newH = drag.initH - dy
            newX = drag.initX + dx
            newY = drag.initY + dy
          }

          update(
            (b) => ({
              ...b,
              shapeNodes: b.shapeNodes.map((s) =>
                s.id === targetId
                  ? {
                    ...s,
                    x: Math.round(newX),
                    y: Math.round(newY),
                    w: Math.round(newW),
                    h: Math.round(newH)
                  }
                  : s
              )
            }),
            { history: false }
          )
        }
      }
    }
  }

  const handlePointerLeave = (): void => {
    mouseCanvasPosRef.current = null
    lastEraserPointRef.current = null
  }

  /* ---------------- Infinite Board: Wheel & Trackpad Scroll/Zoom ---------------- */
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const onWheel = (e: WheelEvent): void => {
      // Allow native scrolling on the Home Hub (Projects, Sections, Overall History)
      if (!activeSectionRef.current) return

      // 0. Check both e.target and physical elementFromPoint so UI panels/flyouts/menus always win
      const rawTarget = e.target instanceof Element ? (e.target as HTMLElement) : null
      const pointEl =
        (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null) || rawTarget

      if (
        pointEl?.closest('.home-hub') ||
        rawTarget?.closest('.home-hub') ||
        pointEl?.closest('.topbar-section-popover') ||
        rawTarget?.closest('.topbar-section-popover') ||
        pointEl?.closest('.code-studio-panel') ||
        rawTarget?.closest('.code-studio-panel') ||
        pointEl?.closest('.canvas-code-card') ||
        rawTarget?.closest('.canvas-code-card') ||
        pointEl?.closest('.floating-ai-window') ||
        rawTarget?.closest('.floating-ai-window') ||
        pointEl?.closest('.detached-window-root') ||
        rawTarget?.closest('.detached-window-root') ||
        pointEl?.closest('.canvas-video-card') ||
        rawTarget?.closest('.canvas-video-card') ||
        pointEl?.closest('.knowledge-hub-modal') ||
        rawTarget?.closest('.knowledge-hub-modal') ||
        pointEl?.closest('.modal-backdrop') ||
        rawTarget?.closest('.modal-backdrop')
      ) {
        return
      }

      const flyoutPanel =
        (pointEl?.closest('.vx-flyout-panel') as HTMLElement | null) ||
        (rawTarget?.closest('.vx-flyout-panel') as HTMLElement | null)
      if (flyoutPanel) {
        e.preventDefault()
        e.stopPropagation()
        const deltaY = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaMode === 2 ? e.deltaY * 300 : e.deltaY
        const deltaX = e.deltaMode === 1 ? e.deltaX * 30 : e.deltaMode === 2 ? e.deltaX * 300 : e.deltaX
        const catRail =
          (pointEl?.closest('.vx-cat-rail') as HTMLElement | null) ||
          (rawTarget?.closest('.vx-cat-rail') as HTMLElement | null)
        if (catRail) {
          catRail.scrollLeft += deltaX !== 0 ? deltaX : deltaY
          return
        }
        const catalogScroll = flyoutPanel.querySelector('.vx-shape-catalog-scroll') as HTMLElement | null
        const targetScroll = catalogScroll || flyoutPanel
        if (e.shiftKey && deltaY !== 0 && deltaX === 0) {
          targetScroll.scrollLeft += deltaY
        } else {
          targetScroll.scrollTop += deltaY
          if (deltaX !== 0) targetScroll.scrollLeft += deltaX
        }
        return
      }

      const contextMenuEl =
        (pointEl?.closest('.rf-context-menu') as HTMLElement | null) ||
        (rawTarget?.closest('.rf-context-menu') as HTMLElement | null)
      if (contextMenuEl) {
        e.preventDefault()
        e.stopPropagation()
        const deltaY = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaMode === 2 ? e.deltaY * 300 : e.deltaY
        const deltaX = e.deltaMode === 1 ? e.deltaX * 30 : e.deltaMode === 2 ? e.deltaX * 300 : e.deltaX
        const catsEl =
          (pointEl?.closest('.rf-context-cats') as HTMLElement | null) ||
          (rawTarget?.closest('.rf-context-cats') as HTMLElement | null)
        if (catsEl) {
          catsEl.scrollLeft += deltaX !== 0 ? deltaX : deltaY
          return
        }
        const gridEl = contextMenuEl.querySelector('.rf-context-grid') as HTMLElement | null
        if (gridEl) {
          gridEl.scrollTop += deltaY
        }
        return
      }

      // Don't hijack scrolling inside panels/modals/editors/popovers (checked BEFORE note/equation cards)
      if (
        pointEl?.closest('.floating-ai-window') ||
        rawTarget?.closest('.floating-ai-window') ||
        pointEl?.closest('.detached-window-root') ||
        rawTarget?.closest('.detached-window-root') ||
        pointEl?.closest('.canvas-video-card') ||
        rawTarget?.closest('.canvas-video-card') ||
        pointEl?.closest('.knowledge-hub-modal') ||
        rawTarget?.closest('.knowledge-hub-modal') ||
        pointEl?.closest('.right-panel') ||
        rawTarget?.closest('.right-panel') ||
        pointEl?.closest('.vx-left-dock') ||
        rawTarget?.closest('.vx-left-dock') ||
        pointEl?.closest('.modal-content') ||
        rawTarget?.closest('.modal-content') ||
        pointEl?.closest('.modal-backdrop') ||
        rawTarget?.closest('.modal-backdrop') ||
        pointEl?.closest('.dropdown-popover') ||
        rawTarget?.closest('.dropdown-popover') ||
        pointEl?.closest('.toolbar-popover-menu') ||
        rawTarget?.closest('.toolbar-popover-menu') ||
        pointEl?.closest('.note-editor-wrap') ||
        rawTarget?.closest('.note-editor-wrap') ||
        pointEl?.closest('.diagram-selection-toolbar') ||
        rawTarget?.closest('.diagram-selection-toolbar')
      ) {
        return
      }

      // If hovering over a note card, scroll inside the note box only and never the outer canvas
      const noteCard = pointEl?.closest('.canvas-note-card') as HTMLElement | null
      if (noteCard && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        e.stopPropagation()

        const deltaY = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaMode === 2 ? e.deltaY * 300 : e.deltaY
        const deltaX = e.deltaMode === 1 ? e.deltaX * 30 : e.deltaMode === 2 ? e.deltaX * 300 : e.deltaX

        // Check for inner horizontally scrollable element (pre, code, table)
        const innerScroll = pointEl?.closest('pre, code, table, .table-wrapper') as HTMLElement | null
        if (
          innerScroll &&
          innerScroll.scrollWidth > innerScroll.clientWidth &&
          (deltaX !== 0 || e.shiftKey)
        ) {
          innerScroll.scrollLeft += deltaX || deltaY
          return
        }

        const bodyEl =
          (pointEl?.closest('.note-card-body') as HTMLElement | null) ||
          (noteCard.querySelector('.note-card-body') as HTMLElement | null) ||
          noteCard

        if (e.shiftKey && deltaY !== 0 && !deltaX && bodyEl.scrollWidth > bodyEl.clientWidth) {
          bodyEl.scrollLeft += deltaY
        } else {
          bodyEl.scrollTop += deltaY
          if (deltaX) {
            bodyEl.scrollLeft += deltaX
          }
        }
        return
      }

      // Equation card with scrollable formula
      const eqCard = pointEl?.closest('.canvas-equation-card') as HTMLElement | null
      if (eqCard && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        e.stopPropagation()
        const deltaY = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaMode === 2 ? e.deltaY * 300 : e.deltaY
        const deltaX = e.deltaMode === 1 ? e.deltaX * 30 : e.deltaMode === 2 ? e.deltaX * 300 : e.deltaX
        const eqDisplay = eqCard.querySelector('.equation-display') as HTMLElement | null
        if (eqDisplay) {
          if (eqDisplay.scrollWidth > eqDisplay.clientWidth) {
            eqDisplay.scrollLeft += deltaX || deltaY
          } else {
            eqDisplay.scrollTop += deltaY
          }
        }
        return
      }

      e.preventDefault()

      // 1. Pinch-to-zoom (trackpad) or Ctrl+Wheel / Cmd+Wheel (mouse)
      if (e.ctrlKey || e.metaKey) {
        const zoomDelta = -e.deltaY * 0.002
        setView((v) => {
          const factor = 1 + Math.max(-0.25, Math.min(0.25, zoomDelta))
          const nextZoom = Math.max(0.15, Math.min(4.0, v.zoom * factor))
          const mouseX = (e.clientX - v.panX) / v.zoom
          const mouseY = (e.clientY - v.panY) / v.zoom
          return {
            zoom: nextZoom,
            panX: Math.round(e.clientX - mouseX * nextZoom),
            panY: Math.round(e.clientY - mouseY * nextZoom)
          }
        })
        return
      }

      // 2. Infinite Pan / Scroll with Wheel or Trackpad
      let dx = e.deltaX
      let dy = e.deltaY

      // Shift + Wheel scrolls horizontally
      if (e.shiftKey && dx === 0) {
        dx = dy
        dy = 0
      }

      setView((v) => ({
        ...v,
        panX: Math.round(v.panX - dx),
        panY: Math.round(v.panY - dy)
      }))
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  /* Global pointerup listener to ensure panning drag clears cleanly */
  useEffect(() => {
    const handleGlobalPointerUp = (): void => {
      if (panStartRef.current) {
        panStartRef.current = null
        isPanningDragRef.current = false
      }
    }
    window.addEventListener('pointerup', handleGlobalPointerUp)
    return () => window.removeEventListener('pointerup', handleGlobalPointerUp)
  }, [])

  const handlePointerUp = async (): Promise<void> => {
    isPointerDownRef.current = false
    const wasPanning = !!panStartRef.current
    panStartRef.current = null
    isPanningDragRef.current = false
    shapeDragRef.current = null
    lastEraserPointRef.current = null
    if (wasPanning) return

    // 0. Handle Section Eraser Marquee Box Deletion
    if (activeTool === 'eraser' && selectionBoxRef.current) {
      const box = selectionBoxRef.current
      selectionBoxRef.current = null
      const rect = normalizeRect(box.startX, box.startY, box.currentX, box.currentY)
      if (rect.w > 4 || rect.h > 4) {
        let deletedCount = 0
        update((b) => {
          const nextStrokes = b.strokes.filter((s) => !isStrokeInRect(s, rect))
          const nextShapes = b.shapeNodes.filter((s) => !isShapeInRect(s, rect))
          const nextTexts = b.textNodes.filter((t) => !isTextInRect(t, rect))
          const nextEquations = b.equationNodes.filter((eq) => !isEquationInRect(eq, rect))
          const nextDiagrams = (b.diagramNodes ?? []).filter((d) => !isDiagramInRect(d, rect))
          const nextCodes = (b.codeNodes ?? []).filter((c) => !isCodeInRect(c, rect))
          deletedCount =
            b.strokes.length - nextStrokes.length +
            (b.shapeNodes.length - nextShapes.length) +
            (b.textNodes.length - nextTexts.length) +
            (b.equationNodes.length - nextEquations.length) +
            ((b.diagramNodes ?? []).length - nextDiagrams.length) +
            ((b.codeNodes ?? []).length - nextCodes.length)
          return {
            ...b,
            strokes: nextStrokes,
            shapeNodes: nextShapes,
            textNodes: nextTexts,
            equationNodes: nextEquations,
            diagramNodes: nextDiagrams,
            codeNodes: nextCodes
          }
        })
        if (deletedCount > 0) {
          addToast('info', `Section deleted: ${deletedCount} diagram element${deletedCount > 1 ? 's' : ''}`)
        }
      }
      return
    }

    // 0b. Clear Select Tool Marquee Box
    if (activeTool === 'select' && selectionBoxRef.current) {
      const box = selectionBoxRef.current
      selectionBoxRef.current = null
      const rect = normalizeRect(box.startX, box.startY, box.currentX, box.currentY)
      if (rect.w <= 4 && rect.h <= 4) {
        setSelectedIds([])
      }
      return
    }

    // 2. Commit Stroke with Writing Pad Detection (buffered multi-stroke OCR for words & equations)
    if (activeStrokeRef.current) {
      const stroke = activeStrokeRef.current
      activeStrokeRef.current = null

      if (stroke.points.length < 2) return

      // Always render the ink stroke right away so multi-stroke writing stays visible
      update((b) => ({ ...b, strokes: [...b.strokes, stroke] }))

      if (
        isAiConfiguredRef.current &&
        (writingPadDetection === 'text' || writingPadDetection === 'equation')
      ) {
        const mode = writingPadDetection
        pendingOcrStrokeIdsRef.current.push(stroke.id)
        if (ocrTimerRef.current !== null) {
          window.clearTimeout(ocrTimerRef.current)
        }

        ocrTimerRef.current = window.setTimeout(async () => {
          ocrTimerRef.current = null
          if (!isAiConfiguredRef.current) {
            pendingOcrStrokeIdsRef.current = []
            return
          }
          const batchIds = [...pendingOcrStrokeIdsRef.current]
          pendingOcrStrokeIdsRef.current = []
          if (batchIds.length === 0) return

          const batchSet = new Set(batchIds)
          const batchStrokes = boardRef.current.strokes.filter((s) => batchSet.has(s.id))
          if (batchStrokes.length === 0) return

          const crop = strokesToOcrImage(batchStrokes)
          const api = window.glassAPI
          if (!api) return

          setAiBusy(true)
          try {
            const currentSettings = settingsRef.current
            const activeProvider = currentSettings.ai.provider
            const activeModel =
              activeProvider === 'ollama'
                ? currentSettings.ai.ollamaModel
                : currentSettings.ai.byokModels[activeProvider] ||
                DEFAULT_PROVIDER_MODELS[activeProvider]

            const res = await api.runAI({
              provider: activeProvider,
              model: activeModel,
              ollamaHost: currentSettings.ai.ollamaHost,
              isHandwritingOCR: mode === 'text',
              isEquationOCR: mode === 'equation',
              imageBase64: crop.base64
            })

            if (res.ok && res.recognizedText?.trim()) {
              const recognized = res.recognizedText.trim()
              if (mode === 'text') {
                const textNode: TextNode = {
                  id: `ocr-${Date.now()}`,
                  x: Math.round(crop.minX),
                  y: Math.round(crop.minY),
                  w: Math.max(200, Math.min(560, Math.round(crop.maxX - crop.minX + 60))),
                  text: recognized,
                  style: 'body',
                  fontSize: 20,
                  color: 'ink',
                  source: 'ocr',
                  createdAt: Date.now()
                }
                update((b) => ({
                  ...b,
                  strokes: b.strokes.filter((s) => !batchSet.has(s.id)),
                  textNodes: [...b.textNodes, textNode]
                }))
                setSelectedId(textNode.id)
                pushHistory()
                addToast('success', `Recognized: "${recognized}"`)
              } else {
                const eqNode: EquationNode = {
                  id: `eq-${Date.now()}`,
                  x: Math.round(crop.minX),
                  y: Math.round(crop.minY),
                  latex: recognized,
                  fontSize: 22,
                  color: 'ink',
                  createdAt: Date.now()
                }
                update((b) => ({
                  ...b,
                  strokes: b.strokes.filter((s) => !batchSet.has(s.id)),
                  equationNodes: [...b.equationNodes, eqNode]
                }))
                setSelectedId(eqNode.id)
                pushHistory()
                addToast('success', `Formula: ${recognized}`)
              }
            } else if (!res.ok) {
              addToast('error', res.error || 'Handwriting recognition failed — check AI settings')
            }
          } catch (err: unknown) {
            addToast(
              'error',
              (err as Error)?.message || 'Handwriting recognition error — check AI settings'
            )
          } finally {
            setAiBusy(false)
          }
        }, 1100)
      }
    }
  }

  /* ---------------- 60 FPS Canvas Render Loop ---------------- */
  useEffect(() => {
    let animId: number

    const renderLoop = (): void => {
      const committedCanvas = committedCanvasRef.current

      if (committedCanvas) {
        const ctx = committedCanvas.getContext('2d')
        if (ctx) {
          ctx.clearRect(0, 0, committedCanvas.width, committedCanvas.height)
          ctx.save()
          ctx.translate(viewRef.current.panX, viewRef.current.panY)
          ctx.scale(viewRef.current.zoom, viewRef.current.zoom)

          const curBoard = boardRef.current
          for (const s of curBoard.shapeNodes) drawShape(ctx, s, themeTokens, fontCss, boardPalette)
          for (const st of curBoard.strokes) drawStroke(ctx, st, themeTokens)

          // Live drawing stroke
          if (activeStrokeRef.current) {
            drawStroke(ctx, activeStrokeRef.current, themeTokens, { live: true })
          }



          // Highlight multi-selected shapes or diagram group
          const currentSelectedIds = selectedIdsRef.current
          if (currentSelectedIds.length > 0) {
            const selectedSet = new Set(currentSelectedIds)
            if (currentSelectedIds.length === 1) {
              for (const s of curBoard.shapeNodes) {
                if (selectedSet.has(s.id)) {
                  ctx.save()
                  ctx.strokeStyle = '#06b6d4'
                  ctx.lineWidth = 2 / viewRef.current.zoom
                  ctx.setLineDash([5 / viewRef.current.zoom, 4 / viewRef.current.zoom])
                  const pad = 4
                  const sx = s.w < 0 ? s.x + s.w : s.x
                  const sy = s.h < 0 ? s.y + s.h : s.y
                  const sw = Math.abs(s.w)
                  const sh = Math.abs(s.h)
                  ctx.strokeRect(sx - pad, sy - pad, sw + pad * 2, sh + pad * 2)
                  ctx.fillStyle = '#06b6d4'
                  const handleSize = 6 / viewRef.current.zoom
                  ctx.fillRect(sx - pad - handleSize / 2, sy - pad - handleSize / 2, handleSize, handleSize)
                  ctx.fillRect(sx + sw + pad - handleSize / 2, sy - pad - handleSize / 2, handleSize, handleSize)
                  ctx.fillRect(sx - pad - handleSize / 2, sy + sh + pad - handleSize / 2, handleSize, handleSize)
                  ctx.fillRect(sx + sw + pad - handleSize / 2, sy + sh + pad - handleSize / 2, handleSize, handleSize)
                  ctx.restore()
                }
              }
            } else {
              // Multi-element Diagram Selection
              // 1. Subtle outline around each selected shape
              for (const s of curBoard.shapeNodes) {
                if (selectedSet.has(s.id)) {
                  ctx.save()
                  ctx.strokeStyle = 'rgba(6, 182, 212, 0.7)'
                  ctx.lineWidth = 1.5 / viewRef.current.zoom
                  const pad = 3
                  const sx = s.w < 0 ? s.x + s.w : s.x
                  const sy = s.h < 0 ? s.y + s.h : s.y
                  const sw = Math.abs(s.w)
                  const sh = Math.abs(s.h)
                  ctx.strokeRect(sx - pad, sy - pad, sw + pad * 2, sh + pad * 2)
                  ctx.restore()
                }
              }

              // 2. Highlight selected strokes
              for (const st of curBoard.strokes) {
                if (selectedSet.has(st.id)) {
                  drawStroke(ctx, st, themeTokens, { color: '#06b6d4', alpha: 0.6 })
                }
              }

              // 3. Overall Group Bounding Box around the entire selected diagram
              const bounds = getSelectionBounds(curBoard, currentSelectedIds)
              if (bounds) {
                const z = viewRef.current.zoom
                const pad = 12 / z
                const gx = bounds.minX - pad
                const gy = bounds.minY - pad
                const gw = bounds.w + pad * 2
                const gh = bounds.h + pad * 2

                ctx.save()
                // Light translucent cyan fill indicating movable diagram surface
                ctx.fillStyle = 'rgba(6, 182, 212, 0.05)'
                ctx.fillRect(gx, gy, gw, gh)

                // Dashed cyan boundary
                ctx.strokeStyle = '#06b6d4'
                ctx.lineWidth = 1.8 / z
                ctx.setLineDash([7 / z, 5 / z])
                ctx.strokeRect(gx, gy, gw, gh)
                ctx.setLineDash([])

                // 4 prominent corner handles indicating group movable frame
                const hSize = 8 / z
                ctx.fillStyle = '#ffffff'
                ctx.strokeStyle = '#0891b2'
                ctx.lineWidth = 2 / z
                const corners = [
                  [gx, gy],
                  [gx + gw, gy],
                  [gx + gw, gy + gh],
                  [gx, gy + gh]
                ]
                for (const [cx, cy] of corners) {
                  ctx.fillRect(cx - hSize / 2, cy - hSize / 2, hSize, hSize)
                  ctx.strokeRect(cx - hSize / 2, cy - hSize / 2, hSize, hSize)
                }

                // Diagram selection header pill
                const pillText = `Diagram · ${currentSelectedIds.length} items`
                const fontSize = Math.max(10, Math.round(12 / z))
                ctx.font = `600 ${fontSize}px Inter, -apple-system, sans-serif`
                const textMetrics = ctx.measureText(pillText)
                const pillW = textMetrics.width + 16 / z
                const pillH = 22 / z
                const pillX = gx
                const pillY = gy - pillH - 6 / z

                // Pill background
                ctx.fillStyle = '#0891b2'
                ctx.beginPath()
                ctx.roundRect(pillX, pillY, pillW, pillH, 4 / z)
                ctx.fill()

                // Pill text
                ctx.fillStyle = '#ffffff'
                ctx.textBaseline = 'middle'
                ctx.fillText(pillText, pillX + 8 / z, pillY + pillH / 2)

                ctx.restore()
              }
            }
          }

          // Draw Selection Marquee Box (eraser section mode or select tool)
          if (selectionBoxRef.current) {
            const sb = selectionBoxRef.current
            const rect = normalizeRect(sb.startX, sb.startY, sb.currentX, sb.currentY)
            ctx.save()
            const isEraser = activeToolRef.current === 'eraser'
            ctx.strokeStyle = isEraser ? '#f43f5e' : '#06b6d4'
            ctx.fillStyle = isEraser ? 'rgba(244, 63, 94, 0.14)' : 'rgba(6, 182, 212, 0.12)'
            ctx.lineWidth = 1.5 / viewRef.current.zoom
            ctx.setLineDash([6 / viewRef.current.zoom, 4 / viewRef.current.zoom])
            ctx.fillRect(rect.x, rect.y, rect.w, rect.h)
            ctx.strokeRect(rect.x, rect.y, rect.w, rect.h)
            ctx.restore()
          }

          // Draw Live Eraser Circle Reticle (Paper mode)
          if (activeToolRef.current === 'eraser' && eraserModeRef.current === 'paper' && mouseCanvasPosRef.current) {
            const m = mouseCanvasPosRef.current
            const r = eraserSizeRef.current / 2
            ctx.save()
            ctx.beginPath()
            ctx.arc(m.x, m.y, r, 0, Math.PI * 2)
            ctx.fillStyle = 'rgba(244, 63, 94, 0.16)'
            ctx.fill()
            ctx.strokeStyle = '#f43f5e'
            ctx.lineWidth = 1.5 / viewRef.current.zoom
            ctx.stroke()
            // Center dot
            ctx.beginPath()
            ctx.arc(m.x, m.y, 2.5 / viewRef.current.zoom, 0, Math.PI * 2)
            ctx.fillStyle = '#f43f5e'
            ctx.fill()
            ctx.restore()
          }

          ctx.restore()
        }
      }

      animId = requestAnimationFrame(renderLoop)
    }

    animId = requestAnimationFrame(renderLoop)
    return () => cancelAnimationFrame(animId)
  }, [themeTokens, fontCss, boardPalette])

  /* ---------------- Element Operations (CanvasElements bridge) ---------------- */
  const handleUpdateText = useCallback(
    (id: string, patch: Partial<TextNode>, opts?: { history?: boolean }) => {
      update(
        (b) => ({
          ...b,
          textNodes: b.textNodes.map((t) => (t.id === id ? { ...t, ...patch } : t))
        }),
        opts
      )
    },
    [update]
  )

  const handleUpdateEquation = useCallback(
    (id: string, patch: Partial<EquationNode>, opts?: { history?: boolean }) => {
      update(
        (b) => ({
          ...b,
          equationNodes: b.equationNodes.map((e) => (e.id === id ? { ...e, ...patch } : e))
        }),
        opts
      )
    },
    [update]
  )

  const handleUpdateDiagram = useCallback(
    (id: string, patch: Partial<DiagramNode>, opts?: { history?: boolean }) => {
      update(
        (b) => ({
          ...b,
          diagramNodes: (b.diagramNodes ?? []).map((d) => (d.id === id ? { ...d, ...patch } : d))
        }),
        opts
      )
    },
    [update]
  )

  const handleUpdateCode = useCallback(
    (id: string, patch: Partial<CodeNode>, opts?: { history?: boolean }) => {
      update(
        (b) => ({
          ...b,
          codeNodes: (b.codeNodes ?? []).map((c) => (c.id === id ? { ...c, ...patch } : c))
        }),
        opts
      )
    },
    [update]
  )

  const handleUpdateVideo = useCallback(
    (id: string, patch: Partial<VideoNode>, opts?: { history?: boolean }) => {
      update(
        (b) => ({
          ...b,
          videoNodes: (b.videoNodes ?? []).map((v) => (v.id === id ? { ...v, ...patch } : v))
        }),
        opts
      )
    },
    [update]
  )

  const handleDeleteElement = useCallback(
    (id: string) => {
      update((b) => ({
        ...b,
        textNodes: b.textNodes.filter((t) => t.id !== id),
        equationNodes: b.equationNodes.filter((e) => e.id !== id),
        shapeNodes: b.shapeNodes.filter((s) => s.id !== id),
        diagramNodes: (b.diagramNodes ?? []).filter((d) => d.id !== id),
        codeNodes: (b.codeNodes ?? []).filter((c) => c.id !== id),
        videoNodes: (b.videoNodes ?? []).filter((v) => v.id !== id)
      }))
      setSelectedIds((prev) => prev.filter((item) => item !== id))
    },
    [update]
  )

  const deleteSelectedElements = useCallback(() => {
    if (selectedIds.length === 0) return
    const idsToDelete = new Set(selectedIds)
    update((b) => ({
      ...b,
      strokes: b.strokes.filter((s) => !idsToDelete.has(s.id)),
      textNodes: b.textNodes.filter((t) => !idsToDelete.has(t.id)),
      equationNodes: b.equationNodes.filter((e) => !idsToDelete.has(e.id)),
      shapeNodes: b.shapeNodes.filter((s) => !idsToDelete.has(s.id)),
      diagramNodes: (b.diagramNodes ?? []).filter((d) => !idsToDelete.has(d.id)),
      codeNodes: (b.codeNodes ?? []).filter((c) => !idsToDelete.has(c.id)),
      videoNodes: (b.videoNodes ?? []).filter((v) => !idsToDelete.has(v.id))
    }))
    addToast('info', `Deleted ${selectedIds.length} element${selectedIds.length > 1 ? 's' : ''}`)
    setSelectedIds([])
  }, [selectedIds, update, addToast])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!activeSection) return
      const activeEl = document.activeElement
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          (activeEl as HTMLElement).isContentEditable ||
          (activeEl as HTMLElement).closest?.('.cm-editor, .code-studio-panel, .canvas-code-card'))
      ) {
        return
      }

      // Spacebar for temporary pan
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault()
        isSpacePressedRef.current = true
        setIsSpacePanning(true)
        return
      }

      // Tool shortcuts (when not holding Ctrl/Cmd)
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.key === 'v' || e.key === 'V') {
          setActiveTool('select')
        } else if (e.key === 'h' || e.key === 'H') {
          setActiveTool('pan')
        } else if (e.key === 'p' || e.key === 'P') {
          setActiveTool('pen')
        } else if (e.key === 't' || e.key === 'T') {
          setActiveTool('text')
        } else if (e.key === 'e' || e.key === 'E') {
          setActiveTool('eraser')
        }
      }

      // Arrow keys nudging for all selected elements
      if (
        (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') &&
        selectedIds.length > 0
      ) {
        e.preventDefault()
        const step = e.shiftKey ? 10 : 2
        let dx = 0
        let dy = 0
        if (e.key === 'ArrowLeft') dx = -step
        if (e.key === 'ArrowRight') dx = step
        if (e.key === 'ArrowUp') dy = -step
        if (e.key === 'ArrowDown') dy = step

        const idSet = new Set(selectedIds)
        update(
          (b) => ({
            ...b,
            shapeNodes: b.shapeNodes.map((s) => (idSet.has(s.id) ? { ...s, x: s.x + dx, y: s.y + dy } : s)),
            textNodes: b.textNodes.map((t) => (idSet.has(t.id) ? { ...t, x: t.x + dx, y: t.y + dy } : t)),
            equationNodes: b.equationNodes.map((eq) => (idSet.has(eq.id) ? { ...eq, x: eq.x + dx, y: eq.y + dy } : eq)),
            diagramNodes: (b.diagramNodes ?? []).map((d) => (idSet.has(d.id) ? { ...d, x: d.x + dx, y: d.y + dy } : d)),
            codeNodes: (b.codeNodes ?? []).map((c) => (idSet.has(c.id) ? { ...c, x: c.x + dx, y: c.y + dy } : c)),
            strokes: b.strokes.map((st) =>
              idSet.has(st.id)
                ? {
                  ...st,
                  points: st.points.map(([px, py, pr]) => [px + dx, py + dy, pr] as InkPoint)
                }
                : st
            )
          }),
          { history: true }
        )
        return
      }

      // Undo (Ctrl+Z / Cmd+Z) & Redo (Ctrl+Y / Ctrl+Shift+Z / Cmd+Y / Cmd+Shift+Z)
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const k = e.key.toLowerCase()
        if (k === 'z' && !e.shiftKey) {
          e.preventDefault()
          undo()
          return
        }
        if ((k === 'z' && e.shiftKey) || (k === 'y' && !e.shiftKey)) {
          e.preventDefault()
          redo()
          return
        }
      }

      // Reset view to 100% origin (Ctrl+0) or Fit to Content (Shift+1)
      if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault()
        setView({ zoom: 1.0, panX: 0, panY: 0 })
      } else if (e.shiftKey && (e.key === '!' || e.key === '1')) {
        e.preventDefault()
        handleFitToContent()
      }

      // Beautify selected diagram (Ctrl+B / Cmd+B)
      if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault()
        handleBeautifySelected()
        return
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        const hasFlowSubSelection = Boolean(
          document.querySelector('.react-flow__node.selected, .react-flow__edge.selected')
        )
        const isInsideFlow =
          (e.target as HTMLElement)?.closest('.react-flow, .rf-board-container') ||
          document.activeElement?.closest('.react-flow, .rf-board-container')
        if (isInsideFlow && hasFlowSubSelection) {
          return
        }
        if (selectedIds.length > 0) {
          e.preventDefault()
          deleteSelectedElements()
        }
      } else if (e.key === 'Escape') {
        setSelectedIds([])
        selectionBoxRef.current = null
      }
    }

    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.code === 'Space') {
        isSpacePressedRef.current = false
        setIsSpacePanning(false)
        if (isPanningDragRef.current) {
          isPanningDragRef.current = false
          panStartRef.current = null
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [activeSection, selectedIds, deleteSelectedElements, handleFitToContent, handleBeautifySelected, undo, redo])

  const handleDuplicateElement = useCallback(
    (id: string) => {
      const curBoard = boardRef.current
      const textNode = curBoard.textNodes.find((t) => t.id === id)
      if (textNode) {
        const dup: TextNode = { ...textNode, id: `text-${Date.now()}`, x: textNode.x + 30, y: textNode.y + 30 }
        update((b) => ({ ...b, textNodes: [...b.textNodes, dup] }))
        setSelectedId(dup.id)
        return
      }
      const eqNode = curBoard.equationNodes.find((e) => e.id === id)
      if (eqNode) {
        const dup: EquationNode = { ...eqNode, id: `eq-${Date.now()}`, x: eqNode.x + 30, y: eqNode.y + 30 }
        update((b) => ({ ...b, equationNodes: [...b.equationNodes, dup] }))
        setSelectedId(dup.id)
        return
      }
      const diagNode = (curBoard.diagramNodes ?? []).find((d) => d.id === id)
      if (diagNode) {
        const dup: DiagramNode = { ...diagNode, id: `diag-${Date.now()}`, x: diagNode.x + 30, y: diagNode.y + 30 }
        update((b) => ({ ...b, diagramNodes: [...(b.diagramNodes ?? []), dup] }))
        setSelectedId(dup.id)
        return
      }
      const codeNode = (curBoard.codeNodes ?? []).find((c) => c.id === id)
      if (codeNode) {
        const dup: CodeNode = {
          ...codeNode,
          id: `code-${Date.now()}`,
          x: codeNode.x + 30,
          y: codeNode.y + 30,
          tabs: codeNode.tabs.map((t) => ({ ...t }))
        }
        update((b) => ({ ...b, codeNodes: [...(b.codeNodes ?? []), dup] }))
        setSelectedId(dup.id)
        return
      }
      const videoNode = (curBoard.videoNodes ?? []).find((v) => v.id === id)
      if (videoNode) {
        const dup: VideoNode = {
          ...videoNode,
          id: `video-${Date.now()}`,
          x: videoNode.x + 30,
          y: videoNode.y + 30,
          tabs: videoNode.tabs?.map((t) => ({ ...t }))
        }
        update((b) => ({ ...b, videoNodes: [...(b.videoNodes ?? []), dup] }))
        setSelectedId(dup.id)
        return
      }
    },
    [update]
  )

  const isLight = boardPalette.isLight
  const isHomeView = !activeSection

  const boardCssVars = useMemo(
    () =>
      ({
        '--board-bg': boardPalette.bg,
        '--board-ink': boardPalette.ink,
        '--board-accent': boardPalette.accent,
        '--board-secondary': boardPalette.secondary,
        '--board-shape-stroke': boardPalette.shapeStroke,
        '--board-shape-fill': boardPalette.shapeFill,
        '--board-shape-text': boardPalette.shapeText,
        '--board-note-bg': boardPalette.noteBg,
        '--board-note-text': boardPalette.noteText,
        '--board-note-accent': boardPalette.noteAccent,
        '--board-node-bg': boardPalette.diagramNodeBg,
        '--board-node-border': boardPalette.diagramNodeBorder,
        '--board-node-text': boardPalette.diagramNodeText,
        '--board-node-subtext': boardPalette.diagramNodeSubtext,
        '--board-edge-color': boardPalette.diagramEdge,
        '--board-grid-color': boardPalette.gridColor
      }) as CSSProperties,
    [boardPalette]
  )

  return (
    <div
      ref={containerRef}
      className={`app-container ${!isHomeView && settings.mode === 'MODE_B' ? 'mode-b' : 'mode-a'} ${isLight ? 'theme-light-bg' : 'theme-dark-canvas'} ${isPanningDragRef.current || panStartRef.current ? 'is-panning' : ''}`}
      data-theme={settings.theme}
      data-font={settings.font}
      style={boardCssVars}
    >
      {/* Layer 1: Canvas Viewport Backdrop with selectable color & grid pattern */}
      <div
        className={`viewport-backdrop ${settings.backgroundPattern ?? 'dots'}`}
        style={{
          backgroundColor:
            settings.backgroundColor === 'transparent'
              ? 'transparent'
              : (settings.backgroundColor ?? '#FFFDF7'),
          backgroundImage:
            settings.backgroundPattern === 'none'
              ? 'none'
              : settings.backgroundPattern === 'grid'
                ? `linear-gradient(to right, ${boardPalette.gridColor} 1px, transparent 1px), linear-gradient(to bottom, ${boardPalette.gridColor} 1px, transparent 1px)`
                : `radial-gradient(${boardPalette.gridColor} ${Math.max(1.1, 1.35 * view.zoom)}px, transparent ${Math.max(1.1, 1.35 * view.zoom)}px)`,
          backgroundSize:
            settings.backgroundPattern === 'grid'
              ? `${Math.max(10, Math.round(28 * view.zoom))}px ${Math.max(10, Math.round(28 * view.zoom))}px`
              : `${Math.max(10, Math.round(24 * view.zoom))}px ${Math.max(10, Math.round(24 * view.zoom))}px`,
          backgroundPosition: `${view.panX}px ${view.panY}px`
        }}
      />

      {/* Top bar */}
      <TopBar
        aiBusy={aiBusy}
        isAiConfigured={isAiConfigured}
        modelLabel={
          settings.ai.provider === 'ollama'
            ? settings.ai.ollamaModel
            : settings.ai.byokModels[settings.ai.provider]
        }
        clickThrough={clickThrough}
        isMaximized={isMaximized}
        isHomeView={isHomeView}
        activeProject={activeProject}
        activeSection={activeSection}
        projectSections={projectSections}
        onGoHome={() => void handleGoHome()}
        onSelectSection={(sec) => void handleOpenSection(sec, activeProject)}
        onQuickCreateSection={handleQuickCreateSection}
        onOpenSettings={() => setSettingsOpen(true)}
        isRightPanelOpen={isRightPanelOpen || isDetachedChat}
        onToggleRightPanel={() => {
          if (isDetachedChat && window.glassAPI?.toggleDetachedChat) {
            window.glassAPI.toggleDetachedChat()
          } else {
            setIsRightPanelOpen((v) => !v)
          }
        }}
        onMinimize={() => window.glassAPI?.minimize()}
        onMaximize={() => window.glassAPI?.maximize()}
        onClose={() => window.glassAPI?.close()}
      />

      {isHomeView ? (
        <HomeHub
          lastSectionId={lastSectionId}
          onOpenSection={(sec, proj, opts) => void handleOpenSection(sec, proj, opts)}
          onToast={addToast}
        />
      ) : (
        <>
          {/* Layer 2: Main interactive canvas for strokes & shapes */}
          <canvas
            ref={committedCanvasRef}
            id="board-canvas"
            className={`canvas-layer committed-canvas cursor-${getCanvasCursor()}`}
            style={{ cursor: getCanvasCursor() }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerLeave}
          />

          {/* Layer 3: Interactive Movable Text, Equation & React Flow Diagram Cards */}
          <CanvasElements
            textNodes={board.textNodes}
            equationNodes={board.equationNodes}
            diagramNodes={board.diagramNodes}
            codeNodes={board.codeNodes}
            videoNodes={board.videoNodes}
            selectedId={selectedId}
            selectedIds={selectedIds}
            onSelect={setSelectedId}
            onUpdateText={handleUpdateText}
            onUpdateEquation={handleUpdateEquation}
            onUpdateDiagram={handleUpdateDiagram}
            onUpdateCode={handleUpdateCode}
            onUpdateVideo={handleUpdateVideo}
            onAddCodeNode={() => handleAddCodeNode()}
            onAddVideoNode={() => handleAddYouTubeToCanvas()}
            onCreateTutorialFromVideo={(topic, transcript) =>
              handleGenerateTutorial(
                transcript ? `${topic}\n\nTranscript Context:\n${transcript.slice(0, 2500)}` : topic
              )
            }
            isAiConfigured={isAiConfigured}
            onDeleteElement={handleDeleteElement}
            onDuplicateElement={handleDuplicateElement}
            onPushHistory={pushHistory}
            onStartMoveSelection={startMoveDrag}
            onMoveSelection={applyMoveDelta}
            onEndMoveSelection={() => {
              shapeDragRef.current = null
            }}
            onInsertToNotes={handleInsertToNotes}
            onToast={addToast}
            isLightTheme={isLight}
            boardPalette={boardPalette}
            view={view}
            activeTool={activeTool}
            activeThemeAccent={themeTokens.accent}
            penColor={penColor === 'ink' ? themeTokens.ink : penColor === 'accent' ? themeTokens.accent : penColor}
            penSize={settings.inkSize}
          />

          {/* Multi-element diagram selection action bar */}
          {selectedIds.length > 0 && (
            <div className="diagram-selection-toolbar">
              <span className="diagram-selection-count">
                <BoxSelect size={16} />
                {selectedIds.length} element{selectedIds.length > 1 ? 's' : ''} selected
              </span>
              <button
                type="button"
                className="diagram-selection-beautify-btn"
                onClick={handleBeautifySelected}
                disabled={!isAiConfigured || isBeautifying}
                title={
                  isAiConfigured
                    ? 'Convert raw hand-drawn sketch into interactive React Flow diagram (Flowchart, Architecture, Electronic, UI)'
                    : 'AI Beautify disabled — configure AI Settings first'
                }
              >
                {isBeautifying ? (
                  <>
                    <Loader2 size={15} className="spin-animate" />
                    <span>Beautifying...</span>
                  </>
                ) : (
                  <>
                    <Sparkles size={15} />
                    <span>Beautify Diagram</span>
                  </>
                )}
              </button>
              <button
                type="button"
                className="diagram-selection-del-btn"
                onClick={deleteSelectedElements}
                title="Delete selected section (Delete/Backspace)"
              >
                <Trash2 size={15} />
                Delete Section
              </button>
              <button
                type="button"
                className="diagram-selection-close-btn"
                onClick={() => setSelectedIds([])}
                title="Deselect (Escape)"
              >
                <X size={15} />
              </button>
            </div>
          )}

          {/* Left Quick-Access Dock Toolbar */}
          <LeftDockToolbar
            activeTool={activeTool}
            onSelectTool={setActiveTool}
            onAddShapeNode={handleAddShapeNode}
            onAddStickyNote={handleAddStickyNote}
            onAddTemplate={handleAddTemplate}
            onBeautify={handleBeautifySelected}
            isBeautifying={isBeautifying}
            isAiConfigured={isAiConfigured}
            hasSelection={selectedIds.length > 0}
            onAddCodeNode={handleAddCodeNode}
            onOpenKnowledgeHub={() => setIsKnowledgeHubOpen(true)}
            onAddYouTubeVideo={() => handleAddYouTubeToCanvas()}
            boardPalette={boardPalette}
            penColor={penColor}
            onPenColor={setPenColor}
            penSize={settings.inkSize}
            onPenSize={(inkSize) => patchSettings({ inkSize })}
            penType={settings.penType ?? 'fountain'}
            onPenType={(penType) => patchSettings({ penType })}
            themeInk={themeTokens.ink}
            themeAccent={themeTokens.accent}
          />

          {/* Floating Toolbar */}
          <div className="dock-wrap">
            <Toolbar
              activeTool={activeTool}
              onSelectTool={setActiveTool}
              writingPadDetection={effectiveWritingPadDetection}
              onSelectDetection={setWritingPadDetection}
              eraserSize={eraserSize}
              onEraserSize={setEraserSize}
              eraserMode={eraserMode}
              onEraserMode={setEraserMode}
              canUndo={canUndo}
              onUndo={undo}
              canRedo={canRedo}
              onRedo={redo}
              onClear={clear}
              onOpenSettings={() => {
                setIsRightPanelOpen(true)
                setSettingsTrigger((t) => t + 1)
              }}
              onBeautify={handleBeautifySelected}
              isBeautifying={isBeautifying}
              isAiConfigured={isAiConfigured}
              hasSelection={selectedIds.length > 0}
              zoom={view.zoom}
              onZoomIn={() => setView((v) => ({ ...v, zoom: Math.min(3.0, v.zoom * 1.2) }))}
              onZoomOut={() => setView((v) => ({ ...v, zoom: Math.max(0.25, v.zoom / 1.2) }))}
              onZoomReset={() => setView({ zoom: 1.0, panX: 0, panY: 0 })}
              onFitView={handleFitToContent}
              penColor={penColor}
              onPenColor={setPenColor}
              penSize={settings.inkSize}
              onPenSize={(inkSize) => patchSettings({ inkSize })}
              penType={settings.penType ?? 'fountain'}
              onPenType={(penType) => patchSettings({ penType })}
              themeInk={themeTokens.ink}
              themeAccent={themeTokens.accent}
              backgroundColor={settings.backgroundColor ?? '#FFFDF7'}
              onSelectBackgroundColor={(backgroundColor) => patchSettings({ backgroundColor })}
              backgroundPattern={settings.backgroundPattern ?? 'dots'}
              onSelectBackgroundPattern={(backgroundPattern) => patchSettings({ backgroundPattern })}
              boardPalette={boardPalette}
            />
          </div>

          {/* Floating Canvas Navigation & Infinite Scroll HUD */}
          <div className="canvas-nav-hud glass">
            <button
              type="button"
              className="nav-hud-coord"
              onClick={() => setView((v) => ({ ...v, panX: 0, panY: 0 }))}
              title="Click to center at origin (0, 0)"
            >
              <span className="coord-axis">X</span>
              <span className="coord-val">{Math.round(-view.panX)}</span>
              <span className="coord-sep">·</span>
              <span className="coord-axis">Y</span>
              <span className="coord-val">{Math.round(-view.panY)}</span>
            </button>
            <button
              type="button"
              className="nav-hud-action-btn"
              onClick={handleFitToContent}
              title="Fit all content to screen (Shift + 1)"
            >
              <Focus size={13} />
              <span>Fit</span>
            </button>
            <button
              type="button"
              className="nav-hud-action-btn"
              onClick={() => setView({ zoom: 1.0, panX: 0, panY: 0 })}
              title="Reset View to 100% (Ctrl + 0)"
            >
              <span>{Math.round(view.zoom * 100)}%</span>
            </button>
          </div>

          {/* Right AI Research & Co-Pilot Panel */}
          <RightPanel
            isOpen={isRightPanelOpen}
            onToggle={() => setIsRightPanelOpen(!isRightPanelOpen)}
            messages={messages}
            threads={chatStore.threads}
            activeThreadId={activeThread?.id || chatStore.activeThreadId}
            onSelectThread={handleSelectChatThread}
            onCreateThread={handleCreateChatThread}
            onRenameThread={handleRenameChatThread}
            onDeleteThread={handleDeleteChatThread}
            onSendMessage={handleSendChatMessage}
            onInsertToNotes={handleInsertToNotes}
            onInsertDiagram={handleInsertDiagram}
            onClearChat={() => {
              const targetThreadId = activeThread?.id || chatStoreRef.current.activeThreadId
              updateAndPersistChatStore(activeProjectId, (prev) => ({
                ...prev,
                threads: prev.threads.map((t) =>
                  t.id === targetThreadId ? { ...t, messages: [], updatedAt: Date.now() } : t
                )
              }))
            }}
            isAiBusy={aiBusy}
            isAiConfigured={isAiConfigured}
            aiUnconfiguredReason={aiReadiness.reason}
            activeModel={
              settings.ai.provider === 'ollama'
                ? settings.ai.ollamaModel
                : settings.ai.byokModels[settings.ai.provider] || DEFAULT_PROVIDER_MODELS[settings.ai.provider]
            }
            activeProvider={settings.ai.provider.toUpperCase()}
            projectId={activeProjectId}
            sectionId={activeSection?.id}
            projectTitle={activeProject?.title}
            isDetached={isDetachedChat}
            onOpenDetached={() => window.glassAPI?.openDetachedChat?.()}
            onCloseDetached={() => window.glassAPI?.closeDetachedChat?.()}
            aiSettings={settings.ai}
            onChangeAI={(ai) => patchSettings({ ai })}
            onToast={addToast}
            openSettingsTrigger={settingsTrigger}
            onOpenKnowledgeHub={() => setIsKnowledgeHubOpen(true)}
            onGenerateTutorial={(topic) => handleGenerateTutorial(topic)}
            onAddYouTubeToCanvas={handleAddYouTubeToCanvas}
          />

          {/* Knowledge Studio Multi-Source Study Hub */}
          <KnowledgeHub
            isOpen={isKnowledgeHubOpen}
            boardId={activeSection.id}
            projectId={activeProjectId ?? undefined}
            onClose={() => setIsKnowledgeHubOpen(false)}
            onGenerateTutorial={handleGenerateTutorial}
            onAddYouTubeToCanvas={handleAddYouTubeToCanvas}
            getCurrentBoardSummary={summarizeCurrentBoard}
            onToast={addToast}
            isAiBusy={aiBusy}
            isAiConfigured={isAiConfigured}
            aiUnconfiguredReason={aiReadiness.reason}
            onOpenAiSettings={() => setSettingsOpen(true)}
            onRunAction={handleNotebookAction}
          />
        </>
      )}

      {/* Settings Modal */}
      {settingsOpen && (
        <SettingsModal
          ai={settings.ai}
          onChangeAI={(ai) => patchSettings({ ai })}
          onClose={() => setSettingsOpen(false)}
          onToast={addToast}
        />
      )}

      {/* Toasts */}
      <Toasts toasts={toasts} />
    </div>
  )
}
