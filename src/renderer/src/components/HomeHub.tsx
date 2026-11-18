import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Code2,
  Clock,
  FileText,
  FolderKanban,
  History,
  Layers,
  MessageSquare,
  Network,
  Pencil,
  Play,
  Plus,
  Search,
  Sigma,
  Sparkles,
  Trash2,
  User,
  Bot,
  Video,
  X
} from 'lucide-react'
import type {
  OverallHistoryEntry,
  OverallHistorySummary,
  ProjectChatStore,
  ProjectItem,
  SectionItem
} from '@shared/ipc'
import {
  PROJECT_COLORS,
  createNewProject,
  createNewSection,
  editProject,
  editSection,
  fetchOverallHistory,
  fetchProjectChatStore,
  fetchProjects,
  fetchSections,
  persistProjectChatStore,
  removeProject,
  removeSection
} from '../board/workspaceStore'

interface HomeHubProps {
  lastSectionId: string | null
  onOpenSection: (
    section: SectionItem,
    project: ProjectItem | null,
    opts?: { openChat?: boolean; threadId?: string; newThread?: boolean }
  ) => void
  onToast: (kind: 'info' | 'success' | 'error', message: string) => void
}

type HistoryFilter = 'all' | 'text' | 'diagram' | 'code' | 'equation' | 'video' | 'source' | 'event'

function getTimeGreeting(): string {
  const hr = new Date().getHours()
  if (hr < 12) return 'Good morning'
  if (hr < 17) return 'Good afternoon'
  return 'Good evening'
}

function formatRelativeTime(ts?: number): string {
  if (!ts) return 'Just now'
  const diff = Date.now() - ts
  if (diff < 60_000) return 'Just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function getHistoryKindMeta(entry: OverallHistoryEntry): {
  label: string
  colorClass: string
  icon: React.ReactNode
} {
  if (entry.entryType === 'source') {
    return { label: entry.kind.toUpperCase(), colorClass: 'sky', icon: <BookOpen size={14} /> }
  }
  if (entry.entryType === 'event') {
    return { label: 'Activity', colorClass: 'pink', icon: <Sparkles size={14} /> }
  }
  switch (entry.kind) {
    case 'text':
      return { label: 'Note', colorClass: 'teal', icon: <FileText size={14} /> }
    case 'diagram':
      return { label: 'Diagram', colorClass: 'purple', icon: <Network size={14} /> }
    case 'equation':
      return { label: 'Equation', colorClass: 'amber', icon: <Sigma size={14} /> }
    case 'code':
      return { label: 'Code', colorClass: 'blue', icon: <Code2 size={14} /> }
    case 'video':
      return { label: 'Video', colorClass: 'red', icon: <Video size={14} /> }
    default:
      return { label: 'Canvas', colorClass: 'teal', icon: <Layers size={14} /> }
  }
}

export const HomeHub: React.FC<HomeHubProps> = ({
  lastSectionId,
  onOpenSection,
  onToast
}) => {
  const [projects, setProjects] = useState<ProjectItem[]>([])
  const [allSections, setAllSections] = useState<SectionItem[]>([])
  const [history, setHistory] = useState<OverallHistorySummary | null>(null)
  const [projectChatStores, setProjectChatStores] = useState<Record<string, ProjectChatStore>>({})
  const [loading, setLoading] = useState(true)

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [projectRightTab, setProjectRightTab] = useState<'chat' | 'history'>('chat')
  const [selectedThreadByProject, setSelectedThreadByProject] = useState<Record<string, string>>({})
  const [searchQuery, setSearchQuery] = useState('')
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all')

  // Project Modal State
  const [projectModal, setProjectModal] = useState<{
    mode: 'create' | 'edit'
    project?: ProjectItem
  } | null>(null)
  const [projTitle, setProjTitle] = useState('')
  const [projDesc, setProjDesc] = useState('')
  const [projColor, setProjColor] = useState<string>(PROJECT_COLORS[0])
  const [firstSectionTitle, setFirstSectionTitle] = useState('')

  // Section Modal State
  const [sectionModal, setSectionModal] = useState<{
    mode: 'create' | 'edit'
    projectId: string
    section?: SectionItem
  } | null>(null)
  const [secTitle, setSecTitle] = useState('')
  const [secDesc, setSecDesc] = useState('')

  // Confirm Delete State
  const [confirmDelete, setConfirmDelete] = useState<{
    kind: 'project' | 'section'
    id: string
    title: string
  } | null>(null)

  const [submitting, setSubmitting] = useState(false)

  const loadChatsForProjects = useCallback(async (projs: ProjectItem[], secs: SectionItem[]) => {
    const entries = await Promise.all(
      projs.map(async (p) => {
        const secIds = secs.filter((s) => s.projectId === p.id).map((s) => s.id)
        const store = await fetchProjectChatStore(p.id, secIds)
        return [p.id, store] as const
      })
    )
    setProjectChatStores(Object.fromEntries(entries))
  }, [])

  const loadWorkspaceData = useCallback(async () => {
    try {
      const [projs, secs, hist] = await Promise.all([
        fetchProjects(),
        fetchSections(),
        fetchOverallHistory(140)
      ])
      setProjects(projs)
      setAllSections(secs)
      setHistory(hist)
      await loadChatsForProjects(projs, secs)
    } catch (err) {
      console.error('Failed to load workspace hub:', err)
    } finally {
      setLoading(false)
    }
  }, [loadChatsForProjects])

  useEffect(() => {
    let active = true
    Promise.all([fetchProjects(), fetchSections(), fetchOverallHistory(140)])
      .then(async ([projs, secs, hist]) => {
        if (!active) return
        setProjects(projs)
        setAllSections(secs)
        setHistory(hist)
        const chatEntries = await Promise.all(
          projs.map(async (p) => {
            const secIds = secs.filter((s) => s.projectId === p.id).map((s) => s.id)
            const store = await fetchProjectChatStore(p.id, secIds)
            return [p.id, store] as const
          })
        )
        if (active) {
          setProjectChatStores(Object.fromEntries(chatEntries))
        }
      })
      .catch((err) => {
        console.error('Failed to load workspace hub:', err)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  const projectMap = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])

  const selectedProject = useMemo(
    () => (selectedProjectId ? projectMap.get(selectedProjectId) ?? null : null),
    [selectedProjectId, projectMap]
  )

  const sectionsByProject = useMemo(() => {
    const map = new Map<string, SectionItem[]>()
    for (const s of allSections) {
      const list = map.get(s.projectId) ?? []
      list.push(s)
      map.set(s.projectId, list)
    }
    return map
  }, [allSections])

  const lastActiveSection = useMemo(() => {
    if (!lastSectionId) return null
    return allSections.find((s) => s.id === lastSectionId) ?? null
  }, [lastSectionId, allSections])

  const q = searchQuery.trim().toLowerCase()

  const filteredProjects = useMemo(() => {
    if (!q) return projects
    return projects.filter((p) => {
      const pSecs = sectionsByProject.get(p.id) ?? []
      const matchesProject =
        p.title.toLowerCase().includes(q) || (p.description ?? '').toLowerCase().includes(q)
      const matchesChildSection = pSecs.some(
        (s) => s.title.toLowerCase().includes(q) || (s.description ?? '').toLowerCase().includes(q)
      )
      return matchesProject || matchesChildSection
    })
  }, [projects, sectionsByProject, q])

  const activeProjectSections = useMemo(() => {
    if (!selectedProjectId) return []
    const list = sectionsByProject.get(selectedProjectId) ?? []
    if (!q) return list
    return list.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        (s.description ?? '').toLowerCase().includes(q) ||
        (s.previewText ?? '').toLowerCase().includes(q)
    )
  }, [selectedProjectId, sectionsByProject, q])

  const filteredHistoryEntries = useMemo(() => {
    const entries = history?.entries ?? []
    const projectSectionIds = selectedProjectId
      ? new Set((sectionsByProject.get(selectedProjectId) ?? []).map((s) => s.id))
      : null

    return entries.filter((entry) => {
      if (projectSectionIds && entry.projectId !== selectedProjectId && !projectSectionIds.has(entry.boardId)) {
        return false
      }
      if (historyFilter !== 'all') {
        if (historyFilter === 'source' && entry.entryType !== 'source') return false
        if (historyFilter === 'event' && entry.entryType !== 'event') return false
        if (
          historyFilter !== 'source' &&
          historyFilter !== 'event' &&
          (entry.entryType !== 'element' || entry.kind !== historyFilter)
        ) {
          return false
        }
      }
      if (q) {
        const hay = `${entry.title} ${entry.snippet ?? ''} ${entry.sectionTitle ?? ''} ${entry.projectTitle ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [history, selectedProjectId, sectionsByProject, historyFilter, q])

  /* ---------------- Handlers ---------------- */

  const openCreateProjectModal = (): void => {
    setProjTitle('')
    setProjDesc('')
    setProjColor(PROJECT_COLORS[projects.length % PROJECT_COLORS.length])
    setFirstSectionTitle('')
    setProjectModal({ mode: 'create' })
  }

  const openEditProjectModal = (proj: ProjectItem): void => {
    setProjTitle(proj.title)
    setProjDesc(proj.description ?? '')
    setProjColor(proj.color || PROJECT_COLORS[0])
    setFirstSectionTitle('')
    setProjectModal({ mode: 'edit', project: proj })
  }

  const openCreateSectionModal = (projectId: string): void => {
    setSecTitle('')
    setSecDesc('')
    setSectionModal({ mode: 'create', projectId })
  }

  const openEditSectionModal = (sec: SectionItem): void => {
    setSecTitle(sec.title)
    setSecDesc(sec.description ?? '')
    setSectionModal({ mode: 'edit', projectId: sec.projectId, section: sec })
  }

  const handleSaveProject = async (e: React.FormEvent, openAfterCreate = false): Promise<void> => {
    e.preventDefault()
    if (!projTitle.trim() || !projectModal || submitting) return
    setSubmitting(true)
    try {
      if (projectModal.mode === 'create') {
        const created = await createNewProject({
          title: projTitle.trim(),
          description: projDesc.trim() || undefined,
          color: projColor
        })
        let createdSection: SectionItem | null = null
        if (firstSectionTitle.trim()) {
          createdSection = await createNewSection({
            projectId: created.id,
            title: firstSectionTitle.trim()
          })
        }
        await loadWorkspaceData()
        setProjectModal(null)
        setSelectedProjectId(created.id)
        onToast('success', `Created project "${created.title}"`)
        if (openAfterCreate && createdSection) {
          onOpenSection(createdSection, created)
        }
      } else if (projectModal.project) {
        const updated = await editProject(projectModal.project.id, {
          title: projTitle.trim(),
          description: projDesc.trim(),
          color: projColor
        })
        await loadWorkspaceData()
        setProjectModal(null)
        if (updated) onToast('success', `Updated "${updated.title}"`)
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleSaveSection = async (e: React.FormEvent, focusImmediately = true): Promise<void> => {
    e.preventDefault()
    if (!secTitle.trim() || !sectionModal || submitting) return
    setSubmitting(true)
    try {
      if (sectionModal.mode === 'create') {
        const created = await createNewSection({
          projectId: sectionModal.projectId,
          title: secTitle.trim(),
          description: secDesc.trim() || undefined
        })
        const parentProj = projectMap.get(sectionModal.projectId) ?? null
        await loadWorkspaceData()
        setSectionModal(null)
        onToast('success', `Created section "${created.title}"`)
        if (focusImmediately) {
          onOpenSection(created, parentProj)
        }
      } else if (sectionModal.section) {
        const updated = await editSection(sectionModal.section.id, {
          title: secTitle.trim(),
          description: secDesc.trim()
        })
        await loadWorkspaceData()
        setSectionModal(null)
        if (updated) onToast('success', `Updated section "${updated.title}"`)
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleConfirmDelete = async (): Promise<void> => {
    if (!confirmDelete || submitting) return
    setSubmitting(true)
    try {
      if (confirmDelete.kind === 'project') {
        await removeProject(confirmDelete.id)
        if (selectedProjectId === confirmDelete.id) setSelectedProjectId(null)
        onToast('info', `Deleted project "${confirmDelete.title}"`)
      } else {
        await removeSection(confirmDelete.id)
        onToast('info', `Deleted section "${confirmDelete.title}"`)
      }
      setConfirmDelete(null)
      await loadWorkspaceData()
    } finally {
      setSubmitting(false)
    }
  }

  const handleOpenHistoryEntry = (entry: OverallHistoryEntry): void => {
    const matchedSection = allSections.find((s) => s.id === entry.boardId)
    if (matchedSection) {
      onOpenSection(matchedSection, projectMap.get(matchedSection.projectId) ?? null)
      return
    }
    const fallbackSection: SectionItem = {
      id: entry.boardId,
      projectId: entry.projectId || 'proj-general',
      title: entry.sectionTitle || 'Study Board',
      createdAt: entry.timestamp,
      updatedAt: entry.timestamp
    }
    const fallbackProject = entry.projectId ? projectMap.get(entry.projectId) ?? null : null
    onOpenSection(fallbackSection, fallbackProject)
  }

  const handleContinueProjectChat = async (
    proj: ProjectItem,
    opts?: { sectionId?: string; threadId?: string; newThread?: boolean }
  ): Promise<void> => {
    const pSecs = sectionsByProject.get(proj.id) ?? []
    const openOpts = {
      openChat: true,
      threadId: opts?.threadId,
      newThread: opts?.newThread
    }
    if (opts?.sectionId) {
      const target = pSecs.find((s) => s.id === opts.sectionId)
      if (target) {
        onOpenSection(target, proj, openOpts)
        return
      }
    }
    if (lastSectionId) {
      const lastInProj = pSecs.find((s) => s.id === lastSectionId)
      if (lastInProj) {
        onOpenSection(lastInProj, proj, openOpts)
        return
      }
    }
    if (pSecs.length > 0) {
      onOpenSection(pSecs[0], proj, openOpts)
      return
    }
    const created = await createNewSection({
      projectId: proj.id,
      title: 'Main Study Board',
      description: 'Project workspace'
    })
    await loadWorkspaceData()
    onOpenSection(created, proj, openOpts)
  }

  const greeting = getTimeGreeting()
  const totalNotes = history?.totalNotes ?? 0
  const totalDiagrams = history?.totalDiagrams ?? 0
  const totalCode = history?.totalCode ?? 0
  const totalEquations = history?.totalEquations ?? 0
  const totalVideos = history?.totalVideos ?? 0
  const totalSources = history?.totalSources ?? 0

  return (
    <div className="home-hub">
      <div className="home-hub-inner">
        {/* Welcome Hero Banner */}
        <section className="home-hero glass">
          <div className="home-hero-copy">
            <div className="home-welcome-pill">
              <Sparkles size={13} />
              <span>AI Study &amp; Whiteboard Studio</span>
            </div>
            <h2 className="home-hero-title">
              {greeting}, welcome to <span>Vexelboard</span>
            </h2>
            <p className="home-hero-subtitle">
              Organize your creativity into <strong>Projects</strong>, create dedicated topic{' '}
              <strong>Sections</strong> to focus on one concept at a time, and review everything
              you&apos;ve created so far.
            </p>
          </div>

          <div className="home-hero-actions">
            {lastActiveSection && (
              <button
                type="button"
                className="home-btn secondary"
                onClick={() =>
                  onOpenSection(
                    lastActiveSection,
                    projectMap.get(lastActiveSection.projectId) ?? null
                  )
                }
                title="Jump back into your last active section"
              >
                <Play size={14} />
                <span>
                  Resume: {lastActiveSection.title}
                </span>
              </button>
            )}
            <button type="button" className="home-btn primary" onClick={openCreateProjectModal}>
              <Plus size={15} />
              <span>New Project</span>
            </button>
          </div>
        </section>

        {/* Stats + Search Bar */}
        <div className="home-toolbar-row">
          <div className="home-stats-strip">
            <div className="home-stat-pill">
              <FolderKanban size={14} />
              <strong>{projects.length}</strong>
              <span>Projects</span>
            </div>
            <div className="home-stat-pill">
              <Layers size={14} />
              <strong>{allSections.length}</strong>
              <span>Sections</span>
            </div>
            <div className="home-stat-pill">
              <FileText size={14} />
              <strong>{totalNotes}</strong>
              <span>Notes</span>
            </div>
            <div className="home-stat-pill">
              <Network size={14} />
              <strong>{totalDiagrams}</strong>
              <span>Diagrams</span>
            </div>
            <div className="home-stat-pill">
              <Code2 size={14} />
              <strong>{totalCode}</strong>
              <span>Code</span>
            </div>
            <div className="home-stat-pill">
              <Sigma size={14} />
              <strong>{totalEquations}</strong>
              <span>Equations</span>
            </div>
            {totalVideos > 0 && (
              <div className="home-stat-pill">
                <Video size={14} />
                <strong>{totalVideos}</strong>
                <span>Videos</span>
              </div>
            )}
            {totalSources > 0 && (
              <div className="home-stat-pill">
                <BookOpen size={14} />
                <strong>{totalSources}</strong>
                <span>Sources</span>
              </div>
            )}
          </div>

          <div className="home-search-box">
            <Search size={14} className="home-search-icon" />
            <input
              type="text"
              placeholder="Search projects, sections, notes, diagrams..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                className="home-search-clear"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
              >
                <X size={13} />
              </button>
            )}
          </div>
        </div>

        {/* Main Workspace Columns */}
        <div className="home-columns">
          {/* Left / Primary: Projects OR Selected Project's Sections */}
          <section className="home-panel glass">
            {!selectedProject ? (
              <>
                <header className="home-panel-header">
                  <div>
                    <h3>
                      <FolderKanban size={17} />
                      <span>Your Projects</span>
                    </h3>
                    <p>Select a course or project to view and focus on its topic sections.</p>
                  </div>
                  <button
                    type="button"
                    className="home-btn compact primary"
                    onClick={openCreateProjectModal}
                  >
                    <Plus size={14} />
                    <span>New Project</span>
                  </button>
                </header>

                {loading && projects.length === 0 ? (
                  <div className="home-empty-state">
                    <p>Loading your projects...</p>
                  </div>
                ) : filteredProjects.length === 0 && !q ? (
                  <div className="home-empty-state">
                    <div className="home-empty-icon">
                      <FolderKanban size={28} />
                    </div>
                    <h4>Create your first Project</h4>
                    <p>
                      Think of a Project as a course or subject (for example,{' '}
                      <em>Machine Learning</em> or <em>System Design</em>). Inside each project,
                      you can create separate Sections for every topic you study.
                    </p>
                    <button
                      type="button"
                      className="home-btn primary"
                      onClick={openCreateProjectModal}
                    >
                      <Plus size={15} />
                      <span>Create First Project</span>
                    </button>
                  </div>
                ) : filteredProjects.length === 0 ? (
                  <div className="home-empty-state">
                    <h4>No matching projects</h4>
                    <p>No projects or sections matched &ldquo;{searchQuery}&rdquo;.</p>
                  </div>
                ) : (
                  <div className="home-card-grid">
                    {filteredProjects.map((proj) => {
                      const pSections = sectionsByProject.get(proj.id) ?? []
                      const pStore = projectChatStores[proj.id]
                      const pThreads = pStore?.threads ?? []
                      const pTotalMsgs = pThreads.reduce((acc, t) => acc + t.messages.length, 0)
                      const activeT =
                        pThreads.find((t) => t.id === pStore?.activeThreadId) || pThreads[0]
                      const accent = proj.color || '#00F5D4'
                      return (
                        <article
                          key={proj.id}
                          className="home-project-card"
                          style={{ '--card-accent': accent } as React.CSSProperties}
                          onClick={() => setSelectedProjectId(proj.id)}
                        >
                          <div className="home-card-accent-bar" />
                          <div className="home-card-top">
                            <div className="home-card-title-wrap">
                              <span className="home-card-dot" style={{ background: accent }} />
                              <h4>{proj.title}</h4>
                            </div>
                            <div
                              className="home-card-actions"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                title="Edit Project"
                                onClick={() => openEditProjectModal(proj)}
                              >
                                <Pencil size={13} />
                              </button>
                              <button
                                type="button"
                                className="danger"
                                title="Delete Project"
                                onClick={() =>
                                  setConfirmDelete({
                                    kind: 'project',
                                    id: proj.id,
                                    title: proj.title
                                  })
                                }
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </div>

                          {proj.description && (
                            <p className="home-card-desc">{proj.description}</p>
                          )}

                          <div className="home-card-meta-row">
                            <span className="home-meta-chip">
                              <Layers size={12} />
                              {pSections.length} {pSections.length === 1 ? 'section' : 'sections'}
                            </span>
                            {pTotalMsgs > 0 && (
                              <span className="home-meta-chip chat">
                                <MessageSquare size={12} />
                                {pThreads.length > 1
                                  ? `${pThreads.length} chats · ${pTotalMsgs} msgs`
                                  : `${pTotalMsgs} ${pTotalMsgs === 1 ? 'msg' : 'msgs'}`}
                              </span>
                            )}
                            <span className="home-meta-chip">
                              <Clock size={12} />
                              {formatRelativeTime(proj.updatedAt)}
                            </span>
                          </div>

                          {pSections.length > 0 && (
                            <div
                              className="home-quick-sections"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {pSections.slice(0, 3).map((sec) => (
                                <button
                                  key={sec.id}
                                  type="button"
                                  className="home-quick-sec-chip"
                                  onClick={() => onOpenSection(sec, proj)}
                                  title={`Focus directly on "${sec.title}"`}
                                >
                                  <span>{sec.title}</span>
                                  <ArrowRight size={11} />
                                </button>
                              ))}
                              {pSections.length > 3 && (
                                <span className="home-more-chip">
                                  +{pSections.length - 3} more
                                </span>
                              )}
                            </div>
                          )}

                          <div className="home-card-footer spread">
                            {pTotalMsgs > 0 ? (
                              <button
                                type="button"
                                className="home-continue-chat-link"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  const lastChat = activeT?.messages[activeT.messages.length - 1]
                                  void handleContinueProjectChat(proj, {
                                    sectionId: lastChat?.sectionId,
                                    threadId: activeT?.id
                                  })
                                }}
                                title="Resume this project's AI chat where you left off"
                              >
                                <MessageSquare size={12} />
                                <span>Continue Chat</span>
                              </button>
                            ) : (
                              <span />
                            )}
                            <span className="home-open-link">
                              Open sections <ArrowRight size={13} />
                            </span>
                          </div>
                        </article>
                      )
                    })}

                    <button
                      type="button"
                      className="home-add-dashed-card"
                      onClick={openCreateProjectModal}
                    >
                      <Plus size={22} />
                      <span>New Project</span>
                      <small>Start a new course or subject</small>
                    </button>
                  </div>
                )}
              </>
            ) : (
              /* Selected Project -> Sections View */
              <>
                <header className="home-panel-header project-detail">
                  <div className="home-project-crumb-row">
                    <button
                      type="button"
                      className="home-back-btn"
                      onClick={() => setSelectedProjectId(null)}
                    >
                      <ArrowLeft size={14} />
                      <span>All Projects</span>
                    </button>
                    <div className="home-selected-project-title">
                      <span
                        className="home-card-dot lg"
                        style={{ background: selectedProject.color || '#00F5D4' }}
                      />
                      <div>
                        <h3>{selectedProject.title}</h3>
                        <p>
                          {selectedProject.description ||
                            'Create a new section for each topic so you can focus only on that topic.'}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="home-project-detail-actions">
                    <button
                      type="button"
                      className="home-btn compact secondary"
                      onClick={() => {
                        const pStore = projectChatStores[selectedProject.id]
                        const activeT =
                          pStore?.threads.find((t) => t.id === pStore.activeThreadId) ||
                          pStore?.threads[0]
                        const lastChat = activeT?.messages[activeT.messages.length - 1]
                        void handleContinueProjectChat(selectedProject, {
                          sectionId: lastChat?.sectionId,
                          threadId: activeT?.id
                        })
                      }}
                      title="Open AI Chat for this project right where you left off"
                    >
                      <MessageSquare size={13} />
                      <span>Continue Chat</span>
                    </button>
                    <button
                      type="button"
                      className="home-btn compact ghost"
                      onClick={() => openEditProjectModal(selectedProject)}
                      title="Edit Project Details"
                    >
                      <Pencil size={13} />
                      <span>Edit</span>
                    </button>
                    <button
                      type="button"
                      className="home-btn compact primary"
                      onClick={() => openCreateSectionModal(selectedProject.id)}
                    >
                      <Plus size={14} />
                      <span>New Section</span>
                    </button>
                  </div>
                </header>

                {activeProjectSections.length === 0 && !q ? (
                  <div className="home-empty-state">
                    <div className="home-empty-icon">
                      <Layers size={28} />
                    </div>
                    <h4>No sections in &ldquo;{selectedProject.title}&rdquo; yet</h4>
                    <p>
                      Create your first topic section to get a clean, distraction-free whiteboard
                      dedicated solely to that topic.
                    </p>
                    <button
                      type="button"
                      className="home-btn primary"
                      onClick={() => openCreateSectionModal(selectedProject.id)}
                    >
                      <Plus size={15} />
                      <span>Create Topic Section</span>
                    </button>
                  </div>
                ) : activeProjectSections.length === 0 ? (
                  <div className="home-empty-state">
                    <h4>No matching sections</h4>
                    <p>No sections matched &ldquo;{searchQuery}&rdquo;.</p>
                  </div>
                ) : (
                  <div className="home-card-grid">
                    {activeProjectSections.map((sec) => {
                      const b = sec.breakdown
                      const pills: string[] = []
                      if (b?.notes) pills.push(`${b.notes} Note${b.notes > 1 ? 's' : ''}`)
                      if (b?.diagrams) pills.push(`${b.diagrams} Diagram${b.diagrams > 1 ? 's' : ''}`)
                      if (b?.code) pills.push(`${b.code} Code`)
                      if (b?.equations) pills.push(`${b.equations} Eq`)
                      if (b?.videos) pills.push(`${b.videos} Video${b.videos > 1 ? 's' : ''}`)
                      if (b?.strokes) pills.push(`${b.strokes} Ink`)

                      return (
                        <article
                          key={sec.id}
                          className="home-section-card"
                          style={
                            { '--card-accent': selectedProject.color || '#00F5D4' } as React.CSSProperties
                          }
                          onClick={() => onOpenSection(sec, selectedProject)}
                        >
                          <div className="home-card-top">
                            <div className="home-card-title-wrap">
                              <Layers size={15} className="home-sec-icon" />
                              <h4>{sec.title}</h4>
                            </div>
                            <div
                              className="home-card-actions"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                title="Rename Section"
                                onClick={() => openEditSectionModal(sec)}
                              >
                                <Pencil size={13} />
                              </button>
                              <button
                                type="button"
                                className="danger"
                                title="Delete Section"
                                onClick={() =>
                                  setConfirmDelete({
                                    kind: 'section',
                                    id: sec.id,
                                    title: sec.title
                                  })
                                }
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </div>

                          {sec.description && (
                            <p className="home-card-desc">{sec.description}</p>
                          )}

                          {sec.previewText && (
                            <p className="home-sec-preview">&ldquo;{sec.previewText}&rdquo;</p>
                          )}

                          <div className="home-sec-breakdown">
                            {pills.length > 0 ? (
                              pills.map((label) => (
                                <span key={label} className="home-breakdown-pill">
                                  {label}
                                </span>
                              ))
                            ) : (
                              <span className="home-breakdown-pill empty">
                                Blank canvas · ready to study
                              </span>
                            )}
                          </div>

                          <div className="home-card-footer spread">
                            <span className="home-meta-chip">
                              <Clock size={12} />
                              {formatRelativeTime(sec.updatedAt)}
                            </span>
                            <span className="home-open-link">
                              Focus Section <ArrowRight size={13} />
                            </span>
                          </div>
                        </article>
                      )
                    })}

                    <button
                      type="button"
                      className="home-add-dashed-card"
                      onClick={() => openCreateSectionModal(selectedProject.id)}
                    >
                      <Plus size={22} />
                      <span>New Topic Section</span>
                      <small>Focus on a new topic under {selectedProject.title}</small>
                    </button>
                  </div>
                )}
              </>
            )}
          </section>

          {/* Right: Overall History OR Selected Project Chat + History */}
          <aside className="home-panel glass home-history-panel">
            {selectedProject ? (
              (() => {
                const pStore = projectChatStores[selectedProject.id]
                const pThreads = pStore?.threads ?? []
                const activeThreadId =
                  selectedThreadByProject[selectedProject.id] ||
                  pStore?.activeThreadId ||
                  pThreads[0]?.id
                const activeThread =
                  pThreads.find((t) => t.id === activeThreadId) || pThreads[0]
                const projMessages = activeThread?.messages ?? []
                const totalMsgs = pThreads.reduce((acc, t) => acc + t.messages.length, 0)
                const filteredProjMessages = q
                  ? projMessages.filter(
                      (m) =>
                        m.content.toLowerCase().includes(q) ||
                        (m.sectionTitle ?? '').toLowerCase().includes(q)
                    )
                  : projMessages

                return (
                  <>
                    <header className="home-panel-header">
                      <div>
                        <h3>
                          {projectRightTab === 'chat' ? (
                            <MessageSquare size={17} />
                          ) : (
                            <History size={17} />
                          )}
                          <span>
                            {projectRightTab === 'chat'
                              ? `${selectedProject.title} Chats`
                              : `${selectedProject.title} History`}
                          </span>
                        </h3>
                        <p>
                          {projectRightTab === 'chat'
                            ? 'Multiple chat threads per project — start a new chat anytime to keep token context lean.'
                            : 'Everything created across sections in this project.'}
                        </p>
                      </div>
                    </header>

                    <div className="home-right-tabs">
                      <button
                        type="button"
                        className={`home-right-tab-btn ${projectRightTab === 'chat' ? 'active' : ''}`}
                        onClick={() => setProjectRightTab('chat')}
                      >
                        <MessageSquare size={13} />
                        <span>Chats ({pThreads.length || 1})</span>
                        <span className="home-tab-badge">{totalMsgs}</span>
                      </button>
                      <button
                        type="button"
                        className={`home-right-tab-btn ${projectRightTab === 'history' ? 'active' : ''}`}
                        onClick={() => setProjectRightTab('history')}
                      >
                        <History size={13} />
                        <span>Creations</span>
                        <span className="home-tab-badge">{filteredHistoryEntries.length}</span>
                      </button>
                    </div>

                    {projectRightTab === 'chat' ? (
                      <>
                        {pThreads.length > 0 && (
                          <div className="home-thread-pills">
                            {pThreads.map((t) => (
                              <button
                                key={t.id}
                                type="button"
                                className={`home-thread-pill ${t.id === activeThread?.id ? 'active' : ''}`}
                                onClick={() => {
                                  setSelectedThreadByProject((prev) => ({
                                    ...prev,
                                    [selectedProject.id]: t.id
                                  }))
                                  if (pStore) {
                                    const updatedStore: ProjectChatStore = {
                                      ...pStore,
                                      activeThreadId: t.id
                                    }
                                    setProjectChatStores((prev) => ({
                                      ...prev,
                                      [selectedProject.id]: updatedStore
                                    }))
                                    void persistProjectChatStore(selectedProject.id, updatedStore)
                                  }
                                }}
                                title={`${t.title} (${t.messages.length} messages)`}
                              >
                                <span className="home-thread-pill-title">{t.title}</span>
                                <span className="home-thread-pill-cnt">{t.messages.length}</span>
                              </button>
                            ))}
                            <button
                              type="button"
                              className="home-thread-pill new"
                              onClick={() =>
                                void handleContinueProjectChat(selectedProject, { newThread: true })
                              }
                              title="Start a brand new chat thread in this project to save tokens"
                            >
                              <Plus size={12} />
                              <span>New Chat</span>
                            </button>
                          </div>
                        )}

                        <div className="home-history-list">
                          {filteredProjMessages.length === 0 ? (
                            <div className="home-history-empty">
                              <MessageSquare size={24} />
                              <p>
                                {q
                                  ? `No chat messages matched "${searchQuery}".`
                                  : `No messages in "${activeThread?.title || 'this chat'}" yet. Start a chat to ask questions, generate diagrams, or build study guides!`}
                              </p>
                            </div>
                          ) : (
                            filteredProjMessages.map((msg) => {
                              const isUser = msg.role === 'user'
                              return (
                                <button
                                  key={msg.id}
                                  type="button"
                                  className={`home-chat-history-item ${isUser ? 'user' : 'assistant'}`}
                                  onClick={() =>
                                    void handleContinueProjectChat(selectedProject, {
                                      sectionId: msg.sectionId,
                                      threadId: activeThread?.id
                                    })
                                  }
                                  title="Click to continue this conversation"
                                >
                                  <div className={`home-history-badge ${isUser ? 'sky' : 'teal'}`}>
                                    {isUser ? <User size={14} /> : <Bot size={14} />}
                                  </div>
                                  <div className="home-history-content">
                                    <div className="home-history-top">
                                      <span className="home-history-title">
                                        {isUser ? 'You' : 'AI Co-Pilot'}
                                      </span>
                                      <span className="home-history-time">
                                        {formatRelativeTime(msg.timestamp)}
                                      </span>
                                    </div>
                                    <p className="home-chat-msg-preview">{msg.content}</p>
                                    {msg.sectionTitle && (
                                      <div className="home-history-meta">
                                        <span className="home-kind-tag teal">Section</span>
                                        <span className="home-history-loc">{msg.sectionTitle}</span>
                                      </div>
                                    )}
                                  </div>
                                </button>
                              )
                            })
                          )}
                        </div>

                        <div className="home-project-chat-footer">
                          <button
                            type="button"
                            className="home-btn primary full"
                            onClick={() => {
                              const lastMsg = projMessages[projMessages.length - 1]
                              void handleContinueProjectChat(selectedProject, {
                                sectionId: lastMsg?.sectionId,
                                threadId: activeThread?.id
                              })
                            }}
                          >
                            <MessageSquare size={14} />
                            <span>
                              {projMessages.length > 0
                                ? `Continue "${activeThread?.title || 'Chat'}"`
                                : 'Start Project Chat'}
                            </span>
                            <ArrowRight size={14} />
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="home-history-filters">
                          {(
                            [
                              { id: 'all', label: 'All' },
                              { id: 'text', label: 'Notes' },
                              { id: 'diagram', label: 'Diagrams' },
                              { id: 'code', label: 'Code' },
                              { id: 'equation', label: 'Equations' },
                              { id: 'video', label: 'Videos' },
                              { id: 'source', label: 'Sources' },
                              { id: 'event', label: 'Activity' }
                            ] as { id: HistoryFilter; label: string }[]
                          ).map((f) => (
                            <button
                              key={f.id}
                              type="button"
                              className={`home-filter-pill ${historyFilter === f.id ? 'active' : ''}`}
                              onClick={() => setHistoryFilter(f.id)}
                            >
                              {f.label}
                            </button>
                          ))}
                        </div>

                        <div className="home-history-list">
                          {filteredHistoryEntries.length === 0 ? (
                            <div className="home-history-empty">
                              <History size={24} />
                              <p>
                                {q || historyFilter !== 'all'
                                  ? 'No history items match this filter.'
                                  : 'Nothing created in this project yet.'}
                              </p>
                            </div>
                          ) : (
                            filteredHistoryEntries.map((entry) => {
                              const meta = getHistoryKindMeta(entry)
                              return (
                                <button
                                  key={entry.id}
                                  type="button"
                                  className="home-history-item"
                                  onClick={() => handleOpenHistoryEntry(entry)}
                                  title={`Open "${entry.sectionTitle || 'Section'}"`}
                                >
                                  <div className={`home-history-badge ${meta.colorClass}`}>
                                    {meta.icon}
                                  </div>
                                  <div className="home-history-content">
                                    <div className="home-history-top">
                                      <span className="home-history-title">{entry.title}</span>
                                      <span className="home-history-time">
                                        {formatRelativeTime(entry.timestamp)}
                                      </span>
                                    </div>
                                    {entry.snippet && (
                                      <p className="home-history-snippet">{entry.snippet}</p>
                                    )}
                                    <div className="home-history-meta">
                                      <span className={`home-kind-tag ${meta.colorClass}`}>
                                        {meta.label}
                                      </span>
                                      <span className="home-history-loc">
                                        {entry.sectionTitle || 'Study Board'}
                                      </span>
                                    </div>
                                  </div>
                                </button>
                              )
                            })
                          )}
                        </div>
                      </>
                    )}
                  </>
                )
              })()
            ) : (
              <>
                <header className="home-panel-header">
                  <div>
                    <h3>
                      <History size={17} />
                      <span>Overall History</span>
                    </h3>
                    <p>Everything you have created so far across all projects &amp; sections.</p>
                  </div>
                </header>

                <div className="home-history-filters">
                  {(
                    [
                      { id: 'all', label: 'All' },
                      { id: 'text', label: 'Notes' },
                      { id: 'diagram', label: 'Diagrams' },
                      { id: 'code', label: 'Code' },
                      { id: 'equation', label: 'Equations' },
                      { id: 'video', label: 'Videos' },
                      { id: 'source', label: 'Sources' },
                      { id: 'event', label: 'Activity' }
                    ] as { id: HistoryFilter; label: string }[]
                  ).map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      className={`home-filter-pill ${historyFilter === f.id ? 'active' : ''}`}
                      onClick={() => setHistoryFilter(f.id)}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                <div className="home-history-list">
                  {filteredHistoryEntries.length === 0 ? (
                    <div className="home-history-empty">
                      <History size={24} />
                      <p>
                        {q || historyFilter !== 'all'
                          ? 'No history items match this filter.'
                          : 'Nothing created yet. Create a project & section and start drawing, writing notes, or building diagrams!'}
                      </p>
                    </div>
                  ) : (
                    filteredHistoryEntries.map((entry) => {
                      const meta = getHistoryKindMeta(entry)
                      return (
                        <button
                          key={entry.id}
                          type="button"
                          className="home-history-item"
                          onClick={() => handleOpenHistoryEntry(entry)}
                          title={`Open "${entry.sectionTitle || 'Section'}"`}
                        >
                          <div className={`home-history-badge ${meta.colorClass}`}>{meta.icon}</div>
                          <div className="home-history-content">
                            <div className="home-history-top">
                              <span className="home-history-title">{entry.title}</span>
                              <span className="home-history-time">
                                {formatRelativeTime(entry.timestamp)}
                              </span>
                            </div>
                            {entry.snippet && (
                              <p className="home-history-snippet">{entry.snippet}</p>
                            )}
                            <div className="home-history-meta">
                              <span className={`home-kind-tag ${meta.colorClass}`}>{meta.label}</span>
                              <span className="home-history-loc">
                                {entry.projectTitle ? `${entry.projectTitle} › ` : ''}
                                {entry.sectionTitle || 'Study Board'}
                              </span>
                            </div>
                          </div>
                        </button>
                      )
                    })
                  )}
                </div>
              </>
            )}
          </aside>
        </div>
      </div>

      {/* Create / Edit Project Modal */}
      {projectModal && (
        <div
          className="modal-backdrop"
          onPointerDown={(e) => e.target === e.currentTarget && setProjectModal(null)}
        >
          <section className="modal glass home-modal" role="dialog" aria-labelledby="proj-modal-title">
            <header className="modal-header">
              <h2 id="proj-modal-title">
                {projectModal.mode === 'create' ? 'Create New Project' : 'Edit Project'}
              </h2>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setProjectModal(null)}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </header>

            <form className="modal-body" onSubmit={(e) => void handleSaveProject(e, true)}>
              <div className="field">
                <label htmlFor="proj-title-input">Project / Course Name</label>
                <input
                  id="proj-title-input"
                  type="text"
                  autoFocus
                  required
                  placeholder="e.g. Operating Systems, Machine Learning, System Design"
                  value={projTitle}
                  onChange={(e) => setProjTitle(e.target.value)}
                />
              </div>

              <div className="field">
                <label htmlFor="proj-desc-input">Description (optional)</label>
                <input
                  id="proj-desc-input"
                  type="text"
                  placeholder="Course code, semester, or learning goal"
                  value={projDesc}
                  onChange={(e) => setProjDesc(e.target.value)}
                />
              </div>

              <div className="field">
                <label>Accent Color</label>
                <div className="home-color-picker">
                  {PROJECT_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={`home-color-swatch ${projColor === c ? 'active' : ''}`}
                      style={{ background: c }}
                      onClick={() => setProjColor(c)}
                      aria-label={`Select color ${c}`}
                    />
                  ))}
                </div>
              </div>

              {projectModal.mode === 'create' && (
                <div className="field">
                  <label htmlFor="proj-first-sec-input">
                    First Topic Section (optional — jump right in)
                  </label>
                  <input
                    id="proj-first-sec-input"
                    type="text"
                    placeholder="e.g. Lecture 1: Introduction"
                    value={firstSectionTitle}
                    onChange={(e) => setFirstSectionTitle(e.target.value)}
                  />
                </div>
              )}

              <div className="home-modal-actions">
                <button
                  type="button"
                  className="home-btn ghost"
                  onClick={() => setProjectModal(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="home-btn primary"
                  disabled={!projTitle.trim() || submitting}
                >
                  {projectModal.mode === 'create'
                    ? firstSectionTitle.trim()
                      ? 'Create & Open Section'
                      : 'Create Project'
                    : 'Save Changes'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {/* Create / Edit Section Modal */}
      {sectionModal && (
        <div
          className="modal-backdrop"
          onPointerDown={(e) => e.target === e.currentTarget && setSectionModal(null)}
        >
          <section className="modal glass home-modal" role="dialog" aria-labelledby="sec-modal-title">
            <header className="modal-header">
              <h2 id="sec-modal-title">
                {sectionModal.mode === 'create' ? 'New Topic Section' : 'Edit Topic Section'}
              </h2>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setSectionModal(null)}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </header>

            <form className="modal-body" onSubmit={(e) => void handleSaveSection(e, true)}>
              <div className="field">
                <label htmlFor="sec-title-input">Topic / Section Title</label>
                <input
                  id="sec-title-input"
                  type="text"
                  autoFocus
                  required
                  placeholder="e.g. Backpropagation, Binary Trees, Lecture 4"
                  value={secTitle}
                  onChange={(e) => setSecTitle(e.target.value)}
                />
              </div>

              <div className="field">
                <label htmlFor="sec-desc-input">Focus Goal / Notes (optional)</label>
                <input
                  id="sec-desc-input"
                  type="text"
                  placeholder="What are you focusing on in this section?"
                  value={secDesc}
                  onChange={(e) => setSecDesc(e.target.value)}
                />
              </div>

              <div className="home-modal-actions">
                <button
                  type="button"
                  className="home-btn ghost"
                  onClick={() => setSectionModal(null)}
                >
                  Cancel
                </button>
                {sectionModal.mode === 'create' && (
                  <button
                    type="button"
                    className="home-btn secondary"
                    disabled={!secTitle.trim() || submitting}
                    onClick={(e) => void handleSaveSection(e, false)}
                  >
                    Create Only
                  </button>
                )}
                <button
                  type="submit"
                  className="home-btn primary"
                  disabled={!secTitle.trim() || submitting}
                >
                  {sectionModal.mode === 'create' ? 'Create & Focus' : 'Save Changes'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {/* Confirm Delete Modal */}
      {confirmDelete && (
        <div
          className="modal-backdrop"
          onPointerDown={(e) => e.target === e.currentTarget && setConfirmDelete(null)}
        >
          <section className="modal glass home-modal compact" role="dialog">
            <header className="modal-header">
              <h2>Delete {confirmDelete.kind === 'project' ? 'Project' : 'Section'}?</h2>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setConfirmDelete(null)}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </header>
            <div className="modal-body">
              <p className="home-confirm-text">
                Are you sure you want to delete <strong>{confirmDelete.title}</strong>?{' '}
                {confirmDelete.kind === 'project'
                  ? 'All sections, notes, diagrams, and drawings inside this project will be permanently removed.'
                  : 'All notes, diagrams, and drawings in this section will be permanently removed.'}
              </p>
              <div className="home-modal-actions">
                <button
                  type="button"
                  className="home-btn ghost"
                  onClick={() => setConfirmDelete(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="home-btn danger"
                  disabled={submitting}
                  onClick={() => void handleConfirmDelete()}
                >
                  Delete
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
