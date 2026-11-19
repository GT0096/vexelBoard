import React, { useState, useRef, useMemo } from 'react'
import {
  Play,
  Trash2,
  Plus,
  FileText,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  GripHorizontal,
  Copy,
  X,
  Link2,
  Sparkles,
  Clock
} from 'lucide-react'
import type { VideoNode, VideoTabItem } from '../types/board'
import type { ResizeDirection } from './CanvasElements'

export interface CanvasVideoCardProps {
  node: VideoNode
  isSelected: boolean
  isResizing?: boolean
  disabledPointerEvents?: boolean
  onSelect: () => void
  onUpdate: (patch: Partial<VideoNode>, opts?: { history?: boolean }) => void
  onDelete: () => void
  onDuplicate: () => void
  onAddContainer?: () => void
  onStartMove: (startX: number, startY: number) => void
  onStartResize?: (e: React.PointerEvent, dir: ResizeDirection) => void
  onAddTimestampNote: (timestampSec: number, videoTitle: string, videoUrl: string) => void
  onCreateTutorialFromVideo?: (topic: string, transcriptText?: string) => void
  isAiConfigured?: boolean
  onToast?: (kind: 'info' | 'success' | 'error', message: string) => void
}

function extractVideoIdClient(urlOrId: string): string | null {
  if (!urlOrId) return null
  const trimmed = urlOrId.trim()
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed
  const match = trimmed.match(
    /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/|live\/))([a-zA-Z0-9_-]{11})/
  )
  return match ? match[1] : null
}

function formatSec(secs: number): string {
  const safe = Math.max(0, Math.floor(secs))
  const m = Math.floor(safe / 60)
  const s = safe % 60
  return `${m}:${s < 10 ? '0' : ''}${s}`
}

export const CanvasVideoCard: React.FC<CanvasVideoCardProps> = ({
  node,
  isSelected,
  isResizing = false,
  disabledPointerEvents = false,
  onSelect,
  onUpdate,
  onDelete,
  onDuplicate,
  onAddContainer,
  onStartMove,
  onStartResize,
  onAddTimestampNote,
  onCreateTutorialFromVideo,
  isAiConfigured = true,
  onToast
}) => {
  const tabs: VideoTabItem[] = useMemo(() => {
    if (node.tabs && node.tabs.length > 0) return node.tabs
    return [
      {
        id: 'vtab-default',
        title: node.title || (node.videoId ? `Video (${node.videoId})` : 'New Video'),
        url: node.url || '',
        videoId: node.videoId || '',
        currentTime: node.currentTime || 0
      }
    ]
  }, [node.tabs, node.title, node.url, node.videoId, node.currentTime])

  const activeTab = useMemo(
    () => tabs.find((t) => t.id === node.activeTabId) || tabs[0],
    [tabs, node.activeTabId]
  )

  const [isHovered, setIsHovered] = useState(false)
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(node.title || 'YouTube Study Hub')
  const [urlInput, setUrlInput] = useState(activeTab?.url || '')
  const [showTranscript, setShowTranscript] = useState(false)
  const [transcriptMap, setTranscriptMap] = useState<
    Record<string, Array<{ text: string; start: number; duration: number }>>
  >({})
  const [loadingTranscript, setLoadingTranscript] = useState(false)
  const [seekInput, setSeekInput] = useState(String(activeTab?.currentTime || 0))
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const activeTranscript = transcriptMap[activeTab?.videoId || ''] || []
  const currentSec = activeTab?.currentTime || 0

  const syncTabs = (nextTabs: VideoTabItem[], nextActiveId?: string): void => {
    const resolvedActiveId = nextActiveId || activeTab.id
    const cur = nextTabs.find((t) => t.id === resolvedActiveId) || nextTabs[0]
    onUpdate(
      {
        tabs: nextTabs,
        activeTabId: cur?.id,
        url: cur?.url || '',
        videoId: cur?.videoId || '',
        currentTime: cur?.currentTime || 0
      },
      { history: false }
    )
  }

  const handleLoadUrl = async (): Promise<void> => {
    const raw = urlInput.trim()
    const vid = extractVideoIdClient(raw)
    if (!vid) {
      onToast?.('error', 'Please paste a valid YouTube link or 11-character Video ID.')
      return
    }
    const cleanUrl = raw.startsWith('http') ? raw : `https://www.youtube.com/watch?v=${vid}`
    let resolvedTitle = `YouTube (${vid})`

    const updatedTabs = tabs.map((t) =>
      t.id === activeTab.id ? { ...t, url: cleanUrl, videoId: vid, title: resolvedTitle, currentTime: 0 } : t
    )
    syncTabs(updatedTabs, activeTab.id)
    setSeekInput('0')

    if (window.glassAPI?.fetchYouTubeInfo) {
      try {
        setLoadingTranscript(true)
        const info = await window.glassAPI.fetchYouTubeInfo(cleanUrl)
        if (info?.ok) {
          resolvedTitle = info.title || resolvedTitle
          if (Array.isArray(info.transcript) && info.transcript.length > 0) {
            setTranscriptMap((prev) => ({ ...prev, [vid]: info.transcript }))
          }
          const enrichedTabs = updatedTabs.map((t) =>
            t.id === activeTab.id ? { ...t, title: resolvedTitle } : t
          )
          onUpdate(
            {
              tabs: enrichedTabs,
              activeTabId: activeTab.id,
              url: cleanUrl,
              videoId: vid,
              title: node.title && node.title !== 'YouTube Study Hub' ? node.title : resolvedTitle
            },
            { history: false }
          )
          onToast?.('success', `Loaded "${resolvedTitle}"`)
        }
      } catch {
        /* ignore metadata failure — video still plays */
      } finally {
        setLoadingTranscript(false)
      }
    }
  }

  const handleAddTab = (): void => {
    const newId = `vtab-${Date.now().toString(36)}`
    const newTab: VideoTabItem = {
      id: newId,
      title: `Video ${tabs.length + 1}`,
      url: '',
      videoId: '',
      currentTime: 0
    }
    const nextTabs = [...tabs, newTab]
    syncTabs(nextTabs, newId)
    setUrlInput('')
    setSeekInput('0')
  }

  const handleSelectTab = (tab: VideoTabItem): void => {
    syncTabs(tabs, tab.id)
    setUrlInput(tab.url || '')
    setSeekInput(String(tab.currentTime || 0))
  }

  const handleCloseTab = (tabId: string, e: React.MouseEvent): void => {
    e.stopPropagation()
    if (tabs.length <= 1) return
    const nextTabs = tabs.filter((t) => t.id !== tabId)
    const nextActive = activeTab.id === tabId ? nextTabs[0] : activeTab
    syncTabs(nextTabs, nextActive.id)
    setUrlInput(nextActive.url || '')
    setSeekInput(String(nextActive.currentTime || 0))
  }

  const seekTo = (seconds: number): void => {
    const safeSec = Math.max(0, Math.floor(seconds))
    setSeekInput(String(safeSec))
    const nextTabs = tabs.map((t) => (t.id === activeTab.id ? { ...t, currentTime: safeSec } : t))
    syncTabs(nextTabs, activeTab.id)
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        JSON.stringify({ event: 'command', func: 'seekTo', args: [safeSec, true] }),
        '*'
      )
    }
  }

  const handleToggleTranscript = async (): Promise<void> => {
    if (showTranscript) {
      setShowTranscript(false)
      return
    }
    setShowTranscript(true)
    if (activeTab.videoId && activeTranscript.length === 0 && window.glassAPI?.fetchYouTubeInfo) {
      setLoadingTranscript(true)
      try {
        const info = await window.glassAPI.fetchYouTubeInfo(activeTab.url || activeTab.videoId)
        if (info?.ok && Array.isArray(info.transcript)) {
          setTranscriptMap((prev) => ({ ...prev, [activeTab.videoId]: info.transcript }))
        }
      } catch {
        /* ignore */
      } finally {
        setLoadingTranscript(false)
      }
    }
  }

  const handleCreateTutorial = async (): Promise<void> => {
    if (!onCreateTutorialFromVideo) return
    let transcriptText = activeTranscript.map((t) => t.text).join(' ')
    if (!transcriptText && activeTab.videoId && window.glassAPI?.fetchYouTubeInfo) {
      try {
        const info = await window.glassAPI.fetchYouTubeInfo(activeTab.url || activeTab.videoId)
        if (info?.ok && info.fullText) transcriptText = info.fullText
      } catch {
        /* ignore */
      }
    }
    const topicLabel = activeTab.title || node.title || 'YouTube Lesson'
    onCreateTutorialFromVideo(topicLabel, transcriptText)
  }

  return (
    <div
      id={node.id}
      className={`canvas-video-card ${isSelected ? 'selected' : ''} ${isResizing ? 'resizing' : ''}`}
      style={{
        left: `${node.x}px`,
        top: `${node.y}px`,
        width: `${node.w || 540}px`,
        height: `${node.h || 460}px`,
        pointerEvents: disabledPointerEvents ? 'none' : 'auto'
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onPointerDown={(e) => {
        if (disabledPointerEvents) return
        e.stopPropagation()
        onSelect()
        const targetEl = e.target as HTMLElement | null
        const isInteractive = Boolean(
          targetEl?.closest(
            'iframe, input, textarea, button, select, a, .video-transcript-drawer, .card-resize-handles, .resize-edge, .resize-handle, .resize-corner-grip'
          )
        )
        if (!isInteractive && e.button === 0) {
          onStartMove(e.clientX, e.clientY)
        }
      }}
    >
      {/* Card Header */}
      <div className="canvas-video-card-header" title="Drag header to move video container">
        <div className="canvas-video-card-drag">
          <span className="video-card-move-pill" title="Drag to move container">
            <GripHorizontal size={13} />
            <span>Move</span>
          </span>
          <Play size={13} className="video-header-icon" />
          {isEditingTitle ? (
            <input
              type="text"
              className="canvas-code-title-input"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => {
                setIsEditingTitle(false)
                onUpdate({ title: titleDraft.trim() || 'YouTube Study Hub' })
              }}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') {
                  setIsEditingTitle(false)
                  onUpdate({ title: titleDraft.trim() || 'YouTube Study Hub' })
                }
              }}
              autoFocus
            />
          ) : (
            <span
              className="canvas-video-card-title"
              title="Double-click to rename container"
              onDoubleClick={(e) => {
                e.stopPropagation()
                setTitleDraft(node.title || 'YouTube Study Hub')
                setIsEditingTitle(true)
              }}
            >
              {node.title || activeTab?.title || 'YouTube Study Hub'}
            </span>
          )}
        </div>

        <div className="canvas-code-card-actions" onPointerDown={(e) => e.stopPropagation()}>
          {onAddContainer && (
            <button
              type="button"
              className="canvas-code-hdr-btn"
              title="Add another YouTube container on board"
              onClick={onAddContainer}
            >
              <Plus size={12} />
            </button>
          )}
          <button
            type="button"
            className="canvas-code-hdr-btn"
            title="Duplicate Video Container"
            onClick={onDuplicate}
          >
            <Copy size={12} />
          </button>
          <button
            type="button"
            className="canvas-code-hdr-btn danger"
            title="Delete Video Container"
            onClick={onDelete}
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Multi-Video Tab Bar */}
      <div className="video-tab-bar" onPointerDown={(e) => e.stopPropagation()}>
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab.id
          return (
            <div
              key={tab.id}
              className={`video-tab-pill ${isActive ? 'active' : ''}`}
              onClick={() => handleSelectTab(tab)}
              title={tab.title}
            >
              <Play size={10} />
              <span className="video-tab-title">{tab.title}</span>
              {tabs.length > 1 && (
                <button
                  type="button"
                  className="video-tab-close"
                  onClick={(e) => handleCloseTab(tab.id, e)}
                  title="Close tab"
                >
                  <X size={10} />
                </button>
              )}
            </div>
          )
        })}
        <button
          type="button"
          className="video-tab-add-btn"
          onClick={handleAddTab}
          title="Add another YouTube video tab inside this container"
        >
          <Plus size={12} />
          <span>New Video</span>
        </button>
      </div>

      {/* URL Loader Bar */}
      <div className="video-url-bar" onPointerDown={(e) => e.stopPropagation()}>
        <Link2 size={13} className="video-url-icon" />
        <input
          type="text"
          className="video-url-input"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') handleLoadUrl()
          }}
          placeholder="Paste YouTube URL or Video ID (e.g. https://youtu.be/...)"
        />
        <button
          type="button"
          className="video-load-btn"
          onClick={handleLoadUrl}
          disabled={!urlInput.trim()}
        >
          Load Video
        </button>
        {activeTab?.url && (
          <a
            href={activeTab.url}
            target="_blank"
            rel="noreferrer"
            className="canvas-code-hdr-btn"
            title="Open in browser"
          >
            <ExternalLink size={12} />
          </a>
        )}
      </div>

      {/* Live Dimension Badge */}
      {isResizing && (
        <div className="resize-dimension-badge">
          {node.w} × {node.h} px
        </div>
      )}

      {/* Embedded Player Body */}
      <div className="video-player-stage" onPointerDown={(e) => e.stopPropagation()}>
        {activeTab?.videoId ? (
          <iframe
            ref={iframeRef}
            key={activeTab.videoId}
            src={`https://www.youtube.com/embed/${activeTab.videoId}?enablejsapi=1&rel=0&playsinline=1`}
            title={activeTab.title || 'YouTube Video Player'}
            className="video-player-iframe"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        ) : (
          <div className="video-empty-stage">
            <div className="video-empty-icon">
              <Play size={26} />
            </div>
            <h4>Watch & Study Inside Your Board</h4>
            <p>
              Paste any YouTube URL above and click <strong>Load Video</strong>. Take timestamped
              notes right beside the player or generate a visual tutorial from its topics.
            </p>
          </div>
        )}
      </div>

      {/* Interactive Controls & Timestamp Note Bar */}
      <div className="video-controls-footer" onPointerDown={(e) => e.stopPropagation()}>
        <div className="video-controls-row">
          <div className="video-time-group">
            <span className="video-time-pill" title="Current bookmark timestamp">
              <Clock size={11} />
              <span>{formatSec(currentSec)}</span>
            </span>
            <input
              type="number"
              min="0"
              className="video-seek-input"
              value={seekInput}
              onChange={(e) => setSeekInput(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') {
                  const val = Number(seekInput)
                  if (!isNaN(val) && val >= 0) seekTo(val)
                }
              }}
              title="Enter seconds and press Enter to seek"
            />
            <button
              type="button"
              className="video-mini-btn"
              onClick={() => {
                const val = Number(seekInput)
                if (!isNaN(val) && val >= 0) seekTo(val)
              }}
              title="Seek player to seconds"
            >
              Seek
            </button>
          </div>

          <div className="video-action-group">
            {activeTab?.videoId && (
              <button
                type="button"
                className={`video-mini-btn ${showTranscript ? 'active' : ''}`}
                onClick={handleToggleTranscript}
                title="Show clickable video transcript"
              >
                <FileText size={12} />
                <span>Transcript</span>
                {showTranscript ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              </button>
            )}

            {onCreateTutorialFromVideo && activeTab?.videoId && (
              <button
                type="button"
                className="video-mini-btn accent"
                onClick={handleCreateTutorial}
                disabled={!isAiConfigured}
                title={
                  isAiConfigured
                    ? 'Create a structured tutorial on the board from this video'
                    : 'Configure AI Settings to generate AI tutorials'
                }
              >
                <Sparkles size={12} />
                <span>Tutorial</span>
              </button>
            )}

            <button
              type="button"
              className="video-note-btn"
              onClick={() =>
                onAddTimestampNote(
                  Number(seekInput) || currentSec,
                  activeTab?.title || node.title || 'YouTube Video',
                  activeTab?.url || node.url || ''
                )
              }
              title="Spawn a linked study note card on the board at this timestamp"
            >
              <Plus size={13} />
              <span>Add Note @ {formatSec(Number(seekInput) || currentSec)}</span>
            </button>
          </div>
        </div>

        {/* Collapsible Transcript Drawer */}
        {showTranscript && (
          <div className="video-transcript-drawer">
            {loadingTranscript ? (
              <div className="video-transcript-status">Fetching video captions...</div>
            ) : activeTranscript.length === 0 ? (
              <div className="video-transcript-status">
                No captions available for this video. You can still take timestamped notes directly!
              </div>
            ) : (
              activeTranscript.map((item, idx) => (
                <div
                  key={idx}
                  className="video-transcript-line"
                  onClick={() => seekTo(item.start)}
                  title="Click to jump video to this timestamp"
                >
                  <span className="video-transcript-ts">{formatSec(item.start)}</span>
                  <span className="video-transcript-txt">{item.text}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Bottom-right corner resize grip */}
      {!disabledPointerEvents && onStartResize && (
        <div
          className="resize-corner-grip"
          onPointerDown={(e) => {
            e.stopPropagation()
            onStartResize(e, 'se')
          }}
          title="Drag corner to resize video container"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path
              d="M8.5 1.5L1.5 8.5M8.5 5L5 8.5M8.5 8.5L8.5 8.51"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </div>
      )}

      {/* 8-direction resize handles */}
      {!disabledPointerEvents && onStartResize && (
        <div className="card-resize-handles">
          {(['n', 's', 'e', 'w'] as const).map((dir) => (
            <div
              key={`video-edge-${dir}`}
              className={`resize-edge ${dir}`}
              onPointerDown={(e) => {
                e.stopPropagation()
                onStartResize(e, dir)
              }}
            />
          ))}
          {(isSelected || isHovered || isResizing) &&
            (['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const).map((dir) => (
              <div
                key={`video-handle-${dir}`}
                className={`resize-handle ${dir}`}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  onStartResize(e, dir)
                }}
              />
            ))}
        </div>
      )}
    </div>
  )
}
