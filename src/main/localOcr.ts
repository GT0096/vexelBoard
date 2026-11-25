import { app } from 'electron'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { LocalOcrRequest, LocalOcrResponse } from '../shared/ipc'

const LOCAL_OCR_MODEL = 'Xenova/trocr-small-handwritten'
const HF_TRANSFORMERS_PKG = '@huggingface/transformers'

let ocrPipelinePromise: Promise<any> | null = null

async function getHandwritingPipeline(): Promise<any> {
  if (!ocrPipelinePromise) {
    ocrPipelinePromise = (async () => {
      const hfMod: any = await import(HF_TRANSFORMERS_PKG)
      const { pipeline, env } = hfMod
      const cacheDir = join(app.getPath('userData'), 'hf-models')
      if (!existsSync(cacheDir)) {
        mkdirSync(cacheDir, { recursive: true })
      }
      env.cacheDir = cacheDir
      env.allowLocalModels = true
      env.allowRemoteModels = true

      console.log(`[LocalOCR] Initializing CPU handwriting model (${LOCAL_OCR_MODEL}) in ${cacheDir}...`)
      const pipe = await pipeline('image-to-text', LOCAL_OCR_MODEL, {
        device: 'cpu',
        dtype: 'q8'
      })
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
  cleaned = cleaned.replace(/^#\s*/, '').replace(/\s*#$/, '').trim()
  return cleaned
}

/**
 * Runs 100% local CPU handwriting OCR via Hugging Face Transformers (`Xenova/trocr-small-handwritten`, ~65MB quantized ONNX).
 * Never calls any cloud or Ollama LLM API.
 */
export async function recognizeHandwritingLocal(req: LocalOcrRequest): Promise<LocalOcrResponse> {
  const startedAt = Date.now()
  try {
    const images = Array.isArray(req?.imagesBase64) ? req.imagesBase64.filter(Boolean) : []
    if (images.length === 0) {
      return {
        ok: false,
        text: '',
        lines: [],
        model: LOCAL_OCR_MODEL,
        durationMs: 0,
        error: 'No handwriting image lines provided.'
      }
    }

    const hfMod: any = await import(HF_TRANSFORMERS_PKG)
    const { RawImage } = hfMod
    const ocrPipe = await getHandwritingPipeline()
    const lines: string[] = []

    for (const rawB64 of images) {
      const cleanB64 = rawB64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '')
      if (!cleanB64) continue
      const buf = Buffer.from(cleanB64, 'base64')
      const blob = new Blob([buf], { type: 'image/png' })
      const img = await RawImage.fromBlob(blob)
      const output = await ocrPipe(img, {
        max_new_tokens: 96
      })
      const first = Array.isArray(output) ? output[0] : output
      const lineText = cleanRecognizedLine(String(first?.generated_text ?? ''))
      if (lineText) {
        lines.push(lineText)
      }
    }

    const text = lines.join('\n').trim()
    return {
      ok: text.length > 0,
      text,
      lines,
      model: LOCAL_OCR_MODEL,
      durationMs: Date.now() - startedAt,
      ...(text.length === 0 ? { error: 'Could not recognize clear handwriting in stroke.' } : {})
    }
  } catch (err: any) {
    console.error('[LocalOCR] Handwriting recognition failed:', err)
    return {
      ok: false,
      text: '',
      lines: [],
      model: LOCAL_OCR_MODEL,
      durationMs: Date.now() - startedAt,
      error: err?.message || 'Local CPU OCR failed'
    }
  }
}
