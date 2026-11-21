import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowRight,
  Ban,
  ChevronDown,
  Layers,
  Loader2,
  Palette,
  PenTool,
  RotateCcw,
  Sparkles,
  Trash2,
  Type,
  X,
  Zap
} from 'lucide-react'
import type { FontId, ShapeNode, VectorArtNode, VectorDiagramMeta } from '../types/board'
import type { DiagramDirection, SmartBeautifyMode } from '@shared/beautifySchema'
import type { BoardPalette } from '../board/backgroundPresets'
import { isConnectorShape } from '../board/connectorUtils'
import { FONTS, FONT_ORDER } from '../themes'

interface VectorActionToolbarProps {
  selectedVectorArt: VectorArtNode | null
  selectedDiagramMeta: VectorDiagramMeta | null
  selectedShapes?: ShapeNode[]
  boardPalette?: BoardPalette
  canAutoLayoutShapes?: boolean
  hasTopSelectionBar?: boolean
  isBusy: boolean
  onPatchSelectedShapes?: (patch: Partial<ShapeNode>, opts?: { coalesceHistory?: boolean }) => void
  onAutoLayoutShapes?: (dir: 'RIGHT' | 'DOWN') => void
  onSyncAnimatedWaveFlow?: () => void
  onEditShapeLabel?: (shapeId: string) => void
  onDeleteSelected?: () => void
  onClearSelection?: () => void
  onSwapArtColor: (artId: string, oldColor: string, newColor: string) => void
  onUngroupArt: (artId: string) => void
  onRerunArtStyle: (artId: string, mode: SmartBeautifyMode) => void
  onRevertArtToSketch: (artId: string) => void
  onToggleDiagramDirection: (groupId: string, nextDirection: DiagramDirection) => void
  onRevertDiagramToSketch: (groupId: string) => void
}

const SHAPE_FILL_SWATCHES = [
  '#FFFFFF',
  '#FFE566',
  '#7BF1A8',
  '#67E8F9',
  '#C4B5FD',
  '#FDA4AF',
  '#FDBA74',
  '#1E293B'
]

const SHAPE_STROKE_SWATCHES: Array<{ value: string; label: string }> = [
  { value: 'ink', label: 'Theme Ink' },
  { value: '#111111', label: 'Black' },
  { value: '#EF4444', label: 'Red' },
  { value: '#2563EB', label: 'Blue' },
  { value: '#10B981', label: 'Green' },
  { value: '#8B5CF6', label: 'Purple' }
]

const SHAPE_LABEL_COLOR_SWATCHES: Array<{ value: string; label: string }> = [
  { value: '#111111', label: 'Black Text' },
  { value: '#FFFFFF', label: 'White Text' },
  { value: '#EF4444', label: 'Red Text' },
  { value: '#2563EB', label: 'Blue Text' },
  { value: '#10B981', label: 'Green Text' },
  { value: '#8B5CF6', label: 'Purple Text' }
]

function normalizeHexSwatch(c: string | undefined, fallback = '#ffe566'): string {
  const s = (c ?? '').trim()
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase()
  if (/^#[0-9a-f]{3}$/i.test(s)) {
    return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`.toLowerCase()
  }
  return fallback
}

export const VectorActionToolbar = React.memo(function VectorActionToolbar(
  props: VectorActionToolbarProps
): React.JSX.Element | null {
  const {
    selectedVectorArt,
    selectedDiagramMeta,
    selectedShapes = [],
    boardPalette,
    canAutoLayoutShapes = false,
    hasTopSelectionBar = false,
    isBusy,
    onPatchSelectedShapes,
    onAutoLayoutShapes,
    onSyncAnimatedWaveFlow,
    onEditShapeLabel,
    onDeleteSelected,
    onClearSelection,
    onSwapArtColor,
    onUngroupArt,
    onRerunArtStyle,
    onRevertArtToSketch,
    onToggleDiagramDirection,
    onRevertDiagramToSketch
  } = props

  const [openMenu, setOpenMenu] = useState<'fill' | 'border' | 'text' | null>(null)
  const toolbarRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!openMenu) return
    const onDown = (e: PointerEvent): void => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        setOpenMenu(null)
      }
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpenMenu(null)
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [openMenu])

  const uniqueFills = useMemo(() => {
    if (!selectedVectorArt) return []
    const set = new Set<string>()
    for (const layer of selectedVectorArt.layers) {
      if (layer.fill && layer.fill !== 'none' && layer.fill !== 'transparent') {
        set.add(layer.fill)
      }
    }
    return Array.from(set).slice(0, 10)
  }, [selectedVectorArt])

  const hasShapes = selectedShapes.length > 0 && Boolean(onPatchSelectedShapes)
  if (!selectedVectorArt && !selectedDiagramMeta && !hasShapes) return null

  const barClass = `vector-context-toolbar ${hasTopSelectionBar ? '' : 'at-top'}`.trim()

  // 1. Floating Mini-Toolbar for `vector_art`
  if (selectedVectorArt) {
    const canSwitchStyle = Boolean(selectedVectorArt.sourceMeta?.originalStrokes?.length)
    const activeStyle = selectedVectorArt.sourceMeta?.style ?? 'trace_only'

    return (
      <div
        ref={toolbarRef}
        className={barClass}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <span className="vector-ctx-badge">
          <Sparkles size={13} />
          Art ({selectedVectorArt.layers.length})
        </span>

        {uniqueFills.length > 0 && (
          <div
            className="vector-palette-swatches"
            title="Click any swatch to swap that color across all matching layers"
          >
            {uniqueFills.map((fillColor) => (
              <label
                key={fillColor}
                className="vector-swatch-label"
                style={{ backgroundColor: fillColor }}
                title={`Swap color ${fillColor}`}
              >
                <input
                  type="color"
                  className="vector-swatch-input"
                  value={normalizeHexSwatch(fillColor, '#111111')}
                  onChange={(e) => onSwapArtColor(selectedVectorArt.id, fillColor, e.target.value)}
                />
              </label>
            ))}
          </div>
        )}

        <span className="vector-ctx-sep" />

        {canSwitchStyle && (
          <div className="vector-style-pills" role="group" aria-label="Vector style switcher">
            <button
              type="button"
              className={`vector-ctx-btn ${activeStyle === 'flat_vector' ? 'active' : ''}`}
              disabled={isBusy}
              onClick={() => onRerunArtStyle(selectedVectorArt.id, 'flat_vector')}
              title="Re-render as clean Flat Vector"
            >
              {isBusy ? <Loader2 size={12} className="spin-animate" /> : null}
              Flat
            </button>
            <button
              type="button"
              className={`vector-ctx-btn ${activeStyle === 'clean_line_art' ? 'active' : ''}`}
              disabled={isBusy}
              onClick={() => onRerunArtStyle(selectedVectorArt.id, 'clean_line_art')}
              title="Re-render as clean monochrome Line Art"
            >
              Line
            </button>
            <button
              type="button"
              className={`vector-ctx-btn ${activeStyle === 'trace_only' ? 'active' : ''}`}
              disabled={isBusy}
              onClick={() => onRerunArtStyle(selectedVectorArt.id, 'trace_only')}
              title="100% offline multi-color VTracer trace of original strokes"
            >
              Trace
            </button>
          </div>
        )}

        <span className="vector-ctx-sep" />

        <button
          type="button"
          className="vector-ctx-btn"
          onClick={() => onUngroupArt(selectedVectorArt.id)}
          title="Ungroup layers into individually movable vector shapes"
        >
          <Layers size={13} />
          Ungroup
        </button>

        {canSwitchStyle && (
          <button
            type="button"
            className="vector-ctx-btn revert"
            onClick={() => onRevertArtToSketch(selectedVectorArt.id)}
            title="Restore original hand-drawn strokes"
          >
            <RotateCcw size={13} />
            Revert
          </button>
        )}

        {!hasTopSelectionBar && (onDeleteSelected || onClearSelection) && (
          <>
            <span className="vector-ctx-sep" />
            {onDeleteSelected && (
              <button
                type="button"
                className="vector-ctx-icon-btn danger"
                onClick={onDeleteSelected}
                title="Delete selected (Delete / Backspace)"
              >
                <Trash2 size={13} />
              </button>
            )}
            {onClearSelection && (
              <button
                type="button"
                className="vector-ctx-icon-btn"
                onClick={onClearSelection}
                title="Deselect (Escape)"
              >
                <X size={13} />
              </button>
            )}
          </>
        )}
      </div>
    )
  }

  // 2. Compact Single-Row Floating Bar with Popover Dropdowns for Shapes & Connectors
  const selectedConnectors = selectedShapes.filter(isConnectorShape)
  const selectedNonConnectors = selectedShapes.filter((s) => !isConnectorShape(s))
  const firstShape = selectedNonConnectors[0] ?? selectedShapes[0]
  const firstConnector = selectedConnectors[0]
  const curRouting =
    firstConnector?.routing ??
    (firstConnector?.shape === 'curved-arrow' || firstConnector?.shape === 'curved-line'
      ? 'curved'
      : firstConnector?.shape === 'polyline' || firstConnector?.shape === 'elbow'
        ? 'orthogonal'
        : 'straight')
  const curArrowMode =
    firstConnector?.arrowStart && firstConnector?.arrowEnd !== false
      ? 'both'
      : firstConnector?.arrowEnd === false && !firstConnector?.arrowStart
        ? 'none'
        : 'end'
  const isFlowAnimated = Boolean(
    firstConnector?.animated || firstConnector?.shape.startsWith('anim-line-')
  )
  const isShapeAnimated = Boolean(
    firstShape?.animated || firstShape?.shape.startsWith('anim-line-')
  )
  const rawFill = firstShape?.fillColor ?? boardPalette?.shapeFill ?? '#FFE566'
  const isTransparent = rawFill === 'transparent' || rawFill === 'none'
  const customFillHex = normalizeHexSwatch(
    isTransparent ? boardPalette?.shapeFill : rawFill,
    '#ffe566'
  )
  const rawStroke = firstShape?.color ?? 'ink'
  const customStrokeHex = normalizeHexSwatch(
    rawStroke === 'ink' || rawStroke === 'accent'
      ? boardPalette?.shapeStroke ?? '#111111'
      : rawStroke,
    '#111111'
  )
  const rawLabelColor = firstShape?.labelColor ?? ''
  const isAutoLabelColor = !rawLabelColor || rawLabelColor === 'auto'
  const customLabelColorHex = normalizeHexSwatch(
    isAutoLabelColor || rawLabelColor === 'ink' || rawLabelColor === 'accent'
      ? (boardPalette?.shapeText ?? '#111111')
      : rawLabelColor,
    '#111111'
  )
  const curFont: FontId =
    firstShape?.fontFamily && firstShape.fontFamily in FONTS
      ? firstShape.fontFamily
      : 'jakarta'

  const curOpacity = firstShape?.fillOpacity ?? 1
  const opacityPct = Math.round(curOpacity * 100)
  const curWidth = firstShape?.strokeWidth ?? 2.5
  const curStyle = firstShape?.strokeStyle ?? 'solid'

  const graphDir = selectedDiagramMeta?.graph?.direction
  const isHorizontal = graphDir === 'RIGHT' || graphDir === 'LEFT'
  const canRevert = Boolean(
    selectedDiagramMeta &&
      (selectedDiagramMeta.originalStrokes?.length ||
        selectedDiagramMeta.originalShapes?.length ||
        selectedDiagramMeta.originalTexts?.length)
  )

  return (
    <div
      ref={toolbarRef}
      className={barClass}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {selectedDiagramMeta && (
        <>
          <span className="vector-ctx-badge">
            <Sparkles size={13} />
            {selectedDiagramMeta.spatialScene ? 'Spatial' : 'Diagram'}
          </span>

          {selectedDiagramMeta.graph && (
            <div className="vector-style-pills" role="group" aria-label="Diagram layout direction">
              <button
                type="button"
                className={`vector-ctx-btn ${isHorizontal ? 'active' : ''}`}
                disabled={isBusy}
                onClick={() => onToggleDiagramDirection(selectedDiagramMeta.groupId, 'RIGHT')}
                title="Re-layout Left-to-Right locally with ELK.js"
              >
                <ArrowRight size={12} />
                LR
              </button>
              <button
                type="button"
                className={`vector-ctx-btn ${!isHorizontal ? 'active' : ''}`}
                disabled={isBusy}
                onClick={() => onToggleDiagramDirection(selectedDiagramMeta.groupId, 'DOWN')}
                title="Re-layout Top-to-Bottom locally with ELK.js"
              >
                <ArrowDown size={12} />
                TB
              </button>
            </div>
          )}

          {onSyncAnimatedWaveFlow && (
            <button
              type="button"
              className="vector-ctx-btn active"
              onClick={onSyncAnimatedWaveFlow}
              title="Auto-synchronize topological wave stages & animate traveling signal pulses across connected diagram"
            >
              <Zap size={12} />
              Wave Flow
            </button>
          )}

          {canRevert && (
            <button
              type="button"
              className="vector-ctx-btn revert"
              onClick={() => onRevertDiagramToSketch(selectedDiagramMeta.groupId)}
              title="Restore original hand-drawn strokes"
            >
              <RotateCcw size={12} />
              Revert
            </button>
          )}

          {hasShapes && <span className="vector-ctx-sep" />}
        </>
      )}

      {hasShapes && onPatchSelectedShapes && (
        <>
          {canAutoLayoutShapes && !selectedDiagramMeta && onAutoLayoutShapes && (
            <>
              <div className="vector-style-pills" role="group" aria-label="Auto-layout connected shapes">
                <button
                  type="button"
                  className="vector-ctx-btn"
                  onClick={() => onAutoLayoutShapes('RIGHT')}
                  title="Auto-layout selected connected shapes Left-to-Right (ELK)"
                >
                  <ArrowRight size={12} />
                  LR
                </button>
                <button
                  type="button"
                  className="vector-ctx-btn"
                  onClick={() => onAutoLayoutShapes('DOWN')}
                  title="Auto-layout selected connected shapes Top-to-Bottom (ELK)"
                >
                  <ArrowDown size={12} />
                  TB
                </button>
              </div>
              {onSyncAnimatedWaveFlow && (
                <button
                  type="button"
                  className="vector-ctx-btn active"
                  onClick={onSyncAnimatedWaveFlow}
                  title="Synchronize topological wave stages & animate traveling signal pulses across connected shapes"
                >
                  <Zap size={12} />
                  Wave Flow
                </button>
              )}
              <span className="vector-ctx-sep" />
            </>
          )}

          {selectedConnectors.length > 0 && (
            <>
              <div className="vector-style-pills" role="group" aria-label="Connector routing">
                <button
                  type="button"
                  className={`vector-ctx-btn ${curRouting === 'orthogonal' ? 'active' : ''}`}
                  onClick={() => onPatchSelectedShapes({ routing: 'orthogonal' })}
                  title="Smoothstep orthogonal flow routing"
                >
                  Step
                </button>
                <button
                  type="button"
                  className={`vector-ctx-btn ${curRouting === 'curved' ? 'active' : ''}`}
                  onClick={() => onPatchSelectedShapes({ routing: 'curved' })}
                  title="Curved Bezier flow connector"
                >
                  Curve
                </button>
                <button
                  type="button"
                  className={`vector-ctx-btn ${curRouting === 'straight' ? 'active' : ''}`}
                  onClick={() => onPatchSelectedShapes({ routing: 'straight' })}
                  title="Straight arrow connector"
                >
                  Line
                </button>
              </div>
              <div className="vector-style-pills" role="group" aria-label="Connector arrowheads">
                <button
                  type="button"
                  className={`vector-ctx-btn ${curArrowMode === 'end' ? 'active' : ''}`}
                  onClick={() => onPatchSelectedShapes({ arrowStart: false, arrowEnd: true })}
                  title="Directed arrow (->)"
                >
                  →
                </button>
                <button
                  type="button"
                  className={`vector-ctx-btn ${curArrowMode === 'both' ? 'active' : ''}`}
                  onClick={() => onPatchSelectedShapes({ arrowStart: true, arrowEnd: true })}
                  title="Bidirectional arrow (<->)"
                >
                  ↔
                </button>
                <button
                  type="button"
                  className={`vector-ctx-btn ${curArrowMode === 'none' ? 'active' : ''}`}
                  onClick={() => onPatchSelectedShapes({ arrowStart: false, arrowEnd: false })}
                  title="Plain link (no arrowheads)"
                >
                  —
                </button>
              </div>
              <button
                type="button"
                className={`vector-ctx-btn ${isFlowAnimated ? 'active' : ''}`}
                onClick={() =>
                  onPatchSelectedShapes({
                    animated: !isFlowAnimated,
                    ...(isFlowAnimated ? {} : { animationMode: firstConnector?.animationMode ?? 'pulse' })
                  })
                }
                title="Toggle animated signal pulse flow"
              >
                <Zap size={12} />
                <span>Flow</span>
              </button>
              {isFlowAnimated && (
                <>
                  <div className="vector-style-pills" role="group" aria-label="Connector animation style">
                    <button
                      type="button"
                      className={`vector-ctx-btn ${(firstConnector?.animationMode ?? 'pulse') !== 'dash' ? 'active' : ''}`}
                      onClick={() => onPatchSelectedShapes({ animated: true, animationMode: 'pulse' })}
                      title="Traveling glowing signal packet orb along wire"
                    >
                      Pulse
                    </button>
                    <button
                      type="button"
                      className={`vector-ctx-btn ${firstConnector?.animationMode === 'dash' ? 'active' : ''}`}
                      onClick={() => onPatchSelectedShapes({ animated: true, animationMode: 'dash' })}
                      title="Marching dashed line flow"
                    >
                      Dash
                    </button>
                  </div>
                  <label
                    className="shape-color-picker-btn"
                    title="Pick signal pulse orb color"
                  >
                    <span
                      className="shape-color-picker-preview"
                      style={{
                        backgroundColor: normalizeHexSwatch(
                          firstConnector?.pulseColor,
                          '#3b82f6'
                        )
                      }}
                    />
                    <input
                      type="color"
                      className="vector-swatch-input"
                      value={normalizeHexSwatch(firstConnector?.pulseColor, '#3b82f6')}
                      onChange={(e) =>
                        onPatchSelectedShapes(
                          { pulseColor: e.target.value, animated: true },
                          { coalesceHistory: true }
                        )
                      }
                    />
                  </label>
                </>
              )}
              <span className="vector-ctx-sep" />
            </>
          )}

          {/* 1. Compact Fill Popover Trigger */}
          {selectedNonConnectors.length > 0 && (
            <div className="shape-menu-anchor">
              <button
                type="button"
                className={`vector-ctx-btn shape-dropdown-trigger ${openMenu === 'fill' ? 'active' : ''}`}
                onClick={() => setOpenMenu((m) => (m === 'fill' ? null : 'fill'))}
                title="Shape fill color & opacity"
              >
                <span
                  className={`shape-trigger-dot ${isTransparent ? 'is-none' : ''}`}
                  style={isTransparent ? undefined : { backgroundColor: customFillHex }}
                />
                <span>Fill</span>
                {!isTransparent && opacityPct < 100 && (
                  <span className="shape-trigger-meta">{opacityPct}%</span>
                )}
                <ChevronDown size={11} />
              </button>

              {openMenu === 'fill' && (
                <div className="shape-style-popover">
                  <div className="shape-popover-row">
                    <span className="shape-popover-label">Color</span>
                    <button
                      type="button"
                      className={`shape-swatch-btn shape-swatch-none ${isTransparent ? 'active' : ''}`}
                      onClick={() => onPatchSelectedShapes({ fillColor: 'transparent' })}
                      title="No Fill (Transparent)"
                    >
                      <Ban size={11} />
                    </button>
                    {SHAPE_FILL_SWATCHES.map((hex) => (
                      <button
                        key={hex}
                        type="button"
                        className={`shape-swatch-btn ${!isTransparent && rawFill.toLowerCase() === hex.toLowerCase() ? 'active' : ''}`}
                        style={{ backgroundColor: hex }}
                        onClick={() =>
                          onPatchSelectedShapes({
                            fillColor: hex,
                            ...(curOpacity <= 0 ? { fillOpacity: 1 } : {})
                          })
                        }
                        title={`Fill ${hex}`}
                      />
                    ))}
                    <label
                      className="shape-color-picker-btn"
                      title="Pick ANY custom fill color"
                    >
                      <Palette size={12} />
                      <span
                        className="shape-color-picker-preview"
                        style={{ backgroundColor: isTransparent ? 'transparent' : customFillHex }}
                      />
                      <input
                        type="color"
                        className="vector-swatch-input"
                        value={customFillHex}
                        onChange={(e) =>
                          onPatchSelectedShapes(
                            {
                              fillColor: e.target.value,
                              ...(curOpacity <= 0 ? { fillOpacity: 1 } : {})
                            },
                            { coalesceHistory: true }
                          )
                        }
                      />
                    </label>
                  </div>
                  <div className="shape-popover-row">
                    <span className="shape-popover-label">Alpha</span>
                    <div className="vector-style-pills">
                      {[
                        { label: '100%', val: 1 },
                        { label: '65%', val: 0.65 },
                        { label: '30%', val: 0.3 }
                      ].map((op) => (
                        <button
                          key={op.label}
                          type="button"
                          disabled={isTransparent}
                          className={`vector-ctx-btn ${Math.abs(curOpacity - op.val) < 0.08 ? 'active' : ''}`}
                          onClick={() => onPatchSelectedShapes({ fillOpacity: op.val })}
                        >
                          {op.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 2. Compact Border Popover Trigger */}
          <div className="shape-menu-anchor">
            <button
              type="button"
              className={`vector-ctx-btn shape-dropdown-trigger ${openMenu === 'border' ? 'active' : ''}`}
              onClick={() => setOpenMenu((m) => (m === 'border' ? null : 'border'))}
              title="Border color, thickness & line style"
            >
              <span
                className="shape-trigger-dot is-ring"
                style={{ borderColor: customStrokeHex }}
              />
              <span>Border</span>
              <span className="shape-trigger-meta">{Math.round(curWidth * 10) / 10}px</span>
              <ChevronDown size={11} />
            </button>

            {openMenu === 'border' && (
              <div className="shape-style-popover">
                <div className="shape-popover-row">
                  <span className="shape-popover-label">Color</span>
                  {SHAPE_STROKE_SWATCHES.map((sw) => {
                    const bg =
                      sw.value === 'ink'
                        ? (boardPalette?.shapeStroke ?? '#111111')
                        : sw.value
                    const active = rawStroke.toLowerCase() === sw.value.toLowerCase()
                    return (
                      <button
                        key={sw.value}
                        type="button"
                        className={`shape-swatch-btn ${active ? 'active' : ''}`}
                        style={{ backgroundColor: bg }}
                        onClick={() => onPatchSelectedShapes({ color: sw.value })}
                        title={sw.label}
                      />
                    )
                  })}
                  <label
                    className="shape-color-picker-btn"
                    title="Pick ANY custom border color"
                  >
                    <PenTool size={11} />
                    <span
                      className="shape-color-picker-preview"
                      style={{ backgroundColor: customStrokeHex }}
                    />
                    <input
                      type="color"
                      className="vector-swatch-input"
                      value={customStrokeHex}
                      onChange={(e) =>
                        onPatchSelectedShapes({ color: e.target.value }, { coalesceHistory: true })
                      }
                    />
                  </label>
                </div>
                <div className="shape-popover-row">
                  <span className="shape-popover-label">Width</span>
                  <div className="vector-style-pills">
                    {[2, 3, 5].map((w) => (
                      <button
                        key={w}
                        type="button"
                        className={`vector-ctx-btn ${Math.abs(curWidth - w) < 0.6 ? 'active' : ''}`}
                        onClick={() => onPatchSelectedShapes({ strokeWidth: w })}
                      >
                        {w}px
                      </button>
                    ))}
                  </div>
                  <div className="vector-style-pills">
                    {(['solid', 'dashed', 'dotted'] as const).map((st) => (
                      <button
                        key={st}
                        type="button"
                        className={`vector-ctx-btn ${curStyle === st ? 'active' : ''}`}
                        onClick={() => onPatchSelectedShapes({ strokeStyle: st })}
                      >
                        {st}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 3. Compact Text (Font & Label Color) Popover Trigger */}
          <div className="shape-menu-anchor">
            <button
              type="button"
              className={`vector-ctx-btn shape-dropdown-trigger ${openMenu === 'text' ? 'active' : ''}`}
              onClick={() => setOpenMenu((m) => (m === 'text' ? null : 'text'))}
              title="Shape text font family & color"
            >
              <Type size={12} />
              <span>{FONTS[curFont].shortLabel}</span>
              <span
                className="shape-trigger-dot"
                style={{ backgroundColor: customLabelColorHex }}
              />
              <ChevronDown size={11} />
            </button>

            {openMenu === 'text' && (
              <div className="shape-style-popover">
                <div className="shape-popover-row">
                  <span className="shape-popover-label">Font</span>
                  <div className="vector-style-pills">
                    {FONT_ORDER.map((fid) => (
                      <button
                        key={fid}
                        type="button"
                        className={`vector-ctx-btn ${curFont === fid ? 'active' : ''}`}
                        style={{ fontFamily: FONTS[fid].css }}
                        onClick={() => onPatchSelectedShapes({ fontFamily: fid })}
                        title={FONTS[fid].label}
                      >
                        {FONTS[fid].shortLabel}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="shape-popover-row">
                  <span className="shape-popover-label">Color</span>
                  <button
                    type="button"
                    className={`vector-ctx-btn ${isAutoLabelColor ? 'active' : ''}`}
                    onClick={() => onPatchSelectedShapes({ labelColor: undefined })}
                    title="Auto contrast text color against fill"
                  >
                    Auto
                  </button>
                  {SHAPE_LABEL_COLOR_SWATCHES.map((sw) => {
                    const active =
                      !isAutoLabelColor && rawLabelColor.toLowerCase() === sw.value.toLowerCase()
                    return (
                      <button
                        key={sw.value}
                        type="button"
                        className={`shape-swatch-btn ${active ? 'active' : ''}`}
                        style={{ backgroundColor: sw.value }}
                        onClick={() => onPatchSelectedShapes({ labelColor: sw.value })}
                        title={sw.label}
                      />
                    )
                  })}
                  <label
                    className="shape-color-picker-btn"
                    title="Pick ANY custom color for shape text / label"
                  >
                    <Type size={11} />
                    <span
                      className="shape-color-picker-preview"
                      style={{ backgroundColor: customLabelColorHex }}
                    />
                    <input
                      type="color"
                      className="vector-swatch-input"
                      value={customLabelColorHex}
                      onChange={(e) =>
                        onPatchSelectedShapes(
                          { labelColor: e.target.value },
                          { coalesceHistory: true }
                        )
                      }
                    />
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* 4. Quick 1-Click Actions: Animate & Edit Label */}
          {selectedNonConnectors.length > 0 && (
            <button
              type="button"
              className={`vector-ctx-btn ${isShapeAnimated ? 'active' : ''}`}
              onClick={() => onPatchSelectedShapes({ animated: !isShapeAnimated })}
              title="Toggle animated flowing border on shape"
            >
              <Zap size={12} />
            </button>
          )}

          {selectedShapes.length === 1 && onEditShapeLabel && (
            <button
              type="button"
              className="vector-ctx-btn"
              onClick={() => {
                setOpenMenu(null)
                onEditShapeLabel(firstShape.id)
              }}
              title="Edit shape text label (or double-click shape)"
            >
              <Type size={12} />
              <span>Edit</span>
            </button>
          )}

          {!hasTopSelectionBar && (onDeleteSelected || onClearSelection) && (
            <>
              <span className="vector-ctx-sep" />
              {onDeleteSelected && (
                <button
                  type="button"
                  className="vector-ctx-icon-btn danger"
                  onClick={onDeleteSelected}
                  title="Delete selected (Delete / Backspace)"
                >
                  <Trash2 size={13} />
                </button>
              )}
              {onClearSelection && (
                <button
                  type="button"
                  className="vector-ctx-icon-btn"
                  onClick={onClearSelection}
                  title="Deselect (Escape)"
                >
                  <X size={13} />
                </button>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
})
