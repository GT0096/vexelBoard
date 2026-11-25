import * as sqliteVec from 'sqlite-vec'
import { join } from 'path'
import { app } from 'electron'
import { existsSync, mkdirSync } from 'fs'
import type {
  OverallHistoryEntry,
  OverallHistorySummary,
  ProjectChatStore,
  ProjectChatThread,
  ProjectItem,
  SectionElementBreakdown,
  SectionItem,
  StoredChatMessage
} from '../shared/ipc'

export interface KnowledgeSource {
  id: string
  boardId?: string
  title: string
  sourceType: 'file' | 'pdf' | 'youtube' | 'text' | 'board'
  sourceUrl?: string
  rawContent: string
  summary?: string
  tokenCount?: number
  createdAt: number
}

export interface KnowledgeChunk {
  id: string
  sourceId: string
  chunkIndex: number
  chunkText: string
  metadata?: Record<string, any>
  embedding?: number[]
}

export interface HistoryEvent {
  id?: number
  boardId: string
  eventType: 'create' | 'update' | 'delete' | 'connect' | 'recall'
  elementId: string
  description?: string
  timestamp: number
}

export interface SearchResult {
  chunkId: string
  sourceId: string
  sourceTitle: string
  sourceType: string
  chunkText: string
  metadata?: Record<string, any>
  score: number
}

interface SqliteStatement {
  run: (...params: any[]) => any
  all: (...params: any[]) => any[]
  get: (...params: any[]) => any
}

interface SqliteDb {
  exec: (sql: string) => void
  prepare: (sql: string) => SqliteStatement
  close?: () => void
}

export const VECTOR_DIMENSION = 384

/** Fast local deterministic feature projection vector (384 dims, normalized) */
export function generateLocalEmbedding(text: string): Float32Array {
  const vec = new Float32Array(VECTOR_DIMENSION)
  if (!text || !text.trim()) return vec

  const clean = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ')
  const words = clean.split(/\s+/).filter(Boolean)

  for (let i = 0; i < words.length; i++) {
    const word = words[i]
    let h = 2166136261
    for (let c = 0; c < word.length; c++) {
      h ^= word.charCodeAt(c)
      h = Math.imul(h, 16777619)
    }
    const idx = Math.abs(h) % VECTOR_DIMENSION
    vec[idx] += 1.0

    // Also hash adjacent bigram for phrase continuity
    if (i < words.length - 1) {
      const bigram = `${word}_${words[i + 1]}`
      let bh = 2166136261
      for (let c = 0; c < bigram.length; c++) {
        bh ^= bigram.charCodeAt(c)
        bh = Math.imul(bh, 16777619)
      }
      const bIdx = Math.abs(bh) % VECTOR_DIMENSION
      vec[bIdx] += 1.5
    }
  }

  // L2 Normalize
  let norm = 0
  for (let i = 0; i < VECTOR_DIMENSION; i++) {
    norm += vec[i] * vec[i]
  }
  norm = Math.sqrt(norm)
  if (norm > 0) {
    for (let i = 0; i < VECTOR_DIMENSION; i++) {
      vec[i] /= norm
    }
  }
  return vec
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i]
  }
  return dot
}

function toVecBytes(vec: Float32Array): Uint8Array {
  return new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength)
}

function sanitizeParams(params: any[]): any[] {
  return params.map((p) => (p === undefined ? null : p))
}

class DatabaseManager {
  private db: SqliteDb | null = null
  private vectorExtensionLoaded = false
  private engineName: 'better-sqlite3' | 'node:sqlite' | 'none' = 'none'

  public init(): void {
    if (this.db) return

    const userDataDir = app.getPath('userData')
    if (!existsSync(userDataDir)) {
      mkdirSync(userDataDir, { recursive: true })
    }

    const dbPath = join(userDataDir, 'board_store.db')
    let rawDb: any = null

    // 1. Try better-sqlite3 first
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const BetterSqlite3 = require('better-sqlite3')
      rawDb = new BetterSqlite3(dbPath)
      rawDb.exec('SELECT 1')
      this.engineName = 'better-sqlite3'
    } catch (err) {
      console.warn('[DB] better-sqlite3 unavailable in this runtime, switching to built-in node:sqlite:', err)
      rawDb = null
    }

    // 2. Fall back to Electron's built-in node:sqlite (DatabaseSync) — zero-setup & zero ABI issues
    if (!rawDb) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const nodeSqlite = require('node:sqlite')
        rawDb = new nodeSqlite.DatabaseSync(dbPath, { allowExtension: true })
        if (typeof rawDb.enableLoadExtension === 'function') {
          rawDb.enableLoadExtension(true)
        }
        this.engineName = 'node:sqlite'
      } catch (err) {
        console.error('[DB] Failed to initialize both better-sqlite3 and node:sqlite:', err)
        this.engineName = 'none'
        return
      }
    }

    this.db = {
      exec: (sql: string) => rawDb.exec(sql),
      prepare: (sql: string) => {
        const stmt = rawDb.prepare(sql)
        return {
          run: (...params: any[]) => stmt.run(...sanitizeParams(params)),
          all: (...params: any[]) => stmt.all(...sanitizeParams(params)),
          get: (...params: any[]) => stmt.get(...sanitizeParams(params))
        }
      },
      close: () => rawDb.close?.()
    }

    // Performance & durability settings (compatible with both engines)
    try {
      this.db.exec(
        'PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA temp_store = MEMORY; PRAGMA cache_size = -16000; PRAGMA foreign_keys = ON;'
      )
    } catch (err) {
      console.warn('[DB] PRAGMA setup warning:', err)
    }

    // Load sqlite-vec extension with fail-safe fallback
    try {
      sqliteVec.load(rawDb)
      this.vectorExtensionLoaded = true
      console.log(`[DB] Initialized (${this.engineName}) with sqlite-vec extension at ${dbPath}`)
    } catch (err) {
      this.vectorExtensionLoaded = false
      console.warn(`[DB] Initialized (${this.engineName}) without sqlite-vec (using JS cosine fallback):`, err)
    }

    this.runMigrations()
  }

  private ensureInit(): boolean {
    if (!this.db) {
      try {
        this.init()
      } catch {
        return false
      }
    }
    return Boolean(this.db)
  }

  private runTransaction(fn: () => void): void {
    if (!this.db) return
    this.db.exec('BEGIN')
    try {
      fn()
      this.db.exec('COMMIT')
    } catch (err) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        /* ignore rollback errors */
      }
      throw err
    }
  }

  private runMigrations(): void {
    if (!this.db) return

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS boards (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        viewport_json TEXT
      );

      CREATE TABLE IF NOT EXISTS board_elements (
        id TEXT PRIMARY KEY,
        board_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        x REAL NOT NULL,
        y REAL NOT NULL,
        w REAL,
        h REAL,
        content_text TEXT,
        raw_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_board_elements_board_kind
        ON board_elements(board_id, kind);

      CREATE TABLE IF NOT EXISTS knowledge_sources (
        id TEXT PRIMARY KEY,
        board_id TEXT,
        title TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_url TEXT,
        raw_content TEXT NOT NULL,
        summary TEXT,
        token_count INTEGER,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS knowledge_chunks (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        chunk_text TEXT NOT NULL,
        metadata_json TEXT,
        embedding BLOB,
        FOREIGN KEY(source_id) REFERENCES knowledge_sources(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS board_history_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        board_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        element_id TEXT NOT NULL,
        description TEXT,
        timestamp INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        color TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sections (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        color TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS project_chats (
        project_id TEXT PRIMARY KEY,
        messages_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
    `)

    try {
      this.db.exec('ALTER TABLE sections ADD COLUMN color TEXT')
    } catch {
      /* column already exists */
    }

    // FTS5 Tables
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS elements_fts USING fts5(
          element_id UNINDEXED,
          board_id UNINDEXED,
          content_text
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
          chunk_id UNINDEXED,
          source_id UNINDEXED,
          chunk_text
        );
      `)
    } catch (e) {
      console.warn('[DB] FTS5 init warning:', e)
    }

    // Vector Table if extension is present
    if (this.vectorExtensionLoaded) {
      try {
        this.db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
            chunk_id text primary key,
            embedding float[${VECTOR_DIMENSION}]
          );
        `)
      } catch (e) {
        console.warn('[DB] vec_chunks table creation warning:', e)
        this.vectorExtensionLoaded = false
      }
    }
  }

  // --- Board State Storage ---

  public saveBoardElements(
    boardId: string,
    title: string,
    elements: Array<{ id: string; kind: string; x: number; y: number; w?: number; h?: number; text?: string; raw: any }>
  ): void {
    if (!this.ensureInit() || !this.db) return

    const now = Date.now()
    const upsertBoard = this.db.prepare(`
      INSERT INTO boards (id, title, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at
    `)
    const touchSection = this.db.prepare('UPDATE sections SET updated_at = ? WHERE id = ?')
    const touchParentProject = this.db.prepare(
      'UPDATE projects SET updated_at = ? WHERE id = (SELECT project_id FROM sections WHERE id = ?)'
    )

    const deleteOldElements = this.db.prepare('DELETE FROM board_elements WHERE board_id = ?')
    const deleteFts = this.db.prepare('DELETE FROM elements_fts WHERE board_id = ?')
    const insertElement = this.db.prepare(`
      INSERT INTO board_elements (id, board_id, kind, x, y, w, h, content_text, raw_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const insertFts = this.db.prepare(`
      INSERT INTO elements_fts (element_id, board_id, content_text)
      VALUES (?, ?, ?)
    `)

    this.runTransaction(() => {
      upsertBoard.run(boardId, title || 'Untitled Board', now, now)
      touchSection.run(now, boardId)
      touchParentProject.run(now, boardId)
      deleteOldElements.run(boardId)
      try {
        deleteFts.run(boardId)
      } catch {
        /* ignore */
      }

      for (const el of elements) {
        const text = el.text || ''
        const createdAt =
          typeof el.raw?.createdAt === 'number' && Number.isFinite(el.raw.createdAt) ? el.raw.createdAt : now
        // Guardrail: never persist raw base64 PNGs inside canvas board_elements rows
        const safeRaw =
          el.raw && typeof el.raw === 'object'
            ? { ...el.raw, base64Png: undefined, imageBase64: undefined }
            : el.raw
        insertElement.run(
          el.id,
          boardId,
          el.kind,
          el.x ?? 0,
          el.y ?? 0,
          el.w ?? null,
          el.h ?? null,
          text,
          JSON.stringify(safeRaw),
          createdAt,
          now
        )
        if (text.trim().length > 0) {
          try {
            insertFts.run(el.id, boardId, text)
          } catch {
            /* ignore */
          }
        }
      }
    })
  }

  public getBoardElements(boardId: string): any[] {
    if (!this.ensureInit() || !this.db) return []
    const rows = this.db
      .prepare('SELECT raw_json FROM board_elements WHERE board_id = ? ORDER BY created_at ASC')
      .all(boardId) as { raw_json: string }[]
    return rows.map((r) => JSON.parse(r.raw_json))
  }

  // --- Knowledge Source & Chunk Indexing ---

  private reclaimDiskSpace(): void {
    if (!this.db) return
    try {
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE);')
    } catch {
      /* ignore checkpoint warnings */
    }
    try {
      this.db.exec('VACUUM;')
    } catch {
      /* ignore vacuum warnings if DB is busy */
    }
  }

  private purgeSourcesInTx(sourceIds: string[]): number {
    if (!this.db || sourceIds.length === 0) return 0
    const selectChunkIds = this.db.prepare('SELECT id FROM knowledge_chunks WHERE source_id = ?')
    const deleteVecById = this.vectorExtensionLoaded
      ? this.db.prepare('DELETE FROM vec_chunks WHERE chunk_id = ?')
      : null
    const deleteFtsBySource = this.db.prepare('DELETE FROM chunks_fts WHERE source_id = ?')
    const deleteChunksBySource = this.db.prepare('DELETE FROM knowledge_chunks WHERE source_id = ?')
    const deleteSourceById = this.db.prepare('DELETE FROM knowledge_sources WHERE id = ?')

    let deletedChunks = 0
    for (const sourceId of sourceIds) {
      const chunkRows = selectChunkIds.all(sourceId) as { id: string }[]
      deletedChunks += chunkRows.length

      if (deleteVecById) {
        for (const row of chunkRows) {
          try {
            deleteVecById.run(row.id)
          } catch {
            /* ignore missing vec row */
          }
        }
      }

      try {
        deleteFtsBySource.run(sourceId)
      } catch {
        /* ignore FTS errors */
      }
      deleteChunksBySource.run(sourceId)
      deleteSourceById.run(sourceId)
    }

    return deletedChunks
  }

  public addKnowledgeSource(source: KnowledgeSource, chunks: KnowledgeChunk[]): void {
    if (!this.ensureInit() || !this.db) return

    const insertSource = this.db.prepare(`
      INSERT INTO knowledge_sources (id, board_id, title, source_type, source_url, raw_content, summary, token_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        source_url = excluded.source_url,
        raw_content = excluded.raw_content,
        summary = excluded.summary,
        token_count = excluded.token_count
    `)

    const selectOldChunkIds = this.db.prepare('SELECT id FROM knowledge_chunks WHERE source_id = ?')
    const deleteVecById = this.vectorExtensionLoaded
      ? this.db.prepare('DELETE FROM vec_chunks WHERE chunk_id = ?')
      : null
    const deleteOldChunks = this.db.prepare('DELETE FROM knowledge_chunks WHERE source_id = ?')
    const deleteOldFts = this.db.prepare('DELETE FROM chunks_fts WHERE source_id = ?')
    const insertChunk = this.db.prepare(`
      INSERT INTO knowledge_chunks (id, source_id, chunk_index, chunk_text, metadata_json, embedding)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    const insertFts = this.db.prepare('INSERT INTO chunks_fts (chunk_id, source_id, chunk_text) VALUES (?, ?, ?)')

    let insertVec: SqliteStatement | null = null
    if (this.vectorExtensionLoaded) {
      try {
        insertVec = this.db.prepare('INSERT OR REPLACE INTO vec_chunks (chunk_id, embedding) VALUES (?, ?)')
      } catch {
        insertVec = null
      }
    }

    const effectiveChunks: KnowledgeChunk[] =
      chunks && chunks.length > 0
        ? chunks
        : source.rawContent.trim()
          ? [
              {
                id: `chunk-${source.id}-0`,
                sourceId: source.id,
                chunkIndex: 0,
                chunkText: source.rawContent.slice(0, 2000),
                metadata: { title: source.title }
              }
            ]
          : []

    // Store only a compact preview in knowledge_sources (avoid duplicating the entire book text alongside chunks)
    const compactPreview = (source.rawContent || effectiveChunks[0]?.chunkText || '').slice(0, 3000)
    const compactSummary =
      source.summary ||
      compactPreview.replace(/\s+/g, ' ').trim().slice(0, 240) ||
      null

    this.runTransaction(() => {
      insertSource.run(
        source.id,
        source.boardId ?? null,
        source.title,
        source.sourceType,
        source.sourceUrl ?? null,
        compactPreview,
        compactSummary,
        source.tokenCount ?? 0,
        source.createdAt
      )

      if (deleteVecById) {
        const oldChunks = selectOldChunkIds.all(source.id) as { id: string }[]
        for (const row of oldChunks) {
          try {
            deleteVecById.run(row.id)
          } catch {
            /* ignore */
          }
        }
      }
      deleteOldChunks.run(source.id)
      try {
        deleteOldFts.run(source.id)
      } catch {
        /* ignore */
      }

      for (const ch of effectiveChunks) {
        const floatVec = generateLocalEmbedding(ch.chunkText)
        const vecBytes = toVecBytes(floatVec)

        insertChunk.run(
          ch.id,
          source.id,
          ch.chunkIndex,
          ch.chunkText,
          JSON.stringify(ch.metadata || {}),
          vecBytes
        )

        try {
          insertFts.run(ch.id, source.id, ch.chunkText)
        } catch {
          /* ignore */
        }

        if (insertVec) {
          try {
            insertVec.run(ch.id, vecBytes)
          } catch {
            /* ignore vec insert errors */
          }
        }
      }
    })
  }

  public getKnowledgeSources(
    boardId?: string,
    projectId?: string,
    opts?: { includeRawContent?: boolean }
  ): KnowledgeSource[] {
    if (!this.ensureInit() || !this.db) return []
    const includeRaw = Boolean(opts?.includeRawContent)
    const cols = includeRaw
      ? 'id, board_id, title, source_type, source_url, raw_content, summary, token_count, created_at'
      : 'id, board_id, title, source_type, source_url, summary, token_count, created_at'
    let rows: any[] = []
    if (projectId) {
      rows = this.db
        .prepare(
          `SELECT ${cols} FROM knowledge_sources
           WHERE board_id IN (SELECT id FROM sections WHERE project_id = ?)
              OR board_id = ?
              OR board_id IS NULL
           ORDER BY created_at DESC`
        )
        .all(projectId, boardId || '') as any[]
    } else if (boardId) {
      rows = this.db
        .prepare(`SELECT ${cols} FROM knowledge_sources WHERE board_id = ? OR board_id IS NULL ORDER BY created_at DESC`)
        .all(boardId) as any[]
    } else {
      rows = this.db.prepare(`SELECT ${cols} FROM knowledge_sources ORDER BY created_at DESC`).all() as any[]
    }
    return rows.map((r) => ({
      id: r.id,
      boardId: r.board_id,
      title: r.title,
      sourceType: r.source_type,
      sourceUrl: r.source_url,
      rawContent: includeRaw ? r.raw_content || '' : '',
      summary: r.summary,
      tokenCount: r.token_count,
      createdAt: r.created_at
    }))
  }

  public getKnowledgeSourcesByIds(sourceIds: string[]): KnowledgeSource[] {
    if (!this.ensureInit() || !this.db || !sourceIds || sourceIds.length === 0) return []
    const placeholders = sourceIds.map(() => '?').join(',')
    const rows = this.db
      .prepare(`SELECT * FROM knowledge_sources WHERE id IN (${placeholders}) ORDER BY created_at DESC`)
      .all(...sourceIds) as any[]
    return rows.map((r) => ({
      id: r.id,
      boardId: r.board_id,
      title: r.title,
      sourceType: r.source_type,
      sourceUrl: r.source_url,
      rawContent: r.raw_content,
      summary: r.summary,
      tokenCount: r.token_count,
      createdAt: r.created_at
    }))
  }

  public deleteKnowledgeSource(sourceId: string): { deletedChunks: number } {
    if (!this.ensureInit() || !this.db) return { deletedChunks: 0 }
    let deletedChunks = 0
    this.runTransaction(() => {
      deletedChunks = this.purgeSourcesInTx([sourceId])
    })
    this.reclaimDiskSpace()
    return { deletedChunks }
  }

  // --- Hybrid & Vector Retrieval ---

  public hybridSearch(query: string, opts: { sourceIds?: string[]; limit?: number } = {}): SearchResult[] {
    if (!this.ensureInit() || !this.db || !query.trim()) return []

    const limit = opts.limit || 6
    const queryVec = generateLocalEmbedding(query)
    const queryVecBytes = toVecBytes(queryVec)
    const sourceIds = opts.sourceIds && opts.sourceIds.length > 0 ? opts.sourceIds : null

    // 1. Vector Search (via sqlite-vec or in-memory cosine fallback)
    const vectorScores = new Map<string, number>()

    if (this.vectorExtensionLoaded && !sourceIds) {
      try {
        const vecRows = this.db
          .prepare(`SELECT chunk_id, distance FROM vec_chunks WHERE embedding MATCH ? ORDER BY distance LIMIT 30`)
          .all(queryVecBytes) as { chunk_id: string; distance: number }[]

        for (const r of vecRows) {
          vectorScores.set(r.chunk_id, 1 / (1 + Math.max(0, r.distance)))
        }
      } catch {
        /* fallback to BLOB scan */
      }
    }

    // Fallback BLOB vector search if vec0 was not used or returned empty
    if (vectorScores.size === 0) {
      const chunkSql = sourceIds
        ? `SELECT id, embedding FROM knowledge_chunks WHERE source_id IN (${sourceIds.map(() => '?').join(',')})`
        : `SELECT id, embedding FROM knowledge_chunks`
      const rows = this.db.prepare(chunkSql).all(...(sourceIds || [])) as { id: string; embedding: Uint8Array }[]

      for (const r of rows) {
        if (!r.embedding || r.embedding.byteLength < 4) continue
        const floatArray = new Float32Array(
          r.embedding.buffer,
          r.embedding.byteOffset,
          r.embedding.byteLength / 4
        )
        const sim = cosineSimilarity(queryVec, floatArray)
        vectorScores.set(r.id, sim)
      }
    }

    // 2. Keyword Search (FTS5)
    const keywordScores = new Map<string, number>()
    try {
      const sanitized = query.replace(/[^\w\s]/g, ' ').trim()
      if (sanitized) {
        const ftsQuery = sanitized.split(/\s+/).filter(Boolean).join(' OR ')
        if (ftsQuery) {
          const ftsSql = sourceIds
            ? `SELECT chunk_id, rank FROM chunks_fts WHERE chunk_text MATCH ? AND source_id IN (${sourceIds.map(() => '?').join(',')}) LIMIT 30`
            : `SELECT chunk_id, rank FROM chunks_fts WHERE chunk_text MATCH ? LIMIT 30`
          const ftsRows = this.db.prepare(ftsSql).all(ftsQuery, ...(sourceIds || [])) as { chunk_id: string; rank: number }[]

          for (const r of ftsRows) {
            keywordScores.set(r.chunk_id, 1 / (1 + Math.abs(r.rank)))
          }
        }
      }
    } catch {
      /* ignore FTS query errors */
    }

    // 3. Reciprocal Rank Fusion (RRF)
    const combinedScores = new Map<string, number>()
    const allChunkIds = new Set([...vectorScores.keys(), ...keywordScores.keys()])

    for (const id of allChunkIds) {
      const vScore = vectorScores.get(id) || 0
      const kScore = keywordScores.get(id) || 0
      combinedScores.set(id, vScore * 0.6 + kScore * 0.4)
    }

    const sortedIds = Array.from(combinedScores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id]) => id)

    if (sortedIds.length === 0) return []

    // 4. Hydrate chunk records
    const hydrateSql = `
      SELECT c.id, c.source_id, c.chunk_text, c.metadata_json, s.title as source_title, s.source_type
      FROM knowledge_chunks c
      JOIN knowledge_sources s ON c.source_id = s.id
      WHERE c.id IN (${sortedIds.map(() => '?').join(',')})
    `
    const chunkRows = this.db.prepare(hydrateSql).all(...sortedIds) as any[]
    const chunkMap = new Map(chunkRows.map((r) => [r.id, r]))

    const results: SearchResult[] = []
    for (const id of sortedIds) {
      const item = chunkMap.get(id)
      if (item) {
        results.push({
          chunkId: item.id,
          sourceId: item.source_id,
          sourceTitle: item.source_title,
          sourceType: item.source_type,
          chunkText: item.chunk_text,
          metadata: item.metadata_json ? JSON.parse(item.metadata_json) : undefined,
          score: combinedScores.get(id) || 0
        })
      }
    }

    return results
  }

  // --- Board History & Recall ---

  public recordHistoryEvent(event: HistoryEvent): void {
    if (!this.ensureInit() || !this.db) return
    this.db
      .prepare(`
        INSERT INTO board_history_events (board_id, event_type, element_id, description, timestamp)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(event.boardId, event.eventType, event.elementId, event.description || null, event.timestamp)
  }

  public getHistoryEvents(boardId: string, limit = 50): HistoryEvent[] {
    if (!this.ensureInit() || !this.db) return []
    const rows = this.db
      .prepare(`
        SELECT id, board_id, event_type, element_id, description, timestamp
        FROM board_history_events
        WHERE board_id = ?
        ORDER BY timestamp ASC
        LIMIT ?
      `)
      .all(boardId, limit) as any[]
    return rows.map((r) => ({
      id: r.id,
      boardId: r.board_id,
      eventType: r.event_type,
      elementId: r.element_id,
      description: r.description,
      timestamp: r.timestamp
    }))
  }

  // --- Projects, Sections & Overall History ---

  private ensureLegacyDefaultProject(): void {
    if (!this.db) return
    const projCountRow = this.db.prepare('SELECT COUNT(*) as cnt FROM projects').get() as { cnt: number } | undefined
    if ((projCountRow?.cnt || 0) > 0) return

    const hasLegacyElements = this.db
      .prepare('SELECT COUNT(*) as cnt FROM board_elements WHERE board_id = ?')
      .get('default-board') as { cnt: number } | undefined
    const hasLegacyHistory = this.db
      .prepare('SELECT COUNT(*) as cnt FROM board_history_events WHERE board_id = ?')
      .get('default-board') as { cnt: number } | undefined
    const hasLegacySources = this.db
      .prepare('SELECT COUNT(*) as cnt FROM knowledge_sources')
      .get() as { cnt: number } | undefined

    if (
      (hasLegacyElements?.cnt || 0) > 0 ||
      (hasLegacyHistory?.cnt || 0) > 0 ||
      (hasLegacySources?.cnt || 0) > 0
    ) {
      const now = Date.now()
      const defaultProjId = 'proj-general'
      this.runTransaction(() => {
        this.db!
          .prepare(
            `INSERT OR IGNORE INTO projects (id, title, description, color, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run(
            defaultProjId,
            'General Workspace',
            'Your previously created notes, diagrams & study materials',
            '#00F5D4',
            now,
            now
          )
        this.db!
          .prepare(
            `INSERT OR IGNORE INTO sections (id, project_id, title, description, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run('default-board', defaultProjId, 'Main Study Board', 'Recovered workspace board', now, now)
        this.db!
          .prepare(
            `INSERT OR IGNORE INTO boards (id, title, created_at, updated_at)
             VALUES (?, ?, ?, ?)`
          )
          .run('default-board', 'Main Study Board', now, now)
      })
    }
  }

  public listProjects(): ProjectItem[] {
    if (!this.ensureInit() || !this.db) return []
    this.ensureLegacyDefaultProject()
    const rows = this.db
      .prepare(`
        SELECT
          p.id,
          p.title,
          p.description,
          p.color,
          p.created_at,
          p.updated_at,
          (SELECT COUNT(*) FROM sections s WHERE s.project_id = p.id) as section_count,
          (SELECT COUNT(*) FROM board_elements be JOIN sections s ON be.board_id = s.id WHERE s.project_id = p.id) as element_count
        FROM projects p
        ORDER BY p.updated_at DESC, p.created_at DESC
      `)
      .all() as any[]

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description || undefined,
      color: r.color || '#00F5D4',
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      sectionCount: r.section_count || 0,
      elementCount: r.element_count || 0
    }))
  }

  public createProject(input: {
    id: string
    title: string
    description?: string
    color?: string
  }): ProjectItem {
    const now = Date.now()
    const item: ProjectItem = {
      id: input.id,
      title: input.title.trim() || 'Untitled Project',
      description: input.description?.trim() || undefined,
      color: input.color || '#00F5D4',
      createdAt: now,
      updatedAt: now,
      sectionCount: 0,
      elementCount: 0
    }
    if (!this.ensureInit() || !this.db) return item

    this.db
      .prepare(`
        INSERT INTO projects (id, title, description, color, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          description = excluded.description,
          color = excluded.color,
          updated_at = excluded.updated_at
      `)
      .run(item.id, item.title, item.description ?? null, item.color ?? '#00F5D4', item.createdAt, item.updatedAt)

    return item
  }

  public updateProject(
    projectId: string,
    patch: { title?: string; description?: string; color?: string }
  ): ProjectItem | null {
    if (!this.ensureInit() || !this.db) return null
    const existing = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as any
    if (!existing) return null

    const now = Date.now()
    const nextTitle = patch.title !== undefined ? patch.title.trim() || existing.title : existing.title
    const nextDesc = patch.description !== undefined ? patch.description.trim() || null : existing.description
    const nextColor = patch.color !== undefined ? patch.color : existing.color

    this.db
      .prepare('UPDATE projects SET title = ?, description = ?, color = ?, updated_at = ? WHERE id = ?')
      .run(nextTitle, nextDesc, nextColor, now, projectId)

    const updated = this.listProjects().find((p) => p.id === projectId)
    return updated || null
  }

  public deleteProject(projectId: string): void {
    if (!this.ensureInit() || !this.db) return
    const secRows = this.db.prepare('SELECT id FROM sections WHERE project_id = ?').all(projectId) as { id: string }[]
    const secIds = secRows.map((s) => s.id)
    let hadPurgedSources = false

    this.runTransaction(() => {
      for (const sid of secIds) {
        const srcRows = this.db!
          .prepare('SELECT id FROM knowledge_sources WHERE board_id = ?')
          .all(sid) as { id: string }[]
        if (srcRows.length > 0) {
          this.purgeSourcesInTx(srcRows.map((r) => r.id))
          hadPurgedSources = true
        }
        this.db!.prepare('DELETE FROM board_elements WHERE board_id = ?').run(sid)
        try {
          this.db!.prepare('DELETE FROM elements_fts WHERE board_id = ?').run(sid)
        } catch {
          /* ignore */
        }
        this.db!.prepare('DELETE FROM board_history_events WHERE board_id = ?').run(sid)
        this.db!.prepare('DELETE FROM boards WHERE id = ?').run(sid)
      }
      this.db!.prepare('DELETE FROM project_chats WHERE project_id = ?').run(projectId)
      this.db!.prepare('DELETE FROM sections WHERE project_id = ?').run(projectId)
      this.db!.prepare('DELETE FROM projects WHERE id = ?').run(projectId)
    })

    if (hadPurgedSources) {
      this.reclaimDiskSpace()
    }
  }

  public listSections(projectId?: string): SectionItem[] {
    if (!this.ensureInit() || !this.db) return []
    this.ensureLegacyDefaultProject()

    const rows = (
      projectId
        ? this.db
            .prepare('SELECT * FROM sections WHERE project_id = ? ORDER BY updated_at DESC, created_at DESC')
            .all(projectId)
        : this.db.prepare('SELECT * FROM sections ORDER BY updated_at DESC, created_at DESC').all()
    ) as any[]

    const kindStmt = this.db.prepare(`
      SELECT kind, COUNT(*) as cnt
      FROM board_elements
      WHERE board_id = ?
      GROUP BY kind
    `)
    const previewStmt = this.db.prepare(`
      SELECT content_text
      FROM board_elements
      WHERE board_id = ? AND kind IN ('text', 'diagram', 'code', 'equation', 'video') AND length(trim(coalesce(content_text, ''))) > 0
      ORDER BY updated_at DESC
      LIMIT 1
    `)

    return rows.map((r) => {
      const kindRows = kindStmt.all(r.id) as { kind: string; cnt: number }[]
      const breakdown: SectionElementBreakdown = {
        notes: 0,
        diagrams: 0,
        equations: 0,
        code: 0,
        videos: 0,
        shapes: 0,
        strokes: 0,
        images: 0
      }
      let total = 0
      for (const kr of kindRows) {
        const cnt = kr.cnt || 0
        total += cnt
        if (kr.kind === 'text') breakdown.notes += cnt
        else if (kr.kind === 'diagram') breakdown.diagrams += cnt
        else if (kr.kind === 'equation') breakdown.equations += cnt
        else if (kr.kind === 'code') breakdown.code += cnt
        else if (kr.kind === 'video') breakdown.videos += cnt
        else if (kr.kind === 'shape') breakdown.shapes += cnt
        else if (kr.kind === 'stroke') breakdown.strokes += cnt
        else if (kr.kind === 'image') breakdown.images = (breakdown.images ?? 0) + cnt
      }
      const prevRow = previewStmt.get(r.id) as { content_text?: string } | undefined
      const previewText = prevRow?.content_text
        ? prevRow.content_text.replace(/\s+/g, ' ').trim().slice(0, 120)
        : undefined

      return {
        id: r.id,
        projectId: r.project_id,
        title: r.title,
        description: r.description || undefined,
        color: r.color || undefined,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        elementCount: total,
        breakdown,
        previewText
      }
    })
  }

  public createSection(input: {
    id: string
    projectId: string
    title: string
    description?: string
    color?: string
  }): SectionItem {
    const now = Date.now()
    const item: SectionItem = {
      id: input.id,
      projectId: input.projectId,
      title: input.title.trim() || 'Untitled Section',
      description: input.description?.trim() || undefined,
      color: input.color || undefined,
      createdAt: now,
      updatedAt: now,
      elementCount: 0,
      breakdown: { notes: 0, diagrams: 0, equations: 0, code: 0, videos: 0, shapes: 0, strokes: 0, images: 0 }
    }
    if (!this.ensureInit() || !this.db) return item

    this.runTransaction(() => {
      this.db!
        .prepare(`
          INSERT INTO sections (id, project_id, title, description, color, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            description = excluded.description,
            color = COALESCE(excluded.color, sections.color),
            updated_at = excluded.updated_at
        `)
        .run(
          item.id,
          item.projectId,
          item.title,
          item.description ?? null,
          item.color ?? null,
          item.createdAt,
          item.updatedAt
        )

      this.db!
        .prepare(`
          INSERT INTO boards (id, title, created_at, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at
        `)
        .run(item.id, item.title, now, now)

      this.db!.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now, item.projectId)
    })

    return item
  }

  public updateSection(
    sectionId: string,
    patch: { title?: string; description?: string; color?: string }
  ): SectionItem | null {
    if (!this.ensureInit() || !this.db) return null
    const existing = this.db.prepare('SELECT * FROM sections WHERE id = ?').get(sectionId) as any
    if (!existing) return null

    const now = Date.now()
    const nextTitle = patch.title !== undefined ? patch.title.trim() || existing.title : existing.title
    const nextDesc = patch.description !== undefined ? patch.description.trim() || null : existing.description
    const nextColor = patch.color !== undefined ? patch.color || null : existing.color

    this.runTransaction(() => {
      this.db!
        .prepare('UPDATE sections SET title = ?, description = ?, color = ?, updated_at = ? WHERE id = ?')
        .run(nextTitle, nextDesc, nextColor, now, sectionId)
      this.db!.prepare('UPDATE boards SET title = ?, updated_at = ? WHERE id = ?').run(nextTitle, now, sectionId)
      this.db!.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now, existing.project_id)
    })

    return this.listSections(existing.project_id).find((s) => s.id === sectionId) || null
  }

  public deleteSection(sectionId: string): void {
    if (!this.ensureInit() || !this.db) return
    let hadPurgedSources = false
    this.runTransaction(() => {
      const srcRows = this.db!
        .prepare('SELECT id FROM knowledge_sources WHERE board_id = ?')
        .all(sectionId) as { id: string }[]
      if (srcRows.length > 0) {
        this.purgeSourcesInTx(srcRows.map((r) => r.id))
        hadPurgedSources = true
      }
      this.db!.prepare('DELETE FROM board_elements WHERE board_id = ?').run(sectionId)
      try {
        this.db!.prepare('DELETE FROM elements_fts WHERE board_id = ?').run(sectionId)
      } catch {
        /* ignore */
      }
      this.db!.prepare('DELETE FROM board_history_events WHERE board_id = ?').run(sectionId)
      this.db!.prepare('DELETE FROM boards WHERE id = ?').run(sectionId)
      this.db!.prepare('DELETE FROM sections WHERE id = ?').run(sectionId)
    })

    if (hadPurgedSources) {
      this.reclaimDiskSpace()
    }
  }

  public getOverallHistory(limit = 120): OverallHistorySummary {
    const empty: OverallHistorySummary = {
      totalProjects: 0,
      totalSections: 0,
      totalElements: 0,
      totalNotes: 0,
      totalDiagrams: 0,
      totalEquations: 0,
      totalCode: 0,
      totalVideos: 0,
      totalSources: 0,
      entries: []
    }
    if (!this.ensureInit() || !this.db) return empty
    this.ensureLegacyDefaultProject()

    const totalProjects =
      ((this.db.prepare('SELECT COUNT(*) as cnt FROM projects').get() as { cnt: number } | undefined)?.cnt) || 0
    const totalSections =
      ((this.db.prepare('SELECT COUNT(*) as cnt FROM sections').get() as { cnt: number } | undefined)?.cnt) || 0
    const totalSources =
      ((this.db.prepare('SELECT COUNT(*) as cnt FROM knowledge_sources').get() as { cnt: number } | undefined)?.cnt) ||
      0

    const kindCounts = this.db
      .prepare('SELECT kind, COUNT(*) as cnt FROM board_elements GROUP BY kind')
      .all() as { kind: string; cnt: number }[]

    let totalElements = 0
    let totalNotes = 0
    let totalDiagrams = 0
    let totalEquations = 0
    let totalCode = 0
    let totalVideos = 0

    for (const row of kindCounts) {
      totalElements += row.cnt || 0
      if (row.kind === 'text') totalNotes += row.cnt || 0
      else if (row.kind === 'diagram') totalDiagrams += row.cnt || 0
      else if (row.kind === 'equation') totalEquations += row.cnt || 0
      else if (row.kind === 'code') totalCode += row.cnt || 0
      else if (row.kind === 'video') totalVideos += row.cnt || 0
    }

    const elementRows = this.db
      .prepare(`
        SELECT
          be.id,
          be.board_id,
          be.kind,
          be.content_text,
          be.raw_json,
          be.created_at,
          be.updated_at,
          s.title as section_title,
          s.project_id as project_id,
          p.title as project_title,
          p.color as project_color
        FROM board_elements be
        LEFT JOIN sections s ON be.board_id = s.id
        LEFT JOIN projects p ON s.project_id = p.id
        WHERE be.kind IN ('text', 'diagram', 'equation', 'code', 'video', 'shape')
        ORDER BY be.updated_at DESC
        LIMIT ?
      `)
      .all(limit) as any[]

    const entries: OverallHistoryEntry[] = []

    for (const r of elementRows) {
      let parsed: any = null
      try {
        parsed = r.raw_json ? JSON.parse(r.raw_json) : null
      } catch {
        parsed = null
      }
      // Skip unlabeled simple shapes to keep history meaningful
      if (r.kind === 'shape' && !String(r.content_text || parsed?.label || '').trim()) {
        continue
      }

      let title = 'Created Item'
      let snippet = (r.content_text || '').replace(/\s+/g, ' ').trim()

      if (r.kind === 'text') {
        const rawTitle = parsed?.title?.trim()
        const firstLine = (parsed?.text || snippet || '').split('\n').find((l: string) => l.trim()) || 'Note'
        title = rawTitle || firstLine.replace(/^#+\s*/, '').slice(0, 72) || 'Text Note'
        snippet = (parsed?.text || snippet).replace(/\s+/g, ' ').trim().slice(0, 140)
      } else if (r.kind === 'diagram') {
        const nodeCount = Array.isArray(parsed?.nodes) ? parsed.nodes.length : 0
        title = parsed?.title || snippet || 'Interactive Diagram'
        snippet = nodeCount > 0 ? `${nodeCount} nodes in diagram` : 'Flow diagram'
      } else if (r.kind === 'equation') {
        title = 'Math Equation'
        snippet = parsed?.latex || snippet
      } else if (r.kind === 'code') {
        const tabNames = Array.isArray(parsed?.tabs) ? parsed.tabs.map((t: any) => t.title).join(', ') : ''
        title = parsed?.title || 'Code Studio'
        snippet = tabNames ? `Tabs: ${tabNames}` : snippet.slice(0, 120)
      } else if (r.kind === 'video') {
        title = parsed?.title || 'YouTube Study Hub'
        snippet = parsed?.url || snippet
      } else if (r.kind === 'shape') {
        title = parsed?.label || 'Diagram Shape'
        snippet = parsed?.shape || ''
      }

      entries.push({
        id: `el-${r.id}`,
        entryType: 'element',
        kind: r.kind,
        title,
        snippet: snippet.slice(0, 140) || undefined,
        boardId: r.board_id,
        sectionTitle: r.section_title || (r.board_id === 'default-board' ? 'Main Study Board' : 'Section'),
        projectId: r.project_id || undefined,
        projectTitle: r.project_title || (r.board_id === 'default-board' ? 'General Workspace' : undefined),
        projectColor: r.project_color || '#00F5D4',
        timestamp: r.updated_at || r.created_at
      })
    }

    const sourceRows = this.db
      .prepare(`
        SELECT
          ks.id,
          ks.board_id,
          ks.title,
          ks.source_type,
          ks.summary,
          ks.raw_content,
          ks.created_at,
          s.title as section_title,
          s.project_id as project_id,
          p.title as project_title,
          p.color as project_color
        FROM knowledge_sources ks
        LEFT JOIN sections s ON ks.board_id = s.id
        LEFT JOIN projects p ON s.project_id = p.id
        ORDER BY ks.created_at DESC
        LIMIT ?
      `)
      .all(Math.max(20, Math.floor(limit / 2))) as any[]

    for (const r of sourceRows) {
      entries.push({
        id: `src-${r.id}`,
        entryType: 'source',
        kind: r.source_type || 'file',
        title: r.title || 'Knowledge Source',
        snippet: (r.summary || r.raw_content || '').replace(/\s+/g, ' ').trim().slice(0, 140) || undefined,
        boardId: r.board_id || 'default-board',
        sectionTitle: r.section_title || (r.board_id ? 'Section' : 'Global Knowledge Base'),
        projectId: r.project_id || undefined,
        projectTitle: r.project_title || undefined,
        projectColor: r.project_color || '#38BDF8',
        timestamp: r.created_at
      })
    }

    const eventRows = this.db
      .prepare(`
        SELECT
          ev.id,
          ev.board_id,
          ev.event_type,
          ev.element_id,
          ev.description,
          ev.timestamp,
          s.title as section_title,
          s.project_id as project_id,
          p.title as project_title,
          p.color as project_color
        FROM board_history_events ev
        LEFT JOIN sections s ON ev.board_id = s.id
        LEFT JOIN projects p ON s.project_id = p.id
        ORDER BY ev.timestamp DESC
        LIMIT ?
      `)
      .all(Math.max(20, Math.floor(limit / 2))) as any[]

    for (const r of eventRows) {
      entries.push({
        id: `ev-${r.id}`,
        entryType: 'event',
        kind: r.event_type || 'create',
        title: r.description || `${r.event_type} ${r.element_id}`,
        boardId: r.board_id,
        sectionTitle: r.section_title || (r.board_id === 'default-board' ? 'Main Study Board' : 'Section'),
        projectId: r.project_id || undefined,
        projectTitle: r.project_title || undefined,
        projectColor: r.project_color || '#FF2A85',
        timestamp: r.timestamp
      })
    }

    entries.sort((a, b) => b.timestamp - a.timestamp)

    return {
      totalProjects,
      totalSections,
      totalElements,
      totalNotes,
      totalDiagrams,
      totalEquations,
      totalCode,
      totalVideos,
      totalSources,
      entries: entries.slice(0, limit)
    }
  }

  public getProjectChat(projectId: string): StoredChatMessage[] {
    const store = this.getProjectChatStore(projectId)
    const active = store.threads.find((t) => t.id === store.activeThreadId) || store.threads[0]
    return active?.messages ?? []
  }

  public saveProjectChat(projectId: string, messages: StoredChatMessage[]): void {
    const existing = this.getProjectChatStore(projectId)
    const now = Date.now()
    const nextThreads = existing.threads.map((t) =>
      t.id === existing.activeThreadId ? { ...t, messages: (messages || []).slice(-120), updatedAt: now } : t
    )
    this.saveProjectChatStore(projectId, {
      activeThreadId: existing.activeThreadId,
      threads: nextThreads
    })
  }

  public getProjectChatStore(projectId: string): ProjectChatStore {
    const now = Date.now()
    const makeDefault = (msgs: StoredChatMessage[] = []): ProjectChatStore => {
      const firstUser = msgs.find((m) => m.role === 'user')?.content?.trim()
      const title = firstUser ? firstUser.replace(/\s+/g, ' ').slice(0, 36) : 'Chat 1'
      const thread: ProjectChatThread = {
        id: 'thread-default',
        title,
        messages: msgs,
        createdAt: msgs[0]?.timestamp ?? now,
        updatedAt: msgs.length > 0 ? (msgs[msgs.length - 1]?.timestamp ?? now) : 0
      }
      return { activeThreadId: thread.id, threads: [thread] }
    }

    if (!this.ensureInit() || !this.db || !projectId) return makeDefault()
    const row = this.db
      .prepare('SELECT messages_json FROM project_chats WHERE project_id = ?')
      .get(projectId) as { messages_json?: string } | undefined
    if (!row?.messages_json) return makeDefault()
    try {
      const parsed = JSON.parse(row.messages_json)
      if (Array.isArray(parsed)) {
        return makeDefault(parsed as StoredChatMessage[])
      }
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.threads) && parsed.threads.length > 0) {
        const threads = parsed.threads as ProjectChatThread[]
        const activeId =
          typeof parsed.activeThreadId === 'string' && threads.some((t) => t.id === parsed.activeThreadId)
            ? parsed.activeThreadId
            : threads[0].id
        return { activeThreadId: activeId, threads }
      }
      return makeDefault()
    } catch {
      return makeDefault()
    }
  }

  public saveProjectChatStore(projectId: string, store: ProjectChatStore): void {
    if (!this.ensureInit() || !this.db || !projectId) return
    const now = Date.now()
    // Ensure parent project row exists so FOREIGN KEY(project_id) never rejects valid chats
    const projExists = this.db.prepare('SELECT 1 FROM projects WHERE id = ?').get(projectId)
    if (!projExists) {
      this.ensureLegacyDefaultProject()
      const stillMissing = !this.db.prepare('SELECT 1 FROM projects WHERE id = ?').get(projectId)
      if (stillMissing) {
        this.db
          .prepare(
            `INSERT OR IGNORE INTO projects (id, title, description, color, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run(
            projectId,
            projectId === 'proj-general' ? 'General Workspace' : 'Workspace Project',
            null,
            '#00F5D4',
            now,
            now
          )
      }
    }

    const sanitizedThreads = (store.threads || []).slice(0, 40).map((t) => ({
      ...t,
      messages: (t.messages || []).slice(-120)
    }))
    const payload = JSON.stringify({
      activeThreadId: store.activeThreadId,
      threads: sanitizedThreads
    })
    this.db
      .prepare(`
        INSERT INTO project_chats (project_id, messages_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(project_id) DO UPDATE SET
          messages_json = excluded.messages_json,
          updated_at = excluded.updated_at
      `)
      .run(projectId, payload, now)
  }

  public getProjectContextSummary(projectId: string, skipSectionId?: string): string {
    if (!this.ensureInit() || !this.db || !projectId) return ''
    try {
      const proj = this.db
        .prepare('SELECT id, title, description FROM projects WHERE id = ?')
        .get(projectId) as { id: string; title: string; description?: string } | undefined

      const sections = this.db
        .prepare('SELECT id, title, description, updated_at FROM sections WHERE project_id = ? ORDER BY updated_at DESC')
        .all(projectId) as Array<{ id: string; title: string; description?: string; updated_at: number }>

      const lines: string[] = []
      if (proj) {
        lines.push(`Project: ${proj.title}${proj.description ? ` — ${proj.description}` : ''}`)
      }
      if (sections.length > 0) {
        lines.push(
          `Sections (${sections.length}): ${sections
            .map((s) => `${s.title}${s.id === skipSectionId ? ' (currently open)' : ''}`)
            .join(', ')}`
        )
      }

      const sectionIds = sections.map((s) => s.id).filter((id) => id !== skipSectionId)
      if (sectionIds.length > 0) {
        const placeholders = sectionIds.map(() => '?').join(',')
        const rows = this.db
          .prepare(
            `SELECT be.board_id, be.kind, be.content_text, be.raw_json, s.title as section_title
             FROM board_elements be
             JOIN sections s ON be.board_id = s.id
             WHERE be.board_id IN (${placeholders})
               AND be.kind IN ('text', 'diagram', 'equation', 'code', 'video', 'shape')
             ORDER BY be.updated_at DESC
             LIMIT 36`
          )
          .all(...sectionIds) as Array<{
          board_id: string
          kind: string
          content_text?: string
          raw_json?: string
          section_title?: string
        }>

        const materialLines: string[] = []
        let charBudget = 3200
        for (const r of rows) {
          let parsed: any = null
          try {
            parsed = r.raw_json ? JSON.parse(r.raw_json) : null
          } catch {
            parsed = null
          }
          if (r.kind === 'shape' && !String(r.content_text || parsed?.label || '').trim()) {
            continue
          }
          let snippet = ''
          if (r.kind === 'text') {
            const t = parsed?.title ? `${parsed.title}: ` : ''
            snippet = `${t}${parsed?.text || r.content_text || ''}`
          } else if (r.kind === 'diagram') {
            const nodes = Array.isArray(parsed?.nodes)
              ? parsed.nodes.map((n: any) => n?.data?.label || n?.label).filter(Boolean).slice(0, 8).join(' -> ')
              : ''
            snippet = `Diagram "${parsed?.title || r.content_text || 'Untitled'}"${nodes ? ` (${nodes})` : ''}`
          } else if (r.kind === 'equation') {
            snippet = `Equation: ${parsed?.latex || r.content_text || ''}`
          } else if (r.kind === 'code') {
            const tabs = Array.isArray(parsed?.tabs)
              ? parsed.tabs.map((t: any) => `${t.title || t.language}: ${String(t.code || '').slice(0, 140)}`).join(' | ')
              : r.content_text || ''
            snippet = `Code [${parsed?.title || 'Snippet'}]: ${tabs}`
          } else if (r.kind === 'video') {
            snippet = `Video: ${parsed?.title || r.content_text || parsed?.url || ''}`
          } else {
            snippet = String(parsed?.label || r.content_text || '')
          }
          const clean = snippet.replace(/\s+/g, ' ').trim().slice(0, 260)
          if (!clean) continue
          const entry = `- [${r.section_title || 'Section'} · ${r.kind}] ${clean}`
          if (charBudget - entry.length < 0) break
          materialLines.push(entry)
          charBudget -= entry.length
        }

        if (materialLines.length > 0) {
          lines.push(
            skipSectionId ? 'Previous Materials from Other Sections in this Project:' : 'Materials Across Project Sections:',
            ...materialLines
          )
        }
      }

      const sources = this.getKnowledgeSources(skipSectionId, projectId)
      if (sources.length > 0) {
        lines.push(
          `Uploaded Knowledge Studio Books/Notes in Project (${sources.length}): ${sources
            .slice(0, 12)
            .map((s) => `"${s.title}" (${s.sourceType})`)
            .join(', ')}`
        )
      }

      return lines.join('\n')
    } catch {
      return ''
    }
  }

  public close(): void {
    if (!this.db) return
    try {
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE);')
    } catch {
      /* ignore checkpoint errors on close */
    }
    try {
      this.db.close?.()
    } catch {
      /* ignore close errors */
    }
    this.db = null
  }
}

export const dbManager = new DatabaseManager()
