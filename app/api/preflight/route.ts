import { NextResponse } from 'next/server'
import { z } from 'zod'
import { runPreflight } from '@/src/queue/batch'

export const runtime = 'nodejs'

const bodySchema = z.object({
  inputFolder: z.string().min(1, 'inputFolder is required'),
  csvText: z.string().min(1, 'csvText is required'),
})

/** Validate a CSV against the input folder without enqueueing — powers the preview table. */
export async function POST(request: Request) {
  let json: unknown
  try {
    json = await request.json()
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join('; ') }, { status: 400 })
  }

  try {
    return NextResponse.json(runPreflight(parsed.data.csvText, parsed.data.inputFolder))
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not read the input folder'
    return NextResponse.json({ error: `Input folder problem: ${message}` }, { status: 400 })
  }
}
