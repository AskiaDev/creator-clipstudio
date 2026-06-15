import { describe, expect, test } from 'bun:test'
import { buildExtractAudioArgs, extractAudio } from '../src/transcribe/audio'

describe('buildExtractAudioArgs', () => {
  test('builds 16kHz mono WAV args, input before output, with overwrite', () => {
    const args = buildExtractAudioArgs('/in/video.mp4', '/out/audio.wav')
    expect(args).toContain('-ar')
    expect(args).toContain('16000')
    expect(args).toContain('-ac')
    expect(args).toContain('1')
    expect(args).toContain('-y')
    const inIdx = args.indexOf('/in/video.mp4')
    const outIdx = args.indexOf('/out/audio.wav')
    expect(inIdx).toBeGreaterThan(-1)
    expect(outIdx).toBeGreaterThan(inIdx)
    expect(args[args.length - 1]).toBe('/out/audio.wav')
  })
})

describe('extractAudio', () => {
  test('returns the wav path on a successful ffmpeg run', async () => {
    const r = await extractAudio('/in.mp4', '/out.wav', async () => ({ exitCode: 0, stderr: '' }))
    expect(r).toEqual({ ok: true, wavPath: '/out.wav' })
  })

  test('returns an error carrying the ffmpeg stderr tail on a non-zero exit', async () => {
    const r = await extractAudio('/in.mp4', '/out.wav', async () => ({
      exitCode: 1,
      stderr: 'noise\n[error] could not open audio\n',
    }))
    if (r.ok) throw new Error('expected failure')
    expect(r.error).toContain('could not open audio')
  })

  test('passes the built 16kHz args to the injected ffmpeg seam', async () => {
    let captured: readonly string[] = []
    await extractAudio('/in.mp4', '/out.wav', async (a) => {
      captured = a
      return { exitCode: 0, stderr: '' }
    })
    expect(captured).toContain('16000')
  })
})
