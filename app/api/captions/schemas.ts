import { z } from 'zod'

/**
 * Zod schemas for POST /api/captions, shared by the route handler and the Studio's transcript JSON
 * loader so both validate the exact same shape (a `Transcript` from src/transcribe/types.ts, plus
 * optional ASS style overrides). Timings are seconds; ASS colours are `&HAABBGGRR` strings.
 */

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

// Partial ASS style overrides. `canvas`, when present, must be a complete {width,height}
// because buildAss shallow-merges it as a whole (see DEFAULT_ASS_STYLE).
export const styleSchema = z
  .object({
    canvas: z.object({ width: z.number().positive(), height: z.number().positive() }),
    fontName: z.string().min(1),
    fontSizePx: z.number().positive(),
    primaryColour: z.string().min(1),
    secondaryColour: z.string().min(1),
    marginVPx: z.number().nonnegative(),
  })
  .partial()

export const bodySchema = z.object({
  transcript: transcriptSchema,
  style: styleSchema.optional(),
})
