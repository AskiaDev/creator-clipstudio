/**
 * Pair b-roll cues (S4 `keywords.ts`) with fetched images (S5 `image.ts`) into render-ready cutaways.
 *
 * Each fetch is independent and untrusted: a failed/blocked/empty image is skipped + logged, never thrown,
 * so a flaky image provider degrades to fewer cutaways rather than failing the whole render. The render core
 * then composites each {@link Cutaway} over its `[startSec, endSec]` window (see `buildFiltergraph`). Order
 * follows the (ranked, best-first) input cues.
 */

import type { Cutaway } from '../render/ffmpegArgs'
import { type BrollImageOptions, type BrollImageProvider, isSafeImageUrl } from './image'
import type { BrollCue } from './keywords'

export interface ResolveCutawaysOptions {
  /** Forwarded to `provider.fetchImage` (orientation/size). */
  readonly imageOptions?: BrollImageOptions
  /** Diagnostics sink for skipped cues; defaults to no-op. */
  readonly log?: (message: string) => void
}

/**
 * Resolve ranked cues into cutaways by fetching one image per cue. Sequential (kind to a local generation
 * provider, and deterministic); a non-`ok` fetch is logged and skipped. Never throws.
 */
export async function resolveCutaways(
  cues: readonly BrollCue[],
  provider: BrollImageProvider,
  opts: ResolveCutawaysOptions = {},
): Promise<Cutaway[]> {
  const log = opts.log ?? (() => {})
  const cutaways: Cutaway[] = []
  for (const cue of cues) {
    // Reject a malformed window up front (cues are untrusted) — never emit a broken `between(...)`.
    if (!isValidWindow(cue.startSec, cue.endSec)) {
      log(`[broll] ${cue.term}: invalid window [${cue.startSec}, ${cue.endSec}] — skipping`)
      continue
    }
    const result = await provider.fetchImage(cue.term, opts.imageOptions)
    if (!result.ok) {
      log(`[broll] ${cue.term}: ${result.error.kind} — ${result.error.message}`)
      continue
    }
    // A URL is about to be handed to ffmpeg `-i`, which WILL fetch it. Re-validate at this egress point,
    // independent of the provider (the `BrollImageProvider` interface makes no SSRF guarantee — the S5
    // lane deliberately left fetch-time validation to the integrator). Also blocks `file:`/`data:`.
    if (result.image.kind === 'url' && !isSafeImageUrl(result.image.url)) {
      log(`[broll] ${cue.term}: provider returned an unsafe URL — skipping`)
      continue
    }
    // local provider → a file path; stock provider → a validated https URL. Both are ffmpeg-readable.
    const input = result.image.kind === 'file' ? result.image.path : result.image.url
    cutaways.push({ input, startSec: cue.startSec, endSec: cue.endSec })
  }
  return cutaways
}

/** A usable cutaway window: both bounds finite, non-negative start, and end strictly after start. */
function isValidWindow(startSec: number, endSec: number): boolean {
  return Number.isFinite(startSec) && Number.isFinite(endSec) && startSec >= 0 && endSec > startSec
}
