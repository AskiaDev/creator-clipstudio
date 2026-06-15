/**
 * Auto-reframe focus math (Phase 4, pure core). Public barrel for the Wave-2 integrator.
 *
 * Pipeline: focus point(s) → crop rectangle(s) → FFmpeg `crop` expression string. No ffmpeg spawn, no
 * render wiring, no GPU/WebCodecs — the integrator drops the expression into the filtergraph.
 */

export { ASPECT_9_16, ASPECT_16_9, DEFAULT_TIMELINE_FPS } from './constants'
export { computeCropRect, focusFromBox } from './crop'
export { easeInOutCubic, linear, smoothstep } from './easing'
export { buildCropExpr, buildCropZoompanExpr } from './expr'
export { type FocusSample, interpolateKeyframes } from './interpolate'
export { clamp, lerp } from './math'
export { cropRectsAtKeyframes, cropRectsOverTime, type TimelineOptions } from './timeline'
export type { EasingFn, Keyframe, Point, Rect, RectAtTime, Size } from './types'
