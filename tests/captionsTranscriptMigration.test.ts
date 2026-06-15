import { afterAll, describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { type Db, openDb } from '../src/db/client'
import { applyMigrations } from '../src/db/migrate'
import { renderJobs } from '../src/db/schema'

const closers: Array<() => void> = []
afterAll(() => {
  for (const c of closers) c()
})

/** Fresh in-memory DB with the REAL committed migrations applied. */
function freshDb(): Db {
  const { db, close } = openDb(':memory:')
  applyMigrations(db)
  closers.push(close)
  return db
}

function columnNames(db: Db): string[] {
  const rows = db.all(sql`PRAGMA table_info(render_jobs)`) as Array<{ name: string }>
  return rows.map((r) => r.name)
}

const REQUIRED = { account: 'acme', category: 'promo', templateKey: 'default' }

describe('captions_transcript migration (additive + reversible)', () => {
  test('up: render_jobs gains a captions_transcript column', () => {
    expect(columnNames(freshDb())).toContain('captions_transcript')
  })

  test('up: a job round-trips its captions_transcript JSON, and absent → null', () => {
    const db = freshDb()
    const payload = JSON.stringify({ durationSec: 3, segments: [] })
    db.insert(renderJobs).values({ fileName: 'a.mp4', sourcePath: '/in/a.mp4', captionsTranscript: payload, ...REQUIRED }).run()
    db.insert(renderJobs).values({ fileName: 'b.mp4', sourcePath: '/in/b.mp4', ...REQUIRED }).run()

    const rows = db.select().from(renderJobs).orderBy(renderJobs.id).all()
    expect(rows[0].captionsTranscript).toBe(payload)
    expect(rows[1].captionsTranscript).toBeNull()
  })

  test('down: dropping captions_transcript is reversible and leaves the rest of the table intact', () => {
    const db = freshDb()
    db.insert(renderJobs).values({ fileName: 'a.mp4', sourcePath: '/in/a.mp4', ...REQUIRED }).run()

    // The additive migration is reversible: SQLite (>= 3.35, bundled in bun:sqlite) supports DROP COLUMN.
    db.run(sql`ALTER TABLE render_jobs DROP COLUMN captions_transcript`)

    expect(columnNames(db)).not.toContain('captions_transcript')
    const rows = db.all(sql`SELECT file_name, status FROM render_jobs`) as Array<{ file_name: string; status: string }>
    expect(rows).toHaveLength(1)
    expect(rows[0].file_name).toBe('a.mp4')
    expect(rows[0].status).toBe('pending')
  })
})
