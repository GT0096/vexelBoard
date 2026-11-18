export interface BoardPalette {
  bg: string
  isLight: boolean
  /** Primary foreground / stroke / text color with high contrast against `bg` */
  ink: string
  /** Vibrant primary accent for headings, highlights, and accent strokes */
  accent: string
  /** Secondary complementary accent */
  secondary: string
  /** Default stroke color for canvas shapes & library shapes */
  shapeStroke: string
  /** Harmonious fill color for shapes on this background */
  shapeFill: string
  /** Text color inside filled shapes (contrasts with `shapeFill`) */
  shapeText: string
  /** Note card background */
  noteBg: string
  /** Note card text color (contrasts with `noteBg`) */
  noteText: string
  /** Note card header / accent color */
  noteAccent: string
  /** ReactFlow diagram node background */
  diagramNodeBg: string
  /** ReactFlow diagram node border */
  diagramNodeBorder: string
  /** ReactFlow diagram node primary text */
  diagramNodeText: string
  /** ReactFlow diagram node secondary text */
  diagramNodeSubtext: string
  /** ReactFlow edge / connector stroke */
  diagramEdge: string
  /** Subtle grid / dot matrix pattern color */
  gridColor: string
  /** Curated pen swatches that pair well & stay legible on this background */
  penSwatches: string[]
  /** Curated sticky / note card palettes */
  notePalettes: Array<{ label: string; bg: string; text: string }>
}

export interface BackgroundPreset {
  id: string
  label: string
  color: string
  description: string
  suggestedInk: string
  palette: BoardPalette
}

const DEFAULT_NOTE_PALETTES: Array<{ label: string; bg: string; text: string }> = [
  { label: 'Paper White', bg: '#FFFFFF', text: '#111111' },
  { label: 'Butter Yellow', bg: '#FFE566', text: '#111111' },
  { label: 'Sky Cyan', bg: '#A5F3FC', text: '#111111' },
  { label: 'Mint Pop', bg: '#A7F3D0', text: '#111111' },
  { label: 'Lilac Mist', bg: '#DDD6FE', text: '#111111' },
  { label: 'Coral Pink', bg: '#FECDD3', text: '#111111' }
]

export const BACKGROUND_PRESETS: BackgroundPreset[] = [
  {
    id: 'studio-cream',
    label: 'Studio Cream',
    color: '#FFFDF7',
    description: 'Warm Neo-Brutalist paper canvas (Default)',
    suggestedInk: '#111111',
    palette: {
      bg: '#FFFDF7',
      isLight: true,
      ink: '#111111',
      accent: '#FF5E5B',
      secondary: '#2563EB',
      shapeStroke: '#111111',
      shapeFill: '#FFE566',
      shapeText: '#111111',
      noteBg: '#FFFFFF',
      noteText: '#111111',
      noteAccent: '#FF5E5B',
      diagramNodeBg: '#FFFFFF',
      diagramNodeBorder: '#111111',
      diagramNodeText: '#111111',
      diagramNodeSubtext: '#52525B',
      diagramEdge: '#111111',
      gridColor: 'rgba(17, 17, 17, 0.14)',
      penSwatches: ['#111111', '#FF5E5B', '#2563EB', '#059669', '#7C3AED', '#EA580C', '#DB2777', '#0891B2'],
      notePalettes: DEFAULT_NOTE_PALETTES
    }
  },
  {
    id: 'whiteboard',
    label: 'Crisp Whiteboard',
    color: '#FFFFFF',
    description: 'Pure high-contrast studio whiteboard',
    suggestedInk: '#111111',
    palette: {
      bg: '#FFFFFF',
      isLight: true,
      ink: '#111111',
      accent: '#2563EB',
      secondary: '#FF5E5B',
      shapeStroke: '#111111',
      shapeFill: '#A5F3FC',
      shapeText: '#111111',
      noteBg: '#FEF9C3',
      noteText: '#111111',
      noteAccent: '#2563EB',
      diagramNodeBg: '#F8FAFC',
      diagramNodeBorder: '#111111',
      diagramNodeText: '#111111',
      diagramNodeSubtext: '#475569',
      diagramEdge: '#2563EB',
      gridColor: 'rgba(17, 17, 17, 0.13)',
      penSwatches: ['#111111', '#2563EB', '#EF4444', '#16A34A', '#9333EA', '#EA580C', '#0D9488', '#E11D48'],
      notePalettes: DEFAULT_NOTE_PALETTES
    }
  },
  {
    id: 'butter-paper',
    label: 'Butter Sketch',
    color: '#FEF3C7',
    description: 'Sunny yellow creative sketchpad',
    suggestedInk: '#18181B',
    palette: {
      bg: '#FEF3C7',
      isLight: true,
      ink: '#18181B',
      accent: '#7C3AED',
      secondary: '#E11D48',
      shapeStroke: '#18181B',
      shapeFill: '#FFFFFF',
      shapeText: '#18181B',
      noteBg: '#FFFFFF',
      noteText: '#18181B',
      noteAccent: '#7C3AED',
      diagramNodeBg: '#FFFBEB',
      diagramNodeBorder: '#18181B',
      diagramNodeText: '#18181B',
      diagramNodeSubtext: '#57534E',
      diagramEdge: '#7C3AED',
      gridColor: 'rgba(24, 24, 27, 0.14)',
      penSwatches: ['#18181B', '#7C3AED', '#DC2626', '#0284C7', '#059669', '#D97706', '#BE185D', '#1D4ED8'],
      notePalettes: DEFAULT_NOTE_PALETTES
    }
  },
  {
    id: 'mint-studio',
    label: 'Mint Studio',
    color: '#ECFDF5',
    description: 'Fresh mint canvas with rose & forest accents',
    suggestedInk: '#064E3B',
    palette: {
      bg: '#ECFDF5',
      isLight: true,
      ink: '#064E3B',
      accent: '#E11D48',
      secondary: '#0284C7',
      shapeStroke: '#064E3B',
      shapeFill: '#A7F3D0',
      shapeText: '#064E3B',
      noteBg: '#FFFFFF',
      noteText: '#064E3B',
      noteAccent: '#E11D48',
      diagramNodeBg: '#FFFFFF',
      diagramNodeBorder: '#064E3B',
      diagramNodeText: '#064E3B',
      diagramNodeSubtext: '#047857',
      diagramEdge: '#059669',
      gridColor: 'rgba(6, 78, 59, 0.14)',
      penSwatches: ['#064E3B', '#E11D48', '#0284C7', '#7C3AED', '#EA580C', '#111111', '#0D9488', '#BE123C'],
      notePalettes: DEFAULT_NOTE_PALETTES
    }
  },
  {
    id: 'sky-studio',
    label: 'Sky Grid',
    color: '#EFF6FF',
    description: 'Crisp sky-blue drafting board',
    suggestedInk: '#0F172A',
    palette: {
      bg: '#EFF6FF',
      isLight: true,
      ink: '#0F172A',
      accent: '#EA580C',
      secondary: '#2563EB',
      shapeStroke: '#0F172A',
      shapeFill: '#BAE6FD',
      shapeText: '#0F172A',
      noteBg: '#FFFFFF',
      noteText: '#0F172A',
      noteAccent: '#EA580C',
      diagramNodeBg: '#FFFFFF',
      diagramNodeBorder: '#0F172A',
      diagramNodeText: '#0F172A',
      diagramNodeSubtext: '#334155',
      diagramEdge: '#2563EB',
      gridColor: 'rgba(30, 58, 138, 0.14)',
      penSwatches: ['#0F172A', '#EA580C', '#2563EB', '#7C3AED', '#059669', '#DC2626', '#0891B2', '#4F46E5'],
      notePalettes: DEFAULT_NOTE_PALETTES
    }
  },
  {
    id: 'lilac-pop',
    label: 'Lilac Pop',
    color: '#F3E8FF',
    description: 'Creative lavender with indigo & magenta ink',
    suggestedInk: '#1E1B4B',
    palette: {
      bg: '#F3E8FF',
      isLight: true,
      ink: '#1E1B4B',
      accent: '#DB2777',
      secondary: '#059669',
      shapeStroke: '#1E1B4B',
      shapeFill: '#FFE566',
      shapeText: '#1E1B4B',
      noteBg: '#FFFFFF',
      noteText: '#1E1B4B',
      noteAccent: '#DB2777',
      diagramNodeBg: '#FAF5FF',
      diagramNodeBorder: '#1E1B4B',
      diagramNodeText: '#1E1B4B',
      diagramNodeSubtext: '#4C1D95',
      diagramEdge: '#7C3AED',
      gridColor: 'rgba(30, 27, 75, 0.13)',
      penSwatches: ['#1E1B4B', '#DB2777', '#7C3AED', '#059669', '#EA580C', '#2563EB', '#111111', '#0D9488'],
      notePalettes: DEFAULT_NOTE_PALETTES
    }
  },
  {
    id: 'peach-sorbet',
    label: 'Peach Sorbet',
    color: '#FFEDD5',
    description: 'Warm apricot canvas with cobalt contrast',
    suggestedInk: '#1C1917',
    palette: {
      bg: '#FFEDD5',
      isLight: true,
      ink: '#1C1917',
      accent: '#2563EB',
      secondary: '#16A34A',
      shapeStroke: '#1C1917',
      shapeFill: '#FFFFFF',
      shapeText: '#1C1917',
      noteBg: '#FFFBEB',
      noteText: '#1C1917',
      noteAccent: '#2563EB',
      diagramNodeBg: '#FFFFFF',
      diagramNodeBorder: '#1C1917',
      diagramNodeText: '#1C1917',
      diagramNodeSubtext: '#57534E',
      diagramEdge: '#EA580C',
      gridColor: 'rgba(28, 25, 23, 0.14)',
      penSwatches: ['#1C1917', '#2563EB', '#DC2626', '#16A34A', '#7C3AED', '#0891B2', '#9A3412', '#DB2777'],
      notePalettes: DEFAULT_NOTE_PALETTES
    }
  },
  {
    id: 'chalkboard',
    label: 'Matcha Chalk',
    color: '#1B4332',
    description: 'Rich forest chalkboard with warm chalk gold',
    suggestedInk: '#FFFDF7',
    palette: {
      bg: '#1B4332',
      isLight: false,
      ink: '#FFFDF7',
      accent: '#FFD166',
      secondary: '#80FFDB',
      shapeStroke: '#FFFDF7',
      shapeFill: '#2D6A4F',
      shapeText: '#FFFDF7',
      noteBg: '#2D6A4F',
      noteText: '#FFFDF7',
      noteAccent: '#FFD166',
      diagramNodeBg: '#143627',
      diagramNodeBorder: '#FFD166',
      diagramNodeText: '#FFFDF7',
      diagramNodeSubtext: '#B7E4C7',
      diagramEdge: '#FFD166',
      gridColor: 'rgba(255, 253, 247, 0.14)',
      penSwatches: ['#FFFDF7', '#FFD166', '#80FFDB', '#FF8FA3', '#A5F3FC', '#C4B5FD', '#FDBA74', '#86EFAC'],
      notePalettes: DEFAULT_NOTE_PALETTES
    }
  },
  {
    id: 'blueprint',
    label: 'Cobalt Blueprint',
    color: '#1E3A8A',
    description: 'Architectural blueprint with drafting yellow',
    suggestedInk: '#FFFFFF',
    palette: {
      bg: '#1E3A8A',
      isLight: false,
      ink: '#FFFFFF',
      accent: '#FFE566',
      secondary: '#67E8F9',
      shapeStroke: '#FFFFFF',
      shapeFill: '#1D4ED8',
      shapeText: '#FFFFFF',
      noteBg: '#172554',
      noteText: '#FFFFFF',
      noteAccent: '#FFE566',
      diagramNodeBg: '#172554',
      diagramNodeBorder: '#67E8F9',
      diagramNodeText: '#FFFFFF',
      diagramNodeSubtext: '#BFDBFE',
      diagramEdge: '#FFE566',
      gridColor: 'rgba(255, 255, 255, 0.18)',
      penSwatches: ['#FFFFFF', '#FFE566', '#67E8F9', '#FF8FA3', '#86EFAC', '#FDBA74', '#E9D5FF', '#FDE047'],
      notePalettes: DEFAULT_NOTE_PALETTES
    }
  },
  {
    id: 'transparent',
    label: 'Transparent Glass',
    color: 'transparent',
    description: 'Desktop pass-through overlay',
    suggestedInk: '#111111',
    palette: {
      bg: 'transparent',
      isLight: true,
      ink: '#111111',
      accent: '#FF5E5B',
      secondary: '#2563EB',
      shapeStroke: '#111111',
      shapeFill: '#FFE566',
      shapeText: '#111111',
      noteBg: '#FFFFFF',
      noteText: '#111111',
      noteAccent: '#FF5E5B',
      diagramNodeBg: '#FFFFFF',
      diagramNodeBorder: '#111111',
      diagramNodeText: '#111111',
      diagramNodeSubtext: '#4B5563',
      diagramEdge: '#111111',
      gridColor: 'rgba(17, 17, 17, 0.12)',
      penSwatches: ['#111111', '#FF5E5B', '#2563EB', '#00E5FF', '#FFE566', '#FFFFFF', '#16A34A', '#9333EA'],
      notePalettes: DEFAULT_NOTE_PALETTES
    }
  }
]

/* ------------------------------------------------------------------ */
/* WCAG Color Harmony & Contrast Engine (for any custom hex color)    */
/* ------------------------------------------------------------------ */

export function normalizeHex(color?: string | null): string | null {
  if (!color || color === 'transparent') return null
  const trimmed = color.trim()
  if (!trimmed.startsWith('#')) return null
  const hex = trimmed.slice(1)
  if (hex.length === 3 && /^[0-9a-fA-F]{3}$/.test(hex)) {
    return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`.toLowerCase()
  }
  if (hex.length >= 6 && /^[0-9a-fA-F]{6}/.test(hex)) {
    return `#${hex.slice(0, 6)}`.toLowerCase()
  }
  return null
}

function hexToRgb(hex: string): [number, number, number] {
  const norm = normalizeHex(hex) ?? '#fffdf7'
  const c = norm.slice(1)
  return [
    parseInt(c.slice(0, 2), 16),
    parseInt(c.slice(2, 4), 16),
    parseInt(c.slice(4, 6), 16)
  ]
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (v: number): string =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h =
    max === rn
      ? (gn - bn) / d + (gn < bn ? 6 : 0)
      : max === gn
        ? (bn - rn) / d + 2
        : (rn - gn) / d + 4
  return [h * 60, s, l]
}

function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360
  const sat = Math.max(0, Math.min(1, s))
  const lig = Math.max(0, Math.min(1, l))
  const c = (1 - Math.abs(2 * lig - 1)) * sat
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = lig - c / 2
  const [r, g, b] =
    hue < 60
      ? [c, x, 0]
      : hue < 120
        ? [x, c, 0]
        : hue < 180
          ? [0, c, x]
          : hue < 240
            ? [0, x, c]
            : hue < 300
              ? [x, 0, c]
              : [c, 0, x]
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255)
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex)
  const lin = (v: number): number => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

export function contrastRatio(hexA: string, hexB: string): number {
  const la = relativeLuminance(hexA)
  const lb = relativeLuminance(hexB)
  const hi = Math.max(la, lb)
  const lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}

export function hasReadableContrast(fgHex: string, bgHex?: string | null, minRatio = 3.0): boolean {
  const normBg = normalizeHex(bgHex)
  const normFg = normalizeHex(fgHex)
  if (!normBg || !normFg) return true
  return contrastRatio(normFg, normBg) >= minRatio
}

function tuneColorContrast(hue: number, sat: number, bgHex: string, preferDark: boolean, minContrast = 4.6): string {
  const startL = preferDark ? 0.38 : 0.72
  const step = preferDark ? -0.04 : 0.04
  let l = startL
  for (let i = 0; i < 14; i++) {
    const candidate = hslToHex(hue, sat, l)
    if (contrastRatio(candidate, bgHex) >= minContrast) {
      return candidate
    }
    l = Math.max(0.08, Math.min(0.95, l + step))
  }
  return preferDark ? '#111111' : '#FFFDF7'
}

/**
 * Determines whether a given color (hex) works best with dark ink (`isLight = true`)
 * using WCAG relative luminance so even vivid mid-tones (yellow, coral, sky, lime) get crisp dark text.
 */
export function isLightColor(color?: string | null): boolean {
  if (!color || color === 'transparent') return false
  const norm = normalizeHex(color)
  if (!norm) return false
  return relativeLuminance(norm) > 0.179
}

const CANDIDATE_PEN_COLORS = [
  '#111111',
  '#FFFDF7',
  '#FF5E5B',
  '#2563EB',
  '#059669',
  '#7C3AED',
  '#EA580C',
  '#DB2777',
  '#0891B2',
  '#FFE566',
  '#67E8F9',
  '#86EFAC',
  '#FDA4AF',
  '#C4B5FD'
]

/**
 * Resolves a complete, harmonious Neo-Brutalist color palette for ANY board background color
 * (curated preset OR arbitrary custom hex color).
 */
export function resolveBoardPalette(backgroundColor?: string | null): BoardPalette {
  const raw = (backgroundColor || '#FFFDF7').trim()
  if (raw === 'transparent') {
    return BACKGROUND_PRESETS.find((p) => p.id === 'transparent')!.palette
  }

  const norm = normalizeHex(raw)
  if (norm) {
    const preset = BACKGROUND_PRESETS.find((p) => p.color.toLowerCase() === norm)
    if (preset) return preset.palette
  }

  const bgHex = norm ?? '#fffdf7'
  const isLight = relativeLuminance(bgHex) > 0.179
  const ink = isLight ? '#111111' : '#FFFDF7'
  const [r, g, b] = hexToRgb(bgHex)
  const [h, s, l] = rgbToHsl(r, g, b)

  // Derive harmonious triadic/complementary accents guaranteed to pass contrast against bgHex
  const accentHue = s < 0.1 ? (isLight ? 4 : 172) : (h + 195) % 360
  const secondaryHue = s < 0.1 ? (isLight ? 221 : 45) : (h + 125) % 360
  const accent = tuneColorContrast(accentHue, 0.85, bgHex, isLight, 4.5)
  const secondary = tuneColorContrast(secondaryHue, 0.82, bgHex, isLight, 4.5)

  // Shape fill pairs cleanly with the background (crisp pastel/cream on light, rich tinted surface on dark)
  let shapeFill: string
  if (isLight) {
    shapeFill = l > 0.9 ? hslToHex((h + 45) % 360, 0.85, 0.78) : '#FFFFFF'
  } else {
    shapeFill = hslToHex(h, Math.min(0.55, Math.max(0.25, s)), Math.min(0.32, l + 0.14))
  }
  const shapeText = contrastRatio('#111111', shapeFill) >= contrastRatio('#FFFDF7', shapeFill) ? '#111111' : '#FFFDF7'
  const shapeStroke = ink

  const noteBg = isLight ? '#FFFFFF' : hslToHex(h, Math.min(0.45, Math.max(0.2, s)), Math.min(0.26, l + 0.1))
  const noteText = contrastRatio('#111111', noteBg) >= contrastRatio('#FFFDF7', noteBg) ? '#111111' : '#FFFDF7'
  const noteAccent = tuneColorContrast(accentHue, 0.85, noteBg, relativeLuminance(noteBg) > 0.179, 4.5)

  const diagramNodeBg = noteBg
  const diagramNodeBorder = isLight ? '#111111' : accent
  const diagramNodeText = noteText
  const diagramNodeSubtext = isLight ? '#52525B' : '#CBD5E1'
  const diagramEdge = isLight ? accent : accent

  const gridColor = isLight ? 'rgba(17, 17, 17, 0.14)' : 'rgba(255, 253, 247, 0.15)'

  const swatchesSet = new Set<string>([ink, accent, secondary])
  for (const c of CANDIDATE_PEN_COLORS) {
    if (swatchesSet.size >= 8) break
    if (contrastRatio(c, bgHex) >= 3.2) {
      swatchesSet.add(c)
    }
  }

  return {
    bg: bgHex,
    isLight,
    ink,
    accent,
    secondary,
    shapeStroke,
    shapeFill,
    shapeText,
    noteBg,
    noteText,
    noteAccent,
    diagramNodeBg,
    diagramNodeBorder,
    diagramNodeText,
    diagramNodeSubtext,
    diagramEdge,
    gridColor,
    penSwatches: Array.from(swatchesSet),
    notePalettes: DEFAULT_NOTE_PALETTES
  }
}
