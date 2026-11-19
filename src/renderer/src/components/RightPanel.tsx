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
  Maximize2,
  Minimize2,
  ExternalLink,
  GripHorizontal,
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
import type { ChatAttachment, ProjectChatThread } from '@shared/ipc'
import { estimateThreadTokens } from '../board/workspaceStore'
import { useAutoGrowTextarea } from '../board/useAutoGrowTextarea'
import { Markdown } from './Markdown'
import { ChatAiSettings } from './ChatAiSettings'
import {
  ChatAtMentionPopover,
  ChatPinnedSourcesBar,
  ChatSourceContextControls,
  useChatKnowledgeSources
} from './ChatKnowledgePicker'

interface RightPanelProps {
  isOpen: boolean
  onToggle: () => void
  messages: ChatMessage[]
  threads?: ProjectChatThread[]
  activeThreadId?: string
  onSelectThread?: (threadId: string) => void
  onCreateThread?: (title?: string) => void
  onRenameThread?: (threadId: string, title: string) => void
  onDeleteThread?: (threadId: string) => void
  onSendMessage: (
    query: string,
    attachments?: ChatAttachment[],
    options?: { sourceIds?: string[]; includeProjectContext?: boolean }
  ) => void
  onInsertToNotes: (text: string, title?: string) => void
  onInsertDiagram: (text: string) => void
  onClearChat: () => void
  onOpenKnowledgeHub?: () => void
  onGenerateTutorial?: (topic: string) => void
  onAddYouTubeToCanvas?: (url: string, title?: string) => void
  isAiBusy: boolean
  isAiConfigured?: boolean
  aiUnconfiguredReason?: string
  activeModel: string
  activeProvider: string
  projectId?: string | null
  sectionId?: string | null
  projectTitle?: string
  isDetached?: boolean
  onOpenDetached?: () => void
  onCloseDetached?: () => void
  aiSettings?: AISettings
  onChangeAI?: (ai: AISettings) => void
  onToast?: (kind: 'info' | 'success' | 'error', message: string) => void
  openSettingsTrigger?: number
}

const CHAT_RECT_KEY = 'vgb.chatPanelRect'

function loadInitialChatRect(): { x: number; y: number; width: number; height: number } {
  const winW = typeof window !== 'undefined' ? window.innerWidth : 1280
  const winH = typeof window !== 'undefined' ? window.innerHeight : 800
  const maxW = Math.max(280, winW - 24)
  const maxH = Math.max(280, winH - 76)
  const defaultW = Math.min(430, maxW)
  const defaultH = Math.min(640, Math.max(320, Math.min(maxH, winH - 100)))
  const defaultX = Math.max(12, winW - defaultW - 20)
  const defaultY = Math.max(60, winH - defaultH - 24)

  try {
    const raw = localStorage.getItem(CHAT_RECT_KEY)
    if (!raw) return { x: defaultX, y: defaultY, width: defaultW, height: defaultH }
    const p = JSON.parse(raw) as Partial<{ x: number; y: number; width: number; height: number }>
    const width =
      typeof p.width === 'number' && Number.isFinite(p.width)
        ? Math.max(Math.min(320, maxW), Math.min(maxW, p.width))
        : defaultW
    const height =
      typeof p.height === 'number' && Number.isFinite(p.height)
        ? Math.max(Math.min(320, maxH), Math.min(maxH, p.height))
        : defaultH
    const x =
      typeof p.x === 'number' && Number.isFinite(p.x)
        ? Math.max(12, Math.min(Math.max(12, winW - width - 12), p.x))
        : defaultX
    const y =
      typeof p.y === 'number' && Number.isFinite(p.y)
        ? Math.max(60, Math.min(Math.max(60, winH - height - 12), p.y))
        : defaultY
    return { x, y, width, height }
  } catch {
    return { x: defaultX, y: defaultY, width: defaultW, height: defaultH }
  }
}

export const RightPanel: React.FC<RightPanelProps> = ({
  isOpen,
  onToggle,
  messages,
  threads,
  activeThreadId,
  onSelectThread,
  onCreateThread,
  onRenameThread,
  onDeleteThread,
  onSendMessage,
  onInsertToNotes,
  onInsertDiagram,
  onClearChat,
  onOpenKnowledgeHub,
  onGenerateTutorial,
  onAddYouTubeToCanvas,
  isAiBusy,
  isAiConfigured = true,
  aiUnconfiguredReason,
  activeModel,
  activeProvider,
  projectId,
  sectionId,
  projectTitle,
  isDetached = false,
  onOpenDetached,
  onCloseDetached,
  aiSettings,
  onChangeAI,
  onToast,
  openSettingsTrigger
}) => {
  const [showAiSettings, setShowAiSettings] = useState(false)

  useEffect(() => {
    if (openSettingsTrigger) {
      setShowAiSettings(true)
    }
  }, [openSettingsTrigger])

  const [input, setInput] = useState('')
  const [selectedText, setSelectedText] = useState('')
  const [selectionPos, setSelectionPos] = useState<{ x: number; y: number } | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Floating Window Coordinates & Dimensions (persisted across minimize/reopen)
  const [initialRect] = useState(loadInitialChatRect)
  const [position, setPosition] = useState<{ x: number; y: number }>({
    x: initialRect.x,
    y: initialRect.y
  })
  const [size, setSize] = useState<{ width: number; height: number }>({
    width: initialRect.width,
    height: initialRect.height
  })
  const [isMaximized, setIsMaximized] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [isResizing, setIsResizing] = useState(false)

  useEffect(() => {
    try {
      localStorage.setItem(
        CHAT_RECT_KEY,
        JSON.stringify({ x: position.x, y: position.y, width: size.width, height: size.height })
      )
    } catch {
      /* ignore */
    }
  }, [position.x, position.y, size.width, size.height])

  const chatEndRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startX: number; startY: number; initX: number; initY: number } | null>(null)
  const resizeRef = useRef<{
    startX: number
    startY: number
    initW: number
    initH: number
    initX: number
    initY: number
    handle: string
  } | null>(null)

  useEffect(() => {
    // Keep window within visible bounds if viewport resizes
    const handleWinResize = (): void => {
      const maxW = Math.max(280, window.innerWidth - 24)
      const maxH = Math.max(280, window.innerHeight - 76)
      setSize((prevSize) => {
        const nextW = Math.min(prevSize.width, maxW)
        const nextH = Math.min(prevSize.height, maxH)
        setPosition((prevPos) => ({
          x: Math.max(12, Math.min(Math.max(12, window.innerWidth - nextW - 12), prevPos.x)),
          y: Math.max(60, Math.min(Math.max(60, window.innerHeight - nextH - 12), prevPos.y))
        }))
        return { width: nextW, height: nextH }
      })
    }
    window.addEventListener('resize', handleWinResize)
    return () => window.removeEventListener('resize', handleWinResize)
  }, [])

  useEffect(() => {
    if (!isOpen || isDetached) return
    // Scroll only the chat list to latest message
    const list = chatEndRef.current?.parentElement
    if (list) list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' })
  }, [messages, isAiBusy, isOpen, isDetached])

  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [showYtInput, setShowYtInput] = useState(false)
  const [ytUrl, setYtUrl] = useState('')
  const [showTutorialInput, setShowTutorialInput] = useState(false)
  const [tutorialTopic, setTutorialTopic] = useState('')
  const [isFetchingMedia, setIsFetchingMedia] = useState(false)
  const [threadMenuOpen, setThreadMenuOpen] = useState(false)
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null)
  const [threadTitleDraft, setThreadTitleDraft] = useState('')
  const threadMenuRef = useRef<HTMLDivElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const knowledge = useChatKnowledgeSources(projectId, sectionId, isOpen && !isDetached)
  useAutoGrowTextarea(textareaRef, input, 5, isOpen && !isDetached)

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

  const activeThread =
    threads?.find((t) => t.id === activeThreadId) || threads?.[0] || null
  const estimatedCtxTokens = estimateThreadTokens(messages)

  const handleAddFileAttachment = (): void => {
    fileInputRef.current?.click()
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
          const att: ChatAttachment = {
            id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            type: 'file',
            name: parsed.fileName || file.name,
            textContent: text,
            tokenEstimate: Math.round(text.length / 4)
          }
          setAttachments((prev) => [...prev, att])
          onToast?.('success', `Attached ${att.name} (~${att.tokenEstimate} tokens)`)
        } else {
          onToast?.('error', parsed?.error || `Could not parse ${file.name}`)
        }
      }
    } catch (err: any) {
      onToast?.('error', `Failed to attach file: ${err?.message || err}`)
    } finally {
      setIsFetchingMedia(false)
      e.target.value = ''
    }
  }

  const handleAddYouTubeAttachment = async (): Promise<void> => {
    if (!ytUrl.trim()) return
    if (!window.glassAPI?.fetchYouTubeInfo) {
      onToast?.('error', 'YouTube bridge unavailable')
      return
    }
    try {
      setIsFetchingMedia(true)
      const res = await window.glassAPI.fetchYouTubeInfo(ytUrl.trim())
      if (!res.ok) {
        onToast?.('error', res.error || 'Failed to fetch YouTube info.')
        return
      }
      const att: ChatAttachment = {
        id: `att-yt-${Date.now()}`,
        type: 'youtube',
        name: res.title,
        url: `https://www.youtube.com/watch?v=${res.videoId}`,
        textContent: res.fullText,
        tokenEstimate: Math.round((res.fullText || '').length / 4),
        metadata: { videoId: res.videoId, author: res.author }
      }
      setAttachments((prev) => [...prev, att])
      setYtUrl('')
      setShowYtInput(false)
      onToast?.('success', `Attached YouTube context: ${res.title}`)
    } catch (err: any) {
      onToast?.('error', `Failed to attach YouTube video: ${err?.message || err}`)
    } finally {
      setIsFetchingMedia(false)
    }
  }

  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return
    files.forEach((file) => {
      const reader = new FileReader()
      reader.onload = () => {
        const b64WithPrefix = reader.result as string
        const base64 = b64WithPrefix.split(',')[1] || b64WithPrefix
        const att: ChatAttachment = {
          id: `att-img-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          type: 'image',
          name: file.name,
          imageBase64: base64,
          mimeType: file.type
        }
        setAttachments((prev) => [...prev, att])
        onToast?.('success', `Attached image ${file.name}`)
      }
      reader.readAsDataURL(file)
    })
    e.target.value = ''
  }

  const removeAttachment = (id: string): void => {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }

  const handleTriggerTutorial = (): void => {
    if (!isAiConfigured) {
      setShowAiSettings(true)
      return
    }
    const clean = tutorialTopic.trim() || 'Current Whiteboard & Knowledge Context'
    onGenerateTutorial?.(clean)
    setTutorialTopic('')
    setShowTutorialInput(false)
  }

  const handleSend = (textOverride?: string): void => {
    if (!isAiConfigured) {
      setShowAiSettings(true)
      return
    }
    const query = (textOverride ?? input).trim()
    if ((!query && attachments.length === 0) || isAiBusy) return
    const sourceIds = knowledge.pinnedSources.map((s) => s.id)
    onSendMessage(query || 'Analyze the attached context and summarize key insights.', attachments, {
      sourceIds: sourceIds.length > 0 ? sourceIds : undefined,
      includeProjectContext: knowledge.includeProjectContext
    })
    if (!textOverride) setInput('')
    setAttachments([])
    knowledge.closeAtMention()
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

  // Handle user selecting text inside AI responses to pick custom snippets
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
      onInsertToNotes(selectedText)
      setSelectedText('')
      setSelectionPos(null)
      window.getSelection()?.removeAllRanges()
    }
  }

  const handleCopy = (id: string, text: string): void => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  /* ---------------- Floating Window Dragging ---------------- */
  const handleHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if ((e.target as HTMLElement).closest('button')) return
    if (isMaximized) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setIsDragging(true)
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initX: position.x,
      initY: position.y
    }
  }

  const handleHeaderPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!dragRef.current || isMaximized) return
    const dx = e.clientX - dragRef.current.startX
    const dy = e.clientY - dragRef.current.startY
    const newX = Math.max(10, Math.min(window.innerWidth - 120, dragRef.current.initX + dx))
    const newY = Math.max(52, Math.min(window.innerHeight - 80, dragRef.current.initY + dy))
    setPosition({ x: newX, y: newY })
  }

  const handleHeaderPointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (dragRef.current) {
      dragRef.current = null
      setIsDragging(false)
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        // pointer capture fallback
      }
    }
  }

  /* ---------------- Floating Window Resizing ---------------- */
  const handleResizePointerDown = (e: React.PointerEvent<HTMLDivElement>, handle: string): void => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    setIsResizing(true)
    resizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initW: size.width,
      initH: size.height,
      initX: position.x,
      initY: position.y,
      handle
    }
  }

  const handleResizePointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!resizeRef.current || isMaximized) return
    const { startX, startY, initW, initH, initX, initY, handle } = resizeRef.current
    const dx = e.clientX - startX
    const dy = e.clientY - startY
    const minW = 380
    const minH = 380
    const maxW = window.innerWidth - 20
    const maxH = window.innerHeight - 60

    let newW = initW
    let newH = initH
    let newX = initX
    let newY = initY

    if (handle.includes('e')) newW = Math.max(minW, Math.min(maxW, initW + dx))
    if (handle.includes('s')) newH = Math.max(minH, Math.min(maxH, initH + dy))
    if (handle.includes('w')) {
      const candidateW = Math.max(minW, Math.min(maxW, initW - dx))
      newX = initX + (initW - candidateW)
      newW = candidateW
    }
    if (handle.includes('n')) {
      const candidateH = Math.max(minH, Math.min(maxH, initH - dy))
      newY = initY + (initH - candidateH)
      newH = candidateH
    }

    setSize({ width: newW, height: newH })
    if (newX !== initX || newY !== initY) {
      setPosition({ x: newX, y: newY })
    }
  }

  const handleResizePointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (resizeRef.current) {
      resizeRef.current = null
      setIsResizing(false)
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        // fallback
      }
    }
  }

  const messagesScrollRef = useRef<HTMLDivElement>(null)

  // Native non-passive wheel listener on the chat panel so wheel scrolling
  // drives the chat box directly and never leaks to the main board canvas
  useEffect(() => {
    const panelEl = panelRef.current
    if (!panelEl || !isOpen || isDetached) return

    const handlePanelWheel = (e: WheelEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (typeof e.stopImmediatePropagation === 'function') {
        e.stopImmediatePropagation()
      }

      const deltaY =
        e.deltaMode === 1 ? e.deltaY * 32 : e.deltaMode === 2 ? e.deltaY * 320 : e.deltaY
      const deltaX =
        e.deltaMode === 1 ? e.deltaX * 32 : e.deltaMode === 2 ? e.deltaX * 320 : e.deltaX

      const targetEl = e.target instanceof Element ? (e.target as HTMLElement) : null

      // Scroll sub-areas (textarea, attachment strip, AI settings popover) if they overflow
      const subScroll = targetEl?.closest(
        '.chat-textarea, .chat-attachment-pills, .chat-ai-settings'
      ) as HTMLElement | null
      if (subScroll && subScroll.scrollHeight > subScroll.clientHeight + 1) {
        const prevTop = subScroll.scrollTop
        subScroll.scrollTop += deltaY
        if (subScroll.scrollTop !== prevTop) return
      }

      // Horizontal scroll inside code blocks / tables / display math when scrolling horizontally
      const hScroll = targetEl?.closest(
        '.chat-text-content pre, .chat-text-content table, .chat-text-content .katex-display'
      ) as HTMLElement | null
      if (hScroll && hScroll.scrollWidth > hScroll.clientWidth + 1) {
        if (deltaX !== 0 || (e.shiftKey && deltaY !== 0)) {
          hScroll.scrollLeft += deltaX !== 0 ? deltaX : deltaY
          return
        }
      }

      // Primary vertical scroll on the chat conversation area
      const scrollEl =
        messagesScrollRef.current ||
        (panelEl.querySelector('.chat-messages-scroll') as HTMLElement | null)
      if (scrollEl) {
        scrollEl.scrollTop += deltaY
      }
    }

    panelEl.addEventListener('wheel', handlePanelWheel, { passive: false })
    return () => panelEl.removeEventListener('wheel', handlePanelWheel)
  }, [isOpen, isDetached])

  const handleToggleMaximize = (): void => {
    setIsMaximized((prev) => !prev)
  }

  const handlePopOutToExternalWindow = (): void => {
    if (onOpenDetached) {
      onOpenDetached()
    } else {
      window.glassAPI?.openDetachedChat?.()
    }
  }

  return (
    <>
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

      {/* Floating Circle Button at Bottom-Right Corner (Visible when panel is closed or detached) */}
      {(!isOpen || isDetached) && (
        <button
          className={`floating-ai-circle-btn ${isDetached ? 'detached-active' : ''}`}
          onClick={() => {
            if (isDetached && window.glassAPI?.toggleDetachedChat) {
              window.glassAPI.toggleDetachedChat()
            } else {
              onToggle()
            }
          }}
          title={
            isDetached
              ? 'AI Chat open in separate window (Click to focus / toggle)'
              : 'Open AI Research, File Uploads, Tutorials & Knowledge Studio'
          }
          aria-label="Open AI Research & Notes"
        >
          <div className="floating-circle-inner">
            <Bot size={24} className="floating-circle-bot" />
            <Sparkles size={13} className="floating-circle-sparkle" />
            {isAiBusy && (
              <span className="floating-circle-beacon">
                <span className="beacon-ping" />
                <span className="beacon-dot" />
              </span>
            )}
            {isDetached && (
              <span className="detached-badge-indicator" title="Open in separate window">
                <ExternalLink size={9} />
              </span>
            )}
          </div>
        </button>
      )}

      {/* Floating Mobile-Sized Chat Window (Visible when open and not detached) */}
      {isOpen && !isDetached && (
        <aside
          ref={panelRef}
          className={`floating-ai-window ${isMaximized ? 'maximized' : ''} ${isDragging ? 'is-dragging' : ''} ${isResizing ? 'is-resizing' : ''}`}
          style={
            isMaximized
              ? undefined
              : {
                  left: `${position.x}px`,
                  top: `${position.y}px`,
                  width: `${size.width}px`,
                  height: `${size.height}px`
                }
          }
          onMouseUp={handleMouseUp}
          onPointerDown={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
        >
          {/* Header & Window Drag Handle */}
          <div
            className="floating-ai-header"
            onPointerDown={handleHeaderPointerDown}
            onPointerMove={handleHeaderPointerMove}
            onPointerUp={handleHeaderPointerUp}
            onDoubleClick={handleToggleMaximize}
          >
            <div className="floating-header-drag-handle">
              <GripHorizontal size={14} className="drag-grip-icon" />
              <div className="panel-icon-circle">
                <Bot size={16} className="text-accent" />
              </div>
              <div className="header-titles">
                <h3 className="panel-title">
                  {projectTitle ? `${projectTitle} · Chat` : 'AI Research & Notes'}
                </h3>
                {aiSettings && onChangeAI ? (
                  <button
                    type="button"
                    className={`panel-model-tag panel-model-badge-btn ${showAiSettings ? 'active' : ''} ${!isAiConfigured ? 'unconfigured' : ''}`}
                    onClick={() => setShowAiSettings((prev) => !prev)}
                    title={
                      isAiConfigured
                        ? 'Click to change AI model & settings'
                        : 'AI not configured — click to open AI Settings'
                    }
                  >
                    <Sparkles size={10} />
                    <span>
                      {isAiConfigured ? `${activeProvider} • ${activeModel}` : 'AI Not Configured'}
                    </span>
                    <Settings2 size={10} className="badge-settings-icon" />
                  </button>
                ) : (
                  <div className={`panel-model-tag ${!isAiConfigured ? 'unconfigured' : ''}`}>
                    <Sparkles size={10} />
                    <span>
                      {isAiConfigured ? `${activeProvider} • ${activeModel}` : 'AI Not Configured'}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="floating-header-actions" onPointerDown={(e) => e.stopPropagation()}>
              {/* Settings toggle */}
              {aiSettings && onChangeAI && (
                <button
                  type="button"
                  className={`header-action-btn ${showAiSettings ? 'active' : ''}`}
                  onClick={() => setShowAiSettings((prev) => !prev)}
                  title={showAiSettings ? 'Close AI Settings' : 'AI Models & Settings'}
                  aria-label="AI Settings"
                >
                  <Settings2 size={14} />
                </button>
              )}

              {/* Pop out to separate OS window (drag to another monitor) */}
              <button
                type="button"
                className="header-action-btn"
                onClick={handlePopOutToExternalWindow}
                title="Pop out to separate window (drag to another screen/monitor)"
                aria-label="Pop out window"
              >
                <ExternalLink size={14} />
              </button>

              {/* Clear chat */}
              <button
                type="button"
                className="header-action-btn"
                onClick={onClearChat}
                title="Clear conversation"
                aria-label="Clear conversation"
                disabled={messages.length === 0}
              >
                <Trash2 size={14} />
              </button>

              {/* Maximize / Restore */}
              <button
                type="button"
                className="header-action-btn"
                onClick={handleToggleMaximize}
                title={isMaximized ? 'Restore window size' : 'Expand to fit screen'}
                aria-label={isMaximized ? 'Restore window size' : 'Expand window'}
              >
                {isMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </button>

              {/* Minimize to bottom-right circle */}
              <button
                type="button"
                className="header-action-btn"
                onClick={onToggle}
                title="Minimize to floating circle"
                aria-label="Minimize chat panel"
              >
                <Minus size={15} />
              </button>

              {/* Close window */}
              <button
                type="button"
                className="header-action-btn close-btn"
                onClick={() => {
                  if (isDetached && onCloseDetached) {
                    onCloseDetached()
                  } else {
                    onToggle()
                  }
                }}
                title="Close window"
                aria-label="Close chat panel"
              >
                <X size={15} />
              </button>
            </div>
          </div>

          {/* Multi-Chat Thread Switcher & New Chat Bar (saves tokens per topic) */}
          {threads && onCreateThread && onSelectThread && (
            <div className="chat-thread-bar" ref={threadMenuRef} onPointerDown={(e) => e.stopPropagation()}>
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
                    {messages.length} msgs · ~{estimatedCtxTokens} tok
                  </span>
                  <ChevronDown size={12} />
                </button>

                {threadMenuOpen && (
                  <div className="chat-thread-dropdown glass">
                    <div className="chat-thread-dropdown-hdr">
                      <span>Project Chats ({threads.length})</span>
                      <span className="chat-thread-hint">10-msg context window</span>
                    </div>
                    <div className="chat-thread-dropdown-list">
                      {threads.map((t) => {
                        const isCur = t.id === (activeThread?.id || activeThreadId)
                        const isEditing = editingThreadId === t.id
                        return (
                          <div
                            key={t.id}
                            className={`chat-thread-item ${isCur ? 'active' : ''}`}
                            onClick={() => {
                              if (!isEditing) {
                                onSelectThread(t.id)
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
                                    onRenameThread?.(t.id, threadTitleDraft.trim())
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
                                  {onRenameThread && (
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
                                  )}
                                  {onDeleteThread && threads.length > 1 && (
                                    <button
                                      type="button"
                                      className="danger"
                                      title="Delete chat"
                                      onClick={() => onDeleteThread(t.id)}
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
                  onCreateThread()
                  setThreadMenuOpen(false)
                }}
                title="Start a new fresh chat in this project to save tokens"
              >
                <Plus size={12} />
                <span>New Chat</span>
              </button>
            </div>
          )}

          {/* Dedicated Accessible Feature Quick-Bar */}
          {(onGenerateTutorial || onOpenKnowledgeHub) && (
            <div className="chat-feature-bar" onPointerDown={(e) => e.stopPropagation()}>
              {onGenerateTutorial && (
                <button
                  type="button"
                  className={`chat-feature-pill ${showTutorialInput ? 'active' : ''}`}
                  disabled={!isAiConfigured}
                  onClick={() => isAiConfigured && setShowTutorialInput((v) => !v)}
                  title={
                    isAiConfigured
                      ? 'Create structured visual tutorial with explanations & diagrams on the board'
                      : 'Configure AI Settings to generate visual tutorials'
                  }
                >
                  <Layout size={13} />
                  <span>Create Tutorial</span>
                </button>
              )}
              {onOpenKnowledgeHub && (
                <button
                  type="button"
                  className="chat-feature-pill notebook"
                  onClick={onOpenKnowledgeHub}
                  title="Open Multi-Source Knowledge Studio & Board Recall"
                >
                  <BookOpen size={13} />
                  <span>Knowledge Studio</span>
                </button>
              )}
            </div>
          )}

          {/* Inline Tutorial Generator Topic Bar */}
          {showTutorialInput && isAiConfigured && onGenerateTutorial && (
            <div className="tutorial-popover-bar" onPointerDown={(e) => e.stopPropagation()}>
              <div className="tutorial-popover-row">
                <Layout size={14} style={{ color: '#38bdf8', flexShrink: 0 }} />
                <input
                  type="text"
                  value={tutorialTopic}
                  onChange={(e) => setTutorialTopic(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleTriggerTutorial()}
                  placeholder="Topic to teach visually (e.g. Transformer Attention, Microservices)..."
                />
                <button
                  type="button"
                  className="tutorial-go-btn"
                  onClick={handleTriggerTutorial}
                  disabled={isAiBusy}
                >
                  Create
                </button>
              </div>
              <div className="tutorial-quick-chips">
                {['Current Board Topic', 'Transformer Self-Attention', 'Distributed Caching'].map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      onGenerateTutorial(t)
                      setShowTutorialInput(false)
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* AI Settings Sub-panel inside Chat */}
          {showAiSettings && aiSettings && onChangeAI && (
            <ChatAiSettings
              ai={aiSettings}
              onChangeAI={onChangeAI}
              onClose={() => setShowAiSettings(false)}
              onToast={onToast}
            />
          )}

          {/* Unconfigured AI Notice */}
          {!isAiConfigured && !showAiSettings && (
            <div className="ai-setup-banner compact" onPointerDown={(e) => e.stopPropagation()}>
              <div className="ai-setup-banner-copy">
                <strong>AI Features Disabled</strong>
                <span>
                  {aiUnconfiguredReason || 'Configure Ollama or a Cloud API key to enable AI Chat, OCR, Beautify, and Synthesis.'}
                </span>
              </div>
              {aiSettings && onChangeAI && (
                <button
                  type="button"
                  className="ai-setup-banner-btn"
                  onClick={() => setShowAiSettings(true)}
                >
                  <Settings2 size={13} />
                  <span>Configure AI</span>
                </button>
              )}
            </div>
          )}

          {/* Conversation list */}
          <div ref={messagesScrollRef} className="chat-messages-scroll">
            {messages.length === 0 ? (
              <div className="chat-empty-state">
                <div className="empty-sparkle-icon">
                  <Sparkles size={28} />
                </div>
                <h4>Ask AI anything</h4>
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

                    {/* Action buttons on AI responses */}
                    {m.role === 'assistant' && (
                      <div className="chat-bubble-actions">
                        <button
                          type="button"
                          className="bubble-action-btn primary"
                          onClick={() => onInsertToNotes(m.content)}
                          title="Insert as a movable note card on the canvas"
                        >
                          <PlusSquare size={13} />
                          <span>Add to Notes</span>
                        </button>
                        <button
                          type="button"
                          className="bubble-action-btn"
                          disabled={!isAiConfigured}
                          onClick={() => isAiConfigured && onInsertDiagram(m.content)}
                          title={
                            isAiConfigured
                              ? 'Generate interactive React Flow diagram and place on whiteboard'
                              : 'Configure AI Settings to generate diagrams'
                          }
                        >
                          <Network size={13} />
                          <span>Create Diagram</span>
                        </button>
                        {onGenerateTutorial && (
                          <button
                            type="button"
                            className="bubble-action-btn"
                            disabled={!isAiConfigured}
                            onClick={() => isAiConfigured && onGenerateTutorial(m.content.slice(0, 800))}
                            title={
                              isAiConfigured
                                ? 'Convert this response into a structured visual tutorial on the board'
                                : 'Configure AI Settings to generate tutorials'
                            }
                          >
                            <Layout size={13} />
                            <span>To Tutorial</span>
                          </button>
                        )}
                        <button
                          type="button"
                          className="bubble-action-btn ghost"
                          onClick={() => handleCopy(m.id, m.content)}
                          title="Copy response"
                          aria-label="Copy response"
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
              ref={imageInputRef}
              accept="image/*"
              multiple
              style={{ display: 'none' }}
              onChange={handleImageFileChange}
            />
            <input
              type="file"
              ref={fileInputRef}
              accept=".pdf,.txt,.md,.markdown,.json,.csv,.ts,.tsx,.js,.jsx,.py,.html,.css"
              multiple
              style={{ display: 'none' }}
              onChange={handleDocumentFilesSelected}
            />

            {/* YouTube Quick Attach Input Bar */}
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

            {/* Pinned Knowledge Studio Book References */}
            <ChatPinnedSourcesBar
              pinnedSources={knowledge.pinnedSources}
              onRemove={knowledge.removePinnedSource}
            />

            {/* Attached Context Pills */}
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
                    {att.tokenEstimate ? (
                      <span className="chat-attachment-tokens">~{att.tokenEstimate}t</span>
                    ) : null}
                    {att.type === 'youtube' && att.url && onAddYouTubeToCanvas && (
                      <button
                        type="button"
                        className="chat-attachment-pin-btn"
                        onClick={() => onAddYouTubeToCanvas(att.url!, att.name)}
                        title="Embed YouTube Player directly on board"
                      >
                        Pin
                      </button>
                    )}
                    <button
                      type="button"
                      className="chat-attachment-remove-btn"
                      onClick={() => removeAttachment(att.id)}
                      title="Remove attachment"
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
                onOpenKnowledgeHub={onOpenKnowledgeHub}
              />
              <textarea
                ref={textareaRef}
                className="chat-textarea"
                value={input}
                disabled={!isAiConfigured}
                onChange={(e) => {
                  setInput(e.target.value)
                  knowledge.detectAtMention(e.target.value, e.target.selectionStart)
                }}
                onKeyDown={handleKeyDown}
                placeholder={
                  isAiConfigured
                    ? 'Ask a question, type @ to cite a book, or upload files... (Enter to send)'
                    : 'Configure AI Settings to enable AI chat...'
                }
                rows={1}
              />
              <div className="chat-input-controls">
                <div className="chat-attach-group">
                  <button
                    type="button"
                    className="chat-attach-btn"
                    disabled={!isAiConfigured}
                    onClick={handleAddFileAttachment}
                    title={
                      isAiConfigured
                        ? 'Attach Document (PDF, Code, Text, Markdown)'
                        : 'Configure AI Settings first'
                    }
                    aria-label="Attach File"
                  >
                    <Paperclip size={13} />
                    <span>File</span>
                  </button>

                  <button
                    type="button"
                    className="chat-attach-btn"
                    disabled={!isAiConfigured}
                    onClick={() => imageInputRef.current?.click()}
                    title={
                      isAiConfigured
                        ? 'Attach Image / Screenshot'
                        : 'Configure AI Settings first'
                    }
                    aria-label="Attach Image"
                  >
                    <ImageIcon size={13} />
                    <span>Image</span>
                  </button>

                  <button
                    type="button"
                    className={`chat-attach-btn yt ${showYtInput ? 'active' : ''}`}
                    disabled={!isAiConfigured}
                    onClick={() => setShowYtInput(!showYtInput)}
                    title={
                      isAiConfigured
                        ? 'Attach YouTube Video Transcript'
                        : 'Configure AI Settings first'
                    }
                    aria-label="Attach YouTube Link"
                  >
                    <Video size={13} />
                    <span>YouTube</span>
                  </button>

                  <ChatSourceContextControls
                    state={knowledge}
                    hasProject={Boolean(projectId)}
                    onOpenKnowledgeHub={onOpenKnowledgeHub}
                  />
                </div>

                <button
                  type="button"
                  className="chat-send-btn"
                  onClick={() => handleSend()}
                  disabled={!isAiConfigured || (!input.trim() && attachments.length === 0) || isAiBusy}
                  title={isAiConfigured ? 'Send (Enter)' : 'Configure AI Settings to send messages'}
                  aria-label="Send message"
                >
                  <Send size={15} />
                </button>
              </div>
            </div>
          </div>

          {/* Resize handles (only when not maximized) */}
          {!isMaximized && (
            <>
              {/* Bottom Right Corner Grip */}
              <div
                className="floating-ai-resize-grip"
                onPointerDown={(e) => handleResizePointerDown(e, 'se')}
                onPointerMove={handleResizePointerMove}
                onPointerUp={handleResizePointerUp}
                title="Drag to resize window"
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M9 1L1 9M9 5L5 9M9 9L9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </div>
              {/* Right Edge */}
              <div
                className="floating-ai-edge-resize r"
                onPointerDown={(e) => handleResizePointerDown(e, 'e')}
                onPointerMove={handleResizePointerMove}
                onPointerUp={handleResizePointerUp}
              />
              {/* Bottom Edge */}
              <div
                className="floating-ai-edge-resize b"
                onPointerDown={(e) => handleResizePointerDown(e, 's')}
                onPointerMove={handleResizePointerMove}
                onPointerUp={handleResizePointerUp}
              />
              {/* Left Edge */}
              <div
                className="floating-ai-edge-resize w"
                onPointerDown={(e) => handleResizePointerDown(e, 'w')}
                onPointerMove={handleResizePointerMove}
                onPointerUp={handleResizePointerUp}
              />
            </>
          )}
        </aside>
      )}
    </>
  )
}
