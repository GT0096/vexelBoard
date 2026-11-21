import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { compileFlowDiagramToBoardElements } from '../src/renderer/src/board/nativeDiagramCompiler.ts'
import {
  buildElkGraphInput,
  flattenElkLayoutResult,
  measureDiagramNodeLabels
} from '../src/renderer/src/board/elkDiagramLayout.ts'
import { compileSpatialScene } from '../src/renderer/src/board/spatialSceneCompiler.ts'
import type { DiagramGraph, SpatialScene } from '../src/shared/beautifySchema.ts'

const req = createRequire(import.meta.url)
const ELK = req('elkjs/lib/elk.bundled.js')

describe('Unified board-native diagram pipeline', () => {
  it('compiles flow nodes & edges directly to native ShapeNodes, immersed title TextNode, and bound orthogonal polylines', () => {
    const res = compileFlowDiagramToBoardElements(
      {
        title: 'API Request Flow',
        diagramType: 'architecture',
        nodes: [
          { id: 'n1', type: 'cloud', position: { x: 0, y: 0 }, data: { label: 'API Gateway' } },
          { id: 'n2', type: 'decision', position: { x: 260, y: 0 }, data: { label: 'Valid JWT?' } },
          { id: 'n3', type: 'database', position: { x: 520, y: 0 }, data: { label: 'Users DB' } }
        ],
        edges: [
          { id: 'e1', source: 'n1', target: 'n2', label: 'Auth Check' },
          { id: 'e2', source: 'n2', target: 'n3', label: 'Query User' }
        ]
      },
      { x: 180, y: 120 },
      { fontFamily: 'grotesk', layerId: 'layer-base-ink' }
    )

    assert.equal(res.title, 'API Request Flow')
    assert.equal(res.texts.length, 1)
    assert.equal(res.texts[0].immersed, true)
    assert.equal(res.texts[0].bg, 'transparent')
    assert.equal(res.texts[0].fontFamily, 'grotesk')
    assert.ok(res.texts[0].id.includes(`-${res.groupId}`))

    const nodeShapes = res.shapes.filter((s) => !s.startBinding && !s.endBinding)
    const connShapes = res.shapes.filter((s) => s.shape === 'polyline')
    assert.equal(nodeShapes.length, 3)
    assert.equal(connShapes.length, 2)

    assert.deepEqual(
      nodeShapes.map((s) => s.shape),
      ['cloud', 'diamond', 'cylinder']
    )

    const nodeIds = new Set(nodeShapes.map((s) => s.id))
    for (const c of connShapes) {
      assert.equal(c.routing, 'orthogonal')
      assert.ok(c.points && c.points.length >= 2)
      assert.ok(c.startBinding && nodeIds.has(c.startBinding.shapeId))
      assert.ok(c.endBinding && nodeIds.has(c.endBinding.shapeId))
      assert.equal(c.vectorGroupId, res.groupId)
      assert.equal(c.layerId, 'layer-base-ink')
    }

    assert.ok(res.meta.graph)
    assert.equal(res.meta.graph?.nodes.length, 3)
    assert.equal(res.meta.graph?.edges.length, 2)
  })

  it('assigns topological flowStage, flowTotalStages, and pulse animationMode when animateFlow or edge.animated is set', () => {
    const res = compileFlowDiagramToBoardElements(
      {
        title: 'Animated Inference Pipeline',
        nodes: [
          { id: 'tok', type: 'ml-token-vector', position: { x: 0, y: 0 }, data: { label: 'Tokens' } },
          { id: 'ffn', type: 'ml-neural-net', position: { x: 0, y: 140 }, data: { label: 'FFN Layer' } },
          { id: 'add', type: 'ml-adder', position: { x: 0, y: 340 }, data: { label: '' } }
        ],
        edges: [
          { id: 'e1', source: 'tok', target: 'ffn', animated: true },
          { id: 'e2', source: 'ffn', target: 'add', animated: true }
        ]
      },
      { x: 100, y: 100 },
      { animateFlow: true }
    )

    const ffn = res.shapes.find((s) => s.shape === 'ml-neural-net')
    const tok = res.shapes.find((s) => s.shape === 'ml-token-vector')
    const adder = res.shapes.find((s) => s.shape === 'ml-adder')
    assert.ok(ffn && tok && adder)

    assert.equal(tok.flowStage, 0)
    assert.equal(ffn.flowStage, 1)
    assert.equal(adder.flowStage, 2)
    assert.equal(ffn.animated, true)

    const edges = res.shapes.filter((s) => s.shape === 'polyline')
    assert.equal(edges.length, 2)
    assert.equal(edges[0].animationMode, 'pulse')
    assert.equal(edges[0].flowStage, 0)
    assert.equal(edges[1].animationMode, 'pulse')
    assert.equal(edges[1].flowStage, 1)
    assert.ok((edges[0].flowTotalStages ?? 0) >= 3)
    assert.ok(edges[0].pulseColor && edges[1].pulseColor)
  })

  it('attaches live startBinding and endBinding to ELK-flattened edges in flattenElkLayoutResult', async () => {
    const elk = new ELK()
    const graph: DiagramGraph = {
      direction: 'RIGHT',
      title: 'ELK Bound Graph',
      nodes: [
        { id: 'a', kind: 'rounded_rect', label: 'Ingress' },
        { id: 'b', kind: 'cylinder', label: 'Store' }
      ],
      edges: [{ id: 'e1', source: 'a', target: 'b', style: 'solid', directed: true }]
    }
    const measured = measureDiagramNodeLabels(graph, 'jakarta')
    const elkOut = await elk.layout(buildElkGraphInput(graph, measured))
    const flat = flattenElkLayoutResult(elkOut, graph, { x: 80, y: 80 }, 'jakarta')

    const vedge = flat.shapes.find((s) => s.id.startsWith('vedge-'))
    const srcNode = flat.shapes.find((s) => s.id.endsWith('-a'))
    const tgtNode = flat.shapes.find((s) => s.id.endsWith('-b'))
    assert.ok(vedge && srcNode && tgtNode)
    assert.equal(vedge.routing, 'orthogonal')
    assert.equal(vedge.startBinding?.shapeId, srcNode.id)
    assert.equal(vedge.endBinding?.shapeId, tgtNode.id)
  })

  it('attaches live startBinding and endBinding to linked-list pointers and connected spatial shapes in compileSpatialScene', () => {
    const llScene: SpatialScene = {
      title: 'Linked List & Box Flow',
      elements: [
        {
          type: 'cell_strip',
          id: 'list',
          orientation: 'horizontal',
          x: 80,
          y: 120,
          w: 520,
          h: 110,
          cells: ['Head', 'Node 1', 'Node 2']
        },
        {
          type: 'shape',
          id: 'src_box',
          kind: 'rounded_rect',
          x: 120,
          y: 420,
          w: 180,
          h: 120,
          label: 'Producer'
        },
        {
          type: 'shape',
          id: 'dst_box',
          kind: 'rounded_rect',
          x: 520,
          y: 420,
          w: 180,
          h: 120,
          label: 'Consumer'
        },
        {
          type: 'connector',
          id: 'flow_conn',
          fromId: 'src_box',
          toId: 'dst_box',
          points: [
            [300, 480],
            [520, 480]
          ],
          arrowEnd: true
        }
      ]
    }

    const res = compileSpatialScene(
      llScene,
      { x: 100, y: 100, width: 700, height: 500 },
      'jakarta'
    )

    const llArrows = res.shapes.filter((s) => s.id.startsWith('vsp-ll-ptr-'))
    assert.equal(llArrows.length, 2)
    for (const arr of llArrows) {
      assert.ok(arr.startBinding?.shapeId.startsWith('vsp-cell-'))
      assert.ok(arr.endBinding?.shapeId.startsWith('vsp-cell-'))
      assert.equal(arr.startBinding?.port, 'right')
      assert.equal(arr.endBinding?.port, 'left')
    }

    const boxConn = res.shapes.find((s) => s.id.startsWith('vsp-conn-'))
    assert.ok(boxConn)
    assert.ok(boxConn.startBinding)
    assert.ok(boxConn.endBinding)
    assert.notEqual(boxConn.startBinding?.shapeId, boxConn.endBinding?.shapeId)
  })
})
