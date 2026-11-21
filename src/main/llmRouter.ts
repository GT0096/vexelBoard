import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { dbManager } from './db'
import { unescapeLlmCode, unescapeLlmText } from '../shared/textUnescape'
import {
  formatDiscoveredAssetsForPrompt,
  inferPedagogicalApproach,
  searchBoardAssets
} from '../shared/boardCatalog'
import { SpatialSceneSchema, normalizeSpatialSceneInput } from '../shared/beautifySchema'
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

export function loadApiKey(provider: ByokProvider): string {
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
The user is studying concepts or solving problems across any field (mathematics, chemistry, biology, atomic/classical physics, quantitative markets, software systems, etc.).
Reason from first principles and structure your explanation natively for the subject: combine causal mechanisms, governing formulas/stoichiometry, diagrams, or code as appropriate.
Structure your answers with markdown:
- Use bullet points, bold keywords, and clear headings.
- Include code blocks or LaTeX formulas where relevant ($...$ or $$...$$).

AGENTIC TOOL CALL - create_diagram:
When the user asks you to create, sketch, or generate a connected diagram or workflow, call the agentic "create_diagram" tool using the matching shape IDs provided in [DISCOVERED FIRST-PRINCIPLES BOARD PRIMITIVES & ASSETS] by outputting a JSON object:
\`\`\`json
{
  "tool": "create_diagram",
  "arguments": {
    "title": "Clean Descriptive Diagram Title",
    "diagramType": "flowchart",
    "nodes": [
      { "id": "1", "type": "rounded-rect", "label": "Node Label", "description": "" }
    ],
    "edges": [
      { "id": "e1-2", "source": "1", "target": "2", "label": "relation" }
    ]
  }
}
\`\`\``

const TUTORIAL_SYSTEM_PROMPT = `You are a First-Principles Master Educator & Visual Synthesizer for an interactive canvas whiteboard.
Do NOT force any topic into a rigid preset template. Before drafting a single element, reason from FIRST PRINCIPLES about what the user actually needs in order to deeply understand THIS topic:
- Identify the fundamental entities, conserved quantities, reactions, state variables, or spatial structures involved.
- Design the custom visual representation, symbolic formalism (LaTeX equations/reactions), and conceptual explanation natively tailored to the phenomenon (e.g., atomic orbitals + photon emission waves, organic chemical rings + energy profiles, biological cell/organelle membranes + codon chains, differential/algebraic derivations, free-body vectors, market payoffs, memory traces, or distributed topologies).

You MUST respond with a single valid JSON object adhering strictly to this format (no markdown code blocks, just raw JSON):
{
  "tutorial": {
    "topic": "Topic Name",
    "approach": "Concise name of the first-principles teaching approach you designed",
    "pedagogicalRationale": "1-sentence explanation of why these primitives and steps best fit this topic.",
    "fontFamily": "serif | mono | grotesk | caveat | jakarta",
    "accentFill": "#hex (optional semantic banner tint matching the phenomenon)",
    "overview": "Clear 2-sentence first-principles intuition of the core mechanism.",
    "steps": [
      {
        "title": "1. Focused Step Title",
        "explanation": "Clear explanation tailored to this step.",
        "keyPoints": ["Concise key takeaway"],
        "equations": ["optional step-by-step LaTeX equations, balanced reactions, or formal laws"],
        "scene": null,
        "diagramNodes": [],
        "diagramEdges": [],
        "codeSnippet": null
      }
    ]
  }
}

UNIVERSAL COMPOSABLE "scene" PRIMITIVES (0..1000 local coordinates — synthesize ANY visual from first principles):
{"title":"...","elements":[...]}
1. "shape": {"type":"shape","id":"...","kind":"circle|ellipse|rect|rounded_rect|hexagon|pentagon|octagon|triangle|diamond|star-5|cross|sphere3d|cube3d|cylinder|<libraryId>","cx":500,"cy":500,"r":180} (or "x","y","w","h"), optional "fill":"#hex", "fillOpacity":0.0..1.0, "stroke":"#hex", "strokeStyle":"solid|dashed|dotted", "strokeWidth":2.5, "rotation":deg, "animated":true|false, "label":"...".
   - Ideal for concentric atomic orbitals, chemical aromatic/sugar rings (hexagon/pentagon), particles, molecules, masses, and translucent cellular compartments.
2. "svg_path": {"type":"svg_path","id":"...","d":"M ... C ... Q ... Z","fill":"#hex","fillOpacity":0.3,"stroke":"#hex","strokeWidth":3,"label":"...","animated":false} (or "paths":[{d,fill,stroke}]).
   - Ideal for ANY arbitrary smooth Bezier geometry: cell membranes, chloroplasts/mitochondria, enzymes, optical lenses, waveguides, potential wells, anatomical outlines.
3. "connector": {"type":"connector","id":"...","points":[[x1,y1],[x2,y2],...],"curved":true|false,"arrowStart":false,"arrowEnd":true|false,"style":"solid|dashed|dotted","stroke":"#hex","strokeWidth":2.5,"animated":true|false,"animationMode":"pulse|dash|both","pulseColor":"#hex","flowStage":0,"label":"..."}.
   - Use 2 points for vectors/bonds/axes, 3 points with curved:true for quadratic arcs, or 4+ points with curved:true for smooth splines (sine/photon waves, activation energy hills, titration/payoff/trajectory curves).
4. "cell_strip": {"type":"cell_strip","id":"...","orientation":"horizontal|vertical","x":..,"y":..,"w":..,"h":..,"cells":["..."],"cellGap":24,"connectorArrows":"forward|bidirectional|circular|none","openEnds":["start"]}.
   - Use contiguous strips for stacks/queues/matrices/orbital spin boxes, OR cellGap + connectorArrows for spaced sequences (mRNA codons, polymer chains, metabolic steps, linked nodes).
5. "text": {"type":"text","id":"...","x":..,"y":..,"text":"...","fontSize":18,"bold":true,"align":"center","color":"#hex"}.

Guidelines:
- Generate 2 to 5 focused steps tailored cleanly to the subject.
- Compose ONLY the primitives each step genuinely needs — leave "diagramNodes": [] and "codeSnippet": null when not relevant.`

function extractFallbackSectionsFromReply(rawReply?: string): {
  headings: Array<{ title: string; body: string }>
  equations: string[]
  codeBlocks: Array<{ language: string; code: string }>
} {
  if (!rawReply || !rawReply.trim()) {
    return { headings: [], equations: [], codeBlocks: [] }
  }
  const text = rawReply.trim()
  const equations: string[] = []
  const displayEqRe = /\$\$([\s\S]+?)\$\$/g
  let m: RegExpExecArray | null
  while ((m = displayEqRe.exec(text)) !== null) {
    const eq = m[1].trim()
    if (eq && equations.length < 4) equations.push(eq)
  }

  const codeBlocks: Array<{ language: string; code: string }> = []
  const codeRe = /```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g
  while ((m = codeRe.exec(text)) !== null) {
    const code = m[2].trim()
    if (code && codeBlocks.length < 2) {
      codeBlocks.push({ language: m[1] || 'python', code })
    }
  }

  const headings: Array<{ title: string; body: string }> = []
  const sectionParts = text.split(/^#{1,3}\s+/m).map((s) => s.trim()).filter(Boolean)
  for (const part of sectionParts.slice(0, 4)) {
    const nl = part.indexOf('\n')
    if (nl > 0) {
      const title = part.slice(0, nl).trim().slice(0, 64)
      const body = part.slice(nl + 1).trim().slice(0, 420)
      if (title && body) headings.push({ title, body })
    }
  }

  return { headings, equations, codeBlocks }
}

function buildFallbackTutorial(topic: string, rawReply?: string): TutorialPayload {
  const cleanTopic = topic.trim() || 'Topic Overview'
  const approach = inferPedagogicalApproach(cleanTopic)
  const discovered = searchBoardAssets({ query: cleanTopic, assetType: 'colors', limit: 1 })
  const palette = discovered.colorPalettes[0]
  const parsed = extractFallbackSectionsFromReply(rawReply)

  if (parsed.headings.length > 0) {
    return {
      topic: cleanTopic,
      approach: approach.name,
      pedagogicalRationale: approach.structureGuide,
      fontFamily: approach.recommendedFont,
      accentFill: palette?.noteCardFill || '#FEF9C3',
      overview:
        rawReply?.replace(/[#*`]/g, '').trim().slice(0, 320) ||
        `First-principles breakdown of ${cleanTopic}.`,
      steps: parsed.headings.map((sec, idx) => ({
        title: `${idx + 1}. ${sec.title}`,
        explanation: sec.body,
        keyPoints: [],
        equations: idx === 0 && parsed.equations.length > 0 ? parsed.equations : undefined,
        codeSnippet:
          idx === parsed.headings.length - 1 && parsed.codeBlocks[0] ? parsed.codeBlocks[0] : null
      }))
    }
  }

  return {
    topic: cleanTopic,
    approach: approach.name,
    pedagogicalRationale: approach.structureGuide,
    fontFamily: approach.recommendedFont,
    accentFill: palette?.noteCardFill || '#FEF9C3',
    overview:
      rawReply?.slice(0, 320) ||
      `First-principles conceptual synthesis for ${cleanTopic}. Retry with an active AI provider to generate full spatial visuals and domain formalism.`,
    steps: [
      {
        title: `1. Core Entities & First Principles of ${cleanTopic}`,
        explanation:
          rawReply ||
          `Decompose **${cleanTopic}** into its fundamental interacting components, state transitions, and governing conservation or causality rules.`,
        keyPoints: [
          `Identify the constituent components, forces, or state variables of ${cleanTopic}`,
          'Specify the causal mechanism linking initial state to observed outcome'
        ],
        equations: parsed.equations.length > 0 ? parsed.equations : undefined,
        codeSnippet: parsed.codeBlocks[0] ?? null
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
      ? dbManager.getKnowledgeSources(opts.boardId, opts.projectId, { includeRawContent: true })
      : dbManager.getKnowledgeSources(undefined, undefined, { includeRawContent: true })
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

const REACTFLOW_DIAGRAM_SYSTEM_PROMPT = `You are an expert Technical Architecture & Board Diagram Generator.
Convert the provided concept, system design, business process, or workflow into a structured connected diagram using native board shape IDs from [DISCOVERED FIRST-PRINCIPLES BOARD PRIMITIVES & ASSETS] in the prompt.

Return STRICT JSON ONLY matching:
{
  "title": "Diagram Title",
  "diagramType": "flowchart",
  "nodes": [
    {
      "id": "1",
      "type": "rounded-rect",
      "label": "Node Label",
      "description": "",
      "x": 200,
      "y": 50
    }
  ],
  "edges": [
    {
      "id": "e1-2",
      "source": "1",
      "target": "2",
      "label": "",
      "animated": false
    }
  ]
}

Respond with STRICT JSON only. Do NOT wrap in markdown code blocks or introductory commentary.`

const BEAUTIFY_DIAGRAM_SYSTEM_PROMPT = `You are a World-Class Technical Diagram Architect & Vision Specialist for an interactive whiteboard application.
Your task is to analyze a hand-drawn sketch, diagram, or handwritten notes drawn by a user and either:
A) Convert pure handwritten text/words/notes into clean well-written text, OR
B) Transform any drawn shapes, flowchart, architecture map, circuit, or UI wireframe into an impeccably structured diagram JSON using the matching board shape IDs provided in [DISCOVERED FIRST-PRINCIPLES BOARD PRIMITIVES & ASSETS].

Analyze the user's drawing carefully:
1. DISTINGUISH HANDWRITTEN TEXT VS SHAPES/DIAGRAMS:
   - If the image ONLY contains handwritten words, sentences, bullet points, or notes with NO geometric shapes, boxes, icons, or diagram connectors, respond ONLY with:
     {"isTextOnly": true, "recognizedText": "Cleanly transcribed, well-written text preserving line breaks"}
   - Otherwise, identify every drawn shape, box, icon, container, arrow, and connector line.
2. PRESERVE EXACT ORIENTATION, SHAPE GEOMETRY, LABELS & TOPOLOGY:
   - NEVER rotate, transpose, or convert a Left-to-Right (LR) diagram into Top-to-Bottom (TB), or vice versa! Preserve the EXACT 2D spatial layout from the image using pixel coordinates relative to top-left (0, 0) ("x", "y", "width", "height"): shapes on the left must have smaller "x", shapes on the right must have larger "x", shapes near the top must have smaller "y", and shapes near the bottom must have larger "y".
   - Keep the EXACT text written inside each shape in "label" (e.g. if the user wrote "D", output "D", NOT "Decision"; if "A", output "A"). Set "description": "" unless secondary descriptive text is actually written in the drawing—NEVER invent placeholder descriptions.
   - Match each drawn shape to the closest matching shape ID from the discovered board asset catalog provided in context (use rectangular box IDs for plain 4-sided boxes, diamond IDs for rhombuses/decisions, cylinder/cloud/server/ml/uml IDs only when visually drawn).
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
      "type": "rounded-rect",
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

const VECTORIZE_DRAWING_SYSTEM_PROMPT = `You are a Principal Vector Illustrator & Diagram Architect for an infinite digital whiteboard.
Your task is to analyze ANY hand-drawn sketch, diagram, multi-diagram composition, scientific figure, or handwritten notes and synthesize a clean, crisp, textbook-grade SVG that faithfully redraws EVERYTHING in the image.

FIRST think carefully in "analysis":
- Inventory EVERY distinct object, sub-diagram, container, compartment, open wall, line, arrow (and its exact direction!), curve, and exact handwritten word/letter in the image.
- Note their exact spatial relationships (top vs bottom, left vs right, inside vs outside, open vs closed ends, pointing from X to Y).

THEN output a single clean, minimalist, publication-grade SVG in "svg":
- Set viewBox="0 0 W H" matching the aspect ratio of the user's drawing (e.g. using the exact pixel width & height provided in the prompt, with ~40px clean breathing margin).
- Use clean, standard SVG primitives so every part is crisp and individually editable:
  * <rect x y width height rx fill stroke stroke-width /> — use rx="0" for flush/touching compartments, grids, or tiled cells; rx="8" for standalone rounded cards.
  * <circle cx cy r fill stroke stroke-width /> and <ellipse cx cy rx ry />
  * <line x1 y1 x2 y2 stroke stroke-width marker-end="url(#arrow)" /> — for straight lines, extension walls, dividers, and straight arrows.
  * <polyline points="x1,y1 x2,y2 x3,y3" fill="none" stroke stroke-width marker-end="url(#arrow)" /> — for crisp 90° L-shaped or stepped bent arrows!
  * <polygon points="..." /> — for triangles, diamonds, hexagons.
  * <path d="M... Q... C... L..." /> — for smooth curves, arcs, waves, clouds, organic illustrations, physics/math curves, or custom icons.
  * <text x y font-size font-weight="700" text-anchor="middle|start|end">Exact text</text>
- Define a clean arrowhead marker inside <defs> whenever arrows are used:
  <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 1 L 10 5 L 0 9 z" /></marker></defs>
  Attach marker-end="url(#arrow)" (and marker-start="url(#arrow)" for bidirectional arrows) to <line>, <polyline>, or <path> elements.

UNIVERSAL VISUAL CRAFTSMANSHIP RULES:
1. COMPLETENESS: Reproduce EVERY sub-diagram, cell, wall, arrow, and text label visible in the image (e.g. if there are two diagrams, draw BOTH in their exact relative positions!). Never drop elements and NEVER invent extra labels that were not drawn.
2. GEOMETRIC PRECISION:
   - Touching/stacked/tiled compartments MUST share exact mathematical edges (zero gaps, zero overlaps, identical widths/heights, rx="0").
   - Open walls/rails MUST touch the exact corners of their adjacent compartments.
   - Straight lines & arrows MUST be perfectly horizontal (y1=y2) or vertical (x1=x2) when drawn roughly straight.
   - Bent arrows MUST use crisp 90° orthogonal <polyline> corners unless a smooth curved arc was clearly intended.
   - Arrowheads MUST point in the EXACT direction drawn by the user!
3. CLEAN TYPOGRAPHY & ZERO OVERLAPS:
   - Text inside a closed cell/shape MUST be centered cleanly inside it (text-anchor="middle", font-size proportional to cell height, ~45% of cell height for single letters).
   - External labels MUST be upright, horizontal, bold, and placed with clear whitespace (~10–14px) away from strokes and borders — NEVER overlapping any line or rectangle edge!
4. COLORS & TRANSPARENT CANVAS:
   - Do NOT draw a background rectangle! Leave the canvas completely transparent so the vector immerses seamlessly into the board.
   - Preserve any explicit colors drawn by the user, and use fill="none" for hollow wireframe strokes.
5. PURE HANDWRITTEN TEXT:
   - If the image contains ONLY handwritten words/notes with NO shapes or arrows, respond with:
     {"isTextOnly": true, "recognizedText": "Exact transcribed text preserving line breaks"}

Respond with STRICT JSON ONLY:
{
  "analysis": "Concise inventory of all elements, text labels, arrow directions, and spatial layout",
  "svg": "<svg xmlns=\\"http://www.w3.org/2000/svg\\" viewBox=\\"0 0 600 500\\">...</svg>"
}
No markdown code fences or extra prose outside the JSON.`

const VECTORIZE_CRITIQUE_SYSTEM_PROMPT = `You are a Meticulous Visual QA Critic & SVG Precision Engineer.
You are given a SIDE-BY-SIDE image:
- LEFT ("ORIGINAL SKETCH"): The user's original hand-drawn whiteboard sketch.
- RIGHT ("GENERATED VECTOR"): The live rendered result of the SVG code provided in the prompt.

Carefully compare LEFT vs RIGHT visually and check ALL 5 criteria:
1. COMPLETENESS: Is EVERY sub-diagram, cell, open wall, divider, arrow, curve, and text label from LEFT present in RIGHT?
2. FIDELITY: Do ALL arrows point in the EXACT same direction as LEFT? Are ALL text strings spelled identically to LEFT without hallucinated extras?
3. ALIGNMENT & PROPORTIONS: Are stacked/adjacent cells flush with equal size and rx="0"? Are open walls locked cleanly to cell corners? Are bent arrows crisp 90° polylines?
4. ZERO OVERLAPS: Does ANY text overlap a shape border, arrow shaft, or another text label? Is every cell label centered cleanly inside its cell?
5. CLEANLINESS: Is there any stray artifact, broken arrow, or unwanted background rectangle?

If RIGHT is already faithful, complete, crisp, and overlap-free, respond with STRICT JSON:
{"approved": true}

If ANY issue exists, fix the SVG coordinates/elements surgically and respond with STRICT JSON:
{
  "approved": false,
  "issues": "Concise summary of what was wrong and fixed",
  "svg": "<svg xmlns=\\"http://www.w3.org/2000/svg\\" viewBox=\\"0 0 W H\\">...</svg>"
}
Respond with STRICT JSON ONLY. No markdown fences or extra prose.`

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
        `Ollama model '${activeModel}' cannot process diagram sketches. Ensure vision is enabled or configure Google Gemini in Settings.`,
        { cause: err }
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

    // Task B: Hand-Drawn Diagram Beautification to Native Board Diagram
    if (req.isBeautifyDiagram) {
      if (!req.imageBase64 && !req.prompt) {
        return { ok: false, error: 'No diagram drawing or description provided for beautification.' }
      }

      const discoveredAssets = formatDiscoveredAssetsForPrompt(req.prompt || 'flowchart diagram', 22)
      const userPrompt = req.prompt
        ? `Analyze this hand-drawn diagram and convert it into a clean, complete diagram JSON structure.\n\n${discoveredAssets}\n\nDrawing elements & extracted labels:\n${req.prompt}`
        : `Analyze this hand-drawn diagram and convert it into a clean, complete diagram JSON structure.\n\n${discoveredAssets}`

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

    // Task B2: Agentic Hand-Drawn Sketch -> Clean Vector SVG Synthesis
    if (req.isVectorizeDrawing) {
      if (!req.imageBase64 && !req.prompt) {
        return { ok: false, error: 'No drawing provided for vectorization.' }
      }

      const userPrompt = req.prompt
        ? `Analyze this hand-drawn whiteboard selection carefully and synthesize a clean, complete, textbook-grade SVG redrawing every item faithfully.\n\nContext:\n${req.prompt}`
        : 'Analyze this hand-drawn whiteboard selection carefully and synthesize a clean, complete, textbook-grade SVG redrawing every item faithfully.'

      const payload: ChatPayload = {
        model,
        system: VECTORIZE_DRAWING_SYSTEM_PROMPT,
        user: userPrompt,
        temperature: resolvedTemp !== undefined ? Math.min(resolvedTemp, 0.2) : undefined,
        imageBase64: req.imageBase64,
        jsonMode: true
      }

      const raw = await dispatchProvider(provider, payload, req.ollamaHost)
      return {
        ok: true,
        reply: raw.trim()
      }
    }

    // Task B3: Agentic Visual Critique & Self-Repair Pass (Original Sketch vs Generated Vector)
    if (req.isVectorizeCritique) {
      if (!req.imageBase64) {
        return { ok: false, error: 'No side-by-side comparison image provided for critique.' }
      }

      const payload: ChatPayload = {
        model,
        system: VECTORIZE_CRITIQUE_SYSTEM_PROMPT,
        user:
          req.prompt ||
          'Compare LEFT (original sketch) with RIGHT (generated vector) and either approve or return a repaired SVG.',
        temperature: resolvedTemp !== undefined ? Math.min(resolvedTemp, 0.15) : undefined,
        imageBase64: req.imageBase64,
        jsonMode: true
      }

      const raw = await dispatchProvider(provider, payload, req.ollamaHost)
      return {
        ok: true,
        reply: raw.trim()
      }
    }

    // Task C: Explicit diagram generation request
    if (!req.isChat && req.prompt?.startsWith('DIAGRAM_GEN:')) {
      const actualPrompt = req.prompt.replace('DIAGRAM_GEN:', '').trim()
      const discoveredAssets = formatDiscoveredAssetsForPrompt(actualPrompt, 18)
      const payload: ChatPayload = {
        model,
        system: REACTFLOW_DIAGRAM_SYSTEM_PROMPT,
        user: `Generate a board diagram JSON for this concept using the discovered shapes below:\n\n${discoveredAssets}\n\nConcept:\n${actualPrompt}`,
        temperature: resolvedTemp,
        jsonMode: true
      }
      const raw = await dispatchProvider(provider, payload, req.ollamaHost)
      return {
        ok: true,
        reply: raw.trim()
      }
    }

    // Task D: Domain-Adaptive Whiteboard Tutorial Generation
    if (req.isTutorial) {
      const topic = req.tutorialTopic || req.prompt || 'System Design'
      const discovered = searchBoardAssets({ query: topic, assetType: 'all', limit: 14 })
      const inferredApproach = discovered.recommendedApproach
      const discoveredAssetsPrompt = formatDiscoveredAssetsForPrompt(topic, 14)

      let contextPrefix = `${discoveredAssetsPrompt}\n\n`
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
        user: `${contextPrefix}Decompose the topic below from first principles using the discovered primitives, shapes, fonts, and semantic suggestions above, and synthesize a custom visual whiteboard tutorial:\n\n${topic}`,
        temperature: resolvedTemp ?? 0.25,
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
          const topPalette = discovered.colorPalettes[0]
          const sanitizedTutorial: TutorialPayload = {
            topic: unescapeLlmText(tutorialObj.topic || topic),
            overview: unescapeLlmText(tutorialObj.overview || `Visual tutorial on ${topic}.`),
            approach:
              typeof tutorialObj.approach === 'string' && tutorialObj.approach.trim()
                ? tutorialObj.approach.trim()
                : inferredApproach.id,
            pedagogicalRationale:
              typeof tutorialObj.pedagogicalRationale === 'string' &&
              tutorialObj.pedagogicalRationale.trim()
                ? unescapeLlmText(tutorialObj.pedagogicalRationale)
                : inferredApproach.structureGuide,
            fontFamily:
              typeof tutorialObj.fontFamily === 'string' && tutorialObj.fontFamily.trim()
                ? tutorialObj.fontFamily.trim()
                : inferredApproach.recommendedFont,
            accentFill:
              typeof tutorialObj.accentFill === 'string' && tutorialObj.accentFill.trim()
                ? tutorialObj.accentFill.trim()
                : topPalette?.nodeFill,
            steps: (tutorialObj.steps as unknown[]).map((rawStep: unknown, idx: number) => {
              const st =
                rawStep && typeof rawStep === 'object'
                  ? (rawStep as Record<string, unknown>)
                  : {}
              const rawEquations = Array.isArray(st.equations)
                ? st.equations.map((eq: unknown) => String(eq ?? '').trim()).filter(Boolean)
                : []
              const singleEq = typeof st.equationLatex === 'string' ? st.equationLatex.trim() : ''
              let validScene: unknown = undefined
              if (st.scene && typeof st.scene === 'object') {
                const normalizedScene = normalizeSpatialSceneInput(st.scene)
                const checkedScene = SpatialSceneSchema.safeParse(normalizedScene)
                if (checkedScene.success) {
                  validScene = checkedScene.data
                }
              }
              const snippetObj =
                st.codeSnippet && typeof st.codeSnippet === 'object'
                  ? (st.codeSnippet as Record<string, unknown>)
                  : null
              return {
                title: unescapeLlmText(
                  typeof st.title === 'string' && st.title.trim() ? st.title : `Step ${idx + 1}`
                ),
                explanation: unescapeLlmText(
                  typeof st.explanation === 'string' ? st.explanation : ''
                ),
                keyPoints: Array.isArray(st.keyPoints)
                  ? st.keyPoints.map((k: unknown) => unescapeLlmText(String(k ?? ''))).filter(Boolean)
                  : [],
                equations: rawEquations.length > 0 ? rawEquations : singleEq ? [singleEq] : undefined,
                equationLatex: singleEq || rawEquations[0] || undefined,
                scene: validScene,
                diagramMermaid:
                  typeof st.diagramMermaid === 'string' && st.diagramMermaid.trim()
                    ? unescapeLlmText(st.diagramMermaid)
                    : undefined,
                diagramNodes:
                  Array.isArray(st.diagramNodes) && st.diagramNodes.length > 0
                    ? (st.diagramNodes as TutorialPayload['steps'][number]['diagramNodes'])
                    : undefined,
                diagramEdges:
                  Array.isArray(st.diagramEdges) && st.diagramEdges.length > 0
                    ? (st.diagramEdges as TutorialPayload['steps'][number]['diagramEdges'])
                    : undefined,
                codeSnippet:
                  snippetObj &&
                  typeof snippetObj.code === 'string' &&
                  snippetObj.code.trim()
                    ? {
                        language:
                          typeof snippetObj.language === 'string' && snippetObj.language.trim()
                            ? snippetObj.language
                            : 'python',
                        code: unescapeLlmCode(snippetObj.code)
                      }
                    : null
              }
            })
          }
          return {
            ok: true,
            reply: sanitizedTutorial.overview,
            tutorial: sanitizedTutorial
          }
        }
      } catch (tutErr) {
        console.warn('[Tutorial] Using domain-adaptive local tutorial fallback:', tutErr)
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

    // Process attachments & multi-source context while keeping the user's question anchored first & last
    let imageBase64 = req.imageBase64
    const contextBlocks: string[] = []

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
        contextBlocks.push(`[ATTACHED SOURCES & KNOWLEDGE GROUNDING]\n${textAttachments}`)
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
      contextBlocks.push(`${ragLabel}\n${ragSnippet}`)
    }

    if (req.boardContext) {
      contextBlocks.push(
        `[CURRENT WHITEBOARD BOARD CONTEXT (background reference only — do NOT review or summarize unrelated board cards unless the user explicitly asks about them)]\n${req.boardContext}`
      )
    }

    let projectContext = ''
    if (req.projectId && req.includeProjectContext !== false) {
      projectContext = dbManager.getProjectContextSummary(
        req.projectId,
        req.boardContext ? req.sectionId : undefined
      )
      if (projectContext) {
        contextBlocks.push(
          `[PROJECT WORKSPACE CONTEXT (Previous Sections, Materials & Books — background reference only)]\n${projectContext}`
        )
      }
    }

    if (/\b(diagram|flow|chart|architecture|draw|plot|graph|explain|tutorial|schema|erd|uml)\b/i.test(prompt)) {
      contextBlocks.push(formatDiscoveredAssetsForPrompt(prompt, 12))
    }

    const enrichedPrompt =
      contextBlocks.length > 0
        ? `[USER QUESTION — ANSWER THIS DIRECTLY AND THOROUGHLY]\n${prompt}\n\n${contextBlocks.join('\n\n')}\n\n[USER QUESTION REMINDER]\n${prompt}`
        : prompt

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

export async function callVisionJsonProvider(args: {
  provider: ProviderId
  model: string
  system: string
  user: string
  imageBase64: string
  ollamaHost?: string
  temperature?: number
}): Promise<string> {
  return dispatchProvider(
    args.provider,
    {
      model: args.model,
      system: args.system,
      user: args.user,
      imageBase64: args.imageBase64,
      temperature: args.temperature ?? 0.2,
      jsonMode: true
    },
    args.ollamaHost
  )
}

export async function callAgentJsonStep(args: {
  provider: ProviderId
  model: string
  system: string
  user: string
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
  imageBase64?: string
  ollamaHost?: string
  temperature?: number
}): Promise<string> {
  return dispatchProvider(
    args.provider,
    {
      model: args.model,
      system: args.system,
      user: args.user,
      history: args.history,
      imageBase64: args.imageBase64,
      temperature: args.temperature ?? 0.2,
      jsonMode: true
    },
    args.ollamaHost
  )
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
