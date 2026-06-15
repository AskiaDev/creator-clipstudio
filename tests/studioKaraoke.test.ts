import { expect, test } from 'bun:test'
import type { Segment } from '../src/transcribe/types'
import { findSegmentIndexAt, wordStateAt } from '../app/studio/lib/karaoke'
import fixture from './fixtures/studio-karaoke.json'

const segment: Segment = {
  startSec: 0,
  endSec: 2,
  text: 'Hello world.',
  words: [
    { text: 'Hello', startSec: 0, endSec: 0.8 },
    { text: 'world.', startSec: 0.8, endSec: 2 },
  ],
}

test('wordStateAt marks a word unsung before its start time', () => {
  expect(wordStateAt(segment.words[1], 0.3)).toBe('unsung')
})

test('wordStateAt marks a word active from its (inclusive) start until its end', () => {
  expect(wordStateAt(segment.words[0], 0)).toBe('active')
  expect(wordStateAt(segment.words[0], 0.3)).toBe('active')
})

test('wordStateAt marks a word sung once its end time has passed (end exclusive)', () => {
  expect(wordStateAt(segment.words[0], 0.8)).toBe('sung')
  expect(wordStateAt(segment.words[0], 1.5)).toBe('sung')
})

test('wordStateAt hands off cleanly: at a boundary the prior word is sung and the next is active', () => {
  expect(wordStateAt(segment.words[0], 0.8)).toBe('sung')
  expect(wordStateAt(segment.words[1], 0.8)).toBe('active')
})

test('findSegmentIndexAt returns the index of the segment whose window contains the time', () => {
  expect(findSegmentIndexAt(fixture, 1.0)).toBe(0)
  expect(findSegmentIndexAt(fixture, 3.0)).toBe(1)
  expect(findSegmentIndexAt(fixture, 7.0)).toBe(2)
})

test('findSegmentIndexAt returns -1 in the gap between two segments', () => {
  // fixture: segment 0 ends at 2.4, segment 1 starts at 2.6 -> 2.5 is a caption gap
  expect(findSegmentIndexAt(fixture, 2.5)).toBe(-1)
})

test('findSegmentIndexAt returns -1 before the first segment and after the last', () => {
  expect(findSegmentIndexAt(fixture, -1)).toBe(-1)
  expect(findSegmentIndexAt(fixture, 9999)).toBe(-1)
})
