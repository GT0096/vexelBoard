import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Check,
  Copy,
  Download,
  Eye,
  FileCode2,
  Loader2,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  X
} from 'lucide-react'
import type {
  CompanionBridgeStatus,
  SkillDetail,
  SkillSourceKind,
  SkillSummary
} from '@shared/ipc'
import type { AISettings } from '../types/board'

interface SkillsModalProps {
  isOpen: boolean
  onClose: () => void
  aiSettings: AISettings
  onChangeAI: (ai: AISettings) => void
  onToast?: (kind: 'info' | 'success' | 'error', message: string) => void
}

type ModalTab = 'browse' | 'create' | 'bridge'
type SourceFilter = 'all' | SkillSourceKind

const SOURCE_LABELS: Record<SkillSourceKind, string> = {
  builtin: 'Built-in',
  workspace: 'Workspace (.agents)',
  antigravity: 'Antigravity Global',
  'antigravity-plugin': 'Antigravity Plugin',
  custom: 'Vexelboard Custom'
}

const STARTER_SKILL_BODY = `# Workflow Title

Describe clearly what the agent or Antigravity should accomplish with this skill.

## Steps

1. Inspect the active whiteboard state and relevant context.
2. Break the concept into crisp visual blocks or verified code.
3. Place clean diagrams, notes, or equations on the board without overlapping existing cards.

## Validation

- Confirm every placed item has concise, accurate content and working links/math.`

export const SkillsModal: React.FC<SkillsModalProps> = ({
  isOpen,
  onClose,
  aiSettings,
  onChangeAI,
  onToast
}) => {
  const [tab, setTab] = useState<ModalTab>('browse')
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [previewSkill, setPreviewSkill] = useState<SkillDetail | null>(null)
  const [bridgeStatus, setBridgeStatus] = useState<CompanionBridgeStatus | null>(null)
  const [copiedMcp, setCopiedMcp] = useState(false)

  // Authoring state
  const [draftName, setDraftName] = useState('')
  const [draftDesc, setDraftDesc] = useState('')
  const [draftTarget, setDraftTarget] = useState<'workspace' | 'antigravity' | 'custom'>('workspace')
  const [draftBody, setDraftBody] = useState(STARTER_SKILL_BODY)
  const [saving, setSaving] = useState(false)

  const api = window.glassAPI
  const activeIds = aiSettings.activeSkillIds ?? []

  const refreshData = useCallback(async () => {
    if (!api) return
    setLoading(true)
    try {
      const [sk, st] = await Promise.all([
        api.listSkills?.() ?? Promise.resolve([]),
        api.getCompanionStatus?.() ?? Promise.resolve(null)
      ])
      setSkills(Array.isArray(sk) ? sk : [])
      setBridgeStatus(st)
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => {
    if (isOpen) {
      void refreshData()
    }
  }, [isOpen, refreshData])

  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  const filteredSkills = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return skills.filter((s) => {
      if (sourceFilter !== 'all' && s.source !== sourceFilter) return false
      if (!q) return true
      return (
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.source.toLowerCase().includes(q)
      )
    })
  }, [skills, sourceFilter, searchQuery])

  if (!isOpen) return null

  const isPinned = (s: SkillSummary): boolean =>
    activeIds.includes(s.id) || activeIds.includes(s.name)

  const togglePinSkill = (s: SkillSummary): void => {
    const currentlyPinned = isPinned(s)
    const nextIds = currentlyPinned
      ? activeIds.filter((id) => id !== s.id && id !== s.name)
      : [...activeIds.filter((id) => id !== s.name), s.id]
    onChangeAI({ ...aiSettings, activeSkillIds: nextIds })
    onToast?.(
      'info',
      currentlyPinned ? `Unpinned skill "${s.name}"` : `Pinned skill "${s.name}" for AI & Agent runs`
    )
  }

  const handleOpenPreview = async (s: SkillSummary): Promise<void> => {
    if (previewSkill?.id === s.id) {
      setPreviewSkill(null)
      return
    }
    const detail = await api?.getSkillDetail?.(s.id)
    if (detail) setPreviewSkill(detail)
  }

  const handleExportToAntigravity = async (
    s: SkillSummary,
    target: 'workspace' | 'antigravity'
  ): Promise<void> => {
    if (!api?.exportSkillToAntigravity) return
    const res = await api.exportSkillToAntigravity(s.id, target)
    if (res.ok) {
      onToast?.(
        'success',
        `Synced "${s.name}" to ${target === 'workspace' ? '.agents/skills' : '~/.gemini/config/skills'}`
      )
      void refreshData()
    } else {
      onToast?.('error', res.error || 'Failed to export skill')
    }
  }

  const handleDelete = async (s: SkillSummary): Promise<void> => {
    if (!api?.deleteSkill) return
    const res = await api.deleteSkill(s.id)
    if (res.ok) {
      onChangeAI({
        ...aiSettings,
        activeSkillIds: activeIds.filter((id) => id !== s.id && id !== s.name)
      })
      if (previewSkill?.id === s.id) setPreviewSkill(null)
      onToast?.('info', `Deleted skill "${s.name}"`)
      void refreshData()
    } else {
      onToast?.('error', res.error || 'Could not delete skill')
    }
  }

  const handleCreateSkill = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!api?.saveSkill) return
    setSaving(true)
    try {
      const res = await api.saveSkill({
        name: draftName,
        description: draftDesc,
        body: draftBody,
        target: draftTarget
      })
      if (res.ok) {
        onToast?.('success', `Saved SKILL.md (${res.skill?.name || draftName})`)
        if (res.skill) {
          onChangeAI({
            ...aiSettings,
            activeSkillIds: Array.from(new Set([...activeIds, res.skill.id]))
          })
        }
        setDraftName('')
        setDraftDesc('')
        setDraftBody(STARTER_SKILL_BODY)
        setTab('browse')
        void refreshData()
      } else {
        onToast?.('error', res.error || 'Failed to save SKILL.md')
      }
    } finally {
      setSaving(false)
    }
  }

  const mcpSnippet = JSON.stringify(
    {
      mcpServers: {
        vexelboard: {
          url: bridgeStatus?.mcpUrl || 'http://127.0.0.1:45789/mcp'
        }
      }
    },
    null,
    2
  )

  return (
    <div
      className="modal-backdrop"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        className="modal glass vx-skills-modal"
        role="dialog"
        aria-labelledby="skills-modal-title"
      >
        <header className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Sparkles size={18} />
            <h2 id="skills-modal-title">AI Skills &amp; Antigravity Companion</h2>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Close Skills Studio"
          >
            <X size={18} />
          </button>
        </header>

        <div className="vx-skills-tabs">
          <button
            type="button"
            className={`vx-skills-tab-btn ${tab === 'browse' ? 'active' : ''}`}
            onClick={() => setTab('browse')}
          >
            <Sparkles size={13} />
            <span>Skills ({skills.length})</span>
            {activeIds.length > 0 && (
              <span className="vx-skills-pin-count">{activeIds.length} pinned</span>
            )}
          </button>
          <button
            type="button"
            className={`vx-skills-tab-btn ${tab === 'create' ? 'active' : ''}`}
            onClick={() => setTab('create')}
          >
            <Plus size={13} />
            <span>Create SKILL.md</span>
          </button>
          <button
            type="button"
            className={`vx-skills-tab-btn ${tab === 'bridge' ? 'active' : ''}`}
            onClick={() => setTab('bridge')}
          >
            <FileCode2 size={13} />
            <span>Antigravity Bridge &amp; MCP</span>
            <span
              className={`vx-bridge-dot ${bridgeStatus?.running ? 'online' : 'offline'}`}
            />
          </button>
        </div>

        <div className="modal-body vx-skills-body">
          {tab === 'browse' && (
            <>
              <div className="vx-skills-toolbar">
                <div className="vx-skills-search-wrap">
                  <Search size={14} />
                  <input
                    type="text"
                    placeholder="Search Antigravity, workspace & built-in skills..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void refreshData()}
                  disabled={loading}
                  title="Rescan SKILL.md folders"
                >
                  <RefreshCw size={13} className={loading ? 'spin' : ''} />
                  Refresh
                </button>
              </div>

              <div className="vx-skills-filter-pills">
                {(
                  [
                    ['all', 'All'],
                    ['workspace', 'Workspace (.agents)'],
                    ['builtin', 'Built-in'],
                    ['antigravity', 'Antigravity Global'],
                    ['antigravity-plugin', 'Antigravity Plugins'],
                    ['custom', 'Custom']
                  ] as Array<[SourceFilter, string]>
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className={`vx-filter-pill ${sourceFilter === key ? 'active' : ''}`}
                    onClick={() => setSourceFilter(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="vx-skills-list">
                {filteredSkills.length === 0 ? (
                  <div className="vx-skills-empty">
                    {loading
                      ? 'Scanning Antigravity and Vexelboard skill directories...'
                      : 'No matching SKILL.md files found.'}
                  </div>
                ) : (
                  filteredSkills.map((s) => {
                    const pinned = isPinned(s)
                    const previewing = previewSkill?.id === s.id
                    return (
                      <div key={s.id} className={`vx-skill-card ${pinned ? 'pinned' : ''}`}>
                        <div className="vx-skill-card-top">
                          <div className="vx-skill-title-group">
                            <strong>{s.name}</strong>
                            <span className={`vx-skill-badge source-${s.source}`}>
                              {SOURCE_LABELS[s.source]}
                            </span>
                            {s.hasScripts && <span className="vx-skill-tag">scripts</span>}
                            {s.hasReferences && <span className="vx-skill-tag">refs</span>}
                          </div>
                          <div className="vx-skill-actions">
                            <button
                              type="button"
                              className={`vx-skill-btn ${pinned ? 'active' : ''}`}
                              onClick={() => togglePinSkill(s)}
                              title={
                                pinned
                                  ? 'Unpin from Chat & Agent prompt'
                                  : 'Pin so Chat & Agent follow this skill automatically'
                              }
                            >
                              {pinned ? <PinOff size={12} /> : <Pin size={12} />}
                              <span>{pinned ? 'Pinned' : 'Pin'}</span>
                            </button>
                            <button
                              type="button"
                              className="vx-skill-btn"
                              onClick={() => void handleOpenPreview(s)}
                              title="Inspect SKILL.md instructions"
                            >
                              <Eye size={12} />
                              <span>{previewing ? 'Hide' : 'View'}</span>
                            </button>
                            {s.source !== 'workspace' && (
                              <button
                                type="button"
                                className="vx-skill-btn"
                                onClick={() => void handleExportToAntigravity(s, 'workspace')}
                                title="Copy SKILL.md into workspace .agents/skills/ for Antigravity"
                              >
                                <Download size={12} />
                                <span>To .agents</span>
                              </button>
                            )}
                            {s.editable && (
                              <button
                                type="button"
                                className="vx-skill-btn danger"
                                onClick={() => void handleDelete(s)}
                                title="Delete custom skill"
                              >
                                <Trash2 size={12} />
                              </button>
                            )}
                          </div>
                        </div>
                        <p className="vx-skill-desc">{s.description}</p>
                        {previewing && previewSkill && (
                          <pre className="vx-skill-preview-pre">{previewSkill.body}</pre>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            </>
          )}

          {tab === 'create' && (
            <form className="vx-skill-form" onSubmit={(e) => void handleCreateSkill(e)}>
              <div className="field">
                <label>Skill Name (lowercase hyphenated)</label>
                <input
                  type="text"
                  placeholder="e.g. circuit-solver or api-diagram-reviewer"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  required
                />
              </div>

              <div className="field">
                <label>Save Location (Antigravity &amp; Vexelboard Compatible `SKILL.md`)</label>
                <select
                  value={draftTarget}
                  onChange={(e) =>
                    setDraftTarget(e.target.value as 'workspace' | 'antigravity' | 'custom')
                  }
                >
                  <option value="workspace">
                    Workspace (.agents/skills/&lt;name&gt;/SKILL.md — shared with Antigravity)
                  </option>
                  <option value="antigravity">
                    Antigravity Global (~/.gemini/config/skills/&lt;name&gt;/SKILL.md)
                  </option>
                  <option value="custom">Vexelboard Local User Data</option>
                </select>
              </div>

              <div className="field">
                <label>Trigger Description (when should the AI / Antigravity activate this skill?)</label>
                <input
                  type="text"
                  placeholder="Use this skill when the user asks to..."
                  value={draftDesc}
                  onChange={(e) => setDraftDesc(e.target.value)}
                  required
                />
              </div>

              <div className="field">
                <label>Markdown Procedure &amp; Instructions</label>
                <textarea
                  rows={9}
                  value={draftBody}
                  onChange={(e) => setDraftBody(e.target.value)}
                  required
                />
              </div>

              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button type="submit" className="btn primary" disabled={saving}>
                  {saving ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
                  Save &amp; Pin Skill
                </button>
              </div>
            </form>
          )}

          {tab === 'bridge' && (
            <div className="vx-bridge-panel">
              <div className="card">
                <div className="card-title">
                  <h3>Live Companion &amp; MCP Server</h3>
                  <span
                    className={`status-pill ${bridgeStatus?.running ? 'ok' : 'off'}`}
                  >
                    <span className={`dot ${bridgeStatus?.running ? 'ok' : 'off'}`} />
                    {bridgeStatus?.running ? `Listening on :${bridgeStatus.port}` : 'Stopped'}
                  </span>
                </div>
                <p className="hint">
                  While Vexelboard is open, Antigravity can automatically inspect the board, query
                  Knowledge Studio, and draw notes/diagrams/equations/code using the bundled{' '}
                  <code>vexelboard-canvas</code> and <code>vexelboard-knowledge</code> workspace
                  skills or Streamable HTTP MCP.
                </p>
                <div className="vx-bridge-urls">
                  <div>
                    <strong>REST Bridge:</strong>{' '}
                    <code>{bridgeStatus?.baseUrl || 'http://127.0.0.1:45789'}</code>
                  </div>
                  <div>
                    <strong>MCP Streamable HTTP:</strong>{' '}
                    <code>{bridgeStatus?.mcpUrl || 'http://127.0.0.1:45789/mcp'}</code>
                  </div>
                  <div>
                    <strong>Discovery File:</strong>{' '}
                    <code>{bridgeStatus?.bridgeFilePath || '~/.vexelboard-bridge.json'}</code>
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="card-title">
                  <h3>Optional `mcp_config.json` Snippet for Antigravity</h3>
                  <button
                    type="button"
                    className="btn primary"
                    onClick={() => {
                      void navigator.clipboard.writeText(mcpSnippet)
                      setCopiedMcp(true)
                      onToast?.('success', 'Copied Antigravity MCP config to clipboard')
                      setTimeout(() => setCopiedMcp(false), 1800)
                    }}
                  >
                    {copiedMcp ? <Check size={13} /> : <Copy size={13} />}
                    {copiedMcp ? 'Copied' : 'Copy Config'}
                  </button>
                </div>
                <pre className="vx-skill-preview-pre">{mcpSnippet}</pre>
                <p className="hint">
                  Paste into <code>~/.gemini/config/mcp_config.json</code> if you want Antigravity
                  to expose <code>vexelboard_*</code> MCP tools globally across any workspace.
                </p>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
