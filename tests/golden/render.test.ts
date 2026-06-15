import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type RenderRequest, probeVideo, renderClip } from '../../src/render/runRender'

const FIXTURE = join(import.meta.dir, '..', 'fixtures', 'sample-16x9.mp4')
const WORK_DIR = mkdtempSync(join(tmpdir(), 'cc-golden-'))
afterAll(() => rmSync(WORK_DIR, { recursive: true, force: true }))

const GOLDEN_TIMEOUT_MS = 60_000
const DURATION_TOLERANCE_SEC = 0.3

describe('golden render (real ffmpeg)', () => {
  test(
    'renders a 16:9 fixture into a 1080x1920 MP4 with audio and source-length duration',
    async () => {
      // Arrange — output into a nested dir to also prove parent-dir creation
      const output = join(WORK_DIR, '2026-06-15', 'acme', 'promo', 'sample_reel.mp4')
      const request: RenderRequest = {
        videoInput: FIXTURE,
        output,
        canvas: { width: 1080, height: 1920 },
        region: { x: 60, y: 460, width: 960, height: 1100 },
        fit: 'cover',
        background: '0x000000',
        crf: 20,
        overlay: { title: 'Golden Title', subtitle: 'rendered end to end', watermark: '@creatorclip' },
      }

      // Act
      const result = await renderClip(request)

      // Assert — render succeeded
      expect(result.ok).toBe(true)
      if (!result.ok) return

      // Assert — ffprobe the OUTPUT (not the helpers): vertical canvas, audio, duration ≈ source
      const probed = await probeVideo(output)
      expect(probed.ok).toBe(true)
      if (!probed.ok) return

      expect(probed.data.width).toBe(1080)
      expect(probed.data.height).toBe(1920)
      expect(probed.data.hasAudio).toBe(true)
      expect(Math.abs(probed.data.durationSec - result.probe.durationSec)).toBeLessThan(
        DURATION_TOLERANCE_SEC,
      )
    },
    GOLDEN_TIMEOUT_MS,
  )
})
