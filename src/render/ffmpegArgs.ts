/**
 * Pure FFmpeg argument-array builder for a single branded vertical render.
 *
 * Composition (per the plan): a `color` background fills the canvas, the source video is
 * scaled/cropped into a region, and a transparent overlay PNG is composited on top. No user
 * text ever touches the filtergraph — text lives entirely in the overlay PNG (Phase 3).
 *
 * This module is side-effect-free: `runRender.ts` (Phase 4) spawns ffmpeg with the result.
 */

export type FitMode = 'cover' | 'contain'

export interface Size {
  readonly width: number
  readonly height: number
}

export interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface RenderSpec {
  readonly videoInput: string
  readonly overlayInput: string
  readonly output: string
  /** Final canvas, e.g. 1080×1920. */
  readonly canvas: Size
  /** Where the source video is placed on the canvas. */
  readonly region: Rect
  /** `cover` fills + crops the region; `contain` letterboxes, showing the background. */
  readonly fit: FitMode
  /** FFmpeg color expression for the background, e.g. `0x000000`. */
  readonly background: string
  /** libx264 constant rate factor (lower = higher quality). */
  readonly crf: number
  /** Optional ASS subtitle file to burn in (Phase 3 captions). Absent → graph is unchanged. */
  readonly subtitlePath?: string
  /**
   * Optional reframe `crop=` filter (Phase 4) prepended to the source `[0:v]` chain before the region
   * scale — reframes e.g. a 16:9 source into a 9:16 window. Absent → the `[0:v]` chain is byte-identical.
   * `runRender` builds this from the probed source size via `reframeCropExpr` (src/render/reframe.ts).
   */
  readonly reframeCrop?: string
  /** Optional VideoToolbox decode acceleration (Phase 6 render-opt). Absent → software decode. */
  readonly hwaccel?: 'videotoolbox'
  /**
   * Optional libx264 VBV bitrate + GOP encode (Phase 6) replacing `-crf`. Absent → `-crf {crf}`
   * (byte-identical). The encoder stays libx264 — this is rate control, not a hardware-encoder swap.
   */
  readonly videoEncode?: {
    readonly bitrate: number
    readonly maxrate: number
    readonly bufsize: number
    readonly keyint: number
  }
}

/**
 * Escape an ASS path for the `ass` filter's `filename` option inside `-filter_complex`. `\` and `:` are
 * AVOption-significant and must be escaped. Callers MUST pass a controlled local path (the worker/route
 * writes the ASS to a temp/work dir) — paths containing quotes or other filtergraph metacharacters are
 * unsupported. The burn path is only exercisable on an ffmpeg built with libass (tests/golden/captionsBurn).
 */
function escapeAssPath(path: string): string {
  return path.replace(/\\/g, '\\\\').replace(/:/g, '\\:')
}

function videoChain(spec: RenderSpec): { scale: string; overlay: string } {
  const { region, fit } = spec
  // Phase 4 reframe: an optional `crop=` is prepended to the source so the region scale operates on the
  // reframed (e.g. 9:16) window. Absent → `[0:v]` is untouched, so the graph stays byte-identical.
  const src = spec.reframeCrop ? `[0:v]${spec.reframeCrop},` : '[0:v]'
  if (fit === 'cover') {
    return {
      scale: `${src}scale=${region.width}:${region.height}:force_original_aspect_ratio=increase,crop=${region.width}:${region.height}[v]`,
      overlay: `overlay=${region.x}:${region.y}`,
    }
  }
  // contain: fit inside the region, then center it so the background shows in the gaps.
  return {
    scale: `${src}scale=${region.width}:${region.height}:force_original_aspect_ratio=decrease[v]`,
    overlay: `overlay=x=${region.x}+(${region.width}-overlay_w)/2:y=${region.y}+(${region.height}-overlay_h)/2`,
  }
}

/** Build the `-filter_complex` graph: background → video region → overlay PNG → (optional) burned ASS. */
export function buildFiltergraph(spec: RenderSpec): string {
  const { scale, overlay } = videoChain(spec)
  const lines = [
    `color=c=${spec.background}:s=${spec.canvas.width}x${spec.canvas.height}[bg]`,
    scale,
    // `shortest=1` ends the composite when the (finite) source video ends. Without it the infinite
    // `color` background drives an unbounded output for any source whose length isn't otherwise
    // bounded — notably a clip with no audio stream — and the render runs until the disk fills.
    `[bg][v]${overlay}:shortest=1[base]`,
  ]
  // When no subtitle is requested the final label stays `[out]`, so the graph is byte-identical to the
  // pre-captions renderer (its golden tests stay green). With one, route the composite through `ass`.
  if (spec.subtitlePath) {
    lines.push('[base][1:v]overlay=0:0[cap]', `[cap]ass=filename=${escapeAssPath(spec.subtitlePath)}[out]`)
  } else {
    lines.push('[base][1:v]overlay=0:0[out]')
  }
  return lines.join(';')
}

/** libx264 video opts: VBV bitrate + GOP when a render-opt plan is present, else the byte-identical CRF. */
function videoEncodeArgs(spec: RenderSpec): string[] {
  if (spec.videoEncode) {
    const { bitrate, maxrate, bufsize, keyint } = spec.videoEncode
    return ['-c:v', 'libx264', '-b:v', String(bitrate), '-maxrate', String(maxrate), '-bufsize', String(bufsize), '-g', String(keyint)]
  }
  return ['-c:v', 'libx264', '-crf', String(spec.crf)]
}

/** Build the full ffmpeg argv (after the `ffmpeg` binary) for one render. */
export function buildFfmpegArgs(spec: RenderSpec): string[] {
  // `-hwaccel videotoolbox` (Phase 6) is a per-input DECODE option placed before the video `-i`; absent
  // → software decode (byte-identical). The encoder (videoEncodeArgs) is unchanged either way.
  const decodeArgs = spec.hwaccel ? ['-hwaccel', spec.hwaccel] : []
  return [
    ...decodeArgs,
    '-i',
    spec.videoInput,
    '-i',
    spec.overlayInput,
    '-filter_complex',
    buildFiltergraph(spec),
    '-map',
    '[out]',
    '-map',
    '0:a?',
    '-shortest',
    ...videoEncodeArgs(spec),
    '-c:a',
    'aac',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    '-y',
    spec.output,
  ]
}
