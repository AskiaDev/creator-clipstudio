/**
 * Pure parsing of raw LLM output into validated, snapped, clamped, de-overlapped {@link ClipCandidate}s.
 *
 * The model is never trusted: rows are Zod-validated, ranges are snapped to real segment boundaries,
 * clamped to the duration/maxSec, too-short clips dropped, and overlaps deduped. Every drop is counted
 * (no silent caps) so the orchestrator can `log()` it.
 */

import { z } from 'zod'
import type { Transcript } from '../transcribe/types'
import type { ClipCandidate, ClipPickerInput } from './types'

const rawCandidateSchema = z.object({
  startSec: z.number().nonnegative(),
  endSec: z.number().positive(),
  title: z.string().min(1),
  score: z.number().min(0).max(100),
  reason: z.string().min(1),
})
type RawCandidate = z.infer<typeof rawCandidateSchema>

const OVERLAP_THRESHOLD = 0.5

/**
 * Pull a list of candidate rows out of a raw LLM response. Defensive against every shape observed across
 * providers: a bare/fenced JSON array, a `{"clips":[...]}` wrapper object (Ollama JSON mode), or a single
 * bare object (wrapped as one element). Never throws; returns `[]` when nothing parses.
 */
export function extractJsonArray(raw: string): unknown[] {
  // 1) Prefer a JSON array. With a `{"clips":[...]}` wrapper, first '[' .. last ']' is exactly the inner array.
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(raw.slice(start, end + 1))
      if (Array.isArray(parsed)) return parsed
    } catch {
      // fall through to the object path
    }
  }
  // 2) Fall back to a JSON object: prefer a `clips` array (our requested shape), then any array-valued
  //    property, else wrap the object itself. Preferring `clips` avoids picking an unrelated array
  //    (e.g. a provider's `{"usage":[...], "clips":[...]}`).
  const objStart = raw.indexOf('{')
  const objEnd = raw.lastIndexOf('}')
  if (objStart !== -1 && objEnd > objStart) {
    try {
      const parsed = JSON.parse(raw.slice(objStart, objEnd + 1))
      if (parsed && typeof parsed === 'object') {
        const obj = parsed as Record<string, unknown>
        if (Array.isArray(obj.clips)) return obj.clips
        const arrayProp = Object.values(obj).find((v) => Array.isArray(v))
        return Array.isArray(arrayProp) ? arrayProp : [parsed]
      }
    } catch {
      return []
    }
  }
  return []
}

function nearest(values: readonly number[], target: number): number {
  return values.reduce(
    (best, v) => (Math.abs(v - target) < Math.abs(best - target) ? v : best),
    values[0] ?? target,
  )
}

/** Map a proposed range to the nearest real segment start/end so cuts land on sentence edges. */
export function snapToBoundaries(
  startSec: number,
  endSec: number,
  transcript: Transcript,
): { startSec: number; endSec: number } {
  if (transcript.segments.length === 0) return { startSec, endSec }
  const starts = transcript.segments.map((s) => s.startSec)
  const ends = transcript.segments.map((s) => s.endSec)
  return { startSec: nearest(starts, startSec), endSec: nearest(ends, endSec) }
}

/** Reconstruct the covered transcript text locally (do not trust the model's excerpt). */
export function excerptFor(transcript: Transcript, startSec: number, endSec: number): string {
  return transcript.segments
    .filter((s) => s.startSec >= startSec && s.endSec <= endSec)
    .map((s) => s.text)
    .join(' ')
    .trim()
}

function overlapRatio(a: ClipCandidate, b: ClipCandidate): number {
  const inter = Math.max(0, Math.min(a.endSec, b.endSec) - Math.max(a.startSec, b.startSec))
  const shorter = Math.min(a.endSec - a.startSec, b.endSec - b.startSec)
  return shorter > 0 ? inter / shorter : 0
}

/** Greedy de-overlap: keep highest score first; drop anything overlapping a kept clip >50%. */
export function dedupeOverlaps(cands: readonly ClipCandidate[]): ClipCandidate[] {
  const sorted = [...cands].sort((a, b) => b.score - a.score)
  const kept: ClipCandidate[] = []
  for (const c of sorted) {
    if (!kept.some((k) => overlapRatio(c, k) > OVERLAP_THRESHOLD)) kept.push(c)
  }
  return kept
}

export interface ParseResult {
  readonly candidates: ClipCandidate[]
  readonly droppedInvalid: number
  readonly droppedShort: number
  readonly droppedOverlap: number
}

/** Raw model text → ranked, bounded candidates + per-reason drop counts. Never throws. */
export function parseClipCandidates(raw: string, input: ClipPickerInput): ParseResult {
  const { transcript, options } = input
  const rows = extractJsonArray(raw)

  let droppedInvalid = 0
  const valid: RawCandidate[] = []
  for (const row of rows) {
    const r = rawCandidateSchema.safeParse(row)
    if (r.success) valid.push(r.data)
    else droppedInvalid++
  }

  let droppedShort = 0
  const shaped: ClipCandidate[] = []
  for (const v of valid) {
    const snapped = snapToBoundaries(v.startSec, v.endSec, transcript)
    let endSec = Math.min(snapped.endSec, input.videoDurationSec)
    if (endSec - snapped.startSec > options.maxSec) endSec = snapped.startSec + options.maxSec
    if (endSec - snapped.startSec < options.minSec) {
      droppedShort++
      continue
    }
    shaped.push({
      startSec: snapped.startSec,
      endSec,
      title: v.title.slice(0, 60),
      score: Math.round(v.score),
      reason: v.reason,
      excerpt: excerptFor(transcript, snapped.startSec, endSec),
    })
  }

  const deduped = dedupeOverlaps(shaped)
  const droppedOverlap = shaped.length - deduped.length
  const candidates = deduped.sort((a, b) => b.score - a.score).slice(0, options.count)
  return { candidates, droppedInvalid, droppedShort, droppedOverlap }
}
