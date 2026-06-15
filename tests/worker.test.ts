import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ValidRow } from '../src/csv/parse'
import { openDb } from '../src/db/client'
import { claimNextPending, enqueueJobs, listJobs, markJobDone, markJobFailed, requeueJob } from '../src/db/jobsRepository'
import { applyMigrations } from '../src/db/migrate'
import { drainQueue } from '../src/queue/worker'
import type { RenderRequest, RenderResult } from '../src/render/runRender'

const closers: Array<() => void> = []
const temps: string[] = []
afterAll(() => {
  for (const c of closers) c()
  for (const t of temps) rmSync(t, { recursive: true, force: true })
})

function freshDb() {
  const { db, close } = openDb(':memory:')
  applyMigrations(db)
  closers.push(close)
  return db
}
function tempDir() {
  const d = mkdtempSync(join(tmpdir(), 'cc-wk-'))
  temps.push(d)
  return d
}
function row(over: Partial<ValidRow> = {}): ValidRow {
  return {
    fileName: 'clip.mp4',
    title: 'T',
    subtitle: 'S',
    category: 'promo',
    account: 'acme',
    template: 'default',
    sourcePath: '/in/clip.mp4',
    ...over,
  }
}

const FIXED_NOW = () => new Date('2026-06-15T10:00:00Z')
const succeed = async (req: RenderRequest): Promise<RenderResult> => ({
  ok: true,
  output: req.output,
  probe: { durationSec: 1, width: 1080, height: 1920, hasAudio: true },
})

describe('jobsRepository worker ops', () => {
  test('claimNextPending moves pending → running and increments attempts; null when empty', () => {
    const db = freshDb()
    enqueueJobs(db, [row()])
    const claimed = claimNextPending(db)
    expect(claimed?.status).toBe('running')
    expect(claimed?.attempts).toBe(1)
    expect(claimNextPending(db)).toBeNull()
  })

  test('markJobDone / markJobFailed / requeueJob transition status', () => {
    const db = freshDb()
    enqueueJobs(db, [row()])
    const job = claimNextPending(db)
    if (!job) throw new Error('expected a claimed job')

    markJobFailed(db, job.id, 'err')
    expect(listJobs(db)[0].status).toBe('failed')

    requeueJob(db, job.id)
    expect(listJobs(db)[0].status).toBe('pending')

    const again = claimNextPending(db)
    if (!again) throw new Error('expected to reclaim the requeued job')
    markJobDone(db, again.id, '/out/x_reel.mp4')
    expect(listJobs(db)[0]).toMatchObject({ status: 'done', outputPath: '/out/x_reel.mp4' })
  })
})

describe('drainQueue', () => {
  test('continues past a failing job: others succeed and every outcome is logged', async () => {
    const db = freshDb()
    const outputRoot = tempDir()
    const logsDir = tempDir()
    enqueueJobs(db, [
      row({ fileName: 'a.mp4', sourcePath: '/in/a.mp4' }),
      row({ fileName: 'broken.mp4', sourcePath: '/in/broken.mp4' }),
      row({ fileName: 'c.mp4', sourcePath: '/in/c.mp4' }),
    ])

    const renderClip = async (req: RenderRequest): Promise<RenderResult> =>
      req.videoInput.includes('broken')
        ? { ok: false, stage: 'ffmpeg', error: 'boom' }
        : { ok: true, output: req.output, probe: { durationSec: 1, width: 1080, height: 1920, hasAudio: true } }

    const result = await drainQueue(db, { renderClip, outputRoot, logsDir, now: FIXED_NOW })

    expect(result).toEqual({ processed: 3, succeeded: 2, failed: 1 })
    const jobs = listJobs(db)
    expect(jobs.filter((j) => j.status === 'done')).toHaveLength(2)
    expect(jobs.filter((j) => j.status === 'failed')).toHaveLength(1)

    // dated CSV log: header + 3 outcome rows
    const lines = readFileSync(join(logsDir, 'render-log-2026-06-15.csv'), 'utf8').trim().split('\n')
    expect(lines).toHaveLength(4)
    expect(lines.filter((l) => l.includes('failed'))).toHaveLength(1)
  })

  test('continues when a job THROWS (not just returns a failure result)', async () => {
    const db = freshDb()
    const outputRoot = tempDir()
    const logsDir = tempDir()
    enqueueJobs(db, [
      row({ fileName: 'a.mp4', sourcePath: '/in/a.mp4' }),
      row({ fileName: 'throws.mp4', sourcePath: '/in/throws.mp4' }),
      row({ fileName: 'c.mp4', sourcePath: '/in/c.mp4' }),
    ])

    const renderClip = async (req: RenderRequest): Promise<RenderResult> => {
      if (req.videoInput.includes('throws')) throw new Error('unexpected boom')
      return { ok: true, output: req.output, probe: { durationSec: 1, width: 1080, height: 1920, hasAudio: true } }
    }

    const result = await drainQueue(db, { renderClip, outputRoot, logsDir, now: FIXED_NOW })
    expect(result).toEqual({ processed: 3, succeeded: 2, failed: 1 })
    const thrown = listJobs(db).find((j) => j.fileName === 'throws.mp4')
    expect(thrown?.status).toBe('failed')
    expect(thrown?.error).toContain('unexpected boom')
  })

  test('retry: a failed job requeued then drained succeeds', async () => {
    const db = freshDb()
    const outputRoot = tempDir()
    const logsDir = tempDir()
    enqueueJobs(db, [row({ fileName: 'r.mp4', sourcePath: '/in/r.mp4' })])

    const fail = async (): Promise<RenderResult> => ({ ok: false, stage: 'ffmpeg', error: 'boom' })
    await drainQueue(db, { renderClip: fail, outputRoot, logsDir, now: FIXED_NOW })
    expect(listJobs(db)[0].status).toBe('failed')

    requeueJob(db, listJobs(db)[0].id)
    const result = await drainQueue(db, { renderClip: succeed, outputRoot, logsDir, now: FIXED_NOW })
    expect(result.succeeded).toBe(1)
    expect(listJobs(db)[0].status).toBe('done')
  })
})
