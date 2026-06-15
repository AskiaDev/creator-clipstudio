import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function message(err: unknown): string {
  return err instanceof Error ? err.message : 'Templates unavailable'
}

/** List persisted templates (built-ins are seeded on first DB use). */
export async function GET() {
  try {
    const { getDb } = await import('@/src/db')
    const { listTemplates } = await import('@/src/db/templatesRepository')
    return NextResponse.json({ templates: listTemplates(getDb()) })
  } catch (err) {
    return NextResponse.json({ error: message(err) }, { status: 500 })
  }
}

/** Upsert an edited template config (validated by the schema; invalid → 400). */
export async function PUT(request: Request) {
  let json: unknown
  try {
    json = await request.json()
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON' }, { status: 400 })
  }

  try {
    const { getDb } = await import('@/src/db')
    const { upsertTemplate } = await import('@/src/db/templatesRepository')
    const result = upsertTemplate(getDb(), json)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
    return NextResponse.json({ template: result.template })
  } catch (err) {
    return NextResponse.json({ error: message(err) }, { status: 500 })
  }
}
