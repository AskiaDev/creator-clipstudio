/**
 * Cut a single contiguous clip with FFmpeg. Pure `buildCutArgs` (testable without ffmpeg) sits behind
 * an injectable spawn seam, mirroring the render core (`src/render/runRender.ts`). Fast input-seek
 * (`-ss` before `-i`) + `-t duration`, re-encoded for frame accuracy.
 *
 * Render-opt follow-up (cross-cutting Phase 6): add `-hwaccel videotoolbox` + resolution-scaled bitrate here.
 */

import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export interface CutSpec {
  readonly source: string
  readonly startSec: number
  readonly endSec: number
  readonly output: string
  readonly crf: number
}

export type RunFfmpeg = (args: readonly string[]) => Promise<{ exitCode: number; stderr: string }>

/** Fast input-seek + duration cut, re-encoded for frame accuracy. */
export function buildCutArgs(spec: CutSpec): string[] {
  const duration = Math.max(0, spec.endSec - spec.startSec)
  return [
    '-ss',
    String(spec.startSec),
    '-i',
    spec.source,
    '-t',
    String(duration),
    '-c:v',
    'libx264',
    '-crf',
    String(spec.crf),
    '-c:a',
    'aac',
    '-movflags',
    '+faststart',
    '-y',
    spec.output,
  ]
}

export interface CutResult {
  readonly ok: boolean
  readonly output?: string
  readonly error?: string
}

const STDERR_TAIL = 300

const DEFAULT_RUN_FFMPEG: RunFfmpeg = async (args) => {
  const proc = Bun.spawn(['ffmpeg', ...args], { stdout: 'ignore', stderr: 'pipe' })
  const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited])
  return { exitCode, stderr }
}

/** Cut a clip; returns the output path on success or a typed error (stderr tail) on a non-zero exit. */
export async function cutClip(spec: CutSpec, runFfmpeg: RunFfmpeg = DEFAULT_RUN_FFMPEG): Promise<CutResult> {
  mkdirSync(dirname(spec.output), { recursive: true })
  const { exitCode, stderr } = await runFfmpeg(buildCutArgs(spec))
  if (exitCode !== 0) return { ok: false, error: `ffmpeg exited ${exitCode}: ${stderr.slice(-STDERR_TAIL)}` }
  return { ok: true, output: spec.output }
}
