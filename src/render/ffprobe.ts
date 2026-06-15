/**
 * ffprobe argument builder + output parser for the render core.
 *
 * Pure and side-effect-free: this module never spawns a process. `runRender.ts` (Phase 4)
 * spawns ffprobe with {@link buildFfprobeArgs} and feeds the stdout to {@link parseFfprobeJson}.
 * ffprobe emits numeric fields (notably `duration`) as strings, so the schema coerces.
 */
import { z } from 'zod'

export interface ProbeData {
  readonly durationSec: number
  readonly width: number
  readonly height: number
  readonly hasAudio: boolean
}

export type ProbeResult =
  | { readonly ok: true; readonly data: ProbeData }
  | { readonly ok: false; readonly error: string }

const FFPROBE_BASE_ARGS = [
  '-v',
  'error',
  '-print_format',
  'json',
  '-show_format',
  '-show_streams',
] as const

/** The argv (after the `ffprobe` binary) that probes a media file as JSON. */
export function buildFfprobeArgs(inputPath: string): string[] {
  return [...FFPROBE_BASE_ARGS, inputPath]
}

/**
 * Coerce ffprobe's stringy numbers to a finite number, mapping unparseable values
 * (e.g. `"N/A"`, `""`) to `undefined` so one bad field never fails the whole parse.
 */
const numberish = z.preprocess((value) => {
  const n = typeof value === 'string' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined
}, z.number().optional())

const StreamSchema = z.object({
  codec_type: z.string(),
  width: numberish,
  height: numberish,
  duration: numberish,
})

const FfprobeSchema = z.object({
  streams: z.array(StreamSchema).default([]),
  format: z.object({ duration: numberish }).optional(),
})

type JsonResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: string }

function toObject(raw: string | unknown): JsonResult {
  if (typeof raw !== 'string') {
    return { ok: true, value: raw }
  }
  try {
    return { ok: true, value: JSON.parse(raw) }
  } catch {
    return { ok: false, error: 'ffprobe output is not valid JSON' }
  }
}

/**
 * Parse ffprobe `-print_format json` output into typed probe data.
 *
 * Accepts either the raw stdout string or an already-parsed object. Returns a Result rather
 * than throwing so callers handle a malformed/audio-only file explicitly.
 */
export function parseFfprobeJson(raw: string | unknown): ProbeResult {
  const parsedJson = toObject(raw)
  if (!parsedJson.ok) {
    return parsedJson
  }

  const validated = FfprobeSchema.safeParse(parsedJson.value)
  if (!validated.success) {
    return { ok: false, error: 'unexpected ffprobe JSON shape' }
  }

  const { streams, format } = validated.data
  const video = streams.find((stream) => stream.codec_type === 'video')
  if (!video) {
    return { ok: false, error: 'no video stream found' }
  }
  if (!video.width || !video.height) {
    return { ok: false, error: 'video stream is missing positive dimensions' }
  }

  const durationSec = format?.duration ?? video.duration
  if (durationSec === undefined || durationSec <= 0) {
    return { ok: false, error: 'no positive duration found in format or video stream' }
  }

  const hasAudio = streams.some((stream) => stream.codec_type === 'audio')

  return {
    ok: true,
    data: { durationSec, width: video.width, height: video.height, hasAudio },
  }
}
