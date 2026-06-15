import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type RenderDeps, type RenderRequest, renderClip } from '../src/render/runRender'

const OUT_DIR = mkdtempSync(join(tmpdir(), 'cc-rr-test-'))
afterAll(() => rmSync(OUT_DIR, { recursive: true, force: true }))

const REQUEST: RenderRequest = {
  videoInput: '/tmp/in.mp4',
  output: join(OUT_DIR, 'sub', 'sample_reel.mp4'),
  canvas: { width: 1080, height: 1920 },
  region: { x: 60, y: 460, width: 960, height: 1100 },
  fit: 'cover',
  background: '0x000000',
  crf: 20,
  overlay: { title: 'T', subtitle: 'S', watermark: 'W' },
}

/** Deps where every stage succeeds; individual tests override the stage under test. */
function okDeps(over: Partial<RenderDeps> = {}): Partial<RenderDeps> {
  return {
    resolveBinary: (b) => `/usr/bin/${b}`,
    probeVideo: async () => ({ ok: true, data: { durationSec: 1, width: 640, height: 360, hasAudio: true } }),
    makeOverlayPng: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    runFfmpeg: async () => ({ exitCode: 0, stderr: '' }),
    ...over,
  }
}

describe('renderClip orchestration', () => {
  test('fails at the preflight stage when a required binary is missing', async () => {
    const result = await renderClip(REQUEST, okDeps({ resolveBinary: (b) => (b === 'ffmpeg' ? null : `/usr/bin/${b}`) }))
    if (result.ok) throw new Error('expected a preflight failure')
    expect(result.stage).toBe('preflight')
  })

  test('fails at the probe stage when ffprobe yields no usable data', async () => {
    const result = await renderClip(REQUEST, okDeps({ probeVideo: async () => ({ ok: false, error: 'no video stream found' }) }))
    if (result.ok) throw new Error('expected a probe failure')
    expect(result.stage).toBe('probe')
    expect(result.error).toContain('no video stream')
  })

  test('fails at the overlay stage when the overlay renderer throws', async () => {
    const result = await renderClip(REQUEST, okDeps({
      makeOverlayPng: async () => {
        throw new Error('font missing')
      },
    }))
    if (result.ok) throw new Error('expected an overlay failure')
    expect(result.stage).toBe('overlay')
    expect(result.error).toContain('font missing')
  })

  test('fails at the ffmpeg stage on a non-zero exit, carrying the stderr tail', async () => {
    const result = await renderClip(REQUEST, okDeps({
      runFfmpeg: async () => ({ exitCode: 1, stderr: 'x\n[error] Invalid argument while filtering\n' }),
    }))
    if (result.ok) throw new Error('expected an ffmpeg failure')
    expect(result.stage).toBe('ffmpeg')
    expect(result.error).toContain('Invalid argument')
  })

  test('succeeds, passes the built args to ffmpeg, and deletes the temp overlay', async () => {
    let captured: readonly string[] | undefined
    const result = await renderClip(REQUEST, okDeps({
      runFfmpeg: async (args) => {
        captured = args
        return { exitCode: 0, stderr: '' }
      },
    }))

    if (!result.ok) throw new Error(`expected success, got ${result.stage}: ${result.error}`)
    expect(result.output).toBe(REQUEST.output)
    expect(result.probe.width).toBe(640)

    const args = captured ?? []
    expect(args).toContain('-filter_complex')
    expect(args).toContain(REQUEST.output)
    const overlayArg = args.find((a) => a.endsWith('overlay.png'))
    expect(overlayArg).toBeDefined()
    // the temp overlay PNG must be cleaned up after the render
    expect(existsSync(overlayArg as string)).toBe(false)
  })
})
