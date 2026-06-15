/**
 * Apply the committed Drizzle migrations to a `bun:sqlite` database.
 *
 * Used by the runtime to bring a fresh DB up to date, and by tests to apply the REAL migration to an
 * in-memory database before a round-trip.
 */

import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import type { Db } from './client'

export const MIGRATIONS_FOLDER = './drizzle'

export function applyMigrations(db: Db, migrationsFolder: string = MIGRATIONS_FOLDER): void {
  migrate(db, { migrationsFolder })
}
