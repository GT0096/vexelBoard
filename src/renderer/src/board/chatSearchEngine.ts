import MiniSearch from 'minisearch'
import type { ProjectChatThread, SearchResultItem } from '@shared/ipc'

export type ChatSearchScope = 'current' | 'all_chats' | 'everything'

export interface IndexedChatDoc {
  id: string
  threadId: string
  threadTitle: string
  messageId: string
  role: 'user' | 'assistant'
  content: string
  sectionTitle: string
  timestamp: number
  msgIndex: number
}

export interface SnippetPart {
  text: string
  highlight: boolean
}

export interface UnifiedChatSearchHit {
  id: string
  kind: 'message' | 'knowledge'
  threadId?: string
  threadTitle?: string
  messageId?: string
  role?: 'user' | 'assistant'
  sourceTitle?: string
  sourceType?: string
  timestamp?: number
  score: number
  matchedTerms: string[]
  snippetParts: SnippetPart[]
  rawText: string
}

export interface ChatSearchExecutionResult {
  hits: UnifiedChatSearchHit[]
  activeThreadHits: UnifiedChatSearchHit[]
  suggestions: string[]
  highlightTerms: string[]
}

/**
 * Builds an in-memory MiniSearch BM25 + fuzzy Levenshtein + prefix-autocomplete index
 * over all chat threads in the current project.
 */
export function createChatSearchIndex(threads: ProjectChatThread[]): MiniSearch<IndexedChatDoc> {
  const miniSearch = new MiniSearch<IndexedChatDoc>({
    fields: ['content', 'threadTitle', 'sectionTitle', 'role'],
    storeFields: [
      'threadId',
      'threadTitle',
      'messageId',
      'role',
      'content',
      'sectionTitle',
      'timestamp',
      'msgIndex'
    ],
    searchOptions: {
      boost: { threadTitle: 2.0, sectionTitle: 1.5, content: 1.0 },
      fuzzy: 0.22,
      prefix: true
    },
    tokenize: (text) =>
      text
        .toLowerCase()
        .split(/[\s,.;:!?()[\]{}"'`<>\\/|+-]+/)
        .filter((tok) => tok.length > 0)
  })

  const docs: IndexedChatDoc[] = []
  for (const thread of threads) {
    ;(thread.messages || []).forEach((m, idx) => {
      if (!m.content || !m.content.trim()) return
      docs.push({
        id: `${thread.id}::${m.id}`,
        threadId: thread.id,
        threadTitle: thread.title || 'Chat',
        messageId: m.id,
        role: m.role,
        content: m.content,
        sectionTitle: m.sectionTitle || '',
        timestamp: m.timestamp || 0,
        msgIndex: idx
      })
    })
  }

  if (docs.length > 0) {
    miniSearch.addAll(docs)
  }
  return miniSearch
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function collectHighlightTerms(query: string, matchedTerms: string[] = []): string[] {
  const rawTokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/^[^\w]+|[^\w]+$/g, ''))
    .filter((t) => t.length >= 2)
  const set = new Set<string>([...rawTokens, ...matchedTerms.filter((t) => t.length >= 2)])
  return Array.from(set).sort((a, b) => b.length - a.length)
}

/**
 * Extracts a contextual window around the densest cluster of matched terms
 * and splits into safe `{ text, highlight }` segments for `<mark>` rendering.
 */
export function buildHighlightedSnippet(
  rawText: string,
  terms: string[],
  windowRadius = 78
): SnippetPart[] {
  const clean = (rawText || '').replace(/\s+/g, ' ').trim()
  if (!clean) return [{ text: '', highlight: false }]
  if (terms.length === 0) {
    const slice = clean.length > windowRadius * 2 ? `${clean.slice(0, windowRadius * 2)}…` : clean
    return [{ text: slice, highlight: false }]
  }

  const lower = clean.toLowerCase()
  let bestPos = -1
  for (const term of terms) {
    const idx = lower.indexOf(term.toLowerCase())
    if (idx !== -1 && (bestPos === -1 || idx < bestPos)) {
      bestPos = idx
    }
  }
  if (bestPos === -1) bestPos = 0

  const start = Math.max(0, bestPos - Math.floor(windowRadius * 0.65))
  const end = Math.min(clean.length, start + windowRadius * 2)
  let excerpt = clean.slice(start, end)
  if (start > 0) excerpt = `…${excerpt}`
  if (end < clean.length) excerpt = `${excerpt}…`

  const pattern = terms.map(escapeRegExp).filter(Boolean).join('|')
  if (!pattern) return [{ text: excerpt, highlight: false }]

  const regex = new RegExp(`(${pattern})`, 'gi')
  const rawParts = excerpt.split(regex)
  const termLowerSet = new Set(terms.map((t) => t.toLowerCase()))

  return rawParts
    .filter((p) => p.length > 0)
    .map((part) => ({
      text: part,
      highlight:
        termLowerSet.has(part.toLowerCase()) ||
        terms.some((t) => part.toLowerCase().startsWith(t.toLowerCase()))
    }))
}

/**
 * Executes Google-style soft-AND BM25 + fuzzy + prefix search across chat threads
 * and optionally hybrid vector+FTS knowledge sources.
 */
export function searchChatIndex(
  index: MiniSearch<IndexedChatDoc>,
  query: string,
  opts: {
    scope: ChatSearchScope
    activeThreadId: string
    knowledgeHits?: SearchResultItem[]
  }
): ChatSearchExecutionResult {
  const q = query.trim()
  if (!q) {
    return { hits: [], activeThreadHits: [], suggestions: [], highlightTerms: [] }
  }

  // 1. Soft-AND search: try strict AND first (highest precision), fall back to OR if 0 results
  let rawResults = index.search(q, {
    combineWith: 'AND',
    fuzzy: 0.22,
    prefix: true,
    boost: { threadTitle: 2.0, sectionTitle: 1.5, content: 1.0 }
  })
  if (rawResults.length === 0) {
    rawResults = index.search(q, {
      combineWith: 'OR',
      fuzzy: 0.25,
      prefix: true,
      boost: { threadTitle: 2.0, sectionTitle: 1.5, content: 1.0 }
    })
  }

  // 2. Instant autocomplete suggestions
  const suggestions = index
    .autoSuggest(q, { fuzzy: 0.22, prefix: true })
    .slice(0, 5)
    .map((s) => s.suggestion)
    .filter((s) => s.toLowerCase() !== q.toLowerCase())

  const allTermSet = new Set<string>()
  const messageHits: UnifiedChatSearchHit[] = []

  for (const r of rawResults) {
    const threadId = String(r.threadId || '')
    if (opts.scope === 'current' && threadId !== opts.activeThreadId) {
      continue
    }
    const matchedTerms = Array.isArray(r.terms) ? r.terms : []
    matchedTerms.forEach((t) => allTermSet.add(t))
    const terms = collectHighlightTerms(q, matchedTerms)
    const content = String(r.content || '')
    messageHits.push({
      id: r.id,
      kind: 'message',
      threadId,
      threadTitle: String(r.threadTitle || 'Chat'),
      messageId: String(r.messageId || ''),
      role: (r.role as 'user' | 'assistant') || 'assistant',
      timestamp: Number(r.timestamp || 0),
      score: r.score,
      matchedTerms: terms,
      snippetParts: buildHighlightedSnippet(content, terms),
      rawText: content
    })
  }

  const highlightTerms = collectHighlightTerms(q, Array.from(allTermSet))

  const knowledgeUnified: UnifiedChatSearchHit[] =
    opts.scope === 'everything' && opts.knowledgeHits
      ? opts.knowledgeHits.map((kh) => ({
          id: `know::${kh.chunkId}`,
          kind: 'knowledge',
          sourceTitle: kh.sourceTitle,
          sourceType: kh.sourceType,
          score: kh.score * 10,
          matchedTerms: highlightTerms,
          snippetParts: buildHighlightedSnippet(kh.chunkText, highlightTerms),
          rawText: kh.chunkText
        }))
      : []

  const hits = [...messageHits, ...knowledgeUnified]
  const activeThreadHits = messageHits.filter((h) => h.threadId === opts.activeThreadId)

  return {
    hits,
    activeThreadHits,
    suggestions,
    highlightTerms
  }
}
