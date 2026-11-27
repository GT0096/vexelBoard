import { app } from 'electron'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { LocalOcrRequest, LocalOcrResponse } from '../shared/ipc'

const LOCAL_OCR_MODEL = 'Xenova/trocr-base-handwritten'
const HF_TRANSFORMERS_PKG = '@huggingface/transformers'

interface OcrOutputItem {
  generated_text?: string
}

type OcrPipeline = (
  input: unknown,
  options?: { max_new_tokens?: number; num_beams?: number }
) => Promise<OcrOutputItem | OcrOutputItem[]>

interface HfTransformersModule {
  pipeline: (
    task: 'image-to-text',
    model: string,
    options?: { device?: string; dtype?: string }
  ) => Promise<OcrPipeline>
  env: {
    cacheDir: string
    allowLocalModels: boolean
    allowRemoteModels: boolean
  }
  RawImage: {
    fromBlob: (blob: Blob) => Promise<unknown>
  }
}

let ocrPipelinePromise: Promise<OcrPipeline> | null = null

async function getHandwritingPipeline(): Promise<OcrPipeline> {
  if (!ocrPipelinePromise) {
    ocrPipelinePromise = (async () => {
      const hfMod = (await import(HF_TRANSFORMERS_PKG)) as unknown as HfTransformersModule
      const { pipeline, env } = hfMod
      const cacheDir = join(app.getPath('userData'), 'hf-models')
      if (!existsSync(cacheDir)) {
        mkdirSync(cacheDir, { recursive: true })
      }
      env.cacheDir = cacheDir
      env.allowLocalModels = true
      env.allowRemoteModels = true

      console.log(
        `[LocalOCR] Initializing CPU handwriting model (${LOCAL_OCR_MODEL}, ONNX port of microsoft/trocr-base-handwritten) in ${cacheDir}...`
      )
      let pipe: OcrPipeline
      try {
        pipe = await pipeline('image-to-text', LOCAL_OCR_MODEL, {
          device: 'cpu',
          dtype: 'q8'
        })
      } catch (q8Err) {
        console.warn(
          `[LocalOCR] q8 quantized weights failed to initialize for ${LOCAL_OCR_MODEL}; falling back to default dtype:`,
          q8Err
        )
        pipe = await pipeline('image-to-text', LOCAL_OCR_MODEL, {
          device: 'cpu'
        })
      }
      console.log(`[LocalOCR] CPU handwriting model (${LOCAL_OCR_MODEL}) ready.`)
      return pipe
    })().catch((err) => {
      ocrPipelinePromise = null
      throw err
    })
  }
  return ocrPipelinePromise
}

function cleanRecognizedLine(raw: string): string {
  let cleaned = (raw || '').replace(/\s+/g, ' ').trim()
  // TrOCR occasionally prefixes or suffixes '#' or '0 0' on blank borders
  cleaned = cleaned
    .replace(/^#+\s*/, '')
    .replace(/\s*#+$/, '')
    .trim()
  cleaned = cleaned.replace(/\s+([,.;:!?])/g, '$1').trim()
  if (cleaned === '0 0') return ''
  return cleaned
}

/**
 * Runs 100% local CPU handwriting OCR via Hugging Face Transformers
 * (`Xenova/trocr-base-handwritten`, the ONNX-converted port of `microsoft/trocr-base-handwritten`).
 * Never calls any cloud or Ollama LLM API.
 */
export async function recognizeHandwritingLocal(req: LocalOcrRequest): Promise<LocalOcrResponse> {
  const startedAt = Date.now()
  try {
    const rawImages = Array.isArray(req?.imagesBase64) ? req.imagesBase64 : []
    const hasAnyImage = rawImages.some((img) => Boolean(img && img.trim()))
    if (!hasAnyImage) {
      return {
        ok: false,
        text: '',
        lines: [],
        model: LOCAL_OCR_MODEL,
        durationMs: 0,
        error: 'No handwriting image lines provided.'
      }
    }

    const hfMod = (await import(HF_TRANSFORMERS_PKG)) as unknown as HfTransformersModule
    const { RawImage } = hfMod
    const ocrPipe = await getHandwritingPipeline()
    const groupedLines = new Map<number, string[]>()

    for (let idx = 0; idx < rawImages.length; idx++) {
      const rawB64 = rawImages[idx]
      if (!rawB64) continue
      const cleanB64 = rawB64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '')
      if (!cleanB64) continue
      const buf = Buffer.from(cleanB64, 'base64')
      const blob = new Blob([buf], { type: 'image/png' })
      const img = await RawImage.fromBlob(blob)

      let output: OcrOutputItem | OcrOutputItem[]
      try {
        output = await ocrPipe(img, {
          max_new_tokens: 96,
          num_beams: 2
        })
      } catch {
        output = await ocrPipe(img, {
          max_new_tokens: 96
        })
      }

      const first = Array.isArray(output) ? output[0] : output
      const lineText = cleanRecognizedLine(String(first?.generated_text ?? ''))
      if (lineText) {
        const lineIdx =
          Array.isArray(req.lineIndices) && typeof req.lineIndices[idx] === 'number'
            ? req.lineIndices[idx]
            : idx
        const bucket = groupedLines.get(lineIdx)
        if (bucket) {
          bucket.push(lineText)
        } else {
          groupedLines.set(lineIdx, [lineText])
        }
      }
    }

    const sortedKeys = Array.from(groupedLines.keys()).sort((a, b) => a - b)
    const lines = sortedKeys
      .map((k) => groupedLines.get(k)!.join(' ').replace(/\s+/g, ' ').trim())
      .filter(Boolean)

    const text = lines.join('\n').trim()
    return {
      ok: text.length > 0,
      text,
      lines,
      model: LOCAL_OCR_MODEL,
      durationMs: Date.now() - startedAt,
      ...(text.length === 0 ? { error: 'Could not recognize clear handwriting in stroke.' } : {})
    }
  } catch (err: unknown) {
    console.error('[LocalOCR] Handwriting recognition failed:', err)
    const errorMsg = err instanceof Error ? err.message : 'Local CPU OCR failed'
    return {
      ok: false,
      text: '',
      lines: [],
      model: LOCAL_OCR_MODEL,
      durationMs: Date.now() - startedAt,
      error: errorMsg || 'Local CPU OCR failed'
    }
  }
}
