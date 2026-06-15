/**
 * Parse + validate a metadata CSV into a pre-flight report.
 *
 * Pure and side-effect-free: the caller supplies the available input files (name → path) and the known
 * template keys, so this never touches the filesystem or DB. Every row lands in exactly one of `valid`
 * (carrying its matched source path) or `invalid` (carrying human-readable reasons) — it never throws.
 */

import Papa from 'papaparse'
import { csvRowSchema } from './schema'

export interface ValidRow {
  readonly fileName: string
  readonly title: string
  readonly subtitle: string
  readonly category: string
  readonly account: string
  readonly template: string
  /** Absolute path of the matched input file. */
  readonly sourcePath: string
}

export interface InvalidRow {
  /** 1-based data-row index (the header is not counted). */
  readonly rowNumber: number
  readonly raw: Record<string, unknown>
  readonly errors: readonly string[]
}

export interface PreflightReport {
  readonly valid: readonly ValidRow[]
  readonly invalid: readonly InvalidRow[]
}

/** Parse CSV text into header-keyed row objects (quoted commas/newlines preserved by Papa). */
export function parseCsv(text: string): Record<string, string>[] {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  })
  return result.data
}

/**
 * Validate parsed rows against the schema, match each `file_name` to an available file and each
 * `template` to a known key, and partition into valid/invalid.
 */
export function buildPreflight(
  csvText: string,
  availableFiles: ReadonlyMap<string, string>,
  knownTemplates: ReadonlySet<string>,
): PreflightReport {
  const valid: ValidRow[] = []
  const invalid: InvalidRow[] = []

  const rows = parseCsv(csvText)
  for (let index = 0; index < rows.length; index++) {
    const raw = rows[index]
    const rowNumber = index + 1
    const parsed = csvRowSchema.safeParse(raw)

    if (!parsed.success) {
      const errors = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'row'}: ${issue.message}`)
      invalid.push({ rowNumber, raw, errors })
      continue
    }

    const row = parsed.data
    const errors: string[] = []
    const sourcePath = availableFiles.get(row.file_name)
    if (sourcePath === undefined) {
      errors.push(`file_name: "${row.file_name}" was not found in the input folder`)
    }
    if (!knownTemplates.has(row.template)) {
      errors.push(`template: "${row.template}" is not a known template`)
    }

    // A missing source path always pushed an error above; the explicit check also narrows the type.
    if (sourcePath === undefined || errors.length > 0) {
      invalid.push({ rowNumber, raw, errors })
      continue
    }

    valid.push({
      fileName: row.file_name,
      title: row.title,
      subtitle: row.subtitle,
      category: row.category,
      account: row.account,
      template: row.template,
      sourcePath,
    })
  }

  return { valid, invalid }
}
