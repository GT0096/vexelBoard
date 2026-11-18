import type { CSSProperties } from 'react'

interface BrandMarkProps {
  size?: number
  className?: string
  style?: CSSProperties
}

/**
 * Kinetic V Nib on Dot-Grid brand mark for Vexelboard.
 */
export function BrandMark({ size = 26, className = 'brand-mark', style }: BrandMarkProps): React.JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      width={size}
      height={size}
      fill="none"
      className={className}
      style={style}
      aria-hidden="true"
    >
      {/* Hard Neo-Brutalist offset shadow */}
      <rect x="14" y="14" width="80" height="80" rx="18" fill="#111111" />
      {/* Cream whiteboard card */}
      <rect x="8" y="8" width="80" height="80" rx="18" fill="#FFFDF7" stroke="#111111" strokeWidth="5" />

      {/* 3x3 Dot-Grid */}
      <g fill="#111111" fillOpacity="0.2">
        <circle cx="24" cy="24" r="2.5" />
        <circle cx="48" cy="24" r="2.5" />
        <circle cx="72" cy="24" r="2.5" />
        <circle cx="24" cy="48" r="2.5" />
        <circle cx="48" cy="48" r="2.5" />
        <circle cx="72" cy="48" r="2.5" />
        <circle cx="24" cy="72" r="2.5" />
        <circle cx="48" cy="72" r="2.5" />
        <circle cx="72" cy="72" r="2.5" />
      </g>

      {/* Kinetic V Nib: Left wing (Yellow) */}
      <path
        d="M20 31 L33 31 L45 55 L45 77 L24 51 Z"
        fill="#FFE566"
        stroke="#111111"
        strokeWidth="4.4"
        strokeLinejoin="round"
      />
      {/* Kinetic V Nib: Right wing (Coral) */}
      <path
        d="M45 55 L57 31 L70 31 L66 51 L45 77 Z"
        fill="#FF5E5B"
        stroke="#111111"
        strokeWidth="4.4"
        strokeLinejoin="round"
      />

      {/* Floating Cyan Node */}
      <circle cx="73.5" cy="23.5" r="6.4" fill="#67E8F9" stroke="#111111" strokeWidth="4" />
    </svg>
  )
}
