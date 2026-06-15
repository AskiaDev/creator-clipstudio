/**
 * FFmpeg/ffprobe preflight check for the CreatorClip Studio render core.
 *
 * Pure and framework-free: the only runtime dependency is Bun's `which`, injected via
 * {@link BinaryResolver} so the missing-binary branches are unit-testable without
 * uninstalling anything. Later phases call this before spawning FFmpeg.
 */

/** Binaries the renderer cannot run without. */
export const REQUIRED_BINARIES = ['ffmpeg', 'ffprobe'] as const

export type RequiredBinary = (typeof REQUIRED_BINARIES)[number]

/** Resolves an executable name to its absolute path, or `null` when not on PATH. */
export type BinaryResolver = (binary: string) => string | null

export interface PreflightOk {
  readonly ok: true
  /** Absolute path of each required binary, keyed by name. */
  readonly binaries: Readonly<Record<RequiredBinary, string>>
}

export interface PreflightFailure {
  readonly ok: false
  /** Required binaries that did not resolve on PATH. */
  readonly missing: readonly RequiredBinary[]
  /** Actionable, user-facing message naming the missing binaries. */
  readonly message: string
}

export type PreflightResult = PreflightOk | PreflightFailure

const defaultResolver: BinaryResolver = (binary) => Bun.which(binary)

function buildFailureMessage(missing: readonly RequiredBinary[]): string {
  const names = missing.join(' and ')
  const verb = missing.length === 1 ? 'is' : 'are'
  return (
    `CreatorClip Studio requires FFmpeg, but ${names} ${verb} not on your PATH. ` +
    `Install FFmpeg (e.g. \`brew install ffmpeg\` on macOS) and reopen your terminal so ` +
    `${names} resolve, then try again.`
  )
}

/**
 * Verify that every binary the renderer depends on resolves on PATH.
 *
 * @param resolve Lookup function, defaulting to `Bun.which`; injected in tests.
 * @returns An OK result with resolved paths, or a failure naming the missing binaries.
 */
export function preflight(resolve: BinaryResolver = defaultResolver): PreflightResult {
  const resolved = REQUIRED_BINARIES.map((binary) => ({ binary, path: resolve(binary) }))
  const missing = resolved
    .filter((entry): entry is { binary: RequiredBinary; path: null } => entry.path === null)
    .map((entry) => entry.binary)

  if (missing.length > 0) {
    return { ok: false, missing, message: buildFailureMessage(missing) }
  }

  const binaries = Object.fromEntries(
    resolved.map((entry) => [entry.binary, entry.path]),
  ) as Record<RequiredBinary, string>

  return { ok: true, binaries }
}
