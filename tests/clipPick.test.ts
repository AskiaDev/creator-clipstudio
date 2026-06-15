import { expect, test } from 'bun:test'
import { pickClips } from '../src/clip/pick'
import { type ClipPickerInput, DEFAULT_CLIP_OPTIONS } from '../src/clip/types'
import fixture from './fixtures/transcript-clip.json'

const input: ClipPickerInput = {
  transcript: fixture,
  videoDurationSec: 120,
  options: DEFAULT_CLIP_OPTIONS,
}

test('pickClips returns parsed candidates from the model output', async () => {
  const callModel = async () =>
    JSON.stringify([{ startSec: 8, endSec: 45, title: 'Founder mistake', score: 88, reason: 'hook' }])
  const out = await pickClips(input, { callModel })
  expect(out).toHaveLength(1)
  expect(out[0].title).toBe('Founder mistake')
})

test('pickClips chunks long transcripts and logs it', async () => {
  const long = {
    durationSec: 1500,
    segments: Array.from({ length: 150 }, (_v, i) => ({
      startSec: i * 10,
      endSec: i * 10 + 10,
      text: `seg ${i}`,
      words: [],
    })),
  }
  const logs: string[] = []
  let calls = 0
  const callModel = async () => {
    calls++
    return '[]'
  }
  await pickClips(
    { ...input, transcript: long, videoDurationSec: 1500 },
    { callModel, log: (m) => logs.push(m), chunkOptions: { windowSec: 600, overlapSec: 60 } },
  )
  expect(calls).toBeGreaterThan(1)
  expect(logs.some((l) => l.includes('windows'))).toBe(true)
})

test('pickClips logs the global cross-window merge (no silent caps)', async () => {
  const long = {
    durationSec: 300,
    segments: Array.from({ length: 30 }, (_v, i) => ({
      startSec: i * 10,
      endSec: i * 10 + 10,
      text: `seg ${i}`,
      words: [],
    })),
  }
  const logs: string[] = []
  // Every window returns the same range → heavy cross-window overlap that the global merge must report.
  const callModel = async () =>
    JSON.stringify([{ startSec: 50, endSec: 90, title: 'dup', score: 80, reason: 'r' }])
  const out = await pickClips(
    { ...input, transcript: long, videoDurationSec: 300 },
    { callModel, log: (m) => logs.push(m), chunkOptions: { windowSec: 100, overlapSec: 80 } },
  )
  expect(out.length).toBeGreaterThan(0)
  expect(logs.some((l) => l.includes('global merge'))).toBe(true)
})
