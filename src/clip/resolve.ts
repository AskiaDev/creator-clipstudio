/**
 * Provider selection + preflight. Mirrors the render preflight pattern: validate that the chosen
 * provider is configured before constructing it. Default provider is local Ollama (no key required).
 */

import { createClaudeClipPicker } from './adapters/claude'
import { createOllamaClipPicker } from './adapters/ollama'
import type { ClipPicker } from './types'

export type ClipProvider = 'claude' | 'ollama'

export interface ProviderCheck {
  readonly ok: boolean
  readonly message?: string
}

/** Preflight: is the selected provider configured? */
export function checkClipProvider(
  provider: ClipProvider,
  env: Record<string, string | undefined> = process.env,
): ProviderCheck {
  if (provider === 'ollama') {
    return { ok: true } // local default at http://localhost:11434; no key needed
  }
  if (provider === 'claude') {
    return env.ANTHROPIC_API_KEY
      ? { ok: true }
      : { ok: false, message: 'Set ANTHROPIC_API_KEY to use the Claude clip picker.' }
  }
  return { ok: false, message: `Unknown clip provider: ${provider}` }
}

/** Construct the active picker from env (`CLIP_PROVIDER`, default `ollama`). Throws if misconfigured. */
export function resolveClipPicker(env: Record<string, string | undefined> = process.env): ClipPicker {
  const provider = (env.CLIP_PROVIDER ?? 'ollama') as ClipProvider // default: local, no key
  const check = checkClipProvider(provider, env)
  if (!check.ok) throw new Error(check.message ?? `Clip provider ${provider} not configured`)
  if (provider === 'ollama') return createOllamaClipPicker()
  if (provider === 'claude') return createClaudeClipPicker()
  throw new Error(`Clip provider not yet implemented: ${provider}`)
}
