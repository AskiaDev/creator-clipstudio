import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ValidRow } from '../../src/csv/parse'
import { openDb } from '../../src/db/client'
import { enqueueJobs, listJobs } from '../../src/db/jobsRepository'
import { applyMigrations } from '../../src/db/migrate'
import { drainQueue } from '../../src/queue/worker'
import { probeVideo } from '../../src/render/runRender'

const FIXTURE = join(import.meta.dir, '..', 'fixtures', 'sample-16x9.mp4')
const temps: string[] = []
const closers: Array<() => void> = []
afterAll(() => {
  for (const c of closers) c()
  for (const t of temps) rmSync(t, { recursive: true, force: true })
})
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), 'cc-gw-'))
  temps.push(d)
  return d
}

describe('golden worker (real ffmpeg)', () => {
  test(
    'drains a real job to an organized 1080x1920 output with a success log',
    async () => {
      const { db, close } = openDb(':memory:')
      applyMigrations(db)
      closers.push(close)
      const outputRoot = tempDir()
      const logsDir = tempDir()

      const job: ValidRow = {
        fileName: 'sample.mp4',
        title: 'Worker Title',
        subtitle: 'queued render',
        category: 'promo',
        account: 'acme',
        template: 'default',
        sourcePath: FIXTURE,
      }
      enqueueJobs(db, [job])

      const result = await drainQueue(db, {
        outputRoot,
        logsDir,
        now: () => new Date('2026-06-15T00:00:00Z'),
      })

      expect(result).toEqual({ processed: 1, succeeded: 1, failed: 0 })
      expect(listJobs(db)[0].status).toBe('done')

      // Output landed at the organized dated path...
      const output = join(outputRoot, '2026-06-15', 'acme', 'promo', 'sample_reel.mp4')
      expect(existsSync(output)).toBe(true)

      // ...and ffprobe confirms a real vertical reel with audio.
      const probed = await probeVideo(output)
      expect(probed.ok).toBe(true)
      if (!probed.ok) return
      expect(probed.data.width).toBe(1080)
      expect(probed.data.height).toBe(1920)
      expect(probed.data.hasAudio).toBe(true)

      // ...and the dated CSV log recorded the success.
      const log = readFileSync(join(logsDir, 'render-log-2026-06-15.csv'), 'utf8')
      const lines = log.trim().split('\n')
      expect(lines).toHaveLength(2) // header + exactly one outcome row
      expect(log).toContain('success')
      expect(log).toContain('sample_reel.mp4')
    },
    60_000,
  )
})
