/**
 * Standalone render worker: drains `render_jobs` one at a time.
 *
 * For each pending job it builds a `RenderRequest` (Phase 4) from the job + its template, calls
 * `renderClip`, then records the outcome to both `render_logs` (DB) and the dated CSV log. One job's
 * failure never aborts the batch (continue-on-failure); a failed job can later be requeued and retried.
 * All spawn/clock/fs/template dependencies are injectable so the loop is unit-testable without ffmpeg.
 */

import type { Db } from '../db/client'
import {
  claimNextPending,
  markJobDone,
  markJobFailed,
  recordRenderLog,
} from '../db/jobsRepository'
import type { RenderJob } from '../db/schema'
import { buildOutputPath } from '../output/paths'
import { type RenderLogEntry, appendRenderLog } from '../output/renderLog'
import { type RenderRequest, renderClip } from '../render/runRender'
import { DEFAULT_RENDER_TEMPLATE, type RenderTemplate, getRenderTemplate } from '../templates/builtins'

export interface WorkerDeps {
  readonly renderClip: typeof renderClip
  readonly getTemplate: (key: string) => RenderTemplate | undefined
  readonly outputRoot: string
  readonly logsDir: string
  readonly now: () => Date
}

export interface DrainResult {
  readonly processed: number
  readonly succeeded: number
  readonly failed: number
}

const DEFAULT_DEPS: WorkerDeps = {
  renderClip,
  getTemplate: getRenderTemplate,
  outputRoot: process.env.OUTPUT_ROOT ?? './output',
  logsDir: process.env.LOGS_DIR ?? './logs',
  now: () => new Date(),
}

function dateStamp(date: Date): string {
  return date.toISOString().slice(0, 10) // YYYY-MM-DD
}

function toRequest(job: RenderJob, template: RenderTemplate, output: string): RenderRequest {
  return {
    videoInput: job.sourcePath,
    output,
    canvas: template.canvas,
    region: template.region,
    fit: template.fit,
    background: template.background,
    crf: template.crf,
    overlay: { title: job.title, subtitle: job.subtitle, watermark: `@${job.account}` },
    template: template.overlay,
  }
}

/** Best-effort CSV log append — a logging failure must never abort the batch. */
function safeAppendLog(logsDir: string, date: string, entry: RenderLogEntry, timestamp: string): void {
  try {
    appendRenderLog(logsDir, date, entry, timestamp)
  } catch (err) {
    console.error(`[worker] failed to write CSV log: ${err instanceof Error ? err.message : String(err)}`)
  }
}

type JobOutcome =
  | { readonly ok: true; readonly output: string }
  | { readonly ok: false; readonly message: string }

/**
 * Drain every pending job sequentially. Returns a tally; never throws on a per-job failure — every
 * throwable step (template lookup, output-path build, render) is guarded so one bad job is recorded
 * as `failed` and the next job continues.
 */
export async function drainQueue(db: Db, overrides: Partial<WorkerDeps> = {}): Promise<DrainResult> {
  const deps: WorkerDeps = { ...DEFAULT_DEPS, ...overrides }
  let processed = 0
  let succeeded = 0
  let failed = 0

  for (let job = claimNextPending(db); job !== null; job = claimNextPending(db)) {
    processed++
    const now = deps.now()
    const date = dateStamp(now)

    let outcome: JobOutcome
    try {
      const template = deps.getTemplate(job.templateKey) ?? DEFAULT_RENDER_TEMPLATE
      const output = buildOutputPath(deps.outputRoot, date, job.account, job.category, job.fileName)
      const result = await deps.renderClip(toRequest(job, template, output))
      outcome = result.ok ? { ok: true, output } : { ok: false, message: `[${result.stage}] ${result.error}` }
    } catch (err) {
      outcome = { ok: false, message: `[worker] ${err instanceof Error ? err.message : String(err)}` }
    }

    const base = { jobId: job.id, fileName: job.fileName, account: job.account, category: job.category }
    if (outcome.ok) {
      succeeded++
      markJobDone(db, job.id, outcome.output)
      recordRenderLog(db, { jobId: job.id, status: 'success', outputPath: outcome.output })
      safeAppendLog(deps.logsDir, date, { ...base, status: 'success', outputPath: outcome.output, message: '' }, now.toISOString())
    } else {
      failed++
      markJobFailed(db, job.id, outcome.message)
      recordRenderLog(db, { jobId: job.id, status: 'failed', message: outcome.message })
      safeAppendLog(deps.logsDir, date, { ...base, status: 'failed', outputPath: '', message: outcome.message }, now.toISOString())
    }
  }

  return { processed, succeeded, failed }
}

if (import.meta.main) {
  const { createDb } = await import('../db/client')
  const { applyMigrations } = await import('../db/migrate')
  const db = createDb()
  applyMigrations(db)
  const result = await drainQueue(db)
  console.log(`[worker] processed ${result.processed} (${result.succeeded} ok, ${result.failed} failed)`)
}
