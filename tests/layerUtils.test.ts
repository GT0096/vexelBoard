import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EMPTY_BOARD, type BoardState } from '../src/renderer/src/types/board.ts'
import {
  LAYER_BASE_INK_ID,
  LAYER_CARDS_ID,
  LAYER_OVERLAY_INK_ID,
  addInkLayer,
  deleteInkLayer,
  ensureBoardLayers,
  isItemEditable,
  moveLayer,
  partitionInkLayers,
  resolveItemLayerId,
  resolveTargetInkLayerId,
  toggleLayerLocked,
  toggleLayerVisible
} from '../src/renderer/src/board/layerUtils.ts'

test('ensureBoardLayers initializes Annotations (Top) above Cards & Widgets above Base Canvas', () => {
  const { layers, activeLayerId } = ensureBoardLayers({})
  assert.equal(layers.length, 3)
  assert.equal(layers[0].id, LAYER_OVERLAY_INK_ID)
  assert.equal(layers[1].id, LAYER_CARDS_ID)
  assert.equal(layers[2].id, LAYER_BASE_INK_ID)
  assert.equal(activeLayerId, LAYER_OVERLAY_INK_ID)

  const part = partitionInkLayers(layers)
  assert.deepEqual(
    part.aboveCards.map((l) => l.id),
    [LAYER_OVERLAY_INK_ID]
  )
  assert.deepEqual(
    part.belowCards.map((l) => l.id),
    [LAYER_BASE_INK_ID]
  )
  assert.equal(part.cardsLayer.id, LAYER_CARDS_ID)
})

test('partitionInkLayers and resolveItemLayerId track layer reordering and legacy items', () => {
  let b: BoardState = { ...EMPTY_BOARD }
  const { layers } = ensureBoardLayers(b)
  // Legacy stroke with undefined layerId falls back to base ink layer
  assert.equal(resolveItemLayerId(undefined, layers), LAYER_BASE_INK_ID)

  // Move base ink layer UP twice so it sits above Cards & Widgets
  b = moveLayer(b, LAYER_BASE_INK_ID, 'up')
  b = moveLayer(b, LAYER_BASE_INK_ID, 'up')
  const part = partitionInkLayers(b.layers!)
  assert.deepEqual(
    part.aboveCards.map((l) => l.id),
    [LAYER_OVERLAY_INK_ID, LAYER_BASE_INK_ID]
  )
  assert.equal(part.belowCards.length, 0)
})

test('locked or hidden active layer falls back cleanly and protects items from edits', () => {
  let b: BoardState = { ...EMPTY_BOARD }
  assert.equal(resolveTargetInkLayerId(b), LAYER_OVERLAY_INK_ID)

  b = toggleLayerLocked(b, LAYER_OVERLAY_INK_ID)
  assert.equal(isItemEditable(LAYER_OVERLAY_INK_ID, b.layers!), false)
  assert.equal(isItemEditable(LAYER_BASE_INK_ID, b.layers!), true)
  assert.equal(resolveTargetInkLayerId(b), LAYER_BASE_INK_ID)

  b = toggleLayerVisible(b, LAYER_BASE_INK_ID)
  assert.equal(isItemEditable(LAYER_BASE_INK_ID, b.layers!), false)
  assert.equal(resolveTargetInkLayerId(b), null)
})

test('addInkLayer & deleteInkLayer reassign items to remaining ink layer without data loss', () => {
  let b: BoardState = {
    ...EMPTY_BOARD,
    strokes: [{ id: 's1', points: [[0, 0, 0.5], [10, 10, 0.5]], color: 'ink', size: 3 }]
  }
  b = addInkLayer(b, 'Markup', 'top')
  const customId = b.activeLayerId!
  b.strokes[0] = { ...b.strokes[0], layerId: customId }

  b = deleteInkLayer(b, customId)
  assert.ok(!b.layers!.some((l) => l.id === customId))
  assert.notEqual(b.strokes[0].layerId, customId)
  assert.ok(b.layers!.some((l) => l.id === b.strokes[0].layerId))
})
