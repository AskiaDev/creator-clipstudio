import { expect, test } from 'bun:test'
import { buildClipPrompt, formatTimestamp } from '../src/clip/prompt'
import { DEFAULT_CLIP_OPTIONS } from '../src/clip/types'
import fixture from './fixtures/transcript-clip.json'

test('formatTimestamp renders MM:SS', () => {
  expect(formatTimestamp(0)).toBe('00:00')
  expect(formatTimestamp(75)).toBe('01:15')
})

test('prompt includes constraints, JSON keys, and timestamped transcript lines', () => {
  const prompt = buildClipPrompt({
    transcript: fixture,
    videoDurationSec: 120,
    options: DEFAULT_CLIP_OPTIONS,
  })
  expect(prompt).toContain('30') // minSec
  expect(prompt).toContain('60') // maxSec
  expect(prompt).toContain('"startSec"')
  expect(prompt).toContain('"clips"') // wrapper object the parser unwraps
  expect(prompt).toContain('[00:08-00:45]')
  expect(prompt.toLowerCase()).toContain('json')
})
