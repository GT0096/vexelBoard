/// <reference lib="webworker" />
import type { InkPoint } from '../types/board'
import { classifyHoldStroke, type HoldSnapResult } from '../board/holdSnapClassifier'

export interface ShapeSnapWorkerRequest {
  reqId: number
  points: InkPoint[]
}

export interface ShapeSnapWorkerResponse {
  reqId: number
  result: HoldSnapResult | null
}

self.onmessage = (event: MessageEvent<ShapeSnapWorkerRequest>): void => {
  const { reqId, points } = event.data
  try {
    const result = classifyHoldStroke(points)
    self.postMessage({ reqId, result } satisfies ShapeSnapWorkerResponse)
  } catch {
    self.postMessage({ reqId, result: null } satisfies ShapeSnapWorkerResponse)
  }
}
