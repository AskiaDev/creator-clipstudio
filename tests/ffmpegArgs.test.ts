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

describe('buildFiltergraph reframe crop seam', () => {
  test('no reframeCrop → [0:v] chain is byte-identical (scale begins straight from [0:v])', () => {
    expect(filtergraphOf(buildFfmpegArgs(baseSpec))).toContain(
      '[0:v]scale=960:1100:force_original_aspect_ratio=increase',
    )
  })

  test('with reframeCrop → the crop is prepended to the [0:v] chain before the scale', () => {
    const graph = filtergraphOf(buildFfmpegArgs({ ...baseSpec, reframeCrop: 'crop=203:360:219:0' }))
    expect(graph).toContain('[0:v]crop=203:360:219:0,scale=960:1100:force_original_aspect_ratio=increase')
  })

  test('reframeCrop also applies in contain mode', () => {
    const graph = filtergraphOf(buildFfmpegArgs({ ...baseSpec, fit: 'contain', reframeCrop: 'crop=203:360:219:0' }))
    expect(graph).toContain('[0:v]crop=203:360:219:0,scale=960:1100:force_original_aspect_ratio=decrease')
  })
})

describe('buildFfmpegArgs render-opt seam (Phase 6)', () => {
  test('no hwaccel / no videoEncode → byte-identical (CRF encode, no -hwaccel, video -i first)', () => {
    const args = buildFfmpegArgs(baseSpec)
    expect(args).not.toContain('-hwaccel')
    expect(args).toContain('-crf')
    expect(args.slice(0, 2)).toEqual(['-i', baseSpec.videoInput])
  })

  test('hwaccel videotoolbox is prepended before the first -i (decode accel)', () => {
    const args = buildFfmpegArgs({ ...baseSpec, hwaccel: 'videotoolbox' })
    expect(args.slice(0, 4)).toEqual(['-hwaccel', 'videotoolbox', '-i', baseSpec.videoInput])
  })

  test('videoEncode replaces -crf with libx264 VBV bitrate + GOP', () => {
    const args = buildFfmpegArgs({
      ...baseSpec,
      videoEncode: { bitrate: 20_000_000, maxrate: 29_000_000, bufsize: 58_000_000, keyint: 90 },
    })
    expect(args).not.toContain('-crf')
    expect(args).toContain('libx264') // encoder unchanged — VBV, not a hardware encoder
    expect(args[args.indexOf('-b:v') + 1]).toBe('20000000')
    expect(args[args.indexOf('-maxrate') + 1]).toBe('29000000')
    expect(args[args.indexOf('-bufsize') + 1]).toBe('58000000')
    expect(args[args.indexOf('-g') + 1]).toBe('90')
  })
})

describe('buildFfmpegArgs b-roll cutaway seam (Phase 5)', () => {
  const inputsOf = (args: readonly string[]): string[] => args.filter((_a, i) => args[i - 1] === '-i')

  test('no cutaways → only the two base inputs and a byte-identical graph', () => {
    const args = buildFfmpegArgs(baseSpec)
    expect(inputsOf(args)).toEqual(['in.mp4', 'overlay.png'])
    expect(filtergraphOf(args).endsWith('[base][1:v]overlay=0:0[out]')).toBe(true)
    expect(filtergraphOf(args)).not.toContain('enable=')
  })

  test('a cutaway adds an input and overlays it full-frame only during its window', () => {
    const args = buildFfmpegArgs({ ...baseSpec, cutaways: [{ input: '/b/r.png', startSec: 1, endSec: 2 }] })
    expect(inputsOf(args)).toEqual(['in.mp4', 'overlay.png', '/b/r.png'])
    const g = filtergraphOf(args)
    expect(g).toContain('[base][1:v]overlay=0:0[bov]')
    expect(g).toContain('[2:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[bc0]')
    expect(g).toContain("[bov][bc0]overlay=0:0:enable='between(t,1,2)'[out]")
  })

  test('cutaway sits UNDER captions: cutaway → [cap], then ass burns on top → [out]', () => {
    const g = filtergraphOf(
      buildFfmpegArgs({ ...baseSpec, subtitlePath: '/c.ass', cutaways: [{ input: '/b/r.png', startSec: 1, endSec: 2 }] }),
    )
    expect(g).toContain("[bov][bc0]overlay=0:0:enable='between(t,1,2)'[cap]")
    expect(g).toContain('[cap]ass=filename=/c.ass[out]')
  })

  test('multiple cutaways chain in order to [out]', () => {
    const g = filtergraphOf(
      buildFfmpegArgs({
        ...baseSpec,
        cutaways: [
          { input: '/b/0.png', startSec: 1, endSec: 2 },
          { input: '/b/1.png', startSec: 3, endSec: 4 },
        ],
      }),
    )
    expect(g).toContain("[bov][bc0]overlay=0:0:enable='between(t,1,2)'[cut0]")
    expect(g).toContain("[cut0][bc1]overlay=0:0:enable='between(t,3,4)'[out]")
  })
})
