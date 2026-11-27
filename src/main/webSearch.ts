import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { parseHTML } from 'linkedom'
import { Readability } from '@mozilla/readability'
import type {
  WebPageContent,
  WebSearchAttempt,
  WebSearchOptions,
  WebSearchProvider,
  WebSearchResponse,
  WebSearchResult,
  WebSearchSettings
} from '../shared/ipc'

const DEFAULTS: WebSearchSettings = {
  enabled: true,
  providerMode: 'builtin',
  searxngUrl: '',
  allowFallback: true
}

const APP_USER_AGENT = 'Vexelboard/1.0 (+https://github.com/GT0096/vexelBoard)'
const DDG_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000
const SEARCH_CACHE_MAX = 100
const MAX_HTML_BYTES = 3 * 1024 * 1024
const SEARCH_TIMEOUT_MS = 10_000
const PAGE_TIMEOUT_MS = 15_000

const searchCache = new Map<string, { at: number; resp: WebSearchResponse }>()

function createCombinedAbortSignal(timeoutMs: number, callerSignal?: AbortSignal): AbortSignal {
  const signals: AbortSignal[] = [AbortSignal.timeout(timeoutMs)]
  if (callerSignal) signals.unshift(callerSignal)
  return AbortSignal.any(signals)
}

const NAMED_HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' '
}

function decodeHtmlEntities(input: string): string {
  return input.replace(
    /&(?:(amp|lt|gt|quot|apos|nbsp)|#0*(\d+)|#x([0-9a-f]+));/gi,
    (_match, named: string | undefined, dec: string | undefined, hex: string | undefined) => {
      if (named) {
        return NAMED_HTML_ENTITIES[named.toLowerCase()] ?? ''
      }
      const code = dec ? Number.parseInt(dec, 10) : hex ? Number.parseInt(hex, 16) : Number.NaN
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : ''
    }
  )
}

function cleanSnippetText(raw: string | undefined | null, maxLen = 300): string {
  if (!raw) return ''
  const noTags = String(raw).replace(/<[^>]+>/g, ' ')
  const decoded = decodeHtmlEntities(noTags).replace(/\s+/g, ' ').trim()
  if (decoded.length <= maxLen) return decoded
  return `${decoded.slice(0, maxLen - 1).trimEnd()}…`
}

function cleanTitleText(raw: string | undefined | null): string {
  if (!raw) return ''
  const noTags = String(raw).replace(/<[^>]+>/g, ' ')
  return decodeHtmlEntities(noTags).replace(/\s+/g, ' ').trim()
}

function normalizeResultUrl(rawUrl: string): { displayUrl: string; dedupeKey: string } | null {
  try {
    const parsed = new URL(rawUrl.trim())
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    parsed.hostname = parsed.hostname.toLowerCase()
    const toDelete: string[] = []
    parsed.searchParams.forEach((_v, k) => {
      const kl = k.toLowerCase()
      if (kl.startsWith('utm_') || kl === 'fbclid' || kl === 'gclid') {
        toDelete.push(k)
      }
    })
    for (const k of toDelete) parsed.searchParams.delete(k)
    const displayUrl = parsed.toString()
    let dedupeKey = displayUrl
    if (dedupeKey.endsWith('/') && parsed.pathname === '/') {
      dedupeKey = dedupeKey.slice(0, -1)
    } else if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
      const pCopy = new URL(displayUrl)
      pCopy.pathname = pCopy.pathname.replace(/\/+$/, '')
      dedupeKey = pCopy.toString()
    }
    return { displayUrl, dedupeKey }
  } catch {
    return null
  }
}

function postProcessResults(items: WebSearchResult[], limit: number): WebSearchResult[] {
  const seen = new Set<string>()
  const out: WebSearchResult[] = []
  for (const item of items) {
    const norm = normalizeResultUrl(item.url)
    if (!norm) continue
    if (seen.has(norm.dedupeKey)) continue
    seen.add(norm.dedupeKey)
    const title = cleanTitleText(item.title) || norm.displayUrl
    const snippet = cleanSnippetText(item.snippet, 300)
    out.push({
      title,
      url: norm.displayUrl,
      snippet,
      ...(item.engine ? { engine: item.engine } : {}),
      ...(item.publishedDate ? { publishedDate: item.publishedDate } : {})
    })
    if (out.length >= limit) break
  }
  return out
}

function getCachedSearch(key: string): WebSearchResponse | null {
  const entry = searchCache.get(key)
  if (!entry) return null
  if (Date.now() - entry.at > SEARCH_CACHE_TTL_MS) {
    searchCache.delete(key)
    return null
  }
  return entry.resp
}

function setCachedSearch(key: string, resp: WebSearchResponse): void {
  if (!resp.ok) return
  if (searchCache.size >= SEARCH_CACHE_MAX) {
    const oldestKey = searchCache.keys().next().value
    if (oldestKey !== undefined) searchCache.delete(oldestKey)
  }
  searchCache.set(key, { at: Date.now(), resp })
}

export async function searchSearxng(
  base: string,
  query: string,
  opts: WebSearchOptions,
  limit: number,
  signal?: AbortSignal
): Promise<{
  ok: boolean
  results: WebSearchResult[]
  answers?: string[]
  suggestions?: string[]
  error?: string
}> {
  try {
    const trimmedBase = base.trim().replace(/\/+$/, '')
    const url = new URL(`${trimmedBase}/search`)
    url.searchParams.set('q', query)
    url.searchParams.set('format', 'json')
    url.searchParams.set('language', 'en')
    url.searchParams.set('safesearch', '1')
    url.searchParams.set('categories', opts.category || 'general')
    if (opts.timeRange) {
      url.searchParams.set('time_range', opts.timeRange)
    }

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': APP_USER_AGENT
      },
      signal: createCombinedAbortSignal(3500, signal)
    })

    if (res.status === 403) {
      return {
        ok: false,
        results: [],
        error: 'Custom search server JSON API disabled – enable "json" format on server'
      }
    }
    if (!res.ok) {
      return {
        ok: false,
        results: [],
        error: `Custom search server returned HTTP ${res.status}`
      }
    }

    const data = (await res.json()) as {
      results?: Array<{
        url?: string
        title?: string
        content?: string
        engine?: string
        publishedDate?: string
      }>
      answers?: Array<string | { answer?: string }>
      suggestions?: string[]
    }

    const mapped: WebSearchResult[] = (Array.isArray(data.results) ? data.results : [])
      .filter((r) => typeof r?.url === 'string' && r.url.trim().length > 0)
      .map((r) => ({
        title: String(r.title || r.url || ''),
        url: String(r.url || ''),
        snippet: String(r.content || ''),
        engine: typeof r.engine === 'string' ? r.engine : 'searxng',
        publishedDate: typeof r.publishedDate === 'string' ? r.publishedDate : undefined
      }))

    const answers = (Array.isArray(data.answers) ? data.answers : [])
      .map((a) => (typeof a === 'string' ? a : typeof a?.answer === 'string' ? a.answer : ''))
      .map((a) => cleanSnippetText(a, 300))
      .filter(Boolean)

    const suggestions = (Array.isArray(data.suggestions) ? data.suggestions : [])
      .map((s) => cleanTitleText(String(s || '')))
      .filter(Boolean)
      .slice(0, 6)

    const results = postProcessResults(mapped, limit)
    return {
      ok: results.length > 0,
      results,
      ...(answers.length > 0 ? { answers } : {}),
      ...(suggestions.length > 0 ? { suggestions } : {}),
      ...(results.length === 0 ? { error: 'Custom search server returned 0 results' } : {})
    }
  } catch (err: unknown) {
    return {
      ok: false,
      results: [],
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

export async function searchDuckDuckGo(
  query: string,
  opts: WebSearchOptions,
  limit: number,
  signal?: AbortSignal
): Promise<{
  ok: boolean
  results: WebSearchResult[]
  error?: string
}> {
  try {
    const params = new URLSearchParams()
    params.set('q', query)
    if (opts.timeRange) {
      const dfMap: Record<NonNullable<WebSearchOptions['timeRange']>, string> = {
        day: 'd',
        week: 'w',
        month: 'm',
        year: 'y'
      }
      params.set('df', dfMap[opts.timeRange])
    }

    const res = await fetch('https://html.duckduckgo.com/html/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': DDG_USER_AGENT
      },
      body: params.toString(),
      signal: createCombinedAbortSignal(SEARCH_TIMEOUT_MS, signal)
    })

    const html = await res.text()
    if (res.status !== 200) {
      return {
        ok: false,
        results: [],
        error: 'DuckDuckGo refused the automated request'
      }
    }

    const { document } = parseHTML(html)
    const nodes = Array.from(document.querySelectorAll('.result'))
    if (nodes.length === 0 && /anomaly|captcha|challenge|unusual traffic/i.test(html)) {
      return {
        ok: false,
        results: [],
        error: 'DuckDuckGo refused the automated request'
      }
    }

    const rawResults: WebSearchResult[] = []
    for (const node of nodes) {
      const cls = node.getAttribute('class') || ''
      if (cls.includes('result--ad')) continue
      const link = node.querySelector('a.result__a')
      if (!link) continue
      const rawHref = (link.getAttribute('href') || '').trim()
      if (!rawHref) continue

      let resolvedHref = rawHref
      if (resolvedHref.startsWith('//')) {
        resolvedHref = `https:${resolvedHref}`
      } else if (resolvedHref.startsWith('/')) {
        resolvedHref = `https://duckduckgo.com${resolvedHref}`
      }
      if (resolvedHref.includes('uddg=')) {
        try {
          const parsedRedirect = new URL(resolvedHref)
          const uddg = parsedRedirect.searchParams.get('uddg')
          if (uddg) {
            resolvedHref = decodeURIComponent(uddg)
          }
        } catch {
          const m = resolvedHref.match(/[?&]uddg=([^&]+)/)
          if (m && m[1]) {
            try {
              resolvedHref = decodeURIComponent(m[1])
            } catch {
              // keep original
            }
          }
        }
      }

      const snippetEl = node.querySelector('.result__snippet')
      rawResults.push({
        title: link.textContent || resolvedHref,
        url: resolvedHref,
        snippet: snippetEl?.textContent || '',
        engine: 'duckduckgo'
      })
    }

    const results = postProcessResults(rawResults, limit)
    return {
      ok: results.length > 0,
      results,
      ...(results.length === 0 ? { error: 'DuckDuckGo returned 0 results' } : {})
    }
  } catch (err: unknown) {
    return {
      ok: false,
      results: [],
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

export async function searchDuckDuckGoInstant(
  query: string,
  signal?: AbortSignal
): Promise<{
  ok: boolean
  answers: string[]
  results: WebSearchResult[]
  error?: string
}> {
  try {
    const url = new URL('https://api.duckduckgo.com/')
    url.searchParams.set('q', query)
    url.searchParams.set('format', 'json')
    url.searchParams.set('no_html', '1')
    url.searchParams.set('skip_disambig', '1')

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': APP_USER_AGENT
      },
      signal: createCombinedAbortSignal(5500, signal)
    })
    if (!res.ok) {
      return { ok: false, answers: [], results: [], error: `DDG Instant HTTP ${res.status}` }
    }

    const data = (await res.json()) as {
      Heading?: string
      AbstractText?: string
      AbstractURL?: string
      Answer?: string
      Definition?: string
      DefinitionURL?: string
      Results?: Array<{ FirstURL?: string; Text?: string }>
      RelatedTopics?: Array<{
        FirstURL?: string
        Text?: string
        Topics?: Array<{ FirstURL?: string; Text?: string }>
      }>
    }

    const answers: string[] = []
    if (data.Answer) answers.push(cleanSnippetText(data.Answer, 300))
    if (data.AbstractText) answers.push(cleanSnippetText(data.AbstractText, 300))
    if (data.Definition) answers.push(cleanSnippetText(data.Definition, 300))

    const out: WebSearchResult[] = []
    if (data.AbstractURL && data.AbstractText) {
      out.push({
        title: data.Heading || data.AbstractURL,
        url: data.AbstractURL,
        snippet: data.AbstractText,
        engine: 'duckduckgo'
      })
    }
    if (data.DefinitionURL && data.Definition) {
      out.push({
        title: data.Heading || 'Definition',
        url: data.DefinitionURL,
        snippet: data.Definition,
        engine: 'duckduckgo'
      })
    }
    for (const r of data.Results ?? []) {
      if (r.FirstURL && r.Text) {
        out.push({
          title: r.Text.split(' - ')[0] || r.Text,
          url: r.FirstURL,
          snippet: r.Text,
          engine: 'duckduckgo'
        })
      }
    }
    for (const rt of data.RelatedTopics ?? []) {
      if (rt.FirstURL && rt.Text) {
        out.push({
          title: rt.Text.split(' - ')[0] || rt.Text,
          url: rt.FirstURL,
          snippet: rt.Text,
          engine: 'duckduckgo'
        })
      } else if (Array.isArray(rt.Topics)) {
        for (const sub of rt.Topics.slice(0, 3)) {
          if (sub.FirstURL && sub.Text) {
            out.push({
              title: sub.Text.split(' - ')[0] || sub.Text,
              url: sub.FirstURL,
              snippet: sub.Text,
              engine: 'duckduckgo'
            })
          }
        }
      }
    }

    return {
      ok: out.length > 0 || answers.length > 0,
      answers: answers.filter(Boolean),
      results: postProcessResults(out, 4)
    }
  } catch (err: unknown) {
    return {
      ok: false,
      answers: [],
      results: [],
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

export async function searchWikipedia(
  query: string,
  limit: number,
  signal?: AbortSignal
): Promise<{
  ok: boolean
  results: WebSearchResult[]
  error?: string
}> {
  try {
    const url = new URL('https://en.wikipedia.org/w/api.php')
    url.searchParams.set('action', 'query')
    url.searchParams.set('list', 'search')
    url.searchParams.set('srsearch', query)
    url.searchParams.set('format', 'json')
    url.searchParams.set('utf8', '1')
    url.searchParams.set('srlimit', String(limit))
    url.searchParams.set('origin', '*')

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': APP_USER_AGENT
      },
      signal: createCombinedAbortSignal(SEARCH_TIMEOUT_MS, signal)
    })

    if (!res.ok) {
      return {
        ok: false,
        results: [],
        error: `Wikipedia returned HTTP ${res.status}`
      }
    }

    const data = (await res.json()) as {
      query?: {
        search?: Array<{
          title?: string
          snippet?: string
          timestamp?: string
        }>
      }
    }

    const items = Array.isArray(data.query?.search) ? data.query.search : []
    const mapped: WebSearchResult[] = items
      .filter((it) => typeof it?.title === 'string' && it.title.trim().length > 0)
      .map((it) => {
        const title = String(it.title || '').trim()
        return {
          title,
          url: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
          snippet: String(it.snippet || ''),
          engine: 'wikipedia',
          publishedDate: typeof it.timestamp === 'string' ? it.timestamp : undefined
        }
      })

    const results = postProcessResults(mapped, limit)
    return {
      ok: results.length > 0,
      results,
      ...(results.length === 0 ? { error: 'Wikipedia returned 0 results' } : {})
    }
  } catch (err: unknown) {
    return {
      ok: false,
      results: [],
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

export async function searchHackerNews(
  query: string,
  limit: number,
  signal?: AbortSignal
): Promise<{
  ok: boolean
  results: WebSearchResult[]
  error?: string
}> {
  try {
    const url = new URL('https://hn.algolia.com/api/v1/search')
    url.searchParams.set('query', query)
    url.searchParams.set('tags', 'story')
    url.searchParams.set('hitsPerPage', String(limit))

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': APP_USER_AGENT
      },
      signal: createCombinedAbortSignal(7000, signal)
    })
    if (!res.ok) {
      return { ok: false, results: [], error: `Hacker News returned HTTP ${res.status}` }
    }

    const data = (await res.json()) as {
      hits?: Array<{
        objectID?: string
        title?: string
        url?: string
        story_text?: string
        points?: number
        num_comments?: number
        created_at?: string
      }>
    }

    const mapped: WebSearchResult[] = (data.hits ?? [])
      .filter((h) => h.title && (h.url || h.objectID))
      .map((h) => {
        const targetUrl = h.url || `https://news.ycombinator.com/item?id=${h.objectID}`
        const meta =
          typeof h.points === 'number'
            ? `(${h.points} pts, ${h.num_comments ?? 0} comments) `
            : ''
        return {
          title: String(h.title),
          url: targetUrl,
          snippet: `${meta}${cleanSnippetText(h.story_text || h.title || '', 260)}`,
          engine: 'hackernews',
          publishedDate: typeof h.created_at === 'string' ? h.created_at : undefined
        }
      })

    const results = postProcessResults(mapped, limit)
    return {
      ok: results.length > 0,
      results,
      ...(results.length === 0 ? { error: 'Hacker News returned 0 results' } : {})
    }
  } catch (err: unknown) {
    return {
      ok: false,
      results: [],
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

export async function searchStackOverflow(
  query: string,
  limit: number,
  signal?: AbortSignal
): Promise<{
  ok: boolean
  results: WebSearchResult[]
  error?: string
}> {
  try {
    const url = new URL('https://api.stackexchange.com/2.3/search/advanced')
    url.searchParams.set('order', 'desc')
    url.searchParams.set('sort', 'relevance')
    url.searchParams.set('site', 'stackoverflow')
    url.searchParams.set('pagesize', String(limit))
    url.searchParams.set('q', query)

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': APP_USER_AGENT
      },
      signal: createCombinedAbortSignal(7000, signal)
    })
    if (!res.ok) {
      return { ok: false, results: [], error: `Stack Overflow returned HTTP ${res.status}` }
    }

    const data = (await res.json()) as {
      items?: Array<{
        title?: string
        link?: string
        tags?: string[]
        score?: number
        answer_count?: number
        is_answered?: boolean
      }>
    }

    const mapped: WebSearchResult[] = (data.items ?? [])
      .filter((it) => it.link && it.title)
      .map((it) => {
        const tagLine = Array.isArray(it.tags) && it.tags.length > 0 ? `[${it.tags.join(', ')}] ` : ''
        const statusLine = `${it.is_answered ? 'Answered' : 'Open'} (${it.answer_count ?? 0} answers, score ${it.score ?? 0})`
        return {
          title: String(it.title),
          url: String(it.link),
          snippet: `${tagLine}${statusLine}`,
          engine: 'stackoverflow'
        }
      })

    const results = postProcessResults(mapped, limit)
    return {
      ok: results.length > 0,
      results,
      ...(results.length === 0 ? { error: 'Stack Overflow returned 0 results' } : {})
    }
  } catch (err: unknown) {
    return {
      ok: false,
      results: [],
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

export async function searchArxiv(
  query: string,
  limit: number,
  signal?: AbortSignal
): Promise<{
  ok: boolean
  results: WebSearchResult[]
  error?: string
}> {
  try {
    const url = new URL('https://export.arxiv.org/api/query')
    url.searchParams.set('search_query', `all:${query}`)
    url.searchParams.set('start', '0')
    url.searchParams.set('max_results', String(limit))

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/atom+xml,application/xml,text/xml',
        'User-Agent': APP_USER_AGENT
      },
      signal: createCombinedAbortSignal(8500, signal)
    })
    if (!res.ok) {
      return { ok: false, results: [], error: `arXiv returned HTTP ${res.status}` }
    }

    const xml = await res.text()
    const { document } = parseHTML(xml)
    const entries = Array.from(document.querySelectorAll('entry'))
    const mapped: WebSearchResult[] = []

    for (const entry of entries) {
      const idUrl = entry.querySelector('id')?.textContent?.trim() || ''
      const title = entry.querySelector('title')?.textContent?.trim() || ''
      const summary = entry.querySelector('summary')?.textContent?.trim() || ''
      const published = entry.querySelector('published')?.textContent?.trim() || undefined
      if (!idUrl || !title) continue
      mapped.push({
        title,
        url: idUrl.replace(/^http:\/\//i, 'https://'),
        snippet: summary,
        engine: 'arxiv',
        publishedDate: published
      })
    }

    const results = postProcessResults(mapped, limit)
    return {
      ok: results.length > 0,
      results,
      ...(results.length === 0 ? { error: 'arXiv returned 0 results' } : {})
    }
  } catch (err: unknown) {
    return {
      ok: false,
      results: [],
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

export async function searchOpenAlex(
  query: string,
  limit: number,
  signal?: AbortSignal
): Promise<{
  ok: boolean
  results: WebSearchResult[]
  error?: string
}> {
  try {
    const url = new URL('https://api.openalex.org/works')
    url.searchParams.set('search', query)
    url.searchParams.set('per-page', String(limit))
    url.searchParams.set('select', 'id,doi,title,publication_year,cited_by_count,primary_location')

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': APP_USER_AGENT
      },
      signal: createCombinedAbortSignal(7500, signal)
    })
    if (!res.ok) {
      return { ok: false, results: [], error: `OpenAlex returned HTTP ${res.status}` }
    }

    const data = (await res.json()) as {
      results?: Array<{
        id?: string
        doi?: string
        title?: string
        publication_year?: number
        cited_by_count?: number
        primary_location?: {
          landing_page_url?: string
          source?: { display_name?: string }
        }
      }>
    }

    const mapped: WebSearchResult[] = (data.results ?? [])
      .filter((w) => w.title && (w.primary_location?.landing_page_url || w.doi || w.id))
      .map((w) => {
        const targetUrl = w.primary_location?.landing_page_url || w.doi || w.id || ''
        const venue = w.primary_location?.source?.display_name
        const metaParts = [
          w.publication_year ? String(w.publication_year) : '',
          venue || '',
          typeof w.cited_by_count === 'number' ? `${w.cited_by_count} citations` : ''
        ].filter(Boolean)
        return {
          title: String(w.title),
          url: targetUrl,
          snippet: metaParts.join(' · ') || 'OpenAlex Scholarly Work',
          engine: 'openalex',
          publishedDate: w.publication_year ? String(w.publication_year) : undefined
        }
      })

    const results = postProcessResults(mapped, limit)
    return {
      ok: results.length > 0,
      results,
      ...(results.length === 0 ? { error: 'OpenAlex returned 0 results' } : {})
    }
  } catch (err: unknown) {
    return {
      ok: false,
      results: [],
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

function fuseMetasearchResults(
  lists: Array<{ engine: WebSearchProvider; weight: number; results: WebSearchResult[] }>,
  limit: number
): WebSearchResult[] {
  const scoreMap = new Map<string, { score: number; item: WebSearchResult }>()
  for (const list of lists) {
    list.results.forEach((item, rank) => {
      const norm = normalizeResultUrl(item.url)
      if (!norm) return
      const rrfScore = list.weight / (60 + rank + 1)
      const prev = scoreMap.get(norm.dedupeKey)
      if (prev) {
        prev.score += rrfScore
        if (prev.item.snippet.length < item.snippet.length) {
          prev.item = { ...prev.item, snippet: item.snippet }
        }
      } else {
        scoreMap.set(norm.dedupeKey, {
          score: rrfScore,
          item: {
            ...item,
            url: norm.displayUrl,
            title: cleanTitleText(item.title) || norm.displayUrl,
            snippet: cleanSnippetText(item.snippet, 300)
          }
        })
      }
    })
  }
  return Array.from(scoreMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.item)
}

/**
 * 100% Zero-Config, Zero-Docker Built-In Open MetaSearch.
 * Runs directly in Node/Electron querying DuckDuckGo (Web + Instant Answer API),
 * Wikipedia, Stack Overflow, Hacker News, arXiv, and OpenAlex, fused via RRF.
 */
async function searchBuiltinMetasearch(
  query: string,
  opts: WebSearchOptions,
  limit: number,
  signal?: AbortSignal
): Promise<{
  ok: boolean
  provider: WebSearchProvider
  results: WebSearchResult[]
  answers: string[]
  attempts: WebSearchAttempt[]
}> {
  const attempts: WebSearchAttempt[] = []
  const fusedInputs: Array<{ engine: WebSearchProvider; weight: number; results: WebSearchResult[] }> = []
  const answers: string[] = []

  const runTimed = async <T extends { ok: boolean; results: WebSearchResult[]; error?: string }>(
    provider: WebSearchProvider,
    weight: number,
    fn: () => Promise<T>
  ): Promise<void> => {
    const t0 = Date.now()
    const out = await fn()
    attempts.push({
      provider,
      ok: out.ok && out.results.length > 0,
      count: out.results.length,
      ...(out.error ? { error: out.error } : {}),
      ms: Date.now() - t0
    })
    if (out.results.length > 0) {
      fusedInputs.push({ engine: provider, weight, results: out.results })
    }
    const maybeAns = (out as unknown as { answers?: string[] }).answers
    if (Array.isArray(maybeAns)) {
      for (const a of maybeAns) {
        if (a && !answers.includes(a)) answers.push(a)
      }
    }
  }

  const isDevQuery =
    opts.category === 'it' ||
    /\b(error|exception|bug|react|typescript|javascript|python|electron|node|css|api|npm|library|framework|code|sql|docker|git|rust|java|c\+\+)\b/i.test(
      query
    )
  const isScienceQuery =
    opts.category === 'science' ||
    /\b(paper|theorem|equation|physics|quantum|biology|chemistry|arxiv|study|algorithm|neural|transformer|molecule|gene|math|calculus)\b/i.test(
      query
    )
  const isNewsOrRecent =
    opts.category === 'news' ||
    Boolean(opts.timeRange) ||
    /\b(latest|news|recent|today|current|202[4-9]|203\d|release|released|version|announced)\b/i.test(
      query
    )

  const tasks: Array<Promise<void>> = [
    runTimed('duckduckgo', 1.45, () => searchDuckDuckGo(query, opts, limit, signal)),
    runTimed('duckduckgo', 1.05, () => searchDuckDuckGoInstant(query, signal)),
    runTimed('wikipedia', 0.95, () => searchWikipedia(query, Math.min(4, limit), signal))
  ]

  if (isDevQuery) {
    tasks.push(
      runTimed('stackoverflow', 1.15, () => searchStackOverflow(query, Math.min(4, limit), signal)),
      runTimed('hackernews', 1.0, () => searchHackerNews(query, Math.min(4, limit), signal))
    )
  } else if (isScienceQuery) {
    tasks.push(
      runTimed('arxiv', 1.15, () => searchArxiv(query, Math.min(4, limit), signal)),
      runTimed('openalex', 1.0, () => searchOpenAlex(query, Math.min(4, limit), signal))
    )
  } else if (isNewsOrRecent) {
    tasks.push(
      runTimed('hackernews', 1.1, () => searchHackerNews(query, Math.min(5, limit), signal))
    )
  }

  await Promise.allSettled(tasks)

  const results = fuseMetasearchResults(fusedInputs, limit)
  const respondingEngines = Array.from(
    new Set(fusedInputs.filter((f) => f.results.length > 0).map((f) => f.engine))
  )
  const provider: WebSearchProvider =
    respondingEngines.length === 1 ? respondingEngines[0] : respondingEngines.length > 1 ? 'builtin' : 'none'

  return {
    ok: results.length > 0,
    provider,
    results,
    answers,
    attempts
  }
}

export async function webSearch(
  query: string,
  opts: WebSearchOptions = {},
  settings: Partial<WebSearchSettings> = {},
  signal?: AbortSignal,
  noCache = false
): Promise<WebSearchResponse> {
  const startedAt = Date.now()
  const merged: WebSearchSettings = {
    enabled: settings.enabled ?? DEFAULTS.enabled,
    providerMode: settings.providerMode ?? DEFAULTS.providerMode,
    searxngUrl: settings.searxngUrl ?? DEFAULTS.searxngUrl,
    allowFallback: settings.allowFallback ?? DEFAULTS.allowFallback
  }

  const limit = Math.max(1, Math.min(10, Math.round(opts.limit ?? 6)))
  const effectiveQuery =
    opts.site && opts.site.trim() ? `${query.trim()} site:${opts.site.trim()}` : query.trim()

  if (!merged.enabled) {
    return {
      ok: false,
      provider: 'none',
      query: effectiveQuery,
      results: [],
      attempts: [],
      durationMs: Date.now() - startedAt,
      error: 'Web search is disabled in Settings.'
    }
  }

  if (!effectiveQuery) {
    return {
      ok: false,
      provider: 'none',
      query: effectiveQuery,
      results: [],
      attempts: [],
      durationMs: Date.now() - startedAt,
      error: 'Search query cannot be empty.'
    }
  }

  const cacheKey = JSON.stringify({
    query: effectiveQuery,
    opts: {
      limit,
      timeRange: opts.timeRange ?? null,
      category: opts.category ?? 'general'
    },
    providerMode: merged.providerMode,
    searxngUrl: merged.providerMode === 'searxng' ? merged.searxngUrl.trim() : '',
    allowFallback: merged.allowFallback
  })

  if (!noCache) {
    const cached = getCachedSearch(cacheKey)
    if (cached) return cached
  }

  const attempts: WebSearchAttempt[] = []

  // Only query custom SearXNG if user explicitly enabled custom server mode with a URL
  const searxBase = merged.providerMode === 'searxng' ? merged.searxngUrl.trim() : ''
  if (searxBase) {
    const t0 = Date.now()
    const sx = await searchSearxng(searxBase, effectiveQuery, opts, limit, signal)
    attempts.push({
      provider: 'searxng',
      ok: sx.ok && sx.results.length > 0,
      count: sx.results.length,
      ...(sx.error ? { error: sx.error } : {}),
      ms: Date.now() - t0
    })
    if (sx.ok && sx.results.length > 0) {
      const resp: WebSearchResponse = {
        ok: true,
        provider: 'searxng',
        query: effectiveQuery,
        results: sx.results,
        ...(sx.answers ? { answers: sx.answers } : {}),
        ...(sx.suggestions ? { suggestions: sx.suggestions } : {}),
        attempts,
        durationMs: Date.now() - startedAt
      }
      if (!noCache) setCachedSearch(cacheKey, resp)
      return resp
    }
    if (!merged.allowFallback) {
      return {
        ok: false,
        provider: 'none',
        query: effectiveQuery,
        results: [],
        attempts,
        durationMs: Date.now() - startedAt,
        error: sx.error || 'Custom search server returned 0 results.'
      }
    }
  }

  // Zero-Docker Built-in Open MetaSearch (primary by default)
  const builtin = await searchBuiltinMetasearch(effectiveQuery, opts, limit, signal)
  attempts.push(...builtin.attempts)

  if (builtin.ok && builtin.results.length > 0) {
    const resp: WebSearchResponse = {
      ok: true,
      provider: builtin.provider,
      query: effectiveQuery,
      results: builtin.results,
      ...(builtin.answers.length > 0 ? { answers: builtin.answers } : {}),
      attempts,
      durationMs: Date.now() - startedAt
    }
    if (!noCache) setCachedSearch(cacheKey, resp)
    return resp
  }

  const errParts = attempts
    .map((a) => (a.error ? `${a.provider}: ${a.error}` : `${a.provider}: 0 results`))
    .filter(Boolean)

  return {
    ok: false,
    provider: 'none',
    query: effectiveQuery,
    results: [],
    attempts,
    durationMs: Date.now() - startedAt,
    error: errParts.join(' | ') || 'No web search results found. Check your internet connection.'
  }
}

export async function testWebSearch(
  settings: Partial<WebSearchSettings> = {}
): Promise<WebSearchResponse> {
  return await webSearch(
    'open source search engine',
    { limit: 3 },
    { ...settings, enabled: true },
    undefined,
    true
  )
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p))
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true
  }
  const [a, b] = parts
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a >= 224) return true
  return false
}

function isPrivateIpv6(ip: string): boolean {
  const clean = ip.split('%')[0].toLowerCase()
  if (clean === '::' || clean === '::1') return true
  if (clean.startsWith('::ffff:')) {
    const mapped = clean.slice('::ffff:'.length)
    if (isIP(mapped) === 4) return isPrivateIpv4(mapped)
    const hexParts = mapped.split(':')
    if (hexParts.length === 2) {
      const hi = Number.parseInt(hexParts[0], 16)
      const lo = Number.parseInt(hexParts[1], 16)
      if (!Number.isNaN(hi) && !Number.isNaN(lo)) {
        const ipv4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`
        return isPrivateIpv4(ipv4)
      }
    }
    return true
  }
  const firstSegment = clean.split(':')[0]
  if (/^[0-9a-f]{1,4}$/.test(firstSegment)) {
    const val = Number.parseInt(firstSegment, 16)
    if ((val & 0xfe00) === 0xfc00) return true
    if ((val & 0xffc0) === 0xfe80) return true
  }
  return false
}

function isBlockedIpAddress(rawIp: string): boolean {
  const clean = rawIp.replace(/^\[|\]$/g, '').split('%')[0]
  const ver = isIP(clean)
  if (ver === 4) return isPrivateIpv4(clean)
  if (ver === 6) return isPrivateIpv6(clean)
  return false
}

async function assertPublicUrl(u: URL): Promise<void> {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`Unsupported URL protocol: ${u.protocol}`)
  }
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!host) {
    throw new Error('URL hostname is missing')
  }
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === 'ip6-localhost'
  ) {
    throw new Error(`Blocked private hostname: ${host}`)
  }

  if (isIP(host)) {
    if (isBlockedIpAddress(host)) {
      throw new Error(`Blocked private or loopback IP address: ${host}`)
    }
    return
  }

  const resolved = await lookup(host, { all: true })
  if (!resolved || resolved.length === 0) {
    throw new Error(`Could not resolve hostname: ${host}`)
  }
  for (const record of resolved) {
    if (isBlockedIpAddress(record.address)) {
      throw new Error(`Blocked host "${host}" resolving to private address ${record.address}`)
    }
  }
}

async function readResponseWithCap(
  res: Response,
  maxBytes: number
): Promise<{ buffer: Buffer; hitByteCap: boolean }> {
  if (!res.body) {
    return { buffer: Buffer.alloc(0), hitByteCap: false }
  }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  let hitByteCap = false
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value || value.byteLength === 0) continue
      if (total + value.byteLength > maxBytes) {
        const remaining = maxBytes - total
        if (remaining > 0) {
          chunks.push(value.subarray(0, remaining))
          total += remaining
        }
        hitByteCap = true
        await reader.cancel().catch(() => {})
        break
      }
      chunks.push(value)
      total += value.byteLength
    }
  } finally {
    reader.releaseLock()
  }
  return { buffer: Buffer.concat(chunks, total), hitByteCap }
}

function normalizeExtractedText(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function selectRelevantPassages(text: string, query: string | undefined, maxChars: number): string {
  if (text.length <= maxChars) return text
  const terms = Array.from(
    new Set(
      (query || '')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 3)
    )
  )
  if (terms.length === 0) {
    return text.slice(0, maxChars).trimEnd()
  }

  const rawParas = text.split(/\n\n+/)
  const chunks: string[] = []
  for (const para of rawParas) {
    if (para.length <= 650) {
      chunks.push(para)
    } else {
      for (let i = 0; i < para.length; i += 600) {
        chunks.push(para.slice(i, i + 600))
      }
    }
  }

  const scored = chunks.map((chunk, idx) => {
    const lower = chunk.toLowerCase()
    let hits = 0
    for (const t of terms) {
      if (lower.includes(t)) hits++
    }
    return { idx, chunk, hits }
  })

  const ranked = [...scored].sort((a, b) => b.hits - a.hits || a.idx - b.idx)
  const chosenIndices = new Set<number>()
  let budget = 0
  for (const item of ranked) {
    if (item.hits === 0 && chosenIndices.size > 0) break
    const sepCost = chosenIndices.size > 0 ? 3 : 0
    if (budget + sepCost + item.chunk.length > maxChars) {
      if (chosenIndices.size === 0) {
        return item.chunk.slice(0, maxChars).trimEnd()
      }
      continue
    }
    chosenIndices.add(item.idx)
    budget += sepCost + item.chunk.length
  }

  const ordered = Array.from(chosenIndices)
    .sort((a, b) => a - b)
    .map((idx) => chunks[idx])

  return ordered.join('\n…\n').slice(0, maxChars)
}

export async function fetchWebPage(
  url: string,
  opts: { query?: string; maxChars?: number; signal?: AbortSignal } = {}
): Promise<WebPageContent> {
  const maxChars = Math.max(500, Math.min(6000, Math.round(opts.maxChars ?? 3500)))
  let currentUrl: URL
  try {
    currentUrl = new URL(url.trim())
    await assertPublicUrl(currentUrl)
  } catch (err: unknown) {
    return {
      ok: false,
      url,
      content: '',
      totalChars: 0,
      truncated: false,
      error: err instanceof Error ? err.message : String(err)
    }
  }

  try {
    const combinedSignal = createCombinedAbortSignal(PAGE_TIMEOUT_MS, opts.signal)
    let res: Response | null = null
    let hops = 0
    const MAX_REDIRECTS = 5

    while (hops <= MAX_REDIRECTS) {
      res = await fetch(currentUrl.toString(), {
        method: 'GET',
        redirect: 'manual',
        headers: {
          Accept:
            'text/html,application/xhtml+xml,text/plain,text/markdown,application/json,application/pdf;q=0.8,*/*;q=0.5',
          'User-Agent': APP_USER_AGENT
        },
        signal: combinedSignal
      })

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location')
        await res.body?.cancel().catch(() => {})
        if (!location) break
        hops += 1
        if (hops > MAX_REDIRECTS) {
          return {
            ok: false,
            url,
            finalUrl: currentUrl.toString(),
            content: '',
            totalChars: 0,
            truncated: false,
            error: 'Too many redirects while fetching webpage'
          }
        }
        currentUrl = new URL(location, currentUrl)
        await assertPublicUrl(currentUrl)
        continue
      }
      break
    }

    if (!res) {
      return {
        ok: false,
        url,
        content: '',
        totalChars: 0,
        truncated: false,
        error: 'No response received'
      }
    }

    if (!res.ok) {
      await res.body?.cancel().catch(() => {})
      return {
        ok: false,
        url,
        finalUrl: currentUrl.toString(),
        content: '',
        totalChars: 0,
        truncated: false,
        error: `HTTP ${res.status} fetching ${currentUrl.hostname}`
      }
    }

    const contentType = (res.headers.get('content-type') || 'text/html').toLowerCase()
    const { buffer } = await readResponseWithCap(res, MAX_HTML_BYTES)

    let title: string | undefined
    let siteName: string | undefined
    let byline: string | undefined
    let excerpt: string | undefined
    let rawText = ''

    if (contentType.includes('text/html') || contentType.includes('application/xhtml+xml')) {
      const html = buffer.toString('utf8')
      const { document } = parseHTML(html)
      const article = new Readability(document as any).parse()
      if (article && article.textContent && article.textContent.trim().length > 0) {
        title = article.title || document.title || undefined
        siteName = article.siteName || undefined
        byline = article.byline || undefined
        excerpt = article.excerpt || undefined
        rawText = article.textContent
      } else {
        title = document.title || undefined
        for (const el of Array.from(document.querySelectorAll('script,style,nav,footer'))) {
          el.remove()
        }
        rawText = document.body?.textContent || document.documentElement?.textContent || ''
      }
    } else if (
      contentType.includes('text/plain') ||
      contentType.includes('json') ||
      contentType.includes('markdown') ||
      contentType.includes('text/markdown')
    ) {
      rawText = buffer.toString('utf8')
    } else if (contentType.includes('application/pdf')) {
      const { parseDocumentBuffer } = await import('./mediaService')
      const parsed = await parseDocumentBuffer('page.pdf', buffer.toString('base64'))
      if (!parsed.ok || !parsed.text) {
        return {
          ok: false,
          url,
          finalUrl: currentUrl.toString(),
          content: '',
          totalChars: 0,
          truncated: false,
          error: parsed.error || 'Failed to extract text from PDF'
        }
      }
      rawText = parsed.text
      title = parsed.fileName
    } else {
      return {
        ok: false,
        url,
        finalUrl: currentUrl.toString(),
        content: '',
        totalChars: 0,
        truncated: false,
        error: `Unsupported content type: ${contentType}`
      }
    }

    const normalized = normalizeExtractedText(rawText)
    const totalChars = normalized.length
    const truncated = totalChars > maxChars
    const content = selectRelevantPassages(normalized, opts.query, maxChars)

    return {
      ok: content.length > 0,
      url,
      finalUrl: currentUrl.toString(),
      title: title ? cleanTitleText(title) : undefined,
      siteName: siteName ? cleanTitleText(siteName) : undefined,
      byline: byline ? cleanTitleText(byline) : undefined,
      excerpt: excerpt ? cleanSnippetText(excerpt, 300) : undefined,
      content,
      totalChars,
      truncated,
      ...(content.length === 0 ? { error: 'Page contained no readable text' } : {})
    }
  } catch (err: unknown) {
    return {
      ok: false,
      url,
      finalUrl: currentUrl.toString(),
      content: '',
      totalChars: 0,
      truncated: false,
      error: err instanceof Error ? err.message : String(err)
    }
  }
}
