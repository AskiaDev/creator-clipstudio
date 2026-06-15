/**
 * Zod schema for one metadata CSV row.
 *
 * Required columns: `file_name,title,subtitle,category,account,template`. `title`/`subtitle` may be
 * empty; the path-deriving segments (`file_name`, `account`, `category`) are rejected if they contain
 * a path separator or `..`, so a malicious CSV can never escape the output directory.
 */

import { z } from 'zod'

/**
 * A value is a safe path segment: no separators and no `..` anywhere in the string (not just `../`).
 * Intentionally conservative — these segments build real output directories.
 */
export function isSafeSegment(value: string): boolean {
  return !value.includes('/') && !value.includes('\\') && !value.includes('..')
}

function pathSegment(label: string) {
  return z
    .string()
    .min(1, `${label} is required`)
    .refine(isSafeSegment, { message: `${label} must not contain path separators or '..'` })
}

export const csvRowSchema = z.object({
  file_name: pathSegment('file_name'),
  title: z.string(),
  subtitle: z.string(),
  category: pathSegment('category'),
  account: pathSegment('account'),
  // Guarded like the path segments; parse.ts additionally matches it against the known-template set.
  template: pathSegment('template'),
})

export type CsvRow = z.infer<typeof csvRowSchema>
