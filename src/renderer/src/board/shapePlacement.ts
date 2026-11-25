import type { LibraryShapeDef } from '../shapes/shapeLibrary'
import type { FontId, ShapeKind, ShapeNode } from '../types/board'

export interface EmbeddedShapeOptions {
  label?: string
  description?: string
  color?: string
  w?: number
  h?: number
  shapeId?: string
  animated?: boolean
}

export interface EmbeddedShapeSpec {
  shape: ShapeKind
  w: number
  h: number
  label: string
  fillColor: string
  borderRadius?: number
  strokeStyle?: 'solid' | 'dashed' | 'dotted'
  strokeWidth?: number
  animated?: boolean
}

const GEOMETRIC_CLEAN_CATEGORIES = new Set([
  'aiAndMath',
  'dataStructures',
  'basic',
  'polygons',
  'arrows',
  'lines',
  'threeD',
  'brackets',
  'symbols'
])

/**
 * Maps any palette shape or library catalog shape into direct canvas ShapeNode dimensions & style,
 * avoiding boxed sub-diagrams and auto-zoom clipping.
 */
export function resolveEmbeddedShapeSpec(
  shapeType: string,
  options?: EmbeddedShapeOptions,
  defaultFill = '#FFE566',
  lookupShape?: (id: string) => LibraryShapeDef | undefined
): EmbeddedShapeSpec {
  const libShape = options?.shapeId
    ? lookupShape?.(options.shapeId)
    : undefined

  // Explicit library catalog shape (e.g., square, triangle, fc-decision, anim-line-arrow)
  if (libShape) {
    return buildSpecFromLibraryShape(libShape, options, defaultFill)
  }

  const fill = options?.color || defaultFill

  switch (shapeType) {
    case 'process':
      return {
        shape: 'rounded-rect',
        w: options?.w ?? 170,
        h: options?.h ?? 86,
        borderRadius: 12,
        label: options?.label ?? 'Process',
        fillColor: fill,
        animated: options?.animated
      }
    case 'decision':
      return {
        shape: 'diamond',
        w: options?.w ?? 164,
        h: options?.h ?? 112,
        label: options?.label ?? 'Decision?',
        fillColor: fill,
        animated: options?.animated
      }
    case 'startEnd':
      return {
        shape: 'rounded-rect',
        w: options?.w ?? 164,
        h: options?.h ?? 72,
        borderRadius: 36,
        label: options?.label ?? 'Start / End',
        fillColor: fill,
        animated: options?.animated
      }
    case 'database':
      return {
        shape: 'cylinder',
        w: options?.w ?? 132,
        h: options?.h ?? 124,
        label: options?.label ?? 'Database',
        fillColor: fill,
        animated: options?.animated
      }
    case 'cloud':
      return {
        shape: 'cloud',
        w: options?.w ?? 184,
        h: options?.h ?? 116,
        label: options?.label ?? 'Cloud API',
        fillColor: fill,
        animated: options?.animated
      }
    case 'document':
      return {
        shape: 'fc-document',
        w: options?.w ?? 168,
        h: options?.h ?? 108,
        label: options?.label ?? 'Document',
        fillColor: fill,
        animated: options?.animated
      }
    case 'inputOutput':
      return {
        shape: 'parallelogram',
        w: options?.w ?? 174,
        h: options?.h ?? 86,
        label: options?.label ?? 'Input / Output',
        fillColor: fill,
        animated: options?.animated
      }
    case 'actor':
      return {
        shape: 'actor',
        w: options?.w ?? 96,
        h: options?.h ?? 124,
        label: options?.label ?? 'Actor',
        fillColor: fill,
        animated: options?.animated
      }
    case 'circle':
      return {
        shape: 'circle',
        w: options?.w ?? 124,
        h: options?.h ?? 124,
        label: options?.label ?? 'State',
        fillColor: fill,
        animated: options?.animated
      }
    case 'group':
      return {
        shape: 'rounded-rect',
        w: options?.w ?? 320,
        h: options?.h ?? 220,
        borderRadius: 14,
        strokeStyle: 'dashed',
        label: options?.label ?? 'Group',
        fillColor: options?.color || 'transparent',
        animated: options?.animated
      }
    case 'custom':
      return {
        shape: 'rounded-rect',
        w: options?.w ?? 180,
        h: options?.h ?? 100,
        borderRadius: 10,
        label: options?.label ?? 'Component',
        fillColor: fill,
        animated: options?.animated
      }
    default: {
      const fallbackLib = lookupShape?.(shapeType)
      if (fallbackLib) {
        return buildSpecFromLibraryShape(fallbackLib, options, defaultFill)
      }
      return {
        shape: (options?.shapeId || shapeType || 'rounded-rect') as ShapeKind,
        w: options?.w ?? 160,
        h: options?.h ?? 100,
        label: options?.label ?? '',
        fillColor: fill,
        animated: options?.animated
      }
    }
  }
}

function buildSpecFromLibraryShape(
  libShape: LibraryShapeDef,
  options: EmbeddedShapeOptions | undefined,
  defaultFill: string
): EmbeddedShapeSpec {
  const rawW = Math.max(24, options?.w ?? libShape.size[0] ?? 120)
  const rawH = Math.max(24, options?.h ?? libShape.size[1] ?? 90)
  const maxDim = Math.max(rawW, rawH)
  const scale = maxDim < 140 ? Math.max(1.25, Math.min(1.6, 140 / maxDim)) : 1.2

  const w = Math.max(64, Math.round(rawW * scale))
  const h = Math.max(40, Math.round(rawH * scale))

  const hasFillPaths =
    libShape.category !== 'lines' && libShape.paths.some((p) => p.fill !== 'none')
  const resolvedFill = !hasFillPaths
    ? 'transparent'
    : options?.color || libShape.defaultFill || defaultFill || '#FFE566'

  let label = ''
  if (GEOMETRIC_CLEAN_CATEGORIES.has(libShape.category)) {
    if (libShape.defaultLabel && libShape.defaultLabel.trim()) {
      label = libShape.defaultLabel
    } else if (options?.label && options.label !== libShape.name) {
      label = options.label
    }
  } else {
    label =
      libShape.defaultLabel !== undefined
        ? libShape.defaultLabel
        : (options?.label ?? libShape.name)
  }

  return {
    shape: libShape.id as ShapeKind,
    w,
    h,
    label,
    fillColor: resolvedFill,
    animated:
      options?.animated !== undefined
        ? options.animated
        : libShape.id.startsWith('anim-line-') || undefined
  }
}

/**
 * Constructs a native board-embedded `ShapeNode` at the given empty board coordinates.
 */
export function buildEmbeddedShapeNode(
  shapeType: string,
  options: EmbeddedShapeOptions | undefined,
  placement: { x: number; y: number },
  defaults: {
    fillColor: string
    fontFamily: FontId
    layerId: string
    strokeWidth?: number
  },
  lookupShape?: (id: string) => LibraryShapeDef | undefined
): ShapeNode {
  const spec = resolveEmbeddedShapeSpec(shapeType, options, defaults.fillColor, lookupShape)
  return {
    id: `shape-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    shape: spec.shape,
    x: Math.round(placement.x),
    y: Math.round(placement.y),
    w: spec.w,
    h: spec.h,
    ...(spec.label ? { label: spec.label } : {}),
    color: 'ink',
    fillColor: spec.fillColor,
    fillOpacity: 1,
    strokeWidth: spec.strokeWidth ?? defaults.strokeWidth ?? 2.5,
    ...(spec.strokeStyle ? { strokeStyle: spec.strokeStyle } : {}),
    ...(spec.borderRadius !== undefined ? { borderRadius: spec.borderRadius } : {}),
    ...(spec.animated ? { animated: true } : {}),
    fontFamily: defaults.fontFamily,
    layerId: defaults.layerId
  }
}
