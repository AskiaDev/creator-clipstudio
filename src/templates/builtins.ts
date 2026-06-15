/**
 * Minimal built-in render template for the MVP engine.
 *
 * A render template bundles the FFmpeg geometry (canvas/region/fit/background/crf) with the overlay
 * styling. Phase 8 replaces this with the configurable catalog (2–3 built-ins, a Zod schema, a sample
 * preview, and a form editor); for now the worker needs exactly one resolvable template to render.
 */

import type { FitMode, Rect, Size } from '../render/ffmpegArgs'
import { DEFAULT_OVERLAY_TEMPLATE, type OverlayTemplate } from '../render/overlay'

export interface RenderTemplate {
  readonly key: string
  readonly name: string
  readonly canvas: Size
  readonly region: Rect
  readonly fit: FitMode
  readonly background: string
  readonly crf: number
  readonly overlay: OverlayTemplate
}

const DEFAULT_CRF = 20

/** Centered 960×1100 video window on a 1080×1920 black canvas, with the default text overlay. */
export const DEFAULT_RENDER_TEMPLATE: RenderTemplate = {
  key: 'default',
  name: 'Default (centered window)',
  canvas: { width: 1080, height: 1920 },
  region: { x: 60, y: 460, width: 960, height: 1100 },
  fit: 'cover',
  background: '0x000000',
  crf: DEFAULT_CRF,
  overlay: DEFAULT_OVERLAY_TEMPLATE,
}

const BUILTINS: Readonly<Record<string, RenderTemplate>> = {
  default: DEFAULT_RENDER_TEMPLATE,
}

/** Resolve a render template by key, or `undefined` when unknown. */
export function getRenderTemplate(key: string): RenderTemplate | undefined {
  return BUILTINS[key]
}
