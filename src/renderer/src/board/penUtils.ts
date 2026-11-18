import type { PenType } from '../types/board'

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
  { id: 'ballpoint', label: 'Ballpoint', hint: 'Crisp uniform fine line' },
  { id: 'fountain', label: 'Fountain', hint: 'Pressure-sensitive calligraphic ink' },
  { id: 'marker', label: 'Marker', hint: 'Bold smooth felt-tip stroke' },
  { id: 'highlighter', label: 'Highlight', hint: 'Wide translucent marker' },
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
