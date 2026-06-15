import { afterAll, describe, expect, test } from 'bun:test'
import { openDb } from '../src/db/client'
import { claimNextPending, markJobDone, markJobFailed, recordRenderLog } from '../src/db/jobsRepository'
import { applyMigrations } from '../src/db/migrate'
import { type FileLister, enqueueBatch, getBatchStatus, runPreflight } from '../src/queue/batch'

const closers: Array<() => void> = []
afterAll(() => {
  for (const close of closers) close()
})
function freshDb() {
  const { db, close } = openDb(':memory:')
  applyMigrations(db)
  closers.push(close)
  return db
}

const FILES = new Map([
  ['a.mp4', '/in/a.mp4'],
  ['b.mp4', '/in/b.mp4'],
])
const lister: FileLister = () => FILES
const HEADER = 'file_name,title,subtitle,category,account,template'
const csv = (...rows: string[]) => [HEADER, ...rows].join('\n')

describe('runPreflight', () => {
  test('partitions valid/invalid using the listed files and known templates', () => {
    const report = runPreflight(
      csv(
        'a.mp4,T,S,promo,acme,plain', // valid
        'missing.mp4,T,S,promo,acme,plain', // file not listed
        'b.mp4,T,S,promo,acme,nope', // unknown template
      ),
      '/in',
      lister,
    )
    expect(report.valid).toHaveLength(1)
    expect(report.valid[0].fileName).toBe('a.mp4')
    expect(report.invalid).toHaveLength(2)
  })
})

describe('enqueueBatch', () => {
  test('enqueues only the valid rows', () => {
    const db = freshDb()
    const result = enqueueBatch(
      db,
      csv('a.mp4,T,S,promo,acme,plain', 'missing.mp4,T,S,promo,acme,plain'),
      '/in',
      lister,
    )
    expect(result.enqueued).toBe(1)
    expect(result.invalid).toHaveLength(1)
    expect(getBatchStatus(db).counts.pending).toBe(1)
  })
})

describe('getBatchStatus', () => {
  test('reports counts and recent logs after a done and a failed job', () => {
    const db = freshDb()
    enqueueBatch(db, csv('a.mp4,T,S,promo,acme,plain', 'b.mp4,T,S,promo,acme,plain'), '/in', lister)

    const first = claimNextPending(db)
    if (!first) throw new Error('expected a job to claim')
    markJobDone(db, first.id, '/out/a_reel.mp4')
    recordRenderLog(db, { jobId: first.id, status: 'success', outputPath: '/out/a_reel.mp4' })

    const second = claimNextPending(db)
    if (!second) throw new Error('expected a second job to claim')
    markJobFailed(db, second.id, 'boom')
    recordRenderLog(db, { jobId: second.id, status: 'failed', message: 'boom' })

    const status = getBatchStatus(db)
    expect(status.counts).toMatchObject({ pending: 0, running: 0, done: 1, failed: 1 })
    expect(status.recent).toHaveLength(2)
    expect(status.recent[0].status).toBe('failed') // newest first
  })
})

describe('safety', () => {
  test('a traversal-unsafe file name cannot produce a valid job even when the file is listed', () => {
    const files = new Map([['../evil.mp4', '/in/../evil.mp4']])
    const report = runPreflight(csv('../evil.mp4,T,S,promo,acme,plain'), '/in', () => files)
    expect(report.valid).toHaveLength(0)
    expect(report.invalid).toHaveLength(1)
  })
})
