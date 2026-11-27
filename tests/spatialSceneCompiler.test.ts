import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compileSpatialScene } from '../src/renderer/src/board/spatialSceneCompiler.ts'
import type { SpatialScene } from '../src/shared/beautifySchema.ts'

test('compileSpatialScene builds open-top vertical cell strip with sharp borders, extension walls, bent arrow, and non-overlapping text', () => {
  const scene: SpatialScene = {
    title: 'Stack Push/Pop',
    elements: [
      {
        type: 'cell_strip',
        id: 'stack1',
        orientation: 'vertical',
        x: 380,
        y: 260,
        w: 240,
        h: 520,
        cells: ['C', 'B', 'A'],
        openEnds: ['start']
      },
      {
        type: 'connector',
        id: 'entry_arr',
        points: [
          [260, 320],
          [264, 700] // slightly tilted ~0.5 deg -> should snap vertical!
        ],
        arrowEnd: true,
        style: 'solid'
      },
      {
        type: 'connector',
        id: 'exit_arr',
        points: [
          [500, 230],
          [502, 110],
          [660, 112]
        ],
        arrowEnd: true,
        style: 'solid'
      },
      {
        type: 'text',
        id: 'lbl_entry',
        x: 180,
        y: 440,
        text: 'Entry',
        align: 'center',
        bold: true
      },
      {
        type: 'text',
        id: 'lbl_exit',
        x: 730,
        y: 110,
        text: 'Exit',
        align: 'left',
        bold: true
      }
    ]
  }

  const res = compileSpatialScene(
    scene,
    { x: 100, y: 100, width: 500, height: 420 },
    'mono'
  )

  const cellRects = res.shapes.filter((s) => s.shape === 'rect')
  assert.equal(cellRects.length, 3, 'Expected 3 uniform stack cells')
  assert.deepEqual(
    cellRects.map((c) => c.label),
    ['C', 'B', 'A']
  )
  assert.ok(
    cellRects.every((c) => c.borderRadius === 0),
    'Cells must have razor-sharp corner radius 0'
  )
  assert.ok(
    cellRects[0].y < cellRects[1].y && cellRects[1].y < cellRects[2].y,
    'Cells should stack top-to-bottom seamlessly'
  )
  assert.equal(cellRects[0].y + cellRects[0].h, cellRects[1].y, 'Adjacent cell walls must touch exactly')

  // Open-top side extension walls
  const walls = res.shapes.filter((s) => s.shape === 'line' && s.arrowEnd === false)
  assert.equal(walls.length, 2, 'Expected 2 extending open-top side rails')
  assert.equal(walls[0].x, cellRects[0].x)
  assert.equal(walls[1].x, cellRects[0].x + cellRects[0].w)

  // Entry straight arrow snapped cleanly vertical
  const entryArr = res.shapes.find((s) => s.shape === 'arrow')
  assert.ok(entryArr, 'Expected straight arrow for Entry')
  assert.equal(entryArr!.w, 0, 'Slightly tilted vertical arrow must snap to dx = 0')

  // Exit bent orthogonal polyline snapped cleanly to axis
  const exitPoly = res.shapes.find((s) => s.shape === 'polyline')
  assert.ok(exitPoly && exitPoly.points && exitPoly.points.length === 3, 'Expected 3-pt bent Exit polyline')
  assert.equal(exitPoly!.points![0][0], exitPoly!.points![1][0], 'Vertical leg must be exact')
  assert.equal(exitPoly!.points![1][1], exitPoly!.points![2][1], 'Horizontal leg must be exact')

  // Board-immersed frameless labels
  assert.equal(res.texts.length, 2)
  assert.ok(
    res.texts.every((t) => t.immersed === true && t.bg === 'transparent' && t.fontFamily === 'mono'),
    'Labels must be frameless board-immersed text with selected font'
  )
})

test('compileSpatialScene supports horizontal dual-open strip and resolves label collisions', () => {
  const scene: SpatialScene = {
    elements: [
      {
        type: 'cell_strip',
        id: 'queue1',
        orientation: 'horizontal',
        x: 250,
        y: 400,
        w: 500,
        h: 160,
        cells: ['A', 'B', 'C'],
        openEnds: ['start', 'end']
      },
      {
        type: 'text',
        id: 'overlap_lbl',
        // Intentionally placed right over top wall of strip -> compiler should push it clear!
        x: 350,
        y: 410,
        text: 'front',
        align: 'center'
      }
    ]
  }

  const res = compileSpatialScene(
    scene,
    { x: 0, y: 0, width: 600, height: 400 },
    'jakarta'
  )

  const cellRects = res.shapes.filter((s) => s.shape === 'rect')
  assert.equal(cellRects.length, 3)
  assert.equal(cellRects[0].x + cellRects[0].w, cellRects[1].x)
  assert.equal(cellRects[1].x + cellRects[1].w, cellRects[2].x)

  const rails = res.shapes.filter((s) => s.shape === 'line' && s.arrowEnd === false)
  assert.equal(rails.length, 4, 'Expected 2 left + 2 right horizontal pipe rails')

  const frontTxt = res.texts[0]
  assert.ok(frontTxt, 'Expected front text node')
  // Check that collision solver pushed label above or below the cells instead of inside the border
  const insideY = frontTxt.y + 12 > cellRects[0].y && frontTxt.y < cellRects[0].y + cellRects[0].h
  assert.equal(insideY, false, 'Collision avoidance should push external text clear of container box')
})

test('compileSpatialScene spaces linked list strips into separate nodes with gap arrows and filters internal strip connectors', () => {
  const llScene: SpatialScene = {
    title: 'Singly Linked List',
    elements: [
      {
        type: 'cell_strip',
        id: 'll_strip',
        orientation: 'horizontal',
        x: 150,
        y: 350,
        w: 600,
        h: 120,
        cells: ['Head', 'Node 1', 'Node 2', 'Node 3']
      },
      // Rogue connector inside strip interior that previously slashed through text
      {
        type: 'connector',
        id: 'rogue_internal',
        points: [
          [180, 410],
          [700, 410]
        ],
        arrowEnd: true
      }
    ]
  }

  const res = compileSpatialScene(
    llScene,
    { x: 100, y: 100, width: 640, height: 320 },
    'jakarta'
  )

  const nodeBoxes = res.shapes.filter((s) => s.shape === 'rounded-rect')
  assert.equal(nodeBoxes.length, 4, 'Expected 4 separated linked list node boxes')
  assert.ok(
    nodeBoxes[1].x > nodeBoxes[0].x + nodeBoxes[0].w + 20,
    'Linked list nodes must have horizontal gap between boxes'
  )

  const gapArrows = res.shapes.filter((s) => s.shape === 'arrow')
  assert.equal(gapArrows.length, 3, 'Expected 3 clean gap arrows between the 4 nodes (rogue internal arrow dropped)')
  // Every arrow must lie strictly in the gap between consecutive nodes, never overlapping node text
  for (let i = 0; i < gapArrows.length; i++) {
    const arr = gapArrows[i]
    const leftBox = nodeBoxes[i]
    const rightBox = nodeBoxes[i + 1]
    assert.ok(arr.x >= leftBox.x + leftBox.w, 'Arrow must start at or outside right border of source node')
    assert.ok(arr.x + arr.w <= rightBox.x, 'Arrow must end at or outside left border of target node')
  }
})

test('compileSpatialScene keeps interior labels inside rounded_rect panels without ejecting them onto cell_strips', () => {
  const scene: SpatialScene = {
    title: 'Traversal Modes',
    elements: [
      {
        type: 'shape',
        id: 'left_panel',
        kind: 'rounded_rect',
        x: 60,
        y: 80,
        w: 420,
        h: 760,
        fill: '#EEF2FF',
        stroke: '#6366F1'
      },
      {
        type: 'text',
        id: 'hdr_left',
        x: 270,
        y: 135,
        text: 'BFS (Breadth-First)',
        fontSize: 20,
        bold: true,
        align: 'center'
      },
      {
        type: 'cell_strip',
        id: 'bfs_queue',
        orientation: 'horizontal',
        x: 100,
        y: 520,
        w: 340,
        h: 110,
        cells: ['A', 'B', 'C']
      },
      {
        type: 'text',
        id: 'ftr_left',
        x: 270,
        y: 770,
        text: 'Sample Path: A -> B -> C',
        fontSize: 12,
        bold: false,
        align: 'center'
      }
    ]
  }

  const res = compileSpatialScene(scene, { x: 100, y: 100, width: 640, height: 480 }, 'jakarta')
  const panel = res.shapes.find((s) => s.shape === 'rounded-rect')
  const stripCells = res.shapes.filter((s) => s.shape === 'rect')
  const hdr = res.texts.find((t) => t.text.includes('BFS'))
  const ftr = res.texts.find((t) => t.text.includes('Sample Path'))

  assert.ok(panel, 'Expected rounded_rect panel shape')
  assert.ok(stripCells.length === 3, 'Expected 3 cell_strip rects')
  assert.ok(hdr, 'Expected header text')
  assert.ok(ftr, 'Expected footer text')

  // Header and footer must remain strictly inside the panel's vertical bounds (never kicked below panel.y + panel.h)
  assert.ok(hdr!.y >= panel!.y && hdr!.y < panel!.y + panel!.h, 'Header should stay inside panel')
  assert.ok(
    ftr!.y >= panel!.y && ftr!.y + 18 <= panel!.y + panel!.h,
    `Footer (${ftr!.y}) should stay inside panel [${panel!.y}, ${panel!.y + panel!.h}]`
  )
  // Footer must not collide with the cell_strip above it
  const stripBottom = Math.max(...stripCells.map((c) => c.y + c.h))
  assert.ok(ftr!.y >= stripBottom, `Footer (${ftr!.y}) should stay clear below cell_strip (${stripBottom})`)
  // Explicit small fontSize (12) should be respected (< 15)
  assert.ok(ftr!.fontSize < 15, `Expected compact fontSize < 15, got ${ftr!.fontSize}`)
})
