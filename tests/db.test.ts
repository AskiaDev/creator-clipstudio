import { afterAll, describe, expect, test } from 'bun:test'
import type { ValidRow } from '../src/csv/parse'
import { openDb } from '../src/db/client'
import { enqueueJobs, listJobs } from '../src/db/jobsRepository'
import { applyMigrations } from '../src/db/migrate'

function row(over: Partial<ValidRow> = {}): ValidRow {
  return {
    fileName: 'clip1.mp4',
    title: 'Title',
    subtitle: 'Subtitle',
    category: 'promo',
    account: 'acme',
    template: 'default',
    sourcePath: '/in/clip1.mp4',
    ...over,
  }
}

const closers: Array<() => void> = []
afterAll(() => {
  for (const close of closers) close()
})

/** Fresh in-memory DB with the REAL committed migration applied. */
function freshDb() {
  const { db, close } = openDb(':memory:')
  applyMigrations(db)
  closers.push(close)
  return db
}

describe('render_jobs enqueue', () => {
  test('applies the migration and round-trips an enqueued job as pending', () => {
    const db = freshDb()

    const inserted = enqueueJobs(db, [row({ fileName: 'clip1.mp4', account: 'acme', category: 'promo' })])
    expect(inserted).toHaveLength(1)

    const jobs = listJobs(db)
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({
      status: 'pending',
      fileName: 'clip1.mp4',
      sourcePath: '/in/clip1.mp4',
      account: 'acme',
      category: 'promo',
      templateKey: 'default',
      attempts: 0,
    })
  })

  test('enqueues nothing for an empty input', () => {
    const db = freshDb()
    expect(enqueueJobs(db, [])).toHaveLength(0)
    expect(listJobs(db)).toHaveLength(0)
  })

  test('enqueues one pending job per valid row', () => {
    const db = freshDb()
    enqueueJobs(db, [row({ fileName: 'clip1.mp4' }), row({ fileName: 'clip2.mp4', sourcePath: '/in/clip2.mp4' })])

    const jobs = listJobs(db)
    expect(jobs).toHaveLength(2)
    expect(jobs.every((j) => j.status === 'pending')).toBe(true)
    expect(jobs.every((j) => j.attempts === 0)).toBe(true)
    expect(jobs.map((j) => j.fileName)).toEqual(['clip1.mp4', 'clip2.mp4'])
  })
})
