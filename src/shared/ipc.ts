/**
 * Shared IPC contracts between the Electron main process, preload bridge and renderer.
 * Pure types + constants only (no runtime imports) so every tsconfig can include it.
 */
import type {
  SmartBeautifyRequest,
  SmartBeautifyResponse,
  VectorCritiqueRequest,
  VectorCritiqueResponse
} from './beautifySchema'
import type { AgentRunRequest, AgentRunResult, AgentStepEvent } from './agentSchema'

export type {
  SmartBeautifyRequest,
  SmartBeautifyResponse,
  VectorCritiqueRequest,
  VectorCritiqueResponse,
  AgentRunRequest,
  AgentRunResult,
  AgentStepEvent
}

export type ProviderId = 'ollama' | 'openai' | 'gemini' | 'grok' | 'claude'
export type ByokProvider = Exclude<ProviderId, 'ollama'>
export type DisplayMode = 'MODE_A' | 'MODE_B'

export const BYOK_PROVIDERS: ByokProvider[] = ['openai', 'gemini', 'grok', 'claude']

export const GEMMA_CLOUD_MODELS = ['gemma4', 'gemma4:cloud', 'gemma4:31b-cloud', 'gemma4:e4b']

export const DEFAULT_PROVIDER_MODELS: Record<ProviderId, string> = {
  ollama: 'gemma4',
  openai: 'gpt-4o',
  gemini: 'gemini-2.0-flash',
  grok: 'grok-2-vision-1212',
  claude: 'claude-3-7-sonnet-20250219'
}

export const POPULAR_PROVIDER_MODELS: Record<ByokProvider, string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'o3-mini', 'o1', 'o4-mini', 'gpt-4-turbo'],
  gemini: ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-2.5-flash', 'gemini-1.5-pro'],
  grok: ['grok-2-vision-1212', 'grok-3', 'grok-2-1212'],
  claude: ['claude-3-7-sonnet-20250219', 'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022']
}

export interface TemperaturePreset {
  id: 'precise' | 'balanced' | 'creative' | 'expressive'
  label: string
  value: number
  description: string
}

export const TEMPERATURE_PRESETS: readonly TemperaturePreset[] = [
  { id: 'precise', label: 'Precise', value: 0.1, description: 'Deterministic, factual & structured' },
  { id: 'balanced', label: 'Balanced', value: 0.3, description: 'Ideal default for accuracy & clarity' },
  { id: 'creative', label: 'Creative', value: 0.7, description: 'Brainstorming & expressive writing' },
  { id: 'expressive', label: 'High / Reasoning', value: 1.0, description: 'Maximum variation or o-series fixed temp' }
] as const

export interface OpenAIModelProfile {
  model: string
  idealTemperature: number
  supportsTemperature: boolean
  maxOutputTokens: number
  reasoningEffort?: 'low' | 'medium' | 'high'
  supportsJsonObject: boolean
  summary: string
  verifiedFromApi?: boolean
}

export function resolveOpenAIModelProfile(rawModel: string): OpenAIModelProfile {
  const model = (rawModel || DEFAULT_PROVIDER_MODELS.openai).trim()
  const lower = model.toLowerCase()

  if (/^o[134](-|$)/i.test(lower) || /^gpt-5/i.test(lower)) {
    const isFixedReasoning = /^o[134](-|$)/i.test(lower) || /^gpt-5(-mini|-nano)?$/i.test(lower)
    return {
      model,
      idealTemperature: 1.0,
      supportsTemperature: !isFixedReasoning,
      maxOutputTokens: 16384,
      reasoningEffort: 'medium',
      supportsJsonObject: true,
      summary: isFixedReasoning
        ? 'Reasoning model — temperature locked at 1.0, medium reasoning effort'
        : 'GPT-5 series — ideal at 1.0 with medium reasoning effort'
    }
  }

  if (lower.includes('4o-mini') || lower.includes('4.1-mini') || lower.includes('4.1-nano')) {
    return {
      model,
      idealTemperature: 0.1,
      supportsTemperature: true,
      maxOutputTokens: 8192,
      supportsJsonObject: true,
      summary: 'Fast compact model — ideal at 0.1 (Precise) for reliable structured output'
    }
  }

  if (lower.startsWith('gpt-4.1')) {
    return {
      model,
      idealTemperature: 0.3,
      supportsTemperature: true,
      maxOutputTokens: 16384,
      supportsJsonObject: true,
      summary: 'Flagship coding & instruction model — ideal at 0.3 (Balanced)'
    }
  }

  if (lower.includes('gpt-4o') || lower.includes('chatgpt-4o')) {
    return {
      model,
      idealTemperature: 0.3,
      supportsTemperature: true,
      maxOutputTokens: 8192,
      supportsJsonObject: true,
      summary: 'Flagship multimodal model — ideal at 0.3 (Balanced)'
    }
  }

  if (lower.startsWith('gpt-4-turbo') || lower === 'gpt-4' || lower.startsWith('gpt-4-')) {
    return {
      model,
      idealTemperature: 0.7,
      supportsTemperature: true,
      maxOutputTokens: 4096,
      supportsJsonObject: true,
      summary: 'High-creativity generation model — ideal at 0.7 (Creative)'
    }
  }

  return {
    model,
    idealTemperature: 0.3,
    supportsTemperature: true,
    maxOutputTokens: 8192,
    supportsJsonObject: true,
    summary: 'Standard OpenAI chat profile — ideal at 0.3 (Balanced)'
  }
}

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  ollama: 'Ollama',
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  grok: 'xAI Grok',
  claude: 'Anthropic Claude'
}

export interface OllamaStatus {
  online: boolean
  models: string[]
  error?: string
}

export interface ChatHistoryMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface StoredChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  sectionId?: string
  sectionTitle?: string
}

export interface ProjectChatThread {
  id: string
  title: string
  messages: StoredChatMessage[]
  createdAt: number
  updatedAt: number
}

export interface ProjectChatStore {
  activeThreadId: string
  threads: ProjectChatThread[]
}

export interface AIRequest {
  provider: ProviderId
  model: string
  ollamaHost?: string
  /** Optional sampling temperature (0.0 - 2.0) */
  temperature?: number
  /** true => handwriting or math equation OCR */
  isHandwritingOCR?: boolean
  isEquationOCR?: boolean
  /** true => convert hand-drawn diagram sketch to React Flow diagram */
  isBeautifyDiagram?: boolean
  /** true => convert hand-drawn sketches & handwriting into board-immersed vector shapes/paths + immersed text */
  isVectorizeDrawing?: boolean
  /** true => agentic visual critic pass comparing original sketch vs synthesized vector SVG */
  isVectorizeCritique?: boolean
  /** true => conversational AI chat for the Right Panel */
  isChat?: boolean
  /** Prompt or question */
  prompt?: string
  /** Cropped base64 PNG (no data: prefix) of white-on-black strokes */
  imageBase64?: string
  chatHistory?: ChatHistoryMessage[]
  cursorX?: number
  cursorY?: number
  canvasWidth?: number
  canvasHeight?: number
  /** Compact textual summary of the current board */
  boardContext?: string
  /** Active project ID for project-wide context & sources */
  projectId?: string
  /** Active section/board ID */
  sectionId?: string
  /** Include project-wide sections, materials & source catalog (defaults to true when projectId is set) */
  includeProjectContext?: boolean
  /** Specific Knowledge Studio source IDs explicitly referenced by the user */
  sourceIds?: string[]
  /** Attached files, images or YouTube contexts */
  attachments?: ChatAttachment[]
  /** True if generating an end-to-end structured visual whiteboard tutorial */
  isTutorial?: boolean
  tutorialTopic?: string
}

export interface AINote {
  title?: string
  text: string
  x: number
  y: number
}

export interface AIShape {
  shape: string
  x: number
  y: number
  w: number
  h: number
  label?: string
}

export interface AIResponse {
  ok: boolean
  error?: string
  /** For conversational answers in the Right Panel */
  reply?: string
  /** Transcribed text or LaTeX formula */
  recognizedText?: string
  /** Structured visual whiteboard tutorial if requested */
  tutorial?: TutorialPayload
  /** Grounded citations from attached sources */
  citations?: string[]
  notes?: AINote[]
  shapes?: AIShape[]
}

export interface ChatAttachment {
  id: string
  type: 'file' | 'image' | 'youtube'
  name: string
  url?: string
  mimeType?: string
  textContent?: string
  imageBase64?: string
  tokenEstimate?: number
  metadata?: Record<string, any>
}

export interface KnowledgeSourceItem {
  id: string
  boardId?: string
  title: string
  sourceType: 'file' | 'pdf' | 'youtube' | 'text' | 'board'
  sourceUrl?: string
  rawContent: string
  summary?: string
  tokenCount?: number
  createdAt: number
  isActive?: boolean
}

export interface KnowledgeChunkItem {
  id: string
  sourceId: string
  chunkIndex: number
  chunkText: string
  metadata?: Record<string, any>
}

export interface SearchResultItem {
  chunkId: string
  sourceId: string
  sourceTitle: string
  sourceType: string
  chunkText: string
  metadata?: Record<string, any>
  score: number
}

export interface HistoryEventItem {
  id?: number
  boardId: string
  eventType: 'create' | 'update' | 'delete' | 'connect' | 'recall'
  elementId: string
  description?: string
  timestamp: number
}

export interface ProjectItem {
  id: string
  title: string
  description?: string
  color?: string
  createdAt: number
  updatedAt: number
  sectionCount?: number
  elementCount?: number
}

export interface SectionElementBreakdown {
  notes: number
  diagrams: number
  equations: number
  code: number
  videos: number
  shapes: number
  strokes: number
}

export interface SectionItem {
  id: string
  projectId: string
  title: string
  description?: string
  createdAt: number
  updatedAt: number
  elementCount?: number
  breakdown?: SectionElementBreakdown
  previewText?: string
}

export interface OverallHistoryEntry {
  id: string
  entryType: 'element' | 'event' | 'source'
  kind: string
  title: string
  snippet?: string
  boardId: string
  sectionTitle?: string
  projectId?: string
  projectTitle?: string
  projectColor?: string
  timestamp: number
}

export interface OverallHistorySummary {
  totalProjects: number
  totalSections: number
  totalElements: number
  totalNotes: number
  totalDiagrams: number
  totalEquations: number
  totalCode: number
  totalVideos: number
  totalSources: number
  entries: OverallHistoryEntry[]
}

export interface TutorialStep {
  title: string
  explanation: string
  keyPoints?: string[]
  equations?: string[]
  equationLatex?: string
  scene?: unknown
  diagramMermaid?: string
  diagramNodes?: any[]
  diagramEdges?: any[]
  codeSnippet?: { language: string; code: string } | null
}

export interface TutorialPayload {
  topic: string
  overview: string
  approach?: string
  pedagogicalRationale?: string
  fontFamily?: string
  accentFill?: string
  steps: TutorialStep[]
}

export interface DetachedChatAction {
  type:
    | 'insertToNotes'
    | 'insertDiagram'
    | 'settingsUpdated'
    | 'openKnowledgeHub'
    | 'generateTutorial'
    | 'addYouTubeToCanvas'
  text?: string
  title?: string
  topic?: string
  url?: string
  ai?: any
}

export interface CodeExecutionRequest {
  language: string
  code: string
  stdin?: string
  timeoutMs?: number
  filename?: string
}

export interface CodeExecutionResult {
  ok: boolean
  stdout: string
  stderr: string
  exitCode: number | null
  durationMs: number
  language: string
  command?: string
  timedOut?: boolean
  error?: string
}

export interface CodeRuntimeInfo {
  id: string
  available: boolean
  command: string
  version?: string
}

export interface GlassAPI {
  checkOllama: (host?: string) => Promise<OllamaStatus>
  saveKey: (provider: ByokProvider, apiKey: string) => Promise<boolean>
  hasKey: (provider: ByokProvider) => Promise<boolean>
  deleteKey: (provider: ByokProvider) => Promise<boolean>
  isEncryptionAvailable: () => Promise<boolean>
  getOpenAIModelConfig: (model: string) => Promise<OpenAIModelProfile>
  runAI: (request: AIRequest) => Promise<AIResponse>
  smartBeautify?: (request: SmartBeautifyRequest) => Promise<SmartBeautifyResponse>
  smartBeautifyCritique?: (request: VectorCritiqueRequest) => Promise<VectorCritiqueResponse>
  runCode?: (request: CodeExecutionRequest) => Promise<CodeExecutionResult>
  checkCodeRuntimes?: () => Promise<Record<string, CodeRuntimeInfo>>
  saveExportFile?: (filename: string, content: string, mimeType: string) => Promise<{ success: boolean; filePath?: string }>
  printToPdf?: () => Promise<string | null>
  setMode: (mode: DisplayMode) => Promise<DisplayMode>
  setClickThrough: (enabled: boolean) => Promise<boolean>
  onClickThroughChanged: (callback: (enabled: boolean) => void) => () => void
  minimize: () => void
  maximize: () => void
  close: () => void
  isMaximized?: () => Promise<boolean>
  onMaximizedChanged?: (callback: (isMaximized: boolean) => void) => () => void
  hasNativeWindowControls?: boolean
  platform?: string
  openDetachedChat?: () => Promise<boolean>
  toggleDetachedChat?: () => Promise<boolean>
  closeDetachedChat?: () => Promise<boolean>
  isDetachedChat?: () => Promise<boolean>
  onDetachedChatChanged?: (callback: (isDetached: boolean) => void) => () => void
  sendDetachedAction?: (action: DetachedChatAction) => void
  onDetachedAction?: (callback: (action: DetachedChatAction) => void) => () => void
  minimizeDetached?: () => void
  maximizeDetached?: () => void
  closeDetached?: () => void
  resizeDetachedWindow?: (width: number, height: number) => void

  // Media, YouTube & Document parsing
  fetchYouTubeInfo?: (url: string) => Promise<any>
  openFileDialogAndParse?: () => Promise<any>
  parseFileBuffer?: (fileName: string, base64Data: string) => Promise<any>

  // Local SQLite & Vector Knowledge Store
  saveKnowledgeSource?: (source: KnowledgeSourceItem, chunks: KnowledgeChunkItem[]) => Promise<{ ok: boolean }>
  indexKnowledgeFilesFromDialog?: (boardId?: string) => Promise<{
    ok: boolean
    canceled?: boolean
    indexed: Array<{ source: KnowledgeSourceItem; chunkCount: number }>
    errors?: string[]
  }>
  getKnowledgeSources?: (boardId?: string, projectId?: string) => Promise<KnowledgeSourceItem[]>
  deleteKnowledgeSource?: (sourceId: string) => Promise<{ ok: boolean; deletedChunks?: number }>
  hybridSearch?: (query: string, opts?: { sourceIds?: string[]; limit?: number }) => Promise<SearchResultItem[]>

  // Board Database Persistence & Spatial Memory
  saveBoardStore?: (
    boardId: string,
    title: string,
    elements: Array<{ id: string; kind: string; x: number; y: number; w?: number; h?: number; text?: string; raw: any }>
  ) => Promise<{ ok: boolean }>
  getBoardStore?: (boardId: string) => Promise<any[]>
  recordHistoryEvent?: (event: HistoryEventItem) => Promise<void>
  getHistoryEvents?: (boardId: string, limit?: number) => Promise<HistoryEventItem[]>

  // Projects, Sections & Overall History
  listProjects?: () => Promise<ProjectItem[]>
  createProject?: (project: { id: string; title: string; description?: string; color?: string }) => Promise<ProjectItem>
  updateProject?: (
    projectId: string,
    patch: { title?: string; description?: string; color?: string }
  ) => Promise<ProjectItem | null>
  deleteProject?: (projectId: string) => Promise<{ ok: boolean }>
  listSections?: (projectId?: string) => Promise<SectionItem[]>
  createSection?: (section: { id: string; projectId: string; title: string; description?: string }) => Promise<SectionItem>
  updateSection?: (
    sectionId: string,
    patch: { title?: string; description?: string }
  ) => Promise<SectionItem | null>
  deleteSection?: (sectionId: string) => Promise<{ ok: boolean }>
  getOverallHistory?: (limit?: number) => Promise<OverallHistorySummary>
  getProjectChat?: (projectId: string) => Promise<StoredChatMessage[]>
  saveProjectChat?: (projectId: string, messages: StoredChatMessage[]) => Promise<{ ok: boolean }>
  getProjectChatStore?: (projectId: string) => Promise<ProjectChatStore>
  saveProjectChatStore?: (projectId: string, store: ProjectChatStore) => Promise<{ ok: boolean }>

  // Multi-Step AI Agent Harness
  runAgent?: (req: AgentRunRequest) => Promise<AgentRunResult>
  cancelAgent?: (runId: string) => Promise<{ ok: boolean }>
  onAgentEvent?: (callback: (event: AgentStepEvent) => void) => () => void
}
