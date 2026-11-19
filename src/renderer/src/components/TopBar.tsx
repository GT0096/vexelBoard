import { useEffect, useRef, useState } from 'react'
import {
  Loader2,
  Minus,
  Square,
  MousePointerClick,
  Sparkles,
  X,
  MessageSquare,
  Home,
  ChevronRight,
  ChevronDown,
  Plus,
  Layers,
  Settings2,
  Check
} from 'lucide-react'
import type { ProjectItem, SectionItem } from '@shared/ipc'
import { BrandMark } from './BrandMark'

interface TopBarProps {
  aiBusy: boolean
  isAiConfigured?: boolean
  modelLabel: string
  clickThrough: boolean
  isRightPanelOpen: boolean
  isMaximized?: boolean
  isHomeView?: boolean
  activeProject?: ProjectItem | null
  activeSection?: SectionItem | null
  projectSections?: SectionItem[]
  onGoHome?: () => void
  onSelectSection?: (section: SectionItem) => void
  onQuickCreateSection?: (title: string) => Promise<void>
  onOpenSettings?: () => void
  onToggleRightPanel: () => void
  onMinimize: () => void
  onMaximize: () => void
  onClose: () => void
}

export function TopBar(p: TopBarProps): React.JSX.Element {
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [addingSection, setAddingSection] = useState(false)
  const [newSectionTitle, setNewSectionTitle] = useState('')
  const [creating, setCreating] = useState(false)
  const switcherRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!switcherOpen) return
    const handleClickOutside = (e: MouseEvent): void => {
      if (switcherRef.current && !switcherRef.current.contains(e.target as Node)) {
        setSwitcherOpen(false)
        setAddingSection(false)
      }
    }
    window.addEventListener('mousedown', handleClickOutside)
    return () => window.removeEventListener('mousedown', handleClickOutside)
  }, [switcherOpen])

  const handleCreateSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!newSectionTitle.trim() || !p.onQuickCreateSection || creating) return
    setCreating(true)
    try {
      await p.onQuickCreateSection(newSectionTitle.trim())
      setNewSectionTitle('')
      setAddingSection(false)
      setSwitcherOpen(false)
    } finally {
      setCreating(false)
    }
  }

  const hasNativeControls = Boolean(window.glassAPI?.hasNativeWindowControls)
  const platform = window.glassAPI?.platform
  const topbarClasses = [
    'topbar',
    hasNativeControls && platform === 'win32' ? 'has-native-window-controls' : '',
    platform === 'darwin' ? 'has-mac-traffic-lights' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <header className={topbarClasses}>
      <div className="topbar-left">
        <div className="brand">
          <BrandMark size={26} />
          <h1>
            Vexel<em>board</em>
          </h1>
        </div>

        {!p.isHomeView && p.activeSection && (
          <div className="topbar-workspace-nav" ref={switcherRef}>
            {p.onGoHome && (
              <button
                type="button"
                className="topbar-home-btn"
                onClick={p.onGoHome}
                title="Back to Welcome Hub, Projects & Overall History"
              >
                <Home size={13} />
                <span>Home</span>
              </button>
            )}

            <div className="topbar-breadcrumb-wrap">
              <button
                type="button"
                className={`topbar-breadcrumb-btn ${switcherOpen ? 'open' : ''}`}
                onClick={() => setSwitcherOpen((v) => !v)}
                title="Switch topic section or create a new section in this project"
              >
                <span
                  className="topbar-proj-dot"
                  style={{ background: p.activeProject?.color || 'var(--theme-ink)' }}
                />
                <span className="topbar-proj-name">{p.activeProject?.title || 'Project'}</span>
                <ChevronRight size={13} className="topbar-crumb-sep" />
                <span className="topbar-sec-name">{p.activeSection.title}</span>
                <ChevronDown size={13} className="topbar-crumb-chevron" />
              </button>

              {switcherOpen && (
                <div className="topbar-section-popover glass">
                  <div className="topbar-popover-hdr">
                    <span className="topbar-popover-eyebrow">
                      <Layers size={12} />
                      {p.activeProject?.title || 'Project'} · Sections
                    </span>
                    <span className="topbar-popover-count">{p.projectSections?.length ?? 1}</span>
                  </div>

                  <div className="topbar-popover-list">
                    {(p.projectSections ?? [p.activeSection]).map((sec) => {
                      const isCurrent = sec.id === p.activeSection?.id
                      return (
                        <button
                          key={sec.id}
                          type="button"
                          className={`topbar-popover-item ${isCurrent ? 'active' : ''}`}
                          onClick={() => {
                            if (!isCurrent) p.onSelectSection?.(sec)
                            setSwitcherOpen(false)
                          }}
                        >
                          <div className="topbar-popover-item-main">
                            <span className="topbar-popover-item-title">{sec.title}</span>
                            {sec.description && (
                              <span className="topbar-popover-item-sub">{sec.description}</span>
                            )}
                          </div>
                          {isCurrent && <Check size={14} className="topbar-popover-check" />}
                        </button>
                      )
                    })}
                  </div>

                  {p.onQuickCreateSection && (
                    <div className="topbar-popover-footer">
                      {addingSection ? (
                        <form className="topbar-quick-section-form" onSubmit={handleCreateSubmit}>
                          <input
                            type="text"
                            autoFocus
                            placeholder="New topic section name..."
                            value={newSectionTitle}
                            onChange={(e) => setNewSectionTitle(e.target.value)}
                          />
                          <button type="submit" disabled={!newSectionTitle.trim() || creating}>
                            {creating ? <Loader2 size={13} className="spin" /> : 'Add'}
                          </button>
                        </form>
                      ) : (
                        <button
                          type="button"
                          className="topbar-new-sec-btn"
                          onClick={() => setAddingSection(true)}
                        >
                          <Plus size={13} />
                          <span>New Topic Section</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="chips">
        {p.isAiConfigured === false ? (
          <button
            type="button"
            className="chip warn ai-chip-btn"
            id="ai-chip"
            onClick={p.onOpenSettings}
            title="AI features are disabled until AI Settings are configured. Click to configure."
          >
            <Settings2 size={13} />
            AI Not Configured
          </button>
        ) : (
          <button
            type="button"
            className={`chip ai-chip-btn ${p.aiBusy ? 'accent' : ''}`}
            id="ai-chip"
            onClick={p.onOpenSettings}
            title="Active AI model — click to configure AI Settings"
          >
            {p.aiBusy ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />}
            {p.modelLabel}
          </button>
        )}
        {p.clickThrough && (
          <span className="chip warn" id="clickthrough-chip">
            <MousePointerClick size={13} /> Click-through · Alt+Space
          </span>
        )}
      </div>

      <div className="header-right-tools">
        {!p.isHomeView ? (
          <button
            className={`header-pill-btn ${p.isRightPanelOpen ? 'active' : ''}`}
            onClick={p.onToggleRightPanel}
            title="Toggle AI Research Panel"
          >
            <MessageSquare size={14} />
            <span>AI Panel</span>
          </button>
        ) : (
          p.onOpenSettings && (
            <button
              className="header-pill-btn"
              onClick={p.onOpenSettings}
              title="Configure AI Provider & Models"
            >
              <Settings2 size={14} />
              <span>AI Settings</span>
            </button>
          )
        )}

        {!hasNativeControls && (
          <div className="window-controls">
            <button id="win-min-btn" onClick={p.onMinimize} aria-label="Minimize" title="Minimize">
              <Minus size={15} />
            </button>
            <button
              id="win-max-btn"
              onClick={p.onMaximize}
              aria-label={p.isMaximized ? 'Restore Down' : 'Maximize'}
              title={p.isMaximized ? 'Restore Down' : 'Maximize'}
            >
              {p.isMaximized ? (
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.2">
                  <rect x="1" y="3" width="7" height="7" rx="0.5" />
                  <path d="M3.5 1h6a0.5 0.5 0 0 1 0.5 0.5v6" />
                </svg>
              ) : (
                <Square size={12} />
              )}
            </button>
            <button id="win-close-btn" className="close" onClick={p.onClose} aria-label="Close" title="Close">
              <X size={15} />
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
