import { describe, expect, test } from 'bun:test'
import { resolveCutaways } from '../src/broll/cutaway'
import type { BrollImageOptions, BrollImageProvider, BrollImageResult } from '../src/broll/image'
import type { BrollCue } from '../src/broll/keywords'

function cue(over: Partial<BrollCue> = {}): BrollCue {
  return { phrase: 'about electric cars', term: 'electric cars', startSec: 1, endSec: 2, score: 10, ...over }
}
function provider(fn: (keyword: string) => BrollImageResult): BrollImageProvider {
  return { fetchImage: async (keyword) => fn(keyword) }
}
const fileOk = (path: string): BrollImageResult => ({ ok: true, image: { kind: 'file', path, source: 'local' } })
const urlOk = (url: string): BrollImageResult => ({ ok: true, image: { kind: 'url', url, source: 'stock' } })
const fail = (): BrollImageResult => ({ ok: false, error: { kind: 'empty', message: 'no results' } })

describe('resolveCutaways — pair cues with images', () => {
  test('maps a file-image cue to a cutaway over its window', async () => {
    const out = await resolveCutaways([cue({ startSec: 1, endSec: 2 })], provider(() => fileOk('/tmp/b.png')))
    expect(out).toEqual([{ input: '/tmp/b.png', startSec: 1, endSec: 2 }])
  })

  test('uses the URL for a stock (url) image', async () => {
    const out = await resolveCutaways([cue()], provider(() => urlOk('https://img.example/x.jpg')))
    expect(out[0].input).toBe('https://img.example/x.jpg')
  })

  test('skips (and logs) a cue whose image fetch fails; the rest still resolve', async () => {
    const logs: string[] = []
    const out = await resolveCutaways(
      [cue({ term: 'good', startSec: 1, endSec: 2 }), cue({ term: 'bad', startSec: 3, endSec: 4 })],
      provider((k) => (k === 'bad' ? fail() : fileOk('/tmp/good.png'))),
      { log: (m) => logs.push(m) },
    )
    expect(out).toEqual([{ input: '/tmp/good.png', startSec: 1, endSec: 2 }])
    expect(logs.some((l) => l.includes('bad'))).toBe(true)
  })

  test('empty cues → no cutaways', async () => {
    expect(await resolveCutaways([], provider(() => fileOk('/x.png')))).toEqual([])
  })

  test('forwards image options to the provider', async () => {
    let seen: BrollImageOptions | undefined
    const p: BrollImageProvider = {
      fetchImage: async (_k, opts) => {
        seen = opts
        return fileOk('/x.png')
      },
    }
    await resolveCutaways([cue()], p, { imageOptions: { orientation: 'portrait' } })
    expect(seen).toEqual({ orientation: 'portrait' })
  })

  test('skips a provider URL that is not SSRF-safe before handing it to ffmpeg (defense-in-depth)', async () => {
    const logs: string[] = []
    const out = await resolveCutaways([cue()], provider(() => urlOk('http://169.254.169.254/latest/meta-data/')), {
      log: (m) => logs.push(m),
    })
    expect(out).toEqual([])
    expect(logs.some((l) => l.toLowerCase().includes('unsafe url'))).toBe(true)
  })

  test('skips a cue with an invalid time window (never emits a broken between())', async () => {
    const logs: string[] = []
    const out = await resolveCutaways(
      [cue({ term: 'reversed', startSec: 2, endSec: 1 }), cue({ term: 'nan', startSec: Number.NaN, endSec: 2 })],
      provider(() => fileOk('/x.png')),
      { log: (m) => logs.push(m) },
    )
    expect(out).toEqual([])
    expect(logs.filter((l) => l.includes('invalid window'))).toHaveLength(2)
  })
})
