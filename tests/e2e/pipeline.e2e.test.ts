/**
 * Phase 7 — cross-flow E2E: clip-suggest → cut → captions → (reframe + b-roll + export) render.
 *
 * Drives the REAL App Router handlers (called directly with a `Request`, no server process) and the
 * REAL render core (`renderClip` → spawns ffmpeg/ffprobe), then verifies the actual output bytes with
 * ffprobe — not the pure helpers. This is the integration spine the unit + golden suites only cover in
 * isolation.
 *
 * Guards (skip, never fail, when a real dependency is absent — same discipline as `captionsBurn`):
 *   - LIBASS  : the `ass` filter needs an ffmpeg built with libass (use `ffmpeg-full` on PATH).
 *   - OLLAMA  : `/api/clip/suggest` calls a local Ollama; skipped when it is not reachable.
 */
import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { POST as captionsPost } from '../../app/api/captions/route'
import { POST as cutPost } from '../../app/api/clip/cut/route'
import { POST as suggestPost } from '../../app/api/clip/suggest/route'
import { buildAss } from '../../src/captions/ass'
import { buildFfmpegArgs, type RenderSpec } from '../../src/render/ffmpegArgs'
import { probeVideo, type RenderRequest, renderClip } from '../../src/render/runRender'
import clipTranscript from '../fixtures/transcript-clip.json'
import karaokeTranscript from '../fixtures/transcript-karaoke.json'

const FIXTURES = join(import.meta.dir, '..', 'fixtures')
const SAMPLE = join(FIXTURES, 'sample-16x9.mp4')
const WORK = mkdtempSync(join(tmpdir(), 'cc-e2e-'))
afterAll(() => rmSync(WORK, { recursive: true, force: true }))

const GOLDEN_TIMEOUT_MS = 60_000
const DURATION_TOLERANCE_SEC = 0.3

/** The `ass` filter needs an ffmpeg built with libass; detect so the burn legs skip (not fail) on minimal builds. */
function hasAssFilter(): boolean {
  const r = Bun.spawnSync(['ffmpeg', '-hide_banner', '-h', 'filter=ass'])
  return !`${r.stdout.toString()}${r.stderr.toString()}`.includes('Unknown filter')
}
const LIBASS = hasAssFilter()

/** `/api/clip/suggest` needs a local Ollama; probe its tag list so the leg skips cleanly when it is down. */
async function ollamaReachable(): Promise<boolean> {
  try {
    const host = process.env.OLLAMA_HOST ?? 'http://localhost:11434'
    const res = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(1000) })
    return res.ok
  } catch {
    return false
  }
}
const OLLAMA = await ollamaReachable()

function postJson(body: unknown): Request {
  return new Request('http://e2e.local', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('cross-flow pipeline E2E (real handlers + real ffmpeg)', () => {
  test.skipIf(!OLLAMA)(
    'clip/suggest ranks real candidates from a transcript via local Ollama',
    async () => {
      const res = await suggestPost(
        postJson({ transcript: clipTranscript, videoDurationSec: clipTranscript.durationSec }),
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as { candidates: { startSec: number; endSec: number }[] }
      expect(Array.isArray(body.candidates)).toBe(true)
      expect(body.candidates.length).toBeGreaterThan(0)
      for (const c of body.candidates) {
        expect(c.endSec).toBeGreaterThan(c.startSec)
        expect(c.startSec).toBeGreaterThanOrEqual(0)
        expect(c.endSec).toBeLessThanOrEqual(clipTranscript.durationSec + DURATION_TOLERANCE_SEC)
      }
    },
    GOLDEN_TIMEOUT_MS,
  )

  test(
    'clip/cut carves a real sub-clip out of the source (ffprobe-verified)',
    async () => {
      // The route reports the path it actually wrote to (`${OUTPUT_ROOT ?? './output'}/clips/<name>.mp4`).
      // Read that back rather than guessing — keeps the test correct even if OUTPUT_ROOT is set in the env.
      // `/output/` is gitignored; we clean up the one file we create.
      let out: string | undefined
      try {
        const res = await cutPost(
          postJson({
            inputFolder: FIXTURES,
            fileName: 'sample-16x9.mp4',
            ranges: [{ startSec: 0, endSec: 1, name: 'e2e_cut' }],
          }),
        )
        expect(res.status).toBe(200)
        const body = (await res.json()) as { results: { ok: boolean; output?: string }[] }
        expect(body.results.length).toBeGreaterThan(0)
        expect(body.results[0]?.ok).toBe(true)
        out = body.results[0]?.output
        expect(typeof out).toBe('string')
        if (!out) return

        expect(existsSync(out)).toBe(true)
        const probed = await probeVideo(out)
        expect(probed.ok).toBe(true)
        if (!probed.ok) return
        // ±0.6s window (wider than DURATION_TOLERANCE_SEC) absorbs keyframe-seek + container muxing slack on a 1s cut.
        expect(probed.data.durationSec).toBeGreaterThan(0.4)
        expect(probed.data.durationSec).toBeLessThan(1.6)
      } finally {
        if (out) rmSync(out, { force: true })
      }
    },
    GOLDEN_TIMEOUT_MS,
  )

  test('captions API builds a karaoke ASS document from a transcript', async () => {
    const res = await captionsPost(postJson({ transcript: karaokeTranscript }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ass: string }
    expect(body.ass).toContain('[Script Info]')
    expect(body.ass).toContain('Dialogue:')
  })

  test.skipIf(!LIBASS)(
    'composed render: captions + reframe + b-roll + export-opt compose into one correct 9:16 export',
    async () => {
      // Captions: the exact ASS the engine emits, burned via the subtitlePath seam.
      const assPath = join(WORK, 'cap.ass')
      writeFileSync(assPath, buildAss(karaokeTranscript, { canvas: { width: 1080, height: 1920 } }))

      // B-roll: a solid frame the cutaway overlay composites in during its window.
      const broll = join(WORK, 'broll-red.png')
      const mk = Bun.spawnSync([
        'ffmpeg', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=640x360', '-frames:v', '1', broll,
      ])
      expect(mk.exitCode).toBe(0)

      // (1) WIRING — prove all four feature flags actually reach the ffmpeg command. A 16:9→1080x1920
      // render yields 1080x1920 even if captions/reframe/b-roll were silently dropped, so geometry alone
      // is false confidence. Each feature's RUNTIME effect is proven in isolation by the per-feature golden
      // tests (captionsBurn → `ass` in stderr; cutaway → frame colour; reframe/renderOpt → dims/audio).
      const allFeatures: RenderSpec = {
        videoInput: SAMPLE,
        overlayInput: broll, // only the argv string is inspected in this leg; not executed.
        output: join(WORK, 'wiring.mp4'),
        canvas: { width: 1080, height: 1920 },
        region: { x: 0, y: 0, width: 1080, height: 1920 },
        fit: 'cover',
        background: '0x000000',
        crf: 20,
        subtitlePath: assPath,
        reframeCrop: 'crop=608:1080:236:0',
        hwaccel: 'videotoolbox',
        videoEncode: { bitrate: 8_000_000, maxrate: 12_000_000, bufsize: 16_000_000, keyint: 60 },
        cutaways: [{ input: broll, startSec: 0.3, endSec: 0.7 }],
      }
      const argv = buildFfmpegArgs(allFeatures).join(' ')
      expect(argv).toContain('ass=filename=') // captions burn-in
      expect(argv).toContain('crop=608:1080') // reframe crop prepended to [0:v]
      expect(argv).toContain("enable='between(t,0.3,0.7)'") // b-roll cutaway window
      expect(argv).toContain('-maxrate') // export-opt VBV rate control
      expect(argv).toContain('-hwaccel videotoolbox') // export-opt hwaccel decode

      // (2) EXECUTION + GEOMETRY — the real orchestrator builds its OWN spec (probes the source for the
      // reframe crop, plans the export tier) and ffmpeg actually runs it. Verify the OUTPUT bytes.
      const output = join(WORK, 'composed_reel.mp4')
      const request: RenderRequest = {
        videoInput: SAMPLE,
        output,
        canvas: { width: 1080, height: 1920 },
        region: { x: 0, y: 0, width: 1080, height: 1920 },
        fit: 'cover',
        background: '0x000000',
        crf: 20,
        overlay: { title: 'E2E', subtitle: 'captions+reframe+broll+opt', watermark: '@creatorclip' },
        subtitlePath: assPath,
        reframe: { focus: { x: 0.5, y: 0.5 } },
        cutaways: [{ input: broll, startSec: 0.3, endSec: 0.7 }],
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
      expect(Math.abs(probed.data.durationSec - result.probe.durationSec)).toBeLessThan(
        DURATION_TOLERANCE_SEC,
      )
    },
    GOLDEN_TIMEOUT_MS,
  )
})
