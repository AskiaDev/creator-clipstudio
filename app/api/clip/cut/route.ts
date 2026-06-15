import { join } from 'node:path'
import { NextResponse } from 'next/server'
import { cutClip } from '@/src/clip/cut'
import { cutBodySchema } from '../schemas'

export const runtime = 'nodejs'

const OUTPUT_ROOT = process.env.OUTPUT_ROOT ?? './output'
// H.264 quality/size trade-off; 20 ≈ visually lossless for shorts and matches the renderer's golden default.
const CLIP_CRF = 20

/** Cut the requested ranges out of a source file into `output/clips/`. Thin handler. */
export async function POST(req: Request) {
  let json: unknown
  try {
    json = await req.json()
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON' }, { status: 400 })
  }

  const parsed = cutBodySchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join('; ') }, { status: 400 })
  }

  const { inputFolder, fileName, ranges } = parsed.data
  // `fileName` and each `name` are isSafeSegment-validated, so they cannot escape `inputFolder` / the
  // output dir. `inputFolder` itself is operator-chosen (same trust model as the existing renderer
  // enqueue/preflight routes) — this app assumes a trusted local operator.
  const source = join(inputFolder, fileName)
  try {
    const results = []
    for (const r of ranges) {
      const output = join(OUTPUT_ROOT, 'clips', `${r.name}.mp4`)
      results.push(await cutClip({ source, startSec: r.startSec, endSec: r.endSec, output, crf: CLIP_CRF }))
    }
    return NextResponse.json({ results })
  } catch (err) {
    console.error('[clip] cut failed:', err)
    return NextResponse.json({ error: 'Cut operation failed' }, { status: 500 })
  }
}
