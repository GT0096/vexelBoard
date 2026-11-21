import {
  SmartClassificationSchema,
  VectorCritiqueResultSchema,
  normalizeSpatialSceneInput,
  type IllustrationBrief,
  type IllustrationStyle,
  type SmartBeautifyRequest,
  type SmartBeautifyResponse,
  type SmartClassification,
  type VectorCritiqueRequest,
  type VectorCritiqueResponse
} from '../shared/beautifySchema'
import { DEFAULT_PROVIDER_MODELS } from '../shared/ipc'
import { callVisionJsonProvider, hasApiKey, loadApiKey } from './llmRouter'
import { tracePngToVectorLayers } from './vectorTracer'

const SMART_CLASSIFIER_SYSTEM_PROMPT = `You are a Content-Aware Whiteboard Vision Compiler.
The image may include subtle numbered coordinate grid ticks (200, 400, 600, 800) along a 0..1000 normalized X/Y canvas to help you read EXACT positions.
Analyze the user's hand-drawn selection and output EXACTLY ONE structured JSON object.
NEVER output raw SVG markup, HTML, or markdown fences — output STRICT JSON ONLY.

ROUTING GUARDRAILS (CHOOSE THE BEST FIT):
1. "spatial_scene": CHOOSE THIS whenever the diagram's exact 2D geometric arrangement, contiguous cell partitions, open-sided containers, shared walls, bent pointer arrows, Venn circles, timelines, coordinate plots, matrices, tables, memory frames, math geometry, or circuits matter.
   - Instead of abstract graph boxes separated by whitespace, describe the exact scene using composable primitives in 0..1000 coordinates:
     * "cell_strip": Any vertical or horizontal sequence of adjacent compartments sharing dividers (stacks, queues, arrays, buffers, tables, registers, multi-field blocks). Set "openEnds": ["start"] if top/left is open with extending side walls, ["end"] if bottom/right is open, or ["start","end"] if both ends are open rails! Put the cells in visual top-to-bottom (or left-to-right) order.
     * "shape": Geometric boxes/circles/diamonds/cylinders/parallelograms/triangles (optionally with "openSides": ["top"] etc. for open trays/containers).
     * "connector": Straight arrows, bent orthogonal L/U arrows (3+ points), or curved arrows with normalized waypoints [[x1,y1], [x2,y2], ...], arrowStart, arrowEnd, style, optional "fromId"/"toId", and optional label.
     * "text": Standalone frameless annotations/titles/labels outside boxes (e.g. "Entry", "Exit", "top", "front", "rear", "O(1)"). Use "align": "center" with center (x,y), or "align": "left" with left edge (x,y).
2. "diagram": Use ONLY for node-and-edge flowcharts, system architectures, trees, ERDs, or state machines made of distinct separated nodes connected by arrows where automated layered routing (ELK) improves clarity.
   - IMPORTANT: If stick figures or small icons are connected by flowchart arrows or boxes, classify as "diagram" (or "hybrid" if there is a major focal illustration with callout annotations).
3. "illustration": Use when the drawing itself (human figure, portrait, animal, landscape, scenery, or organic sketch) is the primary artistic subject.
4. "hybrid": Use when there is a primary artistic illustration PLUS handwritten text callouts or pointer arrows annotating parts of it.
5. "text": Use ONLY when the selection is pure handwritten words, sentences, or headings with NO diagram and NO illustration.

EXACT JSON SCHEMAS (return ONLY ONE):

S) Spatial Scene (Preferred for spatial, cellular, open-container, or pointer-annotated diagrams):
{
  "category": "spatial_scene",
  "scene": {
    "title": "",
    "elements": [
      {
        "type": "cell_strip",
        "id": "strip1",
        "orientation": "vertical",
        "x": 360,
        "y": 240,
        "w": 240,
        "h": 540,
        "cells": ["topItem", "midItem", "bottomItem"],
        "openEnds": ["start"]
      },
      {
        "type": "connector",
        "id": "c1",
        "points": [[260, 320], [260, 740]],
        "arrowEnd": true,
        "style": "solid"
      },
      {
        "type": "connector",
        "id": "c2",
        "points": [[480, 260], [480, 120], [640, 120]],
        "arrowEnd": true,
        "style": "solid"
      },
      {
        "type": "text",
        "id": "t1",
        "x": 200,
        "y": 480,
        "text": "Label",
        "fontSize": 22,
        "bold": true,
        "align": "center"
      }
    ]
  }
}
- cell_strip.orientation: "vertical" | "horizontal"
- shape.kind: "rect" | "rounded_rect" | "ellipse" | "diamond" | "triangle" | "cylinder" | "parallelogram"
- Double-check every handwritten letter/word carefully from the image before transcribing (e.g. distinguish C vs D, A vs B, 0 vs O).

A) Node-Link Graph Diagram (ELK Auto-Layout):
{
  "category": "diagram",
  "graph": {
    "direction": "RIGHT",
    "title": "",
    "nodes": [
      { "id": "n1", "kind": "rounded_rect", "label": "Client" },
      { "id": "g1", "kind": "group", "label": "Backend" },
      { "id": "n2", "kind": "diamond", "label": "Valid?", "parentId": "g1" }
    ],
    "edges": [
      { "id": "e1", "source": "n1", "target": "n2", "label": "HTTP", "style": "solid", "directed": true }
    ]
  }
}

B) Illustration:
{
  "category": "illustration",
  "brief": {
    "subject": "Concise visual description of subject, pose, and details",
    "composition": "Framing and proportions",
    "style": "flat_vector",
    "paletteHex": ["#1E293B", "#3B82F6"],
    "isMonochromeLineSketch": false
  }
}

C) Hybrid (Illustration + Native Callouts):
{
  "category": "hybrid",
  "brief": {
    "subject": "Description of the artwork ONLY",
    "composition": "Exact layout of the artwork",
    "style": "flat_vector",
    "paletteHex": ["#1E293B", "#10B981"],
    "isMonochromeLineSketch": false
  },
  "callouts": [
    {
      "text": "Exact label text",
      "normX": 0.82,
      "normY": 0.25,
      "pointsToNormX": 0.56,
      "pointsToNormY": 0.34,
      "bold": true
    }
  ]
}

D) Pure Handwritten Text:
{
  "category": "text",
  "recognizedText": "Exact transcribed text preserving line breaks"
}

Return STRICT JSON ONLY.`

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim()
  const tryParse = (s: string): Record<string, unknown> | null => {
    try {
      const p = JSON.parse(s)
      return p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : null
    } catch {
      return null
    }
  }
  const direct = tryParse(cleaned)
  if (direct) return direct
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start >= 0 && end > start) {
    const slice = cleaned.slice(start, end + 1)
    return tryParse(slice) ?? tryParse(slice.replace(/,\s*([}\]])/g, '$1'))
  }
  return null
}

/* ------------------------------------------------------------------ */
/* Pluggable ImageRefinementProvider Architecture                      */
/* ------------------------------------------------------------------ */

export interface ImageRefinementInput {
  base64Png: string
  brief: IllustrationBrief
  styleOverride?: IllustrationStyle
  hasCallouts?: boolean
}

export interface ImageRefinementResult {
  refinedPngBase64: string
  providerKind: 'cloud' | 'local_comfyui' | 'trace_only'
}

export interface ImageRefinementProvider {
  readonly kind: 'cloud' | 'local_comfyui' | 'trace_only'
  isAvailable(): boolean
  refine(input: ImageRefinementInput): Promise<ImageRefinementResult | null>
}

function buildFlatVectorRefinementPrompt(input: ImageRefinementInput): string {
  const style = input.styleOverride ?? input.brief.style
  const palette =
    input.brief.paletteHex.length > 0
      ? `Strictly use this color palette: ${input.brief.paletteHex.join(', ')}.`
      : 'Preserve the original sketch ink/paint color palette.'

  const styleDirective =
    style === 'clean_line_art'
      ? 'Clean minimalist black ink vector line art with crisp uniform stroke weights, closed clean contours, zero shading, zero hatching.'
      : style === 'editorial_poster'
        ? 'Bold mid-century editorial poster flat vector illustration with crisp geometric color blocks, clean sharp silhouettes, high contrast.'
        : 'Modern clean flat vector illustration with solid flat color blocks, smooth crisp bezier-like edges, minimal clean shapes.'

  return [
    `Redraw this exact user sketch into a clean vector-ready illustration: ${input.brief.subject}.`,
    `Composition: ${input.brief.composition}.`,
    `Style: ${styleDirective}`,
    palette,
    'STRICT REQUIREMENTS:',
    '- Strictly preserve the exact subject pose, proportions, orientation, and spatial layout of the input sketch.',
    '- Pure solid #FFFFFF white background.',
    '- Solid flat color blocks and crisp clean edges ONLY.',
    '- ZERO gradients, ZERO soft shadows, ZERO blur, ZERO noise/grain, ZERO photorealistic texture.',
    input.hasCallouts
      ? '- OMIT all handwritten text labels and pointer arrows from the redrawn artwork (text and arrows will be overlaid as crisp native canvas vectors).'
      : '- Do NOT add any extra text, watermarks, frames, or borders.'
  ].join('\n')
}

/**
 * 1. Cloud Image-Edit Adapter (OpenAI Image Edit or Gemini Image Generation/Edit)
 */
class CloudImageEditProvider implements ImageRefinementProvider {
  readonly kind = 'cloud' as const
  private preferredProvider?: string

  constructor(preferredProvider?: string) {
    this.preferredProvider = preferredProvider
  }

  isAvailable(): boolean {
    return hasApiKey('openai') || hasApiKey('gemini')
  }

  async refine(input: ImageRefinementInput): Promise<ImageRefinementResult | null> {
    const prompt = buildFlatVectorRefinementPrompt(input)
    const order: Array<'gemini' | 'openai'> =
      this.preferredProvider === 'openai' ? ['openai', 'gemini'] : ['gemini', 'openai']

    for (const p of order) {
      if (!hasApiKey(p)) continue
      try {
        if (p === 'gemini') {
          const out = await this.callGeminiImageEdit(loadApiKey('gemini'), input.base64Png, prompt)
          if (out) return { refinedPngBase64: out, providerKind: 'cloud' }
        } else if (p === 'openai') {
          const out = await this.callOpenAiImageEdit(loadApiKey('openai'), input.base64Png, prompt)
          if (out) return { refinedPngBase64: out, providerKind: 'cloud' }
        }
      } catch (err) {
        console.warn(`[SmartBeautify] Cloud refinement (${p}) skipped:`, err)
      }
    }
    return null
  }

  private async callGeminiImageEdit(
    apiKey: string,
    base64Png: string,
    prompt: string
  ): Promise<string | null> {
    const models = ['gemini-2.5-flash-image', 'gemini-2.0-flash-preview-image-generation']
    for (const model of models) {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey
          },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [
                  { text: prompt },
                  { inlineData: { mimeType: 'image/png', data: base64Png } }
                ]
              }
            ],
            generationConfig: {
              responseModalities: ['IMAGE', 'TEXT'],
              temperature: 0.2
            }
          }),
          signal: AbortSignal.timeout(45_000)
        }
      )
      if (!res.ok) continue
      const data = (await res.json()) as {
        candidates?: Array<{
          content?: {
            parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }>
          }
        }>
      }
      const parts = data.candidates?.[0]?.content?.parts ?? []
      const imgPart = parts.find((part) => part.inlineData?.data)
      if (imgPart?.inlineData?.data) {
        return imgPart.inlineData.data
      }
    }
    return null
  }

  private async callOpenAiImageEdit(
    apiKey: string,
    base64Png: string,
    prompt: string
  ): Promise<string | null> {
    const pngBytes = Buffer.from(base64Png, 'base64')
    const form = new FormData()
    form.append('model', 'gpt-image-1')
    form.append('prompt', prompt)
    form.append('size', '1024x1024')
    form.append('image', new Blob([pngBytes], { type: 'image/png' }), 'sketch.png')

    const res = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(55_000)
    })
    if (!res.ok) return null
    const data = (await res.json()) as { data?: Array<{ b64_json?: string; url?: string }> }
    const b64 = data.data?.[0]?.b64_json
    if (b64) return b64
    const url = data.data?.[0]?.url
    if (url) {
      const imgRes = await fetch(url, { signal: AbortSignal.timeout(20_000) })
      if (imgRes.ok) {
        const arr = Buffer.from(await imgRes.arrayBuffer())
        return arr.toString('base64')
      }
    }
    return null
  }
}

/**
 * 2. Local ComfyUI ControlNet Scribble/Lineart Adapter (optional offline art refinement)
 */
class LocalComfyUiProvider implements ImageRefinementProvider {
  readonly kind = 'local_comfyui' as const
  private endpoint: string

  constructor(endpoint?: string) {
    this.endpoint = (endpoint || process.env.COMFYUI_URL || '').trim().replace(/\/+$/, '')
  }

  isAvailable(): boolean {
    return this.endpoint.length > 0
  }

  async refine(input: ImageRefinementInput): Promise<ImageRefinementResult | null> {
    if (!this.endpoint) return null
    try {
      // Quick health probe before attempting upload
      const statsRes = await fetch(`${this.endpoint}/system_stats`, {
        signal: AbortSignal.timeout(1500)
      })
      if (!statsRes.ok) return null

      // Upload sketch to ComfyUI input folder
      const form = new FormData()
      const pngBytes = Buffer.from(input.base64Png, 'base64')
      const fname = `vexel_sketch_${Date.now()}.png`
      form.append('image', new Blob([pngBytes], { type: 'image/png' }), fname)
      form.append('overwrite', 'true')
      const uploadRes = await fetch(`${this.endpoint}/upload/image`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(8000)
      })
      if (!uploadRes.ok) return null

      // Custom workflow hook: if user configured COMFYUI_WORKFLOW_URL or standard endpoint
      const customEndpoint = process.env.COMFYUI_SCRIBBLE_API?.trim()
      if (customEndpoint) {
        const genRes = await fetch(customEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageName: fname,
            prompt: buildFlatVectorRefinementPrompt(input),
            style: input.styleOverride ?? input.brief.style
          }),
          signal: AbortSignal.timeout(45_000)
        })
        if (genRes.ok) {
          const out = (await genRes.json()) as { base64Png?: string }
          if (out.base64Png) {
            return { refinedPngBase64: out.base64Png, providerKind: 'local_comfyui' }
          }
        }
      }
      return null
    } catch {
      return null
    }
  }
}

/**
 * 3. Offline Trace-Only Fallback Provider (100% offline, skips AI image generation)
 */
class TraceOnlyProvider implements ImageRefinementProvider {
  readonly kind = 'trace_only' as const
  isAvailable(): boolean {
    return true
  }
  async refine(input: ImageRefinementInput): Promise<ImageRefinementResult> {
    return {
      refinedPngBase64: input.base64Png,
      providerKind: 'trace_only'
    }
  }
}

/* ------------------------------------------------------------------ */
/* Main IPC Handler: `canvas:smart-beautify`                           */
/* ------------------------------------------------------------------ */

export async function runSmartBeautify(req: SmartBeautifyRequest): Promise<SmartBeautifyResponse> {
  try {
    if (!req.base64Png) {
      return { ok: false, error: 'No cropped selection PNG provided.' }
    }

    const mode = req.mode ?? 'auto'

    // Fast 100% Offline Trace-Only Mode (skips all Vision/Image AI calls!)
    if (mode === 'trace_only') {
      const traced = await tracePngToVectorLayers(req.base64Png, {
        clustering: req.isMonochromeHint ? 'bw' : 'color-cluster',
        hierarchical: 'stacked',
        mode: 'spline',
        filterSpeckle: 6,
        colorPrecision: 6,
        layerDifference: 16,
        cornerThreshold: 60
      })
      return {
        ok: true,
        category: 'illustration',
        vectorArt: {
          viewBoxWidth: traced.viewBoxWidth,
          viewBoxHeight: traced.viewBoxHeight,
          layers: traced.layers,
          refinementUsed: 'trace_only'
        }
      }
    }

    // Explicit Style Re-Run Mode (Flat Vector / Line Art / Editorial Poster directly on artwork)
    if (mode === 'flat_vector' || mode === 'clean_line_art' || mode === 'editorial_poster') {
      const brief: IllustrationBrief = {
        subject: req.textHints || 'hand-drawn whiteboard illustration',
        composition: 'faithful to the input sketch',
        style: mode,
        paletteHex: (req.paletteHints ?? []).slice(0, 12),
        isMonochromeLineSketch: mode === 'clean_line_art'
      }
      return runIllustrationPipeline(req, brief, mode, [])
    }

    // Step 1: Content-Aware Classification via Vision LLM (Strict Zod Validation)
    const provider = req.provider ?? 'ollama'
    const model = (req.model || DEFAULT_PROVIDER_MODELS[provider]).trim()
    const userPrompt = [
      `Cropped selection size: ${Math.round(req.width)}×${Math.round(req.height)}px.`,
      req.paletteHints && req.paletteHints.length > 0
        ? `User stroke colors detected: ${req.paletteHints.join(', ')}.`
        : '',
      req.textHints ? `Existing text hints: ${req.textHints}` : '',
      'Classify this whiteboard selection into "spatial_scene", "diagram", "illustration", "hybrid", or "text" and return STRICT JSON ONLY.'
    ]
      .filter(Boolean)
      .join('\n')

    const rawReply = await callVisionJsonProvider({
      provider,
      model,
      system: SMART_CLASSIFIER_SYSTEM_PROMPT,
      user: userPrompt,
      imageBase64: req.ruledBase64Png || req.base64Png,
      ollamaHost: req.ollamaHost,
      temperature: req.temperature !== undefined ? Math.min(req.temperature, 0.2) : 0.15
    })

    const rawObj = extractJsonObject(rawReply)
    if (!rawObj) {
      // Safe fallback: trace original offline so user always gets clean vectors
      const traced = await tracePngToVectorLayers(req.base64Png, {
        clustering: req.isMonochromeHint ? 'bw' : 'color-cluster'
      })
      return {
        ok: true,
        category: 'illustration',
        vectorArt: {
          viewBoxWidth: traced.viewBoxWidth,
          viewBoxHeight: traced.viewBoxHeight,
          layers: traced.layers,
          refinementUsed: 'trace_only'
        }
      }
    }

    if (rawObj.scene && typeof rawObj.scene === 'object') {
      rawObj.scene = normalizeSpatialSceneInput(rawObj.scene)
    }
    const parsed = SmartClassificationSchema.safeParse(rawObj)
    if (!parsed.success) {
      console.warn('[SmartBeautify] Zod validation issue:', parsed.error.issues)
      // Attempt gentle repair for common LLM minor schema slips
      const repaired = repairClassificationFallback(rawObj)
      if (!repaired) {
        const traced = await tracePngToVectorLayers(req.base64Png, {
          clustering: req.isMonochromeHint ? 'bw' : 'color-cluster'
        })
        return {
          ok: true,
          category: 'illustration',
          vectorArt: {
            viewBoxWidth: traced.viewBoxWidth,
            viewBoxHeight: traced.viewBoxHeight,
            layers: traced.layers,
            refinementUsed: 'trace_only'
          }
        }
      }
      return dispatchClassification(req, repaired)
    }

    return dispatchClassification(req, parsed.data)
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

function repairClassificationFallback(obj: Record<string, unknown>): SmartClassification | null {
  if (obj.scene && typeof obj.scene === 'object') {
    const sc = SmartClassificationSchema.safeParse({ category: 'spatial_scene', scene: obj.scene })
    if (sc.success) return sc.data
  }
  if (typeof obj.recognizedText === 'string' && obj.recognizedText.trim()) {
    return { category: 'text', recognizedText: obj.recognizedText.trim() }
  }
  if (obj.graph && typeof obj.graph === 'object') {
    const g = SmartClassificationSchema.safeParse({ category: 'diagram', graph: obj.graph })
    if (g.success) return g.data
  }
  if (obj.brief && typeof obj.brief === 'object') {
    const h = SmartClassificationSchema.safeParse({
      category: Array.isArray(obj.callouts) && obj.callouts.length > 0 ? 'hybrid' : 'illustration',
      brief: obj.brief,
      ...(Array.isArray(obj.callouts) ? { callouts: obj.callouts } : {})
    })
    if (h.success) return h.data
  }
  return null
}

async function dispatchClassification(
  req: SmartBeautifyRequest,
  classification: SmartClassification
): Promise<SmartBeautifyResponse> {
  if (classification.category === 'spatial_scene') {
    return {
      ok: true,
      category: 'spatial_scene',
      spatialScene: classification.scene
    }
  }

  if (classification.category === 'text') {
    return {
      ok: true,
      category: 'text',
      recognizedText: classification.recognizedText
    }
  }

  if (classification.category === 'diagram') {
    return {
      ok: true,
      category: 'diagram',
      graph: classification.graph
    }
  }

  const callouts = classification.category === 'hybrid' ? classification.callouts : []
  return runIllustrationPipeline(req, classification.brief, undefined, callouts)
}

const CRITIQUE_SYSTEM_PROMPT = `You are a strict Visual QA Critic for a hand-drawn sketch-to-vector diagram compiler.
The image shows LEFT = ORIGINAL SKETCH and RIGHT = COMPILED VECTOR RESULT.
Inspect BOTH sides carefully and compare with the provided structured JSON:
1. Are ALL handwritten labels transcribed accurately (zero misread characters or missing words)?
2. Are all containers, cell compartments, open-top/open-side walls, and dividers preserved in the right order?
3. Are all arrows pointed in the right direction without crossing or clipping into text/containers?
4. Do any labels overlap each other or container walls?

If the RIGHT side faithfully matches the LEFT sketch with clean legibility, return:
{ "approved": true, "issues": [] }

If ANY issue exists, return the corrected full JSON in the EXACT same schema key ("repairedScene" for spatial_scene, or "repairedGraph" for diagram):
{
  "approved": false,
  "issues": ["concise issue description"],
  "repairedScene": { ... }
}
Return STRICT JSON ONLY.`

/**
 * Runs 1 bounded Visual Critique & Self-Repair pass comparing Original Sketch vs Compiled Vector.
 */
export async function runSmartBeautifyCritique(
  req: VectorCritiqueRequest
): Promise<VectorCritiqueResponse> {
  try {
    if (!req.comparisonBase64Png) {
      return { ok: true, approved: true, issues: [] }
    }
    const provider = req.provider ?? 'ollama'
    const model = (req.model || DEFAULT_PROVIDER_MODELS[provider]).trim()
    const currentPayload =
      req.category === 'spatial_scene'
        ? { category: 'spatial_scene', scene: req.scene }
        : { category: 'diagram', graph: req.graph }

    const userPrompt = [
      `Compare LEFT (Original Sketch) with RIGHT (Compiled Vector) for category "${req.category}".`,
      req.textHints ? `Known text hints: ${req.textHints}` : '',
      `Current compiled JSON:\n${JSON.stringify(currentPayload)}`,
      'Return { "approved": true, "issues": [] } if faithful and clean, OR return "repairedScene" / "repairedGraph" fixing any defects.'
    ]
      .filter(Boolean)
      .join('\n\n')

    const raw = await callVisionJsonProvider({
      provider,
      model,
      system: CRITIQUE_SYSTEM_PROMPT,
      user: userPrompt,
      imageBase64: req.comparisonBase64Png,
      ollamaHost: req.ollamaHost,
      temperature: 0.1
    })

    const rawObj = extractJsonObject(raw)
    if (!rawObj) {
      return { ok: true, approved: true, issues: [] }
    }
    if (rawObj.repairedScene && typeof rawObj.repairedScene === 'object') {
      rawObj.repairedScene = normalizeSpatialSceneInput(rawObj.repairedScene)
    }
    const parsed = VectorCritiqueResultSchema.safeParse(rawObj)
    if (!parsed.success) {
      return { ok: true, approved: true, issues: [] }
    }
    return {
      ok: true,
      approved: parsed.data.approved,
      issues: parsed.data.issues,
      repairedScene: parsed.data.repairedScene,
      repairedGraph: parsed.data.repairedGraph
    }
  } catch (err) {
    return {
      ok: false,
      approved: true,
      issues: [],
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

async function runIllustrationPipeline(
  req: SmartBeautifyRequest,
  brief: IllustrationBrief,
  styleOverride: IllustrationStyle | undefined,
  callouts: SmartBeautifyResponse['callouts']
): Promise<SmartBeautifyResponse> {
  const providers: ImageRefinementProvider[] = [
    new CloudImageEditProvider(req.provider),
    new LocalComfyUiProvider(req.comfyUiUrl),
    new TraceOnlyProvider()
  ]

  let refinedPng = req.base64Png
  let refinementUsed: 'cloud' | 'local_comfyui' | 'trace_only' = 'trace_only'

  for (const adapter of providers) {
    if (!adapter.isAvailable()) continue
    const out = await adapter.refine({
      base64Png: req.base64Png,
      brief,
      styleOverride,
      hasCallouts: Boolean(callouts && callouts.length > 0)
    })
    if (out) {
      refinedPng = out.refinedPngBase64
      refinementUsed = out.providerKind
      break
    }
  }

  const effectiveStyle = styleOverride ?? brief.style
  const isMono = effectiveStyle === 'clean_line_art' || (brief.isMonochromeLineSketch && refinementUsed === 'trace_only')

  const traced = await tracePngToVectorLayers(refinedPng, {
    clustering: isMono ? 'bw' : 'color-cluster',
    hierarchical: 'stacked',
    mode: 'spline',
    filterSpeckle: 6,
    colorPrecision: 6,
    layerDifference: 16,
    cornerThreshold: 60
  })

  return {
    ok: true,
    category: callouts && callouts.length > 0 ? 'hybrid' : 'illustration',
    brief,
    callouts: callouts && callouts.length > 0 ? callouts : undefined,
    vectorArt: {
      viewBoxWidth: traced.viewBoxWidth,
      viewBoxHeight: traced.viewBoxHeight,
      layers: traced.layers,
      refinementUsed
    }
  }
}
