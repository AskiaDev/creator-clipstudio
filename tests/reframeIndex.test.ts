import { expect, test } from 'bun:test'
import * as reframe from '../src/reframe'

test('reframe barrel exposes the public reframe API', () => {
  expect(typeof reframe.computeCropRect).toBe('function')
  expect(typeof reframe.focusFromBox).toBe('function')
  expect(typeof reframe.cropRectsOverTime).toBe('function')
  expect(typeof reframe.cropRectsAtKeyframes).toBe('function')
  expect(typeof reframe.interpolateKeyframes).toBe('function')
  expect(typeof reframe.buildCropExpr).toBe('function')
  expect(typeof reframe.buildCropZoompanExpr).toBe('function')
  expect(typeof reframe.easeInOutCubic).toBe('function')
  expect(typeof reframe.linear).toBe('function')
  expect(typeof reframe.smoothstep).toBe('function')
  expect(reframe.ASPECT_9_16).toBeCloseTo(0.5625, 12)
  expect(reframe.DEFAULT_TIMELINE_FPS).toBe(30)
})

test('reframe barrel composes end-to-end: keyframes → rects → ffmpeg crop expr', () => {
  const expr = reframe.buildCropZoompanExpr(
    reframe.cropRectsAtKeyframes({ width: 1920, height: 1080 }, reframe.ASPECT_9_16, [
      { tSec: 0, focus: { x: 0.25, y: 0.5 } },
      { tSec: 2, focus: { x: 0.75, y: 0.5 } },
    ]),
  )
  expect(expr.startsWith('crop=')).toBe(true)
})
