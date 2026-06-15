import { afterAll, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cutClip } from '../../src/clip/cut'

const FIXTURE = join(import.meta.dir, '..', 'fixtures', 'sample-16x9.mp4')
const dir = mkdtempSync(join(tmpdir(), 'cc-cut-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const GOLDEN_TIMEOUT_MS = 60_000

test(
  'cutClip produces a ~1s clip from the committed fixture',
  async () => {
    const out = join(dir, 'cut.mp4')
    const res = await cutClip({ source: FIXTURE, startSec: 0, endSec: 1, output: out, crf: 20 })
    expect(res.ok).toBe(true)
    const probe = Bun.spawnSync([
      'ffprobe',
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'csv=p=0',
      out,
    ])
    const duration = Number.parseFloat(probe.stdout.toString().trim())
    expect(duration).toBeGreaterThan(0.4)
    expect(duration).toBeLessThan(1.6)
  },
  GOLDEN_TIMEOUT_MS,
)
