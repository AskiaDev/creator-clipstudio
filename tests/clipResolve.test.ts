import { expect, test } from 'bun:test'
import { checkClipProvider } from '../src/clip/resolve'

test('claude provider requires an API key', () => {
  expect(checkClipProvider('claude', {}).ok).toBe(false)
  expect(checkClipProvider('claude', { ANTHROPIC_API_KEY: 'sk-x' }).ok).toBe(true)
})

test('ollama provider needs no key (local default)', () => {
  expect(checkClipProvider('ollama', {}).ok).toBe(true)
})

test('unknown provider is rejected with a message', () => {
  const r = checkClipProvider('zzz' as never, {})
  expect(r.ok).toBe(false)
  expect(r.message).toContain('Unknown')
})
