import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { probeVideo, type RenderRequest, renderClip } from '../../src/render/runRender'

const FIXTURE = join(import.meta.dir, '..', 'fixtures', 'sample-16x9.mp4')
const WORK_DIR = mkdtempSync(join(tmpdir(), 'cc-golden-opt-'))
afterAll(() => rmSync(WORK_DIR, { recursive: true, force: true }))

const GOLDEN_TIMEOUT_MS = 60_000
const DURATION_TOLERANCE_SEC = 0.3

describe('golden render-opt (real ffmpeg, Phase 6)', () => {
  test(
    'render-opt (hwaccel where available + VBV bitrate) keeps dims/duration/audio correct',
    async () => {
      // Real deps: detect videotoolbox + use it where present (macOS), software-fallback elsewhere.
      // Either way the OUTPUT must stay correct — render-opt is a throughput change, not an output change.
      const output = join(WORK_DIR, 'opt_reel.mp4')
      const request: RenderRequest = {
        videoInput: FIXTURE,
        output,
        canvas: { width: 1080, height: 1920 },
        region: { x: 60, y: 460, width: 960, height: 1100 },
        fit: 'cover',
        background: '0x000000',
        crf: 20,
        overlay: { title: 'Opt', subtitle: 'hwaccel + VBV', watermark: '@creatorclip' },
        export: { tier: 'high' },
      }

      const result = await renderClip(request)
      expect(result.ok).toBe(true)
      if (!result.ok) return

      const probed = await probeVideo(output)
      expect(probed.ok).toBe(true)
      if (!probed.ok) return
      expect(probed.data.width).toBe(1080)
      expect(probed.data.height).toBe(1920)
      expect(probed.data.hasAudio).toBe(true)
      expect(Math.abs(probed.data.durationSec - result.probe.durationSec)).toBeLessThan(DURATION_TOLERANCE_SEC)
    },
    GOLDEN_TIMEOUT_MS,
  )
})
