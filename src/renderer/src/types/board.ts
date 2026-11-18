import type { DisplayMode, OpenAIModelProfile, ProviderId } from '@shared/ipc'

export type { DisplayMode, ProviderId }

/** [x, y, pressure] */
export type InkPoint = [number, number, number]

export type ColorRole = 'ink' | 'accent' | string

export type PenType = 'ballpoint' | 'fountain' | 'marker' | 'highlighter' | 'dashed'

export interface Stroke {
  id: string
  points: InkPoint[]
  color: ColorRole
  size: number
  penType?: PenType
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
  // Connectors
  | 'arrow'
  | 'arrow-bidirectional'
  | 'line'
  | 'dashed-line'
  | 'elbow'
  // Vexelboard shape library IDs
  | (string & {})

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
  strokeWidth?: number
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
  stdin?: string
  output?: CodeTabExecutionOutput | null
}

export interface CodeNode {
  id: string
  x: number
  y: number
  w: number
  h: number
  title?: string
  tabs: CodeTabItem[]
  activeTabId: string
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
  currentTime?: number
  tabs?: VideoTabItem[]
  activeTabId?: string
  bookmarks?: VideoBookmark[]
  createdAt: number
}

export interface BoardState {
  strokes: Stroke[]
  textNodes: TextNode[]
  equationNodes: EquationNode[]
  shapeNodes: ShapeNode[]
  diagramNodes: DiagramNode[]
  codeNodes?: CodeNode[]
  videoNodes?: VideoNode[]
}

export const EMPTY_BOARD: BoardState = {
  strokes: [],
  textNodes: [],
  equationNodes: [],
  shapeNodes: [],
  diagramNodes: [],
  codeNodes: [],
  videoNodes: []
}

export type ToolType = 'select' | 'pan' | 'pen' | 'text' | 'equation' | 'eraser' | 'diagram' | 'video'
export type WritingPadDetection = 'none' | 'text' | 'equation'
export type EraserMode = 'paper' | 'section'
export type ThemeId = 'neon' | 'chalk' | 'blueprint' | 'overlay'
export type FontId = 'caveat' | 'jakarta' | 'mono'
export type Handedness = 'right' | 'left'

export interface CanvasTransform {
  zoom: number
  panX: number
  panY: number
}

export interface AISettings {
  provider: ProviderId
  ollamaHost: string
  ollamaModel: string
  byokModels: Record<Exclude<ProviderId, 'ollama'>, string>
  temperature: number
  openaiModelProfile?: OpenAIModelProfile
}

export type BackgroundPattern = 'none' | 'dots' | 'grid'

export interface AppSettings {
  theme: ThemeId
  font: FontId
  mode: DisplayMode
  dominantHand: Handedness
  inkSize: number
  penType?: PenType
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
