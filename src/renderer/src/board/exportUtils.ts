import type { BoardState, ThemeId } from '../types/board'
import { resolveThemeTokens } from '../themes'
import { isLightColor, resolveBoardPalette } from './backgroundPresets'
import katex from 'katex'
import { getLibraryShape, renderLibraryShapeSvgGroup } from '../shapes/shapeLibrary'

/**
 * Clean SVG export of all board elements (strokes, shapes, text, equations).
 */
export function exportToSvg(board: BoardState, themeId: ThemeId, customBgColor?: string): string {
  const palette = resolveBoardPalette(customBgColor)
  const theme = resolveThemeTokens(customBgColor, themeId, palette)
  let minX = 0
  let minY = 0
  let maxX = 1920
  let maxY = 1080

  const allX: number[] = []
  const allY: number[] = []

  board.strokes.forEach((s) => {
    s.points.forEach(([x, y]) => {
      allX.push(x)
      allY.push(y)
    })
  })

  board.shapeNodes.forEach((s) => {
    allX.push(s.x, s.x + s.w)
    allY.push(s.y, s.y + s.h)
  })

  board.textNodes.forEach((t) => {
    allX.push(t.x, t.x + (t.w ?? 240))
    allY.push(t.y, t.y + (t.h ?? 80))
  })

  board.equationNodes.forEach((e) => {
    allX.push(e.x, e.x + (e.w ?? 200))
    allY.push(e.y, e.y + (e.h ?? 60))
  })

  ;(board.diagramNodes ?? []).forEach((d) => {
    allX.push(d.x, d.x + (d.w ?? 600))
    allY.push(d.y, d.y + (d.h ?? 400))
  })

  if (allX.length > 0) {
    minX = Math.min(...allX) - 60
    minY = Math.min(...allY) - 60
    maxX = Math.max(...allX) + 60
    maxY = Math.max(...allY) + 60
  }

  const width = Math.max(800, maxX - minX)
  const height = Math.max(600, maxY - minY)

  const bgColor =
    customBgColor && customBgColor !== 'transparent'
      ? customBgColor
      : (theme.exportBg ?? '#FFFDF7')

  let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${width} ${height}" width="${width}" height="${height}">
  <style>
    .note-text { font-family: 'Plus Jakarta Sans', system-ui, sans-serif; fill: ${theme.ink}; }
    .note-header { font-weight: 700; fill: ${theme.ink}; }
    .note-accent { fill: ${theme.accent}; stroke: ${theme.accent}; }
    .shape-stroke { stroke: ${theme.ink}; fill: none; stroke-width: 3.5; stroke-linecap: round; stroke-linejoin: round; }
  </style>
  <rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="${bgColor}" />
`

  // 1. Shapes
  for (const s of board.shapeNodes) {
    const stroke = s.color === 'accent' ? theme.accent : palette.shapeStroke
    const fill = s.fillColor || palette.shapeFill

    if (s.shape === 'rect' || s.shape === 'component') {
      svg += `  <rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="6" stroke="${stroke}" stroke-width="3" fill="${fill}" />\n`
    } else if (s.shape === 'rounded-rect' || s.shape === 'queue') {
      svg += `  <rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="${Math.min(s.w, s.h) / 3}" stroke="${stroke}" stroke-width="3" fill="${fill}" />\n`
    } else if (s.shape === 'circle') {
      const rx = Math.abs(s.w) / 2
      const ry = Math.abs(s.h) / 2
      svg += `  <ellipse cx="${s.x + rx}" cy="${s.y + ry}" rx="${rx}" ry="${ry}" stroke="${stroke}" stroke-width="3" fill="${fill}" />\n`
    } else if (s.shape === 'diamond') {
      const cx = s.x + s.w / 2
      const cy = s.y + s.h / 2
      svg += `  <polygon points="${cx},${s.y} ${s.x + s.w},${cy} ${cx},${s.y + s.h} ${s.x},${cy}" stroke="${stroke}" stroke-width="3" fill="${fill}" />\n`
    } else if (s.shape === 'triangle') {
      const cx = s.x + s.w / 2
      svg += `  <polygon points="${cx},${s.y} ${s.x + s.w},${s.y + s.h} ${s.x},${s.y + s.h}" stroke="${stroke}" stroke-width="3" fill="${fill}" />\n`
    } else if (s.shape === 'cylinder') {
      const ry = Math.min(20, s.h * 0.2)
      svg += `  <g stroke="${stroke}" stroke-width="3" fill="${fill}">
    <path d="M ${s.x} ${s.y + ry} L ${s.x} ${s.y + s.h - ry} A ${s.w / 2} ${ry} 0 0 0 ${s.x + s.w} ${s.y + s.h - ry} L ${s.x + s.w} ${s.y + ry} Z" />
    <ellipse cx="${s.x + s.w / 2}" cy="${s.y + ry}" rx="${s.w / 2}" ry="${ry}" />
  </g>\n`
    } else if (s.shape === 'arrow' || s.shape === 'arrow-bidirectional' || s.shape === 'line') {
      const x2 = s.x + s.w
      const y2 = s.y + s.h
      svg += `  <line x1="${s.x}" y1="${s.y}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="3.5" stroke-linecap="round" />\n`
      if (s.shape !== 'line') {
        const angle = Math.atan2(s.h, s.w)
        const aLen = 14
        const ax1 = x2 - aLen * Math.cos(angle - Math.PI / 6)
        const ay1 = y2 - aLen * Math.sin(angle - Math.PI / 6)
        const ax2 = x2 - aLen * Math.cos(angle + Math.PI / 6)
        const ay2 = y2 - aLen * Math.sin(angle + Math.PI / 6)
        svg += `  <polygon points="${x2},${y2} ${ax1},${ay1} ${ax2},${ay2}" fill="${stroke}" />\n`
      }
    } else {
      const libShape = getLibraryShape(s.shape)
      if (libShape) {
        svg += renderLibraryShapeSvgGroup(
          libShape,
          s.x,
          s.y,
          s.w,
          s.h,
          stroke,
          fill,
          s.strokeWidth ?? 3
        )
      } else {
        svg += `  <rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="8" stroke="${stroke}" stroke-width="3" fill="${fill}" />\n`
      }
    }

    if (s.label) {
      const lblColor = s.fillColor ? (isLightColor(s.fillColor) ? '#111111' : '#FFFDF7') : palette.shapeText
      svg += `  <text x="${s.x + s.w / 2}" y="${s.y + s.h / 2 + 5}" text-anchor="middle" font-family="'Plus Jakarta Sans', sans-serif" font-size="15" font-weight="700" fill="${lblColor}">${escapeXml(s.label)}</text>\n`
    }
  }

  // 2. Text nodes
  for (const t of board.textNodes) {
    const isH1 = t.style === 'h1' || t.fontSize >= 30
    const isH2 = t.style === 'h2' || (t.fontSize >= 22 && t.fontSize < 30)
    const fontSize = isH1 ? 28 : isH2 ? 22 : 16
    const fontWeight = t.bold || isH1 || isH2 ? '700' : '400'
    const fontStyle = t.italic ? 'italic' : 'normal'
    const color = t.color === 'accent' ? theme.accent : theme.ink

    if (t.bg) {
      svg += `  <rect x="${t.x}" y="${t.y}" width="${t.w ?? 280}" height="${t.h ?? 110}" rx="12" fill="${t.bg}" stroke="${palette.diagramNodeBorder}" stroke-width="2" />\n`
    }

    const textColor = t.bg ? (isLightColor(t.bg) ? '#111111' : '#FFFDF7') : color
    const lines = t.text.split('\n')
    lines.forEach((line, idx) => {
      svg += `  <text x="${t.x + (t.bg ? 14 : 0)}" y="${t.y + (t.bg ? 28 : 20) + idx * (fontSize * 1.3)}" font-family="'Plus Jakarta Sans', sans-serif" font-size="${fontSize}" font-weight="${fontWeight}" font-style="${fontStyle}" fill="${textColor}">${escapeXml(line)}</text>\n`
    })
  }

  // 3. Equations
  for (const eq of board.equationNodes) {
    const color = eq.color === 'accent' ? theme.accent : theme.ink
    try {
      const rendered = katex.renderToString(eq.latex, { throwOnError: false, output: 'html' })
      svg += `  <foreignObject x="${eq.x}" y="${eq.y}" width="${eq.w ?? 300}" height="${eq.h ?? 80}">
    <div xmlns="http://www.w3.org/1999/xhtml" style="color: ${color}; font-size: ${eq.fontSize}px; padding: 4px;">
      ${rendered}
    </div>
  </foreignObject>\n`
    } catch {
      svg += `  <text x="${eq.x}" y="${eq.y + 24}" font-family="'JetBrains Mono', monospace" font-size="${eq.fontSize}" fill="${color}">$$ ${escapeXml(eq.latex)} $$</text>\n`
    }
  }

  // 4. Interactive Diagrams & library shapes
  for (const d of board.diagramNodes ?? []) {
    const dw = d.w ?? 600
    const dh = d.h ?? 400
    svg += `  <rect x="${d.x}" y="${d.y}" width="${dw}" height="${dh}" rx="14" fill="transparent" stroke="${palette.diagramNodeBorder}" stroke-width="2" stroke-dasharray="6 4" />\n`
    if (d.title) {
      svg += `  <text x="${d.x + 16}" y="${d.y + 26}" font-family="'Plus Jakarta Sans', sans-serif" font-size="14" font-weight="700" fill="${palette.ink}">${escapeXml(d.title)}</text>\n`
    }

    const centers = new Map<string, { cx: number; cy: number }>()
    const resolvedNodes = (d.nodes ?? []).map((n) => {
      const nodeData = (n.data ?? {}) as Record<string, unknown>
      const shapeLookup = String(nodeData.shapeId || n.type || 'rectangle')
      const libShape = getLibraryShape(shapeLookup) || getLibraryShape('rectangle')
      const nw = Number(n.width ?? n.measured?.width ?? nodeData.w ?? libShape?.size[0] ?? 140)
      const nh = Number(n.height ?? n.measured?.height ?? nodeData.h ?? libShape?.size[1] ?? 70)
      const nx = d.x + (n.position?.x ?? 0)
      const ny = d.y + (n.position?.y ?? 0)
      centers.set(n.id, { cx: nx + nw / 2, cy: ny + nh / 2 })
      return { n, nodeData, libShape, nx, ny, nw, nh }
    })

    for (const edge of d.edges ?? []) {
      const src = centers.get(edge.source)
      const tgt = centers.get(edge.target)
      if (!src || !tgt) continue
      svg += `  <line x1="${src.cx}" y1="${src.cy}" x2="${tgt.cx}" y2="${tgt.cy}" stroke="${palette.diagramEdge}" stroke-width="2.2" />\n`
      if (edge.label) {
        const mx = (src.cx + tgt.cx) / 2
        const my = (src.cy + tgt.cy) / 2
        svg += `  <text x="${mx}" y="${my - 4}" text-anchor="middle" font-family="'Plus Jakarta Sans', sans-serif" font-size="11" fill="${palette.ink}">${escapeXml(String(edge.label))}</text>\n`
      }
    }

    for (const { nodeData, libShape, nx, ny, nw, nh } of resolvedNodes) {
      const nodeStroke = (nodeData.color as string | undefined) || palette.diagramNodeBorder
      const nodeFill =
        (nodeData.bg as string | undefined) ||
        libShape?.defaultFill ||
        palette.diagramNodeBg
      if (libShape) {
        svg += renderLibraryShapeSvgGroup(libShape, nx, ny, nw, nh, nodeStroke, nodeFill, 2)
      } else {
        svg += `  <rect x="${nx}" y="${ny}" width="${nw}" height="${nh}" rx="8" stroke="${nodeStroke}" stroke-width="2" fill="${nodeFill}" />\n`
      }
      const label = nodeData.label ? String(nodeData.label) : ''
      if (label) {
        const [tx, ty, tw, th] = libShape?.text ?? [8, 8, 84, 84]
        const lx = nx + ((tx + tw / 2) / 100) * nw
        const ly = ny + ((ty + th / 2) / 100) * nh + 4
        const textFill = isLightColor(nodeFill) ? '#111111' : '#FFFDF7'
        svg += `  <text x="${lx}" y="${ly}" text-anchor="middle" font-family="'Plus Jakarta Sans', sans-serif" font-size="12" font-weight="600" fill="${textFill}">${escapeXml(label)}</text>\n`
      }
    }
  }

  svg += `</svg>`
  return svg
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export async function downloadSvg(
  board: BoardState,
  themeId: ThemeId,
  customBgColor?: string
): Promise<void> {
  const svgContent = exportToSvg(board, themeId, customBgColor)
  if (window.glassAPI?.saveExportFile) {
    await window.glassAPI.saveExportFile('notes.svg', svgContent, 'image/svg+xml')
    return
  }
  const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `notes-${Date.now()}.svg`
  a.click()
  URL.revokeObjectURL(url)
}

export async function downloadImage(
  canvas: HTMLCanvasElement,
  _board: BoardState,
  _themeId: ThemeId,
  format: 'png' | 'jpeg' = 'png',
  customBgColor?: string
): Promise<void> {
  const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png'
  let dataUrl = ''
  if (customBgColor && customBgColor !== 'transparent') {
    const off = document.createElement('canvas')
    off.width = canvas.width
    off.height = canvas.height
    const octx = off.getContext('2d')
    if (octx) {
      octx.fillStyle = customBgColor
      octx.fillRect(0, 0, off.width, off.height)
      octx.drawImage(canvas, 0, 0)
      dataUrl = off.toDataURL(mime, 0.95)
    } else {
      dataUrl = canvas.toDataURL(mime, 0.95)
    }
  } else {
    dataUrl = canvas.toDataURL(mime, 0.95)
  }

  if (window.glassAPI?.saveExportFile) {
    await window.glassAPI.saveExportFile(`notes.${format}`, dataUrl, mime)
    return
  }
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = `notes-${Date.now()}.${format}`
  a.click()
}

export async function downloadPdf(
  _canvas: HTMLCanvasElement,
  _board: BoardState,
  _themeId: ThemeId
): Promise<void> {
  if (window.glassAPI?.printToPdf) {
    await window.glassAPI.printToPdf()
    return
  }
  window.print()
}
