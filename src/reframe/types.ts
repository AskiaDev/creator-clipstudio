/**
 * Public geometry contract for the auto-reframe core (Phase 4, pure math).
 *
 * Everything here is plain numbers — no ffmpeg, no render wiring, no GPU/WebCodecs. The integrator
 * (Wave 2) consumes {@link Rect}s and the expression strings built from them. Pixel coordinates are
 * **source pixels** with the origin at the top-left; {@link Point} focus coordinates are **normalized**
 * `0..1` across the source frame.
 */

/** A pixel size (e.g. a source video resolution). */
export interface Size {
  readonly width: number
  readonly height: number
}

/** A normalized focus point in `0..1` across the source frame (face/active-speaker center). */
export interface Point {
  readonly x: number
  readonly y: number
}

/** An axis-aligned rectangle in source pixels (top-left origin). */
export interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** A focus (and optional zoom) sample at a point in time, in seconds. */
export interface Keyframe {
  readonly tSec: number
  readonly focus: Point
  /** Magnification `>= 1`. Defaults to `1` (largest target-aspect window) when omitted. */
  readonly zoom?: number
}

/** A computed crop rectangle at a point in time, in seconds. */
export interface RectAtTime {
  readonly tSec: number
  readonly rect: Rect
}

/** A pure easing function mapping progress `0..1` to eased progress `0..1`. */
export type EasingFn = (t: number) => number
