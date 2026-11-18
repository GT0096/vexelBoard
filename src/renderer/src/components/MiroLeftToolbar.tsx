import React, { useState, useRef, useEffect, useMemo } from 'react'
import {
  MousePointer,
  Hand,
  PenTool,
  Eraser,
  Square,
  StickyNote,
  Sparkles,
  LayoutTemplate,
  Diamond,
  Database,
  Cloud,
  FileText,
  User,
  Circle,
  FolderOpen,
  Layers,
  ChevronDown,
  ChevronRight,
  Workflow,
  Server,
  GitBranch,
  Boxes,
  Compass,
  Search,
  X,
  Zap,
  Code2,
  Video,
  BookOpen
} from 'lucide-react'
import type { CodeTabItem, PenType, ToolType } from '../types/board'
import type { BoardPalette } from '../board/backgroundPresets'
import { resolvePenColorHex } from '../board/penUtils'
import { PenControls } from './PenControls'
import {
  ALL_LIBRARY_SHAPES,
  ANIMATED_LINE_SHAPES,
  SHAPE_CATEGORIES,
  type LibraryShapeDef
} from '../shapes/shapeLibrary'
import { ShapeSvg } from '../shapes/ShapeSvg'

export interface MiroLeftToolbarProps {
  activeTool: ToolType
  onSelectTool: (tool: ToolType) => void
  onAddShapeNode: (
    shapeType: string,
    options?: {
      label?: string
      description?: string
      color?: string
      w?: number
      h?: number
      shapeId?: string
      animated?: boolean
    }
  ) => void
  onAddStickyNote: (color: string) => void
  onAddTemplate: (templateId: string) => void
  onBeautify: () => void
  isBeautifying?: boolean
  hasSelection?: boolean
  onAddCodeNode?: (initialTab?: CodeTabItem) => void
  onOpenNotebookLM?: () => void
  onAddYouTubeVideo?: () => void
  boardPalette?: BoardPalette
  penColor: string
  onPenColor: (c: string) => void
  penSize: number
  onPenSize: (s: number) => void
  penType: PenType
  onPenType: (t: PenType) => void
  themeInk: string
  themeAccent: string
}

interface ShapeItem {
  type: string
  label: string
  desc: string
  icon: React.ReactNode
}

const SHAPES_LIST: ShapeItem[] = [
  { type: 'process', label: 'Process', desc: 'Standard action step', icon: <Square size={16} /> },
  { type: 'decision', label: 'Decision', desc: 'Condition or branch', icon: <Diamond size={16} /> },
  { type: 'startEnd', label: 'Start / End', desc: 'Entry or exit pill', icon: <Circle size={16} /> },
  { type: 'database', label: 'Database', desc: 'SQL / Redis / Table', icon: <Database size={16} /> },
  { type: 'cloud', label: 'Cloud API', desc: 'Gateway or service', icon: <Cloud size={16} /> },
  { type: 'document', label: 'Document', desc: 'File or specification', icon: <FileText size={16} /> },
  { type: 'inputOutput', label: 'Input / Output', desc: 'Parallelogram I/O', icon: <Layers size={16} /> },
  { type: 'actor', label: 'Actor / User', desc: 'Client or human role', icon: <User size={16} /> },
  { type: 'circle', label: 'State Circle', desc: 'Event or circular node', icon: <Circle size={16} /> },
  { type: 'group', label: 'Group Frame', desc: 'Resizable container', icon: <FolderOpen size={16} /> },
  { type: 'sticky', label: 'Sticky Note', desc: 'Quick note card', icon: <StickyNote size={16} /> },
  { type: 'custom', label: 'Custom Card', desc: 'Generic component', icon: <Square size={16} /> }
]

const STICKY_COLORS = [
  { name: 'Yellow', color: '#fef08a', text: '#713f12' },
  { name: 'Green', color: '#bbf7d0', text: '#14532d' },
  { name: 'Pink', color: '#fbcfe8', text: '#831843' },
  { name: 'Blue', color: '#bae6fd', text: '#0c4a6e' },
  { name: 'Orange', color: '#fed7aa', text: '#7c2d12' },
  { name: 'Purple', color: '#e9d5ff', text: '#581c87' }
]

const TEMPLATES = [
  {
    id: 'flowchart',
    title: 'Standard Flowchart',
    desc: 'Start -> Action -> Decision -> Success/Error -> Finish',
    icon: <Workflow size={16} className="text-accent" />
  },
  {
    id: 'microservices',
    title: 'Cloud Architecture',
    desc: 'Client -> API Gateway -> Auth / Services -> DB / Redis',
    icon: <Server size={16} className="text-accent" />
  },
  {
    id: 'mindmap',
    title: 'Mindmap / Brainstorm',
    desc: 'Central concept with radiating sub-branches',
    icon: <GitBranch size={16} className="text-accent" />
  },
  {
    id: 'erd',
    title: 'Entity Relationship (ERD)',
    desc: 'Users, Orders, Products, and Payments relational flow',
    icon: <Boxes size={16} className="text-accent" />
  },
  {
    id: 'user_journey',
    title: 'User Journey Funnel',
    desc: 'Landing -> Sign Up -> Onboarding -> Activation',
    icon: <Compass size={16} className="text-accent" />
  }
]

export const MiroLeftToolbar: React.FC<MiroLeftToolbarProps> = ({
  activeTool,
  onSelectTool,
  onAddShapeNode,
  onAddStickyNote,
  onAddTemplate,
  onBeautify,
  isBeautifying,
  hasSelection,
  onAddCodeNode,
  onOpenNotebookLM,
  onAddYouTubeVideo,
  boardPalette,
  penColor,
  onPenColor,
  penSize,
  onPenSize,
  penType,
  onPenType,
  themeInk,
  themeAccent
}) => {
  const [openFlyout, setOpenFlyout] = useState<'pen' | 'shapes' | 'stickies' | 'templates' | null>(null)
  const resolvedPenColor = resolvePenColorHex(penColor, themeInk, themeAccent)
  const [searchQuery, setSearchQuery] = useState('')
  const [animFilter, setAnimFilter] = useState<'all' | 'animated'>('all')
  const [activeCategory, setActiveCategory] = useState<string>('all')
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({})
  const containerRef = useRef<HTMLDivElement>(null)
  const flyoutRef = useRef<HTMLDivElement | null>(null)
  const catRailRef = useRef<HTMLDivElement | null>(null)
  const catalogScrollRef = useRef<HTMLDivElement | null>(null)

  const isAnimatedMode = animFilter === 'animated'

  const categoryNameById = useMemo(
    () => new Map(SHAPE_CATEGORIES.map((c) => [c.id, c.name])),
    []
  )

  const filteredCoreShapes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return SHAPES_LIST
    return SHAPES_LIST.filter(
      (s) =>
        s.label.toLowerCase().includes(q) ||
        s.type.toLowerCase().includes(q) ||
        s.desc.toLowerCase().includes(q)
    )
  }, [searchQuery])

  const filteredAnimatedLines: LibraryShapeDef[] = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (activeCategory !== 'all' && activeCategory !== 'lines') {
      return []
    }
    const baseLines = isAnimatedMode
      ? [...ANIMATED_LINE_SHAPES, ...ALL_LIBRARY_SHAPES.filter((s) => s.category === 'lines')]
      : ANIMATED_LINE_SHAPES
    if (!q) return baseLines
    return baseLines.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q) ||
        s.aliases.some((a) => a.toLowerCase().includes(q)) ||
        s.tags.some((t) => t.toLowerCase().includes(q))
    )
  }, [activeCategory, isAnimatedMode, searchQuery])

  const filteredLibraryShapes: LibraryShapeDef[] = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return ALL_LIBRARY_SHAPES.filter((s) => {
      if (activeCategory !== 'all' && activeCategory !== 'core' && s.category !== activeCategory) {
        return false
      }
      if (!q) return true
      return (
        s.name.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q) ||
        s.aliases.some((a) => a.toLowerCase().includes(q)) ||
        s.tags.some((t) => t.toLowerCase().includes(q))
      )
    })
  }, [activeCategory, searchQuery])

  const groupedCategories = useMemo(() => {
    const byCat = new Map<string, LibraryShapeDef[]>()
    for (const shape of filteredLibraryShapes) {
      const list = byCat.get(shape.category)
      if (list) list.push(shape)
      else byCat.set(shape.category, [shape])
    }
    return SHAPE_CATEGORIES.map((cat) => ({
      cat,
      shapes: byCat.get(cat.id) ?? []
    })).filter((group) => group.shapes.length > 0)
  }, [filteredLibraryShapes])

  const toggleCategoryCollapsed = (catId: string): void => {
    setCollapsedCategories((prev) => ({ ...prev, [catId]: !prev[catId] }))
  }

  // Close flyout on outside click
  useEffect(() => {
    const handleOutside = (e: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpenFlyout(null)
      }
    }
    window.addEventListener('mousedown', handleOutside)
    return () => window.removeEventListener('mousedown', handleOutside)
  }, [])

  // Native non-passive wheel listener so flyout scrolling never leaks to the whiteboard or note cards
  useEffect(() => {
    const flyoutEl = flyoutRef.current
    if (!flyoutEl || !openFlyout) return

    const handleFlyoutWheel = (e: WheelEvent): void => {
      e.preventDefault()
      e.stopPropagation()

      const deltaY =
        e.deltaMode === 1 ? e.deltaY * 30 : e.deltaMode === 2 ? e.deltaY * 300 : e.deltaY
      const deltaX =
        e.deltaMode === 1 ? e.deltaX * 30 : e.deltaMode === 2 ? e.deltaX * 300 : e.deltaX

      const targetEl = e.target as HTMLElement | null
      const catRailEl = catRailRef.current
      if (catRailEl && (targetEl?.closest('.miro-cat-rail') === catRailEl || catRailEl.contains(targetEl))) {
        catRailEl.scrollLeft += deltaX !== 0 ? deltaX : deltaY
        return
      }

      const catalogScrollEl = catalogScrollRef.current
      if (catalogScrollEl) {
        if (e.shiftKey && deltaY !== 0 && deltaX === 0) {
          catalogScrollEl.scrollLeft += deltaY
        } else {
          catalogScrollEl.scrollTop += deltaY
          if (deltaX !== 0) {
            catalogScrollEl.scrollLeft += deltaX
          }
        }
        return
      }

      flyoutEl.scrollTop += deltaY
      if (deltaX !== 0) {
        flyoutEl.scrollLeft += deltaX
      }
    }

    flyoutEl.addEventListener('wheel', handleFlyoutWheel, { passive: false })
    return () => flyoutEl.removeEventListener('wheel', handleFlyoutWheel)
  }, [openFlyout])

  const toggleFlyout = (flyout: 'pen' | 'shapes' | 'stickies' | 'templates'): void => {
    setOpenFlyout((prev) => (prev === flyout ? null : flyout))
  }

  const renderShapeTile = (shape: LibraryShapeDef, forceAnimated = false): React.JSX.Element => {
    const catTitle = categoryNameById.get(shape.category) || shape.category
    const animated = forceAnimated || isAnimatedMode || shape.id.startsWith('anim-line-')
    return (
      <button
        key={`${animated ? 'anim' : 'std'}-${shape.id}`}
        type="button"
        className={`miro-shape-tile ${animated ? 'is-animated' : ''}`}
        title={animated ? `${shape.name} — ${catTitle} (Animated)` : `${shape.name} — ${catTitle}`}
        onClick={() => {
          onAddShapeNode(shape.id, {
            label: shape.defaultLabel !== undefined ? shape.defaultLabel : shape.name,
            description: '',
            color: shape.defaultFill,
            w: shape.size[0],
            h: shape.size[1],
            shapeId: shape.id,
            animated
          })
          setOpenFlyout(null)
        }}
      >
        <div className="miro-shape-tile-preview">
          <ShapeSvg
            shape={shape}
            strokeColor={boardPalette?.shapeStroke ?? '#111111'}
            fillColor={shape.defaultFill || boardPalette?.shapeFill || '#FFE566'}
            strokeWidth={1.7}
            preserveAspectRatio="xMidYMid meet"
            className="miro-shape-tile-svg"
            animated={animated}
          />
        </div>
        <span className="miro-shape-tile-name">{shape.name}</span>
        {animated && (
          <span className="miro-shape-tile-anim-badge" title="Animated shape" aria-hidden="true">
            <Zap size={9} />
          </span>
        )}
      </button>
    )
  }

  const renderCoreNodesGrid = (): React.JSX.Element => (
    <div className="miro-shape-grid">
      {filteredCoreShapes.map((shape) => (
        <button
          key={shape.type}
          type="button"
          className={`miro-shape-chip ${isAnimatedMode ? 'is-animated' : ''}`}
          title={isAnimatedMode ? `${shape.desc} (Animated)` : shape.desc}
          onClick={() => {
            onAddShapeNode(shape.type, {
              label: shape.label,
              description: shape.desc,
              animated: isAnimatedMode
            })
            setOpenFlyout(null)
          }}
        >
          <span className="miro-shape-chip-icon">{shape.icon}</span>
          <span className="miro-shape-chip-text">
            <strong>{isAnimatedMode ? `Animated ${shape.label}` : shape.label}</strong>
            <small>{shape.desc}</small>
          </span>
        </button>
      ))}
    </div>
  )

  return (
    <div className="miro-left-dock" ref={containerRef}>
      {/* 1. Selection Tool */}
      <button
        type="button"
        className={`miro-dock-btn ${activeTool === 'select' ? 'active' : ''}`}
        onClick={() => {
          onSelectTool('select')
          setOpenFlyout(null)
        }}
        title="Select & Move elements (V)"
      >
        <MousePointer size={18} />
      </button>

      {/* 2. Hand / Pan Canvas Tool */}
      <button
        type="button"
        className={`miro-dock-btn ${activeTool === 'pan' ? 'active' : ''}`}
        onClick={() => {
          onSelectTool('pan')
          setOpenFlyout(null)
        }}
        title="Hand / Pan canvas (H or Space+Drag)"
      >
        <Hand size={18} />
      </button>

      <div className="miro-dock-divider" />

      {/* 3. Pen Drawing Tool */}
      <button
        type="button"
        className={`miro-dock-btn miro-pen-btn ${activeTool === 'pen' ? 'active' : ''}`}
        onClick={() => {
          const wasPen = activeTool === 'pen'
          onSelectTool('pen')
          setOpenFlyout((prev) => (wasPen && prev === 'pen' ? null : 'pen'))
        }}
        title="Pen / Whiteboard Ink (P) — Color, Thickness & Pen Type"
      >
        <PenTool size={18} />
        <span
          className="miro-pen-color-dot"
          style={{ background: resolvedPenColor }}
          aria-hidden="true"
        />
      </button>

      {/* 4. Eraser Tool */}
      <button
        type="button"
        className={`miro-dock-btn ${activeTool === 'eraser' ? 'active' : ''}`}
        onClick={() => {
          onSelectTool('eraser')
          setOpenFlyout(null)
        }}
        title="Eraser (E)"
      >
        <Eraser size={18} />
      </button>

      <div className="miro-dock-divider" />

      {/* 5. Shapes & Flowchart Nodes Flyout */}
      <button
        type="button"
        className={`miro-dock-btn ${openFlyout === 'shapes' ? 'active' : ''}`}
        onClick={() => toggleFlyout('shapes')}
        title="All Shapes & Flowchart Components"
      >
        <Square size={18} />
      </button>

      {/* 6. Sticky Notes Flyout */}
      <button
        type="button"
        className={`miro-dock-btn ${openFlyout === 'stickies' ? 'active' : ''}`}
        onClick={() => toggleFlyout('stickies')}
        title="Sticky Notes"
      >
        <StickyNote size={18} />
      </button>

      {/* 7. Templates Flyout */}
      <button
        type="button"
        className={`miro-dock-btn ${openFlyout === 'templates' ? 'active' : ''}`}
        onClick={() => toggleFlyout('templates')}
        title="Diagram & Architecture Templates"
      >
        <LayoutTemplate size={18} />
      </button>

      {/* 8. Add Coding Tab Container onto Board */}
      <button
        type="button"
        className="miro-dock-btn code-tab-btn"
        onClick={() => {
          setOpenFlyout(null)
          onAddCodeNode?.()
        }}
        title="Add Coding Tab Container — Place anywhere, drag, resize & run code in any language"
      >
        <Code2 size={18} />
      </button>

      {/* 8b. Add YouTube Interactive Video Card to Board */}
      <button
        type="button"
        className="miro-dock-btn"
        onClick={() => {
          setOpenFlyout(null)
          onAddYouTubeVideo?.()
        }}
        title="Add Interactive YouTube Video Card — Play on board & take timestamped notes"
        style={{ color: '#ef4444' }}
      >
        <Video size={18} />
      </button>

      {/* 8c. Open NotebookLM Knowledge Studio */}
      <button
        type="button"
        className="miro-dock-btn"
        onClick={() => {
          setOpenFlyout(null)
          onOpenNotebookLM?.()
        }}
        title="Open NotebookLM Knowledge Studio — Multi-source study, tutorials & recall"
        style={{ color: '#a78bfa' }}
      >
        <BookOpen size={18} />
      </button>

      <div className="miro-dock-divider" />

      {/* 9. AI Diagram Beautifier / Sketch Recognizer */}
      <button
        type="button"
        className={`miro-dock-btn magic-ai ${isBeautifying ? 'active' : ''}`}
        onClick={onBeautify}
        title={
          hasSelection
            ? 'Beautify selected sketch into interactive React Flow diagram'
            : 'AI Beautify Diagram (Auto-detect drawing strokes)'
        }
      >
        <Sparkles size={18} />
      </button>

      {/* ---------------- Flyout Panels ---------------- */}

      {/* 0. Pen Settings Flyout (Color, Thickness, Pen Type) */}
      {openFlyout === 'pen' && (
        <div
          ref={flyoutRef}
          className="miro-flyout-panel pen-flyout-panel"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="miro-flyout-header">
            <div className="miro-flyout-title">
              <span>Pen Settings</span>
              <span className="miro-count-pill">{penType}</span>
            </div>
            <button
              type="button"
              className="miro-flyout-close-btn"
              title="Close pen settings"
              onClick={() => setOpenFlyout(null)}
            >
              <X size={14} />
            </button>
          </div>

          <PenControls
            penColor={penColor}
            onPenColor={onPenColor}
            penSize={penSize}
            onPenSize={onPenSize}
            penType={penType}
            onPenType={onPenType}
            themeInk={themeInk}
            themeAccent={themeAccent}
            boardPalette={boardPalette}
            onActivatePen={() => onSelectTool('pen')}
          />
        </div>
      )}

      {/* A. Shapes Flyout (full shape catalog + animated shapes & lines + quick nodes) */}
      {openFlyout === 'shapes' && (
        <div
          ref={flyoutRef}
          className="miro-flyout-panel shapes-catalog"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="miro-flyout-header">
            <div className="miro-flyout-title">
              <span>Shapes</span>
              <span className="miro-count-pill">
                {activeCategory === 'core'
                  ? `${filteredCoreShapes.length} quick`
                  : `${filteredLibraryShapes.length +
                  (activeCategory === 'all' || activeCategory === 'lines'
                    ? filteredAnimatedLines.length
                    : 0)
                  }${isAnimatedMode ? ' animated' : ' shapes'}`}
              </span>
            </div>
            <button
              type="button"
              className="miro-flyout-close-btn"
              title="Close shapes panel"
              onClick={() => setOpenFlyout(null)}
            >
              <X size={14} />
            </button>
          </div>

          <div className="miro-catalog-controls">
            <div className="miro-shape-search">
              <Search size={13} className="miro-shape-search-icon" />
              <input
                type="text"
                className="miro-shape-search-input"
                placeholder={`Search ${ALL_LIBRARY_SHAPES.length + ANIMATED_LINE_SHAPES.length} shapes & lines...`}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                autoFocus
              />
              {searchQuery && (
                <button
                  type="button"
                  className="miro-shape-search-clear"
                  title="Clear search"
                  onClick={() => setSearchQuery('')}
                >
                  <X size={12} />
                </button>
              )}
            </div>

            <div className="miro-source-pills">
              <button
                type="button"
                className={`miro-filter-pill ${animFilter === 'all' ? 'active' : ''}`}
                onClick={() => setAnimFilter('all')}
              >
                All
              </button>
              <button
                type="button"
                className={`miro-filter-pill animated-pill ${animFilter === 'animated' ? 'active' : ''}`}
                onClick={() => setAnimFilter('animated')}
                title="Show animated lines and animated versions of every shape"
              >
                <Zap size={11} />
                <span>Animated Shapes</span>
              </button>
            </div>
          </div>

          <div
            ref={catRailRef}
            className="miro-cat-rail"
            role="tablist"
            aria-label="Shape categories"
          >
            <button
              type="button"
              className={`miro-cat-pill ${activeCategory === 'all' ? 'active' : ''}`}
              onClick={() => setActiveCategory('all')}
            >
              All ({ALL_LIBRARY_SHAPES.length + ANIMATED_LINE_SHAPES.length})
            </button>
            <button
              type="button"
              className={`miro-cat-pill animated-cat-pill ${isAnimatedMode ? 'active' : ''}`}
              title="Toggle Animated mode for all shapes and lines"
              onClick={() => setAnimFilter((prev) => (prev === 'animated' ? 'all' : 'animated'))}
            >
              <Zap size={10} />
              <span>Animated</span>
            </button>
            <button
              type="button"
              className={`miro-cat-pill ${activeCategory === 'core' ? 'active' : ''}`}
              onClick={() => setActiveCategory('core')}
            >
              Quick Nodes ({SHAPES_LIST.length})
            </button>
            {SHAPE_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                type="button"
                className={`miro-cat-pill ${activeCategory === cat.id ? 'active' : ''}`}
                title={cat.description}
                onClick={() => setActiveCategory(cat.id)}
              >
                {cat.name} (
                {cat.id === 'lines' ? cat.count + ANIMATED_LINE_SHAPES.length : cat.count})
              </button>
            ))}
          </div>

          <div ref={catalogScrollRef} className="miro-shape-catalog-scroll">
            {activeCategory === 'core' ? (
              filteredCoreShapes.length === 0 ? (
                <div className="miro-shape-empty">No matching quick nodes found.</div>
              ) : (
                renderCoreNodesGrid()
              )
            ) : activeCategory === 'all' ? (
              filteredCoreShapes.length === 0 &&
                filteredAnimatedLines.length === 0 &&
                groupedCategories.length === 0 ? (
                <div className="miro-shape-empty">No matching shapes found.</div>
              ) : (
                <div className="miro-cat-sections">
                  {filteredAnimatedLines.length > 0 && (
                    <section className="miro-cat-section">
                      <button
                        type="button"
                        className="miro-cat-section-header"
                        onClick={() => toggleCategoryCollapsed('animated-lines')}
                      >
                        <span className="miro-cat-section-title">
                          Animated Lines &amp; Connectors
                        </span>
                        <span className="miro-cat-section-meta">
                          <span className="miro-cat-section-count">
                            {filteredAnimatedLines.length}
                          </span>
                          {collapsedCategories['animated-lines'] ? (
                            <ChevronRight size={13} />
                          ) : (
                            <ChevronDown size={13} />
                          )}
                        </span>
                      </button>
                      {!collapsedCategories['animated-lines'] && (
                        <div className="miro-shape-catalog-grid">
                          {filteredAnimatedLines.map((s) => renderShapeTile(s, true))}
                        </div>
                      )}
                    </section>
                  )}

                  {filteredCoreShapes.length > 0 && (
                    <section className="miro-cat-section">
                      <button
                        type="button"
                        className="miro-cat-section-header"
                        onClick={() => toggleCategoryCollapsed('core')}
                      >
                        <span className="miro-cat-section-title">
                          {isAnimatedMode ? 'Animated Quick Diagram Nodes' : 'Quick Diagram Nodes'}
                        </span>
                        <span className="miro-cat-section-meta">
                          <span className="miro-cat-section-count">{filteredCoreShapes.length}</span>
                          {collapsedCategories.core ? (
                            <ChevronRight size={13} />
                          ) : (
                            <ChevronDown size={13} />
                          )}
                        </span>
                      </button>
                      {!collapsedCategories.core && renderCoreNodesGrid()}
                    </section>
                  )}

                  {groupedCategories.map(({ cat, shapes }) => {
                    const isCollapsed = Boolean(collapsedCategories[cat.id])
                    return (
                      <section key={cat.id} className="miro-cat-section">
                        <button
                          type="button"
                          className="miro-cat-section-header"
                          title={cat.description}
                          onClick={() => toggleCategoryCollapsed(cat.id)}
                        >
                          <span className="miro-cat-section-title">
                            {isAnimatedMode ? `Animated ${cat.name}` : cat.name}
                          </span>
                          <span className="miro-cat-section-meta">
                            <span className="miro-cat-section-count">{shapes.length}</span>
                            {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                          </span>
                        </button>
                        {!isCollapsed && (
                          <div className="miro-shape-catalog-grid">
                            {shapes.map((s) => renderShapeTile(s))}
                          </div>
                        )}
                      </section>
                    )
                  })}
                </div>
              )
            ) : filteredLibraryShapes.length === 0 && filteredAnimatedLines.length === 0 ? (
              <div className="miro-shape-empty">No matching shapes found.</div>
            ) : (
              <div className="miro-cat-sections">
                {activeCategory === 'lines' && filteredAnimatedLines.length > 0 && !isAnimatedMode && (
                  <section className="miro-cat-section">
                    <div className="miro-cat-section-header static">
                      <span className="miro-cat-section-title">
                        Animated Lines &amp; Connectors
                      </span>
                      <span className="miro-cat-section-count">{filteredAnimatedLines.length}</span>
                    </div>
                    <div className="miro-shape-catalog-grid">
                      {filteredAnimatedLines.map((s) => renderShapeTile(s, true))}
                    </div>
                  </section>
                )}

                <section className="miro-cat-section">
                  <div className="miro-cat-section-header static">
                    <span className="miro-cat-section-title">
                      {isAnimatedMode
                        ? `Animated ${categoryNameById.get(activeCategory) || activeCategory}`
                        : categoryNameById.get(activeCategory) || activeCategory}
                    </span>
                    <span className="miro-cat-section-count">
                      {activeCategory === 'lines' && isAnimatedMode
                        ? filteredAnimatedLines.length
                        : filteredLibraryShapes.length}
                    </span>
                  </div>
                  <div className="miro-shape-catalog-grid">
                    {(activeCategory === 'lines' && isAnimatedMode
                      ? filteredAnimatedLines
                      : filteredLibraryShapes
                    ).map((s) => renderShapeTile(s))}
                  </div>
                </section>
              </div>
            )}
          </div>
        </div>
      )}

      {/* B. Sticky Notes Flyout */}
      {openFlyout === 'stickies' && (
        <div
          ref={flyoutRef}
          className="miro-flyout-panel stickies-panel"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="miro-flyout-header">
            <div className="miro-flyout-title">
              <span>Sticky Notes</span>
              <span className="miro-count-pill">Pick color</span>
            </div>
            <button
              type="button"
              className="miro-flyout-close-btn"
              title="Close sticky notes panel"
              onClick={() => setOpenFlyout(null)}
            >
              <X size={14} />
            </button>
          </div>

          <div className="miro-sticky-swatches">
            {STICKY_COLORS.map((s) => (
              <button
                key={s.name}
                type="button"
                className="miro-sticky-swatch"
                style={{ backgroundColor: s.color }}
                title={`${s.name} Sticky Note`}
                onClick={() => {
                  onAddStickyNote(s.color)
                  setOpenFlyout(null)
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* C. Templates Flyout */}
      {openFlyout === 'templates' && (
        <div
          ref={flyoutRef}
          className="miro-flyout-panel templates-panel"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="miro-flyout-header">
            <div className="miro-flyout-title">
              <span>One-Click Templates</span>
              <span className="miro-count-pill">{TEMPLATES.length}</span>
            </div>
            <button
              type="button"
              className="miro-flyout-close-btn"
              title="Close templates panel"
              onClick={() => setOpenFlyout(null)}
            >
              <X size={14} />
            </button>
          </div>

          <div className="miro-template-list">
            {TEMPLATES.map((tmpl) => (
              <button
                key={tmpl.id}
                type="button"
                className="miro-template-item"
                onClick={() => {
                  onAddTemplate(tmpl.id)
                  setOpenFlyout(null)
                }}
              >
                <div className="miro-template-title">
                  {tmpl.icon}
                  <span>{tmpl.title}</span>
                  <ChevronRight size={14} style={{ marginLeft: 'auto', color: '#94a3b8' }} />
                </div>
                <div className="miro-template-desc">{tmpl.desc}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
