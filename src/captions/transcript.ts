/**
 * Pure, immutable transcript transforms used by the caption Studio: fix a mis-recognised word, and
 * retime captions (e.g. shift to clip-relative time after a clip is cut). Every function returns a NEW
 * {@link Transcript}; the input is never mutated.
 */

import type { Transcript } from '../transcribe/types'

/** Replace one word's text and rebuild the owning segment's text. Out-of-range indices are a no-op. */
export function editWordText(
  transcript: Transcript,
  segmentIndex: number,
  wordIndex: number,
  newText: string,
): Transcript {
  return {
    ...transcript,
    segments: transcript.segments.map((seg, i) => {
      if (i !== segmentIndex) return seg
      if (wordIndex < 0 || wordIndex >= seg.words.length) return seg
      const words = seg.words.map((w, j) => (j === wordIndex ? { ...w, text: newText } : w))
      return { ...seg, words, text: words.map((w) => w.text).join(' ') }
    }),
  }
}

/** Shift every segment/word timing by `shiftSec` (negative clamps to 0). Media `durationSec` is unchanged. */
export function retime(transcript: Transcript, shiftSec: number): Transcript {
  const shift = (t: number) => Math.max(0, t + shiftSec)
  return {
    durationSec: transcript.durationSec,
    segments: transcript.segments.map((seg) => ({
      ...seg,
      startSec: shift(seg.startSec),
      endSec: shift(seg.endSec),
      words: seg.words.map((w) => ({ ...w, startSec: shift(w.startSec), endSec: shift(w.endSec) })),
    })),
  }
}
