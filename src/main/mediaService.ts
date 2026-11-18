import { YoutubeTranscript } from 'youtube-transcript'
import { readFileSync, statSync } from 'fs'
import { basename, extname } from 'path'

export interface TranscriptItem {
  text: string
  start: number
  duration: number
}

export interface YouTubeInfoResult {
  ok: boolean
  videoId: string
  title: string
  author: string
  thumbnailUrl: string
  transcript: TranscriptItem[]
  fullText: string
  chunks: Array<{ text: string; start: number; end: number }>
  hasCaptions?: boolean
  error?: string
}

export interface DocumentParseResult {
  ok: boolean
  fileName: string
  fileType: string
  pageCount?: number
  text: string
  chunks: Array<{ text: string; page?: number; chunkIndex: number }>
  error?: string
}

export function extractYouTubeVideoId(urlOrId: string): string | null {
  if (!urlOrId) return null
  const trimmed = urlOrId.trim()
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed
  }

  const match = trimmed.match(
    /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/|live\/))([a-zA-Z0-9_-]{11})/
  )
  return match ? match[1] : null
}

const HTML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&amp;#39;': "'"
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;#39;|&(?:amp|lt|gt|quot|#39);/g, (entity) => HTML_ENTITIES[entity] ?? entity)
    .replace(/\s+/g, ' ')
    .trim()
}

function stripHtmlTags(input: string): string {
  let prev = ''
  let curr = input
  while (curr !== prev) {
    prev = curr
    curr = curr.replace(/<[^>]*>/g, '')
  }
  return curr.replace(/[<>]/g, '')
}

async function fetchCaptionFallback(videoId: string): Promise<TranscriptItem[]> {
  try {
    const watchRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    })
    if (!watchRes.ok) return []
    const html = await watchRes.text()
    const match = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});/s)
    if (!match) return []
    const playerData = JSON.parse(match[1])
    const tracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks
    if (!Array.isArray(tracks) || tracks.length === 0) return []

    const preferred =
      tracks.find((t: any) => t.languageCode?.startsWith('en')) || tracks[0]
    if (!preferred?.baseUrl) return []

    const capRes = await fetch(preferred.baseUrl)
    if (!capRes.ok) return []
    const xml = await capRes.text()
    const items: TranscriptItem[] = []
    const regex = /<text start="([^"]+)" dur="([^"]*)"[^>]*>([\s\S]*?)<\/text>/g
    let m: RegExpExecArray | null
    while ((m = regex.exec(xml)) !== null) {
      const start = parseFloat(m[1]) || 0
      const duration = parseFloat(m[2]) || 2
      const text = decodeHtmlEntities(stripHtmlTags(m[3]))
      if (text) items.push({ text, start, duration })
    }
    return items
  } catch {
    return []
  }
}

export async function fetchYouTubeInfo(url: string): Promise<YouTubeInfoResult> {
  const videoId = extractYouTubeVideoId(url)
  if (!videoId) {
    return {
      ok: false,
      videoId: '',
      title: '',
      author: '',
      thumbnailUrl: '',
      transcript: [],
      fullText: '',
      chunks: [],
      error: 'Invalid YouTube URL or Video ID.'
    }
  }

  let title = `YouTube Video (${videoId})`
  let author = 'Unknown Creator'
  const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`

  // 1. Fetch metadata from oEmbed
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
    const res = await fetch(oembedUrl)
    if (res.ok) {
      const data = (await res.json()) as { title?: string; author_name?: string }
      if (data.title) title = data.title
      if (data.author_name) author = data.author_name
    }
  } catch {
    /* ignore metadata failure */
  }

  // 2. Fetch transcript with fallback
  let transcriptItems: TranscriptItem[] = []
  try {
    const raw = await YoutubeTranscript.fetchTranscript(videoId)
    transcriptItems = raw.map((item) => ({
      text: decodeHtmlEntities(item.text),
      start: item.offset / 1000,
      duration: item.duration / 1000
    }))
  } catch (err: any) {
    console.warn(`[YouTube] Primary transcript fetch note: ${err?.message || err}`)
  }

  if (transcriptItems.length === 0) {
    transcriptItems = await fetchCaptionFallback(videoId)
  }

  const hasCaptions = transcriptItems.length > 0
  const fullText = hasCaptions
    ? transcriptItems.map((t) => t.text).join(' ')
    : `YouTube Video: "${title}" by ${author} (https://www.youtube.com/watch?v=${videoId}). Note: Captions were not available for this video.`

  // 3. Group into ~800 char chunks with timestamp ranges for Knowledge Studio / RAG
  const chunks: Array<{ text: string; start: number; end: number }> = []
  let currentWords: string[] = []
  let chunkStart = 0
  let chunkEnd = 0

  for (const item of transcriptItems) {
    if (currentWords.length === 0) {
      chunkStart = Math.floor(item.start)
    }
    currentWords.push(item.text)
    chunkEnd = Math.floor(item.start + item.duration)

    if (currentWords.join(' ').length > 800) {
      chunks.push({
        text: currentWords.join(' '),
        start: chunkStart,
        end: chunkEnd
      })
      currentWords = []
    }
  }
  if (currentWords.length > 0) {
    chunks.push({
      text: currentWords.join(' '),
      start: chunkStart,
      end: chunkEnd
    })
  }
  if (chunks.length === 0) {
    chunks.push({ text: fullText, start: 0, end: 0 })
  }

  return {
    ok: true,
    videoId,
    title,
    author,
    thumbnailUrl,
    transcript: transcriptItems,
    fullText,
    chunks,
    hasCaptions
  }
}

function chunkTextBlocks(text: string, maxLen = 1100): Array<{ text: string; chunkIndex: number }> {
  const chunks: Array<{ text: string; chunkIndex: number }> = []
  const blocks = text.split(/\n\s*\n|\n/)
  let currentBlock = ''
  let blockIdx = 0

  for (const block of blocks) {
    if ((currentBlock + '\n' + block).length > maxLen) {
      if (currentBlock.trim().length > 0) {
        chunks.push({ text: currentBlock.trim(), chunkIndex: blockIdx++ })
      }
      currentBlock = block
    } else {
      currentBlock += (currentBlock ? '\n' : '') + block
    }
  }
  if (currentBlock.trim().length > 0) {
    chunks.push({ text: currentBlock.trim(), chunkIndex: blockIdx++ })
  }
  if (chunks.length === 0 && text.trim()) {
    chunks.push({ text: text.trim().slice(0, maxLen), chunkIndex: 0 })
  }
  return chunks
}

async function parsePdfBuffer(buffer: Buffer): Promise<{ text: string; pageCount: number }> {
  let text = ''
  let pageCount = 1

  try {
    // Lazy-load pdf-parse so Electron startup never fails if pdfjs worker tries to resolve DOM globals early
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PDFParse } = require('pdf-parse')
    const parser = new PDFParse({ data: buffer })
    const textResult = await parser.getText()
    text = textResult?.text || ''
    try {
      const info = await parser.getInfo()
      pageCount = (info as any)?.total || 1
    } catch {
      /* ignore info lookup errors */
    }
    await parser.destroy?.()
  } catch (err) {
    console.warn('[Media] PDFParse fallback triggered:', err)
  }

  if (!text.trim()) {
    // Pure-JS text stream extraction fallback for uncompressed PDF text blocks
    const latin = buffer.toString('latin1')
    const extracted: string[] = []
    const tjRegex = /\(([^()]{2,})\)\s*Tj/g
    let m: RegExpExecArray | null
    while ((m = tjRegex.exec(latin)) !== null) {
      const clean = m[1].replace(/[^\x20-\x7E]/g, ' ').trim()
      if (clean) extracted.push(clean)
    }
    text =
      extracted.length > 0
        ? extracted.join(' ')
        : buffer.toString('utf-8').replace(/[^\x20-\x7E\n\r\t]/g, ' ').replace(/\s{3,}/g, '\n')
  }

  return { text, pageCount }
}

async function parseBufferInternal(fileName: string, buffer: Buffer): Promise<DocumentParseResult> {
  const ext = extname(fileName).toLowerCase()
  if (buffer.byteLength > 50 * 1024 * 1024) {
    return {
      ok: false,
      fileName,
      fileType: ext,
      text: '',
      chunks: [],
      error: 'File exceeds 50MB maximum size limit.'
    }
  }

  if (ext === '.pdf') {
    const { text, pageCount } = await parsePdfBuffer(buffer)
    const chunks = chunkTextBlocks(text, 1200)
    return {
      ok: true,
      fileName,
      fileType: 'pdf',
      pageCount,
      text,
      chunks
    }
  }

  const rawText = buffer.toString('utf-8')
  const chunks = chunkTextBlocks(rawText, 1000)
  return {
    ok: true,
    fileName,
    fileType: ext.replace('.', '') || 'txt',
    text: rawText,
    chunks
  }
}

export async function parseDocumentFile(filePath: string): Promise<DocumentParseResult> {
  try {
    const fileName = basename(filePath)
    const stats = statSync(filePath)
    if (stats.size > 50 * 1024 * 1024) {
      return {
        ok: false,
        fileName,
        fileType: extname(filePath),
        text: '',
        chunks: [],
        error: 'File exceeds 50MB maximum size limit.'
      }
    }
    const buffer = readFileSync(filePath)
    return await parseBufferInternal(fileName, buffer)
  } catch (err: any) {
    return {
      ok: false,
      fileName: basename(filePath),
      fileType: extname(filePath),
      text: '',
      chunks: [],
      error: err?.message || 'Failed to parse document.'
    }
  }
}

export async function parseDocumentBuffer(
  fileName: string,
  base64Data: string
): Promise<DocumentParseResult> {
  try {
    const cleanB64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data
    const buffer = Buffer.from(cleanB64, 'base64')
    return await parseBufferInternal(fileName, buffer)
  } catch (err: any) {
    return {
      ok: false,
      fileName,
      fileType: extname(fileName),
      text: '',
      chunks: [],
      error: err?.message || 'Failed to parse uploaded file.'
    }
  }
}
