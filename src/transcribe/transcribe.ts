/**
 * Transcription orchestrator + CLI entry — the only transcribe module that spawns processes by default.
 *
 * Flow: preflight → probe → (no audio? empty result) → extract 16 kHz WAV → whisper.cpp → parse →
 * {@link Transcript}. Every side-effecting seam (probe, ffmpeg, whisper, clock, logger) is injectable,
 * so the whole orchestration — including the no-audio short-circuit and the long-run heartbeat — is
 * unit-testable without a binary. The probed media duration is treated as authoritative.
 *
 * It reuses `src/render/ffprobe.ts` (arg builder + parser) for probing, but deliberately does NOT import
 * the render orchestrator, keeping transcription decoupled from the overlay/satori graph.
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildFfprobeArgs, type ProbeResult, parseFfprobeJson } from '../render/ffprobe'
import { extractAudio, type RunFfmpeg, readPipe, runFfmpegCli, tailLines } from './audio'
import {
  type BinaryResolver,
  DEFAULT_WHISPER_BIN,
  DEFAULT_WHISPER_MODEL,
  type FileExists,
  transcribePreflight,
  WHISPER_BIN_ENV,
  WHISPER_MODEL_ENV,
} from './preflight'
import { countWords, emptyTranscript, type TranscribeResult } from './types'
import { parseWhisperJson, type RunWhisper, runWhisperCli } from './whisper'

export interface TranscribeDeps {
  readonly binary: string
  readonly modelPath: string
  readonly resolveBinary: BinaryResolver
  readonly fileExists: FileExists
  readonly probe: (path: string) => Promise<ProbeResult>
  readonly runFfmpeg: RunFfmpeg
  readonly runWhisper: RunWhisper
  /** Monotonic clock in ms; injected so the heartbeat is deterministic in tests. */
  readonly now: () => number
  readonly log: (message: string) => void
  /** Cadence for the "still transcribing" heartbeat on long files. */
  readonly heartbeatMs: number
}

/** Heartbeat cadence so a multi-minute transcription never looks frozen in the terminal. */
const HEARTBEAT_MS = 5000

/** Default probe seam: spawn ffprobe and parse its JSON, reusing the render core's pure helpers. */
async function spawnProbe(path: string): Promise<ProbeResult> {
  const proc = Bun.spawn(['ffprobe', ...buildFfprobeArgs(path)], { stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([
    readPipe(proc.stdout),
    readPipe(proc.stderr),
    proc.exited,
  ])
  if (exitCode !== 0) {
    return { ok: false, error: `ffprobe exited ${exitCode}: ${tailLines(stderr)}` }
  }
  return parseFfprobeJson(stdout)
}

const DEFAULT_DEPS: TranscribeDeps = {
  binary: process.env[WHISPER_BIN_ENV] ?? DEFAULT_WHISPER_BIN,
  modelPath: process.env[WHISPER_MODEL_ENV] ?? DEFAULT_WHISPER_MODEL,
  resolveBinary: (binary) => Bun.which(binary),
  fileExists: (path) => existsSync(path),
  probe: spawnProbe,
  runFfmpeg: runFfmpegCli,
  runWhisper: runWhisperCli,
  now: () => Date.now(),
  log: () => {},
  heartbeatMs: HEARTBEAT_MS,
}

/**
 * Transcribe a local video into a typed {@link Transcript}, fully locally via whisper.cpp.
 * Returns a typed Result for each failure stage; a no-audio source yields an empty transcript with a note.
 */
export async function transcribe(
  input: string,
  overrides: Partial<TranscribeDeps> = {},
): Promise<TranscribeResult> {
  const deps: TranscribeDeps = { ...DEFAULT_DEPS, ...overrides }

  const pf = transcribePreflight({
    binary: deps.binary,
    modelPath: deps.modelPath,
    resolveBinary: deps.resolveBinary,
    fileExists: deps.fileExists,
  })
  if (!pf.ok) {
    return { ok: false, stage: 'preflight', error: pf.message }
  }

  // Phase-1 ingest path is local VIDEO files. An audio-only file (no video stream) reports a `probe`
  // error here (ffprobe.ts requires a video stream); audio-only ingest is a deferred follow-on.
  const probe = await deps.probe(input)
  if (!probe.ok) {
    return { ok: false, stage: 'probe', error: probe.error }
  }

  if (!probe.data.hasAudio) {
    deps.log('[transcribe] source has no audio stream — nothing to transcribe')
    return {
      ok: true,
      transcript: emptyTranscript(probe.data.durationSec),
      note: 'no audio stream — nothing to transcribe',
    }
  }

  const workDir = mkdtempSync(join(tmpdir(), 'cc-transcribe-'))
  const startedMs = deps.now()
  const heartbeat = setInterval(() => {
    const elapsed = Math.round((deps.now() - startedMs) / 1000)
    deps.log(`[transcribe] …still transcribing (${elapsed}s)`)
  }, deps.heartbeatMs)

  try {
    const wavPath = join(workDir, 'audio.wav')
    deps.log('[transcribe] extracting 16kHz mono audio…')
    const audio = await extractAudio(input, wavPath, deps.runFfmpeg)
    if (!audio.ok) {
      return { ok: false, stage: 'audio', error: audio.error }
    }

    deps.log(`[transcribe] running whisper.cpp (${deps.binary})…`)
    const run = await deps.runWhisper({
      binary: deps.binary,
      model: deps.modelPath,
      wavPath,
      outPrefix: join(workDir, 'out'),
    })
    if (!run.ok) {
      return { ok: false, stage: 'whisper', error: run.error }
    }

    const parsed = parseWhisperJson(run.json)
    if (!parsed.ok) {
      return { ok: false, stage: 'parse', error: parsed.error }
    }

    // Media duration from the probe is authoritative — whisper's last segment may end before EOF.
    const transcript = { durationSec: probe.data.durationSec, segments: parsed.transcript.segments }
    deps.log(`[transcribe] done — ${transcript.segments.length} segments, ${countWords(transcript)} words`)
    return { ok: true, transcript }
  } finally {
    clearInterval(heartbeat)
    rmSync(workDir, { recursive: true, force: true })
  }
}

if (import.meta.main) {
  const input = process.argv[2]
  if (!input) {
    console.error('usage: bun run transcribe <video-path> [--json]')
    process.exit(1)
  }
  const result = await transcribe(input, { log: (message) => console.log(message) })
  if (!result.ok) {
    console.error(`[transcribe] ${result.stage} failed: ${result.error}`)
    process.exit(1)
  }
  if (result.note) {
    console.log(`[transcribe] note: ${result.note}`)
  }
  console.log(
    `[transcribe] ${result.transcript.segments.length} segments over ${result.transcript.durationSec.toFixed(1)}s ` +
      `(${countWords(result.transcript)} words)`,
  )
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(result.transcript, null, 2))
  }
}
