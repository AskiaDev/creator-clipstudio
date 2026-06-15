import { NextResponse } from 'next/server'
import { buildAss } from '@/src/captions/ass'
import { bodySchema } from './schemas'

export const runtime = 'nodejs'

/** Build burned-in karaoke ASS from an (edited) transcript. POST {transcript, style?} -> {ass}. */
export async function POST(request: Request) {
  let json: unknown
  try {
    json = await request.json()
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    const error = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; ')
    return NextResponse.json({ error }, { status: 400 })
  }

  return NextResponse.json({ ass: buildAss(parsed.data.transcript, parsed.data.style) })
}
