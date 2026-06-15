import { expect, test } from 'bun:test'
import { editWordText, retime } from '../src/captions/transcript'
import fixture from './fixtures/transcript-karaoke.json'

test('editWordText replaces a word and rebuilds segment text, immutably', () => {
  const out = editWordText(fixture, 0, 0, 'Hi')
  expect(out.segments[0].words[0].text).toBe('Hi')
  expect(out.segments[0].text).toBe('Hi world.')
  // original untouched (immutability)
  expect(fixture.segments[0].words[0].text).toBe('Hello')
  expect(fixture.segments[0].text).toBe('Hello world.')
  // unrelated segment preserved
  expect(out.segments[1].text).toBe('No timings here.')
})

test('editWordText out-of-range index is a no-op (returns equal transcript)', () => {
  expect(editWordText(fixture, 9, 9, 'X').segments[0].words[0].text).toBe('Hello')
})

test('retime shifts all timings without changing media duration, immutably', () => {
  const out = retime(fixture, 1)
  expect(out.segments[0].startSec).toBe(1)
  expect(out.segments[0].words[0].startSec).toBe(1)
  expect(out.segments[0].words[0].endSec).toBeCloseTo(1.8)
  expect(out.durationSec).toBe(fixture.durationSec) // media length unchanged
  expect(fixture.segments[0].startSec).toBe(0) // original untouched
})

test('retime clamps negative times to zero (clip-relative shift)', () => {
  const out = retime(fixture, -5)
  expect(out.segments[0].startSec).toBe(0)
  expect(out.segments[0].endSec).toBe(0)
})
