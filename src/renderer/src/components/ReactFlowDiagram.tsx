import React, {
  createContext,
  useContext,
  useCallback,
  useMemo,
  useState,
  useRef,
  useEffect
} from 'react'
import { createPortal } from 'react-dom'
import {
  ReactFlow,
  Controls,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  Handle,
  Position,
  MarkerType,
  useReactFlow,
  NodeResizer,
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
  type EdgeChange,
  type NodeProps,
  type EdgeProps
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  GripHorizontal,
  Trash2,
  Copy,
  Plus,
  CheckCircle,
  HelpCircle,
  Database,
  Cloud,
  FileText,
  AlignHorizontalSpaceAround,
  AlignVerticalSpaceAround,
  Edit2,
  User,
  Disc,
  Layers,
  StickyNote,
  ArrowDownRight,
  Palette,
  X,
  Zap,
  RefreshCw,
  Search,
  Check
} from 'lucide-react'
import type { DiagramNode } from '../types/board'
import type { ResizeDirection } from './CanvasElements'
import { layoutReactFlowElements } from '../board/flowLayout'
import { isLightColor, type BoardPalette } from '../board/backgroundPresets'
import {
  ALL_LIBRARY_SHAPES,
  ANIMATED_LINE_SHAPES,
  SHAPE_CATEGORIES,
  getLibraryShape,
  type LibraryShapeDef
} from '../shapes/shapeLibrary'
import { ShapeSvg } from '../shapes/ShapeSvg'

/* ------------------------------------------------------------------ */
/* Custom Node Types & Data Interfaces                                */
/* ------------------------------------------------------------------ */

export interface CustomNodeData extends Record<string, unknown> {
  label: string
  description?: string
  color?: string
  bg?: string
  w?: number
  h?: number
  shapeId?: string
  animated?: boolean
}

interface QuickNodeDef {
  type: string
  label: string
  defaultLabel: string
  previewShapeId: string
}

const QUICK_NODE_SHAPES: QuickNodeDef[] = [
  { type: 'process', label: 'Process', defaultLabel: 'Action Step', previewShapeId: 'rounded-rectangle' },
  { type: 'decision', label: 'Decision', defaultLabel: 'Condition?', previewShapeId: 'diamond' },
  { type: 'startEnd', label: 'Start / End', defaultLabel: 'Start', previewShapeId: 'stadium' },
  { type: 'database', label: 'Database', defaultLabel: 'Database', previewShapeId: 'cylinder' },
  { type: 'cloud', label: 'Cloud API', defaultLabel: 'API Gateway', previewShapeId: 'cloud' },
  { type: 'document', label: 'Document', defaultLabel: 'Document', previewShapeId: 'flowchart-document' },
  { type: 'inputOutput', label: 'Input / Output', defaultLabel: 'Data Input', previewShapeId: 'parallelogram' },
  { type: 'actor', label: 'Actor / User', defaultLabel: 'User', previewShapeId: 'uml-actor' },
  { type: 'stateCircle', label: 'State Circle', defaultLabel: 'State', previewShapeId: 'circle' },
  { type: 'group', label: 'Group Frame', defaultLabel: 'Group Frame', previewShapeId: 'rectangle' },
  { type: 'sticky', label: 'Sticky Note', defaultLabel: 'Quick Note', previewShapeId: 'sticky-note' },
  { type: 'custom', label: 'Custom Card', defaultLabel: 'Service Card', previewShapeId: 'card-header' }
]

interface DiagramActionsContextValue {
  toggleNodeAnimated: (nodeId: string) => void
  openNodeReplaceMenu: (nodeId: string, clientX: number, clientY: number) => void
  openEdgeContextMenu: (edgeId: string, clientX: number, clientY: number) => void
  palette?: BoardPalette
}

const DiagramActionsContext = createContext<DiagramActionsContextValue | null>(null)

const COLOR_SWATCHES = [
  { name: 'Cyan', hex: '#00f0ff' },
  { name: 'Emerald', hex: '#10b981' },
  { name: 'Amber', hex: '#f59e0b' },
  { name: 'Violet', hex: '#a855f7' },
  { name: 'Rose', hex: '#f43f5e' },
  { name: 'Slate', hex: '#64748b' }
]

const RF_PRO_OPTIONS = { hideAttribution: true }

/**
 * 4-way directional handles for all React Flow diagram nodes.
 * Keeping 'in-top' and 'out-bottom' first preserves legacy unnamed edge defaults.
 */
function FourWayHandles(): React.JSX.Element {
  return (
    <>
      <Handle type="target" position={Position.Top} id="in-top" className="rf-handle" />
      <Handle type="target" position={Position.Left} id="in-left" className="rf-handle" />
      <Handle
        type="target"
        position={Position.Bottom}
        id="in-bottom"
        className="rf-handle"
        style={{ opacity: 0, pointerEvents: 'none' }}
      />
      <Handle
        type="target"
        position={Position.Right}
        id="in-right"
        className="rf-handle"
        style={{ opacity: 0, pointerEvents: 'none' }}
      />
      <Handle type="source" position={Position.Bottom} id="out-bottom" className="rf-handle" />
      <Handle type="source" position={Position.Right} id="out-right" className="rf-handle" />
      <Handle
        type="source"
        position={Position.Top}
        id="out-top"
        className="rf-handle"
        style={{ opacity: 0, pointerEvents: 'none' }}
      />
      <Handle
        type="source"
        position={Position.Left}
        id="out-left"
        className="rf-handle"
        style={{ opacity: 0, pointerEvents: 'none' }}
      />
    </>
  )
}

// Mini floating action badge for any selected node
function NodeActionBar({
  id,
  onStartEdit,
  showColors = true
}: {
  id: string
  onStartEdit: () => void
  showColors?: boolean
}): React.JSX.Element {
  const { deleteElements, getNode, addNodes, updateNodeData } = useReactFlow()
  const diagramActions = useContext(DiagramActionsContext)
  const [showPalette, setShowPalette] = useState(false)
  const currentNode = getNode(id)
  const isNodeAnimated =
    currentNode?.data?.animated !== undefined
      ? Boolean(currentNode.data.animated)
      : typeof currentNode?.type === 'string' && currentNode.type.startsWith('anim-line-')

  return (
    <div className="rf-node-actions" onPointerDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="rf-node-act-btn"
        title="Edit label & details (Double-click)"
        onClick={onStartEdit}
      >
        <Edit2 size={12} />
      </button>

      <button
        type="button"
        className={`rf-node-act-btn ${isNodeAnimated ? 'active' : ''}`}
        title={isNodeAnimated ? 'Switch to Static version' : 'Replace with Animated version'}
        onClick={() => {
          if (diagramActions) {
            diagramActions.toggleNodeAnimated(id)
          } else {
            updateNodeData(id, { animated: !isNodeAnimated })
          }
        }}
      >
        <Zap size={12} />
      </button>

      {diagramActions && (
        <button
          type="button"
          className="rf-node-act-btn"
          title="Replace with another shape (or Right-click)"
          onClick={(e) => diagramActions.openNodeReplaceMenu(id, e.clientX, e.clientY)}
        >
          <RefreshCw size={12} />
        </button>
      )}

      {showColors && (
        <div className="relative inline-flex items-center">
          <button
            type="button"
            className="rf-node-act-btn"
            title="Change accent color"
            onClick={() => setShowPalette(!showPalette)}
          >
            <Palette size={12} />
          </button>
          {showPalette && (
            <div className="rf-node-palette-popover">
              {COLOR_SWATCHES.map((sw) => (
                <button
                  key={sw.name}
                  type="button"
                  className="rf-palette-swatch"
                  style={{ background: sw.hex }}
                  title={sw.name}
                  onClick={() => {
                    updateNodeData(id, { color: sw.hex })
                    setShowPalette(false)
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        className="rf-node-act-btn"
        title="Duplicate node"
        onClick={() => {
          const current = getNode(id)
          if (current) {
            addNodes({
              ...current,
              id: `node-${Date.now().toString(36)}`,
              position: { x: current.position.x + 30, y: current.position.y + 30 },
              selected: true
            })
          }
        }}
      >
        <Copy size={12} />
      </button>

      <button
        type="button"
        className="rf-node-act-btn danger"
        title="Delete this node (Delete/Backspace)"
        onClick={() => deleteElements({ nodes: [{ id }] })}
      >
        <Trash2 size={12} />
      </button>
    </div>
  )
}

// 1. Process / Step Node
function ProcessNode({ id, data, selected }: NodeProps<Node<CustomNodeData>>): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(data.label || 'Step')
  const [desc, setDesc] = useState(data.description || '')
  const { updateNodeData } = useReactFlow()

  useEffect(() => {
    setLabel(data.label || 'Step')
    setDesc(data.description || '')
  }, [data.label, data.description])

  const handleFinish = (): void => {
    setEditing(false)
    updateNodeData(id, { label: label.trim() || 'Step', description: desc.trim() })
  }

  const diagramActions = useContext(DiagramActionsContext)
  const palette = diagramActions?.palette
  const accentColor = (data.color as string) || palette?.accent || '#FF5E5B'

  return (
    <div
      className={`rf-custom-node rf-node-process ${selected ? 'selected' : ''} ${data.animated ? 'rf-node-animated' : ''}`}
      style={data.color ? { borderColor: accentColor } : undefined}
      onDoubleClick={() => setEditing(true)}
    >
      {selected && !editing && <NodeActionBar id={id} onStartEdit={() => setEditing(true)} />}

      <FourWayHandles />
      <div className="rf-node-accent-bar" style={{ background: accentColor }} />
      <div className="rf-node-body">
        {editing ? (
          <div className="rf-node-edit-wrap" onPointerDown={(e) => e.stopPropagation()}>
            <input
              type="text"
              className="rf-node-input"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onBlur={handleFinish}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') handleFinish()
                if (e.key === 'Escape') setEditing(false)
              }}
              autoFocus
            />
            <input
              type="text"
              className="rf-node-subinput"
              value={desc}
              placeholder="Description (optional)"
              onChange={(e) => setDesc(e.target.value)}
              onBlur={handleFinish}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') handleFinish()
                if (e.key === 'Escape') setEditing(false)
              }}
            />
          </div>
        ) : (
          <>
            <div className="rf-node-title-row">
              <span className="rf-node-label">{label}</span>
            </div>
            {desc && <span className="rf-node-subline">{desc}</span>}
          </>
        )}
      </div>
    </div>
  )
}

// 2. Decision Node (Diamond / Branching)
function DecisionNode({ id, data, selected }: NodeProps<Node<CustomNodeData>>): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(data.label || 'Condition?')
  const { updateNodeData } = useReactFlow()

  useEffect(() => {
    setLabel(data.label || 'Condition?')
  }, [data.label])

  const handleFinish = (): void => {
    setEditing(false)
    updateNodeData(id, { label: label.trim() || 'Condition?' })
  }

  return (
    <div
      className={`rf-custom-node rf-node-decision ${selected ? 'selected' : ''} ${data.animated ? 'rf-node-animated' : ''}`}
      onDoubleClick={() => setEditing(true)}
    >
      {selected && !editing && <NodeActionBar id={id} onStartEdit={() => setEditing(true)} />}

      <FourWayHandles />
      <div className="rf-diamond-shape">
        <div className="rf-diamond-inner">
          <HelpCircle size={14} className="rf-decision-icon" />
          {editing ? (
            <input
              type="text"
              className="rf-node-input text-center"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onBlur={handleFinish}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') handleFinish()
                if (e.key === 'Escape') setEditing(false)
              }}
              autoFocus
              onPointerDown={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="rf-node-label">{label}</span>
          )}
        </div>
      </div>
    </div>
  )
}

// 3. Database Node (Cylinder / Data Store)
function DatabaseNode({ id, data, selected }: NodeProps<Node<CustomNodeData>>): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(data.label || 'Database')
  const [desc, setDesc] = useState(data.description || 'Data Store')
  const { updateNodeData } = useReactFlow()

  useEffect(() => {
    setLabel(data.label || 'Database')
    setDesc(data.description || 'Data Store')
  }, [data.label, data.description])

  const handleFinish = (): void => {
    setEditing(false)
    updateNodeData(id, { label: label.trim() || 'Database', description: desc.trim() })
  }

  return (
    <div
      className={`rf-custom-node rf-node-database ${selected ? 'selected' : ''} ${data.animated ? 'rf-node-animated' : ''}`}
      onDoubleClick={() => setEditing(true)}
    >
      {selected && !editing && <NodeActionBar id={id} onStartEdit={() => setEditing(true)} />}

      <FourWayHandles />
      <div className="rf-node-body">
        <div className="rf-node-title-row">
          <Database size={15} className="rf-db-icon text-accent" />
          {editing ? (
            <div className="rf-node-edit-wrap" onPointerDown={(e) => e.stopPropagation()}>
              <input
                type="text"
                className="rf-node-input"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                onBlur={handleFinish}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') handleFinish()
                  if (e.key === 'Escape') setEditing(false)
                }}
                autoFocus
              />
              <input
                type="text"
                className="rf-node-subinput"
                value={desc}
                placeholder="Description"
                onChange={(e) => setDesc(e.target.value)}
                onBlur={handleFinish}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') handleFinish()
                  if (e.key === 'Escape') setEditing(false)
                }}
              />
            </div>
          ) : (
            <span className="rf-node-label">{label}</span>
          )}
        </div>
        {!editing && desc && <span className="rf-node-subline">{desc}</span>}
      </div>
    </div>
  )
}

// 4. Cloud / API Gateway Node
function CloudNode({ id, data, selected }: NodeProps<Node<CustomNodeData>>): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(data.label || 'API Gateway')
  const [desc, setDesc] = useState(data.description || 'Cloud Service')
  const { updateNodeData } = useReactFlow()

  useEffect(() => {
    setLabel(data.label || 'API Gateway')
    setDesc(data.description || 'Cloud Service')
  }, [data.label, data.description])

  const handleFinish = (): void => {
    setEditing(false)
    updateNodeData(id, { label: label.trim() || 'API Gateway', description: desc.trim() })
  }

  return (
    <div
      className={`rf-custom-node rf-node-cloud ${selected ? 'selected' : ''} ${data.animated ? 'rf-node-animated' : ''}`}
      onDoubleClick={() => setEditing(true)}
    >
      {selected && !editing && <NodeActionBar id={id} onStartEdit={() => setEditing(true)} />}

      <FourWayHandles />
      <div className="rf-node-body">
        <div className="rf-node-title-row">
          <Cloud size={15} className="rf-cloud-icon text-accent" />
          {editing ? (
            <div className="rf-node-edit-wrap" onPointerDown={(e) => e.stopPropagation()}>
              <input
                type="text"
                className="rf-node-input"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                onBlur={handleFinish}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') handleFinish()
                  if (e.key === 'Escape') setEditing(false)
                }}
                autoFocus
              />
              <input
                type="text"
                className="rf-node-subinput"
                value={desc}
                placeholder="Description"
                onChange={(e) => setDesc(e.target.value)}
                onBlur={handleFinish}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') handleFinish()
                  if (e.key === 'Escape') setEditing(false)
                }}
              />
            </div>
          ) : (
            <span className="rf-node-label">{label}</span>
          )}
        </div>
        {!editing && desc && <span className="rf-node-subline">{desc}</span>}
      </div>
    </div>
  )
}

// 5. Start / End Node (Rounded Stadium Pill)
function StartEndNode({ id, data, selected }: NodeProps<Node<CustomNodeData>>): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(data.label || 'Start')
  const { updateNodeData } = useReactFlow()

  useEffect(() => {
    setLabel(data.label || 'Start')
  }, [data.label])

  const handleFinish = (): void => {
    setEditing(false)
    updateNodeData(id, { label: label.trim() || 'Start' })
  }

  return (
    <div
      className={`rf-custom-node rf-node-startend ${selected ? 'selected' : ''} ${data.animated ? 'rf-node-animated' : ''}`}
      onDoubleClick={() => setEditing(true)}
    >
      {selected && !editing && <NodeActionBar id={id} onStartEdit={() => setEditing(true)} />}

      <FourWayHandles />
      <div className="rf-node-pill-inner">
        <CheckCircle size={14} className="rf-start-icon" />
        {editing ? (
          <input
            type="text"
            className="rf-node-input text-center"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={handleFinish}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') handleFinish()
              if (e.key === 'Escape') setEditing(false)
            }}
            autoFocus
            onPointerDown={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="rf-node-label">{label}</span>
        )}
      </div>
    </div>
  )
}

// 6. Document / File Node
function DocumentNode({ id, data, selected }: NodeProps<Node<CustomNodeData>>): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(data.label || 'Document')
  const [desc, setDesc] = useState(data.description || '')
  const { updateNodeData } = useReactFlow()

  const handleFinish = (): void => {
    setEditing(false)
    updateNodeData(id, { label: label.trim() || 'Document', description: desc.trim() })
  }

  return (
    <div
      className={`rf-custom-node rf-node-document ${selected ? 'selected' : ''} ${data.animated ? 'rf-node-animated' : ''}`}
      onDoubleClick={() => setEditing(true)}
    >
      {selected && !editing && <NodeActionBar id={id} onStartEdit={() => setEditing(true)} />}
      <FourWayHandles />
      <div className="rf-node-body">
        <div className="rf-node-title-row">
          <FileText size={15} className="text-amber-400" />
          {editing ? (
            <div className="rf-node-edit-wrap" onPointerDown={(e) => e.stopPropagation()}>
              <input
                type="text"
                className="rf-node-input"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                onBlur={handleFinish}
                autoFocus
              />
              <input
                type="text"
                className="rf-node-subinput"
                value={desc}
                placeholder="Details"
                onChange={(e) => setDesc(e.target.value)}
                onBlur={handleFinish}
              />
            </div>
          ) : (
            <span className="rf-node-label">{label}</span>
          )}
        </div>
        {!editing && desc && <span className="rf-node-subline">{desc}</span>}
      </div>
    </div>
  )
}

// 7. Input / Output Parallelogram Node
function InputOutputNode({ id, data, selected }: NodeProps<Node<CustomNodeData>>): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(data.label || 'Data Input')
  const { updateNodeData } = useReactFlow()

  const handleFinish = (): void => {
    setEditing(false)
    updateNodeData(id, { label: label.trim() || 'Data Input' })
  }

  return (
    <div
      className={`rf-custom-node rf-node-io ${selected ? 'selected' : ''} ${data.animated ? 'rf-node-animated' : ''}`}
      onDoubleClick={() => setEditing(true)}
    >
      {selected && !editing && <NodeActionBar id={id} onStartEdit={() => setEditing(true)} />}
      <FourWayHandles />
      <div className="rf-node-body">
        <div className="rf-node-title-row">
          <ArrowDownRight size={14} className="text-emerald-400" />
          {editing ? (
            <input
              type="text"
              className="rf-node-input"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onBlur={handleFinish}
              autoFocus
              onPointerDown={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="rf-node-label">{label}</span>
          )}
        </div>
      </div>
    </div>
  )
}

// 8. Actor / Persona Node
function ActorNode({ id, data, selected }: NodeProps<Node<CustomNodeData>>): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(data.label || 'User / Client')
  const { updateNodeData } = useReactFlow()

  const handleFinish = (): void => {
    setEditing(false)
    updateNodeData(id, { label: label.trim() || 'User / Client' })
  }

  return (
    <div
      className={`rf-custom-node rf-node-actor ${selected ? 'selected' : ''} ${data.animated ? 'rf-node-animated' : ''}`}
      onDoubleClick={() => setEditing(true)}
    >
      {selected && !editing && <NodeActionBar id={id} onStartEdit={() => setEditing(true)} />}
      <FourWayHandles />
      <div className="rf-node-body items-center text-center">
        <div className="rf-actor-avatar">
          <User size={18} className="text-cyan-400" />
        </div>
        {editing ? (
          <input
            type="text"
            className="rf-node-input text-center mt-1"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={handleFinish}
            autoFocus
            onPointerDown={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="rf-node-label mt-1">{label}</span>
        )}
      </div>
    </div>
  )
}

// 9. Circle / State Node
function CircleNode({ id, data, selected }: NodeProps<Node<CustomNodeData>>): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(data.label || 'State')
  const { updateNodeData } = useReactFlow()

  const handleFinish = (): void => {
    setEditing(false)
    updateNodeData(id, { label: label.trim() || 'State' })
  }

  return (
    <div
      className={`rf-custom-node rf-node-circle ${selected ? 'selected' : ''} ${data.animated ? 'rf-node-animated' : ''}`}
      onDoubleClick={() => setEditing(true)}
    >
      {selected && !editing && <NodeActionBar id={id} onStartEdit={() => setEditing(true)} />}
      <FourWayHandles />
      <div className="rf-circle-inner">
        <Disc size={13} className="text-violet-400" />
        {editing ? (
          <input
            type="text"
            className="rf-node-input text-center"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={handleFinish}
            autoFocus
            onPointerDown={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="rf-node-label">{label}</span>
        )}
      </div>
    </div>
  )
}

// 10. Group / Subflow Frame Node (Resizable Container)
function GroupNode({ id, data, selected }: NodeProps<Node<CustomNodeData>>): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(data.label || 'Group Frame')
  const { updateNodeData } = useReactFlow()

  const handleFinish = (): void => {
    setEditing(false)
    updateNodeData(id, { label: label.trim() || 'Group Frame' })
  }

  return (
    <div className={`rf-group-frame ${selected ? 'selected' : ''} ${data.animated ? 'rf-node-animated' : ''}`}>
      <NodeResizer minWidth={220} minHeight={160} isVisible={selected} lineClassName="border-accent" />
      {selected && !editing && <NodeActionBar id={id} onStartEdit={() => setEditing(true)} showColors={false} />}
      <div className="rf-group-header" onDoubleClick={() => setEditing(true)}>
        <Layers size={13} className="text-accent" />
        {editing ? (
          <input
            type="text"
            className="rf-node-input"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={handleFinish}
            autoFocus
            onPointerDown={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="rf-group-title">{label}</span>
        )}
      </div>
    </div>
  )
}

// 11. Sticky Note Node
function StickyNode({ id, data, selected }: NodeProps<Node<CustomNodeData>>): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(data.label || 'Idea note')
  const { updateNodeData } = useReactFlow()

  const handleFinish = (): void => {
    setEditing(false)
    updateNodeData(id, { label: label.trim() || 'Idea note' })
  }

  const bgColor = (data.bg as string) || '#fef08a' // Default sticky yellow

  return (
    <div
      className={`rf-sticky-note ${selected ? 'selected' : ''} ${data.animated ? 'rf-node-animated' : ''}`}
      style={{ backgroundColor: bgColor }}
      onDoubleClick={() => setEditing(true)}
    >
      <NodeResizer minWidth={140} minHeight={120} isVisible={selected} />
      {selected && !editing && <NodeActionBar id={id} onStartEdit={() => setEditing(true)} />}
      <div className="rf-sticky-body">
        <StickyNote size={14} className="rf-sticky-pin text-amber-700 opacity-60" />
        {editing ? (
          <textarea
            className="rf-sticky-textarea"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={handleFinish}
            autoFocus
            onPointerDown={(e) => e.stopPropagation()}
            rows={4}
          />
        ) : (
          <div className="rf-sticky-text">{label}</div>
        )}
      </div>
      <FourWayHandles />
    </div>
  )
}

// 12. Custom Card / Technical Metric Node
function CustomCardNode({ id, data, selected }: NodeProps<Node<CustomNodeData>>): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(data.label || 'Service Card')
  const [desc, setDesc] = useState(data.description || '')
  const { updateNodeData } = useReactFlow()

  const handleFinish = (): void => {
    setEditing(false)
    updateNodeData(id, { label: label.trim() || 'Service Card', description: desc.trim() })
  }

  return (
    <div
      className={`rf-custom-node rf-node-custom-card ${selected ? 'selected' : ''} ${data.animated ? 'rf-node-animated' : ''}`}
      onDoubleClick={() => setEditing(true)}
    >
      {selected && !editing && <NodeActionBar id={id} onStartEdit={() => setEditing(true)} />}
      <FourWayHandles />
      <div className="rf-node-body">
        <div className="rf-node-title-row">
          <FileText size={14} className="opacity-80" />
          {editing ? (
            <div className="rf-node-edit-wrap" onPointerDown={(e) => e.stopPropagation()}>
              <input
                type="text"
                className="rf-node-input"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                onBlur={handleFinish}
                autoFocus
              />
              <input
                type="text"
                className="rf-node-subinput"
                value={desc}
                placeholder="Description"
                onChange={(e) => setDesc(e.target.value)}
                onBlur={handleFinish}
              />
            </div>
          ) : (
            <span className="rf-node-label">{label}</span>
          )}
        </div>
        {!editing && desc && <span className="rf-node-subline">{desc}</span>}
      </div>
    </div>
  )
}

// 13. Universal Library Shape Node
function LibraryShapeNode({
  id,
  type,
  data,
  selected,
  width,
  height
}: NodeProps<Node<CustomNodeData>>): React.JSX.Element {
  const shapeDef: LibraryShapeDef =
    getLibraryShape((data.shapeId as string) || type) || getLibraryShape('rectangle')!

  const displayLabel =
    data.label !== undefined
      ? data.label
      : shapeDef.defaultLabel !== undefined
        ? shapeDef.defaultLabel
        : shapeDef.name
  const displayDesc = data.description || ''

  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(displayLabel)
  const [desc, setDesc] = useState(displayDesc)
  const { updateNodeData } = useReactFlow()

  const startEditing = (): void => {
    setLabel(displayLabel)
    setDesc(displayDesc)
    setEditing(true)
  }

  const handleFinish = (): void => {
    setEditing(false)
    updateNodeData(id, { label: label.trim(), description: desc.trim() })
  }

  const defaultW = typeof data.w === 'number' ? data.w : shapeDef.size[0]
  const defaultH = typeof data.h === 'number' ? data.h : shapeDef.size[1]
  const diagramActions = useContext(DiagramActionsContext)
  const palette = diagramActions?.palette
  const accentColor = (data.color as string) || palette?.shapeStroke || '#111111'
  const fillColor = (data.bg as string) || shapeDef.defaultFill || palette?.shapeFill || '#FFE566'
  const textColor =
    fillColor === '#fef08a'
      ? '#422006'
      : isLightColor(fillColor)
        ? '#111111'
        : '#FFFDF7'
  const [tx, ty, tw, th] = shapeDef.text ?? [8, 8, 84, 84]

  const isAnimated =
    data.animated !== undefined
      ? Boolean(data.animated)
      : shapeDef.id.startsWith('anim-line-')

  return (
    <div
      className={`rf-node-library-shape ${selected ? 'selected' : ''} ${isAnimated ? 'rf-node-animated' : ''}`}
      style={!width && !height ? { width: `${defaultW}px`, height: `${defaultH}px` } : undefined}
      onDoubleClick={startEditing}
    >
      <NodeResizer minWidth={36} minHeight={24} isVisible={selected} />
      {selected && !editing && <NodeActionBar id={id} onStartEdit={startEditing} />}

      <FourWayHandles />

      <ShapeSvg
        shape={shapeDef}
        strokeColor={accentColor}
        fillColor={fillColor}
        strokeWidth={2}
        className="rf-library-shape-svg"
        animated={isAnimated}
      />

      <div
        className="rf-library-shape-text"
        style={{
          left: `${tx}%`,
          top: `${ty}%`,
          width: `${tw}%`,
          height: `${th}%`,
          color: textColor
        }}
      >
        {editing ? (
          <div className="rf-node-edit-wrap" onPointerDown={(e) => e.stopPropagation()}>
            <input
              type="text"
              className="rf-node-input text-center"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onBlur={handleFinish}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') handleFinish()
                if (e.key === 'Escape') setEditing(false)
              }}
              autoFocus
            />
            <input
              type="text"
              className="rf-node-subinput text-center"
              value={desc}
              placeholder="Subtext"
              onChange={(e) => setDesc(e.target.value)}
              onBlur={handleFinish}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') handleFinish()
                if (e.key === 'Escape') setEditing(false)
              }}
            />
          </div>
        ) : (
          <>
            {displayLabel && <span className="rf-node-label">{displayLabel}</span>}
            {displayDesc && <span className="rf-node-subline">{displayDesc}</span>}
          </>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Custom Edge with Editable Label and Delete Button                   */
/* ------------------------------------------------------------------ */

function CustomFlowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  label,
  style,
  markerEnd,
  selected
}: EdgeProps): React.JSX.Element {
  const [isEditing, setIsEditing] = useState(false)
  const [edgeLabel, setEdgeLabel] = useState(label ? String(label) : '')
  const { setEdges } = useReactFlow()
  const diagramActions = useContext(DiagramActionsContext)

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetPosition,
    targetX,
    targetY,
    borderRadius: 16
  })

  const handleFinishLabel = (): void => {
    setIsEditing(false)
    setEdges((edges) =>
      edges.map((e) => (e.id === id ? { ...e, label: edgeLabel.trim() || undefined } : e))
    )
  }

  const handleDeleteEdge = (): void => {
    setEdges((edges) => edges.filter((e) => e.id !== id))
  }

  return (
    <>
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all'
          }}
          className="rf-edge-label-container"
        >
          {isEditing ? (
            <input
              type="text"
              className="rf-edge-input"
              value={edgeLabel}
              onChange={(e) => setEdgeLabel(e.target.value)}
              onBlur={handleFinishLabel}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') handleFinishLabel()
                if (e.key === 'Escape') setIsEditing(false)
              }}
              autoFocus
            />
          ) : (
            <div
              className={`rf-edge-badge ${selected ? 'selected' : ''}`}
              onDoubleClick={() => setIsEditing(true)}
              onContextMenu={(e) => {
                if (diagramActions) {
                  e.preventDefault()
                  e.stopPropagation()
                  diagramActions.openEdgeContextMenu(id, e.clientX, e.clientY)
                }
              }}
              title="Double-click to edit condition · Right-click for line options"
            >
              <span>{edgeLabel || (selected ? '+ Condition' : '')}</span>
              {selected && (
                <button
                  type="button"
                  className="rf-edge-del-btn"
                  title="Delete edge"
                  onClick={handleDeleteEdge}
                >
                  <X size={10} />
                </button>
              )}
            </div>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Viewport Auto-Fit Sync (keeps diagram scaled inside outer box)     */
/* ------------------------------------------------------------------ */

function DiagramViewportSync({
  boxW,
  boxH,
  nodes,
  layoutTick
}: {
  boxW: number
  boxH: number
  nodes: Node[]
  layoutTick: number
}): null {
  const { setViewport } = useReactFlow()
  const prevVpRef = useRef<{ x: number; y: number; zoom: number } | null>(null)
  const nodesRef = useRef(nodes)

  useEffect(() => {
    nodesRef.current = nodes
  }, [nodes])

  const measurementKey = nodes
    .map(
      (n) =>
        `${n.id}:${Math.round(n.measured?.width ?? n.width ?? 0)}x${Math.round(n.measured?.height ?? n.height ?? 0)}`
    )
    .join(',')

  useEffect(() => {
    const currentNodes = nodesRef.current
    if (currentNodes.length === 0) return

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity

    for (const n of currentNodes) {
      const d = (n.data ?? {}) as Record<string, unknown>
      const measuredW =
        typeof n.measured?.width === 'number' && n.measured.width > 0 ? n.measured.width : undefined
      const measuredH =
        typeof n.measured?.height === 'number' && n.measured.height > 0 ? n.measured.height : undefined
      const nw =
        measuredW ??
        (typeof n.width === 'number' && n.width > 0
          ? n.width
          : typeof d.w === 'number' && d.w > 0
            ? (d.w as number)
            : 150)
      const nh =
        measuredH ??
        (typeof n.height === 'number' && n.height > 0
          ? n.height
          : typeof d.h === 'number' && d.h > 0
            ? (d.h as number)
            : 80)
      const nx = n.position?.x ?? 0
      const ny = n.position?.y ?? 0
      if (nx < minX) minX = nx
      if (ny < minY) minY = ny
      if (nx + nw > maxX) maxX = nx + nw
      if (ny + nh > maxY) maxY = ny + nh
    }

    if (!Number.isFinite(minX) || !Number.isFinite(minY)) return

    // Include safety margin for curved/step edge bends and arrowheads
    const contentW = Math.max(60, maxX - minX + 36)
    const contentH = Math.max(60, maxY - minY + 36)
    const pad = Math.min(20, Math.max(8, Math.round(Math.min(boxW, boxH) * 0.05)))
    const availW = Math.max(40, boxW - pad * 2)
    const availH = Math.max(40, boxH - pad * 2)

    const zoom = Math.max(0.05, Math.min(3.0, Math.min(availW / contentW, availH / contentH)))
    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2
    const vpX = Math.round(boxW / 2 - centerX * zoom)
    const vpY = Math.round(boxH / 2 - centerY * zoom)

    const prev = prevVpRef.current
    if (
      prev &&
      Math.abs(prev.x - vpX) < 0.5 &&
      Math.abs(prev.y - vpY) < 0.5 &&
      Math.abs(prev.zoom - zoom) < 0.002
    ) {
      return
    }
    prevVpRef.current = { x: vpX, y: vpY, zoom }
    void setViewport({ x: vpX, y: vpY, zoom }, { duration: 0 })
  }, [boxW, boxH, layoutTick, measurementKey, setViewport])

  return null
}

/* ------------------------------------------------------------------ */
/* Main Diagram Container Props                                       */
/* ------------------------------------------------------------------ */

export interface ReactFlowDiagramProps {
  diagram: DiagramNode
  isSelected: boolean
  isResizing?: boolean
  disabledPointerEvents?: boolean
  palette?: BoardPalette
  onSelect: () => void
  onUpdate: (patch: Partial<DiagramNode>) => void
  onDelete: () => void
  onDuplicate: () => void
  onStartMove?: (startX: number, startY: number) => void
  onStartResize?: (e: React.PointerEvent, direction: ResizeDirection) => void
}

export function ReactFlowDiagram({
  diagram,
  isSelected,
  isResizing = false,
  disabledPointerEvents = false,
  palette,
  onSelect,
  onUpdate,
  onDelete,
  onDuplicate,
  onStartMove,
  onStartResize
}: ReactFlowDiagramProps): React.JSX.Element {
  const [nodes, setNodes] = useState<Node[]>(diagram.nodes || [])
  const [edges, setEdges] = useState<Edge[]>(diagram.edges || [])
  const [title, setTitle] = useState(diagram.title || 'Interactive Diagram')
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const [layoutTick, setLayoutTick] = useState(0)
  const [contextMenu, setContextMenu] = useState<
    | { kind: 'node'; nodeId: string; x: number; y: number }
    | { kind: 'edge'; edgeId: string; x: number; y: number }
    | null
  >(null)
  const [menuSearch, setMenuSearch] = useState('')
  const [menuCategory, setMenuCategory] = useState<string>('all')
  const [replaceAsAnimated, setReplaceAsAnimated] = useState(false)
  const contextMenuRef = useRef<HTMLDivElement | null>(null)

  const boxW = Math.max(200, Math.round(diagram.w || 420))
  const boxH = Math.max(140, Math.round(diagram.h || 280))

  // Close right-click context menu on outside click or Escape
  useEffect(() => {
    if (!contextMenu) return
    const handleOutsidePointer = (e: PointerEvent): void => {
      const target = e.target as HTMLElement | null
      if (target?.closest('.rf-context-menu')) return
      setContextMenu(null)
    }
    const handleEscape = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setContextMenu(null)
      }
    }
    window.addEventListener('pointerdown', handleOutsidePointer, true)
    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('pointerdown', handleOutsidePointer, true)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [contextMenu])

  // Native non-passive wheel scrolling for context menu categories & shape picker grid
  useEffect(() => {
    const menuEl = contextMenuRef.current
    if (!menuEl || !contextMenu) return

    const handleMenuWheel = (e: WheelEvent): void => {
      e.preventDefault()
      e.stopPropagation()

      const deltaY =
        e.deltaMode === 1 ? e.deltaY * 30 : e.deltaMode === 2 ? e.deltaY * 300 : e.deltaY
      const deltaX =
        e.deltaMode === 1 ? e.deltaX * 30 : e.deltaMode === 2 ? e.deltaX * 300 : e.deltaX

      const targetEl = e.target as HTMLElement | null
      const catsEl = targetEl?.closest('.rf-context-cats') as HTMLElement | null
      if (catsEl) {
        catsEl.scrollLeft += deltaX !== 0 ? deltaX : deltaY
        return
      }

      const gridEl = menuEl.querySelector('.rf-context-grid') as HTMLElement | null
      if (gridEl) {
        if (e.shiftKey && deltaY !== 0 && deltaX === 0) {
          gridEl.scrollLeft += deltaY
        } else {
          gridEl.scrollTop += deltaY
          if (deltaX !== 0) gridEl.scrollLeft += deltaX
        }
      }
    }

    menuEl.addEventListener('wheel', handleMenuWheel, { passive: false })
    return () => menuEl.removeEventListener('wheel', handleMenuWheel)
  }, [contextMenu])

  // Node & shape replacement / animation actions
  const handleToggleNodeAnimated = useCallback(
    (nodeId: string, explicitAnimated?: boolean) => {
      const nextNodes = nodes.map((n) => {
        if (n.id !== nodeId) return n
        const currentAnimated =
          n.data?.animated !== undefined
            ? Boolean(n.data.animated)
            : typeof n.type === 'string' && n.type.startsWith('anim-line-')
        const nextAnimated = explicitAnimated !== undefined ? explicitAnimated : !currentAnimated
        return {
          ...n,
          data: {
            ...n.data,
            animated: nextAnimated
          }
        }
      })
      setNodes(nextNodes)
      onUpdate({ nodes: nextNodes })
    },
    [nodes, onUpdate]
  )

  const handleAnimateConnectedEdges = useCallback(
    (nodeId: string, animated: boolean) => {
      const nextEdges = edges.map((edge) => {
        if (edge.source !== nodeId && edge.target !== nodeId) return edge
        return {
          ...edge,
          animated,
          style: {
            ...edge.style,
            strokeDasharray: animated ? '6 4' : undefined
          }
        }
      })
      setEdges(nextEdges)
      onUpdate({ edges: nextEdges })
    },
    [edges, onUpdate]
  )

  const handleAnimateEntireDiagram = useCallback(
    (animated: boolean) => {
      const nextNodes = nodes.map((n) => ({
        ...n,
        data: { ...n.data, animated }
      }))
      const nextEdges = edges.map((edge) => ({
        ...edge,
        animated,
        style: {
          ...edge.style,
          strokeDasharray: animated ? '6 4' : undefined
        }
      }))
      setNodes(nextNodes)
      setEdges(nextEdges)
      onUpdate({ nodes: nextNodes, edges: nextEdges })
    },
    [nodes, edges, onUpdate]
  )

  const handleReplaceNodeShape = useCallback(
    (
      nodeId: string,
      newType: string,
      opts?: {
        shapeDef?: LibraryShapeDef
        defaultLabel?: string
        forceAnimated?: boolean
      }
    ) => {
      const nextNodes = nodes.map((n) => {
        if (n.id !== nodeId) return n
        const existingLabel = typeof n.data?.label === 'string' ? n.data.label.trim() : ''
        const currentAnimated =
          n.data?.animated !== undefined
            ? Boolean(n.data.animated)
            : typeof n.type === 'string' && n.type.startsWith('anim-line-')
        const nextAnimated =
          opts?.forceAnimated !== undefined
            ? opts.forceAnimated
            : currentAnimated || newType.startsWith('anim-line-')

        const resolvedBg =
          newType === 'sticky'
            ? (n.data?.bg as string) || '#fef08a'
            : opts?.shapeDef?.defaultFill
              ? opts.shapeDef.defaultFill
              : n.type === 'sticky'
                ? undefined
                : n.data?.bg

        if (opts?.shapeDef) {
          const [sw, sh] = opts.shapeDef.size
          return {
            ...n,
            type: newType,
            selected: true,
            width: undefined,
            height: undefined,
            style: { width: sw, height: sh },
            data: {
              ...n.data,
              label: existingLabel || opts.defaultLabel || opts.shapeDef.name,
              shapeId: opts.shapeDef.id,
              w: sw,
              h: sh,
              bg: resolvedBg,
              animated: nextAnimated
            }
          }
        }

        return {
          ...n,
          type: newType,
          selected: true,
          width: undefined,
          height: undefined,
          style:
            newType === 'group'
              ? { width: 280, height: 180 }
              : newType === 'sticky'
                ? { width: 170, height: 140 }
                : undefined,
          data: {
            ...n.data,
            label: existingLabel || opts?.defaultLabel || 'Step',
            shapeId: undefined,
            w: undefined,
            h: undefined,
            bg: resolvedBg,
            animated: nextAnimated
          }
        }
      })
      setNodes(nextNodes)
      setLayoutTick((t) => t + 1)
      onUpdate({ nodes: nextNodes })
    },
    [nodes, onUpdate]
  )

  const activeEdgeColor = palette?.diagramEdge || '#111111'

  const handleUpdateEdgeStyle = useCallback(
    (edgeId: string, mode: 'animated' | 'dotted' | 'static') => {
      const nextEdges = edges.map((edge) => {
        if (edge.id !== edgeId) return edge
        if (mode === 'animated') {
          return {
            ...edge,
            animated: true,
            style: { ...edge.style, stroke: activeEdgeColor, strokeWidth: 2.2, strokeDasharray: '6 4' }
          }
        }
        if (mode === 'dotted') {
          return {
            ...edge,
            animated: true,
            style: { ...edge.style, stroke: activeEdgeColor, strokeWidth: 2.2, strokeDasharray: '2 5' }
          }
        }
        return {
          ...edge,
          animated: false,
          style: { ...edge.style, stroke: activeEdgeColor, strokeWidth: 2.2, strokeDasharray: undefined }
        }
      })
      setEdges(nextEdges)
      onUpdate({ edges: nextEdges })
    },
    [edges, onUpdate, activeEdgeColor]
  )

  const openNodeContextMenuAt = useCallback(
    (nodeId: string, clientX: number, clientY: number) => {
      onSelect()
      const targetNode = nodes.find((n) => n.id === nodeId)
      const isCurrentlyAnimated = targetNode
        ? targetNode.data?.animated !== undefined
          ? Boolean(targetNode.data.animated)
          : typeof targetNode.type === 'string' && targetNode.type.startsWith('anim-line-')
        : false
      const menuW = 344
      const menuH = 495
      setNodes((nds) => nds.map((n) => ({ ...n, selected: n.id === nodeId })))
      setMenuSearch('')
      setMenuCategory('all')
      setReplaceAsAnimated(isCurrentlyAnimated)
      setContextMenu({
        kind: 'node',
        nodeId,
        x: Math.max(8, Math.min(clientX, window.innerWidth - menuW - 12)),
        y: Math.max(8, Math.min(clientY, window.innerHeight - menuH - 12))
      })
    },
    [nodes, onSelect]
  )

  const openEdgeContextMenuAt = useCallback(
    (edgeId: string, clientX: number, clientY: number) => {
      onSelect()
      const menuW = 244
      const menuH = 220
      setEdges((eds) => eds.map((edge) => ({ ...edge, selected: edge.id === edgeId })))
      setContextMenu({
        kind: 'edge',
        edgeId,
        x: Math.max(8, Math.min(clientX, window.innerWidth - menuW - 12)),
        y: Math.max(8, Math.min(clientY, window.innerHeight - menuH - 12))
      })
    },
    [onSelect]
  )

  const diagramActionsValue = useMemo<DiagramActionsContextValue>(
    () => ({
      toggleNodeAnimated: (id) => handleToggleNodeAnimated(id),
      openNodeReplaceMenu: openNodeContextMenuAt,
      openEdgeContextMenu: openEdgeContextMenuAt,
      palette
    }),
    [handleToggleNodeAnimated, openNodeContextMenuAt, openEdgeContextMenuAt, palette]
  )

  const menuFilteredQuickNodes = useMemo(() => {
    if (menuCategory !== 'all' && menuCategory !== 'quick') return []
    const q = menuSearch.trim().toLowerCase()
    if (!q) return QUICK_NODE_SHAPES
    return QUICK_NODE_SHAPES.filter(
      (item) => item.label.toLowerCase().includes(q) || item.type.toLowerCase().includes(q)
    )
  }, [menuCategory, menuSearch])

  const menuFilteredAnimatedLines = useMemo(() => {
    if (
      menuCategory !== 'all' &&
      menuCategory !== 'animated-lines' &&
      menuCategory !== 'lines'
    ) {
      return []
    }
    const q = menuSearch.trim().toLowerCase()
    if (!q) return ANIMATED_LINE_SHAPES
    return ANIMATED_LINE_SHAPES.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        s.tags.some((t) => t.toLowerCase().includes(q)) ||
        s.aliases.some((a) => a.toLowerCase().includes(q))
    )
  }, [menuCategory, menuSearch])

  const menuFilteredLibShapes = useMemo(() => {
    if (menuCategory === 'quick' || menuCategory === 'animated-lines') return []
    const q = menuSearch.trim().toLowerCase()
    return ALL_LIBRARY_SHAPES.filter((s) => {
      if (menuCategory !== 'all' && s.category !== menuCategory) return false
      if (!q) return true
      return (
        s.name.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q) ||
        s.aliases.some((a) => a.toLowerCase().includes(q)) ||
        s.tags.some((t) => t.toLowerCase().includes(q))
      )
    })
  }, [menuCategory, menuSearch])

  // Node types registry with all custom components + full library shapes & animated lines
  const nodeTypes = useMemo(() => {
    const libraryTypes: Record<string, typeof LibraryShapeNode> = {}
    for (const shape of ALL_LIBRARY_SHAPES) {
      libraryTypes[shape.id] = LibraryShapeNode
    }
    for (const lineShape of ANIMATED_LINE_SHAPES) {
      libraryTypes[lineShape.id] = LibraryShapeNode
    }
    return {
      ...libraryTypes,
      libraryShape: LibraryShapeNode,
      process: ProcessNode,
      decision: DecisionNode,
      database: DatabaseNode,
      cloud: CloudNode,
      startEnd: StartEndNode,
      document: DocumentNode,
      inputOutput: InputOutputNode,
      actor: ActorNode,
      stateCircle: CircleNode,
      group: GroupNode,
      annotation: StickyNode,
      sticky: StickyNode,
      custom: CustomCardNode,
      default: ProcessNode
    }
  }, [])

  // Custom edge types registry
  const edgeTypes = useMemo(
    () => ({
      smoothstep: CustomFlowEdge,
      default: CustomFlowEdge
    }),
    []
  )

  // Synchronize internal state with parent props when diagram.id or external elements change
  const prevIdRef = useRef(diagram.id)
  const prevDiagramNodesRef = useRef(diagram.nodes)
  const prevDiagramEdgesRef = useRef(diagram.edges)
  useEffect(() => {
    if (prevIdRef.current !== diagram.id) {
      prevIdRef.current = diagram.id
      prevDiagramNodesRef.current = diagram.nodes
      prevDiagramEdgesRef.current = diagram.edges
      queueMicrotask(() => {
        setNodes(diagram.nodes || [])
        setEdges(diagram.edges || [])
        setTitle(diagram.title || 'Interactive Diagram')
      })
      return
    }
    if (prevDiagramNodesRef.current !== diagram.nodes) {
      prevDiagramNodesRef.current = diagram.nodes
      if (diagram.nodes && diagram.nodes !== nodes) {
        queueMicrotask(() => setNodes(diagram.nodes || []))
      }
    }
    if (prevDiagramEdgesRef.current !== diagram.edges) {
      prevDiagramEdgesRef.current = diagram.edges
      if (diagram.edges && diagram.edges !== edges) {
        queueMicrotask(() => setEdges(diagram.edges || []))
      }
    }
  }, [diagram.id, diagram.nodes, diagram.edges, diagram.title, nodes, edges])

  // Node changes (drag, select, dimension)
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((nds) => applyNodeChanges(changes, nds))
  }, [])

  // Edge changes (select, delete)
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((eds) => applyEdgeChanges(changes, eds))
  }, [])

  // Sync node changes on drag stop
  const onNodeDragStop = useCallback(() => {
    setLayoutTick((t) => t + 1)
    onUpdate({ nodes })
  }, [nodes, onUpdate])

  // Sync elements on node/edge delete
  const onNodesDelete = useCallback(
    (deletedNodes: Node[]) => {
      const deletedIds = new Set(deletedNodes.map((n) => n.id))
      const nextNodes = nodes.filter((n) => !deletedIds.has(n.id))
      const nextEdges = edges.filter(
        (e) => !deletedIds.has(e.source) && !deletedIds.has(e.target)
      )
      setNodes(nextNodes)
      setEdges(nextEdges)
      setLayoutTick((t) => t + 1)
      onUpdate({ nodes: nextNodes, edges: nextEdges })
    },
    [nodes, edges, onUpdate]
  )

  const onEdgesDelete = useCallback(
    (deletedEdges: Edge[]) => {
      const deletedIds = new Set(deletedEdges.map((e) => e.id))
      const nextEdges = edges.filter((e) => !deletedIds.has(e.id))
      setEdges(nextEdges)
      onUpdate({ edges: nextEdges })
    },
    [edges, onUpdate]
  )

  const adaptedEdges = useMemo(
    () =>
      edges.map((e) => {
        const curStroke = typeof e.style?.stroke === 'string' ? e.style.stroke : undefined
        const isDefaultCyan = !curStroke || curStroke.toLowerCase() === '#38bdf8'
        const resolvedStroke = isDefaultCyan ? activeEdgeColor : curStroke
        const markerObj =
          e.markerEnd && typeof e.markerEnd === 'object'
            ? {
                ...e.markerEnd,
                color:
                  !e.markerEnd.color || String(e.markerEnd.color).toLowerCase() === '#38bdf8'
                    ? resolvedStroke
                    : e.markerEnd.color
              }
            : e.markerEnd
        return {
          ...e,
          markerEnd: markerObj,
          style: { ...e.style, stroke: resolvedStroke }
        }
      }),
    [edges, activeEdgeColor]
  )

  // Connecting new edges between handles
  const onConnect = useCallback(
    (params: Connection) => {
      setEdges((eds) => {
        const newEdge: Edge = {
          ...params,
          id: `e-${params.source}-${params.target}-${Date.now().toString(36)}`,
          type: 'smoothstep',
          label: '',
          markerEnd: {
            type: MarkerType.ArrowClosed as const,
            width: 16,
            height: 16,
            color: activeEdgeColor
          },
          style: { stroke: activeEdgeColor, strokeWidth: 2.2 }
        }
        const next = addEdge(newEdge, eds)
        onUpdate({ edges: next })
        return next
      })
    },
    [onUpdate, activeEdgeColor]
  )

  // Auto layout using Dagre
  const handleAutoLayout = useCallback(
    (direction: 'TB' | 'LR') => {
      const laidOut = layoutReactFlowElements(nodes, edges, { direction })
      setNodes(laidOut.nodes)
      setEdges(laidOut.edges)
      setLayoutTick((t) => t + 1)
      onUpdate({ nodes: laidOut.nodes, edges: laidOut.edges })
    },
    [nodes, edges, onUpdate]
  )

  // Adding new node to diagram
  const handleAddNode = useCallback(
    (type: string, defaultLabel: string, extraData?: Record<string, unknown>) => {
      const id = `node-${Date.now().toString(36)}`
      const offset = nodes.length * 24
      const newNode: Node = {
        id,
        type,
        position: { x: 60 + (offset % 220), y: 60 + (offset % 200) },
        data: { label: defaultLabel, description: '', ...(extraData || {}) }
      }
      const next = [...nodes, newNode]
      setNodes(next)
      setLayoutTick((t) => t + 1)
      onUpdate({ nodes: next })
    },
    [nodes, onUpdate]
  )

  // Header drag start for moving whole diagram container on the whiteboard
  const handleHeaderPointerDown = (e: React.PointerEvent): void => {
    e.stopPropagation()
    onSelect()
    onStartMove?.(e.clientX, e.clientY)
  }

  const handleTitleBlur = (): void => {
    setIsEditingTitle(false)
    onUpdate({ title: title.trim() || 'Interactive Diagram' })
  }

  // Key down inside React Flow: delete selected nodes/edges, or delete entire diagram when container is selected
  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const activeEl = document.activeElement
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
        return
      }

      const selectedNodes = nodes.filter((n) => n.selected)
      const selectedEdges = edges.filter((e) => e.selected)
      if (selectedNodes.length > 0 || selectedEdges.length > 0) {
        e.preventDefault()
        e.stopPropagation()
        const nodeIds = new Set(selectedNodes.map((n) => n.id))
        const edgeIds = new Set(selectedEdges.map((e) => e.id))
        const nextNodes = nodes.filter((n) => !nodeIds.has(n.id))
        const nextEdges = edges.filter(
          (e) => !edgeIds.has(e.id) && !nodeIds.has(e.source) && !nodeIds.has(e.target)
        )
        setNodes(nextNodes)
        setEdges(nextEdges)
        onUpdate({ nodes: nextNodes, edges: nextEdges })
        return
      }

      if (isSelected) {
        e.preventDefault()
        e.stopPropagation()
        onDelete()
      }
    }
  }

  const activeTargetNode =
    contextMenu?.kind === 'node' ? nodes.find((n) => n.id === contextMenu.nodeId) : undefined
  const activeTargetEdge =
    contextMenu?.kind === 'edge' ? edges.find((e) => e.id === contextMenu.edgeId) : undefined

  const isTargetNodeAnimated = activeTargetNode
    ? activeTargetNode.data?.animated !== undefined
      ? Boolean(activeTargetNode.data.animated)
      : typeof activeTargetNode.type === 'string' &&
        activeTargetNode.type.startsWith('anim-line-')
    : false

  const targetConnectedEdges = activeTargetNode
    ? edges.filter((e) => e.source === activeTargetNode.id || e.target === activeTargetNode.id)
    : []
  const areConnectedEdgesAnimated =
    targetConnectedEdges.length > 0 && targetConnectedEdges.every((e) => Boolean(e.animated))

  const isDiagramAllAnimated =
    nodes.length > 0 &&
    nodes.every((n) =>
      n.data?.animated !== undefined
        ? Boolean(n.data.animated)
        : typeof n.type === 'string' && n.type.startsWith('anim-line-')
    ) &&
    edges.every((e) => Boolean(e.animated))

  const activeNodeShapeKey = activeTargetNode
    ? String(activeTargetNode.data?.shapeId || activeTargetNode.type || '')
    : ''

  return (
    <DiagramActionsContext.Provider value={diagramActionsValue}>
      <div
        id={diagram.id}
        className={`rf-board-container ${isSelected ? 'selected' : ''} ${disabledPointerEvents ? 'disabled-pointer' : ''}`}
        style={{
          transform: `translate(${diagram.x}px, ${diagram.y}px)`,
          width: `${boxW}px`,
          height: `${boxH}px`
        }}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onPointerDownCapture={() => {
          if (!disabledPointerEvents && !isSelected) {
            onSelect()
          }
        }}
        onPointerDown={(e) => {
          if (disabledPointerEvents) return
          e.stopPropagation()
          if (!isSelected) {
            onSelect()
          }
          const targetEl = e.target as HTMLElement | null
          const isSubElement = Boolean(
            targetEl?.closest(
              '.react-flow__node, .react-flow__edge, .react-flow__handle, .react-flow__controls, .rf-floating-toolbar, .card-resize-handles, .resize-edge, .resize-handle, .rf-resize-handle, button, input, textarea'
            )
          )
          if (!isSubElement && e.button === 0) {
            // Clear any stale internal node/edge selection so Delete removes the whole diagram and dragging moves it
            if (nodes.some((n) => n.selected)) {
              setNodes((nds) => nds.map((n) => (n.selected ? { ...n, selected: false } : n)))
            }
            if (edges.some((edge) => edge.selected)) {
              setEdges((eds) =>
                eds.map((edge) => (edge.selected ? { ...edge, selected: false } : edge))
              )
            }
            e.currentTarget.focus({ preventScroll: true })
            onStartMove?.(e.clientX, e.clientY)
          }
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* 1. Immersed Floating Pill Toolbar (Shows when selected or hovered) */}
        {(isSelected || isHovered) && (
          <div className="rf-floating-toolbar" onPointerDown={(e) => e.stopPropagation()}>
            <div
              className="rf-flow-drag-pill"
              onPointerDown={handleHeaderPointerDown}
              title="Drag to move entire diagram on whiteboard"
            >
              <GripHorizontal size={14} />
              <span>Move Flow</span>
            </div>

            <span className="rf-toolbar-divider" />

            {isEditingTitle ? (
              <input
                type="text"
                className="rf-title-edit-input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={handleTitleBlur}
                onKeyDown={(e) => e.key === 'Enter' && handleTitleBlur()}
                autoFocus
              />
            ) : (
              <span
                className="rf-pill-title"
                title="Double click to edit diagram title"
                onDoubleClick={() => setIsEditingTitle(true)}
              >
                {title}
              </span>
            )}

            <span className="rf-toolbar-divider" />

            {/* Quick Add Node Buttons */}
            <button
              type="button"
              className="rf-pill-btn"
              title="Add Process Step"
              onClick={() => handleAddNode('process', 'Action Step')}
            >
              <Plus size={11} />
              <span>Step</span>
            </button>
            <button
              type="button"
              className="rf-pill-btn"
              title="Add Decision (Diamond)"
              onClick={() => handleAddNode('decision', 'Condition?')}
            >
              <HelpCircle size={11} />
              <span>Decision</span>
            </button>
            <button
              type="button"
              className="rf-pill-btn"
              title="Add Database Store"
              onClick={() => handleAddNode('database', 'Database')}
            >
              <Database size={11} />
              <span>DB</span>
            </button>
            <button
              type="button"
              className="rf-pill-btn"
              title="Add Cloud / API Gateway"
              onClick={() => handleAddNode('cloud', 'API Gateway')}
            >
              <Cloud size={11} />
              <span>Cloud</span>
            </button>
            <button
              type="button"
              className="rf-pill-btn"
              title="Add Start / End Pill"
              onClick={() => handleAddNode('startEnd', 'End')}
            >
              <CheckCircle size={11} />
              <span>End</span>
            </button>
            <button
              type="button"
              className="rf-pill-btn"
              title="Add Sticky Note"
              onClick={() => handleAddNode('sticky', 'Note text', { bg: '#fef08a' })}
            >
              <StickyNote size={11} />
              <span>Sticky</span>
            </button>
            <button
              type="button"
              className="rf-pill-btn"
              title="Add Group Frame"
              onClick={() => handleAddNode('group', 'Container Frame')}
            >
              <Layers size={11} />
              <span>Group</span>
            </button>

            <span className="rf-toolbar-divider" />

            {/* Auto Layout */}
            <button
              type="button"
              className="rf-pill-icon-btn"
              title="Auto-Layout (Top-Down)"
              onClick={() => handleAutoLayout('TB')}
            >
              <AlignVerticalSpaceAround size={13} />
            </button>
            <button
              type="button"
              className="rf-pill-icon-btn"
              title="Auto-Layout (Left-to-Right)"
              onClick={() => handleAutoLayout('LR')}
            >
              <AlignHorizontalSpaceAround size={13} />
            </button>

            {/* Duplicate Flow */}
            <button
              type="button"
              className="rf-pill-icon-btn"
              title="Duplicate Diagram"
              onClick={onDuplicate}
            >
              <Copy size={13} />
            </button>

            {/* Delete Flow */}
            <button
              type="button"
              className="rf-pill-btn danger"
              title="Delete Entire Diagram from Board (Delete / Backspace)"
              onClick={onDelete}
            >
              <Trash2 size={11} />
              <span>Delete</span>
            </button>
          </div>
        )}

        {/* Live dimension badge while resizing */}
        {isResizing && (
          <div className="resize-dimension-badge">
            {boxW} × {boxH} px
          </div>
        )}

        {/* 2. React Flow Canvas (Transparent, Clipped & Dynamically Scaled to Box) */}
        <div className="rf-canvas-wrap">
          <ReactFlow
            nodes={nodes}
            edges={adaptedEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeDragStop={onNodeDragStop}
            onNodesDelete={onNodesDelete}
            onEdgesDelete={onEdgesDelete}
            onConnect={onConnect}
            onNodeContextMenu={(e, node) => {
              e.preventDefault()
              e.stopPropagation()
              openNodeContextMenuAt(node.id, e.clientX, e.clientY)
            }}
            onEdgeContextMenu={(e, edge) => {
              e.preventDefault()
              e.stopPropagation()
              openEdgeContextMenuAt(edge.id, e.clientX, e.clientY)
            }}
            nodesDraggable={true}
            nodesConnectable={true}
            elementsSelectable={true}
            panOnDrag={false}
            zoomOnScroll={false}
            preventScrolling={false}
            minZoom={0.05}
            maxZoom={3}
            proOptions={RF_PRO_OPTIONS}
            snapToGrid
            snapGrid={[12, 12]}
          >
            <DiagramViewportSync boxW={boxW} boxH={boxH} nodes={nodes} layoutTick={layoutTick} />
            {boxH >= 180 && <Controls position="bottom-right" showInteractive={false} />}
          </ReactFlow>
        </div>

        {/* 3. All 4 Edges & 8 Resize Handles */}
        {!disabledPointerEvents && onStartResize && (
          <div className="card-resize-handles">
            {/* Edge grab strips (always active so cursor feedback works immediately on all 4 edges) */}
            {(['n', 's', 'e', 'w'] as const).map((dir) => (
              <div
                key={`edge-${dir}`}
                className={`resize-edge ${dir}`}
                title={`Drag ${dir === 'n' ? 'top' : dir === 's' ? 'bottom' : dir === 'e' ? 'right' : 'left'} edge to resize`}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  onStartResize(e, dir)
                }}
              />
            ))}

            {/* Visible corner & midpoint grips */}
            {(isSelected || isHovered || isResizing) &&
              (['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const).map((dir) => (
                <div
                  key={`handle-${dir}`}
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

      {/* Right-click Shape & Line Replacement Context Menu */}
      {contextMenu &&
        createPortal(
          <div
            ref={contextMenuRef}
            className={`rf-context-menu ${contextMenu.kind === 'edge' ? 'edge-menu' : 'node-menu'}`}
            style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
            onPointerDown={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
          >
            {contextMenu.kind === 'node' && activeTargetNode ? (
              <>
                <div className="rf-context-header">
                  <div className="rf-context-title-wrap">
                    <RefreshCw size={13} className="text-accent" />
                    <span className="rf-context-title">
                      {(activeTargetNode.data?.label as string) || activeNodeShapeKey || 'Shape'}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="rf-context-close"
                    title="Close menu"
                    onClick={() => setContextMenu(null)}
                  >
                    <X size={13} />
                  </button>
                </div>

                <div className="rf-context-actions">
                  <button
                    type="button"
                    className={`rf-context-btn primary ${isTargetNodeAnimated ? 'active' : ''}`}
                    onClick={() => {
                      handleToggleNodeAnimated(activeTargetNode.id, !isTargetNodeAnimated)
                      setContextMenu(null)
                    }}
                  >
                    <Zap size={13} />
                    <span>
                      {isTargetNodeAnimated
                        ? 'Switch Shape to Static Version'
                        : 'Replace with Animated Version'}
                    </span>
                  </button>

                  {targetConnectedEdges.length > 0 && (
                    <button
                      type="button"
                      className={`rf-context-btn ${areConnectedEdgesAnimated ? 'active' : ''}`}
                      onClick={() => {
                        handleAnimateConnectedEdges(
                          activeTargetNode.id,
                          !areConnectedEdgesAnimated
                        )
                        setContextMenu(null)
                      }}
                    >
                      <Zap size={13} />
                      <span>
                        {areConnectedEdgesAnimated
                          ? 'Stop Connected Lines Animation'
                          : `Animate Connected Lines (${targetConnectedEdges.length})`}
                      </span>
                    </button>
                  )}

                  <button
                    type="button"
                    className={`rf-context-btn ${isDiagramAllAnimated ? 'active' : ''}`}
                    onClick={() => {
                      handleAnimateEntireDiagram(!isDiagramAllAnimated)
                      setContextMenu(null)
                    }}
                  >
                    <Zap size={13} />
                    <span>
                      {isDiagramAllAnimated
                        ? 'Switch Entire Diagram to Static'
                        : 'Animate Entire Diagram'}
                    </span>
                  </button>
                </div>

                <div className="rf-context-divider" />

                <div className="rf-context-picker">
                  <div className="rf-context-picker-head">
                    <span>Replace Shape With</span>
                    <div className="rf-context-mode-pills">
                      <button
                        type="button"
                        className={`rf-context-mode-pill ${!replaceAsAnimated ? 'active' : ''}`}
                        onClick={() => setReplaceAsAnimated(false)}
                      >
                        Static
                      </button>
                      <button
                        type="button"
                        className={`rf-context-mode-pill anim ${replaceAsAnimated ? 'active' : ''}`}
                        onClick={() => setReplaceAsAnimated(true)}
                      >
                        <Zap size={10} />
                        <span>Animated</span>
                      </button>
                    </div>
                  </div>

                  <div className="rf-context-search-wrap">
                    <Search size={12} className="rf-context-search-icon" />
                    <input
                      type="text"
                      className="rf-context-search-input"
                      placeholder="Search any shape or animated line..."
                      value={menuSearch}
                      onChange={(e) => setMenuSearch(e.target.value)}
                      onKeyDown={(e) => e.stopPropagation()}
                      autoFocus
                    />
                    {menuSearch && (
                      <button
                        type="button"
                        className="rf-context-search-clear"
                        onClick={() => setMenuSearch('')}
                      >
                        <X size={11} />
                      </button>
                    )}
                  </div>

                  <div className="rf-context-cats">
                    <button
                      type="button"
                      className={`rf-context-cat-pill ${menuCategory === 'all' ? 'active' : ''}`}
                      onClick={() => setMenuCategory('all')}
                    >
                      All
                    </button>
                    <button
                      type="button"
                      className={`rf-context-cat-pill ${menuCategory === 'animated-lines' ? 'active' : ''}`}
                      onClick={() => setMenuCategory('animated-lines')}
                    >
                      Animated Lines
                    </button>
                    <button
                      type="button"
                      className={`rf-context-cat-pill ${menuCategory === 'quick' ? 'active' : ''}`}
                      onClick={() => setMenuCategory('quick')}
                    >
                      Quick Nodes
                    </button>
                    {SHAPE_CATEGORIES.map((cat) => (
                      <button
                        key={cat.id}
                        type="button"
                        className={`rf-context-cat-pill ${menuCategory === cat.id ? 'active' : ''}`}
                        onClick={() => setMenuCategory(cat.id)}
                      >
                        {cat.name}
                      </button>
                    ))}
                  </div>

                  <div className="rf-context-grid">
                    {menuFilteredQuickNodes.map((qn) => {
                      const previewShape =
                        getLibraryShape(qn.previewShapeId) || getLibraryShape('rectangle')!
                      const isCurrent = activeTargetNode.type === qn.type
                      return (
                        <button
                          key={`qn-${qn.type}`}
                          type="button"
                          className={`rf-context-shape-tile ${isCurrent ? 'current' : ''} ${replaceAsAnimated ? 'is-animated' : ''}`}
                          title={`Replace with ${qn.label}${replaceAsAnimated ? ' (Animated)' : ''}`}
                          onClick={() => {
                            handleReplaceNodeShape(activeTargetNode.id, qn.type, {
                              defaultLabel: qn.defaultLabel,
                              forceAnimated: replaceAsAnimated
                            })
                            setContextMenu(null)
                          }}
                        >
                          <div className="rf-context-tile-preview">
                            <ShapeSvg
                              shape={previewShape}
                              strokeColor={palette?.shapeStroke || '#111111'}
                              fillColor={
                                qn.type === 'sticky' ? '#fef08a' : (palette?.shapeFill || '#FFE566')
                              }
                              strokeWidth={1.6}
                              preserveAspectRatio="xMidYMid meet"
                              className="rf-context-tile-svg"
                              animated={replaceAsAnimated}
                            />
                          </div>
                          <span className="rf-context-tile-name">{qn.label}</span>
                          {isCurrent && (
                            <span className="rf-context-tile-check" title="Current shape">
                              <Check size={9} />
                            </span>
                          )}
                        </button>
                      )
                    })}

                    {menuFilteredAnimatedLines.map((lineShape) => {
                      const isCurrent = activeNodeShapeKey === lineShape.id
                      return (
                        <button
                          key={`al-${lineShape.id}`}
                          type="button"
                          className={`rf-context-shape-tile is-animated ${isCurrent ? 'current' : ''}`}
                          title={`Replace with ${lineShape.name} (Animated)`}
                          onClick={() => {
                            handleReplaceNodeShape(activeTargetNode.id, lineShape.id, {
                              shapeDef: lineShape,
                              defaultLabel: lineShape.defaultLabel,
                              forceAnimated: true
                            })
                            setContextMenu(null)
                          }}
                        >
                          <div className="rf-context-tile-preview">
                            <ShapeSvg
                              shape={lineShape}
                              strokeColor={palette?.shapeStroke || '#111111'}
                              fillColor="none"
                              strokeWidth={1.6}
                              preserveAspectRatio="xMidYMid meet"
                              className="rf-context-tile-svg"
                              animated={true}
                            />
                          </div>
                          <span className="rf-context-tile-name">{lineShape.name}</span>
                          {isCurrent && (
                            <span className="rf-context-tile-check" title="Current shape">
                              <Check size={9} />
                            </span>
                          )}
                        </button>
                      )
                    })}

                    {menuFilteredLibShapes.map((shape) => {
                      const isCurrent = activeNodeShapeKey === shape.id
                      return (
                        <button
                          key={`lib-${shape.id}`}
                          type="button"
                          className={`rf-context-shape-tile ${isCurrent ? 'current' : ''} ${replaceAsAnimated ? 'is-animated' : ''}`}
                          title={`Replace with ${shape.name}${replaceAsAnimated ? ' (Animated)' : ''}`}
                          onClick={() => {
                            handleReplaceNodeShape(activeTargetNode.id, shape.id, {
                              shapeDef: shape,
                              defaultLabel: shape.defaultLabel ?? shape.name,
                              forceAnimated: replaceAsAnimated
                            })
                            setContextMenu(null)
                          }}
                        >
                          <div className="rf-context-tile-preview">
                            <ShapeSvg
                              shape={shape}
                              strokeColor={palette?.shapeStroke || '#111111'}
                              fillColor={shape.defaultFill || palette?.shapeFill || '#FFE566'}
                              strokeWidth={1.6}
                              preserveAspectRatio="xMidYMid meet"
                              className="rf-context-tile-svg"
                              animated={replaceAsAnimated}
                            />
                          </div>
                          <span className="rf-context-tile-name">{shape.name}</span>
                          {isCurrent && (
                            <span className="rf-context-tile-check" title="Current shape">
                              <Check size={9} />
                            </span>
                          )}
                        </button>
                      )
                    })}

                    {menuFilteredQuickNodes.length === 0 &&
                      menuFilteredAnimatedLines.length === 0 &&
                      menuFilteredLibShapes.length === 0 && (
                        <div className="rf-context-empty">No matching shapes found.</div>
                      )}
                  </div>
                </div>
              </>
            ) : contextMenu.kind === 'edge' && activeTargetEdge ? (
              <>
                <div className="rf-context-header">
                  <div className="rf-context-title-wrap">
                    <Zap size={13} className="text-accent" />
                    <span className="rf-context-title">Connector Line</span>
                  </div>
                  <button
                    type="button"
                    className="rf-context-close"
                    title="Close menu"
                    onClick={() => setContextMenu(null)}
                  >
                    <X size={13} />
                  </button>
                </div>

                <div className="rf-context-actions">
                  <button
                    type="button"
                    className={`rf-context-btn primary ${activeTargetEdge.animated ? 'active' : ''}`}
                    onClick={() => {
                      handleUpdateEdgeStyle(
                        activeTargetEdge.id,
                        activeTargetEdge.animated ? 'static' : 'animated'
                      )
                      setContextMenu(null)
                    }}
                  >
                    <Zap size={13} />
                    <span>
                      {activeTargetEdge.animated
                        ? 'Switch to Static Solid Line'
                        : 'Replace with Animated Flow Line'}
                    </span>
                  </button>

                  <button
                    type="button"
                    className="rf-context-btn"
                    onClick={() => {
                      handleUpdateEdgeStyle(activeTargetEdge.id, 'dotted')
                      setContextMenu(null)
                    }}
                  >
                    <Zap size={13} />
                    <span>Replace with Animated Dotted Pulse</span>
                  </button>

                  <button
                    type="button"
                    className="rf-context-btn"
                    onClick={() => {
                      handleAnimateEntireDiagram(true)
                      setContextMenu(null)
                    }}
                  >
                    <Zap size={13} />
                    <span>Animate All Shapes &amp; Lines</span>
                  </button>

                  <div className="rf-context-divider" />

                  <button
                    type="button"
                    className="rf-context-btn danger"
                    onClick={() => {
                      onEdgesDelete([activeTargetEdge])
                      setContextMenu(null)
                    }}
                  >
                    <Trash2 size={13} />
                    <span>Delete Connector Line</span>
                  </button>
                </div>
              </>
            ) : null}
          </div>,
          document.body
        )}
    </DiagramActionsContext.Provider>
  )
}
