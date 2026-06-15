import { expect, test } from 'bun:test'
import { cutBodySchema, suggestBodySchema } from '../app/api/clip/schemas'
import fixture from './fixtures/transcript-clip.json'

test('suggest body requires a transcript + duration', () => {
  expect(suggestBodySchema.safeParse({ transcript: fixture, videoDurationSec: 120 }).success).toBe(true)
  expect(suggestBodySchema.safeParse({}).success).toBe(false)
})

test('cut body requires folder, file, and ranges', () => {
  const ok = cutBodySchema.safeParse({
    inputFolder: '/clips',
    fileName: 'a.mp4',
    ranges: [{ startSec: 0, endSec: 30, name: 'clip1' }],
  })
  expect(ok.success).toBe(true)
  expect(cutBodySchema.safeParse({ inputFolder: '/clips', fileName: 'a.mp4', ranges: [] }).success).toBe(false)
})
