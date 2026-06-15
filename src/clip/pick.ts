/**
 * Provider-agnostic clip-pick orchestration. The only IO is an injectable `callModel` — adapters
 * (Ollama default, Claude alternate) supply it. The transcript is windowed (map), each window asked
 * independently, then candidates merged + re-ranked globally (reduce). All drops are logged.
 */

import { type ChunkOptions, chunkTranscript, DEFAULT_CHUNK_OPTIONS } from './chunk'
import { dedupeOverlaps, parseClipCandidates } from './parse'
import { buildClipPrompt } from './prompt'
import type { ClipCandidate, ClipPickerInput } from './types'

export type CallModel = (prompt: string) => Promise<string>

export interface PickDeps {
  readonly callModel: CallModel
  readonly chunkOptions?: ChunkOptions
  readonly log?: (message: string) => void
}

/** Map-reduce clip pick: window the transcript, ask the model per window, merge + rank globally. */
export async function pickClips(input: ClipPickerInput, deps: PickDeps): Promise<ClipCandidate[]> {
  const log = deps.log ?? (() => {})
  const windows = chunkTranscript(input.transcript, deps.chunkOptions ?? DEFAULT_CHUNK_OPTIONS)
  if (windows.length > 1) log(`[clip] long transcript: ${windows.length} windows (chunked map-reduce)`)

  const all: ClipCandidate[] = []
  // Sequential by design: local models serialize on the GPU, so parallel windows do not help and only
  // increase memory pressure. Do not "optimize" this to Promise.all.
  for (const window of windows) {
    const windowInput: ClipPickerInput = {
      ...input,
      transcript: { durationSec: input.transcript.durationSec, segments: window.segments },
    }
    const raw = await deps.callModel(buildClipPrompt(windowInput))
    const result = parseClipCandidates(raw, windowInput)
    if (result.droppedInvalid || result.droppedShort || result.droppedOverlap) {
      log(
        `[clip] window ${window.startSec}-${window.endSec}s: kept ${result.candidates.length}; dropped ${result.droppedInvalid} invalid / ${result.droppedShort} short / ${result.droppedOverlap} overlap`,
      )
    }
    all.push(...result.candidates)
  }

  // Global merge: dedupe across windows, then keep the top-N. Log both reductions (no silent caps).
  const merged = dedupeOverlaps(all).sort((a, b) => b.score - a.score)
  const droppedGlobalOverlap = all.length - merged.length
  const final = merged.slice(0, input.options.count)
  const droppedTruncation = merged.length - final.length
  if (droppedGlobalOverlap || droppedTruncation) {
    log(
      `[clip] global merge: ${all.length} candidates → kept ${final.length}; dropped ${droppedGlobalOverlap} cross-window overlap / ${droppedTruncation} over top-${input.options.count}`,
    )
  }
  return final
}
