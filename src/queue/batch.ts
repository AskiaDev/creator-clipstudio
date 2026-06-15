/**
 * Batch service: the testable composition the thin route handlers delegate to.
 *
 * Lists video files in the input folder, runs the CSV pre-flight (Phase 5), enqueues the valid rows,
 * and reads job status. The filesystem lister is injectable so the logic is unit-testable without disk.
 */

import { readdirSync } from 'node:fs'
import { extname, join } from 'node:path'
import { buildPreflight, type PreflightReport } from '../csv/parse'
import type { Db } from './../db/client'
import { enqueueJobs, listJobs, listRecentRenderLogs, type RecentRenderLog } from '../db/jobsRepository'
import { listRenderTemplateKeys } from '../templates/keys'

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv'])
const RECENT_LOG_LIMIT = 25

/** Map a folder to `{ fileName → absolutePath }` for the video files it contains. */
export type FileLister = (folder: string) => Map<string, string>

const defaultLister: FileLister = (folder) => {
  const files = new Map<string, string>()
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (entry.isFile() && VIDEO_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      files.set(entry.name, join(folder, entry.name))
    }
  }
  return files
}

/** Validate a CSV against the folder's files + known templates, returning the pre-flight report. */
export function runPreflight(
  csvText: string,
  inputFolder: string,
  lister: FileLister = defaultLister,
): PreflightReport {
  const files = lister(inputFolder)
  return buildPreflight(csvText, files, new Set(listRenderTemplateKeys()))
}

export interface EnqueueBatchResult {
  readonly enqueued: number
  readonly invalid: PreflightReport['invalid']
}

/** Pre-flight, then enqueue only the valid rows. Invalid rows are reported, never enqueued. */
export function enqueueBatch(
  db: Db,
  csvText: string,
  inputFolder: string,
  lister: FileLister = defaultLister,
): EnqueueBatchResult {
  const report = runPreflight(csvText, inputFolder, lister)
  const inserted = enqueueJobs(db, report.valid)
  return { enqueued: inserted.length, invalid: report.invalid }
}

export interface BatchStatus {
  readonly counts: { readonly pending: number; readonly running: number; readonly done: number; readonly failed: number }
  readonly recent: readonly RecentRenderLog[]
}

/** Status snapshot for the UI: job counts by state + the most recent outcome logs. */
export function getBatchStatus(db: Db): BatchStatus {
  // Small batches: a full scan is fine. TODO(phase 8): aggregate via GROUP BY status if batches grow.
  const jobs = listJobs(db)
  const countOf = (status: keyof BatchStatus['counts']): number =>
    jobs.filter((job) => job.status === status).length
  const counts = {
    pending: countOf('pending'),
    running: countOf('running'),
    done: countOf('done'),
    failed: countOf('failed'),
  }
  return { counts, recent: listRecentRenderLogs(db, RECENT_LOG_LIMIT) }
}
