import { z } from 'zod'
import { SpatialSceneSchema } from './beautifySchema'
import type { ProviderId } from './ipc'

export const AgentModeSchema = z.enum([
  'general',
  'annotate',
  'diagram',
  'fix_code',
  'research'
])
export type AgentMode = z.infer<typeof AgentModeSchema>

export const AgentAnnotationItemSchema = z.object({
  kind: z.enum(['text', 'circle', 'rect', 'arrow', 'highlight_underline']),
  x: z.number(),
  y: z.number(),
  width: z.number().optional(),
  height: z.number().optional(),
  toX: z.number().optional(),
  toY: z.number().optional(),
  text: z.string().optional(),
  color: z.string().optional(),
  fontSize: z.number().min(10).max(64).optional(),
  strokeWidth: z.number().min(1).max(14).optional()
})
export type AgentAnnotationItem = z.infer<typeof AgentAnnotationItemSchema>

export const AgentDiagramNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.string().optional(),
  subtitle: z.string().optional(),
  shape: z.string().optional(),
  group: z.string().optional(),
  layer: z.number().optional()
})

export const AgentDiagramEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  label: z.string().optional(),
  style: z.string().optional(),
  animated: z.boolean().optional()
})

export const AgentBoardMutationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('add_note'),
    title: z.string().optional(),
    content: z.string().min(1),
    x: z.number().optional(),
    y: z.number().optional(),
    w: z.number().optional(),
    h: z.number().optional(),
    color: z.string().optional()
  }),
  z.object({
    type: z.literal('add_equation'),
    latex: z.string().min(1),
    title: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional()
  }),
  z.object({
    type: z.literal('add_reactflow_diagram'),
    title: z.string().min(1),
    diagramType: z
      .enum(['flowchart', 'mindmap', 'architecture', 'erd', 'sequence', 'concept'])
      .optional(),
    direction: z.enum(['TB', 'LR']).optional(),
    animated: z.boolean().optional(),
    nodes: z.array(AgentDiagramNodeSchema).min(1).max(40),
    edges: z.array(AgentDiagramEdgeSchema).max(80),
    x: z.number().optional(),
    y: z.number().optional()
  }),
  z.object({
    type: z.literal('add_spatial_scene'),
    title: z.string().optional(),
    scene: SpatialSceneSchema,
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional()
  }),
  z.object({
    type: z.literal('add_code_card'),
    id: z.string().min(1).optional(),
    title: z.string().min(1),
    language: z.string().min(1),
    code: z.string().min(1),
    pipelineMode: z.boolean().optional(),
    tabs: z
      .array(
        z.object({
          title: z.string().min(1),
          language: z.string().min(1),
          code: z.string().min(1),
          stdin: z.string().optional(),
          upstreamTabId: z.string().nullable().optional()
        })
      )
      .optional(),
    x: z.number().optional(),
    y: z.number().optional()
  }),
  z.object({
    type: z.literal('add_graph_card'),
    id: z.string().min(1).optional(),
    cardId: z.string().min(1).optional(),
    title: z.string().optional(),
    chartType: z.string().optional(),
    data: z.record(z.string(), z.unknown()).optional(),
    spec: z.record(z.string(), z.unknown()).optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional()
  }),
  z.object({
    type: z.literal('add_3d_scene'),
    id: z.string().min(1).optional(),
    title: z.string().optional(),
    preset: z.string().optional(),
    scene: z.unknown().optional(),
    immersed: z.boolean().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional()
  }),
  z.object({
    type: z.literal('add_connector'),
    sourceId: z.string().min(1),
    targetId: z.string().min(1),
    sourcePort: z.enum(['top', 'right', 'bottom', 'left']).optional(),
    targetPort: z.enum(['top', 'right', 'bottom', 'left']).optional(),
    routing: z.enum(['orthogonal', 'curved', 'straight']).optional(),
    color: z.string().optional(),
    label: z.string().optional(),
    animated: z.boolean().optional()
  }),
  z.object({
    type: z.literal('patch_code_card'),
    cardId: z.string().min(1),
    language: z.string().optional(),
    code: z.string().min(1),
    title: z.string().optional()
  }),
  z.object({
    type: z.literal('annotate_overlay'),
    layerId: z.string().optional(),
    annotations: z.array(AgentAnnotationItemSchema).min(1).max(30)
  }),
  z.object({
    type: z.literal('add_video_card'),
    title: z.string().min(1),
    url: z.string().min(1),
    videoId: z.string().min(1),
    summary: z.string().optional(),
    transcriptExcerpt: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional()
  }),
  z.object({
    type: z.literal('delete_elements'),
    elementIds: z.array(z.string().min(1)).min(1).max(500)
  })
])
export type AgentBoardMutation = z.infer<typeof AgentBoardMutationSchema>

export const AgentBoardSnapshotSchema = z.object({
  boardId: z.string().min(1),
  projectId: z.string().optional(),
  activeLayerId: z.string().default('layer-overlay-ink'),
  knowledgeSourceCount: z.number().int().nonnegative().default(0),
  suggestedEmptyArea: z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number()
    })
    .optional(),
  layers: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        kind: z.enum(['ink', 'elements']),
        visible: z.boolean(),
        locked: z.boolean(),
        opacity: z.number(),
        order: z.number()
      })
    )
    .default([]),
  selectedIds: z.array(z.string()).default([]),
  selectionBounds: z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number()
    })
    .optional(),
  viewportCenter: z.object({
    x: z.number(),
    y: z.number()
  }),
  strokesCount: z.number().default(0),
  notes: z
    .array(
      z.object({
        id: z.string(),
        title: z.string().optional(),
        contentPreview: z.string(),
        x: z.number(),
        y: z.number(),
        w: z.number(),
        h: z.number()
      })
    )
    .default([]),
  diagrams: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        diagramType: z.string(),
        nodeCount: z.number(),
        edgeCount: z.number(),
        x: z.number(),
        y: z.number(),
        w: z.number(),
        h: z.number()
      })
    )
    .default([]),
  codeCards: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        activeLanguage: z.string(),
        codePreview: z.string(),
        lastError: z.string().optional(),
        lastOutput: z.string().optional(),
        x: z.number(),
        y: z.number(),
        w: z.number(),
        h: z.number()
      })
    )
    .default([]),
  equations: z
    .array(
      z.object({
        id: z.string(),
        latex: z.string(),
        x: z.number(),
        y: z.number(),
        w: z.number(),
        h: z.number()
      })
    )
    .default([]),
  videos: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        url: z.string(),
        x: z.number(),
        y: z.number()
      })
    )
    .default([]),
  scenes3d: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        preset: z.string().optional(),
        elementCount: z.number(),
        x: z.number(),
        y: z.number(),
        w: z.number(),
        h: z.number()
      })
    )
    .default([]),
  graphs: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        chartType: z.string(),
        linkedCodeNodeId: z.string().optional(),
        x: z.number(),
        y: z.number(),
        w: z.number(),
        h: z.number()
      })
    )
    .default([]),
  imageBase64: z.string().optional()
})
export type AgentBoardSnapshot = z.infer<typeof AgentBoardSnapshotSchema>

export const AgentActiveCodeContextSchema = z.object({
  cardId: z.string().optional(),
  title: z.string().optional(),
  language: z.string(),
  code: z.string(),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
  error: z.string().optional()
})
export type AgentActiveCodeContext = z.infer<typeof AgentActiveCodeContextSchema>

export const WebSearchSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  providerMode: z.enum(['builtin', 'searxng']).default('builtin'),
  searxngUrl: z.string().default(''),
  allowFallback: z.boolean().default(true)
})
export type WebSearchSettingsInput = z.infer<typeof WebSearchSettingsSchema>

export const AgentRunRequestSchema = z.object({
  runId: z.string().min(1),
  prompt: z.string().min(1),
  mode: AgentModeSchema.default('general'),
  provider: z.enum(['ollama', 'openai', 'grok', 'gemini', 'claude']),
  model: z.string().min(1),
  ollamaHost: z.string().optional(),
  webSearch: WebSearchSettingsSchema.optional(),
  activeSkillIds: z.array(z.string()).max(12).optional(),
  boardSnapshot: AgentBoardSnapshotSchema,
  activeCodeContext: AgentActiveCodeContextSchema.optional(),
  selectedSourceIds: z.array(z.string()).optional(),
  chatHistory: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string()
      })
    )
    .max(12)
    .optional(),
  maxSteps: z.number().int().min(1).max(10).optional()
})
export type AgentRunRequest = z.infer<typeof AgentRunRequestSchema>

export interface AgentStepEvent {
  runId: string
  step: number
  maxSteps: number
  kind:
    | 'started'
    | 'thought'
    | 'tool_call'
    | 'tool_result'
    | 'mutation'
    | 'final'
    | 'error'
    | 'cancelled'
  message: string
  toolName?: string
  toolArgsSummary?: string
  toolResultPreview?: string
  mutationType?: AgentBoardMutation['type']
  timestamp: number
}

export interface AgentRunResult {
  ok: boolean
  runId: string
  answer: string
  stepsCount: number
  mutations: AgentBoardMutation[]
  usedTools: string[]
  aborted?: boolean
  error?: string
}

export type AgentProviderId = ProviderId
