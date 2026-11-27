import type { DisplayMode, OpenAIModelProfile, ProviderId, WebSearchSettings } from '@shared/ipc'
import type {
  DiagramGraph,
  IllustrationBrief,
  SpatialScene,
  VectorPathLayer
} from '@shared/beautifySchema'
import type { Scene3DSpec } from '@shared/scene3dSchema'
import type { GraphPlotSpec } from '../board/graphPlotBuilder'

export type {
  DisplayMode,
  ProviderId,
  DiagramGraph,
  IllustrationBrief,
  SpatialScene,
  VectorPathLayer,
  Scene3DSpec
}

/** [x, y, pressure] */
export type InkPoint = [number, number, number]

export type ColorRole = 'ink' | 'accent' | string

export type PenType =
  | 'ballpoint'
  | 'fountain'
  | 'pencil'
  | 'brush'
  | 'marker'
  | 'highlighter'
  | 'dashed'

export interface Stroke {
  id: string
  points: InkPoint[]
  color: ColorRole
  size: number
  penType?: PenType
  layerId?: string
}

export type TextStyle = 'h1' | 'h2' | 'h3' | 'body' | 'bullet' | 'quote'

export interface TextNode {
  id: string
  x: number
  y: number
  w?: number
  h?: number
  text: string
  title?: string
  style?: TextStyle
  bold?: boolean
  italic?: boolean
  fontSize: number
  color: ColorRole
  bg?: string
  /** When true, renders directly immersed on the board surface with no textbox/card border or padding */
  immersed?: boolean
  /** Explicit font family for board-immersed or styled text */
  fontFamily?: FontId
  /** Optional text alignment */
  align?: 'left' | 'center' | 'right'
  /** Optional group id for elements vectorized together */
  vectorGroupId?: string
  /** Layer assignment for board-immersed text */
  layerId?: string
  /** Optional rotation angle in degrees */
  rotation?: number
  /** Freehand strokes drawn directly inside the note (coordinates relative to the note) */
  ink?: Stroke[]
  source: 'manual' | 'ocr' | 'ai'
  createdAt: number
}

export interface EquationNode {
  id: string
  x: number
  y: number
  w?: number
  h?: number
  latex: string
  fontSize: number
  color: ColorRole
  bg?: string
  createdAt: number
}

export type ShapeKind =
  // 2D Basic
  | 'rect'
  | 'rounded-rect'
  | 'circle'
  | 'diamond'
  | 'triangle'
  | 'parallelogram'
  // System Design & Architecture
  | 'cylinder'
  | 'cloud'
  | 'server'
  | 'queue'
  | 'actor'
  | 'component'
  // 3D Isometric
  | 'cube3d'
  | 'cylinder3d'
  | 'sphere3d'
  // Connectors & Custom Vector Paths
  | 'arrow'
  | 'arrow-bidirectional'
  | 'line'
  | 'dashed-line'
  | 'elbow'
  | 'curved-arrow'
  | 'curved-line'
  | 'polyline'
  | 'svg-path'
  // Vexelboard shape library IDs
  | (string & {})

export interface VectorSvgPath {
  d: string
  fill?: string
  stroke?: string
  strokeWidth?: number
  dashed?: boolean
}

export type PortSide = 'top' | 'right' | 'bottom' | 'left'
export type ConnectorRouting = 'orthogonal' | 'curved' | 'straight'

export interface ShapePortBinding {
  shapeId: string
  port: PortSide
}

export interface ShapeNode {
  id: string
  shape: ShapeKind
  x: number
  y: number
  w: number
  h: number
  label?: string
  color: ColorRole
  fillColor?: string
  /** Optional fill opacity (0 to 1, defaults to 1 while strokes stay crisp) */
  fillOpacity?: number
  /** Optional animated stroke/flow hint */
  animated?: boolean
  /** Animation visual style when animated is true: 'pulse' (traveling signal orb), 'dash' (marching ants), or 'both' */
  animationMode?: 'pulse' | 'dash' | 'both'
  /** Topological stage index (0, 1, 2, ...) for synchronized wave propagation across multi-stage diagrams */
  flowStage?: number
  /** Total number of stages in a synchronized diagram wave cycle */
  flowTotalStages?: number
  /** Optional custom color for traveling signal pulse orb */
  pulseColor?: string
  strokeWidth?: number
  strokeStyle?: 'solid' | 'dashed' | 'dotted'
  /** Explicit corner radius in px (0 = razor-sharp corners for stack/array/table cells) */
  borderRadius?: number
  /** Explicit label font size in px */
  labelSize?: number
  /** Explicit label bold weight (defaults to true) */
  labelBold?: boolean
  /** Explicit label text color (hex or ColorRole; defaults to auto-contrast against fill) */
  labelColor?: string
  rotation?: number
  /** Single SVG path string in local svgViewBox space (used when shape === 'svg-path') */
  svgPath?: string
  /** Multiple SVG vector paths in local svgViewBox space (used when shape === 'svg-path') */
  svgPaths?: VectorSvgPath[]
  /** Local viewBox [width, height] or [minX, minY, width, height] for svgPath / svgPaths */
  svgViewBox?: [number, number] | [number, number, number, number]
  /** Control point [cx, cy] in canvas coordinates for curved-arrow / curved-line */
  controlPoint?: [number, number]
  /** Multi-segment vertices in canvas coordinates for polyline connectors */
  points?: Array<[number, number]>
  /** Optional arrowheads for polyline / line connectors */
  arrowStart?: boolean
  arrowEnd?: boolean
  /** Live port bindings for React Flow-style auto-routing board connectors */
  startBinding?: ShapePortBinding
  endBinding?: ShapePortBinding
  /** Connector routing geometry style */
  routing?: ConnectorRouting
  /** Font family for embedded shape label */
  fontFamily?: FontId
  /** Optional group id for elements vectorized together */
  vectorGroupId?: string
  /** Layer assignment */
  layerId?: string
}

import type { Node as RFNode, Edge as RFEdge } from '@xyflow/react'

export interface DiagramNode {
  id: string
  x: number
  y: number
  w: number
  h: number
  title?: string
  nodes: RFNode[]
  edges: RFEdge[]
  color?: ColorRole
  createdAt: number
}

export interface CodeTabExecutionOutput {
  ok: boolean
  stdout: string
  stderr: string
  exitCode: number | null
  durationMs: number
  language: string
  command?: string
  timedOut?: boolean
  error?: string
  timestamp: number
}

export interface CodeTabItem {
  id: string
  title: string
  language: string
  code: string
  color?: string
  stdin?: string
  /** Optional pipeline source: 'prev' (chain previous tab), a specific tab id, or 'card:<cardId>:<tabId>' */
  upstreamTabId?: string | null
  /** Output panel display mode */
  visualMode?: 'terminal' | 'plot2d' | 'scene3d'
  output?: CodeTabExecutionOutput | null
}

export interface CodeNode {
  id: string
  x: number
  y: number
  w: number
  h: number
  title?: string
  color?: string
  /** When true, tabs can be sequentially executed as a pipeline passing stdout -> stdin */
  pipelineMode?: boolean
  /** Optional linked board visual elements updated automatically when code runs */
  linkedScene3DId?: string
  linkedGraphGroupId?: string
  linkedGraphId?: string
  tabs: CodeTabItem[]
  activeTabId: string
  createdAt: number
}

export interface GraphNode {
  id: string
  x: number
  y: number
  w: number
  h: number
  title?: string
  spec: GraphPlotSpec
  linkedCodeNodeId?: string
  layerId?: string
  createdAt: number
}

export interface Scene3DNode {
  id: string
  x: number
  y: number
  w: number
  h: number
  title?: string
  spec: Scene3DSpec
  /** When true (default), renders directly immersed on the board canvas with no card border/background */
  immersed?: boolean
  color?: string
  linkedCodeNodeId?: string
  linkedTabId?: string
  layerId?: string
  createdAt: number
}

export interface VideoBookmark {
  id: string
  timestamp: number
  label: string
  noteId?: string
}

export interface VideoTabItem {
  id: string
  title: string
  url: string
  videoId: string
  color?: string
  currentTime?: number
}

export interface VideoNode {
  id: string
  x: number
  y: number
  w: number
  h: number
  url: string
  videoId: string
  title?: string
  color?: string
  currentTime?: number
  tabs?: VideoTabItem[]
  activeTabId?: string
  bookmarks?: VideoBookmark[]
  createdAt: number
}

export interface ImageNode {
  id: string
  x: number
  y: number
  w: number
  h: number
  naturalW?: number
  naturalH?: number
  /** vexel-media:// URL or data URI (kept out of stripped base64Png/imageBase64 keys) */
  src: string
  caption?: string
  color?: string
  layerId?: string
  createdAt: number
}

export interface VectorArtSourceMeta {
  style?: 'flat_vector' | 'clean_line_art' | 'editorial_poster' | 'trace_only'
  refinementUsed?: 'cloud' | 'local_comfyui' | 'trace_only'
  brief?: IllustrationBrief
  /** Original raw strokes preserved for non-destructive Revert-to-Sketch & Style Switcher (never raw PNGs!) */
  originalStrokes?: Stroke[]
  originalShapes?: ShapeNode[]
  originalTexts?: TextNode[]
}

export interface VectorArtNode {
  id: string
  kind: 'vector_art'
  x: number
  y: number
  width: number
  height: number
  viewBoxWidth: number
  viewBoxHeight: number
  layers: VectorPathLayer[]
  rotation?: number
  sourceMeta?: VectorArtSourceMeta
  layerId?: string
  createdAt: number
}

export interface VectorDiagramMeta {
  groupId: string
  anchor: { x: number; y: number }
  graph?: DiagramGraph
  spatialScene?: SpatialScene
  originalStrokes?: Stroke[]
  originalShapes?: ShapeNode[]
  originalTexts?: TextNode[]
}

export type BoardLayerKind = 'ink' | 'elements'

export interface BoardLayer {
  id: string
  name: string
  kind: BoardLayerKind
  visible: boolean
  locked: boolean
  opacity: number
}

export interface BoardState {
  strokes: Stroke[]
  textNodes: TextNode[]
  equationNodes: EquationNode[]
  shapeNodes: ShapeNode[]
  diagramNodes: DiagramNode[]
  vectorArtNodes?: VectorArtNode[]
  vectorDiagramMeta?: Record<string, VectorDiagramMeta>
  codeNodes?: CodeNode[]
  videoNodes?: VideoNode[]
  imageNodes?: ImageNode[]
  scene3dNodes?: Scene3DNode[]
  graphNodes?: GraphNode[]
  /** Top-to-bottom z-order layer stack (index 0 = topmost above cards, last = bottommost base) */
  layers?: BoardLayer[]
  /** Active ink layer where new pen strokes, hold-to-snap shapes & vector art are placed */
  activeLayerId?: string
}

export const EMPTY_BOARD: BoardState = {
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
  graphNodes: [],
  layers: [
    { id: 'layer-overlay-ink', name: 'Annotations (Top)', kind: 'ink', visible: true, locked: false, opacity: 1 },
    { id: 'layer-cards', name: 'Cards & Widgets', kind: 'elements', visible: true, locked: false, opacity: 1 },
    { id: 'layer-base-ink', name: 'Base Canvas', kind: 'ink', visible: true, locked: false, opacity: 1 }
  ],
  activeLayerId: 'layer-overlay-ink'
}

export type ToolType =
  | 'select'
  | 'pan'
  | 'pen'
  | 'lasso'
  | 'snip'
  | 'text'
  | 'equation'
  | 'eraser'
  | 'diagram'
  | 'video'
export type EraserMode = 'paper' | 'section'
export type ThemeId = 'neon' | 'chalk' | 'blueprint' | 'overlay'
export type FontId = 'jakarta' | 'caveat' | 'grotesk' | 'mono' | 'serif'
export type Handedness = 'right' | 'left'

export interface CanvasTransform {
  zoom: number
  panX: number
  panY: number
}

export type HandwritingOcrMode = 'api' | 'local'

export interface AISettings {
  provider: ProviderId
  ollamaHost: string
  ollamaModel: string
  byokModels: Record<Exclude<ProviderId, 'ollama'>, string>
  temperature: number
  openaiModelProfile?: OpenAIModelProfile
  webSearch?: WebSearchSettings
  activeSkillIds?: string[]
  /** Handwriting OCR engine preference ('api' defaults to configured Vision AI with local TrOCR fallback) */
  handwritingOcrMode?: HandwritingOcrMode
  /** True once the user has explicitly configured/enabled an AI provider */
  configured?: boolean
}

export type BackgroundPattern = 'none' | 'dots' | 'grid'

export interface AppSettings {
  theme: ThemeId
  font: FontId
  mode: DisplayMode
  dominantHand: Handedness
  inkSize: number
  penType?: PenType
  /** Shapes Mode: instant local basic shape detection without LLM API */
  shapesMode?: boolean
  /** iPad-style circle-an-area in Pen mode to select enclosed elements */
  circleToSelect?: boolean
  backgroundColor?: string
  backgroundPattern?: BackgroundPattern
  ai: AISettings
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  sectionId?: string
  sectionTitle?: string
}

export interface Toast {
  id: string
  kind: 'info' | 'success' | 'error'
  message: string
}
