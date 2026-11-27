import React, { useState } from 'react'
import { Box, Code2, LineChart, Palette, Plus, Trash2, X } from 'lucide-react'
import {
  GRAPH_CHART_TYPES,
  GRAPH_COLOR_PALETTES,
  GRAPH_PRESETS,
  GRAPH_SERIES_COLORS,
  is3DGraphChartType,
  resolveGraphChartType,
  type GraphAxisStyle,
  type GraphChartType,
  type GraphLegendPosition,
  type GraphPlotSpec
} from '../board/graphPlotBuilder'
import {
  buildPresetScene3D,
  SCENE3D_PRESETS,
  type Scene3DElement,
  type Scene3DSpec
} from '@shared/scene3dSchema'
import { Inline3DViewer } from './Canvas3DScene'
import { InteractiveGraphViewport } from './CanvasGraphCard'

interface GraphBuilderFlyoutProps {
  onInsertGraph: (spec: GraphPlotSpec) => void
  onInsertScene3D?: (spec: Scene3DSpec) => void
  onCreateLinkedCode?: (opts: { kind: '2d' | '3d'; graphSpec?: GraphPlotSpec; scene3dSpec?: Scene3DSpec }) => void
  onClose: () => void
}

function cloneSpec(spec: GraphPlotSpec): GraphPlotSpec {
  return {
    ...spec,
    functions: spec.functions.map((f) => ({ ...f })),
    dataSeries: spec.dataSeries.map((d) => ({
      ...d,
      sliceColors: d.sliceColors ? [...d.sliceColors] : undefined
    })),
    ohlcData: spec.ohlcData ? spec.ohlcData.map((c) => ({ ...c })) : undefined,
    zMatrix: spec.zMatrix ? spec.zMatrix.map((r) => [...r]) : undefined
  }
}

export const GraphBuilderFlyout: React.FC<GraphBuilderFlyoutProps> = ({
  onInsertGraph,
  onInsertScene3D,
  onCreateLinkedCode,
  onClose
}) => {
  const [builderMode, setBuilderMode] = useState<'graph' | 'scene3d'>('graph')
  const [spec, setSpec] = useState<GraphPlotSpec>(() => cloneSpec(GRAPH_PRESETS[0].spec))
  const [activePresetId, setActivePresetId] = useState<string>(GRAPH_PRESETS[0].id)

  const [scene3dSpec, setScene3dSpec] = useState<Scene3DSpec>(() => buildPresetScene3D('car'))
  const [active3dPresetId, setActive3dPresetId] = useState<string>('car')

  const chartType = resolveGraphChartType(spec)
  const is3DChart = is3DGraphChartType(chartType)
  const surfaceEl = scene3dSpec.elements.find((e) => e.type === 'surface3d')

  const updateField = <K extends keyof GraphPlotSpec>(key: K, val: GraphPlotSpec[K]): void => {
    setSpec((prev) => ({ ...prev, [key]: val }))
  }

  const handleSelectChartType = (nextType: GraphChartType): void => {
    setSpec((prev) => {
      const next: GraphPlotSpec = {
        ...prev,
        chartType: nextType,
        mode: is3DGraphChartType(nextType)
          ? '3d'
          : nextType === 'function'
            ? 'function'
            : 'data'
      }
      if (nextType === 'line' || nextType === 'smooth' || nextType === 'bar' || nextType === 'scatter') {
        next.dataKind = nextType
      }
      if (nextType === 'surface3d' && !next.expr3d && !next.zMatrix && next.dataSeries.length === 0) {
        next.expr3d = 'sin(x)*cos(y)*0.9'
      }
      if ((nextType === 'scatter3d' || nextType === 'line3d' || nextType === 'bar3d') && next.dataSeries.every((d) => !d.zValuesText)) {
        next.dataSeries = [
          {
            id: 'd1',
            label: '3D Coordinates',
            xValuesText: '1.5, 1.2, 0.5, -0.4, -1.1, -1.5, -1.3, -0.6, 0.3, 1.1',
            valuesText: '0, 0.9, 1.4, 1.4, 0.9, 0.1, -0.8, -1.4, -1.5, -1.0',
            zValuesText: '-1, -0.6, -0.2, 0.2, 0.6, 1.0, 1.4, 1.8, 2.2, 2.6',
            color: prev.dataSeries[0]?.color || GRAPH_SERIES_COLORS[0]
          }
        ]
      }
      return next
    })
  }

  const handleApplyPalette = (colors: string[]): void => {
    setSpec((prev) => ({
      ...prev,
      functions: prev.functions.map((f, i) => ({ ...f, color: colors[i % colors.length] })),
      dataSeries: prev.dataSeries.map((d, i) => ({
        ...d,
        color: colors[i % colors.length],
        sliceColors: colors
      })),
      bullColor: colors[0],
      bearColor: colors[1] ?? '#EF4444'
    }))
  }

  const handleAdd3dPrimitive = (
    kind: 'box' | 'sphere' | 'cylinder' | 'wheel' | 'spring' | 'lens' | 'flask' | 'arrow3d'
  ): void => {
    const idx = scene3dSpec.elements.length + 1
    const el: Scene3DElement =
      kind === 'wheel'
        ? { id: `wheel-${idx}`, type: 'wheel', pos: [0, 0, 1], radius: 0.36, color: '#0F172A', anim: { rotateSpeed: [0, 0, -2] } }
        : kind === 'spring'
          ? { id: `spring-${idx}`, type: 'spring', from: [-1, 0.5, 0], to: [1, 0.5, 0], radius: 0.24, turns: 8, color: '#F59E0B' }
          : kind === 'lens'
            ? { id: `lens-${idx}`, type: 'lens', pos: [0, 0.5, 0], radius: 0.65, color: '#38BDF8', opacity: 0.48 }
            : kind === 'flask'
              ? { id: `flask-${idx}`, type: 'flask', pos: [0, -0.35, 0], radius: 0.5, height: 1.05, fillLevel: 0.5, color: '#E0F2FE', liquidColor: '#EC4899' }
              : kind === 'arrow3d'
                ? { id: `vec-${idx}`, type: 'arrow3d', from: [0, 0.2, 0], to: [1.6, 0.9, 0.3], color: '#10B981', anim: { pulseFlow: true } }
                : kind === 'sphere'
                  ? { id: `sphere-${idx}`, type: 'sphere', pos: [0.8, 0.4, 0], radius: 0.4, color: '#EF4444' }
                  : kind === 'cylinder'
                    ? { id: `cyl-${idx}`, type: 'cylinder', pos: [-0.8, 0.4, 0], radius: 0.3, height: 0.9, color: '#10B981' }
                    : { id: `box-${idx}`, type: 'box', pos: [0, 0.4, 0], size: [0.9, 0.6, 0.9], color: '#3B82F6' }
    setScene3dSpec((prev) => ({
      ...prev,
      preset: 'custom',
      elements: [...prev.elements, el]
    }))
  }

  return (
    <div
      className="vx-flyout-panel graph-builder-flyout"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="vx-flyout-header">
        <div className="vx-flyout-title">
          {builderMode === 'scene3d' ? <Box size={15} /> : <LineChart size={15} />}
          <span>{builderMode === 'scene3d' ? '3D Objects & Lab Builder' : 'Plotly / GeoGebra 2D & 3D Plotter'}</span>
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

      {/* Top Plotter / 3D Apparatus Switch */}
      <div className="graph-mode-tabs">
        <button
          type="button"
          className={`vx-filter-pill ${builderMode === 'graph' ? 'active' : ''}`}
          onClick={() => setBuilderMode('graph')}
        >
          2D &amp; 3D Graphs
        </button>
        <button
          type="button"
          className={`vx-filter-pill ${builderMode === 'scene3d' ? 'active' : ''}`}
          onClick={() => setBuilderMode('scene3d')}
        >
          3D Object / Lab Rig
        </button>
      </div>

      {builderMode === 'scene3d' ? (
        <>
          <div className="graph-presets-rail">
            {SCENE3D_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`graph-preset-chip ${active3dPresetId === p.id ? 'active' : ''}`}
                title={p.description}
                onClick={() => {
                  setActive3dPresetId(p.id)
                  setScene3dSpec(buildPresetScene3D(p.id))
                }}
              >
                {p.name}
              </button>
            ))}
          </div>

          <Inline3DViewer spec={scene3dSpec} height={185} compact />

          <div className="graph-config-scroll">
            <div className="graph-field-row">
              <label>
                <span>Title</span>
                <input
                  type="text"
                  value={scene3dSpec.title || ''}
                  onChange={(e) => setScene3dSpec((prev) => ({ ...prev, title: e.target.value }))}
                  onKeyDown={(e) => e.stopPropagation()}
                  placeholder="3D object or experimental setup title..."
                />
              </label>
            </div>

            {surfaceEl && (
              <div className="graph-field-row">
                <label>
                  <span>3D Surface Formula z = f(x, y, t)</span>
                  <input
                    type="text"
                    value={surfaceEl.expr || ''}
                    onKeyDown={(e) => e.stopPropagation()}
                    onChange={(e) =>
                      setScene3dSpec((prev) => ({
                        ...prev,
                        elements: prev.elements.map((el) =>
                          el.id === surfaceEl.id ? { ...el, expr: e.target.value } : el
                        )
                      }))
                    }
                  />
                </label>
              </div>
            )}

            <div className="graph-series-section">
              <div className="graph-series-header">
                <span>Add 3D Part Manually ({scene3dSpec.elements.length} parts)</span>
              </div>
              <div className="graph-3d-parts-palette">
                {(['box', 'sphere', 'cylinder', 'wheel', 'spring', 'lens', 'flask', 'arrow3d'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    className="graph-mini-add-btn"
                    onClick={() => handleAdd3dPrimitive(k)}
                  >
                    + {k}
                  </button>
                ))}
              </div>
            </div>

            <div className="graph-options-row">
              <label className="graph-check-label">
                <input
                  type="checkbox"
                  checked={scene3dSpec.immersed !== false}
                  onChange={(e) => setScene3dSpec((prev) => ({ ...prev, immersed: e.target.checked }))}
                />
                <span>Canvas-Immersed</span>
              </label>
              <label className="graph-check-label">
                <input
                  type="checkbox"
                  checked={scene3dSpec.showGrid !== false}
                  onChange={(e) => setScene3dSpec((prev) => ({ ...prev, showGrid: e.target.checked }))}
                />
                <span>Grid</span>
              </label>
              <label className="graph-check-label">
                <input
                  type="checkbox"
                  checked={scene3dSpec.showAxes !== false}
                  onChange={(e) => setScene3dSpec((prev) => ({ ...prev, showAxes: e.target.checked }))}
                />
                <span>Axes</span>
              </label>
            </div>
          </div>

          <div className="graph-action-stack">
            {onInsertScene3D && (
              <button
                type="button"
                className="graph-insert-primary-btn"
                onClick={() => {
                  onInsertScene3D(scene3dSpec)
                  onClose()
                }}
              >
                <Box size={15} />
                <span>Immerse 3D Object on Canvas</span>
              </button>
            )}
            {onCreateLinkedCode && (
              <button
                type="button"
                className="graph-link-code-btn"
                onClick={() => {
                  onCreateLinkedCode({ kind: '3d', scene3dSpec })
                  onClose()
                }}
              >
                <Code2 size={14} />
                <span>Insert 3D + Connected Code Card</span>
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          {/* 1. One-Click Chart Presets */}
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

          {/* 2. Live Interactive Plotly/GeoGebra 2D & 3D Preview */}
          <div className="graph-preview-card">
            <InteractiveGraphViewport spec={spec} height={186} compact interactive />
          </div>

          {/* 3. Scrollable Config */}
          <div className="graph-config-scroll">
            <div className="graph-bounds-grid two-col">
              <label>
                <span>Chart Type</span>
                <select
                  value={chartType}
                  onChange={(e) => handleSelectChartType(e.target.value as GraphChartType)}
                >
                  <optgroup label="2D Functions (GeoGebra)">
                    {GRAPH_CHART_TYPES.filter((c) => c.group === '2d-fn').map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="2D Charts & Financial">
                    {GRAPH_CHART_TYPES.filter((c) => c.group === '2d-data').map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Statistical & Distributions">
                    {GRAPH_CHART_TYPES.filter((c) => c.group === '2d-stat').map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="3D Plots (Interactive)">
                    {GRAPH_CHART_TYPES.filter((c) => c.group === '3d').map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </label>

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

            {chartType === 'function' ? (
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
                    <span>Curves y = f(x)</span>
                    {spec.functions.length < 5 && (
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
                              color: GRAPH_SERIES_COLORS[spec.functions.length % GRAPH_SERIES_COLORS.length]
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
                        title="Toggle dashed"
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
            ) : chartType === 'surface3d' && !spec.zMatrix && spec.dataSeries.length === 0 ? (
              <div className="graph-field-row">
                <label>
                  <span>3D Surface Formula z = f(x, y)</span>
                  <input
                    type="text"
                    value={spec.expr3d || 'sin(x)*cos(y)'}
                    onKeyDown={(e) => e.stopPropagation()}
                    onChange={(e) => updateField('expr3d', e.target.value)}
                  />
                </label>
              </div>
            ) : (
              <>
                <div className="graph-bounds-grid two-col">
                  <label>
                    <span>Categories / X Labels</span>
                    <input
                      type="text"
                      value={spec.categoriesText}
                      onKeyDown={(e) => e.stopPropagation()}
                      onChange={(e) => updateField('categoriesText', e.target.value)}
                      placeholder="A, B, C... or 1, 2, 3"
                    />
                  </label>
                  {chartType === 'histogram' ? (
                    <label>
                      <span>Bins</span>
                      <input
                        type="number"
                        min={3}
                        max={40}
                        value={spec.bins ?? 10}
                        onChange={(e) => updateField('bins', Math.max(3, Number(e.target.value) || 10))}
                      />
                    </label>
                  ) : (
                    <label>
                      <span>Legend Position</span>
                      <select
                        value={spec.legendPosition || 'bottom'}
                        onChange={(e) =>
                          updateField('legendPosition', e.target.value as GraphLegendPosition)
                        }
                      >
                        <option value="bottom">Bottom</option>
                        <option value="top">Top</option>
                        <option value="right">Right</option>
                        <option value="inside">Inside</option>
                      </select>
                    </label>
                  )}
                </div>

                <div className="graph-series-section">
                  <div className="graph-series-header">
                    <span>Data Series {is3DChart ? '(x / y / z)' : '(values)'}</span>
                    {spec.dataSeries.length < 5 && (
                      <button
                        type="button"
                        className="graph-mini-add-btn"
                        onClick={() =>
                          updateField('dataSeries', [
                            ...spec.dataSeries,
                            {
                              id: `ds-${Date.now()}`,
                              label: `Series ${spec.dataSeries.length + 1}`,
                              valuesText: '1, 3, 2, 5, 4',
                              ...(is3DChart ? { xValuesText: '0, 1, 2, 3, 4', zValuesText: '1, 2, 3, 2, 4' } : {}),
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

            {/* Color Palettes + Theme Colors */}
            <div className="graph-series-section">
              <div className="graph-series-header">
                <span><Palette size={11} /> Color Theme &amp; Axes</span>
              </div>
              <div className="graph-palette-row">
                {GRAPH_COLOR_PALETTES.map((pal) => (
                  <button
                    key={pal.id}
                    type="button"
                    className="graph-palette-chip"
                    onClick={() => handleApplyPalette(pal.colors)}
                  >
                    <span className="graph-palette-dots">
                      {pal.colors.slice(0, 3).map((c, ci) => (
                        <i key={ci} style={{ background: c }} />
                      ))}
                    </span>
                    <span>{pal.name}</span>
                  </button>
                ))}
              </div>
              <div className="graph-color-grid">
                <label>
                  <span>Bg</span>
                  <input
                    type="color"
                    value={spec.backgroundColor || '#FFFFFF'}
                    onChange={(e) => updateField('backgroundColor', e.target.value)}
                  />
                </label>
                <label>
                  <span>Axes</span>
                  <input
                    type="color"
                    value={spec.axisColor || '#1E293B'}
                    onChange={(e) => updateField('axisColor', e.target.value)}
                  />
                </label>
                <label>
                  <span>Grid</span>
                  <input
                    type="color"
                    value={spec.gridColor || '#E2E8F0'}
                    onChange={(e) => updateField('gridColor', e.target.value)}
                  />
                </label>
                <label>
                  <span>Text</span>
                  <input
                    type="color"
                    value={spec.textColor || '#475569'}
                    onChange={(e) => updateField('textColor', e.target.value)}
                  />
                </label>
              </div>
            </div>

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
              >
                <option value="origin">Axes through Origin</option>
                <option value="frame">Bottom-Left Frame</option>
                <option value="box">4-Sided Box</option>
                <option value="none">No Axes</option>
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
              {chartType === 'histogram' && (
                <label className="graph-check-label">
                  <input
                    type="checkbox"
                    checked={Boolean(spec.showKde)}
                    onChange={(e) => updateField('showKde', e.target.checked)}
                  />
                  <span>KDE</span>
                </label>
              )}
              {chartType === 'pie' && (
                <label className="graph-check-label">
                  <input
                    type="checkbox"
                    checked={Boolean(spec.donut)}
                    onChange={(e) => updateField('donut', e.target.checked)}
                  />
                  <span>Donut</span>
                </label>
              )}
            </div>
          </div>

          <div className="graph-action-stack">
            <button
              type="button"
              className="graph-insert-primary-btn"
              onClick={() => {
                onInsertGraph(spec)
                onClose()
              }}
            >
              <Plus size={15} />
              <span>Insert Unified Graph onto Board</span>
            </button>
            {onCreateLinkedCode && (
              <button
                type="button"
                className="graph-link-code-btn"
                onClick={() => {
                  onCreateLinkedCode({ kind: '2d', graphSpec: spec })
                  onClose()
                }}
              >
                <Code2 size={14} />
                <span>Insert Graph + Connected Code Card</span>
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
