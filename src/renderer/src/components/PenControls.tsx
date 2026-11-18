import React from 'react'
import { Pen, PenTool, Brush, Highlighter, MoreHorizontal } from 'lucide-react'
import type { PenType } from '../types/board'
import type { BoardPalette } from '../board/backgroundPresets'
import { DEFAULT_PEN_COLORS, PEN_TYPE_META, resolvePenColorHex } from '../board/penUtils'

const PEN_TYPE_ICONS: Record<PenType, React.ReactNode> = {
  ballpoint: <Pen size={13} />,
  fountain: <PenTool size={13} />,
  marker: <Brush size={13} />,
  highlighter: <Highlighter size={13} />,
  dashed: <MoreHorizontal size={13} />
}

interface PenControlsProps {
  penColor: string
  onPenColor: (color: string) => void
  penSize: number
  onPenSize: (size: number) => void
  penType: PenType
  onPenType: (penType: PenType) => void
  themeInk: string
  themeAccent: string
  boardPalette?: BoardPalette
  onActivatePen?: () => void
}

export function PenControls({
  penColor,
  onPenColor,
  penSize,
  onPenSize,
  penType,
  onPenType,
  themeInk,
  themeAccent,
  boardPalette,
  onActivatePen
}: PenControlsProps): React.JSX.Element {
  const activeColor = resolvePenColorHex(penColor, themeInk, themeAccent)
  const swatches = boardPalette?.penSwatches ?? DEFAULT_PEN_COLORS

  return (
    <div className="pen-options">
      <div className="pen-sub-label">Pen Type</div>
      <div className="pen-type-grid" role="group" aria-label="Pen type">
        {PEN_TYPE_META.map((opt) => (
          <button
            key={opt.id}
            type="button"
            className={`pen-type-btn ${penType === opt.id ? 'active' : ''}`}
            title={opt.hint}
            onClick={() => {
              onPenType(opt.id)
              onActivatePen?.()
            }}
          >
            {PEN_TYPE_ICONS[opt.id]}
            <span>{opt.label}</span>
          </button>
        ))}
      </div>

      <div className="pen-sub-label">Color</div>
      <div className="pen-swatches">
        <button
          type="button"
          className={`pen-swatch ${penColor === 'ink' ? 'active' : ''}`}
          style={{ background: themeInk }}
          title="Theme ink"
          onClick={() => {
            onPenColor('ink')
            onActivatePen?.()
          }}
        />
        <button
          type="button"
          className={`pen-swatch ${penColor === 'accent' ? 'active' : ''}`}
          style={{ background: themeAccent }}
          title="Theme accent"
          onClick={() => {
            onPenColor('accent')
            onActivatePen?.()
          }}
        />
        {swatches.map((c) => (
          <button
            key={c}
            type="button"
            className={`pen-swatch ${penColor === c ? 'active' : ''}`}
            style={{ background: c }}
            title={c}
            onClick={() => {
              onPenColor(c)
              onActivatePen?.()
            }}
          />
        ))}
        <input
          type="color"
          className="pen-color-input"
          title="Custom color"
          value={penColor.startsWith('#') ? penColor : themeInk}
          onChange={(e) => {
            onPenColor(e.target.value)
            onActivatePen?.()
          }}
        />
      </div>

      <div className="pen-size-row">
        <span>Thickness</span>
        <input
          type="range"
          min={1}
          max={24}
          value={penSize}
          onChange={(e) => {
            onPenSize(Number(e.target.value))
            onActivatePen?.()
          }}
        />
        <span className="pen-size-val">{penSize}px</span>
        <span
          className={`pen-size-preview pen-preview-${penType}`}
          style={{
            width: penType === 'highlighter' ? 18 : penSize,
            height: penType === 'highlighter' ? Math.max(8, Math.min(20, penSize)) : penSize,
            background: penType === 'dashed' ? 'transparent' : activeColor,
            borderColor: penType === 'dashed' ? activeColor : undefined,
            opacity: penType === 'highlighter' ? 0.42 : 1
          }}
        />
      </div>
    </div>
  )
}
