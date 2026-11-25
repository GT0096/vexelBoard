import React, { useMemo, useState } from 'react'
import { LineChart, Plus, Trash2, X } from 'lucide-react'
import {
  buildGraphPreviewModel,
  GRAPH_PRESETS,
  GRAPH_SERIES_COLORS,
  type GraphAxisStyle,
  type GraphDataChartKind,
  type GraphPlotSpec
} from '../board/graphPlotBuilder'

interface GraphBuilderFlyoutProps {
  onInsertGraph: (spec: GraphPlotSpec) => void
  onClose: () => void
}

function cloneSpec(spec: GraphPlotSpec): GraphPlotSpec {
  return {
    ...spec,
    functions: spec.functions.map((f) => ({ ...f })),
    dataSeries: spec.dataSeries.map((d) => ({ ...d }))
  }
}

export const GraphBuilderFlyout: React.FC<GraphBuilderFlyoutProps> = ({
  onInsertGraph,
  onClose
}) => {
  const [spec, setSpec] = useState<GraphPlotSpec>(() => cloneSpec(GRAPH_PRESETS[0].spec))
  const [activePresetId, setActivePresetId] = useState<string>(GRAPH_PRESETS[0].id)

  const preview = useMemo(() => buildGraphPreviewModel(spec, 300, 174), [spec])

  const updateField = <K extends keyof GraphPlotSpec>(key: K, val: GraphPlotSpec[K]): void => {
    setSpec((prev) => ({ ...prev, [key]: val }))
  }

  return (
    <div
      className="vx-flyout-panel graph-builder-flyout"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="vx-flyout-header">
        <div className="vx-flyout-title">
          <LineChart size={15} />
          <span>Graph &amp; Function Plotter</span>
        </div>
        <button
          type="button"
          className="vx-flyout-close-btn"
          title="Close graph builder"
          onClick={onClose}
        >
          <X size={14} />
        </button>
      </div>

      {/* 1. One-Click Presets */}
      <div className="graph-presets-rail">
        {GRAPH_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`graph-preset-chip ${activePresetId === p.id ? 'active' : ''}`}
            title={p.description}
            onClick={() => {
              setActivePresetId(p.id)
              setSpec(cloneSpec(p.spec))
            }}
          >
            {p.name}
          </button>
        ))}
      </div>

      {/* 2. Live Interactive Vector SVG Preview */}
      <div className="graph-preview-card">
        <svg viewBox={`0 0 ${preview.viewW} ${preview.viewH}`} className="graph-preview-svg">
          <rect
            x="1"
            y="1"
            width={preview.viewW - 2}
            height={preview.viewH - 2}
            rx="10"
            fill="#FFFFFF"
            stroke="#111111"
            strokeWidth="1.5"
          />
          {spec.title.trim() && (
            <text
              x={preview.viewW / 2}
              y={14}
              textAnchor="middle"
              fontSize="10.5"
              fontWeight="700"
              fill="#111111"
            >
              {spec.title.trim()}
            </text>
          )}
          {spec.showGrid &&
            preview.gridLinesX.map((gx, idx) => (
              <line
                key={`gx-${idx}`}
                x1={gx}
                y1={preview.plotY}
                x2={gx}
                y2={preview.plotY + preview.plotH}
                stroke="#E2E8F0"
                strokeWidth="1"
                strokeDasharray="3 3"
              />
            ))}
          {spec.showGrid &&
            preview.gridLinesY.map((gy, idx) => (
              <line
                key={`gy-${idx}`}
                x1={preview.plotX}
                y1={gy}
                x2={preview.plotX + preview.plotW}
                y2={gy}
                stroke="#E2E8F0"
                strokeWidth="1"
                strokeDasharray="3 3"
              />
            ))}
          {/* X and Y Axes */}
          <line
            x1={preview.plotX}
            y1={preview.xAxisY}
            x2={preview.plotX + preview.plotW}
            y2={preview.xAxisY}
            stroke="#111111"
            strokeWidth="1.5"
          />
          <line
            x1={preview.yAxisX}
            y1={preview.plotY}
            x2={preview.yAxisX}
            y2={preview.plotY + preview.plotH}
            stroke="#111111"
            strokeWidth="1.5"
          />
          {/* Bars */}
          {preview.bars.map((b, idx) => (
            <rect
              key={`bar-${idx}`}
              x={b.x}
              y={b.y}
              width={b.w}
              height={b.h}
              rx="2"
              fill={b.color}
              fillOpacity="0.86"
              stroke="#111111"
              strokeWidth="1"
            />
          ))}
          {/* Curves */}
          {preview.paths.map((p, idx) => (
            <path
              key={`p-${idx}`}
              d={p.d}
              fill="none"
              stroke={p.color}
              strokeWidth={p.strokeWidth ?? 2.4}
              strokeDasharray={p.dashed ? '5 4' : undefined}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          {/* Dots */}
          {preview.dots.map((d, idx) => (
            <circle
              key={`d-${idx}`}
              cx={d.cx}
              cy={d.cy}
              r={spec.dataKind === 'scatter' ? 4 : 3}
              fill={d.color}
              stroke="#FFFFFF"
              strokeWidth="1.2"
            />
          ))}
          {/* Tick labels */}
          {preview.xTicks.map((tk, idx) => (
            <text
              key={`xt-${idx}`}
              x={tk.pos}
              y={preview.plotY + preview.plotH + 12}
              textAnchor="middle"
              fontSize="8.5"
              fill="#475569"
            >
              {tk.label}
            </text>
          ))}
          {preview.yTicks.map((tk, idx) => (
            <text
              key={`yt-${idx}`}
              x={preview.plotX - 5}
              y={tk.pos + 3}
              textAnchor="end"
              fontSize="8.5"
              fill="#475569"
            >
              {tk.label}
            </text>
          ))}
          {/* Legend */}
          {spec.showLegend &&
            preview.legend.slice(0, 4).map((lg, idx) => {
              const step = Math.floor(preview.viewW / Math.max(1, Math.min(4, preview.legend.length)))
              const lx = 14 + idx * step
              return (
                <g key={`lg-${idx}`}>
                  <line
                    x1={lx}
                    y1={preview.viewH - 9}
                    x2={lx + 14}
                    y2={preview.viewH - 9}
                    stroke={lg.color}
                    strokeWidth="2.5"
                    strokeDasharray={lg.dashed ? '4 3' : undefined}
                  />
                  <text x={lx + 18} y={preview.viewH - 6} fontSize="8.5" fontWeight="600" fill="#111111">
                    {lg.label.slice(0, 14)}
                  </text>
                </g>
              )
            })}
        </svg>
      </div>

      {/* 3. Mode Switch & Scrollable Config */}
      <div className="graph-config-scroll">
        <div className="graph-mode-tabs">
          <button
            type="button"
            className={`vx-filter-pill ${spec.mode === 'function' ? 'active' : ''}`}
            onClick={() => updateField('mode', 'function')}
          >
            y = f(x) Functions
          </button>
          <button
            type="button"
            className={`vx-filter-pill ${spec.mode === 'data' ? 'active' : ''}`}
            onClick={() => updateField('mode', 'data')}
          >
            Data Chart (Line / Bar)
          </button>
        </div>

        <div className="graph-field-row">
          <label>
            <span>Title</span>
            <input
              type="text"
              value={spec.title}
              onChange={(e) => updateField('title', e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              placeholder="Chart title..."
            />
          </label>
        </div>

        {spec.mode === 'function' ? (
          <>
            <div className="graph-bounds-grid">
              <label>
                <span>x min</span>
                <input
                  type="number"
                  step="any"
                  value={spec.xMin}
                  onChange={(e) => updateField('xMin', Number(e.target.value))}
                  onKeyDown={(e) => e.stopPropagation()}
                />
              </label>
              <label>
                <span>x max</span>
                <input
                  type="number"
                  step="any"
                  value={spec.xMax}
                  onChange={(e) => updateField('xMax', Number(e.target.value))}
                  onKeyDown={(e) => e.stopPropagation()}
                />
              </label>
              <label>
                <span>y min</span>
                <input
                  type="number"
                  step="any"
                  value={spec.yMin}
                  onChange={(e) => updateField('yMin', Number(e.target.value))}
                  onKeyDown={(e) => e.stopPropagation()}
                />
              </label>
              <label>
                <span>y max</span>
                <input
                  type="number"
                  step="any"
                  value={spec.yMax}
                  onChange={(e) => updateField('yMax', Number(e.target.value))}
                  onKeyDown={(e) => e.stopPropagation()}
                />
              </label>
            </div>

            <div className="graph-series-section">
              <div className="graph-series-header">
                <span>Curves (sin, cos, exp, sigmoid, silu, x^2...)</span>
                {spec.functions.length < 4 && (
                  <button
                    type="button"
                    className="graph-mini-add-btn"
                    onClick={() =>
                      updateField('functions', [
                        ...spec.functions,
                        {
                          id: `fn-${Date.now()}`,
                          label: `f${spec.functions.length + 1}(x)`,
                          expr: '0.5*x',
                          color:
                            GRAPH_SERIES_COLORS[spec.functions.length % GRAPH_SERIES_COLORS.length]
                        }
                      ])
                    }
                  >
                    <Plus size={11} /> Add
                  </button>
                )}
              </div>
              {spec.functions.map((fn, idx) => (
                <div key={fn.id} className="graph-series-row">
                  <input
                    type="color"
                    className="graph-color-input"
                    value={fn.color}
                    title="Curve color"
                    onChange={(e) => {
                      const next = [...spec.functions]
                      next[idx] = { ...fn, color: e.target.value }
                      updateField('functions', next)
                    }}
                  />
                  <input
                    type="text"
                    className="graph-expr-input"
                    value={fn.expr}
                    placeholder="e.g. sin(x) + 0.2*x"
                    onKeyDown={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      const next = [...spec.functions]
                      next[idx] = { ...fn, expr: e.target.value, label: e.target.value }
                      updateField('functions', next)
                    }}
                  />
                  <button
                    type="button"
                    className={`graph-dash-btn ${fn.dashed ? 'active' : ''}`}
                    title="Toggle dashed curve"
                    onClick={() => {
                      const next = [...spec.functions]
                      next[idx] = { ...fn, dashed: !fn.dashed }
                      updateField('functions', next)
                    }}
                  >
                    ---
                  </button>
                  <button
                    type="button"
                    className="graph-del-btn"
                    title="Remove curve"
                    onClick={() =>
                      updateField(
                        'functions',
                        spec.functions.filter((_, i) => i !== idx)
                      )
                    }
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="graph-bounds-grid two-col">
              <label>
                <span>Chart Style</span>
                <select
                  value={spec.dataKind}
                  onChange={(e) => updateField('dataKind', e.target.value as GraphDataChartKind)}
                >
                  <option value="line">Line Plot</option>
                  <option value="smooth">Smooth Curve</option>
                  <option value="bar">Bar Chart</option>
                  <option value="scatter">Scatter Points</option>
                </select>
              </label>
              <label>
                <span>X Labels (comma-separated)</span>
                <input
                  type="text"
                  value={spec.categoriesText}
                  onKeyDown={(e) => e.stopPropagation()}
                  onChange={(e) => updateField('categoriesText', e.target.value)}
                  placeholder="E1, E2, E3..."
                />
              </label>
            </div>

            <div className="graph-series-section">
              <div className="graph-series-header">
                <span>Data Series (comma-separated numbers)</span>
                {spec.dataSeries.length < 4 && (
                  <button
                    type="button"
                    className="graph-mini-add-btn"
                    onClick={() =>
                      updateField('dataSeries', [
                        ...spec.dataSeries,
                        {
                          id: `ds-${Date.now()}`,
                          label: `Series ${spec.dataSeries.length + 1}`,
                          valuesText: '1, 2, 3, 4',
                          color:
                            GRAPH_SERIES_COLORS[spec.dataSeries.length % GRAPH_SERIES_COLORS.length]
                        }
                      ])
                    }
                  >
                    <Plus size={11} /> Add
                  </button>
                )}
              </div>
              {spec.dataSeries.map((ds, idx) => (
                <div key={ds.id} className="graph-series-row data-row">
                  <input
                    type="color"
                    className="graph-color-input"
                    value={ds.color}
                    onChange={(e) => {
                      const next = [...spec.dataSeries]
                      next[idx] = { ...ds, color: e.target.value }
                      updateField('dataSeries', next)
                    }}
                  />
                  <input
                    type="text"
                    className="graph-label-input"
                    value={ds.label}
                    placeholder="Label"
                    onKeyDown={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      const next = [...spec.dataSeries]
                      next[idx] = { ...ds, label: e.target.value }
                      updateField('dataSeries', next)
                    }}
                  />
                  <input
                    type="text"
                    className="graph-expr-input"
                    value={ds.valuesText}
                    placeholder="1, 2, 4, 3"
                    onKeyDown={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      const next = [...spec.dataSeries]
                      next[idx] = { ...ds, valuesText: e.target.value }
                      updateField('dataSeries', next)
                    }}
                  />
                  <button
                    type="button"
                    className="graph-del-btn"
                    title="Remove series"
                    onClick={() =>
                      updateField(
                        'dataSeries',
                        spec.dataSeries.filter((_, i) => i !== idx)
                      )
                    }
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="graph-bounds-grid two-col">
          <label>
            <span>X Axis Label</span>
            <input
              type="text"
              value={spec.xLabel}
              onKeyDown={(e) => e.stopPropagation()}
              onChange={(e) => updateField('xLabel', e.target.value)}
            />
          </label>
          <label>
            <span>Y Axis Label</span>
            <input
              type="text"
              value={spec.yLabel}
              onKeyDown={(e) => e.stopPropagation()}
              onChange={(e) => updateField('yLabel', e.target.value)}
            />
          </label>
        </div>

        <div className="graph-options-row">
          <select
            value={spec.axisStyle}
            onChange={(e) => updateField('axisStyle', e.target.value as GraphAxisStyle)}
            title="Axes layout"
          >
            <option value="origin">Axes through Origin (0,0)</option>
            <option value="frame">Bottom-Left Axes Frame</option>
          </select>
          <label className="graph-check-label">
            <input
              type="checkbox"
              checked={spec.showGrid}
              onChange={(e) => updateField('showGrid', e.target.checked)}
            />
            <span>Grid</span>
          </label>
          <label className="graph-check-label">
            <input
              type="checkbox"
              checked={spec.showLegend}
              onChange={(e) => updateField('showLegend', e.target.checked)}
            />
            <span>Legend</span>
          </label>
        </div>
      </div>

      <button
        type="button"
        className="graph-insert-primary-btn"
        onClick={() => {
          onInsertGraph(spec)
          onClose()
        }}
      >
        <Plus size={15} />
        <span>Insert Graph onto Board</span>
      </button>
    </div>
  )
}
