import { useCallback, useEffect, useRef } from 'react'
import type { InkPoint, ShapeNode } from '../types/board'
import {
  classifyHoldStroke,
  snapConnectorToShapeAnchors,
  type HoldSnapResult
} from './holdSnapClassifier'
import type { ShapeSnapWorkerResponse } from '../workers/shapeSnap.worker'

const HOLD_DWELL_MS = 350
const HOLD_RADIUS_PX = 4

export interface HoldSnapPreview {
  snapped: HoldSnapResult
  pulseAt: number
  anchorX: number
  anchorY: number
}

/**
 * Manages the 350ms / 4px dwell timer for offline Hold-to-Snap in Pen mode,
 * running RDP + geometric classification off the main thread in a Web Worker.
 */
export function useHoldToSnap(
  getExistingShapes: () => ShapeNode[],
  onPreviewChange?: () => void
): {
  previewRef: React.MutableRefObject<HoldSnapPreview | null>
  onStrokePoint: (pt: InkPoint, getAllPoints: () => InkPoint[]) => void
  consumeSnappedPreview: () => HoldSnapResult | null
  resetHoldSnap: () => void
} {
  const workerRef = useRef<Worker | null>(null)
  const reqIdRef = useRef(0)
  const timerRef = useRef<number | null>(null)
  const anchorPtRef = useRef<{ x: number; y: number } | null>(null)
  const previewRef = useRef<HoldSnapPreview | null>(null)
  const shapesGetterRef = useRef(getExistingShapes)
  const previewCbRef = useRef(onPreviewChange)

  useEffect(() => {
    shapesGetterRef.current = getExistingShapes
    previewCbRef.current = onPreviewChange
  }, [getExistingShapes, onPreviewChange])

  useEffect(() => {
    try {
      const worker = new Worker(new URL('../workers/shapeSnap.worker.ts', import.meta.url), {
        type: 'module'
      })
      worker.onmessage = (e: MessageEvent<ShapeSnapWorkerResponse>) => {
        if (e.data.reqId !== reqIdRef.current) return
        if (e.data.result) {
          const snapped = snapConnectorToShapeAnchors(e.data.result, shapesGetterRef.current())
          const a = anchorPtRef.current
          previewRef.current = {
            snapped,
            pulseAt: performance.now(),
            anchorX: a?.x ?? snapped.x,
            anchorY: a?.y ?? snapped.y
          }
          previewCbRef.current?.()
        }
      }
      workerRef.current = worker
      return () => {
        worker.terminate()
        workerRef.current = null
      }
    } catch {
      return undefined
    }
  }, [])

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const resetHoldSnap = useCallback(() => {
    clearTimer()
    reqIdRef.current += 1
    anchorPtRef.current = null
    previewRef.current = null
  }, [clearTimer])

  const onStrokePoint = useCallback(
    (pt: InkPoint, getAllPoints: () => InkPoint[]) => {
      const curAnchor = anchorPtRef.current
      if (curAnchor && Math.hypot(pt[0] - curAnchor.x, pt[1] - curAnchor.y) <= HOLD_RADIUS_PX) {
        // Still dwelling within 4px radius — let the running 350ms timer fire!
        return
      }

      // Pointer moved outside 4px radius: cancel any engaged snap preview & restart 350ms dwell timer
      previewRef.current = null
      anchorPtRef.current = { x: pt[0], y: pt[1] }
      clearTimer()

      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        const allPts = getAllPoints()
        if (allPts.length < 4) return
        const reqId = ++reqIdRef.current
        if (workerRef.current) {
          workerRef.current.postMessage({ reqId, points: allPts })
        } else {
          const syncRes = classifyHoldStroke(allPts)
          if (syncRes && reqId === reqIdRef.current) {
            const snapped = snapConnectorToShapeAnchors(syncRes, shapesGetterRef.current())
            previewRef.current = {
              snapped,
              pulseAt: performance.now(),
              anchorX: pt[0],
              anchorY: pt[1]
            }
            previewCbRef.current?.()
          }
        }
      }, HOLD_DWELL_MS)
    },
    [clearTimer]
  )

  const consumeSnappedPreview = useCallback((): HoldSnapResult | null => {
    clearTimer()
    const res = previewRef.current?.snapped ?? null
    anchorPtRef.current = null
    previewRef.current = null
    reqIdRef.current += 1
    return res
  }, [clearTimer])

  useEffect(() => {
    return () => {
      clearTimer()
    }
  }, [clearTimer])

  return {
    previewRef,
    onStrokePoint,
    consumeSnappedPreview,
    resetHoldSnap
  }
}
