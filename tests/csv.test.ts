import { describe, expect, test } from 'bun:test'
import { buildPreflight } from '../src/csv/parse'

const FILES = new Map([
  ['clip1.mp4', '/in/clip1.mp4'],
  ['clip2.mp4', '/in/clip2.mp4'],
])
const TEMPLATES = new Set(['default', 'bold'])

const HEADER = 'file_name,title,subtitle,category,account,template'
const csv = (...rows: string[]) => [HEADER, ...rows].join('\n')

describe('buildPreflight', () => {
  test('accepts a well-formed row and attaches the matched source path', () => {
    const report = buildPreflight(csv('clip1.mp4,Summer Sale,Half off,promo,acme,default'), FILES, TEMPLATES)
    expect(report.invalid).toHaveLength(0)
    expect(report.valid).toHaveLength(1)
    expect(report.valid[0]).toMatchObject({
      fileName: 'clip1.mp4',
      title: 'Summer Sale',
      account: 'acme',
      category: 'promo',
      template: 'default',
      sourcePath: '/in/clip1.mp4',
    })
  })

  test('rejects a row whose CSV is missing a required column', () => {
    // No `account` column at all.
    const text = ['file_name,title,subtitle,category,template', 'clip1.mp4,T,S,promo,default'].join('\n')
    const report = buildPreflight(text, FILES, TEMPLATES)
    expect(report.valid).toHaveLength(0)
    expect(report.invalid).toHaveLength(1)
    expect(report.invalid[0].errors.join(' ')).toContain('account')
  })

  test('rejects a row whose file_name is not in the input folder', () => {
    const report = buildPreflight(csv('missing.mp4,T,S,promo,acme,default'), FILES, TEMPLATES)
    expect(report.valid).toHaveLength(0)
    expect(report.invalid[0].errors.join(' ')).toContain('not found')
  })

  test('rejects a row referencing an unknown template', () => {
    const report = buildPreflight(csv('clip1.mp4,T,S,promo,acme,nope'), FILES, TEMPLATES)
    expect(report.valid).toHaveLength(0)
    expect(report.invalid[0].errors.join(' ')).toContain('not a known template')
  })

  test('rejects path-traversal in file_name, account, or category', () => {
    const fileName = buildPreflight(csv('../clip1.mp4,T,S,promo,acme,default'), FILES, TEMPLATES)
    expect(fileName.valid).toHaveLength(0)
    expect(fileName.invalid[0].errors.join(' ')).toContain('file_name')

    const account = buildPreflight(csv('clip1.mp4,T,S,promo,../evil,default'), FILES, TEMPLATES)
    expect(account.valid).toHaveLength(0)
    expect(account.invalid[0].errors.join(' ')).toContain('account')

    const category = buildPreflight(csv('clip1.mp4,T,S,..,acme,default'), FILES, TEMPLATES)
    expect(category.valid).toHaveLength(0)
    expect(category.invalid[0].errors.join(' ')).toContain('category')
  })

  test('preserves a quoted comma inside a title', () => {
    const report = buildPreflight(csv('clip1.mp4,"Hello, World",S,promo,acme,default'), FILES, TEMPLATES)
    expect(report.valid).toHaveLength(1)
    expect(report.valid[0].title).toBe('Hello, World')
  })

  test('partitions a mixed CSV into valid and invalid', () => {
    const report = buildPreflight(
      csv(
        'clip1.mp4,Good,One,promo,acme,default', // valid
        'missing.mp4,Bad,Two,promo,acme,default', // bad file
        'clip2.mp4,Also Good,Three,reels,beta,bold', // valid
      ),
      FILES,
      TEMPLATES,
    )
    expect(report.valid).toHaveLength(2)
    expect(report.invalid).toHaveLength(1)
    expect(report.invalid[0].rowNumber).toBe(2)
  })
})
