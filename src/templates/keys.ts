/**
 * Canonical render-template keys.
 *
 * A deliberately pure module (no render-engine imports) so the UI route handlers can validate CSV
 * `template` values without dragging satori/resvg into the server bundle. `builtins.ts` provides a
 * `Record<RenderTemplateKey, RenderTemplate>`, so the type system guarantees every key has a template.
 */

export const RENDER_TEMPLATE_KEYS = ['plain', 'course_promo', 'podcast_caption'] as const

export type RenderTemplateKey = (typeof RENDER_TEMPLATE_KEYS)[number]

export const DEFAULT_TEMPLATE_KEY: RenderTemplateKey = 'plain'

export function listRenderTemplateKeys(): string[] {
  return [...RENDER_TEMPLATE_KEYS]
}

export function isRenderTemplateKey(value: string): value is RenderTemplateKey {
  return (RENDER_TEMPLATE_KEYS as readonly string[]).includes(value)
}
