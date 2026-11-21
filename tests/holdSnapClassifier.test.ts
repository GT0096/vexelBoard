import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyHoldStroke } from '../src/renderer/src/board/holdSnapClassifier.ts'

function sampleLine(x1: number, y1: number, x2: number, y2: number, steps = 20, jitter = 1.2) {
  const pts: Array<[number, number, number]> = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const j = Math.sin(i * 1.9) * jitter
    pts.push([x1 + (x2 - x1) * t + j, y1 + (y2 - y1) * t - j * 0.5, 0.5])
  }
  return pts
}

function samplePolygon(vertices: Array<[number, number]>, stepsPerEdge = 10, jitter = 1.0) {
  const pts: Array<[number, number, number]> = []
  for (let e = 0; e < vertices.length; e++) {
    const [x1, y1] = vertices[e]
    const [x2, y2] = vertices[(e + 1) % vertices.length]
    for (let i = 0; i < stepsPerEdge; i++) {
      const t = i / stepsPerEdge
      const j = Math.sin((e * stepsPerEdge + i) * 2.1) * jitter
      pts.push([x1 + (x2 - x1) * t + j, y1 + (y2 - y1) * t + j * 0.5, 0.5])
    }
  }
  pts.push([vertices[0][0] + 2, vertices[0][1] - 1, 0.5])
  return pts
}

function sampleEllipse(cx: number, cy: number, rx: number, ry: number, steps = 48, jitter = 1.2) {
  const pts: Array<[number, number, number]> = []
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2
    const j = Math.sin(i * 3.1) * jitter
    pts.push([cx + Math.cos(a) * rx + j, cy + Math.sin(a) * ry - j * 0.5, 0.5])
  }
  return pts
}

test('classifyHoldStroke: straight line snaps to line', () => {
  const pts = sampleLine(100, 200, 340, 204)
  const res = classifyHoldStroke(pts)
  assert.ok(res)
  assert.equal(res.kind, 'line')
  assert.equal(res.h, 0) // snapped to exact horizontal within 6°
})

test('classifyHoldStroke: shaft + arrowhead barb snaps to arrow', () => {
  const shaft = sampleLine(100, 200, 320, 200, 20, 0.8)
  const barb = sampleLine(320, 200, 294, 182, 6, 0.4).slice(1)
  const res = classifyHoldStroke([...shaft, ...barb])
  assert.ok(res)
  assert.equal(res.kind, 'arrow')
  assert.ok(res.w > 180)
})

test('classifyHoldStroke: near-circular loop snaps to perfect circle', () => {
  const pts = sampleEllipse(250, 250, 82, 78)
  const res = classifyHoldStroke(pts)
  assert.ok(res)
  assert.equal(res.kind, 'circle')
  assert.equal(res.isPerfectCircle, true)
  assert.equal(res.w, res.h)
})

test('classifyHoldStroke: wide oval stays non-square ellipse', () => {
  const pts = sampleEllipse(250, 250, 120, 62)
  const res = classifyHoldStroke(pts)
  assert.ok(res)
  assert.equal(res.kind, 'circle')
  assert.equal(res.isPerfectCircle, false)
  assert.ok(res.w > res.h * 1.5)
})

test('classifyHoldStroke: 4 axis-aligned corners snap to rect', () => {
  const pts = samplePolygon([
    [100, 100],
    [300, 102],
    [298, 220],
    [102, 218]
  ])
  const res = classifyHoldStroke(pts)
  assert.ok(res)
  assert.equal(res.kind, 'rect')
})

test('classifyHoldStroke: 4 midpoint corners snap to diamond', () => {
  const pts = samplePolygon([
    [200, 80],
    [310, 180],
    [200, 280],
    [90, 180]
  ])
  const res = classifyHoldStroke(pts)
  assert.ok(res)
  assert.equal(res.kind, 'diamond')
})

test('classifyHoldStroke: 3 corners snap to triangle', () => {
  const pts = samplePolygon([
    [200, 80],
    [310, 260],
    [90, 260]
  ])
  const res = classifyHoldStroke(pts)
  assert.ok(res)
  assert.equal(res.kind, 'triangle')
})

test('classifyHoldStroke: cursive handwriting squiggle does NOT falsely snap', () => {
  // Open wavy 'm' / cursive loop
  const pts: Array<[number, number, number]> = []
  for (let i = 0; i <= 40; i++) {
    const t = i / 40
    pts.push([100 + t * 180, 200 + Math.sin(t * Math.PI * 5) * 32, 0.5])
  }
  const res = classifyHoldStroke(pts)
  assert.equal(res, null)
})
