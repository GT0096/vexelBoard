import React, { memo, useMemo, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  BoxSelect,
  Eye,
  EyeOff,
  Layers,
  LayoutGrid,
  Lock,
  PenTool,
  Plus,
  Trash2,
  Unlock,
  X
} from 'lucide-react'
import type { BoardLayer, BoardState } from '../types/board'
import { countLayerItems } from '../board/layerUtils'

interface LayersPanelProps {
  isOpen: boolean
  board: BoardState
  layers: BoardLayer[]
  activeLayerId: string
  onClose: () => void
  onSelectActiveLayer: (layerId: string) => void
  onAddInkLayer: (position: 'top' | 'bottom') => void
  onToggleVisible: (layerId: string) => void
  onToggleLocked: (layerId: string) => void
  onSetOpacity: (layerId: string, opacity: number) => void
  onRenameLayer: (layerId: string, name: string) => void
  onMoveLayer: (layerId: string, dir: 'up' | 'down') => void
  onDeleteLayer: (layerId: string) => void
  onSelectLayerItems: (layerId: string) => void
}

export const LayersPanel = memo(function LayersPanel(
  props: LayersPanelProps
): React.JSX.Element | null {
  const {
    isOpen,
    board,
    layers,
    activeLayerId,
    onClose,
    onSelectActiveLayer,
    onAddInkLayer,
    onToggleVisible,
    onToggleLocked,
    onSetOpacity,
    onRenameLayer,
    onMoveLayer,
    onDeleteLayer,
    onSelectLayerItems
  } = props
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [expandedOpacityId, setExpandedOpacityId] = useState<string | null>(null)

  const itemCounts = useMemo(
    () => (isOpen ? countLayerItems(board, layers) : {}),
    [isOpen, board, layers]
  )

  if (!isOpen) return null

  const inkCount = layers.filter((l) => l.kind === 'ink').length
  const cardsIdx = layers.findIndex((l) => l.kind === 'elements')

  return (
    <div
      className="layers-panel"
      onPointerDown={(e) => e.stopPropagation()}
      role="dialog"
      aria-label="Canvas Layers"
    >
      <div className="layers-panel-header">
        <div className="layers-panel-title">
          <Layers size={15} />
          <span>Layers</span>
        </div>
        <div className="layers-panel-header-actions">
          <button
            type="button"
            className="layers-add-btn"
            onClick={() => onAddInkLayer('top')}
            title="Add new annotation ink layer ABOVE Cards, Diagrams & Code"
          >
            <Plus size={13} />
            <span>Top Ink</span>
          </button>
          <button
            type="button"
            className="layers-add-btn secondary"
            onClick={() => onAddInkLayer('bottom')}
            title="Add new ink layer BELOW Cards & Widgets"
          >
            <Plus size={13} />
            <span>Base</span>
          </button>
          <button
            type="button"
            className="layers-icon-btn"
            onClick={onClose}
            title="Close Layers (L)"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="layers-hint-bar">
        Ink layers above <strong>Cards &amp; Widgets</strong> let you draw directly over Text, Diagrams &amp; Code.
      </div>

      <div className="layers-list">
        {layers.map((layer, idx) => {
          const isInk = layer.kind === 'ink'
          const isActive = isInk && layer.id === activeLayerId
          const isAboveCards = isInk && cardsIdx >= 0 && idx < cardsIdx
          const count = itemCounts[layer.id] ?? 0
          const showOpacity = expandedOpacityId === layer.id

          return (
            <div
              key={layer.id}
              className={`layer-row ${isActive ? 'active' : ''} ${!isInk ? 'cards-row' : ''} ${!layer.visible ? 'is-hidden' : ''}`}
              onClick={() => {
                if (isInk) onSelectActiveLayer(layer.id)
              }}
            >
              <div className="layer-row-main">
                <span
                  className={`layer-kind-badge ${isInk ? (isAboveCards ? 'above' : 'below') : 'cards'}`}
                  title={
                    isInk
                      ? isAboveCards
                        ? 'Ink Layer (renders ABOVE Cards, Diagrams & Code)'
                        : 'Ink Layer (renders BELOW Cards)'
                      : 'Interactive Text, Diagrams, Code & Video Cards'
                  }
                >
                  {isInk ? <PenTool size={12} /> : <LayoutGrid size={12} />}
                </span>

                <div className="layer-name-wrap">
                  {editingId === layer.id ? (
                    <input
                      className="layer-rename-input"
                      autoFocus
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onBlur={() => {
                        if (draftName.trim()) onRenameLayer(layer.id, draftName)
                        setEditingId(null)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          if (draftName.trim()) onRenameLayer(layer.id, draftName)
                          setEditingId(null)
                        } else if (e.key === 'Escape') {
                          setEditingId(null)
                        }
                      }}
                    />
                  ) : (
                    <span
                      className="layer-name"
                      onDoubleClick={(e) => {
                        e.stopPropagation()
                        setEditingId(layer.id)
                        setDraftName(layer.name)
                      }}
                      title="Double-click to rename layer"
                    >
                      {layer.name}
                    </span>
                  )}
                  <span className="layer-meta-sub">
                    {count} {count === 1 ? 'item' : 'items'}
                    {layer.opacity < 0.99 ? ` · ${Math.round(layer.opacity * 100)}%` : ''}
                  </span>
                </div>

                <div className="layer-row-controls" onClick={(e) => e.stopPropagation()}>
                  {isInk && count > 0 && (
                    <button
                      type="button"
                      className="layer-ctrl-btn"
                      onClick={() => onSelectLayerItems(layer.id)}
                      title="Select all items on this layer"
                    >
                      <BoxSelect size={12} />
                    </button>
                  )}
                  <button
                    type="button"
                    className={`layer-ctrl-btn ${!layer.visible ? 'warn' : ''}`}
                    onClick={() => onToggleVisible(layer.id)}
                    title={layer.visible ? 'Hide layer' : 'Show layer'}
                  >
                    {layer.visible ? <Eye size={13} /> : <EyeOff size={13} />}
                  </button>
                  <button
                    type="button"
                    className={`layer-ctrl-btn ${layer.locked ? 'warn' : ''}`}
                    onClick={() => onToggleLocked(layer.id)}
                    title={
                      isInk
                        ? layer.locked
                          ? 'Unlock layer'
                          : 'Lock layer'
                        : layer.locked
                          ? 'Unlock Cards (cards clickable in Select mode)'
                          : 'Lock Cards (click & drag ink annotations ON TOP of cards in Select mode)'
                    }
                  >
                    {layer.locked ? <Lock size={13} /> : <Unlock size={13} />}
                  </button>
                  <button
                    type="button"
                    className="layer-ctrl-btn"
                    disabled={idx === 0}
                    onClick={() => onMoveLayer(layer.id, 'up')}
                    title="Move layer up (higher z-order)"
                  >
                    <ArrowUp size={12} />
                  </button>
                  <button
                    type="button"
                    className="layer-ctrl-btn"
                    disabled={idx === layers.length - 1}
                    onClick={() => onMoveLayer(layer.id, 'down')}
                    title="Move layer down (lower z-order)"
                  >
                    <ArrowDown size={12} />
                  </button>
                  <button
                    type="button"
                    className={`layer-ctrl-btn ${showOpacity ? 'active' : ''}`}
                    onClick={() => setExpandedOpacityId(showOpacity ? null : layer.id)}
                    title="Adjust layer opacity"
                  >
                    %
                  </button>
                  {isInk && inkCount > 1 && (
                    <button
                      type="button"
                      className="layer-ctrl-btn danger"
                      onClick={() => onDeleteLayer(layer.id)}
                      title="Delete layer (items move to fallback ink layer)"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>

              {showOpacity && (
                <div className="layer-opacity-row" onClick={(e) => e.stopPropagation()}>
                  <span>Opacity</span>
                  <input
                    type="range"
                    min={10}
                    max={100}
                    value={Math.round(layer.opacity * 100)}
                    onChange={(e) => onSetOpacity(layer.id, Number(e.target.value) / 100)}
                  />
                  <span>{Math.round(layer.opacity * 100)}%</span>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
})
LayersPanel.displayName = 'LayersPanel'
