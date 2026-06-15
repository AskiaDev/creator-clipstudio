'use client'

import { useCallback, useEffect, useState } from 'react'
import { RENDER_TEMPLATE_KEYS } from '@/src/templates/keys'
import { type PreviewRow, PreviewTable } from './PreviewTable'

interface InvalidRow {
  readonly rowNumber: number
  readonly raw: Record<string, unknown>
  readonly errors: readonly string[]
}
interface PreflightResponse {
  readonly valid: ReadonlyArray<{
    readonly fileName: string
    readonly account: string
    readonly category: string
    readonly template: string
  }>
  readonly invalid: readonly InvalidRow[]
}
interface EnqueueResponse {
  readonly enqueued: number
  readonly invalid: readonly InvalidRow[]
}
interface StatusResponse {
  readonly counts: { readonly pending: number; readonly running: number; readonly done: number; readonly failed: number }
  readonly recent: ReadonlyArray<{
    readonly jobId: number
    readonly status: string
    readonly message: string | null
    readonly outputPath: string | null
  }>
}

const POLL_MS = 2500
const ZERO_COUNTS = { pending: 0, running: 0, done: 0, failed: 0 } as const

const PLACEHOLDER_CSV = `file_name,title,subtitle,category,account,template
clip-01.mp4,Summer Sale,Up to 50% off,promo,acme,default
clip-02.mp4,New Drop,Out now,reels,acme,default`

function text(value: unknown): string {
  return typeof value === 'string' && value.length > 0 ? value : '—'
}

function toRows(report: PreflightResponse): PreviewRow[] {
  const valid: PreviewRow[] = report.valid.map((row) => ({
    key: `v-${row.fileName}`,
    ok: true,
    fileName: row.fileName,
    account: row.account,
    category: row.category,
    template: row.template,
    reasons: [],
  }))
  const invalid: PreviewRow[] = report.invalid.map((row) => ({
    key: `i-${row.rowNumber}`,
    ok: false,
    fileName: text(row.raw.file_name),
    account: text(row.raw.account),
    category: text(row.raw.category),
    template: text(row.raw.template),
    reasons: row.errors,
  }))
  return [...valid, ...invalid]
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string }
    return body.error ?? `Request failed (${response.status})`
  } catch {
    return `Request failed (${response.status})`
  }
}

export function BatchConsole() {
  const [inputFolder, setInputFolder] = useState('')
  const [csvText, setCsvText] = useState('')
  const [rows, setRows] = useState<PreviewRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<StatusResponse>({ counts: ZERO_COUNTS, recent: [] })

  const canSubmit = inputFolder.trim().length > 0 && csvText.trim().length > 0 && !busy

  const refreshStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/status', { cache: 'no-store' })
      if (response.ok) {
        setStatus((await response.json()) as StatusResponse)
      }
    } catch {
      // status polling is best-effort; ignore transient errors
    }
  }, [])

  useEffect(() => {
    refreshStatus()
    const id = setInterval(refreshStatus, POLL_MS)
    return () => clearInterval(id)
  }, [refreshStatus])

  const preview = useCallback(async () => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const response = await fetch('/api/preflight', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ inputFolder, csvText }),
      })
      if (!response.ok) {
        setError(await readError(response))
        return
      }
      const report = (await response.json()) as PreflightResponse
      setRows(toRows(report))
      setNotice(`${report.valid.length} valid · ${report.invalid.length} invalid`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed')
    } finally {
      setBusy(false)
    }
  }, [inputFolder, csvText])

  const enqueue = useCallback(async () => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const response = await fetch('/api/enqueue', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ inputFolder, csvText }),
      })
      if (!response.ok) {
        setError(await readError(response))
        return
      }
      const result = (await response.json()) as EnqueueResponse
      setNotice(
        `Enqueued ${result.enqueued} job${result.enqueued === 1 ? '' : 's'}` +
          (result.invalid.length > 0 ? ` · skipped ${result.invalid.length} invalid` : '') +
          '. Run `bun run worker` to render.',
      )
      await refreshStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enqueue failed')
    } finally {
      setBusy(false)
    }
  }, [inputFolder, csvText, refreshStatus])

  return (
    <section className="console">
      <div className="panel">
        <div className="panel__head">
          <span className="panel__n">01</span>
          <span className="panel__title">Batch input</span>
          <span className="panel__hint">local only</span>
        </div>

        <label className="field">
          <span className="field__label">Input folder</span>
          <input
            className="input"
            type="text"
            placeholder="/Users/you/clips/acme"
            value={inputFolder}
            onChange={(e) => setInputFolder(e.target.value)}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
          <span className="field__note">Absolute path to the folder of cut clips on this machine.</span>
        </label>

        <label className="field">
          <span className="field__label">Metadata CSV</span>
          <textarea
            className="textarea"
            placeholder={PLACEHOLDER_CSV}
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            spellCheck={false}
          />
          <span className="field__note">
            Columns: file_name, title, subtitle, category, account, template. Templates:{' '}
            {RENDER_TEMPLATE_KEYS.join(', ')}.
            Output → output/{'{date}'}/{'{account}'}/{'{category}'}/.
          </span>
        </label>

        <div className="actions">
          <button type="button" className="btn" onClick={preview} disabled={!canSubmit}>
            Preview
          </button>
          <button type="button" className="btn btn--primary" onClick={enqueue} disabled={!canSubmit}>
            Render batch
          </button>
        </div>

        {error ? <p className="msg msg--err">{error}</p> : null}
        {notice ? <p className="msg msg--ok">{notice}</p> : null}
      </div>

      <div className="panel">
        <div className="panel__head">
          <span className="panel__n">02</span>
          <span className="panel__title">Preview &amp; status</span>
          <span className="panel__hint">live · {POLL_MS / 1000}s</span>
        </div>

        <div className="stats">
          <div className="stat stat--pending">
            <span className="stat__n">{status.counts.pending}</span>
            <span className="stat__k">Pending</span>
          </div>
          <div className="stat stat--running">
            <span className="stat__n">{status.counts.running}</span>
            <span className="stat__k">Running</span>
          </div>
          <div className="stat stat--done">
            <span className="stat__n">{status.counts.done}</span>
            <span className="stat__k">Done</span>
          </div>
          <div className="stat stat--failed">
            <span className="stat__n">{status.counts.failed}</span>
            <span className="stat__k">Failed</span>
          </div>
        </div>

        {rows ? (
          rows.length > 0 ? (
            <PreviewTable rows={rows} />
          ) : (
            <p className="empty">No rows parsed from the CSV.</p>
          )
        ) : (
          <p className="empty">Paste a CSV and press Preview to validate rows before rendering.</p>
        )}

        {status.recent.length > 0 ? (
          <div className="loglist">
            {status.recent.map((log) => (
              <div key={log.jobId} className="logrow">
                <span className={log.status === 'failed' ? 'pill pill--fail' : 'pill pill--ok'}>{log.status}</span>
                <span className="logrow__msg">{log.outputPath ?? log.message ?? `job ${log.jobId}`}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  )
}
