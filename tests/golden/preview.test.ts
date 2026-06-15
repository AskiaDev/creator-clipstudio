import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { renderPreview } from '../../src/render/preview'
import { BUILTIN_TEMPLATES } from '../../src/templates/builtins'

const FIXTURE = join(import.meta.dir, '..', 'fixtures', 'sample-16x9.mp4')
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47]

function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

describe('golden preview (real ffmpeg)', () => {
  test(
    'renders a truthful 1080x1920 preview frame at the clip midpoint',
    async () => {
      const template = BUILTIN_TEMPLATES.course_promo
      const result = await renderPreview({
        videoInput: FIXTURE,
        canvas: template.canvas,
        region: template.region,
        fit: template.fit,
        background: template.background,
        overlay: { title: 'Preview', subtitle: 'midpoint frame', watermark: '@acme' },
        template: template.overlay,
      })

      expect(result.ok).toBe(true)
      if (!result.ok) return

      expect(PNG_SIGNATURE.every((b, i) => result.png[i] === b)).toBe(true)
      expect(pngSize(result.png)).toEqual({ width: 1080, height: 1920 })
      expect(result.atSec).toBeGreaterThan(0)
    },
    60_000,
  )
})
