import { memo } from 'react'
import type { TextNode } from '../types/board'
import { colorFor, type ThemeTokens } from '../themes'

interface TextLayerProps {
  nodes: TextNode[]
  theme: ThemeTokens
  registerRef: (id: string, el: HTMLElement | null) => void
}

/** Committed typography layer — DOM text so fonts/themes switch instantly via CSS. */
export const TextLayer = memo(function TextLayer({ nodes, theme, registerRef }: TextLayerProps) {
  return (
    <div className="text-layer" aria-live="polite">
      {nodes.map((n) =>
        n.source === 'ai' ? (
          <article
            key={n.id}
            ref={(el) => registerRef(n.id, el)}
            className="note-card"
            style={{ left: n.x, top: n.y, fontSize: n.fontSize }}
          >
            {n.title && <h4 style={{ color: theme.accent }}>{n.title}</h4>}
            <p style={{ color: colorFor(theme, n.color) }}>{n.text}</p>
          </article>
        ) : (
          <span
            key={n.id}
            ref={(el) => registerRef(n.id, el)}
            className="ink-text"
            style={{ left: n.x, top: n.y, fontSize: n.fontSize, color: colorFor(theme, n.color) }}
          >
            {n.text}
          </span>
        )
      )}
    </div>
  )
})
