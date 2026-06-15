import { expect, test } from 'bun:test'
import { buildCutArgs, cutClip } from '../src/clip/cut'

test('buildCutArgs uses fast input seek + duration and writes output last', () => {
  const args = buildCutArgs({ source: 'in.mp4', startSec: 30, endSec: 75, output: 'out.mp4', crf: 20 })
  expect(args.slice(0, 4)).toEqual(['-ss', '30', '-i', 'in.mp4'])
  expect(args[args.indexOf('-t') + 1]).toBe('45') // 75 - 30
  expect(args[args.length - 1]).toBe('out.mp4')
  expect(args).toContain('-y')
})

test('cutClip maps a non-zero exit to an error result', async () => {
  const runFfmpeg = async () => ({ exitCode: 1, stderr: 'boom' })
  const res = await cutClip({ source: 'in.mp4', startSec: 0, endSec: 30, output: 'out.mp4', crf: 20 }, runFfmpeg)
  expect(res.ok).toBe(false)
  expect(res.error).toContain('boom')
})

test('cutClip returns the output path on success', async () => {
  const runFfmpeg = async () => ({ exitCode: 0, stderr: '' })
  const res = await cutClip({ source: 'in.mp4', startSec: 0, endSec: 30, output: 'out.mp4', crf: 20 }, runFfmpeg)
  expect(res).toEqual({ ok: true, output: 'out.mp4' })
})
