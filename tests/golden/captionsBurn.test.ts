import { afterAll, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildAss } from '../../src/captions/ass'
import { buildFfmpegArgs, type RenderSpec } from '../../src/render/ffmpegArgs'
import fixture from '../fixtures/transcript-karaoke.json'

const SAMPLE = join(import.meta.dir, '..', 'fixtures', 'sample-16x9.mp4')
const dir = mkdtempSync(join(tmpdir(), 'cc-burn-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const GOLDEN_TIMEOUT_MS = 60_000

/** The `ass` filter needs an ffmpeg built with libass. Detect it so the burn check is skipped (not failed) on minimal builds. */
function hasAssFilter(): boolean {
  const r = Bun.spawnSync(['ffmpeg', '-hide_banner', '-h', 'filter=ass'])
  return !`${r.stdout.toString()}${r.stderr.toString()}`.includes('Unknown filter')
}
const LIBASS = hasAssFilter()
if (!LIBASS) {
  console.warn('[captionsBurn] SKIPPED: installed ffmpeg has no libass (no `ass` filter) — burn-in not verifiable here.')
}

test.skipIf(!LIBASS)(
  'real ffmpeg burns a generated ASS into the output via the subtitlePath seam',
  async () => {
    // Generate the ASS the engine produces, and a tiny transparent overlay PNG the graph requires.
    const assPath = join(dir, 'cap.ass')
    writeFileSync(assPath, buildAss(fixture, { canvas: { width: 1080, height: 1920 } }))
    const overlay = join(dir, 'overlay.png')
    const mk = Bun.spawnSync(['ffmpeg', '-y', '-f', 'lavfi', '-i', 'color=c=black@0.0:s=64x64,format=rgba', '-frames:v', '1', overlay])
    expect(mk.exitCode).toBe(0)

    const output = join(dir, 'captioned.mp4')
    const spec: RenderSpec = {
      videoInput: SAMPLE,
      overlayInput: overlay,
      output,
      canvas: { width: 1080, height: 1920 },
      region: { x: 60, y: 460, width: 960, height: 1100 },
      fit: 'cover',
      background: '0x000000',
      crf: 20,
      subtitlePath: assPath,
    }

    const proc = Bun.spawn(['ffmpeg', ...buildFfmpegArgs(spec)], { stdout: 'ignore', stderr: 'pipe' })
    const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited])
    expect(exitCode).toBe(0)
    // the ass filter must actually have been applied (ffmpeg names it in its filter graph init)
    expect(stderr.toLowerCase()).toContain('ass')

    const probe = Bun.spawnSync(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', output])
    expect(probe.stdout.toString().trim()).toBe('1080,1920')
  },
  GOLDEN_TIMEOUT_MS,
)
