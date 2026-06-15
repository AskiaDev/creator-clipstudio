/**
 * Bridge from a reframe *request* to a pure FFmpeg `crop=` filter string, given the probed source size.
 *
 * The heavy geometry lives in `src/reframe` (pure, tested in isolation); this module only picks the
 * static-vs-keyframe path and applies the 9:16 default. `runRender` calls this AFTER ffprobe (it needs
 * the real source dimensions) and threads the result into `RenderSpec.reframeCrop`; `buildFiltergraph`
 * prepends it to the `[0:v]` chain. Absent reframe → no crop → byte-identical filtergraph.
 */

import {
  ASPECT_9_16,
  buildCropExpr,
  buildCropZoompanExpr,
  computeCropRect,
  cropRectsAtKeyframes,
  cropRectsOverTime,
  type Keyframe,
  type Point,
  type Size,
} from '../reframe'

/** Reframe by a single static focus — the dominant face-crop case. */
export interface StaticReframe {
  /** Normalized focus (0..1 across the source frame) the 9:16 window centers on. */
  readonly focus: Point
  /** Magnification `>= 1`; defaults to 1 (largest target-aspect window). */
  readonly zoom?: number
  /** Target aspect (width / height); defaults to 9:16. */
  readonly targetAspect?: number
  /** Excluded so `{ focus, keyframes }` can't type-check as static and then mis-dispatch as keyframed. */
  readonly keyframes?: never
}

/** Reframe by time-varying focus/zoom keyframes — a moving subject → piecewise-linear `crop`. */
export interface KeyframeReframe {
  readonly keyframes: readonly Keyframe[]
  /** Dense eased sampling fps; omit for one compact segment per keyframe. */
  readonly fps?: number
  readonly targetAspect?: number
  /** Excluded so the discriminated union stays unambiguous (see {@link StaticReframe.keyframes}). */
  readonly focus?: never
}

export type ReframeRequest = StaticReframe | KeyframeReframe

/**
 * Build the reframe `crop=` filter for a `source`-sized video. Pure. Throws (via `computeCropRect`) on
 * invalid geometry — non-finite/out-of-range focus, `zoom < 1`, or a sub-pixel window — so the caller
 * can surface it as a typed failure instead of emitting a broken filtergraph.
 */
function isKeyframeReframe(reframe: ReframeRequest): reframe is KeyframeReframe {
  return reframe.keyframes !== undefined
}

export function reframeCropExpr(reframe: ReframeRequest, source: Size): string {
  const targetAspect = reframe.targetAspect ?? ASPECT_9_16
  if (isKeyframeReframe(reframe)) {
    const rects =
      reframe.fps != null
        ? cropRectsOverTime(source, targetAspect, reframe.keyframes, { fps: reframe.fps })
        : cropRectsAtKeyframes(source, targetAspect, reframe.keyframes)
    return buildCropZoompanExpr(rects)
  }
  return buildCropExpr(computeCropRect(source, targetAspect, reframe.focus, reframe.zoom))
}
