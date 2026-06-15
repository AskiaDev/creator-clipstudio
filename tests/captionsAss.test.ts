import { expect, test } from 'bun:test'
import type { Transcript } from '../src/transcribe/types'
import { buildAss, formatAssTime } from '../src/captions/ass'
import fixture from './fixtures/transcript-karaoke.json'

test('formatAssTime renders H:MM:SS.cc (centiseconds)', () => {
  expect(formatAssTime(0)).toBe('0:00:00.00')
  expect(formatAssTime(2)).toBe('0:00:02.00')
  expect(formatAssTime(75.5)).toBe('0:01:15.50')
})

test('formatAssTime carries rounding cleanly at sub-second/minute/hour boundaries', () => {
  expect(formatAssTime(1.999)).toBe('0:00:02.00') // carries into seconds
  expect(formatAssTime(59.999)).toBe('0:01:00.00') // carries into minutes
  expect(formatAssTime(3599.999)).toBe('1:00:00.00') // carries into hours
})

test('buildAss emits the required ASS sections and a Default style sized to the canvas', () => {
  const ass = buildAss(fixture, { canvas: { width: 1080, height: 1920 } })
  expect(ass).toContain('[Script Info]')
  expect(ass).toContain('PlayResX: 1080')
  expect(ass).toContain('PlayResY: 1920')
  expect(ass).toContain('[V4+ Styles]')
  expect(ass).toContain('Style: Default,')
  expect(ass).toContain('[Events]')
})

test('buildAss wraps each timed word in a \\k karaoke tag with centisecond durations', () => {
  const ass = buildAss(fixture)
  // "Hello" 0->0.8s = 80cs ; "world." 0.8->2s = 120cs
  expect(ass).toContain('{\\k80}Hello {\\k120}world.')
  // dialogue line for the first segment, 0 -> 2s
  expect(ass).toContain('Dialogue: 0,0:00:00.00,0:00:02.00,Default,')
})

test('buildAss falls back to plain text for a segment without word timings', () => {
  const ass = buildAss(fixture)
  const noTimings = ass.split('\n').find((l) => l.includes('No timings here.'))
  expect(noTimings).toBeDefined()
  expect(noTimings).toContain('Dialogue: 0,0:00:02.00,0:00:05.00,Default,')
  expect(noTimings).not.toContain('\\k') // no karaoke tags when there are no word timings
})

test('buildAss on an empty transcript is valid with zero Dialogue lines', () => {
  const empty: Transcript = { durationSec: 0, segments: [] }
  const ass = buildAss(empty)
  expect(ass).toContain('[Events]')
  expect(ass.split('\n').filter((l) => l.startsWith('Dialogue:'))).toHaveLength(0)
})

test('buildAss escapes ASS control characters in untrusted transcript text', () => {
  const injected: Transcript = {
    durationSec: 5,
    segments: [
      { startSec: 0, endSec: 2, text: '{applause} back\\slash', words: [] },
      {
        startSec: 2,
        endSec: 4,
        text: 'hi',
        words: [{ text: '{laugh}', startSec: 2, endSec: 3 }],
      },
    ],
  }
  const ass = buildAss(injected)
  // braces/backslashes in TEXT are escaped, so they can't open an override block or eat a word
  expect(ass).toContain('\\{applause\\} back\\\\slash')
  expect(ass).toContain('{\\k100}\\{laugh\\}') // the \k tag stays literal; the word's braces are escaped
  // no UNescaped override block other than our own \k tags
  expect(ass).not.toContain('{applause}')
})

test('buildAss is deterministic', () => {
  expect(buildAss(fixture)).toBe(buildAss(fixture))
})
