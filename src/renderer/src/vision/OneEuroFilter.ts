/**
 * 1€ Filter — speed-adaptive low-pass filter (Casiez, Roussel & Vogel, CHI 2012).
 * Low speed => heavy smoothing (kills webcam jitter); high speed => low lag.
 */
class LowPass {
  private y: number | null = null
  private s: number | null = null

  filter(value: number, alpha: number): number {
    if (this.y === null || this.s === null) {
      this.y = value
      this.s = value
    } else {
      this.s = alpha * value + (1 - alpha) * this.s
    }
    this.y = value
    return this.s
  }

  last(): number | null {
    return this.y
  }

  lastFiltered(): number | null {
    return this.s
  }

  reset(): void {
    this.y = null
    this.s = null
  }
}

export class OneEuroFilter {
  private x = new LowPass()
  private dx = new LowPass()
  private lastTime: number | null = null

  constructor(
    public minCutoff = 1.1,
    public beta = 0.009,
    public dCutoff = 1.0
  ) {}

  private static alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff)
    return 1 / (1 + tau / dt)
  }

  /** @param timestampMs monotonic time in milliseconds */
  filter(value: number, timestampMs: number): number {
    const prevFiltered = this.x.lastFiltered()
    let dt = this.lastTime === null ? 1 / 60 : (timestampMs - this.lastTime) / 1000
    if (dt <= 0 || !Number.isFinite(dt)) dt = 1 / 60
    this.lastTime = timestampMs

    const derivative = prevFiltered === null ? 0 : (value - prevFiltered) / dt
    const edx = this.dx.filter(derivative, OneEuroFilter.alpha(this.dCutoff, dt))
    const cutoff = this.minCutoff + this.beta * Math.abs(edx)
    return this.x.filter(value, OneEuroFilter.alpha(cutoff, dt))
  }

  reset(): void {
    this.x.reset()
    this.dx.reset()
    this.lastTime = null
  }
}

/** Convenience pair for 2D points */
export class OneEuroFilter2D {
  private fx: OneEuroFilter
  private fy: OneEuroFilter

  constructor(minCutoff = 1.1, beta = 0.009, dCutoff = 1.0) {
    this.fx = new OneEuroFilter(minCutoff, beta, dCutoff)
    this.fy = new OneEuroFilter(minCutoff, beta, dCutoff)
  }

  filter(x: number, y: number, timestampMs: number): { x: number; y: number } {
    return { x: this.fx.filter(x, timestampMs), y: this.fy.filter(y, timestampMs) }
  }

  reset(): void {
    this.fx.reset()
    this.fy.reset()
  }
}
