/**
 * Single-clip end-to-end render: the only module in the render core that spawns a process.
 *
 * Orchestrates the pure pieces — preflight (Phase 1), ffprobe parse (Phase 2), overlay PNG (Phase 3),
 * ffmpeg arg builder (Phase 2) — and `Bun.spawn`s ffprobe + ffmpeg. The overlay PNG is written to a
 * unique temp file (composited by ffmpeg as input 1), then deleted. Every spawn dependency is injectable
 * so the orchestration and its error stages are unit-testable without a real ffmpeg.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { buildFfmpegArgs, type FitMode, type Rect, type RenderSpec, type Size } from './ffmpegArgs'
import { buildFfprobeArgs, type ProbeData, type ProbeResult, parseFfprobeJson } from './ffprobe'
import { type ExportConfig, describeExportPlan, planExport } from './exportArgs'
import { type OverlayContent, type OverlayTemplate, renderOverlayPng } from './overlay'
import { type BinaryResolver, preflight } from './preflight'
import { type ReframeRequest, reframeCropExpr } from './reframe'

export interface RenderRequest {
  readonly videoInput: string
  readonly output: string
  /** Final canvas, e.g. 1080×1920. */
  readonly canvas: Size
  /** Where the source video is placed on the canvas. */
  readonly region: Rect
  readonly fit: FitMode
  /** FFmpeg color expression for the background, e.g. `0x000000`. */
  readonly background: string
  readonly crf: number
  readonly overlay: OverlayContent
  readonly template?: OverlayTemplate
  /**
   * Optional ASS subtitle file to burn in (Phase 3 captions). The worker writes the file from a job's
   * `captions_transcript` and passes its path; absent → the filtergraph is byte-identical to the
   * pre-captions renderer (the `ass` filter is only added when this is set — see `buildFiltergraph`).
   */
  readonly subtitlePath?: string
  /**
   * Optional auto-reframe (Phase 4): reframe e.g. a 16:9 source into a 9:16 window via a `crop` filter,
   * by a static focus or focus keyframes. The crop is computed from the probed source size. Absent →
   * the render path is byte-identical to the un-reframed renderer.
   */
  readonly reframe?: ReframeRequest
  /**
   * Optional Phase-6 render-opt: VideoToolbox decode (software fallback) + resolution-scaled VBV bitrate
   * + GOP tuning, computed from the output canvas. Absent → CRF encode, byte-identical render.
   */
  readonly export?: ExportConfig
}

/** The pipeline stage a failure occurred in. */
export type RenderStage = 'preflight' | 'probe' | 'reframe' | 'overlay' | 'ffmpeg'

export type RenderResult =
  | { readonly ok: true; readonly output: string; readonly probe: ProbeData }
  | { readonly ok: false; readonly stage: RenderStage; readonly error: string }

export interface FfmpegRun {
  readonly exitCode: number
  readonly stderr: string
}

/** Spawn dependencies, injectable for tests; all default to real ffprobe/ffmpeg via `Bun.spawn`. */
export interface RenderDeps {
  readonly resolveBinary: BinaryResolver
  readonly probeVideo: (path: string) => Promise<ProbeResult>
  readonly runFfmpeg: (args: readonly string[]) => Promise<FfmpegRun>
  readonly makeOverlayPng: (content: OverlayContent, template?: OverlayTemplate) => Promise<Uint8Array>
  /** Whether a named ffmpeg `-hwaccel` is available (Phase 6); default probes `ffmpeg -hwaccels`. */
  readonly detectHwaccel: (name: string) => boolean
  /** Progress/diagnostics sink (default no-op); surfaces the render-opt plan so no clamp is silent. */
  readonly log: (message: string) => void
}

const STDERR_TAIL_LINES = 6

function lastLines(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .slice(-STDERR_TAIL_LINES)
    .join('\n')
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function readStream(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  return stream ? await new Response(stream).text() : ''
}

/** Spawn ffprobe on a file and parse its JSON into typed probe data. */
export async function probeVideo(path: string): Promise<ProbeResult> {
  const proc = Bun.spawn(['ffprobe', ...buildFfprobeArgs(path)], { stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([
    readStream(proc.stdout),
    readStream(proc.stderr),
    proc.exited,
  ])
  if (exitCode !== 0) {
    return { ok: false, error: `ffprobe exited ${exitCode}: ${lastLines(stderr)}` }
  }
  return parseFfprobeJson(stdout)
}

async function spawnFfmpeg(args: readonly string[]): Promise<FfmpegRun> {
  const proc = Bun.spawn(['ffmpeg', ...args], { stdout: 'pipe', stderr: 'pipe' })
  const [stderr, exitCode] = await Promise.all([readStream(proc.stderr), proc.exited])
  return { exitCode, stderr }
}

/**
 * Available ffmpeg `-hwaccels`, probed ONCE per process — the set never changes at runtime, so memoizing
 * keeps the synchronous `ffmpeg -hwaccels` spawn off the hot async render path after the first export
 * render. A non-zero exit (e.g. ffmpeg missing) or a throw leaves the set empty → software fallback.
 */
let hwaccelCache: Set<string> | null = null

function detectHwaccelDefault(name: string): boolean {
  if (hwaccelCache === null) {
    hwaccelCache = new Set()
    try {
      const r = Bun.spawnSync(['ffmpeg', '-hide_banner', '-hwaccels'])
      if (r.exitCode === 0) {
        for (const line of `${r.stdout?.toString() ?? ''}`.split('\n')) {
          const trimmed = line.trim()
          // Accelerator names are listed one-per-line under a `Hardware acceleration methods:` header.
          if (trimmed.length > 0 && !trimmed.endsWith(':')) {
            hwaccelCache.add(trimmed)
          }
        }
      }
    } catch {
      // Leave the cache empty → software fallback for every accelerator.
    }
  }
  return hwaccelCache.has(name)
}

const DEFAULT_DEPS: RenderDeps = {
  resolveBinary: (binary) => Bun.which(binary),
  probeVideo,
  runFfmpeg: spawnFfmpeg,
  makeOverlayPng: renderOverlayPng,
  detectHwaccel: detectHwaccelDefault,
  log: () => {},
}

/**
 * Render one branded vertical clip end to end. Returns a typed Result for the four expected failure
 * stages (`preflight`, `probe`, `overlay`, `ffmpeg`); the temp overlay PNG is always cleaned up.
 */
export async function renderClip(
  request: RenderRequest,
  deps: Partial<RenderDeps> = {},
): Promise<RenderResult> {
  const d: RenderDeps = { ...DEFAULT_DEPS, ...deps }

  const pf = preflight(d.resolveBinary)
  if (!pf.ok) {
    return { ok: false, stage: 'preflight', error: pf.message }
  }

  const probe = await d.probeVideo(request.videoInput)
  if (!probe.ok) {
    return { ok: false, stage: 'probe', error: probe.error }
  }

  // Phase 4 reframe: build the crop from the REAL probed source size (focus is normalized). A malformed
  // request throws here (bad focus/zoom/aspect) and is surfaced as a typed `reframe` failure, never a
  // broken filtergraph. Absent → undefined → byte-identical render.
  let reframeCrop: string | undefined
  if (request.reframe) {
    try {
      reframeCrop = reframeCropExpr(request.reframe, { width: probe.data.width, height: probe.data.height })
    } catch (err) {
      return { ok: false, stage: 'reframe', error: errorMessage(err) }
    }
  }

  // Phase 6 render-opt (opt-in): resolution-scaled VBV bitrate + GOP from the output canvas, plus
  // VideoToolbox decode when available (software fallback). The full plan — including the deferred
  // chunk/concurrency/queue — is logged so no clamp is silent. Absent → CRF encode, byte-identical.
  let hwaccel: 'videotoolbox' | undefined
  let videoEncode: RenderSpec['videoEncode']
  if (request.export) {
    if (request.export.fps === undefined) {
      // Surface the assumption: bitrate floor/cap + keyint scale with fps; omitting it assumes 30fps.
      d.log('[render-opt] output fps not provided -> bitrate/keyint assume 30fps')
    }
    const plan = planExport(request.export, request.canvas.width, request.canvas.height)
    videoEncode = plan.videoEncode
    d.log(describeExportPlan(plan))
    if (request.export.hwaccel !== false) {
      if (d.detectHwaccel('videotoolbox')) {
        hwaccel = 'videotoolbox'
      } else {
        d.log('[render-opt] videotoolbox unavailable -> software decode')
      }
    }
  }

  let overlayPng: Uint8Array
  try {
    overlayPng = await d.makeOverlayPng(request.overlay, request.template)
  } catch (err) {
    return { ok: false, stage: 'overlay', error: errorMessage(err) }
  }

  let workDir: string
  try {
    workDir = mkdtempSync(join(tmpdir(), 'cc-overlay-'))
  } catch (err) {
    return { ok: false, stage: 'overlay', error: errorMessage(err) }
  }

  try {
    const overlayInput = join(workDir, 'overlay.png')
    try {
      writeFileSync(overlayInput, overlayPng)
      mkdirSync(dirname(request.output), { recursive: true })
    } catch (err) {
      // Filesystem setup for the ffmpeg run (temp PNG / output dir) failed.
      return { ok: false, stage: 'ffmpeg', error: errorMessage(err) }
    }

    const spec: RenderSpec = {
      videoInput: request.videoInput,
      overlayInput,
      output: request.output,
      canvas: request.canvas,
      region: request.region,
      fit: request.fit,
      background: request.background,
      crf: request.crf,
      subtitlePath: request.subtitlePath,
      reframeCrop,
      hwaccel,
      videoEncode,
    }

    const { exitCode, stderr } = await d.runFfmpeg(buildFfmpegArgs(spec))
    if (exitCode !== 0) {
      return { ok: false, stage: 'ffmpeg', error: `ffmpeg exited ${exitCode}: ${lastLines(stderr)}` }
    }
    return { ok: true, output: request.output, probe: probe.data }
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}
