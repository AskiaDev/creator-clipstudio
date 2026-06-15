/**
 * Canonical Zod validator for a {@link Transcript} — the single runtime source of truth shared by the
 * caption API (app/api/captions) and the render worker (src/queue/worker).
 *
 * The Transcript *type* lives in ./types; this is its runtime schema. Edited/persisted transcripts are
 * untrusted on read (a DB row can be hand-edited or corrupted), so the worker re-validates here before
 * building the burned-in ASS. Shape and field constraints mirror the original app/api/captions schema
 * exactly (timings are non-negative seconds) so API and worker never diverge.
 */

import { z } from 'zod'
import type { Transcript } from './types'

export const wordSchema = z.object({
  text: z.string(),
  startSec: z.number().nonnegative(),
  endSec: z.number().nonnegative(),
})

export const segmentSchema = z.object({
  startSec: z.number().nonnegative(),
  endSec: z.number().nonnegative(),
  text: z.string(),
  words: z.array(wordSchema),
})

export const transcriptSchema = z.object({
  durationSec: z.number().nonnegative(),
  segments: z.array(segmentSchema),
})

/** Validate an already-parsed, untrusted value as a {@link Transcript}. Throws a descriptive Error on mismatch. */
export function parseTranscript(value: unknown): Transcript {
  const parsed = transcriptSchema.safeParse(value)
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'transcript'}: ${issue.message}`)
      .join('; ')
    throw new Error(`invalid transcript: ${detail}`)
  }
  return parsed.data
}

/** Parse an untrusted persisted JSON string and validate it as a {@link Transcript}. Throws on bad JSON or shape. */
export function parseTranscriptJson(raw: string): Transcript {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error('invalid transcript: not valid JSON')
  }
  return parseTranscript(value)
}
