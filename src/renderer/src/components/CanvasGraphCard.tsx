import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Box,
  Copy,
  Crosshair,
  FilePlus2,
  GripHorizontal,
  Grid,
  LineChart,
  Move,
  Palette,
  Plus,
  RotateCcw,
  RotateCw,
  SlidersHorizontal,
  Trash2,
  X,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import type { Scene3DCamera } from '@shared/scene3dSchema'
import type { GraphNode, PortSide } from '../types/board'
import type { ResizeDirection } from './CanvasElements'
import {
  buildGraphPreviewModel,
  buildScene3DFromGraphSpec,
  GRAPH_CHART_TYPES,
  GRAPH_COLOR_PALETTES,
  GRAPH_SERIES_COLORS,
  is3DGraphChartType,
  resolveGraphChartType,
  type GraphAxisStyle,
  type GraphChartType,
  type GraphLegendPosition,
  type GraphPlotSpec,
  type PreviewGraphHoverPoint
} from '../board/graphPlotBuilder'
import { Scene3DViewportCanvas } from './Canvas3DScene'

/* ---------------- Shared Interactive 2D & 3D Graph Viewport ---------------- */

export interface InteractiveGraphViewportProps {
  spec: GraphPlotSpec
  width?: number
  height?: number
  compact?: boolean
  interactive?: boolean
  isLightTheme?: boolean
}

export const InteractiveGraphViewport: React.FC<InteractiveGraphViewportProps> = ({
  spec,
  width,
  height,
  compact = false,
  interactive = true,
  isLightTheme = true
}) => {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [boxSize, setBoxSize] = useState<{ w: number; h: number }>({
    w: width ?? 440,
    h: height ?? 260
  })

  const chartType = resolveGraphChartType(spec)
  const is3D = is3DGraphChartType(chartType)

  const resolvedW = width !== undefined ? Math.max(120, Math.round(width)) : boxSize.w
  const resolvedH = height !== undefined ? Math.max(100, Math.round(height)) : boxSize.h

  useEffect(() => {
    if (width !== undefined && height !== undefined) return undefined
    const el = wrapRef.current
    if (!el) return undefined
    const updateSize = (): void => {
      const cw = el.clientWidth
      const ch = el.clientHeight
      if (cw > 40 && (height !== undefined || ch > 40)) {
        setBoxSize({
          w: Math.round(cw),
          h: Math.round(height ?? ch)
        })
      }
    }
    const rafId = requestAnimationFrame(updateSize)
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(updateSize)
      ro.observe(el)
      return () => {
        cancelAnimationFrame(rafId)
        ro.disconnect()
      }
    }
    return () => cancelAnimationFrame(rafId)
  }, [width, height, is3D])

  // 3D Camera state (remembered during interactive orbit & pan)
  const [cam3d, setCam3d] = useState<Scene3DCamera>({ yaw: 40, pitch: 26, zoom: 1, panX: 0, panY: 0 })
  const [dragMode3d, setDragMode3d] = useState<'orbit' | 'pan'>('orbit')
  const [autoRotate3d, setAutoRotate3d] = useState(false)
  const [wireframe3d, setWireframe3d] = useState(false)
  const scene3dSpec = useMemo(() => (is3D ? buildScene3DFromGraphSpec(spec) : null), [is3D, spec])

  // 2D Interactive Zoom/Pan override for continuous plots
  const [zoomBounds, setZoomBounds] = useState<{
    xMin: number
    xMax: number
    yMin: number
    yMax: number
  } | null>(null)
  const pan2dRef = useRef<{
    startX: number
    startY: number
    initBounds: { xMin: number; xMax: number; yMin: number; yMax: number }
  } | null>(null)
  const [hoveredPt, setHoveredPt] = useState<PreviewGraphHoverPoint | null>(null)

  const effectiveSpec = useMemo<GraphPlotSpec>(() => {
    if (!zoomBounds) return spec
    return {
      ...spec,
      xMin: zoomBounds.xMin,
      xMax: zoomBounds.xMax,
      yMin: zoomBounds.yMin,
      yMax: zoomBounds.yMax,
      autoScale: false
    }
  }, [spec, zoomBounds])

  const preview = useMemo(
    () => buildGraphPreviewModel(effectiveSpec, Math.max(220, resolvedW), Math.max(150, resolvedH)),
    [effectiveSpec, resolvedW, resolvedH]
  )

  const canZoomPan2D =
    interactive &&
    !is3D &&
    (chartType === 'function' ||
      chartType === 'line' ||
      chartType === 'smooth' ||
      chartType === 'area' ||
      chartType === 'scatter')

  const zoom2D = (factor: number): void => {
    const cur = zoomBounds ?? {
      xMin: preview.xMin,
      xMax: preview.xMax,
      yMin: preview.yMin,
      yMax: preview.yMax
    }
    const cx = (cur.xMin + cur.xMax) / 2
    const cy = (cur.yMin + cur.yMax) / 2
    const hx = ((cur.xMax - cur.xMin) / 2) * factor
    const hy = ((cur.yMax - cur.yMin) / 2) * factor
    setZoomBounds({ xMin: cx - hx, xMax: cx + hx, yMin: cy - hy, yMax: cy + hy })
  }

  if (is3D && scene3dSpec) {
    return (
      <div
        ref={wrapRef}
        className="vx-graph-viewport is-3d"
        style={height !== undefined ? { height: `${height}px` } : { height: '100%' }}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="vx-graph-3d-overlay-ctrls">
          <button
            type="button"
            className={`inline-3d-btn ${dragMode3d === 'orbit' ? 'active' : ''}`}
            onClick={() => setDragMode3d('orbit')}
            title="Orbit / Rotate 3D (Shift+drag to move)"
          >
            <Box size={11} />
          </button>
          <button
            type="button"
            className={`inline-3d-btn ${dragMode3d === 'pan' ? 'active' : ''}`}
            onClick={() => setDragMode3d('pan')}
            title="Move / Pan 3D graph inside viewport"
          >
            <Move size={11} />
          </button>
          <button
            type="button"
            className="inline-3d-btn"
            onClick={() => setCam3d({ yaw: 40, pitch: 26, zoom: 1, panX: 0, panY: 0 })}
            title="Center & reset 3D graph"
          >
            <Crosshair size={11} />
          </button>
          <button
            type="button"
            className={`inline-3d-btn ${autoRotate3d ? 'active' : ''}`}
            onClick={() => setAutoRotate3d((v) => !v)}
            title="Toggle auto-orbit"
          >
            <RotateCw size={11} />
          </button>
          <button
            type="button"
            className={`inline-3d-btn ${wireframe3d ? 'active' : ''}`}
            onClick={() => setWireframe3d((v) => !v)}
            title="Toggle wireframe"
          >
            <Grid size={11} />
          </button>
          <button
            type="button"
            className="inline-3d-btn"
            onClick={() => setCam3d((c) => ({ ...c, zoom: Math.min(3.5, (c.zoom ?? 1) * 1.18) }))}
            title="Zoom in 3D"
          >
            <ZoomIn size={11} />
          </button>
          <button
            type="button"
            className="inline-3d-btn"
            onClick={() => setCam3d((c) => ({ ...c, zoom: Math.max(0.35, (c.zoom ?? 1) / 1.18) }))}
            title="Zoom out 3D"
          >
            <ZoomOut size={11} />
          </button>
        </div>
        <Scene3DViewportCanvas
          spec={scene3dSpec}
          width={Math.max(180, resolvedW)}
          height={Math.max(130, resolvedH)}
          isLightTheme={isLightTheme}
          playing
          autoRotate={autoRotate3d}
          wireframe={wireframe3d}
          camera={cam3d}
          interactionMode={dragMode3d}
          onChangeCamera={setCam3d}
        />
        <div className="inline-3d-hint">
          {dragMode3d === 'pan'
            ? 'Drag to move graph · Right-drag or Center resets'
            : 'Drag to orbit 3D · Shift+drag to move'}
          {spec.zLabel ? ` · ${spec.zLabel}` : ''}
        </div>
      </div>
    )
  }

  const bgColor = spec.backgroundColor || '#FFFFFF'
  const axisColor = spec.axisColor || '#1E293B'
  const gridColor = spec.gridColor || '#E2E8F0'
  const textColor = spec.textColor || '#475569'
  const legendPos: GraphLegendPosition = spec.legendPosition ?? 'bottom'

  const handleSvgMouseMove = (e: React.MouseEvent<SVGSVGElement>): void => {
    const svg = e.currentTarget
    const rect = svg.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const sx = ((e.clientX - rect.left) / rect.width) * preview.viewW
    const sy = ((e.clientY - rect.top) / rect.height) * preview.viewH

    if (pan2dRef.current) {
      const dxPx = e.clientX - pan2dRef.current.startX
      const dyPx = e.clientY - pan2dRef.current.startY
      const b = pan2dRef.current.initBounds
      const dxData = (dxPx / Math.max(1, (preview.plotW / preview.viewW) * rect.width)) * (b.xMax - b.xMin)
      const dyData = (dyPx / Math.max(1, (preview.plotH / preview.viewH) * rect.height)) * (b.yMax - b.yMin)
      setZoomBounds({
        xMin: b.xMin - dxData,
        xMax: b.xMax - dxData,
        yMin: b.yMin + dyData,
        yMax: b.yMax + dyData
      })
      return
    }

    if (!interactive || preview.hoverPoints.length === 0) return
    let best: PreviewGraphHoverPoint | null = null
    let bestDist = 26
    for (const pt of preview.hoverPoints) {
      const d = Math.hypot(sx - pt.cx, sy - pt.cy)
      if (d < bestDist) {
        bestDist = d
        best = pt
      }
    }
    setHoveredPt(best)
  }

  return (
    <div
      ref={wrapRef}
      className="vx-graph-viewport"
      style={height !== undefined ? { height: `${height}px` } : { height: '100%' }}
    >
      {canZoomPan2D && !compact && (
        <div
          className="vx-graph-2d-zoom-bar"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button type="button" onClick={() => zoom2D(0.75)} title="Zoom in">
            <ZoomIn size={11} />
          </button>
          <button type="button" onClick={() => zoom2D(1.33)} title="Zoom out">
            <ZoomOut size={11} />
          </button>
          {zoomBounds && (
            <button type="button" onClick={() => setZoomBounds(null)} title="Center & reset zoom/pan">
              <RotateCcw size={11} />
            </button>
          )}
        </div>
      )}

      <svg
        viewBox={`0 0 ${preview.viewW} ${preview.viewH}`}
        className={`graph-preview-svg ${canZoomPan2D ? 'is-pannable' : ''}`}
        onMouseDown={(e) => {
          if (!canZoomPan2D || e.button !== 0) return
          // Drag inside chart body pans 2D coordinates without tearing apart the chart
          e.stopPropagation()
          pan2dRef.current = {
            startX: e.clientX,
            startY: e.clientY,
            initBounds: zoomBounds ?? {
              xMin: preview.xMin,
              xMax: preview.xMax,
              yMin: preview.yMin,
              yMax: preview.yMax
            }
          }
        }}
        onPointerDown={(e) => {
          if (canZoomPan2D) e.stopPropagation()
        }}
        onMouseMove={handleSvgMouseMove}
        onMouseUp={() => {
          pan2dRef.current = null
        }}
        onMouseLeave={() => {
          pan2dRef.current = null
          setHoveredPt(null)
        }}
      >
        <rect
          x="0.5"
          y="0.5"
          width={preview.viewW - 1}
          height={preview.viewH - 1}
          rx="8"
          fill={bgColor}
        />

        {spec.title.trim() && (
          <text
            x={preview.viewW / 2}
            y={14}
            textAnchor="middle"
            fontSize="11"
            fontWeight="800"
            fill={textColor}
          >
            {spec.title.trim()}
          </text>
        )}

        {/* Grid */}
        {spec.showGrid &&
          chartType !== 'pie' &&
          chartType !== 'heatmap' &&
          preview.gridLinesX.map((gx, idx) => (
            <line
              key={`gx-${idx}`}
              x1={gx}
              y1={preview.plotY}
              x2={gx}
              y2={preview.plotY + preview.plotH}
              stroke={gridColor}
              strokeWidth="1"
              strokeDasharray="3 3"
            />
          ))}
        {spec.showGrid &&
          chartType !== 'pie' &&
          chartType !== 'heatmap' &&
          preview.gridLinesY.map((gy, idx) => (
            <line
              key={`gy-${idx}`}
              x1={preview.plotX}
              y1={gy}
              x2={preview.plotX + preview.plotW}
              y2={gy}
              stroke={gridColor}
              strokeWidth="1"
              strokeDasharray="3 3"
            />
          ))}

        {/* Axes */}
        {spec.axisStyle !== 'none' && chartType !== 'pie' && (
          <>
            {spec.axisStyle === 'box' && (
              <rect
                x={preview.plotX}
                y={preview.plotY}
                width={preview.plotW}
                height={preview.plotH}
                fill="none"
                stroke={axisColor}
                strokeWidth="1.3"
              />
            )}
            <line
              x1={preview.plotX}
              y1={preview.xAxisY}
              x2={preview.plotX + preview.plotW}
              y2={preview.xAxisY}
              stroke={axisColor}
              strokeWidth="1.5"
            />
            <line
              x1={preview.yAxisX}
              y1={preview.plotY}
              x2={preview.yAxisX}
              y2={preview.plotY + preview.plotH}
              stroke={axisColor}
              strokeWidth="1.5"
            />
          </>
        )}

        {/* Heatmap Cells */}
        {preview.cells.map((c, idx) => (
          <g key={`hm-${idx}`}>
            <rect x={c.x} y={c.y} width={c.w} height={c.h} fill={c.fill} stroke={bgColor} strokeWidth="0.8" />
            {c.w >= 24 && c.h >= 16 && (
              <text
                x={c.x + c.w / 2}
                y={c.y + c.h / 2 + 3}
                textAnchor="middle"
                fontSize="8.5"
                fontWeight="700"
                fill={c.textColor}
              >
                {c.valueLabel}
              </text>
            )}
          </g>
        ))}

        {/* Pie / Donut Slices */}
        {preview.slices.map((sl, idx) => (
          <g key={`pie-${idx}`}>
            <path d={sl.d} fill={sl.color} stroke={bgColor} strokeWidth="1.6" />
            {sl.pctLabel && (
              <text
                x={sl.labelX}
                y={sl.labelY + 3}
                textAnchor="middle"
                fontSize="9"
                fontWeight="800"
                fill="#FFFFFF"
              >
                {sl.pctLabel}
              </text>
            )}
          </g>
        ))}

        {/* Bars / Histogram Bins / IQR Boxes / Candlestick Bodies */}
        {preview.bars.map((b, idx) => (
          <rect
            key={`bar-${idx}`}
            x={b.x}
            y={b.y}
            width={b.w}
            height={b.h}
            rx="1.5"
            fill={b.color}
            fillOpacity={b.opacity ?? 0.86}
            stroke={b.strokeColor || '#0F172A'}
            strokeWidth="0.9"
          />
        ))}

        {/* Wicks / Whiskers / Median Bars */}
        {preview.wicks.map((w, idx) => (
          <line
            key={`wk-${idx}`}
            x1={w.x1}
            y1={w.y1}
            x2={w.x2}
            y2={w.y2}
            stroke={w.color}
            strokeWidth={w.strokeWidth ?? 1.6}
            strokeLinecap="round"
          />
        ))}

        {/* Function / Line / Smooth / Area / Violin Paths */}
        {preview.paths.map((p, idx) => (
          <path
            key={`p-${idx}`}
            d={p.d}
            fill={p.fill || 'none'}
            fillOpacity={p.fillOpacity}
            stroke={p.color}
            strokeWidth={p.strokeWidth ?? 2.4}
            strokeDasharray={p.dashed ? '5 4' : undefined}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {/* Data Dots */}
        {preview.dots.map((d, idx) => (
          <circle
            key={`d-${idx}`}
            cx={d.cx}
            cy={d.cy}
            r={d.r ?? 3.2}
            fill={d.color}
            stroke="#FFFFFF"
            strokeWidth="1.1"
          />
        ))}

        {/* Tick labels */}
        {chartType !== 'pie' &&
          preview.xTicks.map((tk, idx) => (
            <text
              key={`xt-${idx}`}
              x={tk.pos}
              y={preview.plotY + preview.plotH + 12}
              textAnchor="middle"
              fontSize="8.5"
              fill={textColor}
            >
              {tk.label.slice(0, 10)}
            </text>
          ))}
        {chartType !== 'pie' &&
          preview.yTicks.map((tk, idx) => (
            <text
              key={`yt-${idx}`}
              x={preview.plotX - 5}
              y={tk.pos + 3}
              textAnchor="end"
              fontSize="8.5"
              fill={textColor}
            >
              {tk.label.slice(0, 8)}
            </text>
          ))}

        {/* Axis Titles */}
        {spec.xLabel?.trim() && chartType !== 'pie' && (
          <text
            x={preview.plotX + preview.plotW / 2}
            y={preview.plotY + preview.plotH + 22}
            textAnchor="middle"
            fontSize="8.5"
            fontWeight="700"
            fill={textColor}
          >
            {spec.xLabel.trim()}
          </text>
        )}
        {spec.yLabel?.trim() && chartType !== 'pie' && (
          <text
            x={11}
            y={preview.plotY + preview.plotH / 2}
            textAnchor="middle"
            fontSize="8.5"
            fontWeight="700"
            fill={textColor}
            transform={`rotate(-90 11 ${preview.plotY + preview.plotH / 2})`}
          >
            {spec.yLabel.trim()}
          </text>
        )}

        {/* Legend (bottom | top | right | inside) */}
        {spec.showLegend &&
          preview.legend.length > 0 &&
          (() => {
            const items = preview.legend.slice(0, 5)
            if (legendPos === 'right') {
              const rx = preview.plotX + preview.plotW + 8
              return items.map((lg, idx) => (
                <g key={`lg-${idx}`}>
                  <rect x={rx} y={preview.plotY + 4 + idx * 15} width="9" height="9" rx="2" fill={lg.color} />
                  <text
                    x={rx + 13}
                    y={preview.plotY + 11.5 + idx * 15}
                    fontSize="8.5"
                    fontWeight="700"
                    fill={textColor}
                  >
                    {lg.label.slice(0, 13)}
                  </text>
                </g>
              ))
            }
            if (legendPos === 'inside') {
              const ix = preview.plotX + preview.plotW - 92
              const iy = preview.plotY + 6
              return (
                <g>
                  <rect
                    x={ix - 4}
                    y={iy - 2}
                    width={92}
                    height={items.length * 14 + 6}
                    rx="5"
                    fill={bgColor}
                    fillOpacity="0.88"
                    stroke={gridColor}
                    strokeWidth="1"
                  />
                  {items.map((lg, idx) => (
                    <g key={`lg-${idx}`}>
                      <line
                        x1={ix}
                        y1={iy + 7 + idx * 14}
                        x2={ix + 12}
                        y2={iy + 7 + idx * 14}
                        stroke={lg.color}
                        strokeWidth="2.5"
                        strokeDasharray={lg.dashed ? '4 2' : undefined}
                      />
                      <text x={ix + 16} y={iy + 10 + idx * 14} fontSize="8" fontWeight="700" fill={textColor}>
                        {lg.label.slice(0, 12)}
                      </text>
                    </g>
                  ))}
                </g>
              )
            }
            const ly = legendPos === 'top' ? 24 : preview.viewH - 7
            const step = Math.floor((preview.viewW - 24) / Math.max(1, items.length))
            return items.map((lg, idx) => {
              const lx = 14 + idx * step
              return (
                <g key={`lg-${idx}`}>
                  <line
                    x1={lx}
                    y1={ly - 3}
                    x2={lx + 12}
                    y2={ly - 3}
                    stroke={lg.color}
                    strokeWidth="2.5"
                    strokeDasharray={lg.dashed ? '4 3' : undefined}
                  />
                  <text x={lx + 15} y={ly} fontSize="8.5" fontWeight="700" fill={textColor}>
                    {lg.label.slice(0, 14)}
                  </text>
                </g>
              )
            })
          })()}

        {/* Interactive Hover Crosshair & Highlight */}
        {hoveredPt && (
          <g pointerEvents="none">
            <line
              x1={hoveredPt.cx}
              y1={preview.plotY}
              x2={hoveredPt.cx}
              y2={preview.plotY + preview.plotH}
              stroke="#94A3B8"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            <circle cx={hoveredPt.cx} cy={hoveredPt.cy} r={5.5} fill={hoveredPt.color} stroke="#FFFFFF" strokeWidth="1.8" />
          </g>
        )}
      </svg>

      {hoveredPt && (
        <div
          className="vx-graph-tooltip"
          style={{
            left: `${Math.min(72, Math.max(8, (hoveredPt.cx / preview.viewW) * 100))}%`,
            top: `${Math.max(10, Math.min(72, (hoveredPt.cy / preview.viewH) * 100))}%`,
            borderColor: hoveredPt.color
          }}
        >
          <strong>{hoveredPt.title}</strong>
          {hoveredPt.lines.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ---------------- Board Unified Movable & Resizable Graph Card ---------------- */

export interface CanvasGraphCardProps {
  node: GraphNode
  isSelected: boolean
  isResizing?: boolean
  isLightTheme?: boolean
  activeThemeAccent: string
  disabledPointerEvents?: boolean
  onSelect: () => void
  onUpdate: (patch: Partial<GraphNode>, opts?: { history?: boolean }) => void
  onDelete: () => void
  onDuplicate: () => void
  onStartMove: (startX: number, startY: number) => void
  onStartResize?: (e: React.PointerEvent, dir: ResizeDirection) => void
  onStartConnect?: (sourceId: string, port: PortSide, clientX: number, clientY: number) => void
  onInsertToNotes?: (markdown: string, title?: string) => void
  onContextMenu?: (e: React.MouseEvent) => void
}

export const CanvasGraphCard: React.FC<CanvasGraphCardProps> = ({
  node,
  isSelected,
  isResizing = false,
  isLightTheme = true,
  activeThemeAccent,
  disabledPointerEvents = false,
  onSelect,
  onUpdate,
  onDelete,
  onDuplicate,
  onStartMove,
  onStartResize,
  onStartConnect,
  onInsertToNotes,
  onContextMenu
}) => {
  const [isHovered, setIsHovered] = useState(false)
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(node.title || node.spec.title || 'Graph')
  const [showCustomize, setShowCustomize] = useState(false)
  const [customTab, setCustomTab] = useState<'data' | 'colors' | 'axes'>('colors')

  const spec = node.spec
  const chartType = resolveGraphChartType(spec)
  const is3D = is3DGraphChartType(chartType)

  const updateSpec = (patch: Partial<GraphPlotSpec>, history = false): void => {
    const nextSpec: GraphPlotSpec = { ...spec, ...patch }
    if (patch.chartType) {
      nextSpec.mode = is3DGraphChartType(patch.chartType)
        ? '3d'
        : patch.chartType === 'function'
          ? 'function'
          : 'data'
      if (
        patch.chartType === 'line' ||
        patch.chartType === 'smooth' ||
        patch.chartType === 'bar' ||
        patch.chartType === 'scatter'
      ) {
        nextSpec.dataKind = patch.chartType
      }
    }
    onUpdate(
      {
        title: patch.title ?? node.title,
        spec: nextSpec
      },
      { history }
    )
  }

  const applyPalette = (colors: string[]): void => {
    updateSpec(
      {
        functions: spec.functions.map((f, i) => ({ ...f, color: colors[i % colors.length] })),
        dataSeries: spec.dataSeries.map((d, i) => ({
          ...d,
          color: colors[i % colors.length],
          sliceColors: colors
        })),
        bullColor: colors[0],
        bearColor: colors[1] ?? '#EF4444'
      },
      true
    )
  }

  const handleSendToNote = (): void => {
    if (!onInsertToNotes) return
    if (is3D) {
      const s3 = buildScene3DFromGraphSpec(spec)
      onInsertToNotes(`\`\`\`3d\n${JSON.stringify(s3, null, 2)}\n\`\`\``, spec.title || node.title || '3D Graph')
      return
    }
    const mdLines = [`### ${spec.title || node.title || 'Graph'} (${chartType})`]
    if (chartType === 'function') {
      spec.functions.forEach((f) => mdLines.push(`- \`y = ${f.expr}\``))
    } else {
      spec.dataSeries.forEach((d) => mdLines.push(`- **${d.label}**: ${d.valuesText}`))
    }
    onInsertToNotes(mdLines.join('\n'), spec.title || node.title || 'Graph')
  }

  return (
    <div
      id={node.id}
      className={`canvas-graph-node ${isSelected ? 'selected' : ''} ${isResizing ? 'resizing' : ''}`}
      style={{
        left: `${node.x}px`,
        top: `${node.y}px`,
        width: `${node.w}px`,
        height: `${node.h}px`,
        borderColor: isSelected ? activeThemeAccent : undefined,
        pointerEvents: disabledPointerEvents ? 'none' : 'auto'
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onContextMenu={(e) => {
        if (!disabledPointerEvents) onContextMenu?.(e)
      }}
      onPointerDown={(e) => {
        if (disabledPointerEvents) return
        e.stopPropagation()
        onSelect()
        const targetEl = e.target as HTMLElement | null
        const isInteractive = Boolean(
          targetEl?.closest(
            '.canvas-graph-custom-drawer, .canvas-graph-actions, .card-flow-port-handle, .card-resize-handles, .resize-edge, .resize-handle, .resize-corner-grip, button, input, select, textarea'
          )
        )
        if (!isInteractive && e.button === 0) {
          onStartMove(e.clientX, e.clientY)
        }
      }}
    >
      {/* Unified Header — dragging anywhere here moves the entire graph cleanly */}
      <div className="canvas-graph-header" title="Drag anywhere to move Graph as one unit">
        <div className="canvas-graph-drag">
          <span className="code-card-move-pill">
            <GripHorizontal size={12} />
          </span>
          {is3D ? <Box size={13} className="text-accent" /> : <LineChart size={13} className="text-accent" />}
          {isEditingTitle ? (
            <input
              type="text"
              className="canvas-code-title-input"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => {
                setIsEditingTitle(false)
                const clean = titleDraft.trim() || 'Graph'
                onUpdate({ title: clean, spec: { ...spec, title: clean } })
              }}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') {
                  setIsEditingTitle(false)
                  const clean = titleDraft.trim() || 'Graph'
                  onUpdate({ title: clean, spec: { ...spec, title: clean } })
                }
              }}
              autoFocus
            />
          ) : (
            <span
              className="canvas-graph-title"
              title="Double-click to rename graph"
              onDoubleClick={(e) => {
                e.stopPropagation()
                setTitleDraft(spec.title || node.title || 'Graph')
                setIsEditingTitle(true)
              }}
            >
              {spec.title || node.title || 'Graph'}
            </span>
          )}
        </div>

        <div className="canvas-graph-actions" onPointerDown={(e) => e.stopPropagation()}>
          <select
            className="canvas-graph-type-select"
            value={chartType}
            title="Switch graph visualization type (2D or 3D)"
            onChange={(e) => updateSpec({ chartType: e.target.value as GraphChartType }, true)}
          >
            {GRAPH_CHART_TYPES.map((ct) => (
              <option key={ct.id} value={ct.id}>
                {ct.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            className={`canvas-code-hdr-btn ${showCustomize ? 'active' : ''}`}
            title="Customize graph colors, legends, axes & data"
            onClick={() => setShowCustomize((v) => !v)}
          >
            <Palette size={12} />
          </button>

          {onInsertToNotes && (
            <button
              type="button"
              className="canvas-code-hdr-btn"
              title="Send graph summary / 3D spec to Notes"
              onClick={handleSendToNote}
            >
              <FilePlus2 size={12} />
            </button>
          )}
          <button
            type="button"
            className="canvas-code-hdr-btn"
            title="Duplicate Graph"
            onClick={onDuplicate}
          >
            <Copy size={12} />
          </button>
          <button
            type="button"
            className="canvas-code-hdr-btn danger"
            title="Delete Graph"
            onClick={onDelete}
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Interactive 2D / 3D Plot Body */}
      <div className="canvas-graph-body">
        <InteractiveGraphViewport
          spec={spec}
          width={Math.max(200, node.w - 12)}
          height={Math.max(130, node.h - 46)}
          compact={node.w < 420}
          isLightTheme={isLightTheme}
          interactive={!disabledPointerEvents}
        />
      </div>

      {/* Expandable Customize Drawer (Data | Colors | Axes & Legend) */}
      {showCustomize && (
        <div
          className="canvas-graph-custom-drawer"
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <div className="canvas-graph-drawer-tabs">
            <button
              type="button"
              className={customTab === 'colors' ? 'active' : ''}
              onClick={() => setCustomTab('colors')}
            >
              <Palette size={11} />
              <span>Colors</span>
            </button>
            <button
              type="button"
              className={customTab === 'axes' ? 'active' : ''}
              onClick={() => setCustomTab('axes')}
            >
              <SlidersHorizontal size={11} />
              <span>Axes &amp; Legend</span>
            </button>
            <button
              type="button"
              className={customTab === 'data' ? 'active' : ''}
              onClick={() => setCustomTab('data')}
            >
              <LineChart size={11} />
              <span>Data</span>
            </button>
            <button
              type="button"
              className="canvas-graph-drawer-close"
              onClick={() => setShowCustomize(false)}
              title="Close"
            >
              <X size={12} />
            </button>
          </div>

          <div className="canvas-graph-drawer-body">
            {customTab === 'colors' && (
              <>
                <div className="graph-palette-row">
                  {GRAPH_COLOR_PALETTES.map((pal) => (
                    <button
                      key={pal.id}
                      type="button"
                      className="graph-palette-chip"
                      title={`Apply ${pal.name} palette`}
                      onClick={() => applyPalette(pal.colors)}
                    >
                      <span className="graph-palette-dots">
                        {pal.colors.slice(0, 4).map((c, ci) => (
                          <i key={ci} style={{ background: c }} />
                        ))}
                      </span>
                      <span>{pal.name}</span>
                    </button>
                  ))}
                </div>

                <div className="graph-color-grid">
                  <label>
                    <span>Background</span>
                    <input
                      type="color"
                      value={spec.backgroundColor || '#FFFFFF'}
                      onChange={(e) => updateSpec({ backgroundColor: e.target.value })}
                    />
                  </label>
                  <label>
                    <span>Axes</span>
                    <input
                      type="color"
                      value={spec.axisColor || '#1E293B'}
                      onChange={(e) => updateSpec({ axisColor: e.target.value })}
                    />
                  </label>
                  <label>
                    <span>Grid</span>
                    <input
                      type="color"
                      value={spec.gridColor || '#E2E8F0'}
                      onChange={(e) => updateSpec({ gridColor: e.target.value })}
                    />
                  </label>
                  <label>
                    <span>Labels</span>
                    <input
                      type="color"
                      value={spec.textColor || '#475569'}
                      onChange={(e) => updateSpec({ textColor: e.target.value })}
                    />
                  </label>
                </div>

                {chartType === 'function' ? (
                  spec.functions.map((fn, idx) => (
                    <div key={fn.id} className="graph-series-mini-row">
                      <input
                        type="color"
                        value={fn.color}
                        onChange={(e) => {
                          const next = [...spec.functions]
                          next[idx] = { ...fn, color: e.target.value }
                          updateSpec({ functions: next })
                        }}
                      />
                      <input
                        type="text"
                        value={fn.label}
                        onChange={(e) => {
                          const next = [...spec.functions]
                          next[idx] = { ...fn, label: e.target.value }
                          updateSpec({ functions: next })
                        }}
                        placeholder="Legend label"
                      />
                    </div>
                  ))
                ) : (
                  spec.dataSeries.map((ds, idx) => (
                    <div key={ds.id} className="graph-series-mini-row">
                      <input
                        type="color"
                        value={ds.color}
                        onChange={(e) => {
                          const next = [...spec.dataSeries]
                          next[idx] = { ...ds, color: e.target.value }
                          updateSpec({ dataSeries: next })
                        }}
                      />
                      <input
                        type="text"
                        value={ds.label}
                        onChange={(e) => {
                          const next = [...spec.dataSeries]
                          next[idx] = { ...ds, label: e.target.value }
                          updateSpec({ dataSeries: next })
                        }}
                        placeholder="Legend label"
                      />
                    </div>
                  ))
                )}
              </>
            )}

            {customTab === 'axes' && (
              <>
                <div className="graph-bounds-grid two-col">
                  <label>
                    <span>Axis Style</span>
                    <select
                      value={spec.axisStyle}
                      onChange={(e) => updateSpec({ axisStyle: e.target.value as GraphAxisStyle })}
                    >
                      <option value="origin">Through Origin (0,0)</option>
                      <option value="frame">Bottom-Left Frame</option>
                      <option value="box">4-Sided Box</option>
                      <option value="none">Hidden Axes</option>
                    </select>
                  </label>
                  <label>
                    <span>Legend Position</span>
                    <select
                      value={spec.legendPosition || 'bottom'}
                      onChange={(e) =>
                        updateSpec({ legendPosition: e.target.value as GraphLegendPosition })
                      }
                    >
                      <option value="bottom">Bottom</option>
                      <option value="top">Top</option>
                      <option value="right">Right</option>
                      <option value="inside">Inside Top-Right</option>
                    </select>
                  </label>
                </div>

                <div className="graph-bounds-grid two-col">
                  <label>
                    <span>X Label</span>
                    <input
                      type="text"
                      value={spec.xLabel}
                      onChange={(e) => updateSpec({ xLabel: e.target.value })}
                    />
                  </label>
                  <label>
                    <span>Y Label</span>
                    <input
                      type="text"
                      value={spec.yLabel}
                      onChange={(e) => updateSpec({ yLabel: e.target.value })}
                    />
                  </label>
                </div>

                <div className="graph-options-row">
                  <label className="graph-check-label">
                    <input
                      type="checkbox"
                      checked={spec.showGrid}
                      onChange={(e) => updateSpec({ showGrid: e.target.checked })}
                    />
                    <span>Grid</span>
                  </label>
                  <label className="graph-check-label">
                    <input
                      type="checkbox"
                      checked={spec.showLegend}
                      onChange={(e) => updateSpec({ showLegend: e.target.checked })}
                    />
                    <span>Legend</span>
                  </label>
                  {chartType === 'histogram' && (
                    <label className="graph-check-label">
                      <input
                        type="checkbox"
                        checked={Boolean(spec.showKde)}
                        onChange={(e) => updateSpec({ showKde: e.target.checked })}
                      />
                      <span>KDE Curve</span>
                    </label>
                  )}
                  {(chartType === 'scatter' || chartType === 'line') && (
                    <label className="graph-check-label">
                      <input
                        type="checkbox"
                        checked={Boolean(spec.showTrendline)}
                        onChange={(e) => updateSpec({ showTrendline: e.target.checked })}
                      />
                      <span>Trendline</span>
                    </label>
                  )}
                  {chartType === 'pie' && (
                    <label className="graph-check-label">
                      <input
                        type="checkbox"
                        checked={Boolean(spec.donut)}
                        onChange={(e) => updateSpec({ donut: e.target.checked })}
                      />
                      <span>Donut</span>
                    </label>
                  )}
                </div>
              </>
            )}

            {customTab === 'data' && (
              <>
                {chartType === 'function' ? (
                  <>
                    <div className="graph-bounds-grid">
                      <label>
                        <span>x min</span>
                        <input
                          type="number"
                          step="any"
                          value={spec.xMin}
                          onChange={(e) => updateSpec({ xMin: Number(e.target.value) })}
                        />
                      </label>
                      <label>
                        <span>x max</span>
                        <input
                          type="number"
                          step="any"
                          value={spec.xMax}
                          onChange={(e) => updateSpec({ xMax: Number(e.target.value) })}
                        />
                      </label>
                      <label>
                        <span>y min</span>
                        <input
                          type="number"
                          step="any"
                          value={spec.yMin}
                          onChange={(e) => updateSpec({ yMin: Number(e.target.value) })}
                        />
                      </label>
                      <label>
                        <span>y max</span>
                        <input
                          type="number"
                          step="any"
                          value={spec.yMax}
                          onChange={(e) => updateSpec({ yMax: Number(e.target.value) })}
                        />
                      </label>
                    </div>
                    {spec.functions.map((fn, idx) => (
                      <div key={fn.id} className="graph-series-mini-row">
                        <input
                          type="text"
                          value={fn.expr}
                          onChange={(e) => {
                            const next = [...spec.functions]
                            next[idx] = { ...fn, expr: e.target.value, label: e.target.value }
                            updateSpec({ functions: next })
                          }}
                          placeholder="e.g. x^2 - 3*x"
                        />
                      </div>
                    ))}
                    <button
                      type="button"
                      className="graph-mini-add-btn"
                      onClick={() =>
                        updateSpec({
                          functions: [
                            ...spec.functions,
                            {
                              id: `fn-${Date.now()}`,
                              label: '0.5*x',
                              expr: '0.5*x',
                              color: GRAPH_SERIES_COLORS[spec.functions.length % GRAPH_SERIES_COLORS.length]
                            }
                          ]
                        })
                      }
                    >
                      <Plus size={11} /> Add Curve
                    </button>
                  </>
                ) : chartType === 'surface3d' && !spec.zMatrix && spec.dataSeries.length === 0 ? (
                  <div className="graph-field-row">
                    <label>
                      <span>3D Formula z = f(x, y)</span>
                      <input
                        type="text"
                        value={spec.expr3d || 'sin(x)*cos(y)'}
                        onChange={(e) => updateSpec({ expr3d: e.target.value })}
                      />
                    </label>
                  </div>
                ) : (
                  <>
                    <div className="graph-field-row">
                      <label>
                        <span>Categories / X Labels</span>
                        <input
                          type="text"
                          value={spec.categoriesText}
                          onChange={(e) => updateSpec({ categoriesText: e.target.value })}
                        />
                      </label>
                    </div>
                    {spec.dataSeries.map((ds, idx) => (
                      <div key={ds.id} className="graph-series-mini-row">
                        <input
                          type="text"
                          value={ds.valuesText}
                          onChange={(e) => {
                            const next = [...spec.dataSeries]
                            next[idx] = { ...ds, valuesText: e.target.value }
                            updateSpec({ dataSeries: next })
                          }}
                          placeholder="Y values (comma-separated)"
                        />
                      </div>
                    ))}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {isResizing && (
        <div className="resize-dimension-badge">
          {node.w} × {node.h} px
        </div>
      )}

      {/* Flowchart Connection Ports */}
      {!disabledPointerEvents &&
        onStartConnect &&
        (isSelected || isHovered || isResizing) &&
        (['top', 'right', 'bottom', 'left'] as const).map((port) => (
          <button
            key={`graph-port-${port}`}
            type="button"
            className={`card-flow-port-handle pos-${port}`}
            title="Connect to a Coding Tab, Shape, or 3D Scene"
            onPointerDown={(e) => {
              if (e.button !== 0) return
              e.preventDefault()
              e.stopPropagation()
              onSelect()
              onStartConnect(node.id, port, e.clientX, e.clientY)
            }}
          />
        ))}

      {/* 8 Resize Handles */}
      {!disabledPointerEvents && onStartResize && (
        <div className="card-resize-handles">
          {(['n', 's', 'e', 'w'] as const).map((dir) => (
            <div
              key={`graph-edge-${dir}`}
              className={`resize-edge ${dir}`}
              onPointerDown={(e) => {
                e.stopPropagation()
                onStartResize(e, dir)
              }}
            />
          ))}
          {(isSelected || isHovered || isResizing) &&
            (['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const).map((dir) => (
              <div
                key={`graph-h-${dir}`}
                className={`resize-handle ${dir}`}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  onStartResize(e, dir)
                }}
              />
            ))}
        </div>
      )}
    </div>
  )
}
