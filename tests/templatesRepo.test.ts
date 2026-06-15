import { afterAll, describe, expect, test } from 'bun:test'
import { openDb } from '../src/db/client'
import { applyMigrations } from '../src/db/migrate'
import { getTemplate, listTemplates, seedTemplates, upsertTemplate } from '../src/db/templatesRepository'
import { BUILTIN_TEMPLATES } from '../src/templates/builtins'

const closers: Array<() => void> = []
afterAll(() => {
  for (const close of closers) close()
})
function freshDb() {
  const { db, close } = openDb(':memory:')
  applyMigrations(db)
  closers.push(close)
  return db
}

const BUILTIN_COUNT = Object.keys(BUILTIN_TEMPLATES).length

describe('templatesRepository', () => {
  test('seeds the built-ins idempotently', () => {
    const db = freshDb()
    seedTemplates(db)
    seedTemplates(db) // second call is a no-op
    expect(listTemplates(db)).toHaveLength(BUILTIN_COUNT)
  })

  test('upsert validates and round-trips an edit; the DB row overrides the built-in', () => {
    const db = freshDb()
    seedTemplates(db)
    const result = upsertTemplate(db, { ...BUILTIN_TEMPLATES.plain, name: 'Plain (edited)', crf: 23 })
    expect(result.ok).toBe(true)

    const stored = getTemplate(db, 'plain')
    expect(stored?.name).toBe('Plain (edited)')
    expect(stored?.crf).toBe(23)
    expect(listTemplates(db)).toHaveLength(BUILTIN_COUNT) // still an upsert, not an insert
  })

  test('rejects an invalid config before persistence', () => {
    const db = freshDb()
    const result = upsertTemplate(db, { ...BUILTIN_TEMPLATES.plain, crf: 999 })
    expect(result.ok).toBe(false)
    expect(getTemplate(db, 'plain')).toBeUndefined()
  })
})
