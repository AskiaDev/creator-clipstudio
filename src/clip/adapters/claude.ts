/**
 * Alternate clip-picker adapter: Anthropic Claude (reference for the provider-agnostic interface).
 * Selected only when `CLIP_PROVIDER=claude`; the default stays local Ollama so the tool needs no keys.
 */

import { type CallModel, pickClips } from '../pick'
import type { ClipPicker, ClipPickerInput } from '../types'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const DEFAULT_MODEL = 'claude-opus-4-8' // latest; override with CLIP_MODEL
const MAX_TOKENS = 2048

function claudeCallModel(apiKey: string, model: string): CallModel {
  return async (prompt: string) => {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model, max_tokens: MAX_TOKENS, messages: [{ role: 'user', content: prompt }] }),
    })
    if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`)
    const data = (await res.json()) as { content: Array<{ type: string; text?: string }> }
    return data.content.map((c) => c.text ?? '').join('')
  }
}

export function createClaudeClipPicker(opts?: {
  apiKey?: string
  model?: string
  log?: (m: string) => void
}): ClipPicker {
  const apiKey = opts?.apiKey ?? process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')
  const callModel = claudeCallModel(apiKey, opts?.model ?? process.env.CLIP_MODEL ?? DEFAULT_MODEL)
  return { pickClips: (input: ClipPickerInput) => pickClips(input, { callModel, log: opts?.log }) }
}
