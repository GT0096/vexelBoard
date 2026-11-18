import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AtSign, BookOpen, Check, FileText, Layers, Video, X } from 'lucide-react'
import type { KnowledgeSourceItem } from '@shared/ipc'

export interface ChatKnowledgeState {
  availableSources: KnowledgeSourceItem[]
  pinnedSources: KnowledgeSourceItem[]
  includeProjectContext: boolean
  setIncludeProjectContext: React.Dispatch<React.SetStateAction<boolean>>
  showSourcesMenu: boolean
  setShowSourcesMenu: React.Dispatch<React.SetStateAction<boolean>>
  atQuery: string | null
  atMatches: KnowledgeSourceItem[]
  refreshSources: () => Promise<void>
  togglePinnedSource: (src: KnowledgeSourceItem) => void
  removePinnedSource: (sourceId: string) => void
  detectAtMention: (value: string, cursorPos: number | null) => void
  applyAtMention: (
    src: KnowledgeSourceItem,
    currentInput: string,
    setInput: (val: string) => void
  ) => void
  closeAtMention: () => void
}

export function useChatKnowledgeSources(
  projectId?: string | null,
  sectionId?: string | null,
  isActive = true
): ChatKnowledgeState {
  const [availableSources, setAvailableSources] = useState<KnowledgeSourceItem[]>([])
  const [pinnedSources, setPinnedSources] = useState<KnowledgeSourceItem[]>([])
  const [includeProjectContext, setIncludeProjectContext] = useState(true)
  const [showSourcesMenu, setShowSourcesMenu] = useState(false)
  const [atQuery, setAtQuery] = useState<string | null>(null)
  const atRangeRef = useRef<{ start: number; end: number } | null>(null)

  const refreshSources = useCallback(async () => {
    if (!window.glassAPI?.getKnowledgeSources) return
    try {
      const list = await window.glassAPI.getKnowledgeSources(
        sectionId || undefined,
        projectId || undefined
      )
      setAvailableSources(list)
      setPinnedSources((prev) => prev.filter((p) => list.some((item) => item.id === p.id)))
    } catch {
      /* ignore */
    }
  }, [projectId, sectionId])

  useEffect(() => {
    if (isActive) {
      void refreshSources()
    }
  }, [isActive, refreshSources])

  useEffect(() => {
    setPinnedSources([])
    setAtQuery(null)
    atRangeRef.current = null
  }, [projectId])

  useEffect(() => {
    const onChanged = (): void => {
      void refreshSources()
    }
    window.addEventListener('vexelboard:sources-changed', onChanged)
    return () => window.removeEventListener('vexelboard:sources-changed', onChanged)
  }, [refreshSources])

  const togglePinnedSource = useCallback((src: KnowledgeSourceItem) => {
    setPinnedSources((prev) =>
      prev.some((p) => p.id === src.id) ? prev.filter((p) => p.id !== src.id) : [...prev, src]
    )
  }, [])

  const removePinnedSource = useCallback((sourceId: string) => {
    setPinnedSources((prev) => prev.filter((p) => p.id !== sourceId))
  }, [])

  const detectAtMention = useCallback((value: string, cursorPos: number | null) => {
    const pos = cursorPos ?? value.length
    const beforeCursor = value.slice(0, pos)
    const match = beforeCursor.match(/(?:^|\s)@([^\s@]*)$/)
    if (match) {
      const token = match[1] ?? ''
      const atIdx = beforeCursor.lastIndexOf('@')
      atRangeRef.current = { start: atIdx, end: pos }
      setAtQuery(token)
    } else {
      atRangeRef.current = null
      setAtQuery(null)
    }
  }, [])

  const applyAtMention = useCallback(
    (src: KnowledgeSourceItem, currentInput: string, setInput: (val: string) => void) => {
      setPinnedSources((prev) => (prev.some((p) => p.id === src.id) ? prev : [...prev, src]))
      const range = atRangeRef.current
      if (range) {
        const before = currentInput.slice(0, range.start)
        const after = currentInput.slice(range.end)
        const needsTrailingSpace = after.length === 0 || !after.startsWith(' ')
        const inserted = `"${src.title}"${needsTrailingSpace ? ' ' : ''}`
        setInput(`${before}${inserted}${after}`)
      }
      atRangeRef.current = null
      setAtQuery(null)
    },
    []
  )

  const closeAtMention = useCallback(() => {
    atRangeRef.current = null
    setAtQuery(null)
  }, [])

  const atMatches = useMemo(() => {
    if (atQuery === null) return []
    const q = atQuery.trim().toLowerCase()
    if (!q) return availableSources.slice(0, 8)
    return availableSources.filter((s) => s.title.toLowerCase().includes(q)).slice(0, 8)
  }, [atQuery, availableSources])

  return {
    availableSources,
    pinnedSources,
    includeProjectContext,
    setIncludeProjectContext,
    showSourcesMenu,
    setShowSourcesMenu,
    atQuery,
    atMatches,
    refreshSources,
    togglePinnedSource,
    removePinnedSource,
    detectAtMention,
    applyAtMention,
    closeAtMention
  }
}

function getSourceIcon(sourceType: KnowledgeSourceItem['sourceType']): React.ReactNode {
  if (sourceType === 'youtube') return <Video size={12} style={{ color: '#f87171', flexShrink: 0 }} />
  if (sourceType === 'board') return <Layers size={12} style={{ color: '#a78bfa', flexShrink: 0 }} />
  return <FileText size={12} style={{ color: '#f59e0b', flexShrink: 0 }} />
}

export const ChatPinnedSourcesBar: React.FC<{
  pinnedSources: KnowledgeSourceItem[]
  onRemove: (id: string) => void
}> = ({ pinnedSources, onRemove }) => {
  if (pinnedSources.length === 0) return null
  return (
    <div className="chat-attachment-pills">
      {pinnedSources.map((src) => (
        <div
          key={src.id}
          className="chat-attachment-chip chat-book-ref-chip"
          title={`Grounded in Knowledge Studio source: ${src.title}`}
        >
          <BookOpen size={12} style={{ color: '#f59e0b', flexShrink: 0 }} />
          <span className="chat-attachment-name">@{src.title}</span>
          {src.tokenCount ? <span className="chat-attachment-tokens">~{src.tokenCount}t</span> : null}
          <button
            type="button"
            className="chat-attachment-remove-btn"
            onClick={() => onRemove(src.id)}
            title={`Stop specifically referencing ${src.title}`}
            aria-label={`Remove ${src.title}`}
          >
            <X size={11} />
          </button>
        </div>
      ))}
    </div>
  )
}

export const ChatAtMentionPopover: React.FC<{
  atQuery: string | null
  matches: KnowledgeSourceItem[]
  pinnedSources: KnowledgeSourceItem[]
  onSelect: (src: KnowledgeSourceItem) => void
  onClose: () => void
  onOpenKnowledgeHub?: () => void
}> = ({ atQuery, matches, pinnedSources, onSelect, onClose, onOpenKnowledgeHub }) => {
  if (atQuery === null) return null
  return (
    <div className="chat-source-popover chat-at-popover glass">
      <div className="chat-source-popover-hdr">
        <span>
          <AtSign size={12} /> Reference Knowledge Book / Note
        </span>
        <button type="button" className="chat-source-popover-close" onClick={onClose} aria-label="Close">
          <X size={12} />
        </button>
      </div>
      <div className="chat-source-popover-list">
        {matches.length === 0 ? (
          <div className="chat-source-empty">
            <span>No matching uploaded books or notes found.</span>
            {onOpenKnowledgeHub && (
              <button
                type="button"
                className="chat-source-upload-link"
                onClick={() => {
                  onClose()
                  onOpenKnowledgeHub()
                }}
              >
                Upload in Knowledge Studio
              </button>
            )}
          </div>
        ) : (
          matches.map((src) => {
            const isPinned = pinnedSources.some((p) => p.id === src.id)
            return (
              <button
                key={src.id}
                type="button"
                className={`chat-source-option ${isPinned ? 'active' : ''}`}
                onClick={() => onSelect(src)}
              >
                {getSourceIcon(src.sourceType)}
                <span className="chat-source-option-title">{src.title}</span>
                {src.tokenCount ? (
                  <span className="chat-source-option-meta">~{src.tokenCount}t</span>
                ) : null}
                {isPinned && <Check size={12} className="chat-source-check" />}
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}

export const ChatSourceContextControls: React.FC<{
  state: ChatKnowledgeState
  hasProject: boolean
  onOpenKnowledgeHub?: () => void
}> = ({ state, hasProject, onOpenKnowledgeHub }) => {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!state.showSourcesMenu) return
    const handleOutside = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        state.setShowSourcesMenu(false)
      }
    }
    window.addEventListener('mousedown', handleOutside)
    return () => window.removeEventListener('mousedown', handleOutside)
  }, [state.showSourcesMenu, state.setShowSourcesMenu])

  return (
    <div className="chat-context-controls" ref={menuRef}>
      <div className="chat-books-picker-wrap">
        <button
          type="button"
          className={`chat-attach-btn books ${
            state.showSourcesMenu || state.pinnedSources.length > 0 ? 'active' : ''
          }`}
          onClick={() => {
            const nextOpen = !state.showSourcesMenu
            state.setShowSourcesMenu(nextOpen)
            if (nextOpen) void state.refreshSources()
          }}
          title="Select Knowledge Studio books or notes to specifically reference (or type @)"
          aria-label="Reference Knowledge Books"
        >
          <BookOpen size={13} />
          <span>
            {state.pinnedSources.length > 0
              ? `Books (${state.pinnedSources.length})`
              : state.availableSources.length > 0
                ? `Books (${state.availableSources.length})`
                : 'Books'}
          </span>
        </button>

        {state.showSourcesMenu && (
          <div className="chat-source-popover glass">
            <div className="chat-source-popover-hdr">
              <span>
                <BookOpen size={12} /> Reference Knowledge Books
              </span>
              <span className="chat-source-popover-sub">or type @</span>
            </div>
            <div className="chat-source-popover-list">
              {state.availableSources.length === 0 ? (
                <div className="chat-source-empty">
                  <span>No books or notes uploaded to Knowledge Studio yet.</span>
                  {onOpenKnowledgeHub && (
                    <button
                      type="button"
                      className="chat-source-upload-link"
                      onClick={() => {
                        state.setShowSourcesMenu(false)
                        onOpenKnowledgeHub()
                      }}
                    >
                      Upload in Knowledge Studio
                    </button>
                  )}
                </div>
              ) : (
                state.availableSources.map((src) => {
                  const isPinned = state.pinnedSources.some((p) => p.id === src.id)
                  return (
                    <button
                      key={src.id}
                      type="button"
                      className={`chat-source-option ${isPinned ? 'active' : ''}`}
                      onClick={() => state.togglePinnedSource(src)}
                    >
                      {getSourceIcon(src.sourceType)}
                      <span className="chat-source-option-title">{src.title}</span>
                      {src.tokenCount ? (
                        <span className="chat-source-option-meta">~{src.tokenCount}t</span>
                      ) : null}
                      {isPinned && <Check size={12} className="chat-source-check" />}
                    </button>
                  )
                })
              )}
            </div>
            {state.pinnedSources.length > 0 && (
              <div className="chat-source-popover-footer">
                <button
                  type="button"
                  className="chat-source-clear-btn"
                  onClick={() =>
                    state.pinnedSources.forEach((s) => state.removePinnedSource(s.id))
                  }
                >
                  Clear selected ({state.pinnedSources.length})
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {hasProject && (
        <button
          type="button"
          className={`chat-attach-btn project-ctx ${state.includeProjectContext ? 'active' : ''}`}
          onClick={() => state.setIncludeProjectContext((v) => !v)}
          title={
            state.includeProjectContext
              ? 'Project Context ON: AI can refer to previous sections, notes, diagrams & books in this project'
              : 'Project Context OFF: click to include all project sections & materials'
          }
          aria-label="Toggle Project Context"
        >
          <Layers size={13} />
          <span>Project</span>
        </button>
      )}
    </div>
  )
}
