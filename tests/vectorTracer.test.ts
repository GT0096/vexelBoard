import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { extractLayersFromTracedSvg } from '../src/main/vectorTracer.ts'

test('extractLayersFromTracedSvg strips near-white background >90% viewBox and keeps artwork layers', () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
    <path d="M 0 0 H 200 V 200 H 0 Z" fill="#fefefe" />
    <path d="M 40 40 L 160 40 L 100 160 Z" fill="#2563EB" />
    <path d="M 80 70 L 120 70 L 100 110 Z" fill="#FFFFFF" />
  </svg>`
  const res = extractLayersFromTracedSvg(svg)
  assert.equal(res.viewBoxWidth, 200)
  assert.equal(res.viewBoxHeight, 200)
  // Full white background stripped, small inner white highlight preserved!
  assert.equal(res.layers.length, 2)
  assert.equal(res.layers[0].fill, '#2563EB')
  assert.equal(res.layers[1].fill, '#FFFFFF')
})

test('@visioncortex/vtracer WASM + svgo converts RGBA pixels to clean SVG', () => {
  const req = createRequire(import.meta.url)
  const vtracer = req('@visioncortex/vtracer') as {
    convertPixels: (rgba: Uint8Array, w: number, h: number, opts?: Record<string, unknown>) => string
  }
  const { optimize } = req('svgo') as {
    optimize: (svg: string, cfg?: Record<string, unknown>) => { data: string }
  }

  // Create a 64x64 RGBA image: white background + centered crimson circle
  const w = 64
  const h = 64
  const rgba = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4
      const d = Math.hypot(x - 32, y - 32)
      if (d <= 18) {
        rgba[idx] = 220
        rgba[idx + 1] = 38
        rgba[idx + 2] = 38
        rgba[idx + 3] = 255
      } else {
        rgba[idx] = 255
        rgba[idx + 1] = 255
        rgba[idx + 2] = 255
        rgba[idx + 3] = 255
      }
    }
  }

  const rawSvg = vtracer.convertPixels(rgba, w, h, {
    clustering: 'color-cluster',
    hierarchical: 'stacked',
    mode: 'spline',
    filterSpeckle: 4,
    colorPrecision: 6,
    layerDifference: 16,
    cornerThreshold: 60
  })
  const opt = optimize(rawSvg, { multipass: true, floatPrecision: 2 })
  const extracted = extractLayersFromTracedSvg(opt.data)
  assert.ok(extracted.layers.length >= 1, 'Expected at least 1 traced artwork layer')
  assert.ok(
    extracted.layers.every((l) => l.fill.toLowerCase() !== '#ffffff'),
    'Expected full white background to be stripped'
  )
})
