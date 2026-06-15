import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { countWords, emptyTranscript, type Transcript } from '../src/transcribe/types'

const short = JSON.parse(
  readFileSync(join(import.meta.dir, 'fixtures', 'transcript-short.json'), 'utf8'),
) as Transcript

describe('transcribe types', () => {
  test('emptyTranscript carries the duration and has no segments', () => {
    const t = emptyTranscript(12.5)
    expect(t.durationSec).toBe(12.5)
    expect(t.segments).toEqual([])
  })

  test('countWords sums words across all segments', () => {
    expect(short.segments.length).toBe(1)
    expect(countWords(short)).toBe(2)
  })

  test('the Transcript shape exposes per-word timings in seconds', () => {
    expect(short.segments[0].words[0]).toEqual({ text: 'Hello', startSec: 0, endSec: 0.6 })
  })
})
