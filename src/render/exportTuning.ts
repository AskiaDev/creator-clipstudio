/**
 * Pure chunking/backpressure tuning for long or 4K ffmpeg encodes.
 *
 * Ported from Recordly's `lib/exporter/exportTuning.ts`. The WebCodecs queue plumbing (latency
 * modes, decode queues, native-write counters, the `navigator.hardwareConcurrency` probe) does
 * not transfer; only the pure number math does. Given a resolution, frame rate, encode mode, and
 * optional core count this returns the chunk length, parallel-chunk concurrency, keyframe
 * interval, and frame queue limit the integrator wires into the segmented ffmpeg pipeline.
 * Side-effect-free: no `navigator`, no spawn, no I/O.
 *
 * Workload is normalized to 720p60 (`relativePixelRate` = 1.0); heavier encodes get shorter
 * chunks and lower concurrency. Every clamp that changes a value is reported in `clamps`.
 */

/** Encode mode trading speed for quality; mirrors the reference's encoding-mode axis. */
export type EncodeMode = 'fast' | 'balanced' | 'quality'

/** Backpressure/concurrency profile chosen from core count and workload. */
export type TuningProfile = 'conservative' | 'balanced' | 'balanced-plus'

export interface TuningInput {
  readonly width: number
  readonly height: number
  readonly fps: number
  /** Defaults to `balanced` when omitted. */
  readonly mode?: EncodeMode
  /** Logical cores available to the encoder. Defaults to 8 when omitted or non-finite. */
  readonly hardwareConcurrency?: number
}

export interface TuningClamps {
  /** Chunk target was raised to the minimum chunk length. */
  readonly chunkRaisedToMin: boolean
  /** Queue target was raised to the mode's minimum. */
  readonly queueRaisedToMin: boolean
  /** Queue target was lowered to the mode's maximum. */
  readonly queueLoweredToMax: boolean
  /** Profile concurrency was limited by the available core count. */
  readonly concurrencyLimitedByCores: boolean
}

export interface TuningPlan {
  /** Segment length in seconds for chunked encoding, aligned to a whole number of GOPs. */
  readonly chunkSeconds: number
  /** Number of chunks to encode in parallel. */
  readonly concurrency: number
  /** Keyframe interval in frames (libx264 `-g`). */
  readonly keyint: number
  /** Maximum frames buffered before applying backpressure. */
  readonly queueLimit: number
  /** Workload relative to the 720p60 baseline (1.0). Exposed for logging/diagnostics. */
  readonly relativePixelRate: number
  readonly profile: TuningProfile
  readonly clamps: TuningClamps
}

const DEFAULT_ENCODE_MODE: EncodeMode = 'balanced'
const DEFAULT_HARDWARE_CONCURRENCY = 8
/** 1280×720@60 — the workload the relative pixel rate is normalized against. */
const BASELINE_PIXELS_PER_SECOND = 1280 * 720 * 60

const TARGET_QUEUE_SECONDS: Record<EncodeMode, number> = { fast: 1.25, balanced: 2, quality: 2.4 }
const MIN_QUEUE_LIMIT: Record<EncodeMode, number> = { fast: 36, balanced: 72, quality: 96 }
const MAX_QUEUE_LIMIT: Record<EncodeMode, number> = { fast: 96, balanced: 120, quality: 180 }
const KEYINT_SECONDS: Record<EncodeMode, number> = { fast: 4, balanced: 3, quality: 2.5 }

/** Parallel-chunk count per profile, ported from the reference's ffmpeg in-flight-write counts. */
const PROFILE_CONCURRENCY: Record<TuningProfile, number> = {
  conservative: 2,
  balanced: 4,
  'balanced-plus': 8,
}

const LOW_CORE_COUNT = 4
const HIGH_CORE_COUNT = 8
const HEAVY_WORKLOAD_RATE = 1.5
const EXTREME_WORKLOAD_RATE = 3

/** Base chunk length for a baseline (720p60) workload; shortened for heavier encodes. */
const BASE_CHUNK_SECONDS = 60
/** Smallest chunk length we will emit, regardless of workload. */
const MIN_CHUNK_SECONDS = 10

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`exportTuning: ${name} must be a positive finite number, received ${value}`)
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** Resolve the optional core hint to a usable integer, defaulting when absent or non-finite. */
function effectiveCoreCount(hardwareConcurrency?: number): number {
  if (typeof hardwareConcurrency === 'number' && Number.isFinite(hardwareConcurrency) && hardwareConcurrency >= 1) {
    return Math.floor(hardwareConcurrency)
  }
  return DEFAULT_HARDWARE_CONCURRENCY
}

/** Workload relative to 720p60; each dimension floored at 1 so it never collapses to 0. */
function relativePixelRate(width: number, height: number, fps: number): number {
  return (Math.max(1, width) * Math.max(1, height) * Math.max(1, fps)) / BASELINE_PIXELS_PER_SECOND
}

function selectProfile(coreCount: number, rate: number): TuningProfile {
  const isLowCore = coreCount <= LOW_CORE_COUNT
  const isHighCore = coreCount >= HIGH_CORE_COUNT
  const isHeavy = rate >= HEAVY_WORKLOAD_RATE
  const isExtreme = rate >= EXTREME_WORKLOAD_RATE
  if (isLowCore || isExtreme) {
    return 'conservative'
  }
  if (isHighCore && !isHeavy) {
    return 'balanced-plus'
  }
  return 'balanced'
}

/**
 * Plan chunking and backpressure for an encode. Pure and deterministic.
 * Throws {@link RangeError} on non-positive or non-finite width/height/fps.
 */
export function planExportTuning(input: TuningInput): TuningPlan {
  assertPositiveFinite(input.width, 'width')
  assertPositiveFinite(input.height, 'height')
  assertPositiveFinite(input.fps, 'fps')

  const mode = input.mode ?? DEFAULT_ENCODE_MODE
  const coreCount = effectiveCoreCount(input.hardwareConcurrency)
  const rate = relativePixelRate(input.width, input.height, input.fps)

  const profile = selectProfile(coreCount, rate)
  const profileConcurrency = PROFILE_CONCURRENCY[profile]
  const concurrency = Math.min(profileConcurrency, coreCount)

  const keyint = Math.max(1, Math.round(input.fps * KEYINT_SECONDS[mode]))

  const requestedQueue = Math.round(input.fps * TARGET_QUEUE_SECONDS[mode])
  const queueLimit = clamp(requestedQueue, MIN_QUEUE_LIMIT[mode], MAX_QUEUE_LIMIT[mode])

  // Heavier workloads get shorter chunks; align to whole GOPs so each segment starts on a keyframe.
  // GOP alignment is the hard constraint, so for short GOPs the final length can land just under
  // MIN_CHUNK_SECONDS (e.g. 3×3s=9s when the min is 10s); `chunkRaisedToMin` still reports that the
  // workload-derived target was below the minimum before alignment.
  const keyintSeconds = KEYINT_SECONDS[mode]
  const requestedChunk = BASE_CHUNK_SECONDS / Math.max(1, rate)
  const boundedChunk = Math.max(requestedChunk, MIN_CHUNK_SECONDS)
  const chunkGops = Math.max(1, Math.round(boundedChunk / keyintSeconds))
  const chunkSeconds = chunkGops * keyintSeconds

  return {
    chunkSeconds,
    concurrency,
    keyint,
    queueLimit,
    relativePixelRate: rate,
    profile,
    clamps: {
      chunkRaisedToMin: requestedChunk < MIN_CHUNK_SECONDS,
      queueRaisedToMin: requestedQueue < MIN_QUEUE_LIMIT[mode],
      queueLoweredToMax: requestedQueue > MAX_QUEUE_LIMIT[mode],
      concurrencyLimitedByCores: profileConcurrency > coreCount,
    },
  }
}
