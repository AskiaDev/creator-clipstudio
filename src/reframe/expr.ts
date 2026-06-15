/**
 * Pure FFmpeg `crop` expression builders. These return strings only — the integrator (Wave 2) drops
 * them into the filtergraph. No ffmpeg is spawned here.
 *
 * A static crop is `crop=w:h:x:y`. A time-varying crop emits piecewise-linear expressions in `t`
 * (seconds) for whichever of `w/h/x/y` change, holding constant dimensions as plain integers. Pixels are
 * rounded to integers for a stable, valid filter string.
 */

import { assertFinite } from './math'
import type { Rect, RectAtTime } from './types'

interface IntRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

function assertFiniteRect(rect: Rect): void {
  assertFinite(rect.x, 'rect.x')
  assertFinite(rect.y, 'rect.y')
  assertFinite(rect.width, 'rect.width')
  assertFinite(rect.height, 'rect.height')
}

function roundRect(rect: Rect): IntRect {
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  }
}

function assertDrawable(rect: IntRect): void {
  if (rect.width <= 0 || rect.height <= 0) {
    throw new Error(`reframe: crop dimensions must be positive (got ${rect.width}x${rect.height})`)
  }
}

/** Format a number for an expression: integers stay integers, fractions trim to 6 decimals. */
function fmt(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)))
}

/** A single linear segment `(v0 ± |Δ| * (t - t0) / Δt)` from `(t0, v0)` to `(t1, v1)`. */
function segment(t0: number, v0: number, t1: number, v1: number): string {
  const dt = t1 - t0
  if (dt <= 0) {
    // Coincident sample times: step directly to the later value (never divide by zero).
    return fmt(v1)
  }
  const delta = v1 - v0
  if (delta === 0) {
    // Flat sub-span: emit the constant value, not a vacuous `+0*t` term.
    return fmt(v0)
  }
  const sign = delta > 0 ? '+' : '-'
  const magnitude = Math.abs(delta)
  const tTerm = t0 === 0 ? 't' : `(t-${fmt(t0)})`
  const divisor = dt === 1 ? '' : `/${fmt(dt)}`
  return `(${fmt(v0)}${sign}${fmt(magnitude)}*${tTerm}${divisor})`
}

/** Build a constant integer or a quoted piecewise-linear `t` expression for one dimension. */
function buildDimension(times: readonly number[], values: readonly number[]): string {
  if (values.every((v) => v === values[0])) {
    return fmt(values[0])
  }

  // Fold segments right-to-left; the deepest else-branch holds the final value.
  let expr = fmt(values[values.length - 1])
  for (let i = values.length - 2; i >= 0; i -= 1) {
    const seg = segment(times[i], values[i], times[i + 1], values[i + 1])
    expr = `if(lt(t,${fmt(times[i + 1])}),${seg},${expr})`
  }
  // Hold the first value for times before the timeline starts.
  if (times[0] > 0) {
    expr = `if(lt(t,${fmt(times[0])}),${fmt(values[0])},${expr})`
  }
  return `'${expr}'`
}

/** Build a static `crop=w:h:x:y` filter for one rectangle (pixels rounded to integers). */
export function buildCropExpr(rect: Rect): string {
  assertFiniteRect(rect)
  const r = roundRect(rect)
  assertDrawable(r)
  return `crop=${r.width}:${r.height}:${r.x}:${r.y}`
}

/**
 * Build a `crop` filter from a timeline of rectangles. Identical rectangles collapse to a static crop;
 * otherwise each changing dimension becomes a piecewise-linear expression in `t`. Samples are sorted by
 * time defensively, so the output is deterministic regardless of input order.
 */
export function buildCropZoompanExpr(rectsOverTime: readonly RectAtTime[]): string {
  if (rectsOverTime.length === 0) {
    throw new Error('reframe: buildCropZoompanExpr requires at least one rect')
  }

  const sorted = [...rectsOverTime].sort((a, b) => a.tSec - b.tSec)
  for (const { tSec, rect } of sorted) {
    assertFinite(tSec, 'rectAtTime.tSec')
    assertFiniteRect(rect)
  }

  const times = sorted.map((sample) => sample.tSec)
  const rects = sorted.map((sample) => roundRect(sample.rect))
  for (const rect of rects) {
    assertDrawable(rect)
  }

  const first = rects[0]
  const allEqual = rects.every(
    (r) => r.x === first.x && r.y === first.y && r.width === first.width && r.height === first.height,
  )
  if (allEqual) {
    return `crop=${first.width}:${first.height}:${first.x}:${first.y}`
  }

  const width = buildDimension(times, rects.map((r) => r.width))
  const height = buildDimension(times, rects.map((r) => r.height))
  const x = buildDimension(times, rects.map((r) => r.x))
  const y = buildDimension(times, rects.map((r) => r.y))
  return `crop=${width}:${height}:${x}:${y}`
}
