import type { EraserMode, PenType, ToolType } from '../types/board'

export const DEFAULT_PEN_COLORS = [
  '#111111',
  '#FF5E5B',
  '#2563EB',
  '#059669',
  '#7C3AED',
  '#EA580C',
  '#DB2777',
  '#0891B2'
]

export const PEN_TYPE_META: Array<{
  id: PenType
  label: string
  hint: string
}> = [
  { id: 'ballpoint', label: 'Pen', hint: 'Crisp uniform fine pen line' },
  { id: 'fountain', label: 'Fountain', hint: 'Pressure-sensitive calligraphic nib' },
  { id: 'pencil', label: 'Pencil', hint: 'Fine textured graphite pencil' },
  { id: 'brush', label: 'Brush', hint: 'Expressive tapered artist brush' },
  { id: 'marker', label: 'Marker', hint: 'Bold smooth felt-tip stroke' },
  { id: 'highlighter', label: 'Highlight', hint: 'Wide translucent highlighter' },
  { id: 'dashed', label: 'Dashed', hint: 'Stitched dashed ink line' }
]

export function resolvePenColorHex(
  penColor: string,
  themeInk: string,
  themeAccent: string
): string {
  if (penColor === 'ink') return themeInk
  if (penColor === 'accent') return themeAccent
  return penColor
}

function sanitizeSvgHex(raw: string | undefined, fallback = '#111111'): string {
  if (!raw) return fallback
  const trimmed = raw.trim()
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed)) return trimmed
  return fallback
}

function svgToDataUriCursor(svg: string, hotX: number, hotY: number, fallback = 'crosshair'): string {
  const encoded = encodeURIComponent(svg)
    .replace(/'/g, '%27')
    .replace(/"/g, '%22')
  return `url("data:image/svg+xml,${encoded}") ${hotX} ${hotY}, ${fallback}`
}

const cursorCache = new Map<string, string>()

/**
 * Generates crisp, color-tinted SVG cursor CSS for Pen, Fountain, Pencil, Brush, Marker,
 * Highlighter, Lasso, and Snip tools (hotspot precisely at the writing nib).
 */
export function getToolCursorCss(
  tool: ToolType,
  opts: {
    penType?: PenType
    penColorHex?: string
    eraserMode?: EraserMode
  } = {}
): string {
  if (tool === 'pen') {
    const penType = opts.penType ?? 'fountain'
    const color = sanitizeSvgHex(opts.penColorHex, '#111111')
    const cacheKey = `pen:${penType}:${color}`
    const cached = cursorCache.get(cacheKey)
    if (cached) return cached

    let svg = ''
    if (penType === 'pencil') {
      // Angled wooden/graphite pencil with tip at (2, 22)
      svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
        <g stroke="#ffffff" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
          <path d="M2 22L5.2 15.2L16.6 3.8C17.4 3 18.7 3 19.5 3.8L20.2 4.5C21 5.3 21 6.6 20.2 7.4L8.8 18.8L2 22Z"/>
        </g>
        <path d="M5.2 15.2L16.6 3.8C17.4 3 18.7 3 19.5 3.8L20.2 4.5C21 5.3 21 6.6 20.2 7.4L8.8 18.8L5.2 15.2Z" fill="#FBBF24" stroke="#111111" stroke-width="1.4" stroke-linejoin="round"/>
        <path d="M15.2 5.2L18.8 8.8L20.2 7.4C21 6.6 21 5.3 20.2 4.5L19.5 3.8C18.7 3 17.4 3 16.6 3.8L15.2 5.2Z" fill="#FB7185" stroke="#111111" stroke-width="1.3"/>
        <path d="M2 22L5.2 15.2L8.8 18.8L2 22Z" fill="#FDE68A" stroke="#111111" stroke-width="1.3" stroke-linejoin="round"/>
        <path d="M2 22L3.9 18L6 20.1L2 22Z" fill="${color}"/>
      </svg>`
    } else if (penType === 'brush' || penType === 'marker' || penType === 'highlighter') {
      // Expressive artist paintbrush / marker tip at (2, 22)
      svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
        <g stroke="#ffffff" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
          <path d="M18.6 3.2C19.3 2.5 20.4 2.5 21.1 3.2C21.8 3.9 21.8 5 21.1 5.7L11.8 15L9 12.2L18.6 3.2Z"/>
          <path d="M9 12.2L11.8 15C10.9 17.6 8.8 19.6 5.6 20.5C4.2 20.9 3 21.4 2 22C2.5 20.6 3 19.1 3.6 17.7C4.6 15.1 6.6 13.1 9 12.2Z"/>
        </g>
        <path d="M18.6 3.2C19.3 2.5 20.4 2.5 21.1 3.2C21.8 3.9 21.8 5 21.1 5.7L11.8 15L9 12.2L18.6 3.2Z" fill="#334155" stroke="#111111" stroke-width="1.4" stroke-linejoin="round"/>
        <path d="M9 12.2L11.8 15C10.9 17.6 8.8 19.6 5.6 20.5C4.2 20.9 3 21.4 2 22C2.5 20.6 3 19.1 3.6 17.7C4.6 15.1 6.6 13.1 9 12.2Z" fill="${color}" stroke="#111111" stroke-width="1.4" stroke-linejoin="round"/>
      </svg>`
    } else {
      // Precision Fountain / Ballpoint Pen nib pointing to (2, 22)
      svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
        <g stroke="#ffffff" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
          <path d="M2 22L6.2 11.4L15.8 3.4C16.7 2.6 18 2.7 18.8 3.5L20.5 5.2C21.3 6 21.4 7.3 20.6 8.2L12.6 17.8L2 22Z"/>
        </g>
        <path d="M6.2 11.4L15.8 3.4C16.7 2.6 18 2.7 18.8 3.5L20.5 5.2C21.3 6 21.4 7.3 20.6 8.2L12.6 17.8L6.2 11.4Z" fill="${color}" stroke="#111111" stroke-width="1.4" stroke-linejoin="round"/>
        <path d="M2 22L6.2 11.4L12.6 17.8L2 22Z" fill="#F8FAFC" stroke="#111111" stroke-width="1.4" stroke-linejoin="round"/>
        <path d="M2 22L6.8 17.2" stroke="#111111" stroke-width="1.3" stroke-linecap="round"/>
        <circle cx="7.4" cy="16.6" r="1.3" fill="${color}" stroke="#111111" stroke-width="1"/>
      </svg>`
    }

    const res = svgToDataUriCursor(svg, 2, 22, 'crosshair')
    cursorCache.set(cacheKey, res)
    return res
  }

  if (tool === 'lasso') {
    const cached = cursorCache.get('lasso')
    if (cached) return cached
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
      <ellipse cx="13" cy="10.5" rx="8.5" ry="6.5" stroke="#ffffff" stroke-width="3.2"/>
      <ellipse cx="13" cy="10.5" rx="8.5" ry="6.5" stroke="#0891B2" stroke-width="1.8" stroke-dasharray="3.2 2.4"/>
      <path d="M2.5 21.5L7.5 15.5" stroke="#ffffff" stroke-width="3.2" stroke-linecap="round"/>
      <path d="M2.5 21.5L7.5 15.5" stroke="#111111" stroke-width="1.8" stroke-linecap="round"/>
      <circle cx="7.8" cy="15.2" r="2.2" fill="#06B6D4" stroke="#111111" stroke-width="1.2"/>
    </svg>`
    const res = svgToDataUriCursor(svg, 3, 21, 'crosshair')
    cursorCache.set('lasso', res)
    return res
  }

  if (tool === 'snip') {
    return 'crosshair'
  }

  if (tool === 'eraser') {
    return opts.eraserMode === 'paper' ? 'none' : 'crosshair'
  }

  if (tool === 'text') return 'text'
  if (tool === 'equation') return 'crosshair'
  if (tool === 'pan') return 'grab'
  return 'default'
}
