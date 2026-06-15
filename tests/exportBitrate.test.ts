import { describe, expect, test } from 'bun:test'
import { type BitrateInput, planExportBitrate } from '../src/render/exportBitrate'

const at = (input: BitrateInput) => planExportBitrate(input)

describe('planExportBitrate — resolution scaling', () => {
  test('1080p30 high is the 20 Mbps anchor with derived VBV maxrate/bufsize', () => {
    const plan = at({ width: 1920, height: 1080, fps: 30, tier: 'high' })
    expect(plan.bitrate).toBe(20_000_000)
    expect(plan.maxrate).toBe(29_000_000) // 20M × 1.45
    expect(plan.bufsize).toBe(58_000_000) // maxrate × 2
    expect(plan.clamps).toEqual({ raisedToFloor: false, loweredToCap: false })
  })

  test('4K target bitrate exceeds 1080p at the same fps and tier', () => {
    const hd = at({ width: 1920, height: 1080, fps: 30, tier: 'high' })
    const uhd = at({ width: 3840, height: 2160, fps: 30, tier: 'high' })
    expect(uhd.bitrate).toBeGreaterThan(hd.bitrate)
  })

  test('4K30 high is raised to the resolution-scaled floor (exposed)', () => {
    const plan = at({ width: 3840, height: 2160, fps: 30, tier: 'high' })
    expect(plan.bitrate).toBe(32_000_000) // floor 16M × sqrt(4)=2
    expect(plan.clamps).toEqual({ raisedToFloor: true, loweredToCap: false })
  })

  test('720p30 high is raised to its floor and stays below the 1080p target', () => {
    const plan = at({ width: 1280, height: 720, fps: 30, tier: 'high' })
    expect(plan.bitrate).toBe(10_666_667) // floor 16M × sqrt(0.444)
    const hd = at({ width: 1920, height: 1080, fps: 30, tier: 'high' }).bitrate
    expect(plan.bitrate).toBeLessThan(hd)
    expect(plan.clamps).toEqual({ raisedToFloor: true, loweredToCap: false })
  })
})

describe('planExportBitrate — fps influence', () => {
  test('60fps scales target above 30fps via sqrt(fps/30)', () => {
    const p30 = at({ width: 1920, height: 1080, fps: 30, tier: 'high' })
    const p60 = at({ width: 1920, height: 1080, fps: 60, tier: 'high' })
    expect(p60.bitrate).toBeGreaterThan(p30.bitrate)
    expect(p60.bitrate).toBe(28_284_271) // round(20M × sqrt(2))
  })

  test('24fps and 30fps share a multiplier of 1 (sqrt clamped at 1)', () => {
    const p24 = at({ width: 1920, height: 1080, fps: 24, tier: 'high' })
    const p30 = at({ width: 1920, height: 1080, fps: 30, tier: 'high' })
    expect(p24.bitrate).toBe(p30.bitrate)
  })

  test('fps defaults to 30 when omitted', () => {
    const omitted = at({ width: 1920, height: 1080, tier: 'high' })
    const explicit = at({ width: 1920, height: 1080, fps: 30, tier: 'high' })
    expect(omitted).toEqual(explicit)
  })
})

describe('planExportBitrate — quality tiers', () => {
  test('tiers are monotonic non-increasing source ≥ high ≥ good ≥ low at 4K30', () => {
    const dims = { width: 3840, height: 2160, fps: 30 } as const
    const source = at({ ...dims, tier: 'source' }).bitrate
    const high = at({ ...dims, tier: 'high' }).bitrate
    const good = at({ ...dims, tier: 'good' }).bitrate
    const low = at({ ...dims, tier: 'low' }).bitrate
    expect(source).toBeGreaterThanOrEqual(high)
    expect(high).toBeGreaterThanOrEqual(good)
    expect(good).toBeGreaterThanOrEqual(low)
    expect(source).toBeGreaterThan(low)
  })

  test('low tier is lowered to its resolution-scaled cap (exposed)', () => {
    const plan = at({ width: 1920, height: 1080, fps: 30, tier: 'low' })
    expect(plan.bitrate).toBe(14_000_000) // cap 14M × sqrt(1)
    expect(plan.clamps).toEqual({ raisedToFloor: false, loweredToCap: true })
  })

  test('source 4K30 is lowered to its 72 Mbps cap (exposed)', () => {
    const plan = at({ width: 3840, height: 2160, fps: 30, tier: 'source' })
    expect(plan.bitrate).toBe(72_000_000) // cap 36M × sqrt(4)=2
    expect(plan.clamps).toEqual({ raisedToFloor: false, loweredToCap: true })
  })
})

describe('planExportBitrate — invariants', () => {
  test('is deterministic for identical input', () => {
    const input = { width: 2560, height: 1440, fps: 48, tier: 'good' } as const
    expect(at(input)).toEqual(at(input))
  })

  test('always emits integer bps with bufsize ≥ maxrate ≥ bitrate', () => {
    const plan = at({ width: 1280, height: 720, fps: 50, tier: 'good' })
    expect(Number.isInteger(plan.bitrate)).toBe(true)
    expect(Number.isInteger(plan.maxrate)).toBe(true)
    expect(Number.isInteger(plan.bufsize)).toBe(true)
    expect(plan.maxrate).toBeGreaterThanOrEqual(plan.bitrate)
    expect(plan.bufsize).toBeGreaterThanOrEqual(plan.maxrate)
  })

  test('never emits a target below the 2 Mbps MP4 floor', () => {
    const plan = at({ width: 16, height: 16, fps: 1, tier: 'low' })
    expect(plan.bitrate).toBeGreaterThanOrEqual(2_000_000)
  })
})

describe('planExportBitrate — input validation', () => {
  test.each([
    ['zero width', { width: 0, height: 1080, tier: 'high' as const }],
    ['negative height', { width: 1920, height: -1, tier: 'high' as const }],
    ['NaN width', { width: Number.NaN, height: 1080, tier: 'high' as const }],
    ['Infinity height', { width: 1920, height: Number.POSITIVE_INFINITY, tier: 'high' as const }],
    ['zero fps', { width: 1920, height: 1080, fps: 0, tier: 'high' as const }],
    ['negative fps', { width: 1920, height: 1080, fps: -30, tier: 'high' as const }],
  ])('throws on %s', (_label, input) => {
    expect(() => planExportBitrate(input)).toThrow(RangeError)
  })
})
