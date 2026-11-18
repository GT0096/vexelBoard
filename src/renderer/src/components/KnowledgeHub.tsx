import React, { useState, useEffect, useRef } from 'react'
import {
  BookOpen,
  FileText,
  Video,
  Plus,
  Trash2,
  HelpCircle,
  Headphones,
  Layout,
  Clock,
  Sparkles,
  X,
  Compass,
  ArrowRight,
  Search
} from 'lucide-react'
import type { KnowledgeSourceItem } from '@shared/ipc'

interface KnowledgeHubProps {
  isOpen: boolean
  boardId?: string
  projectId?: string
  onClose: () => void
  onGenerateTutorial: (topic: string) => void
  onAddYouTubeToCanvas: (url: string, title?: string) => void
  getCurrentBoardSummary: () => string
  onToast?: (kind: 'info' | 'success' | 'error', message: string) => void
  isAiBusy: boolean
  onRunAction: (
    actionType: 'study_guide' | 'faq' | 'podcast' | 'recall' | 'patterns',
    customQuery?: string,
    activeSourceIds?: string[]
  ) => Promise<void>
}

export const KnowledgeHub: React.FC<KnowledgeHubProps> = ({
  isOpen,
  boardId,
  projectId,
  onClose,
  onGenerateTutorial,
  onAddYouTubeToCanvas,
  getCurrentBoardSummary,
  onToast,
  isAiBusy,
  onRunAction
}) => {
  const [sources, setSources] = useState<KnowledgeSourceItem[]>([])
  const [loading, setLoading] = useState(false)
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [showAddYoutube, setShowAddYoutube] = useState(false)
  const [tutorialTopicInput, setTutorialTopicInput] = useState('')
  const [customRecallQuery, setCustomRecallQuery] = useState('')
  const [activeTab, setActiveTab] = useState<'sources' | 'synthesis' | 'spatial'>('sources')
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      loadSources()
    }
  }, [isOpen, boardId, projectId])

  const loadSources = async (): Promise<void> => {
    if (!window.glassAPI?.getKnowledgeSources) return
    try {
      setLoading(true)
      const data = await window.glassAPI.getKnowledgeSources(boardId, projectId)
      setSources(data.map((s) => ({ ...s, isActive: true })))
    } catch (err) {
      console.warn('Failed to load sources from SQLite:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleToggleSource = (id: string): void => {
    setSources((prev) => prev.map((s) => (s.id === id ? { ...s, isActive: !s.isActive } : s)))
  }

  const handleDeleteSource = async (id: string): Promise<void> => {
    if (window.glassAPI?.deleteKnowledgeSource) {
      await window.glassAPI.deleteKnowledgeSource(id)
      setSources((prev) => prev.filter((s) => s.id !== id))
      window.dispatchEvent(new CustomEvent('vexelboard:sources-changed'))
      onToast?.('info', 'Source removed from knowledge base')
    }
  }

  const indexParsedDocument = async (parsed: any): Promise<void> => {
    if (!parsed || !parsed.ok) {
      onToast?.('error', parsed?.error || 'Could not parse uploaded file.')
      return
    }
    const sourceId = `src-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const text = parsed.text || ''
    const newSource: KnowledgeSourceItem = {
      id: sourceId,
      boardId,
      title: parsed.fileName,
      sourceType: parsed.fileType === 'pdf' ? 'pdf' : 'file',
      rawContent: text,
      tokenCount: Math.round(text.length / 4),
      createdAt: Date.now(),
      isActive: true
    }

    const chunks = (parsed.chunks || []).map((c: any) => ({
      id: `chunk-${sourceId}-${c.chunkIndex}`,
      sourceId,
      chunkIndex: c.chunkIndex,
      chunkText: c.text,
      metadata: { page: c.page, fileName: parsed.fileName }
    }))

    if (window.glassAPI?.saveKnowledgeSource) {
      await window.glassAPI.saveKnowledgeSource(newSource, chunks)
    }
    setSources((prev) => [newSource, ...prev])
    window.dispatchEvent(new CustomEvent('vexelboard:sources-changed'))
    onToast?.('success', `Indexed "${parsed.fileName}" (${chunks.length} chunks)`)
  }

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return

    setLoading(true)
    try {
      for (const file of files) {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result || ''))
          reader.onerror = () => reject(reader.error)
          reader.readAsDataURL(file)
        })

        if (window.glassAPI?.parseFileBuffer) {
          const parsed = await window.glassAPI.parseFileBuffer(file.name, base64)
          await indexParsedDocument(parsed)
        } else {
          const text = await file.text()
          await indexParsedDocument({
            ok: true,
            fileName: file.name,
            fileType: file.name.split('.').pop() || 'txt',
            text,
            chunks: [{ text, chunkIndex: 0 }]
          })
        }
      }
    } catch (err: any) {
      onToast?.('error', `File upload failed: ${err?.message || err}`)
    } finally {
      setLoading(false)
      e.target.value = ''
    }
  }

  const handleAddYouTubeSource = async (): Promise<void> => {
    if (!youtubeUrl.trim() || !window.glassAPI?.fetchYouTubeInfo) return
    try {
      setLoading(true)
      const info = await window.glassAPI.fetchYouTubeInfo(youtubeUrl.trim())
      if (!info.ok) {
        onToast?.('error', info.error || 'Failed to fetch YouTube video.')
        return
      }

      const sourceId = `yt-${info.videoId}-${Date.now()}`
      const newSource: KnowledgeSourceItem = {
        id: sourceId,
        boardId,
        title: info.title,
        sourceType: 'youtube',
        sourceUrl: `https://www.youtube.com/watch?v=${info.videoId}`,
        rawContent: info.fullText,
        tokenCount: Math.round(info.fullText.length / 4),
        createdAt: Date.now(),
        isActive: true
      }

      const chunks = (info.chunks || []).map((c: any, idx: number) => ({
        id: `chunk-${sourceId}-${idx}`,
        sourceId,
        chunkIndex: idx,
        chunkText: c.text,
        metadata: { start: c.start, end: c.end, title: info.title }
      }))

      if (window.glassAPI?.saveKnowledgeSource) {
        await window.glassAPI.saveKnowledgeSource(newSource, chunks)
      }
      setSources((prev) => [newSource, ...prev])
      window.dispatchEvent(new CustomEvent('vexelboard:sources-changed'))
      setYoutubeUrl('')
      setShowAddYoutube(false)
      onToast?.('success', `Indexed YouTube video: "${info.title}"`)
    } catch (err: any) {
      onToast?.('error', `Error fetching video: ${err?.message || err}`)
    } finally {
      setLoading(false)
    }
  }

  const handleAddWhiteboardAsSource = async (): Promise<void> => {
    const summary = getCurrentBoardSummary()
    if (!summary.trim() || summary === 'Whiteboard is currently empty.') {
      onToast?.('info', 'Whiteboard is currently empty. Add notes or diagrams first.')
      return
    }

    const sourceId = `board-${Date.now()}`
    const newSource: KnowledgeSourceItem = {
      id: sourceId,
      boardId,
      title: `Whiteboard Snapshot (${new Date().toLocaleTimeString()})`,
      sourceType: 'board',
      rawContent: summary,
      tokenCount: Math.round(summary.length / 4),
      createdAt: Date.now(),
      isActive: true
    }

    const chunks = [
      {
        id: `chunk-${sourceId}-0`,
        sourceId,
        chunkIndex: 0,
        chunkText: summary,
        metadata: { type: 'board_snapshot' }
      }
    ]

    if (window.glassAPI?.saveKnowledgeSource) {
      await window.glassAPI.saveKnowledgeSource(newSource, chunks)
    }
    setSources((prev) => [newSource, ...prev])
    window.dispatchEvent(new CustomEvent('vexelboard:sources-changed'))
    onToast?.('success', 'Indexed current whiteboard into knowledge base!')
  }

  const activeSourceIds = sources.filter((s) => s.isActive).map((s) => s.id)

  if (!isOpen) return null

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card knowledge-hub-modal" onClick={(e) => e.stopPropagation()}>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.txt,.md,.markdown,.json,.csv,.ts,.tsx,.js,.jsx,.py,.html,.css"
          style={{ display: 'none' }}
          onChange={handleFileInputChange}
        />

        {/* Header */}
        <div className="modal-header knowledge-hub-header">
          <div className="modal-title-wrap">
            <div className="knowledge-hub-brand-icon">
              <BookOpen size={20} />
            </div>
            <div>
              <div className="knowledge-hub-title-row">
                <h2>Knowledge Studio</h2>
                <span className="knowledge-hub-badge">SQLite-Vec RAG</span>
              </div>
              <p className="knowledge-hub-subtitle">
                Upload multiple documents &amp; YouTube links to study, synthesize, and recall board concepts
              </p>
            </div>
          </div>

          <button type="button" className="icon-btn-ghost" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>

        {/* Tab Bar */}
        <div className="knowledge-hub-tabs">
          <button
            type="button"
            className={`knowledge-hub-tab-btn ${activeTab === 'sources' ? 'active' : ''}`}
            onClick={() => setActiveTab('sources')}
          >
            <BookOpen size={14} />
            <span>Knowledge Sources ({sources.length})</span>
          </button>

          <button
            type="button"
            className={`knowledge-hub-tab-btn ${activeTab === 'synthesis' ? 'active' : ''}`}
            onClick={() => setActiveTab('synthesis')}
          >
            <Sparkles size={14} />
            <span>Knowledge Synthesis</span>
          </button>

          <button
            type="button"
            className={`knowledge-hub-tab-btn ${activeTab === 'spatial' ? 'active' : ''}`}
            onClick={() => setActiveTab('spatial')}
          >
            <Compass size={14} />
            <span>Board Recall &amp; Patterns</span>
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="knowledge-hub-body">
          {activeTab === 'sources' && (
            <div className="knowledge-hub-section">
              <div className="knowledge-hub-toolbar">
                <span className="knowledge-hub-hint">
                  Checked sources ground your Study Guides, Tutorials, and Chat Q&amp;A.
                </span>

                <div className="knowledge-hub-toolbar-actions">
                  <button
                    type="button"
                    className="knowledge-hub-btn"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={loading}
                  >
                    <Plus size={14} />
                    <span>Upload File / PDF</span>
                  </button>

                  <button
                    type="button"
                    className="knowledge-hub-btn danger"
                    onClick={() => setShowAddYoutube((v) => !v)}
                  >
                    <Video size={14} />
                    <span>Add YouTube Link</span>
                  </button>

                  <button
                    type="button"
                    className="knowledge-hub-btn accent"
                    onClick={handleAddWhiteboardAsSource}
                  >
                    <Layout size={14} />
                    <span>Index Whiteboard</span>
                  </button>
                </div>
              </div>

              {showAddYoutube && (
                <div className="knowledge-hub-yt-bar">
                  <Video size={16} className="yt-icon" />
                  <input
                    type="text"
                    value={youtubeUrl}
                    onChange={(e) => setYoutubeUrl(e.target.value)}
                    placeholder="Paste YouTube URL (e.g. https://www.youtube.com/watch?v=...)"
                    onKeyDown={(e) => e.key === 'Enter' && handleAddYouTubeSource()}
                  />
                  <button
                    type="button"
                    className="knowledge-hub-btn solid-danger"
                    onClick={handleAddYouTubeSource}
                    disabled={loading || !youtubeUrl.trim()}
                  >
                    {loading ? 'Indexing...' : 'Index Video'}
                  </button>
                </div>
              )}

              <div className="knowledge-hub-source-list">
                {sources.length === 0 ? (
                  <div className="knowledge-hub-empty">
                    <BookOpen size={34} />
                    <h4>No knowledge sources indexed yet</h4>
                    <p>
                      Upload PDFs, lecture notes, code files, or paste YouTube links to build your
                      local Knowledge Studio library.
                    </p>
                  </div>
                ) : (
                  sources.map((src) => (
                    <div
                      key={src.id}
                      className={`knowledge-hub-source-card ${src.isActive ? '' : 'inactive'}`}
                    >
                      <div className="knowledge-hub-source-left">
                        <input
                          type="checkbox"
                          checked={Boolean(src.isActive)}
                          onChange={() => handleToggleSource(src.id)}
                          title="Toggle source in RAG context"
                        />

                        <div className="knowledge-hub-source-icon">
                          {src.sourceType === 'youtube' ? (
                            <Video size={16} style={{ color: '#f87171' }} />
                          ) : src.sourceType === 'pdf' ? (
                            <FileText size={16} style={{ color: '#fbbf24' }} />
                          ) : src.sourceType === 'board' ? (
                            <Layout size={16} style={{ color: '#38bdf8' }} />
                          ) : (
                            <FileText size={16} style={{ color: '#34d399' }} />
                          )}
                        </div>

                        <div className="knowledge-hub-source-meta">
                          <div className="knowledge-hub-source-title">{src.title}</div>
                          <div className="knowledge-hub-source-sub">
                            <span>{src.sourceType.toUpperCase()}</span>
                            <span>•</span>
                            <span>~{src.tokenCount || 0} tokens</span>
                            <span>•</span>
                            <span>{new Date(src.createdAt).toLocaleDateString()}</span>
                          </div>
                        </div>
                      </div>

                      <div className="knowledge-hub-source-actions">
                        {src.sourceType === 'youtube' && src.sourceUrl && (
                          <button
                            type="button"
                            className="knowledge-hub-btn danger"
                            onClick={() => {
                              onAddYouTubeToCanvas(src.sourceUrl!, src.title)
                              onClose()
                            }}
                            title="Open playable YouTube card on the whiteboard"
                          >
                            <Video size={12} />
                            <span>Pin to Board</span>
                          </button>
                        )}
                        <button
                          type="button"
                          className="icon-btn-ghost danger"
                          onClick={() => handleDeleteSource(src.id)}
                          title="Delete source"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {activeTab === 'synthesis' && (
            <div className="knowledge-hub-section">
              <div className="knowledge-hub-section-hdr">
                <h3>1-Click Synthesis Studio</h3>
                <p>
                  Generate study materials grounded in your {activeSourceIds.length} active source
                  {activeSourceIds.length === 1 ? '' : 's'} and whiteboard context.
                </p>
              </div>

              <div className="knowledge-hub-grid">
                <div className="knowledge-hub-action-card">
                  <div className="action-card-top">
                    <div className="action-card-icon blue">
                      <BookOpen size={17} />
                    </div>
                    <h4>Generate Study Guide</h4>
                    <p>
                      Creates a structured markdown study guide with core concepts, terminology,
                      and takeaways directly on your board.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="knowledge-hub-action-btn blue"
                    disabled={isAiBusy || (activeSourceIds.length === 0 && getCurrentBoardSummary() === 'Whiteboard is currently empty.')}
                    onClick={() => {
                      onRunAction('study_guide', undefined, activeSourceIds)
                      onClose()
                    }}
                  >
                    <Sparkles size={14} />
                    <span>Create Study Guide</span>
                  </button>
                </div>

                <div className="knowledge-hub-action-card">
                  <div className="action-card-top">
                    <div className="action-card-icon purple">
                      <HelpCircle size={17} />
                    </div>
                    <h4>FAQ &amp; Practice Quiz</h4>
                    <p>
                      Generates active-recall practice questions and detailed rationales based on
                      your uploaded materials.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="knowledge-hub-action-btn purple"
                    disabled={isAiBusy || (activeSourceIds.length === 0 && getCurrentBoardSummary() === 'Whiteboard is currently empty.')}
                    onClick={() => {
                      onRunAction('faq', undefined, activeSourceIds)
                      onClose()
                    }}
                  >
                    <Sparkles size={14} />
                    <span>Create FAQ &amp; Quiz</span>
                  </button>
                </div>

                <div className="knowledge-hub-action-card">
                  <div className="action-card-top">
                    <div className="action-card-icon emerald">
                      <Headphones size={17} />
                    </div>
                    <h4>Podcast Overview Script</h4>
                    <p>
                      Creates an intuitive two-host conversation breaking down complex ideas from
                      your sources.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="knowledge-hub-action-btn emerald"
                    disabled={isAiBusy || (activeSourceIds.length === 0 && getCurrentBoardSummary() === 'Whiteboard is currently empty.')}
                    onClick={() => {
                      onRunAction('podcast', undefined, activeSourceIds)
                      onClose()
                    }}
                  >
                    <Sparkles size={14} />
                    <span>Create Audio Script</span>
                  </button>
                </div>

                <div className="knowledge-hub-action-card highlighted">
                  <div className="action-card-top">
                    <div className="action-card-icon sky">
                      <Layout size={17} />
                    </div>
                    <h4>Visual Whiteboard Tutorial</h4>
                    <p>
                      Builds a step-by-step visual tutorial with explanation cards, interactive
                      diagrams, and formulas on the board.
                    </p>
                    <input
                      type="text"
                      className="knowledge-hub-topic-input"
                      value={tutorialTopicInput}
                      onChange={(e) => setTutorialTopicInput(e.target.value)}
                      placeholder="Enter topic (or leave blank for active sources)..."
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          onGenerateTutorial(tutorialTopicInput.trim() || 'Active Knowledge Sources')
                          onClose()
                        }
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    className="knowledge-hub-action-btn sky"
                    disabled={isAiBusy}
                    onClick={() => {
                      onGenerateTutorial(tutorialTopicInput.trim() || 'Active Knowledge Sources')
                      onClose()
                    }}
                  >
                    <ArrowRight size={14} />
                    <span>Teach on Whiteboard</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'spatial' && (
            <div className="knowledge-hub-section">
              <div className="knowledge-hub-section-hdr">
                <h3>Board as Context &amp; Spatial Recall</h3>
                <p>
                  Ask how you arrived at a section of your board, or let AI discover conceptual
                  patterns and relationships across everything you created.
                </p>
              </div>

              <div className="knowledge-hub-yt-bar" style={{ borderColor: 'rgba(56, 189, 248, 0.35)' }}>
                <Search size={16} style={{ color: '#38bdf8' }} />
                <input
                  type="text"
                  value={customRecallQuery}
                  onChange={(e) => setCustomRecallQuery(e.target.value)}
                  placeholder="Ask about your board (e.g. 'How do my notes relate to this diagram?' or 'Why did I add Redis?')"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && customRecallQuery.trim()) {
                      onRunAction('recall', customRecallQuery.trim(), activeSourceIds)
                      onClose()
                    }
                  }}
                />
                <button
                  type="button"
                  className="knowledge-hub-action-btn sky"
                  style={{ width: 'auto', padding: '7px 14px' }}
                  disabled={isAiBusy || !customRecallQuery.trim()}
                  onClick={() => {
                    onRunAction('recall', customRecallQuery.trim(), activeSourceIds)
                    onClose()
                  }}
                >
                  <span>Ask Board</span>
                </button>
              </div>

              <div className="knowledge-hub-grid">
                <div className="knowledge-hub-action-card">
                  <div className="action-card-top">
                    <div className="action-card-icon amber">
                      <Clock size={17} />
                    </div>
                    <h4>&ldquo;How Did I Get Here?&rdquo; (Recall)</h4>
                    <p>
                      Reconstructs the chronological sequence of your notes, diagrams, and edits to
                      refresh your context when returning later.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="knowledge-hub-action-btn amber"
                    disabled={isAiBusy}
                    onClick={() => {
                      onRunAction('recall', undefined, activeSourceIds)
                      onClose()
                    }}
                  >
                    <Compass size={14} />
                    <span>Trace Line of Thought</span>
                  </button>
                </div>

                <div className="knowledge-hub-action-card">
                  <div className="action-card-top">
                    <div className="action-card-icon teal">
                      <Sparkles size={17} />
                    </div>
                    <h4>Find Patterns &amp; Concept Links</h4>
                    <p>
                      Analyzes notes, equations, code, and diagrams across the board to explain how
                      ideas relate and surface hidden connections.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="knowledge-hub-action-btn teal"
                    disabled={isAiBusy}
                    onClick={() => {
                      onRunAction('patterns', undefined, activeSourceIds)
                      onClose()
                    }}
                  >
                    <Sparkles size={14} />
                    <span>Synthesize Concept Map</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
