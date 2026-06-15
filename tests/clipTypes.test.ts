import { expect, test } from 'bun:test'
import { DEFAULT_CLIP_OPTIONS } from '../src/clip/types'

test('default clip options target 30-60s shorts', () => {
  expect(DEFAULT_CLIP_OPTIONS.minSec).toBe(30)
  expect(DEFAULT_CLIP_OPTIONS.maxSec).toBe(60)
  expect(DEFAULT_CLIP_OPTIONS.count).toBeGreaterThan(0)
})
