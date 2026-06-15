/**
 * Core crop geometry: map a source size + target aspect + focus point to the crop rectangle.
 *
 * Ported (pure math only) from Recordly's `videoPlayback/zoomTransform.ts` (focus→stage mapping,
 * `clamp`) and `cursorFollowCamera.ts` (the visible-half-span clamping insight: the focus window must
 * stay fully inside the frame). No ffmpeg, no Pixi, no WebCodecs.
 */

import { assertFinite, clamp } from './math'
import type { Point, Rect, Size } from './types'

function assertValidInputs(source: Size, targetAspect: number, focus: Point, zoom: number): void {
  assertFinite(source.width, 'source.width')
  assertFinite(source.height, 'source.height')
  assertFinite(targetAspect, 'targetAspect')
  assertFinite(zoom, 'zoom')
  assertFinite(focus.x, 'focus.x')
  assertFinite(focus.y, 'focus.y')
  if (source.width <= 0 || source.height <= 0) {
    throw new Error(`reframe: source dimensions must be positive (got ${source.width}x${source.height})`)
  }
  if (targetAspect <= 0) {
    throw new Error(`reframe: targetAspect must be positive (got ${targetAspect})`)
  }
  if (zoom < 1) {
    throw new Error(`reframe: zoom must be >= 1 — the window cannot exceed the frame (got ${zoom})`)
  }
}

/**
 * Compute the crop rectangle (source pixels) for one focus point.
 *
 * At `zoom = 1` the window is the largest rectangle of `targetAspect` that fits inside `source`. Higher
 * `zoom` magnifies (a proportionally smaller window). The window is centered on `focus` and then clamped
 * so it stays fully inside the source frame.
 *
 * @param targetAspect Target aspect ratio as `width / height` (e.g. `9 / 16`).
 * @param focus Normalized focus point in `0..1`; out-of-range values clamp to the nearest edge.
 * @param zoom Magnification `>= 1` (default `1`).
 */
export function computeCropRect(source: Size, targetAspect: number, focus: Point, zoom = 1): Rect {
  assertValidInputs(source, targetAspect, focus, zoom)

  const sourceAspect = source.width / source.height
  // Largest target-aspect window that fits inside the source at zoom = 1.
  let width: number
  let height: number
  if (sourceAspect > targetAspect) {
    // Source is wider than the target → bound by height.
    height = source.height
    width = height * targetAspect
  } else {
    // Source is narrower than (or equal to) the target → bound by width.
    width = source.width
    height = width / targetAspect
  }

  width /= zoom
  height /= zoom

  if (width < 1 || height < 1) {
    throw new Error(
      `reframe: zoom ${zoom} shrinks the crop window below one pixel (${width}x${height}); reduce zoom`,
    )
  }

  // Center on the focus point, then clamp the window fully inside the frame.
  const x = clamp(focus.x * source.width - width / 2, 0, source.width - width)
  const y = clamp(focus.y * source.height - height / 2, 0, source.height - height)

  return { x, y, width, height }
}

/**
 * Face-crop heuristic seam: convert a detected box (source pixels) to a normalized focus point at the
 * box center, clamped to `0..1`. AV diarization / active-speaker tracking is an explicit non-goal — the
 * caller supplies the box (e.g. from a face detector).
 */
export function focusFromBox(box: Rect, source: Size): Point {
  assertFinite(box.x, 'box.x')
  assertFinite(box.y, 'box.y')
  assertFinite(box.width, 'box.width')
  assertFinite(box.height, 'box.height')
  assertFinite(source.width, 'source.width')
  assertFinite(source.height, 'source.height')
  if (source.width <= 0 || source.height <= 0) {
    throw new Error(`reframe: source dimensions must be positive (got ${source.width}x${source.height})`)
  }

  const cx = (box.x + box.width / 2) / source.width
  const cy = (box.y + box.height / 2) / source.height
  return { x: clamp(cx, 0, 1), y: clamp(cy, 0, 1) }
}
