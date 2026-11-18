import React, { useState, useEffect } from 'react'
import {
  Trash2,
  Heading1,
  Heading2,
  Type,
  Bold,
  Italic,
  Palette,
  Copy,
  Pencil,
  Brush,
  Workflow,
  Eraser,
  Check,
  Code,
  Table,
  Sigma,
  FoldVertical
} from 'lucide-react'
import type {
  CanvasTransform,
  CodeNode,
  DiagramNode,
  EquationNode,
  InkPoint,
  Stroke,
  TextNode,
  TextStyle,
  ToolType,
  VideoNode
} from '../types/board'
import katex from 'katex'
import getStroke from 'perfect-freehand'
import { Markdown } from './Markdown'
import { ReactFlowDiagram } from './ReactFlowDiagram'
import { CanvasCodeCard } from './CodeStudioPanel'
import { CanvasVideoCard } from './CanvasVideoCard'
import { isLightColor, type BoardPalette } from '../board/backgroundPresets'

const MERMAID_TEMPLATE = '\n```mermaid\ngraph TD\n  A[Start] --> B{Decision}\n  B -->|Yes| C[Do it]\n  B -->|No| D[Skip]\n```\n'
const TABLE_TEMPLATE = '\n| Col A | Col B |\n| --- | --- |\n| 1 | 2 |\n'

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
  kind: 'text' | 'equation' | 'diagram' | 'code' | 'video'
  direction: ResizeDirection
  startX: number
  startY: number
  initX: number
  initY: number
  initW: number
  initH: number
  hasExplicitH: boolean
}

interface CanvasElementsProps {
  textNodes: TextNode[]
  equationNodes: EquationNode[]
  diagramNodes?: DiagramNode[]
  codeNodes?: CodeNode[]
  videoNodes?: VideoNode[]
  selectedId: string | null
  selectedIds?: string[]
  onSelect: (id: string | null) => void
  onUpdateText: (id: string, patch: Partial<TextNode>, opts?: { history?: boolean }) => void
  onUpdateEquation: (id: string, patch: Partial<EquationNode>, opts?: { history?: boolean }) => void
  onUpdateDiagram?: (id: string, patch: Partial<DiagramNode>, opts?: { history?: boolean }) => void
  onUpdateCode?: (id: string, patch: Partial<CodeNode>, opts?: { history?: boolean }) => void
  onUpdateVideo?: (id: string, patch: Partial<VideoNode>, opts?: { history?: boolean }) => void
  onAddCodeNode?: () => void
  onAddVideoNode?: () => void
  onCreateTutorialFromVideo?: (topic: string, transcriptText?: string) => void
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
  penColor: string
  penSize: number
}

const NOTE_PALETTES = [
  { label: 'Auto Theme', bg: '' },
  { label: 'Paper White', bg: '#FFFFFF' },
  { label: 'Butter Yellow', bg: '#FFE566' },
  { label: 'Sky Cyan', bg: '#A5F3FC' },
  { label: 'Mint Pop', bg: '#A7F3D0' },
  { label: 'Lilac Mist', bg: '#DDD6FE' },
  { label: 'Coral Pink', bg: '#FECDD3' }
]

export const CanvasElements: React.FC<CanvasElementsProps> = ({
  textNodes,
  equationNodes,
  diagramNodes,
  codeNodes,
  videoNodes,
  selectedId,
  selectedIds,
  onSelect,
  onUpdateText,
  onUpdateEquation,
  onUpdateDiagram,
  onUpdateCode,
  onUpdateVideo,
  onAddCodeNode,
  onAddVideoNode,
  onCreateTutorialFromVideo,
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
  penColor,
  penSize
}) => {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [drawingId, setDrawingId] = useState<string | null>(null)
  const [liveStroke, setLiveStroke] = useState<InkPoint[] | null>(null)
  const [eraseMode, setEraseMode] = useState(false)
  const [colorPickerOpen, setColorPickerOpen] = useState(false)
  const [dragState, setDragState] = useState<{
    id: string
    kind: 'text' | 'equation' | 'diagram' | 'code' | 'video'
    startX: number
    startY: number
    initX: number
    initY: number
    isMulti?: boolean
  } | null>(null)
  const [resizeState, setResizeState] = useState<ResizeState | null>(null)

  // Double-click to edit text or equation
  const handleStartEdit = (id: string, text: string): void => {
    setEditingId(id)
    setEditText(text)
  }

  const handleFinishEdit = (): void => {
    if (!editingId) return
    const textNode = textNodes.find((t) => t.id === editingId)
    if (textNode) {
      onUpdateText(editingId, { text: editText.trim() || 'Empty note' })
    }
    const eqNode = equationNodes.find((e) => e.id === editingId)
    if (eqNode) {
      onUpdateEquation(editingId, { latex: editText.trim() || 'E = mc^2' })
    }
    setEditingId(null)
  }

  // Pointer dragging for movement (notes & equations)
  const handlePointerDown = (
    e: React.PointerEvent,
    id: string,
    kind: 'text' | 'equation',
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
    onUpdateVideo
  ])

  // Pointer down to begin resizing
  const handleResizeStart = (
    e: React.PointerEvent,
    id: string,
    kind: 'text' | 'equation' | 'diagram' | 'code' | 'video',
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
      hasExplicitH: true
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
            : resizeState.kind === 'diagram'
              ? 200
              : 160
      const minH =
        resizeState.kind === 'video'
          ? 320
          : resizeState.kind === 'code'
            ? 240
            : resizeState.kind === 'diagram'
              ? 140
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
  }, [resizeState, view.zoom, onPushHistory, onUpdateText, onUpdateEquation, onUpdateDiagram, onUpdateCode, onUpdateVideo])

  // Selected item toolbar formatting helpers
  const selectedTextNode = textNodes.find((t) => t.id === selectedId)

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

  const handleStyleChange = (style: TextStyle): void => {
    if (!selectedTextNode) return
    const fontSize = style === 'h1' ? 32 : style === 'h2' ? 24 : 16
    const bold = style === 'h1' || style === 'h2'
    onUpdateText(selectedTextNode.id, { style, fontSize, bold })
  }

  return (
    <div
      className="canvas-dom-overlay"
      style={{
        transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`,
        transformOrigin: '0 0'
      }}
    >
      {/* 1. Text & Sticky Notes */}
      {textNodes.map((t) => {
        const isSelected = selectedIds ? selectedIds.includes(t.id) : t.id === selectedId
        const isEditing = t.id === editingId

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
              width: t.w ? `${t.w}px` : undefined,
              height: t.h ? `${t.h}px` : undefined,
              maxWidth: t.w ? 'none' : undefined,
              fontSize: `${t.fontSize}px`,
              fontWeight: t.bold ? 700 : 500,
              fontStyle: t.italic ? 'italic' : 'normal',
              background: resolvedBg,
              color: resolvedTextColor,
              borderColor: isSelected ? activeThemeAccent : undefined,
              minWidth: isDrawing || hasInk ? 260 : 160,
              minHeight: isDrawing || hasInk ? 160 : undefined
            }}
            onPointerDown={(e) => handlePointerDown(e, t.id, 'text', t.x, t.y)}
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
              <div className="note-editor-wrap" onPointerDown={(e) => e.stopPropagation()}>
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
                  <button className="bar-btn" title="Done (Esc)" onClick={handleFinishEdit}>
                    <Check size={13} />
                  </button>
                </div>
                <textarea
                  className="note-inline-editor"
                  autoFocus
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onBlur={handleFinishEdit}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') handleFinishEdit()
                  }}
                  rows={Math.max(3, editText.split('\n').length)}
                />
              </div>
            ) : (
              <div className="note-content-display">
                {t.title && <div className="note-card-title">{t.title}</div>}
                <div className="note-card-body chat-text-content">
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
                  onClick={() => handleStyleChange('h1')}
                  title="Make Header (H1)"
                >
                  <Heading1 size={14} />
                </button>
                <button
                  className={`bar-btn ${t.style === 'h2' ? 'active' : ''}`}
                  onClick={() => handleStyleChange('h2')}
                  title="Make Subheader (H2)"
                >
                  <Heading2 size={14} />
                </button>
                <button
                  className={`bar-btn ${t.style === 'body' ? 'active' : ''}`}
                  onClick={() => handleStyleChange('body')}
                  title="Normal Text"
                >
                  <Type size={14} />
                </button>
                <div className="bar-separator" />
                <button
                  className="bar-btn"
                  onClick={() => handleStartEdit(t.id, t.text)}
                  title="Edit text (Markdown)"
                >
                  <Pencil size={14} />
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
                <div className="color-palette-popover-wrap">
                  <button
                    className="bar-btn"
                    onClick={() => setColorPickerOpen(!colorPickerOpen)}
                    title="Change Note Color"
                  >
                    <Palette size={14} />
                  </button>
                  {colorPickerOpen && (
                    <div className="color-palette-popover">
                      {NOTE_PALETTES.map((p) => (
                        <button
                          key={p.label}
                          className="palette-swatch"
                          style={{
                            background: p.bg || (boardPalette?.noteBg ?? '#FFFFFF')
                          }}
                          onClick={() => {
                            onUpdateText(t.id, { bg: p.bg || undefined })
                            setColorPickerOpen(false)
                          }}
                          title={p.label}
                        />
                      ))}
                    </div>
                  )}
                </div>
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
      {equationNodes.map((eq) => {
        const isSelected = selectedIds ? selectedIds.includes(eq.id) : eq.id === selectedId
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
              borderColor: isSelected ? activeThemeAccent : undefined
            }}
            onPointerDown={(e) => handlePointerDown(e, eq.id, 'equation', eq.x, eq.y)}
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
      {(diagramNodes ?? []).map((diag) => {
        const isSelected = selectedIds ? selectedIds.includes(diag.id) : diag.id === selectedId
        const isPointerDisabled =
          activeTool === 'eraser' || activeTool === 'pen' || activeTool === 'pan'
        return (
          <ReactFlowDiagram
            key={diag.id}
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
        )
      })}

      {/* 4. Interactive Pinned Code Runner Cards */}
      {(codeNodes ?? []).map((codeNode) => {
        const isSelected = selectedIds ? selectedIds.includes(codeNode.id) : codeNode.id === selectedId
        const isPointerDisabled =
          activeTool === 'eraser' || activeTool === 'pen' || activeTool === 'pan'
        return (
          <CanvasCodeCard
            key={codeNode.id}
            node={codeNode}
            isSelected={isSelected}
            isResizing={resizeState?.id === codeNode.id}
            isLightTheme={isLightTheme}
            disabledPointerEvents={isPointerDisabled}
            onSelect={() => onSelect(codeNode.id)}
            onUpdate={(patch, opts) => onUpdateCode?.(codeNode.id, patch, opts)}
            onDelete={() => onDeleteElement(codeNode.id)}
            onDuplicate={() => onDuplicateElement(codeNode.id)}
            onAddContainer={onAddCodeNode}
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
            onToast={onToast}
          />
        )
      })}

      {/* 5. In-Board Interactive YouTube Video Cards */}
      {(videoNodes ?? []).map((videoNode) => {
        const isSelected = selectedIds ? selectedIds.includes(videoNode.id) : videoNode.id === selectedId
        const isPointerDisabled =
          activeTool === 'eraser' || activeTool === 'pen' || activeTool === 'pan'
        return (
          <CanvasVideoCard
            key={videoNode.id}
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
            onToast={onToast}
          />
        )
      })}
    </div>
  )
}
