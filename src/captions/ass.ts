/**
 * Pure `Transcript → ASS` generator for burned-in karaoke captions (Phase 3).
 *
 * Each segment becomes one ASS `Dialogue` line; each word with timings is wrapped in a `{\k<cs>}` karaoke
 * tag (centiseconds) so the word highlights as it is spoken. Segments without word timings fall back to a
 * plain (un-karaoke'd) line. Deterministic and side-effect-free; the render filtergraph burns the result.
 */

import type { Segment, Transcript } from '../transcribe/types'

export interface AssStyle {
  readonly canvas: { readonly width: number; readonly height: number }
  readonly fontName: string
  readonly fontSizePx: number
  /** Colour of the "sung" (already-spoken) text — the karaoke fill. ASS `&HAABBGGRR`. */
  readonly primaryColour: string
  /** Colour of the not-yet-sung text. */
  readonly secondaryColour: string
  /** Distance of the caption baseline from the bottom edge, in pixels. */
  readonly marginVPx: number
}

export const DEFAULT_ASS_STYLE: AssStyle = {
  canvas: { width: 1080, height: 1920 },
  fontName: 'Arial',
  fontSizePx: 64,
  primaryColour: '&H00FFFFFF', // white (sung)
  secondaryColour: '&H0000D7FF', // amber (unsung)
  marginVPx: 120,
}

const CS_PER_SEC = 100
const MINUTES_PER_HOUR = 60
const SECONDS_PER_MINUTE = 60

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Format seconds as ASS `H:MM:SS.cc` (centiseconds), rolling carries cleanly. */
export function formatAssTime(totalSec: number): string {
  const totalCs = Math.round(Math.max(0, totalSec) * CS_PER_SEC)
  const cs = totalCs % CS_PER_SEC
  const totalSecInt = Math.floor(totalCs / CS_PER_SEC)
  const s = totalSecInt % SECONDS_PER_MINUTE
  const m = Math.floor(totalSecInt / SECONDS_PER_MINUTE) % MINUTES_PER_HOUR
  const h = Math.floor(totalSecInt / (SECONDS_PER_MINUTE * MINUTES_PER_HOUR))
  return `${h}:${pad2(m)}:${pad2(s)}.${pad2(cs)}`
}

/**
 * Escape transcript text for the ASS `Text` field. Transcript text is untrusted (whisper output); `{`/`}`
 * delimit ASS override blocks and `\` starts a control sequence, so they must be escaped or a stray brace
 * could drop a word or inject directives (e.g. `{\pos(..)}`). Backslash is escaped FIRST. Newlines → `\N`.
 */
function escapeText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\r?\n/g, '\\N')
    .trim()
}

/** Per-word `{\k<cs>}word` karaoke, or the plain segment text when the segment has no word timings. */
function dialogueText(segment: Segment): string {
  if (segment.words.length === 0) return escapeText(segment.text)
  return segment.words
    .map((w) => {
      const cs = Math.max(0, Math.round((w.endSec - w.startSec) * CS_PER_SEC))
      return `{\\k${cs}}${escapeText(w.text)}`
    })
    .join(' ')
}

function header(style: AssStyle): string {
  const { canvas } = style
  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${canvas.width}`,
    `PlayResY: ${canvas.height}`,
    'WrapStyle: 2',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,${style.fontName},${style.fontSizePx},${style.primaryColour},${style.secondaryColour},&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,3,2,2,60,60,${style.marginVPx},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ].join('\n')
}

/**
 * Build a complete ASS document from a transcript. Empty transcript → valid header with no dialogue.
 * `style` is shallow-merged over {@link DEFAULT_ASS_STYLE}: pass `canvas` as a complete `{width,height}`.
 */
export function buildAss(transcript: Transcript, style: Partial<AssStyle> = {}): string {
  const merged: AssStyle = { ...DEFAULT_ASS_STYLE, ...style }
  const dialogues = transcript.segments.map(
    (seg) =>
      `Dialogue: 0,${formatAssTime(seg.startSec)},${formatAssTime(seg.endSec)},Default,,0,0,0,,${dialogueText(seg)}`,
  )
  return `${[header(merged), ...dialogues].join('\n')}\n`
}
