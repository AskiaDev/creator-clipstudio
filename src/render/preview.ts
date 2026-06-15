/**
 * Truthful sample preview: a single real frame composited exactly like the final render.
 *
 * Extracts a frame at the clip midpoint and runs the SAME composition as the video render (color bg ▸
 * video region ▸ overlay PNG) via `buildFiltergraph`, emitting one PNG. Because it reuses the render
 * core, the preview matches what the worker will produce. In-process spawn; typed Result.
 *
 * The caller is responsible for validating `videoInput` (path trust); this function spawns ffprobe/ffmpeg
 * on it directly.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildFiltergraph, type RenderSpec } from './ffmpegArgs'
import { type OverlayContent, type OverlayTemplate, renderOverlayPng } from './overlay'
import { probeVideo } from './runRender'

export interface PreviewRequest {
  readonly videoInput: string
  readonly canvas: RenderSpec['canvas']
  readonly region: RenderSpec['region']
  readonly fit: RenderSpec['fit']
  readonly background: string
  readonly overlay: OverlayContent
  readonly template?: OverlayTemplate
}

export type PreviewStage = 'probe' | 'overlay' | 'ffmpeg'

export type PreviewResult =
  | { readonly ok: true; readonly png: Uint8Array; readonly atSec: number }
  | { readonly ok: false; readonly stage: PreviewStage; readonly error: string }

export interface PreviewDeps {
  readonly probeVideo: typeof probeVideo
  readonly makeOverlayPng: typeof renderOverlayPng
  readonly runFfmpeg: (args: readonly string[]) => Promise<{ exitCode: number; stderr: string }>
}

const STDERR_TAIL_LINES = 6

function tail(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .slice(-STDERR_TAIL_LINES)
    .join('\n')
}

async function spawnFfmpeg(args: readonly string[]): Promise<{ exitCode: number; stderr: string }> {
  const proc = Bun.spawn(['ffmpeg', ...args], { stdout: 'pipe', stderr: 'pipe' })
  const [stderr, exitCode] = await Promise.all([
    proc.stderr ? new Response(proc.stderr).text() : Promise.resolve(''),
    proc.exited,
  ])
  return { exitCode, stderr }
}

const DEFAULT_DEPS: PreviewDeps = {
  probeVideo,
  makeOverlayPng: renderOverlayPng,
  runFfmpeg: spawnFfmpeg,
}

/** Render one composited preview frame (PNG bytes) at the clip midpoint. */
export async function renderPreview(
  request: PreviewRequest,
  deps: Partial<PreviewDeps> = {},
): Promise<PreviewResult> {
  const d: PreviewDeps = { ...DEFAULT_DEPS, ...deps }

  const probe = await d.probeVideo(request.videoInput)
  if (!probe.ok) {
    return { ok: false, stage: 'probe', error: probe.error }
  }
  const atSec = probe.data.durationSec / 2

  let overlayPng: Uint8Array
  try {
    overlayPng = await d.makeOverlayPng(request.overlay, request.template)
  } catch (err) {
    return { ok: false, stage: 'overlay', error: err instanceof Error ? err.message : String(err) }
  }

  const workDir = mkdtempSync(join(tmpdir(), 'cc-preview-'))
  try {
    const overlayInput = join(workDir, 'overlay.png')
    const outPath = join(workDir, 'preview.png')
    writeFileSync(overlayInput, overlayPng)

    const spec: RenderSpec = {
      videoInput: request.videoInput,
      overlayInput,
      output: outPath,
      canvas: request.canvas,
      region: request.region,
      fit: request.fit,
      background: request.background,
      crf: 1,
    }
    // Single-frame PNG: we reuse buildFiltergraph (identical composition to the video render) but NOT
    // buildFfmpegArgs — no codec/audio/faststart flags, a pre-input `-ss` fast-seek, and `-frames:v 1`.
    // The input order ([0:v] video, [1:v] overlay) must match buildFiltergraph; update both together.
    const args = [
      '-ss',
      atSec.toFixed(3),
      '-i',
      request.videoInput,
      '-i',
      overlayInput,
      '-filter_complex',
      buildFiltergraph(spec),
      '-map',
      '[out]',
      '-frames:v',
      '1',
      '-y',
      outPath,
    ]

    const { exitCode, stderr } = await d.runFfmpeg(args)
    if (exitCode !== 0) {
      return { ok: false, stage: 'ffmpeg', error: `ffmpeg exited ${exitCode}: ${tail(stderr)}` }
    }
    return { ok: true, png: readFileSync(outPath), atSec }
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}
