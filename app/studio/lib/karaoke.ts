/**
 * Pure scrub-time → karaoke-state helpers for the Caption Studio DOM preview.
 *
 * The preview overlay is HTML/CSS synced to a `<video>` scrub position — it does NOT burn ASS with
 * ffmpeg/libass (that happens at export). These functions mirror the ASS `{\k}` semantics from
 * `src/captions/ass.ts`: at a given playhead time, each word is "sung" (already spoken, the primary
 * fill), "active" (currently being spoken), or "unsung" (not yet reached, the secondary colour).
 *
 * Side-effect-free and framework-free so they can be unit-tested without React.
 */

import type { Transcript, Word } from '@/src/transcribe/types'

/** Karaoke state of a single word at a playhead time, matching ASS primary/secondary colour roles. */
export type WordState = 'unsung' | 'active' | 'sung'

/**
 * Classify a word at playhead `timeSec`. The active window is `[startSec, endSec)`: the start is
 * inclusive and the end is exclusive, so a word becomes "sung" the instant its end is reached and the
 * next word becomes "active" at the same boundary (clean hand-off, no flicker, no double-highlight).
 */
export function wordStateAt(word: Word, timeSec: number): WordState {
  if (timeSec >= word.endSec) return 'sung'
  if (timeSec >= word.startSec) return 'active'
  return 'unsung'
}

/**
 * Index of the segment whose window `[startSec, endSec)` contains `timeSec`, or `-1` when the playhead
 * is before the first segment, after the last, or in a gap between segments (no caption on screen).
 */
export function findSegmentIndexAt(transcript: Transcript, timeSec: number): number {
  return transcript.segments.findIndex((segment) => timeSec >= segment.startSec && timeSec < segment.endSec)
}
