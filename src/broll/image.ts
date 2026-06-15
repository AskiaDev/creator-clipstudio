/**
 * B-roll image adapter (Phase 5, part 2/2). An injectable image provider that, given a keyword/phrase,
 * returns a b-roll image (locally generated OR stock) from behind an injectable fetch/write seam —
 * mirroring the clip engine's adapter pattern (`src/clip/adapters/*`, `src/clip/resolve.ts`).
 *
 * Two providers, mirroring the clip pair:
 *   - `local` (DEFAULT, no key): posts to a local generation server (e.g. SD WebUI) and persists the PNG.
 *   - `stock` (keyed alternate): searches a stock host over https; the key travels in a header, never the URL.
 *
 * The model/provider is never trusted: responses are Zod-validated at the boundary, returned URLs are
 * checked for SSRF safety, local filenames are path-traversal-sanitized, and every failure is mapped to a
 * typed {@link BrollImageError} — `fetchImage` never throws raw. Secrets come only from env/opts.
 *
 * Types are defined inline here on purpose: lane S4 owns `src/broll/keywords.ts` and this lane must stay
 * independent — no shared `src/broll/types.ts`.
 */

import { createHash } from 'node:crypto'
import { writeFile as fsWriteFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'

// ── Public contract ─────────────────────────────────────────────────────────

/** Selectable b-roll image providers. `local` is the no-key default. */
export type BrollProvider = 'local' | 'stock'

/** Preflight result — same shape as the clip engine's `ProviderCheck`. */
export interface ProviderCheck {
  readonly ok: boolean
  readonly message?: string
}

/** Per-call shaping hints for one image request. */
export interface BrollImageOptions {
  readonly orientation?: 'landscape' | 'portrait' | 'square'
  readonly width?: number
  readonly height?: number
}

/** A resolved b-roll image: a remote URL (stock) or a local file path (generated). */
export type BrollImage =
  | {
      readonly kind: 'url'
      readonly url: string
      readonly source: BrollProvider
      readonly width?: number
      readonly height?: number
      readonly credit?: string
    }
  | {
      readonly kind: 'file'
      readonly path: string
      readonly source: BrollProvider
      readonly width?: number
      readonly height?: number
    }

/** Typed failure — `fetchImage` maps every error path to one of these instead of throwing. */
export interface BrollImageError {
  /** `input` bad arg · `network` fetch/non-2xx · `parse` bad response · `empty` no results · `unsafe` SSRF-blocked URL · `io` disk write. */
  readonly kind: 'input' | 'network' | 'parse' | 'empty' | 'unsafe' | 'io'
  readonly message: string
  /** Present when the failure came from a non-2xx provider response. */
  readonly status?: number
}

/** Discriminated result so callers handle errors explicitly (never a thrown exception). */
export type BrollImageResult =
  | { readonly ok: true; readonly image: BrollImage }
  | { readonly ok: false; readonly error: BrollImageError }

/** The single provider-agnostic seam every adapter implements. */
export interface BrollImageProvider {
  fetchImage(keyword: string, opts?: BrollImageOptions): Promise<BrollImageResult>
}

/**
 * Injectable network seam (defaults to global `fetch`); mocked in tests. A structural call signature,
 * not `typeof fetch`, so a plain async function is a valid mock — the real `fetch` is still assignable.
 */
export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>
/** Injectable disk seam for persisting generated images; mocked in tests. */
export type WriteFileLike = (path: string, data: Uint8Array) => Promise<void>

// ── Config (no secrets, no env-controlled hosts → no SSRF surface) ──────────

/** Fixed https stock host. Never read from env/user input so the destination host can't be hijacked. */
const DEFAULT_STOCK_BASE_URL = 'https://api.stockphotos.example/v1/search'
/** Local generation server (e.g. Automatic1111 SD WebUI). Intentional localhost egress; no key, no data leaves. */
const DEFAULT_LOCAL_HOST = 'http://localhost:7860'
const STOCK_API_KEY_ENV = 'BROLL_STOCK_API_KEY'

// ── Boundary schemas (defensive parsing of provider responses) ──────────────

const stockResponseSchema = z.object({
  results: z.array(
    z.object({
      url: z.string().min(1),
      width: z.number().int().positive().optional(),
      height: z.number().int().positive().optional(),
      credit: z.string().optional(),
    }),
  ),
})

const localResponseSchema = z.object({
  images: z.array(z.string().min(1)),
})

// ── Security helpers (exported for direct unit testing) ─────────────────────

/** Reject literal loopback / private / link-local hosts (defense-in-depth against SSRF to internal services). */
function isBlockedImageHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase() // strip IPv6 brackets
  if (host === 'localhost') return true
  if (host.includes(':')) {
    // IPv6 literal: loopback (::1), unspecified (::), link-local (fe80::/10), unique-local (fc00::/7).
    if (host === '::1' || host === '::') return true
    return host.startsWith('fe80') || host.startsWith('fc') || host.startsWith('fd')
  }
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return false // a normal DNS hostname — allowed (rebind-to-private is out of scope: we don't fetch it)
  const a = Number(m[1])
  const b = Number(m[2])
  if (a === 0 || a === 10 || a === 127) return true // unspecified / private / loopback
  if (a === 169 && b === 254) return true // link-local (cloud metadata)
  if (a === 192 && b === 168) return true // private
  if (a === 172 && b >= 16 && b <= 31) return true // private
  return false
}

/**
 * SSRF guard for URLs handed back to the integrator. Allows ONLY `https:` to a public host with no
 * embedded credentials. Blocks `http:`/`data:`/`file:`/`ftp:`/`javascript:`, loopback/private/link-local
 * literals (incl. cloud-metadata IPs), and unparseable strings. `data:` is rejected outright because a
 * `data:image/svg+xml` payload can carry executable content; this lane never emits a data URL.
 */
export function isSafeImageUrl(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  if (url.username || url.password) return false // no credentials embedded in the URL
  if (isBlockedImageHost(url.hostname)) return false
  return true
}

/**
 * Build the stock search URL with the keyword as an encoded query param on a fixed host. Using `URL`/
 * `searchParams` guarantees the keyword cannot change the host, add parameters, or inject a fragment.
 */
export function buildStockSearchUrl(baseUrl: string, keyword: string, opts?: BrollImageOptions): string {
  const url = new URL(baseUrl)
  url.searchParams.set('query', keyword)
  if (opts?.orientation) url.searchParams.set('orientation', opts.orientation)
  return url.toString()
}

/**
 * Reduce a keyword to a safe filename slug: lowercase, non-alphanumeric runs → `-`, trimmed, bounded.
 * Strips path separators and `..` so a crafted keyword can never escape the target directory.
 */
export function safeImageFilename(keyword: string): string {
  const slug = keyword
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return slug.length > 0 ? slug : 'broll'
}

// ── Preflight + resolution (mirrors checkClipProvider / resolveClipPicker) ──

/** Preflight: is the selected provider configured? */
export function checkBrollProvider(
  provider: BrollProvider,
  env: Record<string, string | undefined> = process.env,
): ProviderCheck {
  if (provider === 'local') {
    return { ok: true } // local generation; no key needed
  }
  if (provider === 'stock') {
    return env[STOCK_API_KEY_ENV]
      ? { ok: true }
      : { ok: false, message: `Set ${STOCK_API_KEY_ENV} to use the stock b-roll provider.` }
  }
  return { ok: false, message: `Unknown b-roll provider: ${provider}` }
}

/** Construct the active provider from env (`BROLL_PROVIDER`, default `local`). Throws if misconfigured. */
export function resolveBrollProvider(
  env: Record<string, string | undefined> = process.env,
): BrollImageProvider {
  const raw = env.BROLL_PROVIDER ?? 'local' // default: local, no key
  if (raw !== 'local' && raw !== 'stock') throw new Error(`Unknown b-roll provider: ${raw}`)
  const provider: BrollProvider = raw // narrowed — no unsafe cast
  const check = checkBrollProvider(provider, env)
  if (!check.ok) throw new Error(check.message ?? `B-roll provider ${provider} not configured`)
  if (provider === 'stock') return createStockBrollProvider({ apiKey: env[STOCK_API_KEY_ENV] })
  return createLocalBrollProvider()
}

// ── Result helpers ──────────────────────────────────────────────────────────

function success(image: BrollImage): BrollImageResult {
  return { ok: true, image }
}

function failure(kind: BrollImageError['kind'], message: string, status?: number): BrollImageResult {
  return { ok: false, error: { kind, message, status } }
}

function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Strip a secret out of free-form text before it reaches a returned error/log (defense-in-depth). */
function redactSecret(text: string, secret: string): string {
  return secret.length > 0 ? text.split(secret).join('[redacted]') : text
}

// ── Stock adapter (keyed; mirrors the Claude clip adapter) ──────────────────

export function createStockBrollProvider(opts?: {
  apiKey?: string
  baseUrl?: string
  fetchImpl?: FetchLike
  log?: (message: string) => void
}): BrollImageProvider {
  const apiKey = opts?.apiKey ?? process.env[STOCK_API_KEY_ENV]
  if (!apiKey) throw new Error(`${STOCK_API_KEY_ENV} is not set`)
  const baseUrl = opts?.baseUrl ?? DEFAULT_STOCK_BASE_URL
  // Validate at construction (allowed to throw, like the missing-key guard) so `fetchImage` — which calls
  // buildStockSearchUrl → new URL(baseUrl) — can never throw on a malformed baseUrl.
  let parsedBase: URL
  try {
    parsedBase = new URL(baseUrl)
  } catch {
    throw new Error('Stock b-roll baseUrl must be a valid URL')
  }
  if (parsedBase.protocol !== 'https:') throw new Error('Stock b-roll baseUrl must be https')
  const fetchImpl: FetchLike = opts?.fetchImpl ?? fetch
  const log = opts?.log ?? (() => {})

  return {
    async fetchImage(keyword: string, imgOpts?: BrollImageOptions): Promise<BrollImageResult> {
      const kw = keyword.trim()
      if (!kw) return failure('input', 'keyword is required')

      const url = buildStockSearchUrl(baseUrl, kw, imgOpts)
      let res: Response
      try {
        // Secret travels in a header, never the URL/query string. `redirect: 'error'` stops a CDN from
        // bouncing the request to an internal host (SSRF via redirect).
        res = await fetchImpl(url, {
          method: 'GET',
          redirect: 'error',
          headers: { authorization: apiKey, accept: 'application/json' },
        })
      } catch (error) {
        // Redact the key in case a custom fetchImpl echoes request headers into its error message.
        const safe = redactSecret(errMessage(error), apiKey)
        log(`[broll] stock request failed: ${safe}`)
        return failure('network', `stock image request failed: ${safe}`)
      }
      // Status only — never echo the response body (avoids leaking anything sensitive).
      if (!res.ok) return failure('network', `stock image API returned ${res.status}`, res.status)

      let payload: unknown
      try {
        payload = await res.json()
      } catch {
        return failure('parse', 'stock response was not valid JSON')
      }
      const parsed = stockResponseSchema.safeParse(payload)
      if (!parsed.success) return failure('parse', 'stock response did not match the expected schema')

      const first = parsed.data.results[0]
      if (!first) return failure('empty', `no stock images found for "${kw}"`)
      if (!isSafeImageUrl(first.url)) return failure('unsafe', 'provider returned an unsafe image URL')

      return success({
        kind: 'url',
        url: first.url,
        source: 'stock',
        width: first.width,
        height: first.height,
        credit: first.credit,
      })
    },
  }
}

// ── Local adapter (DEFAULT, no key; mirrors the Ollama clip adapter) ────────

/**
 * Default local-generation provider. `host`/`tmpDir` are operator-trusted configuration (like the clip
 * engine's `OLLAMA_HOST`), never user input — the only attacker-controlled value, the keyword, is confined
 * to the request body and to a path-sanitized filename.
 */
export function createLocalBrollProvider(opts?: {
  host?: string
  model?: string
  tmpDir?: string
  fetchImpl?: FetchLike
  writeFile?: WriteFileLike
  log?: (message: string) => void
}): BrollImageProvider {
  const host = opts?.host ?? process.env.BROLL_LOCAL_HOST ?? DEFAULT_LOCAL_HOST
  const model = opts?.model ?? process.env.BROLL_LOCAL_MODEL ?? 'sd_xl_base'
  const dir = opts?.tmpDir ?? tmpdir()
  const fetchImpl: FetchLike = opts?.fetchImpl ?? fetch
  const writeImpl: WriteFileLike = opts?.writeFile ?? ((path, data) => fsWriteFile(path, data))
  const log = opts?.log ?? (() => {})

  return {
    async fetchImage(keyword: string, imgOpts?: BrollImageOptions): Promise<BrollImageResult> {
      const kw = keyword.trim()
      if (!kw) return failure('input', 'keyword is required')

      // Keyword goes in the request BODY, not the URL — the host stays fixed/local (no SSRF via keyword).
      const body = JSON.stringify({ prompt: kw, model, width: imgOpts?.width, height: imgOpts?.height })
      let res: Response
      try {
        res = await fetchImpl(`${host}/sdapi/v1/txt2img`, {
          method: 'POST',
          redirect: 'error',
          headers: { 'content-type': 'application/json' },
          body,
        })
      } catch (error) {
        log(`[broll] local generation failed: ${errMessage(error)}`)
        return failure('network', `local generation request failed: ${errMessage(error)}`)
      }
      if (!res.ok) return failure('network', `local generation returned ${res.status}`, res.status)

      let payload: unknown
      try {
        payload = await res.json()
      } catch {
        return failure('parse', 'local response was not valid JSON')
      }
      const parsed = localResponseSchema.safeParse(payload)
      if (!parsed.success) return failure('parse', 'local response did not match the expected schema')

      const encoded = parsed.data.images[0]
      if (!encoded) return failure('empty', `local generation produced no image for "${kw}"`)

      // `Buffer.from(_, 'base64')` silently drops invalid chars, so an undecodable payload yields 0 bytes.
      const bytes = new Uint8Array(Buffer.from(encoded, 'base64'))
      if (bytes.byteLength === 0) return failure('parse', 'local generation returned an undecodable image')

      // Filename is sanitized + content-hashed; `join` with a slug that has no separators cannot escape `dir`.
      const hash = createHash('sha1').update(kw).digest('hex').slice(0, 8)
      const path = join(dir, `broll-${safeImageFilename(kw)}-${hash}.png`)
      try {
        await writeImpl(path, bytes)
      } catch (error) {
        return failure('io', `failed to persist generated image: ${errMessage(error)}`)
      }

      return success({ kind: 'file', path, source: 'local', width: imgOpts?.width, height: imgOpts?.height })
    },
  }
}
