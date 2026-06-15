import { expect, test } from 'bun:test'
import type { Transcript } from '../src/transcribe/types'
import { chunkTranscript } from '../src/clip/chunk'

function makeTranscript(durationSec: number, segLen = 10): Transcript {
  const segments = []
  for (let s = 0; s < durationSec; s += segLen) {
    segments.push({ startSec: s, endSec: Math.min(s + segLen, durationSec), text: `seg ${s}`, words: [] })
  }
  return { durationSec, segments }
}

test('short transcript returns a single window', () => {
  const w = chunkTranscript(makeTranscript(120), { windowSec: 600, overlapSec: 30 })
  expect(w).toHaveLength(1)
  expect(w[0].segments.length).toBeGreaterThan(0)
})

test('long transcript splits into overlapping windows', () => {
  const w = chunkTranscript(makeTranscript(1500), { windowSec: 600, overlapSec: 60 })
  expect(w.length).toBeGreaterThan(1)
  // overlap: window 2 starts before window 1 ends
  expect(w[1].startSec).toBeLessThan(w[0].endSec)
})
