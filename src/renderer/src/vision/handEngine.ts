import {
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerResult,
  type NormalizedLandmark
} from '@mediapipe/tasks-vision'
import { OneEuroFilter2D } from './OneEuroFilter'
import type { Handedness } from '../types/board'

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const PINCH_ENTER_RATIO = 0.28
const PINCH_EXIT_RATIO = 0.42

const MP_VERSION = '1.1.1'
const LOCAL_WASM = './mediapipe/wasm'
const CDN_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`
const MODEL_PATH = './models/hand_landmarker.task'

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface Viewport {
  width: number
  height: number
  videoWidth: number
  videoHeight: number
  fit: 'cover' | 'stretch'
}

export interface HandInfo {
  handedness: 'Right' | 'Left'
  isPrimary: boolean
  indexX: number
  indexY: number
  thumbX: number
  thumbY: number
  pinchX: number
  pinchY: number
  isPinching: boolean
  pinchRatio: number
  skeleton: Array<{ x: number; y: number }>
}

export interface HandFrame {
  handsDetected: number
  primaryHand: HandInfo | null
  secondaryHand: HandInfo | null
  /** Primary hand index+thumb pinch state */
  isPinching: boolean
  pinchX: number
  pinchY: number
  /** Two-hand zoom gesture active when both hands are detected and pinching */
  isTwoHandZoom: boolean
  twoHandDistance: number
  twoHandMidX: number
  twoHandMidY: number
  twoHandDelta: number
  /** Left hand pinch for voice push-to-talk */
  leftHandPTT: boolean
  allSkeletons: Array<Array<{ x: number; y: number }>>
}

const EMPTY_FRAME: HandFrame = {
  handsDetected: 0,
  primaryHand: null,
  secondaryHand: null,
  isPinching: false,
  pinchX: 0,
  pinchY: 0,
  isTwoHandZoom: false,
  twoHandDistance: 0,
  twoHandMidX: 0,
  twoHandMidY: 0,
  twoHandDelta: 0,
  leftHandPTT: false,
  allSkeletons: []
}

/* ------------------------------------------------------------------ */
/* Geometry helpers                                                    */
/* ------------------------------------------------------------------ */

export function mapToViewport(lm: { x: number; y: number }, vp: Viewport): { x: number; y: number } {
  const { width: W, height: H, videoWidth: vw, videoHeight: vh } = vp
  if (vp.fit === 'stretch' || !vw || !vh) {
    return { x: (1 - lm.x) * W, y: lm.y * H }
  }
  const s = Math.max(W / vw, H / vh)
  const dw = vw * s
  const dh = vh * s
  return { x: (W - dw) / 2 + (1 - lm.x) * dw, y: (H - dh) / 2 + lm.y * dh }
}

function palmSpan(lm: NormalizedLandmark[]): number {
  const dx = lm[0].x - lm[9].x
  const dy = lm[0].y - lm[9].y
  return Math.sqrt(dx * dx + dy * dy) || 0.1
}

function pinchDistanceRatio(lm: NormalizedLandmark[]): number {
  const dx = lm[4].x - lm[8].x
  const dy = lm[4].y - lm[8].y
  const dPinch = Math.sqrt(dx * dx + dy * dy)
  return dPinch / palmSpan(lm)
}

/* ------------------------------------------------------------------ */
/* HandEngine                                                          */
/* ------------------------------------------------------------------ */

export class HandEngine {
  private landmarker: HandLandmarker | null = null
  private primaryFilter = new OneEuroFilter2D(60, 1.2, 0.015)
  private secondaryFilter = new OneEuroFilter2D(60, 1.2, 0.015)

  private primaryPinching = false
  private secondaryPinching = false

  private lastTwoHandDist = 0
  private lastProcessedTimestamp = -1

  public dominantHand: Handedness = 'right'

  public async init(): Promise<'GPU' | 'CPU'> {
    let wasmRoot = LOCAL_WASM
    let resolver: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>> | null = null
    try {
      resolver = await FilesetResolver.forVisionTasks(wasmRoot)
    } catch {
      wasmRoot = CDN_WASM
      resolver = await FilesetResolver.forVisionTasks(wasmRoot)
    }

    try {
      this.landmarker = await HandLandmarker.createFromOptions(resolver, {
        baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.55,
        minHandPresenceConfidence: 0.55,
        minTrackingConfidence: 0.55
      })
      return 'GPU'
    } catch {
      this.landmarker = await HandLandmarker.createFromOptions(resolver, {
        baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'CPU' },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5
      })
      return 'CPU'
    }
  }

  public process(video: HTMLVideoElement, timestampMs: number, vp: Viewport): HandFrame {
    if (!this.landmarker) return EMPTY_FRAME
    if (
      video.readyState < 2 ||
      !video.videoWidth ||
      !video.videoHeight ||
      video.paused ||
      video.ended
    ) {
      return EMPTY_FRAME
    }

    // MediaPipe VIDEO mode requires strictly monotonically increasing timestamps
    const ts =
      timestampMs <= this.lastProcessedTimestamp
        ? this.lastProcessedTimestamp + 1
        : timestampMs
    this.lastProcessedTimestamp = ts

    let result: HandLandmarkerResult
    try {
      result = this.landmarker.detectForVideo(video, ts)
    } catch {
      return EMPTY_FRAME
    }

    const { landmarks, handednesses } = result
    if (!landmarks || !landmarks.length) {
      this.primaryFilter.reset()
      this.secondaryFilter.reset()
      this.primaryPinching = false
      this.secondaryPinching = false
      this.lastTwoHandDist = 0
      return EMPTY_FRAME
    }

    const hands: HandInfo[] = []
    const allSkeletons: Array<Array<{ x: number; y: number }>> = []

    for (let i = 0; i < landmarks.length; i++) {
      const lm = landmarks[i]
      const hClass = handednesses?.[i]?.[0]?.categoryName ?? (i === 0 ? 'Right' : 'Left')
      // Mirrored view: MediaPipe's "Left" is the user's visible right hand in webcam selfie mode
      const isDominant =
        (this.dominantHand === 'right' && hClass === 'Left') ||
        (this.dominantHand === 'left' && hClass === 'Right')

      const skeleton = lm.map((pt) => mapToViewport(pt, vp))
      allSkeletons.push(skeleton)

      const indexPt = mapToViewport(lm[8], vp)
      const thumbPt = mapToViewport(lm[4], vp)
      const rawPinchX = (indexPt.x + thumbPt.x) / 2
      const rawPinchY = (indexPt.y + thumbPt.y) / 2

      const ratio = pinchDistanceRatio(lm)
      let pinching = isDominant ? this.primaryPinching : this.secondaryPinching
      if (pinching) {
        if (ratio > PINCH_EXIT_RATIO) pinching = false
      } else {
        if (ratio < PINCH_ENTER_RATIO) pinching = true
      }

      if (isDominant) {
        this.primaryPinching = pinching
      } else {
        this.secondaryPinching = pinching
      }

      const filter = isDominant ? this.primaryFilter : this.secondaryFilter
      const filteredPinch = filter.filter(rawPinchX, rawPinchY, timestampMs / 1000)

      hands.push({
        handedness: hClass as 'Right' | 'Left',
        isPrimary: isDominant,
        indexX: indexPt.x,
        indexY: indexPt.y,
        thumbX: thumbPt.x,
        thumbY: thumbPt.y,
        pinchX: filteredPinch.x,
        pinchY: filteredPinch.y,
        isPinching: pinching,
        pinchRatio: ratio,
        skeleton
      })
    }

    const primary = hands.find((h) => h.isPrimary) ?? hands[0]
    const secondary = hands.find((h) => h !== primary) ?? null

    // Two-Hand Zoom Detection:
    // When both hands are visible and either both are pinching or hands move apart/together
    let isTwoHandZoom = false
    let twoHandDistance = 0
    let twoHandMidX = 0
    let twoHandMidY = 0
    let twoHandDelta = 0

    if (primary && secondary) {
      // Measure distance between both hands' pinch points
      const dx = secondary.pinchX - primary.pinchX
      const dy = secondary.pinchY - primary.pinchY
      twoHandDistance = Math.sqrt(dx * dx + dy * dy)
      twoHandMidX = (primary.pinchX + secondary.pinchX) / 2
      twoHandMidY = (primary.pinchY + secondary.pinchY) / 2

      // Both hands pinching engages explicit zoom gesture
      if (primary.isPinching && secondary.isPinching) {
        isTwoHandZoom = true
        if (this.lastTwoHandDist > 0) {
          twoHandDelta = twoHandDistance - this.lastTwoHandDist
        }
        this.lastTwoHandDist = twoHandDistance
      } else {
        this.lastTwoHandDist = 0
      }
    } else {
      this.lastTwoHandDist = 0
    }

    // Left hand thumb-index pinch for Push-to-Talk (when not in two-hand zoom)
    const leftHandPTT = Boolean(secondary?.isPinching && !isTwoHandZoom)

    return {
      handsDetected: hands.length,
      primaryHand: primary,
      secondaryHand: secondary,
      isPinching: primary.isPinching && !isTwoHandZoom,
      pinchX: primary.pinchX,
      pinchY: primary.pinchY,
      isTwoHandZoom,
      twoHandDistance,
      twoHandMidX,
      twoHandMidY,
      twoHandDelta,
      leftHandPTT,
      allSkeletons
    }
  }

  public dispose(): void {
    if (this.landmarker) {
      this.landmarker.close()
      this.landmarker = null
    }
  }
}
