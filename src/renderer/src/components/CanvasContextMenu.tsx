import React, { memo, useEffect, useRef } from 'react'
import {
  Ban,
  Bot,
  BoxSelect,
  ClipboardPaste,
  Code2,
  Copy,
  Crop,
  FilePlus2,
  Focus,
  ImagePlus,
  Layers,
  LineChart,
  Palette,
  PenTool,
  RotateCcw,
  RotateCw,
  Sigma,
  Sparkles,
  Trash2,
  Type,
  Wand2,
  Workflow,
  X,
  Zap
} from 'lucide-react'
import { FONTS, FONT_ORDER } from '../themes'
import type { FontId } from '../types/board'

const CTX_FILL_SWATCHES = [
  '#FFFFFF',
  '#FFE566',
  '#7BF1A8',
  '#67E8F9',
  '#C4B5FD',
  '#FDA4AF'
]

const CTX_TEXT_SWATCHES = [
  '#111111',
  '#FFFFFF',
  '#EF4444',
  '#2563EB',
  '#10B981',
  '#8B5CF6'
]

function normalizeColorHex(c: string | undefined, fallback: string): string {
  const s = (c ?? '').trim()
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase()
  if (/^#[0-9a-f]{3}$/i.test(s)) {
    return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`.toLowerCase()
  }
  return fallback
}

export interface CanvasContextMenuProps {
  x: number
  y: number
  worldX: number
  worldY: number
  selectedCount: number
  hasSelectedStrokes: boolean
  hasTextOrShapeSelected: boolean
  hasShapeSelected?: boolean
  currentShapeFill?: string
  currentShapeStroke?: string
  currentShapeLabelColor?: string
  hasLayerableSelected: boolean
  isAiConfigured: boolean
  currentFont: FontId
  onClose: () => void
  onBeautify: () => void
  onVectorize: () => void
  onTraceOriginal: () => void
  onAIAnnotate: () => void
  onSendToAntigravity?: () => void
  onRotateSelection?: (deltaDeg: number, reset?: boolean) => void
  onOpenGraphBuilder?: () => void
  onApplyFont: (font: FontId) => void
  onShapeFillChange?: (fill: string, opts?: { coalesceHistory?: boolean }) => void
  onShapeStrokeChange?: (stroke: string, opts?: { coalesceHistory?: boolean }) => void
  onShapeLabelColorChange?: (
    color: string | undefined,
    opts?: { coalesceHistory?: boolean }
  ) => void
  onMoveToLayer: (layerId: string) => void
  onDuplicate: () => void
  onDelete: () => void
  onSelectAll: () => void
  onClearSelection: () => void
  onAddTextAt: (worldX: number, worldY: number) => void
  onAddEquationAt: (worldX: number, worldY: number) => void
  onAddCodeAt: () => void
  onPasteImageAt?: (worldX: number, worldY: number) => void
  onUploadImageAt?: (worldX: number, worldY: number) => void
  onSnipBoardRegion?: () => void
  onAddFlowDiagram?: () => void
  onAddAnimatedArchitecture?: () => void
  onSyncAnimatedWaveFlow?: () => void
  onFitView: () => void
  onResetView: () => void
  onToggleLayers: () => void
}

export const CanvasContextMenu = memo(function CanvasContextMenu(
  props: CanvasContextMenuProps
): React.JSX.Element {
  const {
    x,
    y,
    worldX,
    worldY,
    selectedCount,
    hasTextOrShapeSelected,
    hasShapeSelected,
    currentShapeFill,
    currentShapeStroke,
    currentShapeLabelColor,
    hasLayerableSelected,
    isAiConfigured,
    currentFont,
    onClose,
    onVectorize,
    onAIAnnotate,
    onSendToAntigravity,
    onRotateSelection,
    onOpenGraphBuilder,
    onApplyFont,
    onShapeFillChange,
    onShapeStrokeChange,
    onShapeLabelColorChange,
    onMoveToLayer,
    onDuplicate,
    onDelete,
    onSelectAll,
    onClearSelection,
    onAddTextAt,
    onAddEquationAt,
    onAddCodeAt,
    onPasteImageAt,
    onUploadImageAt,
    onSnipBoardRegion,
    onAddFlowDiagram,
    onAddAnimatedArchitecture,
    onSyncAnimatedWaveFlow,
    onFitView,
    onResetView,
    onToggleLayers
  } = props

  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: PointerEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const winW = typeof window !== 'undefined' ? window.innerWidth : 1280
  const winH = typeof window !== 'undefined' ? window.innerHeight : 800
  const menuW = 248
  const estH = selectedCount > 0 ? (hasShapeSelected ? 470 : 370) : 324
  const left = Math.max(12, Math.min(winW - menuW - 12, x))
  const top = Math.max(52, Math.min(winH - estH - 12, y))

  const runAndClose = (fn: () => void): void => {
    onClose()
    fn()
  }

  return (
    <div
      ref={menuRef}
      className="canvas-context-menu"
      style={{ left: `${left}px`, top: `${top}px` }}
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      role="menu"
    >
      {selectedCount > 0 ? (
        <>
          <div className="ctx-menu-header">
            <BoxSelect size={12} />
            <span>
              {selectedCount} element{selectedCount > 1 ? 's' : ''} selected
            </span>
          </div>

          <button
            type="button"
            className="ctx-menu-item accent-mint"
            onClick={() => runAndClose(onVectorize)}
          >
            <Wand2 size={13} />
            <span>Vectorize / Beautify</span>
            <kbd>Ctrl+B</kbd>
          </button>

          {onSendToAntigravity && (
            <button
              type="button"
              className="ctx-menu-item accent-yellow"
              onClick={() => runAndClose(onSendToAntigravity)}
            >
              <Sparkles size={13} />
              <span>Send Selection to Antigravity</span>
            </button>
          )}

          {onRotateSelection && (
            <>
              <button
                type="button"
                className="ctx-menu-item"
                onClick={() => runAndClose(() => onRotateSelection(-90))}
              >
                <RotateCcw size={13} />
                <span>Rotate 90° Left</span>
              </button>
              <button
                type="button"
                className="ctx-menu-item"
                onClick={() => runAndClose(() => onRotateSelection(90))}
              >
                <RotateCw size={13} />
                <span>Rotate 90° Right</span>
              </button>
            </>
          )}

          {isAiConfigured && (
            <button
              type="button"
              className="ctx-menu-item accent-yellow"
              onClick={() => runAndClose(onAIAnnotate)}
            >
              <Bot size={13} />
              <span>AI Annotate Overlay</span>
            </button>
          )}

          {hasShapeSelected && onSyncAnimatedWaveFlow && (
            <button
              type="button"
              className="ctx-menu-item accent-mint"
              onClick={() => runAndClose(onSyncAnimatedWaveFlow)}
            >
              <Zap size={13} />
              <span>Animate Wave Signal Flow</span>
            </button>
          )}

          {hasShapeSelected && onShapeFillChange && (
            <>
              <div className="ctx-menu-divider" />
              <div className="ctx-menu-section-label">Shape Fill &amp; Border</div>
              <div className="ctx-menu-color-row">
                <button
                  type="button"
                  className={`shape-swatch-btn shape-swatch-none ${
                    currentShapeFill === 'transparent' || currentShapeFill === 'none' ? 'active' : ''
                  }`}
                  onClick={() => onShapeFillChange('transparent')}
                  title="No Fill (Transparent)"
                >
                  <Ban size={10} />
                </button>
                {CTX_FILL_SWATCHES.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    className={`shape-swatch-btn ${
                      currentShapeFill?.toLowerCase() === hex.toLowerCase() ? 'active' : ''
                    }`}
                    style={{ backgroundColor: hex }}
                    onClick={() => onShapeFillChange(hex)}
                    title={`Fill ${hex}`}
                  />
                ))}
                <label className="shape-color-picker-btn compact" title="Custom Fill Color">
                  <Palette size={11} />
                  <input
                    type="color"
                    className="vector-swatch-input"
                    value={normalizeColorHex(currentShapeFill, '#ffe566')}
                    onChange={(e) => onShapeFillChange(e.target.value, { coalesceHistory: true })}
                  />
                </label>
                {onShapeStrokeChange && (
                  <label className="shape-color-picker-btn compact" title="Custom Border Color">
                    <PenTool size={11} />
                    <input
                      type="color"
                      className="vector-swatch-input"
                      value={normalizeColorHex(currentShapeStroke, '#111111')}
                      onChange={(e) =>
                        onShapeStrokeChange(e.target.value, { coalesceHistory: true })
                      }
                    />
                  </label>
                )}
              </div>
            </>
          )}

          {hasTextOrShapeSelected && (
            <>
              <div className="ctx-menu-divider" />
              <div className="ctx-menu-section-label">Font &amp; Text Color</div>
              <div className="ctx-menu-font-row">
                {FONT_ORDER.map((fid) => (
                  <button
                    key={fid}
                    type="button"
                    className={`ctx-menu-font-chip ${currentFont === fid ? 'active' : ''}`}
                    style={{ fontFamily: FONTS[fid].css }}
                    onClick={() => onApplyFont(fid)}
                    title={FONTS[fid].label}
                  >
                    {FONTS[fid].shortLabel}
                  </button>
                ))}
              </div>
              {hasShapeSelected && onShapeLabelColorChange && (
                <div className="ctx-menu-color-row" style={{ marginTop: 6 }}>
                  <button
                    type="button"
                    className={`ctx-menu-font-chip ${
                      !currentShapeLabelColor || currentShapeLabelColor === 'auto' ? 'active' : ''
                    }`}
                    onClick={() => onShapeLabelColorChange(undefined)}
                    title="Auto-contrast text color"
                  >
                    Auto
                  </button>
                  {CTX_TEXT_SWATCHES.map((hex) => (
                    <button
                      key={`txt-${hex}`}
                      type="button"
                      className={`shape-swatch-btn ${
                        currentShapeLabelColor?.toLowerCase() === hex.toLowerCase() ? 'active' : ''
                      }`}
                      style={{ backgroundColor: hex }}
                      onClick={() => onShapeLabelColorChange(hex)}
                      title={`Text Color ${hex}`}
                    />
                  ))}
                  <label className="shape-color-picker-btn compact" title="Custom Text Color">
                    <Type size={11} />
                    <input
                      type="color"
                      className="vector-swatch-input"
                      value={normalizeColorHex(currentShapeLabelColor, '#111111')}
                      onChange={(e) =>
                        onShapeLabelColorChange(e.target.value, { coalesceHistory: true })
                      }
                    />
                  </label>
                </div>
              )}
            </>
          )}

          {hasLayerableSelected && (
            <>
              <div className="ctx-menu-divider" />
              <button
                type="button"
                className="ctx-menu-item"
                onClick={() => runAndClose(() => onMoveToLayer('layer-overlay-ink'))}
              >
                <Layers size={13} />
                <span>Send to Top Ink Layer</span>
              </button>
              <button
                type="button"
                className="ctx-menu-item"
                onClick={() => runAndClose(() => onMoveToLayer('layer-base-ink'))}
              >
                <Layers size={13} />
                <span>Send to Base Ink Layer</span>
              </button>
            </>
          )}

          <div className="ctx-menu-divider" />

          <button
            type="button"
            className="ctx-menu-item"
            onClick={() => runAndClose(onDuplicate)}
          >
            <Copy size={13} />
            <span>Duplicate</span>
            <kbd>Ctrl+D</kbd>
          </button>

          <button
            type="button"
            className="ctx-menu-item"
            onClick={() => runAndClose(onSelectAll)}
          >
            <BoxSelect size={13} />
            <span>Select All</span>
            <kbd>Ctrl+A</kbd>
          </button>

          <button
            type="button"
            className="ctx-menu-item"
            onClick={() => runAndClose(onClearSelection)}
          >
            <X size={13} />
            <span>Deselect</span>
            <kbd>Esc</kbd>
          </button>

          <div className="ctx-menu-divider" />

          <button
            type="button"
            className="ctx-menu-item danger"
            onClick={() => runAndClose(onDelete)}
          >
            <Trash2 size={13} />
            <span>Delete Selected</span>
            <kbd>Del</kbd>
          </button>
        </>
      ) : (
        <>
          <div className="ctx-menu-header">
            <span>Canvas Actions</span>
          </div>

          {onPasteImageAt && (
            <button
              type="button"
              className="ctx-menu-item accent-mint"
              onClick={() => runAndClose(() => onPasteImageAt(worldX, worldY))}
            >
              <ClipboardPaste size={13} />
              <span>Paste Snippet / Image Here</span>
              <kbd>Ctrl+V</kbd>
            </button>
          )}

          {onUploadImageAt && (
            <button
              type="button"
              className="ctx-menu-item"
              onClick={() => runAndClose(() => onUploadImageAt(worldX, worldY))}
            >
              <ImagePlus size={13} />
              <span>Insert Image File Here...</span>
            </button>
          )}

          {onSnipBoardRegion && (
            <button
              type="button"
              className="ctx-menu-item"
              onClick={() => runAndClose(onSnipBoardRegion)}
            >
              <Crop size={13} />
              <span>Snip Board Region</span>
            </button>
          )}

          <button
            type="button"
            className="ctx-menu-item"
            onClick={() => runAndClose(() => onAddTextAt(worldX, worldY))}
          >
            <FilePlus2 size={13} />
            <span>Add Text Note Here</span>
          </button>

          <button
            type="button"
            className="ctx-menu-item"
            onClick={() => runAndClose(() => onAddEquationAt(worldX, worldY))}
          >
            <Sigma size={13} />
            <span>Add Equation Here</span>
          </button>

          {onOpenGraphBuilder && (
            <button
              type="button"
              className="ctx-menu-item accent-mint"
              onClick={() => runAndClose(onOpenGraphBuilder)}
            >
              <LineChart size={13} />
              <span>Draw Graph / Function Plot...</span>
            </button>
          )}

          <button
            type="button"
            className="ctx-menu-item"
            onClick={() => runAndClose(onAddCodeAt)}
          >
            <Code2 size={13} />
            <span>Add Code Container</span>
          </button>

          {onAddFlowDiagram && (
            <button
              type="button"
              className="ctx-menu-item"
              onClick={() => runAndClose(onAddFlowDiagram)}
            >
              <Workflow size={13} />
              <span>Add Flow Diagram</span>
            </button>
          )}

          {onAddAnimatedArchitecture && (
            <button
              type="button"
              className="ctx-menu-item accent-mint"
              onClick={() => runAndClose(onAddAnimatedArchitecture)}
            >
              <Zap size={13} />
              <span>Add Animated Architecture (Transformer vs MoE)</span>
            </button>
          )}

          <div className="ctx-menu-divider" />
          <div className="ctx-menu-section-label">Board Font</div>
          <div className="ctx-menu-font-row">
            {FONT_ORDER.map((fid) => (
              <button
                key={fid}
                type="button"
                className={`ctx-menu-font-chip ${currentFont === fid ? 'active' : ''}`}
                style={{ fontFamily: FONTS[fid].css }}
                onClick={() => onApplyFont(fid)}
                title={FONTS[fid].label}
              >
                {FONTS[fid].shortLabel}
              </button>
            ))}
          </div>

          <div className="ctx-menu-divider" />

          <button
            type="button"
            className="ctx-menu-item"
            onClick={() => runAndClose(onSelectAll)}
          >
            <BoxSelect size={13} />
            <span>Select All</span>
            <kbd>Ctrl+A</kbd>
          </button>

          <button
            type="button"
            className="ctx-menu-item"
            onClick={() => runAndClose(onFitView)}
          >
            <Focus size={13} />
            <span>Fit All Content</span>
            <kbd>Shift+1</kbd>
          </button>

          <button
            type="button"
            className="ctx-menu-item"
            onClick={() => runAndClose(onResetView)}
          >
            <RotateCcw size={13} />
            <span>Reset View (100%)</span>
            <kbd>Ctrl+0</kbd>
          </button>

          <button
            type="button"
            className="ctx-menu-item"
            onClick={() => runAndClose(onToggleLayers)}
          >
            <Layers size={13} />
            <span>Toggle Layers Panel</span>
            <kbd>L</kbd>
          </button>
        </>
      )}
    </div>
  )
})
