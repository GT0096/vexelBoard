import React, { useEffect, useRef, useState } from 'react'
import {
  MousePointer2,
  Hand,
  Focus,
  Pen,
  Type,
  Sigma,
  Eraser,
  Undo2,
  Redo2,
  Trash2,
  Settings2,
  ChevronDown,
  BoxSelect,
  Sparkles,
  Palette,
  Check,
  Square,
  Grid2x2,
  Grid3x3,
  Pipette
} from 'lucide-react'
import type {
  BackgroundPattern,
  EraserMode,
  FontId,
  PenType,
  ToolType,
  WritingPadDetection
} from '../types/board'
import { FONTS, FONT_ORDER } from '../themes'
import {
  BACKGROUND_PRESETS,
  hasReadableContrast,
  isLightColor,
  normalizeHex,
  resolveBoardPalette,
  type BoardPalette
} from '../board/backgroundPresets'
import { PenControls } from './PenControls'

interface ToolbarProps {
  activeTool: ToolType
  onSelectTool: (tool: ToolType) => void
  writingPadDetection: WritingPadDetection
  onSelectDetection: (det: WritingPadDetection) => void
  canUndo: boolean
  onUndo: () => void
  canRedo: boolean
  onRedo: () => void
  onClear: () => void
  onOpenSettings: () => void
  zoom: number
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomReset: () => void
  onFitView?: () => void
  penColor: string
  onPenColor: (c: string) => void
  penSize: number
  onPenSize: (s: number) => void
  penType: PenType
  onPenType: (t: PenType) => void
  eraserSize: number
  onEraserSize: (size: number) => void
  eraserMode: EraserMode
  onEraserMode: (mode: EraserMode) => void
  themeInk: string
  themeAccent: string
  backgroundColor: string
  onSelectBackgroundColor: (color: string) => void
  backgroundPattern: BackgroundPattern
  onSelectBackgroundPattern: (pattern: BackgroundPattern) => void
  onBeautify?: () => void
  isBeautifying?: boolean
  onVectorize?: () => void
  isVectorizing?: boolean
  vectorFont?: FontId
  onVectorFontChange?: (font: FontId) => void
  isAiConfigured?: boolean
  hasSelection?: boolean
  boardPalette?: BoardPalette
}

export const Toolbar = React.memo(function Toolbar(p: ToolbarProps): React.JSX.Element {
  const [padDetectionMenuOpen, setPadDetectionMenuOpen] = useState(false)
  const [eraserMenuOpen, setEraserMenuOpen] = useState(false)
  const [bgMenuOpen, setBgMenuOpen] = useState(false)
  const [fontMenuOpen, setFontMenuOpen] = useState(false)
  const padPopRef = useRef<HTMLDivElement>(null)
  const eraserPopRef = useRef<HTMLDivElement>(null)
  const bgPopRef = useRef<HTMLDivElement>(null)
  const fontPopRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const close = (e: PointerEvent): void => {
      if (padPopRef.current && !padPopRef.current.contains(e.target as Node)) {
        setPadDetectionMenuOpen(false)
      }
      if (eraserPopRef.current && !eraserPopRef.current.contains(e.target as Node)) {
        setEraserMenuOpen(false)
      }
      if (bgPopRef.current && !bgPopRef.current.contains(e.target as Node)) {
        setBgMenuOpen(false)
      }
      if (fontPopRef.current && !fontPopRef.current.contains(e.target as Node)) {
        setFontMenuOpen(false)
      }
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [])

  return (
    <nav className="dock glass" id="main-toolbar" aria-label="Board tools">
      {/* 1. Primary Canvas Tools */}
      <div className="segmented">
        <button
          className={p.activeTool === 'select' ? 'active' : ''}
          onClick={() => p.onSelectTool('select')}
          title="Select & Move (V)"
        >
          <MousePointer2 size={16} />
          <span>Select</span>
        </button>

        <button
          className={p.activeTool === 'pan' ? 'active' : ''}
          onClick={() => p.onSelectTool('pan')}
          title="Hand / Pan Canvas (H or hold Space)"
        >
          <Hand size={16} />
          <span>Pan</span>
        </button>

        {/* Writing Pad / Pen with detection selector */}
        <div className="dropdown-parent-wrap" ref={padPopRef}>
          <button
            className={`tool-combo-btn ${p.activeTool === 'pen' ? 'active' : ''}`}
            onClick={() => p.onSelectTool('pen')}
            title={`Writing Pad / Pen (P) — Recognition: ${p.writingPadDetection.toUpperCase()}`}
          >
            <Pen size={16} />
            <span>
              {p.writingPadDetection === 'none'
                ? 'Pen'
                : `Pen·${p.writingPadDetection === 'text' ? 'Text' : 'Math'}`}
            </span>
            <span
              className="combo-arrow"
              onClick={(e) => {
                e.stopPropagation()
                setPadDetectionMenuOpen(!padDetectionMenuOpen)
              }}
            >
              <ChevronDown size={12} />
            </span>
          </button>

          {padDetectionMenuOpen && (
            <div className="toolbar-popover-menu pad-detection-menu">
              <div className="popover-heading">Pen Style, Color &amp; Thickness</div>
              <PenControls
                penColor={p.penColor}
                onPenColor={p.onPenColor}
                penSize={p.penSize}
                onPenSize={p.onPenSize}
                penType={p.penType}
                onPenType={p.onPenType}
                themeInk={p.themeInk}
                themeAccent={p.themeAccent}
                boardPalette={p.boardPalette}
                onActivatePen={() => p.onSelectTool('pen')}
              />
              <div className="popover-heading">Writing Pad Recognition</div>
              <button
                className={p.writingPadDetection === 'none' ? 'active' : ''}
                onClick={() => {
                  p.onSelectDetection('none')
                  p.onSelectTool('pen')
                  setPadDetectionMenuOpen(false)
                }}
              >
                <span>Freehand Ink (Pure Drawing)</span>
              </button>
              <button
                className={p.writingPadDetection === 'text' ? 'active' : ''}
                disabled={p.isAiConfigured === false}
                title={
                  p.isAiConfigured === false
                    ? 'Configure AI Settings to enable Text OCR'
                    : 'Convert handwriting to typed text'
                }
                onClick={() => {
                  if (p.isAiConfigured === false) return
                  p.onSelectDetection('text')
                  p.onSelectTool('pen')
                  setPadDetectionMenuOpen(false)
                }}
              >
                <Type size={13} className="text-accent" />
                <span>
                  Text OCR (Handwriting to Typed Text)
                  {p.isAiConfigured === false ? ' · AI Required' : ''}
                </span>
              </button>
              <button
                className={p.writingPadDetection === 'equation' ? 'active' : ''}
                disabled={p.isAiConfigured === false}
                title={
                  p.isAiConfigured === false
                    ? 'Configure AI Settings to enable Equation OCR'
                    : 'Convert handwriting to LaTeX equation'
                }
                onClick={() => {
                  if (p.isAiConfigured === false) return
                  p.onSelectDetection('equation')
                  p.onSelectTool('pen')
                  setPadDetectionMenuOpen(false)
                }}
              >
                <Sigma size={13} className="text-accent" />
                <span>
                  Equation OCR (Handwriting to LaTeX Formula)
                  {p.isAiConfigured === false ? ' · AI Required' : ''}
                </span>
              </button>
            </div>
          )}
        </div>

        {/* Text Note */}
        <button
          className={p.activeTool === 'text' ? 'active' : ''}
          onClick={() => p.onSelectTool('text')}
          title="Insert Text Note (T)"
        >
          <Type size={16} />
          <span>Text</span>
        </button>

        {/* Decoupled Board Typography Picker (Notes, Text, Shapes & Vectors) */}
        {p.onVectorFontChange && (
          <div className="dropdown-parent-wrap" ref={fontPopRef}>
            <button
              type="button"
              className={`tool-combo-btn tool-font-btn ${fontMenuOpen ? 'active' : ''}`}
              onClick={(e) => {
                e.stopPropagation()
                setFontMenuOpen((o) => !o)
                setBgMenuOpen(false)
                setPadDetectionMenuOpen(false)
                setEraserMenuOpen(false)
              }}
              title={`Board Typography: ${FONTS[p.vectorFont ?? 'jakarta'].label} (Applies to Text Areas, Notes, Shapes & Vectors)`}
              style={{ fontFamily: FONTS[p.vectorFont ?? 'jakarta'].css }}
            >
              <span className="font-btn-aa" style={{ fontFamily: FONTS[p.vectorFont ?? 'jakarta'].css }}>
                Aa
              </span>
              <span>{FONTS[p.vectorFont ?? 'jakarta'].shortLabel}</span>
              <span className="combo-arrow">
                <ChevronDown size={12} />
              </span>
            </button>

            {fontMenuOpen && (
              <div className="vector-font-popover" onPointerDown={(e) => e.stopPropagation()}>
                <div className="vector-font-popover-title">Board Font</div>
                <div className="vector-font-popover-sub">Notes, Text Areas, Shapes & Vectors</div>
                {FONT_ORDER.map((fid) => {
                  const meta = FONTS[fid]
                  const active = (p.vectorFont ?? 'jakarta') === fid
                  return (
                    <button
                      key={fid}
                      type="button"
                      className={`vector-font-option ${active ? 'active' : ''}`}
                      onClick={() => {
                        p.onVectorFontChange?.(fid)
                        setFontMenuOpen(false)
                      }}
                    >
                      <span className="vector-font-option-sample" style={{ fontFamily: meta.css }}>
                        {meta.sample}
                      </span>
                      <span className="vector-font-option-label" style={{ fontFamily: meta.css }}>
                        {meta.label}
                      </span>
                      {active && <Check size={13} className="vector-font-check" />}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Eraser with circle size & section delete popover */}
        <div className="dropdown-parent-wrap" ref={eraserPopRef}>
          <button
            className={`tool-combo-btn ${p.activeTool === 'eraser' ? 'active' : ''}`}
            onClick={() => p.onSelectTool('eraser')}
            title={`Eraser (${p.eraserMode === 'section' ? 'Section Delete' : `${p.eraserSize}px Paper Eraser`})`}
          >
            <Eraser size={16} />
            <span>{p.eraserMode === 'section' ? 'Area' : 'Erase'}</span>
            <span
              className="combo-arrow"
              onClick={(e) => {
                e.stopPropagation()
                setEraserMenuOpen(!eraserMenuOpen)
              }}
              title="Change Eraser Mode & Circle Size"
            >
              <ChevronDown size={12} />
            </span>
          </button>

          {eraserMenuOpen && (
            <div className="toolbar-popover-menu eraser-options-menu">
              <div className="popover-heading">Eraser Mode</div>
              <div className="eraser-mode-row">
                <button
                  type="button"
                  className={`eraser-mode-btn ${p.eraserMode === 'paper' ? 'active' : ''}`}
                  onClick={() => {
                    p.onEraserMode('paper')
                    p.onSelectTool('eraser')
                  }}
                  title="Rub away strokes and lines like a physical eraser on paper"
                >
                  <div className="eraser-mode-icon-badge">
                    <Sparkles size={15} />
                  </div>
                  <div className="eraser-mode-info">
                    <strong>Paper Eraser</strong>
                    <small>Continuous rub</small>
                  </div>
                  {p.eraserMode === 'paper' && <span className="eraser-mode-active-dot" />}
                </button>
                <button
                  type="button"
                  className={`eraser-mode-btn ${p.eraserMode === 'section' ? 'active' : ''}`}
                  onClick={() => {
                    p.onEraserMode('section')
                    p.onSelectTool('eraser')
                  }}
                  title="Drag a box over a diagram section to delete it in one go"
                >
                  <div className="eraser-mode-icon-badge section">
                    <BoxSelect size={15} />
                  </div>
                  <div className="eraser-mode-info">
                    <strong>Section Delete</strong>
                    <small>Box-select delete</small>
                  </div>
                  {p.eraserMode === 'section' && <span className="eraser-mode-active-dot" />}
                </button>
              </div>

              {p.eraserMode === 'paper' && (
                <>
                  <div className="popover-heading-row">
                    <span className="popover-heading">Circle Size Preset</span>
                  </div>
                  <div className="eraser-size-presets">
                    {[18, 36, 72, 120].map((size) => (
                      <button
                        type="button"
                        key={size}
                        className={`eraser-preset-chip ${p.eraserSize === size ? 'active' : ''}`}
                        onClick={() => p.onEraserSize(size)}
                      >
                        <span className="preset-label">{size <= 20 ? 'S' : size <= 40 ? 'M' : size <= 80 ? 'L' : 'XL'}</span>
                        <span className="preset-val">{size}px</span>
                      </button>
                    ))}
                  </div>

                  <div className="popover-heading-row">
                    <span className="popover-heading">Adjust Radius</span>
                    <span className="eraser-size-badge">{p.eraserSize}px</span>
                  </div>
                  <div className="eraser-slider-container">
                    <input
                      type="range"
                      className="eraser-range-input"
                      min={10}
                      max={160}
                      value={p.eraserSize}
                      onChange={(e) => p.onEraserSize(Number(e.target.value))}
                    />
                    <div className="eraser-preview-frame" title={`Eraser Circle: ${p.eraserSize}px`}>
                      <div
                        className="eraser-circle-preview"
                        style={{
                          width: Math.min(28, Math.max(8, p.eraserSize * 0.22)),
                          height: Math.min(28, Math.max(8, p.eraserSize * 0.22))
                        }}
                      />
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* 6. Canvas Background & Color Selector */}
        <div className="dropdown-parent-wrap" ref={bgPopRef}>
          <button
            className={`tool-combo-btn ${bgMenuOpen ? 'active' : ''}`}
            onClick={() => setBgMenuOpen(!bgMenuOpen)}
            title="Choose canvas background color & pattern"
          >
            <Palette size={16} />
            <span
              className="bg-color-swatch-indicator"
              style={{
                backgroundColor: p.backgroundColor === 'transparent' ? 'transparent' : p.backgroundColor,
                borderColor: isLightColor(p.backgroundColor) ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.45)'
              }}
            />
            <span>Bg</span>
            <span className="combo-arrow">
              <ChevronDown size={12} />
            </span>
          </button>

          {bgMenuOpen && (
            <div className="toolbar-popover-menu background-options-menu">
              <div className="popover-heading">Canvas Background Colors</div>
              <div className="bg-presets-grid">
                {BACKGROUND_PRESETS.map((preset) => {
                  const isSelected = p.backgroundColor.toLowerCase() === preset.color.toLowerCase()
                  const isLight = isLightColor(preset.color)
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      className={`bg-preset-card ${isSelected ? 'active' : ''}`}
                      onClick={() => {
                        p.onSelectBackgroundColor(preset.color)
                        if (
                          p.penColor !== 'ink' &&
                          p.penColor !== 'accent' &&
                          !hasReadableContrast(p.penColor, preset.palette.bg, 3.0)
                        ) {
                          p.onPenColor('ink')
                        }
                      }}
                      title={`${preset.label}: ${preset.description}`}
                    >
                      <span
                        className="bg-swatch-circle"
                        style={{
                          backgroundColor:
                            preset.color === 'transparent'
                              ? 'transparent'
                              : preset.color,
                          backgroundImage:
                            preset.color === 'transparent'
                              ? 'conic-gradient(#cbd5e1 90deg, #ffffff 90deg 180deg, #cbd5e1 180deg 270deg, #ffffff 270deg)'
                              : undefined,
                          backgroundSize: preset.color === 'transparent' ? '8px 8px' : undefined,
                          borderColor: '#111111'
                        }}
                      >
                        {isSelected && (
                          <Check
                            size={11}
                            style={{ color: isLight ? '#111111' : '#ffffff', strokeWidth: 3 }}
                          />
                        )}
                      </span>
                      <span className="bg-preset-name">{preset.label}</span>
                      <span className="bg-palette-dots" aria-hidden="true">
                        <i style={{ backgroundColor: preset.palette.ink }} title="Font / Ink color" />
                        <i style={{ backgroundColor: preset.palette.shapeFill }} title="Shape fill color" />
                        <i style={{ backgroundColor: preset.palette.accent }} title="Accent color" />
                      </span>
                    </button>
                  )
                })}
              </div>

              <div className="popover-heading">Custom Color &amp; Hex</div>
              <div className="custom-bg-row">
                <div
                  className="custom-color-picker-wrapper"
                  title="Click to pick custom color"
                  style={{
                    backgroundColor: p.backgroundColor === 'transparent' ? '#FFFDF7' : p.backgroundColor
                  }}
                >
                  <Pipette
                    size={14}
                    className="custom-color-pipette-icon"
                    style={{
                      color: isLightColor(p.backgroundColor) ? '#111111' : '#FFFDF7'
                    }}
                  />
                  <input
                    type="color"
                    className="custom-color-picker-input"
                    value={normalizeHex(p.backgroundColor) ?? '#fffdf7'}
                    onChange={(e) => {
                      const nextBg = e.target.value
                      p.onSelectBackgroundColor(nextBg)
                      const nextPalette = resolveBoardPalette(nextBg)
                      if (
                        p.penColor !== 'ink' &&
                        p.penColor !== 'accent' &&
                        !hasReadableContrast(p.penColor, nextPalette.bg, 3.0)
                      ) {
                        p.onPenColor('ink')
                      }
                    }}
                  />
                </div>
                <div className="custom-hex-box">
                  <span className="hex-prefix">#</span>
                  <input
                    type="text"
                    className="custom-hex-input"
                    placeholder="FFFDF7"
                    value={p.backgroundColor.startsWith('#') ? p.backgroundColor.slice(1) : p.backgroundColor}
                    onChange={(e) => {
                      const val = e.target.value.trim()
                      const hexVal = val.startsWith('#') ? val : `#${val}`
                      p.onSelectBackgroundColor(hexVal)
                      const norm = normalizeHex(hexVal)
                      if (
                        norm &&
                        p.penColor !== 'ink' &&
                        p.penColor !== 'accent' &&
                        !hasReadableContrast(p.penColor, norm, 3.0)
                      ) {
                        p.onPenColor('ink')
                      }
                    }}
                    title="Enter custom hex color code"
                  />
                </div>
              </div>

              <div className="popover-heading">Grid Texture</div>
              <div className="bg-pattern-selector-row">
                <button
                  type="button"
                  className={`pattern-btn ${p.backgroundPattern === 'none' ? 'active' : ''}`}
                  onClick={() => p.onSelectBackgroundPattern('none')}
                  title="Solid clean canvas with no grid"
                >
                  <Square size={16} />
                  <span>Solid Blank</span>
                </button>
                <button
                  type="button"
                  className={`pattern-btn ${p.backgroundPattern === 'dots' ? 'active' : ''}`}
                  onClick={() => p.onSelectBackgroundPattern('dots')}
                  title="Subtle dot matrix pattern"
                >
                  <Grid2x2 size={16} />
                  <span>Dot Matrix</span>
                </button>
                <button
                  type="button"
                  className={`pattern-btn ${p.backgroundPattern === 'grid' ? 'active' : ''}`}
                  onClick={() => p.onSelectBackgroundPattern('grid')}
                  title="Engineering graph paper grid"
                >
                  <Grid3x3 size={16} />
                  <span>Graph Grid</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <span className="dock-divider" />

      {/* 2. Zoom Controls */}
      <div className="segmented zoom-controls">
        <button onClick={p.onZoomOut} title="Zoom Out (Ctrl+Minus or Wheel)">
          &minus;
        </button>
        <button onClick={p.onZoomReset} title="Reset View (100% at origin · Ctrl+0)">
          <span className="zoom-text">{Math.round(p.zoom * 100)}%</span>
        </button>
        <button onClick={p.onZoomIn} title="Zoom In (Ctrl+Plus or Wheel)">
          +
        </button>
        {p.onFitView && (
          <button onClick={p.onFitView} title="Fit to Content (Shift+1)" className="fit-view-btn">
            <Focus size={13} />
          </button>
        )}
      </div>

      <span className="dock-divider" />

      {/* 3. Undo / Redo / Clear / Settings */}
      <div className="icon-group">
        <button
          className="icon-btn"
          disabled={!p.canUndo}
          onClick={p.onUndo}
          title="Undo (Ctrl+Z)"
        >
          <Undo2 size={16} />
        </button>
        <button
          className="icon-btn"
          disabled={!p.canRedo}
          onClick={p.onRedo}
          title="Redo (Ctrl+Y / Ctrl+Shift+Z)"
        >
          <Redo2 size={16} />
        </button>
        <button className="icon-btn" onClick={p.onClear} title="Clear Canvas">
          <Trash2 size={16} />
        </button>
        <button className="icon-btn" onClick={p.onOpenSettings} title="Settings">
          <Settings2 size={16} />
        </button>
      </div>
    </nav>
  )
})
