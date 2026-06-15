import { describe, expect, test } from 'bun:test'
import landscapeAudio from './fixtures/probe-landscape-audio.json'
import portraitNoAudio from './fixtures/probe-portrait-noaudio.json'
import { buildFfprobeArgs, parseFfprobeJson } from '../src/render/ffprobe'

describe('buildFfprobeArgs', () => {
  test('requests JSON with streams and format for the given path', () => {
    expect(buildFfprobeArgs('/clips/a.mp4')).toEqual([
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      '/clips/a.mp4',
    ])
  })
})

describe('parseFfprobeJson', () => {
  test('parses a landscape clip with audio (duration string coerced)', () => {
    const result = parseFfprobeJson(landscapeAudio)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({
        durationSec: 2,
        width: 1280,
        height: 720,
        hasAudio: true,
      })
    }
  })

  test('reports hasAudio false when there is no audio stream', () => {
    const result = parseFfprobeJson(portraitNoAudio)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.hasAudio).toBe(false)
    }
  })

  test('parses portrait dimensions', () => {
    const result = parseFfprobeJson(portraitNoAudio)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.width).toBe(720)
      expect(result.data.height).toBe(1280)
    }
  })

  test('tolerates an "N/A" stream duration when the format duration is valid', () => {
    const result = parseFfprobeJson({
      streams: [{ codec_type: 'video', width: 1280, height: 720, duration: 'N/A' }],
      format: { duration: '5.0' },
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.durationSec).toBe(5)
    }
  })

  test('fails when no duration is present in format or stream', () => {
    const result = parseFfprobeJson({
      streams: [{ codec_type: 'video', width: 1280, height: 720 }],
      format: {},
    })

    expect(result.ok).toBe(false)
  })

  test('accepts a raw JSON string (ffprobe stdout)', () => {
    const result = parseFfprobeJson(JSON.stringify(landscapeAudio))

    expect(result.ok).toBe(true)
  })

  test('fails with a typed error on malformed JSON', () => {
    const result = parseFfprobeJson('{ not json')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.length).toBeGreaterThan(0)
    }
  })

  test('fails when there is no video stream', () => {
    const result = parseFfprobeJson({
      streams: [{ codec_type: 'audio', duration: '2' }],
      format: { duration: '2' },
    })

    expect(result.ok).toBe(false)
  })
})
