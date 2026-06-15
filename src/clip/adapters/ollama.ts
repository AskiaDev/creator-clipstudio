/**
 * DEFAULT clip-picker adapter: local Ollama. No API key, no cost, fully on-device. Supplies a
 * provider-specific `callModel` to the shared {@link pickClips} core; everything else is provider-agnostic.
 */

import { type CallModel, pickClips } from '../pick'
import type { ClipPicker, ClipPickerInput } from '../types'

const DEFAULT_HOST = process.env.OLLAMA_HOST ?? 'http://localhost:11434'
const DEFAULT_MODEL = process.env.CLIP_MODEL ?? 'qwen2.5:7b-instruct-q4_K_M' // installed locally

function ollamaCallModel(host: string, model: string): CallModel {
  return async (prompt: string) => {
    const res = await fetch(`${host}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // format:'json' forces valid JSON out of the model → the parser stays defensive regardless.
      body: JSON.stringify({ model, prompt, stream: false, format: 'json', options: { temperature: 0.2 } }),
    })
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`)
    const data = (await res.json()) as { response: string }
    return data.response
  }
}

export function createOllamaClipPicker(opts?: {
  host?: string
  model?: string
  log?: (m: string) => void
}): ClipPicker {
  const callModel = ollamaCallModel(opts?.host ?? DEFAULT_HOST, opts?.model ?? DEFAULT_MODEL)
  return { pickClips: (input: ClipPickerInput) => pickClips(input, { callModel, log: opts?.log }) }
}
