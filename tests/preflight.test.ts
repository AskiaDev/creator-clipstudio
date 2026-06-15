import { describe, expect, test } from 'bun:test'
import {
  preflight,
  REQUIRED_BINARIES,
  type BinaryResolver,
} from '../src/render/preflight'

/** Resolver where every binary is present. */
const allPresent: BinaryResolver = (binary) => `/opt/homebrew/bin/${binary}`

/** Resolver where exactly one named binary is missing. */
const missingOne =
  (absent: string): BinaryResolver =>
  (binary) =>
    binary === absent ? null : `/opt/homebrew/bin/${binary}`

describe('preflight', () => {
  test('succeeds and returns paths when ffmpeg and ffprobe both resolve', () => {
    const result = preflight(allPresent)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.binaries.ffmpeg).toBe('/opt/homebrew/bin/ffmpeg')
      expect(result.binaries.ffprobe).toBe('/opt/homebrew/bin/ffprobe')
    }
  })

  test('fails and names ffmpeg when ffmpeg is absent', () => {
    const result = preflight(missingOne('ffmpeg'))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.missing).toEqual(['ffmpeg'])
      expect(result.message).toContain('ffmpeg')
    }
  })

  test('fails and names ffprobe when ffprobe is absent', () => {
    const result = preflight(missingOne('ffprobe'))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.missing).toEqual(['ffprobe'])
      expect(result.message).toContain('ffprobe')
    }
  })

  test('reports every required binary when none resolve', () => {
    const result = preflight(() => null)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.missing).toEqual([...REQUIRED_BINARIES])
    }
  })

  test('default resolver finds the real ffmpeg and ffprobe in this environment', () => {
    // Exercises the real Bun.which path (both binaries are installed in dev/CI).
    const result = preflight()

    // Fail with an actionable message rather than a bare "false !== true" when the
    // host is missing FFmpeg, so an environment gap is never mistaken for a code bug.
    if (!result.ok) {
      throw new Error(`Expected ffmpeg and ffprobe on PATH. ${result.message}`)
    }
    expect(result.ok).toBe(true)
  })
})
