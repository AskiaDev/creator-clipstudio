import { NextResponse } from 'next/server'
import { z } from 'zod'
import { enqueueBatch } from '@/src/queue/batch'

export const runtime = 'nodejs'

const bodySchema = z.object({
  inputFolder: z.string().min(1, 'inputFolder is required'),
  csvText: z.string().min(1, 'csvText is required'),
})

/** Pre-flight + enqueue the valid rows as pending render jobs. */
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
    // Lazy DB import — keeps `bun:sqlite` out of `next build`'s Node-based page collection.
    const { getDb } = await import('@/src/db')
    return NextResponse.json(enqueueBatch(getDb(), parsed.data.csvText, parsed.data.inputFolder))
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not read the input folder'
    return NextResponse.json({ error: `Input folder problem: ${message}` }, { status: 400 })
  }
}
