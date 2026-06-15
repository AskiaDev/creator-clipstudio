/**
 * Time-varying crop: turn focus keyframes into a timeline of crop rectangles.
 *
 * - {@link cropRectsOverTime} bakes a dense, eased per-frame timeline (best for frame-accurate crops).
 * - {@link cropRectsAtKeyframes} returns one rect per keyframe (compact; feed to `buildCropZoompanExpr`
 *   for a short piecewise-linear expression).
 *
 * Pure math — no ffmpeg, no render wiring.
 */

import { DEFAULT_TIMELINE_FPS } from './constants'
import { computeCropRect } from './crop'
import { easeInOutCubic } from './easing'
import { interpolateKeyframes } from './interpolate'
import { assertFinite } from './math'
import type { EasingFn, Keyframe, RectAtTime, Size } from './types'

/** Options for {@link cropRectsOverTime}. */
export interface TimelineOptions {
  /** Sampling rate in frames per second (default {@link DEFAULT_TIMELINE_FPS}). */
  readonly fps?: number
  /** Easing applied between keyframes (default cubic ease-in-out). */
  readonly easing?: EasingFn
}

function sortByTime(keyframes: readonly Keyframe[]): readonly Keyframe[] {
  // Validate before sorting: a NaN tSec would make the sort comparator non-deterministic.
  for (const keyframe of keyframes) {
    assertFinite(keyframe.tSec, 'keyframe.tSec')
  }
  return [...keyframes].sort((a, b) => a.tSec - b.tSec)
}

/**
 * Sample crop rectangles across the keyframe span at `fps`, easing focus/zoom between keyframes.
 *
 * Endpoints are inclusive: the first sample is at the first keyframe time and the last sample is exactly
 * at the last keyframe time. A single keyframe (or zero-duration span) yields one sample. The sample
 * count is `round((lastT - firstT) * fps)` segments — never silently capped.
 *
 * Intermediate samples sit on a uniform `1/fps` grid anchored at the first keyframe. When the span is
 * not an exact multiple of `1/fps`, the final interval (up to the pinned last sample) is shorter or
 * longer than the others; pass an `fps` that divides the span evenly if uniform spacing matters.
 */
export function cropRectsOverTime(
  source: Size,
  targetAspect: number,
  keyframes: readonly Keyframe[],
  options: TimelineOptions = {},
): readonly RectAtTime[] {
  if (keyframes.length === 0) {
    throw new Error('reframe: cropRectsOverTime requires at least one keyframe')
  }

  const fps = options.fps ?? DEFAULT_TIMELINE_FPS
  assertFinite(fps, 'fps')
  if (fps <= 0) {
    throw new Error(`reframe: fps must be positive (got ${fps})`)
  }

  const easing = options.easing ?? easeInOutCubic
  const sorted = sortByTime(keyframes)
  const firstT = sorted[0].tSec
  const lastT = sorted[sorted.length - 1].tSec

  const sampleAt = (tSec: number): RectAtTime => {
    const { focus, zoom } = interpolateKeyframes(sorted, tSec, easing)
    return { tSec, rect: computeCropRect(source, targetAspect, focus, zoom) }
  }

  if (lastT <= firstT) {
    return [sampleAt(firstT)]
  }

  const segments = Math.round((lastT - firstT) * fps)
  const out: RectAtTime[] = []
  for (let i = 0; i <= segments; i += 1) {
    // Pin the final sample exactly to lastT (avoids float drift at the end).
    const tSec = i === segments ? lastT : firstT + i / fps
    out.push(sampleAt(tSec))
  }
  return out
}

/**
 * Compute one crop rectangle per keyframe (sorted by time, no densification). Pair with
 * {@link buildCropZoompanExpr} for a compact piecewise-linear ffmpeg expression.
 */
export function cropRectsAtKeyframes(
  source: Size,
  targetAspect: number,
  keyframes: readonly Keyframe[],
): readonly RectAtTime[] {
  if (keyframes.length === 0) {
    throw new Error('reframe: cropRectsAtKeyframes requires at least one keyframe')
  }

  return sortByTime(keyframes).map((keyframe) => ({
    tSec: keyframe.tSec,
    rect: computeCropRect(source, targetAspect, keyframe.focus, keyframe.zoom ?? 1),
  }))
}
