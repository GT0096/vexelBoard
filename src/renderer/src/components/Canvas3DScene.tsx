import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Box,
  Copy,
  Eye,
  FilePlus2,
  GripHorizontal,
  Grid,
  Layers,
  Pause,
  Play,
  Plus,
  RotateCcw,
  RotateCw,
  Sliders,
  Trash2,
  X,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import {
  buildPresetScene3D,
  SCENE3D_PRESETS,
  type Scene3DCamera,
  type Scene3DElement,
  type Scene3DPrimitiveType,
  type Scene3DSpec
} from '@shared/scene3dSchema'
import { renderScene3DToCanvas } from '../board/scene3dEngine'
import type { PortSide, Scene3DNode } from '../types/board'
import type { ResizeDirection } from './CanvasElements'

const QUICK_PARTS: Array<{ type: Scene3DPrimitiveType; label: string; create: (idx: number) => Scene3DElement }> = [
  {
    type: 'box',
    label: 'Box',
    create: (i) => ({ id: `box-${i}`, type: 'box', pos: [0, 0.4, 0], size: [1, 0.7, 1], color: '#3B82F6' })
  },
  {
    type: 'sphere',
    label: 'Sphere',
    create: (i) => ({ id: `sphere-${i}`, type: 'sphere', pos: [0.8, 0.5, 0], radius: 0.42, color: '#EF4444' })
  },
  {
    type: 'cylinder',
    label: 'Cylinder',
    create: (i) => ({ id: `cyl-${i}`, type: 'cylinder', pos: [-0.8, 0.5, 0], radius: 0.3, height: 1.0, color: '#10B981' })
  },
  {
    type: 'wheel',
    label: 'Wheel',
    create: (i) => ({
      id: `wheel-${i}`,
      type: 'wheel',
      pos: [0, 0, 1.0],
      radius: 0.36,
      tubeRadius: 0.12,
      spokes: 6,
      color: '#0F172A',
      secondaryColor: '#CBD5E1',
      anim: { rotateSpeed: [0, 0, -2] }
    })
  },
  {
    type: 'spring',
    label: 'Spring',
    create: (i) => ({
      id: `spring-${i}`,
      type: 'spring',
      from: [-1.1, 0.4, 0],
      to: [1.1, 0.4, 0],
      radius: 0.24,
      turns: 8,
      color: '#F59E0B'
    })
  },
  {
    type: 'lens',
    label: 'Optics Lens',
    create: (i) => ({
      id: `lens-${i}`,
      type: 'lens',
      pos: [0, 0.5, 0],
      radius: 0.65,
      height: 0.25,
      lensKind: 'biconvex',
      color: '#38BDF8',
      opacity: 0.48
    })
  },
  {
    type: 'prism',
    label: 'Prism',
    create: (i) => ({
      id: `prism-${i}`,
      type: 'prism',
      pos: [1.1, 0.45, 0],
      size: [0.85, 0.85, 0.75],
      color: '#7DD3FC',
      opacity: 0.5
    })
  },
  {
    type: 'flask',
    label: 'Lab Flask',
    create: (i) => ({
      id: `flask-${i}`,
      type: 'flask',
      pos: [0, -0.35, 0],
      radius: 0.5,
      height: 1.05,
      fillLevel: 0.5,
      color: '#E0F2FE',
      liquidColor: '#EC4899',
      opacity: 0.44
    })
  },
  {
    type: 'arrow3d',
    label: 'Vector 3D',
    create: (i) => ({
      id: `vec-${i}`,
      type: 'arrow3d',
      from: [0, 0.2, 0],
      to: [1.6, 0.9, 0.4],
      color: '#10B981',
      label: 'F',
      anim: { pulseFlow: true }
    })
  },
  {
    type: 'surface3d',
    label: 'Surface z=f(x,y)',
    create: (i) => ({
      id: `surf-${i}`,
      type: 'surface3d',
      expr: 'sin(x*1.2)*cos(y*1.2)*0.9',
      xRange: [-2.8, 2.8],
      zRange: [-2.8, 2.8],
      resolution: 18,
      colorMap: 'coolwarm'
    })
  },
  {
    type: 'label3d',
    label: '3D Label',
    create: (i) => ({
      id: `lbl-${i}`,
      type: 'label3d',
      pos: [0, 1.4, 0],
      text: 'Measurement Point',
      color: '#7C3AED',
      fontSize: 12
    })
  }
]

/* ---------------- Shared Interactive 3D Canvas Viewport ---------------- */

export interface Scene3DCanvasProps {
  spec: Scene3DSpec
  width: number
  height: number
  isLightTheme?: boolean
  playing: boolean
  autoRotate: boolean
  wireframe: boolean
  camera: Scene3DCamera
  onChangeCamera: (next: Scene3DCamera) => void
  onPointerPassThrough?: boolean
  interactionMode?: 'orbit' | 'pan'
  className?: string
}

export const Scene3DViewportCanvas: React.FC<Scene3DCanvasProps> = ({
  spec,
  width,
  height,
  isLightTheme = true,
  playing,
  autoRotate,
  wireframe,
  camera,
  onChangeCamera,
  onPointerPassThrough = false,
  interactionMode = 'orbit',
  className = ''
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const specRef = useRef(spec)
  const camRef = useRef(camera)
  const playingRef = useRef(playing)
  const autoRotateRef = useRef(autoRotate)
  const wireframeRef = useRef(wireframe)
  const timeRef = useRef(0)
  const orbitRef = useRef<{
    mode: 'orbit' | 'pan'
    startX: number
    startY: number
    initYaw: number
    initPitch: number
    initPanX: number
    initPanY: number
    moved: boolean
  } | null>(null)

  useEffect(() => {
    specRef.current = spec
    camRef.current = camera
    playingRef.current = playing
    wireframeRef.current = wireframe
    autoRotateRef.current = autoRotate
  }, [spec, camera, playing, wireframe, autoRotate])

  const hasAnimElements = useMemo(
    () =>
      spec.elements.some(
        (el) =>
          Boolean(el.anim?.rotateSpeed) ||
          Boolean(el.anim?.oscillate) ||
          Boolean(el.anim?.pulseFlow) ||
          (el.type === 'surface3d' && /\bt\b/.test(el.expr || ''))
      ),
    [spec.elements]
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let rafId = 0
    let lastTs = performance.now()

    const drawFrame = (now: number): void => {
      const dt = Math.min(0.08, Math.max(0, (now - lastTs) / 1000))
      lastTs = now
      if (playingRef.current) {
        timeRef.current += dt
      }
      if (autoRotateRef.current && !orbitRef.current) {
        camRef.current = {
          ...camRef.current,
          yaw: ((camRef.current.yaw ?? 38) + dt * 26) % 360
        }
      }

      const dpr = window.devicePixelRatio || 1
      const targetW = Math.max(60, Math.round(width))
      const targetH = Math.max(60, Math.round(height))
      if (canvas.width !== Math.round(targetW * dpr) || canvas.height !== Math.round(targetH * dpr)) {
        canvas.width = Math.round(targetW * dpr)
        canvas.height = Math.round(targetH * dpr)
      }
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.save()
        ctx.scale(dpr, dpr)
        ctx.clearRect(0, 0, targetW, targetH)
        renderScene3DToCanvas(
          ctx,
          { ...specRef.current, wireframe: wireframeRef.current },
          targetW,
          targetH,
          camRef.current,
          timeRef.current,
          { isLight: isLightTheme }
        )
        ctx.restore()
      }

      if (autoRotateRef.current || (playingRef.current && hasAnimElements) || orbitRef.current) {
        rafId = requestAnimationFrame(drawFrame)
      }
    }

    rafId = requestAnimationFrame(drawFrame)
    return () => {
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [width, height, spec, isLightTheme, playing, autoRotate, wireframe, camera, hasAnimElements])

  useEffect(() => {
    const onMove = (e: PointerEvent): void => {
      if (!orbitRef.current) return
      const dx = e.clientX - orbitRef.current.startX
      const dy = e.clientY - orbitRef.current.startY
      if (Math.hypot(dx, dy) > 2) orbitRef.current.moved = true
      const nextCam: Scene3DCamera =
        orbitRef.current.mode === 'pan'
          ? {
              ...camRef.current,
              panX: Math.round(orbitRef.current.initPanX + dx),
              panY: Math.round(orbitRef.current.initPanY + dy)
            }
          : {
              ...camRef.current,
              yaw: orbitRef.current.initYaw + dx * 0.55,
              pitch: Math.max(-82, Math.min(82, orbitRef.current.initPitch + dy * 0.48))
            }
      camRef.current = nextCam
      onChangeCamera(nextCam)
    }
    const onUp = (): void => {
      if (orbitRef.current) {
        orbitRef.current = null
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [onChangeCamera])

  return (
    <canvas
      ref={canvasRef}
      className={`scene3d-viewport-canvas ${className}`}
      style={{
        width: `${width}px`,
        height: `${height}px`,
        pointerEvents: onPointerPassThrough ? 'none' : 'auto',
        cursor: onPointerPassThrough ? undefined : interactionMode === 'pan' ? 'grab' : 'grab'
      }}
      onContextMenu={(e) => {
        if (!onPointerPassThrough) e.preventDefault()
      }}
      onPointerDown={(e) => {
        if (onPointerPassThrough || (e.button !== 0 && e.button !== 1 && e.button !== 2)) return
        e.stopPropagation()
        const activeMode: 'orbit' | 'pan' =
          interactionMode === 'pan' || e.shiftKey || e.button === 1 || e.button === 2
            ? 'pan'
            : 'orbit'
        orbitRef.current = {
          mode: activeMode,
          startX: e.clientX,
          startY: e.clientY,
          initYaw: camRef.current.yaw ?? spec.camera?.yaw ?? 38,
          initPitch: camRef.current.pitch ?? spec.camera?.pitch ?? 24,
          initPanX: camRef.current.panX ?? spec.camera?.panX ?? 0,
          initPanY: camRef.current.panY ?? spec.camera?.panY ?? 0,
          moved: false
        }
      }}
    />
  )
}

/* ---------------- Compact 3D Viewer (In Notes & Code Output) ---------------- */

export interface Inline3DViewerProps {
  spec: Scene3DSpec
  height?: number
  onImmerseOnBoard?: (spec: Scene3DSpec) => void
  onCopyJson?: () => void
  compact?: boolean
}

export const Inline3DViewer: React.FC<Inline3DViewerProps> = ({
  spec,
  height = 230,
  onImmerseOnBoard,
  compact = false
}) => {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [boxWidth, setBoxWidth] = useState(320)
  const [playing, setPlaying] = useState(spec.animate !== false)
  const [autoRotate, setAutoRotate] = useState(Boolean(spec.camera?.autoRotate))
  const [wireframe, setWireframe] = useState(Boolean(spec.wireframe))
  const specCamKey = `${spec.preset || ''}:${spec.title || ''}`
  const [cameraState, setCameraState] = useState<{ key: string; cam: Scene3DCamera } | null>(null)
  const camera =
    cameraState && cameraState.key === specCamKey
      ? cameraState.cam
      : (spec.camera ?? { yaw: 38, pitch: 24, zoom: 1 })
  const setCamera = (updater: Scene3DCamera | ((prev: Scene3DCamera) => Scene3DCamera)): void => {
    setCameraState((prev) => {
      const base =
        prev && prev.key === specCamKey
          ? prev.cam
          : (spec.camera ?? { yaw: 38, pitch: 24, zoom: 1 })
      const next = typeof updater === 'function' ? updater(base) : updater
      return { key: specCamKey, cam: next }
    })
  }

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const updateSize = (): void => {
      const w = el.clientWidth
      if (w > 40) setBoxWidth(w)
    }
    updateSize()
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(updateSize)
      ro.observe(el)
      return () => ro.disconnect()
    }
    return undefined
  }, [])

  return (
    <div
      ref={wrapRef}
      className="inline-3d-viewer"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="inline-3d-topbar">
        <span className="inline-3d-title">
          <Box size={12} />
          <span>{spec.title || '3D View'}</span>
        </span>
        <div className="inline-3d-controls">
          <button
            type="button"
            className={`inline-3d-btn ${playing ? 'active' : ''}`}
            onClick={() => setPlaying((v) => !v)}
            title={playing ? 'Pause simulation' : 'Play simulation'}
          >
            {playing ? <Pause size={11} /> : <Play size={11} />}
          </button>
          <button
            type="button"
            className={`inline-3d-btn ${autoRotate ? 'active' : ''}`}
            onClick={() => setAutoRotate((v) => !v)}
            title="Auto-rotate 3D camera"
          >
            <RotateCw size={11} />
          </button>
          <button
            type="button"
            className={`inline-3d-btn ${wireframe ? 'active' : ''}`}
            onClick={() => setWireframe((v) => !v)}
            title="Toggle wireframe"
          >
            <Grid size={11} />
          </button>
          <button
            type="button"
            className="inline-3d-btn"
            onClick={() =>
              setCamera((c) => ({ ...c, zoom: Math.min(3.5, (c.zoom ?? 1) * 1.18) }))
            }
            title="Zoom in 3D"
          >
            <ZoomIn size={11} />
          </button>
          <button
            type="button"
            className="inline-3d-btn"
            onClick={() =>
              setCamera((c) => ({ ...c, zoom: Math.max(0.35, (c.zoom ?? 1) / 1.18) }))
            }
            title="Zoom out 3D"
          >
            <ZoomOut size={11} />
          </button>
          {onImmerseOnBoard && (
            <button
              type="button"
              className="inline-3d-btn primary"
              onClick={() => onImmerseOnBoard({ ...spec, camera, wireframe, immersed: true })}
              title="Immerse this 3D scene directly onto the whiteboard canvas"
            >
              <Layers size={11} />
              {!compact && <span>Immerse</span>}
            </button>
          )}
        </div>
      </div>
      <div className="inline-3d-stage" style={{ height: `${height}px` }}>
        <Scene3DViewportCanvas
          spec={spec}
          width={boxWidth}
          height={height}
          playing={playing}
          autoRotate={autoRotate}
          wireframe={wireframe}
          camera={camera}
          onChangeCamera={setCamera}
        />
        <div className="inline-3d-hint">Drag to orbit 3D</div>
      </div>
    </div>
  )
}

/* ---------------- Board Canvas-Immersed 3D Scene Card ---------------- */

export interface Canvas3DSceneCardProps {
  node: Scene3DNode
  isSelected: boolean
  isResizing?: boolean
  isLightTheme?: boolean
  activeThemeAccent: string
  disabledPointerEvents?: boolean
  onSelect: () => void
  onUpdate: (patch: Partial<Scene3DNode>, opts?: { history?: boolean }) => void
  onDelete: () => void
  onDuplicate: () => void
  onStartMove: (startX: number, startY: number) => void
  onStartResize?: (e: React.PointerEvent, dir: ResizeDirection) => void
  onStartConnect?: (sourceId: string, port: PortSide, clientX: number, clientY: number) => void
  onInsertToNotes?: (markdown: string, title?: string) => void
  onContextMenu?: (e: React.MouseEvent) => void
}

export const Canvas3DSceneCard: React.FC<Canvas3DSceneCardProps> = ({
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
  const [playing, setPlaying] = useState(node.spec.animate !== false)
  const [autoRotate, setAutoRotate] = useState(Boolean(node.spec.camera?.autoRotate))
  const [showEditor, setShowEditor] = useState(false)
  const [showPartPicker, setShowPartPicker] = useState(false)
  const [jsonDraft, setJsonDraft] = useState(() => JSON.stringify(node.spec, null, 2))
  const [jsonError, setJsonError] = useState<string | null>(null)

  const camera: Scene3DCamera = node.spec.camera ?? { yaw: 38, pitch: 24, zoom: 1 }
  const isImmersed = node.immersed !== false

  const updateSpec = (patch: Partial<Scene3DSpec>, history = true): void => {
    onUpdate(
      {
        title: patch.title ?? node.title,
        spec: { ...node.spec, ...patch }
      },
      { history }
    )
  }

  const handleCameraChange = (nextCam: Scene3DCamera): void => {
    onUpdate(
      {
        spec: { ...node.spec, camera: nextCam }
      },
      { history: false }
    )
  }

  const handleAddPart = (factory: (idx: number) => Scene3DElement): void => {
    const nextEl = factory(node.spec.elements.length + 1)
    updateSpec({
      preset: 'custom',
      elements: [...node.spec.elements, nextEl]
    })
    setShowPartPicker(false)
  }

  const handleUpdateElement = (elId: string, patch: Partial<Scene3DElement>): void => {
    updateSpec(
      {
        elements: node.spec.elements.map((el) => (el.id === elId ? { ...el, ...patch } : el))
      },
      false
    )
  }

  const handleApplyJson = (): void => {
    try {
      const parsed = JSON.parse(jsonDraft) as Scene3DSpec
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.elements)) {
        setJsonError('JSON must contain an "elements" array.')
        return
      }
      setJsonError(null)
      onUpdate({
        title: parsed.title || node.title,
        spec: parsed
      })
    } catch (err) {
      setJsonError(err instanceof Error ? err.message : 'Invalid JSON')
    }
  }

  const handleSendToNote = (): void => {
    if (!onInsertToNotes) return
    const md = `\`\`\`3d\n${JSON.stringify(node.spec, null, 2)}\n\`\`\``
    onInsertToNotes(md, node.title || node.spec.title || '3D Scene')
  }

  return (
    <div
      id={node.id}
      className={`canvas-3d-node ${isImmersed ? 'immersed' : 'framed'} ${isSelected ? 'selected' : ''} ${
        isResizing ? 'resizing' : ''
      }`}
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
      }}
    >
      {/* Drag Handle / Title Pill (visible on hover or selection when immersed, always visible when framed) */}
      {(isSelected || isHovered || !isImmersed) && (
        <div
          className={`canvas-3d-drag-pill ${isImmersed ? 'floating' : ''}`}
          onPointerDown={(e) => {
            if (disabledPointerEvents || e.button !== 0) return
            e.stopPropagation()
            onSelect()
            onStartMove(e.clientX, e.clientY)
          }}
          title="Drag to move 3D object across the canvas"
        >
          <GripHorizontal size={12} />
          <Box size={12} />
          <span>{node.title || node.spec.title || '3D Object'}</span>
        </div>
      )}

      {/* Selected Quick Toolbar */}
      {isSelected && (
        <div
          className="element-quick-bar canvas-3d-toolbar"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <select
            className="canvas-3d-preset-select"
            value={node.spec.preset || 'custom'}
            title="Switch 3D preset assembly"
            onChange={(e) => {
              const p = e.target.value
              if (p === 'custom') return
              const nextSpec = buildPresetScene3D(p)
              onUpdate({ title: nextSpec.title, spec: { ...nextSpec, immersed: isImmersed } })
            }}
          >
            <option value="custom">Custom 3D ({node.spec.elements.length} parts)</option>
            {SCENE3D_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <div className="canvas-3d-part-dropdown-wrap">
            <button
              type="button"
              className={`bar-btn ${showPartPicker ? 'active' : ''}`}
              onClick={() => setShowPartPicker((v) => !v)}
              title="Add 3D primitive part manually (box, wheel, spring, lens, prism, flask, vector, surface...)"
            >
              <Plus size={13} />
              <span>Part</span>
            </button>
            {showPartPicker && (
              <div className="canvas-3d-part-menu">
                {QUICK_PARTS.map((p) => (
                  <button
                    key={p.type}
                    type="button"
                    className="canvas-3d-part-item"
                    onClick={() => handleAddPart(p.create)}
                  >
                    + {p.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            className={`bar-btn ${playing ? 'active' : ''}`}
            onClick={() => {
              const next = !playing
              setPlaying(next)
              updateSpec({ animate: next }, false)
            }}
            title={playing ? 'Pause 3D simulation' : 'Play 3D simulation'}
          >
            {playing ? <Pause size={13} /> : <Play size={13} />}
          </button>

          <button
            type="button"
            className={`bar-btn ${autoRotate ? 'active' : ''}`}
            onClick={() => setAutoRotate((v) => !v)}
            title="Toggle auto-orbit rotation"
          >
            <RotateCw size={13} />
          </button>

          <button
            type="button"
            className={`bar-btn ${node.spec.wireframe ? 'active' : ''}`}
            onClick={() => updateSpec({ wireframe: !node.spec.wireframe })}
            title="Toggle 3D wireframe"
          >
            <Grid size={13} />
          </button>

          <button
            type="button"
            className={`bar-btn ${isImmersed ? 'active' : ''}`}
            onClick={() => onUpdate({ immersed: !isImmersed })}
            title={isImmersed ? 'Canvas-Immersed (no card border)' : 'Show Card Frame'}
          >
            <Eye size={13} />
          </button>

          <button
            type="button"
            className="bar-btn"
            onClick={() => handleCameraChange({ yaw: 38, pitch: 24, zoom: 1, panX: 0, panY: 0 })}
            title="Reset 3D camera"
          >
            <RotateCcw size={13} />
          </button>

          <button
            type="button"
            className="bar-btn"
            onClick={() =>
              handleCameraChange({ ...camera, zoom: Math.min(3.5, (camera.zoom ?? 1) * 1.18) })
            }
            title="Zoom 3D in"
          >
            <ZoomIn size={13} />
          </button>

          <button
            type="button"
            className="bar-btn"
            onClick={() =>
              handleCameraChange({ ...camera, zoom: Math.max(0.35, (camera.zoom ?? 1) / 1.18) })
            }
            title="Zoom 3D out"
          >
            <ZoomOut size={13} />
          </button>

          <button
            type="button"
            className={`bar-btn ${showEditor ? 'active' : ''}`}
            onClick={() => {
              const next = !showEditor
              if (next) {
                setJsonDraft(JSON.stringify(node.spec, null, 2))
                setJsonError(null)
              }
              setShowEditor(next)
            }}
            title="Edit 3D parts, coordinates & JSON"
          >
            <Sliders size={13} />
          </button>

          {onInsertToNotes && (
            <button
              type="button"
              className="bar-btn"
              onClick={handleSendToNote}
              title="Embed this 3D object inside a Markdown Note"
            >
              <FilePlus2 size={13} />
            </button>
          )}

          <button
            type="button"
            className="bar-btn"
            onClick={onDuplicate}
            title="Duplicate 3D Object"
          >
            <Copy size={13} />
          </button>

          <button
            type="button"
            className="bar-btn danger"
            onClick={onDelete}
            title="Delete 3D Object"
          >
            <Trash2 size={13} />
          </button>
        </div>
      )}

      {/* 3D Canvas Stage */}
      <Scene3DViewportCanvas
        spec={node.spec}
        width={node.w}
        height={node.h}
        isLightTheme={isLightTheme}
        playing={playing}
        autoRotate={autoRotate}
        wireframe={Boolean(node.spec.wireframe)}
        camera={camera}
        onChangeCamera={handleCameraChange}
        onPointerPassThrough={disabledPointerEvents}
      />

      {/* Manual 3D Part & JSON Editor Drawer */}
      {isSelected && showEditor && (
        <div
          className="canvas-3d-editor-drawer"
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <div className="canvas-3d-editor-hdr">
            <span>3D Parts &amp; JSON ({node.spec.elements.length})</span>
            <button type="button" className="bar-btn" onClick={() => setShowEditor(false)}>
              <X size={12} />
            </button>
          </div>

          <div className="canvas-3d-toggles-row">
            <label>
              <input
                type="checkbox"
                checked={node.spec.showGrid !== false}
                onChange={(e) => updateSpec({ showGrid: e.target.checked })}
              />
              <span>Grid</span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={node.spec.showAxes !== false}
                onChange={(e) => updateSpec({ showAxes: e.target.checked })}
              />
              <span>Axes</span>
            </label>
          </div>

          <div className="canvas-3d-parts-list">
            {node.spec.elements.slice(0, 12).map((el) => (
              <div key={el.id} className="canvas-3d-part-row">
                <span className="part-tag">{el.type}</span>
                <span className="part-id" title={el.id}>
                  {el.id}
                </span>
                {el.type === 'surface3d' ? (
                  <input
                    type="text"
                    className="part-expr-input"
                    value={el.expr || ''}
                    onChange={(e) => handleUpdateElement(el.id, { expr: e.target.value })}
                    title="z = f(x, y, t)"
                  />
                ) : (
                  <input
                    type="color"
                    value={el.color || '#3B82F6'}
                    onChange={(e) => handleUpdateElement(el.id, { color: e.target.value })}
                    title="Part color"
                  />
                )}
                <button
                  type="button"
                  className="bar-btn danger"
                  onClick={() =>
                    updateSpec({
                      elements: node.spec.elements.filter((item) => item.id !== el.id)
                    })
                  }
                  title="Remove part"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
          </div>

          <textarea
            className="canvas-3d-json-area"
            rows={5}
            value={jsonDraft}
            onChange={(e) => setJsonDraft(e.target.value)}
          />
          {jsonError && <div className="canvas-3d-json-err">{jsonError}</div>}
          <button type="button" className="canvas-3d-apply-btn" onClick={handleApplyJson}>
            Apply 3D Scene JSON
          </button>
        </div>
      )}

      {isResizing && (
        <div className="resize-dimension-badge">
          {node.w} × {node.h} px
        </div>
      )}

      {/* Flowchart Connection Ports (4 edge circular dots for linking Code <-> 3D <-> Shapes) */}
      {!disabledPointerEvents &&
        onStartConnect &&
        (isSelected || isHovered || isResizing) &&
        (['top', 'right', 'bottom', 'left'] as const).map((port) => (
          <button
            key={`3d-port-${port}`}
            type="button"
            className={`card-flow-port-handle pos-${port}`}
            title="Drag to connect to another Code Card, Graph, or 3D Scene"
            onPointerDown={(e) => {
              if (e.button !== 0) return
              e.preventDefault()
              e.stopPropagation()
              onSelect()
              onStartConnect(node.id, port, e.clientX, e.clientY)
            }}
          />
        ))}

      {!disabledPointerEvents && onStartResize && (
        <div className="card-resize-handles">
          {(['n', 's', 'e', 'w'] as const).map((dir) => (
            <div
              key={`3d-edge-${dir}`}
              className={`resize-edge ${dir}`}
              onPointerDown={(e) => onStartResize(e, dir)}
            />
          ))}
          {(isSelected || isHovered || isResizing) &&
            (['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const).map((dir) => (
              <div
                key={`3d-h-${dir}`}
                className={`resize-handle ${dir}`}
                onPointerDown={(e) => onStartResize(e, dir)}
              />
            ))}
        </div>
      )}
    </div>
  )
}
