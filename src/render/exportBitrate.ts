/**
 * Pure resolution- and fps-scaled MP4 bitrate planning for the ffmpeg encode path.
 *
 * Ported from Recordly's `lib/exporter/exportBitrate.ts` — its WebCodecs encode path does not
 * transfer, only the number math does. Given a target resolution, frame rate, and quality tier
 * this returns the average target bitrate plus the VBV `maxrate`/`bufsize` the integrator feeds
 * to libx264 as `-b:v`/`-maxrate`/`-bufsize`. Side-effect-free: no ffmpeg spawn, no I/O.
 *
 * Scaling model (all from the reference):
 *   - base bitrate is selected by pixel-count tier (720p / 1080p / >1080p), with a separate,
 *     higher table for the near-`source` tier;
 *   - frame rate scales the target by `sqrt(max(1, fps / 30))`, so 24 and 30 fps share it;
 *   - a per-tier floor and cap, each scaled by `sqrt(pixelRate / 1080p30)`, keep results sane;
 *     the floor is additionally never below an absolute 2 Mbps MP4 minimum, and the cap is never
 *     below the floor, so the two bounds stay coherent for any future table edit.
 *
 * The floor and cap are the only clamps, and each is reported in `clamps` — nothing is capped
 * silently.
 */

/** Quality tier, highest to lowest fidelity. `source` targets a near-transparent re-encode. */
export type QualityTier = 'source' | 'high' | 'good' | 'low'

export interface BitrateInput {
  readonly width: number
  readonly height: number
  /** Source/target frame rate. Defaults to 30 when omitted. */
  readonly fps?: number
  readonly tier: QualityTier
}

export interface BitrateClamps {
  /** Target was raised to the resolution/fps-scaled floor. */
  readonly raisedToFloor: boolean
  /** Target was lowered to the resolution/fps-scaled cap. */
  readonly loweredToCap: boolean
}

export interface BitratePlan {
  /** Average target bitrate in bits/sec (libx264 `-b:v`). */
  readonly bitrate: number
  /** VBV peak bitrate in bits/sec (`-maxrate`). */
  readonly maxrate: number
  /** VBV buffer size in bits (`-bufsize`). */
  readonly bufsize: number
  readonly clamps: BitrateClamps
}

/** Absolute lower bound for any MP4 target; folded into the per-tier floor so it is never breached. */
const MIN_BITRATE_BPS = 2_000_000
/** 1920×1080@30 — the pixel-rate the floor/cap tables are normalized against. */
const REFERENCE_PIXEL_RATE = 1920 * 1080 * 30
const REFERENCE_FRAME_RATE = 30
const DEFAULT_FRAME_RATE = 30
/** VBV headroom over the average target (`-maxrate` ≈ 1.45× `-b:v`). */
const MAXRATE_MULTIPLIER = 1.45
/** VBV buffer expressed as a multiple of `maxrate` (≈ 2s of peak). */
const BUFSIZE_MULTIPLIER = 2
/** Smallest pixel-rate scale the floor/cap may shrink to, so tiny inputs keep a usable target. */
const MIN_PIXEL_RATE_SCALE = 0.1

const REFERENCE_CAP_BPS: Record<QualityTier, number> = {
  source: 36_000_000,
  high: 28_000_000,
  good: 20_000_000,
  low: 14_000_000,
}

const REFERENCE_FLOOR_BPS: Record<QualityTier, number> = {
  source: 22_000_000,
  high: 16_000_000,
  good: 12_000_000,
  low: 8_000_000,
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`exportBitrate: ${name} must be a positive finite number, received ${value}`)
  }
}

/** Base bitrate before fps/clamp adjustment, selected by pixel-count tier. */
function baseBitrate(width: number, height: number, tier: QualityTier): number {
  const totalPixels = width * height
  if (tier === 'source') {
    if (totalPixels > 2560 * 1440) {
      return 80_000_000
    }
    if (totalPixels > 1920 * 1080) {
      return 50_000_000
    }
    return 30_000_000
  }
  if (totalPixels <= 1280 * 720) {
    return 10_000_000
  }
  if (totalPixels <= 1920 * 1080) {
    return 20_000_000
  }
  return 30_000_000
}

/** sqrt scale above the 30fps baseline; 24 and 30 fps share a multiplier of 1. */
function frameRateMultiplier(fps: number): number {
  return Math.sqrt(Math.max(1, fps / REFERENCE_FRAME_RATE))
}

/** Pixel-rate of this encode relative to 1080p30, floored so tiny inputs keep a usable scale. */
function pixelRateScale(width: number, height: number, fps: number): number {
  return Math.max((width * height * fps) / REFERENCE_PIXEL_RATE, MIN_PIXEL_RATE_SCALE)
}

/**
 * Plan the average target bitrate and VBV `maxrate`/`bufsize` for an MP4 encode.
 * Pure and deterministic. Throws {@link RangeError} on non-positive or non-finite width/height/fps.
 */
export function planExportBitrate(input: BitrateInput): BitratePlan {
  assertPositiveFinite(input.width, 'width')
  assertPositiveFinite(input.height, 'height')
  if (input.fps !== undefined) {
    assertPositiveFinite(input.fps, 'fps')
  }
  const fps = input.fps ?? DEFAULT_FRAME_RATE

  const scaleRoot = Math.sqrt(pixelRateScale(input.width, input.height, fps))
  const requested = Math.round(baseBitrate(input.width, input.height, input.tier) * frameRateMultiplier(fps))
  // Fold the absolute minimum into the floor, and keep the cap at or above the floor, so the bounds
  // stay coherent (and `bitrate` never drops below MIN_BITRATE_BPS) for any tier-table values.
  const floor = Math.max(Math.round(REFERENCE_FLOOR_BPS[input.tier] * scaleRoot), MIN_BITRATE_BPS)
  const cap = Math.max(Math.round(REFERENCE_CAP_BPS[input.tier] * scaleRoot), floor)

  const afterFloor = Math.max(requested, floor)
  const bitrate = Math.min(afterFloor, cap)
  const maxrate = Math.round(bitrate * MAXRATE_MULTIPLIER)

  return {
    bitrate,
    maxrate,
    bufsize: Math.round(maxrate * BUFSIZE_MULTIPLIER),
    clamps: {
      raisedToFloor: afterFloor > requested,
      loweredToCap: bitrate < afterFloor,
    },
  }
}
