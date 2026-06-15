import { describe, expect, test } from 'bun:test'
import { buildFfmpegArgs } from '../src/render/ffmpegArgs'
import { BUILTIN_TEMPLATES, getRenderTemplate } from '../src/templates/builtins'
import { templateSchema } from '../src/templates/schema'

function argsFor(key: string): string[] {
  const template = getRenderTemplate(key)
  if (!template) throw new Error(`expected built-in template "${key}"`)
  return buildFfmpegArgs({
    videoInput: 'in.mp4',
    overlayInput: 'overlay.png',
    output: 'out.mp4',
    canvas: template.canvas,
    region: template.region,
    fit: template.fit,
    background: template.background,
    crf: template.crf,
  })
}

describe('built-in templates', () => {
  test('there are at least two built-ins and each parses the template schema', () => {
    const all = Object.values(BUILTIN_TEMPLATES)
    expect(all.length).toBeGreaterThanOrEqual(2)
    for (const template of all) {
      expect(templateSchema.safeParse(template).success).toBe(true)
    }
  })

  test('rejects an invalid template config (crf out of range)', () => {
    const bad = { ...BUILTIN_TEMPLATES.plain, crf: 999 }
    expect(templateSchema.safeParse(bad).success).toBe(false)
  })

  test('selecting a different template changes the render composition', () => {
    expect(argsFor('plain')).not.toEqual(argsFor('course_promo'))
    expect(argsFor('course_promo')).not.toEqual(argsFor('podcast_caption'))
  })
})
