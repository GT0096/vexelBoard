import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Bot, BoxSelect, Layers, Loader2, PenTool, Sparkles, Trash2, Wand2, X } from 'lucide-react'
import type {
  BoardState,
  CanvasTransform,
  ChatMessage,
  CodeNode,
  CodeTabItem,
  DiagramNode,
  EquationNode,
  EraserMode,
  FontId,
  InkPoint,
  PortSide,
  ShapeNode,
  Stroke,
  TextNode,
  Toast,
  ToolType,
  VectorArtNode,
  VectorDiagramMeta,
  VideoNode,
  VideoTabItem,
  WritingPadDetection
} from './types/board'
import type { DiagramDirection, SmartBeautifyMode, SpatialScene } from '@shared/beautifySchema'
import type { AgentActiveCodeContext, AgentMode, AgentStepEvent } from '@shared/agentSchema'
import { unescapeLlmCode, unescapeLlmText } from '@shared/textUnescape'
import { applyAgentMutationsToBoard, buildAgentBoardSnapshot } from './board/agentExecutor'
import {
  collectOccupiedBoardRects,
  findEmptyBoardRect,
  getSafeViewportScreenRect
} from './board/placementUtils'
import { buildEmbeddedShapeNode, resolveEmbeddedShapeSpec } from './board/shapePlacement'
import {
  assignTopologicalFlowStages,
  buildTransformerVsMoEAnimatedDiagram
} from './board/animatedArchitectureBuilder'
import { getLibraryShape } from './shapes/shapeLibrary'
import { FONTS, FONT_ORDER, resolveFontCss, resolveThemeTokens } from './themes'
import {
  drawHoldSnapPulse,
  drawLiveConnectionPreview,
  drawShape,
  drawShapeConnectionPorts,
  drawStroke,
  drawVectorArt,
  getStrokeBoundsCached,
  isBoundsInViewport,
  screenToCanvas,
  strokesToOcrImage
} from './board/render'
import {
  buildFlowConnectorNode,
  buildGraphFromBoardShapes,
  convertConnectorRouting,
  getOppositePort,
  getShapePortHandles,
  getShapePorts,
  inferFreeEndPort,
  isConnectorShape,
  pickNearestPort,
  portNormal,
  remapDuplicatedConnectors,
  syncBoundConnectors
} from './board/connectorUtils'
import {
  addInkLayer,
  deleteInkLayer,
  ensureBoardLayers,
  isItemEditable,
  isItemVisible,
  moveLayer,
  partitionInkLayers,
  renameLayer,
  resolveItemLayerId,
  resolveTargetInkLayerId,
  setLayerOpacity,
  toggleLayerLocked,
  toggleLayerVisible
} from './board/layerUtils'
import {
  renderSelectedDiagramToImage,
  parseAndCleanReactFlow,
  generateSmartLocalReactFlowDiagram,
  buildBoardNativeTemplateDiagram,
  type CleanReactFlowResult
} from './board/beautifyUtils'
import { compileFlowDiagramToBoardElements } from './board/nativeDiagramCompiler'
import {
  buildHybridCalloutNodes,
  buildImmersedTextFromOcr,
  looksLikePureHandwriting,
  measureBoardText,
  rasterizeSelectionColorPreserving,
  renderSpatialComparisonPng,
  generateLocalVectorDiagram
} from './board/vectorizeUtils'
import { compileSpatialScene } from './board/spatialSceneCompiler'
import { useHoldToSnap } from './board/useHoldToSnap'
import { buildShapeNodeFromHoldSnap } from './board/holdSnapClassifier'
import { layoutDiagramWithElkWorker } from './board/elkDiagramLayout'
import {
  BoundsRect,
  eraseStrokesAlongPath,
  eraseShapesAlongPath,
  eraseVectorArtAlongPath,
  getShapeBoundingRect,
  normalizeRect,
  isShapeInRect,
  isStrokeInRect,
  isTextInRect,
  isEquationInRect,
  isDiagramInRect,
  isCodeInRect,
  isVectorArtInRect
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
import { isLightColor, resolveBoardPalette } from './board/backgroundPresets'
import { Toolbar } from './components/Toolbar'
import { LeftDockToolbar } from './components/LeftDockToolbar'
import { TopBar } from './components/TopBar'
import { CanvasElements } from './components/CanvasElements'
import { Toasts } from './components/Toasts'
import { VectorActionToolbar } from './components/VectorActionToolbar'
import { LayersPanel } from './components/LayersPanel'
import { CanvasContextMenu } from './components/CanvasContextMenu'

const HomeHub = lazy(() => import('./components/HomeHub').then((m) => ({ default: m.HomeHub })))
const RightPanel = lazy(() => import('./components/RightPanel').then((m) => ({ default: m.RightPanel })))
const KnowledgeHub = lazy(() => import('./components/KnowledgeHub').then((m) => ({ default: m.KnowledgeHub })))
const SettingsModal = lazy(() => import('./components/SettingsModal').then((m) => ({ default: m.SettingsModal })))

export interface DragSnapshot {
  shapes: Array<{
    id: string
    initX: number
    initY: number
    initControlPoint?: [number, number]
    initPoints?: Array<[number, number]>
  }>
  vectorArts?: Array<{ id: string; initX: number; initY: number }>
  texts: Array<{ id: string; initX: number; initY: number }>
  equations: Array<{ id: string; initX: number; initY: number }>
  diagrams: Array<{ id: string; initX: number; initY: number }>
  codes: Array<{ id: string; initX: number; initY: number }>
  videos?: Array<{ id: string; initX: number; initY: number }>
  strokes: Array<{ id: string; initPoints: InkPoint[] }>
}

export type ResizeHandle8 = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export interface ShapeDragState {
  kind: 'move' | 'shape-resize' | 'vector-art-resize' | 'connect'
  handle?: ResizeHandle8
  targetId?: string
  initX?: number
  initY?: number
  initW?: number
  initH?: number
  initControlPoint?: [number, number]
  initPoints?: Array<[number, number]>
  sourceShapeId?: string
  sourcePort?: PortSide
  currentX?: number
  currentY?: number
  snapTarget?: { shapeId: string; port: PortSide } | null
  startPinchX: number
  startPinchY: number
  snapshots?: DragSnapshot
}

function getShapeResizeHandles(
  b: { x: number; y: number; w: number; h: number },
  pad = 4
): Array<{ handle: ResizeHandle8; x: number; y: number }> {
  const sx = b.x
  const sy = b.y
  const sw = Math.max(12, b.w)
  const sh = Math.max(12, b.h)
  const mx = sx + sw / 2
  const my = sy + sh / 2
  return [
    { handle: 'nw', x: sx - pad, y: sy - pad },
    { handle: 'n', x: mx, y: sy - pad },
    { handle: 'ne', x: sx + sw + pad, y: sy - pad },
    { handle: 'e', x: sx + sw + pad, y: my },
    { handle: 'se', x: sx + sw + pad, y: sy + sh + pad },
    { handle: 's', x: mx, y: sy + sh + pad },
    { handle: 'sw', x: sx - pad, y: sy + sh + pad },
    { handle: 'w', x: sx - pad, y: my }
  ]
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
      const b = getShapeBoundingRect(s)
      if (b.minX < minX) minX = b.minX
      if (b.minY < minY) minY = b.minY
      if (b.maxX > maxX) maxX = b.maxX
      if (b.maxY > maxY) maxY = b.maxY
    }
  }

  for (const v of board.vectorArtNodes ?? []) {
    if (idSet.has(v.id)) {
      found = true
      minX = Math.min(minX, v.x, v.x + v.width)
      minY = Math.min(minY, v.y, v.y + v.height)
      maxX = Math.max(maxX, v.x, v.x + v.width)
      maxY = Math.max(maxY, v.y, v.y + v.height)
    }
  }

  for (const t of board.textNodes) {
    if (idSet.has(t.id)) {
      found = true
      const tw =
        t.w ??
        (t.immersed
          ? Math.max(
            40,
            Math.min(
              640,
              Math.max(...t.text.split('\n').map((l) => l.length), 4) * (t.fontSize || 20) * 0.62
            )
          )
          : 260)
      const th =
        t.h ??
        (t.immersed
          ? Math.max(28, (t.text.split('\n').length || 1) * (t.fontSize || 20) * 1.4)
          : 120)
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

function findFreeBoardPlacement(
  board: BoardState,
  itemW: number,
  itemH: number,
  view: CanvasTransform,
  opts?: { topMargin?: number; gap?: number }
): { x: number; y: number; nextPan?: { panX: number; panY: number } } {
  return findEmptyBoardRect(
    collectOccupiedBoardRects(board),
    itemW,
    itemH,
    view,
    getSafeViewportScreenRect(),
    opts
  )
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
  const [isVectorizing, setIsVectorizing] = useState(false)
  const [agentRunning, setAgentRunning] = useState(false)
  const [agentSteps, setAgentSteps] = useState<AgentStepEvent[]>([])
  const [canUndoLastAgent, setCanUndoLastAgent] = useState(false)
  const activeAgentRunIdRef = useRef<string | null>(null)
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

  useEffect(() => {
    const off = window.glassAPI?.onAgentEvent?.((ev) => {
      if (activeAgentRunIdRef.current && ev.runId !== activeAgentRunIdRef.current) return
      setAgentSteps((prev) => [...prev.slice(-30), ev])
    })
    return () => off?.()
  }, [])

  // Window State
  const [clickThrough, setClickThrough] = useState(false)
  const [isMaximized, setIsMaximized] = useState(false)

  // DOM Refs & Dual-Canvas Layers (Base Canvas + Annotation Overlay Canvas)
  const committedCanvasRef = useRef<HTMLCanvasElement>(null)
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const rafIdRef = useRef<number | null>(null)
  const scheduleRenderRef = useRef<() => void>(() => {})
  const [isLayersOpen, setIsLayersOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    worldX: number
    worldY: number
  } | null>(null)
  const [editingShapeId, setEditingShapeId] = useState<string | null>(null)
  const [editingShapeText, setEditingShapeText] = useState('')

  const { layers: boardLayers, activeLayerId } = useMemo(
    () => ensureBoardLayers(board),
    [board.layers, board.activeLayerId]
  )
  const partitionedLayers = useMemo(
    () => partitionInkLayers(boardLayers),
    [boardLayers]
  )
  const boardLayersRef = useRef(boardLayers)
  boardLayersRef.current = boardLayers
  const partitionedLayersRef = useRef(partitionedLayers)
  partitionedLayersRef.current = partitionedLayers

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
  const hoveredShapeIdRef = useRef<string | null>(null)
  const hoveredPortRef = useRef<{ shapeId: string; port: PortSide } | null>(null)
  const selectionBoxRef = useRef<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null)

  // Element Selection & Drag Refs
  const shapeDragRef = useRef<ShapeDragState | null>(null)
  const pendingOcrStrokeIdsRef = useRef<string[]>([])
  const ocrTimerRef = useRef<number | null>(null)

  // Offline 350ms Hold-to-Snap Web Worker hook (Pen mode)
  const holdSnap = useHoldToSnap(
    () => boardRef.current.shapeNodes,
    () => scheduleRenderRef.current()
  )

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
  const fontCss = resolveFontCss(settings.font)

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
    for (const c of [committedCanvasRef.current, overlayCanvasRef.current]) {
      if (c && (c.width !== w || c.height !== h)) {
        c.width = w
        c.height = h
      }
    }
    scheduleRenderRef.current()
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

  const handleCancelAgent = useCallback(() => {
    const runId = activeAgentRunIdRef.current
    if (!runId) return
    void window.glassAPI?.cancelAgent?.(runId)
  }, [])

  const handleRunAgent = useCallback(
    async (
      prompt: string,
      opts?: {
        mode?: AgentMode
        selectedSourceIds?: string[]
        activeCodeContext?: AgentActiveCodeContext
        includeSelectionImage?: boolean
        openPanel?: boolean
      }
    ) => {
      if (!isAiConfiguredRef.current) {
        addToast('info', aiReasonRef.current || 'Configure AI Settings to enable AI features.')
        setSettingsOpen(true)
        return
      }
      const api = window.glassAPI
      if (!api?.runAgent) {
        addToast('error', 'Agent Harness IPC bridge unavailable')
        return
      }
      if (opts?.openPanel) {
        setIsRightPanelOpen(true)
      }

      const requestProjectId = activeProjectId
      const targetThreadId = activeThread?.id || chatStoreRef.current.activeThreadId
      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: prompt,
        timestamp: Date.now(),
        sectionId: activeSection?.id,
        sectionTitle: activeSection?.title
      }
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

      const runId = `agent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
      activeAgentRunIdRef.current = runId
      setAgentSteps([])
      setCanUndoLastAgent(false)
      setAgentRunning(true)

      const curBoard = boardRef.current
      const curSelected = selectedIdsRef.current
      const selBounds = getSelectionBounds(curBoard, curSelected)
      const selectionBounds = selBounds
        ? {
            x: Math.round(selBounds.x),
            y: Math.round(selBounds.y),
            width: Math.round(selBounds.w),
            height: Math.round(selBounds.h)
          }
        : undefined

      const curView = viewRef.current
      const viewportCenter = {
        x: Math.round((window.innerWidth / 2 - curView.panX) / curView.zoom),
        y: Math.round((window.innerHeight / 2 - curView.panY) / curView.zoom)
      }

      const currentSettings = settingsRef.current
      const palette = resolveBoardPalette(currentSettings.backgroundColor)
      const activeThemeTokens = resolveThemeTokens(
        currentSettings.backgroundColor,
        currentSettings.theme,
        palette
      )

      let imageBase64: string | undefined
      if (opts?.includeSelectionImage && curSelected.length > 0) {
        const crop = rasterizeSelectionColorPreserving(
          curBoard,
          curSelected,
          activeThemeTokens.ink,
          activeThemeTokens.accent
        )
        if (crop?.base64Png) {
          imageBase64 = crop.base64Png
        } else {
          const fallbackImg = renderSelectedDiagramToImage(curBoard, curSelected, activeThemeTokens)
          imageBase64 = fallbackImg?.base64
        }
      }

      const recentChatHistory = messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(-8)
        .map((m) => ({ role: m.role, content: m.content }))

      const occupiedRects = collectOccupiedBoardRects(curBoard)
      const suggestedRect = findEmptyBoardRect(
        occupiedRects,
        760,
        480,
        curView,
        getSafeViewportScreenRect(),
        { gap: 40 }
      )
      const suggestedEmptyArea = {
        x: suggestedRect.x,
        y: suggestedRect.y,
        width: 760,
        height: 480
      }

      const snapshot = buildAgentBoardSnapshot({
        board: curBoard,
        boardId: activeSection?.id || 'default-board',
        projectId: requestProjectId ?? undefined,
        selectedIds: curSelected,
        selectionBounds,
        viewportCenter,
        suggestedEmptyArea,
        imageBase64
      })

      const activeProvider = currentSettings.ai.provider
      const activeModel =
        activeProvider === 'ollama'
          ? currentSettings.ai.ollamaModel
          : currentSettings.ai.byokModels[activeProvider] || DEFAULT_PROVIDER_MODELS[activeProvider]

      try {
        const result = await api.runAgent({
          runId,
          prompt,
          mode: opts?.mode ?? 'general',
          provider: activeProvider,
          model: activeModel,
          ollamaHost: currentSettings.ai.ollamaHost,
          boardSnapshot: snapshot,
          activeCodeContext: opts?.activeCodeContext,
          selectedSourceIds: opts?.selectedSourceIds,
          chatHistory: recentChatHistory,
          maxSteps: 8
        })

        let appliedCount = 0
        if (result.mutations && result.mutations.length > 0) {
          pushHistory()
          const latestBoard = boardRef.current
          const safeRect = getSafeViewportScreenRect()
          const latestView = viewRef.current
          const outcome = applyAgentMutationsToBoard(latestBoard, result.mutations, {
            viewportCenter,
            view: latestView,
            screenSafe: safeRect,
            selectionBounds,
            fontFamily: currentSettings.font,
            defaultInkColor: activeThemeTokens.accent
          })
          update((b) => {
            if (b === latestBoard) return outcome.nextBoard
            return applyAgentMutationsToBoard(b, result.mutations, {
              viewportCenter,
              view: viewRef.current,
              screenSafe: getSafeViewportScreenRect(),
              selectionBounds,
              fontFamily: currentSettings.font,
              defaultInkColor: activeThemeTokens.accent
            }).nextBoard
          })
          appliedCount = outcome.appliedCount
          if (outcome.nextPan) {
            const np = outcome.nextPan
            setView((v) => ({ ...v, panX: np.panX, panY: np.panY }))
          }
          setCanUndoLastAgent(appliedCount > 0)
          scheduleRenderRef.current()
        }

        const finalText = result.aborted
          ? 'Stopped active agent run.'
          : result.ok
            ? result.answer ||
              (appliedCount > 0 ? `Applied ${appliedCount} update(s) to the board.` : 'Done.')
            : `Agent error: ${result.error || 'Unknown error'}`

        const aiMsg: ChatMessage = {
          id: `ai-${Date.now()}`,
          role: 'assistant',
          content: finalText,
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
          await persistProjectChatStore(requestProjectId, {
            ...latest,
            threads: latest.threads.map((t) =>
              t.id === targetThreadId
                ? { ...t, messages: [...t.messages, aiMsg], updatedAt: aiMsg.timestamp }
                : t
            )
          })
        }

        if (appliedCount > 0) {
          addToast(
            'success',
            `Agent applied ${appliedCount} board update${appliedCount === 1 ? '' : 's'}`
          )
        } else if (!result.ok && !result.aborted && result.error) {
          addToast('error', result.error)
        }
      } catch (err) {
        addToast('error', `Agent failed: ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        setAgentRunning(false)
      }
    },
    [
      activeProjectId,
      activeSection?.id,
      activeSection?.title,
      activeThread?.id,
      messages,
      addToast,
      boardRef,
      pushHistory,
      update,
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
        const colStride = 560
        const cardW = 500
        const totalTutorialW = Math.max(540, tut.steps.length * colStride - 60)
        const totalTutorialH = 1080
        const placement = findFreeBoardPlacement(
          boardRef.current,
          totalTutorialW,
          totalTutorialH,
          curView,
          { gap: 40 }
        )
        const startX = placement.x
        const startY = placement.y
        const cleanTopic = unescapeLlmText(tut.topic || shortTitle)
        const cleanOverview = unescapeLlmText(tut.overview)
        const tutorialFont: FontId =
          tut.fontFamily && tut.fontFamily in FONTS
            ? (tut.fontFamily as FontId)
            : settingsRef.current.font
        const roadmap = tut.steps
          .map((s, idx) => `**${idx + 1}.** ${unescapeLlmText(s.title).replace(/^\d+[.)]\s*/, '')}`)
          .join('  →  ')
        const approachBanner = tut.pedagogicalRationale
          ? `\n\n**Teaching Strategy${tut.approach ? ` (${tut.approach.replace(/_/g, ' ')})` : ''}:** ${unescapeLlmText(tut.pedagogicalRationale)}`
          : tut.approach
            ? `\n\n**Teaching Strategy:** ${tut.approach.replace(/_/g, ' ')}`
            : ''
        const bannerH = approachBanner ? 200 : 175

        // Header Banner Note
        const headerNode: TextNode = {
          id: `tut-header-${Date.now()}`,
          x: startX,
          y: startY,
          w: Math.min(1640, totalTutorialW),
          h: bannerH,
          text: `# 🎓 Visual Tutorial: ${cleanTopic}\n\n> ${cleanOverview}${approachBanner}\n\n**Roadmap:** ${roadmap}`,
          title: `Tutorial: ${cleanTopic}`,
          fontSize: 15,
          fontFamily: tutorialFont,
          color: 'ink',
          bg: tut.accentFill || '#FEF9C3',
          source: 'ai',
          createdAt: Date.now()
        }

        const newTextNodes: TextNode[] = [headerNode]
        const newEquationNodes: EquationNode[] = []
        const newCodeNodes: CodeNode[] = []
        const newShapeNodes: ShapeNode[] = []
        const newVectorDiagramMeta: Record<string, VectorDiagramMeta> = {}
        const targetLayerId = resolveTargetInkLayerId(boardRef.current) ?? 'layer-base-ink'

        const stepY = startY + bannerH + 30

        tut.steps.forEach((st, i) => {
          const cardX = startX + i * colStride
          const cleanStepTitle = unescapeLlmText(st.title).replace(/^\d+[.)]\s*/, '')
          const numberedTitle = `${i + 1}. ${cleanStepTitle}`
          const cleanExplanation = unescapeLlmText(st.explanation)
          const bullets =
            st.keyPoints?.map((k) => `- ${unescapeLlmText(k)}`).join('\n') || ''
          const cardText = [
            `### ${numberedTitle}`,
            '',
            cleanExplanation,
            bullets ? `\n#### Key Takeaways\n${bullets}` : ''
          ]
            .filter(Boolean)
            .join('\n')

          const noteH = Math.max(
            190,
            Math.min(310, Math.round(130 + (cardText.length / 48) * 18))
          )
          let curY = stepY

          newTextNodes.push({
            id: `tut-step-${Date.now()}-${i}`,
            x: cardX,
            y: curY,
            w: cardW,
            h: noteH,
            text: cardText,
            title: numberedTitle,
            fontSize: 14,
            fontFamily: tutorialFont,
            color: 'ink',
            bg: undefined,
            source: 'ai',
            createdAt: Date.now() + i
          })

          if (i < tut.steps.length - 1) {
            newShapeNodes.push({
              id: `tut-arrow-${Date.now()}-${i}`,
              shape: 'arrow',
              x: cardX + cardW + 8,
              y: curY + Math.round(noteH / 2),
              w: colStride - cardW - 16,
              h: 0,
              color: 'accent',
              strokeWidth: 3
            })
          }

          curY += noteH + 24

          // 1. Step-by-step Equations (ideal for math derivations, physics laws, and trading formulas)
          const stepEquations = Array.from(
            new Set(
              [
                ...(Array.isArray(st.equations) ? st.equations : []),
                ...(st.equationLatex ? [st.equationLatex] : [])
              ]
                .map((eq) => String(eq ?? '').trim())
                .filter(Boolean)
            )
          )
          stepEquations.forEach((latex, eqIdx) => {
            newEquationNodes.push({
              id: `tut-eq-${Date.now()}-${i}-${eqIdx}`,
              x: cardX,
              y: curY,
              w: cardW,
              latex,
              fontSize: 20,
              color: 'accent',
              createdAt: Date.now() + i * 10 + eqIdx
            })
            curY += 104
          })

          // 2. Domain-specific 2D SpatialScene (trading plots, physics vector diagrams, memory layouts)
          if (st.scene && typeof st.scene === 'object') {
            const compiledScene = compileSpatialScene(
              st.scene as SpatialScene,
              { x: cardX, y: curY, width: cardW, height: 320 },
              tutorialFont,
              {
                measureText: (txt, fs, bld) => measureBoardText(txt, fs, bld, tutorialFont),
                layerId: targetLayerId
              }
            )
            newShapeNodes.push(...compiledScene.shapes)
            newTextNodes.push(...compiledScene.texts)
            newVectorDiagramMeta[compiledScene.groupId] = {
              groupId: compiledScene.groupId,
              anchor: { x: compiledScene.bounds.x, y: compiledScene.bounds.y },
              spatialScene: st.scene as SpatialScene
            }
            curY += 348
          } else if (
            (Array.isArray(st.diagramNodes) && st.diagramNodes.length > 0) ||
            (typeof st.diagramMermaid === 'string' && st.diagramMermaid.trim().length > 0)
          ) {
            // 3. Connected board-native flow/topology diagram only when actually provided
            const diagramSource =
              Array.isArray(st.diagramNodes) && st.diagramNodes.length > 0
                ? JSON.stringify({
                    title: numberedTitle,
                    diagramType: 'flowchart',
                    nodes: st.diagramNodes,
                    edges: st.diagramEdges || []
                  })
                : unescapeLlmText(st.diagramMermaid!)

            const parsedFlow = parseAndCleanReactFlow(diagramSource)
            const compiledDiag = compileFlowDiagramToBoardElements(
              parsedFlow,
              {
                x: cardX,
                y: curY,
                w: cardW,
                h: 320
              },
              {
                fontFamily: tutorialFont,
                layerId: targetLayerId,
                defaultFillColor: tut.accentFill || boardPalette.shapeFill
              }
            )
            newShapeNodes.push(...compiledDiag.shapes)
            newTextNodes.push(...compiledDiag.texts)
            newVectorDiagramMeta[compiledDiag.groupId] = compiledDiag.meta
            curY += compiledDiag.bounds.h + 28
          }

          // 4. Runnable Code Card only when code genuinely belongs to the step
          if (st.codeSnippet && st.codeSnippet.code && st.codeSnippet.code.trim()) {
            const tabId = `tab-${Date.now()}-${i}`
            const lang = st.codeSnippet.language || 'python'
            const ext = lang === 'javascript' ? 'js' : lang === 'typescript' ? 'ts' : 'py'
            const slug =
              cleanStepTitle
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '_')
                .replace(/^_+|_+$/g, '')
                .slice(0, 22) || `step_${i + 1}`
            newCodeNodes.push({
              id: `tut-code-${Date.now()}-${i}`,
              x: cardX,
              y: curY,
              w: cardW,
              h: 320,
              title: `${slug}.${ext}`,
              tabs: [
                {
                  id: tabId,
                  title: `${slug}.${ext}`,
                  language: lang,
                  code: unescapeLlmCode(st.codeSnippet.code)
                }
              ],
              activeTabId: tabId,
              createdAt: Date.now() + i
            })
          }
        })

        pushHistory()
        update((b) => ({
          ...b,
          textNodes: [...b.textNodes, ...newTextNodes],
          equationNodes: [...b.equationNodes, ...newEquationNodes],
          codeNodes: [...(b.codeNodes ?? []), ...newCodeNodes],
          shapeNodes: [...b.shapeNodes, ...newShapeNodes],
          vectorDiagramMeta: {
            ...(b.vectorDiagramMeta ?? {}),
            ...newVectorDiagramMeta
          }
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

        scheduleRenderRef.current()
        addToast('success', `Created ${tut.steps.length}-step visual tutorial with native board diagrams!`)
      } catch (err: any) {
        addToast('error', `Tutorial generation error: ${err?.message || err}`)
      } finally {
        setAiBusy(false)
      }
    },
    [addToast, update, summarizeCurrentBoard, activeSection?.id, boardPalette.shapeFill, pushHistory]
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
      const curBoard = boardRef.current
      const activeFont = settingsRef.current.font
      const targetLayerId = resolveTargetInkLayerId(curBoard) ?? 'layer-base-ink'

      const draft = compileFlowDiagramToBoardElements(
        parsedFlow,
        { x: 0, y: 0 },
        {
          fontFamily: activeFont,
          defaultFillColor: boardPalette.shapeFill
        }
      )

      const placement = findFreeBoardPlacement(curBoard, draft.bounds.w, draft.bounds.h, curView, {
        topMargin: 24,
        gap: 28
      })

      const compiled = compileFlowDiagramToBoardElements(
        parsedFlow,
        { x: placement.x, y: placement.y },
        {
          fontFamily: activeFont,
          layerId: targetLayerId,
          defaultFillColor: boardPalette.shapeFill,
          existingGroupId: draft.groupId
        }
      )

      pushHistory()
      update((b) => ({
        ...b,
        shapeNodes: [...b.shapeNodes, ...compiled.shapes],
        textNodes: [...b.textNodes, ...compiled.texts],
        vectorDiagramMeta: {
          ...(b.vectorDiagramMeta ?? {}),
          [compiled.groupId]: compiled.meta
        }
      }))
      const createdIds = [
        ...compiled.shapes.map((s) => s.id),
        ...compiled.texts.map((t) => t.id)
      ]
      setSelectedId(createdIds[0] ?? null)
      setSelectedIds(createdIds)
      setActiveTool('select')
      if (placement.nextPan) {
        setView((v) => ({
          ...v,
          panX: placement.nextPan!.panX,
          panY: placement.nextPan!.panY
        }))
      }
      scheduleRenderRef.current()
      addToast('success', `✨ Created ${compiled.title} in free board space!`)
    },
    [update, addToast, setSelectedId, setSelectedIds, boardPalette.shapeFill, pushHistory]
  )

  /* ---------------- Left Dock Toolbar Handlers ---------------- */
  const handleAddStickyNote = useCallback(
    (color: string) => {
      const curBoard = boardRef.current
      const noteW = 230
      const noteH = 150
      const placement = findFreeBoardPlacement(curBoard, noteW, noteH, viewRef.current)
      const newNote: TextNode = {
        id: `text-${Date.now().toString(36)}`,
        x: Math.round(placement.x),
        y: Math.round(placement.y),
        w: noteW,
        text: 'Double-click to write...',
        fontSize: 16,
        fontFamily: settingsRef.current.font,
        color: 'ink',
        bg: color || '#fef08a',
        source: 'manual',
        createdAt: Date.now()
      }

      update((b) => ({
        ...b,
        textNodes: [...b.textNodes, newNote]
      }))
      if (placement.nextPan) {
        setView((v) => ({
          ...v,
          panX: placement.nextPan!.panX,
          panY: placement.nextPan!.panY
        }))
      }
      setSelectedId(newNote.id)
      setSelectedIds([newNote.id])
      setActiveTool('select')
      addToast('success', 'Added sticky note to board')
    },
    [update, setSelectedId, setSelectedIds, addToast]
  )

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
      if (shapeType === 'sticky') {
        handleAddStickyNote(options?.color || '#fef08a')
        return
      }

      const curBoard = boardRef.current
      const spec = resolveEmbeddedShapeSpec(
        shapeType,
        options,
        boardPalette.shapeFill,
        getLibraryShape
      )
      const placement = findFreeBoardPlacement(curBoard, spec.w, spec.h, viewRef.current)
      const targetLayerId = resolveTargetInkLayerId(curBoard) ?? 'layer-base-ink'
      const newShape = buildEmbeddedShapeNode(
        shapeType,
        options,
        placement,
        {
          fillColor: boardPalette.shapeFill,
          fontFamily: settingsRef.current.font,
          layerId: targetLayerId
        },
        getLibraryShape
      )

      update((b) => ({
        ...b,
        shapeNodes: [...b.shapeNodes, newShape]
      }))
      if (placement.nextPan) {
        setView((v) => ({
          ...v,
          panX: placement.nextPan!.panX,
          panY: placement.nextPan!.panY
        }))
      }
      setSelectedId(newShape.id)
      setSelectedIds([newShape.id])
      setActiveTool('select')
      scheduleRenderRef.current()
      addToast('success', `Added ${options?.label || shapeType} to board`)
    },
    [boardPalette.shapeFill, handleAddStickyNote, update, setSelectedId, setSelectedIds, addToast]
  )

  const handleAddTemplate = useCallback(
    (templateId: string) => {
      if (templateId === 'transformer_vs_moe') {
        const curBoard = boardRef.current
        const placement = findFreeBoardPlacement(curBoard, 1060, 880, viewRef.current, {
          gap: 40,
          topMargin: 56
        })
        const targetLayerId = resolveTargetInkLayerId(curBoard) ?? 'layer-base-ink'
        const arch = buildTransformerVsMoEAnimatedDiagram(
          { x: placement.x, y: placement.y },
          settingsRef.current.font,
          targetLayerId
        )

        update((b) => ({
          ...b,
          shapeNodes: [...b.shapeNodes, ...arch.shapes],
          textNodes: [...b.textNodes, ...arch.texts]
        }))
        if (placement.nextPan) {
          setView((v) => ({
            ...v,
            panX: placement.nextPan!.panX,
            panY: placement.nextPan!.panY
          }))
        }
        setSelectedId(null)
        setSelectedIds([])
        setActiveTool('select')
        pushHistory()
        scheduleRenderRef.current()
        addToast(
          'success',
          '✨ Created animated Transformer vs. Mixture of Experts architecture diagram!'
        )
        return
      }

      const curBoard = boardRef.current
      const activeFont = settingsRef.current.font
      const targetLayerId = resolveTargetInkLayerId(curBoard) ?? 'layer-base-ink'
      const draft = buildBoardNativeTemplateDiagram(templateId, { x: 0, y: 0 }, {
        fontFamily: activeFont,
        defaultFillColor: boardPalette.shapeFill
      })
      const placement = findFreeBoardPlacement(curBoard, draft.bounds.w, draft.bounds.h, viewRef.current, {
        gap: 32,
        topMargin: 24
      })
      const compiled = buildBoardNativeTemplateDiagram(
        templateId,
        { x: placement.x, y: placement.y },
        {
          fontFamily: activeFont,
          layerId: targetLayerId,
          defaultFillColor: boardPalette.shapeFill
        }
      )

      pushHistory()
      update((b) => ({
        ...b,
        shapeNodes: [...b.shapeNodes, ...compiled.shapes],
        textNodes: [...b.textNodes, ...compiled.texts],
        vectorDiagramMeta: {
          ...(b.vectorDiagramMeta ?? {}),
          [compiled.groupId]: compiled.meta
        }
      }))
      if (placement.nextPan) {
        setView((v) => ({
          ...v,
          panX: placement.nextPan!.panX,
          panY: placement.nextPan!.panY
        }))
      }
      const createdIds = [
        ...compiled.shapes.map((s) => s.id),
        ...compiled.texts.map((t) => t.id)
      ]
      setSelectedId(createdIds[0] ?? null)
      setSelectedIds(createdIds)
      setActiveTool('select')
      scheduleRenderRef.current()
      addToast('success', `✨ Created ${compiled.title} template!`)
    },
    [update, setSelectedId, setSelectedIds, pushHistory, addToast, boardPalette.shapeFill]
  )

  const handleSyncAnimatedWaveFlow = useCallback(() => {
    const selIds = selectedIdsRef.current
    if (selIds.length === 0) return
    update(
      (b) => ({
        ...b,
        shapeNodes: assignTopologicalFlowStages(b.shapeNodes, selIds)
      }),
      { history: true }
    )
    scheduleRenderRef.current()
    addToast('success', '⚡ Synchronized animated signal wave flow across connected shapes!')
  }, [update, addToast])

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

    const originalStrokes = curBoard.strokes.filter((s) => idSet.has(s.id))
    const originalShapes = curBoard.shapeNodes.filter((s) => idSet.has(s.id))
    const originalTexts = curBoard.textNodes.filter((t) => idSet.has(t.id))
    const targetLayerId = resolveTargetInkLayerId(curBoard) ?? 'layer-base-ink'

    const compiled = compileFlowDiagramToBoardElements(
      effectiveFlow,
      {
        x: bounds.x,
        y: bounds.y,
        w: bounds.w,
        h: bounds.h
      },
      {
        fontFamily: settingsRef.current.font,
        layerId: targetLayerId,
        defaultFillColor: boardPalette.shapeFill,
        originalStrokes,
        originalShapes,
        originalTexts
      }
    )

    update((b) => ({
      ...b,
      strokes: b.strokes.filter((s) => !idSet.has(s.id)),
      shapeNodes: [...b.shapeNodes.filter((s) => !idSet.has(s.id)), ...compiled.shapes],
      textNodes: [...b.textNodes.filter((t) => !idSet.has(t.id)), ...compiled.texts],
      equationNodes: b.equationNodes.filter((eq) => !idSet.has(eq.id)),
      vectorDiagramMeta: {
        ...(b.vectorDiagramMeta ?? {}),
        [compiled.groupId]: compiled.meta
      }
    }))

    const newIds = [
      ...compiled.shapes.map((s) => s.id),
      ...compiled.texts.map((t) => t.id)
    ]
    setSelectedId(newIds[0] ?? null)
    setSelectedIds(newIds)
    setActiveTool('select')
    pushHistory()
    scheduleRenderRef.current()
    addToast('success', `✨ Beautified sketch into ${compiled.title}! (Ctrl+Z to undo)`)
  }, [update, pushHistory, addToast, setSelectedId, themeTokens, boardPalette.shapeFill])

  /* ---------------- Smart Sketch-to-Vector Converter (Content-Aware Router + ELK + VTracer) ---------------- */
  const runSmartVectorize = useCallback(
    async (mode: SmartBeautifyMode = 'auto') => {
      // Cancel any pending debounced OCR so Vectorize processes the full stroke set once
      if (ocrTimerRef.current !== null) {
        window.clearTimeout(ocrTimerRef.current)
        ocrTimerRef.current = null
        pendingOcrStrokeIdsRef.current = []
      }

      const currentSelectedIds = selectedIdsRef.current
      const curBoard = boardRef.current

      let targetIds = currentSelectedIds
      if (targetIds.length === 0) {
        if (curBoard.strokes.length > 0 || curBoard.shapeNodes.length > 0) {
          targetIds = [
            ...curBoard.strokes.map((s) => s.id),
            ...curBoard.shapeNodes.map((s) => s.id),
            ...curBoard.textNodes.filter((t) => t.immersed).map((t) => t.id)
          ]
          setSelectedIds(targetIds)
        } else {
          addToast('info', 'Draw shapes, diagrams, illustrations, or handwriting with the pen first!')
          return
        }
      }

      const raster = rasterizeSelectionColorPreserving(
        curBoard,
        targetIds,
        themeTokens.ink,
        themeTokens.accent
      )
      if (!raster || !raster.base64Png) {
        addToast('error', 'Select hand-drawn strokes, shapes, or text to vectorize.')
        return
      }

      const activeFont: FontId =
        settingsRef.current.font && settingsRef.current.font in FONTS
          ? settingsRef.current.font
          : 'jakarta'

      const idSet = new Set(targetIds)
      const originalStrokes = curBoard.strokes.filter((s) => idSet.has(s.id))
      const originalShapes = curBoard.shapeNodes.filter((s) => idSet.has(s.id))
      const originalTexts = curBoard.textNodes.filter((t) => idSet.has(t.id))

      setIsVectorizing(true)
      setAiBusy(true)
      addToast(
        'info',
        mode === 'trace_only'
          ? 'Tracing original strokes offline into multi-color vector paths...'
          : `Analyzing & vectorizing selection (${FONTS[activeFont].label})...`
      )

      const api = window.glassAPI
      const currentSettings = settingsRef.current
      const activeProvider = currentSettings.ai.provider
      const activeModel =
        activeProvider === 'ollama'
          ? currentSettings.ai.ollamaModel
          : currentSettings.ai.byokModels[activeProvider] || DEFAULT_PROVIDER_MODELS[activeProvider]

      try {
        // 1. Pure Handwriting Fast-Path (auto mode + AI configured) -> frameless board-immersed text
        if (
          mode === 'auto' &&
          api &&
          isAiConfiguredRef.current &&
          looksLikePureHandwriting(curBoard, targetIds)
        ) {
          const ocrImage =
            originalStrokes.length > 0 ? strokesToOcrImage(originalStrokes).base64 : raster.base64Png
          const ocrRes = await api.runAI({
            provider: activeProvider,
            model: activeModel,
            ollamaHost: currentSettings.ai.ollamaHost,
            isHandwritingOCR: true,
            imageBase64: ocrImage
          })
          if (ocrRes.ok && ocrRes.recognizedText?.trim()) {
            const textRes = buildImmersedTextFromOcr(
              ocrRes.recognizedText.trim(),
              raster.bounds,
              activeFont,
              raster.dominantColor
            )
            update((b) => ({
              ...b,
              strokes: b.strokes.filter((s) => !idSet.has(s.id)),
              shapeNodes: b.shapeNodes.filter((s) => !idSet.has(s.id)),
              textNodes: [...b.textNodes.filter((t) => !idSet.has(t.id)), ...textRes.texts],
              equationNodes: b.equationNodes.filter((eq) => !idSet.has(eq.id))
            }))
            const newIds = textRes.texts.map((t) => t.id)
            setSelectedIds(newIds)
            setSelectedId(newIds[0] ?? null)
            setActiveTool('select')
            pushHistory()
            addToast(
              'success',
              `Converted handwriting into board-immersed ${FONTS[activeFont].label} text! (Ctrl+Z to undo)`
            )
            return
          }
        }

        // 2. Content-Aware Smart Beautify IPC (`canvas:smart-beautify`: Zod Classifier -> Spatial Compiler / ELK Diagram / VTracer+SVGO VectorArt)
        if (api?.smartBeautify && (mode === 'trace_only' || isAiConfiguredRef.current)) {
          const smartRes = await api.smartBeautify({
            base64Png: raster.base64Png,
            ruledBase64Png: raster.ruledBase64Png,
            width: raster.width,
            height: raster.height,
            mode,
            provider: activeProvider,
            model: activeModel,
            ollamaHost: currentSettings.ai.ollamaHost,
            temperature: currentSettings.ai.temperature,
            textHints: raster.textHints || undefined,
            paletteHints: raster.paletteHints,
            isMonochromeHint: raster.isMonochrome
          })

          if (smartRes && smartRes.ok) {
            // Branch S: Composable Spatial Scene -> Geometric Constraint Solver + Visual Critique Loop
            if (smartRes.category === 'spatial_scene' && smartRes.spatialScene) {
              const targetRect = {
                x: raster.anchor.x,
                y: raster.anchor.y,
                width: raster.width,
                height: raster.height
              }
              const measureFn = (txt: string, fs: number, bld: boolean): { w: number; h: number } =>
                measureBoardText(txt, fs, bld, activeFont)

              let activeScene = smartRes.spatialScene
              const targetInkLayerId = resolveTargetInkLayerId(curBoard) ?? undefined
              let compiled = compileSpatialScene(activeScene, targetRect, activeFont, {
                measureText: measureFn,
                layerId: targetInkLayerId
              })

              // 1 bounded Vision Critique & Self-Repair pass comparing Original vs Compiled
              if (api.smartBeautifyCritique && isAiConfiguredRef.current) {
                try {
                  const comparisonPng = await renderSpatialComparisonPng(
                    raster.base64Png,
                    compiled,
                    compiled.bounds,
                    activeFont
                  )
                  if (comparisonPng) {
                    const critique = await api.smartBeautifyCritique({
                      comparisonBase64Png: comparisonPng,
                      category: 'spatial_scene',
                      scene: activeScene,
                      provider: activeProvider,
                      model: activeModel,
                      ollamaHost: currentSettings.ai.ollamaHost,
                      textHints: raster.textHints || undefined
                    })
                    if (critique?.ok && !critique.approved && critique.repairedScene) {
                      activeScene = critique.repairedScene
                      compiled = compileSpatialScene(activeScene, targetRect, activeFont, {
                        measureText: measureFn,
                        existingGroupId: compiled.groupId,
                        layerId: targetInkLayerId
                      })
                    }
                  }
                } catch {
                  /* keep first compiled pass if critique times out */
                }
              }

              const diagramMeta: VectorDiagramMeta = {
                groupId: compiled.groupId,
                anchor: raster.anchor,
                spatialScene: activeScene,
                originalStrokes,
                originalShapes,
                originalTexts
              }

              update((b) => ({
                ...b,
                strokes: b.strokes.filter((s) => !idSet.has(s.id)),
                shapeNodes: [...b.shapeNodes.filter((s) => !idSet.has(s.id)), ...compiled.shapes],
                textNodes: [...b.textNodes.filter((t) => !idSet.has(t.id)), ...compiled.texts],
                equationNodes: b.equationNodes.filter((eq) => !idSet.has(eq.id)),
                vectorDiagramMeta: {
                  ...(b.vectorDiagramMeta ?? {}),
                  [compiled.groupId]: diagramMeta
                }
              }))

              const newIds = [
                ...compiled.shapes.map((s) => s.id),
                ...compiled.texts.map((t) => t.id)
              ]
              setSelectedIds(newIds)
              setSelectedId(newIds.length === 1 ? newIds[0] : null)
              setActiveTool('select')
              pushHistory()
              addToast(
                'success',
                `Vectorized spatial diagram (${compiled.shapes.length} vector primitives, ${compiled.texts.length} labels)! (Ctrl+Z to undo)`
              )
              return
            }
            // Branch T: Pure Text
            if (smartRes.category === 'text' && smartRes.recognizedText?.trim()) {
              const textRes = buildImmersedTextFromOcr(
                smartRes.recognizedText.trim(),
                raster.bounds,
                activeFont,
                raster.dominantColor
              )
              update((b) => ({
                ...b,
                strokes: b.strokes.filter((s) => !idSet.has(s.id)),
                shapeNodes: b.shapeNodes.filter((s) => !idSet.has(s.id)),
                textNodes: [...b.textNodes.filter((t) => !idSet.has(t.id)), ...textRes.texts],
                equationNodes: b.equationNodes.filter((eq) => !idSet.has(eq.id))
              }))
              const newIds = textRes.texts.map((t) => t.id)
              setSelectedIds(newIds)
              setSelectedId(newIds[0] ?? null)
              setActiveTool('select')
              pushHistory()
              addToast('success', `Converted text into immersed ${FONTS[activeFont].label}! (Ctrl+Z to undo)`)
              return
            }

            // Branch A: Structured Diagram -> ELK.js Web Worker (layered orthogonal hierarchical layout)
            if (smartRes.category === 'diagram' && smartRes.graph) {
              const anchor = { x: raster.anchor.x + 24, y: raster.anchor.y + 24 }
              const laidOut = await layoutDiagramWithElkWorker(smartRes.graph, anchor, activeFont)
              const targetInkLayerId = resolveTargetInkLayerId(curBoard) ?? undefined
              const stampedShapes = targetInkLayerId
                ? laidOut.shapes.map((s) => ({ ...s, layerId: targetInkLayerId }))
                : laidOut.shapes
              const stampedTexts = targetInkLayerId
                ? laidOut.texts.map((t) => ({ ...t, layerId: targetInkLayerId }))
                : laidOut.texts
              const diagramMeta: VectorDiagramMeta = {
                groupId: laidOut.groupId,
                anchor,
                graph: smartRes.graph,
                originalStrokes,
                originalShapes,
                originalTexts
              }

              update((b) => ({
                ...b,
                strokes: b.strokes.filter((s) => !idSet.has(s.id)),
                shapeNodes: [...b.shapeNodes.filter((s) => !idSet.has(s.id)), ...stampedShapes],
                textNodes: [...b.textNodes.filter((t) => !idSet.has(t.id)), ...stampedTexts],
                equationNodes: b.equationNodes.filter((eq) => !idSet.has(eq.id)),
                vectorDiagramMeta: {
                  ...(b.vectorDiagramMeta ?? {}),
                  [laidOut.groupId]: diagramMeta
                }
              }))

              const newIds = [
                ...stampedShapes.map((s) => s.id),
                ...stampedTexts.map((t) => t.id)
              ]
              setSelectedIds(newIds)
              setSelectedId(newIds.length === 1 ? newIds[0] : null)
              setActiveTool('select')
              pushHistory()
              addToast(
                'success',
                `Vectorized diagram (${smartRes.graph.nodes.length} nodes, ${smartRes.graph.edges.length} edges) with ELK orthogonal layout!`
              )
              return
            }

            // Branch B: Illustration / Hybrid / Offline Trace Original -> `vector_art` (+ native hybrid callouts)
            if (smartRes.vectorArt && smartRes.vectorArt.layers.length > 0) {
              const now = Date.now()
              const artId = `vart-${now.toString(36)}`
              const aspect =
                smartRes.vectorArt.viewBoxWidth / Math.max(1, smartRes.vectorArt.viewBoxHeight)
              const artW = raster.width
              const artH = Math.max(48, Math.round(artW / Math.max(0.15, aspect)))

              const targetInkLayerId = resolveTargetInkLayerId(curBoard) ?? undefined
              const artNode: VectorArtNode = {
                id: artId,
                kind: 'vector_art',
                x: raster.anchor.x,
                y: raster.anchor.y,
                width: artW,
                height: artH,
                viewBoxWidth: smartRes.vectorArt.viewBoxWidth,
                viewBoxHeight: smartRes.vectorArt.viewBoxHeight,
                layers: smartRes.vectorArt.layers,
                ...(targetInkLayerId ? { layerId: targetInkLayerId } : {}),
                sourceMeta: {
                  style:
                    mode === 'trace_only'
                      ? 'trace_only'
                      : mode === 'flat_vector' || mode === 'clean_line_art' || mode === 'editorial_poster'
                        ? mode
                        : (smartRes.brief?.style ?? 'flat_vector'),
                  refinementUsed: smartRes.vectorArt.refinementUsed,
                  brief: smartRes.brief,
                  originalStrokes,
                  originalShapes,
                  originalTexts
                },
                createdAt: now
              }

              const hybrid =
                smartRes.category === 'hybrid' && smartRes.callouts && smartRes.callouts.length > 0
                  ? buildHybridCalloutNodes(
                    smartRes.callouts,
                    { x: artNode.x, y: artNode.y, width: artNode.width, height: artNode.height },
                    activeFont,
                    artId
                  )
                  : { shapes: [], texts: [] }

              update((b) => ({
                ...b,
                strokes: b.strokes.filter((s) => !idSet.has(s.id)),
                shapeNodes: [...b.shapeNodes.filter((s) => !idSet.has(s.id)), ...hybrid.shapes],
                textNodes: [...b.textNodes.filter((t) => !idSet.has(t.id)), ...hybrid.texts],
                equationNodes: b.equationNodes.filter((eq) => !idSet.has(eq.id)),
                vectorArtNodes: [...(b.vectorArtNodes ?? []), artNode]
              }))

              const newIds = [
                artNode.id,
                ...hybrid.shapes.map((s) => s.id),
                ...hybrid.texts.map((t) => t.id)
              ]
              setSelectedIds(newIds)
              setSelectedId(newIds.length === 1 ? newIds[0] : null)
              setActiveTool('select')
              pushHistory()
              addToast(
                'success',
                smartRes.category === 'hybrid'
                  ? `Vectorized hybrid artwork (${artNode.layers.length} layers) + ${hybrid.texts.length} immersed callouts!`
                  : `Vectorized artwork into ${artNode.layers.length} clean scalable layers! (Ctrl+Z to undo)`
              )
              return
            }
          }
        }

        // 3. Offline / Un-restarted Electron Fallback: deterministic local geometric + smooth Bézier vectorization
        const localFallback = generateLocalVectorDiagram(curBoard, targetIds, activeFont)
        if (localFallback.shapes.length > 0 || localFallback.texts.length > 0) {
          update((b) => ({
            ...b,
            strokes: b.strokes.filter((s) => !idSet.has(s.id)),
            shapeNodes: [...b.shapeNodes.filter((s) => !idSet.has(s.id)), ...localFallback.shapes],
            textNodes: [...b.textNodes.filter((t) => !idSet.has(t.id)), ...localFallback.texts],
            equationNodes: b.equationNodes.filter((eq) => !idSet.has(eq.id))
          }))
          const newIds = [
            ...localFallback.shapes.map((s) => s.id),
            ...localFallback.texts.map((t) => t.id)
          ]
          setSelectedIds(newIds)
          setSelectedId(newIds.length === 1 ? newIds[0] : null)
          setActiveTool('select')
          pushHistory()
          addToast(
            'info',
            isAiConfiguredRef.current
              ? 'Converted drawn strokes locally into clean vector paths.'
              : 'Converted shapes locally into clean vectors. Configure AI in Settings for smart routing.'
          )
        }
      } catch (err: unknown) {
        console.warn('[SmartVectorize] fallback:', err)
        const errMsg = (err as Error)?.message || ''
        if (/No handler registered for ['"]canvas:smart-beautify['"]/i.test(errMsg)) {
          addToast(
            'error',
            'Main process needs a restart to activate Smart Vectorize — stop and re-run `npm run dev` (your sketch was kept intact).'
          )
          return
        }
        const localFallback = generateLocalVectorDiagram(curBoard, targetIds, activeFont)
        if (localFallback.shapes.length > 0 || localFallback.texts.length > 0) {
          update((b) => ({
            ...b,
            strokes: b.strokes.filter((s) => !idSet.has(s.id)),
            shapeNodes: [...b.shapeNodes.filter((s) => !idSet.has(s.id)), ...localFallback.shapes],
            textNodes: [...b.textNodes.filter((t) => !idSet.has(t.id)), ...localFallback.texts],
            equationNodes: b.equationNodes.filter((eq) => !idSet.has(eq.id))
          }))
          setSelectedIds([
            ...localFallback.shapes.map((s) => s.id),
            ...localFallback.texts.map((t) => t.id)
          ])
          setActiveTool('select')
          pushHistory()
        }
        addToast('error', `Vectorize notice: ${errMsg || 'Fell back to local vectors.'}`)
      } finally {
        setIsVectorizing(false)
        setAiBusy(false)
      }
    },
    [update, pushHistory, addToast, setSelectedId, themeTokens]
  )

  const handleVectorizeSelected = useCallback(() => {
    void runSmartVectorize('auto')
  }, [runSmartVectorize])

  const handleTraceOriginalSelected = useCallback(() => {
    void runSmartVectorize('trace_only')
  }, [runSmartVectorize])

  /* ---------------- Contextual Vector Art & Diagram Toolbar Actions ---------------- */
  const handleSwapArtColor = useCallback(
    (artId: string, oldColor: string, newColor: string) => {
      update(
        (b) => ({
          ...b,
          vectorArtNodes: (b.vectorArtNodes ?? []).map((art) =>
            art.id === artId
              ? {
                ...art,
                layers: art.layers.map((layer) =>
                  layer.fill === oldColor ? { ...layer, fill: newColor } : layer
                )
              }
              : art
          )
        }),
        { history: true }
      )
    },
    [update]
  )

  const handleUngroupArt = useCallback(
    (artId: string) => {
      const curBoard = boardRef.current
      const art = (curBoard.vectorArtNodes ?? []).find((v) => v.id === artId)
      if (!art || art.layers.length === 0) return

      const now = Date.now()
      const ungroupedShapes: ShapeNode[] = art.layers.map((layer, idx) => ({
        id: `vung-${now}-${idx}`,
        shape: 'svg-path',
        x: Math.round(art.x),
        y: Math.round(art.y),
        w: Math.round(art.width),
        h: Math.round(art.height),
        svgViewBox: [0, 0, art.viewBoxWidth, art.viewBoxHeight],
        svgPaths: [
          {
            d: layer.d,
            fill: layer.fill,
            stroke: layer.stroke ?? 'none',
            strokeWidth: layer.strokeWidth
          }
        ],
        color: layer.stroke ?? 'ink',
        fillColor: layer.fill,
        strokeWidth: layer.strokeWidth ?? 0,
        vectorGroupId: art.id
      }))

      update((b) => ({
        ...b,
        vectorArtNodes: (b.vectorArtNodes ?? []).filter((v) => v.id !== artId),
        shapeNodes: [...b.shapeNodes, ...ungroupedShapes]
      }))
      setSelectedIds(ungroupedShapes.map((s) => s.id))
      pushHistory()
      addToast('success', `Ungrouped into ${ungroupedShapes.length} editable vector layers!`)
    },
    [update, pushHistory, addToast]
  )

  const handleRevertArtToSketch = useCallback(
    (artId: string) => {
      const curBoard = boardRef.current
      const art = (curBoard.vectorArtNodes ?? []).find((v) => v.id === artId)
      if (!art?.sourceMeta) return
      const origStrokes = art.sourceMeta.originalStrokes ?? []
      const origShapes = art.sourceMeta.originalShapes ?? []
      const origTexts = art.sourceMeta.originalTexts ?? []

      update((b) => ({
        ...b,
        vectorArtNodes: (b.vectorArtNodes ?? []).filter((v) => v.id !== artId),
        shapeNodes: [
          ...b.shapeNodes.filter((s) => s.vectorGroupId !== artId),
          ...origShapes
        ],
        textNodes: [...b.textNodes, ...origTexts],
        strokes: [...b.strokes, ...origStrokes]
      }))
      setSelectedIds([
        ...origStrokes.map((s) => s.id),
        ...origShapes.map((s) => s.id),
        ...origTexts.map((t) => t.id)
      ])
      pushHistory()
      addToast('info', 'Reverted vector artwork back to original sketch.')
    },
    [update, pushHistory, addToast]
  )

  const handleRerunArtStyle = useCallback(
    async (artId: string, mode: SmartBeautifyMode) => {
      const curBoard = boardRef.current
      const art = (curBoard.vectorArtNodes ?? []).find((v) => v.id === artId)
      const origStrokes = art?.sourceMeta?.originalStrokes
      if (!art || !origStrokes || origStrokes.length === 0) return

      const tempBoard: BoardState = {
        ...curBoard,
        strokes: origStrokes,
        shapeNodes: art.sourceMeta?.originalShapes ?? [],
        textNodes: art.sourceMeta?.originalTexts ?? []
      }
      const ids = [
        ...origStrokes.map((s) => s.id),
        ...(art.sourceMeta?.originalShapes ?? []).map((s) => s.id)
      ]
      const raster = rasterizeSelectionColorPreserving(
        tempBoard,
        ids,
        themeTokens.ink,
        themeTokens.accent
      )
      const api = window.glassAPI
      if (!raster || !api?.smartBeautify) return

      setIsVectorizing(true)
      try {
        const currentSettings = settingsRef.current
        const activeProvider = currentSettings.ai.provider
        const activeModel =
          activeProvider === 'ollama'
            ? currentSettings.ai.ollamaModel
            : currentSettings.ai.byokModels[activeProvider] || DEFAULT_PROVIDER_MODELS[activeProvider]

        const res = await api.smartBeautify({
          base64Png: raster.base64Png,
          width: raster.width,
          height: raster.height,
          mode,
          provider: activeProvider,
          model: activeModel,
          ollamaHost: currentSettings.ai.ollamaHost,
          textHints: art.sourceMeta?.brief?.subject || raster.textHints,
          paletteHints: raster.paletteHints,
          isMonochromeHint: mode === 'clean_line_art' || raster.isMonochrome
        })

        if (res.ok && res.vectorArt && res.vectorArt.layers.length > 0) {
          update((b) => ({
            ...b,
            vectorArtNodes: (b.vectorArtNodes ?? []).map((v) =>
              v.id === artId
                ? {
                  ...v,
                  viewBoxWidth: res.vectorArt!.viewBoxWidth,
                  viewBoxHeight: res.vectorArt!.viewBoxHeight,
                  layers: res.vectorArt!.layers,
                  sourceMeta: {
                    ...v.sourceMeta,
                    style: mode === 'auto' ? 'flat_vector' : mode,
                    refinementUsed: res.vectorArt!.refinementUsed
                  }
                }
                : v
            )
          }))
          pushHistory()
          addToast('success', `Updated artwork style (${mode.replace(/_/g, ' ')})!`)
        }
      } finally {
        setIsVectorizing(false)
      }
    },
    [update, pushHistory, addToast, themeTokens]
  )

  const handleToggleDiagramDirection = useCallback(
    async (groupId: string, nextDirection: DiagramDirection) => {
      const curBoard = boardRef.current
      const meta = curBoard.vectorDiagramMeta?.[groupId]
      if (!meta || !meta.graph) return

      const activeFont: FontId =
        settingsRef.current.font && settingsRef.current.font in FONTS
          ? settingsRef.current.font
          : 'jakarta'

      const updatedGraph = { ...meta.graph, direction: nextDirection }
      try {
        const laidOut = await layoutDiagramWithElkWorker(updatedGraph, meta.anchor, activeFont, {
          directionOverride: nextDirection,
          existingGroupId: groupId
        })
        const updatedMeta: VectorDiagramMeta = { ...meta, graph: updatedGraph }

        update((b) => ({
          ...b,
          shapeNodes: [
            ...b.shapeNodes.filter((s) => s.vectorGroupId !== groupId),
            ...laidOut.shapes
          ],
          textNodes: [
            ...b.textNodes.filter((t) => !t.id.includes(`-${groupId}`)),
            ...laidOut.texts
          ],
          vectorDiagramMeta: {
            ...(b.vectorDiagramMeta ?? {}),
            [groupId]: updatedMeta
          }
        }))
        setSelectedIds([
          ...laidOut.shapes.map((s) => s.id),
          ...laidOut.texts.map((t) => t.id)
        ])
        pushHistory()
      } catch (err) {
        addToast('error', `Layout toggle failed: ${(err as Error)?.message || 'ELK error'}`)
      }
    },
    [update, pushHistory, addToast]
  )

  const handleRevertDiagramToSketch = useCallback(
    (groupId: string) => {
      const curBoard = boardRef.current
      const meta = curBoard.vectorDiagramMeta?.[groupId]
      if (!meta || !meta.graph) return
      const origStrokes = meta.originalStrokes ?? []
      const origShapes = meta.originalShapes ?? []
      const origTexts = meta.originalTexts ?? []

      update((b) => {
        const nextMeta = { ...(b.vectorDiagramMeta ?? {}) }
        delete nextMeta[groupId]
        return {
          ...b,
          shapeNodes: [
            ...b.shapeNodes.filter((s) => s.vectorGroupId !== groupId),
            ...origShapes
          ],
          textNodes: [
            ...b.textNodes.filter((t) => t.vectorGroupId !== groupId && !t.id.includes(`-${groupId}`)),
            ...origTexts
          ],
          strokes: [...b.strokes, ...origStrokes],
          vectorDiagramMeta: nextMeta
        }
      })
      setSelectedIds([
        ...origStrokes.map((s) => s.id),
        ...origShapes.map((s) => s.id),
        ...origTexts.map((t) => t.id)
      ])
      pushHistory()
      addToast('info', 'Reverted diagram back to original sketch.')
    },
    [update, pushHistory, addToast]
  )

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
    for (const va of curBoard.vectorArtNodes ?? []) {
      allX.push(va.x, va.x + va.width)
      allY.push(va.y, va.y + va.height)
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
        .map((s) => ({
          id: s.id,
          initX: s.x,
          initY: s.y,
          initControlPoint: s.controlPoint ? ([s.controlPoint[0], s.controlPoint[1]] as [number, number]) : undefined,
          initPoints: s.points ? s.points.map(([px, py]) => [px, py] as [number, number]) : undefined
        })),
      vectorArts: (curBoard.vectorArtNodes ?? [])
        .filter((v) => idSet.has(v.id))
        .map((v) => ({ id: v.id, initX: v.x, initY: v.y })),
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
      const { shapes, vectorArts, texts, equations, diagrams, codes, videos, strokes } = drag.snapshots

      const vectorArtMap = new Map(
        (vectorArts ?? []).map((v) => [
          v.id,
          { x: Math.round(v.initX + dx), y: Math.round(v.initY + dy) }
        ])
      )

      const shapeMap = new Map(
        shapes.map((s) => [
          s.id,
          {
            x: Math.round(s.initX + dx),
            y: Math.round(s.initY + dy),
            ...(s.initControlPoint
              ? {
                controlPoint: [
                  Math.round(s.initControlPoint[0] + dx),
                  Math.round(s.initControlPoint[1] + dy)
                ] as [number, number]
              }
              : {}),
            ...(s.initPoints
              ? {
                points: s.initPoints.map(
                  ([px, py]) => [Math.round(px + dx), Math.round(py + dy)] as [number, number]
                )
              }
              : {})
          }
        ])
      )
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
          shapeNodes: syncBoundConnectors(
            b.shapeNodes.map((s) => (shapeMap.has(s.id) ? { ...s, ...shapeMap.get(s.id)! } : s))
          ),
          vectorArtNodes: (b.vectorArtNodes ?? []).map((v) =>
            vectorArtMap.has(v.id) ? { ...v, ...vectorArtMap.get(v.id)! } : v
          ),
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
    if (shapeDragRef.current?.kind === 'connect' || hoveredPortRef.current) return 'crosshair'
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
    if (e.button === 2) return
    setContextMenu(null)
    isPointerDownRef.current = true
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId)
    } catch {
      /* ignore synthetic event capture errors */
    }

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
      const targetLayerId = resolveTargetInkLayerId(boardRef.current)
      if (!targetLayerId) {
        isPointerDownRef.current = false
        addToast('info', 'All ink layers are locked or hidden — unlock or show one in Layers.')
        return
      }
      holdSnap.resetHoldSnap()
      const p: [number, number, number] = [canvasPt.x, canvasPt.y, e.pressure || 0.5]
      const stroke: Stroke = {
        id: `st-${Date.now()}`,
        points: [p],
        color: penColorRef.current,
        size: settingsRef.current.inkSize,
        penType: settingsRef.current.penType ?? 'fountain',
        layerId: targetLayerId
      }
      activeStrokeRef.current = stroke
      scheduleRenderRef.current()
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
        fontFamily: settingsRef.current.font,
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
      const curLayers = boardLayersRef.current
      const currentSelected = selectedIdsRef.current

      // 0. Check if clicked a live React Flow-style connection port dot on selected/hovered shape
      const portCandList: ShapeNode[] = []
      if (currentSelected.length === 1) {
        const selShape = curBoard.shapeNodes.find((s) => s.id === currentSelected[0])
        if (selShape && !isConnectorShape(selShape) && isItemEditable(selShape.layerId, curLayers)) {
          portCandList.push(selShape)
        }
      }
      if (hoveredShapeIdRef.current) {
        const hovShape = curBoard.shapeNodes.find((s) => s.id === hoveredShapeIdRef.current)
        if (
          hovShape &&
          !isConnectorShape(hovShape) &&
          isItemEditable(hovShape.layerId, curLayers) &&
          !portCandList.some((c) => c.id === hovShape.id)
        ) {
          portCandList.push(hovShape)
        }
      }
      const portHitTol = 11 / viewRef.current.zoom
      for (const s of portCandList) {
        for (const p of getShapePortHandles(s, viewRef.current.zoom)) {
          if (Math.hypot(canvasPt.x - p.dotX, canvasPt.y - p.dotY) <= portHitTol) {
            shapeDragRef.current = {
              kind: 'connect',
              sourceShapeId: s.id,
              sourcePort: p.port,
              startPinchX: canvasPt.x,
              startPinchY: canvasPt.y,
              currentX: canvasPt.x,
              currentY: canvasPt.y,
              snapTarget: null
            }
            scheduleRenderRef.current()
            return
          }
        }
      }

      // 1. Check if clicked near a resize handle of an already selected single shape
      if (currentSelected.length === 1) {
        const hitTol = 14 / viewRef.current.zoom
        for (const s of curBoard.shapeNodes) {
          if (!currentSelected.includes(s.id) || !isItemEditable(s.layerId, curLayers)) continue
          const b = getShapeBoundingRect(s)
          const corners = getShapeResizeHandles(b, 4)

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
                initControlPoint: s.controlPoint
                  ? ([s.controlPoint[0], s.controlPoint[1]] as [number, number])
                  : undefined,
                initPoints: s.points
                  ? s.points.map(([px, py]) => [px, py] as [number, number])
                  : undefined,
                startPinchX: canvasPt.x,
                startPinchY: canvasPt.y
              }
              return
            }
          }
        }

        // 1b. Check corner resize handle of a single selected VectorArtNode
        for (const v of curBoard.vectorArtNodes ?? []) {
          if (!currentSelected.includes(v.id) || !isItemEditable(v.layerId, curLayers)) continue
          const pad = 4
          const corners: Array<{ handle: 'nw' | 'ne' | 'se' | 'sw'; x: number; y: number }> = [
            { handle: 'nw', x: v.x - pad, y: v.y - pad },
            { handle: 'ne', x: v.x + v.width + pad, y: v.y - pad },
            { handle: 'se', x: v.x + v.width + pad, y: v.y + v.height + pad },
            { handle: 'sw', x: v.x - pad, y: v.y + v.height + pad }
          ]
          for (const c of corners) {
            if (Math.hypot(canvasPt.x - c.x, canvasPt.y - c.y) <= hitTol) {
              pushHistory()
              shapeDragRef.current = {
                targetId: v.id,
                kind: 'vector-art-resize',
                handle: c.handle,
                initX: v.x,
                initY: v.y,
                initW: v.width,
                initH: v.height,
                startPinchX: canvasPt.x,
                startPinchY: canvasPt.y
              }
              return
            }
          }
        }
      }

      // 2. Check shape hit (respecting locked/hidden layers)
      const hitShape = [...curBoard.shapeNodes].reverse().find((s) => {
        if (!isItemEditable(s.layerId, curLayers)) return false
        const b = getShapeBoundingRect(s)
        const margin = s.points?.length || Math.abs(s.w) < 16 || Math.abs(s.h) < 16 ? 10 : 0
        const sw = Math.max(20, b.w) + margin * 2
        const sh = Math.max(20, b.h) + margin * 2
        const sx = b.x - margin
        const sy = b.y - margin
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
          if (currentSelected.includes(hitShape.id) && currentSelected.length > 1) {
            startMoveDrag(currentSelected, canvasPt.x, canvasPt.y)
          } else {
            setSelectedIds([hitShape.id])
            startMoveDrag([hitShape.id], canvasPt.x, canvasPt.y)
          }
        }
        return
      }

      // 2b. Check VectorArtNode hit
      const hitVectorArt = [...(curBoard.vectorArtNodes ?? [])].reverse().find((v) => {
        if (!isItemEditable(v.layerId, curLayers)) return false
        return (
          canvasPt.x >= v.x &&
          canvasPt.x <= v.x + v.width &&
          canvasPt.y >= v.y &&
          canvasPt.y <= v.y + v.height
        )
      })

      if (hitVectorArt) {
        if (e.shiftKey) {
          const next = currentSelected.includes(hitVectorArt.id)
            ? currentSelected.filter((id) => id !== hitVectorArt.id)
            : [...currentSelected, hitVectorArt.id]
          setSelectedIds(next)
          if (next.includes(hitVectorArt.id)) {
            startMoveDrag(next, canvasPt.x, canvasPt.y)
          }
        } else {
          if (currentSelected.includes(hitVectorArt.id) && currentSelected.length > 1) {
            startMoveDrag(currentSelected, canvasPt.x, canvasPt.y)
          } else {
            setSelectedIds([hitVectorArt.id])
            startMoveDrag([hitVectorArt.id], canvasPt.x, canvasPt.y)
          }
        }
        return
      }

      // 3. Check stroke hit (e.g., drawn arrows or connector lines)
      const hitStroke = [...curBoard.strokes].reverse().find((st) => {
        if (!isItemEditable(st.layerId, curLayers)) return false
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
        scheduleRenderRef.current()
      }
      return
    }

    if (activeTool === 'eraser') {
      if (eraserModeRef.current === 'section' || e.shiftKey) {
        selectionBoxRef.current = {
          startX: canvasPt.x,
          startY: canvasPt.y,
          currentX: canvasPt.x,
          currentY: canvasPt.y
        }
        scheduleRenderRef.current()
      } else {
        // Paper-like eraser: only touches items on visible & unlocked ink layers
        lastEraserPointRef.current = { x: canvasPt.x, y: canvasPt.y }
        const r = eraserSizeRef.current / 2
        const curLayers = boardLayersRef.current
        update(
          (b) => {
            const lockedStrokes = b.strokes.filter((s) => !isItemEditable(s.layerId, curLayers))
            const editableStrokes = b.strokes.filter((s) => isItemEditable(s.layerId, curLayers))
            const lockedShapes = b.shapeNodes.filter((s) => !isItemEditable(s.layerId, curLayers))
            const editableShapes = b.shapeNodes.filter((s) => isItemEditable(s.layerId, curLayers))
            const allArts = b.vectorArtNodes ?? []
            const lockedArts = allArts.filter((v) => !isItemEditable(v.layerId, curLayers))
            const editableArts = allArts.filter((v) => isItemEditable(v.layerId, curLayers))

            return {
              ...b,
              strokes: [...lockedStrokes, ...eraseStrokesAlongPath(editableStrokes, canvasPt.x, canvasPt.y, canvasPt.x, canvasPt.y, r)],
              shapeNodes: [...lockedShapes, ...eraseShapesAlongPath(editableShapes, canvasPt.x, canvasPt.y, canvasPt.x, canvasPt.y, r)],
              vectorArtNodes: [...lockedArts, ...eraseVectorArtAlongPath(editableArts, canvasPt.x, canvasPt.y, canvasPt.x, canvasPt.y, r)]
            }
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

    if (!isPointerDownRef.current) {
      if (activeTool === 'eraser' && eraserModeRef.current === 'paper') {
        scheduleRenderRef.current()
      } else if (activeTool === 'select') {
        const curBoard = boardRef.current
        const curLayers = boardLayersRef.current
        const curSelected = selectedIdsRef.current
        const zoom = viewRef.current.zoom
        const portHitTol = 12 / zoom

        const portCandidates: ShapeNode[] = []
        if (curSelected.length === 1) {
          const selShape = curBoard.shapeNodes.find((s) => s.id === curSelected[0])
          if (selShape && !isConnectorShape(selShape) && isItemEditable(selShape.layerId, curLayers)) {
            portCandidates.push(selShape)
          }
        }
        if (hoveredShapeIdRef.current) {
          const prevHov = curBoard.shapeNodes.find((s) => s.id === hoveredShapeIdRef.current)
          if (
            prevHov &&
            !isConnectorShape(prevHov) &&
            isItemEditable(prevHov.layerId, curLayers) &&
            !portCandidates.some((c) => c.id === prevHov.id)
          ) {
            portCandidates.push(prevHov)
          }
        }

        let nextHoveredPort: { shapeId: string; port: PortSide } | null = null
        for (const cand of portCandidates) {
          for (const ph of getShapePortHandles(cand, zoom)) {
            if (Math.hypot(canvasPt.x - ph.dotX, canvasPt.y - ph.dotY) <= portHitTol) {
              nextHoveredPort = { shapeId: cand.id, port: ph.port }
              break
            }
          }
          if (nextHoveredPort) break
        }

        let nextHoveredShapeId: string | null = nextHoveredPort?.shapeId ?? null
        if (!nextHoveredShapeId) {
          const hitShape = [...curBoard.shapeNodes].reverse().find((s) => {
            if (isConnectorShape(s) || !isItemEditable(s.layerId, curLayers)) return false
            const b = getShapeBoundingRect(s)
            const margin = 6 / zoom
            return (
              canvasPt.x >= b.x - margin &&
              canvasPt.x <= b.x + Math.max(20, b.w) + margin &&
              canvasPt.y >= b.y - margin &&
              canvasPt.y <= b.y + Math.max(20, b.h) + margin
            )
          })
          nextHoveredShapeId = hitShape?.id ?? null
        }

        const prevPort = hoveredPortRef.current
        const portChanged =
          prevPort?.shapeId !== nextHoveredPort?.shapeId || prevPort?.port !== nextHoveredPort?.port
        const shapeChanged = hoveredShapeIdRef.current !== nextHoveredShapeId
        if (portChanged || shapeChanged) {
          hoveredPortRef.current = nextHoveredPort
          hoveredShapeIdRef.current = nextHoveredShapeId
          if (portChanged && committedCanvasRef.current) {
            committedCanvasRef.current.style.cursor = getCanvasCursor()
          }
          scheduleRenderRef.current()
        }
      }
      return
    }

    if (activeTool === 'pen' && activeStrokeRef.current) {
      const p: [number, number, number] = [canvasPt.x, canvasPt.y, e.pressure || 0.5]
      activeStrokeRef.current.points.push(p)
      holdSnap.onStrokePoint(p, () => activeStrokeRef.current?.points ?? [])
      scheduleRenderRef.current()
      return
    }

    if (activeTool === 'eraser') {
      if (selectionBoxRef.current) {
        selectionBoxRef.current.currentX = canvasPt.x
        selectionBoxRef.current.currentY = canvasPt.y
        scheduleRenderRef.current()
      } else if (eraserModeRef.current === 'paper' && lastEraserPointRef.current) {
        const p0 = lastEraserPointRef.current
        const p1 = canvasPt
        const r = eraserSizeRef.current / 2
        const curLayers = boardLayersRef.current
        update(
          (b) => {
            const lockedStrokes = b.strokes.filter((s) => !isItemEditable(s.layerId, curLayers))
            const editableStrokes = b.strokes.filter((s) => isItemEditable(s.layerId, curLayers))
            const lockedShapes = b.shapeNodes.filter((s) => !isItemEditable(s.layerId, curLayers))
            const editableShapes = b.shapeNodes.filter((s) => isItemEditable(s.layerId, curLayers))
            const allArts = b.vectorArtNodes ?? []
            const lockedArts = allArts.filter((v) => !isItemEditable(v.layerId, curLayers))
            const editableArts = allArts.filter((v) => isItemEditable(v.layerId, curLayers))

            return {
              ...b,
              strokes: [...lockedStrokes, ...eraseStrokesAlongPath(editableStrokes, p0.x, p0.y, p1.x, p1.y, r)],
              shapeNodes: [...lockedShapes, ...eraseShapesAlongPath(editableShapes, p0.x, p0.y, p1.x, p1.y, r)],
              vectorArtNodes: [...lockedArts, ...eraseVectorArtAlongPath(editableArts, p0.x, p0.y, p1.x, p1.y, r)]
            }
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
        const curLayers = boardLayersRef.current
        const cardsEditable =
          partitionedLayersRef.current.cardsLayer.visible &&
          !partitionedLayersRef.current.cardsLayer.locked
        const ids: string[] = []
        for (const s of curBoard.shapeNodes) {
          if (isItemEditable(s.layerId, curLayers) && isShapeInRect(s, rect)) ids.push(s.id)
        }
        for (const v of curBoard.vectorArtNodes ?? []) {
          if (isItemEditable(v.layerId, curLayers) && isVectorArtInRect(v, rect)) ids.push(v.id)
        }
        for (const t of curBoard.textNodes) {
          const ok = t.immersed ? isItemEditable(t.layerId, curLayers) : cardsEditable
          if (ok && isTextInRect(t, rect)) ids.push(t.id)
        }
        if (cardsEditable) {
          for (const eq of curBoard.equationNodes) {
            if (isEquationInRect(eq, rect)) ids.push(eq.id)
          }
          for (const d of curBoard.diagramNodes ?? []) {
            if (isDiagramInRect(d, rect)) ids.push(d.id)
          }
          for (const c of curBoard.codeNodes ?? []) {
            if (isCodeInRect(c, rect)) ids.push(c.id)
          }
        }
        for (const st of curBoard.strokes) {
          if (isItemEditable(st.layerId, curLayers) && isStrokeInRect(st, rect)) ids.push(st.id)
        }
        setSelectedIds(ids)
        scheduleRenderRef.current()
      } else if (shapeDragRef.current) {
        const drag = shapeDragRef.current
        const dx = canvasPt.x - drag.startPinchX
        const dy = canvasPt.y - drag.startPinchY

        if (drag.kind === 'connect') {
          drag.currentX = canvasPt.x
          drag.currentY = canvasPt.y
          const curBoard = boardRef.current
          const curLayers = boardLayersRef.current
          const zoom = viewRef.current.zoom
          const portSnapTol = 28 / zoom
          let nextSnap: { shapeId: string; port: PortSide } | null = null
          let bestDist = Infinity

          for (const target of [...curBoard.shapeNodes].reverse()) {
            if (
              target.id === drag.sourceShapeId ||
              isConnectorShape(target) ||
              !isItemEditable(target.layerId, curLayers)
            ) {
              continue
            }
            const handles = getShapePortHandles(target, zoom)
            for (const h of handles) {
              const dDot = Math.hypot(canvasPt.x - h.dotX, canvasPt.y - h.dotY)
              const dAnc = Math.hypot(canvasPt.x - h.anchorX, canvasPt.y - h.anchorY)
              const d = Math.min(dDot, dAnc)
              if (d <= portSnapTol && d < bestDist) {
                bestDist = d
                nextSnap = { shapeId: target.id, port: h.port }
              }
            }
            const b = getShapeBoundingRect(target)
            if (
              canvasPt.x >= b.x &&
              canvasPt.x <= b.x + Math.max(20, b.w) &&
              canvasPt.y >= b.y &&
              canvasPt.y <= b.y + Math.max(20, b.h)
            ) {
              const nearPort = pickNearestPort(target, canvasPt)
              if (!nextSnap) {
                nextSnap = { shapeId: target.id, port: nearPort }
              }
              break
            }
          }

          drag.snapTarget = nextSnap
          scheduleRenderRef.current()
          return
        }

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
          const targetShape = boardRef.current.shapeNodes.find((sh) => sh.id === targetId)
          const isLinearShape =
            targetShape?.shape === 'line' ||
            targetShape?.shape === 'dashed-line' ||
            targetShape?.shape === 'arrow' ||
            targetShape?.shape === 'arrow-bidirectional' ||
            targetShape?.shape === 'elbow' ||
            targetShape?.shape === 'curved-line' ||
            targetShape?.shape === 'curved-arrow' ||
            targetShape?.shape === 'polyline'

          if (drag.handle.includes('e')) {
            newW = drag.initW + dx
          }
          if (drag.handle.includes('w')) {
            newW = drag.initW - dx
            newX = drag.initX + dx
          }
          if (drag.handle.includes('s')) {
            newH = drag.initH + dy
          }
          if (drag.handle.includes('n')) {
            newH = drag.initH - dy
            newY = drag.initY + dy
          }

          if (!isLinearShape && drag.initW > 0 && drag.initH > 0) {
            if (drag.handle.includes('e') || drag.handle.includes('w')) {
              newW = Math.max(24, newW)
              if (drag.handle.includes('w')) {
                newX = drag.initX + (drag.initW - newW)
              }
            }
            if (drag.handle.includes('s') || drag.handle.includes('n')) {
              newH = Math.max(24, newH)
              if (drag.handle.includes('n')) {
                newY = drag.initY + (drag.initH - newH)
              }
            }
          }

          const scaleX = drag.initW !== 0 ? newW / drag.initW : 1
          const scaleY = drag.initH !== 0 ? newH / drag.initH : 1

          update(
            (b) => ({
              ...b,
              shapeNodes: syncBoundConnectors(
                b.shapeNodes.map((s) =>
                  s.id === targetId
                    ? {
                      ...s,
                      x: Math.round(newX),
                      y: Math.round(newY),
                      w: Math.round(newW),
                      h: Math.round(newH),
                      ...(drag.initControlPoint
                        ? {
                          controlPoint: [
                            Math.round(newX + (drag.initControlPoint[0] - drag.initX!) * scaleX),
                            Math.round(newY + (drag.initControlPoint[1] - drag.initY!) * scaleY)
                          ] as [number, number]
                        }
                        : {}),
                      ...(drag.initPoints
                        ? {
                          points: drag.initPoints.map(
                            ([px, py]) =>
                              [
                                Math.round(newX + (px - drag.initX!) * scaleX),
                                Math.round(newY + (py - drag.initY!) * scaleY)
                              ] as [number, number]
                          )
                        }
                        : {})
                    }
                    : s
                )
              )
            }),
            { history: false }
          )
        } else if (
          drag.kind === 'vector-art-resize' &&
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
            newW = Math.max(24, drag.initW + dx)
            newH = Math.max(24, drag.initH + dy)
          } else if (drag.handle === 'ne') {
            newW = Math.max(24, drag.initW + dx)
            newH = Math.max(24, drag.initH - dy)
            newY = drag.initY + (drag.initH - newH)
          } else if (drag.handle === 'sw') {
            newW = Math.max(24, drag.initW - dx)
            newH = Math.max(24, drag.initH + dy)
            newX = drag.initX + (drag.initW - newW)
          } else if (drag.handle === 'nw') {
            newW = Math.max(24, drag.initW - dx)
            newH = Math.max(24, drag.initH - dy)
            newX = drag.initX + (drag.initW - newW)
            newY = drag.initY + (drag.initH - newH)
          }

          update(
            (b) => ({
              ...b,
              vectorArtNodes: (b.vectorArtNodes ?? []).map((v) =>
                v.id === targetId
                  ? {
                    ...v,
                    x: Math.round(newX),
                    y: Math.round(newY),
                    width: Math.round(newW),
                    height: Math.round(newH)
                  }
                  : v
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
    hoveredShapeIdRef.current = null
    hoveredPortRef.current = null
    scheduleRenderRef.current()
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
        rawTarget?.closest('.diagram-selection-toolbar') ||
        pointEl?.closest('.vector-context-toolbar') ||
        rawTarget?.closest('.vector-context-toolbar') ||
        pointEl?.closest('.layers-panel') ||
        rawTarget?.closest('.layers-panel')
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
    const finishedDrag = shapeDragRef.current
    panStartRef.current = null
    isPanningDragRef.current = false
    shapeDragRef.current = null
    lastEraserPointRef.current = null
    if (wasPanning) return

    if (
      finishedDrag?.kind === 'connect' &&
      finishedDrag.sourceShapeId &&
      finishedDrag.sourcePort
    ) {
      const sourceShape = boardRef.current.shapeNodes.find(
        (s) => s.id === finishedDrag.sourceShapeId
      )
      if (sourceShape) {
        const endX = finishedDrag.currentX ?? finishedDrag.startPinchX
        const endY = finishedDrag.currentY ?? finishedDrag.startPinchY
        const dragDist = Math.hypot(
          endX - finishedDrag.startPinchX,
          endY - finishedDrag.startPinchY
        )

        if (finishedDrag.snapTarget) {
          const targetShape = boardRef.current.shapeNodes.find(
            (s) => s.id === finishedDrag.snapTarget!.shapeId
          )
          if (targetShape) {
            const conn = buildFlowConnectorNode({
              source: sourceShape,
              sourcePort: finishedDrag.sourcePort,
              target: targetShape,
              targetPort: finishedDrag.snapTarget.port,
              fontFamily: settingsRef.current.font,
              layerId: sourceShape.layerId
            })
            update((b) => ({ ...b, shapeNodes: [...b.shapeNodes, conn] }))
            setSelectedIds([conn.id])
            scheduleRenderRef.current()
            addToast('success', 'Connected shapes')
            return
          }
        }

        if (dragDist >= 24) {
          const conn = buildFlowConnectorNode({
            source: sourceShape,
            sourcePort: finishedDrag.sourcePort,
            freeEnd: { x: Math.round(endX), y: Math.round(endY) },
            fontFamily: settingsRef.current.font,
            layerId: sourceShape.layerId
          })
          update((b) => ({ ...b, shapeNodes: [...b.shapeNodes, conn] }))
          setSelectedIds([conn.id])
          scheduleRenderRef.current()
          addToast('success', 'Added flow connector')
          return
        }

        // Quick click on a port dot -> spawn a matching connected next shape cleanly aligned
        const [nx, ny] = portNormal(finishedDrag.sourcePort)
        const srcBounds = getShapeBoundingRect(sourceShape)
        const nextW = Math.max(64, Math.round(srcBounds.w))
        const nextH = Math.max(40, Math.round(srcBounds.h))
        const gap = 140
        let nextX = srcBounds.x
        let nextY = srcBounds.y
        if (nx > 0) nextX = srcBounds.x + srcBounds.w + gap
        else if (nx < 0) nextX = srcBounds.x - gap - nextW
        if (ny > 0) nextY = srcBounds.y + srcBounds.h + gap
        else if (ny < 0) nextY = srcBounds.y - gap - nextH

        const targetPort = getOppositePort(finishedDrag.sourcePort)
        const spawnedShape: ShapeNode = {
          ...sourceShape,
          id: `shape-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
          x: Math.round(nextX),
          y: Math.round(nextY),
          w: nextW,
          h: nextH,
          ...(sourceShape.label ? { label: 'Next Step' } : {})
        }
        const conn = buildFlowConnectorNode({
          source: sourceShape,
          sourcePort: finishedDrag.sourcePort,
          target: spawnedShape,
          targetPort,
          fontFamily: settingsRef.current.font,
          layerId: sourceShape.layerId
        })
        update((b) => ({ ...b, shapeNodes: [...b.shapeNodes, spawnedShape, conn] }))
        setSelectedId(spawnedShape.id)
        setSelectedIds([spawnedShape.id])
        scheduleRenderRef.current()
        addToast('success', 'Added connected shape')
        return
      }
      scheduleRenderRef.current()
      return
    }

    // 0. Handle Section Eraser Marquee Box Deletion (respecting layer visibility/locks)
    if (activeTool === 'eraser' && selectionBoxRef.current) {
      const box = selectionBoxRef.current
      selectionBoxRef.current = null
      const rect = normalizeRect(box.startX, box.startY, box.currentX, box.currentY)
      if (rect.w > 4 || rect.h > 4) {
        let deletedCount = 0
        const curLayers = boardLayersRef.current
        const cardsEditable =
          partitionedLayersRef.current.cardsLayer.visible &&
          !partitionedLayersRef.current.cardsLayer.locked
        update((b) => {
          const nextStrokes = b.strokes.filter(
            (s) => !isItemEditable(s.layerId, curLayers) || !isStrokeInRect(s, rect)
          )
          const nextShapes = b.shapeNodes.filter(
            (s) => !isItemEditable(s.layerId, curLayers) || !isShapeInRect(s, rect)
          )
          const nextVectorArts = (b.vectorArtNodes ?? []).filter(
            (v) => !isItemEditable(v.layerId, curLayers) || !isVectorArtInRect(v, rect)
          )
          const nextTexts = b.textNodes.filter((t) => {
            const ok = t.immersed ? isItemEditable(t.layerId, curLayers) : cardsEditable
            return !ok || !isTextInRect(t, rect)
          })
          const nextEquations = cardsEditable
            ? b.equationNodes.filter((eq) => !isEquationInRect(eq, rect))
            : b.equationNodes
          const nextDiagrams = cardsEditable
            ? (b.diagramNodes ?? []).filter((d) => !isDiagramInRect(d, rect))
            : (b.diagramNodes ?? [])
          const nextCodes = cardsEditable
            ? (b.codeNodes ?? []).filter((c) => !isCodeInRect(c, rect))
            : (b.codeNodes ?? [])
          deletedCount =
            b.strokes.length - nextStrokes.length +
            (b.shapeNodes.length - nextShapes.length) +
            ((b.vectorArtNodes ?? []).length - nextVectorArts.length) +
            (b.textNodes.length - nextTexts.length) +
            (b.equationNodes.length - nextEquations.length) +
            ((b.diagramNodes ?? []).length - nextDiagrams.length) +
            ((b.codeNodes ?? []).length - nextCodes.length)
          return {
            ...b,
            strokes: nextStrokes,
            shapeNodes: nextShapes,
            vectorArtNodes: nextVectorArts,
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
      scheduleRenderRef.current()
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
      scheduleRenderRef.current()
      return
    }

    // 2. Commit Stroke with Offline Hold-to-Snap OR Writing Pad Detection
    if (activeStrokeRef.current) {
      const stroke = activeStrokeRef.current
      activeStrokeRef.current = null
      const snapped = holdSnap.consumeSnappedPreview()

      if (stroke.points.length < 2) {
        scheduleRenderRef.current()
        return
      }

      // Tier 1: Real-Time Offline Hold-to-Snap (engaged only after 350ms dwell within 4px radius)
      if (snapped) {
        const snappedShape: ShapeNode = {
          ...buildShapeNodeFromHoldSnap(snapped, stroke.color, stroke.size, stroke.penType),
          ...(stroke.layerId ? { layerId: stroke.layerId } : {})
        }
        update((b) => ({ ...b, shapeNodes: [...b.shapeNodes, snappedShape] }))
        pushHistory()
        return
      }

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

  /* ---------------- On-Demand Dirty-Flag Dual-Canvas Engine + Frustum Culling ---------------- */
  const paintCanvases = useCallback(() => {
    const curBoard = boardRef.current
    const curView = viewRef.current
    const curLayers = boardLayersRef.current
    const { belowCards, aboveCards } = partitionedLayersRef.current
    let keepAnimatingPulse = false
    const animNow = performance.now()

    const paintInkBuckets = (
      ctx: CanvasRenderingContext2D,
      buckets: typeof belowCards,
      vp: { minX: number; minY: number; maxX: number; maxY: number }
    ): void => {
      for (const layer of buckets) {
        if (!layer.visible) continue
        ctx.save()
        if (layer.opacity < 0.999) {
          ctx.globalAlpha = layer.opacity
        }
        for (const va of curBoard.vectorArtNodes ?? []) {
          if (resolveItemLayerId(va.layerId, curLayers) !== layer.id) continue
          const vx1 = Math.min(va.x, va.x + va.width)
          const vy1 = Math.min(va.y, va.y + va.height)
          const vx2 = Math.max(va.x, va.x + va.width)
          const vy2 = Math.max(va.y, va.y + va.height)
          if (isBoundsInViewport(vx1, vy1, vx2, vy2, vp)) {
            drawVectorArt(ctx, va, themeTokens, boardPalette)
          }
        }
        for (const s of curBoard.shapeNodes) {
          if (resolveItemLayerId(s.layerId, curLayers) !== layer.id) continue
          const b = getShapeBoundingRect(s)
          if (isBoundsInViewport(b.minX - 24, b.minY - 24, b.maxX + 24, b.maxY + 24, vp)) {
            drawShape(ctx, s, themeTokens, fontCss, boardPalette, animNow)
            if (s.animated || s.shape.startsWith('anim-line-')) {
              keepAnimatingPulse = true
            }
          }
        }
        for (const st of curBoard.strokes) {
          if (resolveItemLayerId(st.layerId, curLayers) !== layer.id) continue
          const sb = getStrokeBoundsCached(st)
          if (isBoundsInViewport(sb.minX, sb.minY, sb.maxX, sb.maxY, vp)) {
            drawStroke(ctx, st, themeTokens)
          }
        }
        ctx.restore()
      }
    }

    const baseCanvas = committedCanvasRef.current
    const overCanvas = overlayCanvasRef.current
    if (!baseCanvas && !overCanvas) return

    const refCanvas = baseCanvas || overCanvas!
    const z = Math.max(0.1, curView.zoom)
    const margin = 90 / z
    const vp = {
      minX: -curView.panX / z - margin,
      minY: -curView.panY / z - margin,
      maxX: (refCanvas.width - curView.panX) / z + margin,
      maxY: (refCanvas.height - curView.panY) / z + margin
    }

    // 1. Base Canvas: Ink layers BELOW Cards & Widgets
    if (baseCanvas) {
      const ctx = baseCanvas.getContext('2d')
      if (ctx) {
        ctx.clearRect(0, 0, baseCanvas.width, baseCanvas.height)
        ctx.save()
        ctx.translate(curView.panX, curView.panY)
        ctx.scale(curView.zoom, curView.zoom)
        paintInkBuckets(ctx, belowCards, vp)
        ctx.restore()
      }
    }

    // 2. Overlay Canvas: Ink layers ABOVE Cards + Live Stroke + Hold-to-Snap + Selection + Marquee + Eraser + Ports
    if (overCanvas) {
      const ctx = overCanvas.getContext('2d')
      if (ctx) {
        ctx.clearRect(0, 0, overCanvas.width, overCanvas.height)
        ctx.save()
        ctx.translate(curView.panX, curView.panY)
        ctx.scale(curView.zoom, curView.zoom)

        paintInkBuckets(ctx, aboveCards, vp)

        // Live drawing stroke (or crisp Hold-to-Snap preview + pulse when 350ms dwell engaged)
        if (activeStrokeRef.current) {
          const hp = holdSnap.previewRef.current
          if (hp) {
            const previewShape = buildShapeNodeFromHoldSnap(
              hp.snapped,
              activeStrokeRef.current.color,
              activeStrokeRef.current.size,
              activeStrokeRef.current.penType
            )
            drawShape(ctx, previewShape, themeTokens, fontCss, boardPalette)
            const elapsed = performance.now() - hp.pulseAt
            drawHoldSnapPulse(
              ctx,
              hp.anchorX,
              hp.anchorY,
              elapsed,
              curView.zoom,
              themeTokens.accent
            )
            if (elapsed < 460) {
              keepAnimatingPulse = true
            }
          } else {
            drawStroke(ctx, activeStrokeRef.current, themeTokens, { live: true })
          }
        }

        // Highlight selected shapes, vector art, or multi-element group
        const currentSelectedIds = selectedIdsRef.current
        if (currentSelectedIds.length > 0) {
          const selectedSet = new Set(currentSelectedIds)
          if (currentSelectedIds.length === 1) {
            for (const s of curBoard.shapeNodes) {
              if (selectedSet.has(s.id)) {
                ctx.save()
                ctx.strokeStyle = '#06b6d4'
                ctx.lineWidth = 2 / curView.zoom
                ctx.setLineDash([5 / curView.zoom, 4 / curView.zoom])
                const pad = 4
                const b = getShapeBoundingRect(s)
                const sx = b.x
                const sy = b.y
                const sw = Math.max(12, b.w)
                const sh = Math.max(12, b.h)
                ctx.strokeRect(sx - pad, sy - pad, sw + pad * 2, sh + pad * 2)
                ctx.setLineDash([])
                ctx.fillStyle = '#FFFFFF'
                ctx.strokeStyle = '#06b6d4'
                ctx.lineWidth = 2 / curView.zoom
                const handleSize = 7 / curView.zoom
                for (const h of getShapeResizeHandles(b, pad)) {
                  ctx.fillRect(h.x - handleSize / 2, h.y - handleSize / 2, handleSize, handleSize)
                  ctx.strokeRect(h.x - handleSize / 2, h.y - handleSize / 2, handleSize, handleSize)
                }
                ctx.restore()
              }
            }
            for (const va of curBoard.vectorArtNodes ?? []) {
              if (selectedSet.has(va.id)) {
                ctx.save()
                ctx.strokeStyle = '#06b6d4'
                ctx.lineWidth = 2 / curView.zoom
                ctx.setLineDash([5 / curView.zoom, 4 / curView.zoom])
                const pad = 4
                ctx.strokeRect(va.x - pad, va.y - pad, va.width + pad * 2, va.height + pad * 2)
                ctx.fillStyle = '#06b6d4'
                const handleSize = 7 / curView.zoom
                ctx.fillRect(va.x - pad - handleSize / 2, va.y - pad - handleSize / 2, handleSize, handleSize)
                ctx.fillRect(va.x + va.width + pad - handleSize / 2, va.y - pad - handleSize / 2, handleSize, handleSize)
                ctx.fillRect(va.x - pad - handleSize / 2, va.y + va.height + pad - handleSize / 2, handleSize, handleSize)
                ctx.fillRect(va.x + va.width + pad - handleSize / 2, va.y + va.height + pad - handleSize / 2, handleSize, handleSize)
                ctx.restore()
              }
            }
          } else {
            for (const s of curBoard.shapeNodes) {
              if (selectedSet.has(s.id)) {
                ctx.save()
                ctx.strokeStyle = 'rgba(6, 182, 212, 0.7)'
                ctx.lineWidth = 1.5 / curView.zoom
                const pad = 3
                const b = getShapeBoundingRect(s)
                const sx = b.x
                const sy = b.y
                const sw = Math.max(8, b.w)
                const sh = Math.max(8, b.h)
                ctx.strokeRect(sx - pad, sy - pad, sw + pad * 2, sh + pad * 2)
                ctx.restore()
              }
            }
            for (const va of curBoard.vectorArtNodes ?? []) {
              if (selectedSet.has(va.id)) {
                ctx.save()
                ctx.strokeStyle = 'rgba(6, 182, 212, 0.7)'
                ctx.lineWidth = 1.5 / curView.zoom
                const pad = 3
                ctx.strokeRect(va.x - pad, va.y - pad, va.width + pad * 2, va.height + pad * 2)
                ctx.restore()
              }
            }
            for (const st of curBoard.strokes) {
              if (selectedSet.has(st.id)) {
                drawStroke(ctx, st, themeTokens, { color: '#06b6d4', alpha: 0.6 })
              }
            }

            const bounds = getSelectionBounds(curBoard, currentSelectedIds)
            if (bounds) {
              const pad = 12 / z
              const gx = bounds.minX - pad
              const gy = bounds.minY - pad
              const gw = bounds.w + pad * 2
              const gh = bounds.h + pad * 2

              ctx.save()
              ctx.fillStyle = 'rgba(6, 182, 212, 0.05)'
              ctx.fillRect(gx, gy, gw, gh)
              ctx.strokeStyle = '#06b6d4'
              ctx.lineWidth = 1.8 / z
              ctx.setLineDash([7 / z, 5 / z])
              ctx.strokeRect(gx, gy, gw, gh)
              ctx.setLineDash([])

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

              const pillText = `Diagram · ${currentSelectedIds.length} items`
              const fontSize = Math.max(10, Math.round(12 / z))
              ctx.font = `600 ${fontSize}px Inter, -apple-system, sans-serif`
              const textMetrics = ctx.measureText(pillText)
              const pillW = textMetrics.width + 16 / z
              const pillH = 22 / z
              const pillX = gx
              const pillY = gy - pillH - 6 / z

              ctx.fillStyle = '#0891b2'
              ctx.beginPath()
              ctx.roundRect(pillX, pillY, pillW, pillH, 4 / z)
              ctx.fill()

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
          ctx.lineWidth = 1.5 / z
          ctx.setLineDash([6 / z, 4 / z])
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
          ctx.lineWidth = 1.5 / z
          ctx.stroke()
          ctx.beginPath()
          ctx.arc(m.x, m.y, 2.5 / z, 0, Math.PI * 2)
          ctx.fillStyle = '#f43f5e'
          ctx.fill()
          ctx.restore()
        }

        // Draw React Flow-style circular connection ports & live orthogonal connection preview
        if (activeToolRef.current === 'select') {
          const drag = shapeDragRef.current
          if (drag?.kind === 'connect' && drag.sourceShapeId && drag.sourcePort) {
            const sourceShape = curBoard.shapeNodes.find((s) => s.id === drag.sourceShapeId)
            if (sourceShape) {
              drawShapeConnectionPorts(ctx, sourceShape, curView.zoom, {
                activeSourcePort: drag.sourcePort,
                accentColor: themeTokens.accent
              })
              const startPt = getShapePorts(sourceShape)[drag.sourcePort]
              const snapShape = drag.snapTarget
                ? curBoard.shapeNodes.find((s) => s.id === drag.snapTarget!.shapeId)
                : undefined
              let endPt = {
                x: drag.currentX ?? drag.startPinchX,
                y: drag.currentY ?? drag.startPinchY
              }
              let endPort = inferFreeEndPort(startPt, endPt, drag.sourcePort)
              if (snapShape && drag.snapTarget) {
                drawShapeConnectionPorts(ctx, snapShape, curView.zoom, {
                  snapPort: drag.snapTarget.port,
                  accentColor: themeTokens.accent
                })
                endPt = getShapePorts(snapShape)[drag.snapTarget.port]
                endPort = drag.snapTarget.port
              }
              drawLiveConnectionPreview(
                ctx,
                startPt,
                drag.sourcePort,
                endPt,
                endPort,
                curView.zoom,
                themeTokens.accent
              )
            }
          } else if (!selectionBoxRef.current && !drag) {
            const portShapes: ShapeNode[] = []
            if (currentSelectedIds.length === 1) {
              const sel = curBoard.shapeNodes.find((s) => s.id === currentSelectedIds[0])
              if (
                sel &&
                !isConnectorShape(sel) &&
                isItemVisible(sel.layerId, curLayers) &&
                isItemEditable(sel.layerId, curLayers)
              ) {
                portShapes.push(sel)
              }
            }
            if (hoveredShapeIdRef.current) {
              const hov = curBoard.shapeNodes.find((s) => s.id === hoveredShapeIdRef.current)
              if (
                hov &&
                !isConnectorShape(hov) &&
                isItemVisible(hov.layerId, curLayers) &&
                isItemEditable(hov.layerId, curLayers) &&
                !portShapes.some((ps) => ps.id === hov.id)
              ) {
                portShapes.push(hov)
              }
            }
            for (const ps of portShapes) {
              drawShapeConnectionPorts(ctx, ps, curView.zoom, {
                hoveredPort:
                  hoveredPortRef.current?.shapeId === ps.id ? hoveredPortRef.current.port : null,
                accentColor: themeTokens.accent
              })
            }
          }
        }

        ctx.restore()
      }
    }

    if (keepAnimatingPulse) {
      scheduleRenderRef.current()
    }
  }, [themeTokens, fontCss, boardPalette, holdSnap])

  const scheduleRender = useCallback(() => {
    if (rafIdRef.current !== null) return
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null
      paintCanvases()
    })
  }, [paintCanvases])

  scheduleRenderRef.current = scheduleRender

  useEffect(() => {
    scheduleRender()
  }, [
    scheduleRender,
    board,
    view,
    selectedIds,
    activeTool,
    eraserMode,
    eraserSize,
    activeSection?.id
  ])

  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }
    }
  }, [])

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
        vectorArtNodes: (b.vectorArtNodes ?? []).filter((v) => v.id !== id),
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
      shapeNodes: b.shapeNodes.filter(
        (s) =>
          !idsToDelete.has(s.id) &&
          !(s.startBinding && idsToDelete.has(s.startBinding.shapeId)) &&
          !(s.endBinding && idsToDelete.has(s.endBinding.shapeId))
      ),
      vectorArtNodes: (b.vectorArtNodes ?? []).filter((v) => !idsToDelete.has(v.id)),
      diagramNodes: (b.diagramNodes ?? []).filter((d) => !idsToDelete.has(d.id)),
      codeNodes: (b.codeNodes ?? []).filter((c) => !idsToDelete.has(c.id)),
      videoNodes: (b.videoNodes ?? []).filter((v) => !idsToDelete.has(v.id))
    }))
    addToast('info', `Deleted ${selectedIds.length} element${selectedIds.length > 1 ? 's' : ''}`)
    setSelectedIds([])
  }, [selectedIds, update, addToast])

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
      const artNode = (curBoard.vectorArtNodes ?? []).find((v) => v.id === id)
      if (artNode) {
        const dup: VectorArtNode = {
          ...artNode,
          id: `vart-${Date.now()}`,
          x: artNode.x + 30,
          y: artNode.y + 30,
          layers: artNode.layers.map((l) => ({ ...l }))
        }
        update((b) => ({ ...b, vectorArtNodes: [...(b.vectorArtNodes ?? []), dup] }))
        setSelectedId(dup.id)
        return
      }
    },
    [update]
  )

  const handleApplyFont = useCallback(
    (nextFont: FontId) => {
      patchSettings({ font: nextFont })
      const selIds = selectedIdsRef.current
      if (selIds.length === 0) return
      const idSet = new Set(selIds)
      const cur = boardRef.current
      const touchesBoardItem =
        cur.textNodes.some((t) => idSet.has(t.id)) || cur.shapeNodes.some((s) => idSet.has(s.id))
      if (!touchesBoardItem) return

      pushHistory()
      update((b) => ({
        ...b,
        textNodes: b.textNodes.map((t) =>
          idSet.has(t.id) ? { ...t, fontFamily: nextFont } : t
        ),
        shapeNodes: b.shapeNodes.map((s) =>
          idSet.has(s.id) ? { ...s, fontFamily: nextFont } : s
        )
      }))
      scheduleRenderRef.current()
    },
    [patchSettings, pushHistory, update, boardRef]
  )

  const handleSelectAll = useCallback(() => {
    const cur = boardRef.current
    const curLayers = boardLayersRef.current
    const allIds: string[] = []
    for (const s of cur.shapeNodes) {
      if (isItemVisible(s.layerId, curLayers) && isItemEditable(s.layerId, curLayers)) {
        allIds.push(s.id)
      }
    }
    for (const st of cur.strokes) {
      if (isItemVisible(st.layerId, curLayers) && isItemEditable(st.layerId, curLayers)) {
        allIds.push(st.id)
      }
    }
    for (const v of cur.vectorArtNodes ?? []) {
      if (isItemVisible(v.layerId, curLayers) && isItemEditable(v.layerId, curLayers)) {
        allIds.push(v.id)
      }
    }
    for (const t of cur.textNodes) {
      if (!t.immersed || (isItemVisible(t.layerId, curLayers) && isItemEditable(t.layerId, curLayers))) {
        allIds.push(t.id)
      }
    }
    for (const eq of cur.equationNodes) allIds.push(eq.id)
    for (const d of cur.diagramNodes ?? []) allIds.push(d.id)
    for (const c of cur.codeNodes ?? []) allIds.push(c.id)
    for (const v of cur.videoNodes ?? []) allIds.push(v.id)

    setSelectedIds(allIds)
    setActiveTool('select')
    scheduleRenderRef.current()
  }, [boardRef])

  const handleMoveSelectionToLayer = useCallback(
    (targetLayerId: string) => {
      const selIds = selectedIdsRef.current
      if (selIds.length === 0) return
      const idSet = new Set(selIds)
      pushHistory()
      update((b) => {
        const ensured = ensureBoardLayers(b)
        const nextLayers = ensured.layers.map((l) =>
          l.id === targetLayerId ? { ...l, visible: true } : l
        )
        return {
          ...b,
          layers: nextLayers,
          strokes: b.strokes.map((st) =>
            idSet.has(st.id) ? { ...st, layerId: targetLayerId } : st
          ),
          shapeNodes: b.shapeNodes.map((s) =>
            idSet.has(s.id) ? { ...s, layerId: targetLayerId } : s
          ),
          vectorArtNodes: (b.vectorArtNodes ?? []).map((v) =>
            idSet.has(v.id) ? { ...v, layerId: targetLayerId } : v
          ),
          textNodes: b.textNodes.map((t) =>
            idSet.has(t.id) && t.immersed ? { ...t, layerId: targetLayerId } : t
          )
        }
      })
      scheduleRenderRef.current()
      const layerName =
        boardLayersRef.current.find((l) => l.id === targetLayerId)?.name || targetLayerId
      addToast('success', `Moved selection to "${layerName}"`)
    },
    [pushHistory, update, addToast]
  )

  const handleDuplicateSelection = useCallback(() => {
    const selIds = selectedIdsRef.current
    if (selIds.length === 0) return
    if (selIds.length === 1) {
      const single = selIds[0]
      const cur = boardRef.current
      const isCardOrArt =
        cur.textNodes.some((t) => t.id === single) ||
        cur.equationNodes.some((eq) => eq.id === single) ||
        (cur.diagramNodes ?? []).some((d) => d.id === single) ||
        (cur.codeNodes ?? []).some((c) => c.id === single) ||
        (cur.videoNodes ?? []).some((v) => v.id === single) ||
        (cur.vectorArtNodes ?? []).some((va) => va.id === single)
      if (isCardOrArt) {
        pushHistory()
        handleDuplicateElement(single)
        return
      }
    }

    const idSet = new Set(selIds)
    const now = Date.now()
    const clonedIds: string[] = []
    let counter = 0
    const nextId = (prefix: string): string => `${prefix}-${now.toString(36)}-${++counter}`

    pushHistory()
    update((b) => {
      const shapeIdMap = new Map<string, string>()
      const newShapes = b.shapeNodes
        .filter((s) => idSet.has(s.id))
        .map((s) => {
          const id = nextId('shp')
          shapeIdMap.set(s.id, id)
          clonedIds.push(id)
          return {
            ...s,
            id,
            x: s.x + 30,
            y: s.y + 30,
            controlPoint: s.controlPoint
              ? ([s.controlPoint[0] + 30, s.controlPoint[1] + 30] as [number, number])
              : undefined,
            points: s.points
              ? s.points.map(([px, py]) => [px + 30, py + 30] as [number, number])
              : undefined
          }
        })
      const syncedNewShapes = remapDuplicatedConnectors(newShapes, shapeIdMap)
      const newStrokes = b.strokes
        .filter((st) => idSet.has(st.id))
        .map((st) => {
          const id = nextId('st')
          clonedIds.push(id)
          return {
            ...st,
            id,
            points: st.points.map(([px, py, pr]) => [px + 30, py + 30, pr] as InkPoint)
          }
        })
      const newTexts = b.textNodes
        .filter((t) => idSet.has(t.id))
        .map((t) => {
          const id = nextId('text')
          clonedIds.push(id)
          return { ...t, id, x: t.x + 30, y: t.y + 30, createdAt: now }
        })
      const newEqs = b.equationNodes
        .filter((eq) => idSet.has(eq.id))
        .map((eq) => {
          const id = nextId('eq')
          clonedIds.push(id)
          return { ...eq, id, x: eq.x + 30, y: eq.y + 30, createdAt: now }
        })
      const newArts = (b.vectorArtNodes ?? [])
        .filter((v) => idSet.has(v.id))
        .map((v) => {
          const id = nextId('vart')
          clonedIds.push(id)
          return { ...v, id, x: v.x + 30, y: v.y + 30, layers: v.layers.map((l) => ({ ...l })) }
        })
      const newDiags = (b.diagramNodes ?? [])
        .filter((d) => idSet.has(d.id))
        .map((d) => {
          const id = nextId('diag')
          clonedIds.push(id)
          return { ...d, id, x: d.x + 30, y: d.y + 30, createdAt: now }
        })
      const newCodes = (b.codeNodes ?? [])
        .filter((c) => idSet.has(c.id))
        .map((c) => {
          const id = nextId('code')
          clonedIds.push(id)
          return { ...c, id, x: c.x + 30, y: c.y + 30, tabs: c.tabs.map((t) => ({ ...t })) }
        })
      const newVideos = (b.videoNodes ?? [])
        .filter((v) => idSet.has(v.id))
        .map((v) => {
          const id = nextId('video')
          clonedIds.push(id)
          return { ...v, id, x: v.x + 30, y: v.y + 30 }
        })
      return {
        ...b,
        shapeNodes: [...b.shapeNodes, ...syncedNewShapes],
        strokes: [...b.strokes, ...newStrokes],
        textNodes: [...b.textNodes, ...newTexts],
        equationNodes: [...b.equationNodes, ...newEqs],
        vectorArtNodes: [...(b.vectorArtNodes ?? []), ...newArts],
        diagramNodes: [...(b.diagramNodes ?? []), ...newDiags],
        codeNodes: [...(b.codeNodes ?? []), ...newCodes],
        videoNodes: [...(b.videoNodes ?? []), ...newVideos]
      }
    })
    if (clonedIds.length > 0) {
      setSelectedIds(clonedIds)
      scheduleRenderRef.current()
    }
  }, [boardRef, handleDuplicateElement, pushHistory, update])

  const handleCanvasContextMenu = useCallback(
    (e: React.MouseEvent, explicitElementId?: string) => {
      e.preventDefault()
      e.stopPropagation()
      const canvasPt = screenToCanvas(e.clientX, e.clientY, viewRef.current)
      const currentSelected = selectedIdsRef.current

      if (explicitElementId) {
        if (!currentSelected.includes(explicitElementId)) {
          setSelectedIds([explicitElementId])
        }
      } else {
        const curBoard = boardRef.current
        const curLayers = boardLayersRef.current
        const hitArt = [...(curBoard.vectorArtNodes ?? [])]
          .reverse()
          .find(
            (v) =>
              isItemEditable(v.layerId, curLayers) &&
              canvasPt.x >= v.x &&
              canvasPt.x <= v.x + v.width &&
              canvasPt.y >= v.y &&
              canvasPt.y <= v.y + v.height
          )
        const hitShape = hitArt
          ? null
          : [...curBoard.shapeNodes].reverse().find((s) => {
              if (!isItemEditable(s.layerId, curLayers)) return false
              const b = getShapeBoundingRect(s)
              const margin = s.points?.length || Math.abs(s.w) < 16 || Math.abs(s.h) < 16 ? 10 : 0
              return (
                canvasPt.x >= b.x - margin &&
                canvasPt.x <= b.x + Math.max(20, b.w) + margin &&
                canvasPt.y >= b.y - margin &&
                canvasPt.y <= b.y + Math.max(20, b.h) + margin
              )
            })
        const hitStroke =
          hitArt || hitShape
            ? null
            : [...curBoard.strokes]
                .reverse()
                .find(
                  (st) =>
                    isItemEditable(st.layerId, curLayers) &&
                    st.points.some(
                      ([px, py]) =>
                        Math.hypot(canvasPt.x - px, canvasPt.y - py) <= 12 / viewRef.current.zoom
                    )
                )
        const hitId = hitArt?.id ?? hitShape?.id ?? hitStroke?.id
        if (hitId && !currentSelected.includes(hitId)) {
          setSelectedIds([hitId])
        }
      }

      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        worldX: Math.round(canvasPt.x),
        worldY: Math.round(canvasPt.y)
      })
    },
    [boardRef]
  )

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
        } else if (e.key === 'l' || e.key === 'L') {
          setIsLayersOpen((v) => !v)
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
            shapeNodes: syncBoundConnectors(
              b.shapeNodes.map((s) =>
                idSet.has(s.id)
                  ? {
                    ...s,
                    x: s.x + dx,
                    y: s.y + dy,
                    ...(s.controlPoint
                      ? {
                        controlPoint: [s.controlPoint[0] + dx, s.controlPoint[1] + dy] as [
                          number,
                          number
                        ]
                      }
                      : {}),
                    ...(s.points
                      ? {
                        points: s.points.map(([px, py]) => [px + dx, py + dy] as [number, number])
                      }
                      : {})
                  }
                  : s
              )
            ),
            textNodes: b.textNodes.map((t) => (idSet.has(t.id) ? { ...t, x: t.x + dx, y: t.y + dy } : t)),
            vectorArtNodes: (b.vectorArtNodes ?? []).map((v) =>
              idSet.has(v.id) ? { ...v, x: v.x + dx, y: v.y + dy } : v
            ),
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

      // Undo (Ctrl+Z / Cmd+Z), Redo, Select All (Ctrl+A), Duplicate (Ctrl+D)
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
        if (k === 'a' && !e.shiftKey) {
          e.preventDefault()
          handleSelectAll()
          return
        }
        if (k === 'd' && !e.shiftKey) {
          e.preventDefault()
          handleDuplicateSelection()
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

      // Vectorize selected drawing into clean board-immersed vectors & text (Ctrl+Shift+B / Cmd+Shift+B)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault()
        handleVectorizeSelected()
        return
      }

      // Beautify selected diagram (Ctrl+B / Cmd+B)
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'b' || e.key === 'B')) {
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
        setContextMenu(null)
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
  }, [activeSection, selectedIds, deleteSelectedElements, handleFitToContent, handleBeautifySelected, handleVectorizeSelected, handleSelectAll, handleDuplicateSelection, undo, redo])

  const isLight = boardPalette.isLight
  const isHomeView = !activeSection

  const selectedVectorArt = useMemo(() => {
    if (selectedIds.length !== 1) return null
    const id = selectedIds[0]
    return (board.vectorArtNodes ?? []).find((v) => v.id === id) ?? null
  }, [selectedIds, board.vectorArtNodes])

  const selectedDiagramMeta = useMemo(() => {
    if (selectedIds.length === 0 || !board.vectorDiagramMeta) return null
    const idSet = new Set(selectedIds)
    for (const s of board.shapeNodes) {
      if (idSet.has(s.id) && s.vectorGroupId && board.vectorDiagramMeta[s.vectorGroupId]) {
        return board.vectorDiagramMeta[s.vectorGroupId]
      }
    }
    for (const t of board.textNodes) {
      if (idSet.has(t.id) && t.vectorGroupId && board.vectorDiagramMeta[t.vectorGroupId]) {
        return board.vectorDiagramMeta[t.vectorGroupId]
      }
    }
    return null
  }, [selectedIds, board.shapeNodes, board.textNodes, board.vectorDiagramMeta])

  const selectedShapes = useMemo(() => {
    if (selectedIds.length === 0) return []
    const idSet = new Set(selectedIds)
    return board.shapeNodes.filter((s) => idSet.has(s.id))
  }, [selectedIds, board.shapeNodes])

  const editingShape = useMemo(
    () => (editingShapeId ? board.shapeNodes.find((s) => s.id === editingShapeId) ?? null : null),
    [editingShapeId, board.shapeNodes]
  )

  const lastStyleHistoryRef = useRef<number>(0)
  const handlePatchSelectedShapes = useCallback(
    (patch: Partial<ShapeNode>, opts?: { coalesceHistory?: boolean }) => {
      const selIds = selectedIdsRef.current
      if (selIds.length === 0) return
      const idSet = new Set(selIds)
      if (!boardRef.current.shapeNodes.some((s) => idSet.has(s.id))) return
      const now = Date.now()
      const shouldPushHistory =
        !opts?.coalesceHistory || now - lastStyleHistoryRef.current > 600
      if (shouldPushHistory) {
        lastStyleHistoryRef.current = now
      }
      update(
        (b) => {
          const { routing: nextRouting, ...restPatch } = patch
          const shapeById = nextRouting
            ? new Map(b.shapeNodes.map((s) => [s.id, s]))
            : null
          return {
            ...b,
            shapeNodes: b.shapeNodes.map((s) => {
              if (!idSet.has(s.id)) return s
              if (nextRouting && shapeById && isConnectorShape(s)) {
                return { ...convertConnectorRouting(s, nextRouting, shapeById), ...restPatch }
              }
              return { ...s, ...patch }
            })
          }
        },
        { history: shouldPushHistory }
      )
      scheduleRenderRef.current()
    },
    [update]
  )

  const boardShapeGraph = useMemo(
    () => buildGraphFromBoardShapes(selectedShapes, board.shapeNodes),
    [selectedShapes, board.shapeNodes]
  )

  const handleAutoLayoutBoardShapes = useCallback(
    async (direction: 'RIGHT' | 'DOWN') => {
      const curBoard = boardRef.current
      const idSet = new Set(selectedIdsRef.current)
      const selShapes = curBoard.shapeNodes.filter((s) => idSet.has(s.id))
      const graphInfo = buildGraphFromBoardShapes(selShapes, curBoard.shapeNodes)
      if (!graphInfo) return

      const activeFont: FontId =
        settingsRef.current.font && settingsRef.current.font in FONTS
          ? settingsRef.current.font
          : 'jakarta'

      try {
        const laidOut = await layoutDiagramWithElkWorker(
          { ...graphInfo.graph, direction },
          graphInfo.anchor,
          activeFont,
          { directionOverride: direction }
        )
        const prefix = `vnode-${laidOut.groupId}-`
        const posByOrigId = new Map<string, { x: number; y: number }>()
        for (const s of laidOut.shapes) {
          if (s.id.startsWith(prefix)) {
            posByOrigId.set(s.id.slice(prefix.length), { x: s.x, y: s.y })
          }
        }
        if (posByOrigId.size === 0) return

        const edgeIdSet = new Set(graphInfo.edgeIds)
        const startPort: PortSide = direction === 'RIGHT' ? 'right' : 'bottom'
        const endPort: PortSide = direction === 'RIGHT' ? 'left' : 'top'

        update(
          (b) => ({
            ...b,
            shapeNodes: syncBoundConnectors(
              b.shapeNodes.map((s) => {
                const nextPos = posByOrigId.get(s.id)
                if (nextPos) {
                  return { ...s, x: nextPos.x, y: nextPos.y }
                }
                if (edgeIdSet.has(s.id) && s.startBinding && s.endBinding) {
                  return {
                    ...s,
                    startBinding: { ...s.startBinding, port: startPort },
                    endBinding: { ...s.endBinding, port: endPort }
                  }
                }
                return s
              })
            )
          }),
          { history: true }
        )
        scheduleRenderRef.current()
        addToast(
          'success',
          `Auto-laid out ${posByOrigId.size} shapes (${direction === 'RIGHT' ? 'Left → Right' : 'Top → Bottom'})`
        )
      } catch (err) {
        addToast('error', `Auto-layout failed: ${(err as Error)?.message || 'ELK error'}`)
      }
    },
    [update, addToast]
  )

  const handleCanvasDoubleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (activeToolRef.current !== 'select') return
    const canvasPt = screenToCanvas(e.clientX, e.clientY, viewRef.current)
    const curBoard = boardRef.current
    const curLayers = boardLayersRef.current
    const hit = [...curBoard.shapeNodes].reverse().find((s) => {
      if (!isItemEditable(s.layerId, curLayers)) return false
      const b = getShapeBoundingRect(s)
      const margin = s.points?.length || Math.abs(s.w) < 16 || Math.abs(s.h) < 16 ? 10 : 4
      return (
        canvasPt.x >= b.x - margin &&
        canvasPt.x <= b.x + Math.max(20, b.w) + margin &&
        canvasPt.y >= b.y - margin &&
        canvasPt.y <= b.y + Math.max(20, b.h) + margin
      )
    })
    if (hit) {
      setSelectedIds([hit.id])
      setEditingShapeId(hit.id)
      setEditingShapeText(hit.label ?? '')
    }
  }, [])

  const handleCommitShapeLabel = useCallback(() => {
    if (!editingShapeId) return
    const nextLabel = editingShapeText.trim()
    const target = boardRef.current.shapeNodes.find((s) => s.id === editingShapeId)
    setEditingShapeId(null)
    if (!target) return
    if ((target.label ?? '') === nextLabel) return
    update((b) => ({
      ...b,
      shapeNodes: b.shapeNodes.map((s) =>
        s.id === editingShapeId ? { ...s, label: nextLabel || undefined } : s
      )
    }))
    scheduleRenderRef.current()
  }, [editingShapeId, editingShapeText, update])

  const hasSelectedStrokes = useMemo(() => {
    if (selectedIds.length === 0) return false
    const idSet = new Set(selectedIds)
    return board.strokes.some((st) => idSet.has(st.id))
  }, [selectedIds, board.strokes])

  const hasTextOrShapeSelected = useMemo(() => {
    if (selectedIds.length === 0) return false
    const idSet = new Set(selectedIds)
    return (
      board.textNodes.some((t) => idSet.has(t.id)) ||
      board.shapeNodes.some((s) => idSet.has(s.id))
    )
  }, [selectedIds, board.textNodes, board.shapeNodes])

  const hasLayerableSelected = useMemo(() => {
    if (selectedIds.length === 0) return false
    const idSet = new Set(selectedIds)
    return (
      board.strokes.some((st) => idSet.has(st.id)) ||
      board.shapeNodes.some((s) => idSet.has(s.id)) ||
      (board.vectorArtNodes ?? []).some((v) => idSet.has(v.id)) ||
      board.textNodes.some((t) => t.immersed && idSet.has(t.id))
    )
  }, [selectedIds, board.strokes, board.shapeNodes, board.vectorArtNodes, board.textNodes])

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
        <Suspense fallback={null}>
          <HomeHub
            lastSectionId={lastSectionId}
            onOpenSection={(sec, proj, opts) => void handleOpenSection(sec, proj, opts)}
            onToast={addToast}
          />
        </Suspense>
      ) : (
        <>
          {/* Layer 1.5: Base Canvas for Ink/Shapes/Art positioned BELOW Cards & Widgets */}
          <canvas
            ref={committedCanvasRef}
            id="board-canvas"
            className={`canvas-layer committed-canvas cursor-${getCanvasCursor()}`}
            style={{ cursor: getCanvasCursor() }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerLeave}
            onDoubleClick={handleCanvasDoubleClick}
            onContextMenu={(e) => handleCanvasContextMenu(e)}
          />

          {/* Layer 2: Interactive Movable Text, Equation, React Flow Diagrams, Code & Video Cards */}
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
            onAskAICode={(cardId, ctx) => {
              const errSummary = ctx.error || ctx.stderr
              const promptText = errSummary
                ? `Diagnose and fix the bug in Code Card "${ctx.title}" (${ctx.language}). Verify with run_code and patch card "${cardId}" in place.`
                : `Review Code Card "${ctx.title}" (${ctx.language}), explain what it does, and improve it if helpful.`
              void handleRunAgent(promptText, {
                mode: 'fix_code',
                activeCodeContext: {
                  cardId,
                  title: ctx.title,
                  language: ctx.language,
                  code: ctx.code,
                  stdout: ctx.stdout,
                  stderr: ctx.stderr,
                  error: ctx.error
                },
                openPanel: true
              })
            }}
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
            defaultFont={settings.font}
            penColor={penColor === 'ink' ? themeTokens.ink : penColor === 'accent' ? themeTokens.accent : penColor}
            penSize={settings.inkSize}
            boardLayers={boardLayers}
            cardsVisible={partitionedLayers.cardsLayer.visible}
            cardsLocked={partitionedLayers.cardsLayer.locked}
            cardsOpacity={partitionedLayers.cardsLayer.opacity}
            onElementContextMenu={(e, id) => handleCanvasContextMenu(e, id)}
          />

          {/* Layer 3: Overlay Annotation Canvas ABOVE Text, React Flow Diagrams, Code & Videos */}
          <canvas
            ref={overlayCanvasRef}
            id="board-canvas-overlay"
            className={`canvas-layer overlay-canvas cursor-${getCanvasCursor()}`}
            style={{
              cursor: getCanvasCursor(),
              pointerEvents:
                activeTool === 'pen' ||
                activeTool === 'eraser' ||
                activeTool === 'pan' ||
                isSpacePanning ||
                partitionedLayers.cardsLayer.locked
                  ? 'auto'
                  : 'none'
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerLeave}
            onDoubleClick={handleCanvasDoubleClick}
            onContextMenu={(e) => handleCanvasContextMenu(e)}
          />

          {/* Inline label editor for double-clicked embedded board shapes */}
          {editingShape && (() => {
            const b = getShapeBoundingRect(editingShape)
            const screenX = b.x * view.zoom + view.panX
            const screenY = b.y * view.zoom + view.panY
            const screenW = Math.max(96, Math.max(24, b.w) * view.zoom)
            const screenH = Math.max(36, Math.max(24, b.h) * view.zoom)
            const fill = editingShape.fillColor || boardPalette.shapeFill
            const isTransparent =
              fill === 'transparent' ||
              fill === 'none' ||
              (editingShape.fillOpacity !== undefined && editingShape.fillOpacity < 0.45)
            const autoTextCol = isTransparent
              ? boardPalette.ink
              : isLightColor(fill)
                ? '#111111'
                : '#FFFDF7'
            const textCol =
              editingShape.labelColor && editingShape.labelColor !== 'auto'
                ? editingShape.labelColor === 'ink'
                  ? boardPalette.ink
                  : editingShape.labelColor === 'accent'
                    ? themeTokens.accent
                    : editingShape.labelColor
                : autoTextCol
            const activeEditFont: FontId =
              editingShape.fontFamily && editingShape.fontFamily in FONTS
                ? editingShape.fontFamily
                : settings.font
            const editorFont = resolveFontCss(activeEditFont)
            const editorFontSize = Math.max(
              12,
              Math.min(24, Math.round((editingShape.labelSize ?? 15) * view.zoom))
            )
            const pickerHex = /^#[0-9a-f]{6}$/i.test(textCol) ? textCol : '#111111'
            return (
              <div
                className="shape-inline-editor-wrap"
                style={{
                  left: `${screenX}px`,
                  top: `${screenY}px`,
                  width: `${screenW}px`,
                  height: `${screenH}px`
                }}
                onPointerDown={(ev) => ev.stopPropagation()}
                onDoubleClick={(ev) => ev.stopPropagation()}
              >
                <div
                  className="shape-inline-text-bar"
                  tabIndex={-1}
                  onPointerDown={(ev) => ev.stopPropagation()}
                >
                  <select
                    className="shape-font-select"
                    value={activeEditFont}
                    onChange={(ev) =>
                      handlePatchSelectedShapes({ fontFamily: ev.target.value as FontId })
                    }
                    title="Select font for shape text"
                  >
                    {FONT_ORDER.map((fid) => (
                      <option key={fid} value={fid}>
                        {FONTS[fid].shortLabel} · {FONTS[fid].label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className={`vector-ctx-btn ${!editingShape.labelColor || editingShape.labelColor === 'auto' ? 'active' : ''}`}
                    onMouseDown={(ev) => ev.preventDefault()}
                    onClick={() => handlePatchSelectedShapes({ labelColor: undefined })}
                    title="Auto-contrast text color"
                  >
                    Auto
                  </button>
                  {['#111111', '#FFFFFF', '#EF4444', '#2563EB', '#10B981', '#8B5CF6'].map((hex) => (
                    <button
                      key={hex}
                      type="button"
                      className={`shape-swatch-btn ${
                        editingShape.labelColor?.toLowerCase() === hex.toLowerCase() ? 'active' : ''
                      }`}
                      style={{ backgroundColor: hex }}
                      onMouseDown={(ev) => ev.preventDefault()}
                      onClick={() => handlePatchSelectedShapes({ labelColor: hex })}
                      title={`Text Color ${hex}`}
                    />
                  ))}
                  <label
                    className="shape-color-picker-btn"
                    title="Pick custom shape text color"
                  >
                    <span
                      className="shape-color-picker-preview"
                      style={{ backgroundColor: pickerHex }}
                    />
                    <input
                      type="color"
                      className="vector-swatch-input"
                      value={pickerHex}
                      onChange={(ev) =>
                        handlePatchSelectedShapes(
                          { labelColor: ev.target.value },
                          { coalesceHistory: true }
                        )
                      }
                    />
                  </label>
                </div>
                <input
                  type="text"
                  className="shape-inline-label-editor"
                  autoFocus
                  placeholder="Type label..."
                  value={editingShapeText}
                  style={{
                    fontFamily: editorFont,
                    fontSize: `${editorFontSize}px`,
                    color: textCol
                  }}
                  onChange={(ev) => setEditingShapeText(ev.target.value)}
                  onBlur={(ev) => {
                    if (
                      ev.relatedTarget &&
                      ev.currentTarget.parentElement?.contains(ev.relatedTarget as Node)
                    ) {
                      return
                    }
                    handleCommitShapeLabel()
                  }}
                  onKeyDown={(ev) => {
                    ev.stopPropagation()
                    if (ev.key === 'Enter') {
                      ev.preventDefault()
                      handleCommitShapeLabel()
                    } else if (ev.key === 'Escape') {
                      ev.preventDefault()
                      setEditingShapeId(null)
                    }
                  }}
                />
              </div>
            )
          })()}

          {/* Multi-element selection action bar (shown when hand-drawn strokes or non-shape cards are selected) */}
          {selectedIds.length > 0 &&
            (hasSelectedStrokes ||
              (selectedShapes.length === 0 && !selectedVectorArt && !selectedDiagramMeta)) && (
            <div className="diagram-selection-toolbar">
              <span className="diagram-selection-count">
                <BoxSelect size={14} />
                <span>{selectedIds.length} selected</span>
              </span>
              <button
                type="button"
                className="diagram-selection-beautify-btn"
                onClick={handleBeautifySelected}
                disabled={!isAiConfigured || isBeautifying || isVectorizing}
                title={
                  isAiConfigured
                    ? 'Convert raw hand-drawn sketch into interactive React Flow diagram (Ctrl+B)'
                    : 'AI Beautify disabled — configure AI Settings first'
                }
              >
                {isBeautifying ? (
                  <>
                    <Loader2 size={14} className="spin-animate" />
                    <span>Beautifying...</span>
                  </>
                ) : (
                  <>
                    <Sparkles size={14} />
                    <span>Beautify</span>
                  </>
                )}
              </button>

              <button
                type="button"
                className="diagram-selection-vectorize-btn"
                onClick={handleVectorizeSelected}
                disabled={isVectorizing || isBeautifying}
                title="Convert hand-drawn sketch into clean vector diagram & board font text (Ctrl+Shift+B)"
              >
                {isVectorizing ? (
                  <>
                    <Loader2 size={14} className="spin-animate" />
                    <span>Vectorizing...</span>
                  </>
                ) : (
                  <>
                    <Wand2 size={14} />
                    <span>Vectorize</span>
                  </>
                )}
              </button>

              {hasSelectedStrokes && (
                <button
                  type="button"
                  className="diagram-selection-trace-btn"
                  onClick={handleTraceOriginalSelected}
                  disabled={isVectorizing || isBeautifying}
                  title="100% offline multi-color VTracer vectorization of selected strokes (no AI required)"
                >
                  <PenTool size={14} />
                  <span>Trace</span>
                </button>
              )}

              {isAiConfigured && (
                <button
                  type="button"
                  className="diagram-selection-agent-btn"
                  onClick={() =>
                    void handleRunAgent(
                      'Inspect the selected canvas region and draw clear overlay annotations (arrows, highlights, and brief labels) directly on layer-overlay-ink.',
                      {
                        mode: 'annotate',
                        includeSelectionImage: true,
                        openPanel: true
                      }
                    )
                  }
                  disabled={agentRunning || isBeautifying || isVectorizing}
                  title="Ask VexelBot Agent to annotate the selected region on the top overlay layer"
                >
                  <Bot size={14} />
                  <span>{agentRunning ? 'Annotating...' : 'AI Annotate'}</span>
                </button>
              )}

              <button
                type="button"
                className="diagram-selection-del-btn"
                onClick={deleteSelectedElements}
                title="Delete selected elements (Delete / Backspace)"
              >
                <Trash2 size={14} />
                <span>Delete</span>
              </button>
              <button
                type="button"
                className="diagram-selection-close-btn"
                onClick={() => setSelectedIds([])}
                title="Deselect (Escape)"
              >
                <X size={14} />
              </button>
            </div>
          )}

          {/* Contextual Vector Art / ELK Diagram / Shape Style Mini-Toolbar */}
          <VectorActionToolbar
            selectedVectorArt={selectedVectorArt}
            selectedDiagramMeta={selectedDiagramMeta}
            selectedShapes={selectedShapes}
            boardPalette={boardPalette}
            canAutoLayoutShapes={Boolean(boardShapeGraph)}
            hasTopSelectionBar={hasSelectedStrokes}
            isBusy={isVectorizing}
            onPatchSelectedShapes={handlePatchSelectedShapes}
            onAutoLayoutShapes={(dir) => void handleAutoLayoutBoardShapes(dir)}
            onSyncAnimatedWaveFlow={handleSyncAnimatedWaveFlow}
            onEditShapeLabel={(shapeId) => {
              const found = boardRef.current.shapeNodes.find((s) => s.id === shapeId)
              if (found) {
                setEditingShapeId(found.id)
                setEditingShapeText(found.label ?? '')
              }
            }}
            onDeleteSelected={deleteSelectedElements}
            onClearSelection={() => setSelectedIds([])}
            onSwapArtColor={handleSwapArtColor}
            onUngroupArt={handleUngroupArt}
            onRerunArtStyle={handleRerunArtStyle}
            onRevertArtToSketch={handleRevertArtToSketch}
            onToggleDiagramDirection={handleToggleDiagramDirection}
            onRevertDiagramToSketch={handleRevertDiagramToSketch}
          />

          {/* Left Quick-Access Dock Toolbar */}
          <LeftDockToolbar
            activeTool={activeTool}
            onSelectTool={setActiveTool}
            onAddShapeNode={handleAddShapeNode}
            onAddStickyNote={handleAddStickyNote}
            onAddTemplate={handleAddTemplate}
            onBeautify={handleBeautifySelected}
            isBeautifying={isBeautifying}
            onVectorize={handleVectorizeSelected}
            isVectorizing={isVectorizing}
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
              onVectorize={handleVectorizeSelected}
              isVectorizing={isVectorizing}
              vectorFont={settings.font}
              onVectorFontChange={handleApplyFont}
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

          {/* Floating Canvas Navigation & Layers HUD */}
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
              className={`nav-hud-action-btn layers-toggle-btn ${isLayersOpen ? 'active' : ''}`}
              onClick={() => setIsLayersOpen((v) => !v)}
              title="Canvas Layers — draw pen annotations above or below Text, Diagrams & Code (L)"
            >
              <Layers size={13} />
              <span>
                {boardLayers.find((l) => l.id === activeLayerId)?.name || 'Layers'}
              </span>
            </button>
          </div>

          {contextMenu && (
            <CanvasContextMenu
              x={contextMenu.x}
              y={contextMenu.y}
              worldX={contextMenu.worldX}
              worldY={contextMenu.worldY}
              selectedCount={selectedIds.length}
              hasSelectedStrokes={hasSelectedStrokes}
              hasTextOrShapeSelected={hasTextOrShapeSelected}
              hasShapeSelected={selectedShapes.length > 0}
              currentShapeFill={selectedShapes[0]?.fillColor || boardPalette.shapeFill}
              currentShapeStroke={
                selectedShapes[0]?.color === 'ink' || !selectedShapes[0]?.color
                  ? boardPalette.shapeStroke
                  : selectedShapes[0].color === 'accent'
                    ? themeTokens.accent
                    : selectedShapes[0].color
              }
              onShapeFillChange={(fill, opts) =>
                handlePatchSelectedShapes({ fillColor: fill }, opts)
              }
              onShapeStrokeChange={(stroke, opts) =>
                handlePatchSelectedShapes({ color: stroke }, opts)
              }
              currentShapeLabelColor={selectedShapes[0]?.labelColor}
              onShapeLabelColorChange={(labelColor, opts) =>
                handlePatchSelectedShapes({ labelColor }, opts)
              }
              hasLayerableSelected={hasLayerableSelected}
              isAiConfigured={isAiConfigured}
              currentFont={selectedShapes[0]?.fontFamily || settings.font}
              onClose={() => setContextMenu(null)}
              onBeautify={handleBeautifySelected}
              onVectorize={handleVectorizeSelected}
              onTraceOriginal={handleTraceOriginalSelected}
              onAIAnnotate={() =>
                void handleRunAgent(
                  'Inspect the selected canvas region and draw clear overlay annotations (arrows, highlights, and brief labels) directly on layer-overlay-ink.',
                  {
                    mode: 'annotate',
                    includeSelectionImage: true,
                    openPanel: true
                  }
                )
              }
              onApplyFont={handleApplyFont}
              onMoveToLayer={handleMoveSelectionToLayer}
              onDuplicate={handleDuplicateSelection}
              onDelete={deleteSelectedElements}
              onSelectAll={handleSelectAll}
              onClearSelection={() => setSelectedIds([])}
              onAddTextAt={(wx, wy) => {
                const newNode: TextNode = {
                  id: `text-${Date.now()}`,
                  x: wx,
                  y: wy,
                  text: 'Type your note here...',
                  style: 'body',
                  fontSize: 18,
                  fontFamily: settingsRef.current.font,
                  color: 'ink',
                  source: 'manual',
                  createdAt: Date.now()
                }
                pushHistory()
                update((b) => ({ ...b, textNodes: [...b.textNodes, newNode] }))
                setSelectedIds([newNode.id])
                setActiveTool('select')
              }}
              onAddEquationAt={(wx, wy) => {
                const newEq: EquationNode = {
                  id: `eq-${Date.now()}`,
                  x: wx,
                  y: wy,
                  latex: 'f(x) = \\sigma(W x + b)',
                  fontSize: 22,
                  color: 'ink',
                  createdAt: Date.now()
                }
                pushHistory()
                update((b) => ({ ...b, equationNodes: [...b.equationNodes, newEq] }))
                setSelectedIds([newEq.id])
                setActiveTool('select')
              }}
              onAddCodeAt={() => handleAddCodeNode()}
              onAddFlowDiagram={() => handleAddTemplate('blank_flow')}
              onAddAnimatedArchitecture={() => handleAddTemplate('transformer_vs_moe')}
              onSyncAnimatedWaveFlow={handleSyncAnimatedWaveFlow}
              onFitView={handleFitToContent}
              onResetView={() => setView({ zoom: 1.0, panX: 0, panY: 0 })}
              onToggleLayers={() => setIsLayersOpen((v) => !v)}
            />
          )}

          <LayersPanel
            isOpen={isLayersOpen}
            board={board}
            layers={boardLayers}
            activeLayerId={activeLayerId}
            onClose={() => setIsLayersOpen(false)}
            onSelectActiveLayer={(layerId) =>
              update((b) => ({ ...b, activeLayerId: layerId }), { history: false })
            }
            onAddInkLayer={(pos) =>
              update((b) => addInkLayer(b, undefined, pos), { history: true })
            }
            onToggleVisible={(layerId) =>
              update((b) => toggleLayerVisible(b, layerId), { history: false })
            }
            onToggleLocked={(layerId) =>
              update((b) => toggleLayerLocked(b, layerId), { history: false })
            }
            onSetOpacity={(layerId, opacity) =>
              update((b) => setLayerOpacity(b, layerId, opacity), { history: false })
            }
            onRenameLayer={(layerId, name) =>
              update((b) => renameLayer(b, layerId, name), { history: false })
            }
            onMoveLayer={(layerId, dir) =>
              update((b) => moveLayer(b, layerId, dir), { history: true })
            }
            onDeleteLayer={(layerId) =>
              update((b) => deleteInkLayer(b, layerId), { history: true })
            }
            onSelectLayerItems={(layerId) => {
              const cur = boardRef.current
              const ids: string[] = []
              for (const st of cur.strokes) {
                if (resolveItemLayerId(st.layerId, boardLayers) === layerId) ids.push(st.id)
              }
              for (const sh of cur.shapeNodes) {
                if (resolveItemLayerId(sh.layerId, boardLayers) === layerId) ids.push(sh.id)
              }
              for (const va of cur.vectorArtNodes ?? []) {
                if (resolveItemLayerId(va.layerId, boardLayers) === layerId) ids.push(va.id)
              }
              for (const t of cur.textNodes) {
                if (t.immersed && resolveItemLayerId(t.layerId, boardLayers) === layerId) ids.push(t.id)
              }
              setSelectedIds(ids)
              setActiveTool('select')
            }}
          />

          {/* Right AI Research & Co-Pilot Panel */}
          <Suspense fallback={null}>
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
            onRunAgent={handleRunAgent}
            onCancelAgent={handleCancelAgent}
            agentRunning={agentRunning}
            agentSteps={agentSteps}
            canUndoLastAgent={canUndoLastAgent}
            onUndoLastAgent={() => {
              undo()
              setCanUndoLastAgent(false)
              scheduleRenderRef.current()
            }}
          />
          </Suspense>

          {/* Knowledge Studio Multi-Source Study Hub (mounted only when open) */}
          {isKnowledgeHubOpen && (
            <Suspense fallback={null}>
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
            </Suspense>
          )}
        </>
      )}

      {/* Settings Modal */}
      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsModal
            ai={settings.ai}
            onChangeAI={(ai) => patchSettings({ ai })}
            onClose={() => setSettingsOpen(false)}
            onToast={addToast}
          />
        </Suspense>
      )}

      {/* Toasts */}
      <Toasts toasts={toasts} />
    </div>
  )
}
