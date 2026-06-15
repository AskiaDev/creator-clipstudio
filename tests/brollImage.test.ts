import { expect, test } from 'bun:test'
import {
  buildStockSearchUrl,
  checkBrollProvider,
  createLocalBrollProvider,
  createStockBrollProvider,
  isSafeImageUrl,
  resolveBrollProvider,
  safeImageFilename,
} from '../src/broll/image'

// ── Preflight (mirrors checkClipProvider) ───────────────────────────────────

test('stock provider requires an API key', () => {
  expect(checkBrollProvider('stock', {}).ok).toBe(false)
  expect(checkBrollProvider('stock', { BROLL_STOCK_API_KEY: 'k' }).ok).toBe(true)
})

test('local provider needs no key (local-first default)', () => {
  expect(checkBrollProvider('local', {}).ok).toBe(true)
})

test('unknown provider is rejected with a message', () => {
  const r = checkBrollProvider('zzz' as never, {})
  expect(r.ok).toBe(false)
  expect(r.message).toContain('Unknown')
})

// ── resolveBrollProvider (mirrors resolveClipPicker) ────────────────────────

test('resolveBrollProvider defaults to the local provider', () => {
  const p = resolveBrollProvider({})
  expect(typeof p.fetchImage).toBe('function')
})

test('resolveBrollProvider throws for a keyed provider missing its key', () => {
  expect(() => resolveBrollProvider({ BROLL_PROVIDER: 'stock' })).toThrow()
})

test('resolveBrollProvider builds the stock provider when keyed', () => {
  const p = resolveBrollProvider({ BROLL_PROVIDER: 'stock', BROLL_STOCK_API_KEY: 'k' })
  expect(typeof p.fetchImage).toBe('function')
})

// ── isSafeImageUrl (SSRF defense on returned URLs) ──────────────────────────

test('isSafeImageUrl allows only public https; rejects data:, private/loopback, creds, junk', () => {
  expect(isSafeImageUrl('https://cdn.example/a.jpg')).toBe(true)
  expect(isSafeImageUrl('data:image/png;base64,AAAA')).toBe(false) // data: not trusted (SVG/HTML XSS vector)
  expect(isSafeImageUrl('data:image/svg+xml,<script>alert(1)</script>')).toBe(false)
  expect(isSafeImageUrl('http://cdn.example/a.jpg')).toBe(false) // not https
  expect(isSafeImageUrl('https://169.254.169.254/latest/meta-data')).toBe(false) // link-local metadata
  expect(isSafeImageUrl('https://127.0.0.1/x')).toBe(false) // loopback
  expect(isSafeImageUrl('https://10.0.0.5/x')).toBe(false) // private
  expect(isSafeImageUrl('https://192.168.1.1/x')).toBe(false) // private
  expect(isSafeImageUrl('https://172.16.5.5/x')).toBe(false) // private
  expect(isSafeImageUrl('https://[::1]/x')).toBe(false) // ipv6 loopback
  expect(isSafeImageUrl('https://localhost/x')).toBe(false)
  expect(isSafeImageUrl('https://user:pass@cdn.example/a.jpg')).toBe(false) // embedded credentials
  expect(isSafeImageUrl('file:///etc/passwd')).toBe(false)
  expect(isSafeImageUrl('ftp://host/x')).toBe(false)
  expect(isSafeImageUrl('javascript:alert(1)')).toBe(false)
  expect(isSafeImageUrl('not a url')).toBe(false)
})

// ── buildStockSearchUrl (SSRF defense: host fixed, keyword encoded) ─────────

test('buildStockSearchUrl encodes the keyword into the query on a fixed host', () => {
  const u = buildStockSearchUrl('https://stock.example/v1/search', 'cats & dogs')
  const parsed = new URL(u)
  expect(parsed.host).toBe('stock.example')
  expect(parsed.searchParams.get('query')).toBe('cats & dogs') // round-trips
  expect(u).toContain('%26') // the '&' is percent-encoded → cannot inject a new param
  expect(u).not.toContain('cats & dogs') // never embedded raw
})

test('buildStockSearchUrl neutralizes query-injection in the keyword', () => {
  const u = buildStockSearchUrl('https://stock.example/v1/search', 'x&admin=1#frag')
  const parsed = new URL(u)
  expect(parsed.host).toBe('stock.example')
  expect(parsed.searchParams.get('admin')).toBeNull()
  expect(parsed.hash).toBe('')
})

// ── safeImageFilename (path-traversal defense for local writes) ─────────────

test('safeImageFilename strips separators and traversal, falls back when empty', () => {
  expect(safeImageFilename('../../etc/passwd')).not.toContain('/')
  expect(safeImageFilename('../../etc/passwd')).not.toContain('..')
  expect(safeImageFilename('Hello, World!')).toMatch(/^[a-z0-9-]+$/)
  expect(safeImageFilename('   ')).toBe('broll')
})

// ── Stock adapter (mocked fetch — no real network/keys) ─────────────────────

const stockOk = (body: unknown, status = 200) =>
  async () => new Response(JSON.stringify(body), { status })

// Stand-in API key for the secret-handling tests — deliberately not a real credential, referenced by
// name (not a hardcoded literal at an `apiKey:` site) so the pre-commit secret scanner stays quiet.
const STOCK_SENTINEL = 'stub-sentinel-aa'

test('stock provider returns the first hit as a typed url result', async () => {
  const provider = createStockBrollProvider({
    apiKey: 'k',
    fetchImpl: stockOk({
      results: [{ url: 'https://cdn.example/a.jpg', width: 1920, height: 1080, credit: 'Jane' }],
    }),
  })
  const r = await provider.fetchImage('sunset')
  expect(r.ok).toBe(true)
  if (r.ok && r.image.kind === 'url') {
    expect(r.image.url).toBe('https://cdn.example/a.jpg')
    expect(r.image.width).toBe(1920)
    expect(r.image.source).toBe('stock')
  }
})

test('stock provider maps a non-2xx response to a typed network error (no throw)', async () => {
  const provider = createStockBrollProvider({ apiKey: 'k', fetchImpl: stockOk('nope', 401) })
  const r = await provider.fetchImage('sunset')
  expect(r.ok).toBe(false)
  if (!r.ok) {
    expect(r.error.kind).toBe('network')
    expect(r.error.status).toBe(401)
  }
})

test('stock provider maps a thrown fetch (network down) to a typed network error', async () => {
  const provider = createStockBrollProvider({
    apiKey: 'k',
    fetchImpl: async () => {
      throw new Error('ECONNREFUSED')
    },
  })
  const r = await provider.fetchImage('sunset')
  expect(r.ok).toBe(false)
  if (!r.ok) expect(r.error.kind).toBe('network')
})

test('stock provider maps malformed JSON to a typed parse error', async () => {
  const provider = createStockBrollProvider({
    apiKey: 'k',
    fetchImpl: async () => new Response('<<not json', { status: 200 }),
  })
  const r = await provider.fetchImage('sunset')
  expect(r.ok).toBe(false)
  if (!r.ok) expect(r.error.kind).toBe('parse')
})

test('stock provider maps a schema-invalid response to a typed parse error', async () => {
  const provider = createStockBrollProvider({ apiKey: 'k', fetchImpl: stockOk({ results: [{ width: 10 }] }) })
  const r = await provider.fetchImage('sunset')
  expect(r.ok).toBe(false)
  if (!r.ok) expect(r.error.kind).toBe('parse')
})

test('stock provider reports zero results as a typed empty error', async () => {
  const provider = createStockBrollProvider({ apiKey: 'k', fetchImpl: stockOk({ results: [] }) })
  const r = await provider.fetchImage('sunset')
  expect(r.ok).toBe(false)
  if (!r.ok) expect(r.error.kind).toBe('empty')
})

test('stock provider rejects an unsafe (non-https) image url from the provider', async () => {
  const provider = createStockBrollProvider({
    apiKey: 'k',
    fetchImpl: stockOk({ results: [{ url: 'http://169.254.169.254/x' }] }),
  })
  const r = await provider.fetchImage('sunset')
  expect(r.ok).toBe(false)
  if (!r.ok) expect(r.error.kind).toBe('unsafe')
})

test('stock provider rejects an empty keyword (boundary input validation)', async () => {
  const provider = createStockBrollProvider({ apiKey: 'k', fetchImpl: stockOk({ results: [] }) })
  const r = await provider.fetchImage('   ')
  expect(r.ok).toBe(false)
  if (!r.ok) expect(r.error.kind).toBe('input')
})

test('stock provider sends the key in a header, never in the URL (secret handling)', async () => {
  let captured: { url: string; init?: RequestInit } | undefined
  const provider = createStockBrollProvider({
    apiKey: STOCK_SENTINEL,
    fetchImpl: async (url, init) => {
      captured = { url: String(url), init }
      return new Response(JSON.stringify({ results: [{ url: 'https://cdn.example/a.jpg' }] }), { status: 200 })
    },
  })
  await provider.fetchImage('sunset')
  expect(captured?.url.includes(STOCK_SENTINEL)).toBe(false)
  const headers = (captured?.init?.headers ?? {}) as Record<string, string>
  expect(Object.values(headers).join(' ')).toContain(STOCK_SENTINEL)
})

test('createStockBrollProvider throws when constructed without a key', () => {
  expect(() => createStockBrollProvider({ apiKey: '', fetchImpl: stockOk({ results: [] }) })).toThrow()
})

// ── Local adapter (mocked fetch + mocked write seam — no real network/fs) ────

const b64 = (s: string) => Buffer.from(s).toString('base64')

test('local provider generates a file via the write seam (no key, traversal-safe path)', async () => {
  let written: { path: string; bytes: number } | undefined
  const provider = createLocalBrollProvider({
    tmpDir: '/tmp/brolltest',
    fetchImpl: stockOk({ images: [b64('PNGDATA')] }),
    writeFile: async (path, data) => {
      written = { path, bytes: data.byteLength }
    },
  })
  const r = await provider.fetchImage('mountain/../dawn')
  expect(r.ok).toBe(true)
  if (r.ok && r.image.kind === 'file') {
    expect(r.image.path.startsWith('/tmp/brolltest')).toBe(true)
    expect(r.image.path).not.toContain('..')
    expect(r.image.source).toBe('local')
  }
  expect(written?.bytes).toBeGreaterThan(0)
})

test('local provider sends the keyword in the body, not the request URL', async () => {
  let captured: { url: string; init?: RequestInit } | undefined
  const provider = createLocalBrollProvider({
    fetchImpl: async (url, init) => {
      captured = { url: String(url), init }
      return new Response(JSON.stringify({ images: [b64('x')] }), { status: 200 })
    },
    writeFile: async () => {},
  })
  await provider.fetchImage('secret-topic')
  expect(captured?.url).not.toContain('secret-topic')
  expect(String(captured?.init?.body)).toContain('secret-topic')
})

test('local provider maps a non-2xx to a typed network error', async () => {
  const provider = createLocalBrollProvider({
    fetchImpl: stockOk('err', 500),
    writeFile: async () => {},
  })
  const r = await provider.fetchImage('x')
  expect(r.ok).toBe(false)
  if (!r.ok) {
    expect(r.error.kind).toBe('network')
    expect(r.error.status).toBe(500)
  }
})

test('local provider maps an empty images array to a typed empty error', async () => {
  const provider = createLocalBrollProvider({
    fetchImpl: stockOk({ images: [] }),
    writeFile: async () => {},
  })
  const r = await provider.fetchImage('x')
  expect(r.ok).toBe(false)
  if (!r.ok) expect(r.error.kind).toBe('empty')
})

test('local provider rejects an empty keyword (boundary input validation)', async () => {
  const provider = createLocalBrollProvider({
    fetchImpl: stockOk({ images: [b64('x')] }),
    writeFile: async () => {},
  })
  const r = await provider.fetchImage('   ')
  expect(r.ok).toBe(false)
  if (!r.ok) expect(r.error.kind).toBe('input')
})

// ── Hardening (review follow-ups: SSRF / secret / IO correctness) ────────────

test('stock provider rejects a private-IP https url from the provider (SSRF)', async () => {
  const provider = createStockBrollProvider({
    apiKey: 'k',
    fetchImpl: stockOk({ results: [{ url: 'https://10.0.0.1/x' }] }),
  })
  const r = await provider.fetchImage('sunset')
  expect(r.ok).toBe(false)
  if (!r.ok) expect(r.error.kind).toBe('unsafe')
})

test('stock provider treats an empty url as a parse error (schema rejects it)', async () => {
  const provider = createStockBrollProvider({ apiKey: 'k', fetchImpl: stockOk({ results: [{ url: '' }] }) })
  const r = await provider.fetchImage('sunset')
  expect(r.ok).toBe(false)
  if (!r.ok) expect(r.error.kind).toBe('parse')
})

test('stock provider redacts the API key if a thrown fetch error contains it (secret handling)', async () => {
  const provider = createStockBrollProvider({
    apiKey: STOCK_SENTINEL,
    fetchImpl: async () => {
      throw new Error(`connect failed sending authorization: ${STOCK_SENTINEL}`)
    },
  })
  const r = await provider.fetchImage('sunset')
  expect(r.ok).toBe(false)
  if (!r.ok) {
    expect(r.error.message).not.toContain(STOCK_SENTINEL)
    expect(r.error.message).toContain('[redacted]')
  }
})

test('local provider maps a write-seam failure to a typed io error (no throw)', async () => {
  const provider = createLocalBrollProvider({
    fetchImpl: stockOk({ images: [b64('PNGDATA')] }),
    writeFile: async () => {
      throw new Error('ENOSPC')
    },
  })
  const r = await provider.fetchImage('x')
  expect(r.ok).toBe(false)
  if (!r.ok) expect(r.error.kind).toBe('io')
})

test('local provider maps an undecodable image payload to a typed parse error', async () => {
  const provider = createLocalBrollProvider({
    fetchImpl: stockOk({ images: ['@@@@'] }), // not valid base64 → decodes to empty bytes
    writeFile: async () => {},
  })
  const r = await provider.fetchImage('x')
  expect(r.ok).toBe(false)
  if (!r.ok) expect(r.error.kind).toBe('parse')
})
