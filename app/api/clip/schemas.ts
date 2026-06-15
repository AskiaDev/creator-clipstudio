/**
 * Request validation for the clip API. Mirrors `app/api/preflight/route.ts` (Zod at the boundary).
 *
 * `fileName` and clip `name` build real filesystem paths, so they are constrained to safe path segments
 * (reusing the renderer's {@link isSafeSegment}): they cannot contain separators or `..`, so they can never
 * escape the operator-chosen `inputFolder` (for the source) or the output dir (for cut files).
 *
 * `inputFolder` is intentionally an operator-chosen path (validated only as non-empty) — the SAME trust
 * model as the existing renderer `enqueue`/`preflight` routes. This app assumes a trusted local operator;
 * it is not hardened for untrusted multi-tenant exposure. (Flagged for human review; consistent app-wide.)
 */

import { z } from 'zod'
import { isSafeSegment } from '@/src/csv/schema'

const wordSchema = z.object({ text: z.string(), startSec: z.number(), endSec: z.number() })
const segmentSchema = z.object({
  startSec: z.number(),
  endSec: z.number(),
  text: z.string(),
  words: z.array(wordSchema),
})
const transcriptSchema = z.object({
  durationSec: z.number().positive(),
  segments: z.array(segmentSchema),
})

const safeSegment = (label: string) =>
  z
    .string()
    .min(1, `${label} is required`)
    .refine(isSafeSegment, { message: `${label} must not contain path separators or '..'` })

export const suggestBodySchema = z.object({
  transcript: transcriptSchema,
  videoDurationSec: z.number().positive(),
  options: z
    .object({
      count: z.number().int().positive(),
      minSec: z.number().positive(),
      maxSec: z.number().positive(),
      style: z.enum(['informational', 'viral', 'educational']),
    })
    .optional(),
})

export const cutBodySchema = z.object({
  inputFolder: z.string().min(1),
  fileName: safeSegment('fileName'),
  ranges: z
    .array(
      z.object({
        startSec: z.number().nonnegative(),
        endSec: z.number().positive(),
        name: safeSegment('name'),
      }),
    )
    .min(1),
})
