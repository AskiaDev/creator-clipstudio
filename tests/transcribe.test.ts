import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { transcribePreflight } from '../src/transcribe/preflight'
import { transcribe, type TranscribeDeps } from '../src/transcribe/transcribe'

const sampleJson = readFileSync(join(import.meta.dir, 'fixtures', 'whisper-sample.json'), 'utf8')

/** Deps where every stage succeeds; tests override the stage under test. */
function okDeps(over: Partial<TranscribeDeps> = {}): Partial<TranscribeDeps> {
  return {
    binary: 'whisper-cli',
    modelPath: '/models/ggml-base.en.bin',
    resolveBinary: (b) => `/usr/bin/${b}`,
    fileExists: () => true,
    probe: async () => ({ ok: true, data: { durationSec: 9, width: 1920, height: 1080, hasAudio: true } }),
    runFfmpeg: async () => ({ exitCode: 0, stderr: '' }),
    runWhisper: async () => ({ ok: true, json: sampleJson }),
    now: () => 0,
    log: () => {},
    heartbeatMs: 5000,
    ...over,
  }
}

describe('transcribe orchestration', () => {
  test('preflight failure short-circuits before any spawn', async () => {
    let whisperCalled = false
    const r = await transcribe('/v.mp4', okDeps({
      resolveBinary: () => null,
      runWhisper: async () => {
        whisperCalled = true
        return { ok: true, json: sampleJson }
      },
    }))
    if (r.ok) throw new Error('expected a preflight failure')
    expect(r.stage).toBe('preflight')
    expect(whisperCalled).toBe(false)
  })

  test('produces a Transcript through probe → extract → whisper → parse', async () => {
    const r = await transcribe('/v.mp4', okDeps())
    if (!r.ok) throw new Error(r.error)
    expect(r.transcript.segments.length).toBe(2)
    // the probed media duration is authoritative over the whisper-derived end
    expect(r.transcript.durationSec).toBe(9)
  })

  test('a no-audio source returns an empty transcript with a note and never spawns', async () => {
    let whisperCalled = false
    let ffmpegCalled = false
    const r = await transcribe('/silent.mp4', okDeps({
      probe: async () => ({ ok: true, data: { durationSec: 4, width: 1280, height: 720, hasAudio: false } }),
      runFfmpeg: async () => {
        ffmpegCalled = true
        return { exitCode: 0, stderr: '' }
      },
      runWhisper: async () => {
        whisperCalled = true
        return { ok: true, json: sampleJson }
      },
    }))
    if (!r.ok) throw new Error(r.error)
    expect(r.transcript.segments).toEqual([])
    expect(r.transcript.durationSec).toBe(4)
    expect(r.note ?? '').toContain('no audio')
    expect(whisperCalled).toBe(false)
    expect(ffmpegCalled).toBe(false)
  })

  test('surfaces a probe failure as the probe stage', async () => {
    const r = await transcribe('/v.mp4', okDeps({
      probe: async () => ({ ok: false, error: 'ffprobe died' }),
    }))
    if (r.ok) throw new Error('expected a probe failure')
    expect(r.stage).toBe('probe')
  })

  test('surfaces a whisper failure as the whisper stage', async () => {
    const r = await transcribe('/v.mp4', okDeps({
      runWhisper: async () => ({ ok: false, error: 'whisper-cli exited 1' }),
    }))
    if (r.ok) throw new Error('expected a whisper failure')
    expect(r.stage).toBe('whisper')
  })

  test('emits a still-transcribing heartbeat during a long run', async () => {
    const logs: string[] = []
    let t = 0
    await transcribe('/v.mp4', okDeps({
      heartbeatMs: 5,
      now: () => {
        t += 1000
        return t
      },
      log: (m) => logs.push(m),
      runWhisper: async () => {
        await new Promise((res) => setTimeout(res, 25))
        return { ok: true, json: sampleJson }
      },
    }))
    expect(logs.some((l) => l.includes('still transcribing'))).toBe(true)
  })
})

describe('transcribePreflight', () => {
  const base = { binary: 'whisper-cli', modelPath: '/m/ggml-base.en.bin' }

  test('ok when the binary resolves and the model file exists', () => {
    const r = transcribePreflight({ ...base, resolveBinary: (b) => `/usr/bin/${b}`, fileExists: () => true })
    expect(r.ok).toBe(true)
  })

  test('fails with an actionable message when the binary is missing', () => {
    const r = transcribePreflight({ ...base, resolveBinary: () => null, fileExists: () => true })
    if (r.ok) throw new Error('expected a preflight failure')
    expect(r.message).toContain('whisper')
  })

  test('fails with an actionable message when the model file is absent', () => {
    const r = transcribePreflight({ ...base, resolveBinary: (b) => `/usr/bin/${b}`, fileExists: () => false })
    if (r.ok) throw new Error('expected a preflight failure')
    expect(r.message).toContain('model')
  })
})
