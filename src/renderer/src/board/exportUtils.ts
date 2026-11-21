import type { BoardState, ThemeId } from '../types/board'
import { colorFor, resolveFontCss, resolveThemeTokens } from '../themes'
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

  ;(board.vectorArtNodes ?? []).forEach((v) => {
    allX.push(v.x, v.x + v.width)
    allY.push(v.y, v.y + v.height)
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
    const stroke =
      s.color === 'ink'
        ? palette.shapeStroke
        : s.color === 'accent'
          ? theme.accent
          : colorFor(theme, s.color)
    const isTransparentFill = s.fillColor === 'transparent' || s.fillColor === 'none'
    const fillOpacity =
      s.fillOpacity !== undefined ? Math.max(0, Math.min(1, s.fillOpacity)) : 1
    const fill = isTransparentFill || fillOpacity <= 0 ? 'none' : (s.fillColor || palette.shapeFill)
    const fillOpacityAttr =
      !isTransparentFill && fillOpacity > 0 && fillOpacity < 1
        ? ` fill-opacity="${fillOpacity}"`
        : ''
    const sw = s.strokeWidth ?? 3
    const dashAttr =
      s.strokeStyle === 'dashed' || s.shape === 'dashed-line'
        ? ' stroke-dasharray="8 6"'
        : s.strokeStyle === 'dotted'
          ? ' stroke-dasharray="2 6"'
          : ''
    const rotOpen = s.rotation
      ? `  <g transform="rotate(${s.rotation} ${s.x + s.w / 2} ${s.y + s.h / 2})">\n`
      : ''
    const rotClose = s.rotation ? `  </g>\n` : ''
    const shapeFont = resolveFontCss(s.fontFamily)

    if (rotOpen) svg += rotOpen

    if (s.shape === 'rect' || s.shape === 'component') {
      const rx = s.borderRadius ?? 6
      svg += `  <rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="${rx}" stroke="${stroke}" stroke-width="${sw}" fill="${fill}"${fillOpacityAttr}${dashAttr} />\n`
    } else if (s.shape === 'rounded-rect' || s.shape === 'queue') {
      const rx = s.borderRadius ?? Math.min(24, Math.min(Math.abs(s.w), Math.abs(s.h)) / 3)
      svg += `  <rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="${rx}" stroke="${stroke}" stroke-width="${sw}" fill="${fill}"${fillOpacityAttr}${dashAttr} />\n`
    } else if (s.shape === 'circle') {
      const rx = Math.abs(s.w) / 2
      const ry = Math.abs(s.h) / 2
      svg += `  <ellipse cx="${s.x + rx}" cy="${s.y + ry}" rx="${rx}" ry="${ry}" stroke="${stroke}" stroke-width="${sw}" fill="${fill}"${fillOpacityAttr}${dashAttr} />\n`
    } else if (s.shape === 'diamond') {
      const cx = s.x + s.w / 2
      const cy = s.y + s.h / 2
      svg += `  <polygon points="${cx},${s.y} ${s.x + s.w},${cy} ${cx},${s.y + s.h} ${s.x},${cy}" stroke="${stroke}" stroke-width="${sw}" fill="${fill}"${fillOpacityAttr}${dashAttr} />\n`
    } else if (s.shape === 'triangle') {
      const cx = s.x + s.w / 2
      svg += `  <polygon points="${cx},${s.y} ${s.x + s.w},${s.y + s.h} ${s.x},${s.y + s.h}" stroke="${stroke}" stroke-width="${sw}" fill="${fill}"${fillOpacityAttr}${dashAttr} />\n`
    } else if (s.shape === 'cylinder') {
      const ry = Math.min(20, s.h * 0.2)
      svg += `  <g stroke="${stroke}" stroke-width="${sw}" fill="${fill}"${fillOpacityAttr}${dashAttr}>
    <path d="M ${s.x} ${s.y + ry} L ${s.x} ${s.y + s.h - ry} A ${s.w / 2} ${ry} 0 0 0 ${s.x + s.w} ${s.y + s.h - ry} L ${s.x + s.w} ${s.y + ry} Z" />
    <ellipse cx="${s.x + s.w / 2}" cy="${s.y + ry}" rx="${s.w / 2}" ry="${ry}" />
  </g>\n`
    } else if (
      s.shape === 'arrow' ||
      s.shape === 'arrow-bidirectional' ||
      s.shape === 'line' ||
      s.shape === 'dashed-line' ||
      s.shape === 'elbow'
    ) {
      const x2 = s.x + s.w
      const y2 = s.y + s.h
      if (s.shape === 'elbow') {
        const midX = s.x + s.w * 0.5
        svg += `  <polyline points="${s.x},${s.y} ${midX},${s.y} ${midX},${y2} ${x2},${y2}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"${dashAttr} />\n`
      } else {
        svg += `  <line x1="${s.x}" y1="${s.y}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round"${dashAttr} />\n`
      }
      if (s.shape === 'arrow' || s.shape === 'arrow-bidirectional') {
        const angle = Math.atan2(s.h, s.w)
        const aLen = 14
        const ax1 = x2 - aLen * Math.cos(angle - Math.PI / 6)
        const ay1 = y2 - aLen * Math.sin(angle - Math.PI / 6)
        const ax2 = x2 - aLen * Math.cos(angle + Math.PI / 6)
        const ay2 = y2 - aLen * Math.sin(angle + Math.PI / 6)
        svg += `  <polygon points="${x2},${y2} ${ax1},${ay1} ${ax2},${ay2}" fill="${stroke}" />\n`
        if (s.shape === 'arrow-bidirectional') {
          const sa = angle + Math.PI
          const sx1 = s.x - aLen * Math.cos(sa - Math.PI / 6)
          const sy1 = s.y - aLen * Math.sin(sa - Math.PI / 6)
          const sx2 = s.x - aLen * Math.cos(sa + Math.PI / 6)
          const sy2 = s.y - aLen * Math.sin(sa + Math.PI / 6)
          svg += `  <polygon points="${s.x},${s.y} ${sx1},${sy1} ${sx2},${sy2}" fill="${stroke}" />\n`
        }
      }
    } else if (s.shape === 'curved-arrow' || s.shape === 'curved-line') {
      const x2 = s.x + s.w
      const y2 = s.y + s.h
      const cx = s.controlPoint?.[0] ?? (s.x + x2) / 2
      const cy = s.controlPoint?.[1] ?? (s.y + y2) / 2 - 40
      svg += `  <path d="M ${s.x} ${s.y} Q ${cx} ${cy} ${x2} ${y2}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round"${dashAttr} />\n`
      if (s.shape === 'curved-arrow' || s.arrowEnd) {
        const angle = Math.atan2(y2 - cy, x2 - cx)
        const aLen = 14
        const ax1 = x2 - aLen * Math.cos(angle - Math.PI / 6)
        const ay1 = y2 - aLen * Math.sin(angle - Math.PI / 6)
        const ax2 = x2 - aLen * Math.cos(angle + Math.PI / 6)
        const ay2 = y2 - aLen * Math.sin(angle + Math.PI / 6)
        svg += `  <polygon points="${x2},${y2} ${ax1},${ay1} ${ax2},${ay2}" fill="${stroke}" />\n`
      }
    } else if (s.shape === 'polyline' && s.points && s.points.length >= 2) {
      const ptsStr = s.points.map(([px, py]) => `${px},${py}`).join(' ')
      svg += `  <polyline points="${ptsStr}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"${dashAttr} />\n`
      if (s.arrowEnd !== false) {
        const prev = s.points[s.points.length - 2]
        const end = s.points[s.points.length - 1]
        const angle = Math.atan2(end[1] - prev[1], end[0] - prev[0])
        const aLen = 13
        const ax1 = end[0] - aLen * Math.cos(angle - Math.PI / 6)
        const ay1 = end[1] - aLen * Math.sin(angle - Math.PI / 6)
        const ax2 = end[0] - aLen * Math.cos(angle + Math.PI / 6)
        const ay2 = end[1] - aLen * Math.sin(angle + Math.PI / 6)
        svg += `  <polygon points="${end[0]},${end[1]} ${ax1},${ay1} ${ax2},${ay2}" fill="${stroke}" />\n`
      }
    } else if (s.shape === 'svg-path' && (s.svgPaths?.length || s.svgPath)) {
      const vb = s.svgViewBox
      const [vbX, vbY, vbW, vbH] =
        vb && vb.length === 4 ? vb : [0, 0, vb?.[0] ?? 100, vb?.[1] ?? 100]
      const sx = s.w / Math.max(1, vbW)
      const sy = s.h / Math.max(1, vbH)
      const list = s.svgPaths?.length
        ? s.svgPaths
        : s.svgPath
          ? [{ d: s.svgPath, fill, stroke, strokeWidth: sw }]
          : []
      svg += `  <g transform="translate(${s.x} ${s.y}) scale(${sx} ${sy}) translate(${-vbX} ${-vbY})">\n`
      for (const p of list) {
        const pFill =
          !p.fill || p.fill === 'transparent' || p.fill === 'none' || fillOpacity <= 0
            ? 'none'
            : p.fill === 'ink'
              ? stroke
              : p.fill === 'accent'
                ? theme.accent
                : p.fill
        const pFillOpacityAttr =
          pFill !== 'none' && fillOpacity > 0 && fillOpacity < 1
            ? ` fill-opacity="${fillOpacity}"`
            : ''
        const pStroke =
          p.stroke === 'none'
            ? 'none'
            : !p.stroke || p.stroke === 'ink'
              ? stroke
              : p.stroke === 'accent'
                ? theme.accent
                : p.stroke
        const pDash = p.dashed ? ' stroke-dasharray="8 6"' : dashAttr
        svg += `    <path d="${escapeXml(p.d)}" fill="${pFill}"${pFillOpacityAttr} stroke="${pStroke}" stroke-width="${p.strokeWidth ?? sw}" stroke-linecap="round" stroke-linejoin="round"${pDash} vector-effect="non-scaling-stroke" />\n`
      }
      svg += `  </g>\n`
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
          sw,
          fillOpacity
        )
      } else {
        svg += `  <rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="8" stroke="${stroke}" stroke-width="${sw}" fill="${fill}"${fillOpacityAttr}${dashAttr} />\n`
      }
    }

    if (s.label) {
      const lblColor =
        s.labelColor && s.labelColor !== 'auto'
          ? s.labelColor === 'ink'
            ? palette.ink
            : s.labelColor === 'accent'
              ? theme.accent
              : s.labelColor
          : isTransparentFill || fillOpacity < 0.45
            ? palette.ink
            : s.fillColor
              ? isLightColor(s.fillColor)
                ? '#111111'
                : '#FFFDF7'
              : palette.shapeText
      const isShortCellLabel = s.label.trim().length <= 4
      const lblSize =
        s.labelSize ??
        Math.round(
          isShortCellLabel
            ? Math.max(16, Math.min(34, Math.min(Math.abs(s.h) * 0.52, Math.abs(s.w) * 0.42)))
            : Math.max(14, Math.min(20, Math.abs(s.h) * 0.28))
        )
      const lblWeight = s.labelBold === false ? '500' : '700'
      svg += `  <text x="${s.x + s.w / 2}" y="${s.y + s.h / 2 + lblSize * 0.35}" text-anchor="middle" font-family="${escapeXml(shapeFont)}" font-size="${lblSize}" font-weight="${lblWeight}" fill="${lblColor}">${escapeXml(s.label)}</text>\n`
    }

    if (rotClose) svg += rotClose
  }

  // 1b. Traced Multi-Color Vector Art entities (`vector_art`)
  for (const art of board.vectorArtNodes ?? []) {
    const sx = art.width / Math.max(1, art.viewBoxWidth)
    const sy = art.height / Math.max(1, art.viewBoxHeight)
    svg += `  <g transform="translate(${art.x} ${art.y}) scale(${sx} ${sy})">\n`
    for (const layer of art.layers) {
      const fillAttr =
        !layer.fill || layer.fill === 'transparent'
          ? 'none'
          : layer.fill === 'ink'
            ? theme.ink
            : layer.fill === 'accent'
              ? theme.accent
              : layer.fill
      const strokeAttr = layer.stroke
        ? ` stroke="${escapeXml(layer.stroke === 'ink' ? theme.ink : layer.stroke)}" stroke-width="${layer.strokeWidth ?? 2}" vector-effect="non-scaling-stroke"`
        : ''
      svg += `    <path d="${escapeXml(layer.d)}" fill="${escapeXml(fillAttr)}"${strokeAttr} />\n`
    }
    svg += `  </g>\n`
  }

  // 2. Text nodes (including board-immersed frameless text)
  for (const t of board.textNodes) {
    const isH1 = t.style === 'h1' || t.fontSize >= 30
    const isH2 = t.style === 'h2' || (t.fontSize >= 22 && t.fontSize < 30)
    const fontSize = t.immersed ? (t.fontSize || 20) : isH1 ? 28 : isH2 ? 22 : 16
    const fontWeight = t.bold || isH1 || isH2 ? '700' : '500'
    const fontStyle = t.italic ? 'italic' : 'normal'
    const fontFamily = resolveFontCss(t.fontFamily)
    const color =
      t.color === 'ink'
        ? theme.ink
        : t.color === 'accent'
          ? theme.accent
          : colorFor(theme, t.color)

    const hasCardBg = !t.immersed && Boolean(t.bg) && t.bg !== 'transparent'
    if (hasCardBg) {
      svg += `  <rect x="${t.x}" y="${t.y}" width="${t.w ?? 280}" height="${t.h ?? 110}" rx="12" fill="${t.bg}" stroke="${palette.diagramNodeBorder}" stroke-width="2" />\n`
    }

    const textColor = hasCardBg && t.bg ? (isLightColor(t.bg) ? '#111111' : '#FFFDF7') : color
    const lines = t.text.split('\n')
    lines.forEach((line, idx) => {
      svg += `  <text x="${t.x + (hasCardBg ? 14 : 0)}" y="${t.y + (hasCardBg ? 28 : fontSize) + idx * (fontSize * 1.35)}" font-family="${escapeXml(fontFamily)}" font-size="${fontSize}" font-weight="${fontWeight}" font-style="${fontStyle}" fill="${textColor}">${escapeXml(line)}</text>\n`
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
