import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpen,
  Bot,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Search,
  Sparkles,
  User,
  X
} from 'lucide-react'
import type { ProjectChatThread, SearchResultItem } from '@shared/ipc'
import {
  createChatSearchIndex,
  searchChatIndex,
  type ChatSearchScope,
  type UnifiedChatSearchHit
} from '../board/chatSearchEngine'

interface ChatSearchBarProps {
  isOpen: boolean
  onClose: () => void
  threads: ProjectChatThread[]
  activeThreadId: string
  onJumpToMessage: (threadId: string, messageId: string) => void
  onInsertKnowledgeSnippet?: (text: string, title?: string) => void
  onActiveMatchesChange?: (info: {
    activeMessageId: string | null
    matchedMessageIds: Set<string>
    highlightTerms: string[]
  }) => void
}

export const ChatSearchBar: React.FC<ChatSearchBarProps> = ({
  isOpen,
  onClose,
  threads,
  activeThreadId,
  onJumpToMessage,
  onInsertKnowledgeSnippet,
  onActiveMatchesChange
}) => {
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<ChatSearchScope>('all_chats')
  const [cursorIdx, setCursorIdx] = useState(0)
  const [knowledgeHits, setKnowledgeHits] = useState<SearchResultItem[]>([])
  const [resultsExpanded, setResultsExpanded] = useState(true)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      window.setTimeout(() => inputRef.current?.focus(), 20)
    } else {
      onActiveMatchesChange?.({
        activeMessageId: null,
        matchedMessageIds: new Set(),
        highlightTerms: []
      })
    }
  }, [isOpen, onActiveMatchesChange])

  // Rebuild MiniSearch BM25 + fuzzy index whenever threads or messages change
  const miniSearchIndex = useMemo(() => createChatSearchIndex(threads), [threads])

  // Query hybrid SQLite FTS5 + vector search when 'everything' scope is active
  useEffect(() => {
    if (!isOpen || scope !== 'everything' || query.trim().length < 2) {
      setKnowledgeHits([])
      return
    }
    let cancelled = false
    const timer = window.setTimeout(async () => {
      try {
        const res = await window.glassAPI?.hybridSearch?.(query.trim(), { limit: 6 })
        if (!cancelled) setKnowledgeHits(Array.isArray(res) ? res : [])
      } catch {
        if (!cancelled) setKnowledgeHits([])
      }
    }, 160)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [isOpen, scope, query])

  const searchOut = useMemo(
    () =>
      searchChatIndex(miniSearchIndex, query, {
        scope,
        activeThreadId,
        knowledgeHits
      }),
    [miniSearchIndex, query, scope, activeThreadId, knowledgeHits]
  )

  const navigableHits = useMemo(
    () => searchOut.hits.filter((h) => h.kind === 'message' && h.threadId && h.messageId),
    [searchOut.hits]
  )

  useEffect(() => {
    setCursorIdx(0)
  }, [query, scope])

  useEffect(() => {
    if (!isOpen) return
    const safeIdx = navigableHits.length > 0 ? Math.min(cursorIdx, navigableHits.length - 1) : -1
    const currentHit = safeIdx >= 0 ? navigableHits[safeIdx] : null
    const matchedIds = new Set(
      searchOut.activeThreadHits.map((h) => h.messageId!).filter(Boolean)
    )
    onActiveMatchesChange?.({
      activeMessageId:
        currentHit && currentHit.threadId === activeThreadId ? currentHit.messageId! : null,
      matchedMessageIds: matchedIds,
      highlightTerms: searchOut.highlightTerms
    })
  }, [
    isOpen,
    cursorIdx,
    navigableHits,
    searchOut.activeThreadHits,
    searchOut.highlightTerms,
    activeThreadId,
    onActiveMatchesChange
  ])

  if (!isOpen) return null

  const stepMatch = (delta: number): void => {
    if (navigableHits.length === 0) return
    const nextIdx = (cursorIdx + delta + navigableHits.length) % navigableHits.length
    setCursorIdx(nextIdx)
    const target = navigableHits[nextIdx]
    if (target?.threadId && target?.messageId) {
      onJumpToMessage(target.threadId, target.messageId)
    }
  }

  const handleSelectHit = (hit: UnifiedChatSearchHit, idx: number): void => {
    if (hit.kind === 'message' && hit.threadId && hit.messageId) {
      const navIdx = navigableHits.findIndex((n) => n.id === hit.id)
      if (navIdx >= 0) setCursorIdx(navIdx)
      else setCursorIdx(idx)
      onJumpToMessage(hit.threadId, hit.messageId)
    } else if (hit.kind === 'knowledge' && onInsertKnowledgeSnippet) {
      onInsertKnowledgeSnippet(hit.rawText, hit.sourceTitle || 'Knowledge Snippet')
    }
  }

  return (
    <div className="vx-chat-search-panel" onPointerDown={(e) => e.stopPropagation()}>
      <div className="vx-chat-search-input-row">
        <Search size={13} className="vx-chat-search-icon" />
        <input
          ref={inputRef}
          type="text"
          className="vx-chat-search-input"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setResultsExpanded(true)
          }}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Escape') {
              e.preventDefault()
              onClose()
            } else if (e.key === 'Enter') {
              e.preventDefault()
              stepMatch(e.shiftKey ? -1 : 1)
            }
          }}
          placeholder="Search messages, code, topics (typo-tolerant BM25)..."
        />
        {query && (
          <span className="vx-chat-search-count">
            {navigableHits.length > 0
              ? `${Math.min(cursorIdx + 1, navigableHits.length)}/${navigableHits.length}`
              : '0'}
          </span>
        )}
        {query && (
          <>
            <button
              type="button"
              className="vx-chat-search-nav-btn"
              disabled={navigableHits.length === 0}
              onClick={() => stepMatch(-1)}
              title="Previous match (Shift+Enter)"
            >
              <ChevronUp size={13} />
            </button>
            <button
              type="button"
              className="vx-chat-search-nav-btn"
              disabled={navigableHits.length === 0}
              onClick={() => stepMatch(1)}
              title="Next match (Enter)"
            >
              <ChevronDown size={13} />
            </button>
            <button
              type="button"
              className="vx-chat-search-nav-btn"
              onClick={() => setQuery('')}
              title="Clear query"
            >
              <X size={12} />
            </button>
          </>
        )}
        <button
          type="button"
          className="vx-chat-search-close-btn"
          onClick={onClose}
          title="Close search (Esc)"
        >
          Close
        </button>
      </div>

      {/* Scope Filter Bar + Instant Suggestions */}
      <div className="vx-chat-search-meta-row">
        <div className="vx-chat-search-scopes">
          <button
            type="button"
            className={`vx-search-scope-pill ${scope === 'current' ? 'active' : ''}`}
            onClick={() => setScope('current')}
          >
            This Chat
          </button>
          <button
            type="button"
            className={`vx-search-scope-pill ${scope === 'all_chats' ? 'active' : ''}`}
            onClick={() => setScope('all_chats')}
          >
            All Chats ({threads.length})
          </button>
          <button
            type="button"
            className={`vx-search-scope-pill ${scope === 'everything' ? 'active' : ''}`}
            onClick={() => setScope('everything')}
            title="Search all chats + indexed Knowledge Studio sources"
          >
            + Knowledge
          </button>
        </div>
        {searchOut.hits.length > 0 && (
          <button
            type="button"
            className="vx-search-toggle-list-btn"
            onClick={() => setResultsExpanded((v) => !v)}
          >
            {resultsExpanded ? 'Hide list' : `Show ${searchOut.hits.length} results`}
          </button>
        )}
      </div>

      {/* Instant Autocomplete Chips */}
      {query.trim().length >= 2 && searchOut.suggestions.length > 0 && (
        <div className="vx-chat-search-suggestions">
          <Sparkles size={10} className="vx-suggest-icon" />
          {searchOut.suggestions.map((sug) => (
            <button
              key={sug}
              type="button"
              className="vx-search-suggest-chip"
              onClick={() => setQuery(sug)}
            >
              {sug}
            </button>
          ))}
        </div>
      )}

      {/* Ranked Results List */}
      {query.trim().length > 0 && resultsExpanded && (
        <div className="vx-chat-search-results">
          {searchOut.hits.length === 0 ? (
            <div className="vx-chat-search-empty">
              No matches for &ldquo;{query}&rdquo; — try fewer words or switch to <strong>All Chats</strong>.
            </div>
          ) : (
            searchOut.hits.slice(0, 25).map((hit, idx) => {
              const isFocused =
                hit.kind === 'message' &&
                navigableHits[cursorIdx]?.id === hit.id
              return (
                <button
                  key={hit.id}
                  type="button"
                  className={`vx-chat-search-hit ${isFocused ? 'active' : ''} kind-${hit.kind}`}
                  onClick={() => handleSelectHit(hit, idx)}
                >
                  <div className="vx-search-hit-top">
                    <span className="vx-search-hit-badge">
                      {hit.kind === 'knowledge' ? (
                        <>
                          <BookOpen size={10} />
                          <span>{hit.sourceTitle || 'Source'}</span>
                        </>
                      ) : hit.role === 'user' ? (
                        <>
                          <User size={10} />
                          <span>You · {hit.threadTitle}</span>
                        </>
                      ) : (
                        <>
                          <Bot size={10} />
                          <span>AI · {hit.threadTitle}</span>
                        </>
                      )}
                    </span>
                    {hit.threadId && hit.threadId !== activeThreadId && (
                      <span className="vx-search-other-thread-tag">
                        <MessageSquare size={9} /> Switch chat
                      </span>
                    )}
                    {hit.timestamp ? (
                      <span className="vx-search-hit-time">
                        {new Date(hit.timestamp).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </span>
                    ) : null}
                  </div>
                  <div className="vx-search-hit-snippet">
                    {hit.snippetParts.map((part, pIdx) =>
                      part.highlight ? (
                        <mark key={pIdx} className="vx-search-mark">
                          {part.text}
                        </mark>
                      ) : (
                        <span key={pIdx}>{part.text}</span>
                      )
                    )}
                  </div>
                </button>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
