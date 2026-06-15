import { expect, test } from 'bun:test'
import { linear } from '../src/reframe/easing'
import { interpolateKeyframes } from '../src/reframe/interpolate'
import type { Keyframe } from '../src/reframe/types'

const PAN: readonly Keyframe[] = [
  { tSec: 0, focus: { x: 0, y: 0.5 }, zoom: 1 },
  { tSec: 10, focus: { x: 1, y: 0.5 }, zoom: 2 },
]

test('interpolateKeyframes returns the only keyframe when there is just one', () => {
  const result = interpolateKeyframes([{ tSec: 3, focus: { x: 0.3, y: 0.7 } }], 99)
  expect(result.focus).toEqual({ x: 0.3, y: 0.7 })
  expect(result.zoom).toBe(1) // zoom defaults to 1 when omitted
})

test('interpolateKeyframes holds the first keyframe before the timeline starts', () => {
  const result = interpolateKeyframes(PAN, -5, linear)
  expect(result.focus).toEqual({ x: 0, y: 0.5 })
  expect(result.zoom).toBe(1)
})

test('interpolateKeyframes holds the last keyframe after the timeline ends', () => {
  const result = interpolateKeyframes(PAN, 50, linear)
  expect(result.focus).toEqual({ x: 1, y: 0.5 })
  expect(result.zoom).toBe(2)
})

test('interpolateKeyframes linearly interpolates focus and zoom at the midpoint', () => {
  const result = interpolateKeyframes(PAN, 5, linear)
  expect(result.focus.x).toBeCloseTo(0.5, 12)
  expect(result.zoom).toBeCloseTo(1.5, 12)
})

test('interpolateKeyframes applies easing between keyframes', () => {
  // easeInOutCubic(0.25) = 0.0625 → focus.x = lerp(0, 1, 0.0625)
  const result = interpolateKeyframes(PAN, 2.5)
  expect(result.focus.x).toBeCloseTo(0.0625, 12)
})

test('interpolateKeyframes returns the exact keyframe value at a keyframe time (tie)', () => {
  const kfs: readonly Keyframe[] = [
    { tSec: 0, focus: { x: 0, y: 0 } },
    { tSec: 5, focus: { x: 0.5, y: 0.5 } },
    { tSec: 10, focus: { x: 1, y: 1 } },
  ]
  const result = interpolateKeyframes(kfs, 5, linear)
  expect(result.focus).toEqual({ x: 0.5, y: 0.5 })
})

test('interpolateKeyframes sorts unsorted keyframes defensively', () => {
  const unsorted: readonly Keyframe[] = [
    { tSec: 10, focus: { x: 1, y: 0.5 }, zoom: 2 },
    { tSec: 0, focus: { x: 0, y: 0.5 }, zoom: 1 },
  ]
  const result = interpolateKeyframes(unsorted, 5, linear)
  expect(result.focus.x).toBeCloseTo(0.5, 12)
  expect(result.zoom).toBeCloseTo(1.5, 12)
})

test('interpolateKeyframes is deterministic', () => {
  const a = interpolateKeyframes(PAN, 3.3)
  const b = interpolateKeyframes(PAN, 3.3)
  expect(a).toEqual(b)
})

test('interpolateKeyframes throws on an empty keyframe list', () => {
  expect(() => interpolateKeyframes([], 0)).toThrow()
})

test('interpolateKeyframes throws on a non-finite query time', () => {
  expect(() => interpolateKeyframes(PAN, Number.NaN)).toThrow()
})

test('interpolateKeyframes returns the last value among 3+ coincident keyframes', () => {
  const kfs: readonly Keyframe[] = [
    { tSec: 5, focus: { x: 0, y: 0 } },
    { tSec: 5, focus: { x: 0.5, y: 0.5 } },
    { tSec: 5, focus: { x: 1, y: 1 } },
  ]
  const result = interpolateKeyframes(kfs, 5, linear)
  expect(result.focus).toEqual({ x: 1, y: 1 })
})
