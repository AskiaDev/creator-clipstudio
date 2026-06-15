/**
 * Tiny shared numeric helpers for the reframe core. Pure, no dependencies.
 */

/** Clamp `value` into the inclusive range `[min, max]`. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Linear interpolation between `from` and `to` at parameter `t` (not clamped). */
export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t
}

/** Throw with a clear message if `value` is not a finite number. */
export function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`reframe: ${name} must be a finite number (got ${value})`)
  }
}
