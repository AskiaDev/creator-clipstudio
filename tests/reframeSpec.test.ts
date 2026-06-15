import { describe, expect, test } from 'bun:test'
import { reframeCropExpr } from '../src/render/reframe'

describe('reframeCropExpr — request → ffmpeg crop string', () => {
  test('static focus on a 1920x1080 source → centered 9:16 crop', () => {
    expect(reframeCropExpr({ focus: { x: 0.5, y: 0.5 } }, { width: 1920, height: 1080 })).toBe('crop=608:1080:656:0')
  })

  test('static focus on the 640x360 sample → centered 9:16 crop', () => {
    expect(reframeCropExpr({ focus: { x: 0.5, y: 0.5 } }, { width: 640, height: 360 })).toBe('crop=203:360:219:0')
  })

  test('off-center focus shifts the crop x', () => {
    const centered = reframeCropExpr({ focus: { x: 0.5, y: 0.5 } }, { width: 1920, height: 1080 })
    const left = reframeCropExpr({ focus: { x: 0.2, y: 0.5 } }, { width: 1920, height: 1080 })
    expect(left).not.toBe(centered)
    expect(left.startsWith('crop=608:1080:')).toBe(true) // same window size, different x
  })

  test('zoom > 1 tightens the window (different from zoom 1)', () => {
    const z1 = reframeCropExpr({ focus: { x: 0.5, y: 0.5 } }, { width: 1920, height: 1080 })
    const z2 = reframeCropExpr({ focus: { x: 0.5, y: 0.5 }, zoom: 2 }, { width: 1920, height: 1080 })
    expect(z2).not.toBe(z1)
  })

  test('keyframes → time-varying (zoompan) crop; static focus stays constant', () => {
    const moving = reframeCropExpr(
      { keyframes: [
        { tSec: 0, focus: { x: 0.2, y: 0.5 } },
        { tSec: 2, focus: { x: 0.8, y: 0.5 } },
      ] },
      { width: 1920, height: 1080 },
    )
    expect(moving.startsWith('crop=')).toBe(true)
    expect(moving).toContain('t') // x is an expression in time t
    expect(reframeCropExpr({ focus: { x: 0.5, y: 0.5 } }, { width: 1920, height: 1080 })).not.toContain('t')
  })

  test('targetAspect defaults to 9:16 (explicit 9/16 matches the default)', () => {
    const def = reframeCropExpr({ focus: { x: 0.5, y: 0.5 } }, { width: 1920, height: 1080 })
    const explicit = reframeCropExpr({ focus: { x: 0.5, y: 0.5 }, targetAspect: 9 / 16 }, { width: 1920, height: 1080 })
    expect(def).toBe(explicit)
  })
})
