/**
 * Repository for the `render_jobs` queue. All `render_jobs` access goes through here — no inline SQL
 * in callers. Phase 6's worker will add claim/complete/fail operations; Phase 5 only enqueues.
 */

import { and, eq } from 'drizzle-orm'
import type { ValidRow } from '../csv/parse'
import type { Db } from './client'
import { type NewRenderJob, type RenderJob, renderJobs, renderLogs } from './schema'

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

/** Atomically claim the oldest pending job: pending → running, attempts + 1. Returns it, or null. */
export function claimNextPending(db: Db): RenderJob | null {
  return db.transaction((tx) => {
    const next = tx
      .select()
      .from(renderJobs)
      .where(eq(renderJobs.status, 'pending'))
      .orderBy(renderJobs.id)
      .limit(1)
      .all()[0]
    if (!next) {
      return null
    }
    const updated = tx
      .update(renderJobs)
      .set({ status: 'running', attempts: next.attempts + 1, updatedAt: new Date() })
      .where(eq(renderJobs.id, next.id))
      .returning()
      .all()
    return updated[0] ?? null
  })
}

/** Mark a job done and record its output path. */
export function markJobDone(db: Db, id: number, outputPath: string): void {
  db.update(renderJobs)
    .set({ status: 'done', outputPath, error: null, updatedAt: new Date() })
    .where(eq(renderJobs.id, id))
    .run()
}

/** Mark a job failed with a diagnostic message. */
export function markJobFailed(db: Db, id: number, error: string): void {
  db.update(renderJobs)
    .set({ status: 'failed', error, updatedAt: new Date() })
    .where(eq(renderJobs.id, id))
    .run()
}

/** Re-enqueue a failed job for another attempt (failed → pending). No-op for non-failed jobs. */
export function requeueJob(db: Db, id: number): void {
  db.update(renderJobs)
    .set({ status: 'pending', error: null, updatedAt: new Date() })
    .where(and(eq(renderJobs.id, id), eq(renderJobs.status, 'failed')))
    .run()
}

export interface RenderLogInput {
  readonly jobId: number
  readonly status: 'success' | 'failed'
  readonly outputPath?: string | null
  readonly message?: string | null
  readonly durationMs?: number | null
}

/** Persist a per-job outcome to `render_logs` (the durable companion to the CSV log). */
export function recordRenderLog(db: Db, entry: RenderLogInput): void {
  db.insert(renderLogs)
    .values({
      jobId: entry.jobId,
      status: entry.status,
      outputPath: entry.outputPath ?? null,
      message: entry.message ?? null,
      durationMs: entry.durationMs ?? null,
    })
    .run()
}
