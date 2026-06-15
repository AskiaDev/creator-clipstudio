/**
 * Drizzle SQLite schema for CreatorClip Studio.
 *
 * Four tables: `media_files` (probed source clips), `templates` (overlay configs), `render_jobs`
 * (the work queue the worker drains), and `render_logs` (crash-safe per-job outcomes). The runtime
 * opens this via `bun:sqlite`; `drizzle-kit` generates migrations into `drizzle/`.
 */

import { sql } from 'drizzle-orm'
import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

const timestamp = (name: string) =>
  integer(name, { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`)

/** A source clip the user provided, optionally enriched with ffprobe data. */
export const mediaFiles = sqliteTable('media_files', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  fileName: text('file_name').notNull(),
  path: text('path').notNull(),
  durationSec: real('duration_sec'),
  width: integer('width'),
  height: integer('height'),
  hasAudio: integer('has_audio', { mode: 'boolean' }),
  createdAt: timestamp('created_at'),
})

/** A named overlay template; `config` holds the serialized `OverlayTemplate`. */
export const templates = sqliteTable('templates', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  config: text('config', { mode: 'json' }).notNull(),
  createdAt: timestamp('created_at'),
})

/** The render work queue. One row per valid CSV row; the worker (Phase 6) drains it. */
export const renderJobs = sqliteTable('render_jobs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  status: text('status', { enum: ['pending', 'running', 'done', 'failed'] })
    .notNull()
    .default('pending'),
  fileName: text('file_name').notNull(),
  sourcePath: text('source_path').notNull(),
  title: text('title').notNull().default(''),
  subtitle: text('subtitle').notNull().default(''),
  account: text('account').notNull(),
  category: text('category').notNull(),
  templateKey: text('template_key').notNull(),
  /**
   * The edited Transcript (Phase 3 captions) as a JSON string, or null for no burned-in captions.
   * Deliberately plain TEXT (not drizzle `mode: 'json'`): the worker treats it as untrusted and
   * JSON-parses + Zod-validates it per job, so a single corrupt row fails only that job instead of
   * throwing inside the claim-select and aborting the whole drain.
   */
  captionsTranscript: text('captions_transcript'),
  outputPath: text('output_path'),
  attempts: integer('attempts').notNull().default(0),
  error: text('error'),
  createdAt: timestamp('created_at'),
  updatedAt: timestamp('updated_at'),
})

/** Crash-safe per-job outcome log (Phase 6 writes these as the worker runs). */
export const renderLogs = sqliteTable('render_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  jobId: integer('job_id')
    .notNull()
    .references(() => renderJobs.id),
  status: text('status', { enum: ['success', 'failed'] }).notNull(),
  outputPath: text('output_path'),
  message: text('message'),
  durationMs: integer('duration_ms'),
  createdAt: timestamp('created_at'),
})

export type RenderJob = typeof renderJobs.$inferSelect
export type NewRenderJob = typeof renderJobs.$inferInsert
