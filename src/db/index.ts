/**
 * Process-wide database accessor for the Next.js route handlers.
 *
 * Opens the runtime DB once and applies migrations on first use, so a fresh checkout serves requests
 * without a manual migrate step. The worker process opens its own connection separately.
 */

import { type Db, createDb } from './client'
import { applyMigrations } from './migrate'

let cached: Db | undefined

export function getDb(): Db {
  if (!cached) {
    const db = createDb()
    applyMigrations(db)
    cached = db
  }
  return cached
}
