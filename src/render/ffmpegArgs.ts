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
}

function videoChain(spec: RenderSpec): { scale: string; overlay: string } {
  const { region, fit } = spec
  if (fit === 'cover') {
    return {
      scale: `[0:v]scale=${region.width}:${region.height}:force_original_aspect_ratio=increase,crop=${region.width}:${region.height}[v]`,
      overlay: `overlay=${region.x}:${region.y}`,
    }
  }
  // contain: fit inside the region, then center it so the background shows in the gaps.
  return {
    scale: `[0:v]scale=${region.width}:${region.height}:force_original_aspect_ratio=decrease[v]`,
    overlay: `overlay=x=${region.x}+(${region.width}-overlay_w)/2:y=${region.y}+(${region.height}-overlay_h)/2`,
  }
}

/** Build the `-filter_complex` graph: background → video region → overlay PNG. */
export function buildFiltergraph(spec: RenderSpec): string {
  const { scale, overlay } = videoChain(spec)
  return [
    `color=c=${spec.background}:s=${spec.canvas.width}x${spec.canvas.height}[bg]`,
    scale,
    // `shortest=1` ends the composite when the (finite) source video ends. Without it the infinite
    // `color` background drives an unbounded output for any source whose length isn't otherwise
    // bounded — notably a clip with no audio stream — and the render runs until the disk fills.
    `[bg][v]${overlay}:shortest=1[base]`,
    '[base][1:v]overlay=0:0[out]',
  ].join(';')
}

/** Build the full ffmpeg argv (after the `ffmpeg` binary) for one render. */
export function buildFfmpegArgs(spec: RenderSpec): string[] {
  return [
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
    '-c:v',
    'libx264',
    '-crf',
    String(spec.crf),
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
