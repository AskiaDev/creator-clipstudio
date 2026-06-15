import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { probeVideo, type RenderRequest, renderClip } from '../../src/render/runRender'

const FIXTURE = join(import.meta.dir, '..', 'fixtures', 'sample-16x9.mp4')
const WORK = mkdtempSync(join(tmpdir(), 'cc-golden-broll-'))
afterAll(() => rmSync(WORK, { recursive: true, force: true }))

const TIMEOUT = 60_000
const BROLL = join(WORK, 'broll-red.png')

beforeAll(() => {
  // A solid-red b-roll image; the cutaway filter scales it to cover the canvas, so the frame turns red.
  const mk = Bun.spawnSync(['ffmpeg', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=640x360', '-frames:v', '1', BROLL])
  if (mk.exitCode !== 0) throw new Error('failed to create the b-roll fixture')
})

/** Average RGB of one frame at `tSec` (frame-accurate output seek → 1x1 downscale → 3 raw bytes). */
function avgRgb(video: string, tSec: number): [number, number, number] {
  const p = Bun.spawnSync([
    'ffmpeg', '-i', video, '-ss', String(tSec), '-frames:v', '1',
    '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
  ])
  const b = p.stdout
  return [b[0] ?? 0, b[1] ?? 0, b[2] ?? 0]
}
const isRedDominant = (r: number, g: number, b: number): boolean => r > 120 && r > g + 40 && r > b + 40

describe('golden b-roll cutaway (real ffmpeg, Phase 5)', () => {
  test(
    'a cutaway is composited ONLY during its window (red mid-window, the gray source outside)',
    async () => {
      // The 1s sample averages a gray (~122,131,126); a red cutaway over [0.3,0.7] is unambiguous.
      const output = join(WORK, 'broll_reel.mp4')
      const request: RenderRequest = {
        videoInput: FIXTURE,
        output,
        canvas: { width: 1080, height: 1920 },
        region: { x: 0, y: 0, width: 1080, height: 1920 },
        fit: 'cover',
        background: '0x000000',
        crf: 20,
        overlay: { title: '', subtitle: '', watermark: '' },
        cutaways: [{ input: BROLL, startSec: 0.3, endSec: 0.7 }],
      }

      const result = await renderClip(request)
      expect(result.ok).toBe(true)
      if (!result.ok) return

      const probed = await probeVideo(output)
      expect(probed.ok).toBe(true)
      if (!probed.ok) return
      expect(probed.data.width).toBe(1080)
      expect(probed.data.height).toBe(1920)

      // Inside the window → the red cutaway dominates the frame.
      expect(isRedDominant(...avgRgb(output, 0.5))).toBe(true)
      // Outside the window → the cutaway is gone (the gray source, not red).
      expect(isRedDominant(...avgRgb(output, 0.05))).toBe(false)
    },
    TIMEOUT,
  )
})
