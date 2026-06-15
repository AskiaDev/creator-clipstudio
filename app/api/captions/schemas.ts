import { z } from 'zod'
import { segmentSchema, transcriptSchema, wordSchema } from '@/src/transcribe/schema'

/**
 * Zod schemas for POST /api/captions. The transcript shape is the canonical validator from
 * `src/transcribe/schema` (the same one the render worker uses on read), re-exported here so the route
 * handler and the Studio's transcript JSON loader keep importing it from one place. This file owns only
 * the API-specific additions: optional ASS style overrides and the request body envelope.
 */

export { wordSchema, segmentSchema, transcriptSchema }

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
