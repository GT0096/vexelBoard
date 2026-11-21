import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  buildEmbeddedShapeNode,
  resolveEmbeddedShapeSpec
} from '../src/renderer/src/board/shapePlacement.ts'
import type { LibraryShapeDef, ShapeLibraryFile } from '../src/renderer/src/shapes/shapeLibrary.ts'

const libraryJsonPath = resolve(process.cwd(), 'src/renderer/src/shapes/shapeLibrary.json')
const libraryFile = JSON.parse(readFileSync(libraryJsonPath, 'utf8')) as ShapeLibraryFile
const shapeById = new Map<string, LibraryShapeDef>(
  libraryFile.shapes.map((s) => [s.id.toLowerCase(), s])
)
const lookupShape = (id: string): LibraryShapeDef | undefined =>
  shapeById.get(id.toLowerCase())

test('resolveEmbeddedShapeSpec maps all core flowchart/diagram shapes directly to native board shapes', () => {
  const cases: Array<{ type: string; expectedShape: string; transparent?: boolean }> = [
    { type: 'process', expectedShape: 'rounded-rect' },
    { type: 'decision', expectedShape: 'diamond' },
    { type: 'startEnd', expectedShape: 'rounded-rect' },
    { type: 'database', expectedShape: 'cylinder' },
    { type: 'cloud', expectedShape: 'cloud' },
    { type: 'document', expectedShape: 'fc-document' },
    { type: 'inputOutput', expectedShape: 'parallelogram' },
    { type: 'actor', expectedShape: 'actor' },
    { type: 'circle', expectedShape: 'circle' },
    { type: 'group', expectedShape: 'rounded-rect', transparent: true },
    { type: 'custom', expectedShape: 'rounded-rect' }
  ]

  for (const c of cases) {
    const spec = resolveEmbeddedShapeSpec(c.type, undefined, '#FFE566', lookupShape)
    assert.equal(spec.shape, c.expectedShape, `Failed mapping for ${c.type}`)
    assert.ok(spec.w >= 64 && spec.h >= 40, `Unexpected size for ${c.type}: ${spec.w}x${spec.h}`)
    if (c.transparent) {
      assert.equal(spec.fillColor, 'transparent')
      assert.equal(spec.strokeStyle, 'dashed')
    } else {
      assert.equal(spec.fillColor, '#FFE566')
    }
  }
})

test('resolveEmbeddedShapeSpec scales square/basic library shapes comfortably and omits boilerplate geometric labels', () => {
  const squareSpec = resolveEmbeddedShapeSpec(
    'square',
    { label: 'Square', w: 90, h: 90, shapeId: 'square' },
    '#FFE566',
    lookupShape
  )
  assert.equal(squareSpec.shape, 'square')
  assert.equal(squareSpec.w, 140)
  assert.equal(squareSpec.h, 140)
  assert.equal(squareSpec.label, '')
  assert.equal(squareSpec.fillColor, '#FFE566')

  const rectSpec = resolveEmbeddedShapeSpec(
    'rectangle',
    { label: 'Rectangle', w: 140, h: 80, shapeId: 'rectangle' },
    '#7BF1A8',
    lookupShape
  )
  assert.equal(rectSpec.shape, 'rectangle')
  assert.equal(rectSpec.w, 168)
  assert.equal(rectSpec.h, 96)
  assert.equal(rectSpec.label, '')
  assert.equal(rectSpec.fillColor, '#7BF1A8')
})

test('resolveEmbeddedShapeSpec preserves semantic labels for flowchart shapes and transparent fill for stroke-only shapes', () => {
  const fcSpec = resolveEmbeddedShapeSpec(
    'fc-process',
    { shapeId: 'fc-process' },
    '#67E8F9',
    lookupShape
  )
  assert.equal(fcSpec.shape, 'fc-process')
  assert.ok(fcSpec.label.length > 0)
  assert.equal(fcSpec.fillColor, '#67E8F9')

  const arcSpec = resolveEmbeddedShapeSpec(
    'arc',
    { label: 'Arc', w: 100, h: 100, shapeId: 'arc' },
    '#FFE566',
    lookupShape
  )
  assert.equal(arcSpec.shape, 'arc')
  assert.equal(arcSpec.fillColor, 'transparent')
})

test('buildEmbeddedShapeNode constructs complete native ShapeNode ready for direct board placement', () => {
  const node = buildEmbeddedShapeNode(
    'square',
    { label: 'Square', w: 90, h: 90, shapeId: 'square', color: '#ff3366' },
    { x: 420.4, y: 260.8 },
    {
      fillColor: '#FFE566',
      fontFamily: 'grotesk',
      layerId: 'layer-overlay-ink'
    },
    lookupShape
  )

  assert.ok(node.id.startsWith('shape-'))
  assert.equal(node.shape, 'square')
  assert.equal(node.x, 420)
  assert.equal(node.y, 261)
  assert.equal(node.w, 140)
  assert.equal(node.h, 140)
  assert.equal(node.fillColor, '#ff3366')
  assert.equal(node.fillOpacity, 1)
  assert.equal(node.fontFamily, 'grotesk')
  assert.equal(node.layerId, 'layer-overlay-ink')
  assert.equal(node.label, undefined)
})

test('buildEmbeddedShapeNode preserves animated flag for anim-line-* and animated library shapes', () => {
  const animLineDef: LibraryShapeDef = {
    id: 'anim-line-arrow',
    name: 'Animated Flow Arrow',
    category: 'lines',
    sources: [],
    size: [160, 48],
    paths: [
      { d: 'M 6 50 L 90 50', fill: 'none', dash: 'dash' },
      { d: 'M 74 34 L 92 50 L 74 66', fill: 'none' }
    ],
    defaultLabel: '',
    aliases: ['animated arrow'],
    tags: ['line', 'arrow', 'animated']
  }

  const lookupWithAnim = (id: string): LibraryShapeDef | undefined =>
    id === 'anim-line-arrow' ? animLineDef : lookupShape(id)

  const animLineNode = buildEmbeddedShapeNode(
    'anim-line-arrow',
    { shapeId: 'anim-line-arrow' },
    { x: 200, y: 300 },
    { fillColor: '#FFE566', fontFamily: 'jakarta', layerId: 'layer-base-ink' },
    lookupWithAnim
  )
  assert.equal(animLineNode.shape, 'anim-line-arrow')
  assert.equal(animLineNode.animated, true)
  assert.equal(animLineNode.fillColor, 'transparent')

  const animBoxNode = buildEmbeddedShapeNode(
    'square',
    { shapeId: 'square', animated: true },
    { x: 100, y: 100 },
    { fillColor: '#FFE566', fontFamily: 'jakarta', layerId: 'layer-base-ink' },
    lookupWithAnim
  )
  assert.equal(animBoxNode.shape, 'square')
  assert.equal(animBoxNode.animated, true)
})
