import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Bot, BoxSelect, Layers, Loader2, RotateCcw, RotateCw, Sparkles, Trash2, Wand2, X } from 'lucide-react'
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
  GraphNode,
  ImageNode,
  InkPoint,
  PortSide,
  Scene3DNode,
  Scene3DSpec,
  ShapeNode,
  Stroke,
  TextNode,
  Toast,
  ToolType,
  VectorArtNode,
  VectorDiagramMeta,
  VideoNode,
  VideoTabItem
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
  screenToCanvas
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
  syncBoundConnectors,
  type ConnectableBoardElement
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
  buildBoardNativeTemplateDiagram,
  type CleanReactFlowResult
} from './board/beautifyUtils'
import { compileFlowDiagramToBoardElements } from './board/nativeDiagramCompiler'
import { type GraphPlotSpec } from './board/graphPlotBuilder'
import {
  CODE_PIPELINE_PRESETS,
  mergeCodeVisualIntoGraphSpec,
  parseCodeOutputToVisuals,
  wrapCodeForAutoOutput
} from './board/codeVisualParser'
import { buildPresetScene3D } from '@shared/scene3dSchema'
import {
  applyGroupScale,
  applyRotationDelta,
  captureRotationSnapshot,
  isEndpointLinearShape,
  rotatePointAround,
  type RotationSnapshot
} from './board/rotationUtils'
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
import {
  buildShapeNodeFromHoldSnap,
  snapConnectorToShapeAnchors,
  type HoldSnapKind
} from './board/holdSnapClassifier'
import { layoutDiagramWithElkWorker } from './board/elkDiagramLayout'
import {
  BoundsRect,
  eraseStrokesAlongPath,
  eraseShapesAlongPath,
  eraseVectorArtAlongPath,
  findElementsInLasso,
  getShapeBoundingRect,
  normalizeRect,
  isShapeInRect,
  isStrokeInRect,
  isTextInRect,
  isEquationInRect,
  isDiagramInRect,
  isCodeInRect,
  isVideoInRect,
  isImageInRect,
  isScene3DInRect,
  isGraphInRect,
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
  editSection,
  fetchProjectChatStore,
  fetchSections,
  getProjectChatStorageKey,
  loadProjectChatStoreLocal,
  loadSectionViewLocal,
  persistProjectChatStore,
  saveSectionViewLocal,
  setActiveChatProjectId
} from './board/workspaceStore'
import { getToolCursorCss, resolvePenColorHex } from './board/penUtils'
import { analyzeSelectionLocally, detectLocalBasicShape } from './vision/localShapeDetector'
import { rasterizeStrokesBlockForApiOcr, rasterizeStrokesForLocalOcr } from './vision/localOcrUtils'
import {
  DEFAULT_PROVIDER_MODELS,
  DEFAULT_WEB_SEARCH_SETTINGS,
  PROVIDER_LABELS,
  type ChatAttachment,
  type CompanionSelectionCapturePayload,
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
const SkillsModal = lazy(() => import('./components/SkillsModal').then((m) => ({ default: m.SkillsModal })))

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
  images?: Array<{ id: string; initX: number; initY: number }>
  scene3ds?: Array<{ id: string; initX: number; initY: number }>
  graphs?: Array<{ id: string; initX: number; initY: number }>
  strokes: Array<{ id: string; initPoints: InkPoint[] }>
}

export type ResizeHandle8 = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export interface ShapeDragState {
  kind: 'move' | 'shape-resize' | 'vector-art-resize' | 'group-resize' | 'rotate' | 'connect'
  handle?: ResizeHandle8
  targetId?: string
  initX?: number
  initY?: number
  initW?: number
  initH?: number
  initRotation?: number
  initControlPoint?: [number, number]
  initPoints?: Array<[number, number]>
  initGroupBounds?: { x: number; y: number; w: number; h: number }
  rotationSnapshot?: RotationSnapshot
  startAngleRad?: number
  liveAngleDeg?: number
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

  for (const v of board.videoNodes ?? []) {
    if (idSet.has(v.id)) {
      found = true
      const vw = v.w ?? 540
      const vh = v.h ?? 460
      if (v.x < minX) minX = v.x
      if (v.y < minY) minY = v.y
      if (v.x + vw > maxX) maxX = v.x + vw
      if (v.y + vh > maxY) maxY = v.y + vh
    }
  }

  for (const img of board.imageNodes ?? []) {
    if (idSet.has(img.id)) {
      found = true
      const iw = img.w ?? 360
      const ih = img.h ?? 260
      if (img.x < minX) minX = img.x
      if (img.y < minY) minY = img.y
      if (img.x + iw > maxX) maxX = img.x + iw
      if (img.y + ih > maxY) maxY = img.y + ih
    }
  }

  for (const s3d of board.scene3dNodes ?? []) {
    if (idSet.has(s3d.id)) {
      found = true
      const sw = s3d.w ?? 480
      const sh = s3d.h ?? 380
      if (s3d.x < minX) minX = s3d.x
      if (s3d.y < minY) minY = s3d.y
      if (s3d.x + sw > maxX) maxX = s3d.x + sw
      if (s3d.y + sh > maxY) maxY = s3d.y + sh
    }
  }

  for (const gr of board.graphNodes ?? []) {
    if (idSet.has(gr.id)) {
      found = true
      const gw = gr.w ?? 520
      const gh = gr.h ?? 370
      if (gr.x < minX) minX = gr.x
      if (gr.y < minY) minY = gr.y
      if (gr.x + gw > maxX) maxX = gr.x + gw
      if (gr.y + gh > maxY) maxY = gr.y + gh
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
  const [skillsModalOpen, setSkillsModalOpen] = useState(false)
  const [openGraphTrigger, setOpenGraphTrigger] = useState(0)
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
  const scheduleRenderRef = useRef<() => void>(() => { })
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
  const activeLassoPointsRef = useRef<InkPoint[] | null>(null)

  // Element Selection & Drag Refs
  const shapeDragRef = useRef<ShapeDragState | null>(null)

  // Offline 350ms Hold-to-Snap Web Worker hook (Shapes Mode)
  const holdSnap = useHoldToSnap(
    () => boardRef.current.shapeNodes,
    () => scheduleRenderRef.current()
  )

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

  const handleUpdateChatThreadColor = useCallback(
    (threadId: string, color: string | undefined) => {
      updateAndPersistChatStore(activeProjectId, (prev) => ({
        ...prev,
        threads: prev.threads.map((t) => (t.id === threadId ? { ...t, color } : t))
      }))
    },
    [activeProjectId, updateAndPersistChatStore]
  )

  const handleUpdateSectionColor = useCallback(
    async (sectionId: string, color: string | undefined) => {
      const updated = await editSection(sectionId, { color: color ?? '' })
      const cleanColor = color || undefined
      setProjectSections((prev) =>
        prev.map((s) => (s.id === sectionId ? { ...(updated ?? s), color: cleanColor } : s))
      )
      setActiveSection((prev) =>
        prev && prev.id === sectionId ? { ...(updated ?? prev), color: cleanColor } : prev
      )
    },
    []
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

  // Live Antigravity Companion & MCP Bridge: apply board mutations pushed externally
  useEffect(() => {
    const off = window.glassAPI?.onCompanionMutations?.((payload) => {
      if (!payload?.mutations || payload.mutations.length === 0) return
      pushHistory()
      const curView = viewRef.current
      const viewportCenter = {
        x: Math.round((window.innerWidth / 2 - curView.panX) / curView.zoom),
        y: Math.round((window.innerHeight / 2 - curView.panY) / curView.zoom)
      }
      const curSettings = settingsRef.current
      const palette = resolveBoardPalette(curSettings.backgroundColor)
      const tokens = resolveThemeTokens(curSettings.backgroundColor, curSettings.theme, palette)
      let applied = 0
      let nextPanOut: { panX: number; panY: number } | undefined
      let createdIdsOut: string[] = []
      let deletedIdsOut: string[] = []
      update((latestBoard) => {
        const outcome = applyAgentMutationsToBoard(latestBoard, payload.mutations, {
          viewportCenter,
          view: viewRef.current,
          screenSafe: getSafeViewportScreenRect(),
          fontFamily: curSettings.font,
          defaultInkColor: tokens.accent
        })
        applied = outcome.appliedCount
        createdIdsOut = outcome.createdIds
        deletedIdsOut = outcome.deletedIds
        if (outcome.nextPan) nextPanOut = outcome.nextPan
        return outcome.nextBoard
      })
      if (deletedIdsOut.length > 0) {
        if (createdIdsOut.length > 0) {
          setSelectedIds(createdIdsOut)
        } else {
          const delSet = new Set(deletedIdsOut)
          setSelectedIds((prev) => prev.filter((id) => !delSet.has(id)))
        }
      }
      if (nextPanOut) {
        const np = nextPanOut
        setView((v) => ({ ...v, panX: np.panX, panY: np.panY }))
      }
      setCanUndoLastAgent(applied > 0)
      scheduleRenderRef.current()
      addToast('success', `Antigravity Companion applied ${applied} item(s) to board`)
    })
    return () => off?.()
  }, [pushHistory, update, addToast])

  // Sync live board snapshot to Antigravity Companion HTTP/MCP server
  useEffect(() => {
    const syncFn = window.glassAPI?.syncCompanionSnapshot
    if (!syncFn) return
    const timer = window.setTimeout(() => {
      const curBoard = boardRef.current
      const curSelected = selectedIdsRef.current
      const selBounds = curSelected.length > 0 ? getSelectionBounds(curBoard, curSelected) : null
      const curView = viewRef.current
      const viewportCenter = {
        x: Math.round((window.innerWidth / 2 - curView.panX) / curView.zoom),
        y: Math.round((window.innerHeight / 2 - curView.panY) / curView.zoom)
      }
      const occ = collectOccupiedBoardRects(curBoard)
      const emptyRect = findEmptyBoardRect(occ, 760, 480, curView, getSafeViewportScreenRect(), {
        gap: 40
      })
      const snap = buildAgentBoardSnapshot({
        board: curBoard,
        boardId: activeSection?.id || 'default-board',
        projectId: activeProjectId ?? undefined,
        selectedIds: curSelected,
        selectionBounds: selBounds
          ? {
            x: Math.round(selBounds.x),
            y: Math.round(selBounds.y),
            width: Math.round(selBounds.w),
            height: Math.round(selBounds.h)
          }
          : undefined,
        viewportCenter,
        suggestedEmptyArea: { x: emptyRect.x, y: emptyRect.y, width: 760, height: 480 }
      })
      syncFn(snap)
    }, 350)
    return () => window.clearTimeout(timer)
  }, [board, selectedIds, activeSection?.id, activeProjectId])

  const buildCurrentSelectionCapturePayload = useCallback((): CompanionSelectionCapturePayload => {
    const curBoard = boardRef.current
    const curSelected = selectedIdsRef.current
    const sec = activeSectionRef.current
    const boardId = sec?.id || 'default-board'
    const projectId = sec?.projectId || undefined

    if (curSelected.length === 0) {
      return {
        ok: false,
        boardId,
        projectId,
        selectedIds: [],
        error: 'No elements are currently selected on the Vexelboard canvas.'
      }
    }

    const selBounds = getSelectionBounds(curBoard, curSelected)
    const selectionBounds = selBounds
      ? {
        x: Math.round(selBounds.x),
        y: Math.round(selBounds.y),
        width: Math.max(40, Math.round(selBounds.w)),
        height: Math.max(40, Math.round(selBounds.h))
      }
      : undefined

    const curSettings = settingsRef.current
    const palette = resolveBoardPalette(curSettings.backgroundColor)
    const activeThemeTokens = resolveThemeTokens(
      curSettings.backgroundColor,
      curSettings.theme,
      palette
    )

    const crop = rasterizeSelectionColorPreserving(
      curBoard,
      curSelected,
      activeThemeTokens.ink,
      activeThemeTokens.accent
    )

    let base64Png = crop?.base64Png
    let width = crop?.width
    let height = crop?.height

    if (!base64Png) {
      const fallbackImg = renderSelectedDiagramToImage(curBoard, curSelected, activeThemeTokens)
      base64Png = fallbackImg?.base64
    }

    const idSet = new Set(curSelected)
    const strokeCount = curBoard.strokes.filter((s) => idSet.has(s.id)).length
    const shapeCount = curBoard.shapeNodes.filter((s) => idSet.has(s.id)).length
    const textCount = curBoard.textNodes.filter((t) => idSet.has(t.id)).length
    const summaryParts: string[] = []
    if (strokeCount > 0) summaryParts.push(`${strokeCount} stroke(s)`)
    if (shapeCount > 0) summaryParts.push(`${shapeCount} shape(s)`)
    if (textCount > 0) summaryParts.push(`${textCount} text item(s)`)
    if (crop?.textHints) summaryParts.push(`labels: ${crop.textHints}`)

    return {
      ok: Boolean(base64Png),
      boardId,
      projectId,
      selectedIds: [...curSelected],
      selectionBounds,
      base64Png,
      width,
      height,
      elementSummary: summaryParts.join(', ') || `${curSelected.length} selected element(s)`,
      error: base64Png ? undefined : 'Selected elements could not be rasterized to PNG.'
    }
  }, [])

  // Answer live selection-image pulls from Antigravity / Companion Bridge
  useEffect(() => {
    const off = window.glassAPI?.onRequestSelectionCapture?.((requestId) => {
      const payload = buildCurrentSelectionCapturePayload()
      window.glassAPI?.respondSelectionCapture?.(requestId, payload)
    })
    return () => off?.()
  }, [buildCurrentSelectionCapturePayload])

  const handleSendSelectionToAntigravity = useCallback(async () => {
    const payload = buildCurrentSelectionCapturePayload()
    if (!payload.ok) {
      addToast('info', payload.error || 'Select a sketch or diagram on the board first.')
      return
    }
    const res = await window.glassAPI?.pushSelectionCapture?.(payload)
    if (!res?.ok) {
      addToast('error', res?.error || 'Could not save selection capture for Antigravity.')
      return
    }
    const promptText = 'Vectorize my current Vexelboard selection'
    try {
      await navigator.clipboard.writeText(promptText)
      addToast(
        'success',
        'Selection captured for Antigravity! Prompt copied ("Vectorize my current Vexelboard selection").'
      )
    } catch {
      addToast(
        'success',
        `Selection captured for Antigravity${res.filePath ? ` (${res.filePath})` : ''}.`
      )
    }
  }, [buildCurrentSelectionCapturePayload, addToast])

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
          activeSkillIds: currentSettings.ai.activeSkillIds,
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
          webSearch: {
            ...DEFAULT_WEB_SEARCH_SETTINGS,
            ...(currentSettings.ai.webSearch ?? {}),
            providerMode:
              currentSettings.ai.webSearch?.providerMode ??
              (currentSettings.ai.webSearch?.searxngUrl &&
                currentSettings.ai.webSearch.searxngUrl !== 'http://localhost:8888'
                ? 'searxng'
                : 'builtin')
          },
          activeSkillIds: currentSettings.ai.activeSkillIds,
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
    (color: string, title?: string) => {
      const curBoard = boardRef.current
      const noteW = 230
      const noteH = 150
      const placement = findFreeBoardPlacement(curBoard, noteW, noteH, viewRef.current)
      const newNote: TextNode = {
        id: `text-${Date.now().toString(36)}`,
        x: Math.round(placement.x),
        y: Math.round(placement.y),
        w: noteW,
        ...(title?.trim() ? { title: title.trim() } : {}),
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

  const handleInsertGraph = useCallback(
    (spec: GraphPlotSpec, opts?: { x?: number; y?: number; w?: number; h?: number; linkedCodeNodeId?: string }) => {
      const curBoard = boardRef.current
      const cardW = opts?.w ?? 520
      const cardH = opts?.h ?? 370
      const placement =
        typeof opts?.x === 'number' && typeof opts?.y === 'number'
          ? { x: Math.round(opts.x), y: Math.round(opts.y), nextPan: undefined }
          : findFreeBoardPlacement(curBoard, cardW, cardH, viewRef.current, {
            gap: 32,
            topMargin: 44
          })
      const id = `graph-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
      const node: GraphNode = {
        id,
        x: placement.x,
        y: placement.y,
        w: cardW,
        h: cardH,
        title: spec.title.trim() || 'Graph',
        spec,
        linkedCodeNodeId: opts?.linkedCodeNodeId,
        createdAt: Date.now()
      }
      pushHistory()
      update((b) => ({
        ...b,
        graphNodes: [...(b.graphNodes ?? []), node]
      }))
      if (placement.nextPan) {
        setView((v) => ({
          ...v,
          panX: placement.nextPan!.panX,
          panY: placement.nextPan!.panY
        }))
      }
      setSelectedId(id)
      setSelectedIds([id])
      setActiveTool('select')
      addToast('success', `Added "${node.title}" onto board`)
      return id
    },
    [update, setSelectedId, setSelectedIds, pushHistory, addToast]
  )

  const handleInsertScene3D = useCallback(
    (spec: Scene3DSpec, opts?: { x?: number; y?: number; w?: number; h?: number; linkedCodeNodeId?: string }) => {
      const curBoard = boardRef.current
      const cardW = opts?.w ?? 480
      const cardH = opts?.h ?? 380
      const placement =
        typeof opts?.x === 'number' && typeof opts?.y === 'number'
          ? { x: Math.round(opts.x), y: Math.round(opts.y), nextPan: undefined }
          : findFreeBoardPlacement(curBoard, cardW, cardH, viewRef.current, {
            gap: 32,
            topMargin: 32
          })

      const id = `s3d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
      const node: Scene3DNode = {
        id,
        x: placement.x,
        y: placement.y,
        w: cardW,
        h: cardH,
        title: spec.title || '3D Object',
        spec: { ...spec, immersed: spec.immersed ?? true },
        immersed: spec.immersed ?? true,
        linkedCodeNodeId: opts?.linkedCodeNodeId,
        createdAt: Date.now()
      }
      pushHistory()
      update((b) => ({
        ...b,
        scene3dNodes: [...(b.scene3dNodes ?? []), node]
      }))
      if (placement.nextPan) {
        setView((v) => ({
          ...v,
          panX: placement.nextPan!.panX,
          panY: placement.nextPan!.panY
        }))
      }
      setSelectedId(id)
      setSelectedIds([id])
      setActiveTool('select')
      addToast('success', `Immersed 3D scene "${node.title}" onto canvas`)
      return id
    },
    [update, setSelectedId, setSelectedIds, pushHistory, addToast]
  )

  const resolveConnectorLayerId = useCallback((b: BoardState, fallbackLayerId?: string): string => {
    if (b.layers?.some((l) => l.id === 'layer-overlay-ink')) return 'layer-overlay-ink'
    return fallbackLayerId ?? resolveTargetInkLayerId(b) ?? 'layer-base-ink'
  }, [])

  const handleSpawnScene3DFromCode = useCallback(
    (spec: Scene3DSpec, sourceCardId?: string) => {
      const curBoard = boardRef.current
      const sourceCard = sourceCardId
        ? (curBoard.codeNodes ?? []).find((c) => c.id === sourceCardId)
        : undefined
      const connectedSceneId = sourceCardId
        ? curBoard.shapeNodes
          .flatMap((s) => {
            if (s.startBinding?.shapeId === sourceCardId && s.endBinding?.shapeId) {
              return [s.endBinding.shapeId]
            }
            if (s.endBinding?.shapeId === sourceCardId && s.startBinding?.shapeId) {
              return [s.startBinding.shapeId]
            }
            return []
          })
          .find((tid) => (curBoard.scene3dNodes ?? []).some((s3) => s3.id === tid))
        : undefined
      const existingLinkedId = connectedSceneId ?? sourceCard?.linkedScene3DId
      const existingScene = existingLinkedId
        ? (curBoard.scene3dNodes ?? []).find((s) => s.id === existingLinkedId)
        : undefined

      if (existingScene) {
        update(
          (b) => ({
            ...b,
            scene3dNodes: (b.scene3dNodes ?? []).map((s) =>
              s.id === existingScene.id
                ? {
                  ...s,
                  title: spec.title || s.title,
                  spec: { ...spec, camera: s.spec.camera ?? spec.camera, immersed: s.immersed ?? true }
                }
                : s
            )
          }),
          { history: false }
        )
        addToast('success', `Synced 3D simulation "${spec.title || existingScene.title}"`)
        return
      }

      const newId = handleInsertScene3D(spec, {
        x: sourceCard ? sourceCard.x + sourceCard.w + 72 : undefined,
        y: sourceCard ? sourceCard.y : undefined,
        linkedCodeNodeId: sourceCardId
      })
      if (sourceCardId && sourceCard && newId) {
        update(
          (b) => {
            const targetScene = (b.scene3dNodes ?? []).find((s) => s.id === newId)
            const conn = targetScene
              ? buildFlowConnectorNode({
                source: sourceCard,
                sourcePort: 'right',
                target: targetScene,
                targetPort: 'left',
                color: '#06b6d4',
                animated: true,
                fontFamily: settingsRef.current.font,
                layerId: resolveConnectorLayerId(b)
              })
              : null
            return {
              ...b,
              shapeNodes: conn ? [...b.shapeNodes, conn] : b.shapeNodes,
              codeNodes: (b.codeNodes ?? []).map((c) =>
                c.id === sourceCardId ? { ...c, linkedScene3DId: newId } : c
              )
            }
          },
          { history: false }
        )
        scheduleRenderRef.current()
      }
    },
    [update, handleInsertScene3D, resolveConnectorLayerId, addToast]
  )

  const handleSpawnGraphFromCode = useCallback(
    (spec: GraphPlotSpec, sourceCardId?: string) => {
      const curBoard = boardRef.current
      const sourceCard = sourceCardId
        ? (curBoard.codeNodes ?? []).find((c) => c.id === sourceCardId)
        : undefined
      const connectedGraphId = sourceCardId
        ? curBoard.shapeNodes
          .flatMap((s) => {
            if (s.startBinding?.shapeId === sourceCardId && s.endBinding?.shapeId) {
              return [s.endBinding.shapeId]
            }
            if (s.endBinding?.shapeId === sourceCardId && s.startBinding?.shapeId) {
              return [s.startBinding.shapeId]
            }
            return []
          })
          .find((tid) => (curBoard.graphNodes ?? []).some((g) => g.id === tid))
        : undefined
      const existingGraphId =
        connectedGraphId ?? sourceCard?.linkedGraphId ?? sourceCard?.linkedGraphGroupId
      const existingGraph = existingGraphId
        ? (curBoard.graphNodes ?? []).find((g) => g.id === existingGraphId)
        : undefined

      if (existingGraph) {
        pushHistory()
        update((b) => ({
          ...b,
          graphNodes: (b.graphNodes ?? []).map((g) =>
            g.id === existingGraph.id
              ? {
                ...g,
                title: spec.title || g.title,
                spec: mergeCodeVisualIntoGraphSpec(g.spec, spec, false)
              }
              : g
          )
        }))
        addToast('success', `Synced "${spec.title || existingGraph.title || 'Graph'}" from code`)
        return
      }

      const newGraphId = handleInsertGraph(spec, {
        x: sourceCard ? sourceCard.x + sourceCard.w + 72 : undefined,
        y: sourceCard ? sourceCard.y : undefined,
        linkedCodeNodeId: sourceCardId
      })
      if (sourceCardId && sourceCard && newGraphId) {
        update(
          (b) => {
            const targetGraph = (b.graphNodes ?? []).find((g) => g.id === newGraphId)
            const flowConn = targetGraph
              ? buildFlowConnectorNode({
                source: sourceCard,
                sourcePort: 'right',
                target: targetGraph,
                targetPort: 'left',
                color: '#06b6d4',
                animated: true,
                fontFamily: settingsRef.current.font,
                layerId: resolveConnectorLayerId(b)
              })
              : null
            return {
              ...b,
              shapeNodes: flowConn ? [...b.shapeNodes, flowConn] : b.shapeNodes,
              codeNodes: (b.codeNodes ?? []).map((c) =>
                c.id === sourceCardId ? { ...c, linkedGraphId: newGraphId } : c
              )
            }
          },
          { history: false }
        )
        scheduleRenderRef.current()
      }
    },
    [update, pushHistory, addToast, handleInsertGraph, resolveConnectorLayerId]
  )

  const handleExecuteConnectedCodeFlow = useCallback(
    async (entryCardId: string, entryTabId?: string) => {
      const api = window.glassAPI
      if (!api?.runCode) {
        addToast('error', 'Local code execution bridge is only available inside the Electron app.')
        return
      }

      const initialBoard = boardRef.current
      const codeById = new Map((initialBoard.codeNodes ?? []).map((c) => [c.id, c]))
      const entryCard = codeById.get(entryCardId)
      if (!entryCard) return

      // Collect directional CodeNode -> CodeNode edges from bound board flowchart connectors
      const codeIncoming = new Map<string, string[]>()
      const codeOutgoing = new Map<string, string[]>()
      for (const s of initialBoard.shapeNodes) {
        const srcId = s.startBinding?.shapeId
        const dstId = s.endBinding?.shapeId
        if (!srcId || !dstId || srcId === dstId) continue
        if (codeById.has(srcId) && codeById.has(dstId)) {
          const inList = codeIncoming.get(dstId) ?? []
          if (!inList.includes(srcId)) inList.push(srcId)
          codeIncoming.set(dstId, inList)
          const outList = codeOutgoing.get(srcId) ?? []
          if (!outList.includes(dstId)) outList.push(dstId)
          codeOutgoing.set(srcId, outList)
        }
      }

      // Include any un-run upstream ancestors so entryCard receives fresh stdin
      const orderedIds: string[] = []
      const scheduled = new Set<string>()
      const ancestorVisiting = new Set<string>()

      const visitAncestor = (id: string, isEntry: boolean): void => {
        if (scheduled.has(id) || ancestorVisiting.has(id)) return
        ancestorVisiting.add(id)
        for (const upId of codeIncoming.get(id) ?? []) {
          const upCard = codeById.get(upId)
          const upTab = upCard?.tabs.find((t) => t.id === upCard.activeTabId) ?? upCard?.tabs[0]
          if (upCard && !upTab?.output?.stdout) {
            visitAncestor(upId, false)
          }
        }
        ancestorVisiting.delete(id)
        if (isEntry || !scheduled.has(id)) {
          scheduled.add(id)
          orderedIds.push(id)
        }
      }
      visitAncestor(entryCardId, true)

      // Traverse reachable downstream CodeNodes in BFS topological order
      const queue = [entryCardId]
      while (queue.length > 0) {
        const cur = queue.shift()!
        for (const nxt of codeOutgoing.get(cur) ?? []) {
          if (!scheduled.has(nxt)) {
            scheduled.add(nxt)
            orderedIds.push(nxt)
            queue.push(nxt)
          }
        }
      }

      const stdoutByCardId = new Map<string, string>()

      for (const curId of orderedIds) {
        const curBoard = boardRef.current
        const card = (curBoard.codeNodes ?? []).find((c) => c.id === curId)
        if (!card) continue

        const targetTabId =
          curId === entryCardId && entryTabId ? entryTabId : card.activeTabId || card.tabs[0]?.id
        const tab = card.tabs.find((t) => t.id === targetTabId) ?? card.tabs[0]
        if (!tab) continue

        const incomingIds = codeIncoming.get(curId) ?? []
        const incomingPayloads: string[] = []
        for (const upId of incomingIds) {
          const fresh = stdoutByCardId.get(upId)
          if (fresh !== undefined) {
            incomingPayloads.push(fresh)
          } else {
            const upCard = (curBoard.codeNodes ?? []).find((c) => c.id === upId)
            const upTab = upCard?.tabs.find((t) => t.id === upCard.activeTabId) ?? upCard?.tabs[0]
            if (upTab?.output?.stdout) incomingPayloads.push(upTab.output.stdout)
          }
        }
        const effectiveStdin =
          incomingPayloads.length > 0 ? incomingPayloads.join('\n') : (tab.stdin ?? '')

        const res = await api.runCode({
          language: tab.language,
          code: wrapCodeForAutoOutput(tab.language, tab.code),
          stdin: effectiveStdin,
          timeoutMs: 12000,
          filename: tab.title
        })

        const parsed = res.stdout ? parseCodeOutputToVisuals(res.stdout, tab.title) : null
        const nextVisualMode =
          tab.visualMode ??
          (parsed?.detectedKind === 'scene3d'
            ? 'scene3d'
            : parsed?.detectedKind === 'plot2d'
              ? 'plot2d'
              : 'terminal')

        update(
          (b) => ({
            ...b,
            codeNodes: (b.codeNodes ?? []).map((c) =>
              c.id === curId
                ? {
                  ...c,
                  tabs: c.tabs.map((t) =>
                    t.id === tab.id
                      ? { ...t, output: { ...res, timestamp: Date.now() }, visualMode: nextVisualMode }
                      : t
                  )
                }
                : c
            )
          }),
          { history: false }
        )

        if (!res.ok) {
          addToast(
            'error',
            `Flow halted at "${card.title || tab.title}" (${res.error || `exit ${res.exitCode}`})`
          )
          break
        }

        stdoutByCardId.set(curId, res.stdout)

        if (res.stdout && parsed) {
          const latestBoard = boardRef.current
          // Bidirectional connector lookup for visual targets attached to curId
          const peerIds = new Set<string>()
          for (const s of latestBoard.shapeNodes) {
            if (s.startBinding?.shapeId === curId && s.endBinding?.shapeId) {
              peerIds.add(s.endBinding.shapeId)
            } else if (s.endBinding?.shapeId === curId && s.startBinding?.shapeId) {
              peerIds.add(s.startBinding.shapeId)
            }
          }

          // 1. Update connected Scene3DNode(s)
          const target3dIds = new Set<string>()
          if (card.linkedScene3DId) target3dIds.add(card.linkedScene3DId)
          for (const s3 of latestBoard.scene3dNodes ?? []) {
            if (peerIds.has(s3.id)) target3dIds.add(s3.id)
          }
          if (parsed.scene3d && target3dIds.size > 0) {
            const nextSpec = parsed.scene3d
            update(
              (b) => ({
                ...b,
                scene3dNodes: (b.scene3dNodes ?? []).map((s3) =>
                  target3dIds.has(s3.id)
                    ? {
                      ...s3,
                      title: nextSpec.title || s3.title,
                      spec: {
                        ...nextSpec,
                        camera: s3.spec.camera ?? nextSpec.camera,
                        immersed: s3.immersed ?? true
                      }
                    }
                    : s3
                )
              }),
              { history: false }
            )
          }

          // 2. Update connected unified GraphNode(s)
          const targetGraphIds = new Set<string>()
          if (card.linkedGraphId) targetGraphIds.add(card.linkedGraphId)
          if (card.linkedGraphGroupId) targetGraphIds.add(card.linkedGraphGroupId)
          for (const gr of latestBoard.graphNodes ?? []) {
            if (peerIds.has(gr.id) || gr.linkedCodeNodeId === curId) {
              targetGraphIds.add(gr.id)
            }
          }
          if (parsed.plot2d && targetGraphIds.size > 0) {
            const plotSpec = parsed.plot2d
            const hasExplicit = Boolean(parsed.hasExplicitChartType)
            update(
              (b) => ({
                ...b,
                graphNodes: (b.graphNodes ?? []).map((gr) =>
                  targetGraphIds.has(gr.id)
                    ? {
                      ...gr,
                      title: plotSpec.title || gr.title,
                      spec: mergeCodeVisualIntoGraphSpec(gr.spec, plotSpec, hasExplicit)
                    }
                    : gr
                )
              }),
              { history: false }
            )
          }
        }
      }
    },
    [update, addToast]
  )

  const handleCreateLinkedCode = useCallback(
    (opts: { kind: '2d' | '3d'; graphSpec?: GraphPlotSpec; scene3dSpec?: Scene3DSpec }) => {
      const now = Date.now()
      const cardW = 540
      const cardH = 400
      const curBoard = boardRef.current
      const placement = findFreeBoardPlacement(curBoard, cardW + 580, cardH, viewRef.current, { gap: 36 })

      if (opts.kind === '3d') {
        const presetId =
          opts.scene3dSpec?.preset === 'car' ? 'car_3d_kinematics' : 'projectile_3d_pipeline'
        const preset = CODE_PIPELINE_PRESETS.find((p) => p.id === presetId) ?? CODE_PIPELINE_PRESETS[0]
        const sceneSpec = opts.scene3dSpec ?? buildPresetScene3D('car')
        const sceneId = handleInsertScene3D(sceneSpec, {
          x: placement.x + cardW + 72,
          y: placement.y
        })
        const firstTab = preset.tabs[0]
        const lastTab = preset.tabs[preset.tabs.length - 1]
        const tabs: CodeTabItem[] = [
          {
            id: `tab-${now}-1`,
            title: firstTab.title,
            language: firstTab.language,
            code: firstTab.code,
            color: firstTab.color,
            stdin: firstTab.stdin ?? '',
            output: null
          }
        ]
        const hasSecondStage = preset.tabs.length > 1 && lastTab !== firstTab
        const newCode1: CodeNode = {
          id: `code-${now.toString(36)}-a`,
          x: placement.x,
          y: placement.y,
          w: cardW,
          h: cardH,
          title: hasSecondStage ? `${firstTab.title} (Stage 1)` : `${sceneSpec.title || '3D'} Code`,
          linkedScene3DId: hasSecondStage ? undefined : sceneId,
          tabs,
          activeTabId: tabs[0].id,
          createdAt: now
        }
        const createdNodes: CodeNode[] = [newCode1]
        if (hasSecondStage) {
          const tab2: CodeTabItem = {
            id: `tab-${now}-2`,
            title: lastTab.title,
            language: lastTab.language,
            code: lastTab.code,
            color: lastTab.color,
            visualMode: 'scene3d',
            output: null
          }
          createdNodes.push({
            id: `code-${now.toString(36)}-b`,
            x: placement.x,
            y: placement.y + cardH + 64,
            w: cardW,
            h: 360,
            title: `${sceneSpec.title || '3D'} Render (Stage 2)`,
            linkedScene3DId: sceneId,
            tabs: [tab2],
            activeTabId: tab2.id,
            createdAt: now + 1
          })
        }

        update((b) => {
          const targetScene = (b.scene3dNodes ?? []).find((s) => s.id === sceneId)
          const extraConns: ShapeNode[] = []
          const layerId = resolveConnectorLayerId(b)
          if (hasSecondStage && createdNodes.length === 2) {
            extraConns.push(
              buildFlowConnectorNode({
                source: createdNodes[0],
                sourcePort: 'bottom',
                target: createdNodes[1],
                targetPort: 'top',
                color: '#06b6d4',
                animated: true,
                fontFamily: settingsRef.current.font,
                layerId
              })
            )
            if (targetScene) {
              extraConns.push(
                buildFlowConnectorNode({
                  source: createdNodes[1],
                  sourcePort: 'right',
                  target: targetScene,
                  targetPort: 'left',
                  color: '#06b6d4',
                  animated: true,
                  fontFamily: settingsRef.current.font,
                  layerId
                })
              )
            }
          } else if (targetScene) {
            extraConns.push(
              buildFlowConnectorNode({
                source: createdNodes[0],
                sourcePort: 'right',
                target: targetScene,
                targetPort: 'left',
                color: '#06b6d4',
                animated: true,
                fontFamily: settingsRef.current.font,
                layerId
              })
            )
          }
          return {
            ...b,
            codeNodes: [...(b.codeNodes ?? []), ...createdNodes],
            shapeNodes: [...b.shapeNodes, ...extraConns]
          }
        })
        setSelectedId(newCode1.id)
        setSelectedIds([newCode1.id])
        scheduleRenderRef.current()
        addToast('success', 'Created Flowchart-Connected Code Cards → 3D Scene! Running...')
        setTimeout(() => void handleExecuteConnectedCodeFlow(newCode1.id, tabs[0].id), 60)
      } else {
        const gSpec: GraphPlotSpec = opts.graphSpec ?? {
          title: 'Code Plot',
          mode: 'data',
          chartType: 'line',
          xMin: -5,
          xMax: 5,
          yMin: -2,
          yMax: 25,
          xLabel: 'x',
          yLabel: 'y',
          axisStyle: 'frame',
          showGrid: true,
          showLegend: true,
          functions: [],
          dataKind: 'line',
          categoriesText: '',
          dataSeries: []
        }

        const ct = gSpec.chartType || (gSpec.mode === 'function' ? 'function' : gSpec.dataKind || 'line')
        let starterCode = CODE_PIPELINE_PRESETS[2].tabs[0].code
        if (ct === 'candlestick') {
          starterCode = `def stock_ohlc():
    return {
        "type": "candlestick",
        "title": "AAPL Weekly Price Action",
        "x": ["Mon", "Tue", "Wed", "Thu", "Fri"],
        "open": [212.4, 216.0, 214.2, 219.5, 224.0],
        "high": [217.8, 218.5, 220.4, 225.2, 228.6],
        "low": [211.0, 213.1, 213.8, 218.0, 222.5],
        "close": [216.0, 214.2, 219.5, 224.0, 227.9]
    }
`
        } else if (ct === 'histogram' || ct === 'bar' || ct === 'pie' || ct === 'violin' || ct === 'box') {
          starterCode = `def compute_distribution():
    # Return {"x": [...]} or {"x": labels, "y": values} to drive the connected Graph!
    x = [14, 18, 22, 25, 28, 31, 34, 36, 39, 43, 47, 52, 58, 64]
    return {
        "type": "${ct}",
        "title": "${gSpec.title || 'Code Distribution'}",
        "x": x
    }
`
        } else if (ct === 'surface3d' || ct === 'scatter3d' || ct === 'line3d' || ct === 'bar3d') {
          starterCode = CODE_PIPELINE_PRESETS[1].tabs[0].code
        } else if (ct === 'function') {
          starterCode = `import math

def compute_curve():
    # Return any equation {"expr": "x^2 - 3*x"} OR numeric {"x": ..., "y": ...} hashmap!
    x = [round(i * 0.25, 2) for i in range(-16, 17)]
    y = [round((v ** 2) * 0.35 - v, 3) for v in x]
    return {
        "title": "Custom Python Curve: 0.35x^2 - x",
        "x": x,
        "y": y,
        "xLabel": "x",
        "yLabel": "y"
    }
`
        }

        const initialGraphSpec: GraphPlotSpec =
          ct === 'function'
            ? {
              ...gSpec,
              title: 'Custom Python Curve: 0.35x^2 - x',
              mode: 'function',
              chartType: 'function',
              xMin: -4,
              xMax: 4,
              yMin: -2,
              yMax: 10,
              xLabel: 'x',
              yLabel: 'y',
              functions: [{ id: 'fn-1', label: '0.35*x^2 - x', expr: '0.35*x^2 - x', color: '#2563EB' }],
              dataSeries: []
            }
            : gSpec

        const graphId = `graph-${now.toString(36)}-lnk`
        const newGraph: GraphNode = {
          id: graphId,
          x: placement.x + cardW + 72,
          y: placement.y,
          w: 520,
          h: 370,
          title: initialGraphSpec.title || 'Graph',
          spec: initialGraphSpec,
          linkedCodeNodeId: `code-${now.toString(36)}`,
          createdAt: now
        }
        const tab: CodeTabItem = {
          id: `tab-${now}-1`,
          title: 'plot_data.py',
          language: 'python',
          code: starterCode,
          visualMode: ct === 'surface3d' || ct === 'scatter3d' || ct === 'line3d' || ct === 'bar3d' ? 'scene3d' : 'plot2d',
          output: null
        }
        const newCode: CodeNode = {
          id: `code-${now.toString(36)}`,
          x: placement.x,
          y: placement.y,
          w: cardW,
          h: cardH,
          title: `${initialGraphSpec.title || 'Graph'} Code`,
          linkedGraphId: graphId,
          tabs: [tab],
          activeTabId: tab.id,
          createdAt: now
        }

        pushHistory()
        update((b) => {
          const conn = buildFlowConnectorNode({
            source: newCode,
            sourcePort: 'right',
            target: newGraph,
            targetPort: 'left',
            color: '#06b6d4',
            animated: true,
            fontFamily: settingsRef.current.font,
            layerId: resolveConnectorLayerId(b)
          })
          return {
            ...b,
            graphNodes: [...(b.graphNodes ?? []), newGraph],
            codeNodes: [...(b.codeNodes ?? []), newCode],
            shapeNodes: [...b.shapeNodes, conn]
          }
        })
        setSelectedId(newCode.id)
        setSelectedIds([newCode.id])
        scheduleRenderRef.current()
        addToast('success', 'Created Connected Code Card → Graph! Running...')
        setTimeout(() => void handleExecuteConnectedCodeFlow(newCode.id, tab.id), 60)
      }
    },
    [update, pushHistory, handleInsertScene3D, resolveConnectorLayerId, addToast, handleExecuteConnectedCodeFlow]
  )

  const handleRotateSelected = useCallback(
    (deltaDeg: number, reset = false) => {
      const selIds = selectedIdsRef.current
      if (selIds.length === 0) return
      const curBoard = boardRef.current
      const curLayers = boardLayersRef.current

      if (selIds.length === 1) {
        const sid = selIds[0]
        const s = curBoard.shapeNodes.find((n) => n.id === sid && isItemEditable(n.layerId, curLayers))
        if (s) {
          pushHistory()
          if (reset) {
            update((b) => ({
              ...b,
              shapeNodes: b.shapeNodes.map((n) => (n.id === sid ? { ...n, rotation: 0 } : n))
            }))
          } else {
            const bRect = getShapeBoundingRect(s)
            const snap = captureRotationSnapshot(
              curBoard,
              [sid],
              bRect.x + bRect.w / 2,
              bRect.y + bRect.h / 2
            )
            update((b) => applyRotationDelta(b, snap, deltaDeg))
          }
          scheduleRenderRef.current()
          return
        }
      }

      const bounds = getSelectionBounds(curBoard, selIds)
      if (!bounds) return
      pushHistory()
      if (reset) {
        const idSet = new Set(selIds)
        update((b) => ({
          ...b,
          shapeNodes: b.shapeNodes.map((n) => (idSet.has(n.id) ? { ...n, rotation: 0 } : n)),
          textNodes: b.textNodes.map((n) => (idSet.has(n.id) ? { ...n, rotation: 0 } : n)),
          vectorArtNodes: (b.vectorArtNodes ?? []).map((n) =>
            idSet.has(n.id) ? { ...n, rotation: 0 } : n
          )
        }))
      } else {
        const cx = bounds.minX + bounds.w / 2
        const cy = bounds.minY + bounds.h / 2
        const snap = captureRotationSnapshot(curBoard, selIds, cx, cy)
        update((b) => applyRotationDelta(b, snap, deltaDeg))
      }
      scheduleRenderRef.current()
    },
    [pushHistory, update]
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

  /* ---------------- Insert Image / Clipboard Snippet / Board Snip ---------------- */
  const insertSavedImageNode = useCallback(
    (
      saved: { src: string; width?: number; height?: number; name?: string },
      atWorld?: { x: number; y: number }
    ) => {
      const natW = Math.max(64, saved.width || 480)
      const natH = Math.max(64, saved.height || 320)
      const maxEdge = 520
      const scale = Math.min(1, maxEdge / Math.max(natW, natH))
      const dispW = Math.max(120, Math.round(natW * scale))
      const dispH = Math.max(90, Math.round(natH * scale))

      const placement = atWorld
        ? { x: Math.round(atWorld.x), y: Math.round(atWorld.y) }
        : findFreeBoardPlacement(boardRef.current, dispW, dispH, viewRef.current, { gap: 24 })

      const imgNode: ImageNode = {
        id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        x: placement.x,
        y: placement.y,
        w: dispW,
        h: dispH,
        naturalW: natW,
        naturalH: natH,
        src: saved.src,
        caption: saved.name || 'Snippet',
        createdAt: Date.now()
      }

      pushHistory()
      update((b) => ({
        ...b,
        imageNodes: [...(b.imageNodes ?? []), imgNode]
      }))
      setSelectedId(imgNode.id)
      setSelectedIds([imgNode.id])
      setActiveTool('select')
      if ('nextPan' in placement && placement.nextPan) {
        setView((v) => ({
          ...v,
          panX: placement.nextPan!.panX,
          panY: placement.nextPan!.panY
        }))
      }
      addToast('success', `Inserted ${saved.name || 'image snippet'} on board`)
    },
    [pushHistory, update, setSelectedId, addToast]
  )

  const saveDataUrlAndInsert = useCallback(
    async (dataUrl: string, suggestedName?: string, atWorld?: { x: number; y: number }) => {
      const api = window.glassAPI
      if (api?.saveBoardImage) {
        const res = await api.saveBoardImage(dataUrl, suggestedName)
        if (res?.ok && res.src) {
          insertSavedImageNode(
            {
              src: res.src,
              width: res.width,
              height: res.height,
              name: res.name || suggestedName
            },
            atWorld
          )
          return
        }
      }
      // Browser fallback outside Electron
      const probe = new Image()
      probe.onload = () => {
        insertSavedImageNode(
          {
            src: dataUrl,
            width: probe.naturalWidth || 480,
            height: probe.naturalHeight || 320,
            name: suggestedName
          },
          atWorld
        )
      }
      probe.onerror = () => {
        insertSavedImageNode({ src: dataUrl, name: suggestedName }, atWorld)
      }
      probe.src = dataUrl
    },
    [insertSavedImageNode]
  )

  const handlePasteClipboardImage = useCallback(
    async (atWorld?: { x: number; y: number }) => {
      const api = window.glassAPI
      if (api?.readClipboardImage) {
        const res = await api.readClipboardImage()
        if (res?.ok && res.src) {
          insertSavedImageNode(
            {
              src: res.src,
              width: res.width,
              height: res.height,
              name: res.name || 'Clipboard Snippet'
            },
            atWorld
          )
          return
        }
      }
      // Browser Clipboard API fallback
      if (navigator.clipboard?.read) {
        try {
          const items = await navigator.clipboard.read()
          for (const item of items) {
            const imgType = item.types.find((t) => t.startsWith('image/'))
            if (imgType) {
              const blob = await item.getType(imgType)
              const reader = new FileReader()
              reader.onload = () => {
                if (typeof reader.result === 'string') {
                  void saveDataUrlAndInsert(reader.result, 'Clipboard Snippet', atWorld)
                }
              }
              reader.readAsDataURL(blob)
              return
            }
          }
        } catch {
          /* ignore */
        }
      }
      addToast('info', 'No screenshot or image found in clipboard — take a snip (Win+Shift+S) and press Ctrl+V!')
    },
    [insertSavedImageNode, saveDataUrlAndInsert, addToast]
  )

  const handleUploadImageFiles = useCallback(
    async (atWorld?: { x: number; y: number }) => {
      const api = window.glassAPI
      if (api?.pickBoardImages) {
        const res = await api.pickBoardImages()
        if (res?.canceled) return
        if (res?.ok && Array.isArray(res.images) && res.images.length > 0) {
          res.images.forEach((im, idx) => {
            if (im.ok && im.src) {
              insertSavedImageNode(
                {
                  src: im.src,
                  width: im.width,
                  height: im.height,
                  name: im.name
                },
                atWorld ? { x: atWorld.x + idx * 32, y: atWorld.y + idx * 32 } : undefined
              )
            }
          })
          return
        }
      }
      // Standard file input fallback
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/*'
      input.multiple = true
      input.onchange = () => {
        const files = Array.from(input.files || [])
        files.forEach((f, idx) => {
          const reader = new FileReader()
          reader.onload = () => {
            if (typeof reader.result === 'string') {
              void saveDataUrlAndInsert(
                reader.result,
                f.name,
                atWorld ? { x: atWorld.x + idx * 32, y: atWorld.y + idx * 32 } : undefined
              )
            }
          }
          reader.readAsDataURL(f)
        })
      }
      input.click()
    },
    [insertSavedImageNode, saveDataUrlAndInsert]
  )

  // Global Ctrl+V paste handler for screenshots / just-taken snippets
  useEffect(() => {
    const onPaste = (e: ClipboardEvent): void => {
      if (!activeSectionRef.current) return
      const activeEl = document.activeElement
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          (activeEl as HTMLElement).isContentEditable ||
          (activeEl as HTMLElement).closest?.('.cm-editor, .code-studio-panel, .canvas-code-card, .floating-ai-window'))
      ) {
        return
      }
      const items = Array.from(e.clipboardData?.items || [])
      const imageItem = items.find((it) => it.type.startsWith('image/'))
      if (imageItem) {
        e.preventDefault()
        const file = imageItem.getAsFile()
        if (file) {
          const reader = new FileReader()
          reader.onload = () => {
            if (typeof reader.result === 'string') {
              void saveDataUrlAndInsert(
                reader.result,
                'Pasted Snippet',
                mouseCanvasPosRef.current ?? undefined
              )
            }
          }
          reader.readAsDataURL(file)
          return
        }
      }
      const hasPlainText = items.some((it) => it.type === 'text/plain')
      if (!hasPlainText && window.glassAPI?.readClipboardImage) {
        void window.glassAPI.readClipboardImage().then((res) => {
          if (res?.ok && res.src) {
            insertSavedImageNode(
              {
                src: res.src,
                width: res.width,
                height: res.height,
                name: res.name || 'Pasted Snippet'
              },
              mouseCanvasPosRef.current ?? undefined
            )
          }
        })
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [insertSavedImageNode, saveDataUrlAndInsert])

  /* ---------------- Unified Smart Sketch-to-Vector & Beautify Router ---------------- */
  const runSmartVectorize = useCallback(
    async (mode: SmartBeautifyMode = 'auto') => {
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

      const activeFont: FontId =
        settingsRef.current.font && settingsRef.current.font in FONTS
          ? settingsRef.current.font
          : 'jakarta'

      const idSet = new Set(targetIds)
      const originalStrokes = curBoard.strokes.filter((s) => idSet.has(s.id))
      const originalShapes = curBoard.shapeNodes.filter((s) => idSet.has(s.id))
      const originalTexts = curBoard.textNodes.filter((t) => idSet.has(t.id))
      const api = window.glassAPI

      setIsVectorizing(true)
      setIsBeautifying(true)

      try {
        // =========================================================================
        // TIER 1: LOCAL SHAPES + CONFIGURABLE HANDWRITING OCR (API Default, Local TrOCR Fallback)
        // =========================================================================
        if (mode === 'auto' && originalStrokes.length > 0) {
          const localAnalysis = analyzeSelectionLocally(originalStrokes, originalShapes)

          const transcribeHandwritingStrokes = async (
            strokesToRead: Stroke[],
            isLabel: boolean
          ): Promise<{
            text: string
            bounds: { minX: number; minY: number; maxX: number; maxY: number }
            engineLabel: string
            error?: string
          } | null> => {
            const curSettings = settingsRef.current
            const ocrMode = curSettings.ai.handwritingOcrMode ?? 'api'
            const activeProvider = curSettings.ai.provider
            const activeModel =
              activeProvider === 'ollama'
                ? curSettings.ai.ollamaModel
                : curSettings.ai.byokModels[activeProvider] || DEFAULT_PROVIDER_MODELS[activeProvider]

            let apiError: string | undefined

            // Path A: Configured AI Vision API (Default)
            if (ocrMode === 'api' && isAiConfiguredRef.current && api?.runAI) {
              const block = rasterizeStrokesBlockForApiOcr(strokesToRead)
              if (block) {
                if (!isLabel) {
                  setAiBusy(true)
                  addToast(
                    'info',
                    `Recognizing handwriting via ${PROVIDER_LABELS[activeProvider]} (${activeModel})...`
                  )
                }
                try {
                  const aiRes = await api.runAI({
                    provider: activeProvider,
                    model: activeModel,
                    ollamaHost: curSettings.ai.ollamaHost,
                    temperature: 0.1,
                    imageBase64: block.base64,
                    isHandwritingOCR: true
                  })
                  if (aiRes?.ok && aiRes.recognizedText?.trim()) {
                    return {
                      text: aiRes.recognizedText.trim(),
                      bounds: block.bounds,
                      engineLabel: `${PROVIDER_LABELS[activeProvider]} · ${activeModel}`
                    }
                  }
                  apiError = aiRes?.error || 'Vision API returned empty handwriting text.'
                } catch (err) {
                  apiError = err instanceof Error ? err.message : String(err)
                } finally {
                  if (!isLabel) setAiBusy(false)
                }
                console.warn('[OCR] Vision API handwriting OCR fallback to Local TrOCR:', apiError)
              }
            }

            // Path B: Local CPU TrOCR (`Xenova/trocr-base-handwritten`)
            if (api?.runLocalOcr) {
              const ocrPayload = rasterizeStrokesForLocalOcr(strokesToRead)
              if (!ocrPayload) return null
              if (!isLabel) {
                addToast(
                  'info',
                  apiError
                    ? 'Vision API OCR unavailable; recognizing locally on CPU (TrOCR Base)...'
                    : 'Recognizing handwriting locally on CPU (TrOCR Base)...'
                )
              }
              const localOcrRes = await api.runLocalOcr({
                imagesBase64: ocrPayload.imagesBase64,
                lineIndices: ocrPayload.lineIndices
              })
              if (localOcrRes?.ok && localOcrRes.text.trim()) {
                return {
                  text: localOcrRes.text.trim(),
                  bounds: ocrPayload.overallBounds,
                  engineLabel: `Local CPU TrOCR (${localOcrRes.durationMs}ms)`
                }
              }
              return {
                text: '',
                bounds: ocrPayload.overallBounds,
                engineLabel: 'Local CPU TrOCR',
                error: localOcrRes?.error || apiError
              }
            }

            return apiError
              ? {
                text: '',
                bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
                engineLabel: PROVIDER_LABELS[activeProvider],
                error: apiError
              }
              : null
          }

          // 1A. Pure Handwriting -> Configured AI API (Default) with Local TrOCR Fallback
          if (
            localAnalysis.isPureHandwriting ||
            (localAnalysis.shapes.length === 0 && looksLikePureHandwriting(curBoard, targetIds))
          ) {
            const ocrRes = await transcribeHandwritingStrokes(originalStrokes, false)
            if (ocrRes && ocrRes.text.trim()) {
              const b = ocrRes.bounds
              const padBounds = {
                minX: b.minX - 36,
                minY: b.minY - 36,
                maxX: b.maxX + 36,
                maxY: b.maxY + 36,
                x: b.minX - 36,
                y: b.minY - 36,
                w: Math.max(80, b.maxX - b.minX + 72),
                h: Math.max(60, b.maxY - b.minY + 72)
              }
              const dominantColor = originalStrokes[0]?.color || 'ink'
              const textRes = buildImmersedTextFromOcr(
                ocrRes.text.trim(),
                padBounds,
                activeFont,
                dominantColor
              )
              update((bd) => ({
                ...bd,
                strokes: bd.strokes.filter((s) => !idSet.has(s.id)),
                shapeNodes: bd.shapeNodes.filter((s) => !idSet.has(s.id)),
                textNodes: [...bd.textNodes.filter((t) => !idSet.has(t.id)), ...textRes.texts],
                equationNodes: bd.equationNodes.filter((eq) => !idSet.has(eq.id))
              }))
              const newIds = textRes.texts.map((t) => t.id)
              setSelectedIds(newIds)
              setSelectedId(newIds[0] ?? null)
              setActiveTool('select')
              pushHistory()
              addToast('success', `Converted handwriting (${ocrRes.engineLabel})!`)
              return
            } else if (ocrRes?.error) {
              console.warn('[OCR] Pure handwriting fallback:', ocrRes.error)
              addToast('info', `Could not read handwriting (${ocrRes.error}); trying diagram fallback...`)
            }
          }

          // 1B. Pure Basic Shapes & Connectors (+ Optional Handwritten Labels Inside/Near Shapes)
          // When AI is configured, reserve fast-path 1B strictly for 1-2 trivial standalone shapes without arrows or outside labels
          // so full hand-drawn diagrams always go to Tier 2 Vision AI.
          const allowLocalShapesFastPath =
            !isAiConfiguredRef.current ||
            (localAnalysis.shapes.length <= 2 &&
              !localAnalysis.shapes.some(
                (s) =>
                  s.shape === 'arrow' ||
                  s.shape === 'arrow-bidirectional' ||
                  s.shape === 'curved-arrow' ||
                  s.shape === 'elbow'
              ) &&
              localAnalysis.labelClusters.every((c) => c.hostShapeIndex !== undefined))

          if (
            allowLocalShapesFastPath &&
            localAnalysis.isPureBasicShapesAndLabels &&
            localAnalysis.shapes.length > 0
          ) {
            const targetInkLayerId = resolveTargetInkLayerId(curBoard) ?? 'layer-base-ink'
            const groupId = `vloc-${Date.now().toString(36)}`
            const nextShapes = localAnalysis.shapes.map((s) => ({
              ...s,
              fontFamily: activeFont,
              layerId: targetInkLayerId,
              vectorGroupId: groupId
            }))
            const extraTexts: TextNode[] = [...originalTexts]
            let labelEngineNote: string | null = null

            // Transcribe any handwritten labels inside/near shapes (API default or Local TrOCR)
            if (localAnalysis.labelClusters.length > 0) {
              for (let cIdx = 0; cIdx < localAnalysis.labelClusters.length; cIdx++) {
                const cluster = localAnalysis.labelClusters[cIdx]
                const res = await transcribeHandwritingStrokes(cluster.strokes, true)
                if (res && res.text.trim()) {
                  labelEngineNote = res.engineLabel
                  if (
                    cluster.hostShapeIndex !== undefined &&
                    nextShapes[cluster.hostShapeIndex] &&
                    !nextShapes[cluster.hostShapeIndex].label
                  ) {
                    nextShapes[cluster.hostShapeIndex] = {
                      ...nextShapes[cluster.hostShapeIndex],
                      label: res.text.trim()
                    }
                  } else {
                    const cb = cluster.bounds
                    extraTexts.push({
                      id: `vloc-txt-${Date.now()}-${cIdx}`,
                      x: Math.round(cb.minX),
                      y: Math.round(cb.minY),
                      text: res.text.trim(),
                      fontSize: 20,
                      color: cluster.strokes[0]?.color || 'ink',
                      bg: 'transparent',
                      immersed: true,
                      fontFamily: activeFont,
                      vectorGroupId: groupId,
                      layerId: targetInkLayerId,
                      source: 'ocr',
                      createdAt: Date.now() + cIdx
                    })
                  }
                } else if (res?.error) {
                  console.warn('[OCR] Label OCR failed:', res.error)
                }
              }
            }

            // Check if connected shapes form a multi-node flow graph -> snap ports cleanly!
            const selBounds = getSelectionBounds(curBoard, targetIds)
            const diagramMeta: VectorDiagramMeta = {
              groupId,
              anchor: { x: Math.round(selBounds?.x ?? 0), y: Math.round(selBounds?.y ?? 0) },
              originalStrokes,
              originalShapes,
              originalTexts
            }

            update((bd) => ({
              ...bd,
              strokes: bd.strokes.filter((s) => !idSet.has(s.id)),
              shapeNodes: [...bd.shapeNodes.filter((s) => !idSet.has(s.id)), ...nextShapes],
              textNodes: [...bd.textNodes.filter((t) => !idSet.has(t.id)), ...extraTexts],
              equationNodes: bd.equationNodes.filter((eq) => !idSet.has(eq.id)),
              vectorDiagramMeta: {
                ...(bd.vectorDiagramMeta ?? {}),
                [groupId]: diagramMeta
              }
            }))

            const createdIds = [
              ...nextShapes.map((s) => s.id),
              ...extraTexts.map((t) => t.id)
            ]
            setSelectedIds(createdIds)
            setSelectedId(createdIds.length === 1 ? createdIds[0] : null)
            setActiveTool('select')
            pushHistory()
            scheduleRenderRef.current()
            addToast(
              'success',
              labelEngineNote
                ? `Vectorized ${nextShapes.length} shape${nextShapes.length > 1 ? 's' : ''} locally + labels (${labelEngineNote})!`
                : `Vectorized ${nextShapes.length} shape${nextShapes.length > 1 ? 's' : ''} locally (Zero LLM API)!`
            )
            return
          }
        }

        // =========================================================================
        // TIER 2: COMPLEX DIAGRAMS, SPATIAL SCENES & ORGANIC ILLUSTRATIONS
        // Uses Smart Beautify Router when AI is configured, or 100% offline VTracer when unconfigured!
        // =========================================================================
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

        const effectiveMode: SmartBeautifyMode =
          mode === 'trace_only' || !isAiConfiguredRef.current ? 'trace_only' : mode

        setAiBusy(effectiveMode !== 'trace_only')
        addToast(
          'info',
          effectiveMode === 'trace_only'
            ? 'Vectorizing sketch offline via VTracer + SVGO...'
            : `Smart routing complex sketch (${FONTS[activeFont].label})...`
        )

        const currentSettings = settingsRef.current
        const activeProvider = currentSettings.ai.provider
        const activeModel =
          activeProvider === 'ollama'
            ? currentSettings.ai.ollamaModel
            : currentSettings.ai.byokModels[activeProvider] || DEFAULT_PROVIDER_MODELS[activeProvider]

        if (api?.smartBeautify) {
          const smartRes = await api.smartBeautify({
            base64Png: raster.base64Png,
            ruledBase64Png: raster.ruledBase64Png,
            width: raster.width,
            height: raster.height,
            mode: effectiveMode,
            provider: activeProvider,
            model: activeModel,
            ollamaHost: currentSettings.ai.ollamaHost,
            temperature: currentSettings.ai.temperature,
            textHints: raster.textHints || undefined,
            paletteHints: raster.paletteHints,
            isMonochromeHint: raster.isMonochrome
          })

          if (smartRes && smartRes.ok) {
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
                  /* keep first compiled pass */
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
                `Vectorized spatial diagram (${compiled.shapes.length} primitives, ${compiled.texts.length} labels)!`
              )
              return
            }

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
              addToast('success', `Converted text into immersed ${FONTS[activeFont].label}!`)
              return
            }

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
                `Vectorized diagram (${smartRes.graph.nodes.length} nodes, ${smartRes.graph.edges.length} edges)!`
              )
              return
            }

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
                    effectiveMode === 'trace_only'
                      ? 'trace_only'
                      : effectiveMode === 'flat_vector' ||
                        effectiveMode === 'clean_line_art' ||
                        effectiveMode === 'editorial_poster'
                        ? effectiveMode
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
                `Vectorized artwork into ${artNode.layers.length} clean scalable layers! (Ctrl+Z to undo)`
              )
              return
            }
          }

          if (smartRes && !smartRes.ok) {
            addToast(
              'error',
              smartRes.error || 'Could not beautify diagram sketch. Check AI Settings and try again.'
            )
            return
          }
          if (isAiConfiguredRef.current) {
            addToast('error', 'Could not interpret diagram selection. Try again or switch vision models.')
            return
          }
        }

        // Deterministic local fallback (only when IPC API / AI is unavailable)
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
          addToast('success', 'Converted sketch locally into clean vector paths!')
        }
      } catch (err: unknown) {
        console.warn('[SmartVectorize] fallback:', err)
        if (isAiConfiguredRef.current && api?.smartBeautify) {
          const msg = err instanceof Error ? err.message : String(err)
          addToast('error', `Beautify failed: ${msg}`)
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
          addToast('info', 'Converted sketch locally into clean vectors.')
        }
      } finally {
        setIsVectorizing(false)
        setIsBeautifying(false)
        setAiBusy(false)
      }
    },
    [update, pushHistory, addToast, setSelectedId, themeTokens]
  )

  const handleVectorizeSelected = useCallback(() => {
    void runSmartVectorize('auto')
  }, [runSmartVectorize])

  const handleBeautifySelected = handleVectorizeSelected

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
      if (!meta) return
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
    for (const img of curBoard.imageNodes ?? []) {
      allX.push(img.x, img.x + (img.w ?? 360))
      allY.push(img.y, img.y + (img.h ?? 260))
    }
    for (const s3d of curBoard.scene3dNodes ?? []) {
      allX.push(s3d.x, s3d.x + (s3d.w ?? 480))
      allY.push(s3d.y, s3d.y + (s3d.h ?? 380))
    }
    for (const gr of curBoard.graphNodes ?? []) {
      allX.push(gr.x, gr.x + (gr.w ?? 520))
      allY.push(gr.y, gr.y + (gr.h ?? 390))
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
      images: (curBoard.imageNodes ?? [])
        .filter((im) => idSet.has(im.id))
        .map((im) => ({ id: im.id, initX: im.x, initY: im.y })),
      scene3ds: (curBoard.scene3dNodes ?? [])
        .filter((s3d) => idSet.has(s3d.id))
        .map((s3d) => ({ id: s3d.id, initX: s3d.x, initY: s3d.y })),
      graphs: (curBoard.graphNodes ?? [])
        .filter((gr) => idSet.has(gr.id))
        .map((gr) => ({ id: gr.id, initX: gr.x, initY: gr.y })),
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
      const { shapes, vectorArts, texts, equations, diagrams, codes, videos, images, scene3ds, graphs, strokes } = drag.snapshots

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
      const imageMap = new Map((images ?? []).map((im) => [im.id, { x: Math.round(im.initX + dx), y: Math.round(im.initY + dy) }]))
      const scene3dMap = new Map((scene3ds ?? []).map((s3d) => [s3d.id, { x: Math.round(s3d.initX + dx), y: Math.round(s3d.initY + dy) }]))
      const graphMap = new Map((graphs ?? []).map((gr) => [gr.id, { x: Math.round(gr.initX + dx), y: Math.round(gr.initY + dy) }]))
      const strokeMap = new Map(
        strokes.map((st) => [
          st.id,
          st.initPoints.map(([x, y, p]) => [Math.round(x + dx), Math.round(y + dy), p] as InkPoint)
        ])
      )

      update(
        (b) => {
          const movedShapes = b.shapeNodes.map((s) =>
            shapeMap.has(s.id) ? { ...s, ...shapeMap.get(s.id)! } : s
          )
          const movedCodes = (b.codeNodes ?? []).map((c) =>
            codeMap.has(c.id) ? { ...c, ...codeMap.get(c.id)! } : c
          )
          const movedScene3ds = (b.scene3dNodes ?? []).map((s3d) =>
            scene3dMap.has(s3d.id) ? { ...s3d, ...scene3dMap.get(s3d.id)! } : s3d
          )
          const movedGraphs = (b.graphNodes ?? []).map((gr) =>
            graphMap.has(gr.id) ? { ...gr, ...graphMap.get(gr.id)! } : gr
          )
          const hasRotatedGroup = b.shapeNodes.some(
            (s) => shapeMap.has(s.id) && Boolean(s.rotation && Math.abs(s.rotation) > 0.5)
          )
          return {
            ...b,
            shapeNodes: hasRotatedGroup
              ? movedShapes
              : syncBoundConnectors(movedShapes, [...movedCodes, ...movedScene3ds, ...movedGraphs]),
            vectorArtNodes: (b.vectorArtNodes ?? []).map((v) =>
              vectorArtMap.has(v.id) ? { ...v, ...vectorArtMap.get(v.id)! } : v
            ),
            textNodes: b.textNodes.map((t) => (textMap.has(t.id) ? { ...t, ...textMap.get(t.id)! } : t)),
            equationNodes: b.equationNodes.map((e) => (eqMap.has(e.id) ? { ...e, ...eqMap.get(e.id)! } : e)),
            diagramNodes: (b.diagramNodes ?? []).map((d) => (diagMap.has(d.id) ? { ...d, ...diagMap.get(d.id)! } : d)),
            codeNodes: movedCodes,
            videoNodes: (b.videoNodes ?? []).map((v) => (videoMap.has(v.id) ? { ...v, ...videoMap.get(v.id)! } : v)),
            imageNodes: (b.imageNodes ?? []).map((im) => (imageMap.has(im.id) ? { ...im, ...imageMap.get(im.id)! } : im)),
            scene3dNodes: movedScene3ds,
            graphNodes: movedGraphs,
            strokes: b.strokes.map((st) => (strokeMap.has(st.id) ? { ...st, points: strokeMap.get(st.id)! } : st))
          }
        },
        { history: false }
      )
    },
    [update]
  )

  const findConnectableOnBoard = useCallback(
    (
      b: BoardState,
      id: string
    ): { el: ConnectableBoardElement; kind: 'shape' | 'code' | 'scene3d' | 'graph'; label: string } | null => {
      const sh = b.shapeNodes.find((s) => s.id === id)
      if (sh) {
        return {
          el: sh,
          kind: 'shape',
          label: sh.label || (sh.vectorGroupId ? '2D Graph' : sh.shape)
        }
      }
      const cd = (b.codeNodes ?? []).find((c) => c.id === id)
      if (cd) {
        return { el: cd, kind: 'code', label: cd.title || 'Code Card' }
      }
      const s3 = (b.scene3dNodes ?? []).find((s) => s.id === id)
      if (s3) {
        return { el: s3, kind: 'scene3d', label: s3.title || '3D Scene' }
      }
      const gr = (b.graphNodes ?? []).find((g) => g.id === id)
      if (gr) {
        return { el: gr, kind: 'graph', label: gr.title || gr.spec?.title || 'Graph' }
      }
      return null
    },
    []
  )

  const getConnectableTargets = useCallback(
    (
      curBoard: BoardState,
      curLayers: typeof boardLayersRef.current,
      excludeId: string
    ): ConnectableBoardElement[] => {
      const targets: ConnectableBoardElement[] = []
      const cardsEditable =
        partitionedLayersRef.current.cardsLayer.visible &&
        !partitionedLayersRef.current.cardsLayer.locked
      if (cardsEditable) {
        for (const gr of [...(curBoard.graphNodes ?? [])].reverse()) {
          if (gr.id !== excludeId) targets.push(gr)
        }
        for (const s3 of [...(curBoard.scene3dNodes ?? [])].reverse()) {
          if (s3.id !== excludeId) targets.push(s3)
        }
        for (const cd of [...(curBoard.codeNodes ?? [])].reverse()) {
          if (cd.id !== excludeId) targets.push(cd)
        }
      }
      for (const sh of [...curBoard.shapeNodes].reverse()) {
        if (
          sh.id === excludeId ||
          isConnectorShape(sh) ||
          !isItemEditable(sh.layerId, curLayers)
        ) {
          continue
        }
        targets.push(sh)
      }
      return targets
    },
    []
  )

  const updateConnectDrag = useCallback(
    (canvasPt: { x: number; y: number }) => {
      const drag = shapeDragRef.current
      if (!drag || drag.kind !== 'connect' || !drag.sourceShapeId) return
      drag.currentX = canvasPt.x
      drag.currentY = canvasPt.y
      const curBoard = boardRef.current
      const curLayers = boardLayersRef.current
      const zoom = viewRef.current.zoom
      const portSnapTol = 28 / zoom
      let nextSnap: { shapeId: string; port: PortSide } | null = null
      let bestDist = Infinity

      for (const target of getConnectableTargets(curBoard, curLayers, drag.sourceShapeId)) {
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
        const b =
          'shape' in target
            ? getShapeBoundingRect(target as ShapeNode)
            : { x: target.x, y: target.y, w: target.w, h: target.h }
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
    },
    [getConnectableTargets]
  )

  const finishConnectDrag = useCallback(
    (finishedDrag: ShapeDragState) => {
      if (!finishedDrag.sourceShapeId || !finishedDrag.sourcePort) return
      const curBoard = boardRef.current
      const sourceInfo = findConnectableOnBoard(curBoard, finishedDrag.sourceShapeId)
      if (!sourceInfo) {
        scheduleRenderRef.current()
        return
      }
      const sourceEl = sourceInfo.el
      const endX = finishedDrag.currentX ?? finishedDrag.startPinchX
      const endY = finishedDrag.currentY ?? finishedDrag.startPinchY
      const dragDist = Math.hypot(
        endX - finishedDrag.startPinchX,
        endY - finishedDrag.startPinchY
      )

      if (finishedDrag.snapTarget) {
        const targetInfo = findConnectableOnBoard(curBoard, finishedDrag.snapTarget.shapeId)
        if (targetInfo) {
          const involvesCard = sourceInfo.kind !== 'shape' || targetInfo.kind !== 'shape'
          const conn = buildFlowConnectorNode({
            source: sourceEl,
            sourcePort: finishedDrag.sourcePort,
            target: targetInfo.el,
            targetPort: finishedDrag.snapTarget.port,
            color: involvesCard ? '#06b6d4' : 'ink',
            animated: involvesCard,
            fontFamily: settingsRef.current.font,
            layerId: involvesCard ? resolveConnectorLayerId(curBoard, sourceEl.layerId) : sourceEl.layerId
          })
          let autoRunCodeId: string | null = null
          if (sourceInfo.kind === 'code' && (targetInfo.kind === 'graph' || targetInfo.kind === 'scene3d')) {
            autoRunCodeId = sourceEl.id
          } else if (targetInfo.kind === 'code' && (sourceInfo.kind === 'graph' || sourceInfo.kind === 'scene3d')) {
            autoRunCodeId = targetInfo.el.id
          }
          update((b) => {
            let nextCodeNodes = b.codeNodes ?? []
            let nextGraphNodes = b.graphNodes ?? []
            if (sourceInfo.kind === 'code' && targetInfo.kind === 'graph') {
              nextCodeNodes = nextCodeNodes.map((c) =>
                c.id === sourceEl.id ? { ...c, linkedGraphId: targetInfo.el.id } : c
              )
              nextGraphNodes = nextGraphNodes.map((g) =>
                g.id === targetInfo.el.id ? { ...g, linkedCodeNodeId: sourceEl.id } : g
              )
            } else if (sourceInfo.kind === 'graph' && targetInfo.kind === 'code') {
              nextCodeNodes = nextCodeNodes.map((c) =>
                c.id === targetInfo.el.id ? { ...c, linkedGraphId: sourceEl.id } : c
              )
              nextGraphNodes = nextGraphNodes.map((g) =>
                g.id === sourceEl.id ? { ...g, linkedCodeNodeId: targetInfo.el.id } : g
              )
            } else if (sourceInfo.kind === 'code' && targetInfo.kind === 'scene3d') {
              nextCodeNodes = nextCodeNodes.map((c) =>
                c.id === sourceEl.id ? { ...c, linkedScene3DId: targetInfo.el.id } : c
              )
            } else if (sourceInfo.kind === 'scene3d' && targetInfo.kind === 'code') {
              nextCodeNodes = nextCodeNodes.map((c) =>
                c.id === targetInfo.el.id ? { ...c, linkedScene3DId: sourceEl.id } : c
              )
            }
            return {
              ...b,
              codeNodes: nextCodeNodes,
              graphNodes: nextGraphNodes,
              shapeNodes: [...b.shapeNodes, conn]
            }
          })
          setSelectedIds([conn.id])
          scheduleRenderRef.current()
          addToast('success', `Connected "${sourceInfo.label}" → "${targetInfo.label}"`)
          if (autoRunCodeId) {
            const runId = autoRunCodeId
            setTimeout(() => void handleExecuteConnectedCodeFlow(runId), 60)
          }
          return
        }
      }

      if (dragDist >= 24) {
        const isCard = sourceInfo.kind !== 'shape'
        const conn = buildFlowConnectorNode({
          source: sourceEl,
          sourcePort: finishedDrag.sourcePort,
          freeEnd: { x: Math.round(endX), y: Math.round(endY) },
          color: isCard ? '#06b6d4' : 'ink',
          animated: isCard,
          fontFamily: settingsRef.current.font,
          layerId: isCard ? resolveConnectorLayerId(curBoard, sourceEl.layerId) : sourceEl.layerId
        })
        update((b) => ({ ...b, shapeNodes: [...b.shapeNodes, conn] }))
        setSelectedIds([conn.id])
        scheduleRenderRef.current()
        addToast('success', 'Added flow connector')
        return
      }

      const [nx, ny] = portNormal(finishedDrag.sourcePort)
      const targetPort = getOppositePort(finishedDrag.sourcePort)

      if (sourceInfo.kind === 'code') {
        const nextW = Math.max(420, Math.round(sourceEl.w))
        const nextH = Math.max(340, Math.round(sourceEl.h))
        const stageGap = 90
        let nextX = sourceEl.x
        let nextY = sourceEl.y
        if (nx > 0) nextX = sourceEl.x + sourceEl.w + stageGap
        else if (nx < 0) nextX = sourceEl.x - stageGap - nextW
        if (ny > 0) nextY = sourceEl.y + sourceEl.h + stageGap
        else if (ny < 0) nextY = sourceEl.y - stageGap - nextH

        // Detect downstream Graph / 3D Scene already attached on this side so we insert cleanly before it
        const downstreamConn = curBoard.shapeNodes.find(
          (s) =>
            isConnectorShape(s) &&
            s.startBinding?.shapeId === sourceEl.id &&
            Boolean(s.endBinding?.shapeId) &&
            ((curBoard.graphNodes ?? []).some((g) => g.id === s.endBinding?.shapeId) ||
              (curBoard.scene3dNodes ?? []).some((s3) => s3.id === s.endBinding?.shapeId))
        )
        const downstreamTargetId =
          downstreamConn?.endBinding?.shapeId ??
          (sourceEl as CodeNode).linkedGraphId ??
          (sourceEl as CodeNode).linkedScene3DId
        const downstreamGraph = (curBoard.graphNodes ?? []).find((g) => g.id === downstreamTargetId)
        const downstreamScene = (curBoard.scene3dNodes ?? []).find((s3) => s3.id === downstreamTargetId)
        const downstreamVisual = downstreamGraph ?? downstreamScene
        const insertingBeforeVisual = Boolean(downstreamVisual && nx >= 0)

        if (!insertingBeforeVisual) {
          const occ = collectOccupiedBoardRects(curBoard)
          const candOverlap = occ.some(
            (r) =>
              nextX < r.x + r.w + 24 &&
              nextX + nextW + 24 > r.x &&
              nextY < r.y + r.h + 24 &&
              nextY + nextH + 24 > r.y
          )
          if (candOverlap) {
            const freeSlot = findEmptyBoardRect(
              occ,
              nextW,
              nextH,
              viewRef.current,
              getSafeViewportScreenRect(),
              { gap: 28 }
            )
            nextX = freeSlot.x
            nextY = freeSlot.y
          }
        }

        const now = Date.now()
        const newTab: CodeTabItem = {
          id: `tab-${now.toString(36)}-nxt`,
          title: 'transform.py',
          language: 'python',
          code: `# 'data' automatically receives the dict returned by "${sourceInfo.label}"!\ndef transform(data):\n    x = data.get("x", [1, 2, 3, 4, 5])\n    y = data.get("y") or data.get("raw_y") or [10, 20, 15, 30, 25]\n\n    # Process your data cleanly (no sys.stdin/json boilerplate needed)\n    processed_y = [round(v * 1.5, 2) for v in y]\n\n    return {\n        "title": "Processed Output",\n        "x": x,\n        "y": processed_y\n    }\n`,
          stdin: '',
          output: null
        }
        const spawnedCode: CodeNode = {
          id: `code-${now.toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
          x: Math.round(nextX),
          y: Math.round(nextY),
          w: nextW,
          h: nextH,
          title: `Next: ${sourceInfo.label}`,
          ...(downstreamGraph ? { linkedGraphId: downstreamGraph.id } : {}),
          ...(downstreamScene ? { linkedScene3DId: downstreamScene.id } : {}),
          tabs: [newTab],
          activeTabId: newTab.id,
          createdAt: now
        }
        const layerId = resolveConnectorLayerId(curBoard, sourceEl.layerId)
        const conn1 = buildFlowConnectorNode({
          source: sourceEl,
          sourcePort: finishedDrag.sourcePort,
          target: spawnedCode,
          targetPort,
          color: '#06b6d4',
          animated: true,
          fontFamily: settingsRef.current.font,
          layerId
        })

        update((b) => {
          const shiftRight = nextW + stageGap
          const nextGraphs = (b.graphNodes ?? []).map((g) => {
            if (downstreamGraph && g.id === downstreamGraph.id && insertingBeforeVisual) {
              return {
                ...g,
                x: Math.max(g.x, spawnedCode.x + shiftRight),
                linkedCodeNodeId: spawnedCode.id
              }
            }
            return g
          })
          const nextScenes = (b.scene3dNodes ?? []).map((s3) => {
            if (downstreamScene && s3.id === downstreamScene.id && insertingBeforeVisual) {
              return {
                ...s3,
                x: Math.max(s3.x, spawnedCode.x + shiftRight)
              }
            }
            return s3
          })
          const nextCodes = (b.codeNodes ?? []).map((c) =>
            c.id === sourceEl.id && insertingBeforeVisual
              ? { ...c, linkedGraphId: undefined, linkedScene3DId: undefined }
              : c
          )
          const shiftedVisualTarget = insertingBeforeVisual
            ? (nextGraphs.find((g) => g.id === downstreamGraph?.id) ??
              nextScenes.find((s3) => s3.id === downstreamScene?.id))
            : undefined
          const extraConn = shiftedVisualTarget
            ? buildFlowConnectorNode({
              source: spawnedCode,
              sourcePort: 'right',
              target: shiftedVisualTarget,
              targetPort: 'left',
              color: '#06b6d4',
              animated: true,
              fontFamily: settingsRef.current.font,
              layerId
            })
            : null
          const filteredShapes =
            insertingBeforeVisual && downstreamConn
              ? b.shapeNodes.filter((s) => s.id !== downstreamConn.id)
              : b.shapeNodes
          const finalShapes = syncBoundConnectors(
            [...filteredShapes, conn1, ...(extraConn ? [extraConn] : [])],
            [...nextCodes, spawnedCode, ...nextScenes, ...nextGraphs]
          )
          return {
            ...b,
            codeNodes: [...nextCodes, spawnedCode],
            graphNodes: nextGraphs,
            scene3dNodes: nextScenes,
            shapeNodes: finalShapes
          }
        })
        setSelectedId(spawnedCode.id)
        setSelectedIds([spawnedCode.id])
        scheduleRenderRef.current()
        addToast(
          'success',
          insertingBeforeVisual
            ? 'Inserted pipeline stage before Graph! Running flow...'
            : 'Spawned connected Coding Tab'
        )
        if (insertingBeforeVisual) {
          setTimeout(() => void handleExecuteConnectedCodeFlow(sourceEl.id), 60)
        }
        return
      }

      if (sourceInfo.kind === 'shape') {
        const sourceShape = sourceEl as ShapeNode
        const srcBounds = getShapeBoundingRect(sourceShape)
        const nextW = Math.max(64, Math.round(srcBounds.w))
        const nextH = Math.max(40, Math.round(srcBounds.h))
        let nextX = srcBounds.x
        let nextY = srcBounds.y
        if (nx > 0) nextX = srcBounds.x + srcBounds.w + 140
        else if (nx < 0) nextX = srcBounds.x - 140 - nextW
        if (ny > 0) nextY = srcBounds.y + srcBounds.h + 140
        else if (ny < 0) nextY = srcBounds.y - 140 - nextH

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
    },
    [findConnectableOnBoard, resolveConnectorLayerId, update, setSelectedId, setSelectedIds, addToast, handleExecuteConnectedCodeFlow]
  )

  const handleStartCardConnect = useCallback(
    (sourceId: string, port: PortSide, _clientX: number, _clientY: number) => {
      const curBoard = boardRef.current
      const info = findConnectableOnBoard(curBoard, sourceId)
      if (!info) return
      const portPt = getShapePorts(info.el)[port]
      setActiveTool('select')
      shapeDragRef.current = {
        kind: 'connect',
        sourceShapeId: sourceId,
        sourcePort: port,
        startPinchX: portPt.x,
        startPinchY: portPt.y,
        currentX: portPt.x,
        currentY: portPt.y,
        snapTarget: null
      }
      scheduleRenderRef.current()

      const onWinMove = (ev: PointerEvent): void => {
        const canvasEl = committedCanvasRef.current
        if (!canvasEl) return
        const rect = canvasEl.getBoundingClientRect()
        const pt = screenToCanvas(ev.clientX - rect.left, ev.clientY - rect.top, viewRef.current)
        updateConnectDrag(pt)
      }
      const onWinUp = (): void => {
        window.removeEventListener('pointermove', onWinMove)
        window.removeEventListener('pointerup', onWinUp)
        window.removeEventListener('pointercancel', onWinUp)
        const drag = shapeDragRef.current
        shapeDragRef.current = null
        if (drag?.kind === 'connect') {
          finishConnectDrag(drag)
        } else {
          scheduleRenderRef.current()
        }
      }
      window.addEventListener('pointermove', onWinMove)
      window.addEventListener('pointerup', onWinUp)
      window.addEventListener('pointercancel', onWinUp)
    },
    [findConnectableOnBoard, updateConnectDrag, finishConnectDrag]
  )

  const getCanvasCursorClass = (): string => {
    if (isPanningDragRef.current || panStartRef.current) return 'grabbing'
    if (isSpacePanning || activeTool === 'pan') return 'grab'
    if (activeTool === 'eraser' && eraserMode === 'paper') return 'none'
    return 'custom'
  }

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
    return getToolCursorCss(activeTool, {
      penType: settings.penType ?? 'fountain',
      penColorHex: resolvePenColorHex(penColor, themeTokens.ink, themeTokens.accent),
      eraserMode
    })
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

    if (activeTool === 'lasso') {
      activeLassoPointsRef.current = [[canvasPt.x, canvasPt.y, e.pressure || 0.5]]
      scheduleRenderRef.current()
      return
    }

    if (activeTool === 'snip') {
      selectionBoxRef.current = {
        startX: canvasPt.x,
        startY: canvasPt.y,
        currentX: canvasPt.x,
        currentY: canvasPt.y
      }
      scheduleRenderRef.current()
      return
    }

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
      setSelectedId(newNode.id)
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
      setSelectedId(newEq.id)
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

      // 1. Check if clicked near a rotate or resize handle of an already selected single shape or VectorArt
      const zoom = viewRef.current.zoom
      const hitTol = 14 / zoom
      if (currentSelected.length === 1) {
        for (const s of curBoard.shapeNodes) {
          if (!currentSelected.includes(s.id) || !isItemEditable(s.layerId, curLayers)) continue
          const b = getShapeBoundingRect(s)
          const rotRad = !isEndpointLinearShape(s.shape) && s.rotation ? (s.rotation * Math.PI) / 180 : 0
          const cx = s.x + s.w / 2
          const cy = s.y + s.h / 2
          const localPt = rotRad
            ? (() => {
              const [lx, ly] = rotatePointAround(canvasPt.x, canvasPt.y, cx, cy, -rotRad)
              return { x: lx, y: ly }
            })()
            : canvasPt
          const localBounds = rotRad
            ? { x: s.x, y: s.y, w: s.w, h: s.h, minX: s.x, minY: s.y, maxX: s.x + s.w, maxY: s.y + s.h }
            : b
          const rotHandleLocal = {
            x: localBounds.x + Math.max(12, localBounds.w) / 2,
            y: localBounds.y - 26 / zoom
          }
          if (Math.hypot(localPt.x - rotHandleLocal.x, localPt.y - rotHandleLocal.y) <= hitTol) {
            pushHistory()
            const pivotX = rotRad ? cx : b.x + b.w / 2
            const pivotY = rotRad ? cy : b.y + b.h / 2
            shapeDragRef.current = {
              kind: 'rotate',
              targetId: s.id,
              rotationSnapshot: captureRotationSnapshot(curBoard, [s.id], pivotX, pivotY),
              startAngleRad: Math.atan2(canvasPt.y - pivotY, canvasPt.x - pivotX),
              liveAngleDeg: s.rotation ?? 0,
              startPinchX: canvasPt.x,
              startPinchY: canvasPt.y
            }
            return
          }

          const corners = getShapeResizeHandles(localBounds, 4)
          for (const c of corners) {
            if (Math.hypot(localPt.x - c.x, localPt.y - c.y) <= hitTol) {
              pushHistory()
              shapeDragRef.current = {
                targetId: s.id,
                kind: 'shape-resize',
                handle: c.handle,
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
                  : undefined,
                startPinchX: canvasPt.x,
                startPinchY: canvasPt.y
              }
              return
            }
          }
        }

        // 1b. Check rotate & corner resize handles of a single selected VectorArtNode
        for (const v of curBoard.vectorArtNodes ?? []) {
          if (!currentSelected.includes(v.id) || !isItemEditable(v.layerId, curLayers)) continue
          const cx = v.x + v.width / 2
          const cy = v.y + v.height / 2
          const rotRad = v.rotation ? (v.rotation * Math.PI) / 180 : 0
          const localPt = rotRad
            ? (() => {
              const [lx, ly] = rotatePointAround(canvasPt.x, canvasPt.y, cx, cy, -rotRad)
              return { x: lx, y: ly }
            })()
            : canvasPt
          if (Math.hypot(localPt.x - cx, localPt.y - (v.y - 26 / zoom)) <= hitTol) {
            pushHistory()
            shapeDragRef.current = {
              kind: 'rotate',
              targetId: v.id,
              rotationSnapshot: captureRotationSnapshot(curBoard, [v.id], cx, cy),
              startAngleRad: Math.atan2(canvasPt.y - cy, canvasPt.x - cx),
              liveAngleDeg: v.rotation ?? 0,
              startPinchX: canvasPt.x,
              startPinchY: canvasPt.y
            }
            return
          }
          const pad = 4
          const corners: Array<{ handle: 'nw' | 'ne' | 'se' | 'sw'; x: number; y: number }> = [
            { handle: 'nw', x: v.x - pad, y: v.y - pad },
            { handle: 'ne', x: v.x + v.width + pad, y: v.y - pad },
            { handle: 'se', x: v.x + v.width + pad, y: v.y + v.height + pad },
            { handle: 'sw', x: v.x - pad, y: v.y + v.height + pad }
          ]
          for (const c of corners) {
            if (Math.hypot(localPt.x - c.x, localPt.y - c.y) <= hitTol) {
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
      } else if (currentSelected.length > 1) {
        // 1c. Check multi-element selection group rotate handle & 4 corner resize handles
        const bounds = getSelectionBounds(curBoard, currentSelected)
        if (bounds) {
          const pad = 12 / zoom
          const gx = bounds.minX - pad
          const gy = bounds.minY - pad
          const gw = bounds.w + pad * 2
          const gh = bounds.h + pad * 2
          const pivotX = bounds.minX + bounds.w / 2
          const pivotY = bounds.minY + bounds.h / 2

          if (Math.hypot(canvasPt.x - (gx + gw / 2), canvasPt.y - (gy - 26 / zoom)) <= hitTol) {
            pushHistory()
            shapeDragRef.current = {
              kind: 'rotate',
              rotationSnapshot: captureRotationSnapshot(curBoard, currentSelected, pivotX, pivotY),
              startAngleRad: Math.atan2(canvasPt.y - pivotY, canvasPt.x - pivotX),
              liveAngleDeg: 0,
              startPinchX: canvasPt.x,
              startPinchY: canvasPt.y
            }
            return
          }

          const gCorners: Array<{ handle: 'nw' | 'ne' | 'se' | 'sw'; x: number; y: number }> = [
            { handle: 'nw', x: gx, y: gy },
            { handle: 'ne', x: gx + gw, y: gy },
            { handle: 'se', x: gx + gw, y: gy + gh },
            { handle: 'sw', x: gx, y: gy + gh }
          ]
          for (const c of gCorners) {
            if (Math.hypot(canvasPt.x - c.x, canvasPt.y - c.y) <= hitTol) {
              pushHistory()
              shapeDragRef.current = {
                kind: 'group-resize',
                handle: c.handle,
                initGroupBounds: {
                  x: bounds.minX,
                  y: bounds.minY,
                  w: Math.max(24, bounds.w),
                  h: Math.max(24, bounds.h)
                },
                rotationSnapshot: captureRotationSnapshot(
                  curBoard,
                  currentSelected,
                  pivotX,
                  pivotY
                ),
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

    if (activeTool === 'lasso' && activeLassoPointsRef.current) {
      activeLassoPointsRef.current.push([canvasPt.x, canvasPt.y, e.pressure || 0.5])
      scheduleRenderRef.current()
      return
    }

    if (activeTool === 'snip' && selectionBoxRef.current) {
      selectionBoxRef.current.currentX = canvasPt.x
      selectionBoxRef.current.currentY = canvasPt.y
      scheduleRenderRef.current()
      return
    }

    if (activeTool === 'pen' && activeStrokeRef.current) {
      const p: [number, number, number] = [canvasPt.x, canvasPt.y, e.pressure || 0.5]
      activeStrokeRef.current.points.push(p)
      if (settingsRef.current.shapesMode) {
        holdSnap.onStrokePoint(p, () => activeStrokeRef.current?.points ?? [])
      }
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
          for (const v of curBoard.videoNodes ?? []) {
            if (isVideoInRect(v, rect)) ids.push(v.id)
          }
          for (const img of curBoard.imageNodes ?? []) {
            if (isImageInRect(img, rect)) ids.push(img.id)
          }
          for (const s3d of curBoard.scene3dNodes ?? []) {
            if (isScene3DInRect(s3d, rect)) ids.push(s3d.id)
          }
          for (const gr of curBoard.graphNodes ?? []) {
            if (isGraphInRect(gr, rect)) ids.push(gr.id)
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
          updateConnectDrag(canvasPt)
          return
        }

        if (drag.kind === 'move') {
          applyMoveDelta(dx, dy)
        } else if (
          drag.kind === 'rotate' &&
          drag.rotationSnapshot &&
          drag.startAngleRad !== undefined
        ) {
          const { pivotX, pivotY } = drag.rotationSnapshot
          const curRad = Math.atan2(canvasPt.y - pivotY, canvasPt.x - pivotX)
          let deltaDeg = ((curRad - drag.startAngleRad) * 180) / Math.PI
          while (deltaDeg <= -180) deltaDeg += 360
          while (deltaDeg > 180) deltaDeg -= 360
          if (e.shiftKey) {
            deltaDeg = Math.round(deltaDeg / 15) * 15
          }
          drag.liveAngleDeg = Math.round(deltaDeg)
          const snap = drag.rotationSnapshot
          update((b) => applyRotationDelta(b, snap, deltaDeg), { history: false })
        } else if (
          drag.kind === 'group-resize' &&
          drag.rotationSnapshot &&
          drag.initGroupBounds &&
          drag.handle
        ) {
          const ib = drag.initGroupBounds
          let nx = ib.x
          let ny = ib.y
          let nw = ib.w
          let nh = ib.h
          if (drag.handle.includes('e')) nw = Math.max(36, ib.w + dx)
          if (drag.handle.includes('w')) {
            nw = Math.max(36, ib.w - dx)
            nx = ib.x + (ib.w - nw)
          }
          if (drag.handle.includes('s')) nh = Math.max(36, ib.h + dy)
          if (drag.handle.includes('n')) {
            nh = Math.max(36, ib.h - dy)
            ny = ib.y + (ib.h - nh)
          }
          const snap = drag.rotationSnapshot
          update(
            (b) => applyGroupScale(b, snap, ib, { x: nx, y: ny, w: nw, h: nh }),
            { history: false }
          )
        } else if (
          drag.kind === 'shape-resize' &&
          drag.targetId &&
          drag.handle &&
          drag.initW !== undefined &&
          drag.initH !== undefined &&
          drag.initX !== undefined &&
          drag.initY !== undefined
        ) {
          const rotRad = drag.initRotation ? (drag.initRotation * Math.PI) / 180 : 0
          const ldx = rotRad ? dx * Math.cos(rotRad) + dy * Math.sin(rotRad) : dx
          const ldy = rotRad ? -dx * Math.sin(rotRad) + dy * Math.cos(rotRad) : dy
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
            newW = drag.initW + ldx
          }
          if (drag.handle.includes('w')) {
            newW = drag.initW - ldx
            newX = drag.initX + ldx
          }
          if (drag.handle.includes('s')) {
            newH = drag.initH + ldy
          }
          if (drag.handle.includes('n')) {
            newH = drag.initH - ldy
            newY = drag.initY + ldy
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

          if (rotRad && !isLinearShape) {
            const initCx = drag.initX + drag.initW / 2
            const initCy = drag.initY + drag.initH / 2
            const ldcx = newX + newW / 2 - initCx
            const ldcy = newY + newH / 2 - initCy
            const wdcx = ldcx * Math.cos(rotRad) - ldcy * Math.sin(rotRad)
            const wdcy = ldcx * Math.sin(rotRad) + ldcy * Math.cos(rotRad)
            newX = initCx + wdcx - newW / 2
            newY = initCy + wdcy - newH / 2
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
                ),
                [...(b.codeNodes ?? []), ...(b.scene3dNodes ?? []), ...(b.graphNodes ?? [])]
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

  const handlePointerUp = async (e?: React.PointerEvent<HTMLCanvasElement>): Promise<void> => {
    if (e?.currentTarget) {
      try {
        e.currentTarget.releasePointerCapture?.(e.pointerId)
      } catch {
        /* ignore */
      }
    }
    isPointerDownRef.current = false
    const wasPanning = !!panStartRef.current
    const finishedDrag = shapeDragRef.current
    panStartRef.current = null
    isPanningDragRef.current = false
    shapeDragRef.current = null
    lastEraserPointRef.current = null
    if (wasPanning) return

    // 00. Dedicated Pen Lasso Tool Selection
    if (activeTool === 'lasso' && activeLassoPointsRef.current) {
      const lassoPts = activeLassoPointsRef.current
      activeLassoPointsRef.current = null
      const curBoard = boardRef.current
      const curLayers = boardLayersRef.current
      const cardsEditable =
        partitionedLayersRef.current.cardsLayer.visible &&
        !partitionedLayersRef.current.cardsLayer.locked
      const matchedIds = findElementsInLasso(curBoard, lassoPts, {
        strictEnclosure: false,
        isLayerEditable: (lid) => isItemEditable(lid, curLayers),
        cardsEditable
      })
      setSelectedIds(matchedIds)
      setSelectedId(matchedIds[0] ?? null)
      if (matchedIds.length > 0) {
        setActiveTool('select')
        addToast(
          'info',
          `Selected ${matchedIds.length} element${matchedIds.length > 1 ? 's' : ''} with Pen Lasso`
        )
      }
      scheduleRenderRef.current()
      return
    }

    // 00b. Board Region Snip Tool -> Captures selected board area into a movable ImageNode
    if (activeTool === 'snip' && selectionBoxRef.current) {
      const box = selectionBoxRef.current
      selectionBoxRef.current = null
      const rect = normalizeRect(box.startX, box.startY, box.currentX, box.currentY)
      if (rect.w >= 24 && rect.h >= 24) {
        const curBoard = boardRef.current
        const scale = Math.min(2, 1400 / Math.max(rect.w, rect.h))
        const off = document.createElement('canvas')
        off.width = Math.max(48, Math.round(rect.w * scale))
        off.height = Math.max(48, Math.round(rect.h * scale))
        const octx = off.getContext('2d')
        if (octx) {
          octx.fillStyle =
            settingsRef.current.backgroundColor &&
              settingsRef.current.backgroundColor !== 'transparent'
              ? settingsRef.current.backgroundColor
              : '#FFFDF7'
          octx.fillRect(0, 0, off.width, off.height)
          octx.save()
          octx.scale(scale, scale)
          octx.translate(-rect.x, -rect.y)
          for (const va of curBoard.vectorArtNodes ?? []) {
            drawVectorArt(octx, va, themeTokens, boardPalette)
          }
          for (const s of curBoard.shapeNodes) {
            drawShape(octx, s, themeTokens, fontCss, boardPalette)
          }
          for (const st of curBoard.strokes) {
            drawStroke(octx, st, themeTokens)
          }
          for (const t of curBoard.textNodes) {
            octx.save()
            octx.fillStyle = themeTokens.ink
            octx.font = `${t.bold ? 700 : 500} ${t.fontSize || 18}px ${resolveFontCss(t.fontFamily, settingsRef.current.font)}`
            octx.textBaseline = 'top'
            t.text.split('\n').forEach((ln, idx) => {
              octx.fillText(ln, t.x, t.y + idx * ((t.fontSize || 18) * 1.35))
            })
            octx.restore()
          }
          octx.restore()
          const dataUrl = off.toDataURL('image/png')
          await saveDataUrlAndInsert(dataUrl, 'Board Snip', {
            x: Math.round(rect.x + 24),
            y: Math.round(rect.y + 24)
          })
        }
      } else {
        setActiveTool('select')
      }
      scheduleRenderRef.current()
      return
    }

    if (
      finishedDrag?.kind === 'connect' &&
      finishedDrag.sourceShapeId &&
      finishedDrag.sourcePort
    ) {
      finishConnectDrag(finishedDrag)
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

    // 2. Commit Stroke with Shapes Mode OR Freehand + Circle-to-Select
    if (activeStrokeRef.current) {
      const stroke = activeStrokeRef.current
      activeStrokeRef.current = null
      const snapped = holdSnap.consumeSnappedPreview()
      const isShapesMode = Boolean(settingsRef.current.shapesMode)

      if (stroke.points.length < 2) {
        scheduleRenderRef.current()
        return
      }

      // Tier 1: Hold-to-Snap (active only when Shapes Mode is ON)
      if (isShapesMode && snapped) {
        const snappedShape: ShapeNode = {
          ...buildShapeNodeFromHoldSnap(snapped, stroke.color, stroke.size, stroke.penType),
          ...(stroke.layerId ? { layerId: stroke.layerId } : {})
        }
        update((b) => ({ ...b, shapeNodes: [...b.shapeNodes, snappedShape] }))
        pushHistory()
        return
      }

      // Compute basic stroke geometry once for Circle-to-Select & Shapes Mode local detection
      let sMinX = Infinity
      let sMinY = Infinity
      let sMaxX = -Infinity
      let sMaxY = -Infinity
      let sTotalLen = 0
      for (let i = 0; i < stroke.points.length; i++) {
        const [px, py] = stroke.points[i]
        if (px < sMinX) sMinX = px
        if (py < sMinY) sMinY = py
        if (px > sMaxX) sMaxX = px
        if (py > sMaxY) sMaxY = py
        if (i > 0) {
          sTotalLen += Math.hypot(px - stroke.points[i - 1][0], py - stroke.points[i - 1][1])
        }
      }
      const sDiag = Math.hypot(sMaxX - sMinX, sMaxY - sMinY)
      const sStartEnd = Math.hypot(
        stroke.points[stroke.points.length - 1][0] - stroke.points[0][0],
        stroke.points[stroke.points.length - 1][1] - stroke.points[0][1]
      )
      const localShape = detectLocalBasicShape(stroke.points)

      // Tier 1.5: iPad-Style Circle-to-Select in Pen Mode (when Shapes Mode is OFF)
      if (
        !isShapesMode &&
        settingsRef.current.circleToSelect !== false &&
        sDiag >= 64 &&
        sTotalLen > sDiag * 1.55 &&
        sStartEnd <= Math.max(42, sDiag * 0.34) &&
        localShape?.shapeKind !== 'rect' &&
        localShape?.shapeKind !== 'triangle' &&
        localShape?.shapeKind !== 'diamond'
      ) {
        const curBoard = boardRef.current
        const curLayers = boardLayersRef.current
        const cardsEditable =
          partitionedLayersRef.current.cardsLayer.visible &&
          !partitionedLayersRef.current.cardsLayer.locked
        const enclosedIds = findElementsInLasso(curBoard, stroke.points, {
          strictEnclosure: true,
          isLayerEditable: (lid) => isItemEditable(lid, curLayers),
          cardsEditable
        })
        if (enclosedIds.length > 0) {
          setSelectedIds(enclosedIds)
          setSelectedId(enclosedIds[0] ?? null)
          setActiveTool('select')
          scheduleRenderRef.current()
          addToast(
            'info',
            `Selected ${enclosedIds.length} circled element${enclosedIds.length > 1 ? 's' : ''}`
          )
          return
        }
      }

      // Tier 2: Shapes Mode (Instant Local Basic Shape Detection · Zero LLM API!)
      if (isShapesMode && localShape) {
        const minSizeReq = 34
        const minLineDiag = 48
        const minArrowDiag = 34
        const minConf = 0.78

        const passesSize =
          localShape.shapeKind === 'arrow' || localShape.shapeKind === 'curved-arrow'
            ? sDiag >= minArrowDiag
            : localShape.isConnector
              ? sDiag >= minLineDiag
              : Math.min(Math.abs(localShape.w), Math.abs(localShape.h)) >= minSizeReq

        // Prevent handwritten 'l', 'i', 'o' from auto-snapping in Shapes Mode
        let isLikelyHandwritingGlyph = false
        if (
          (localShape.shapeKind === 'line' && sDiag < 135) ||
          (localShape.shapeKind === 'circle' && sDiag < 110)
        ) {
          const sW = Math.max(1, sMaxX - sMinX)
          const sH = Math.max(1, sMaxY - sMinY)
          const sCx = (sMinX + sMaxX) / 2
          const sCy = (sMinY + sMaxY) / 2
          const curShapes = boardRef.current.shapeNodes
          const curStrokes = boardRef.current.strokes

          // 1) Dot-over-stem 'i' / 'j'
          if (
            localShape.shapeKind === 'line' &&
            Math.abs(localShape.h) >= Math.abs(localShape.w) * 1.8
          ) {
            const hasDotAbove = curStrokes.some((other) => {
              if (other.id === stroke.id || other.points.length === 0) return false
              let oMinX = Infinity
              let oMinY = Infinity
              let oMaxX = -Infinity
              let oMaxY = -Infinity
              for (const [px, py] of other.points) {
                if (px < oMinX) oMinX = px
                if (py < oMinY) oMinY = py
                if (px > oMaxX) oMaxX = px
                if (py > oMaxY) oMaxY = py
              }
              const oW = oMaxX - oMinX
              const oH = oMaxY - oMinY
              const oDiag = Math.hypot(oW, oH)
              const oCx = (oMinX + oMaxX) / 2
              return (
                oDiag <= 24 &&
                oW <= 22 &&
                oH <= 22 &&
                oMaxY <= sMinY + 14 &&
                oMinY >= sMinY - Math.max(48, sH * 0.78) &&
                Math.abs(oCx - sCx) <= Math.max(28, sH * 0.48)
              )
            })
            if (hasDotAbove) isLikelyHandwritingGlyph = true
          }

          // 2) Inside an existing closed ShapeNode (handwritten label inside a box)
          if (!isLikelyHandwritingGlyph) {
            for (const box of curShapes) {
              if (
                box.shape === 'line' ||
                box.shape === 'dashed-line' ||
                box.shape === 'arrow' ||
                box.shape === 'arrow-bidirectional' ||
                box.shape === 'curved-arrow' ||
                box.shape === 'curved-line' ||
                box.shape === 'elbow'
              ) {
                continue
              }
              const bx = Math.min(box.x, box.x + box.w)
              const by = Math.min(box.y, box.y + box.h)
              const bw = Math.abs(box.w)
              const bh = Math.abs(box.h)
              if (
                sCx >= bx + 4 &&
                sCx <= bx + bw - 4 &&
                sCy >= by + 4 &&
                sCy <= by + bh - 4 &&
                sW < bw * 0.65 &&
                sH < bh * 0.65
              ) {
                isLikelyHandwritingGlyph = true
                break
              }
            }
          }

          // 3) Adjacent stroke on same horizontal baseline within word spacing
          if (!isLikelyHandwritingGlyph) {
            const hasBaselineNeighbor = curStrokes.some((other) => {
              if (other.id === stroke.id || other.points.length === 0) return false
              let oMinX = Infinity
              let oMinY = Infinity
              let oMaxX = -Infinity
              let oMaxY = -Infinity
              for (const [px, py] of other.points) {
                if (px < oMinX) oMinX = px
                if (py < oMinY) oMinY = py
                if (px > oMaxX) oMaxX = px
                if (py > oMaxY) oMaxY = py
              }
              const oDiag = Math.hypot(oMaxX - oMinX, oMaxY - oMinY)
              const oCy = (oMinY + oMaxY) / 2
              const horizGap = Math.max(0, Math.max(oMinX - sMaxX, sMinX - oMaxX))
              return (
                oDiag < 130 &&
                Math.abs(oCy - sCy) <= Math.max(40, sH * 0.9) &&
                horizGap <= Math.max(60, sH * 1.75)
              )
            })
            if (hasBaselineNeighbor) isLikelyHandwritingGlyph = true
          }
        }

        if (!isLikelyHandwritingGlyph && passesSize && localShape.confidence >= minConf) {
          let finalX = localShape.x
          let finalY = localShape.y
          let finalW = localShape.w
          let finalH = localShape.h
          let finalControlPoint = localShape.controlPoint

          if (
            localShape.shapeKind === 'line' ||
            localShape.shapeKind === 'arrow' ||
            localShape.shapeKind === 'curved-arrow'
          ) {
            const anchored = snapConnectorToShapeAnchors(
              {
                kind: localShape.shapeKind as HoldSnapKind,
                x: finalX,
                y: finalY,
                w: finalW,
                h: finalH,
                ...(finalControlPoint ? { controlPoint: finalControlPoint } : {})
              },
              boardRef.current.shapeNodes
            )
            finalX = anchored.x
            finalY = anchored.y
            finalW = anchored.w
            finalH = anchored.h
            finalControlPoint = anchored.controlPoint
          }

          const snappedNode: ShapeNode = {
            id: `lsnap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            shape:
              localShape.shapeKind === 'line' && stroke.penType === 'dashed'
                ? 'dashed-line'
                : localShape.shapeKind,
            x: finalX,
            y: finalY,
            w: finalW,
            h: finalH,
            ...(finalControlPoint ? { controlPoint: finalControlPoint } : {}),
            borderRadius: localShape.shapeKind === 'rect' ? 6 : undefined,
            color: stroke.color,
            fillColor: 'transparent',
            strokeWidth: Math.max(2, Math.min(6, Math.round(stroke.size * 0.85 * 10) / 10)),
            strokeStyle: stroke.penType === 'dashed' ? 'dashed' : 'solid',
            ...(stroke.layerId ? { layerId: stroke.layerId } : {})
          }
          update((b) => ({ ...b, shapeNodes: [...b.shapeNodes, snappedNode] }))
          pushHistory()
          scheduleRenderRef.current()
          return
        }
      }

      // Freehand ink stroke
      update((b) => ({ ...b, strokes: [...b.strokes, stroke] }))
      return
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
                const pad = 4
                const rotRad = !isEndpointLinearShape(s.shape) && s.rotation ? (s.rotation * Math.PI) / 180 : 0
                if (rotRad) {
                  const rcx = s.x + s.w / 2
                  const rcy = s.y + s.h / 2
                  ctx.translate(rcx, rcy)
                  ctx.rotate(rotRad)
                  ctx.translate(-rcx, -rcy)
                }
                const b = rotRad
                  ? { x: s.x, y: s.y, w: s.w, h: s.h }
                  : getShapeBoundingRect(s)
                const sx = b.x
                const sy = b.y
                const sw = Math.max(12, b.w)
                const sh = Math.max(12, b.h)

                ctx.strokeStyle = '#06b6d4'
                ctx.lineWidth = 2 / z
                ctx.setLineDash([5 / z, 4 / z])
                ctx.strokeRect(sx - pad, sy - pad, sw + pad * 2, sh + pad * 2)
                ctx.setLineDash([])

                // Rotation stem + circular grip handle above top-center
                const rotStemX = sx + sw / 2
                const rotStemY = sy - 26 / z
                ctx.beginPath()
                ctx.moveTo(rotStemX, sy - pad)
                ctx.lineTo(rotStemX, rotStemY)
                ctx.stroke()
                ctx.fillStyle = '#fef08a'
                ctx.strokeStyle = '#0891b2'
                ctx.lineWidth = 2 / z
                ctx.beginPath()
                ctx.arc(rotStemX, rotStemY, 5.5 / z, 0, Math.PI * 2)
                ctx.fill()
                ctx.stroke()

                ctx.fillStyle = '#FFFFFF'
                ctx.strokeStyle = '#06b6d4'
                ctx.lineWidth = 2 / z
                const handleSize = 7 / z
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
                if (va.rotation) {
                  const rcx = va.x + va.width / 2
                  const rcy = va.y + va.height / 2
                  ctx.translate(rcx, rcy)
                  ctx.rotate((va.rotation * Math.PI) / 180)
                  ctx.translate(-rcx, -rcy)
                }
                ctx.strokeStyle = '#06b6d4'
                ctx.lineWidth = 2 / z
                ctx.setLineDash([5 / z, 4 / z])
                const pad = 4
                ctx.strokeRect(va.x - pad, va.y - pad, va.width + pad * 2, va.height + pad * 2)
                ctx.setLineDash([])

                const rotStemX = va.x + va.width / 2
                const rotStemY = va.y - 26 / z
                ctx.beginPath()
                ctx.moveTo(rotStemX, va.y - pad)
                ctx.lineTo(rotStemX, rotStemY)
                ctx.stroke()
                ctx.fillStyle = '#fef08a'
                ctx.strokeStyle = '#0891b2'
                ctx.beginPath()
                ctx.arc(rotStemX, rotStemY, 5.5 / z, 0, Math.PI * 2)
                ctx.fill()
                ctx.stroke()

                ctx.fillStyle = '#06b6d4'
                const handleSize = 7 / z
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
                ctx.lineWidth = 1.5 / z
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
                ctx.lineWidth = 1.5 / z
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

              // Multi-selection rotation stem & grip handle above center
              const rotStemX = gx + gw / 2
              const rotStemY = gy - 26 / z
              ctx.beginPath()
              ctx.moveTo(rotStemX, gy)
              ctx.lineTo(rotStemX, rotStemY)
              ctx.stroke()
              ctx.fillStyle = '#fef08a'
              ctx.strokeStyle = '#0891b2'
              ctx.lineWidth = 2 / z
              ctx.beginPath()
              ctx.arc(rotStemX, rotStemY, 6 / z, 0, Math.PI * 2)
              ctx.fill()
              ctx.stroke()

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

              const activeDrag = shapeDragRef.current
              const pillText =
                activeDrag?.kind === 'rotate'
                  ? `Rotate · ${(activeDrag.liveAngleDeg ?? 0) > 0 ? '+' : ''}${activeDrag.liveAngleDeg ?? 0}°`
                  : `Diagram · ${currentSelectedIds.length} items`
              const fontSize = Math.max(10, Math.round(12 / z))
              ctx.font = `600 ${fontSize}px Inter, -apple-system, sans-serif`
              const textMetrics = ctx.measureText(pillText)
              const pillW = textMetrics.width + 16 / z
              const pillH = 22 / z
              const pillX = gx
              const pillY = gw < pillW * 2.2 ? gy + gh + 8 / z : gy - pillH - 6 / z

              ctx.fillStyle = activeDrag?.kind === 'rotate' ? '#111111' : '#0891b2'
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

        // Draw Selection Marquee Box (eraser section mode, snip region mode, or select tool)
        if (selectionBoxRef.current) {
          const sb = selectionBoxRef.current
          const rect = normalizeRect(sb.startX, sb.startY, sb.currentX, sb.currentY)
          ctx.save()
          const isEraser = activeToolRef.current === 'eraser'
          const isSnip = activeToolRef.current === 'snip'
          ctx.strokeStyle = isEraser ? '#f43f5e' : isSnip ? '#8b5cf6' : '#06b6d4'
          ctx.fillStyle = isEraser
            ? 'rgba(244, 63, 94, 0.14)'
            : isSnip
              ? 'rgba(139, 92, 246, 0.14)'
              : 'rgba(6, 182, 212, 0.12)'
          ctx.lineWidth = 1.8 / z
          ctx.setLineDash([6 / z, 4 / z])
          ctx.fillRect(rect.x, rect.y, rect.w, rect.h)
          ctx.strokeRect(rect.x, rect.y, rect.w, rect.h)
          ctx.restore()
        }

        // Draw Live iPad-Style Pen Lasso Loop
        if (activeLassoPointsRef.current && activeLassoPointsRef.current.length >= 2) {
          const pts = activeLassoPointsRef.current
          ctx.save()
          ctx.beginPath()
          ctx.moveTo(pts[0][0], pts[0][1])
          for (let i = 1; i < pts.length; i++) {
            ctx.lineTo(pts[i][0], pts[i][1])
          }
          ctx.closePath()
          ctx.fillStyle = 'rgba(6, 182, 212, 0.11)'
          ctx.fill()
          ctx.strokeStyle = '#0891b2'
          ctx.lineWidth = 2 / z
          ctx.lineCap = 'round'
          ctx.lineJoin = 'round'
          ctx.setLineDash([7 / z, 5 / z])
          ctx.stroke()
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
            const sourceInfo = findConnectableOnBoard(curBoard, drag.sourceShapeId)
            if (sourceInfo) {
              const sourceEl = sourceInfo.el
              drawShapeConnectionPorts(ctx, sourceEl, curView.zoom, {
                activeSourcePort: drag.sourcePort,
                accentColor: themeTokens.accent
              })
              const startPt = getShapePorts(sourceEl)[drag.sourcePort]
              const snapInfo = drag.snapTarget
                ? findConnectableOnBoard(curBoard, drag.snapTarget.shapeId)
                : null
              let endPt = {
                x: drag.currentX ?? drag.startPinchX,
                y: drag.currentY ?? drag.startPinchY
              }
              let endPort = inferFreeEndPort(startPt, endPt, drag.sourcePort)
              if (snapInfo && drag.snapTarget) {
                drawShapeConnectionPorts(ctx, snapInfo.el, curView.zoom, {
                  snapPort: drag.snapTarget.port,
                  accentColor: themeTokens.accent
                })
                endPt = getShapePorts(snapInfo.el)[drag.snapTarget.port]
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
      const geomChanged =
        patch.x !== undefined ||
        patch.y !== undefined ||
        patch.w !== undefined ||
        patch.h !== undefined
      update((b) => {
        const nextCodes = (b.codeNodes ?? []).map((c) => (c.id === id ? { ...c, ...patch } : c))
        return {
          ...b,
          codeNodes: nextCodes,
          shapeNodes: geomChanged
            ? syncBoundConnectors(b.shapeNodes, [...nextCodes, ...(b.scene3dNodes ?? []), ...(b.graphNodes ?? [])])
            : b.shapeNodes
        }
      }, opts)
      if (geomChanged) scheduleRenderRef.current()
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

  const handleUpdateImage = useCallback(
    (id: string, patch: Partial<ImageNode>, opts?: { history?: boolean }) => {
      update(
        (b) => ({
          ...b,
          imageNodes: (b.imageNodes ?? []).map((im) => (im.id === id ? { ...im, ...patch } : im))
        }),
        opts
      )
    },
    [update]
  )

  const handleUpdateScene3D = useCallback(
    (id: string, patch: Partial<Scene3DNode>, opts?: { history?: boolean }) => {
      const geomChanged =
        patch.x !== undefined ||
        patch.y !== undefined ||
        patch.w !== undefined ||
        patch.h !== undefined
      update((b) => {
        const nextScenes = (b.scene3dNodes ?? []).map((s3d) =>
          s3d.id === id ? { ...s3d, ...patch } : s3d
        )
        return {
          ...b,
          scene3dNodes: nextScenes,
          shapeNodes: geomChanged
            ? syncBoundConnectors(b.shapeNodes, [...(b.codeNodes ?? []), ...nextScenes, ...(b.graphNodes ?? [])])
            : b.shapeNodes
        }
      }, opts)
      if (geomChanged) scheduleRenderRef.current()
    },
    [update]
  )

  const handleUpdateGraph = useCallback(
    (id: string, patch: Partial<GraphNode>, opts?: { history?: boolean }) => {
      const geomChanged =
        patch.x !== undefined ||
        patch.y !== undefined ||
        patch.w !== undefined ||
        patch.h !== undefined
      update((b) => {
        const nextGraphs = (b.graphNodes ?? []).map((gr) =>
          gr.id === id ? { ...gr, ...patch } : gr
        )
        return {
          ...b,
          graphNodes: nextGraphs,
          shapeNodes: geomChanged
            ? syncBoundConnectors(b.shapeNodes, [...(b.codeNodes ?? []), ...(b.scene3dNodes ?? []), ...nextGraphs])
            : b.shapeNodes
        }
      }, opts)
      if (geomChanged) scheduleRenderRef.current()
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
        videoNodes: (b.videoNodes ?? []).filter((v) => v.id !== id),
        imageNodes: (b.imageNodes ?? []).filter((im) => im.id !== id),
        scene3dNodes: (b.scene3dNodes ?? []).filter((s3d) => s3d.id !== id),
        graphNodes: (b.graphNodes ?? []).filter((gr) => gr.id !== id)
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
      videoNodes: (b.videoNodes ?? []).filter((v) => !idsToDelete.has(v.id)),
      imageNodes: (b.imageNodes ?? []).filter((im) => !idsToDelete.has(im.id)),
      scene3dNodes: (b.scene3dNodes ?? []).filter((s3d) => !idsToDelete.has(s3d.id)),
      graphNodes: (b.graphNodes ?? []).filter((gr) => !idsToDelete.has(gr.id))
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
      const imageNode = (curBoard.imageNodes ?? []).find((im) => im.id === id)
      if (imageNode) {
        const dup: ImageNode = {
          ...imageNode,
          id: `img-${Date.now()}`,
          x: imageNode.x + 30,
          y: imageNode.y + 30,
          createdAt: Date.now()
        }
        update((b) => ({ ...b, imageNodes: [...(b.imageNodes ?? []), dup] }))
        setSelectedId(dup.id)
        return
      }
      const s3dNode = (curBoard.scene3dNodes ?? []).find((s) => s.id === id)
      if (s3dNode) {
        const dup: Scene3DNode = {
          ...s3dNode,
          id: `s3d-${Date.now()}`,
          x: s3dNode.x + 30,
          y: s3dNode.y + 30,
          spec: { ...s3dNode.spec, elements: s3dNode.spec.elements.map((e) => ({ ...e })) },
          createdAt: Date.now()
        }
        update((b) => ({ ...b, scene3dNodes: [...(b.scene3dNodes ?? []), dup] }))
        setSelectedId(dup.id)
        return
      }
      const grNode = (curBoard.graphNodes ?? []).find((g) => g.id === id)
      if (grNode) {
        const dup: GraphNode = {
          ...grNode,
          id: `graph-${Date.now()}`,
          x: grNode.x + 30,
          y: grNode.y + 30,
          spec: {
            ...grNode.spec,
            functions: grNode.spec.functions.map((f) => ({ ...f })),
            dataSeries: grNode.spec.dataSeries.map((d) => ({
              ...d,
              sliceColors: d.sliceColors ? [...d.sliceColors] : undefined
            })),
            ohlcData: grNode.spec.ohlcData?.map((o) => ({ ...o })),
            zMatrix: grNode.spec.zMatrix?.map((r) => [...r])
          },
          createdAt: Date.now()
        }
        update((b) => ({ ...b, graphNodes: [...(b.graphNodes ?? []), dup] }))
        setSelectedId(dup.id)
        return
      }
    },
    [update]
  )

  const handleApplyFont = useCallback(
    (nextFont: FontId) => {
      patchSettings({ font: nextFont })
      const rawSel = selectedIdsRef.current
      const selIds = rawSel.length > 0 ? rawSel : selectedId ? [selectedId] : []
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
    [patchSettings, pushHistory, update, boardRef, selectedId]
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
    for (const im of cur.imageNodes ?? []) allIds.push(im.id)
    for (const s3d of cur.scene3dNodes ?? []) allIds.push(s3d.id)
    for (const gr of cur.graphNodes ?? []) allIds.push(gr.id)

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
        (cur.imageNodes ?? []).some((im) => im.id === single) ||
        (cur.scene3dNodes ?? []).some((s3d) => s3d.id === single) ||
        (cur.graphNodes ?? []).some((gr) => gr.id === single) ||
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
      const newImages = (b.imageNodes ?? [])
        .filter((im) => idSet.has(im.id))
        .map((im) => {
          const id = nextId('img')
          clonedIds.push(id)
          return { ...im, id, x: im.x + 30, y: im.y + 30, createdAt: now }
        })
      const newScene3ds = (b.scene3dNodes ?? [])
        .filter((s3d) => idSet.has(s3d.id))
        .map((s3d) => {
          const id = nextId('s3d')
          clonedIds.push(id)
          return {
            ...s3d,
            id,
            x: s3d.x + 30,
            y: s3d.y + 30,
            spec: { ...s3d.spec, elements: s3d.spec.elements.map((e) => ({ ...e })) },
            createdAt: now
          }
        })
      const newGraphs = (b.graphNodes ?? [])
        .filter((gr) => idSet.has(gr.id))
        .map((gr) => {
          const id = nextId('graph')
          clonedIds.push(id)
          return {
            ...gr,
            id,
            x: gr.x + 30,
            y: gr.y + 30,
            spec: {
              ...gr.spec,
              functions: gr.spec.functions.map((f) => ({ ...f })),
              dataSeries: gr.spec.dataSeries.map((d) => ({
                ...d,
                sliceColors: d.sliceColors ? [...d.sliceColors] : undefined
              })),
              ohlcData: gr.spec.ohlcData?.map((o) => ({ ...o })),
              zMatrix: gr.spec.zMatrix?.map((r) => [...r])
            },
            createdAt: now
          }
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
        videoNodes: [...(b.videoNodes ?? []), ...newVideos],
        imageNodes: [...(b.imageNodes ?? []), ...newImages],
        scene3dNodes: [...(b.scene3dNodes ?? []), ...newScene3ds],
        graphNodes: [...(b.graphNodes ?? []), ...newGraphs]
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
        } else if (e.key === 'g' || e.key === 'G') {
          setActiveTool('lasso')
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
          (b) => {
            const nextCodes = (b.codeNodes ?? []).map((c) =>
              idSet.has(c.id) ? { ...c, x: c.x + dx, y: c.y + dy } : c
            )
            const nextScene3ds = (b.scene3dNodes ?? []).map((s3d) =>
              idSet.has(s3d.id) ? { ...s3d, x: s3d.x + dx, y: s3d.y + dy } : s3d
            )
            const nextGraphs = (b.graphNodes ?? []).map((gr) =>
              idSet.has(gr.id) ? { ...gr, x: gr.x + dx, y: gr.y + dy } : gr
            )
            return {
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
                ),
                [...nextCodes, ...nextScene3ds, ...nextGraphs]
              ),
              textNodes: b.textNodes.map((t) => (idSet.has(t.id) ? { ...t, x: t.x + dx, y: t.y + dy } : t)),
              vectorArtNodes: (b.vectorArtNodes ?? []).map((v) =>
                idSet.has(v.id) ? { ...v, x: v.x + dx, y: v.y + dy } : v
              ),
              equationNodes: b.equationNodes.map((eq) => (idSet.has(eq.id) ? { ...eq, x: eq.x + dx, y: eq.y + dy } : eq)),
              diagramNodes: (b.diagramNodes ?? []).map((d) => (idSet.has(d.id) ? { ...d, x: d.x + dx, y: d.y + dy } : d)),
              codeNodes: nextCodes,
              videoNodes: (b.videoNodes ?? []).map((v) => (idSet.has(v.id) ? { ...v, x: v.x + dx, y: v.y + dy } : v)),
              imageNodes: (b.imageNodes ?? []).map((im) => (idSet.has(im.id) ? { ...im, x: im.x + dx, y: im.y + dy } : im)),
              scene3dNodes: nextScene3ds,
              graphNodes: nextGraphs,
              strokes: b.strokes.map((st) =>
                idSet.has(st.id)
                  ? {
                    ...st,
                    points: st.points.map(([px, py, pr]) => [px + dx, py + dy, pr] as InkPoint)
                  }
                  : st
              )
            }
          },
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
      onDragOver={(e) => {
        if (!isHomeView && Array.from(e.dataTransfer.types || []).includes('Files')) {
          e.preventDefault()
        }
      }}
      onDrop={(e) => {
        if (isHomeView) return
        const imgFiles = Array.from(e.dataTransfer.files || []).filter((f) =>
          f.type.startsWith('image/')
        )
        if (imgFiles.length === 0) return
        e.preventDefault()
        const dropWorld = screenToCanvas(e.clientX, e.clientY, viewRef.current)
        imgFiles.forEach((f, idx) => {
          const reader = new FileReader()
          reader.onload = () => {
            if (typeof reader.result === 'string') {
              void saveDataUrlAndInsert(reader.result, f.name, {
                x: dropWorld.x + idx * 32,
                y: dropWorld.y + idx * 32
              })
            }
          }
          reader.readAsDataURL(f)
        })
      }}
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
        onUpdateSectionColor={(secId, color) => void handleUpdateSectionColor(secId, color)}
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
            className={`canvas-layer committed-canvas cursor-${getCanvasCursorClass()}`}
            style={{ cursor: getCanvasCursor() }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onPointerLeave={handlePointerLeave}
            onDoubleClick={handleCanvasDoubleClick}
            onContextMenu={(e) => handleCanvasContextMenu(e)}
          />

          {/* Layer 2: Interactive Movable Text, Equation, React Flow Diagrams, Code, Video & Image Cards */}
          <CanvasElements
            textNodes={board.textNodes}
            equationNodes={board.equationNodes}
            diagramNodes={board.diagramNodes}
            codeNodes={board.codeNodes}
            videoNodes={board.videoNodes}
            imageNodes={board.imageNodes}
            scene3dNodes={board.scene3dNodes}
            graphNodes={board.graphNodes}
            shapeNodes={board.shapeNodes}
            selectedId={selectedId}
            selectedIds={selectedIds}
            onSelect={(id) => {
              setSelectedId(id)
              setSelectedIds(id ? [id] : [])
            }}
            onUpdateText={handleUpdateText}
            onUpdateEquation={handleUpdateEquation}
            onUpdateDiagram={handleUpdateDiagram}
            onUpdateCode={handleUpdateCode}
            onUpdateVideo={handleUpdateVideo}
            onUpdateImage={handleUpdateImage}
            onUpdateScene3D={handleUpdateScene3D}
            onUpdateGraph={handleUpdateGraph}
            onSpawnGraphFromCode={handleSpawnGraphFromCode}
            onSpawnScene3DFromCode={handleSpawnScene3DFromCode}
            onStartConnect={handleStartCardConnect}
            onExecuteCodeNode={handleExecuteConnectedCodeFlow}
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
            className={`canvas-layer overlay-canvas cursor-${getCanvasCursorClass()}`}
            style={{
              cursor: getCanvasCursor(),
              pointerEvents:
                activeTool === 'pen' ||
                  activeTool === 'lasso' ||
                  activeTool === 'snip' ||
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
            onPointerCancel={handlePointerUp}
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
                      className={`shape-swatch-btn ${editingShape.labelColor?.toLowerCase() === hex.toLowerCase() ? 'active' : ''
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

          {/* Multi-element selection action bar (Unified Smart Vectorize & Beautify — ONE UI Button!) */}
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
                  className="diagram-selection-vectorize-btn"
                  onClick={handleVectorizeSelected}
                  disabled={isVectorizing || isBeautifying}
                  title="Smart Vectorize & Beautify (Ctrl+B) — Local shapes + AI/Local OCR, smart diagram/vector routing"
                >
                  {isVectorizing || isBeautifying ? (
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

                <button
                  type="button"
                  className="diagram-selection-agy-btn"
                  onClick={() => void handleSendSelectionToAntigravity()}
                  title="Capture selection PNG for Antigravity & copy prompt (Vectorize my current Vexelboard selection)"
                >
                  <Sparkles size={14} />
                  <span>Antigravity</span>
                </button>

                <button
                  type="button"
                  className="diagram-selection-rot-btn"
                  onClick={() => handleRotateSelected(-90)}
                  title="Rotate selected elements 90° left"
                >
                  <RotateCcw size={13} />
                  <span>-90°</span>
                </button>
                <button
                  type="button"
                  className="diagram-selection-rot-btn"
                  onClick={() => handleRotateSelected(90)}
                  title="Rotate selected elements 90° right"
                >
                  <RotateCw size={13} />
                  <span>+90°</span>
                </button>

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
            onRotateSelection={handleRotateSelected}
          />

          {/* Left Quick-Access Dock Toolbar */}
          <LeftDockToolbar
            activeTool={activeTool}
            onSelectTool={setActiveTool}
            onAddShapeNode={handleAddShapeNode}
            onAddStickyNote={handleAddStickyNote}
            onAddTemplate={handleAddTemplate}
            onInsertGraph={handleInsertGraph}
            onInsertScene3D={handleInsertScene3D}
            onCreateLinkedCode={handleCreateLinkedCode}
            openGraphTrigger={openGraphTrigger}
            onBeautify={handleBeautifySelected}
            isBeautifying={isBeautifying}
            onVectorize={handleVectorizeSelected}
            isVectorizing={isVectorizing}
            isAiConfigured={isAiConfigured}
            hasSelection={selectedIds.length > 0}
            onAddCodeNode={handleAddCodeNode}
            onOpenKnowledgeHub={() => setIsKnowledgeHubOpen(true)}
            onAddYouTubeVideo={() => handleAddYouTubeToCanvas()}
            onPasteImageFromClipboard={() => void handlePasteClipboardImage()}
            onUploadImageFile={() => void handleUploadImageFiles()}
            shapesMode={Boolean(settings.shapesMode)}
            onToggleShapesMode={(shapesMode) => {
              holdSnap.resetHoldSnap()
              patchSettings({ shapesMode })
            }}
            circleToSelect={settings.circleToSelect ?? true}
            onToggleCircleToSelect={(circleToSelect) => patchSettings({ circleToSelect })}
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
              shapesMode={Boolean(settings.shapesMode)}
              onToggleShapesMode={(shapesMode) => {
                holdSnap.resetHoldSnap()
                patchSettings({ shapesMode })
              }}
              circleToSelect={settings.circleToSelect ?? true}
              onToggleCircleToSelect={(circleToSelect) => patchSettings({ circleToSelect })}
              onPasteImageFromClipboard={() => void handlePasteClipboardImage()}
              onUploadImageFile={() => void handleUploadImageFiles()}
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
              onSendToAntigravity={() => void handleSendSelectionToAntigravity()}
              onRotateSelection={handleRotateSelected}
              onOpenGraphBuilder={() => setOpenGraphTrigger((t) => t + 1)}
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
              onPasteImageAt={(wx, wy) => void handlePasteClipboardImage({ x: wx, y: wy })}
              onUploadImageAt={(wx, wy) => void handleUploadImageFiles({ x: wx, y: wy })}
              onSnipBoardRegion={() => setActiveTool('snip')}
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
              onUpdateThreadColor={handleUpdateChatThreadColor}
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
              onOpenSkills={() => setSkillsModalOpen(true)}
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

      {/* AI Skills & Antigravity Companion Modal */}
      {skillsModalOpen && (
        <Suspense fallback={null}>
          <SkillsModal
            isOpen={skillsModalOpen}
            onClose={() => setSkillsModalOpen(false)}
            aiSettings={settings.ai}
            onChangeAI={(ai) => patchSettings({ ai })}
            onToast={addToast}
          />
        </Suspense>
      )}

      {/* Toasts */}
      <Toasts toasts={toasts} />
    </div>
  )
}
