/**
 * Repository for the `templates` table. The built-ins are the seed + fallback; edited configs are
 * persisted here and override the built-in for the same key. Every read re-validates the stored JSON
 * against `templateSchema`, so a hand-edited DB row can never feed a malformed template to the renderer.
 */

import { eq } from 'drizzle-orm'
import { BUILTIN_TEMPLATES } from '../templates/builtins'
import { parseTemplate, type RenderTemplate } from '../templates/schema'
import type { Db } from './client'
import { templates } from './schema'

export type UpsertResult =
  | { readonly ok: true; readonly template: RenderTemplate }
  | { readonly ok: false; readonly error: string }

function formatIssues(parsed: ReturnType<typeof parseTemplate>): string {
  return parsed.success
    ? ''
    : parsed.error.issues.map((issue) => `${issue.path.join('.') || 'config'}: ${issue.message}`).join('; ')
}

/** Insert any built-in not already present (per-key idempotent seed; survives custom rows). */
export function seedTemplates(db: Db): void {
  for (const template of Object.values(BUILTIN_TEMPLATES)) {
    const exists = db.select({ id: templates.id }).from(templates).where(eq(templates.key, template.key)).limit(1).all()[0]
    if (!exists) {
      db.insert(templates).values({ key: template.key, name: template.name, config: template }).run()
    }
  }
}

/** All persisted templates that still pass validation, oldest first. */
export function listTemplates(db: Db): RenderTemplate[] {
  return db
    .select()
    .from(templates)
    .orderBy(templates.id)
    .all()
    .map((row) => parseTemplate(row.config))
    .filter((parsed) => parsed.success)
    .map((parsed) => parsed.data)
}

/** A persisted template by key (re-validated), or `undefined` if absent/invalid. */
export function getTemplate(db: Db, key: string): RenderTemplate | undefined {
  const row = db.select().from(templates).where(eq(templates.key, key)).limit(1).all()[0]
  if (!row) {
    return undefined
  }
  const parsed = parseTemplate(row.config)
  return parsed.success ? parsed.data : undefined
}

/** Validate an edited config and upsert it by key. Invalid configs are rejected, never persisted. */
export function upsertTemplate(db: Db, value: unknown): UpsertResult {
  const parsed = parseTemplate(value)
  if (!parsed.success) {
    return { ok: false, error: formatIssues(parsed) }
  }
  const template = parsed.data
  const exists = db.select({ id: templates.id }).from(templates).where(eq(templates.key, template.key)).limit(1).all()[0]
  if (exists) {
    db.update(templates).set({ name: template.name, config: template }).where(eq(templates.key, template.key)).run()
  } else {
    db.insert(templates).values({ key: template.key, name: template.name, config: template }).run()
  }
  return { ok: true, template }
}
