import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AgentBoardMutationSchema,
  type AgentBoardMutation,
  type AgentBoardSnapshot
} from '../shared/agentSchema'
import { SpatialSceneSchema, normalizeSpatialSceneInput } from '../shared/beautifySchema'
import { normalizeScene3DInput } from '../shared/scene3dSchema'
import type {
  CompanionBridgeStatus,
  CompanionSelectionCapturePayload,
  CompanionSelectionCaptureResult
} from '../shared/ipc'
import { listAllSkills } from './skillManager'

export interface CompanionDbProvider {
  getBoardElements: (boardId: string) => any[]
  hybridSearch: (query: string, opts?: { sourceIds?: string[]; limit?: number }) => any[]
  listProjects: () => any[]
  listSections: (projectId?: string) => any[]
}

export interface CompanionStartOptions {
  onMutations: (mutations: AgentBoardMutation[], source?: string) => boolean
  db?: CompanionDbProvider
  webSearchFn?: (query: string, opts?: { limit?: number; category?: any }) => Promise<any>
  bridgeFilePath?: string
  captureDir?: string
  requestLiveSelectionCapture?: () => Promise<CompanionSelectionCapturePayload | null>
}

const DEFAULT_PORTS = [45789, 45790, 45791, 45792, 45793, 45794, 45795]
const MAX_BODY_BYTES = 2 * 1024 * 1024

let activeServer: Server | null = null
let activePort = 0
let latestSnapshot: AgentBoardSnapshot | null = null
let mutationDispatcher: ((mutations: AgentBoardMutation[], source?: string) => boolean) | null = null
let customDbProvider: CompanionDbProvider | null = null
let customWebSearchFn: CompanionStartOptions['webSearchFn'] | null = null
let activeBridgeFilePath = join(homedir(), '.vexelboard-bridge.json')
let activeCaptureDir = join(tmpdir(), 'vexelboard-companion-captures')
let latestSelectionCapture: CompanionSelectionCaptureResult | null = null
let liveSelectionCaptureRequester: CompanionStartOptions['requestLiveSelectionCapture'] | null = null

function cleanPngBase64(raw: string): string {
  return raw.replace(/^data:image\/[^;]+;base64,/i, '').trim()
}

export function saveCompanionSelectionCapture(
  payload: CompanionSelectionCapturePayload,
  captureDirOverride?: string
): CompanionSelectionCaptureResult {
  const dir = captureDirOverride || activeCaptureDir
  if (captureDirOverride) {
    activeCaptureDir = captureDirOverride
  }

  const selectedIds = Array.isArray(payload.selectedIds) ? payload.selectedIds : []
  if (!payload.ok || !payload.base64Png) {
    const failed: CompanionSelectionCaptureResult = {
      ok: false,
      boardId: payload.boardId,
      projectId: payload.projectId,
      selectedIds,
      selectedCount: selectedIds.length,
      selectionBounds: payload.selectionBounds,
      error:
        payload.error ||
        (selectedIds.length === 0
          ? 'No elements are currently selected on the active Vexelboard canvas.'
          : 'Failed to rasterize current selection.')
    }
    if (selectedIds.length === 0) {
      latestSelectionCapture = null
    }
    return failed
  }

  mkdirSync(dir, { recursive: true })
  const filePath = join(dir, 'latest-selection.png')
  const cleanB64 = cleanPngBase64(payload.base64Png)
  writeFileSync(filePath, Buffer.from(cleanB64, 'base64'))

  const saved: CompanionSelectionCaptureResult = {
    ok: true,
    boardId: payload.boardId,
    projectId: payload.projectId,
    selectedIds,
    selectedCount: selectedIds.length,
    selectionBounds: payload.selectionBounds,
    filePath,
    mimeType: 'image/png',
    width: payload.width,
    height: payload.height,
    base64Png: cleanB64,
    elementSummary: payload.elementSummary,
    capturedAt: Date.now()
  }
  latestSelectionCapture = saved
  return saved
}

export async function captureSelectionForCompanion(opts?: {
  includeBase64?: boolean
}): Promise<CompanionSelectionCaptureResult> {
  const includeBase64 = Boolean(opts?.includeBase64)
  const formatOut = (res: CompanionSelectionCaptureResult): CompanionSelectionCaptureResult => {
    if (includeBase64) return res
    const { base64Png: _omitted, ...meta } = res
    return meta
  }

  if (liveSelectionCaptureRequester) {
    try {
      const livePayload = await liveSelectionCaptureRequester()
      if (livePayload) {
        const saved = saveCompanionSelectionCapture(livePayload)
        if (saved.ok) {
          return formatOut(saved)
        }
        if (
          latestSelectionCapture?.ok &&
          latestSelectionCapture.filePath &&
          existsSync(latestSelectionCapture.filePath) &&
          livePayload.selectedIds.length > 0 &&
          latestSelectionCapture.selectedIds.join(',') === livePayload.selectedIds.join(',')
        ) {
          return formatOut(latestSelectionCapture)
        }
        return formatOut(saved)
      }
    } catch {
      // fall through to cached capture if live IPC timed out
    }
  }

  if (
    latestSelectionCapture?.ok &&
    latestSelectionCapture.filePath &&
    existsSync(latestSelectionCapture.filePath)
  ) {
    return formatOut(latestSelectionCapture)
  }

  return {
    ok: false,
    selectedIds: latestSnapshot?.selectedIds ?? [],
    selectedCount: latestSnapshot?.selectedIds?.length ?? 0,
    selectionBounds: latestSnapshot?.selectionBounds,
    error:
      'No captured selection PNG available. Select elements on the Vexelboard canvas (or click Antigravity on the selection bar) and retry.'
  }
}

async function getDb(): Promise<CompanionDbProvider> {
  if (customDbProvider) return customDbProvider
  const mod = await import('./db')
  return mod.dbManager
}

async function runWebSearch(
  query: string,
  opts?: { limit?: number; category?: any }
): Promise<any> {
  if (customWebSearchFn) return customWebSearchFn(query, opts)
  const mod = await import('./webSearch')
  return mod.webSearch(query, opts ?? {})
}

export function updateCompanionSnapshot(snapshot: AgentBoardSnapshot): void {
  latestSnapshot = snapshot
}

export function getCompanionStatus(): CompanionBridgeStatus {
  const baseUrl = activePort > 0 ? `http://127.0.0.1:${activePort}` : 'http://127.0.0.1:45789'
  return {
    running: Boolean(activeServer && activePort > 0),
    port: activePort,
    baseUrl,
    mcpUrl: `${baseUrl}/mcp`,
    bridgeFilePath: activeBridgeFilePath,
    activeSectionId: latestSnapshot?.boardId,
    activeProjectId: latestSnapshot?.projectId
  }
}

function isLoopbackAddress(addr?: string): boolean {
  if (!addr) return false
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'
}

function isAllowedHostAndOrigin(req: IncomingMessage): boolean {
  const host = String(req.headers.host || '').toLowerCase()
  if (!host.startsWith('127.0.0.1') && !host.startsWith('localhost')) {
    return false
  }
  const origin = req.headers.origin
  if (origin !== undefined) {
    const o = String(origin).toLowerCase()
    if (
      o !== 'null' &&
      !o.startsWith('file://') &&
      !o.startsWith('http://127.0.0.1') &&
      !o.startsWith('http://localhost')
    ) {
      return false
    }
  }
  return true
}

class ClientRequestError extends Error {
  readonly statusCode: number
  readonly safeMessage: string

  constructor(safeMessage: string, statusCode = 400) {
    super(safeMessage)
    this.name = 'ClientRequestError'
    this.statusCode = statusCode
    this.safeMessage = safeMessage
  }
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  })
  res.end(body)
}

async function readJsonBody(req: IncomingMessage): Promise<any> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    req.on('data', (chunk: Buffer) => {
      total += chunk.byteLength
      if (total > MAX_BODY_BYTES) {
        reject(new ClientRequestError('Request body too large', 413))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks, total).toString('utf8').trim()
      if (!text) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(text))
      } catch {
        reject(new ClientRequestError('Invalid JSON body', 400))
      }
    })
    req.on('error', () => {
      reject(new ClientRequestError('Failed to read request body', 400))
    })
  })
}

function validateMutationsPayload(raw: any): AgentBoardMutation[] {
  const rawList = Array.isArray(raw?.mutations)
    ? [...raw.mutations]
    : raw && typeof raw === 'object' && typeof raw.type === 'string'
      ? [raw]
      : []

  const replaceIds = Array.isArray(raw?.replaceElementIds)
    ? raw.replaceElementIds.map((id: any) => String(id || '').trim()).filter(Boolean)
    : []
  if (replaceIds.length > 0 && !rawList.some((item) => item?.type === 'delete_elements')) {
    rawList.unshift({ type: 'delete_elements', elementIds: replaceIds })
  }

  const valid: AgentBoardMutation[] = []
  for (const item of rawList) {
    if (item && item.type === 'add_spatial_scene' && item.scene) {
      item.scene = normalizeSpatialSceneInput(item.scene)
    }
    if (item && item.type === 'add_3d_scene') {
      item.scene = normalizeScene3DInput(
        item.scene ?? { preset: item.preset || 'car', title: item.title, immersed: item.immersed }
      )
    }
    if (item && item.type === 'add_reactflow_diagram' && Array.isArray(item.edges)) {
      item.edges = item.edges.map((e: any, idx: number) => ({
        ...e,
        id: e?.id ? String(e.id) : `edge-${idx + 1}`,
        source: String(e?.source ?? e?.from ?? ''),
        target: String(e?.target ?? e?.to ?? '')
      }))
    }
    const parsed = AgentBoardMutationSchema.safeParse(item)
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
      throw new ClientRequestError(`Invalid mutation payload (${issues})`, 400)
    }
    valid.push(parsed.data)
  }
  if (valid.length === 0) {
    throw new ClientRequestError('Expected at least one valid mutation item', 400)
  }
  return valid
}

const MCP_TOOLS = [
  {
    name: 'vexelboard_status',
    description: 'Check Vexelboard companion bridge status, active board/project ID, and skill count.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'vexelboard_inspect_board',
    description: 'Inspect notes, diagrams, code cards, 2D/3D graph cards, 3D scenes, equations, videos, selection bounds, and layers on the active Vexelboard whiteboard.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'vexelboard_capture_selection',
    description:
      'Capture the currently selected strokes, shapes, or sketch on the Vexelboard canvas as a PNG image on disk (filePath) plus MCP image block, selectionBounds, and selectedIds so you can vectorize or refine it.',
    inputSchema: {
      type: 'object',
      properties: {
        includeBase64: { type: 'boolean' }
      }
    }
  },
  {
    name: 'vexelboard_delete_elements',
    description: 'Delete specific canvas element IDs (such as raw hand-drawn stroke IDs from selectedIds). Supports undo.',
    inputSchema: {
      type: 'object',
      properties: {
        elementIds: { type: 'array', items: { type: 'string' } }
      },
      required: ['elementIds']
    }
  },
  {
    name: 'vexelboard_add_note',
    description: 'Place a structured Markdown sticky note onto an empty area of the Vexelboard canvas.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        content: { type: 'string' },
        color: { type: 'string' }
      },
      required: ['content']
    }
  },
  {
    name: 'vexelboard_create_diagram',
    description: 'Create a connected flowchart, architecture, ERD, mindmap, or sequence diagram on the Vexelboard canvas (optionally replacing selected strokes in place).',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        diagramType: { type: 'string', enum: ['flowchart', 'mindmap', 'architecture', 'erd', 'sequence', 'concept'] },
        direction: { type: 'string', enum: ['TB', 'LR'] },
        animated: { type: 'boolean' },
        nodes: { type: 'array', items: { type: 'object' } },
        edges: { type: 'array', items: { type: 'object' } },
        x: { type: 'number' },
        y: { type: 'number' },
        replaceElementIds: { type: 'array', items: { type: 'string' } }
      },
      required: ['title', 'nodes']
    }
  },
  {
    name: 'vexelboard_create_vector_scene',
    description: 'Compose a SpatialScene 2D vector illustration (shapes, svg_path Bezier contours, curved connectors, cell_strips, text) on the board (optionally replacing selected strokes in place).',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        scene: { type: 'object' },
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number' },
        height: { type: 'number' },
        replaceElementIds: { type: 'array', items: { type: 'string' } }
      },
      required: ['scene']
    }
  },
  {
    name: 'vexelboard_add_equation',
    description: 'Add a rendered KaTeX LaTeX equation card onto an empty area of the board.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        latex: { type: 'string' }
      },
      required: ['latex']
    }
  },
  {
    name: 'vexelboard_create_graph',
    description:
      'Create a unified movable/resizable Plotly/GeoGebra 2D or 3D Graph Card (or update an existing one when `cardId` is passed). Supports 16 chart types: function, line, smooth, area, bar, histogram, scatter, pie, violin, box, candlestick, heatmap, surface3d, scatter3d, line3d, bar3d. Pass `data` as any hashmap ({x, y}, {x, y, z}, 1D {x}, stock OHLC {x, open, high, low, close}, {expr}, {expr3d}, {series}) plus styling options (axisColor, gridColor, backgroundColor, textColor, legendPosition, axisStyle, bins, showKde, donut). Pass deterministic `id` to wire from Code Cards in the same batch.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        cardId: { type: 'string' },
        title: { type: 'string' },
        chartType: {
          type: 'string',
          enum: [
            'function', 'line', 'smooth', 'area', 'bar', 'histogram', 'scatter',
            'pie', 'violin', 'box', 'candlestick', 'heatmap',
            'surface3d', 'scatter3d', 'line3d', 'bar3d'
          ]
        },
        data: { type: 'object' },
        spec: { type: 'object' },
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number' },
        height: { type: 'number' },
        replaceElementIds: { type: 'array', items: { type: 'string' } }
      }
    }
  },
  {
    name: 'vexelboard_create_3d_scene',
    description:
      'Render an interactive 3D object, mathematical surface, or experimental setup directly immersed onto the Vexelboard canvas (e.g. preset car, optics_bench, mechanics_rig, chemistry_setup, electromagnetism, surface_wave, OR custom 3D elements composed of box, sphere, cylinder, cone, torus, wheel, spring, lens, prism, flask, plane, arrow3d, curve3d, surface3d, mesh, label3d). Pass deterministic `id` to wire with Code Cards via vexelboard_connect_elements.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        preset: { type: 'string' },
        scene: { type: 'object' },
        immersed: { type: 'boolean' },
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number' },
        height: { type: 'number' },
        replaceElementIds: { type: 'array', items: { type: 'string' } }
      }
    }
  },
  {
    name: 'vexelboard_add_code_card',
    description:
      'Create a runnable Code Card (or patch an existing one when cardId is passed) on the board. Python Code Cards automatically capture returned/assigned hashmaps ({"x": ..., "y": ...}, 3D {"x", "y", "z"}, stock OHLC) and receive connected upstream data via `def transform(data):` or `INPUT`/`DATA` without sys.stdin/json boilerplate. Pass deterministic `id` to wire stages or Graphs/3D Scenes via vexelboard_connect_elements.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        cardId: { type: 'string' },
        title: { type: 'string' },
        language: { type: 'string' },
        code: { type: 'string' },
        pipelineMode: { type: 'boolean' },
        tabs: { type: 'array', items: { type: 'object' } }
      },
      required: ['language', 'code']
    }
  },
  {
    name: 'vexelboard_connect_elements',
    description:
      'Draw a bound flowchart connector arrow between two board elements (Code Cards, unified Graph Cards, 3D Scenes, or Shapes). Connecting Code -> Code pipes outputs to `data`/`INPUT`/`stdin`; connecting Code -> Graph/3D live-updates the visual whenever the upstream Code Card runs.',
    inputSchema: {
      type: 'object',
      properties: {
        sourceId: { type: 'string' },
        targetId: { type: 'string' },
        sourcePort: { type: 'string', enum: ['top', 'right', 'bottom', 'left'] },
        targetPort: { type: 'string', enum: ['top', 'right', 'bottom', 'left'] },
        routing: { type: 'string', enum: ['orthogonal', 'curved', 'straight'] },
        color: { type: 'string' },
        label: { type: 'string' },
        animated: { type: 'boolean' }
      },
      required: ['sourceId', 'targetId']
    }
  },
  {
    name: 'vexelboard_search_knowledge',
    description: 'Run hybrid vector + FTS5 keyword search over indexed PDFs, docs, and YouTube transcripts in Knowledge Studio.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number' }
      },
      required: ['query']
    }
  }
]

async function executeMcpToolCall(
  toolName: string,
  args: Record<string, any>
): Promise<{ ok: boolean; [k: string]: any }> {
  const pushAndReply = (mutations: AgentBoardMutation[], label: string): { ok: boolean; [k: string]: any } => {
    const delivered = mutationDispatcher ? mutationDispatcher(mutations, 'mcp') : false
    return {
      ok: true,
      queuedCount: mutations.length,
      windowActive: delivered,
      message: delivered
        ? `Added ${label} to the live Vexelboard canvas.`
        : `Validated ${label} (${mutations.length} mutation(s)), but no active board window is open yet.`
    }
  }

  switch (toolName) {
    case 'vexelboard_status':
      return { ok: true, ...getCompanionStatus(), skillsCount: listAllSkills().length }

    case 'vexelboard_inspect_board': {
      if (latestSnapshot) {
        return { ok: true, source: 'live-window', board: latestSnapshot }
      }
      const db = await getDb()
      const sections = db.listSections()
      const latestSection = sections[0]
      const elements = latestSection ? db.getBoardElements(latestSection.id) : []
      return {
        ok: true,
        source: 'sqlite',
        section: latestSection ?? null,
        elementsCount: elements.length,
        elements: elements.slice(0, 40)
      }
    }

    case 'vexelboard_capture_selection': {
      return await captureSelectionForCompanion({
        includeBase64: args.includeBase64 !== false
      })
    }

    case 'vexelboard_delete_elements': {
      const m = validateMutationsPayload({
        type: 'delete_elements',
        elementIds: Array.isArray(args.elementIds) ? args.elementIds : []
      })
      return pushAndReply(m, `deletion of ${m[0]?.type === 'delete_elements' ? m[0].elementIds.length : 0} element(s)`)
    }

    case 'vexelboard_add_note': {
      const m = validateMutationsPayload({
        type: 'add_note',
        title: args.title,
        content: args.content,
        color: args.color
      })
      return pushAndReply(m, `note "${args.title || 'Note'}"`)
    }

    case 'vexelboard_create_diagram': {
      const cleanEdges = Array.isArray(args.edges)
        ? args.edges.map((e: any, idx: number) => ({
            id: e.id || `edge-${idx + 1}`,
            source: e.source || e.from || '',
            target: e.target || e.to || '',
            label: e.label,
            style: e.style,
            animated: e.animated ?? args.animated
          }))
        : []
      const m = validateMutationsPayload({
        replaceElementIds: args.replaceElementIds,
        mutations: [
          {
            type: 'add_reactflow_diagram',
            title: args.title || 'Diagram',
            diagramType: args.diagramType || 'flowchart',
            direction: args.direction || 'TB',
            animated: Boolean(args.animated),
            nodes: args.nodes || [],
            edges: cleanEdges,
            x: typeof args.x === 'number' ? args.x : undefined,
            y: typeof args.y === 'number' ? args.y : undefined
          }
        ]
      })
      return pushAndReply(m, `diagram "${args.title || 'Diagram'}"`)
    }

    case 'vexelboard_create_vector_scene': {
      const normalized = normalizeSpatialSceneInput(args.scene)
      const checked = SpatialSceneSchema.safeParse(normalized)
      if (!checked.success) {
        return {
          ok: false,
          error: checked.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
        }
      }
      const m = validateMutationsPayload({
        replaceElementIds: args.replaceElementIds,
        mutations: [
          {
            type: 'add_spatial_scene',
            title: args.title || checked.data.title,
            scene: checked.data,
            x: typeof args.x === 'number' ? args.x : undefined,
            y: typeof args.y === 'number' ? args.y : undefined,
            width: args.width,
            height: args.height
          }
        ]
      })
      return pushAndReply(m, `vector scene "${args.title || checked.data.title || 'Scene'}"`)
    }

    case 'vexelboard_create_graph': {
      const m = validateMutationsPayload({
        replaceElementIds: args.replaceElementIds,
        mutations: [
          {
            type: 'add_graph_card',
            ...(typeof args.id === 'string' && args.id.trim() ? { id: args.id.trim() } : {}),
            ...(typeof args.cardId === 'string' && args.cardId.trim() ? { cardId: args.cardId.trim() } : {}),
            title: args.title,
            chartType: args.chartType,
            data: args.data,
            spec: args.spec,
            x: typeof args.x === 'number' ? args.x : undefined,
            y: typeof args.y === 'number' ? args.y : undefined,
            width: typeof args.width === 'number' ? args.width : undefined,
            height: typeof args.height === 'number' ? args.height : undefined
          }
        ]
      })
      return pushAndReply(m, `graph "${args.title || args.chartType || 'Graph'}"`)
    }

    case 'vexelboard_create_3d_scene': {
      const normalized = normalizeScene3DInput(
        args.scene ?? { preset: args.preset || 'car', title: args.title, immersed: args.immersed }
      )
      const m = validateMutationsPayload({
        replaceElementIds: args.replaceElementIds,
        mutations: [
          {
            type: 'add_3d_scene',
            ...(typeof args.id === 'string' && args.id.trim() ? { id: args.id.trim() } : {}),
            title: args.title || normalized.title,
            preset: normalized.preset,
            scene: normalized,
            immersed: args.immersed ?? true,
            x: typeof args.x === 'number' ? args.x : undefined,
            y: typeof args.y === 'number' ? args.y : undefined,
            width: args.width,
            height: args.height
          }
        ]
      })
      return pushAndReply(m, `3D scene "${args.title || normalized.title || '3D Scene'}"`)
    }

    case 'vexelboard_add_equation': {
      const m = validateMutationsPayload({
        type: 'add_equation',
        title: args.title,
        latex: args.latex
      })
      return pushAndReply(m, `equation`)
    }

    case 'vexelboard_add_code_card': {
      if (args.cardId) {
        const m = validateMutationsPayload({
          type: 'patch_code_card',
          cardId: String(args.cardId),
          title: args.title,
          language: args.language,
          code: args.code
        })
        return pushAndReply(m, `code patch for ${args.cardId}`)
      }
      const m = validateMutationsPayload({
        type: 'add_code_card',
        ...(typeof args.id === 'string' && args.id.trim() ? { id: args.id.trim() } : {}),
        title: args.title || `snippet.${args.language || 'py'}`,
        language: args.language || 'python',
        code: args.code,
        pipelineMode: args.pipelineMode,
        tabs: args.tabs
      })
      return pushAndReply(m, `code card "${args.title || 'Snippet'}"`)
    }

    case 'vexelboard_connect_elements': {
      const m = validateMutationsPayload({
        type: 'add_connector',
        sourceId: String(args.sourceId),
        targetId: String(args.targetId),
        sourcePort: args.sourcePort,
        targetPort: args.targetPort,
        routing: args.routing,
        color: args.color,
        label: args.label,
        animated: args.animated
      })
      return pushAndReply(m, `connector ${args.sourceId} → ${args.targetId}`)
    }

    case 'vexelboard_search_knowledge': {
      const db = await getDb()
      const hits = db.hybridSearch(String(args.query || ''), {
        limit: typeof args.limit === 'number' ? args.limit : 6
      })
      return { ok: true, count: hits.length, hits }
    }

    default:
      return { ok: false, error: `Unknown MCP tool "${toolName}"` }
  }
}

async function handleJsonRpcMessage(msg: any): Promise<any | null> {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') {
    return {
      jsonrpc: '2.0',
      id: msg?.id ?? null,
      error: { code: -32600, message: 'Invalid JSON-RPC 2.0 request' }
    }
  }

  const hasId = msg.id !== undefined && msg.id !== null
  const method = String(msg.method || '')

  // Notification (no id)
  if (!hasId) {
    return null
  }

  try {
    switch (method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            protocolVersion: '2025-03-26',
            capabilities: { tools: {} },
            serverInfo: { name: 'vexelboard-companion', version: '1.0.0' }
          }
        }
      case 'ping':
        return { jsonrpc: '2.0', id: msg.id, result: {} }
      case 'tools/list':
        return { jsonrpc: '2.0', id: msg.id, result: { tools: MCP_TOOLS } }
      case 'tools/call': {
        const toolName = String(msg.params?.name || '')
        const toolArgs = (msg.params?.arguments && typeof msg.params.arguments === 'object'
          ? msg.params.arguments
          : {}) as Record<string, any>
        const out = await executeMcpToolCall(toolName, toolArgs)
        if (toolName === 'vexelboard_capture_selection' && out.ok && typeof out.base64Png === 'string') {
          const { base64Png, ...metaWithoutBase64 } = out
          return {
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              content: [
                { type: 'text', text: JSON.stringify(metaWithoutBase64, null, 2) },
                { type: 'image', data: base64Png, mimeType: 'image/png' }
              ],
              isError: false
            }
          }
        }
        return {
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(out, null, 2) }],
            isError: !out.ok
          }
        }
      }
      default:
        return {
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32601, message: `Method not found: ${method}` }
        }
    }
  } catch (err) {
    if (err instanceof ClientRequestError) {
      return {
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: -32602, message: err.safeMessage }
      }
    }
    console.warn('[CompanionServer] JSON-RPC error:', err)
    return {
      jsonrpc: '2.0',
      id: msg.id,
      error: { code: -32603, message: 'Internal error' }
    }
  }
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!isLoopbackAddress(req.socket.remoteAddress) || !isAllowedHostAndOrigin(req)) {
    sendJson(res, 403, { ok: false, error: 'Forbidden: loopback clients only' })
    return
  }

  const parsedUrl = new URL(req.url || '/', 'http://127.0.0.1')
  const pathname = parsedUrl.pathname
  const method = (req.method || 'GET').toUpperCase()

  try {
    if (pathname === '/mcp') {
      if (method === 'GET') {
        const accept = String(req.headers.accept || '')
        if (accept.includes('application/json')) {
          sendJson(res, 200, { ok: true, mcp: true, ...getCompanionStatus() })
        } else {
          res.writeHead(405, { Allow: 'POST, GET' })
          res.end()
        }
        return
      }
      if (method === 'POST') {
        const payload = await readJsonBody(req)
        if (Array.isArray(payload)) {
          const responses = (await Promise.all(payload.map(handleJsonRpcMessage))).filter(Boolean)
          if (responses.length === 0) {
            res.writeHead(202)
            res.end()
          } else {
            sendJson(res, 200, responses)
          }
          return
        }
        const single = await handleJsonRpcMessage(payload)
        if (!single) {
          res.writeHead(202)
          res.end()
          return
        }
        sendJson(res, 200, single)
        return
      }
      res.writeHead(405, { Allow: 'POST, GET' })
      res.end()
      return
    }

    if (method === 'GET' && pathname === '/api/status') {
      sendJson(res, 200, {
        ok: true,
        app: 'Vexelboard',
        ...getCompanionStatus(),
        hasLiveWindow: Boolean(latestSnapshot),
        skillsCount: listAllSkills().length
      })
      return
    }

    if (method === 'GET' && pathname === '/api/skills') {
      sendJson(res, 200, { ok: true, skills: listAllSkills() })
      return
    }

    if (method === 'GET' && pathname === '/api/board') {
      if (latestSnapshot) {
        sendJson(res, 200, { ok: true, source: 'live-window', board: latestSnapshot })
        return
      }
      const db = await getDb()
      const sections = db.listSections()
      const latestSection = sections[0]
      const elements = latestSection ? db.getBoardElements(latestSection.id) : []
      sendJson(res, 200, {
        ok: true,
        source: 'sqlite',
        section: latestSection ?? null,
        elements
      })
      return
    }

    if (method === 'GET' && pathname === '/api/selection-image') {
      const includeBase64 = parsedUrl.searchParams.get('includeBase64') === '1'
      const captured = await captureSelectionForCompanion({ includeBase64 })
      sendJson(res, 200, captured)
      return
    }

    if (method === 'GET' && pathname === '/api/projects') {
      const db = await getDb()
      sendJson(res, 200, {
        ok: true,
        projects: db.listProjects(),
        sections: db.listSections()
      })
      return
    }

    if (method === 'POST' && pathname === '/api/board/mutate') {
      const body = await readJsonBody(req)
      const mutations = validateMutationsPayload(body)
      const windowActive = mutationDispatcher
        ? mutationDispatcher(mutations, body.source || 'companion-rest')
        : false
      sendJson(res, 200, {
        ok: true,
        queuedCount: mutations.length,
        windowActive
      })
      return
    }

    if (method === 'POST' && pathname === '/api/knowledge/search') {
      const body = await readJsonBody(req)
      const query = String(body.query || '').trim()
      if (!query) {
        sendJson(res, 400, { ok: false, error: 'Missing query parameter' })
        return
      }
      const db = await getDb()
      const hits = db.hybridSearch(query, {
        sourceIds: Array.isArray(body.sourceIds) ? body.sourceIds : undefined,
        limit: typeof body.limit === 'number' ? body.limit : 6
      })
      sendJson(res, 200, { ok: true, count: hits.length, hits })
      return
    }

    if (method === 'POST' && pathname === '/api/web-search') {
      const body = await readJsonBody(req)
      const query = String(body.query || '').trim()
      if (!query) {
        sendJson(res, 400, { ok: false, error: 'Missing query parameter' })
        return
      }
      const out = await runWebSearch(query, {
        limit: typeof body.limit === 'number' ? body.limit : 6,
        category: body.category
      })
      sendJson(res, 200, out)
      return
    }

    sendJson(res, 404, { ok: false, error: `Unknown endpoint: ${method} ${pathname}` })
  } catch (err) {
    if (err instanceof ClientRequestError) {
      sendJson(res, err.statusCode, { ok: false, error: err.safeMessage })
      return
    }
    console.warn('[CompanionServer] Request error:', err)
    sendJson(res, 500, { ok: false, error: 'Internal server error' })
  }
}

export async function startCompanionServer(
  opts: CompanionStartOptions
): Promise<CompanionBridgeStatus> {
  mutationDispatcher = opts.onMutations
  customDbProvider = opts.db ?? null
  customWebSearchFn = opts.webSearchFn ?? null
  liveSelectionCaptureRequester = opts.requestLiveSelectionCapture ?? null
  if (opts.bridgeFilePath) activeBridgeFilePath = opts.bridgeFilePath
  if (opts.captureDir) activeCaptureDir = opts.captureDir

  if (activeServer && activePort > 0) {
    return getCompanionStatus()
  }

  for (const candidatePort of DEFAULT_PORTS) {
    const bound = await new Promise<boolean>((resolveBind) => {
      const server = createServer((req, res) => {
        void handleRequest(req, res)
      })
      server.once('error', () => {
        server.close()
        resolveBind(false)
      })
      server.listen(candidatePort, '127.0.0.1', () => {
        activeServer = server
        activePort = candidatePort
        resolveBind(true)
      })
    })
    if (bound) break
  }

  if (activeServer && activePort > 0) {
    const status = getCompanionStatus()
    try {
      writeFileSync(
        activeBridgeFilePath,
        JSON.stringify(
          {
            port: status.port,
            baseUrl: status.baseUrl,
            mcpUrl: status.mcpUrl,
            pid: process.pid,
            updatedAt: Date.now()
          },
          null,
          2
        ),
        'utf8'
      )
    } catch {
      // ignore non-fatal bridge file write failure
    }
    console.log(`[CompanionBridge] Listening at ${status.baseUrl} (MCP: ${status.mcpUrl})`)
    return status
  }

  return getCompanionStatus()
}

export function stopCompanionServer(): void {
  if (activeServer) {
    try {
      activeServer.closeAllConnections?.()
      activeServer.close()
    } catch {
      // ignore close error
    }
    activeServer = null
  }
  activePort = 0
  mutationDispatcher = null
  liveSelectionCaptureRequester = null
  latestSelectionCapture = null
  try {
    if (existsSync(activeBridgeFilePath)) {
      const parsed = JSON.parse(readFileSync(activeBridgeFilePath, 'utf8'))
      if (!parsed?.pid || parsed.pid === process.pid) {
        rmSync(activeBridgeFilePath, { force: true })
      }
    }
  } catch {
    // ignore cleanup error
  }
}
