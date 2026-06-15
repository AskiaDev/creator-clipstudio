/**
 * Pure map-reduce windowing: split a long transcript into overlapping time windows so each fits the
 * model context. Short transcripts pass through as a single window. The overlap avoids dropping clips
 * that straddle a window edge.
 */

import type { Segment, Transcript } from '../transcribe/types'

export interface TranscriptWindow {
  readonly startSec: number
  readonly endSec: number
  readonly segments: readonly Segment[]
}

export interface ChunkOptions {
  readonly windowSec: number
  readonly overlapSec: number
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = { windowSec: 600, overlapSec: 30 }

/** Split a transcript into overlapping time windows so long videos fit the model context. */
export function chunkTranscript(
  transcript: Transcript,
  opts: ChunkOptions = DEFAULT_CHUNK_OPTIONS,
): TranscriptWindow[] {
  const total = transcript.durationSec
  if (total <= opts.windowSec) {
    return [{ startSec: 0, endSec: total, segments: transcript.segments }]
  }
  const step = Math.max(1, opts.windowSec - opts.overlapSec)
  const windows: TranscriptWindow[] = []
  for (let start = 0; start < total; start += step) {
    const end = Math.min(start + opts.windowSec, total)
    const segments = transcript.segments.filter((s) => s.startSec < end && s.endSec > start)
    if (segments.length > 0) windows.push({ startSec: start, endSec: end, segments })
    if (end >= total) break
  }
  return windows
}
