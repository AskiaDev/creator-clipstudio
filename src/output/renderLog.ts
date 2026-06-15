/**
 * Dated CSV render log: `logs/render-log-{date}.csv`.
 *
 * Crash-safe by design — each job appends exactly one row immediately after it finishes, so an
 * unexpected exit still leaves a complete record of everything done so far. Fields are CSV-escaped.
 */

import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface RenderLogEntry {
  readonly jobId: number
  readonly fileName: string
  readonly account: string
  readonly category: string
  readonly status: 'success' | 'failed'
  readonly outputPath: string
  readonly message: string
}

const LOG_HEADER = [
  'timestamp',
  'job_id',
  'file_name',
  'account',
  'category',
  'status',
  'output_path',
  'message',
] as const

function csvField(value: string | number): string {
  const text = String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function csvRow(values: readonly (string | number)[]): string {
  return values.map(csvField).join(',')
}

/**
 * Append one outcome row, writing the header once when the file is first created.
 * Assumes a single writer (the worker drains sequentially); concurrent writers would race the header.
 */
export function appendRenderLog(
  logsDir: string,
  date: string,
  entry: RenderLogEntry,
  timestamp: string,
): string {
  mkdirSync(logsDir, { recursive: true })
  const file = join(logsDir, `render-log-${date}.csv`)
  if (!existsSync(file)) {
    writeFileSync(file, `${csvRow(LOG_HEADER)}\n`)
  }
  appendFileSync(
    file,
    `${csvRow([
      timestamp,
      entry.jobId,
      entry.fileName,
      entry.account,
      entry.category,
      entry.status,
      entry.outputPath,
      entry.message,
    ])}\n`,
  )
  return file
}
