/**
 * SQLite connection for the runtime, via `bun:sqlite` + Drizzle.
 *
 * `createDb` opens a database (a file path, or `:memory:` for tests) with foreign keys enforced and
 * returns a typed Drizzle instance. drizzle-kit (dev) talks to the same file through `@libsql/client`.
 *
 * RUNTIME: `bun:sqlite` only resolves under the Bun runtime, so the Next server must run under Bun —
 * the `dev`/`start` scripts use `bun --bun next ...`. Route handlers import this module lazily so
 * `next build` (Node) never evaluates it. Running the server under plain Node would 500 on DB access.
 */

import { Database } from 'bun:sqlite'
import { type BunSQLiteDatabase, drizzle } from 'drizzle-orm/bun-sqlite'
import * as schema from './schema'

export type Db = BunSQLiteDatabase<typeof schema>

/** A connected database plus an explicit `close()` for the underlying handle (used by tests). */
export interface DbHandle {
  readonly db: Db
  readonly close: () => void
}

export const DEFAULT_DB_PATH = process.env.DATABASE_PATH ?? './data/creatorclip.db'

/** Open a database and return both the Drizzle instance and a typed close handle. */
export function openDb(path: string = DEFAULT_DB_PATH): DbHandle {
  const sqlite = new Database(path)
  sqlite.exec('PRAGMA foreign_keys = ON;')
  return { db: drizzle(sqlite, { schema }), close: () => sqlite.close() }
}

/** Open a database for the lifetime of the process (the handle is owned until exit). */
export function createDb(path: string = DEFAULT_DB_PATH): Db {
  return openDb(path).db
}
