import { NextResponse } from 'next/server'
import { z } from 'zod'

export const runtime = 'nodejs'

const bodySchema = z.object({
  inputFolder: z.string().min(1, 'inputFolder is required'),
  fileName: z.string().min(1, 'fileName is required'),
  templateKey: z.string().min(1, 'templateKey is required'),
  account: z.string().min(1, 'account is required'),
  title: z.string().optional(),
  subtitle: z.string().optional(),
})

/** Render one truthful preview frame (PNG bytes) for the chosen clip + template. */
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
  const body = parsed.data

  try {
    // Trust model (local-first, single-user, no auth): `inputFolder` is the user's own absolute path to
    // their clips — the same trusted-root model as /api/preflight + /api/enqueue. The per-clip `fileName`
    // (which may originate from a CSV) IS sanitized below so it can never escape that folder.
    const { join } = await import('node:path')
    const { isSafeSegment } = await import('@/src/csv/schema')
    if (!isSafeSegment(body.fileName)) {
      return NextResponse.json({ error: 'fileName must be a bare filename (no path separators)' }, { status: 400 })
    }

    const { getDb } = await import('@/src/db')
    const { getTemplate } = await import('@/src/db/templatesRepository')
    const { getRenderTemplate } = await import('@/src/templates/builtins')
    const template = getTemplate(getDb(), body.templateKey) ?? getRenderTemplate(body.templateKey)
    if (!template) {
      return NextResponse.json({ error: `Unknown template "${body.templateKey}"` }, { status: 400 })
    }

    const { renderPreview } = await import('@/src/render/preview')
    const result = await renderPreview({
      videoInput: join(body.inputFolder, body.fileName),
      canvas: template.canvas,
      region: template.region,
      fit: template.fit,
      background: template.background,
      overlay: { title: body.title, subtitle: body.subtitle, watermark: `@${body.account}` },
      template: template.overlay,
    })

    if (!result.ok) {
      return NextResponse.json({ error: `[${result.stage}] ${result.error}` }, { status: 400 })
    }
    // copy into a fresh ArrayBuffer-backed view (BlobPart requires Uint8Array<ArrayBuffer>)
    return new NextResponse(new Blob([new Uint8Array(result.png)], { type: 'image/png' }), {
      headers: { 'content-type': 'image/png', 'cache-control': 'no-store' },
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Preview failed' }, { status: 500 })
  }
}
