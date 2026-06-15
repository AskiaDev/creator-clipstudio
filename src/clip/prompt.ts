/**
 * Pure prompt construction for clip selection. No IO, no provider specifics — the same prompt is sent
 * to whichever {@link ClipPicker} adapter is active.
 */

import type { ClipPickerInput } from './types'

/** Render seconds as `MM:SS` (floored, zero-padded). */
export function formatTimestamp(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec))
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** Build the LLM instruction + timestamped transcript for a single window. */
export function buildClipPrompt(input: ClipPickerInput): string {
  const { transcript, options } = input
  const lines = transcript.segments
    .map((seg) => `[${formatTimestamp(seg.startSec)}-${formatTimestamp(seg.endSec)}] ${seg.text}`)
    .join('\n')

  return [
    'You are a video editor selecting the best short clips from a long video transcript.',
    `Pick up to ${options.count} self-contained, ${options.style} segments that would make strong standalone short-form clips.`,
    `Each clip must be between ${options.minSec} and ${options.maxSec} seconds long, start and end on a natural sentence boundary, and have a clear hook.`,
    '',
    'Return ONLY a JSON object of the form {"clips": [ ... ]} (no prose, no code fences).',
    'Each item in "clips" has keys:',
    '"startSec" (number, seconds since the video start), "endSec" (number, seconds since the video start), "title" (string <=60 chars), "score" (integer 0-100), "reason" (string, one sentence).',
    'Use numeric seconds for startSec and endSec (e.g. 8, not "00:08"). Return an empty "clips" array if nothing qualifies.',
    '',
    'Transcript (each line is [MM:SS-MM:SS] text):',
    lines,
  ].join('\n')
}
