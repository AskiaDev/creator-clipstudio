import { describe, expect, test } from 'bun:test'
import { parseTranscript, parseTranscriptJson, transcriptSchema } from '../src/transcribe/schema'

const VALID = {
  durationSec: 8,
  segments: [
    {
      startSec: 0,
      endSec: 2,
      text: 'hello world',
      words: [
        { text: 'hello', startSec: 0, endSec: 1 },
        { text: 'world', startSec: 1, endSec: 2 },
      ],
    },
  ],
}

describe('transcribe/schema — canonical Transcript validator', () => {
  test('parseTranscriptJson accepts a well-formed transcript and returns it typed', () => {
    const t = parseTranscriptJson(JSON.stringify(VALID))
    expect(t.durationSec).toBe(8)
    expect(t.segments[0].words[0].text).toBe('hello')
  })

  test('parseTranscriptJson accepts an empty (no-speech) transcript', () => {
    const t = parseTranscriptJson(JSON.stringify({ durationSec: 5, segments: [] }))
    expect(t.segments).toHaveLength(0)
  })

  test('parseTranscriptJson throws on input that is not valid JSON', () => {
    expect(() => parseTranscriptJson('{ not json')).toThrow(/json/i)
  })

  test('parseTranscriptJson throws on a shape violation (negative timing)', () => {
    const bad = JSON.stringify({ durationSec: 5, segments: [{ startSec: -1, endSec: 2, text: 'x', words: [] }] })
    expect(() => parseTranscriptJson(bad)).toThrow(/transcript/i)
  })

  test('parseTranscript throws on a value missing required fields', () => {
    expect(() => parseTranscript({ segments: [] })).toThrow(/transcript/i)
  })

  test('transcriptSchema rejects a segment missing timings (parity with the captions API)', () => {
    const res = transcriptSchema.safeParse({ durationSec: 5, segments: [{ text: 'hi', words: [] }] })
    expect(res.success).toBe(false)
  })
})
