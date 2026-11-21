import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildFlowConnectorNode,
  buildGraphFromBoardShapes,
  computeOrthogonalRoute,
  convertConnectorRouting,
  getOppositePort,
  getShapePortHandles,
  getShapePorts,
  isConnectorShape,
  pickNearestPort,
  remapDuplicatedConnectors,
  syncBoundConnectors
} from '../src/renderer/src/board/connectorUtils.ts'
import type { ShapeNode } from '../src/renderer/src/types/board.ts'

test('isConnectorShape distinguishes connector lines/arrows from geometric & library shapes', () => {
  for (const kind of [
    'arrow',
    'polyline',
    'curved-arrow',
    'line',
    'dashed-line',
    'elbow',
    'arrow-bidirectional',
    'anim-line-pulse'
  ]) {
    assert.equal(
      isConnectorShape({ shape: kind as ShapeNode['shape'] }),
      true,
      `Expected ${kind} to be treated as connector`
    )
  }

  for (const kind of ['rect', 'rounded-rect', 'diamond', 'circle', 'fc-database', 'cloud']) {
    assert.equal(
      isConnectorShape({ shape: kind as ShapeNode['shape'] }),
      false,
      `Expected ${kind} to NOT be treated as connector`
    )
  }
})

test('getShapePorts and getShapePortHandles compute exact cardinal midpoints and outward handles', () => {
  const box: ShapeNode = {
    id: 'n1',
    shape: 'rounded-rect',
    x: 100,
    y: 200,
    w: 160,
    h: 80
  }

  const ports = getShapePorts(box)
  assert.deepEqual(ports.top, { x: 180, y: 200 })
  assert.deepEqual(ports.right, { x: 260, y: 240 })
  assert.deepEqual(ports.bottom, { x: 180, y: 280 })
  assert.deepEqual(ports.left, { x: 100, y: 240 })

  const handlesZoom2 = getShapePortHandles(box, 2)
  const rightHandle = handlesZoom2.find((h) => h.port === 'right')!
  assert.equal(rightHandle.anchorX, 260)
  assert.equal(rightHandle.anchorY, 240)
  assert.equal(rightHandle.dotX, 260 + 16 / 2)
  assert.equal(rightHandle.dotY, 240)

  assert.equal(getOppositePort('right'), 'left')
  assert.equal(getOppositePort('top'), 'bottom')
})

test('pickNearestPort chooses the closest cardinal port to any external target coordinate', () => {
  const box: ShapeNode = {
    id: 'n1',
    shape: 'rect',
    x: 100,
    y: 100,
    w: 100,
    h: 100
  }

  assert.equal(pickNearestPort(box, { x: 320, y: 145 }), 'right')
  assert.equal(pickNearestPort(box, { x: 10, y: 150 }), 'left')
  assert.equal(pickNearestPort(box, { x: 150, y: 20 }), 'top')
  assert.equal(pickNearestPort(box, { x: 150, y: 290 }), 'bottom')
})

test('computeOrthogonalRoute produces clean orthogonal segments for facing, wrap-around, perpendicular, and same-side ports', () => {
  // 1. Facing ports (right -> left)
  const facing = computeOrthogonalRoute(
    { x: 200, y: 100 },
    'right',
    { x: 400, y: 220 },
    'left'
  )
  assert.deepEqual(facing[0], [200, 100])
  assert.deepEqual(facing[facing.length - 1], [400, 220])
  for (let i = 0; i < facing.length - 1; i++) {
    const dx = Math.abs(facing[i + 1][0] - facing[i][0])
    const dy = Math.abs(facing[i + 1][1] - facing[i][1])
    assert.ok(dx === 0 || dy === 0, `Segment ${i} is not orthogonal`)
  }

  // 2. Wrap-around opposing ports (target is behind source right -> left)
  const wrap = computeOrthogonalRoute(
    { x: 400, y: 100 },
    'right',
    { x: 150, y: 260 },
    'left'
  )
  assert.deepEqual(wrap[0], [400, 100])
  assert.deepEqual(wrap[wrap.length - 1], [150, 260])
  assert.ok(wrap[1][0] > 400, 'Should exit rightward from source right port before wrapping')
  assert.ok(
    wrap[wrap.length - 2][0] < 150,
    'Should approach target left port from the left'
  )

  // 3. Perpendicular ports (right -> top)
  const perp = computeOrthogonalRoute(
    { x: 200, y: 100 },
    'right',
    { x: 360, y: 240 },
    'top'
  )
  assert.deepEqual(perp[0], [200, 100])
  assert.deepEqual(perp[perp.length - 1], [360, 240])

  // 4. Same-side ports (right -> right)
  const sameSide = computeOrthogonalRoute(
    { x: 200, y: 100 },
    'right',
    { x: 240, y: 240 },
    'right'
  )
  assert.deepEqual(sameSide[0], [200, 100])
  assert.deepEqual(sameSide[sameSide.length - 1], [240, 240])
  assert.ok(sameSide[1][0] > 240, 'Same-side right ports should clear rightmost x')
})

test('buildFlowConnectorNode and syncBoundConnectors dynamically re-route when bound shapes move or resize', () => {
  const nodeA: ShapeNode = {
    id: 'node-a',
    shape: 'rounded-rect',
    x: 100,
    y: 100,
    w: 140,
    h: 80,
    label: 'API Gateway'
  }
  const nodeB: ShapeNode = {
    id: 'node-b',
    shape: 'cylinder',
    x: 400,
    y: 180,
    w: 140,
    h: 90,
    label: 'Postgres'
  }

  const conn = buildFlowConnectorNode({
    source: nodeA,
    sourcePort: 'right',
    target: nodeB,
    targetPort: 'left'
  })

  assert.equal(conn.shape, 'polyline')
  assert.equal(conn.routing, 'orthogonal')
  assert.deepEqual(conn.startBinding, { shapeId: 'node-a', port: 'right' })
  assert.deepEqual(conn.endBinding, { shapeId: 'node-b', port: 'left' })
  assert.deepEqual(conn.points?.[0], [240, 140])
  assert.deepEqual(conn.points?.[conn.points.length - 1], [400, 225])

  // Move nodeB and resize nodeA -> syncBoundConnectors must update connector endpoints
  const movedShapes = syncBoundConnectors([
    { ...nodeA, w: 180 },
    { ...nodeB, x: 520, y: 260 },
    conn
  ])
  const updatedConn = movedShapes.find((s) => s.id === conn.id)!
  assert.deepEqual(updatedConn.points?.[0], [280, 140])
  assert.deepEqual(updatedConn.points?.[updatedConn.points.length - 1], [520, 305])
})

test('convertConnectorRouting switches cleanly between orthogonal, curved, and straight connectors', () => {
  const nodeA: ShapeNode = { id: 'a', shape: 'rect', x: 100, y: 100, w: 120, h: 60 }
  const nodeB: ShapeNode = { id: 'b', shape: 'rect', x: 360, y: 200, w: 120, h: 60 }
  const conn = buildFlowConnectorNode({
    source: nodeA,
    sourcePort: 'right',
    target: nodeB,
    targetPort: 'left'
  })
  const map = new Map<string, ShapeNode>([
    [nodeA.id, nodeA],
    [nodeB.id, nodeB],
    [conn.id, conn]
  ])

  const curved = convertConnectorRouting(conn, 'curved', map)
  assert.equal(curved.shape, 'curved-arrow')
  assert.equal(curved.routing, 'curved')
  assert.ok(Array.isArray(curved.controlPoint))
  assert.equal(curved.points, undefined)
  assert.deepEqual(curved.startBinding, conn.startBinding)
  assert.deepEqual(curved.endBinding, conn.endBinding)

  const straight = convertConnectorRouting(curved, 'straight', map)
  assert.equal(straight.shape, 'arrow')
  assert.equal(straight.routing, 'straight')
  assert.equal(straight.controlPoint, undefined)
  assert.equal(straight.points, undefined)
  assert.equal(straight.x, 220)
  assert.equal(straight.y, 130)
  assert.equal(straight.w, 140)
  assert.equal(straight.h, 100)

  const backToOrtho = convertConnectorRouting(straight, 'orthogonal', map)
  assert.equal(backToOrtho.shape, 'polyline')
  assert.equal(backToOrtho.routing, 'orthogonal')
  assert.ok((backToOrtho.points?.length ?? 0) >= 2)
})

test('remapDuplicatedConnectors rebinds cloned connectors to cloned shape IDs', () => {
  const origA: ShapeNode = { id: 'a', shape: 'rect', x: 100, y: 100, w: 100, h: 60 }
  const origB: ShapeNode = { id: 'b', shape: 'rect', x: 300, y: 100, w: 100, h: 60 }
  const origConn = buildFlowConnectorNode({
    source: origA,
    sourcePort: 'right',
    target: origB,
    targetPort: 'left'
  })

  const idMap = new Map<string, string>([
    ['a', 'a-clone'],
    ['b', 'b-clone'],
    [origConn.id, 'conn-clone']
  ])
  const clonedShapes: ShapeNode[] = [
    { ...origA, id: 'a-clone', x: origA.x + 30, y: origA.y + 30 },
    { ...origB, id: 'b-clone', x: origB.x + 30, y: origB.y + 30 },
    { ...origConn, id: 'conn-clone', x: origConn.x + 30, y: origConn.y + 30 }
  ]

  const remapped = remapDuplicatedConnectors(clonedShapes, idMap)
  const clonedConn = remapped.find((s) => s.id === 'conn-clone')!
  assert.deepEqual(clonedConn.startBinding, { shapeId: 'a-clone', port: 'right' })
  assert.deepEqual(clonedConn.endBinding, { shapeId: 'b-clone', port: 'left' })
  assert.deepEqual(clonedConn.points?.[0], [230, 160])
  assert.deepEqual(clonedConn.points?.[clonedConn.points.length - 1], [330, 160])
})

test('buildGraphFromBoardShapes extracts ELK DiagramGraph when 2+ shapes are linked by live connectors', () => {
  const s1: ShapeNode = {
    id: 's1',
    shape: 'rounded-rect',
    x: 80,
    y: 120,
    w: 140,
    h: 70,
    label: 'Client'
  }
  const s2: ShapeNode = {
    id: 's2',
    shape: 'diamond',
    x: 320,
    y: 110,
    w: 120,
    h: 90,
    label: 'Auth?'
  }
  const conn = buildFlowConnectorNode({
    source: s1,
    sourcePort: 'right',
    target: s2,
    targetPort: 'left'
  })

  // Should find connecting edges even when user only selected the 2 boxes
  const extracted = buildGraphFromBoardShapes([s1, s2], [s1, s2, conn])
  assert.ok(extracted)
  assert.equal(extracted.graph.nodes.length, 2)
  assert.equal(extracted.graph.edges.length, 1)
  assert.equal(extracted.graph.edges[0].source, 's1')
  assert.equal(extracted.graph.edges[0].target, 's2')
  assert.deepEqual(extracted.anchor, { x: 80, y: 110 })

  // Returns null if no connectors link the selected shapes
  assert.equal(buildGraphFromBoardShapes([s1, s2], [s1, s2]), null)
})
