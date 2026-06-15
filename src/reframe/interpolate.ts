/**
 * Keyframe interpolation: resolve a focus point (and zoom) at an arbitrary time by easing between the
 * two bracketing keyframes. Ported from the focus-follow easing/holding behavior in Recordly's
 * `cursorFollowCamera.ts`, reduced to pure time→focus interpolation (no Pixi, no camera state machine).
 */

import { easeInOutCubic } from './easing'
import { assertFinite, lerp } from './math'
import type { EasingFn, Keyframe, Point } from './types'

/** The interpolated focus and zoom at one instant. */
export interface FocusSample {
  readonly focus: Point
  readonly zoom: number
}

function zoomOf(keyframe: Keyframe): number {
  return keyframe.zoom ?? 1
}

/**
 * Interpolate the focus/zoom at `tSec` across `keyframes`.
 *
 * Keyframes are sorted defensively by time. Times before the first keyframe hold the first value; times
 * after the last hold the last value (no extrapolation). Between two keyframes the normalized progress is
 * shaped by `easing` and applied to both focus and zoom.
 */
export function interpolateKeyframes(
  keyframes: readonly Keyframe[],
  tSec: number,
  easing: EasingFn = easeInOutCubic,
): FocusSample {
  assertFinite(tSec, 'tSec')
  if (keyframes.length === 0) {
    throw new Error('reframe: interpolateKeyframes requires at least one keyframe')
  }

  // Validate before sorting: a NaN tSec would make the sort comparator non-deterministic.
  for (const keyframe of keyframes) {
    assertFinite(keyframe.tSec, 'keyframe.tSec')
  }
  const sorted = [...keyframes].sort((a, b) => a.tSec - b.tSec)

  // Exact hit on a keyframe time → prefer the last among coincident keyframes (deterministic).
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    if (sorted[i].tSec === tSec) {
      return { focus: sorted[i].focus, zoom: zoomOf(sorted[i]) }
    }
  }

  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  if (tSec < first.tSec) {
    return { focus: first.focus, zoom: zoomOf(first) }
  }
  if (tSec > last.tSec) {
    return { focus: last.focus, zoom: zoomOf(last) }
  }

  // Find the bracketing pair [lo, hi] with lo.tSec <= tSec <= hi.tSec.
  let lo = first
  let hi = last
  for (let i = 0; i < sorted.length - 1; i += 1) {
    if (tSec >= sorted[i].tSec && tSec <= sorted[i + 1].tSec) {
      lo = sorted[i]
      hi = sorted[i + 1]
      break
    }
  }

  const span = hi.tSec - lo.tSec
  if (span <= 0) {
    // Coincident keyframe times: prefer the later value deterministically.
    return { focus: hi.focus, zoom: zoomOf(hi) }
  }

  const eased = easing((tSec - lo.tSec) / span)
  return {
    focus: {
      x: lerp(lo.focus.x, hi.focus.x, eased),
      y: lerp(lo.focus.y, hi.focus.y, eased),
    },
    zoom: lerp(zoomOf(lo), zoomOf(hi), eased),
  }
}
