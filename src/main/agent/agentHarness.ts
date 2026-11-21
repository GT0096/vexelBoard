import { z } from 'zod'
import type {
  AgentActiveCodeContext,
  AgentBoardMutation,
  AgentBoardSnapshot,
  AgentRunRequest,
  AgentRunResult,
  AgentStepEvent
} from '../../shared/agentSchema'

function unescapeLlmText(raw: string | undefined | null): string {
  if (!raw || typeof raw !== 'string') return ''
  let out = raw.replace(/\r\n/g, '\n')
  if (out.includes('\\n') || out.includes('\\t')) {
    out = out.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\t/g, '  ')
  }
  return out.trim()
}

const MAX_TOOL_RESULT_CHARS = 4500

export interface AgentToolContext {
  boardSnapshot: AgentBoardSnapshot
  activeCodeContext?: AgentActiveCodeContext
  selectedSourceIds?: string[]
  signal: AbortSignal
  pushMutation: (mutation: AgentBoardMutation) => void
  emit: (event: Omit<AgentStepEvent, 'runId' | 'step' | 'maxSteps' | 'timestamp'>) => void
}

export interface AgentToolExecutionResult {
  ok: boolean
  summary: string
  data?: unknown
}

export interface AgentToolDefinition {
  name: string
  description: string
  argHint: string
  inputSchema: z.ZodTypeAny
  execute: (args: unknown, ctx: AgentToolContext) => Promise<AgentToolExecutionResult>
}

export function defineAgentTool<S extends z.ZodTypeAny>(def: {
  name: string
  description: string
  argHint: string
  inputSchema: S
  execute: (args: z.infer<S>, ctx: AgentToolContext) => Promise<AgentToolExecutionResult>
}): AgentToolDefinition {
  return {
    name: def.name,
    description: def.description,
    argHint: def.argHint,
    inputSchema: def.inputSchema,
    execute: (args, ctx) => def.execute(args as z.infer<S>, ctx)
  }
}

export type AgentLlmStepFn = (args: {
  provider: AgentRunRequest['provider']
  model: string
  system: string
  user: string
  history: Array<{ role: 'user' | 'assistant'; content: string }>
  imageBase64?: string
  ollamaHost?: string
  temperature?: number
}) => Promise<string>

const AgentSingleToolCallSchema = z.object({
  tool: z.string().min(1),
  args: z.record(z.string(), z.unknown()).default({})
})

const AgentStepEnvelopeSchema = z.object({
  thought: z.string().min(1).max(1600).optional(),
  action: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('tool'),
      tool: z.string().min(1),
      args: z.record(z.string(), z.unknown()).default({})
    }),
    z.object({
      type: z.literal('tools'),
      calls: z.array(AgentSingleToolCallSchema).min(1).max(6)
    }),
    z.object({
      type: z.literal('final'),
      answer: z.string().min(1)
    })
  ])
})

/**
 * Normalizes common LLM JSON envelope variations (e.g. `{"thought":"...","answer":"..."}` or
 * `{"thought":"...","tool":"...","args":{...}}` or `{"action":"final","answer":"..."}`)
 * into the canonical `AgentStepEnvelopeSchema` format so Step 1 never fails schema validation
 * on minor provider differences.
 */
export function normalizeAgentEnvelopeInput(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const obj = { ...(raw as Record<string, unknown>) }
  const thought =
    typeof obj.thought === 'string' && obj.thought.trim().length > 0
      ? obj.thought.trim()
      : undefined

  if (typeof obj.action === 'string') {
    const actStr = obj.action.trim()
    if (actStr === 'final' || actStr === 'finish' || actStr === 'answer') {
      const ans =
        (typeof obj.answer === 'string' && obj.answer) ||
        (typeof obj.response === 'string' && obj.response) ||
        (typeof obj.message === 'string' && obj.message) ||
        thought ||
        'Done.'
      return { ...(thought ? { thought } : {}), action: { type: 'final', answer: ans } }
    }
    const rawArgs =
      (obj.args && typeof obj.args === 'object' ? obj.args : undefined) ??
      (obj.arguments && typeof obj.arguments === 'object' ? obj.arguments : undefined) ??
      {}
    return {
      ...(thought ? { thought } : {}),
      action: { type: 'tool', tool: actStr, args: rawArgs }
    }
  }

  if (obj.action && typeof obj.action === 'object' && !Array.isArray(obj.action)) {
    const actObj = { ...(obj.action as Record<string, unknown>) }
    if (!actObj.type) {
      if (typeof actObj.tool === 'string') {
        actObj.type = 'tool'
      } else if (Array.isArray(actObj.calls) || Array.isArray(actObj.tools)) {
        actObj.type = 'tools'
        if (!actObj.calls && Array.isArray(actObj.tools)) {
          actObj.calls = actObj.tools
        }
      } else if (
        typeof actObj.answer === 'string' ||
        typeof actObj.response === 'string' ||
        typeof actObj.message === 'string'
      ) {
        actObj.type = 'final'
        actObj.answer = actObj.answer ?? actObj.response ?? actObj.message
      }
    }
    if (actObj.type === 'tool' && !actObj.args && actObj.arguments && typeof actObj.arguments === 'object') {
      actObj.args = actObj.arguments
    }
    return { ...(thought ? { thought } : {}), action: actObj }
  }

  if (!obj.action) {
    if (typeof obj.tool === 'string' && obj.tool.trim()) {
      const rawArgs =
        (obj.args && typeof obj.args === 'object' ? obj.args : undefined) ??
        (obj.arguments && typeof obj.arguments === 'object' ? obj.arguments : undefined) ??
        {}
      return {
        ...(thought ? { thought } : {}),
        action: { type: 'tool', tool: obj.tool.trim(), args: rawArgs }
      }
    }
    if (Array.isArray(obj.calls) || Array.isArray(obj.tools)) {
      return {
        ...(thought ? { thought } : {}),
        action: { type: 'tools', calls: obj.calls ?? obj.tools }
      }
    }
    const topAnswer =
      (typeof obj.answer === 'string' && obj.answer.trim()) ||
      (typeof obj.response === 'string' && obj.response.trim()) ||
      (typeof obj.message === 'string' && obj.message.trim()) ||
      (typeof obj.final === 'string' && obj.final.trim())
    if (topAnswer) {
      return {
        ...(thought ? { thought } : {}),
        action: { type: 'final', answer: topAnswer }
      }
    }
  }

  return obj
}

const activeRuns = new Map<string, AbortController>()

export function cancelAgentRun(runId: string): boolean {
  const controller = activeRuns.get(runId)
  if (!controller) return false
  controller.abort()
  return true
}

function stripMarkdownFences(raw: string): string {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced && fenced[1]) return fenced[1].trim()
  return trimmed
}

function extractOutermostJsonObject(raw: string): string {
  const cleaned = stripMarkdownFences(raw)
  const start = cleaned.indexOf('{')
  if (start === -1) return cleaned

  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (ch === '\\') {
      if (inString) escaped = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (!inString) {
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) {
          return cleaned.slice(start, i + 1)
        }
      }
    }
  }
  return cleaned.slice(start)
}

function truncateText(text: string, limit: number): string {
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}\n...[truncated ${text.length - limit} chars]`
}

function getModeGuidance(mode: AgentRunRequest['mode']): string {
  switch (mode) {
    case 'annotate':
      return (
        'MODE = annotate: Inspect the attached selection image/region (`selectionBounds`) and place crisp visual annotations ' +
        '(arrows, highlight boxes/circles, short callout labels) on `layer-overlay-ink` using `annotate_canvas` at world coordinates aligned with `selectionBounds`.'
      )
    case 'diagram':
      return (
        'MODE = diagram: First call `search_board_assets` to discover composable primitives (`shape`, `svg_path`, curved/animated `connector`, `cell_strip`, `text`), library shapes, fonts, and semantic color tokens. ' +
        'Build clean board-native visuals directly on the canvas immediately. Use `create_vector_diagram` (composable `SpatialScene` primitives in `0..1000` space) ' +
        'to synthesize ANY visual from first principles (atomic orbitals, biological membranes/pathways, chemical reaction energy curves, physics force/wave diagrams, coordinate/trading plots, arrays/stacks/chains). ' +
        'Use `create_interactive_diagram` with discovered shape IDs for connected cyclic/system topologies or flowcharts (`animated: true` for stage-synchronized traveling pulse waves). Never emit raw <svg> outside SpatialScene `svg_path`.'
      )
    case 'fix_code':
      return (
        'MODE = fix_code: Inspect `activeCodeContext`. When local runtime is available, test fixes with `run_code` ' +
        'before calling `create_or_patch_code` (passing `cardId` to patch the active code card in place).'
      )
    case 'research':
      return (
        'MODE = research: Ground answers in uploaded PDFs/docs/YouTube sources using `search_knowledge_base` or `fetch_youtube`, and add helpful notes/equations/diagrams on the board.'
      )
    default:
      return (
        'MODE = general: Fulfill requests proactively on the board. When the user asks to explain visually, draw, create diagrams, notes, equations, or code on the board, ' +
        'IMMEDIATELY call the creation tools (batching multiple tools in `action.type = "tools"` when helpful) — NEVER just respond with prose saying you will create them.'
      )
  }
}

function buildAgentSystemPrompt(
  tools: AgentToolDefinition[],
  request: AgentRunRequest
): string {
  const hasSources =
    (request.boardSnapshot.knowledgeSourceCount ?? 0) > 0 ||
    (request.selectedSourceIds?.length ?? 0) > 0

  const filteredTools = hasSources
    ? tools
    : tools.filter((t) => t.name !== 'search_knowledge_base' && t.name !== 'list_project_sources')

  const toolCatalog = filteredTools
    .map((t) => `- ${t.name}: ${t.description}\n  args JSON: ${t.argHint}`)
    .join('\n')

  return [
    'You are VexelBot Agent, an autonomous spatial whiteboard studio assistant in Vexelboard.',
    'You MUST respond ONLY with a single valid JSON object on every turn (no markdown fences, no extra prose):',
    '1) Single tool: {"thought":"...","action":{"type":"tool","tool":"<tool_name>","args":{...}}}',
    '2) Batch tools (create diagram + note + equation together in 1 turn): {"thought":"...","action":{"type":"tools","calls":[{"tool":"<name>","args":{...}}, ...]}}',
    '3) Finish: {"thought":"...","action":{"type":"final","answer":"<concise Markdown summary of what was created/found>"}}',
    '',
    getModeGuidance(request.mode),
    '',
    'CRITICAL ANTI-HALLUCINATION, ASSET DISCOVERY & FIRST-PRINCIPLES SYNTHESIS RULES:',
    '- Always answer and fulfill the exact `USER REQUEST`. `BOARD CONTEXT JSON` is provided ONLY as background reference so you know what already exists on the board. NEVER ignore the user\'s question to review, critique, or summarize an unrelated existing card on the board (such as an existing `.py` code card) unless the user explicitly asked about that specific card.',
    '- DISCOVER BEFORE DRAFTING: Never hardcode or guess shape IDs, fonts, or fixed templates. Call `search_board_assets` first when planning any visual, diagram, or tutorial so you inspect available composable primitives, matching shape library IDs, domain fonts (`serif`, `mono`, `grotesk`, `caveat`, `jakarta`), and semantic color tokens.',
    '- FIRST-PRINCIPLES SYNTHESIS (NO RIGID PRESETS): Whatever the topic (biological processes, chemical reactions/kinetics, atomic/quantum physics, calculus proofs, quantitative markets, algorithms, distributed systems, or novel fields), decompose it from first principles into its core constituent entities, conservation/causal laws, and exact spatial geometry:',
    '  * Spatial Composition (`create_vector_diagram` / `SpatialScene`): compose `shape` (with `cx,cy,r` for concentric shells/atoms/cells, polygons like `hexagon`/`pentagon`, `fillOpacity`, `rotation`, `animated`), `svg_path` (`d: "M ... C ... Q ... Z"` for arbitrary biological membranes, organelles, crystals, waveguides, potential wells), `connector` (2-pt vectors, 3-pt arcs, or 4+ pt smooth splines with `curved: true`, `animated: true`, `pulseColor`, `flowStage`), `cell_strip` (contiguous or spaced via `cellGap` + `connectorArrows` for codon/polymer/orbital/memory chains), and collision-free `text`.',
    '  * Connected Topologies (`create_interactive_diagram`): use discovered shape IDs and optional `animated: true` for multi-node cyclic pathways, metabolic networks, state machines, or system pipelines.',
    '  * Formal Symbolism & Verification: pair visuals with KaTeX `equations` (balanced reactions, conservation laws, step-by-step derivations, thermodynamics) and include `code` ONLY when algorithmic code or simulation is genuinely requested/helpful.',
    '- When the user asks a conceptual question in chat, provide a thorough, first-principles Markdown explanation in `action.answer`.',
    '',
    'CRITICAL WORKSPACE & EMPTY-AREA PLACEMENT RULES:',
    hasSources
      ? `- Knowledge Hub has ${request.boardSnapshot.knowledgeSourceCount} indexed source(s). Use \`search_knowledge_base\` only when the query needs uploaded document/video evidence.`
      : '- IMPORTANT: The Knowledge Hub currently has 0 uploaded sources. Answer general requests in any domain (science, biology, chemistry, physics, math, finance, engineering) from first principles and DO NOT search any knowledge base.',
    '- When creating standalone visuals (`create_vector_diagram`, `create_interactive_diagram`, `add_note_card`, `add_equation`, `create_or_patch_code`, `fetch_youtube`), OMIT `x` and `y`: Vexelboard automatically allocates a guaranteed-empty region on the canvas, keeps multi-item clusters neatly side-by-side without overlapping existing ink/cards, and pans the camera to show it.',
    '- Only supply explicit world coordinates `x`, `y` when drawing targeted overlays on top of existing items with `annotate_canvas` (which writes to `layer-overlay-ink`).',
    '- NEVER finish (`action.type = "final"`) claiming you "will create" a diagram/note/code card without actually calling the creation tool first.',
    '- For `create_vector_diagram`, `scene` MUST have `{"title":"...","elements":[...]}` where every element uses `"type": "shape" | "svg_path" | "connector" | "cell_strip" | "text"`. Keep `0..1000` local coordinates.',
    '',
    'AVAILABLE TOOLS:',
    toolCatalog
  ].join('\n')
}

function buildSeedHistory(
  chatHistory?: Array<{ role: 'user' | 'assistant'; content: string }>
): Array<{ role: 'user' | 'assistant'; content: string }> {
  if (!chatHistory || chatHistory.length === 0) return []
  const cleaned = chatHistory
    .filter((m) => typeof m.content === 'string' && m.content.trim().length > 0)
    .slice(-6)
    .map((m) => ({
      role: m.role,
      content: truncateText(m.content.trim(), 700)
    }))

  // Ensure strict user -> assistant alternation ending on 'assistant' before currentTurnUser
  const normalized: Array<{ role: 'user' | 'assistant'; content: string }> = []
  for (const msg of cleaned) {
    if (normalized.length === 0) {
      if (msg.role === 'user') normalized.push(msg)
      continue
    }
    const prev = normalized[normalized.length - 1]
    if (prev.role === msg.role) {
      prev.content = `${prev.content}\n${msg.content}`
    } else {
      normalized.push(msg)
    }
  }
  if (normalized.length > 0 && normalized[normalized.length - 1].role === 'user') {
    normalized.pop()
  }
  return normalized
}

function buildInitialUserPrompt(request: AgentRunRequest): string {
  const snapshotSummary = {
    ...request.boardSnapshot,
    imageBase64: undefined
  }
  const parts: string[] = [
    `USER REQUEST:\n${request.prompt}`,
    `\n(IMPORTANT: Directly answer or fulfill the USER REQUEST above. Do NOT summarize or critique unrelated existing board cards below unless the USER REQUEST specifically asks about them.)`,
    `\nEXISTING BOARD CONTEXT JSON (background reference only):\n${truncateText(JSON.stringify(snapshotSummary), 3200)}`
  ]
  if (request.activeCodeContext) {
    parts.push(
      `\nACTIVE CODE CONTEXT JSON:\n${truncateText(JSON.stringify(request.activeCodeContext), 3500)}`
    )
  }
  if (request.selectedSourceIds && request.selectedSourceIds.length > 0) {
    parts.push(`\nPINNED KNOWLEDGE SOURCE IDS: ${JSON.stringify(request.selectedSourceIds)}`)
  }
  if (request.boardSnapshot.imageBase64) {
    parts.push('\nAn image capture of the target canvas/selection is attached to this turn.')
  }
  return parts.join('\n')
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new Error('AGENT_ABORTED')
  }
}

export async function runAgentLoop(opts: {
  request: AgentRunRequest
  tools: AgentToolDefinition[]
  callLlmStep: AgentLlmStepFn
  onEvent?: (ev: AgentStepEvent) => void
  signal?: AbortSignal
}): Promise<AgentRunResult> {
  const { request, tools, callLlmStep, onEvent } = opts
  const maxSteps = Math.max(1, Math.min(10, request.maxSteps ?? 8))
  const runController = new AbortController()
  activeRuns.set(request.runId, runController)

  if (opts.signal) {
    if (opts.signal.aborted) runController.abort()
    else opts.signal.addEventListener('abort', () => runController.abort(), { once: true })
  }

  const signal = runController.signal
  const toolMap = new Map<string, AgentToolDefinition>(tools.map((t) => [t.name, t]))
  const mutations: AgentBoardMutation[] = []
  const usedTools: string[] = []
  const systemPrompt = buildAgentSystemPrompt(tools, request)
  const initialUserPrompt = buildInitialUserPrompt(request)

  const emit = (
    step: number,
    partial: Omit<AgentStepEvent, 'runId' | 'step' | 'maxSteps' | 'timestamp'>
  ): void => {
    onEvent?.({
      runId: request.runId,
      step,
      maxSteps,
      timestamp: Date.now(),
      ...partial
    })
  }

  emit(0, {
    kind: 'started',
    message: `Starting ${request.mode} agent (${request.provider}:${request.model}, up to ${maxSteps} steps)...`
  })

  const history: Array<{ role: 'user' | 'assistant'; content: string }> = buildSeedHistory(
    request.chatHistory
  )
  let currentTurnUser = initialUserPrompt
  let lastError = ''

  const recordTurnAndContinue = (assistantContent: string, nextUserPrompt: string): void => {
    history.push({ role: 'user', content: truncateText(currentTurnUser, 3500) })
    history.push({ role: 'assistant', content: truncateText(assistantContent, 1800) })
    currentTurnUser = nextUserPrompt
  }

  try {
    for (let step = 1; step <= maxSteps; step++) {
      throwIfAborted(signal)

      const rawReply = await callLlmStep({
        provider: request.provider,
        model: request.model,
        system: systemPrompt,
        user: currentTurnUser,
        history,
        imageBase64: step === 1 ? request.boardSnapshot.imageBase64 : undefined,
        ollamaHost: request.ollamaHost,
        temperature: 0.2
      })

      throwIfAborted(signal)

      const jsonText = extractOutermostJsonObject(rawReply)
      let parsedRaw: unknown
      try {
        parsedRaw = JSON.parse(jsonText)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        lastError = `Invalid JSON response (${msg})`
        recordTurnAndContinue(
          rawReply,
          `ORIGINAL USER REQUEST: ${request.prompt}\n\nVALIDATION ERROR: Your previous response was not valid JSON (${msg}). Respond ONLY with one valid JSON object matching {"thought":"...","action":{"type":"tool"|"tools"|"final",...}}.`
        )
        emit(step, {
          kind: 'thought',
          message: `JSON parse error on step ${step}; requesting self-correction...`
        })
        continue
      }

      const normalizedEnvelope = normalizeAgentEnvelopeInput(parsedRaw)
      const envelopeResult = AgentStepEnvelopeSchema.safeParse(normalizedEnvelope)
      if (!envelopeResult.success) {
        const issueText = envelopeResult.error.issues
          .slice(0, 4)
          .map((i) => `${i.path.join('.') || 'root'}: ${i.message}`)
          .join('; ')
        lastError = `Schema error: ${issueText}`
        recordTurnAndContinue(
          jsonText,
          `ORIGINAL USER REQUEST: ${request.prompt}\n\nSCHEMA ERROR: ${issueText}. Fix the JSON shape and respond again.`
        )
        emit(step, {
          kind: 'thought',
          message: `Schema validation failed on step ${step}; requesting self-correction...`
        })
        continue
      }

      const envelope = envelopeResult.data
      if (envelope.thought) {
        emit(step, { kind: 'thought', message: envelope.thought })
      }

      if (envelope.action.type === 'final') {
        const cleanAnswer = unescapeLlmText(envelope.action.answer)
        emit(step, { kind: 'final', message: cleanAnswer })
        return {
          ok: true,
          runId: request.runId,
          answer: cleanAnswer,
          stepsCount: step,
          mutations,
          usedTools
        }
      }

      const pendingCalls =
        envelope.action.type === 'tools'
          ? envelope.action.calls
          : [{ tool: envelope.action.tool, args: envelope.action.args }]

      const batchResults: Array<{
        tool: string
        ok: boolean
        summary: string
        queuedMutations: number
        data?: unknown
      }> = []

      for (const call of pendingCalls) {
        throwIfAborted(signal)
        const { tool: toolName, args: rawToolArgs } = call
        const tool = toolMap.get(toolName)
        if (!tool) {
          lastError = `Unknown tool "${toolName}"`
          batchResults.push({
            tool: toolName,
            ok: false,
            summary: `UNKNOWN TOOL "${toolName}". Valid tools: ${Array.from(toolMap.keys()).join(', ')}.`,
            queuedMutations: 0
          })
          continue
        }

        const argParse = tool.inputSchema.safeParse(rawToolArgs ?? {})
        if (!argParse.success) {
          const issueText = argParse.error.issues
            .slice(0, 5)
            .map((i) => `${i.path.join('.') || 'args'}: ${i.message}`)
            .join('; ')
          lastError = `Invalid arguments for "${toolName}": ${issueText}`
          emit(step, {
            kind: 'thought',
            message: `Invalid arguments for ${toolName}; agent retrying...`
          })
          batchResults.push({
            tool: toolName,
            ok: false,
            summary: `TOOL ARGUMENT ERROR: ${issueText}. Expected shape: ${tool.argHint}`,
            queuedMutations: 0
          })
          continue
        }

        const argsSummary = truncateText(JSON.stringify(argParse.data), 140)
        emit(step, {
          kind: 'tool_call',
          message: `Running ${toolName}`,
          toolName,
          toolArgsSummary: argsSummary
        })

        if (!usedTools.includes(toolName)) usedTools.push(toolName)

        const mutationsBefore = mutations.length
        let toolResult: AgentToolExecutionResult
        try {
          toolResult = await tool.execute(argParse.data, {
            boardSnapshot: request.boardSnapshot,
            activeCodeContext: request.activeCodeContext,
            selectedSourceIds: request.selectedSourceIds,
            signal,
            pushMutation: (mutation) => {
              mutations.push(mutation)
              emit(step, {
                kind: 'mutation',
                message: `Queued board update: ${mutation.type}`,
                mutationType: mutation.type
              })
            },
            emit: (partial) => emit(step, partial)
          })
        } catch (err) {
          if (signal.aborted || (err instanceof Error && err.message === 'AGENT_ABORTED')) {
            throw new Error('AGENT_ABORTED', { cause: err })
          }
          toolResult = {
            ok: false,
            summary: `Tool execution failed: ${err instanceof Error ? err.message : String(err)}`
          }
        }

        throwIfAborted(signal)

        if (!toolResult.ok) {
          lastError = toolResult.summary
        }

        const newMutationsCount = mutations.length - mutationsBefore
        emit(step, {
          kind: 'tool_result',
          message: toolResult.summary,
          toolName,
          toolResultPreview: truncateText(toolResult.summary, 180)
        })

        batchResults.push({
          tool: toolName,
          ok: toolResult.ok,
          summary: toolResult.summary,
          queuedMutations: newMutationsCount,
          data: toolResult.data
        })
      }

      const observationPayload = truncateText(JSON.stringify(batchResults), MAX_TOOL_RESULT_CHARS)
      recordTurnAndContinue(
        jsonText,
        `ORIGINAL USER REQUEST: ${request.prompt}\n\nTOOL RESULTS:\n${observationPayload}\n\nCheck if all requested board visuals/answers for "${request.prompt}" are complete. Call more tools or return {"thought":"...","action":{"type":"final","answer":"<thorough Markdown answer directly addressing the ORIGINAL USER REQUEST>"}}.`
      )
    }

    if (mutations.length > 0) {
      const summaryTypes = Array.from(new Set(mutations.map((m) => m.type))).join(', ')
      const doneMsg = `Created ${mutations.length} board element(s) (${summaryTypes}) in an empty area of the board.`
      emit(maxSteps, { kind: 'final', message: doneMsg })
      return {
        ok: true,
        runId: request.runId,
        answer: doneMsg,
        stepsCount: maxSteps,
        mutations,
        usedTools
      }
    }

    const failMsg =
      lastError ||
      'Agent reached the step limit without creating board updates or returning a final response.'
    emit(maxSteps, { kind: 'error', message: failMsg })
    return {
      ok: false,
      runId: request.runId,
      answer: '',
      stepsCount: maxSteps,
      mutations,
      usedTools,
      error: failMsg
    }
  } catch (err) {
    if (signal.aborted || (err instanceof Error && err.message === 'AGENT_ABORTED')) {
      emit(history.length, { kind: 'cancelled', message: 'Agent run cancelled by user.' })
      return {
        ok: false,
        runId: request.runId,
        answer: 'Agent run cancelled.',
        stepsCount: history.length,
        mutations,
        usedTools,
        aborted: true
      }
    }
    const errMsg = err instanceof Error ? err.message : String(err)
    emit(history.length, { kind: 'error', message: errMsg })
    return {
      ok: false,
      runId: request.runId,
      answer: '',
      stepsCount: history.length,
      mutations,
      usedTools,
      error: errMsg
    }
  } finally {
    activeRuns.delete(request.runId)
  }
}
