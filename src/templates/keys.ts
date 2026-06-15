/**
 * Canonical render-template keys.
 *
 * A deliberately pure module (no render-engine imports) so the UI route handlers can validate CSV
 * `template` values without dragging satori/resvg into the server bundle. Must stay in sync with the
 * `BUILTINS` map in `builtins.ts` — Phase 8 unifies these when the configurable catalog lands.
 */

export const RENDER_TEMPLATE_KEYS = ['default'] as const

export type RenderTemplateKey = (typeof RENDER_TEMPLATE_KEYS)[number]

export function listRenderTemplateKeys(): string[] {
  return [...RENDER_TEMPLATE_KEYS]
}
