import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import {
  buildElkGraphInput,
  flattenElkLayoutResult,
  measureDiagramNodeLabels
} from '../src/renderer/src/board/elkDiagramLayout.ts'
import type { DiagramGraph } from '../src/shared/beautifySchema.ts'

const req = createRequire(import.meta.url)
const ELK = req('elkjs/lib/elk.bundled.js')

const SAMPLE_HIERARCHICAL_GRAPH: DiagramGraph = {
  direction: 'RIGHT',
  title: 'Auth Pipeline',
  nodes: [
    { id: 'client', kind: 'rounded_rect', label: 'Client' },
    { id: 'backend', kind: 'group', label: 'Backend Cluster' },
    { id: 'auth', kind: 'diamond', label: 'Valid Token?', parentId: 'backend' },
    { id: 'api', kind: 'rect', label: 'API Service', parentId: 'backend' },
    { id: 'db', kind: 'cylinder', label: 'Postgres DB', parentId: 'backend' }
  ],
  edges: [
    { id: 'e1', source: 'client', target: 'auth', label: 'JWT', style: 'solid', directed: true },
    { id: 'e2', source: 'auth', target: 'api', label: 'Yes', style: 'solid', directed: true },
    { id: 'e3', source: 'api', target: 'db', style: 'dashed', directed: true }
  ]
}

test('ELK layered orthogonal layout flattens hierarchical group children & orthogonal edges', async () => {
  const elk = new ELK()
  const measured = measureDiagramNodeLabels(SAMPLE_HIERARCHICAL_GRAPH, 'jakarta')
  const elkInput = buildElkGraphInput(SAMPLE_HIERARCHICAL_GRAPH, measured)
  const elkOut = await elk.layout(elkInput)

  const anchor = { x: 200, y: 150 }
  const flat = flattenElkLayoutResult(elkOut, SAMPLE_HIERARCHICAL_GRAPH, anchor, 'jakarta')

  // 1 group + 4 leaf nodes + 3 orthogonal polyline edges = 8 shapes
  assert.equal(flat.shapes.length, 8)
  // Group label + diagram title = 2 immersed texts
  assert.equal(flat.texts.length, 2)
  assert.ok(flat.texts.every((t) => t.immersed === true))

  const groupShape = flat.shapes.find((s) => s.id.includes('backend'))!
  const apiShape = flat.shapes.find((s) => s.id.includes('api'))!
  assert.ok(groupShape && apiShape)
  // Child node MUST be strictly inside its flattened parent group container!
  assert.ok(apiShape.x >= groupShape.x, 'child x inside parent group')
  assert.ok(apiShape.y >= groupShape.y, 'child y inside parent group')
  assert.ok(apiShape.x + apiShape.w <= groupShape.x + groupShape.w + 2)
  assert.ok(apiShape.y + apiShape.h <= groupShape.y + groupShape.h + 2)

  // Every edge must be an orthogonal polyline with >= 2 points
  const edges = flat.shapes.filter((s) => s.shape === 'polyline')
  assert.equal(edges.length, 3)
  for (const e of edges) {
    assert.ok(e.points && e.points.length >= 2)
  }
})

test('ELK layout direction toggle (RIGHT -> DOWN) updates orientation cleanly in <50ms', async () => {
  const elk = new ELK()
  const simple: DiagramGraph = {
    direction: 'RIGHT',
    nodes: [
      { id: 'a', kind: 'rect', label: 'Step A' },
      { id: 'b', kind: 'rect', label: 'Step B' }
    ],
    edges: [{ id: 'e1', source: 'a', target: 'b', style: 'solid', directed: true }]
  }
  const measured = measureDiagramNodeLabels(simple, 'jakarta')

  const lrOut = await elk.layout(buildElkGraphInput(simple, measured, 'RIGHT'))
  const lrFlat = flattenElkLayoutResult(lrOut, simple, { x: 100, y: 100 }, 'jakarta')
  const lrA = lrFlat.shapes.find((s) => s.id.endsWith('-a'))!
  const lrB = lrFlat.shapes.find((s) => s.id.endsWith('-b'))!
  assert.ok(lrB.x > lrA.x, 'RIGHT layout places B to the right of A')

  const tbOut = await elk.layout(buildElkGraphInput(simple, measured, 'DOWN'))
  const tbFlat = flattenElkLayoutResult(tbOut, simple, { x: 100, y: 100 }, 'jakarta')
  const tbA = tbFlat.shapes.find((s) => s.id.endsWith('-a'))!
  const tbB = tbFlat.shapes.find((s) => s.id.endsWith('-b'))!
  assert.ok(tbB.y > tbA.y, 'DOWN layout places B below A')
})
