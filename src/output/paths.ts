/**
 * Output path builder: `output/{date}/{account}/{category}/{name}_reel.mp4`.
 *
 * Pure. Each path segment is re-sanitized here as a defensive backstop even though the CSV preflight
 * already rejected unsafe segments — the worker must never write outside its output root.
 */

import { join } from 'node:path'
import { isSafeSegment } from '../csv/schema'

const REEL_SUFFIX = '_reel.mp4'

/** Strip a single trailing extension (`clip.mp4` → `clip`); names without a dot are returned as-is. */
export function baseName(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(0, dot) : fileName
}

function assertSafe(segment: string, label: string): string {
  if (!isSafeSegment(segment)) {
    throw new Error(`Refusing to build an output path: unsafe ${label} segment "${segment}"`)
  }
  return segment
}

export function buildOutputPath(
  root: string,
  date: string,
  account: string,
  category: string,
  fileName: string,
): string {
  const name = baseName(assertSafe(fileName, 'file_name'))
  return join(
    root,
    assertSafe(date, 'date'),
    assertSafe(account, 'account'),
    assertSafe(category, 'category'),
    `${name}${REEL_SUFFIX}`,
  )
}
