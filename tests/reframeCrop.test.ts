import { expect, test } from 'bun:test'
import { computeCropRect, focusFromBox } from '../src/reframe/crop'
import { ASPECT_9_16 } from '../src/reframe/constants'

const HD: { readonly width: number; readonly height: number } = { width: 1920, height: 1080 }

test('computeCropRect crops a centered 16:9 source to the largest 9:16 window (height-bound)', () => {
  const rect = computeCropRect(HD, ASPECT_9_16, { x: 0.5, y: 0.5 })
  // 9:16 window inside 1920x1080 is height-bound: width = 1080 * 9/16 = 607.5, height = 1080
  expect(rect).toEqual({ x: 656.25, y: 0, width: 607.5, height: 1080 })
})

test('computeCropRect window has exactly the target aspect ratio', () => {
  const rect = computeCropRect(HD, ASPECT_9_16, { x: 0.5, y: 0.5 })
  expect(rect.width / rect.height).toBeCloseTo(ASPECT_9_16, 10)
})

test('computeCropRect clamps to the left edge when focus is at x=0', () => {
  const rect = computeCropRect(HD, ASPECT_9_16, { x: 0, y: 0.5 })
  expect(rect.x).toBe(0)
  expect(rect.width).toBe(607.5)
})

test('computeCropRect clamps to the right edge when focus is at x=1', () => {
  const rect = computeCropRect(HD, ASPECT_9_16, { x: 1, y: 0.5 })
  // max x = 1920 - 607.5 = 1312.5
  expect(rect.x).toBe(1312.5)
})

test('computeCropRect with zoom=2 halves window dimensions and centers on focus', () => {
  const rect = computeCropRect(HD, ASPECT_9_16, { x: 0.5, y: 0.5 }, 2)
  expect(rect.width).toBe(303.75)
  expect(rect.height).toBe(540)
  expect(rect.x).toBe(808.125)
  expect(rect.y).toBe(270)
})

test('computeCropRect is height-bound for a square source', () => {
  const rect = computeCropRect({ width: 1000, height: 1000 }, ASPECT_9_16, { x: 0.5, y: 0.5 })
  expect(rect).toEqual({ x: 218.75, y: 0, width: 562.5, height: 1000 })
})

test('computeCropRect is width-bound when the target is wider than the source', () => {
  // portrait source, landscape target 16:9 — width-bound: width = 1080, height = 1080 / (16/9) = 607.5
  const rect = computeCropRect({ width: 1080, height: 1920 }, 16 / 9, { x: 0.5, y: 0.5 })
  expect(rect.width).toBe(1080)
  expect(rect.height).toBe(607.5)
  expect(rect.x).toBe(0)
  expect(rect.y).toBe(656.25)
})

test('computeCropRect returns the full frame when source already matches the target aspect', () => {
  const rect = computeCropRect({ width: 1080, height: 1920 }, ASPECT_9_16, { x: 0.5, y: 0.5 })
  expect(rect).toEqual({ x: 0, y: 0, width: 1080, height: 1920 })
})

test('computeCropRect is deterministic for identical inputs', () => {
  const a = computeCropRect(HD, ASPECT_9_16, { x: 0.37, y: 0.62 }, 1.5)
  const b = computeCropRect(HD, ASPECT_9_16, { x: 0.37, y: 0.62 }, 1.5)
  expect(a).toEqual(b)
})

test('computeCropRect throws on non-positive source dimensions', () => {
  expect(() => computeCropRect({ width: 0, height: 1080 }, ASPECT_9_16, { x: 0.5, y: 0.5 })).toThrow()
  expect(() => computeCropRect({ width: 1920, height: -1 }, ASPECT_9_16, { x: 0.5, y: 0.5 })).toThrow()
})

test('computeCropRect throws on a non-positive target aspect', () => {
  expect(() => computeCropRect(HD, 0, { x: 0.5, y: 0.5 })).toThrow()
})

test('computeCropRect throws when zoom is below 1 (window cannot exceed the frame)', () => {
  expect(() => computeCropRect(HD, ASPECT_9_16, { x: 0.5, y: 0.5 }, 0.5)).toThrow()
})

test('computeCropRect throws on a non-finite focus', () => {
  expect(() => computeCropRect(HD, ASPECT_9_16, { x: Number.NaN, y: 0.5 })).toThrow()
})

test('focusFromBox returns the normalized center of a detected box, clamped to [0,1]', () => {
  // a face box spanning x:[768,1152], y:[270,540] in a 1920x1080 frame → center (0.5, 0.375)
  const focus = focusFromBox({ x: 768, y: 270, width: 384, height: 270 }, HD)
  expect(focus.x).toBeCloseTo(0.5, 10)
  expect(focus.y).toBeCloseTo(0.375, 10)
})

test('focusFromBox clamps a box centered outside the frame back into [0,1]', () => {
  const focus = focusFromBox({ x: 1900, y: 1070, width: 200, height: 200 }, HD)
  expect(focus.x).toBe(1)
  expect(focus.y).toBe(1)
})

test('focusFromBox throws on non-finite source dimensions', () => {
  expect(() =>
    focusFromBox({ x: 100, y: 100, width: 200, height: 200 }, { width: Number.NaN, height: 1080 }),
  ).toThrow()
})

test('computeCropRect throws when zoom shrinks the window below one pixel', () => {
  expect(() => computeCropRect(HD, ASPECT_9_16, { x: 0.5, y: 0.5 }, 5000)).toThrow()
})
