import test from 'node:test'
import assert from 'node:assert/strict'
import {
  collectOccupiedBoardRects,
  findEmptyBoardRect,
  planEmptyClusterLayout,
  rectsOverlap,
  type BoxRect
} from '../src/renderer/src/board/placementUtils.ts'
import type { BoardState, CanvasTransform } from '../src/renderer/src/types/board.ts'

function makeEmptyBoard(): BoardState {
  return {
    strokes: [],
    textNodes: [],
    equationNodes: [],
    shapeNodes: [],
    diagramNodes: [],
    vectorArtNodes: [],
    vectorDiagramMeta: {},
    codeNodes: [],
    videoNodes: []
  }
}

test('collectOccupiedBoardRects captures notes, diagrams, polylines, strokes, and vectorArtNodes', () => {
  const board = makeEmptyBoard()
  board.textNodes.push({
    id: 'n1',
    x: 100,
    y: 120,
    w: 280,
    h: 160,
    text: 'Note',
    fontSize: 15,
    color: 'ink',
    source: 'manual',
    createdAt: 1
  })
  board.shapeNodes.push({
    id: 'arr1',
    shape: 'arrow',
    x: 600,
    y: 300,
    w: -120,
    h: -60,
    color: 'ink'
  })
  board.vectorArtNodes?.push({
    id: 'va1',
    kind: 'vector_art',
    x: 820,
    y: 200,
    width: 180,
    height: 150,
    viewBoxWidth: 180,
    viewBoxHeight: 150,
    layers: [],
    createdAt: 1
  })
  board.strokes.push({
    id: 'st1',
    points: [
      [50, 500, 0.5],
      [150, 580, 0.5]
    ],
    color: 'ink',
    size: 4
  })

  const rects = collectOccupiedBoardRects(board)
  assert.equal(rects.length, 4)
  assert.deepEqual(rects[0], { x: 100, y: 120, w: 280, h: 160 })
  assert.deepEqual(rects[1], { x: 820, y: 200, w: 180, h: 150 })
  assert.deepEqual(rects[2], { x: 480, y: 240, w: 120, h: 60 })
})

test('findEmptyBoardRect avoids occupied viewport center and allocates non-overlapping space', () => {
  const view: CanvasTransform = { zoom: 1, panX: 0, panY: 0 }
  const screenSafe = { left: 84, top: 68, right: 900, bottom: 720 }
  const occupied: BoxRect[] = [
    { x: 250, y: 180, w: 500, h: 420 }
  ]

  const alloc = findEmptyBoardRect(occupied, 340, 220, view, screenSafe, { gap: 24 })
  const placed: BoxRect = { x: alloc.x, y: alloc.y, w: 340, h: 220 }
  for (const occ of occupied) {
    assert.equal(rectsOverlap(placed, occ, 24), false)
  }
})

test('planEmptyClusterLayout packs multi-item cluster into a single empty region with zero overlaps', () => {
  const view: CanvasTransform = { zoom: 1, panX: 0, panY: 0 }
  const screenSafe = { left: 84, top: 68, right: 860, bottom: 700 }
  const occupied: BoxRect[] = [
    { x: 90, y: 80, w: 720, h: 580 }
  ]

  const cluster = planEmptyClusterLayout(
    occupied,
    [
      { key: 'diagram', w: 520, h: 420 },
      { key: 'note', w: 340, h: 220 },
      { key: 'equation', w: 300, h: 96 }
    ],
    view,
    screenSafe,
    { gap: 28, clusterGap: 36 }
  )

  assert.ok(cluster.nextPan !== undefined, 'Expected nextPan when visible area is full')

  const itemBoxes: BoxRect[] = [
    { ...cluster.positions.diagram, w: 520, h: 420 },
    { ...cluster.positions.note, w: 340, h: 220 },
    { ...cluster.positions.equation, w: 300, h: 96 }
  ]

  for (const box of itemBoxes) {
    assert.equal(rectsOverlap(box, occupied[0], 24), false, 'Cluster item overlapped existing content')
  }
  for (let i = 0; i < itemBoxes.length; i++) {
    for (let j = i + 1; j < itemBoxes.length; j++) {
      assert.equal(rectsOverlap(itemBoxes[i], itemBoxes[j], 16), false, 'Cluster items overlapped each other')
    }
  }
})
