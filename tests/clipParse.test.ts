import { expect, test } from 'bun:test'
import {
  dedupeOverlaps,
  excerptFor,
  extractJsonArray,
  parseClipCandidates,
  snapToBoundaries,
} from '../src/clip/parse'
import { type ClipCandidate, type ClipPickerInput, DEFAULT_CLIP_OPTIONS } from '../src/clip/types'
import fixture from './fixtures/transcript-clip.json'

const input: ClipPickerInput = {
  transcript: fixture,
  videoDurationSec: 120,
  options: DEFAULT_CLIP_OPTIONS,
}

test('extractJsonArray tolerates code fences and surrounding prose', () => {
  const raw = 'Sure!\n```json\n[{"a":1}]\n```\nDone'
  expect(extractJsonArray(raw)).toEqual([{ a: 1 }])
  expect(extractJsonArray('no json here')).toEqual([])
})

test('extractJsonArray unwraps a {"clips":[...]} object (Ollama JSON mode)', () => {
  expect(extractJsonArray('{"clips":[{"a":1},{"b":2}]}')).toEqual([{ a: 1 }, { b: 2 }])
})

test('extractJsonArray wraps a single bare object as a one-element array', () => {
  expect(extractJsonArray('{"startSec":8,"endSec":45}')).toEqual([{ startSec: 8, endSec: 45 }])
})

test('extractJsonArray prefers the "clips" array over an unrelated array property', () => {
  expect(extractJsonArray('{"usage":[1,2,3],"clips":[{"a":1}]}')).toEqual([{ a: 1 }])
})

test('snapToBoundaries snaps to nearest segment edges', () => {
  // 7s ~ segment boundary 8 (start); 47s ~ end 45
  expect(snapToBoundaries(7, 47, fixture)).toEqual({ startSec: 8, endSec: 45 })
})

test('excerptFor joins covered segment text', () => {
  expect(excerptFor(fixture, 8, 45)).toContain('biggest mistake')
})

test('dedupeOverlaps keeps the higher score on >50% overlap', () => {
  const a: ClipCandidate = { startSec: 0, endSec: 40, title: 'a', score: 90, reason: 'r', excerpt: '' }
  const b: ClipCandidate = { startSec: 5, endSec: 42, title: 'b', score: 50, reason: 'r', excerpt: '' }
  expect(dedupeOverlaps([a, b]).map((c) => c.title)).toEqual(['a'])
})

test('parseClipCandidates drops too-short and invalid rows and reports counts', () => {
  const raw = JSON.stringify([
    { startSec: 8, endSec: 45, title: 'Founder mistake', score: 88, reason: 'Strong hook' }, // 37s OK
    { startSec: 0, endSec: 8, title: 'Too short', score: 70, reason: 'x' }, // 8s -> dropped
    { startSec: 45, endSec: 45, title: 'no fields' }, // invalid -> dropped
  ])
  const result = parseClipCandidates(raw, input)
  expect(result.candidates).toHaveLength(1)
  expect(result.candidates[0].title).toBe('Founder mistake')
  expect(result.candidates[0].excerpt).toContain('biggest mistake')
  expect(result.droppedShort).toBe(1)
  expect(result.droppedInvalid).toBe(1)
})
