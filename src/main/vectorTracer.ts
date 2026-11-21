import { Worker } from 'worker_threads'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import type { VectorPathLayer } from '../shared/beautifySchema'

function getResolveAnchor(): string {
  if (typeof __filename !== 'undefined' && __filename) return __filename
  try {
    return fileURLToPath(import.meta.url)
  } catch {
    return process.cwd()
  }
}

export interface TraceOptions {
  clustering?: 'color-cluster' | 'bw'
  hierarchical?: 'stacked' | 'cutout'
  mode?: 'spline' | 'polygon' | 'pixel'
  filterSpeckle?: number
  colorPrecision?: number
  layerDifference?: number
  cornerThreshold?: number
  palette?: string[]
}

export interface TraceResult {
  viewBoxWidth: number
  viewBoxHeight: number
  layers: VectorPathLayer[]
  svg: string
}

/** Parse RGB/Hex color to [r, g, b] (0..255) */
function parseColorRgb(color: string): [number, number, number] | null {
  const c = color.trim().toLowerCase()
  if (!c || c === 'none' || c === 'transparent') return null
  if (c === 'white') return [255, 255, 255]
  if (c === 'black') return [0, 0, 0]
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c)
  if (hex) {
    const h = hex[1]
    if (h.length === 3) {
      return [
        parseInt(h[0] + h[0], 16),
        parseInt(h[1] + h[1], 16),
        parseInt(h[2] + h[2], 16)
      ]
    }
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16)
    ]
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(c)
  if (rgb) {
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
  }
  return null
}

function isNearWhite(color: string): boolean {
  const rgb = parseColorRgb(color)
  if (!rgb) return false
  return rgb[0] >= 240 && rgb[1] >= 240 && rgb[2] >= 240
}

/** Fast conservative bounding box of an SVG path's numeric coordinate pairs (supports M/L/C/Q/H/V/relative) */
export function estimatePathBounds(
  d: string,
  tx = 0,
  ty = 0
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g)
  if (!tokens || tokens.length < 3) return null

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let cx = 0
  let cy = 0
  let startX = 0
  let startY = 0
  let cmd = ''
  let i = 0

  const addPt = (x: number, y: number): void => {
    const gx = x + tx
    const gy = y + ty
    if (gx < minX) minX = gx
    if (gy < minY) minY = gy
    if (gx > maxX) maxX = gx
    if (gy > maxY) maxY = gy
  }

  const readNum = (): number => Number(tokens[i++])

  while (i < tokens.length) {
    const tok = tokens[i]
    if (/^[a-zA-Z]$/.test(tok)) {
      cmd = tok
      i++
      if (cmd === 'Z' || cmd === 'z') {
        cx = startX
        cy = startY
      }
      continue
    }

    switch (cmd) {
      case 'M':
        cx = readNum()
        cy = readNum()
        startX = cx
        startY = cy
        addPt(cx, cy)
        cmd = 'L'
        break
      case 'm':
        cx += readNum()
        cy += readNum()
        startX = cx
        startY = cy
        addPt(cx, cy)
        cmd = 'l'
        break
      case 'L':
      case 'T':
        cx = readNum()
        cy = readNum()
        addPt(cx, cy)
        break
      case 'l':
      case 't':
        cx += readNum()
        cy += readNum()
        addPt(cx, cy)
        break
      case 'H':
        cx = readNum()
        addPt(cx, cy)
        break
      case 'h':
        cx += readNum()
        addPt(cx, cy)
        break
      case 'V':
        cy = readNum()
        addPt(cx, cy)
        break
      case 'v':
        cy += readNum()
        addPt(cx, cy)
        break
      case 'C': {
        const x1 = readNum()
        const y1 = readNum()
        const x2 = readNum()
        const y2 = readNum()
        cx = readNum()
        cy = readNum()
        addPt(x1, y1)
        addPt(x2, y2)
        addPt(cx, cy)
        break
      }
      case 'c': {
        const x1 = cx + readNum()
        const y1 = cy + readNum()
        const x2 = cx + readNum()
        const y2 = cy + readNum()
        cx += readNum()
        cy += readNum()
        addPt(x1, y1)
        addPt(x2, y2)
        addPt(cx, cy)
        break
      }
      case 'S':
      case 'Q': {
        const x1 = readNum()
        const y1 = readNum()
        cx = readNum()
        cy = readNum()
        addPt(x1, y1)
        addPt(cx, cy)
        break
      }
      case 's':
      case 'q': {
        const x1 = cx + readNum()
        const y1 = cy + readNum()
        cx += readNum()
        cy += readNum()
        addPt(x1, y1)
        addPt(cx, cy)
        break
      }
      case 'A': {
        i += 5
        cx = readNum()
        cy = readNum()
        addPt(cx, cy)
        break
      }
      case 'a': {
        i += 5
        cx += readNum()
        cy += readNum()
        addPt(cx, cy)
        break
      }
      default:
        i++
        break
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null
  return { minX, minY, maxX, maxY }
}

/** Prepend translate offset into an SVG path's initial coordinates when VTracer emits `transform="translate(x,y)"` */
function applyTranslateToPathD(d: string, tx: number, ty: number): string {
  if (Math.abs(tx) < 0.001 && Math.abs(ty) < 0.001) return d
  // Shift every absolute coordinate in M/L/C/Q/S/T/H/V commands by (tx, ty)
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g)
  if (!tokens) return d
  const out: string[] = []
  let cmd = ''
  let i = 0
  const fmt = (n: number): string => {
    const r = Math.round(n * 100) / 100
    return Number.isInteger(r) ? String(r) : String(r)
  }

  while (i < tokens.length) {
    const tok = tokens[i]
    if (/^[a-zA-Z]$/.test(tok)) {
      cmd = tok
      out.push(tok)
      i++
      continue
    }

    switch (cmd) {
      case 'M':
      case 'L':
      case 'T':
        out.push(fmt(Number(tokens[i++]) + tx), fmt(Number(tokens[i++]) + ty))
        if (cmd === 'M') cmd = 'L'
        break
      case 'H':
        out.push(fmt(Number(tokens[i++]) + tx))
        break
      case 'V':
        out.push(fmt(Number(tokens[i++]) + ty))
        break
      case 'C':
        out.push(
          fmt(Number(tokens[i++]) + tx),
          fmt(Number(tokens[i++]) + ty),
          fmt(Number(tokens[i++]) + tx),
          fmt(Number(tokens[i++]) + ty),
          fmt(Number(tokens[i++]) + tx),
          fmt(Number(tokens[i++]) + ty)
        )
        break
      case 'S':
      case 'Q':
        out.push(
          fmt(Number(tokens[i++]) + tx),
          fmt(Number(tokens[i++]) + ty),
          fmt(Number(tokens[i++]) + tx),
          fmt(Number(tokens[i++]) + ty)
        )
        break
      case 'A':
        out.push(
          tokens[i++],
          tokens[i++],
          tokens[i++],
          tokens[i++],
          tokens[i++],
          fmt(Number(tokens[i++]) + tx),
          fmt(Number(tokens[i++]) + ty)
        )
        break
      default:
        // Relative commands (m, l, c, q, h, v, s, t, a): only the very first 'm' in a path is absolute
        if (cmd === 'm' && out.length === 1) {
          out.push(fmt(Number(tokens[i++]) + tx), fmt(Number(tokens[i++]) + ty))
          cmd = 'l'
        } else {
          out.push(tokens[i++])
        }
        break
    }
  }
  return out.join(' ')
}

/**
 * Extracts `<path>` elements from an SVGO-optimized VTracer SVG into `VectorPathLayer[]`
 * and strips any near-white background layer covering > 90% of the SVG viewBox.
 */
export function extractLayersFromTracedSvg(svg: string): TraceResult {
  let vbW = 512
  let vbH = 512

  const vbMatch = /viewBox=["']\s*[-0-9.]+\s+[-0-9.]+\s+([0-9.]+)\s+([0-9.]+)\s*["']/i.exec(svg)
  if (vbMatch) {
    vbW = Math.max(1, parseFloat(vbMatch[1]))
    vbH = Math.max(1, parseFloat(vbMatch[2]))
  } else {
    const wMatch = /\bwidth=["']([0-9.]+)/i.exec(svg)
    const hMatch = /\bheight=["']([0-9.]+)/i.exec(svg)
    if (wMatch) vbW = Math.max(1, parseFloat(wMatch[1]))
    if (hMatch) vbH = Math.max(1, parseFloat(hMatch[1]))
  }

  const vbArea = vbW * vbH
  const layers: VectorPathLayer[] = []
  const pathRegex = /<path\b([^>]*?)\/?>(?:<\/path>)?/gi
  let match: RegExpExecArray | null
  let idx = 0

  while ((match = pathRegex.exec(svg)) !== null) {
    const attrs = match[1]
    const dMatch = /\bd=["']([^"']+)["']/i.exec(attrs)
    if (!dMatch) continue
    let d = dMatch[1].trim()
    if (d.length < 4) continue

    const fillMatch = /\bfill=["']([^"']+)["']/i.exec(attrs)
    const strokeMatch = /\bstroke=["']([^"']+)["']/i.exec(attrs)
    const swMatch = /\bstroke-width=["']([0-9.]+)["']/i.exec(attrs)
    const trMatch = /\btransform=["']translate\(\s*([-0-9.]+)(?:[\s,]+([-0-9.]+))?\s*\)["']/i.exec(
      attrs
    )

    if (trMatch) {
      const tx = parseFloat(trMatch[1]) || 0
      const ty = parseFloat(trMatch[2] ?? '0') || 0
      d = applyTranslateToPathD(d, tx, ty)
    }

    const fill = fillMatch ? fillMatch[1].trim() : '#111111'
    const stroke = strokeMatch && strokeMatch[1] !== 'none' ? strokeMatch[1].trim() : undefined
    const strokeWidth = swMatch ? parseFloat(swMatch[1]) : undefined

    // Strip any near-white background path covering > 90% of the SVG viewBox
    if (isNearWhite(fill) && !stroke) {
      const b = estimatePathBounds(d)
      if (b) {
        const pathArea = Math.max(0, b.maxX - b.minX) * Math.max(0, b.maxY - b.minY)
        if (pathArea / Math.max(1, vbArea) > 0.9) {
          continue
        }
      }
    }

    layers.push({
      id: `vlayer-${idx++}`,
      d,
      fill,
      ...(stroke ? { stroke } : {}),
      ...(strokeWidth && Number.isFinite(strokeWidth) ? { strokeWidth } : {})
    })
  }

  return {
    viewBoxWidth: Math.round(vbW),
    viewBoxHeight: Math.round(vbH),
    layers,
    svg
  }
}

/**
 * Runs `@visioncortex/vtracer` (WASM) + `svgo` off the Electron main event loop inside a Node `Worker` thread.
 * Falls back safely to in-process execution if worker evaluation is unavailable.
 */
export async function tracePngToVectorLayers(
  pngBase64: string,
  opts: TraceOptions = {}
): Promise<TraceResult> {
  const pngBuffer = Buffer.from(pngBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64')
  const vtracerOpts = {
    clustering: opts.clustering ?? 'color-cluster',
    hierarchical: opts.hierarchical ?? 'stacked',
    mode: opts.mode ?? 'spline',
    filterSpeckle: opts.filterSpeckle ?? 6,
    colorPrecision: opts.colorPrecision ?? 6,
    layerDifference: opts.layerDifference ?? 16,
    cornerThreshold: opts.cornerThreshold ?? 60,
    ...(opts.palette && opts.palette.length > 0 ? { palette: opts.palette } : {})
  }

  const resolveAnchor = getResolveAnchor()

  const runDirect = (): string => {
    const req = createRequire(resolveAnchor)
    const vtracer = req('@visioncortex/vtracer') as {
      convertBuffer: (buf: Uint8Array, options?: Record<string, unknown>) => string
    }
    const { optimize } = req('svgo') as {
      optimize: (
        svg: string,
        config?: Record<string, unknown>
      ) => { data: string }
    }
    const rawSvg = vtracer.convertBuffer(pngBuffer, vtracerOpts)
    const optimized = optimize(rawSvg, {
      multipass: true,
      floatPrecision: 2,
      plugins: ['preset-default']
    })
    return optimized.data
  }

  let optimizedSvg: string
  try {
    optimizedSvg = await new Promise<string>((resolve, reject) => {
      const workerCode = `
        const { parentPort, workerData } = require('worker_threads');
        const { createRequire } = require('module');
        try {
          const req = createRequire(workerData.resolveFrom);
          const vtracer = req('@visioncortex/vtracer');
          const { optimize } = req('svgo');
          const rawSvg = vtracer.convertBuffer(Buffer.from(workerData.pngBytes), workerData.vtracerOpts);
          const optimized = optimize(rawSvg, {
            multipass: true,
            floatPrecision: 2,
            plugins: ['preset-default']
          });
          parentPort.postMessage({ ok: true, svg: optimized.data });
        } catch (err) {
          parentPort.postMessage({ ok: false, error: err && err.message ? err.message : String(err) });
        }
      `
      const worker = new Worker(workerCode, {
        eval: true,
        workerData: {
          resolveFrom: resolveAnchor,
          pngBytes: new Uint8Array(pngBuffer),
          vtracerOpts
        }
      })
      const timeout = setTimeout(() => {
        worker.terminate().catch(() => {})
        reject(new Error('VTracer worker timed out'))
      }, 25_000)

      worker.once('message', (msg: { ok: boolean; svg?: string; error?: string }) => {
        clearTimeout(timeout)
        worker.terminate().catch(() => {})
        if (msg.ok && msg.svg) resolve(msg.svg)
        else reject(new Error(msg.error || 'VTracer worker failed'))
      })
      worker.once('error', (err) => {
        clearTimeout(timeout)
        worker.terminate().catch(() => {})
        reject(err)
      })
    })
  } catch (workerErr) {
    console.warn('[VectorTracer] Worker fallback to direct execution:', workerErr)
    optimizedSvg = runDirect()
  }

  return extractLayersFromTracedSvg(optimizedSvg)
}
