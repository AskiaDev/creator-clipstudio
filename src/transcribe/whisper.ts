/**
 * whisper.cpp invocation + output parsing.
 *
 * The parser ({@link parseWhisperJson}) is pure and side-effect-free: it turns whisper-cli's
 * `--output-json-full` JSON into a typed {@link Transcript}, reconstructing words from sub-word
 * tokens (skipping specials like `[_BEG_]`, merging trailing punctuation into the preceding word).
 * Timings normalize to seconds — whisper.cpp emits integer-millisecond `offsets`, but a seconds-based
 * `start`/`end` shape is tolerated as a fallback. The spawn ({@link runWhisperCli}) is a separate,
 * injectable seam so parsing is testable without a binary.
 */

import { z } from 'zod'
import { readPipe, tailLines } from './audio'
import type { Segment, Transcript, Word } from './types'

/** Whisper writes `<outPrefix>.json`; we read it back after the process exits. */
export interface WhisperRequest {
  readonly binary: string
  readonly model: string
  readonly wavPath: string
  readonly outPrefix: string
}

export type WhisperRun =
  | { readonly ok: true; readonly json: string }
  | { readonly ok: false; readonly error: string }

/** Runs whisper.cpp and returns its JSON text; injected in tests, defaults to a real `Bun.spawn`. */
export type RunWhisper = (req: WhisperRequest) => Promise<WhisperRun>

export type ParseResult =
  | { readonly ok: true; readonly transcript: Transcript }
  | { readonly ok: false; readonly error: string }

/**
 * The whisper-cli argv (after the binary): full JSON output written to `<outPrefix>.json`.
 * `-ojf` = `--output-json-full` (token timings); `-np` silences progress chatter.
 */
export function buildWhisperArgs(model: string, wavPath: string, outPrefix: string): string[] {
  return ['-m', model, '-f', wavPath, '-ojf', '-of', outPrefix, '-np']
}

const MS_PER_SEC = 1000
/** Special whisper tokens (e.g. `[_BEG_]`, `[_TT_123]`) carry no transcribed text. */
const SPECIAL_TOKEN = /^\[.*\]$/

const OffsetsSchema = z.object({ from: z.number(), to: z.number() }).optional()

const TokenSchema = z.object({
  text: z.string(),
  offsets: OffsetsSchema,
  start: z.number().optional(),
  end: z.number().optional(),
})

const SegmentSchema = z.object({
  text: z.string().default(''),
  offsets: OffsetsSchema,
  start: z.number().optional(),
  end: z.number().optional(),
  tokens: z.array(TokenSchema).default([]),
})

const WhisperJsonSchema = z.object({
  transcription: z.array(SegmentSchema).default([]),
})

type RawToken = z.infer<typeof TokenSchema>
type RawSegment = z.infer<typeof SegmentSchema>

interface Timing {
  readonly startSec: number
  readonly endSec: number
}

/** Resolve start/end in seconds from ms `offsets` (preferred) or a seconds `start`/`end` fallback. */
function timing(node: { offsets?: { from: number; to: number }; start?: number; end?: number }): Timing | null {
  if (node.offsets) {
    return { startSec: node.offsets.from / MS_PER_SEC, endSec: node.offsets.to / MS_PER_SEC }
  }
  if (typeof node.start === 'number' && typeof node.end === 'number') {
    return { startSec: node.start, endSec: node.end }
  }
  return null
}

/**
 * Rebuild words from whisper sub-word tokens. A leading space starts a new word; tokens without one
 * (continuations, punctuation) merge into the current word and extend its end. Special tokens are skipped.
 */
function wordsFromTokens(tokens: readonly RawToken[]): Word[] {
  const words: Word[] = []
  for (const token of tokens) {
    if (SPECIAL_TOKEN.test(token.text.trim()) || token.text.trim().length === 0) {
      continue
    }
    const t = timing(token)
    if (!t) {
      continue
    }
    const startsNewWord = token.text.startsWith(' ') || words.length === 0
    if (startsNewWord) {
      words.push({ text: token.text.trim(), startSec: t.startSec, endSec: Math.max(t.endSec, t.startSec) })
    } else {
      const prev = words[words.length - 1]
      words[words.length - 1] = {
        text: prev.text + token.text,
        startSec: prev.startSec,
        endSec: Math.max(prev.endSec, t.endSec),
      }
    }
  }
  return words
}

function toSegment(raw: RawSegment): Segment {
  const t = timing(raw) ?? { startSec: 0, endSec: 0 }
  return { startSec: t.startSec, endSec: t.endSec, text: raw.text.trim(), words: wordsFromTokens(raw.tokens) }
}

function toObject(raw: string | unknown): { ok: true; value: unknown } | { ok: false; error: string } {
  if (typeof raw !== 'string') {
    return { ok: true, value: raw }
  }
  try {
    return { ok: true, value: JSON.parse(raw) }
  } catch {
    return { ok: false, error: 'whisper output is not valid JSON' }
  }
}

/**
 * Parse whisper.cpp `--output-json-full` output (raw string or parsed object) into a typed Transcript.
 * `durationSec` is the latest segment end; the orchestrator overrides it with the probed media duration.
 */
export function parseWhisperJson(raw: string | unknown): ParseResult {
  const parsed = toObject(raw)
  if (!parsed.ok) {
    return parsed
  }
  const validated = WhisperJsonSchema.safeParse(parsed.value)
  if (!validated.success) {
    return { ok: false, error: 'unexpected whisper JSON shape' }
  }
  const segments = validated.data.transcription.map(toSegment)
  const durationSec = segments.reduce((max, segment) => Math.max(max, segment.endSec), 0)
  return { ok: true, transcript: { durationSec, segments } }
}

/**
 * Default spawn seam: run whisper-cli, then read the `<outPrefix>.json` it writes. Returns the JSON
 * text or a typed error carrying the stderr tail.
 */
export const runWhisperCli: RunWhisper = async (req) => {
  // whisper-cli writes results to `<outPrefix>.json`; stdout is unused, so ignore it (don't leave it undrained).
  const proc = Bun.spawn([req.binary, ...buildWhisperArgs(req.model, req.wavPath, req.outPrefix)], {
    stdout: 'ignore',
    stderr: 'pipe',
  })
  const [stderr, exitCode] = await Promise.all([readPipe(proc.stderr), proc.exited])
  if (exitCode !== 0) {
    return { ok: false, error: `whisper-cli exited ${exitCode}: ${tailLines(stderr)}` }
  }
  try {
    const json = await Bun.file(`${req.outPrefix}.json`).text()
    return { ok: true, json }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `whisper-cli produced no JSON at ${req.outPrefix}.json: ${message}` }
  }
}
