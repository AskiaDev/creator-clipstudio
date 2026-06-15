import { describe, expect, test } from 'bun:test'
import { describeExportPlan, planExport } from '../src/render/exportArgs'

describe('planExport — compose bitrate + tuning for an output resolution', () => {
  test('1080x1920 @ default tier/fps → 20 Mbps VBV + g=90', () => {
    expect(planExport({}, 1080, 1920).videoEncode).toEqual({
      bitrate: 20_000_000,
      maxrate: 29_000_000,
      bufsize: 58_000_000,
      keyint: 90,
    })
  })

  test('keyint follows fps and mode (quality keeps keyframes closer than balanced)', () => {
    expect(planExport({ fps: 60 }, 1080, 1920).videoEncode.keyint).toBe(180) // round(60*3)
    expect(planExport({ fps: 60, mode: 'quality' }, 1080, 1920).videoEncode.keyint).toBe(150) // round(60*2.5)
  })

  test('a 4K target scales the bitrate above 1080p', () => {
    const hd = planExport({ tier: 'high' }, 1920, 1080).videoEncode.bitrate
    const uhd = planExport({ tier: 'high' }, 3840, 2160).videoEncode.bitrate
    expect(uhd).toBeGreaterThan(hd)
  })

  test('describeExportPlan surfaces bitrate, keyint, profile, and marks chunking deferred', () => {
    const line = describeExportPlan(planExport({}, 1080, 1920))
    expect(line).toContain('[render-opt]')
    expect(line).toContain('20000k')
    expect(line).toContain('g=90')
    expect(line).toContain('profile=')
    expect(line).toContain('planned(deferred)') // chunk/concurrency/queue computed but not yet wired
  })

  test('a bitrate clamp is surfaced in the description (no silent caps)', () => {
    // 4K high raises the target to the resolution-scaled floor → reported, never silent.
    expect(describeExportPlan(planExport({ tier: 'high' }, 3840, 2160))).toContain('bitrate->floor')
  })
})
