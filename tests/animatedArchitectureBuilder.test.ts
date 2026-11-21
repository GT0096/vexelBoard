import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  assignTopologicalFlowStages,
  buildTransformerVsMoEAnimatedDiagram,
  computePointAlongPolyline,
  computePointAlongQuadraticCurve,
  computePulseWaveState
} from '../src/renderer/src/board/animatedArchitectureBuilder.ts'
import type { ShapeNode } from '../src/renderer/src/types/board.ts'

describe('animatedArchitectureBuilder', () => {
  it('interpolates coordinates accurately along multi-segment orthogonal polylines', () => {
    const pts: Array<[number, number]> = [
      [100, 100],
      [100, 200],
      [300, 200]
    ]
    const pStart = computePointAlongPolyline(pts, 0)
    assert.equal(pStart.x, 100)
    assert.equal(pStart.y, 100)
    assert.equal(pStart.totalLength, 300)

    const pEnd = computePointAlongPolyline(pts, 1)
    assert.equal(pEnd.x, 300)
    assert.equal(pEnd.y, 200)

    // Total length = 100 + 200 = 300. At t = 1/3 (distance 100), point is at the corner [100, 200]
    const corner = computePointAlongPolyline(pts, 1 / 3)
    assert.ok(Math.abs(corner.x - 100) < 1e-6)
    assert.ok(Math.abs(corner.y - 200) < 1e-6)
  })

  it('evaluates points along a quadratic Bezier curve', () => {
    const p0: [number, number] = [0, 0]
    const ctrl: [number, number] = [50, 100]
    const p2: [number, number] = [100, 0]
    const s0 = computePointAlongQuadraticCurve(p0, ctrl, p2, 0)
    assert.equal(s0.x, 0)
    assert.equal(s0.y, 0)
    const sMid = computePointAlongQuadraticCurve(p0, ctrl, p2, 0.5)
    assert.equal(sMid.x, 50)
    assert.equal(sMid.y, 50)
    const sEnd = computePointAlongQuadraticCurve(p0, ctrl, p2, 1)
    assert.equal(sEnd.x, 100)
    assert.equal(sEnd.y, 0)
  })

  it('synchronizes stage-based pulse waves and loops single-stage connectors', () => {
    const stageDuration = 720
    // Stage 0 active at t = 360ms (halfway through stage 0)
    const s0 = computePulseWaveState(360, 0, 6, stageDuration)
    assert.equal(s0.active, true)
    assert.ok(Math.abs(s0.progress - 0.5) < 1e-6)

    // Stage 2 inactive at t = 360ms
    const s2 = computePulseWaveState(360, 2, 6, stageDuration)
    assert.equal(s2.active, false)

    // Stage 2 active at t = 2 * 720 + 180 = 1620ms (progress 0.25)
    const s2Active = computePulseWaveState(1620, 2, 6, stageDuration)
    assert.equal(s2Active.active, true)
    assert.ok(Math.abs(s2Active.progress - 0.25) < 1e-6)

    // Unstaged connector loops continuously
    const continuous = computePulseWaveState(700)
    assert.equal(continuous.active, true)
    assert.ok(continuous.progress > 0 && continuous.progress < 1)
  })

  it('assigns topological wave stages across connected board shapes and connectors', () => {
    const shapes: ShapeNode[] = [
      { id: 'n1', shape: 'rounded-rect', x: 100, y: 100, w: 120, h: 40, color: 'ink' },
      { id: 'n2', shape: 'rounded-rect', x: 100, y: 200, w: 120, h: 40, color: 'ink' },
      { id: 'n3', shape: 'ml-neural-net', x: 100, y: 300, w: 140, h: 90, color: 'ink' },
      {
        id: 'e1',
        shape: 'arrow',
        x: 160,
        y: 140,
        w: 0,
        h: 60,
        color: 'ink',
        startBinding: { shapeId: 'n1', port: 'bottom' },
        endBinding: { shapeId: 'n2', port: 'top' }
      },
      {
        id: 'e2',
        shape: 'arrow',
        x: 160,
        y: 240,
        w: 0,
        h: 60,
        color: 'ink',
        startBinding: { shapeId: 'n2', port: 'bottom' },
        endBinding: { shapeId: 'n3', port: 'top' }
      }
    ]

    const synced = assignTopologicalFlowStages(shapes)
    const byId = new Map(synced.map((s) => [s.id, s]))

    assert.equal(byId.get('e1')?.animated, true)
    assert.equal(byId.get('e1')?.animationMode, 'pulse')
    assert.equal(byId.get('e1')?.flowStage, 0)
    assert.equal(byId.get('e2')?.flowStage, 1)
    assert.equal(byId.get('n1')?.flowStage, 0)
    assert.equal(byId.get('n2')?.flowStage, 1)
    assert.equal(byId.get('n3')?.flowStage, 2)
    assert.ok((byId.get('e1')?.flowTotalStages ?? 0) >= 2)
  })

  it('builds the complete animated Transformer vs. Mixture of Experts architecture diagram', () => {
    const res = buildTransformerVsMoEAnimatedDiagram({ x: 120, y: 80 }, 'jakarta', 'layer-base-ink')

    assert.ok(res.shapes.length >= 60, `Expected >= 60 shapes, got ${res.shapes.length}`)
    assert.ok(res.texts.length >= 7, `Expected >= 7 texts, got ${res.texts.length}`)

    // Verify neural network blocks (1 Transformer FFN + 4 MoE Experts = 5 ml-neural-net nodes)
    const neuralNets = res.shapes.filter((s) => s.shape === 'ml-neural-net')
    assert.equal(neuralNets.length, 5)

    // Verify active vs idle MoE experts
    const activeNets = neuralNets.filter((s) => s.animated)
    const idleNets = neuralNets.filter((s) => !s.animated && s.strokeStyle === 'dashed')
    assert.equal(activeNets.length, 3) // Transformer FFN + MoE Expert 1 & Expert 3
    assert.equal(idleNets.length, 2) // MoE Expert 2 & Expert 4

    // Verify token vectors (4 inputs + 4 outputs per column * 2 columns = 16)
    const tokens = res.shapes.filter((s) => s.shape === 'ml-token-vector')
    assert.equal(tokens.length, 16)

    // Verify residual adder circles (2 per column * 2 columns = 4)
    const adders = res.shapes.filter((s) => s.shape === 'ml-adder')
    assert.equal(adders.length, 4)

    // Verify stage-synchronized animated pulse connectors across all 6 stages (0..5)
    const animatedPulses = res.shapes.filter(
      (s) => s.animated && s.animationMode === 'pulse' && typeof s.flowStage === 'number'
    )
    assert.ok(animatedPulses.length >= 30)
    const stagesPresent = new Set(animatedPulses.map((s) => s.flowStage))
    for (let st = 0; st < 6; st++) {
      assert.equal(stagesPresent.has(st), true, `Missing animated pulse stage ${st}`)
    }
  })
})
