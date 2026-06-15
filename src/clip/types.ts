/**
 * Public contract for the auto-clipper engine (Phase 2).
 *
 * A {@link ClipPicker} turns a {@link Transcript} (Phase 1) into a ranked list of {@link ClipCandidate}s.
 * Provider adapters (Ollama default, Claude alternate) implement this one interface; the pure core
 * (prompt / parse / chunk / pick) is provider-agnostic. All timings are **seconds**.
 */

import type { Transcript } from '../transcribe/types'

/** One ranked short-clip suggestion over the source video, in seconds. */
export interface ClipCandidate {
  readonly startSec: number
  readonly endSec: number
  readonly title: string
  /** Model confidence 0..100. */
  readonly score: number
  readonly reason: string
  /** Transcript text the range covers (reconstructed locally, not trusted from the model). */
  readonly excerpt: string
}

/** Editorial intent passed to the model. */
export type ClipStyle = 'informational' | 'viral' | 'educational'

/** Bounds for clip selection. */
export interface ClipOptions {
  readonly count: number
  readonly minSec: number
  readonly maxSec: number
  readonly style: ClipStyle
}

/** Everything a picker needs for one suggestion run. */
export interface ClipPickerInput {
  readonly transcript: Transcript
  readonly videoDurationSec: number
  readonly options: ClipOptions
}

/** The single provider-agnostic seam every adapter implements. */
export interface ClipPicker {
  pickClips(input: ClipPickerInput): Promise<ClipCandidate[]>
}

/** Sensible defaults: six 30–60s informational shorts. */
export const DEFAULT_CLIP_OPTIONS: ClipOptions = {
  count: 6,
  minSec: 30,
  maxSec: 60,
  style: 'informational',
}
