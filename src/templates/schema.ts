/**
 * Zod schema for a render template (the source of truth for the template shape).
 *
 * A render template bundles the FFmpeg geometry (canvas/region/fit/background/crf) with the overlay
 * styling. This module is pure (zod only) so the UI route handlers can validate edited configs without
 * pulling the render engine. The inferred overlay shape is structurally compatible with `overlay.ts`.
 */

import { z } from 'zod'

const MAX_CRF = 51

const sizeSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
})

const rectSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
})

const textStyleSchema = z.object({
  fontSizePx: z.number().int().positive(),
  color: z.string().min(1),
  weight: z.union([z.literal(400), z.literal(700)]),
})

const overlayTemplateSchema = z.object({
  canvas: sizeSchema,
  paddingPx: z.number().int().nonnegative(),
  title: textStyleSchema,
  subtitle: textStyleSchema,
  watermark: textStyleSchema,
})

export const templateSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  canvas: sizeSchema,
  region: rectSchema,
  fit: z.enum(['cover', 'contain']),
  background: z.string().min(1),
  crf: z.number().int().min(0).max(MAX_CRF),
  overlay: overlayTemplateSchema,
})

export type RenderTemplate = z.infer<typeof templateSchema>

/** Parse an untrusted template config (e.g. an edited form submission). */
export function parseTemplate(value: unknown) {
  return templateSchema.safeParse(value)
}
