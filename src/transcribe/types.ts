/**
 * The single source of truth for transcription types across the AI pipeline.
 *
 * Phases 2 (auto-clipper) and 3 (auto-captions) import {@link Transcript} from here — they must not
 * redefine it. Timings are always **seconds** (whisper.cpp emits milliseconds; the parser normalizes).
 */

/** One token-aligned word with start/end timings in seconds. */
export interface Word {
  readonly text: string
  readonly startSec: number
  readonly endSec: number
}

/** One transcribed segment (a phrase/sentence) with its constituent words. */
export interface Segment {
  readonly startSec: number
  readonly endSec: number
  readonly text: string
  readonly words: readonly Word[]
}

/** A full transcript: the media duration plus ordered segments. */
export interface Transcript {
  readonly durationSec: number
  readonly segments: readonly Segment[]
}

/** Pipeline stage at which transcription can fail, for typed error reporting. */
export type TranscribeStage = 'preflight' | 'probe' | 'audio' | 'whisper' | 'parse'

/** Result of a transcription attempt. `note` flags the benign no-audio case. */
export type TranscribeResult =
  | { readonly ok: true; readonly transcript: Transcript; readonly note?: string }
  | { readonly ok: false; readonly stage: TranscribeStage; readonly error: string }

/** An empty transcript for a given duration — used for no-audio sources (nothing to transcribe). */
export function emptyTranscript(durationSec: number): Transcript {
  return { durationSec, segments: [] }
}

/** Total number of words across every segment. */
export function countWords(transcript: Transcript): number {
  return transcript.segments.reduce((total, segment) => total + segment.words.length, 0)
}
