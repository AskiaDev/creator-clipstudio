import { NextResponse } from 'next/server'
import { getBatchStatus } from '@/src/queue/batch'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Job status snapshot for the live progress panel. The DB module (which loads `bun:sqlite`) is
 * imported lazily so `next build`'s Node-based page collection never evaluates it.
 */
export async function GET() {
  try {
    const { getDb } = await import('@/src/db')
    return NextResponse.json(getBatchStatus(getDb()))
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Status unavailable'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
