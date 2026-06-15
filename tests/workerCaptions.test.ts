import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type Db, openDb } from '../src/db/client'
import { listJobs } from '../src/db/jobsRepository'
import { applyMigrations } from '../src/db/migrate'
import { type NewRenderJob, renderJobs } from '../src/db/schema'
import { drainQueue } from '../src/queue/worker'
import type { RenderRequest, RenderResult } from '../src/render/runRender'
import { DEFAULT_RENDER_TEMPLATE, getRenderTemplate } from '../src/templates/builtins'

const closers: Array<() => void> = []
const temps: string[] = []
afterAll(() => {
  for (const c of closers) c()
  for (const t of temps) rmSync(t, { recursive: true, force: true })
})

function freshDb(): Db {
  const { db, close } = openDb(':memory:')
  applyMigrations(db)
  closers.push(close)
  return db
}
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'cc-wkc-'))
  temps.push(d)
  return d
}
function insertJob(db: Db, over: Partial<NewRenderJob> = {}): void {
  db.insert(renderJobs)
    .values({ fileName: 'c.mp4', sourcePath: '/in/c.mp4', account: 'acme', category: 'promo', templateKey: 'default', ...over })
    .run()
}

const FIXED_NOW = () => new Date('2026-06-15T10:00:00Z')
const PROBE = { durationSec: 1, width: 1080, height: 1920, hasAudio: true }
const TRANSCRIPT = {
  durationSec: 2,
  segments: [
    {
      startSec: 0,
      endSec: 2,
      text: 'hello world',
      words: [
        { text: 'hello', startSec: 0, endSec: 1 },
        { text: 'world', startSec: 1, endSec: 2 },
      ],
    },
  ],
}

describe('drainQueue captions burn-in', () => {
  test('builds an ASS and passes subtitlePath when the job carries captions_transcript', async () => {
    const db = freshDb()
    insertJob(db, { captionsTranscript: JSON.stringify(TRANSCRIPT) })
    let subtitlePath: string | undefined
    let ass = ''
    const renderClip = async (req: RenderRequest): Promise<RenderResult> => {
      subtitlePath = req.subtitlePath
      if (req.subtitlePath) ass = readFileSync(req.subtitlePath, 'utf8')
      return { ok: true, output: req.output, probe: PROBE }
    }

    const result = await drainQueue(db, { renderClip, outputRoot: tempDir(), logsDir: tempDir(), now: FIXED_NOW })

    expect(result.succeeded).toBe(1)
    expect(subtitlePath).toBeDefined()
    expect(ass).toContain('[Script Info]')
    expect(ass).toContain('{\\k') // karaoke tags generated from the transcript words
  })

  test('passes no subtitlePath when captions_transcript is null (byte-identical render path)', async () => {
    const db = freshDb()
    insertJob(db) // no captions
    let seen: string | undefined = 'SENTINEL'
    const renderClip = async (req: RenderRequest): Promise<RenderResult> => {
      seen = req.subtitlePath
      return { ok: true, output: req.output, probe: PROBE }
    }

    await drainQueue(db, { renderClip, outputRoot: tempDir(), logsDir: tempDir(), now: FIXED_NOW })

    expect(seen).toBeUndefined()
  })

  test('a malformed captions_transcript fails only that job; the drain continues', async () => {
    const db = freshDb()
    insertJob(db, { fileName: 'bad.mp4', sourcePath: '/in/bad.mp4', captionsTranscript: '{ not valid json' })
    insertJob(db, { fileName: 'good.mp4', sourcePath: '/in/good.mp4' })
    const renderClip = async (req: RenderRequest): Promise<RenderResult> => ({ ok: true, output: req.output, probe: PROBE })

    const result = await drainQueue(db, { renderClip, outputRoot: tempDir(), logsDir: tempDir(), now: FIXED_NOW })

    expect(result).toEqual({ processed: 2, succeeded: 1, failed: 1 })
    const jobs = listJobs(db)
    expect(jobs.find((j) => j.fileName === 'bad.mp4')?.status).toBe('failed')
    expect(jobs.find((j) => j.fileName === 'bad.mp4')?.error?.toLowerCase()).toContain('transcript')
    expect(jobs.find((j) => j.fileName === 'good.mp4')?.status).toBe('done')
  })

  test('sizes the ASS canvas to the resolved job template (captions match the output resolution)', async () => {
    const db = freshDb()
    insertJob(db, { captionsTranscript: JSON.stringify(TRANSCRIPT) })
    const { width, height } = (getRenderTemplate('default') ?? DEFAULT_RENDER_TEMPLATE).canvas
    let ass = ''
    const renderClip = async (req: RenderRequest): Promise<RenderResult> => {
      if (req.subtitlePath) ass = readFileSync(req.subtitlePath, 'utf8')
      return { ok: true, output: req.output, probe: PROBE }
    }

    await drainQueue(db, { renderClip, outputRoot: tempDir(), logsDir: tempDir(), now: FIXED_NOW })

    expect(ass).toContain(`PlayResX: ${width}`)
    expect(ass).toContain(`PlayResY: ${height}`)
  })
})
