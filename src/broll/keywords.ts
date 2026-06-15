/**
 * Pure transcript → b-roll cue extractor (Phase 5, part 1/2).
 *
 * From a {@link Transcript} (+ optional clip range) it produces ranked {@link BrollCue} candidates —
 * the visual keywords/short noun phrases worth a cutaway. The default {@link extractBrollCues} is a
 * deterministic heuristic (content unigrams + adjacent bigrams, ranked by frequency / length / a
 * noun-phrase bonus); it needs no network so unit tests are pure. {@link extractBrollCuesWithModel}
 * is the optional LLM-backed variant behind an injectable {@link CallModel} seam (mirroring the clip
 * engine). The model is never trusted: its rows are Zod-validated, clamped to the transcript, and the
 * cue phrase is reconstructed locally. The integrator pairs each cue with an image and composites a
 * cutaway. All timings are **seconds**.
 */

import { z } from 'zod'
import type { Segment, Transcript } from '../transcribe/types'

/** One ranked b-roll cue: the visual `term` to fetch footage for, anchored to when it is spoken. */
export interface BrollCue {
  /** The transcript phrase (segment text) the term was spoken in — context for the cutaway. */
  readonly phrase: string
  readonly startSec: number
  readonly endSec: number
  /** Salience score; higher = more cutaway-worthy. Heuristic: frequency + length + noun-phrase bonus. */
  readonly score: number
  /** The salient keyword or short noun phrase to fetch b-roll for (e.g. "electric cars"). */
  readonly term: string
}

/** A sub-window of the source video, in seconds. */
export interface ClipRange {
  readonly startSec: number
  readonly endSec: number
}

/** Tuning for the extractor. All optional; omitting them yields the full ranked list. */
export interface BrollOptions {
  /**
   * Restrict extraction to terms spoken fully inside this window. With word-level timings each word
   * is filtered individually; without them a segment is included only if it lies entirely within the
   * window (a segment straddling a boundary is excluded).
   */
  readonly clipRange?: ClipRange
  /** Keep only the top-N cues. The truncation is logged (no silent caps). */
  readonly topN?: number
  /** Sink for diagnostics (e.g. the top-N drop count). Defaults to a no-op. */
  readonly log?: (message: string) => void
}

/** The single provider-agnostic LLM seam (mirrors the clip engine's `CallModel`). */
export type CallModel = (prompt: string) => Promise<string>

/** Dependencies for the optional LLM-backed extractor. */
export interface BrollModelDeps {
  readonly callModel: CallModel
  readonly log?: (message: string) => void
}

// --- Heuristic tuning (deterministic) --------------------------------------------------------------

/** Shortest normalized token treated as a content word (drops "a"/"of"/2-letter noise). */
const MIN_TERM_LENGTH = 3
/** Each occurrence of a term adds this to its score (recurring themes are more cutaway-worthy). */
const FREQUENCY_WEIGHT = 10
/** Each scored character of the term adds this (more specific terms rank higher). */
const LENGTH_WEIGHT = 1
/** Character count past which extra length stops adding score. */
const MAX_LENGTH_SIGNAL = 12
/** Multi-word noun phrases ("electric cars") are more visual than bare words — flat bonus. */
const PHRASE_BONUS = 5
/** Score assigned to a model-supplied cue that omits its own score. */
const DEFAULT_MODEL_SCORE = 50

const NOOP_LOG = (): void => {}

/** Common English function/filler words that are never b-roll subjects. */
const STOPWORDS: ReadonlySet<string> = new Set([
  'the', 'and', 'but', 'for', 'nor', 'yet', 'are', 'was', 'were', 'been', 'being', 'have', 'has',
  'had', 'does', 'did', 'doing', 'will', 'would', 'shall', 'should', 'can', 'could', 'may', 'might',
  'must', 'this', 'that', 'these', 'those', 'its', 'his', 'her', 'their', 'our', 'your', 'mine',
  'yours', 'ours', 'theirs', 'them', 'they', 'you', 'she', 'him', 'who', 'whom', 'whose', 'which',
  'what', 'when', 'where', 'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'some',
  'such', 'not', 'only', 'own', 'same', 'than', 'too', 'very', 'just', 'also', 'every', 'many',
  'much', 'here', 'there', 'now', 'then', 'about', 'into', 'onto', 'over', 'under', 'from', 'with',
  'without', 'within', 'again', 'once', 'because', 'before', 'after', 'while', 'until', 'dont',
  'cant', 'wont', 'isnt', 'arent', 'wasnt', 'werent', 'havent', 'hasnt', 'didnt', 'doesnt', 'theyre',
  'youre', 'thats', 'lets', 'gonna', 'wanna', 'kinda', 'really', 'actually', 'basically', 'literally',
  'like', 'yeah', 'okay', 'thing', 'things', 'stuff', 'lot', 'lots', 'way', 'get', 'got', 'going',
  'gone', 'one', 'two', 'three', 'today',
])

// --- Internal token model --------------------------------------------------------------------------

interface TimedToken {
  readonly norm: string
  readonly startSec: number
  readonly endSec: number
  readonly isContent: boolean
}

interface TermSpan {
  readonly term: string
  readonly startSec: number
  readonly endSec: number
  readonly wordCount: number
}

interface Occurrence {
  readonly term: string
  readonly startSec: number
  readonly endSec: number
  readonly phrase: string
  readonly count: number
  readonly wordCount: number
}

/** Lowercase and strip punctuation so "World." and "world" collapse to one term. */
function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** A content word is a non-stopword token of meaningful length containing at least one letter. */
function isContentWord(norm: string): boolean {
  return norm.length >= MIN_TERM_LENGTH && /[a-z]/.test(norm) && !STOPWORDS.has(norm)
}

function makeToken(text: string, startSec: number, endSec: number): TimedToken {
  const norm = normalize(text)
  return { norm, startSec, endSec, isContent: isContentWord(norm) }
}

/** Word-level timings when present; otherwise split the segment text and inherit segment timing. */
function tokensForSegment(segment: Segment): readonly TimedToken[] {
  // Guard against malformed input (e.g. JSON without a `words` array): the contract is "never throws".
  const words = segment.words ?? []
  if (words.length > 0) {
    return words.map((w) => makeToken(w.text, w.startSec, w.endSec))
  }
  return segment.text
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .map((part) => makeToken(part, segment.startSec, segment.endSec))
}

function inRange(token: TimedToken, range: ClipRange | undefined): boolean {
  if (!range) return true
  return token.startSec >= range.startSec && token.endSec <= range.endSec
}

/** Maximal runs of adjacent content tokens (stopwords break a run), each a fresh `slice`. */
function contentRuns(tokens: readonly TimedToken[]): readonly (readonly TimedToken[])[] {
  const runs: (readonly TimedToken[])[] = []
  let runStart = -1
  tokens.forEach((token, i) => {
    if (token.isContent && runStart === -1) {
      runStart = i
    } else if (!token.isContent && runStart !== -1) {
      runs.push(tokens.slice(runStart, i))
      runStart = -1
    }
  })
  if (runStart !== -1) runs.push(tokens.slice(runStart))
  return runs
}

/** A unigram or an adjacent-pair bigram spanning [first.start, last.end]. */
function spanOf(tokens: readonly TimedToken[]): TermSpan {
  const first = tokens[0]
  const last = tokens[tokens.length - 1]
  return {
    term: tokens.map((t) => t.norm).join(' '),
    startSec: first.startSec,
    endSec: last.endSec,
    wordCount: tokens.length,
  }
}

/** Content unigrams + every adjacent content bigram within a run (sliding window of size ≤ 2). */
function spansForRun(run: readonly TimedToken[]): TermSpan[] {
  const spans: TermSpan[] = run.map((token) => spanOf([token]))
  for (let i = 0; i + 1 < run.length; i++) {
    spans.push(spanOf([run[i], run[i + 1]]))
  }
  return spans
}

function recordOccurrence(
  byTerm: Map<string, Occurrence>,
  span: TermSpan,
  phrase: string,
): void {
  const existing = byTerm.get(span.term)
  if (existing) {
    // Keep the first occurrence's timing/phrase; only the count grows.
    byTerm.set(span.term, { ...existing, count: existing.count + 1 })
    return
  }
  byTerm.set(span.term, {
    term: span.term,
    startSec: span.startSec,
    endSec: span.endSec,
    phrase,
    count: 1,
    wordCount: span.wordCount,
  })
}

function scoreOf(occurrence: Occurrence): number {
  const charLength = Math.min(occurrence.term.replace(/\s/g, '').length, MAX_LENGTH_SIGNAL)
  const phraseBonus = occurrence.wordCount >= 2 ? PHRASE_BONUS : 0
  return FREQUENCY_WEIGHT * occurrence.count + LENGTH_WEIGHT * charLength + phraseBonus
}

function toCue(occurrence: Occurrence): BrollCue {
  return {
    phrase: occurrence.phrase,
    startSec: occurrence.startSec,
    endSec: occurrence.endSec,
    score: Math.round(scoreOf(occurrence)),
    term: occurrence.term,
  }
}

/** Rank by score, then earlier start, then term alphabetically — fully deterministic. */
function compareCues(a: BrollCue, b: BrollCue): number {
  if (b.score !== a.score) return b.score - a.score
  if (a.startSec !== b.startSec) return a.startSec - b.startSec
  return a.term < b.term ? -1 : a.term > b.term ? 1 : 0
}

function timeOverlaps(a: BrollCue, b: BrollCue): boolean {
  return Math.min(a.endSec, b.endSec) > Math.max(a.startSec, b.startSec)
}

function words(term: string): readonly string[] {
  return term.split(/\s+/).filter(Boolean)
}

/** Does `longer` contain every word of `shorter`? Used to drop a sub-phrase of a kept phrase. */
function subsumes(longer: string, shorter: string): boolean {
  const longerWords = new Set(words(longer))
  return words(shorter).every((word) => longerWords.has(word))
}

/**
 * Drop a cue when a higher-ranked kept cue overlaps it in time AND subsumes its words
 * (e.g. "electric" inside "electric cars"). Distinct terms at the same coarse time are both kept,
 * which matters when word-level timings are absent and tokens share a segment span. Input must be
 * pre-sorted best-first.
 */
function dedupeContained(sorted: readonly BrollCue[]): BrollCue[] {
  const kept: BrollCue[] = []
  for (const cue of sorted) {
    const redundant = kept.some((k) => timeOverlaps(k, cue) && subsumes(k.term, cue.term))
    if (!redundant) kept.push(cue)
  }
  return kept
}

function applyTopN(
  cues: readonly BrollCue[],
  topN: number | undefined,
  log: (message: string) => void,
): BrollCue[] {
  // A non-finite topN (undefined/NaN/Infinity) means "no cap" — never silently truncate on bad input.
  if (topN === undefined || !Number.isFinite(topN)) return [...cues]
  const cap = Math.max(0, Math.floor(topN))
  if (cues.length <= cap) return [...cues]
  const kept = cues.slice(0, cap)
  log(`[broll] ${cues.length} cues → kept ${kept.length}; dropped ${cues.length - kept.length} over top-${cap}`)
  return kept
}

/** Sort → dedupe subsumed sub-phrases → optional top-N cap (logged). Shared by both extractors. */
function finalizeCues(
  cues: readonly BrollCue[],
  topN: number | undefined,
  log: (message: string) => void,
): BrollCue[] {
  const ranked = dedupeContained([...cues].sort(compareCues))
  return applyTopN(ranked, topN, log)
}

/**
 * Default heuristic extractor — pure and deterministic. Empty/no-speech transcripts yield `[]` and it
 * never throws.
 */
export function extractBrollCues(transcript: Transcript, opts?: BrollOptions): BrollCue[] {
  const log = opts?.log ?? NOOP_LOG
  const byTerm = new Map<string, Occurrence>()
  for (const segment of transcript.segments) {
    const tokens = tokensForSegment(segment).filter((token) => inRange(token, opts?.clipRange))
    for (const run of contentRuns(tokens)) {
      for (const span of spansForRun(run)) {
        recordOccurrence(byTerm, span, segment.text)
      }
    }
  }
  const cues = Array.from(byTerm.values(), toCue)
  return finalizeCues(cues, opts?.topN, log)
}

// --- Optional LLM-backed seam ----------------------------------------------------------------------

const rawModelRowSchema = z.object({
  term: z.string().trim().min(1),
  startSec: z.number().nonnegative(),
  endSec: z.number().positive(),
  score: z.number().min(0).max(100).optional(),
})

/**
 * Pull a JSON array of rows out of raw model text. Defensive against a bare/fenced array, a
 * `{"cues":[...]}` wrapper, or any single array-valued property. Never throws; `[]` when nothing parses.
 */
function extractJsonArray(raw: string): unknown[] {
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(raw.slice(start, end + 1))
      if (Array.isArray(parsed)) return parsed
    } catch {
      // fall through to the object path
    }
  }
  const objStart = raw.indexOf('{')
  const objEnd = raw.lastIndexOf('}')
  if (objStart !== -1 && objEnd > objStart) {
    try {
      const parsed = JSON.parse(raw.slice(objStart, objEnd + 1))
      if (parsed && typeof parsed === 'object') {
        const obj = parsed as Record<string, unknown>
        if (Array.isArray(obj.cues)) return obj.cues
        const arrayProp = Object.values(obj).find((v) => Array.isArray(v))
        return Array.isArray(arrayProp) ? arrayProp : [parsed]
      }
    } catch {
      return []
    }
  }
  return []
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi)
}

/** Reconstruct the spoken phrase locally from segments overlapping the range (do not trust the model). */
function phraseForRange(transcript: Transcript, startSec: number, endSec: number): string {
  return transcript.segments
    .filter((s) => s.endSec > startSec && s.startSec < endSec)
    .map((s) => s.text)
    .join(' ')
    .trim()
}

interface ModelParseResult {
  readonly cues: BrollCue[]
  readonly droppedInvalid: number
}

function parseModelCues(raw: string, transcript: Transcript, opts: BrollOptions | undefined): ModelParseResult {
  const lo = opts?.clipRange ? Math.max(0, opts.clipRange.startSec) : 0
  const hi = opts?.clipRange ? Math.min(transcript.durationSec, opts.clipRange.endSec) : transcript.durationSec
  const cues: BrollCue[] = []
  let droppedInvalid = 0
  for (const row of extractJsonArray(raw)) {
    const parsed = rawModelRowSchema.safeParse(row)
    if (!parsed.success) {
      droppedInvalid++
      continue
    }
    const startSec = clamp(parsed.data.startSec, lo, hi)
    const endSec = clamp(parsed.data.endSec, lo, hi)
    if (endSec <= startSec) {
      droppedInvalid++
      continue
    }
    cues.push({
      phrase: phraseForRange(transcript, startSec, endSec),
      startSec,
      endSec,
      score: Math.round(parsed.data.score ?? DEFAULT_MODEL_SCORE),
      term: words(parsed.data.term).join(' '),
    })
  }
  return { cues, droppedInvalid }
}

/** Build a compact, transcript-grounded prompt asking for visual cue terms + timings as JSON. */
function buildBrollPrompt(transcript: Transcript, opts: BrollOptions | undefined): string {
  const range = opts?.clipRange
  const lines = transcript.segments
    .filter((s) => !range || (s.endSec > range.startSec && s.startSec < range.endSec))
    .map((s) => `[${s.startSec.toFixed(1)}-${s.endSec.toFixed(1)}] ${s.text}`)
  return [
    'You are a b-roll editor. From the transcript below, list the visual keywords or short noun',
    'phrases worth showing as a cutaway. Return ONLY a JSON array of objects of the shape',
    '[{"term": "...", "startSec": 0, "endSec": 0, "score": 0}] where startSec/endSec mark when the',
    'term is spoken and score is 0..100 salience.',
    '',
    'Transcript:',
    ...lines,
  ].join('\n')
}

/**
 * Optional LLM-backed extractor. Builds a transcript-grounded prompt, calls the injectable model,
 * then validates/clamps every row and reconstructs the phrase locally. Invalid rows are dropped (and
 * logged); it never throws. Returns `[]` when the model yields nothing parseable.
 */
export async function extractBrollCuesWithModel(
  transcript: Transcript,
  deps: BrollModelDeps,
  opts?: BrollOptions,
): Promise<BrollCue[]> {
  const log = deps.log ?? NOOP_LOG
  let raw: string
  try {
    raw = await deps.callModel(buildBrollPrompt(transcript, opts))
  } catch (error) {
    log(`[broll] model call failed: ${error instanceof Error ? error.message : String(error)}`)
    return []
  }
  const { cues, droppedInvalid } = parseModelCues(raw, transcript, opts)
  if (droppedInvalid > 0) log(`[broll] model: dropped ${droppedInvalid} invalid row(s)`)
  return finalizeCues(cues, opts?.topN, log)
}
