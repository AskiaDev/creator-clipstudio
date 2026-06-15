/**
 * Audio extraction for transcription: build the ffmpeg args for a 16 kHz mono WAV and run them.
 *
 * Pure arg building ({@link buildExtractAudioArgs}) is separated from the spawn ({@link extractAudio})
 * via an injectable `runFfmpeg` seam, mirroring `src/render/runRender.ts`. whisper.cpp expects 16 kHz
 * mono PCM, so that is exactly what we produce.
 *
 * This module also hosts the small spawn helpers ({@link readPipe}, {@link tailLines}) reused by the
 * whisper and orchestrator modules — kept here to respect Phase 1's allowed-file set; extracting a
 * dedicated spawn util is a fine later refactor.
 */

/** whisper.cpp's required input format. */
const SAMPLE_RATE_HZ = '16000'
const MONO = '1'
/** Keep only the last few stderr lines so an ffmpeg error stays actionable but bounded. */
const STDERR_TAIL_LINES = 6

export interface FfmpegRun {
  readonly exitCode: number
  readonly stderr: string
}

/** Runs ffmpeg with the given args; injected in tests, defaults to a real `Bun.spawn`. */
export type RunFfmpeg = (args: readonly string[]) => Promise<FfmpegRun>

export type AudioResult =
  | { readonly ok: true; readonly wavPath: string }
  | { readonly ok: false; readonly error: string }

/**
 * Build the ffmpeg argv that decodes `input` into a 16 kHz mono PCM WAV at `wavOut`.
 * `-vn` drops video; `-y` overwrites; input precedes output.
 */
export function buildExtractAudioArgs(input: string, wavOut: string): string[] {
  return ['-y', '-i', input, '-vn', '-ac', MONO, '-ar', SAMPLE_RATE_HZ, '-f', 'wav', wavOut]
}

/** Read a spawned process pipe to a string (empty when the pipe is absent). */
export async function readPipe(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  return stream ? await new Response(stream).text() : ''
}

/** The last non-empty lines of stderr, for compact error messages. */
export function tailLines(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .slice(-STDERR_TAIL_LINES)
    .join('\n')
}

/** Default ffmpeg seam: a real `Bun.spawn`. Injected away in unit tests. */
export const runFfmpegCli: RunFfmpeg = async (args) => {
  // ffmpeg writes the WAV to the output file; stdout is unused, so ignore it (don't leave it undrained).
  const proc = Bun.spawn(['ffmpeg', ...args], { stdout: 'ignore', stderr: 'pipe' })
  const [stderr, exitCode] = await Promise.all([readPipe(proc.stderr), proc.exited])
  return { exitCode, stderr }
}

/**
 * Extract a 16 kHz mono WAV from `input`. Returns the wav path on success, or a typed error
 * carrying the ffmpeg stderr tail. The spawn is injectable so this is unit-testable without ffmpeg.
 */
export async function extractAudio(
  input: string,
  wavOut: string,
  runFfmpeg: RunFfmpeg = runFfmpegCli,
): Promise<AudioResult> {
  const { exitCode, stderr } = await runFfmpeg(buildExtractAudioArgs(input, wavOut))
  if (exitCode !== 0) {
    return { ok: false, error: `ffmpeg (audio extract) exited ${exitCode}: ${tailLines(stderr)}` }
  }
  return { ok: true, wavPath: wavOut }
}
