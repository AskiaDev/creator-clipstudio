import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { probeVideo, type RenderRequest, renderClip } from '../../src/render/runRender'

const FIXTURE = join(import.meta.dir, '..', 'fixtures', 'sample-16x9.mp4')
const WORK_DIR = mkdtempSync(join(tmpdir(), 'cc-golden-reframe-'))
afterAll(() => rmSync(WORK_DIR, { recursive: true, force: true }))

const GOLDEN_TIMEOUT_MS = 60_000

describe('golden reframe render (real ffmpeg)', () => {
  test(
    'reframes a 16:9 source into a 1080x1920 MP4 (crop prepended, real encode)',
    async () => {
      // Arrange — full-canvas region so the reframed 9:16 window fills the output.
      const output = join(WORK_DIR, 'reframed_reel.mp4')
      const request: RenderRequest = {
        videoInput: FIXTURE,
        output,
        canvas: { width: 1080, height: 1920 },
        region: { x: 0, y: 0, width: 1080, height: 1920 },
        fit: 'cover',
        background: '0x000000',
        crf: 20,
        overlay: { title: 'Reframe', subtitle: '16:9 -> 9:16', watermark: '@creatorclip' },
        reframe: { focus: { x: 0.5, y: 0.5 } },
      }

      // Act — a malformed reframe crop would make ffmpeg fail; success proves the graph composes.
      const result = await renderClip(request)
      expect(result.ok).toBe(true)
      if (!result.ok) return

      // Assert — ffprobe the OUTPUT: the vertical 9:16 canvas.
      const probed = await probeVideo(output)
      expect(probed.ok).toBe(true)
      if (!probed.ok) return
      expect(probed.data.width).toBe(1080)
      expect(probed.data.height).toBe(1920)
    },
    GOLDEN_TIMEOUT_MS,
  )
})
