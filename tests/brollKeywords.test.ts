import { expect, test } from 'bun:test'
import {
  type BrollCue,
  type CallModel,
  extractBrollCues,
  extractBrollCuesWithModel,
} from '../src/broll/keywords'
import type { Segment, Transcript } from '../src/transcribe/types'
import basic from './fixtures/broll-keywords-basic.json'

const fixture: Transcript = basic

/** Build a single-segment transcript inline (terse helper for edge-case tests). */
function oneSegment(text: string, words: Segment['words'] = [], startSec = 0, endSec = 10): Transcript {
  return { durationSec: endSec, segments: [{ startSec, endSec, text, words }] }
}

// ---------------------------------------------------------------------------
// Heuristic core
// ---------------------------------------------------------------------------

test('returns [] for an empty transcript', () => {
  expect(extractBrollCues({ durationSec: 0, segments: [] })).toEqual([])
})

test('returns [] for a no-speech transcript (only stopwords)', () => {
  expect(extractBrollCues(oneSegment('the and a of to is it'))).toEqual([])
})

test('does not throw on a segment with empty text', () => {
  expect(() => extractBrollCues(oneSegment(''))).not.toThrow()
  expect(extractBrollCues(oneSegment(''))).toEqual([])
})

test('extracts the recurring noun phrase as the top cue', () => {
  const cues = extractBrollCues(fixture)
  expect(cues[0].term).toBe('electric cars')
})

test('ranks more frequent terms above rarer ones', () => {
  const cues = extractBrollCues(fixture)
  const electric = cues.find((c) => c.term === 'electric cars')
  const solar = cues.find((c) => c.term === 'solar panels')
  expect(electric).toBeDefined()
  expect(solar).toBeDefined()
  expect((electric as BrollCue).score).toBeGreaterThan((solar as BrollCue).score)
})

test('anchors the top cue to its first-occurrence timing and phrase', () => {
  const cues = extractBrollCues(fixture)
  expect(cues[0].startSec).toBe(0)
  expect(cues[0].endSec).toBe(1)
  expect(cues[0].phrase).toBe('Electric cars are changing the world.')
})

test('produces well-formed cues with positive scores', () => {
  const cues = extractBrollCues(fixture)
  expect(cues.length).toBeGreaterThan(0)
  for (const cue of cues) {
    expect(cue.term.length).toBeGreaterThan(0)
    expect(cue.phrase.length).toBeGreaterThan(0)
    expect(cue.score).toBeGreaterThan(0)
    expect(cue.startSec).toBeGreaterThanOrEqual(0)
    expect(cue.endSec).toBeGreaterThan(cue.startSec)
  }
})

test('produces multi-word terms for adjacent content words (noun phrases)', () => {
  const cues = extractBrollCues(fixture)
  expect(cues.some((c) => c.term.includes(' '))).toBe(true)
})

// ---------------------------------------------------------------------------
// Ranking, tie-breaks, determinism
// ---------------------------------------------------------------------------

test('breaks score ties by earlier start time', () => {
  // "panda" and "zebra": same length, same frequency, both unigrams → equal score.
  const words: Segment['words'] = [
    { text: 'Panda', startSec: 1, endSec: 2 },
    { text: 'and', startSec: 2, endSec: 3 },
    { text: 'zebra', startSec: 3, endSec: 4 },
  ]
  const cues = extractBrollCues(oneSegment('Panda and zebra', words))
  expect(cues.map((c) => c.term)).toEqual(['panda', 'zebra'])
})

test('breaks remaining ties alphabetically by term', () => {
  // No word timings → both unigrams inherit the segment start, so only alpha order can decide.
  const cues = extractBrollCues(oneSegment('Zebra and panda'))
  expect(cues.map((c) => c.term)).toEqual(['panda', 'zebra'])
})

test('is deterministic across repeated calls', () => {
  expect(extractBrollCues(fixture)).toEqual(extractBrollCues(fixture))
})

// ---------------------------------------------------------------------------
// top-N: no silent caps
// ---------------------------------------------------------------------------

test('caps the result at topN', () => {
  const cues = extractBrollCues(fixture, { topN: 2 })
  expect(cues).toHaveLength(2)
})

test('logs the dropped count when topN truncates (no silent caps)', () => {
  const logs: string[] = []
  const full = extractBrollCues(fixture)
  extractBrollCues(fixture, { topN: 2, log: (m) => logs.push(m) })
  const dropped = full.length - 2
  expect(logs.some((l) => l.includes('dropped') && l.includes(String(dropped)))).toBe(true)
})

test('does not log a drop when topN is not exceeded', () => {
  const logs: string[] = []
  extractBrollCues(fixture, { topN: 999, log: (m) => logs.push(m) })
  expect(logs).toHaveLength(0)
})

// ---------------------------------------------------------------------------
// Clip range
// ---------------------------------------------------------------------------

test('restricts cues to the clip range', () => {
  const cues = extractBrollCues(fixture, { clipRange: { startSec: 6, endSec: 13 } })
  expect(cues.length).toBeGreaterThan(0)
  for (const cue of cues) {
    expect(cue.startSec).toBeGreaterThanOrEqual(6)
    expect(cue.endSec).toBeLessThanOrEqual(13)
  }
  expect(cues.some((c) => c.term === 'battery technology')).toBe(false)
})

// ---------------------------------------------------------------------------
// Word-timing fallback
// ---------------------------------------------------------------------------

test('falls back to segment timing when word timings are absent', () => {
  const cues = extractBrollCues(oneSegment('Mountains rise high', [], 5, 9))
  expect(cues.length).toBeGreaterThan(0)
  for (const cue of cues) {
    expect(cue.startSec).toBe(5)
    expect(cue.endSec).toBe(9)
  }
})

// ---------------------------------------------------------------------------
// Optional injectable LLM seam
// ---------------------------------------------------------------------------

test('extractBrollCuesWithModel parses cues from the model output', async () => {
  const callModel: CallModel = async () =>
    JSON.stringify([{ term: 'sunset over mountains', startSec: 2, endSec: 5, score: 90 }])
  const cues = await extractBrollCuesWithModel(fixture, { callModel })
  expect(cues).toHaveLength(1)
  expect(cues[0].term).toBe('sunset over mountains')
  expect(cues[0].score).toBe(90)
  expect(cues[0].startSec).toBe(2)
  expect(cues[0].endSec).toBe(5)
})

test('drops invalid model rows without throwing', async () => {
  const callModel: CallModel = async () =>
    JSON.stringify([
      { term: 'valid cue', startSec: 1, endSec: 4, score: 80 },
      { term: '', startSec: 1, endSec: 4, score: 80 },
      { startSec: 1, endSec: 4 },
      { term: 'bad timing', startSec: 5, endSec: 3 },
    ])
  const cues = await extractBrollCuesWithModel(fixture, { callModel })
  expect(cues).toHaveLength(1)
  expect(cues[0].term).toBe('valid cue')
})

test('returns [] when the model yields no parseable output', async () => {
  const callModel: CallModel = async () => 'Sorry, I could not find anything.'
  expect(await extractBrollCuesWithModel(fixture, { callModel })).toEqual([])
})

test('clamps model timings to the transcript duration', async () => {
  const callModel: CallModel = async () =>
    JSON.stringify([{ term: 'whole video', startSec: 0, endSec: 999, score: 70 }])
  const cues = await extractBrollCuesWithModel(fixture, { callModel })
  expect(cues[0].endSec).toBe(fixture.durationSec)
})

test('reconstructs the phrase locally instead of trusting the model', async () => {
  // The model supplies only term + timing; the phrase must come from the transcript.
  const callModel: CallModel = async () =>
    JSON.stringify([{ term: 'anything', startSec: 0, endSec: 6, phrase: 'HALLUCINATED', score: 70 }])
  const cues = await extractBrollCuesWithModel(fixture, { callModel })
  expect(cues[0].phrase).toContain('Electric cars')
  expect(cues[0].phrase).not.toContain('HALLUCINATED')
})

test('applies topN and logs drops in the model path', async () => {
  const logs: string[] = []
  const callModel: CallModel = async () =>
    JSON.stringify([
      { term: 'a one', startSec: 1, endSec: 3, score: 90 },
      { term: 'b two', startSec: 4, endSec: 6, score: 80 },
      { term: 'c three', startSec: 7, endSec: 9, score: 70 },
    ])
  const cues = await extractBrollCuesWithModel(fixture, { callModel, log: (m) => logs.push(m) }, { topN: 1 })
  expect(cues).toHaveLength(1)
  expect(logs.some((l) => l.includes('dropped'))).toBe(true)
})

test('passes a non-empty prompt containing transcript text to the model', async () => {
  let seenPrompt = ''
  const callModel: CallModel = async (prompt) => {
    seenPrompt = prompt
    return '[]'
  }
  await extractBrollCuesWithModel(fixture, { callModel })
  expect(seenPrompt.length).toBeGreaterThan(0)
  expect(seenPrompt).toContain('Electric cars')
})

test('returns [] (and logs) when the model call rejects — never throws', async () => {
  const callModel: CallModel = async () => {
    throw new Error('network down')
  }
  const logs: string[] = []
  const cues = await extractBrollCuesWithModel(fixture, { callModel, log: (m) => logs.push(m) })
  expect(cues).toEqual([])
  expect(logs.some((l) => l.includes('failed'))).toBe(true)
})

test('accepts a single bare cue object from the model output', async () => {
  const callModel: CallModel = async () => '{"term":"lone cue","startSec":1,"endSec":3,"score":60}'
  const cues = await extractBrollCuesWithModel(fixture, { callModel })
  expect(cues).toHaveLength(1)
  expect(cues[0].term).toBe('lone cue')
})

test('normalizes internal whitespace in model-supplied terms', async () => {
  const callModel: CallModel = async () =>
    JSON.stringify([{ term: 'electric   cars', startSec: 1, endSec: 3, score: 80 }])
  const cues = await extractBrollCuesWithModel(fixture, { callModel })
  expect(cues[0].term).toBe('electric cars')
})

// ---------------------------------------------------------------------------
// topN input hardening (no silent caps)
// ---------------------------------------------------------------------------

test('returns no cues when topN is 0', () => {
  expect(extractBrollCues(fixture, { topN: 0 })).toEqual([])
})

test('floors a fractional topN', () => {
  expect(extractBrollCues(fixture, { topN: 2.9 })).toHaveLength(2)
})

test('ignores a non-finite topN instead of silently truncating', () => {
  const full = extractBrollCues(fixture)
  expect(extractBrollCues(fixture, { topN: Number.NaN })).toHaveLength(full.length)
})

// ---------------------------------------------------------------------------
// Defensive robustness
// ---------------------------------------------------------------------------

test('does not throw on a segment missing its words array', () => {
  const malformed = {
    durationSec: 5,
    segments: [{ startSec: 0, endSec: 5, text: 'hello world' }],
  } as unknown as Transcript
  expect(() => extractBrollCues(malformed)).not.toThrow()
  expect(extractBrollCues(malformed).length).toBeGreaterThan(0)
})
