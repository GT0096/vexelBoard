import { useLayoutEffect, useEffect, type RefObject } from 'react'

function syncTextareaHeight(el: HTMLTextAreaElement, maxLines: number): void {
  const cs = window.getComputedStyle(el)
  const fontSize = parseFloat(cs.fontSize) || 13.5
  const parsedLineHeight = parseFloat(cs.lineHeight)
  const lineHeight = Number.isFinite(parsedLineHeight) ? parsedLineHeight : fontSize * 1.5
  const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0)
  const borderY = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0)

  const minHeight = Math.ceil(lineHeight + padY + borderY)
  const maxHeight = Math.ceil(lineHeight * maxLines + padY + borderY)

  el.style.height = 'auto'
  const scrollH = el.scrollHeight
  const clamped = Math.max(minHeight, Math.min(scrollH, maxHeight))
  el.style.height = `${clamped}px`
  el.style.overflowY = scrollH > maxHeight + 1 ? 'auto' : 'hidden'
}

/**
 * Auto-grows a textarea cleanly from 1 line up to `maxLines` (default 5),
 * and re-measures whenever the container width changes (responsive resize / maximize).
 */
export function useAutoGrowTextarea(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  maxLines = 5,
  isVisible = true
): void {
  useLayoutEffect(() => {
    if (!isVisible) return
    const el = ref.current
    if (!el) return
    syncTextareaHeight(el, maxLines)
  }, [ref, value, maxLines, isVisible])

  useEffect(() => {
    if (!isVisible) return
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return

    let lastWidth = Math.round(el.getBoundingClientRect().width)
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const nextWidth = Math.round(entry.contentRect.width)
      if (nextWidth !== lastWidth) {
        lastWidth = nextWidth
        syncTextareaHeight(el, maxLines)
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, maxLines, isVisible])
}
