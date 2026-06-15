import { NextResponse } from 'next/server'
import { resolveClipPicker } from '@/src/clip/resolve'
import { DEFAULT_CLIP_OPTIONS } from '@/src/clip/types'
import { suggestBodySchema } from '../schemas'

export const runtime = 'nodejs'

/** Suggest ranked clip candidates for a transcript (default provider: local Ollama). Thin handler. */
export async function POST(req: Request) {
  let json: unknown
  try {
    json = await req.json()
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON' }, { status: 400 })
  }

  const parsed = suggestBodySchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join('; ') }, { status: 400 })
  }

  try {
    const picker = resolveClipPicker()
    const candidates = await picker.pickClips({
      transcript: parsed.data.transcript,
      videoDurationSec: parsed.data.videoDurationSec,
      options: parsed.data.options ?? DEFAULT_CLIP_OPTIONS,
    })
    return NextResponse.json({ candidates })
  } catch (err) {
    // Log the full cause server-side; return a generic message so downstream/LLM error bodies don't leak.
    console.error('[clip] suggest failed:', err)
    return NextResponse.json({ error: 'Clip suggestion failed' }, { status: 500 })
  }
}
