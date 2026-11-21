import type { ColorRole, FontId, ThemeId } from './types/board'
import { resolveBoardPalette, type BoardPalette } from './board/backgroundPresets'

export interface ThemeTokens {
  id: ThemeId
  label: string
  ink: string
  accent: string
  /** Neon-style outer glow on ink (0 for crisp Neo-Brutalist ink) */
  glow: number
  /** Solid colour used behind exported PNGs (null = transparent) */
  exportBg: string | null
  /** Dark drop shadow for legibility over arbitrary desktops */
  contrastShadow: boolean
  swatch: [string, string, string]
}

export const THEMES: Record<ThemeId, ThemeTokens> = {
  neon: {
    id: 'neon',
    label: 'Neo-Brutalist Studio',
    ink: '#111111',
    accent: '#FF5E5B',
    glow: 0,
    exportBg: '#FFFDF7',
    contrastShadow: false,
    swatch: ['#FFFDF7', '#111111', '#FF5E5B']
  },
  chalk: {
    id: 'chalk',
    label: 'Matcha Chalkboard',
    ink: '#FFFDF7',
    accent: '#FFD166',
    glow: 0,
    exportBg: '#1B4332',
    contrastShadow: false,
    swatch: ['#1B4332', '#FFFDF7', '#FFD166']
  },
  blueprint: {
    id: 'blueprint',
    label: 'Cobalt Blueprint',
    ink: '#FFFFFF',
    accent: '#FFE566',
    glow: 0,
    exportBg: '#1E3A8A',
    contrastShadow: false,
    swatch: ['#1E3A8A', '#FFFFFF', '#FFE566']
  },
  overlay: {
    id: 'overlay',
    label: 'Desktop Ink (Mode B)',
    ink: '#111111',
    accent: '#FF5E5B',
    glow: 0,
    exportBg: null,
    contrastShadow: true,
    swatch: ['#FFFDF7', '#111111', '#FF5E5B']
  }
}

export const THEME_ORDER: ThemeId[] = ['neon', 'chalk', 'blueprint', 'overlay']

export const FONTS: Record<FontId, { label: string; shortLabel: string; css: string; sample: string }> = {
  jakarta: { label: 'Plus Jakarta Sans', shortLabel: 'Sans', css: '"Plus Jakarta Sans", sans-serif', sample: 'Aa' },
  caveat: { label: 'Caveat', shortLabel: 'Hand', css: '"Caveat", cursive', sample: 'Aa' },
  grotesk: { label: 'Space Grotesk', shortLabel: 'Tech', css: '"Space Grotesk", sans-serif', sample: 'Aa' },
  mono: { label: 'JetBrains Mono', shortLabel: 'Mono', css: '"JetBrains Mono", monospace', sample: '{}' },
  serif: { label: 'Georgia Serif', shortLabel: 'Serif', css: '"Georgia", "Times New Roman", serif', sample: 'Aa' }
}

export const FONT_ORDER: FontId[] = ['jakarta', 'caveat', 'grotesk', 'mono', 'serif']

export function resolveFontCss(fontId?: FontId | string, fallback: FontId = 'jakarta'): string {
  if (fontId && fontId in FONTS) {
    return FONTS[fontId as FontId].css
  }
  return FONTS[fallback].css
}

/**
 * Resolves live ThemeTokens tailored to the current board background color
 * so ink, accents, shapes, and exports always match the selected background.
 */
export function resolveThemeTokens(
  backgroundColor?: string | null,
  themeId: ThemeId = 'neon',
  palette?: BoardPalette
): ThemeTokens {
  const p = palette ?? resolveBoardPalette(backgroundColor)
  const base = THEMES[themeId] ?? THEMES.neon
  const isTransparent = backgroundColor === 'transparent'
  return {
    ...base,
    ink: p.ink,
    accent: p.accent,
    glow: 0,
    exportBg: isTransparent ? null : p.bg,
    contrastShadow: false,
    swatch: [p.bg === 'transparent' ? '#FFFDF7' : p.bg, p.ink, p.accent]
  }
}

export function colorFor(theme: ThemeTokens, role: ColorRole): string {
  if (role === 'accent') return theme.accent
  if (role === 'ink') return theme.ink
  return role // custom CSS color (e.g. '#ff3366')
}
