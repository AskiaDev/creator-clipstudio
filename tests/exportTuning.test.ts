import { describe, expect, test } from 'bun:test'
import { type TuningInput, planExportTuning } from '../src/render/exportTuning'

const at = (input: TuningInput) => planExportTuning(input)

describe('planExportTuning — keyframe interval (-g, frames)', () => {
  test('scales with fps × mode seconds and stays integer', () => {
    expect(at({ width: 1920, height: 1080, fps: 30, mode: 'balanced' }).keyint).toBe(90) // 30 × 3
    expect(at({ width: 1920, height: 1080, fps: 30, mode: 'fast' }).keyint).toBe(120) // 30 × 4
    expect(at({ width: 1920, height: 1080, fps: 60, mode: 'quality' }).keyint).toBe(150) // 60 × 2.5
  })

  test('never drops below 1 frame', () => {
    expect(at({ width: 320, height: 240, fps: 1, mode: 'quality' }).keyint).toBeGreaterThanOrEqual(1)
  })
})

describe('planExportTuning — backpressure queue limit', () => {
  test('targets fps × mode seconds, clamped to the mode band (exposed)', () => {
    const slow = at({ width: 1920, height: 1080, fps: 30, mode: 'balanced' })
    expect(slow.queueLimit).toBe(72) // round(60) raised to MIN 72
    expect(slow.clamps.queueRaisedToMin).toBe(true)

    const mid = at({ width: 1920, height: 1080, fps: 60, mode: 'balanced' })
    expect(mid.queueLimit).toBe(120) // round(120) within band

    const fast = at({ width: 1920, height: 1080, fps: 120, mode: 'balanced' })
    expect(fast.queueLimit).toBe(120) // round(240) lowered to MAX 120
    expect(fast.clamps.queueLoweredToMax).toBe(true)
  })
})

describe('planExportTuning — relative pixel rate (workload metric)', () => {
  test('is 1.0 at the 720p60 baseline and scales with pixels × fps', () => {
    expect(at({ width: 1280, height: 720, fps: 60 }).relativePixelRate).toBeCloseTo(1.0, 6)
    expect(at({ width: 3840, height: 2160, fps: 30 }).relativePixelRate).toBeCloseTo(4.5, 6)
  })
})

describe('planExportTuning — concurrency profile', () => {
  test('high-core light workload picks balanced-plus (8)', () => {
    const plan = at({ width: 1280, height: 720, fps: 60, hardwareConcurrency: 8 })
    expect(plan.profile).toBe('balanced-plus')
    expect(plan.concurrency).toBe(8)
  })

  test('extreme 4K workload falls back to conservative (2) even on many cores', () => {
    const plan = at({ width: 3840, height: 2160, fps: 30, hardwareConcurrency: 16 })
    expect(plan.profile).toBe('conservative')
    expect(plan.concurrency).toBe(2)
  })

  test('low-core machine is conservative and concurrency is limited by cores (exposed)', () => {
    const plan = at({ width: 1280, height: 720, fps: 60, hardwareConcurrency: 1 })
    expect(plan.profile).toBe('conservative')
    expect(plan.concurrency).toBe(1) // min(2, 1 core)
    expect(plan.clamps.concurrencyLimitedByCores).toBe(true)
  })

  test('mid-core heavy (not extreme) workload picks balanced (4)', () => {
    const plan = at({ width: 1920, height: 1080, fps: 60, hardwareConcurrency: 6 })
    expect(plan.profile).toBe('balanced')
    expect(plan.concurrency).toBe(4)
  })

  test('hardwareConcurrency defaults to 8 when omitted', () => {
    const omitted = at({ width: 1280, height: 720, fps: 60 })
    const explicit = at({ width: 1280, height: 720, fps: 60, hardwareConcurrency: 8 })
    expect(omitted).toEqual(explicit)
  })
})

describe('planExportTuning — chunk size (GOP-aligned seconds)', () => {
  test('light workload uses the full base chunk, GOP-aligned', () => {
    const plan = at({ width: 1280, height: 720, fps: 60, mode: 'balanced' })
    expect(plan.chunkSeconds).toBe(60) // 60s base, 20 GOPs × 3s
    expect(plan.clamps.chunkRaisedToMin).toBe(false)
  })

  test('heavier 4K workload shortens the chunk', () => {
    const hd = at({ width: 1280, height: 720, fps: 60, mode: 'balanced' }).chunkSeconds
    const uhd = at({ width: 3840, height: 2160, fps: 30, mode: 'balanced' }).chunkSeconds
    expect(uhd).toBeLessThan(hd)
    expect(uhd).toBe(12) // 60/4.5≈13.3s → round(13.3/3)=4 GOPs × 3s = 12s
  })

  test('extreme workload raises the chunk target to the minimum, GOP-aligned (exposed)', () => {
    const plan = at({ width: 7680, height: 4320, fps: 60, mode: 'balanced' })
    expect(plan.clamps.chunkRaisedToMin).toBe(true)
    expect(plan.chunkSeconds).toBe(9) // raw 1.67s → min 10s → round(10/3)=3 GOPs × 3s = 9s (alignment wins)
  })

  test('chunk length is a whole multiple of the keyframe interval seconds', () => {
    const fps = 30
    for (const mode of ['fast', 'balanced', 'quality'] as const) {
      const plan = at({ width: 3840, height: 2160, fps, mode })
      const keyintSeconds = plan.keyint / fps
      expect(plan.chunkSeconds % keyintSeconds).toBeCloseTo(0, 6)
    }
  })
})

describe('planExportTuning — invariants', () => {
  test('mode defaults to balanced when omitted', () => {
    const omitted = at({ width: 1920, height: 1080, fps: 30 })
    const explicit = at({ width: 1920, height: 1080, fps: 30, mode: 'balanced' })
    expect(omitted).toEqual(explicit)
  })

  test('is deterministic for identical input', () => {
    const input = { width: 2560, height: 1440, fps: 48, mode: 'quality', hardwareConcurrency: 10 } as const
    expect(at(input)).toEqual(at(input))
  })

  test('keyint, queueLimit, and concurrency are integers', () => {
    const plan = at({ width: 1920, height: 1080, fps: 30, mode: 'quality' })
    expect(Number.isInteger(plan.keyint)).toBe(true)
    expect(Number.isInteger(plan.queueLimit)).toBe(true)
    expect(Number.isInteger(plan.concurrency)).toBe(true)
  })

  test('a non-finite hardwareConcurrency falls back to the default (lenient)', () => {
    const fallback = at({ width: 1280, height: 720, fps: 60, hardwareConcurrency: Number.NaN })
    const explicit = at({ width: 1280, height: 720, fps: 60, hardwareConcurrency: 8 })
    expect(fallback).toEqual(explicit)
  })
})

describe('planExportTuning — input validation', () => {
  test.each([
    ['zero width', { width: 0, height: 1080, fps: 30 }],
    ['negative height', { width: 1920, height: -1, fps: 30 }],
    ['NaN fps', { width: 1920, height: 1080, fps: Number.NaN }],
    ['zero fps', { width: 1920, height: 1080, fps: 0 }],
    ['Infinity width', { width: Number.POSITIVE_INFINITY, height: 1080, fps: 30 }],
  ])('throws on %s', (_label, input) => {
    expect(() => planExportTuning(input)).toThrow(RangeError)
  })
})
