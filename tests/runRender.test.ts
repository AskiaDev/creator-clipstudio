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

/** Extract the filtergraph string that follows `-filter_complex` in a captured argv. */
function filtergraphOf(args: readonly string[]): string {
  return args[args.indexOf('-filter_complex') + 1] ?? ''
}
/** ok deps that record the ffmpeg argv the renderer would spawn, into `sink.args`. */
function capturingDeps(sink: { args: readonly string[] }): Partial<RenderDeps> {
  return okDeps({
    runFfmpeg: async (args) => {
      sink.args = args
      return { exitCode: 0, stderr: '' }
    },
  })
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

describe('renderClip subtitle threading (Phase 3 captions)', () => {
  test('threads request.subtitlePath into the filtergraph as a burned-in ass filter', async () => {
    const sink = { args: [] as readonly string[] }
    const result = await renderClip({ ...REQUEST, subtitlePath: '/tmp/caps/cap.ass' }, capturingDeps(sink))
    if (!result.ok) throw new Error(`expected success, got ${result.stage}: ${result.error}`)
    expect(filtergraphOf(sink.args)).toContain('ass=filename=/tmp/caps/cap.ass')
  })

  test('omits the ass filter when no subtitlePath — graph ends [out], byte-identical to pre-captions', async () => {
    const sink = { args: [] as readonly string[] }
    await renderClip(REQUEST, capturingDeps(sink))
    const graph = filtergraphOf(sink.args)
    expect(graph).not.toContain('ass=')
    expect(graph.endsWith('[out]')).toBe(true)
  })
})

describe('renderClip reframe threading (Phase 4)', () => {
  test('computes the reframe crop from the probed source dims and prepends it to [0:v]', async () => {
    const sink = { args: [] as readonly string[] }
    // okDeps probes 640x360 → center focus → crop=203:360:219:0
    const result = await renderClip({ ...REQUEST, reframe: { focus: { x: 0.5, y: 0.5 } } }, capturingDeps(sink))
    if (!result.ok) throw new Error(`expected success, got ${result.stage}: ${result.error}`)
    expect(filtergraphOf(sink.args)).toContain('[0:v]crop=203:360:219:0,scale=')
  })

  test('no reframe → no crop prepended (byte-identical [0:v] chain)', async () => {
    const sink = { args: [] as readonly string[] }
    await renderClip(REQUEST, capturingDeps(sink))
    const graph = filtergraphOf(sink.args)
    expect(graph).toContain('[0:v]scale=')
    expect(graph).not.toContain('crop=203:360:219:0')
  })

  test('fails at the reframe stage when the focus geometry is invalid', async () => {
    const result = await renderClip(
      { ...REQUEST, reframe: { focus: { x: Number.NaN, y: 0.5 } } },
      capturingDeps({ args: [] as readonly string[] }),
    )
    if (result.ok) throw new Error('expected a reframe failure')
    expect(result.stage).toBe('reframe')
  })
})

describe('renderClip render-opt threading (Phase 6)', () => {
  function exportDeps(sink: { args: readonly string[]; logs: string[] }, hwaccelAvailable: boolean): Partial<RenderDeps> {
    return okDeps({
      runFfmpeg: async (args) => {
        sink.args = args
        return { exitCode: 0, stderr: '' }
      },
      detectHwaccel: () => hwaccelAvailable,
      log: (m) => sink.logs.push(m),
    })
  }

  test('export → threads VBV bitrate + videotoolbox hwaccel and logs the plan', async () => {
    const sink = { args: [] as readonly string[], logs: [] as string[] }
    const result = await renderClip({ ...REQUEST, export: { tier: 'high' } }, exportDeps(sink, true))
    if (!result.ok) throw new Error(`expected success, got ${result.stage}: ${result.error}`)
    expect(sink.args.slice(0, 2)).toEqual(['-hwaccel', 'videotoolbox'])
    expect(sink.args).not.toContain('-crf')
    expect(sink.args[sink.args.indexOf('-b:v') + 1]).toBe('20000000') // 1080x1920 high
    expect(sink.logs.some((l) => l.includes('[render-opt]'))).toBe(true)
  })

  test('software fallback: hwaccel unavailable → no -hwaccel, still VBV, logs the fallback', async () => {
    const sink = { args: [] as readonly string[], logs: [] as string[] }
    await renderClip({ ...REQUEST, export: { tier: 'high' } }, exportDeps(sink, false))
    expect(sink.args).not.toContain('-hwaccel')
    expect(sink.args).toContain('-b:v')
    expect(sink.logs.some((l) => l.toLowerCase().includes('software decode'))).toBe(true)
  })

  test('export with hwaccel:false → VBV bitrate but never -hwaccel even if available', async () => {
    const sink = { args: [] as readonly string[], logs: [] as string[] }
    await renderClip({ ...REQUEST, export: { tier: 'high', hwaccel: false } }, exportDeps(sink, true))
    expect(sink.args).not.toContain('-hwaccel')
    expect(sink.args).toContain('-b:v')
  })

  test('no export → byte-identical encode (-crf, no -hwaccel, no -b:v)', async () => {
    const sink = { args: [] as readonly string[], logs: [] as string[] }
    await renderClip(REQUEST, exportDeps(sink, true))
    expect(sink.args).toContain('-crf')
    expect(sink.args).not.toContain('-hwaccel')
    expect(sink.args).not.toContain('-b:v')
  })
})

describe('renderClip cutaway threading (Phase 5)', () => {
  test('threads cutaways → extra input + windowed overlay in the graph', async () => {
    const sink = { args: [] as readonly string[] }
    await renderClip({ ...REQUEST, cutaways: [{ input: '/b/r.png', startSec: 0.3, endSec: 0.7 }] }, capturingDeps(sink))
    expect(sink.args.filter((_a, i) => sink.args[i - 1] === '-i')).toContain('/b/r.png')
    expect(filtergraphOf(sink.args)).toContain("enable='between(t,0.3,0.7)'")
  })

  test('no cutaways → no extra input, no enable= (byte-identical)', async () => {
    const sink = { args: [] as readonly string[] }
    await renderClip(REQUEST, capturingDeps(sink))
    expect(filtergraphOf(sink.args)).not.toContain('enable=')
    expect(filtergraphOf(sink.args)).not.toContain('/b/r.png')
  })
})
