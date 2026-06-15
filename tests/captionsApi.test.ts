import { expect, test } from 'bun:test'
import { POST } from '../app/api/captions/route'
import fixture from './fixtures/studio-karaoke.json'

function postJson(body: unknown): Request {
  return new Request('http://localhost/api/captions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

test('POST returns an ASS document with karaoke tags for a valid transcript', async () => {
  const res = await POST(postJson({ transcript: fixture }))
  expect(res.status).toBe(200)
  const body = (await res.json()) as { ass: string }
  expect(body.ass).toContain('[Script Info]')
  expect(body.ass).toContain('[Events]')
  expect(body.ass).toContain('{\\k') // at least one \k karaoke tag was emitted
  expect(body.ass).toContain('Stop') // first spoken word survives into the dialogue
})

test('POST forwards an optional style override into the ASS canvas', async () => {
  const res = await POST(postJson({ transcript: fixture, style: { canvas: { width: 720, height: 1280 } } }))
  expect(res.status).toBe(200)
  const body = (await res.json()) as { ass: string }
  expect(body.ass).toContain('PlayResX: 720')
  expect(body.ass).toContain('PlayResY: 1280')
  expect(body.ass).toContain('{\\k') // karaoke tags survive when a style override is supplied
})

test('POST on an empty (no-speech) transcript returns valid ASS with zero Dialogue lines', async () => {
  const res = await POST(postJson({ transcript: { durationSec: 8, segments: [] } }))
  expect(res.status).toBe(200)
  const body = (await res.json()) as { ass: string }
  expect(body.ass).toContain('[Events]')
  expect(body.ass.split('\n').filter((line) => line.startsWith('Dialogue:'))).toHaveLength(0)
})

test('POST rejects a body that is not JSON with 400', async () => {
  const res = await POST(new Request('http://localhost/api/captions', { method: 'POST', body: 'not json {' }))
  expect(res.status).toBe(400)
})

test('POST rejects a body missing the transcript with 400 and an explanatory message', async () => {
  const res = await POST(postJson({ style: {} }))
  expect(res.status).toBe(400)
  const body = (await res.json()) as { error: string }
  expect(body.error.toLowerCase()).toContain('transcript')
})

test('POST rejects a malformed transcript (segment missing timings) with 400', async () => {
  const res = await POST(postJson({ transcript: { durationSec: 5, segments: [{ text: 'hi', words: [] }] } }))
  expect(res.status).toBe(400)
})
