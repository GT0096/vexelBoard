import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { dbManager } from './db'
import {
  BYOK_PROVIDERS,
  DEFAULT_PROVIDER_MODELS,
  PROVIDER_LABELS,
  resolveOpenAIModelProfile,
  type AIRequest,
  type AIResponse,
  type ByokProvider,
  type OllamaStatus,
  type OpenAIModelProfile,
  type ProviderId,
  type TutorialPayload
} from '../shared/ipc'

const DEFAULT_OLLAMA_HOST = 'http://localhost:11434'
const REQUEST_TIMEOUT_MS = 60_000

/* ------------------------------------------------------------------ */
/* 1. Ollama connection checker                                        */
/* ------------------------------------------------------------------ */

function normalizeHost(host?: string): string {
  const h = (host || DEFAULT_OLLAMA_HOST).trim().replace(/\/+$/, '')
  return /^https?:\/\//i.test(h) ? h : `http://${h}`
}

export async function checkOllamaStatus(host?: string): Promise<OllamaStatus> {
  const base = normalizeHost(host)
  try {
    const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(3500) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as { models?: Array<{ name?: string; model?: string }> }
    const local = (data.models ?? [])
      .map((m) => m.name || m.model || '')
      .filter((n): n is string => Boolean(n))
    return { online: true, models: local }
  } catch (err) {
    return { online: false, models: [], error: errorMessage(err) }
  }
}

/* ------------------------------------------------------------------ */
/* 2. Encrypted API key vault (safeStorage)                            */
/* ------------------------------------------------------------------ */

type KeyVault = Partial<Record<ByokProvider, string>>

function vaultPath(): string {
  return join(app.getPath('userData'), 'encrypted-keys.json')
}

function readVault(): KeyVault {
  try {
    const p = vaultPath()
    if (!existsSync(p)) return {}
    return JSON.parse(readFileSync(p, 'utf-8')) as KeyVault
  } catch {
    return {}
  }
}

function writeVault(vault: KeyVault): void {
  const p = vaultPath()
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(vault, null, 2), { encoding: 'utf-8', mode: 0o600 })
}

function isByok(provider: string): provider is ByokProvider {
  return (BYOK_PROVIDERS as string[]).includes(provider)
}

export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

export function saveApiKey(provider: ByokProvider, apiKey: string): boolean {
  if (!isByok(provider)) return false
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS-level encryption (safeStorage) is not available on this system.')
  }
  const vault = readVault()
  const trimmed = apiKey.trim()
  if (!trimmed) {
    delete vault[provider]
  } else {
    vault[provider] = safeStorage.encryptString(trimmed).toString('base64')
  }
  writeVault(vault)
  return true
}

export function deleteApiKey(provider: ByokProvider): boolean {
  if (!isByok(provider)) return false
  const vault = readVault()
  delete vault[provider]
  writeVault(vault)
  return true
}

export function hasApiKey(provider: ByokProvider): boolean {
  if (!isByok(provider)) return false
  const vault = readVault()
  if (vault[provider]) return true
  if (provider === 'gemini' && Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)) return true
  if (provider === 'openai' && Boolean(process.env.OPENAI_API_KEY)) return true
  if (provider === 'claude' && Boolean(process.env.ANTHROPIC_API_KEY)) return true
  if (provider === 'grok' && Boolean(process.env.GROK_API_KEY || process.env.XAI_API_KEY)) return true
  return false
}

function loadApiKey(provider: ByokProvider): string {
  const vault = readVault()
  const b64 = vault[provider]
  if (b64 && safeStorage.isEncryptionAvailable()) {
    try {
      const buf = Buffer.from(b64, 'base64')
      const decrypted = safeStorage.decryptString(buf)
      if (decrypted && decrypted.trim().length > 0) return decrypted.trim()
    } catch {
      /* ignore decryption error, fall back to process.env */
    }
  }
  if (provider === 'gemini' && (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)) {
    return (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)!.trim()
  }
  if (provider === 'openai' && process.env.OPENAI_API_KEY) {
    return process.env.OPENAI_API_KEY.trim()
  }
  if (provider === 'claude' && process.env.ANTHROPIC_API_KEY) {
    return process.env.ANTHROPIC_API_KEY.trim()
  }
  if (provider === 'grok' && (process.env.GROK_API_KEY || process.env.XAI_API_KEY)) {
    return (process.env.GROK_API_KEY || process.env.XAI_API_KEY)!.trim()
  }
  throw new Error(`No API key saved for ${PROVIDER_LABELS[provider]}. Add one in Settings.`)
}

export async function fetchOpenAIModelConfig(model: string): Promise<OpenAIModelProfile> {
  const base = resolveOpenAIModelProfile(model)
  try {
    const apiKey = loadApiKey('openai')
    const res = await fetch(`https://api.openai.com/v1/models/${encodeURIComponent(base.model)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(4000)
    })
    if (!res.ok) {
      return { ...base, verifiedFromApi: false }
    }
    const data = (await res.json()) as { id?: string }
    const canonicalModel = data.id?.trim() || base.model
    const refined = resolveOpenAIModelProfile(canonicalModel)
    return {
      ...refined,
      verifiedFromApi: true,
      summary: `${refined.summary} (verified via OpenAI API)`
    }
  } catch {
    return { ...base, verifiedFromApi: false }
  }
}

/* ------------------------------------------------------------------ */
/* 3. System Prompts                                                   */
/* ------------------------------------------------------------------ */

const OCR_SYSTEM_PROMPT = `You are a handwriting recognition model for an AR virtual glass whiteboard.
The user writes in the air or on a drawing pad; input is a white-on-black binary crop of their handwriting stroke.
Infer the intended English text, digits, or symbols.
Respond with STRICT JSON only, no markdown: {"recognizedText": "string"}
If nothing legible is present respond {"recognizedText": ""}.`

const EQUATION_OCR_SYSTEM_PROMPT = `You are a mathematical formula recognition model.
The user wrote a formula or equation on a drawing pad.
Transcribe it into standard, clean LaTeX math formula (e.g. "E = mc^2", "\\int_0^1 x^2 dx", "\\sum_{i=1}^n x_i", "a^2 + b^2 = c^2").
Respond with STRICT JSON only, no markdown: {"recognizedText": "latex formula"}
If nothing legible is present respond {"recognizedText": ""}.`

const CHAT_SYSTEM_PROMPT = `You are an expert AI Research & Engineering Co-Pilot integrated into an interactive glass whiteboard note-taking app.
The user is taking notes, designing systems, or studying concepts.
Answer the user's questions clearly, concisely, and thoroughly.
Structure your answers with markdown:
- Use bullet points, bold keywords, and clear headings.
- Include code blocks or LaTeX formulas where relevant ($...$ or $$...$$).

AGENTIC TOOL CALL - create_diagram:
When the user asks you to create, sketch, or generate a diagram, flowchart, architecture map, sequence diagram, ERD, or workflow, call the agentic "create_diagram" tool by outputting a JSON object with this schema:
\`\`\`json
{
  "tool": "create_diagram",
  "arguments": {
    "title": "Clean Descriptive Diagram Title",
    "diagramType": "flowchart",
    "nodes": [
      { "id": "1", "type": "startEnd", "label": "Start", "description": "Trigger" },
      { "id": "2", "type": "process", "label": "Service Action", "description": "Processing logic" },
      { "id": "3", "type": "decision", "label": "Valid Check?", "description": "Yes / No" },
      { "id": "4", "type": "database", "label": "PostgreSQL", "description": "Primary storage" },
      { "id": "5", "type": "cloud", "label": "API Gateway", "description": "HTTPS proxy" }
    ],
    "edges": [
      { "id": "e1-2", "source": "1", "target": "2" },
      { "id": "e2-3", "source": "2", "target": "3" },
      { "id": "e3-4", "source": "3", "target": "4", "label": "Yes" }
    ]
  }
}
\`\`\`
Supported node types:
- "startEnd": Oval pill for entry, start, or finish
- "process": Standard rectangular action or microservice
- "decision": Diamond condition or branching logic
- "database": Cylinder data persistence, table, or cache
- "cloud": Cloud infra, API gateway, cluster, or external service
- "document": File, documentation, or report sheet
- "inputOutput": Parallelogram for user input, display, or client UI
- "actor": Human user, person, client, or external role
- "circle": Event circle, state node, or junction
- "group": Frame container boundary to group related nodes
- "sticky": Colored sticky note for comments or ideas
- "custom": Generic card
- Plus Vexelboard library shape IDs when domain-specific shapes fit better:
  - Flowchart ("fc-*"): fc-predefined-process, fc-delay, fc-display, fc-stored-data, fc-manual-input, fc-preparation, fc-merge, fc-extract, fc-or, fc-summing-junction, fc-off-page-reference
  - UML ("uml-*"): uml-class, uml-interface, uml-abstract-class, uml-enumeration, uml-package, uml-component, uml-node, uml-lifeline, uml-state, uml-composite-state, uml-initial-state, uml-final-state, uml-fork-join-h
  - BPMN ("bpmn-*"): bpmn-task, bpmn-subprocess, bpmn-event-start, bpmn-event-intermediate, bpmn-event-end, bpmn-gateway-exclusive, bpmn-gateway-parallel, bpmn-gateway-inclusive, bpmn-data-store, bpmn-pool
  - Entity Relation ("er-*"): er-entity, er-weak-entity, er-attribute, er-key-attribute, er-relationship, er-table
  - Network ("net-*"): net-server, net-router, net-switch, net-firewall, net-load-balancer, net-globe, net-queue, net-container, net-function, net-desktop, net-mobile
  - Mockup ("mock-*"): mock-browser-window, mock-mobile-frame, mock-button, mock-text-input, mock-modal, mock-card
  - Basic / 3D / Callouts / Arrows: rectangle, rounded-rectangle, rhombus, parallelogram, hexagon, octagon, star-5, cube, isometric-cube, cylinder-3d, sphere, callout-rect, callout-cloud, chevron, arrow-right\``

const TUTORIAL_SYSTEM_PROMPT = `You are a master educator and visual whiteboard lecturer.
When the user gives a topic, explain it step-by-step using rich explanations, interactive architecture/flow diagrams, and concrete equations or code.

You MUST respond with a single valid JSON object adhering strictly to this format (no markdown code blocks, just raw JSON):
{
  "tutorial": {
    "topic": "Topic Name",
    "overview": "Clear 2-sentence intuition of the core idea.",
    "steps": [
      {
        "title": "1. Core Intuition & Concept",
        "explanation": "Clear explanation with markdown styling.",
        "keyPoints": ["Key takeaway 1", "Key takeaway 2"],
        "diagramMermaid": "graph LR\\n  A[Input] --> B[Processing]\\n  B --> C[Output]",
        "diagramNodes": [
          { "id": "n1", "type": "startEnd", "label": "Input", "description": "Initial data" },
          { "id": "n2", "type": "process", "label": "Processing", "description": "Core transformation" },
          { "id": "n3", "type": "startEnd", "label": "Output", "description": "Final result" }
        ],
        "diagramEdges": [
          { "source": "n1", "target": "n2", "label": "feeds" },
          { "source": "n2", "target": "n3", "label": "produces" }
        ],
        "equationLatex": "",
        "codeSnippet": null
      }
    ]
  }
}

Guidelines:
- Create 3 to 5 logical sequential steps.
- Every step MUST include "diagramNodes" and "diagramEdges" (and/or "diagramMermaid" with "NodeA[Label] --> NodeB[Label]") so an interactive diagram is rendered on the whiteboard.
- Include KaTeX equations (raw LaTeX, without $ wrappers) when math/physics/CS algorithms benefit from mathematical formulation.
- Include code snippets (e.g. language: "python", "javascript", or "sql") when technical implementation clarifies the topic.
- Ensure every step is educational, highly visual, and self-contained.`

function buildFallbackTutorial(topic: string, rawReply?: string): TutorialPayload {
  const cleanTopic = topic.trim() || 'Topic Overview'
  return {
    topic: cleanTopic,
    overview: rawReply
      ? rawReply.slice(0, 320)
      : `Structured visual breakdown of ${cleanTopic}: core intuition, architecture flow, and practical application.`,
    steps: [
      {
        title: `1. Core Intuition: ${cleanTopic}`,
        explanation: rawReply
          ? rawReply
          : `**${cleanTopic}** breaks a complex problem into well-defined inputs, transformations, and verifiable outputs.`,
        keyPoints: [
          `Identify the primary entities and inputs in ${cleanTopic}`,
          'Understand how state transitions from input to output'
        ],
        diagramMermaid: `graph LR\n  A[Problem & Inputs] --> B[Core ${cleanTopic} Logic]\n  B --> C[Result & Insights]`,
        diagramNodes: [
          { id: '1', type: 'startEnd', label: 'Inputs & Context', description: 'Starting conditions' },
          { id: '2', type: 'process', label: cleanTopic, description: 'Core mechanism' },
          { id: '3', type: 'startEnd', label: 'Outcome', description: 'Verified output' }
        ],
        diagramEdges: [
          { source: '1', target: '2', label: 'drives' },
          { source: '2', target: '3', label: 'produces' }
        ]
      },
      {
        title: '2. Architecture & Component Flow',
        explanation: `Map how individual building blocks collaborate inside **${cleanTopic}**, separating storage, processing, and feedback loops.`,
        keyPoints: [
          'Keep interfaces modular between stages',
          'Validate intermediate outputs before downstream steps'
        ],
        diagramNodes: [
          { id: '1', type: 'process', label: 'Ingestion / Prep', description: 'Normalize inputs' },
          { id: '2', type: 'decision', label: 'Validation Gate', description: 'Check constraints' },
          { id: '3', type: 'database', label: 'State / Knowledge', description: 'Persist key artifacts' },
          { id: '4', type: 'process', label: 'Synthesis', description: 'Produce final structure' }
        ],
        diagramEdges: [
          { source: '1', target: '2', label: 'validate' },
          { source: '2', target: '3', label: 'store' },
          { source: '2', target: '4', label: 'pass' }
        ]
      },
      {
        title: '3. Practical Summary & Next Steps',
        explanation: `Apply **${cleanTopic}** iteratively: verify edge cases, connect notes to diagrams on the canvas, and test small examples first.`,
        keyPoints: [
          'Verify assumptions with concrete examples',
          'Link related notes and diagrams spatially on the board'
        ],
        diagramNodes: [
          { id: '1', type: 'process', label: 'Build Prototype', description: 'Start minimal' },
          { id: '2', type: 'decision', label: 'Meets Goal?', description: 'Inspect results' },
          { id: '3', type: 'startEnd', label: 'Refine & Document', description: 'Capture patterns' }
        ],
        diagramEdges: [
          { source: '1', target: '2', label: 'evaluate' },
          { source: '2', target: '3', label: 'yes' }
        ]
      }
    ]
  }
}

function getRagContextSnippet(
  query: string,
  opts?: { sourceIds?: string[]; projectId?: string; boardId?: string }
): { snippet: string; pinnedTitles: string[] } {
  try {
    const explicitIds = opts?.sourceIds?.filter(Boolean) || []
    if (explicitIds.length > 0) {
      const pinnedSources = dbManager.getKnowledgeSourcesByIds(explicitIds)
      const pinnedTitles = pinnedSources.map((s) => s.title)
      const hits = dbManager.hybridSearch(query, { sourceIds: explicitIds, limit: 8 })
      const hitSourceIds = new Set(hits.map((h) => h.sourceId))
      const parts: string[] = []

      if (hits.length > 0) {
        parts.push(
          ...hits.map(
            (h, idx) =>
              `[Referenced Book/Source Match ${idx + 1}: ${h.sourceTitle} (${h.sourceType})]\n${h.chunkText.slice(0, 1400)}`
          )
        )
      }

      // Ensure every pinned book/note has context even for broad queries like "summarize this book"
      for (const src of pinnedSources) {
        if (!hitSourceIds.has(src.id) && src.rawContent) {
          parts.push(
            `[Referenced Book/Source Overview: ${src.title} (${src.sourceType})]\n${src.rawContent.slice(0, 3000)}`
          )
        }
      }

      return { snippet: parts.join('\n\n'), pinnedTitles }
    }

    let scopedIds: string[] | undefined
    if (opts?.projectId) {
      const projSources = dbManager.getKnowledgeSources(opts.boardId, opts.projectId)
      if (projSources.length > 0) {
        scopedIds = projSources.map((s) => s.id)
      }
    }

    const hits = dbManager.hybridSearch(query, { sourceIds: scopedIds, limit: 5 })
    if (hits.length > 0) {
      return {
        snippet: hits
          .map(
            (h, idx) =>
              `[Knowledge Match ${idx + 1}: ${h.sourceTitle} (${h.sourceType})]\n${h.chunkText.slice(0, 1200)}`
          )
          .join('\n\n'),
        pinnedTitles: []
      }
    }
    const sources = opts?.projectId
      ? dbManager.getKnowledgeSources(opts.boardId, opts.projectId)
      : dbManager.getKnowledgeSources()
    if (sources.length > 0) {
      return {
        snippet: sources
          .slice(0, 3)
          .map((s) => `[Source: ${s.title} (${s.sourceType})]\n${s.rawContent.slice(0, 1000)}`)
          .join('\n\n'),
        pinnedTitles: []
      }
    }
  } catch {
    /* ignore DB lookup errors */
  }
  return { snippet: '', pinnedTitles: [] }
}

const REACTFLOW_DIAGRAM_SYSTEM_PROMPT = `You are an expert Technical Architecture & Flowchart Generator.
Convert the provided concept, system design, business process, or workflow into an interactive, beautifully structured React Flow diagram.

Return STRICT JSON ONLY matching:
{
  "title": "Diagram Title",
  "diagramType": "flowchart",
  "nodes": [
    {
      "id": "1",
      "type": "startEnd",
      "label": "Start / End / Entrypoint",
      "description": "Short explanation",
      "x": 200,
      "y": 50
    },
    {
      "id": "2",
      "type": "process",
      "label": "Process Step",
      "description": "Details",
      "x": 200,
      "y": 170
    },
    {
      "id": "3",
      "type": "decision",
      "label": "Condition / Check?",
      "description": "Yes / No branch",
      "x": 200,
      "y": 300
    },
    {
      "id": "4",
      "type": "database",
      "label": "Database Store",
      "description": "Postgres / Redis / MongoDB",
      "x": 420,
      "y": 300
    },
    {
      "id": "5",
      "type": "cloud",
      "label": "API Gateway / External Cloud",
      "description": "HTTP / WebSocket",
      "x": 200,
      "y": 440
    }
  ],
  "edges": [
    {
      "id": "e1-2",
      "source": "1",
      "target": "2",
      "label": "",
      "animated": false
    },
    {
      "id": "e2-3",
      "source": "2",
      "target": "3",
      "label": "",
      "animated": false
    },
    {
      "id": "e3-4",
      "source": "3",
      "target": "4",
      "label": "Yes",
      "animated": true
    },
    {
      "id": "e3-5",
      "source": "3",
      "target": "5",
      "label": "No",
      "animated": false
    }
  ]
}

Supported Node Types:
- "startEnd": Start, Finish, Trigger, or Terminal states
- "process": Standard task, action, service, or computing component
- "decision": Branching condition, check, or filter
- "database": Data persistence, cache, or table
- "cloud": External services, API gateways, queues, cloud infra
- "document": Specification, file, or report
- "inputOutput": Input/Output, User UI, display
- "actor": Person, client, or role
- "circle": State circle, event connector, or terminal
- "group": Container frame to group related nodes
- "sticky": Sticky note for remarks or ideas
- "custom": General card
- Full Vexelboard Shape Library IDs (use when the diagram is UML, BPMN, ERD, Network, Mockup, or specialized Flowchart):
  - Flowchart: fc-predefined-process, fc-delay, fc-display, fc-stored-data, fc-manual-input, fc-preparation, fc-merge, fc-extract, fc-or, fc-summing-junction, fc-off-page-reference
  - UML: uml-class, uml-interface, uml-abstract-class, uml-package, uml-component, uml-node, uml-lifeline, uml-state, uml-initial-state, uml-final-state, uml-fork-join-h
  - BPMN: bpmn-task, bpmn-subprocess, bpmn-event-start, bpmn-event-intermediate, bpmn-event-end, bpmn-gateway-exclusive, bpmn-gateway-parallel, bpmn-gateway-inclusive, bpmn-data-store, bpmn-pool
  - Entity Relation: er-entity, er-weak-entity, er-attribute, er-key-attribute, er-relationship, er-table
  - Network: net-server, net-router, net-switch, net-firewall, net-load-balancer, net-globe, net-queue, net-container, net-function
  - Mockup: mock-browser-window, mock-mobile-frame, mock-button, mock-text-input, mock-modal, mock-card
  - Basic / 3D / Callouts / Arrows: hexagon, octagon, star-5, cube, isometric-cube, cylinder-3d, sphere, callout-rect, callout-cloud, chevron, arrow-right

Respond with STRICT JSON only. Do NOT wrap in markdown code blocks or introductory commentary.`

const BEAUTIFY_DIAGRAM_SYSTEM_PROMPT = `You are a World-Class Technical Diagram Architect & Vision Specialist for an interactive whiteboard application.
Your task is to analyze a hand-drawn sketch, diagram, or handwritten notes drawn by a user and either:
A) Convert pure handwritten text/words/notes into clean well-written text, OR
B) Transform any drawn shapes, flowchart, architecture map, circuit, or UI wireframe into an impeccably structured React Flow JSON using our exact shape library IDs.

Analyze the user's drawing carefully:
1. DISTINGUISH HANDWRITTEN TEXT VS SHAPES/DIAGRAMS:
   - If the image ONLY contains handwritten words, sentences, bullet points, or notes with NO geometric shapes, boxes, icons, or diagram connectors, respond ONLY with:
     {"isTextOnly": true, "recognizedText": "Cleanly transcribed, well-written text preserving line breaks"}
   - Otherwise, identify every drawn shape, box, icon, container, arrow, and connector line.
2. PRESERVE EXACT ORIENTATION, SHAPE GEOMETRY, LABELS & TOPOLOGY:
   - NEVER rotate, transpose, or convert a Left-to-Right (LR) diagram into Top-to-Bottom (TB), or vice versa! Preserve the EXACT 2D spatial layout from the image using pixel coordinates relative to top-left (0, 0) ("x", "y", "width", "height"): shapes on the left must have smaller "x", shapes on the right must have larger "x", shapes near the top must have smaller "y", and shapes near the bottom must have larger "y".
   - Keep the EXACT text written inside each shape in "label" (e.g. if the user wrote "D", output "D", NOT "Decision"; if "A", output "A"). Set "description": "" unless secondary descriptive text is actually written in the drawing—NEVER invent placeholder descriptions like "Document E".
   - Use "rectangle" or "rounded-rectangle" for plain four-sided boxes (even with slightly hand-drawn lines); ONLY use "fc-document" when the shape clearly has a wavy bottom edge representing a document.
   - Match each drawn shape to the closest exact ID from our shape library:
     - Basic: "rectangle", "square", "rounded-rectangle", "stadium", "circle", "ellipse", "triangle", "triangle-down", "right-triangle", "rhombus", "parallelogram", "parallelogram-left", "trapezoid", "trapezoid-inverted", "cross", "x-shape", "half-circle", "donut", "cloud", "shield", "banner", "ribbon", "wave", "can"
     - Polygons & Stars: "pentagon", "hexagon", "hexagon-vertical", "heptagon", "octagon", "decagon", "star-4", "star-5", "star-6", "star-8", "explosion"
     - Arrows: "arrow-right", "arrow-left", "arrow-up", "arrow-down", "arrow-left-right", "arrow-up-down", "arrow-quad", "arrow-circular", "chevron", "pentagon-arrow"
     - Flowchart: "fc-process", "fc-alternate-process", "fc-decision", "fc-terminator", "fc-data", "fc-predefined-process", "fc-internal-storage", "fc-document", "fc-multi-document", "fc-manual-input", "fc-manual-operation", "fc-preparation", "fc-delay", "fc-display", "fc-stored-data", "fc-database", "fc-or", "fc-summing-junction", "fc-off-page-reference"
     - Callouts: "callout-rect", "callout-rounded-rect", "callout-oval", "callout-cloud"
     - 3D: "cube", "isometric-cube", "cylinder-3d", "cylinder-horizontal", "cone", "pyramid", "sphere"
     - Symbols: "heart", "lightning", "drop", "moon", "sun", "checkmark", "gear", "location-pin", "flag", "bookmark", "envelope", "clock", "hourglass", "lock", "key", "lightbulb", "trophy", "puzzle-piece", "crown", "warning-triangle"
     - UML / BPMN / ER / Network / Mockup: "uml-class", "uml-interface", "uml-package", "uml-component", "uml-actor", "uml-use-case", "uml-note", "uml-lifeline", "uml-state", "bpmn-task", "bpmn-event-start", "bpmn-event-end", "bpmn-gateway-exclusive", "bpmn-gateway-parallel", "bpmn-data-store", "er-entity", "er-relationship", "er-table", "net-server", "net-router", "net-switch", "net-firewall", "net-load-balancer", "net-globe", "net-queue", "net-user", "mock-browser-window", "mock-mobile-frame", "mock-button", "mock-text-input", "mock-modal", "mock-card"
     - Special React Flow containers: "sticky" (sticky note), "group" (frame/container)
   - Only include "edges" when there are actual connecting lines or arrows linking shapes; do NOT invent edges for standalone unlinked shapes.
   - Trace branching T-junctions carefully: when an outgoing line from node A splits into a vertical spine pointing to D, B, and C, emit A->D, A->B, and A->C (do NOT falsely chain B->C unless an arrow actually connects B to C).
   - If the user wrote labels next to connector lines ("Yes", "No", "HTTP"), transcribe them into the edge "label".

Return STRICT JSON conforming to EITHER the text-only format above OR:
{
  "title": "Clean Descriptive Diagram Title",
  "diagramType": "flowchart",
  "layoutDirection": "LR",
  "nodes": [
    {
      "id": "1",
      "type": "rounded-rectangle",
      "label": "A",
      "description": "",
      "x": 100,
      "y": 100,
      "width": 140,
      "height": 80
    }
  ],
  "edges": [
    {
      "id": "e1-2",
      "source": "1",
      "target": "2",
      "label": "Optional condition or label",
      "animated": false
    }
  ]
}

Respond with STRICT JSON ONLY. Do NOT add markdown fences or explanation.`

/* ------------------------------------------------------------------ */
/* 4. Provider adapters                                                */
/* ------------------------------------------------------------------ */

interface ChatPayload {
  system: string
  user: string
  imageBase64?: string
  model: string
  temperature?: number
  jsonMode?: boolean
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
}

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })
  const text = await res.text()
  if (!res.ok) {
    let detail = text
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } | string }
      detail =
        typeof parsed.error === 'string' ? parsed.error : (parsed.error?.message ?? text)
    } catch {
      /* keep raw text */
    }
    throw new Error(`HTTP ${res.status}: ${detail.slice(0, 400)}`)
  }
  return JSON.parse(text)
}

export function isOllamaVisionModel(name: string): boolean {
  const m = name.toLowerCase()
  return (
    m.includes('gemma') ||
    m.includes('vision') ||
    m.includes('llava') ||
    m.includes('bakllava') ||
    m.includes('moondream') ||
    m.includes('minicpm-v') ||
    m.includes('qwen2.5-vl') ||
    m.includes('qwen-vl') ||
    m.includes('deepseek-vl')
  )
}

async function callOllama(p: ChatPayload, host?: string): Promise<string> {
  const baseHost = normalizeHost(host)
  // Skip model check as gemma4 / user model is running on Ollama cloud
  const activeModel = (p.model || 'gemma4').trim()

  const messages: Array<{ role: string; content: string; images?: string[] }> = []

  // For vision models like Gemma with image inputs, merge system prompt into user prompt for robust compliance
  if (p.imageBase64 && p.system) {
    const combinedPrompt = `${p.system}\n\nUser drawing instructions & context:\n${p.user}`
    messages.push({
      role: 'user',
      content: combinedPrompt,
      images: [p.imageBase64]
    })
  } else {
    if (p.system) {
      messages.push({ role: 'system', content: p.system })
    }
    if (p.history?.length) {
      for (const h of p.history) {
        messages.push({ role: h.role, content: h.content })
      }
    }
    messages.push({
      role: 'user',
      content: p.user,
      ...(p.imageBase64 ? { images: [p.imageBase64] } : {})
    })
  }

  const body: Record<string, unknown> = {
    model: activeModel,
    stream: false,
    options: { temperature: p.temperature ?? 0.2 },
    messages
  }
  if (p.jsonMode) {
    body.format = 'json'
  }

  try {
    const data = (await postJson(`${baseHost}/api/chat`, body)) as { message?: { content?: string } }
    return data.message?.content ?? ''
  } catch (err: unknown) {
    const errMsg = String((err as Error)?.message || err)

    // Fallback 1: If Ollama rejected format: 'json' with image input, retry without format constraint
    if (body.format === 'json') {
      try {
        const bodyWithoutJson = { ...body }
        delete bodyWithoutJson.format
        const retryData = (await postJson(`${baseHost}/api/chat`, bodyWithoutJson)) as { message?: { content?: string } }
        if (retryData.message?.content) {
          return retryData.message.content
        }
      } catch {
        /* proceed to 404 handler */
      }
    }

    // Fallback 2: If the requested model is not found in local Ollama, try finding an available local model
    if (errMsg.includes('404') || errMsg.toLowerCase().includes('not found')) {
      try {
        const tagRes = await fetch(`${baseHost}/api/tags`, { signal: AbortSignal.timeout(3000) })
        if (tagRes.ok) {
          const tagData = (await tagRes.json()) as { models?: Array<{ name?: string; model?: string }> }
          const available = (tagData.models ?? []).map((m) => m.name || m.model || '').filter(Boolean)
          const candidate = p.imageBase64 ? available.find(isOllamaVisionModel) : available[0]
          if (candidate && candidate !== activeModel) {
            body.model = candidate
            delete body.format
            const retryData = (await postJson(`${baseHost}/api/chat`, body)) as { message?: { content?: string } }
            return retryData.message?.content ?? ''
          }
        }
      } catch {
        /* keep original error */
      }
    }

    if (
      p.imageBase64 &&
      (errMsg.toLowerCase().includes('does not support image') ||
        errMsg.toLowerCase().includes('images are not supported') ||
        errMsg.toLowerCase().includes('vision'))
    ) {
      throw new Error(
        `Ollama model '${activeModel}' cannot process diagram sketches. Ensure vision is enabled or configure Google Gemini in Settings.`
      )
    }

    throw err
  }
}

function isOpenAIBaseUrl(baseUrl: string): boolean {
  try {
    const parsed = new URL(baseUrl)
    return parsed.protocol === 'https:' && parsed.hostname === 'api.openai.com'
  } catch {
    return false
  }
}

async function callOpenAICompatible(baseUrl: string, apiKey: string, p: ChatPayload): Promise<string> {
  const messages: Array<{ role: string; content: unknown }> = [{ role: 'system', content: p.system }]
  if (p.history?.length) {
    for (const h of p.history) {
      messages.push({ role: h.role, content: h.content })
    }
  }

  const userContent = p.imageBase64
    ? [
        { type: 'text', text: p.user },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${p.imageBase64}` } }
      ]
    : p.user

  messages.push({ role: 'user', content: userContent })

  const body: Record<string, unknown> = {
    model: p.model,
    messages
  }

  if (isOpenAIBaseUrl(baseUrl)) {
    const profile = resolveOpenAIModelProfile(p.model)
    if (!profile.supportsTemperature) {
      body.max_completion_tokens = profile.maxOutputTokens
      if (profile.reasoningEffort && !/^o1-mini/i.test(p.model)) {
        body.reasoning_effort = profile.reasoningEffort
      }
    } else {
      body.temperature = p.temperature ?? profile.idealTemperature
      if (profile.reasoningEffort) {
        body.reasoning_effort = profile.reasoningEffort
      }
    }
  } else {
    body.temperature = p.temperature ?? 0.3
  }

  if (p.jsonMode) {
    body.response_format = { type: 'json_object' }
  }

  const data = (await postJson(`${baseUrl}/chat/completions`, body, { Authorization: `Bearer ${apiKey}` })) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  return data.choices?.[0]?.message?.content ?? ''
}

async function callGemini(apiKey: string, p: ChatPayload): Promise<string> {
  const contents: Array<{ role: string; parts: unknown[] }> = []
  if (p.history?.length) {
    for (const h of p.history) {
      contents.push({
        role: h.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: h.content }]
      })
    }
  }

  const userParts: unknown[] = [{ text: p.user }]
  if (p.imageBase64) {
    userParts.push({
      inlineData: {
        mimeType: 'image/png',
        data: p.imageBase64
      }
    })
  }
  contents.push({ role: 'user', parts: userParts })

  const genConfig: Record<string, unknown> = { temperature: p.temperature ?? 0.3 }
  if (p.jsonMode) {
    genConfig.responseMimeType = 'application/json'
  }

  const candidates = Array.from(
    new Set([
      p.model,
      'gemini-2.0-flash',
      'gemini-1.5-flash',
      'gemini-2.5-flash',
      'gemini-1.5-pro'
    ].filter(Boolean))
  )

  let lastErr: unknown = null
  for (const modelCandidate of candidates) {
    try {
      const data = (await postJson(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelCandidate)}:generateContent`,
        {
          system_instruction: { parts: [{ text: p.system }] },
          contents,
          generationConfig: genConfig
        },
        { 'x-goog-api-key': apiKey }
      )) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
      return (data.candidates?.[0]?.content?.parts ?? []).map((x) => x.text ?? '').join('')
    } catch (err) {
      lastErr = err
      const msg = String((err as Error)?.message || err)
      if (msg.includes('404') || msg.toLowerCase().includes('not found')) {
        continue
      }
      throw err
    }
  }
  throw lastErr
}

async function callClaude(apiKey: string, p: ChatPayload): Promise<string> {
  const messages: Array<{ role: string; content: unknown }> = []
  if (p.history?.length) {
    for (const h of p.history) {
      messages.push({ role: h.role, content: h.content })
    }
  }

  const userContent: unknown[] = []
  if (p.imageBase64) {
    userContent.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: p.imageBase64 }
    })
  }
  userContent.push({ type: 'text', text: p.user })
  messages.push({ role: 'user', content: userContent })

  const candidates = Array.from(
    new Set([
      p.model,
      'claude-3-7-sonnet-20250219',
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022'
    ].filter(Boolean))
  )

  let lastErr: unknown = null
  for (const modelCandidate of candidates) {
    try {
      const data = (await postJson(
        'https://api.anthropic.com/v1/messages',
        {
          model: modelCandidate,
          max_tokens: 3000,
          temperature: Math.min(1, p.temperature ?? 0.3),
          system: p.system,
          messages
        },
        { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
      )) as { content?: Array<{ type: string; text?: string }> }
      return (data.content ?? [])
        .filter((c) => c.type === 'text')
        .map((c) => c.text ?? '')
        .join('')
    } catch (err) {
      lastErr = err
      const msg = String((err as Error)?.message || err)
      if (msg.includes('404') || msg.toLowerCase().includes('not found')) {
        continue
      }
      throw err
    }
  }
  throw lastErr
}

/* ------------------------------------------------------------------ */
/* 5. JSON extraction & sanitization                                  */
/* ------------------------------------------------------------------ */

function extractJson(raw: string): Record<string, unknown> {
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim()
  try {
    return JSON.parse(cleaned) as Record<string, unknown>
  } catch {
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>
    }
    throw new Error(`Model did not return JSON: ${cleaned.slice(0, 160)}`)
  }
}



/* ------------------------------------------------------------------ */
/* 6. Unified AI Entrypoint                                            */
/* ------------------------------------------------------------------ */

export async function runAIRequest(req: AIRequest): Promise<AIResponse> {
  try {
    const provider = req.provider ?? 'ollama'
    const model = (req.model || DEFAULT_PROVIDER_MODELS[provider]).trim()
    const resolvedTemp =
      typeof req.temperature === 'number' && Number.isFinite(req.temperature)
        ? Math.max(0, Math.min(2, req.temperature))
        : undefined

    // Task A: Handwriting Text or Equation OCR
    if (req.isHandwritingOCR || req.isEquationOCR) {
      if (!req.imageBase64) {
        return { ok: false, error: 'No stroke image provided for recognition.' }
      }
      const system = req.isEquationOCR ? EQUATION_OCR_SYSTEM_PROMPT : OCR_SYSTEM_PROMPT
      const user = req.isEquationOCR
        ? 'Transcribe this mathematical equation into LaTeX. Return the JSON object only.'
        : 'Transcribe the handwritten text in this image. Return the JSON object only.'

      const payload: ChatPayload = {
        model,
        system,
        user,
        temperature: resolvedTemp,
        imageBase64: req.imageBase64,
        jsonMode: true
      }
      const raw = await dispatchProvider(provider, payload, req.ollamaHost)
      const parsed = extractJson(raw)
      const recognizedText = String(parsed['recognizedText'] ?? parsed['text'] ?? parsed['formula'] ?? '').trim()
      return { ok: true, recognizedText }
    }

    // Task B: Hand-Drawn Diagram Beautification to React Flow Diagram
    if (req.isBeautifyDiagram) {
      if (!req.imageBase64 && !req.prompt) {
        return { ok: false, error: 'No diagram drawing or description provided for beautification.' }
      }

      const userPrompt = req.prompt
        ? `Analyze this hand-drawn diagram and convert it into a clean, complete React Flow diagram JSON structure.\n\nDrawing elements & extracted labels:\n${req.prompt}`
        : 'Analyze this hand-drawn diagram and convert it into a clean, complete React Flow diagram JSON structure.'

      const payload: ChatPayload = {
        model,
        system: BEAUTIFY_DIAGRAM_SYSTEM_PROMPT,
        user: userPrompt,
        temperature: resolvedTemp,
        imageBase64: req.imageBase64,
        jsonMode: true
      }

      const raw = await dispatchProvider(provider, payload, req.ollamaHost)
      return {
        ok: true,
        reply: raw.trim()
      }
    }

    // Task C: Explicit diagram generation request (React Flow)
    if (!req.isChat && req.prompt?.startsWith('DIAGRAM_GEN:')) {
      const actualPrompt = req.prompt.replace('DIAGRAM_GEN:', '').trim()
      const payload: ChatPayload = {
        model,
        system: REACTFLOW_DIAGRAM_SYSTEM_PROMPT,
        user: `Generate an interactive React Flow diagram for this concept:\n\n${actualPrompt}`,
        temperature: resolvedTemp,
        jsonMode: true
      }
      const raw = await dispatchProvider(provider, payload, req.ollamaHost)
      return {
        ok: true,
        reply: raw.trim()
      }
    }

    // Task D: Structured Whiteboard Tutorial Generation
    if (req.isTutorial) {
      const topic = req.tutorialTopic || req.prompt || 'System Design'
      let contextPrefix = ''
      if (req.projectId && req.includeProjectContext !== false) {
        const projCtx = dbManager.getProjectContextSummary(req.projectId, req.boardContext ? req.sectionId : undefined)
        if (projCtx) {
          contextPrefix += `[Project Context]\n${projCtx}\n\n`
        }
      }
      if (req.boardContext) {
        contextPrefix += `[Whiteboard Context]\n${req.boardContext}\n\n`
      }
      if (req.attachments && req.attachments.length > 0) {
        contextPrefix += `[Referenced Knowledge Sources]\n${req.attachments.map((a) => a.textContent || '').join('\n')}\n\n`
      }
      const { snippet: ragSnippet } = getRagContextSnippet(topic, {
        sourceIds: req.sourceIds,
        projectId: req.projectId,
        boardId: req.sectionId
      })
      if (ragSnippet) {
        contextPrefix += `[Local Vector Knowledge Matches]\n${ragSnippet}\n\n`
      }

      const payload: ChatPayload = {
        model,
        system: TUTORIAL_SYSTEM_PROMPT,
        user: `${contextPrefix}Teach this topic visually for an interactive whiteboard tutorial:\n\n${topic}`,
        temperature: resolvedTemp ?? 0.2,
        jsonMode: true
      }

      let raw = ''
      try {
        raw = await dispatchProvider(provider, payload, req.ollamaHost)
        const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim()
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
        const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : cleaned)
        const tutorialObj = parsed.tutorial || (parsed.steps ? parsed : null)
        if (tutorialObj && Array.isArray(tutorialObj.steps) && tutorialObj.steps.length > 0) {
          return {
            ok: true,
            reply: tutorialObj.overview || `Tutorial on ${topic}`,
            tutorial: tutorialObj
          }
        }
      } catch (tutErr) {
        console.warn('[Tutorial] Using structured local tutorial fallback:', tutErr)
      }

      const fallback = buildFallbackTutorial(topic, raw.trim() || undefined)
      return {
        ok: true,
        reply: fallback.overview,
        tutorial: fallback
      }
    }

    // Task E: Conversational Q&A for the Right Panel & Knowledge Studio
    const prompt = (req.prompt ?? '').trim()
    if (!prompt) {
      return { ok: false, error: 'Empty question prompt.' }
    }

    // Process attachments & multi-source context
    let enrichedPrompt = prompt
    let imageBase64 = req.imageBase64

    if (req.attachments && req.attachments.length > 0) {
      const imgAttachment = req.attachments.find((a) => a.type === 'image' && a.imageBase64)
      if (imgAttachment && !imageBase64) {
        imageBase64 = imgAttachment.imageBase64
      }

      const textAttachments = req.attachments
        .filter((a) => a.type !== 'image' && a.textContent)
        .map((a) => `[Source: ${a.name} (${a.type})]\n${a.textContent?.slice(0, 8000)}`)
        .join('\n\n')

      if (textAttachments) {
        enrichedPrompt = `[ATTACHED SOURCES & KNOWLEDGE GROUNDING]\n${textAttachments}\n\n[USER QUERY]\n${prompt}`
      }
    }

    const { snippet: ragSnippet, pinnedTitles } = getRagContextSnippet(prompt, {
      sourceIds: req.sourceIds,
      projectId: req.projectId,
      boardId: req.sectionId
    })
    if (ragSnippet) {
      const ragLabel =
        pinnedTitles.length > 0
          ? `[EXPLICITLY REFERENCED KNOWLEDGE STUDIO BOOKS / SOURCES: ${pinnedTitles.join(', ')}]`
          : '[INDEXED NOTEBOOK SOURCES (SQLite RAG)]'
      enrichedPrompt = `${ragLabel}\n${ragSnippet}\n\n${enrichedPrompt}`
    }

    if (req.boardContext) {
      enrichedPrompt = `[CURRENT WHITEBOARD BOARD CONTEXT]\n${req.boardContext}\n\n${enrichedPrompt}`
    }

    let projectContext = ''
    if (req.projectId && req.includeProjectContext !== false) {
      projectContext = dbManager.getProjectContextSummary(
        req.projectId,
        req.boardContext ? req.sectionId : undefined
      )
      if (projectContext) {
        enrichedPrompt = `[PROJECT WORKSPACE CONTEXT (Previous Sections, Materials & Books)]\n${projectContext}\n\n${enrichedPrompt}`
      }
    }

    let systemPrompt = CHAT_SYSTEM_PROMPT
    if (pinnedTitles.length > 0) {
      systemPrompt += `\n\nIMPORTANT: The user explicitly asked you to refer to these Knowledge Studio book(s)/source(s): ${pinnedTitles.map((t) => `"${t}"`).join(', ')}. Prioritize and strictly ground your answer in these referenced sources, citing their title and relevant details.`
    } else if ((req.attachments && req.attachments.length > 0) || ragSnippet) {
      systemPrompt += `\n\nWhen sources, documents, or YouTube transcripts are provided, strictly ground your answers in those sources whenever applicable. Cite sources by name (e.g. [Document Name] or [YouTube: mm:ss]) when referencing facts.`
    }
    if (projectContext) {
      systemPrompt += `\n\nYou also have visibility into the user's current Project sections and previous whiteboard materials. When helpful, connect answers to their earlier notes, diagrams, code, or books in this project.`
    }

    const payload: ChatPayload = {
      model,
      system: systemPrompt,
      user: enrichedPrompt,
      temperature: resolvedTemp,
      history: req.chatHistory,
      imageBase64,
      jsonMode: false
    }

    const raw = await dispatchProvider(provider, payload, req.ollamaHost)
    return { ok: true, reply: raw.trim() }
  } catch (err) {
    return { ok: false, error: errorMessage(err) }
  }
}

async function dispatchProvider(
  provider: ProviderId,
  payload: ChatPayload,
  ollamaHost?: string
): Promise<string> {
  switch (provider) {
    case 'ollama':
      return callOllama(payload, ollamaHost)
    case 'openai':
      return callOpenAICompatible('https://api.openai.com/v1', loadApiKey('openai'), payload)
    case 'grok':
      return callOpenAICompatible('https://api.x.ai/v1', loadApiKey('grok'), payload)
    case 'gemini':
      return callGemini(loadApiKey('gemini'), payload)
    case 'claude':
      return callClaude(loadApiKey('claude'), payload)
    default:
      throw new Error(`Unsupported AI provider: ${provider}`)
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
