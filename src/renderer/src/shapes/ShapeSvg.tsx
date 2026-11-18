import React from 'react'
import { resolveDashArray, resolvePathFill, type LibraryShapeDef } from './shapeLibrary'

export interface ShapeSvgProps {
  shape: LibraryShapeDef
  strokeColor?: string
  fillColor?: string
  strokeWidth?: number
  className?: string
  style?: React.CSSProperties
  preserveAspectRatio?: string
  animated?: boolean
}

export function ShapeSvg({
  shape,
  strokeColor = '#38bdf8',
  fillColor = 'rgba(15, 23, 42, 0.85)',
  strokeWidth = 1.8,
  className,
  style,
  preserveAspectRatio = 'none',
  animated = false
}: ShapeSvgProps): React.JSX.Element {
  const combinedClass = [className, animated ? 'shape-svg-animated' : ''].filter(Boolean).join(' ')

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio={preserveAspectRatio}
      className={combinedClass || undefined}
      style={style}
      aria-hidden="true"
    >
      {shape.paths.map((p, idx) => {
        const pathStroke = p.stroke === 'none' ? 'none' : (p.stroke ?? strokeColor)
        const pathFill = resolvePathFill(p.fill, fillColor, strokeColor)
        const effectiveSw = pathStroke === 'none' ? 0 : (p.sw ?? 1) * strokeWidth
        return (
          <React.Fragment key={idx}>
            <path
              d={p.d}
              fill={pathFill}
              fillRule={p.rule}
              stroke={pathStroke}
              strokeOpacity={animated && pathStroke !== 'none' ? 0.28 : undefined}
              strokeWidth={effectiveSw}
              strokeLinejoin="round"
              strokeLinecap="round"
              strokeDasharray={resolveDashArray(p.dash)}
              vectorEffect="non-scaling-stroke"
            />
            {animated && (
              <path
                d={p.d}
                fill="none"
                stroke={
                  pathStroke === 'none'
                    ? p.fill === 'solid'
                      ? '#e0f2fe'
                      : strokeColor
                    : pathStroke
                }
                strokeWidth={Math.max(1.2, (p.sw ?? 1) * strokeWidth)}
                strokeLinejoin="round"
                strokeLinecap="round"
                strokeDasharray={
                  p.dash === 'dot' ? '2 5' : p.dash === 'dashdot' ? '6 3 2 3' : undefined
                }
                vectorEffect="non-scaling-stroke"
                className="shape-svg-flow-overlay"
              />
            )}
          </React.Fragment>
        )
      })}
    </svg>
  )
}
