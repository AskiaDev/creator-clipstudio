import { describe, expect, test } from 'bun:test'
import { buildFfmpegArgs, type RenderSpec } from '../src/render/ffmpegArgs'

const baseSpec: RenderSpec = {
  videoInput: 'in.mp4',
  overlayInput: 'overlay.png',
  output: 'out.mp4',
  canvas: { width: 1080, height: 1920 },
  region: { x: 60, y: 460, width: 960, height: 1100 },
  fit: 'cover',
  background: '0x000000',
  crf: 20,
}

/** Extract the filtergraph string that follows `-filter_complex`. */
function filtergraphOf(args: readonly string[]): string {
  const value = args[args.indexOf('-filter_complex') + 1]
  return value ?? ''
}

/** Collect every argument that immediately follows a `-map` flag. */
function mapsOf(args: readonly string[]): string[] {
  return args.filter((_arg, i) => args[i - 1] === '-map')
}

describe('buildFfmpegArgs', () => {
  test('cover reproduces the reference filtergraph', () => {
    const graph = filtergraphOf(buildFfmpegArgs(baseSpec))

    expect(graph).toBe(
      'color=c=0x000000:s=1080x1920[bg];' +
        '[0:v]scale=960:1100:force_original_aspect_ratio=increase,crop=960:1100[v];' +
        '[bg][v]overlay=60:460:shortest=1[base];' +
        '[base][1:v]overlay=0:0[out]',
    )
  })

  test('bounds the composite to the source video with shortest=1 (no-audio runaway regression)', () => {
    // The `color` background is an infinite source; -shortest only bounds output when a finite stream
    // (normally the audio) is mapped. A clip with no audio would otherwise encode until the disk fills.
    // shortest=1 on the background↔video overlay ends the composite with the finite source video.
    expect(filtergraphOf(buildFfmpegArgs(baseSpec))).toContain('[bg][v]overlay=60:460:shortest=1[base]')
    expect(filtergraphOf(buildFfmpegArgs({ ...baseSpec, fit: 'contain' }))).toContain(':shortest=1[base]')
  })

  test('contain scales with decrease and centers the video in the region', () => {
    const graph = filtergraphOf(buildFfmpegArgs({ ...baseSpec, fit: 'contain' }))

    expect(graph).toContain('force_original_aspect_ratio=decrease')
    expect(graph).toContain('overlay=x=60+(960-overlay_w)/2:y=460+(1100-overlay_h)/2')
    expect(graph).toContain('color=c=0x000000:s=1080x1920[bg]')
  })

  test('maps the composed video and optional source audio', () => {
    const args = buildFfmpegArgs(baseSpec)

    expect(mapsOf(args)).toEqual(['[out]', '0:a?'])
    expect(args).toContain('-shortest')
  })

  test('encodes H.264 / AAC / yuv420p / +faststart with a configurable crf', () => {
    const args = buildFfmpegArgs({ ...baseSpec, crf: 18 })

    expect(args).toContain('libx264')
    expect(args).toContain('aac')
    expect(args).toContain('yuv420p')
    expect(args).toContain('+faststart')
    expect(args[args.indexOf('-crf') + 1]).toBe('18')
  })

  test('orders the two inputs first and the output last (with overwrite)', () => {
    const args = buildFfmpegArgs(baseSpec)

    expect(args.slice(0, 4)).toEqual(['-i', 'in.mp4', '-i', 'overlay.png'])
    expect(args[args.length - 1]).toBe('out.mp4')
    expect(args[args.length - 2]).toBe('-y')
  })
})

describe('buildFiltergraph subtitle burn-in seam', () => {
  test('no subtitlePath → byte-identical graph: output ends [out], no ass filter', () => {
    const graph = filtergraphOf(buildFfmpegArgs(baseSpec))
    expect(graph.endsWith('[base][1:v]overlay=0:0[out]')).toBe(true)
    expect(graph).not.toContain('ass=')
  })

  test('with subtitlePath → appends an ass filter routed into [out]', () => {
    const graph = filtergraphOf(buildFfmpegArgs({ ...baseSpec, subtitlePath: '/tmp/d/cap.ass' }))
    expect(graph).toContain('[base][1:v]overlay=0:0[cap]')
    expect(graph.endsWith('[cap]ass=filename=/tmp/d/cap.ass[out]')).toBe(true)
  })

  test('escapes filtergraph-special characters in the subtitle path', () => {
    const graph = filtergraphOf(buildFfmpegArgs({ ...baseSpec, subtitlePath: '/tmp/a:b/cap.ass' }))
    expect(graph).toContain('ass=filename=/tmp/a\\:b/cap.ass[out]')
  })
})
