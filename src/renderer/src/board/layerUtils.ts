import type { BoardLayer, BoardState } from '../types/board'

export const LAYER_OVERLAY_INK_ID = 'layer-overlay-ink'
export const LAYER_CARDS_ID = 'layer-cards'
export const LAYER_BASE_INK_ID = 'layer-base-ink'

export const DEFAULT_BOARD_LAYERS: BoardLayer[] = [
  {
    id: LAYER_OVERLAY_INK_ID,
    name: 'Annotations (Top)',
    kind: 'ink',
    visible: true,
    locked: false,
    opacity: 1
  },
  {
    id: LAYER_CARDS_ID,
    name: 'Cards & Widgets',
    kind: 'elements',
    visible: true,
    locked: false,
    opacity: 1
  },
  {
    id: LAYER_BASE_INK_ID,
    name: 'Base Canvas',
    kind: 'ink',
    visible: true,
    locked: false,
    opacity: 1
  }
]

function cloneDefaultLayers(): BoardLayer[] {
  return DEFAULT_BOARD_LAYERS.map((l) => ({ ...l }))
}

function clampOpacity(val: unknown): number {
  const n = typeof val === 'number' && Number.isFinite(val) ? val : 1
  return Math.max(0.05, Math.min(1, n))
}

/**
 * Normalizes a board's layer stack and guarantees:
 * 1. Exactly one `'layer-cards'` (elements) layer exists.
 * 2. At least one `'ink'` layer exists.
 * 3. `activeLayerId` points to a valid `'ink'` layer (defaulting to `'layer-overlay-ink'`).
 */
export function ensureBoardLayers(board: Pick<BoardState, 'layers' | 'activeLayerId'>): {
  layers: BoardLayer[]
  activeLayerId: string
} {
  const raw = Array.isArray(board.layers) && board.layers.length > 0 ? board.layers : cloneDefaultLayers()
  const seen = new Set<string>()
  const normalized: BoardLayer[] = []

  for (const item of raw) {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id.trim()) continue
    if (seen.has(item.id)) continue
    seen.add(item.id)
    normalized.push({
      id: item.id,
      name:
        typeof item.name === 'string' && item.name.trim()
          ? item.name.trim()
          : item.kind === 'elements'
            ? 'Cards & Widgets'
            : 'Layer',
      kind: item.id === LAYER_CARDS_ID || item.kind === 'elements' ? 'elements' : 'ink',
      visible: item.visible !== false,
      locked: Boolean(item.locked),
      opacity: clampOpacity(item.opacity)
    })
  }

  if (!normalized.some((l) => l.kind === 'elements')) {
    const idx = Math.min(1, normalized.length)
    normalized.splice(idx, 0, {
      id: LAYER_CARDS_ID,
      name: 'Cards & Widgets',
      kind: 'elements',
      visible: true,
      locked: false,
      opacity: 1
    })
  }

  if (!normalized.some((l) => l.kind === 'ink')) {
    normalized.unshift({
      id: LAYER_OVERLAY_INK_ID,
      name: 'Annotations (Top)',
      kind: 'ink',
      visible: true,
      locked: false,
      opacity: 1
    })
  }

  const inkLayers = normalized.filter((l) => l.kind === 'ink')
  const requested = board.activeLayerId
  const activeValid = inkLayers.find((l) => l.id === requested)
  const defaultInk =
    inkLayers.find((l) => l.id === LAYER_OVERLAY_INK_ID) ?? inkLayers[0]

  return {
    layers: normalized,
    activeLayerId: activeValid ? activeValid.id : defaultInk.id
  }
}

/**
 * Splits ink layers into bottom-to-top render lists relative to `Cards & Widgets`:
 * - `belowCards`: rendered on the Base Canvas (`#board-canvas`, behind DOM cards)
 * - `aboveCards`: rendered on the Overlay Canvas (`#board-canvas-overlay`, ON TOP of cards)
 */
export function partitionInkLayers(layers: BoardLayer[]): {
  belowCards: BoardLayer[]
  aboveCards: BoardLayer[]
  cardsLayer: BoardLayer
} {
  const cardsIdx = layers.findIndex((l) => l.kind === 'elements')
  const cardsLayer: BoardLayer =
    cardsIdx >= 0
      ? layers[cardsIdx]
      : {
          id: LAYER_CARDS_ID,
          name: 'Cards & Widgets',
          kind: 'elements',
          visible: true,
          locked: false,
          opacity: 1
        }

  const topPart = cardsIdx >= 0 ? layers.slice(0, cardsIdx) : layers
  const bottomPart = cardsIdx >= 0 ? layers.slice(cardsIdx + 1) : []

  // Reverse top-to-bottom UI list into bottom-to-top painter's draw order
  const aboveCards = topPart.filter((l) => l.kind === 'ink').reverse()
  const belowCards = bottomPart.filter((l) => l.kind === 'ink').reverse()

  return { belowCards, aboveCards, cardsLayer }
}

/** Legacy items without explicit `layerId` belong to `'layer-base-ink'` (or first below-cards ink layer). */
export function resolveItemLayerId(layerId: string | undefined, layers: BoardLayer[]): string {
  if (layerId && layers.some((l) => l.id === layerId)) {
    return layerId
  }
  const base = layers.find((l) => l.id === LAYER_BASE_INK_ID)
  if (base) return base.id
  const firstInk = [...layers].reverse().find((l) => l.kind === 'ink')
  return firstInk?.id ?? LAYER_BASE_INK_ID
}

/**
 * Returns the layer ID to stamp on newly drawn pen strokes / annotations.
 * If the currently active ink layer is hidden or locked, picks the topmost visible unlocked ink layer, or `null` if all are locked/hidden.
 */
export function resolveTargetInkLayerId(
  board: Pick<BoardState, 'layers' | 'activeLayerId'>
): string | null {
  const { layers, activeLayerId } = ensureBoardLayers(board)
  const active = layers.find((l) => l.id === activeLayerId && l.kind === 'ink')
  if (active && active.visible && !active.locked) {
    return active.id
  }
  const fallback = layers.find((l) => l.kind === 'ink' && l.visible && !l.locked)
  return fallback ? fallback.id : null
}

export function isItemVisible(layerId: string | undefined, layers: BoardLayer[]): boolean {
  const resolved = resolveItemLayerId(layerId, layers)
  const layer = layers.find((l) => l.id === resolved)
  return layer ? layer.visible : true
}

export function isItemEditable(layerId: string | undefined, layers: BoardLayer[]): boolean {
  const resolved = resolveItemLayerId(layerId, layers)
  const layer = layers.find((l) => l.id === resolved)
  return layer ? layer.visible && !layer.locked : true
}

export function countLayerItems(board: BoardState, layers: BoardLayer[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const l of layers) counts[l.id] = 0

  const cardCount =
    board.textNodes.filter((t) => !t.immersed).length +
    board.equationNodes.length +
    (board.diagramNodes?.length ?? 0) +
    (board.codeNodes?.length ?? 0) +
    (board.videoNodes?.length ?? 0)
  const cardsLayer = layers.find((l) => l.kind === 'elements')
  if (cardsLayer) counts[cardsLayer.id] = cardCount

  for (const st of board.strokes) {
    const lid = resolveItemLayerId(st.layerId, layers)
    counts[lid] = (counts[lid] ?? 0) + 1
  }
  for (const sh of board.shapeNodes) {
    const lid = resolveItemLayerId(sh.layerId, layers)
    counts[lid] = (counts[lid] ?? 0) + 1
  }
  for (const va of board.vectorArtNodes ?? []) {
    const lid = resolveItemLayerId(va.layerId, layers)
    counts[lid] = (counts[lid] ?? 0) + 1
  }
  for (const t of board.textNodes) {
    if (!t.immersed) continue
    const lid = resolveItemLayerId(t.layerId, layers)
    counts[lid] = (counts[lid] ?? 0) + 1
  }
  return counts
}

export function addInkLayer(
  board: BoardState,
  name?: string,
  position: 'top' | 'bottom' = 'top'
): BoardState {
  const { layers } = ensureBoardLayers(board)
  const inkCount = layers.filter((l) => l.kind === 'ink').length
  const id = `layer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`
  const newLayer: BoardLayer = {
    id,
    name: name?.trim() || `Ink Layer ${inkCount + 1}`,
    kind: 'ink',
    visible: true,
    locked: false,
    opacity: 1
  }
  const nextLayers = position === 'top' ? [newLayer, ...layers] : [...layers, newLayer]
  return {
    ...board,
    layers: nextLayers,
    activeLayerId: id
  }
}

export function toggleLayerVisible(board: BoardState, layerId: string): BoardState {
  const { layers, activeLayerId } = ensureBoardLayers(board)
  return {
    ...board,
    layers: layers.map((l) => (l.id === layerId ? { ...l, visible: !l.visible } : l)),
    activeLayerId
  }
}

export function toggleLayerLocked(board: BoardState, layerId: string): BoardState {
  const { layers, activeLayerId } = ensureBoardLayers(board)
  return {
    ...board,
    layers: layers.map((l) => (l.id === layerId ? { ...l, locked: !l.locked } : l)),
    activeLayerId
  }
}

export function setLayerOpacity(board: BoardState, layerId: string, opacity: number): BoardState {
  const { layers, activeLayerId } = ensureBoardLayers(board)
  const safeOpacity = clampOpacity(opacity)
  return {
    ...board,
    layers: layers.map((l) => (l.id === layerId ? { ...l, opacity: safeOpacity } : l)),
    activeLayerId
  }
}

export function renameLayer(board: BoardState, layerId: string, name: string): BoardState {
  const { layers, activeLayerId } = ensureBoardLayers(board)
  const clean = name.trim()
  if (!clean) return board
  return {
    ...board,
    layers: layers.map((l) => (l.id === layerId ? { ...l, name: clean } : l)),
    activeLayerId
  }
}

export function moveLayer(board: BoardState, layerId: string, dir: 'up' | 'down'): BoardState {
  const { layers, activeLayerId } = ensureBoardLayers(board)
  const idx = layers.findIndex((l) => l.id === layerId)
  if (idx < 0) return board
  const targetIdx = dir === 'up' ? idx - 1 : idx + 1
  if (targetIdx < 0 || targetIdx >= layers.length) return board
  const next = [...layers]
  const [removed] = next.splice(idx, 1)
  next.splice(targetIdx, 0, removed)
  return {
    ...board,
    layers: next,
    activeLayerId
  }
}

export function deleteInkLayer(board: BoardState, layerId: string): BoardState {
  const { layers, activeLayerId } = ensureBoardLayers(board)
  const target = layers.find((l) => l.id === layerId)
  if (!target || target.kind !== 'ink') return board

  const remainingInk = layers.filter((l) => l.kind === 'ink' && l.id !== layerId)
  if (remainingInk.length === 0) return board

  const fallbackId = remainingInk[0].id
  const remap = (lid: string | undefined): string | undefined =>
    resolveItemLayerId(lid, layers) === layerId ? fallbackId : lid

  return {
    ...board,
    layers: layers.filter((l) => l.id !== layerId),
    activeLayerId: activeLayerId === layerId ? fallbackId : activeLayerId,
    strokes: board.strokes.map((st) => ({ ...st, layerId: remap(st.layerId) })),
    shapeNodes: board.shapeNodes.map((sh) => ({ ...sh, layerId: remap(sh.layerId) })),
    vectorArtNodes: (board.vectorArtNodes ?? []).map((va) => ({ ...va, layerId: remap(va.layerId) })),
    textNodes: board.textNodes.map((t) => (t.immersed ? { ...t, layerId: remap(t.layerId) } : t))
  }
}
