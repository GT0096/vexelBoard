import React, { Suspense, lazy, memo, useState, useEffect } from 'react'
import {
  Trash2,
  Heading1,
  Heading2,
  Type,
  Bold,
  Italic,
  Copy,
  Pencil,
  Brush,
  Workflow,
  Eraser,
  Check,
  Code,
  Table,
  Sigma,
  FoldVertical,
  Minus,
  Plus,
  Image as ImageIcon,
  GripHorizontal,
  Box
} from 'lucide-react'
import type {
  BoardLayer,
  CanvasTransform,
  CodeNode,
  DiagramNode,
  EquationNode,
  FontId,
  GraphNode,
  ImageNode,
  InkPoint,
  PortSide,
  Scene3DNode,
  Scene3DSpec,
  ShapeNode,
  Stroke,
  TextNode,
  TextStyle,
  ToolType,
  VideoNode
} from '../types/board'
import type { GraphPlotSpec } from '../board/graphPlotBuilder'
import { isItemEditable, isItemVisible, resolveItemLayerId } from '../board/layerUtils'
import { FONTS, FONT_ORDER, resolveFontCss } from '../themes'
import katex from 'katex'
import getStroke from 'perfect-freehand'
import { Markdown } from './Markdown'
import { isLightColor, type BoardPalette } from '../board/backgroundPresets'
import { TabColorPicker, getReadableTabStyle } from './TabColorPicker'

const ReactFlowDiagram = lazy(() =>
  import('./ReactFlowDiagram').then((m) => ({ default: m.ReactFlowDiagram }))
)
const CanvasCodeCard = lazy(() =>
  import('./CodeStudioPanel').then((m) => ({ default: m.CanvasCodeCard }))
)
const CanvasVideoCard = lazy(() =>
  import('./CanvasVideoCard').then((m) => ({ default: m.CanvasVideoCard }))
)
const Canvas3DSceneCard = lazy(() =>
  import('./Canvas3DScene').then((m) => ({ default: m.Canvas3DSceneCard }))
)
const CanvasGraphCard = lazy(() =>
  import('./CanvasGraphCard').then((m) => ({ default: m.CanvasGraphCard }))
)

const MERMAID_TEMPLATE = '\n```mermaid\ngraph TD\n  A[Start] --> B{Decision}\n  B -->|Yes| C[Do it]\n  B -->|No| D[Skip]\n```\n'
const TABLE_TEMPLATE = '\n| Col A | Col B |\n| --- | --- |\n| 1 | 2 |\n'
const SCENE3D_TEMPLATE = '\n```3d\npreset: car\n```\n'

function inkToPath(points: InkPoint[], size: number): string {
  const outline = getStroke(points, { size, thinning: 0.5, smoothing: 0.5, streamline: 0.4 })
  if (!outline.length) return ''
  const d = outline.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length]
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2)
      return acc
    },
    ['M', ...outline[0], 'Q'] as (string | number)[]
  )
  d.push('Z')
  return d.join(' ')
}

export type ResizeDirection = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

interface ResizeState {
  id: string
  kind: 'text' | 'equation' | 'diagram' | 'code' | 'video' | 'image' | 'scene3d' | 'graph'
  direction: ResizeDirection
  startX: number
  startY: number
  initX: number
  initY: number
  initW: number
  initH: number
  hasExplicitH: boolean
  isImmersedText?: boolean
}

interface CanvasElementsProps {
  textNodes: TextNode[]
  equationNodes: EquationNode[]
  diagramNodes?: DiagramNode[]
  codeNodes?: CodeNode[]
  videoNodes?: VideoNode[]
  imageNodes?: ImageNode[]
  scene3dNodes?: Scene3DNode[]
  graphNodes?: GraphNode[]
  shapeNodes?: ShapeNode[]
  selectedId: string | null
  selectedIds?: string[]
  onSelect: (id: string | null) => void
  onUpdateText: (id: string, patch: Partial<TextNode>, opts?: { history?: boolean }) => void
  onUpdateEquation: (id: string, patch: Partial<EquationNode>, opts?: { history?: boolean }) => void
  onUpdateDiagram?: (id: string, patch: Partial<DiagramNode>, opts?: { history?: boolean }) => void
  onUpdateCode?: (id: string, patch: Partial<CodeNode>, opts?: { history?: boolean }) => void
  onUpdateVideo?: (id: string, patch: Partial<VideoNode>, opts?: { history?: boolean }) => void
  onUpdateImage?: (id: string, patch: Partial<ImageNode>, opts?: { history?: boolean }) => void
  onUpdateScene3D?: (id: string, patch: Partial<Scene3DNode>, opts?: { history?: boolean }) => void
  onUpdateGraph?: (id: string, patch: Partial<GraphNode>, opts?: { history?: boolean }) => void
  onSpawnGraphFromCode?: (spec: GraphPlotSpec, sourceCardId?: string) => void
  onSpawnScene3DFromCode?: (spec: Scene3DSpec, sourceCardId?: string) => void
  onStartConnect?: (sourceId: string, port: PortSide, clientX: number, clientY: number) => void
  onExecuteCodeNode?: (cardId: string, tabId?: string) => Promise<void>
  onAddCodeNode?: () => void
  onAddVideoNode?: () => void
  onCreateTutorialFromVideo?: (topic: string, transcriptText?: string) => void
  onAskAICode?: (
    cardId: string,
    ctx: {
      title: string
      language: string
      code: string
      stdout?: string
      stderr?: string
      error?: string
    }
  ) => void
  isAiConfigured?: boolean
  onDeleteElement: (id: string) => void
  onDuplicateElement: (id: string) => void
  onPushHistory?: () => void
  onStartMoveSelection?: (ids: string[], startX: number, startY: number) => void
  onMoveSelection?: (dx: number, dy: number) => void
  onEndMoveSelection?: () => void
  onInsertToNotes?: (text: string, title?: string) => void
  onToast?: (kind: 'info' | 'success' | 'error', message: string) => void
  isLightTheme?: boolean
  boardPalette?: BoardPalette
  view: CanvasTransform
  activeTool?: ToolType
  activeThemeAccent: string
  defaultFont?: FontId
  penColor: string
  penSize: number
  boardLayers?: BoardLayer[]
  cardsVisible?: boolean
  cardsLocked?: boolean
  cardsOpacity?: number
  onElementContextMenu?: (e: React.MouseEvent, elementId: string) => void
}

const IMMERSED_INK_COLORS = [
  { label: 'Board Ink', value: 'ink' },
  { label: 'Accent', value: 'accent' },
  { label: 'Crimson', value: '#EF4444' },
  { label: 'Cobalt', value: '#2563EB' },
  { label: 'Emerald', value: '#059669' },
  { label: 'Violet', value: '#7C3AED' },
  { label: 'Amber', value: '#D97706' }
]

export const CanvasElements: React.FC<CanvasElementsProps> = memo(({
  textNodes,
  equationNodes,
  diagramNodes,
  codeNodes,
  videoNodes,
  imageNodes,
  scene3dNodes,
  graphNodes,
  shapeNodes,
  selectedId,
  selectedIds,
  onSelect,
  onUpdateText,
  onUpdateEquation,
  onUpdateDiagram,
  onUpdateCode,
  onUpdateVideo,
  onUpdateImage,
  onUpdateScene3D,
  onUpdateGraph,
  onSpawnGraphFromCode,
  onSpawnScene3DFromCode,
  onStartConnect,
  onExecuteCodeNode,
  onAddCodeNode,
  onAddVideoNode,
  onCreateTutorialFromVideo,
  onAskAICode,
  isAiConfigured = true,
  onDeleteElement,
  onDuplicateElement,
  onPushHistory,
  onStartMoveSelection,
  onMoveSelection,
  onEndMoveSelection,
  onInsertToNotes,
  onToast,
  isLightTheme = false,
  boardPalette,
  view,
  activeTool,
  activeThemeAccent,
  defaultFont = 'jakarta',
  penColor,
  penSize,
  boardLayers,
  cardsVisible = true,
  cardsLocked = false,
  cardsOpacity = 1,
  onElementContextMenu
}) => {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editText, setEditText] = useState('')
  const [focusTitleInput, setFocusTitleInput] = useState(false)
  const [drawingId, setDrawingId] = useState<string | null>(null)
  const [liveStroke, setLiveStroke] = useState<InkPoint[] | null>(null)
  const [eraseMode, setEraseMode] = useState(false)
  const [dragState, setDragState] = useState<{
    id: string
    kind: 'text' | 'equation' | 'diagram' | 'code' | 'video' | 'image' | 'scene3d' | 'graph'
    startX: number
    startY: number
    initX: number
    initY: number
    isMulti?: boolean
  } | null>(null)
  const [resizeState, setResizeState] = useState<ResizeState | null>(null)

  // Double-click to edit text, equation, or image caption (with optional title header focus)
  const handleStartEdit = (
    id: string,
    text: string,
    title?: string,
    focusTitle = false
  ): void => {
    setEditingId(id)
    setEditText(text)
    setEditTitle(title ?? '')
    setFocusTitleInput(focusTitle)
  }

  const handleFinishEdit = (): void => {
    if (!editingId) return
    const textNode = textNodes.find((t) => t.id === editingId)
    if (textNode) {
      if (textNode.immersed) {
        onUpdateText(editingId, { text: editText.trim() || 'Label' })
      } else {
        onUpdateText(editingId, {
          text: editText.trim() || 'Empty note',
          title: editTitle.trim() || undefined
        })
      }
    }
    const eqNode = equationNodes.find((e) => e.id === editingId)
    if (eqNode) {
      onUpdateEquation(editingId, { latex: editText.trim() || 'E = mc^2' })
    }
    const imgNode = imageNodes?.find((img) => img.id === editingId)
    if (imgNode) {
      onUpdateImage?.(editingId, { caption: editText.trim() || undefined })
    }
    setEditingId(null)
    setFocusTitleInput(false)
  }

  // Pointer dragging for movement (notes, equations & images)
  const handlePointerDown = (
    e: React.PointerEvent,
    id: string,
    kind: 'text' | 'equation' | 'image',
    curX: number,
    curY: number
  ): void => {
    if (editingId === id) return
    e.stopPropagation()

    const isAlreadySelected = Boolean(selectedIds && selectedIds.includes(id))
    const isMulti = Boolean(isAlreadySelected && selectedIds && selectedIds.length > 1)

    if (!isAlreadySelected) {
      onSelect(id)
    }
    onPushHistory?.()

    if (isMulti && selectedIds) {
      onStartMoveSelection?.(selectedIds, curX, curY)
    }

    setDragState({
      id,
      kind,
      startX: e.clientX,
      startY: e.clientY,
      initX: curX,
      initY: curY,
      isMulti
    })
  }

  // Global window listener for dragging notes, equations, and full diagrams smoothly
  useEffect(() => {
    if (!dragState) return

    const handleWindowPointerMove = (e: PointerEvent): void => {
      const dx = (e.clientX - dragState.startX) / view.zoom
      const dy = (e.clientY - dragState.startY) / view.zoom

      if (dragState.isMulti) {
        onMoveSelection?.(dx, dy)
        return
      }

      const nextX = Math.round(dragState.initX + dx)
      const nextY = Math.round(dragState.initY + dy)

      if (dragState.kind === 'diagram') {
        onUpdateDiagram?.(dragState.id, { x: nextX, y: nextY }, { history: false })
      } else if (dragState.kind === 'code') {
        onUpdateCode?.(dragState.id, { x: nextX, y: nextY }, { history: false })
      } else if (dragState.kind === 'video') {
        onUpdateVideo?.(dragState.id, { x: nextX, y: nextY }, { history: false })
      } else if (dragState.kind === 'image') {
        onUpdateImage?.(dragState.id, { x: nextX, y: nextY }, { history: false })
      } else if (dragState.kind === 'scene3d') {
        onUpdateScene3D?.(dragState.id, { x: nextX, y: nextY }, { history: false })
      } else if (dragState.kind === 'graph') {
        onUpdateGraph?.(dragState.id, { x: nextX, y: nextY }, { history: false })
      } else if (dragState.kind === 'text') {
        onUpdateText(dragState.id, { x: nextX, y: nextY }, { history: false })
      } else if (dragState.kind === 'equation') {
        onUpdateEquation(dragState.id, { x: nextX, y: nextY }, { history: false })
      }
    }

    const handleWindowPointerUp = (): void => {
      if (dragState.isMulti) {
        onEndMoveSelection?.()
      }
      setDragState(null)
    }

    window.addEventListener('pointermove', handleWindowPointerMove)
    window.addEventListener('pointerup', handleWindowPointerUp)
    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove)
      window.removeEventListener('pointerup', handleWindowPointerUp)
    }
  }, [
    dragState,
    view.zoom,
    onMoveSelection,
    onEndMoveSelection,
    onPushHistory,
    onUpdateText,
    onUpdateEquation,
    onUpdateDiagram,
    onUpdateCode,
    onUpdateVideo,
    onUpdateImage,
    onUpdateScene3D,
    onUpdateGraph
  ])

  // Pointer down to begin resizing
  const handleResizeStart = (
    e: React.PointerEvent,
    id: string,
    kind: 'text' | 'equation' | 'diagram' | 'code' | 'video' | 'image' | 'scene3d' | 'graph',
    direction: ResizeDirection
  ): void => {
    e.stopPropagation()
    e.preventDefault()
    onSelect(id)
    onPushHistory?.()

    const el = document.getElementById(id)
    const rect = el?.getBoundingClientRect()
    const node =
      kind === 'text'
        ? textNodes.find((t) => t.id === id)
        : kind === 'equation'
          ? equationNodes.find((eq) => eq.id === id)
          : kind === 'code'
            ? codeNodes?.find((c) => c.id === id)
            : kind === 'video'
              ? videoNodes?.find((v) => v.id === id)
              : kind === 'image'
                ? imageNodes?.find((im) => im.id === id)
                : kind === 'scene3d'
                  ? scene3dNodes?.find((s) => s.id === id)
                  : kind === 'graph'
                    ? graphNodes?.find((g) => g.id === id)
                    : diagramNodes?.find((d) => d.id === id)

    const initW = node?.w ?? (rect ? Math.round(rect.width / view.zoom) : 480)
    const initH = node?.h ?? (rect ? Math.round(rect.height / view.zoom) : 340)

    setResizeState({
      id,
      kind,
      direction,
      startX: e.clientX,
      startY: e.clientY,
      initX: node?.x ?? 0,
      initY: node?.y ?? 0,
      initW,
      initH,
      hasExplicitH: Boolean(node?.h),
      isImmersedText: kind === 'text' ? Boolean((node as TextNode | undefined)?.immersed) : false
    })
  }

  // Global window listener for silky-smooth resizing
  useEffect(() => {
    if (!resizeState) return

    const handleWindowPointerMove = (e: PointerEvent): void => {
      const dx = (e.clientX - resizeState.startX) / view.zoom
      const dy = (e.clientY - resizeState.startY) / view.zoom

      const minW =
        resizeState.kind === 'video'
          ? 380
          : resizeState.kind === 'code'
            ? 320
            : resizeState.kind === 'scene3d'
              ? 220
              : resizeState.kind === 'diagram'
                ? 200
                : resizeState.isImmersedText
                  ? 48
                  : 160
      const minH =
        resizeState.kind === 'video'
          ? 320
          : resizeState.kind === 'code'
            ? 240
            : resizeState.kind === 'scene3d'
              ? 180
              : resizeState.kind === 'diagram'
                ? 140
                : resizeState.isImmersedText
                  ? 24
                  : 60

      let newX = resizeState.initX
      let newY = resizeState.initY
      let newW = resizeState.initW
      let newH = resizeState.initH

      const dir = resizeState.direction

      // Width calculation
      if (dir === 'e' || dir === 'ne' || dir === 'se') {
        newW = Math.max(minW, Math.round(resizeState.initW + dx))
      } else if (dir === 'w' || dir === 'nw' || dir === 'sw') {
        newW = Math.max(minW, Math.round(resizeState.initW - dx))
        newX = Math.round(resizeState.initX + (resizeState.initW - newW))
      }

      // Height calculation
      let shouldUpdateH =
        resizeState.hasExplicitH ||
        dir === 's' ||
        dir === 'se' ||
        dir === 'sw' ||
        dir === 'n' ||
        dir === 'ne' ||
        dir === 'nw'

      // Pure horizontal edge drag keeps height auto if it wasn't fixed
      if ((dir === 'e' || dir === 'w') && !resizeState.hasExplicitH) {
        shouldUpdateH = false
      }

      if (shouldUpdateH) {
        if (dir === 's' || dir === 'se' || dir === 'sw') {
          newH = Math.max(minH, Math.round(resizeState.initH + dy))
        } else if (dir === 'n' || dir === 'ne' || dir === 'nw') {
          newH = Math.max(minH, Math.round(resizeState.initH - dy))
          newY = Math.round(resizeState.initY + (resizeState.initH - newH))
        }
      }

      if (resizeState.kind === 'text') {
        const patch: Partial<TextNode> = {
          x: newX,
          w: newW
        }
        if (dir === 'n' || dir === 'ne' || dir === 'nw') {
          patch.y = newY
        }
        if (shouldUpdateH) {
          patch.h = newH
        }
        onUpdateText(resizeState.id, patch, { history: false })
      } else if (resizeState.kind === 'equation') {
        const patch: Partial<EquationNode> = {
          x: newX,
          w: newW
        }
        if (dir === 'n' || dir === 'ne' || dir === 'nw') {
          patch.y = newY
        }
        if (shouldUpdateH) {
          patch.h = newH
        }
        onUpdateEquation(resizeState.id, patch, { history: false })
      } else if (resizeState.kind === 'diagram') {
        const patch: Partial<DiagramNode> = {
          w: newW,
          h: newH
        }
        if (dir === 'n' || dir === 'ne' || dir === 'nw') {
          patch.y = newY
        }
        if (dir === 'w' || dir === 'nw' || dir === 'sw') {
          patch.x = newX
        }
        onUpdateDiagram?.(resizeState.id, patch, { history: false })
      } else if (resizeState.kind === 'code') {
        const patch: Partial<CodeNode> = {
          w: newW,
          h: newH
        }
        if (dir === 'n' || dir === 'ne' || dir === 'nw') {
          patch.y = newY
        }
        if (dir === 'w' || dir === 'nw' || dir === 'sw') {
          patch.x = newX
        }
        onUpdateCode?.(resizeState.id, patch, { history: false })
      } else if (resizeState.kind === 'video') {
        const patch: Partial<VideoNode> = {
          w: newW,
          h: newH
        }
        if (dir === 'n' || dir === 'ne' || dir === 'nw') {
          patch.y = newY
        }
        if (dir === 'w' || dir === 'nw' || dir === 'sw') {
          patch.x = newX
        }
        onUpdateVideo?.(resizeState.id, patch, { history: false })
      } else if (resizeState.kind === 'image') {
        const patch: Partial<ImageNode> = {
          w: Math.max(80, newW),
          h: Math.max(60, newH)
        }
        if (dir === 'n' || dir === 'ne' || dir === 'nw') {
          patch.y = newY
        }
        if (dir === 'w' || dir === 'nw' || dir === 'sw') {
          patch.x = newX
        }
        onUpdateImage?.(resizeState.id, patch, { history: false })
      } else if (resizeState.kind === 'scene3d') {
        const patch: Partial<Scene3DNode> = {
          w: Math.max(220, newW),
          h: Math.max(180, newH)
        }
        if (dir === 'n' || dir === 'ne' || dir === 'nw') {
          patch.y = newY
        }
        if (dir === 'w' || dir === 'nw' || dir === 'sw') {
          patch.x = newX
        }
        onUpdateScene3D?.(resizeState.id, patch, { history: false })
      } else if (resizeState.kind === 'graph') {
        const patch: Partial<GraphNode> = {
          w: Math.max(280, newW),
          h: Math.max(210, newH)
        }
        if (dir === 'n' || dir === 'ne' || dir === 'nw') {
          patch.y = newY
        }
        if (dir === 'w' || dir === 'nw' || dir === 'sw') {
          patch.x = newX
        }
        onUpdateGraph?.(resizeState.id, patch, { history: false })
      }
    }

    const handleWindowPointerUp = (): void => {
      onPushHistory?.()
      setResizeState(null)
    }

    window.addEventListener('pointermove', handleWindowPointerMove)
    window.addEventListener('pointerup', handleWindowPointerUp)
    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove)
      window.removeEventListener('pointerup', handleWindowPointerUp)
    }
  }, [
    resizeState,
    view.zoom,
    onPushHistory,
    onUpdateText,
    onUpdateEquation,
    onUpdateDiagram,
    onUpdateCode,
    onUpdateVideo,
    onUpdateImage,
    onUpdateScene3D,
    onUpdateGraph
  ])

  // Selected item toolbar formatting helpers
  const selectedTextNode = textNodes.find(
    (t) => t.id === selectedId || Boolean(selectedIds?.includes(t.id))
  )

  // Insert a markdown snippet at end of the editor text
  const insertSnippet = (snippet: string): void => setEditText((prev) => prev + snippet)

  // In-note drawing helpers
  const noteLocalPoint = (e: React.PointerEvent<SVGSVGElement>): InkPoint => {
    const rect = e.currentTarget.getBoundingClientRect()
    return [(e.clientX - rect.left) / view.zoom, (e.clientY - rect.top) / view.zoom, e.pressure || 0.5]
  }

  const handleInkDown = (e: React.PointerEvent<SVGSVGElement>, t: TextNode): void => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const pt = noteLocalPoint(e)
    if (eraseMode) {
      eraseAt(t, pt)
      return
    }
    setLiveStroke([pt])
  }

  const eraseAt = (t: TextNode, pt: InkPoint): void => {
    const ink = t.ink ?? []
    const kept = ink.filter(
      (s) => !s.points.some((p) => Math.hypot(p[0] - pt[0], p[1] - pt[1]) < 10 + s.size)
    )
    if (kept.length !== ink.length) onUpdateText(t.id, { ink: kept })
  }

  const handleInkMove = (e: React.PointerEvent<SVGSVGElement>, t: TextNode): void => {
    e.stopPropagation()
    if (eraseMode) {
      if (e.buttons) eraseAt(t, noteLocalPoint(e))
      return
    }
    if (!liveStroke) return
    const pt = noteLocalPoint(e)
    setLiveStroke((prev) => (prev ? [...prev, pt] : prev))
  }

  const handleInkUp = (e: React.PointerEvent<SVGSVGElement>, t: TextNode): void => {
    e.stopPropagation()
    if (!liveStroke) return
    if (liveStroke.length > 1) {
      const stroke: Stroke = {
        id: `nst-${Date.now()}`,
        points: liveStroke,
        color: penColor,
        size: Math.max(2, penSize)
      }
      onUpdateText(t.id, { ink: [...(t.ink ?? []), stroke] })
    }
    setLiveStroke(null)
  }

  const handleStyleChange = (style: TextStyle, targetId?: string): void => {
    const id = targetId ?? selectedTextNode?.id
    if (!id) return
    const fontSize = style === 'h1' ? 32 : style === 'h2' ? 24 : 16
    const bold = style === 'h1' || style === 'h2'
    onUpdateText(id, { style, fontSize, bold })
  }

  const isInkPassThroughTool =
    activeTool === 'eraser' ||
    activeTool === 'pen' ||
    activeTool === 'lasso' ||
    activeTool === 'snip' ||
    activeTool === 'pan' ||
    cardsLocked

  return (
    <div
      className="canvas-dom-overlay"
      style={
        {
          transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`,
          transformOrigin: '0 0',
          '--cards-layer-opacity': cardsOpacity
        } as React.CSSProperties
      }
    >
      {/* 1. Text, Board-Immersed Typography & Sticky Notes */}
      {textNodes.map((t) => {
        if (t.immersed) {
          if (boardLayers && !isItemVisible(t.layerId, boardLayers)) return null
        } else if (!cardsVisible) {
          return null
        }
        const isSelected = t.id === selectedId || Boolean(selectedIds?.includes(t.id))
        const isEditing = t.id === editingId

        // 1A. Board-Immersed Frameless Typography (NO textbox / card border / padding)
        if (t.immersed) {
          const activeFontId: FontId =
            t.fontFamily && t.fontFamily in FONTS ? t.fontFamily : defaultFont
          const resolvedImmersedColor =
            t.color === 'ink'
              ? (boardPalette?.ink ?? (isLightTheme ? '#111111' : '#FFFDF7'))
              : t.color === 'accent'
                ? activeThemeAccent
                : t.color
          const textLayerLocked = boardLayers ? !isItemEditable(t.layerId, boardLayers) : false
          const passThrough = isInkPassThroughTool || textLayerLocked
          const textOpacity = boardLayers
            ? (boardLayers.find((l) => l.id === resolveItemLayerId(t.layerId, boardLayers))?.opacity ?? 1)
            : 1
          const linesCount = Math.max(1, (isEditing ? editText : t.text).split('\n').length)
          const longestLine = Math.max(
            4,
            ...(isEditing ? editText : t.text).split('\n').map((l) => l.length)
          )

          return (
            <div
              key={t.id}
              id={t.id}
              className={`canvas-immersed-text ${isSelected ? 'selected' : ''} ${isEditing ? 'editing' : ''} ${t.w ? 'has-custom-w' : ''} ${t.h ? 'has-custom-h' : ''}`}
              style={{
                left: `${t.x}px`,
                top: `${t.y}px`,
                width: t.w ? `${t.w}px` : 'max-content',
                height: t.h ? `${t.h}px` : undefined,
                maxWidth: t.w ? 'none' : '760px',
                fontSize: `${t.fontSize || 20}px`,
                fontWeight: t.bold ? 700 : 500,
                fontStyle: t.italic ? 'italic' : 'normal',
                fontFamily: resolveFontCss(activeFontId, defaultFont),
                textAlign: t.align ?? 'left',
                color: resolvedImmersedColor,
                opacity: textOpacity,
                transform: t.rotation ? `rotate(${t.rotation}deg)` : undefined,
                transformOrigin: 'center center',
                pointerEvents: passThrough ? 'none' : 'auto'
              }}
              onPointerDown={(e) => handlePointerDown(e, t.id, 'text', t.x, t.y)}
              onContextMenu={(e) => onElementContextMenu?.(e, t.id)}
              onDoubleClick={(e) => {
                e.stopPropagation()
                handleStartEdit(t.id, t.text)
              }}
            >
              {/* Live dimension badge during active resizing */}
              {resizeState?.id === t.id && (
                <div className="resize-dimension-badge">
                  {t.w ?? 'auto'} × {t.h ?? 'auto'} px
                </div>
              )}

              {/* 8-direction resize handles for immersed text */}
              {!isEditing && (
                <div className="card-resize-handles">
                  <div
                    className="resize-edge n"
                    onPointerDown={(e) => handleResizeStart(e, t.id, 'text', 'n')}
                    title="Drag to resize top edge"
                  />
                  <div
                    className="resize-edge s"
                    onPointerDown={(e) => handleResizeStart(e, t.id, 'text', 's')}
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      onUpdateText(t.id, { h: undefined })
                    }}
                    title="Drag to resize height (Double-click to fit content)"
                  />
                  <div
                    className="resize-edge e"
                    onPointerDown={(e) => handleResizeStart(e, t.id, 'text', 'e')}
                    title="Drag to resize width"
                  />
                  <div
                    className="resize-edge w"
                    onPointerDown={(e) => handleResizeStart(e, t.id, 'text', 'w')}
                    title="Drag to resize width"
                  />

                  {isSelected && (
                    <>
                      <div
                        className="resize-handle nw"
                        onPointerDown={(e) => handleResizeStart(e, t.id, 'text', 'nw')}
                      />
                      <div
                        className="resize-handle n"
                        onPointerDown={(e) => handleResizeStart(e, t.id, 'text', 'n')}
                      />
                      <div
                        className="resize-handle ne"
                        onPointerDown={(e) => handleResizeStart(e, t.id, 'text', 'ne')}
                      />
                      <div
                        className="resize-handle e"
                        onPointerDown={(e) => handleResizeStart(e, t.id, 'text', 'e')}
                      />
                      <div
                        className="resize-handle se"
                        onPointerDown={(e) => handleResizeStart(e, t.id, 'text', 'se')}
                        title="Drag to resize"
                      />
                      <div
                        className="resize-handle s"
                        onPointerDown={(e) => handleResizeStart(e, t.id, 'text', 's')}
                        onDoubleClick={(e) => {
                          e.stopPropagation()
                          onUpdateText(t.id, { h: undefined })
                        }}
                        title="Double-click to reset height to auto"
                      />
                      <div
                        className="resize-handle sw"
                        onPointerDown={(e) => handleResizeStart(e, t.id, 'text', 'sw')}
                      />
                      <div
                        className="resize-handle w"
                        onPointerDown={(e) => handleResizeStart(e, t.id, 'text', 'w')}
                      />
                    </>
                  )}
                </div>
              )}

              {isEditing ? (
                <textarea
                  className="immersed-inline-editor"
                  autoFocus
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onBlur={handleFinishEdit}
                  onPointerDown={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      handleFinishEdit()
                    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault()
                      handleFinishEdit()
                    }
                  }}
                  rows={linesCount}
                  style={{
                    fontFamily: resolveFontCss(activeFontId, defaultFont),
                    fontSize: `${t.fontSize || 20}px`,
                    fontWeight: t.bold ? 700 : 500,
                    fontStyle: t.italic ? 'italic' : 'normal',
                    textAlign: t.align ?? 'left',
                    color: resolvedImmersedColor,
                    width: t.w
                      ? `${Math.max(80, t.w)}px`
                      : `${Math.max(120, Math.min(720, Math.round(longestLine * (t.fontSize || 20) * 0.65 + 24)))}px`
                  }}
                />
              ) : (
                <span className="immersed-text-span">{t.text}</span>
              )}

              {/* Compact floating typography bar (visible ONLY when selected) */}
              {isSelected && !isEditing && (
                <div
                  className="element-quick-bar immersed-quick-bar"
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  {/* Font family switcher */}
                  <div className="immersed-font-group" title="Switch font">
                    {FONT_ORDER.map((fid) => (
                      <button
                        key={fid}
                        type="button"
                        className={`immersed-font-chip ${activeFontId === fid ? 'active' : ''}`}
                        style={{ fontFamily: FONTS[fid].css }}
                        onClick={() => onUpdateText(t.id, { fontFamily: fid })}
                        title={`Font: ${FONTS[fid].label}`}
                      >
                        {FONTS[fid].shortLabel}
                      </button>
                    ))}
                  </div>
                  <div className="bar-separator" />
                  {/* Font size stepper */}
                  <button
                    type="button"
                    className="bar-btn"
                    onClick={() =>
                      onUpdateText(t.id, { fontSize: Math.max(12, (t.fontSize || 20) - 2) })
                    }
                    title="Decrease font size"
                  >
                    <Minus size={12} />
                  </button>
                  <span className="immersed-size-pill">{Math.round(t.fontSize || 20)}</span>
                  <button
                    type="button"
                    className="bar-btn"
                    onClick={() =>
                      onUpdateText(t.id, { fontSize: Math.min(72, (t.fontSize || 20) + 2) })
                    }
                    title="Increase font size"
                  >
                    <Plus size={12} />
                  </button>
                  <div className="bar-separator" />
                  <button
                    type="button"
                    className={`bar-btn ${t.bold ? 'active' : ''}`}
                    onClick={() => onUpdateText(t.id, { bold: !t.bold })}
                    title="Bold"
                  >
                    <Bold size={13} />
                  </button>
                  <button
                    type="button"
                    className={`bar-btn ${t.italic ? 'active' : ''}`}
                    onClick={() => onUpdateText(t.id, { italic: !t.italic })}
                    title="Italic"
                  >
                    <Italic size={13} />
                  </button>
                  <div className="bar-separator" />
                  {/* Ink color swatches */}
                  <div className="immersed-color-dots">
                    {IMMERSED_INK_COLORS.map((c) => {
                      const dotBg =
                        c.value === 'ink'
                          ? (boardPalette?.ink ?? '#111111')
                          : c.value === 'accent'
                            ? activeThemeAccent
                            : c.value
                      return (
                        <button
                          key={c.value}
                          type="button"
                          className={`immersed-color-dot ${t.color === c.value ? 'active' : ''}`}
                          style={{ backgroundColor: dotBg }}
                          onClick={() => onUpdateText(t.id, { color: c.value })}
                          title={`Color: ${c.label}`}
                        />
                      )
                    })}
                  </div>
                  {(t.w !== undefined || t.h !== undefined) && (
                    <>
                      <div className="bar-separator" />
                      <button
                        type="button"
                        className="bar-btn"
                        onClick={() => onUpdateText(t.id, { w: undefined, h: undefined })}
                        title="Reset size to auto-fit"
                      >
                        <FoldVertical size={13} />
                      </button>
                    </>
                  )}
                  <div className="bar-separator" />
                  <button
                    type="button"
                    className="bar-btn"
                    onClick={() => handleStartEdit(t.id, t.text)}
                    title="Edit text (Double-click)"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    type="button"
                    className="bar-btn"
                    onClick={() => onDuplicateElement(t.id)}
                    title="Duplicate"
                  >
                    <Copy size={13} />
                  </button>
                  <button
                    type="button"
                    className="bar-btn danger"
                    onClick={() => onDeleteElement(t.id)}
                    title="Delete"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              )}
            </div>
          )
        }

        const isDrawing = t.id === drawingId
        const hasInk = (t.ink?.length ?? 0) > 0
        const isLegacyTranslucentBg =
          t.bg === 'rgba(255, 255, 255, 0.06)' ||
          t.bg === 'rgba(255, 255, 255, 0.08)' ||
          t.bg === 'rgba(255,255,255,0.08)' ||
          t.bg === 'rgba(30, 41, 59, 0.85)'
        const resolvedBg = isLegacyTranslucentBg
          ? (t.source === 'ai' ? (boardPalette?.noteBg ?? '#FFFFFF') : 'transparent')
          : (t.bg || (t.source === 'ai' ? (boardPalette?.noteBg ?? '#FFFFFF') : 'transparent'))
        const resolvedTextColor =
          resolvedBg === 'transparent'
            ? (boardPalette?.ink ?? (isLightTheme ? '#111111' : '#FFFDF7'))
            : isLightColor(resolvedBg)
              ? '#111111'
              : (boardPalette?.noteText ?? '#FFFDF7')

        const noteFontId: FontId =
          t.fontFamily && t.fontFamily in FONTS ? t.fontFamily : defaultFont
        const resolvedNoteFontCss = resolveFontCss(noteFontId, defaultFont)

        return (
          <div
            key={t.id}
            id={t.id}
            className={`canvas-note-card ${t.style || 'body'} ${isSelected ? 'selected' : ''} ${
              resolvedBg !== 'transparent' ? 'has-bg' : ''
            } ${isDrawing ? 'drawing' : ''} ${t.w ? 'has-custom-w' : ''} ${t.h ? 'has-custom-h' : ''}`}
            style={{
              left: `${t.x}px`,
              top: `${t.y}px`,
              width: t.w ? `${t.w}px` : 'max-content',
              height: t.h ? `${t.h}px` : undefined,
              maxWidth: t.w ? 'none' : '480px',
              fontSize: `${t.fontSize || 18}px`,
              fontFamily: resolvedNoteFontCss,
              fontWeight: t.bold ? 700 : 500,
              fontStyle: t.italic ? 'italic' : 'normal',
              background: resolvedBg,
              color: resolvedTextColor,
              borderColor: isSelected ? activeThemeAccent : undefined,
              minWidth: isDrawing || hasInk ? 260 : 160,
              minHeight: isDrawing || hasInk ? 160 : undefined,
              opacity: cardsOpacity,
              transform: t.rotation ? `rotate(${t.rotation}deg)` : undefined,
              transformOrigin: 'center center',
              pointerEvents: isInkPassThroughTool ? 'none' : 'auto'
            }}
            onPointerDown={(e) => handlePointerDown(e, t.id, 'text', t.x, t.y)}
            onContextMenu={(e) => onElementContextMenu?.(e, t.id)}
            onDoubleClick={(e) => {
              e.stopPropagation()
              if (!isDrawing) handleStartEdit(t.id, t.text)
            }}
            onWheel={(e) => {
              if (!e.ctrlKey && !e.metaKey) {
                e.stopPropagation()
              }
            }}
          >
            {/* Live dimension badge during active resizing */}
            {resizeState?.id === t.id && (
              <div className="resize-dimension-badge">
                {t.w ?? 'auto'} × {t.h ?? 'auto'} px
              </div>
            )}

            {/* Bottom-right corner resize grip */}
            {!isEditing && (
              <div
                className="resize-corner-grip"
                onPointerDown={(e) => handleResizeStart(e, t.id, 'text', 'se')}
                title="Drag to resize (Width & Height)"
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

            {/* 8-direction resize handles: edges always active when not editing, corner/midpoint dots when selected */}
            {!isEditing && (
              <div className="card-resize-handles">
                {/* Edge drag strips */}
                <div
                  className="resize-edge n"
                  onPointerDown={(e) => handleResizeStart(e, t.id, 'text', 'n')}
                  title="Drag to resize top edge"
                />
                <div
                  className="resize-edge s"
                  onPointerDown={(e) => handleResizeStart(e, t.id, 'text', 's')}
                  onDoubleClick={(e) => {
                    e.stopPropagation()
                    onUpdateText(t.id, { h: undefined })
                  }}
                  title="Drag to resize height (Double-click to fit content)"
                />
                <div
                  className="resize-edge e"
                  onPointerDown={(e) => handleResizeStart(e, t.id, 'text', 'e')}
                  title="Drag to resize width"
                />
                <div
                  className="resize-edge w"
                  onPointerDown={(e) => handleResizeStart(e, t.id, 'text', 'w')}
                  title="Drag to resize width"
                />

                {/* Handle corner and midpoint dots */}
                {isSelected && (
                  <>
                    <div
                      className="resize-handle nw"
                      onPointerDown={(e) => handleResizeStart(e, t.id, 'text', 'nw')}
                    />
                    <div
                      className="resize-handle n"
                      onPointerDown={(e) => handleResizeStart(e, t.id, 'text', 'n')}
                    />
                    <div
                      className="resize-handle ne"
                      onPointerDown={(e) => handleResizeStart(e, t.id, 'text', 'ne')}
                    />
                    <div
                      className="resize-handle e"
                      onPointerDown={(e) => handleResizeStart(e, t.id, 'text', 'e')}
                    />
                    <div
                      className="resize-handle se"
                      onPointerDown={(e) => handleResizeStart(e, t.id, 'text', 'se')}
                      title="Drag to resize"
                    />
                    <div
                      className="resize-handle s"
                      onPointerDown={(e) => handleResizeStart(e, t.id, 'text', 's')}
                      onDoubleClick={(e) => {
                        e.stopPropagation()
                        onUpdateText(t.id, { h: undefined })
                      }}
                      title="Double-click to reset height to auto"
                    />
                    <div
                      className="resize-handle sw"
                      onPointerDown={(e) => handleResizeStart(e, t.id, 'text', 'sw')}
                    />
                    <div
                      className="resize-handle w"
                      onPointerDown={(e) => handleResizeStart(e, t.id, 'text', 'w')}
                    />
                  </>
                )}
              </div>
            )}

            {isEditing ? (
              <div
                className="note-editor-wrap"
                tabIndex={-1}
                onPointerDown={(e) => e.stopPropagation()}
                onBlur={(e) => {
                  if (e.currentTarget.contains(e.relatedTarget as Node)) return
                  handleFinishEdit()
                }}
              >
                <div className="note-editor-helpers" onMouseDown={(e) => e.preventDefault()}>
                  <span className="bar-tag">Markdown</span>
                  <button className="bar-btn" title="Bold" onClick={() => insertSnippet('**bold**')}>
                    <Bold size={13} />
                  </button>
                  <button className="bar-btn" title="Heading" onClick={() => insertSnippet('\n## Heading\n')}>
                    <Heading2 size={13} />
                  </button>
                  <button className="bar-btn" title="Code block" onClick={() => insertSnippet('\n```js\ncode\n```\n')}>
                    <Code size={13} />
                  </button>
                  <button className="bar-btn" title="Table" onClick={() => insertSnippet(TABLE_TEMPLATE)}>
                    <Table size={13} />
                  </button>
                  <button className="bar-btn" title="Math (LaTeX)" onClick={() => insertSnippet(' $x^2 + y^2 = z^2$ ')}>
                    <Sigma size={13} />
                  </button>
                  <button className="bar-btn" title="Diagram (Mermaid)" onClick={() => insertSnippet(MERMAID_TEMPLATE)}>
                    <Workflow size={13} />
                  </button>
                  <button className="bar-btn" title="3D Object / Lab Setup" onClick={() => insertSnippet(SCENE3D_TEMPLATE)}>
                    <Box size={13} />
                  </button>
                  <div className="bar-separator" />
                  <div className="immersed-font-group" title="Note / Text Area Font">
                    {FONT_ORDER.map((fid) => (
                      <button
                        key={fid}
                        type="button"
                        className={`immersed-font-chip ${noteFontId === fid ? 'active' : ''}`}
                        style={{ fontFamily: FONTS[fid].css }}
                        onClick={() => onUpdateText(t.id, { fontFamily: fid })}
                        title={`Font: ${FONTS[fid].label}`}
                      >
                        {FONTS[fid].shortLabel}
                      </button>
                    ))}
                  </div>
                  <div className="bar-separator" />
                  <button
                    type="button"
                    className="bar-btn"
                    onClick={() =>
                      onUpdateText(t.id, { fontSize: Math.max(12, (t.fontSize || 18) - 2) })
                    }
                    title="Decrease font size"
                  >
                    <Minus size={12} />
                  </button>
                  <span className="immersed-size-pill">{Math.round(t.fontSize || 18)}</span>
                  <button
                    type="button"
                    className="bar-btn"
                    onClick={() =>
                      onUpdateText(t.id, { fontSize: Math.min(72, (t.fontSize || 18) + 2) })
                    }
                    title="Increase font size"
                  >
                    <Plus size={12} />
                  </button>
                  <button className="bar-btn" title="Done (Esc)" onClick={handleFinishEdit}>
                    <Check size={13} />
                  </button>
                </div>
                <input
                  type="text"
                  className="note-title-editor"
                  autoFocus={focusTitleInput}
                  placeholder="Card title (optional, e.g. 1. Key Concept)..."
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      const textarea = e.currentTarget.parentElement?.querySelector(
                        '.note-inline-editor'
                      ) as HTMLTextAreaElement | null
                      textarea?.focus()
                    } else if (e.key === 'Escape') {
                      e.preventDefault()
                      handleFinishEdit()
                    }
                  }}
                />
                <textarea
                  className="note-inline-editor"
                  autoFocus={!focusTitleInput}
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  style={{ fontFamily: resolvedNoteFontCss, fontSize: `${t.fontSize || 18}px` }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') handleFinishEdit()
                  }}
                  rows={Math.max(3, editText.split('\n').length)}
                />
              </div>
            ) : (
              <div className="note-content-display">
                {t.title && (
                  <div
                    className="note-card-title"
                    title="Double-click to edit card title"
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      if (!isDrawing) handleStartEdit(t.id, t.text, t.title, true)
                    }}
                  >
                    {t.title}
                  </div>
                )}
                <div
                  className="note-card-body chat-text-content"
                  style={{ fontFamily: resolvedNoteFontCss, fontSize: `${t.fontSize || 18}px` }}
                >
                  <Markdown text={t.text} />
                </div>
              </div>
            )}

            {/* Ink layer drawn directly inside the note */}
            {(hasInk || isDrawing) && (
              <svg
                className="note-ink-layer"
                style={{
                  pointerEvents: isDrawing ? 'auto' : 'none',
                  cursor: isDrawing ? (eraseMode ? 'cell' : 'crosshair') : undefined
                }}
                onPointerDown={isDrawing ? (e) => handleInkDown(e, t) : undefined}
                onPointerMove={isDrawing ? (e) => handleInkMove(e, t) : undefined}
                onPointerUp={isDrawing ? (e) => handleInkUp(e, t) : undefined}
              >
                {(t.ink ?? []).map((s) => (
                  <path
                    key={s.id}
                    d={inkToPath(s.points, s.size)}
                    fill={s.color === 'ink' || s.color === 'accent' ? activeThemeAccent : s.color}
                  />
                ))}
                {isDrawing && liveStroke && (
                  <path d={inkToPath(liveStroke, Math.max(2, penSize))} fill={penColor} />
                )}
              </svg>
            )}

            {/* Quick action bar for selected text note */}
            {isSelected && !isEditing && (
              <div className="element-quick-bar" onPointerDown={(e) => e.stopPropagation()}>
                <button
                  className={`bar-btn ${t.style === 'h1' ? 'active' : ''}`}
                  onClick={() => handleStyleChange('h1', t.id)}
                  title="Make Header (H1)"
                >
                  <Heading1 size={14} />
                </button>
                <button
                  className={`bar-btn ${t.style === 'h2' ? 'active' : ''}`}
                  onClick={() => handleStyleChange('h2', t.id)}
                  title="Make Subheader (H2)"
                >
                  <Heading2 size={14} />
                </button>
                <button
                  className={`bar-btn ${t.style === 'body' ? 'active' : ''}`}
                  onClick={() => handleStyleChange('body', t.id)}
                  title="Normal Text"
                >
                  <Type size={14} />
                </button>
                <div className="bar-separator" />
                <div className="immersed-font-group" title="Switch Font">
                  {FONT_ORDER.map((fid) => (
                    <button
                      key={fid}
                      type="button"
                      className={`immersed-font-chip ${noteFontId === fid ? 'active' : ''}`}
                      style={{ fontFamily: FONTS[fid].css }}
                      onClick={() => onUpdateText(t.id, { fontFamily: fid })}
                      title={`Font: ${FONTS[fid].label}`}
                    >
                      {FONTS[fid].shortLabel}
                    </button>
                  ))}
                </div>
                <div className="bar-separator" />
                <button
                  type="button"
                  className="bar-btn"
                  onClick={() =>
                    onUpdateText(t.id, { fontSize: Math.max(12, (t.fontSize || 18) - 2) })
                  }
                  title="Decrease font size"
                >
                  <Minus size={12} />
                </button>
                <span className="immersed-size-pill">{Math.round(t.fontSize || 18)}</span>
                <button
                  type="button"
                  className="bar-btn"
                  onClick={() =>
                    onUpdateText(t.id, { fontSize: Math.min(72, (t.fontSize || 18) + 2) })
                  }
                  title="Increase font size"
                >
                  <Plus size={12} />
                </button>
                <div className="bar-separator" />
                <button
                  className="bar-btn"
                  onClick={() => handleStartEdit(t.id, t.text, t.title, false)}
                  title="Edit text & title (Markdown)"
                >
                  <Pencil size={14} />
                </button>
                <button
                  type="button"
                  className={`bar-btn ${t.title ? 'active' : ''}`}
                  onClick={() => handleStartEdit(t.id, t.text, t.title, true)}
                  title={t.title ? 'Edit card title header' : 'Add card title header'}
                >
                  <span style={{ fontSize: 10, fontWeight: 800 }}>Title</span>
                </button>
                {/```mermaid/i.test(t.text) && (
                  <button
                    className="bar-btn"
                    onClick={async () => {
                      const match = /```mermaid\s*([\s\S]*?)```/i.exec(t.text)
                      const code = match ? match[1].trim() : t.text
                      try {
                        await navigator.clipboard.writeText(code)
                      } catch {
                        // ignore
                      }
                    }}
                    title="Copy raw Mermaid diagram code to clipboard"
                  >
                    <Copy size={14} />
                  </button>
                )}
                <button
                  className="bar-btn"
                  onClick={() => onUpdateText(t.id, { text: t.text + MERMAID_TEMPLATE })}
                  title="Add diagram (Mermaid) to this note"
                >
                  <Workflow size={14} />
                </button>
                <button
                  className={`bar-btn ${isDrawing ? 'active' : ''}`}
                  onClick={() => {
                    setDrawingId(isDrawing ? null : t.id)
                    setEraseMode(false)
                  }}
                  title="Draw inside this note (uses pen color & thickness)"
                >
                  <Brush size={14} />
                </button>
                {isDrawing && (
                  <>
                    <button
                      className={`bar-btn ${eraseMode ? 'active' : ''}`}
                      onClick={() => setEraseMode(!eraseMode)}
                      title="Erase ink in note"
                    >
                      <Eraser size={14} />
                    </button>
                    <button
                      className="bar-btn danger"
                      onClick={() => onUpdateText(t.id, { ink: [] })}
                      title="Clear all ink in note"
                    >
                      <Trash2 size={14} />
                    </button>
                  </>
                )}
                <div className="bar-separator" />
                <button
                  className={`bar-btn ${t.bold ? 'active' : ''}`}
                  onClick={() => onUpdateText(t.id, { bold: !t.bold })}
                  title="Toggle Bold"
                >
                  <Bold size={14} />
                </button>
                <button
                  className={`bar-btn ${t.italic ? 'active' : ''}`}
                  onClick={() => onUpdateText(t.id, { italic: !t.italic })}
                  title="Toggle Italic"
                >
                  <Italic size={14} />
                </button>
                {(t.w !== undefined || t.h !== undefined) && (
                  <button
                    className="bar-btn"
                    onClick={() => onUpdateText(t.id, { w: undefined, h: undefined })}
                    title="Reset size to default auto-fit"
                  >
                    <FoldVertical size={14} />
                  </button>
                )}
                <div className="bar-separator" />
                <TabColorPicker
                  size="sm"
                  color={t.bg && t.bg !== 'transparent' ? t.bg : undefined}
                  onChange={(c) => onUpdateText(t.id, { bg: c })}
                  title="Change Note tab / card color"
                />
                <button
                  className="bar-btn"
                  onClick={() => onDuplicateElement(t.id)}
                  title="Duplicate Note"
                >
                  <Copy size={14} />
                </button>
                <button
                  className="bar-btn danger"
                  onClick={() => onDeleteElement(t.id)}
                  title="Delete Note"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            )}
          </div>
        )
      })}

      {/* 2. Math Equation Nodes (KaTeX) */}
      {cardsVisible && equationNodes.map((eq) => {
        const isSelected = eq.id === selectedId || Boolean(selectedIds?.includes(eq.id))
        const isEditing = eq.id === editingId

        let renderedHtml = ''
        try {
          renderedHtml = katex.renderToString(eq.latex, {
            throwOnError: false,
            displayMode: true
          })
        } catch {
          renderedHtml = `<code>${eq.latex}</code>`
        }

        return (
          <div
            key={eq.id}
            id={eq.id}
            className={`canvas-equation-card ${isSelected ? 'selected' : ''}`}
            style={{
              left: `${eq.x}px`,
              top: `${eq.y}px`,
              width: eq.w ? `${eq.w}px` : undefined,
              height: eq.h ? `${eq.h}px` : undefined,
              fontSize: `${eq.fontSize}px`,
              ...(eq.bg ? getReadableTabStyle(eq.bg) : {}),
              borderColor: isSelected ? activeThemeAccent : undefined,
              opacity: cardsOpacity,
              pointerEvents: isInkPassThroughTool ? 'none' : 'auto'
            }}
            onPointerDown={(e) => handlePointerDown(e, eq.id, 'equation', eq.x, eq.y)}
            onContextMenu={(e) => onElementContextMenu?.(e, eq.id)}
            onDoubleClick={(e) => {
              e.stopPropagation()
              handleStartEdit(eq.id, eq.latex)
            }}
          >
            {/* Live dimension badge during active resizing */}
            {resizeState?.id === eq.id && (
              <div className="resize-dimension-badge">
                {eq.w ?? 'auto'} × {eq.h ?? 'auto'} px
              </div>
            )}

            {/* Bottom-right corner resize grip */}
            {!isEditing && (
              <div
                className="resize-corner-grip"
                onPointerDown={(e) => handleResizeStart(e, eq.id, 'equation', 'se')}
                title="Drag to resize"
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

            {/* Resize handles when selected */}
            {isSelected && !isEditing && (
              <div className="card-resize-handles">
                <div
                  className="resize-edge e"
                  onPointerDown={(e) => handleResizeStart(e, eq.id, 'equation', 'e')}
                  title="Drag to resize width"
                />
                <div
                  className="resize-edge s"
                  onPointerDown={(e) => handleResizeStart(e, eq.id, 'equation', 's')}
                  title="Drag to resize height"
                />
                <div
                  className="resize-handle se"
                  onPointerDown={(e) => handleResizeStart(e, eq.id, 'equation', 'se')}
                  title="Drag to resize"
                />
                <div
                  className="resize-handle e"
                  onPointerDown={(e) => handleResizeStart(e, eq.id, 'equation', 'e')}
                />
                <div
                  className="resize-handle s"
                  onPointerDown={(e) => handleResizeStart(e, eq.id, 'equation', 's')}
                />
              </div>
            )}

            {isEditing ? (
              <div className="equation-editor-box" onPointerDown={(e) => e.stopPropagation()}>
                <span className="eq-label">LaTeX Formula:</span>
                <input
                  type="text"
                  className="equation-input"
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onBlur={handleFinishEdit}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleFinishEdit()
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                  autoFocus
                />
              </div>
            ) : (
              <div
                className="equation-display"
                dangerouslySetInnerHTML={{ __html: renderedHtml }}
              />
            )}

            {isSelected && !isEditing && (
              <div className="element-quick-bar" onPointerDown={(e) => e.stopPropagation()}>
                <span className="bar-tag">LaTeX</span>
                <TabColorPicker
                  size="sm"
                  color={eq.bg}
                  onChange={(c) => onUpdateEquation(eq.id, { bg: c })}
                  title="Change Equation card color"
                />
                {(eq.w !== undefined || eq.h !== undefined) && (
                  <button
                    className="bar-btn"
                    onClick={() => onUpdateEquation(eq.id, { w: undefined, h: undefined })}
                    title="Reset size to auto"
                  >
                    <FoldVertical size={14} />
                  </button>
                )}
                <button
                  className="bar-btn"
                  onClick={() => onDuplicateElement(eq.id)}
                  title="Duplicate Equation"
                >
                  <Copy size={14} />
                </button>
                <button
                  className="bar-btn danger"
                  onClick={() => onDeleteElement(eq.id)}
                  title="Delete Equation"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            )}
          </div>
        )
      })}

      {/* 3. React Flow Interactive Diagrams */}
      <Suspense fallback={null}>
      {cardsVisible && (diagramNodes ?? []).map((diag) => {
        const isSelected = diag.id === selectedId || Boolean(selectedIds?.includes(diag.id))
        const isPointerDisabled = isInkPassThroughTool
        return (
          <div
            key={diag.id}
            style={{ display: 'contents' }}
            onContextMenu={(e) => {
              if (!isPointerDisabled) onElementContextMenu?.(e, diag.id)
            }}
          >
            <ReactFlowDiagram
              diagram={diag}
              isSelected={isSelected}
              isResizing={resizeState?.id === diag.id}
              disabledPointerEvents={isPointerDisabled}
              palette={boardPalette}
              onSelect={() => onSelect(diag.id)}
              onUpdate={(patch) => onUpdateDiagram?.(diag.id, patch)}
              onDelete={() => onDeleteElement(diag.id)}
              onDuplicate={() => onDuplicateElement(diag.id)}
              onStartMove={(startX, startY) => {
                const isMulti = Boolean(selectedIds && selectedIds.includes(diag.id) && selectedIds.length > 1)
                if (isMulti && selectedIds) {
                  onStartMoveSelection?.(selectedIds, startX, startY)
                } else {
                  onSelect(diag.id)
                  onPushHistory?.()
                }
                setDragState({
                  id: diag.id,
                  kind: 'diagram',
                  startX,
                  startY,
                  initX: diag.x,
                  initY: diag.y,
                  isMulti
                })
              }}
              onStartResize={(e, dir) => handleResizeStart(e, diag.id, 'diagram', dir)}
            />
          </div>
        )
      })}
      </Suspense>

      {/* 4. Interactive Pinned Code Runner Cards */}
      <Suspense fallback={null}>
      {cardsVisible && (codeNodes ?? []).map((codeNode) => {
        const isSelected = codeNode.id === selectedId || Boolean(selectedIds?.includes(codeNode.id))
        const isPointerDisabled = isInkPassThroughTool
        const incomingConns = (shapeNodes ?? []).filter(
          (s) => s.endBinding?.shapeId === codeNode.id && Boolean(s.startBinding?.shapeId)
        )
        const outgoingConns = (shapeNodes ?? []).filter(
          (s) => s.startBinding?.shapeId === codeNode.id && Boolean(s.endBinding?.shapeId)
        )
        const connectionSummary =
          incomingConns.length > 0 || outgoingConns.length > 0
            ? {
                incomingCount: incomingConns.length,
                outgoingCount: outgoingConns.length
              }
            : undefined
        return (
          <div
            key={codeNode.id}
            style={{ display: 'contents' }}
            onContextMenu={(e) => {
              if (isPointerDisabled) return
              const targetEl = e.target as HTMLElement | null
              // Preserve native copy/paste inside CodeMirror text editor; show card menu on header/frame
              if (targetEl?.closest('.cm-content')) return
              onElementContextMenu?.(e, codeNode.id)
            }}
          >
            <CanvasCodeCard
              node={codeNode}
              connectionSummary={connectionSummary}
              isSelected={isSelected}
              isResizing={resizeState?.id === codeNode.id}
              isLightTheme={isLightTheme}
              disabledPointerEvents={isPointerDisabled}
              onSelect={() => onSelect(codeNode.id)}
              onUpdate={(patch, opts) => onUpdateCode?.(codeNode.id, patch, opts)}
              onDelete={() => onDeleteElement(codeNode.id)}
              onDuplicate={() => onDuplicateElement(codeNode.id)}
              onAddContainer={onAddCodeNode}
              onStartConnect={onStartConnect}
              onExecuteCodeNode={onExecuteCodeNode}
              onStartMove={(startX, startY) => {
                const isMulti = Boolean(
                  selectedIds && selectedIds.includes(codeNode.id) && selectedIds.length > 1
                )
                if (isMulti && selectedIds) {
                  onStartMoveSelection?.(selectedIds, startX, startY)
                } else {
                  onSelect(codeNode.id)
                  onPushHistory?.()
                }
                setDragState({
                  id: codeNode.id,
                  kind: 'code',
                  startX,
                  startY,
                  initX: codeNode.x,
                  initY: codeNode.y,
                  isMulti
                })
              }}
              onStartResize={(e, dir) => handleResizeStart(e, codeNode.id, 'code', dir)}
              onSendOutputToNote={onInsertToNotes}
              onSpawnGraphFromCode={onSpawnGraphFromCode}
              onSpawnScene3DFromCode={onSpawnScene3DFromCode}
              onAskAI={
                onAskAICode && isAiConfigured
                  ? (ctx) => onAskAICode(codeNode.id, ctx)
                  : undefined
              }
              onToast={onToast}
            />
          </div>
        )
      })}
      </Suspense>

      {/* 5. In-Board Interactive YouTube Video Cards */}
      <Suspense fallback={null}>
      {cardsVisible && (videoNodes ?? []).map((videoNode) => {
        const isSelected = videoNode.id === selectedId || Boolean(selectedIds?.includes(videoNode.id))
        const isPointerDisabled = isInkPassThroughTool
        return (
          <div
            key={videoNode.id}
            style={{ display: 'contents' }}
            onContextMenu={(e) => {
              if (!isPointerDisabled) onElementContextMenu?.(e, videoNode.id)
            }}
          >
            <CanvasVideoCard
              node={videoNode}
              isSelected={isSelected}
              isResizing={resizeState?.id === videoNode.id}
              disabledPointerEvents={isPointerDisabled}
              onSelect={() => onSelect(videoNode.id)}
              onUpdate={(patch, opts) => onUpdateVideo?.(videoNode.id, patch, opts)}
              onDelete={() => onDeleteElement(videoNode.id)}
              onDuplicate={() => onDuplicateElement(videoNode.id)}
              onAddContainer={onAddVideoNode}
              onStartMove={(startX, startY) => {
                const isMulti = Boolean(
                  selectedIds && selectedIds.includes(videoNode.id) && selectedIds.length > 1
                )
                if (isMulti && selectedIds) {
                  onStartMoveSelection?.(selectedIds, startX, startY)
                } else {
                  onSelect(videoNode.id)
                  onPushHistory?.()
                }
                setDragState({
                  id: videoNode.id,
                  kind: 'video',
                  startX,
                  startY,
                  initX: videoNode.x,
                  initY: videoNode.y,
                  isMulti
                })
              }}
              onStartResize={(e, dir) => handleResizeStart(e, videoNode.id, 'video', dir)}
              onAddTimestampNote={(timestampSec, videoTitle, videoUrl) => {
                const mins = Math.floor(timestampSec / 60)
                const secs = Math.floor(timestampSec % 60)
                const formatted = `${mins}:${secs < 10 ? '0' : ''}${secs}`
                const noteText = `### Notes on [${videoTitle}](${videoUrl || '#'}) at \`${formatted}\`\n\n- Key Insight:\n- Action Item:`
                onInsertToNotes?.(noteText, `${videoTitle} @ ${formatted}`)
              }}
              onCreateTutorialFromVideo={onCreateTutorialFromVideo}
              isAiConfigured={isAiConfigured}
              onToast={onToast}
            />
          </div>
        )
      })}
      </Suspense>

      {/* 6. Inserted Images & Clipboard Snippets */}
      {cardsVisible &&
        (imageNodes ?? []).map((img) => {
          const isSelected = img.id === selectedId || Boolean(selectedIds?.includes(img.id))
          const isEditingCaption = img.id === editingId
          return (
            <div
              key={img.id}
              id={img.id}
              className={`canvas-image-card ${isSelected ? 'selected' : ''} ${
                resizeState?.id === img.id ? 'resizing' : ''
              }`}
              style={{
                left: `${img.x}px`,
                top: `${img.y}px`,
                width: `${img.w}px`,
                height: `${img.h}px`,
                borderColor: isSelected ? activeThemeAccent : img.color || undefined,
                opacity: cardsOpacity,
                pointerEvents: isInkPassThroughTool ? 'none' : 'auto'
              }}
              onPointerDown={(e) => handlePointerDown(e, img.id, 'image', img.x, img.y)}
              onContextMenu={(e) => onElementContextMenu?.(e, img.id)}
              onDoubleClick={(e) => {
                e.stopPropagation()
                handleStartEdit(img.id, img.caption || '')
              }}
            >
              {(isSelected || img.caption || img.color) && (
                <div
                  className="canvas-image-card-header"
                  style={getReadableTabStyle(img.color)}
                >
                  <GripHorizontal size={12} className="image-grip-icon" />
                  <ImageIcon size={12} />
                  {isEditingCaption ? (
                    <input
                      type="text"
                      className="canvas-code-title-input"
                      value={editText}
                      placeholder="Add image caption..."
                      onChange={(e) => setEditText(e.target.value)}
                      onBlur={handleFinishEdit}
                      onPointerDown={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        e.stopPropagation()
                        if (e.key === 'Enter') handleFinishEdit()
                        if (e.key === 'Escape') setEditingId(null)
                      }}
                      autoFocus
                    />
                  ) : (
                    <span className="canvas-image-caption">
                      {img.caption || 'Snippet'}
                    </span>
                  )}
                  <div
                    className="canvas-image-hdr-actions"
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <TabColorPicker
                      size="xs"
                      color={img.color}
                      onChange={(c) => onUpdateImage?.(img.id, { color: c })}
                      title="Change snippet tab header color"
                    />
                    <button
                      type="button"
                      className="canvas-code-hdr-btn"
                      title="Edit caption"
                      onClick={() => handleStartEdit(img.id, img.caption || '')}
                    >
                      <Pencil size={11} />
                    </button>
                    <button
                      type="button"
                      className="canvas-code-hdr-btn"
                      title="Duplicate image"
                      onClick={() => onDuplicateElement(img.id)}
                    >
                      <Copy size={11} />
                    </button>
                    <button
                      type="button"
                      className="canvas-code-hdr-btn danger"
                      title="Delete image"
                      onClick={() => onDeleteElement(img.id)}
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>
              )}

              {resizeState?.id === img.id && (
                <div className="resize-dimension-badge">
                  {img.w} × {img.h} px
                </div>
              )}

              <div className="canvas-image-body">
                <img
                  src={img.src}
                  alt={img.caption || 'Board snippet'}
                  draggable={false}
                  className="canvas-image-el"
                />
              </div>

              {!isEditingCaption && (
                <div className="card-resize-handles">
                  {(['n', 's', 'e', 'w'] as const).map((dir) => (
                    <div
                      key={`img-edge-${dir}`}
                      className={`resize-edge ${dir}`}
                      onPointerDown={(e) => handleResizeStart(e, img.id, 'image', dir)}
                    />
                  ))}
                  {isSelected &&
                    (['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const).map((dir) => (
                      <div
                        key={`img-h-${dir}`}
                        className={`resize-handle ${dir}`}
                        onPointerDown={(e) => handleResizeStart(e, img.id, 'image', dir)}
                      />
                    ))}
                </div>
              )}
            </div>
          )
        })}

      {/* 7. Canvas-Immersed Interactive 3D Objects & Experimental Setups */}
      <Suspense fallback={null}>
        {cardsVisible &&
          (scene3dNodes ?? []).map((s3d) => {
            const isSelected = s3d.id === selectedId || Boolean(selectedIds?.includes(s3d.id))
            const isPointerDisabled = isInkPassThroughTool
            return (
              <Canvas3DSceneCard
                key={s3d.id}
                node={s3d}
                isSelected={isSelected}
                isResizing={resizeState?.id === s3d.id}
                isLightTheme={isLightTheme}
                activeThemeAccent={activeThemeAccent}
                disabledPointerEvents={isPointerDisabled}
                onSelect={() => onSelect(s3d.id)}
                onUpdate={(patch, opts) => onUpdateScene3D?.(s3d.id, patch, opts)}
                onDelete={() => onDeleteElement(s3d.id)}
                onDuplicate={() => onDuplicateElement(s3d.id)}
                onStartMove={(startX, startY) => {
                  const isMulti = Boolean(
                    selectedIds && selectedIds.includes(s3d.id) && selectedIds.length > 1
                  )
                  if (isMulti && selectedIds) {
                    onStartMoveSelection?.(selectedIds, startX, startY)
                  } else {
                    onSelect(s3d.id)
                    onPushHistory?.()
                  }
                  setDragState({
                    id: s3d.id,
                    kind: 'scene3d',
                    startX,
                    startY,
                    initX: s3d.x,
                    initY: s3d.y,
                    isMulti
                  })
                }}
                onStartResize={(e, dir) => handleResizeStart(e, s3d.id, 'scene3d', dir)}
                onStartConnect={onStartConnect}
                onInsertToNotes={onInsertToNotes}
                onContextMenu={(e) => onElementContextMenu?.(e, s3d.id)}
              />
            )
          })}
      </Suspense>

      {/* 8. Unified Interactive 2D & 3D Plotly / GeoGebra Graph Cards */}
      <Suspense fallback={null}>
        {cardsVisible &&
          (graphNodes ?? []).map((gr) => {
            const isSelected = gr.id === selectedId || Boolean(selectedIds?.includes(gr.id))
            const isPointerDisabled = isInkPassThroughTool
            return (
              <CanvasGraphCard
                key={gr.id}
                node={gr}
                isSelected={isSelected}
                isResizing={resizeState?.id === gr.id}
                isLightTheme={isLightTheme}
                activeThemeAccent={activeThemeAccent}
                disabledPointerEvents={isPointerDisabled}
                onSelect={() => onSelect(gr.id)}
                onUpdate={(patch, opts) => onUpdateGraph?.(gr.id, patch, opts)}
                onDelete={() => onDeleteElement(gr.id)}
                onDuplicate={() => onDuplicateElement(gr.id)}
                onStartMove={(startX, startY) => {
                  const isMulti = Boolean(
                    selectedIds && selectedIds.includes(gr.id) && selectedIds.length > 1
                  )
                  if (isMulti && selectedIds) {
                    onStartMoveSelection?.(selectedIds, startX, startY)
                  } else {
                    onSelect(gr.id)
                    onPushHistory?.()
                  }
                  setDragState({
                    id: gr.id,
                    kind: 'graph',
                    startX,
                    startY,
                    initX: gr.x,
                    initY: gr.y,
                    isMulti
                  })
                }}
                onStartResize={(e, dir) => handleResizeStart(e, gr.id, 'graph', dir)}
                onStartConnect={onStartConnect}
                onInsertToNotes={onInsertToNotes}
                onContextMenu={(e) => onElementContextMenu?.(e, gr.id)}
              />
            )
          })}
      </Suspense>
    </div>
  )
})
CanvasElements.displayName = 'CanvasElements'
