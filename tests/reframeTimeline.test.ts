import { expect, test } from 'bun:test'
import { ASPECT_9_16 } from '../src/reframe/constants'
import { linear } from '../src/reframe/easing'
import { cropRectsAtKeyframes, cropRectsOverTime } from '../src/reframe/timeline'
import type { Keyframe } from '../src/reframe/types'
import panFixture from './fixtures/reframe-pan.json'

const HD = { width: 1920, height: 1080 }

test('cropRectsOverTime returns a single sample for a single keyframe', () => {
  const rects = cropRectsOverTime(HD, ASPECT_9_16, [{ tSec: 4, focus: { x: 0.5, y: 0.5 } }])
  expect(rects.length).toBe(1)
  expect(rects[0].tSec).toBe(4)
  expect(rects[0].rect).toEqual({ x: 656.25, y: 0, width: 607.5, height: 1080 })
})

test('cropRectsOverTime samples at fps across the span with inclusive endpoints', () => {
  const kfs: readonly Keyframe[] = [
    { tSec: 0, focus: { x: 0, y: 0.5 } },
    { tSec: 1, focus: { x: 1, y: 0.5 } },
  ]
  const rects = cropRectsOverTime(HD, ASPECT_9_16, kfs, { fps: 30 })
  expect(rects.length).toBe(31) // i = 0..30
  expect(rects[0].tSec).toBe(0)
  expect(rects[rects.length - 1].tSec).toBe(1)
})

test('cropRectsOverTime honors a custom fps (no silent cap on sample count)', () => {
  const kfs: readonly Keyframe[] = [
    { tSec: 0, focus: { x: 0, y: 0.5 } },
    { tSec: 2, focus: { x: 1, y: 0.5 } },
  ]
  const rects = cropRectsOverTime(HD, ASPECT_9_16, kfs, { fps: 10 })
  expect(rects.length).toBe(21) // round((2-0)*10) = 20 → i = 0..20
})

test('cropRectsOverTime clamps the moving window to the frame edges and pans monotonically', () => {
  const kfs: readonly Keyframe[] = [
    { tSec: 0, focus: { x: 0, y: 0.5 } },
    { tSec: 1, focus: { x: 1, y: 0.5 } },
  ]
  const rects = cropRectsOverTime(HD, ASPECT_9_16, kfs, { fps: 2, easing: linear })
  expect(rects[0].rect.x).toBe(0) // clamped to the left edge
  expect(rects[rects.length - 1].rect.x).toBe(1312.5) // clamped to the right edge
  for (let i = 1; i < rects.length; i += 1) {
    expect(rects[i].rect.x).toBeGreaterThanOrEqual(rects[i - 1].rect.x)
  }
})

test('cropRectsOverTime matches the golden pan fixture (linear easing)', () => {
  const rects = cropRectsOverTime(panFixture.source, panFixture.targetAspect, panFixture.keyframes, {
    fps: panFixture.fps,
    easing: linear,
  })
  expect(rects).toEqual(panFixture.expected)
})

test('cropRectsOverTime is deterministic', () => {
  const kfs: readonly Keyframe[] = [
    { tSec: 0, focus: { x: 0.2, y: 0.4 }, zoom: 1 },
    { tSec: 3, focus: { x: 0.8, y: 0.6 }, zoom: 1.5 },
  ]
  const a = cropRectsOverTime(HD, ASPECT_9_16, kfs, { fps: 12 })
  const b = cropRectsOverTime(HD, ASPECT_9_16, kfs, { fps: 12 })
  expect(a).toEqual(b)
})

test('cropRectsOverTime throws on an empty keyframe list', () => {
  expect(() => cropRectsOverTime(HD, ASPECT_9_16, [])).toThrow()
})

test('cropRectsOverTime throws on a non-positive fps', () => {
  expect(() =>
    cropRectsOverTime(HD, ASPECT_9_16, [{ tSec: 0, focus: { x: 0.5, y: 0.5 } }], { fps: 0 }),
  ).toThrow()
})

test('cropRectsAtKeyframes returns one rect per keyframe, sorted by time', () => {
  const kfs: readonly Keyframe[] = [
    { tSec: 2, focus: { x: 0.75, y: 0.5 } },
    { tSec: 0, focus: { x: 0.25, y: 0.5 } },
  ]
  const rects = cropRectsAtKeyframes(HD, ASPECT_9_16, kfs)
  expect(rects.length).toBe(2)
  expect(rects[0].tSec).toBe(0)
  expect(rects[0].rect.x).toBe(176.25)
  expect(rects[1].tSec).toBe(2)
  expect(rects[1].rect.x).toBe(1136.25)
})
