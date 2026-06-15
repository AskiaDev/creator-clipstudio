/**
 * Pure easing functions for keyframe interpolation. Each maps progress `0..1` to eased progress `0..1`
 * and clamps out-of-range input. Ported from the easing/clamping spirit of Recordly's camera transitions
 * (`cursorFollowCamera.ts`), expressed here as plain functions.
 */

import { clamp } from './math'
import type { EasingFn } from './types'

/** Identity easing (constant velocity). */
export const linear: EasingFn = (t) => clamp(t, 0, 1)

/** Cubic ease-in-out: slow at both ends, symmetric about the midpoint. */
export const easeInOutCubic: EasingFn = (t) => {
  const p = clamp(t, 0, 1)
  return p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2
}

/** Hermite smoothstep `3t^2 - 2t^3`: gentle ease-in-out. */
export const smoothstep: EasingFn = (t) => {
  const p = clamp(t, 0, 1)
  return p * p * (3 - 2 * p)
}
