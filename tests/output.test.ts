import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { baseName, buildOutputPath } from '../src/output/paths'
import { appendRenderLog } from '../src/output/renderLog'

const temps: string[] = []
afterAll(() => {
  for (const t of temps) rmSync(t, { recursive: true, force: true })
})
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), 'cc-log-'))
  temps.push(d)
  return d
}

describe('buildOutputPath', () => {
  test('organizes by date/account/category and strips the extension', () => {
    expect(buildOutputPath('/out', '2026-06-15', 'acme', 'promo', 'clip1.mp4')).toBe(
      '/out/2026-06-15/acme/promo/clip1_reel.mp4',
    )
    expect(baseName('clip1.mp4')).toBe('clip1')
  })

  test('refuses unsafe path segments', () => {
    expect(() => buildOutputPath('/out', '2026-06-15', '../evil', 'promo', 'clip1.mp4')).toThrow()
    expect(() => buildOutputPath('/out', '2026-06-15', 'acme', 'promo', '../escape.mp4')).toThrow()
  })
})

describe('appendRenderLog', () => {
  test('writes the header once and appends CSV-escaped rows', () => {
    const dir = tempDir()
    const entry = (over = {}) => ({
      jobId: 1,
      fileName: 'clip1.mp4',
      account: 'acme',
      category: 'promo',
      status: 'success' as const,
      outputPath: '/out/clip1_reel.mp4',
      message: '',
      ...over,
    })

    appendRenderLog(dir, '2026-06-15', entry(), '2026-06-15T10:00:00Z')
    appendRenderLog(dir, '2026-06-15', entry({ jobId: 2, status: 'failed', message: 'ffmpeg said: bad, broken' }), '2026-06-15T10:00:01Z')

    const lines = readFileSync(join(dir, 'render-log-2026-06-15.csv'), 'utf8').trim().split('\n')
    expect(lines).toHaveLength(3) // header + 2 rows
    expect(lines[0]).toBe('timestamp,job_id,file_name,account,category,status,output_path,message')
    // a message with a comma must be quoted so the column count stays intact
    expect(lines[2]).toContain('"ffmpeg said: bad, broken"')
  })
})
