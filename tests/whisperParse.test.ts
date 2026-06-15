import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildWhisperArgs, parseWhisperJson } from '../src/transcribe/whisper'

const sampleJson = readFileSync(join(import.meta.dir, 'fixtures', 'whisper-sample.json'), 'utf8')

describe('parseWhisperJson', () => {
  test('parses whisper.cpp --output-json-full into a typed Transcript in seconds', () => {
    const r = parseWhisperJson(sampleJson)
    if (!r.ok) throw new Error(r.error)
    const t = r.transcript
    expect(t.segments.length).toBe(2)
    expect(t.segments[0].text).toBe('Hello world.')
    expect(t.segments[0].startSec).toBe(0)
    expect(t.segments[0].endSec).toBe(1.5) // 1500ms → 1.5s
    expect(t.durationSec).toBe(3.2) // max segment end
  })

  test('reconstructs words from tokens, skipping [_BEG_] and merging trailing punctuation', () => {
    const r = parseWhisperJson(sampleJson)
    if (!r.ok) throw new Error(r.error)
    const w0 = r.transcript.segments[0].words
    expect(w0.map((w) => w.text)).toEqual(['Hello', 'world.'])
    expect(w0[0]).toEqual({ text: 'Hello', startSec: 0.1, endSec: 0.6 })
    expect(w0[1].endSec).toBe(1.5) // '.' merges into 'world', extending the end
    const w1 = r.transcript.segments[1].words
    expect(w1.map((w) => w.text)).toEqual(['This', 'is', 'a', 'test.'])
  })

  test('tolerates seconds-based timings (start/end) as a fallback for offsets', () => {
    const secondsShape = JSON.stringify({
      transcription: [{ start: 1, end: 2, text: 'Hi', tokens: [{ text: ' Hi', start: 1, end: 2 }] }],
    })
    const r = parseWhisperJson(secondsShape)
    if (!r.ok) throw new Error(r.error)
    expect(r.transcript.segments[0].startSec).toBe(1)
    expect(r.transcript.segments[0].endSec).toBe(2)
    expect(r.transcript.segments[0].words[0]).toEqual({ text: 'Hi', startSec: 1, endSec: 2 })
  })

  test('returns an error for malformed JSON rather than throwing', () => {
    expect(parseWhisperJson('{not json').ok).toBe(false)
  })

  test('returns an empty transcript when transcription is absent', () => {
    const r = parseWhisperJson('{}')
    if (!r.ok) throw new Error(r.error)
    expect(r.transcript.segments).toEqual([])
    expect(r.transcript.durationSec).toBe(0)
  })

  test('drops a token that carries no timing (no offsets, no start/end) instead of fabricating one', () => {
    const noTiming = JSON.stringify({
      transcription: [
        {
          offsets: { from: 0, to: 500 },
          text: 'keep drop',
          tokens: [
            { text: ' keep', offsets: { from: 0, to: 300 } },
            { text: ' drop' }, // no timing → must be skipped, not emitted with a bogus 0
          ],
        },
      ],
    })
    const r = parseWhisperJson(noTiming)
    if (!r.ok) throw new Error(r.error)
    expect(r.transcript.segments[0].words.map((w) => w.text)).toEqual(['keep'])
  })
})

describe('buildWhisperArgs', () => {
  test('builds the exact ordered argv for full JSON output (model before wav)', () => {
    const args = buildWhisperArgs('models/ggml-base.en.bin', '/tmp/a.wav', '/tmp/out')
    expect(args).toEqual(['-m', 'models/ggml-base.en.bin', '-f', '/tmp/a.wav', '-ojf', '-of', '/tmp/out', '-np'])
  })
})
