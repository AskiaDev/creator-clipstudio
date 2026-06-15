/**
 * Compose the Phase-6 render-opt encode plan from the two pure lane modules (`exportBitrate`,
 * `exportTuning`) for a given OUTPUT resolution, and render it into a log line.
 *
 * This is the only place that joins the bitrate + tuning math; `runRender` calls it when a render opts
 * into `export`, threads the resulting libx264 VBV/GOP opts into the ffmpeg args, and logs the plan so
 * every clamp is surfaced (no silent caps). Pure + side-effect-free.
 */

import { type BitratePlan, planExportBitrate, type QualityTier } from './exportBitrate'
import { type EncodeMode, planExportTuning, type TuningPlan } from './exportTuning'

/** Opt-in render-opt knobs on a RenderRequest. Absent → CRF encode, byte-identical render. */
export interface ExportConfig {
  /** Bitrate quality tier; defaults to `high`. */
  readonly tier?: QualityTier
  /** Encode mode for keyint/chunk tuning; defaults to `balanced`. */
  readonly mode?: EncodeMode
  /** Output frame rate for bitrate/keyint scaling; defaults to 30. */
  readonly fps?: number
  /** Request VideoToolbox decode acceleration (subject to availability + software fallback). Default true. */
  readonly hwaccel?: boolean
  /** Logical-core hint for tuning concurrency. */
  readonly hardwareConcurrency?: number
}

/** libx264 VBV + GOP opts derived from the bitrate plan + tuning keyint. */
export interface VideoEncodePlan {
  readonly bitrate: number
  readonly maxrate: number
  readonly bufsize: number
  readonly keyint: number
}

export interface ExportPlan {
  readonly videoEncode: VideoEncodePlan
  readonly bitrate: BitratePlan
  readonly tuning: TuningPlan
}

const DEFAULT_TIER: QualityTier = 'high'
const DEFAULT_FPS = 30

/** Compose the bitrate + tuning plans for an OUTPUT of `width`×`height`. Pure; throws on non-positive dims. */
export function planExport(config: ExportConfig, width: number, height: number): ExportPlan {
  const fps = config.fps ?? DEFAULT_FPS
  const bitrate = planExportBitrate({ width, height, fps, tier: config.tier ?? DEFAULT_TIER })
  const tuning = planExportTuning({
    width,
    height,
    fps,
    mode: config.mode,
    hardwareConcurrency: config.hardwareConcurrency,
  })
  return {
    videoEncode: { bitrate: bitrate.bitrate, maxrate: bitrate.maxrate, bufsize: bitrate.bufsize, keyint: tuning.keyint },
    bitrate,
    tuning,
  }
}

/** One-line, log-friendly summary that surfaces every clamp + the (deferred) chunk/concurrency plan. */
export function describeExportPlan(plan: ExportPlan): string {
  const { videoEncode: v, bitrate, tuning } = plan
  const clamps = [
    bitrate.clamps.raisedToFloor && 'bitrate->floor',
    bitrate.clamps.loweredToCap && 'bitrate->cap',
    tuning.clamps.chunkRaisedToMin && 'chunk->min',
    tuning.clamps.queueRaisedToMin && 'queue->min',
    tuning.clamps.queueLoweredToMax && 'queue->max',
    tuning.clamps.concurrencyLimitedByCores && 'concurrency->cores',
  ].filter(Boolean)
  // Active opts (bitrate/keyint/profile) are stated plainly; chunk/concurrency/queue are computed but the
  // parallel-segment orchestration is deferred, so they are tagged `planned(deferred)` — never read as live.
  return (
    `[render-opt] ${Math.round(v.bitrate / 1000)}k (max ${Math.round(v.maxrate / 1000)}k) g=${v.keyint} ` +
    `profile=${tuning.profile} rate=${tuning.relativePixelRate.toFixed(2)}` +
    `${clamps.length ? ` clamps=[${clamps.join(',')}]` : ''}` +
    ` | planned(deferred): chunk=${tuning.chunkSeconds}s x${tuning.concurrency} queue=${tuning.queueLimit}`
  )
}
