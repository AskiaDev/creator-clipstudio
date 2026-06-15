/**
 * Built-in render templates (the catalog the worker/preview resolve against).
 *
 * Three distinct compositions so template selection visibly changes the output. Each is typed against
 * the Zod-derived `RenderTemplate` and keyed by `RenderTemplateKey`, so the catalog is exhaustive.
 * Phase 8's DB layer can override any of these by key; these remain the seed + fallback.
 */

// Pure module: every import is type-only (erased), so the render engine (satori/resvg) is never loaded
// here — the UI route handlers can read the catalog without bundling/loading the renderer.
import type { RenderTemplateKey } from './keys'
import type { RenderTemplate } from './schema'

const DEFAULT_CRF = 20
const CANVAS = { width: 1080, height: 1920 } as const

function overlay(
  title: { fontSizePx: number; color: string },
  subtitle: { fontSizePx: number; color: string },
  watermark: { fontSizePx: number; color: string },
  paddingPx = 72,
): RenderTemplate['overlay'] {
  return {
    canvas: CANVAS,
    paddingPx,
    title: { ...title, weight: 700 },
    subtitle: { ...subtitle, weight: 400 },
    watermark: { ...watermark, weight: 400 },
  }
}

export const BUILTIN_TEMPLATES: Record<RenderTemplateKey, RenderTemplate> = {
  // Full-frame: the clip fills the whole vertical canvas; text sits over it.
  plain: {
    key: 'plain',
    name: 'Plain (full frame)',
    canvas: { width: 1080, height: 1920 },
    region: { x: 0, y: 0, width: 1080, height: 1920 },
    fit: 'cover',
    background: '0x000000',
    crf: DEFAULT_CRF,
    overlay: overlay({ fontSizePx: 72, color: '#ffffff' }, { fontSizePx: 42, color: '#f2f2f2' }, { fontSizePx: 30, color: 'rgba(255,255,255,0.8)' }),
  },
  // Windowed promo: the clip sits in a centered window on a brand background; bold headline.
  course_promo: {
    key: 'course_promo',
    name: 'Course promo (windowed)',
    canvas: { width: 1080, height: 1920 },
    region: { x: 60, y: 460, width: 960, height: 1100 },
    fit: 'cover',
    background: '0x101826',
    crf: DEFAULT_CRF,
    overlay: overlay({ fontSizePx: 84, color: '#ffffff' }, { fontSizePx: 44, color: '#cfd8e6' }, { fontSizePx: 32, color: 'rgba(255,255,255,0.82)' }),
  },
  // Caption: a square clip up top, large caption space below on black.
  podcast_caption: {
    key: 'podcast_caption',
    name: 'Podcast caption (square + caption)',
    canvas: { width: 1080, height: 1920 },
    region: { x: 0, y: 0, width: 1080, height: 1080 },
    fit: 'cover',
    background: '0x000000',
    crf: DEFAULT_CRF,
    overlay: overlay({ fontSizePx: 64, color: '#ffe08a' }, { fontSizePx: 52, color: '#ffffff' }, { fontSizePx: 30, color: 'rgba(255,255,255,0.7)' }, 64),
  },
}

/** Resolve a built-in render template by key, or `undefined` when unknown. */
export function getRenderTemplate(key: string): RenderTemplate | undefined {
  return BUILTIN_TEMPLATES[key as RenderTemplateKey]
}

/** The fallback template the worker uses when a job's key is unknown. */
export const DEFAULT_RENDER_TEMPLATE: RenderTemplate = BUILTIN_TEMPLATES.plain

/** Re-export the schema type so existing importers (worker) keep one import site. */
export type { RenderTemplate } from './schema'
