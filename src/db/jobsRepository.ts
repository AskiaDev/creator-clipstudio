/**
 * Repository for the `render_jobs` queue. All `render_jobs` access goes through here — no inline SQL
 * in callers. Phase 6's worker will add claim/complete/fail operations; Phase 5 only enqueues.
 */

import type { ValidRow } from '../csv/parse'
import type { Db } from './client'
import { type NewRenderJob, type RenderJob, renderJobs } from './schema'

/**
 * Insert one `pending` job per valid CSV row. Returns the inserted rows (empty input → no-op).
 * Note: a single very large batch could exceed SQLite's bound-parameter limit; Phase 6 should chunk if needed.
 */
export function enqueueJobs(db: Db, rows: readonly ValidRow[]): RenderJob[] {
  if (rows.length === 0) {
    return []
  }
  const values: NewRenderJob[] = rows.map((row) => ({
    status: 'pending',
    fileName: row.fileName,
    sourcePath: row.sourcePath,
    title: row.title,
    subtitle: row.subtitle,
    account: row.account,
    category: row.category,
    templateKey: row.template,
  }))
  return db.insert(renderJobs).values(values).returning().all()
}

/** All jobs, oldest first. */
export function listJobs(db: Db): RenderJob[] {
  return db.select().from(renderJobs).orderBy(renderJobs.id).all()
}
