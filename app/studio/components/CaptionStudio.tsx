'use client'

import { useCallback, useMemo, useState } from 'react'
import { transcriptSchema } from '@/app/api/captions/schemas'
import { editWordText, retime } from '@/src/captions/transcript'
import { countWords, type Transcript } from '@/src/transcribe/types'
import { findSegmentIndexAt } from '../lib/karaoke'
import { usePlayhead } from '../lib/usePlayhead'
import styles from '../studio.module.css'
import { CaptionStage } from './CaptionStage'
import { SegmentList } from './SegmentList'

const NUDGE_SEC = 0.1
const VIDEO_URL_PATTERN = /^https?:\/\//i

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string }
    return body.error ?? `Request failed (${response.status})`
  } catch {
    return `Request failed (${response.status})`
  }
}

interface CaptionStudioProps {
  readonly initialTranscript: Transcript
}

/** Caption Studio orchestrator: holds the editable transcript and drives the scrub preview + ASS export. */
export function CaptionStudio({ initialTranscript }: CaptionStudioProps) {
  const [transcript, setTranscript] = useState<Transcript>(initialTranscript)
  const [videoSrc, setVideoSrc] = useState('')
  const [jsonDraft, setJsonDraft] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [ass, setAss] = useState<string | null>(null)
  const [assError, setAssError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const { timeSec, playing, seek, togglePlay } = usePlayhead(transcript.durationSec)
  const activeSegmentIndex = useMemo(() => findSegmentIndexAt(transcript, timeSec), [transcript, timeSec])
  const isEmpty = transcript.segments.length === 0
  const trimmedVideoSrc = videoSrc.trim()
  const videoUrlInvalid = trimmedVideoSrc !== '' && !VIDEO_URL_PATTERN.test(trimmedVideoSrc)

  // Any edit invalidates a previously generated ASS document.
  const applyTranscript = useCallback((next: Transcript) => {
    setTranscript(next)
    setAss(null)
    setAssError(null)
  }, [])

  const handleEditWord = useCallback(
    (segmentIndex: number, wordIndex: number, text: string) => {
      applyTranscript(editWordText(transcript, segmentIndex, wordIndex, text))
    },
    [transcript, applyTranscript],
  )

  const nudge = useCallback(
    (shiftSec: number) => {
      applyTranscript(retime(transcript, shiftSec))
    },
    [transcript, applyTranscript],
  )

  const cueSegment = useCallback(
    (segmentIndex: number) => {
      const segment = transcript.segments[segmentIndex]
      if (segment) seek(segment.startSec)
    },
    [transcript, seek],
  )

  const loadJson = useCallback(() => {
    let raw: unknown
    try {
      raw = JSON.parse(jsonDraft)
    } catch {
      setLoadError('That is not valid JSON.')
      return
    }
    // Validate with the same zod schema the /api/captions route uses, so a pasted transcript is fully
    // shape-checked (segments + word timings) before it drives the editor — not just a shallow guard.
    const result = transcriptSchema.safeParse(raw)
    if (!result.success) {
      setLoadError(result.error.issues.map((issue) => `${issue.path.join('.') || 'transcript'}: ${issue.message}`).join('; '))
      return
    }
    applyTranscript(result.data)
    setLoadError(null)
    setJsonDraft('')
    seek(0)
  }, [jsonDraft, applyTranscript, seek])

  const requestAss = useCallback(async () => {
    setBusy(true)
    setAssError(null)
    try {
      const response = await fetch('/api/captions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ transcript }),
      })
      if (!response.ok) {
        setAssError(await readError(response))
        return
      }
      const body = (await response.json()) as unknown
      if (typeof body !== 'object' || body === null || typeof (body as { ass?: unknown }).ass !== 'string') {
        setAssError('Unexpected response from /api/captions.')
        return
      }
      setAss((body as { ass: string }).ass)
    } catch (err) {
      setAssError(err instanceof Error ? err.message : 'Could not build ASS')
    } finally {
      setBusy(false)
    }
  }, [transcript])

  const copyAss = useCallback(() => {
    if (ass && navigator.clipboard) void navigator.clipboard.writeText(ass)
  }, [ass])

  return (
    <section className={styles.layout}>
      <div className="panel">
        <div className="panel__head">
          <span className="panel__n">05</span>
          <span className="panel__title">Transcript</span>
          <span className="panel__hint">
            {transcript.segments.length} seg · {countWords(transcript)} words
          </span>
        </div>

        <div className="field">
          <span className="field__label">Timing · shift every caption (retime)</span>
          <div className="actions">
            <button type="button" className="btn" onClick={() => nudge(-NUDGE_SEC)} disabled={isEmpty}>
              − 0.10s
            </button>
            <button type="button" className="btn" onClick={() => nudge(NUDGE_SEC)} disabled={isEmpty}>
              + 0.10s
            </button>
            <span className="field__note" style={{ alignSelf: 'center' }}>
              Re-aligns the whole transcript to the clip after a cut.
            </span>
          </div>
        </div>

        <details className="field">
          <summary className="field__label" style={{ cursor: 'pointer' }}>
            Load transcript JSON
          </summary>
          <textarea
            className="textarea"
            value={jsonDraft}
            onChange={(event) => setJsonDraft(event.target.value)}
            placeholder='{ "durationSec": 12, "segments": [ … ] }'
            spellCheck={false}
            style={{ marginTop: 8 }}
          />
          <div className="actions">
            <button type="button" className="btn" onClick={loadJson} disabled={jsonDraft.trim() === ''}>
              Load transcript
            </button>
          </div>
          {loadError ? <p className="msg msg--err">{loadError}</p> : null}
        </details>

        {isEmpty ? (
          <p className="empty">No speech detected in this clip — nothing to caption. Paste a transcript above to begin.</p>
        ) : (
          <SegmentList
            transcript={transcript}
            timeSec={timeSec}
            activeSegmentIndex={activeSegmentIndex}
            onEditWord={handleEditWord}
            onCueSegment={cueSegment}
          />
        )}
      </div>

      <div className={`panel ${styles.previewRail}`}>
        <div className="panel__head">
          <span className="panel__n">06</span>
          <span className="panel__title">Scrub preview</span>
          <span className="panel__hint">DOM overlay · no ffmpeg</span>
        </div>

        <CaptionStage
          transcript={transcript}
          timeSec={timeSec}
          playing={playing}
          activeSegmentIndex={activeSegmentIndex}
          videoSrc={videoUrlInvalid ? '' : trimmedVideoSrc}
          onSeek={seek}
          onTogglePlay={togglePlay}
        />

        <label className="field">
          <span className="field__label">Video URL (optional backdrop)</span>
          <input
            className="input"
            type="text"
            value={videoSrc}
            onChange={(event) => setVideoSrc(event.target.value)}
            placeholder="https://… — captions stay a DOM overlay"
            spellCheck={false}
          />
          {videoUrlInvalid ? (
            <span className="field__note" style={{ color: 'var(--fail)' }}>
              Enter an http(s) URL — data: and blob: schemes are not allowed.
            </span>
          ) : null}
        </label>

        <div className="actions">
          <button type="button" className="btn btn--primary" onClick={requestAss} disabled={busy}>
            {busy ? 'Building…' : 'Build ASS'}
          </button>
          {ass ? (
            <button type="button" className="btn" onClick={copyAss}>
              Copy
            </button>
          ) : null}
        </div>

        {assError ? <p className="msg msg--err">{assError}</p> : null}
        {ass ? (
          <div className={styles.assBlock}>
            <pre className={styles.assPre}>{ass}</pre>
          </div>
        ) : null}
      </div>
    </section>
  )
}
