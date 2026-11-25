import React, { useState, useRef, useEffect, useMemo } from 'react'
import {
  MousePointer,
  Hand,
  PenTool,
  Eraser,
  Square,
  StickyNote,
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
  BookOpen,
  Wand2,
  Loader2,
  Lasso,
  ImagePlus,
  ClipboardPaste,
  Crop,
  Upload,
  Pencil,
  Brush,
  LineChart
} from 'lucide-react'
import type { CodeTabItem, PenType, ToolType } from '../types/board'
import type { BoardPalette } from '../board/backgroundPresets'
import type { GraphPlotSpec } from '../board/graphPlotBuilder'
import { resolvePenColorHex } from '../board/penUtils'
import { PenControls } from './PenControls'
import { GraphBuilderFlyout } from './GraphBuilderFlyout'
import {
  ALL_LIBRARY_SHAPES,
  ANIMATED_LINE_SHAPES,
  SHAPE_CATEGORIES,
  type LibraryShapeDef
} from '../shapes/shapeLibrary'
import { ShapeSvg } from '../shapes/ShapeSvg'

export interface LeftDockToolbarProps {
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
  onAddStickyNote: (color: string, title?: string) => void
  onAddTemplate: (templateId: string) => void
  onInsertGraph?: (spec: GraphPlotSpec) => void
  openGraphTrigger?: number
  onBeautify: () => void
  isBeautifying?: boolean
  onVectorize?: () => void
  isVectorizing?: boolean
  isAiConfigured?: boolean
  hasSelection?: boolean
  onAddCodeNode?: (initialTab?: CodeTabItem) => void
  onOpenKnowledgeHub?: () => void
  onAddYouTubeVideo?: () => void
  onPasteImageFromClipboard?: () => void
  onUploadImageFile?: () => void
  shapesMode?: boolean
  onToggleShapesMode?: (next: boolean) => void
  circleToSelect?: boolean
  onToggleCircleToSelect?: (next: boolean) => void
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
    id: 'transformer_vs_moe',
    title: 'Transformer vs. MoE (Animated)',
    desc: 'Stage-synchronized neural signal flow with residual bypass & MoE router',
    icon: <Zap size={16} className="text-accent" />
  },
  {
    id: 'blank_flow',
    title: 'Blank Flow Canvas',
    desc: 'Connected board shapes with live ports & auto-layout',
    icon: <Workflow size={16} className="text-accent" />
  },
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

export const LeftDockToolbar: React.FC<LeftDockToolbarProps> = React.memo(({
  activeTool,
  onSelectTool,
  onAddShapeNode,
  onAddStickyNote,
  onAddTemplate,
  onInsertGraph,
  openGraphTrigger,
  onBeautify,
  isBeautifying,
  onVectorize,
  isVectorizing,
  hasSelection,
  onAddCodeNode,
  onOpenKnowledgeHub,
  onAddYouTubeVideo,
  onPasteImageFromClipboard,
  onUploadImageFile,
  shapesMode,
  onToggleShapesMode,
  circleToSelect,
  onToggleCircleToSelect,
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
  const [openFlyout, setOpenFlyout] = useState<
    'pen' | 'shapes' | 'graphs' | 'stickies' | 'templates' | 'images' | null
  >(null)
  const [selectedDockItem, setSelectedDockItem] = useState<string>(activeTool)
  const [stickyTitleDraft, setStickyTitleDraft] = useState('')
  const resolvedPenColor = resolvePenColorHex(penColor, themeInk, themeAccent)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    if (openGraphTrigger && openGraphTrigger > 0) {
      setSelectedDockItem('graphs')
      setOpenFlyout('graphs')
    }
  }, [openGraphTrigger])

  useEffect(() => {
    if (
      activeTool === 'select' ||
      activeTool === 'pan' ||
      activeTool === 'pen' ||
      activeTool === 'lasso' ||
      activeTool === 'snip' ||
      activeTool === 'eraser'
    ) {
      setSelectedDockItem(activeTool)
    }
  }, [activeTool])
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
      if (catRailEl && (targetEl?.closest('.vx-cat-rail') === catRailEl || catRailEl.contains(targetEl))) {
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

  const toggleFlyout = (
    flyout: 'pen' | 'shapes' | 'graphs' | 'stickies' | 'templates' | 'images'
  ): void => {
    setOpenFlyout((prev) => (prev === flyout ? null : flyout))
  }

  const renderShapeTile = (shape: LibraryShapeDef, forceAnimated = false): React.JSX.Element => {
    const catTitle = categoryNameById.get(shape.category) || shape.category
    const animated = forceAnimated || isAnimatedMode || shape.id.startsWith('anim-line-')
    return (
      <button
        key={`${animated ? 'anim' : 'std'}-${shape.id}`}
        type="button"
        className={`vx-shape-tile ${animated ? 'is-animated' : ''}`}
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
        <div className="vx-shape-tile-preview">
          <ShapeSvg
            shape={shape}
            strokeColor={boardPalette?.shapeStroke ?? '#111111'}
            fillColor={shape.defaultFill || boardPalette?.shapeFill || '#FFE566'}
            strokeWidth={1.7}
            preserveAspectRatio="xMidYMid meet"
            className="vx-shape-tile-svg"
            animated={animated}
          />
        </div>
        <span className="vx-shape-tile-name">{shape.name}</span>
        {animated && (
          <span className="vx-shape-tile-anim-badge" title="Animated shape" aria-hidden="true">
            <Zap size={9} />
          </span>
        )}
      </button>
    )
  }

  const renderCoreNodesGrid = (): React.JSX.Element => (
    <div className="vx-shape-grid">
      {filteredCoreShapes.map((shape) => (
        <button
          key={shape.type}
          type="button"
          className={`vx-shape-chip ${isAnimatedMode ? 'is-animated' : ''}`}
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
          <span className="vx-shape-chip-icon">{shape.icon}</span>
          <span className="vx-shape-chip-text">
            <strong>{isAnimatedMode ? `Animated ${shape.label}` : shape.label}</strong>
            <small>{shape.desc}</small>
          </span>
        </button>
      ))}
    </div>
  )

  return (
    <div className="vx-left-dock" ref={containerRef}>
      {/* 1. Selection Tool */}
      <button
        type="button"
        className={`vx-dock-btn ${selectedDockItem === 'select' && activeTool === 'select' ? 'active' : ''}`}
        onClick={() => {
          setSelectedDockItem('select')
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
        className={`vx-dock-btn ${selectedDockItem === 'pan' && activeTool === 'pan' ? 'active' : ''}`}
        onClick={() => {
          setSelectedDockItem('pan')
          onSelectTool('pan')
          setOpenFlyout(null)
        }}
        title="Hand / Pan canvas (H or Space+Drag)"
      >
        <Hand size={18} />
      </button>

      <div className="vx-dock-divider" />

      {/* 3. Pen / Pencil / Brush Tool (Click = Select Pen · Double-click = Open Pen Style Tab) */}
      <button
        type="button"
        className={`vx-dock-btn vx-pen-btn ${
          (selectedDockItem === 'pen' && activeTool === 'pen') || openFlyout === 'pen' ? 'active' : ''
        }`}
        onClick={() => {
          setSelectedDockItem('pen')
          onSelectTool('pen')
          setOpenFlyout((prev) => (prev === 'pen' ? prev : null))
        }}
        onDoubleClick={(e) => {
          e.stopPropagation()
          setSelectedDockItem('pen')
          onSelectTool('pen')
          toggleFlyout('pen')
        }}
        title="Pen / Pencil / Brush (P) — Click to draw · Double-click for Pen, Pencil & Brush styles"
      >
        {penType === 'pencil' ? (
          <Pencil size={18} />
        ) : penType === 'brush' || penType === 'marker' || penType === 'highlighter' ? (
          <Brush size={18} />
        ) : (
          <PenTool size={18} />
        )}
        <span
          className="vx-pen-color-dot"
          style={{ background: resolvedPenColor }}
          aria-hidden="true"
        />
      </button>

      {/* 3b. iPad-Style Pen Lasso Selection Tool */}
      <button
        type="button"
        className={`vx-dock-btn ${selectedDockItem === 'lasso' && activeTool === 'lasso' ? 'active' : ''}`}
        onClick={() => {
          setSelectedDockItem('lasso')
          onSelectTool('lasso')
          setOpenFlyout(null)
        }}
        title="Pen Lasso Select (G) — Circle any area with your pen to select elements inside"
      >
        <Lasso size={18} />
      </button>

      {/* 4. Eraser Tool */}
      <button
        type="button"
        className={`vx-dock-btn ${selectedDockItem === 'eraser' && activeTool === 'eraser' ? 'active' : ''}`}
        onClick={() => {
          setSelectedDockItem('eraser')
          onSelectTool('eraser')
          setOpenFlyout(null)
        }}
        title="Eraser (E)"
      >
        <Eraser size={18} />
      </button>

      <div className="vx-dock-divider" />

      {/* 5. Shapes & Flowchart Nodes (Click = Select · Double-click = Open Shapes Tab) */}
      <button
        type="button"
        className={`vx-dock-btn ${openFlyout === 'shapes' ? 'active' : selectedDockItem === 'shapes' ? 'selected-item' : ''}`}
        onClick={() => {
          setSelectedDockItem('shapes')
          setOpenFlyout((prev) => (prev === 'shapes' ? prev : null))
        }}
        onDoubleClick={(e) => {
          e.stopPropagation()
          setSelectedDockItem('shapes')
          toggleFlyout('shapes')
        }}
        title="Shapes & Components — Click to select · Double-click to open tab"
      >
        <Square size={18} />
        <span className="vx-dock-expand-dot" aria-hidden="true" />
      </button>

      {/* 5b. Draw Graph / Function & Data Plot */}
      <button
        type="button"
        className={`vx-dock-btn ${openFlyout === 'graphs' ? 'active' : selectedDockItem === 'graphs' ? 'selected-item' : ''}`}
        onClick={() => {
          setSelectedDockItem('graphs')
          toggleFlyout('graphs')
        }}
        title="Draw Graph / Function & Data Plot"
        style={{ color: '#0284c7' }}
      >
        <LineChart size={18} />
        <span className="vx-dock-expand-dot" aria-hidden="true" />
      </button>

      {/* 6. Sticky Notes (Click = Select · Double-click = Open Notes Tab) */}
      <button
        type="button"
        className={`vx-dock-btn ${openFlyout === 'stickies' ? 'active' : selectedDockItem === 'stickies' ? 'selected-item' : ''}`}
        onClick={() => {
          setSelectedDockItem('stickies')
          setOpenFlyout((prev) => (prev === 'stickies' ? prev : null))
        }}
        onDoubleClick={(e) => {
          e.stopPropagation()
          setSelectedDockItem('stickies')
          toggleFlyout('stickies')
        }}
        title="Sticky Notes — Click to select · Double-click to open tab"
      >
        <StickyNote size={18} />
        <span className="vx-dock-expand-dot" aria-hidden="true" />
      </button>

      {/* 7. Templates (Click = Select · Double-click = Open Templates Tab) */}
      <button
        type="button"
        className={`vx-dock-btn ${openFlyout === 'templates' ? 'active' : selectedDockItem === 'templates' ? 'selected-item' : ''}`}
        onClick={() => {
          setSelectedDockItem('templates')
          setOpenFlyout((prev) => (prev === 'templates' ? prev : null))
        }}
        onDoubleClick={(e) => {
          e.stopPropagation()
          setSelectedDockItem('templates')
          toggleFlyout('templates')
        }}
        title="Diagram Templates — Click to select · Double-click to open tab"
      >
        <LayoutTemplate size={18} />
        <span className="vx-dock-expand-dot" aria-hidden="true" />
      </button>

      {/* 8. Coding Container (Click = Select · Double-click = Open Coding Tab) */}
      <button
        type="button"
        className={`vx-dock-btn code-tab-btn ${selectedDockItem === 'code' ? 'selected-item' : ''}`}
        onClick={() => {
          setSelectedDockItem('code')
          setOpenFlyout(null)
        }}
        onDoubleClick={(e) => {
          e.stopPropagation()
          setSelectedDockItem('code')
          setOpenFlyout(null)
          onAddCodeNode?.()
        }}
        title="Coding Tab Container — Click to select · Double-click to add & open"
      >
        <Code2 size={18} />
        <span className="vx-dock-expand-dot" aria-hidden="true" />
      </button>

      {/* 8b. Interactive YouTube Video Card (Click = Select · Double-click = Open Video Tab) */}
      <button
        type="button"
        className={`vx-dock-btn ${selectedDockItem === 'video' ? 'selected-item' : ''}`}
        onClick={() => {
          setSelectedDockItem('video')
          setOpenFlyout(null)
        }}
        onDoubleClick={(e) => {
          e.stopPropagation()
          setSelectedDockItem('video')
          setOpenFlyout(null)
          onAddYouTubeVideo?.()
        }}
        title="YouTube Video Card — Click to select · Double-click to open"
        style={{ color: '#ef4444' }}
      >
        <Video size={18} />
        <span className="vx-dock-expand-dot" aria-hidden="true" />
      </button>

      {/* 8c. Insert Image or Just-Taken Snippet */}
      <button
        type="button"
        className={`vx-dock-btn ${
          openFlyout === 'images' || activeTool === 'snip'
            ? 'active'
            : selectedDockItem === 'images'
              ? 'selected-item'
              : ''
        }`}
        onClick={() => {
          setSelectedDockItem('images')
          toggleFlyout('images')
        }}
        title="Insert Image or Paste Latest Screenshot/Snippet (Ctrl+V)"
        style={{ color: '#0891b2' }}
      >
        <ImagePlus size={18} />
        <span className="vx-dock-expand-dot" aria-hidden="true" />
      </button>

      {/* 8d. Knowledge Studio (Click = Select · Double-click = Open Knowledge Studio Tab) */}
      <button
        type="button"
        className={`vx-dock-btn ${selectedDockItem === 'knowledge' ? 'selected-item' : ''}`}
        onClick={() => {
          setSelectedDockItem('knowledge')
          setOpenFlyout(null)
        }}
        onDoubleClick={(e) => {
          e.stopPropagation()
          setSelectedDockItem('knowledge')
          setOpenFlyout(null)
          onOpenKnowledgeHub?.()
        }}
        title="Knowledge Studio — Click to select · Double-click to open"
        style={{ color: '#a78bfa' }}
      >
        <BookOpen size={18} />
        <span className="vx-dock-expand-dot" aria-hidden="true" />
      </button>

      <div className="vx-dock-divider" />

      {/* 9. Unified Smart Vectorize & Beautify (Single Smartly-Routed Button!) */}
      <button
        type="button"
        className={`vx-dock-btn magic-vector ${
          isBeautifying || isVectorizing
            ? 'active'
            : selectedDockItem === 'beautify'
              ? 'selected-item'
              : ''
        }`}
        onClick={() => {
          setSelectedDockItem('beautify')
          setOpenFlyout(null)
          if (!isBeautifying && !isVectorizing) {
            ;(onVectorize ?? onBeautify)()
          }
        }}
        disabled={Boolean(isBeautifying || isVectorizing)}
        title={
          hasSelection
            ? 'Smart Vectorize & Beautify Selection (Ctrl+B) — Local shapes/OCR first, smart diagram/vector routing'
            : 'Smart Vectorize & Beautify Board Sketch (Ctrl+B)'
        }
      >
        {isBeautifying || isVectorizing ? (
          <Loader2 size={18} className="spin-animate" />
        ) : (
          <Wand2 size={18} />
        )}
      </button>

      {/* ---------------- Flyout Panels ---------------- */}

      {/* 0a. Insert Image or Snippet Flyout */}
      {openFlyout === 'images' && (
        <div
          ref={flyoutRef}
          className="vx-flyout-panel image-insert-flyout"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="vx-flyout-header">
            <div className="vx-flyout-title">
              <ImagePlus size={14} />
              <span>Insert Image / Snippet</span>
            </div>
            <button
              type="button"
              className="vx-flyout-close-btn"
              title="Close panel"
              onClick={() => setOpenFlyout(null)}
            >
              <X size={14} />
            </button>
          </div>
          <div className="vx-template-list">
            <button
              type="button"
              className="vx-template-card"
              onClick={() => {
                setOpenFlyout(null)
                onPasteImageFromClipboard?.()
              }}
            >
              <span className="vx-template-icon">
                <ClipboardPaste size={16} />
              </span>
              <span className="vx-template-info">
                <strong>Paste Snippet Just Taken (Ctrl+V)</strong>
                <small>Inserts the latest screenshot or copied image from your clipboard</small>
              </span>
            </button>
            <button
              type="button"
              className="vx-template-card"
              onClick={() => {
                setOpenFlyout(null)
                onUploadImageFile?.()
              }}
            >
              <span className="vx-template-icon">
                <Upload size={16} />
              </span>
              <span className="vx-template-info">
                <strong>Upload Image File...</strong>
                <small>Choose PNG, JPG, WebP, GIF, or SVG from your computer</small>
              </span>
            </button>
            <button
              type="button"
              className="vx-template-card"
              onClick={() => {
                setOpenFlyout(null)
                onSelectTool('snip')
              }}
            >
              <span className="vx-template-icon">
                <Crop size={16} />
              </span>
              <span className="vx-template-info">
                <strong>Snip Board Region</strong>
                <small>Drag over any canvas area to capture a movable snippet card</small>
              </span>
            </button>
          </div>
        </div>
      )}

      {/* 0. Pen Settings Flyout (Color, Thickness, Pen Type) */}
      {openFlyout === 'pen' && (
        <div
          ref={flyoutRef}
          className="vx-flyout-panel pen-flyout-panel"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="vx-flyout-header">
            <div className="vx-flyout-title">
              <span>Pen Settings</span>
              <span className="vx-count-pill">{penType}</span>
            </div>
            <button
              type="button"
              className="vx-flyout-close-btn"
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
            shapesMode={shapesMode}
            onToggleShapesMode={onToggleShapesMode}
            circleToSelect={circleToSelect}
            onToggleCircleToSelect={onToggleCircleToSelect}
          />
        </div>
      )}

      {/* A. Shapes Flyout (full shape catalog + animated shapes & lines + quick nodes) */}
      {openFlyout === 'shapes' && (
        <div
          ref={flyoutRef}
          className="vx-flyout-panel shapes-catalog"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="vx-flyout-header">
            <div className="vx-flyout-title">
              <span>Shapes</span>
              <span className="vx-count-pill">
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
              className="vx-flyout-close-btn"
              title="Close shapes panel"
              onClick={() => setOpenFlyout(null)}
            >
              <X size={14} />
            </button>
          </div>

          <div className="vx-catalog-controls">
            <div className="vx-shape-search">
              <Search size={13} className="vx-shape-search-icon" />
              <input
                type="text"
                className="vx-shape-search-input"
                placeholder={`Search ${ALL_LIBRARY_SHAPES.length + ANIMATED_LINE_SHAPES.length} shapes & lines...`}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                autoFocus
              />
              {searchQuery && (
                <button
                  type="button"
                  className="vx-shape-search-clear"
                  title="Clear search"
                  onClick={() => setSearchQuery('')}
                >
                  <X size={12} />
                </button>
              )}
            </div>

            <div className="vx-source-pills">
              <button
                type="button"
                className={`vx-filter-pill ${animFilter === 'all' ? 'active' : ''}`}
                onClick={() => setAnimFilter('all')}
              >
                All
              </button>
              <button
                type="button"
                className={`vx-filter-pill animated-pill ${animFilter === 'animated' ? 'active' : ''}`}
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
            className="vx-cat-rail"
            role="tablist"
            aria-label="Shape categories"
          >
            <button
              type="button"
              className={`vx-cat-pill ${activeCategory === 'all' ? 'active' : ''}`}
              onClick={() => setActiveCategory('all')}
            >
              All ({ALL_LIBRARY_SHAPES.length + ANIMATED_LINE_SHAPES.length})
            </button>
            <button
              type="button"
              className={`vx-cat-pill animated-cat-pill ${isAnimatedMode ? 'active' : ''}`}
              title="Toggle Animated mode for all shapes and lines"
              onClick={() => setAnimFilter((prev) => (prev === 'animated' ? 'all' : 'animated'))}
            >
              <Zap size={10} />
              <span>Animated</span>
            </button>
            <button
              type="button"
              className={`vx-cat-pill ${activeCategory === 'core' ? 'active' : ''}`}
              onClick={() => setActiveCategory('core')}
            >
              Quick Nodes ({SHAPES_LIST.length})
            </button>
            {SHAPE_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                type="button"
                className={`vx-cat-pill ${activeCategory === cat.id ? 'active' : ''}`}
                title={cat.description}
                onClick={() => setActiveCategory(cat.id)}
              >
                {cat.name} (
                {cat.id === 'lines' ? cat.count + ANIMATED_LINE_SHAPES.length : cat.count})
              </button>
            ))}
          </div>

          <div ref={catalogScrollRef} className="vx-shape-catalog-scroll">
            {activeCategory === 'core' ? (
              filteredCoreShapes.length === 0 ? (
                <div className="vx-shape-empty">No matching quick nodes found.</div>
              ) : (
                renderCoreNodesGrid()
              )
            ) : activeCategory === 'all' ? (
              filteredCoreShapes.length === 0 &&
                filteredAnimatedLines.length === 0 &&
                groupedCategories.length === 0 ? (
                <div className="vx-shape-empty">No matching shapes found.</div>
              ) : (
                <div className="vx-cat-sections">
                  {filteredAnimatedLines.length > 0 && (
                    <section className="vx-cat-section">
                      <button
                        type="button"
                        className="vx-cat-section-header"
                        onClick={() => toggleCategoryCollapsed('animated-lines')}
                      >
                        <span className="vx-cat-section-title">
                          Animated Lines &amp; Connectors
                        </span>
                        <span className="vx-cat-section-meta">
                          <span className="vx-cat-section-count">
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
                        <div className="vx-shape-catalog-grid">
                          {filteredAnimatedLines.map((s) => renderShapeTile(s, true))}
                        </div>
                      )}
                    </section>
                  )}

                  {filteredCoreShapes.length > 0 && (
                    <section className="vx-cat-section">
                      <button
                        type="button"
                        className="vx-cat-section-header"
                        onClick={() => toggleCategoryCollapsed('core')}
                      >
                        <span className="vx-cat-section-title">
                          {isAnimatedMode ? 'Animated Quick Diagram Nodes' : 'Quick Diagram Nodes'}
                        </span>
                        <span className="vx-cat-section-meta">
                          <span className="vx-cat-section-count">{filteredCoreShapes.length}</span>
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
                      <section key={cat.id} className="vx-cat-section">
                        <button
                          type="button"
                          className="vx-cat-section-header"
                          title={cat.description}
                          onClick={() => toggleCategoryCollapsed(cat.id)}
                        >
                          <span className="vx-cat-section-title">
                            {isAnimatedMode ? `Animated ${cat.name}` : cat.name}
                          </span>
                          <span className="vx-cat-section-meta">
                            <span className="vx-cat-section-count">{shapes.length}</span>
                            {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                          </span>
                        </button>
                        {!isCollapsed && (
                          <div className="vx-shape-catalog-grid">
                            {shapes.map((s) => renderShapeTile(s))}
                          </div>
                        )}
                      </section>
                    )
                  })}
                </div>
              )
            ) : filteredLibraryShapes.length === 0 && filteredAnimatedLines.length === 0 ? (
              <div className="vx-shape-empty">No matching shapes found.</div>
            ) : (
              <div className="vx-cat-sections">
                {activeCategory === 'lines' && filteredAnimatedLines.length > 0 && !isAnimatedMode && (
                  <section className="vx-cat-section">
                    <div className="vx-cat-section-header static">
                      <span className="vx-cat-section-title">
                        Animated Lines &amp; Connectors
                      </span>
                      <span className="vx-cat-section-count">{filteredAnimatedLines.length}</span>
                    </div>
                    <div className="vx-shape-catalog-grid">
                      {filteredAnimatedLines.map((s) => renderShapeTile(s, true))}
                    </div>
                  </section>
                )}

                <section className="vx-cat-section">
                  <div className="vx-cat-section-header static">
                    <span className="vx-cat-section-title">
                      {isAnimatedMode
                        ? `Animated ${categoryNameById.get(activeCategory) || activeCategory}`
                        : categoryNameById.get(activeCategory) || activeCategory}
                    </span>
                    <span className="vx-cat-section-count">
                      {activeCategory === 'lines' && isAnimatedMode
                        ? filteredAnimatedLines.length
                        : filteredLibraryShapes.length}
                    </span>
                  </div>
                  <div className="vx-shape-catalog-grid">
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
          className="vx-flyout-panel stickies-panel"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="vx-flyout-header">
            <div className="vx-flyout-title">
              <span>Sticky Notes</span>
              <span className="vx-count-pill">Pick color</span>
            </div>
            <button
              type="button"
              className="vx-flyout-close-btn"
              title="Close sticky notes panel"
              onClick={() => setOpenFlyout(null)}
            >
              <X size={14} />
            </button>
          </div>

          <div className="vx-sticky-title-row">
            <input
              type="text"
              className="vx-sticky-title-input"
              placeholder="Optional card title (e.g. Key Formula)..."
              value={stickyTitleDraft}
              onChange={(e) => setStickyTitleDraft(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </div>

          <div className="vx-sticky-swatches">
            {STICKY_COLORS.map((s) => (
              <button
                key={s.name}
                type="button"
                className="vx-sticky-swatch"
                style={{ backgroundColor: s.color }}
                title={`${s.name} Sticky Note`}
                onClick={() => {
                  const titleToUse = stickyTitleDraft.trim() || undefined
                  onAddStickyNote(s.color, titleToUse)
                  setStickyTitleDraft('')
                  setOpenFlyout(null)
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* B2. Interactive Graph & Function Plotter Flyout */}
      {openFlyout === 'graphs' && onInsertGraph && (
        <GraphBuilderFlyout
          onInsertGraph={onInsertGraph}
          onClose={() => setOpenFlyout(null)}
        />
      )}

      {/* C. Templates Flyout */}
      {openFlyout === 'templates' && (
        <div
          ref={flyoutRef}
          className="vx-flyout-panel templates-panel"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="vx-flyout-header">
            <div className="vx-flyout-title">
              <span>One-Click Templates</span>
              <span className="vx-count-pill">{TEMPLATES.length}</span>
            </div>
            <button
              type="button"
              className="vx-flyout-close-btn"
              title="Close templates panel"
              onClick={() => setOpenFlyout(null)}
            >
              <X size={14} />
            </button>
          </div>

          <div className="vx-template-list">
            {TEMPLATES.map((tmpl) => (
              <button
                key={tmpl.id}
                type="button"
                className="vx-template-item"
                onClick={() => {
                  onAddTemplate(tmpl.id)
                  setOpenFlyout(null)
                }}
              >
                <div className="vx-template-title">
                  {tmpl.icon}
                  <span>{tmpl.title}</span>
                  <ChevronRight size={14} style={{ marginLeft: 'auto', color: '#94a3b8' }} />
                </div>
                <div className="vx-template-desc">{tmpl.desc}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
})
