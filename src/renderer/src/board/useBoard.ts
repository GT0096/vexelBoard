import { useCallback, useEffect, useRef, useState } from 'react'
import { EMPTY_BOARD, type AppSettings, type BoardState } from '../types/board'
import { DEFAULT_PROVIDER_MODELS, resolveOpenAIModelProfile } from '@shared/ipc'
import {
  buildElementsForDb,
  isBoardEmpty,
  loadSectionBoardLocal,
  reconstructBoardFromDbElements,
  saveSectionBoardLocal
} from './workspaceStore'

const HISTORY_LIMIT = 60
const SETTINGS_KEY = 'vgb.settings'
const NEOBRUTAL_MIGRATED_KEY = 'vgb.neobrutal_theme_v1'

export interface BoardApi {
  board: BoardState
  boardRef: { current: BoardState }
  /** Apply an update. `history: false` merges into the current undo step. */
  update: (fn: (b: BoardState) => BoardState, opts?: { history?: boolean }) => void
  pushHistory: () => void
  undo: () => void
  canUndo: boolean
  redo: () => void
  canRedo: boolean
  clear: () => void
  flushSave: () => Promise<void>
}

export function useBoard(sectionId: string | null, sectionTitle = 'Untitled Section'): BoardApi {
  const [board, setBoard] = useState<BoardState>(() =>
    sectionId ? loadSectionBoardLocal(sectionId) : EMPTY_BOARD
  )
  const [prevSectionId, setPrevSectionId] = useState<string | null>(sectionId)
  const boardRef = useRef(board)
  const historyRef = useRef<BoardState[]>([])
  const redoRef = useRef<BoardState[]>([])
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const activeSectionIdRef = useRef<string | null>(sectionId)
  const activeSectionTitleRef = useRef<string>(sectionTitle)
  const dirtyRef = useRef(false)

  if (prevSectionId !== sectionId) {
    setPrevSectionId(sectionId)
    setCanUndo(false)
    setCanRedo(false)
    setBoard(sectionId ? loadSectionBoardLocal(sectionId) : EMPTY_BOARD)
  }

  useEffect(() => {
    activeSectionTitleRef.current = sectionTitle
  }, [sectionTitle])

  const persistSectionNow = useCallback(async (targetId: string, targetTitle: string, state: BoardState) => {
    saveSectionBoardLocal(targetId, state)
    if (window.glassAPI?.saveBoardStore) {
      try {
        await window.glassAPI.saveBoardStore(targetId, targetTitle, buildElementsForDb(state))
      } catch {
        /* ignore SQLite persistence errors */
      }
    }
  }, [])

  const flushSave = useCallback(async () => {
    const id = activeSectionIdRef.current
    if (!id) return
    dirtyRef.current = false
    await persistSectionNow(id, activeSectionTitleRef.current, boardRef.current)
  }, [persistSectionNow])

  // Switch active section cleanly: flush previous section, sync refs, and hydrate from SQLite if needed
  useEffect(() => {
    const prevId = activeSectionIdRef.current
    if (prevId && prevId !== sectionId && dirtyRef.current) {
      dirtyRef.current = false
      void persistSectionNow(prevId, activeSectionTitleRef.current, boardRef.current)
    }

    activeSectionIdRef.current = sectionId
    historyRef.current = []
    redoRef.current = []
    dirtyRef.current = false

    if (!sectionId) {
      boardRef.current = EMPTY_BOARD
      return
    }

    const localBoard = loadSectionBoardLocal(sectionId)
    boardRef.current = localBoard

    let cancelled = false
    if (isBoardEmpty(localBoard) && window.glassAPI?.getBoardStore) {
      window.glassAPI
        .getBoardStore(sectionId)
        .then((rows) => {
          if (cancelled || activeSectionIdRef.current !== sectionId) return
          if (Array.isArray(rows) && rows.length > 0) {
            const reconstructed = reconstructBoardFromDbElements(rows)
            if (!isBoardEmpty(reconstructed)) {
              boardRef.current = reconstructed
              setBoard(reconstructed)
              saveSectionBoardLocal(sectionId, reconstructed)
            }
          }
        })
        .catch(() => {})
    }

    return () => {
      cancelled = true
    }
  }, [sectionId, persistSectionNow])

  const pushHistory = useCallback(() => {
    const current = boardRef.current
    const stack = historyRef.current
    if (stack[stack.length - 1] === current) {
      if (redoRef.current.length > 0) {
        redoRef.current = []
        setCanRedo(false)
      }
      return
    }
    stack.push(current)
    if (stack.length > HISTORY_LIMIT) stack.shift()
    redoRef.current = []
    setCanUndo(true)
    setCanRedo(false)
  }, [])

  const update = useCallback(
    (fn: (b: BoardState) => BoardState, opts?: { history?: boolean }) => {
      if (!activeSectionIdRef.current) return
      if (opts?.history !== false) pushHistory()
      const next = fn(boardRef.current)
      boardRef.current = next
      dirtyRef.current = true
      setBoard(next)
    },
    [pushHistory]
  )

  const undo = useCallback(() => {
    let prev = historyRef.current.pop()
    while (prev && prev === boardRef.current) {
      prev = historyRef.current.pop()
    }
    if (!prev) {
      setCanUndo(historyRef.current.length > 0)
      return
    }
    redoRef.current.push(boardRef.current)
    if (redoRef.current.length > HISTORY_LIMIT) redoRef.current.shift()
    boardRef.current = prev
    dirtyRef.current = true
    setBoard(prev)
    setCanUndo(historyRef.current.length > 0)
    setCanRedo(true)
  }, [])

  const redo = useCallback(() => {
    let next = redoRef.current.pop()
    while (next && next === boardRef.current) {
      next = redoRef.current.pop()
    }
    if (!next) {
      setCanRedo(redoRef.current.length > 0)
      return
    }
    historyRef.current.push(boardRef.current)
    if (historyRef.current.length > HISTORY_LIMIT) historyRef.current.shift()
    boardRef.current = next
    dirtyRef.current = true
    setBoard(next)
    setCanUndo(true)
    setCanRedo(redoRef.current.length > 0)
  }, [])

  const clear = useCallback(() => {
    if (!activeSectionIdRef.current) return
    pushHistory()
    boardRef.current = EMPTY_BOARD
    dirtyRef.current = true
    setBoard(EMPTY_BOARD)
  }, [pushHistory])

  // Debounced persistence so the active section survives restarts and syncs to local SQLite
  useEffect(() => {
    if (!sectionId) return
    const targetId = sectionId
    const targetTitle = sectionTitle
    const t = window.setTimeout(() => {
      if (activeSectionIdRef.current !== targetId) return
      dirtyRef.current = false
      void persistSectionNow(targetId, targetTitle, board)
    }, 650)
    return () => window.clearTimeout(t)
  }, [board, sectionId, sectionTitle, persistSectionNow])

  return { board, boardRef, update, pushHistory, undo, canUndo, redo, canRedo, clear, flushSave }
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'neon',
  font: 'jakarta',
  mode: 'MODE_A',
  dominantHand: 'right',
  inkSize: 4,
  penType: 'fountain',
  backgroundColor: '#FFFDF7',
  backgroundPattern: 'dots',
  ai: {
    provider: 'ollama',
    ollamaHost: 'http://localhost:11434',
    ollamaModel: DEFAULT_PROVIDER_MODELS.ollama,
    byokModels: {
      openai: DEFAULT_PROVIDER_MODELS.openai,
      gemini: DEFAULT_PROVIDER_MODELS.gemini,
      grok: DEFAULT_PROVIDER_MODELS.grok,
      claude: DEFAULT_PROVIDER_MODELS.claude
    },
    temperature: 0.3,
    openaiModelProfile: resolveOpenAIModelProfile(DEFAULT_PROVIDER_MODELS.openai),
    configured: false
  }
}

export function useSettings(): [AppSettings, (patch: Partial<AppSettings>) => void] {
  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY)
      if (!raw) return DEFAULT_SETTINGS
      const p = JSON.parse(raw) as Partial<AppSettings>
      const mergedByok = { ...DEFAULT_SETTINGS.ai.byokModels, ...(p.ai?.byokModels ?? {}) }
      const ai = {
        ...DEFAULT_SETTINGS.ai,
        ...(p.ai ?? {}),
        byokModels: mergedByok,
        temperature:
          typeof p.ai?.temperature === 'number' && Number.isFinite(p.ai.temperature)
            ? p.ai.temperature
            : DEFAULT_SETTINGS.ai.temperature,
        openaiModelProfile:
          p.ai?.openaiModelProfile ?? resolveOpenAIModelProfile(mergedByok.openai || DEFAULT_PROVIDER_MODELS.openai)
      }
      if (ai.ollamaModel === 'gemma4:cloud') {
        ai.ollamaModel = DEFAULT_PROVIDER_MODELS.ollama
      }
      if (ai.byokModels?.claude === 'claude-sonnet-4-20250514') {
        ai.byokModels.claude = DEFAULT_PROVIDER_MODELS.claude
      }
      const mergedSettings: AppSettings = {
        ...DEFAULT_SETTINGS,
        ...p,
        ai
      }
      if (!localStorage.getItem(NEOBRUTAL_MIGRATED_KEY)) {
        localStorage.setItem(NEOBRUTAL_MIGRATED_KEY, '1')
        if (!p.backgroundColor || p.backgroundColor.toLowerCase() === '#0a0f1a') {
          mergedSettings.backgroundColor = DEFAULT_SETTINGS.backgroundColor
          try {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(mergedSettings))
          } catch {
            /* ignore */
          }
        }
      }
      return mergedSettings
    } catch {
      return DEFAULT_SETTINGS
    }
  })

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch, ai: { ...prev.ai, ...(patch.ai ?? {}) } }
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  useEffect(() => {
    const handleStorage = (e: StorageEvent): void => {
      if (e.key === SETTINGS_KEY && e.newValue) {
        try {
          const p = JSON.parse(e.newValue) as Partial<AppSettings>
          setSettings((prev) => ({
            ...prev,
            ...p,
            ai: { ...prev.ai, ...(p.ai ?? {}) }
          }))
        } catch {
          // ignore parsing error
        }
      }
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  return [settings, updateSettings]
}
