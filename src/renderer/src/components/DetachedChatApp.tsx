import React, { useState, useRef, useEffect } from 'react'
import {
  Bot,
  Send,
  Copy,
  PlusSquare,
  Network,
  Trash2,
  Sparkles,
  Check,
  Minus,
  Square,
  X,
  Settings2,
  Paperclip,
  Video,
  Image as ImageIcon,
  BookOpen,
  Layout,
  MessageSquare,
  ChevronDown,
  Plus,
  Pencil
} from 'lucide-react'
import type { ChatMessage, AISettings } from '../types/board'
import { Markdown } from './Markdown'
import { ChatAiSettings } from './ChatAiSettings'
import {
  ChatAtMentionPopover,
  ChatPinnedSourcesBar,
  ChatSourceContextControls,
  useChatKnowledgeSources
} from './ChatKnowledgePicker'
import { useSettings } from '../board/useBoard'
import {
  ACTIVE_CHAT_PROJECT_KEY,
  createChatThread,
  deriveThreadTitle,
  estimateThreadTokens,
  fetchProjectChatStore,
  getActiveChatProjectId,
  getProjectChatStorageKey,
  loadProjectChatStoreLocal,
  persistProjectChatStore
} from '../board/workspaceStore'
import {
  DEFAULT_PROVIDER_MODELS,
  type AIRequest,
  type ChatAttachment,
  type ProjectChatStore
} from '../../../shared/ipc'

export const DetachedChatApp: React.FC = () => {
  const [settings, patchSettings] = useSettings()
  const [showAiSettings, setShowAiSettings] = useState(false)
  const [activeProjectId, setActiveProjectId] = useState<string>(
    () => getActiveChatProjectId() || 'proj-general'
  )
  const [chatStore, setChatStore] = useState<ProjectChatStore>(() =>
    loadProjectChatStoreLocal(getActiveChatProjectId() || 'proj-general')
  )
  const chatStoreRef = useRef(chatStore)
  chatStoreRef.current = chatStore
  const hydratedProjectRef = useRef<string | null>(null)
  const activeThread =
    chatStore.threads.find((t) => t.id === chatStore.activeThreadId) || chatStore.threads[0]
  const messages = activeThread?.messages ?? []
  const [threadMenuOpen, setThreadMenuOpen] = useState(false)
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null)
  const [threadTitleDraft, setThreadTitleDraft] = useState('')
  const threadMenuRef = useRef<HTMLDivElement>(null)
  const [input, setInput] = useState('')
  const [selectedText, setSelectedText] = useState('')
  const [selectionPos, setSelectionPos] = useState<{ x: number; y: number } | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [isAiBusy, setIsAiBusy] = useState(false)
  const [isMaximized, setIsMaximized] = useState(false)
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [showYtInput, setShowYtInput] = useState(false)
  const [ytUrl, setYtUrl] = useState('')
  const [showTutorialInput, setShowTutorialInput] = useState(false)
  const [tutorialTopic, setTutorialTopic] = useState('')
  const [isFetchingMedia, setIsFetchingMedia] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const knowledge = useChatKnowledgeSources(activeProjectId, null, true)

  const activeProvider = settings.ai.provider
  const activeModel =
    settings.ai.provider === 'ollama'
      ? settings.ai.ollamaModel
      : settings.ai.byokModels[settings.ai.provider] || DEFAULT_PROVIDER_MODELS[settings.ai.provider]

  const chatEndRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const resizeRef = useRef<{ startX: number; startY: number; initW: number; initH: number } | null>(null)

  useEffect(() => {
    // Scroll chat list when messages update
    const list = chatEndRef.current?.parentElement
    if (list) list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' })
  }, [messages, isAiBusy])

  useEffect(() => {
    // Check initial maximized state
    window.glassAPI?.isMaximized?.().then((max) => setIsMaximized(max))
    return window.glassAPI?.onMaximizedChanged?.((max) => setIsMaximized(max))
  }, [])

  // Sync active project chat store with SQLite & main window storage events
  useEffect(() => {
    let alive = true
    hydratedProjectRef.current = null
    void fetchProjectChatStore(activeProjectId).then((loaded) => {
      if (alive) {
        hydratedProjectRef.current = activeProjectId
        chatStoreRef.current = loaded
        setChatStore(loaded)
      }
    })

    const onStorage = (e: StorageEvent): void => {
      if (e.key === ACTIVE_CHAT_PROJECT_KEY && e.newValue) {
        hydratedProjectRef.current = null
        setActiveProjectId(e.newValue)
        const nextLocal = loadProjectChatStoreLocal(e.newValue)
        chatStoreRef.current = nextLocal
        setChatStore(nextLocal)
      } else if (e.key === getProjectChatStorageKey(activeProjectId) && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue) as ProjectChatStore
          if (parsed && Array.isArray(parsed.threads) && parsed.threads.length > 0) {
            hydratedProjectRef.current = activeProjectId
            chatStoreRef.current = parsed
            setChatStore(parsed)
          }
        } catch {
          /* ignore */
        }
      }
    }
    const onUnload = (): void => {
      if (hydratedProjectRef.current === activeProjectId) {
        void persistProjectChatStore(activeProjectId, chatStoreRef.current)
      }
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener('beforeunload', onUnload)
    return () => {
      alive = false
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('beforeunload', onUnload)
    }
  }, [activeProjectId])

  useEffect(() => {
    if (!threadMenuOpen) return
    const handleOutside = (e: MouseEvent): void => {
      if (threadMenuRef.current && !threadMenuRef.current.contains(e.target as Node)) {
        setThreadMenuOpen(false)
        setEditingThreadId(null)
      }
    }
    window.addEventListener('mousedown', handleOutside)
    return () => window.removeEventListener('mousedown', handleOutside)
  }, [threadMenuOpen])

  const handleResizePointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    resizeRef.current = {
      startX: e.screenX,
      startY: e.screenY,
      initW: window.innerWidth,
      initH: window.innerHeight
    }
  }

  const handleResizePointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!resizeRef.current) return
    const dx = e.screenX - resizeRef.current.startX
    const dy = e.screenY - resizeRef.current.startY
    const newW = Math.max(320, resizeRef.current.initW + dx)
    const newH = Math.max(400, resizeRef.current.initH + dy)
    window.glassAPI?.resizeDetachedWindow?.(newW, newH)
  }

  const handleResizePointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (resizeRef.current) {
      resizeRef.current = null
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        // fallback
      }
    }
  }

  const handleDocumentFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return

    setIsFetchingMedia(true)
    try {
      for (const file of files) {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result || ''))
          reader.onerror = () => reject(reader.error)
          reader.readAsDataURL(file)
        })

        let parsed: any = null
        if (window.glassAPI?.parseFileBuffer) {
          parsed = await window.glassAPI.parseFileBuffer(file.name, base64)
        } else {
          const text = await file.text()
          parsed = { ok: true, fileName: file.name, text }
        }

        if (parsed && parsed.ok) {
          const text = parsed.text || ''
          setAttachments((prev) => [
            ...prev,
            {
              id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              type: 'file',
              name: parsed.fileName || file.name,
              textContent: text,
              tokenEstimate: Math.round(text.length / 4)
            }
          ])
        }
      }
    } finally {
      setIsFetchingMedia(false)
      e.target.value = ''
    }
  }

  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(e.target.files || [])
    files.forEach((file) => {
      const reader = new FileReader()
      reader.onload = () => {
        const b64WithPrefix = String(reader.result || '')
        const base64 = b64WithPrefix.split(',')[1] || b64WithPrefix
        setAttachments((prev) => [
          ...prev,
          {
            id: `att-img-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            type: 'image',
            name: file.name,
            imageBase64: base64,
            mimeType: file.type
          }
        ])
      }
      reader.readAsDataURL(file)
    })
    e.target.value = ''
  }

  const handleAddYouTubeAttachment = async (): Promise<void> => {
    if (!ytUrl.trim() || !window.glassAPI?.fetchYouTubeInfo) return
    try {
      setIsFetchingMedia(true)
      const res = await window.glassAPI.fetchYouTubeInfo(ytUrl.trim())
      if (res?.ok) {
        setAttachments((prev) => [
          ...prev,
          {
            id: `att-yt-${Date.now()}`,
            type: 'youtube',
            name: res.title,
            url: `https://www.youtube.com/watch?v=${res.videoId}`,
            textContent: res.fullText,
            tokenEstimate: Math.round((res.fullText || '').length / 4),
            metadata: { videoId: res.videoId, author: res.author }
          }
        ])
        setYtUrl('')
        setShowYtInput(false)
      }
    } finally {
      setIsFetchingMedia(false)
    }
  }

  const handleTriggerTutorial = (): void => {
    const clean = tutorialTopic.trim() || 'Current Whiteboard & Knowledge Context'
    window.glassAPI?.sendDetachedAction?.({ type: 'generateTutorial', topic: clean })
    setTutorialTopic('')
    setShowTutorialInput(false)
  }

  const handleSend = async (queryText?: string): Promise<void> => {
    const textToSend = (queryText ?? input).trim()
    if ((!textToSend && attachments.length === 0) || isAiBusy) return

    const promptText = textToSend || 'Analyze the attached context and summarize key insights.'
    const currentAttachments = [...attachments]

    const targetThreadId = activeThread?.id || chatStore.activeThreadId
    const userMsg: ChatMessage = {
      id: 'msg_' + Date.now(),
      role: 'user',
      content: promptText,
      timestamp: Date.now()
    }
    const updated = [...messages, userMsg]
    setChatStore((prev) => {
      const next: ProjectChatStore = {
        ...prev,
        threads: prev.threads.map((t) => {
          if (t.id !== targetThreadId) return t
          const updatedMsgs = [...t.messages, userMsg]
          const isDefault = /^(Chat \d+|New Chat)$/i.test(t.title.trim())
          return {
            ...t,
            title: isDefault ? deriveThreadTitle(updatedMsgs, t.title) : t.title,
            messages: updatedMsgs,
            updatedAt: userMsg.timestamp
          }
        })
      }
      void persistProjectChatStore(activeProjectId, next)
      return next
    })
    if (!queryText) setInput('')
    setAttachments([])
    knowledge.closeAtMention()
    setIsAiBusy(true)

    try {
      const history = updated.slice(-10).map((m) => ({
        role: m.role,
        content: m.content
      }))
      const pinnedIds = knowledge.pinnedSources.map((s) => s.id)

      const req: AIRequest = {
        provider: settings.ai.provider,
        model: activeModel,
        ollamaHost: settings.ai.ollamaHost,
        temperature: settings.ai.temperature,
        isChat: true,
        prompt: promptText,
        chatHistory: history,
        projectId: activeProjectId,
        includeProjectContext: knowledge.includeProjectContext,
        sourceIds: pinnedIds.length > 0 ? pinnedIds : undefined,
        attachments: currentAttachments
      }

      const res = await window.glassAPI?.runAI(req)
      const replyMsg: ChatMessage =
        res && res.ok && res.reply
          ? {
              id: 'msg_' + Date.now(),
              role: 'assistant',
              content: res.reply,
              timestamp: Date.now()
            }
          : {
              id: 'msg_' + Date.now(),
              role: 'assistant',
              content: res?.error || 'AI request did not return a response. Please check your model settings.',
              timestamp: Date.now()
            }

      setChatStore((prev) => {
        const next: ProjectChatStore = {
          ...prev,
          threads: prev.threads.map((t) =>
            t.id === targetThreadId
              ? { ...t, messages: [...t.messages, replyMsg], updatedAt: replyMsg.timestamp }
              : t
          )
        }
        void persistProjectChatStore(activeProjectId, next)
        return next
      })
    } catch (err: any) {
      const errMsg: ChatMessage = {
        id: 'msg_' + Date.now(),
        role: 'assistant',
        content: `AI Error: ${err?.message || 'Failed to communicate with AI'}`,
        timestamp: Date.now()
      }
      setChatStore((prev) => {
        const next: ProjectChatStore = {
          ...prev,
          threads: prev.threads.map((t) =>
            t.id === targetThreadId
              ? { ...t, messages: [...t.messages, errMsg], updatedAt: errMsg.timestamp }
              : t
          )
        }
        void persistProjectChatStore(activeProjectId, next)
        return next
      })
    } finally {
      setIsAiBusy(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (knowledge.atQuery !== null && knowledge.atMatches.length > 0) {
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault()
        knowledge.applyAtMention(knowledge.atMatches[0], input, setInput)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        knowledge.closeAtMention()
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleMouseUp = (): void => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed) {
      setSelectedText('')
      setSelectionPos(null)
      return
    }
    const text = sel.toString().trim()
    if (text.length > 3 && panelRef.current?.contains(sel.anchorNode)) {
      const range = sel.getRangeAt(0)
      const rect = range.getBoundingClientRect()
      setSelectedText(text)
      setSelectionPos({ x: rect.left + rect.width / 2, y: rect.top - 10 })
    } else {
      setSelectedText('')
      setSelectionPos(null)
    }
  }

  const handleAddSelectedToNotes = (): void => {
    if (selectedText) {
      window.glassAPI?.sendDetachedAction?.({
        type: 'insertToNotes',
        text: selectedText
      })
      setSelectedText('')
      setSelectionPos(null)
      window.getSelection()?.removeAllRanges()
    }
  }

  const handleInsertToNotes = (text: string): void => {
    window.glassAPI?.sendDetachedAction?.({
      type: 'insertToNotes',
      text
    })
  }

  const handleInsertDiagram = (text: string): void => {
    window.glassAPI?.sendDetachedAction?.({
      type: 'insertDiagram',
      text
    })
  }

  const handleCopy = (id: string, text: string): void => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  return (
    <div className="detached-window-root" ref={panelRef} onMouseUp={handleMouseUp}>
      {/* Floating snippet insert badge when text is selected */}
      {selectedText && selectionPos && (
        <button
          className="chat-floating-insert-btn"
          style={{ left: selectionPos.x, top: selectionPos.y }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleAddSelectedToNotes}
        >
          <PlusSquare size={14} />
          <span>Add selection to canvas</span>
        </button>
      )}

      {/* Detached Window Titlebar with OS-level window drag */}
      <div className="detached-titlebar">
        <div className="detached-title-wrap">
          <div className="panel-icon-circle">
            <Bot size={17} className="text-accent" />
          </div>
            <div className="detached-title-text">
            <h3 className="panel-title">AI Research & Notes</h3>
            <button
              type="button"
              className={`panel-model-tag panel-model-badge-btn ${showAiSettings ? 'active' : ''}`}
              onClick={() => setShowAiSettings((prev) => !prev)}
              title="Click to change AI model & settings"
            >
              <Sparkles size={11} />
              <span>{activeProvider.toUpperCase()} &bull; {activeModel} &bull; Multi-Screen Window</span>
              <Settings2 size={11} className="badge-settings-icon" />
            </button>
          </div>
        </div>

        <div className="detached-window-actions">
          {/* AI Settings Toggle */}
          <button
            type="button"
            className={`header-action-btn ${showAiSettings ? 'active' : ''}`}
            onClick={() => setShowAiSettings((prev) => !prev)}
            title={showAiSettings ? 'Close AI Settings' : 'AI Models & Settings'}
          >
            <Settings2 size={14} />
          </button>
          <button
            type="button"
            className="header-action-btn"
            onClick={() => {
              const targetId = activeThread?.id || chatStore.activeThreadId
              setChatStore((prev) => {
                const next: ProjectChatStore = {
                  ...prev,
                  threads: prev.threads.map((t) =>
                    t.id === targetId ? { ...t, messages: [], updatedAt: Date.now() } : t
                  )
                }
                void persistProjectChatStore(activeProjectId, next)
                return next
              })
            }}
            title="Clear conversation"
            disabled={messages.length === 0}
          >
            <Trash2 size={14} />
          </button>
          <button
            type="button"
            className="header-action-btn"
            onClick={() => window.glassAPI?.minimizeDetached?.()}
            title="Minimize window"
          >
            <Minus size={14} />
          </button>
          <button
            type="button"
            className="header-action-btn"
            onClick={() => window.glassAPI?.maximizeDetached?.()}
            title={isMaximized ? 'Restore' : 'Maximize'}
          >
            <Square size={13} />
          </button>
          <button
            type="button"
            className="header-action-btn close-btn"
            onClick={() => window.glassAPI?.closeDetached?.()}
            title="Close / Re-dock to whiteboard"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Multi-Chat Thread Switcher & New Chat Bar */}
      <div className="chat-thread-bar" ref={threadMenuRef}>
        <div className="chat-thread-picker-wrap">
          <button
            type="button"
            className={`chat-thread-picker-btn ${threadMenuOpen ? 'open' : ''}`}
            onClick={() => setThreadMenuOpen((v) => !v)}
            title="Switch between chat threads in this project"
          >
            <MessageSquare size={12} className="chat-thread-icon" />
            <span className="chat-thread-name">{activeThread?.title || 'Chat 1'}</span>
            <span className="chat-thread-meta">
              {messages.length} msgs · ~{estimateThreadTokens(messages)} tok
            </span>
            <ChevronDown size={12} />
          </button>

          {threadMenuOpen && (
            <div className="chat-thread-dropdown glass">
              <div className="chat-thread-dropdown-hdr">
                <span>Project Chats ({chatStore.threads.length})</span>
                <span className="chat-thread-hint">10-msg context window</span>
              </div>
              <div className="chat-thread-dropdown-list">
                {chatStore.threads.map((t) => {
                  const isCur = t.id === (activeThread?.id || chatStore.activeThreadId)
                  const isEditing = editingThreadId === t.id
                  return (
                    <div
                      key={t.id}
                      className={`chat-thread-item ${isCur ? 'active' : ''}`}
                      onClick={() => {
                        if (!isEditing) {
                          setChatStore((prev) => {
                            const next = { ...prev, activeThreadId: t.id }
                            void persistProjectChatStore(activeProjectId, next)
                            return next
                          })
                          setThreadMenuOpen(false)
                        }
                      }}
                    >
                      {isEditing ? (
                        <form
                          className="chat-thread-rename-form"
                          onClick={(e) => e.stopPropagation()}
                          onSubmit={(e) => {
                            e.preventDefault()
                            if (threadTitleDraft.trim()) {
                              setChatStore((prev) => {
                                const next = {
                                  ...prev,
                                  threads: prev.threads.map((th) =>
                                    th.id === t.id
                                      ? { ...th, title: threadTitleDraft.trim(), updatedAt: Date.now() }
                                      : th
                                  )
                                }
                                void persistProjectChatStore(activeProjectId, next)
                                return next
                              })
                            }
                            setEditingThreadId(null)
                          }}
                        >
                          <input
                            type="text"
                            autoFocus
                            value={threadTitleDraft}
                            onChange={(e) => setThreadTitleDraft(e.target.value)}
                            onKeyDown={(e) => {
                              e.stopPropagation()
                              if (e.key === 'Escape') setEditingThreadId(null)
                            }}
                          />
                          <button type="submit">
                            <Check size={12} />
                          </button>
                        </form>
                      ) : (
                        <>
                          <div className="chat-thread-item-main">
                            <span className="chat-thread-item-title">{t.title}</span>
                            <span className="chat-thread-item-sub">
                              {t.messages.length} {t.messages.length === 1 ? 'msg' : 'msgs'} · ~
                              {estimateThreadTokens(t.messages)} tok
                            </span>
                          </div>
                          <div
                            className="chat-thread-item-actions"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              title="Rename chat"
                              onClick={() => {
                                setEditingThreadId(t.id)
                                setThreadTitleDraft(t.title)
                              }}
                            >
                              <Pencil size={11} />
                            </button>
                            {chatStore.threads.length > 1 && (
                              <button
                                type="button"
                                className="danger"
                                title="Delete chat"
                                onClick={() => {
                                  setChatStore((prev) => {
                                    const rem = prev.threads.filter((th) => th.id !== t.id)
                                    const next: ProjectChatStore = {
                                      activeThreadId:
                                        prev.activeThreadId === t.id ? rem[0].id : prev.activeThreadId,
                                      threads: rem
                                    }
                                    void persistProjectChatStore(activeProjectId, next)
                                    return next
                                  })
                                }}
                              >
                                <Trash2 size={11} />
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          className="chat-new-thread-btn"
          onClick={() => {
            setChatStore((prev) => {
              const created = createChatThread(`Chat ${prev.threads.length + 1}`)
              const next: ProjectChatStore = {
                activeThreadId: created.id,
                threads: [created, ...prev.threads]
              }
              void persistProjectChatStore(activeProjectId, next)
              return next
            })
            setThreadMenuOpen(false)
          }}
          title="Start a new fresh chat in this project to save tokens"
        >
          <Plus size={12} />
          <span>New Chat</span>
        </button>
      </div>

      {/* Dedicated Feature Quick-Bar */}
      <div className="chat-feature-bar">
        <button
          type="button"
          className={`chat-feature-pill ${showTutorialInput ? 'active' : ''}`}
          onClick={() => setShowTutorialInput((v) => !v)}
          title="Create structured visual tutorial on whiteboard"
        >
          <Layout size={13} />
          <span>Create Tutorial</span>
        </button>
        <button
          type="button"
          className="chat-feature-pill notebook"
          onClick={() => window.glassAPI?.sendDetachedAction?.({ type: 'openNotebookLM' })}
          title="Open NotebookLM Knowledge Studio on main board"
        >
          <BookOpen size={13} />
          <span>NotebookLM Studio</span>
        </button>
      </div>

      {/* Inline Tutorial Generator Bar */}
      {showTutorialInput && (
        <div className="tutorial-popover-bar">
          <div className="tutorial-popover-row">
            <Layout size={14} style={{ color: '#38bdf8', flexShrink: 0 }} />
            <input
              type="text"
              value={tutorialTopic}
              onChange={(e) => setTutorialTopic(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleTriggerTutorial()}
              placeholder="Topic to teach visually on board..."
            />
            <button type="button" className="tutorial-go-btn" onClick={handleTriggerTutorial}>
              Create
            </button>
          </div>
        </div>
      )}

      {/* AI Settings Sub-panel inside Detached Chat */}
      {showAiSettings && (
        <ChatAiSettings
          ai={settings.ai}
          onChangeAI={(newAi: AISettings) => {
            patchSettings({ ai: newAi })
            window.glassAPI?.sendDetachedAction?.({
              type: 'settingsUpdated',
              ai: newAi
            })
          }}
          onClose={() => setShowAiSettings(false)}
        />
      )}

      {/* Conversation list */}
      <div className="chat-messages-scroll detached-scroll">
        {messages.length === 0 ? (
          <div className="chat-empty-state">
            <div className="empty-sparkle-icon">
              <Sparkles size={28} />
            </div>
            <h4>Multi-Screen AI Workspace</h4>
            <p>
              Drag this window to any monitor or screen. You can ask anything here, and click{' '}
              <strong>&ldquo;Add to Notes&rdquo;</strong> to place cards directly onto your whiteboard!
            </p>
            <div className="chat-quick-prompts">
              <button
                onClick={() =>
                  handleSend(
                    'Explain how a distributed event streaming architecture works (Kafka/RabbitMQ) with key components.'
                  )
                }
              >
                &ldquo;Explain distributed event streaming architecture&rdquo;
              </button>
              <button
                onClick={() =>
                  handleSend('Give me the key mathematical equations and concepts for Transformer self-attention.')
                }
              >
                &ldquo;Self-attention equations and concepts&rdquo;
              </button>
            </div>
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`chat-message-row ${m.role}`}>
              {m.role === 'assistant' && (
                <div className="assistant-avatar">
                  <Bot size={15} />
                </div>
              )}
              <div className="chat-bubble">
                <div className="chat-text-content">
                  <Markdown text={m.content} />
                </div>

                {m.role === 'assistant' && (
                  <div className="chat-bubble-actions">
                    <button
                      type="button"
                      className="bubble-action-btn primary"
                      onClick={() => handleInsertToNotes(m.content)}
                      title="Insert as a movable note card on the whiteboard canvas"
                    >
                      <PlusSquare size={13} />
                      <span>Add to Notes</span>
                    </button>
                    <button
                      type="button"
                      className="bubble-action-btn"
                      onClick={() => handleInsertDiagram(m.content)}
                      title="Generate interactive React Flow diagram and place on whiteboard"
                    >
                      <Network size={13} />
                      <span>Create Diagram</span>
                    </button>
                    <button
                      type="button"
                      className="bubble-action-btn"
                      onClick={() =>
                        window.glassAPI?.sendDetachedAction?.({
                          type: 'generateTutorial',
                          topic: m.content.slice(0, 800)
                        })
                      }
                      title="Convert this response into a structured visual tutorial on the board"
                    >
                      <Layout size={13} />
                      <span>To Tutorial</span>
                    </button>
                    <button
                      type="button"
                      className="bubble-action-btn ghost"
                      onClick={() => handleCopy(m.id, m.content)}
                      title="Copy response"
                    >
                      {copiedId === m.id ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))
        )}

        {isAiBusy && (
          <div className="chat-message-row assistant">
            <div className="assistant-avatar pulse">
              <Bot size={15} />
            </div>
            <div className="chat-bubble thinking">
              <div className="typing-dots">
                <span></span>
                <span></span>
                <span></span>
              </div>
              <span className="thinking-label">AI is formulating response...</span>
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Bottom input area */}
      <div className="chat-input-container">
        <input
          type="file"
          ref={fileInputRef}
          accept=".pdf,.txt,.md,.markdown,.json,.csv,.ts,.tsx,.js,.jsx,.py,.html,.css"
          multiple
          style={{ display: 'none' }}
          onChange={handleDocumentFilesSelected}
        />
        <input
          type="file"
          ref={imageInputRef}
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={handleImageFileChange}
        />

        {showYtInput && (
          <div className="chat-yt-attach-bar">
            <Video size={14} className="chat-yt-icon" />
            <input
              type="text"
              value={ytUrl}
              onChange={(e) => setYtUrl(e.target.value)}
              placeholder="Paste YouTube Video URL..."
              onKeyDown={(e) => e.key === 'Enter' && handleAddYouTubeAttachment()}
            />
            <button
              type="button"
              className="chat-yt-submit-btn"
              onClick={handleAddYouTubeAttachment}
              disabled={isFetchingMedia || !ytUrl.trim()}
            >
              {isFetchingMedia ? 'Fetching...' : 'Attach'}
            </button>
            <button
              type="button"
              className="chat-yt-close-btn"
              onClick={() => setShowYtInput(false)}
              aria-label="Close YouTube URL bar"
            >
              <X size={13} />
            </button>
          </div>
        )}

        <ChatPinnedSourcesBar
          pinnedSources={knowledge.pinnedSources}
          onRemove={knowledge.removePinnedSource}
        />

        {attachments.length > 0 && (
          <div className="chat-attachment-pills">
            {attachments.map((att) => (
              <div key={att.id} className="chat-attachment-chip">
                {att.type === 'youtube' ? (
                  <Video size={12} style={{ color: '#f87171', flexShrink: 0 }} />
                ) : att.type === 'image' ? (
                  <ImageIcon size={12} style={{ color: '#38bdf8', flexShrink: 0 }} />
                ) : (
                  <Paperclip size={12} style={{ color: '#34d399', flexShrink: 0 }} />
                )}
                <span className="chat-attachment-name">{att.name}</span>
                {att.type === 'youtube' && att.url && (
                  <button
                    type="button"
                    className="chat-attachment-pin-btn"
                    onClick={() =>
                      window.glassAPI?.sendDetachedAction?.({
                        type: 'addYouTubeToCanvas',
                        url: att.url,
                        title: att.name
                      })
                    }
                  >
                    Pin
                  </button>
                )}
                <button
                  type="button"
                  className="chat-attachment-remove-btn"
                  onClick={() => setAttachments((prev) => prev.filter((a) => a.id !== att.id))}
                  aria-label={`Remove ${att.name}`}
                >
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="chat-input-wrapper">
          <ChatAtMentionPopover
            atQuery={knowledge.atQuery}
            matches={knowledge.atMatches}
            pinnedSources={knowledge.pinnedSources}
            onSelect={(src) => knowledge.applyAtMention(src, input, setInput)}
            onClose={knowledge.closeAtMention}
            onOpenNotebookLM={() =>
              window.glassAPI?.sendDetachedAction?.({ type: 'openNotebookLM' })
            }
          />
          <textarea
            className="chat-textarea"
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              knowledge.detectAtMention(e.target.value, e.target.selectionStart)
            }}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question, type @ to cite a book, or attach files... (Enter to send)"
            rows={2}
          />
          <div className="chat-input-controls">
            <div className="chat-attach-group">
              <button
                type="button"
                className="chat-attach-btn"
                onClick={() => fileInputRef.current?.click()}
                title="Attach Document (PDF, Code, Text, Markdown)"
                aria-label="Attach File"
              >
                <Paperclip size={13} />
                <span>File</span>
              </button>
              <button
                type="button"
                className="chat-attach-btn"
                onClick={() => imageInputRef.current?.click()}
                title="Attach Image / Screenshot"
                aria-label="Attach Image"
              >
                <ImageIcon size={13} />
                <span>Image</span>
              </button>
              <button
                type="button"
                className={`chat-attach-btn yt ${showYtInput ? 'active' : ''}`}
                onClick={() => setShowYtInput((v) => !v)}
                title="Attach YouTube Video Transcript"
                aria-label="Attach YouTube Link"
              >
                <Video size={13} />
                <span>YouTube</span>
              </button>
              <ChatSourceContextControls
                state={knowledge}
                hasProject={Boolean(activeProjectId)}
                onOpenNotebookLM={() =>
                  window.glassAPI?.sendDetachedAction?.({ type: 'openNotebookLM' })
                }
              />
            </div>
            <button
              type="button"
              className="chat-send-btn"
              onClick={() => handleSend()}
              disabled={(!input.trim() && attachments.length === 0) || isAiBusy}
              title="Send (Enter)"
              aria-label="Send message"
            >
              <Send size={15} />
            </button>
          </div>
        </div>
      </div>

      {/* Bottom-right corner resize handle */}
      {!isMaximized && (
        <div
          className="floating-ai-resize-grip"
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerUp}
          title="Drag to resize window"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M9 1L1 9M9 5L5 9M9 9L9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
      )}
    </div>
  )
}
