import { defineConfig } from 'drizzle-kit'

/**
 * Drizzle wiring for CreatorClip Studio.
 *
 * Phase 1 stands up the config + migration runner only — no tables are defined yet
 * (the schema arrives in Phase 5). `bun run db:migrate` is therefore a clean no-op that
 * proves the config loads and a local SQLite file can be opened.
 */
// drizzle-kit connects through @libsql/client, which expects a `file:` URL.
// The runtime (Phase 6) opens the same file via bun:sqlite using a plain path.
const DATABASE_URL = process.env.DATABASE_URL ?? 'file:./data/creatorclip.db'

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: DATABASE_URL,
  },
})
