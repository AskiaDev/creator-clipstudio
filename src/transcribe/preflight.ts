/**
 * Transcription preflight: verify the whisper.cpp binary and a ggml model are available before
 * spawning anything. Mirrors `src/render/preflight.ts` — the only runtime dependencies (`Bun.which`,
 * filesystem existence) are injected so both missing branches are unit-testable.
 */

/** Env overrides for the binary and model, with sensible local defaults. */
export const WHISPER_BIN_ENV = 'WHISPER_BIN'
export const WHISPER_MODEL_ENV = 'WHISPER_MODEL'
export const DEFAULT_WHISPER_BIN = 'whisper-cli'
export const DEFAULT_WHISPER_MODEL = 'models/ggml-base.en.bin'

/** Resolves an executable name to its absolute path, or `null` when not on PATH. */
export type BinaryResolver = (binary: string) => string | null
/** Reports whether a file exists at the given path. */
export type FileExists = (path: string) => boolean

export interface TranscribePreflightDeps {
  readonly binary: string
  readonly modelPath: string
  readonly resolveBinary: BinaryResolver
  readonly fileExists: FileExists
}

export type TranscribePreflightResult =
  | { readonly ok: true; readonly binaryPath: string; readonly modelPath: string }
  | { readonly ok: false; readonly message: string }

/**
 * Verify the whisper binary resolves on PATH and the ggml model file exists.
 * Returns the resolved paths, or an actionable message naming exactly what is missing.
 */
export function transcribePreflight(deps: TranscribePreflightDeps): TranscribePreflightResult {
  const binaryPath = deps.resolveBinary(deps.binary)
  const hasModel = deps.fileExists(deps.modelPath)
  const missing: string[] = []
  if (!binaryPath) {
    missing.push(
      `whisper.cpp binary '${deps.binary}' not on PATH (install: \`brew install whisper-cpp\`, or set ${WHISPER_BIN_ENV})`,
    )
  }
  if (!hasModel) {
    missing.push(
      `ggml model not found at '${deps.modelPath}' (download e.g. ggml-base.en.bin, or set ${WHISPER_MODEL_ENV})`,
    )
  }
  // Guard on `!binaryPath` (not `missing.length`) so TypeScript narrows binaryPath to a string below.
  if (!binaryPath || !hasModel) {
    return { ok: false, message: `Transcription preflight failed — ${missing.join('; ')}.` }
  }
  return { ok: true, binaryPath, modelPath: deps.modelPath }
}
