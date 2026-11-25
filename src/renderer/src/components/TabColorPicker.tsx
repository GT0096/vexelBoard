import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Ban, Palette, Pipette } from 'lucide-react'
import { isLightColor } from '../board/backgroundPresets'

export const TAB_COLOR_PRESETS = [
  { label: 'Butter Yellow', hex: '#FFE566' },
  { label: 'Mint Green', hex: '#7BF1A8' },
  { label: 'Sky Cyan', hex: '#67E8F9' },
  { label: 'Soft Lilac', hex: '#C4B5FD' },
  { label: 'Coral Rose', hex: '#FDA4AF' },
  { label: 'Peach Amber', hex: '#FDBA74' },
  { label: 'Periwinkle', hex: '#93C5FD' },
  { label: 'Emerald', hex: '#34D399' },
  { label: 'Crimson', hex: '#F87171' },
  { label: 'Royal Blue', hex: '#2563EB' },
  { label: 'Slate Dark', hex: '#1E293B' },
  { label: 'Pure White', hex: '#FFFFFF' }
] as const

export function getReadableTabStyle(
  color?: string,
  opts?: { isActive?: boolean; subtleInactive?: boolean }
): React.CSSProperties | undefined {
  if (!color || color === 'transparent') return undefined
  const light = isLightColor(color)
  const textCol = light ? '#111111' : '#FFFDF7'
  const style: Record<string, string | number> = {
    backgroundColor: color,
    backgroundImage: 'none',
    color: textCol,
    '--vx-tab-bg': color,
    '--vx-tab-fg': textCol
  }
  if (opts?.subtleInactive && !opts?.isActive) {
    style.opacity = 0.88
  }
  return style as React.CSSProperties
}

interface TabColorPickerProps {
  color?: string
  onChange: (nextColor: string | undefined) => void
  title?: string
  size?: 'xs' | 'sm' | 'md'
}

export const TabColorPicker: React.FC<TabColorPickerProps> = ({
  color,
  onChange,
  title = 'Change tab color',
  size = 'sm'
}) => {
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<{ left: number; top: number }>({ left: 0, top: 0 })
  const triggerRef = useRef<HTMLSpanElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleOutside = (e: PointerEvent): void => {
      const target = e.target as Node
      if (
        triggerRef.current &&
        !triggerRef.current.contains(target) &&
        popRef.current &&
        !popRef.current.contains(target)
      ) {
        setOpen(false)
      }
    }
    const handleEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', handleOutside, true)
    window.addEventListener('keydown', handleEsc)
    return () => {
      window.removeEventListener('pointerdown', handleOutside, true)
      window.removeEventListener('keydown', handleEsc)
    }
  }, [open])

  const handleToggle = (e: React.MouseEvent): void => {
    e.stopPropagation()
    e.preventDefault()
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      const popW = 204
      const popH = 148
      const left = Math.max(8, Math.min(window.innerWidth - popW - 8, rect.left))
      const top =
        rect.bottom + popH + 12 > window.innerHeight
          ? Math.max(8, rect.top - popH - 6)
          : rect.bottom + 6
      setCoords({ left, top })
    }
    setOpen((v) => !v)
  }

  const normHex = color && /^#[0-9a-f]{6}$/i.test(color) ? color : '#ffe566'

  return (
    <>
      <span
        ref={triggerRef}
        role="button"
        tabIndex={0}
        className={`vx-tab-color-btn size-${size} ${color ? 'has-color' : ''}`}
        onClick={handleToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            e.stopPropagation()
            handleToggle(e as unknown as React.MouseEvent)
          }
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        title={title}
        aria-label={title}
      >
        {color ? (
          <span
            className="vx-tab-color-dot"
            style={{
              backgroundColor: color,
              borderColor: isLightColor(color) ? 'rgba(17,17,17,0.55)' : 'rgba(255,255,255,0.75)'
            }}
          />
        ) : (
          <Palette size={size === 'xs' ? 10 : size === 'sm' ? 11 : 13} />
        )}
      </span>

      {open &&
        createPortal(
          <div
            ref={popRef}
            className="vx-tab-color-popover"
            style={{ left: `${coords.left}px`, top: `${coords.top}px` }}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="vx-tab-color-popover-hdr">
              <span>Tab Color</span>
              {color && (
                <button
                  type="button"
                  className="vx-tab-color-reset"
                  onClick={() => {
                    onChange(undefined)
                    setOpen(false)
                  }}
                  title="Reset to default color"
                >
                  <Ban size={10} />
                  <span>Default</span>
                </button>
              )}
            </div>
            <div className="vx-tab-color-grid">
              {TAB_COLOR_PRESETS.map((preset) => {
                const active = color?.toLowerCase() === preset.hex.toLowerCase()
                return (
                  <button
                    key={preset.hex}
                    type="button"
                    className={`vx-tab-color-swatch ${active ? 'active' : ''}`}
                    style={{ backgroundColor: preset.hex }}
                    title={preset.label}
                    onClick={() => {
                      onChange(preset.hex)
                      setOpen(false)
                    }}
                  />
                )
              })}
            </div>
            <div className="vx-tab-color-custom-row">
              <label className="vx-tab-color-custom-label" title="Choose any custom color">
                <Pipette size={11} />
                <span>Custom Color</span>
                <input
                  type="color"
                  value={normHex}
                  onChange={(e) => onChange(e.target.value)}
                />
              </label>
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
