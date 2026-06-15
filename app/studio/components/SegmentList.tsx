'use client'

import { useState } from 'react'
import { formatAssTime } from '@/src/captions/ass'
import type { Transcript } from '@/src/transcribe/types'
import { wordStateAt } from '../lib/karaoke'
import styles from '../studio.module.css'

interface SegmentListProps {
  readonly transcript: Transcript
  readonly timeSec: number
  readonly activeSegmentIndex: number
  readonly onEditWord: (segmentIndex: number, wordIndex: number, text: string) => void
  readonly onCueSegment: (segmentIndex: number) => void
}

interface EditTarget {
  readonly segment: number
  readonly word: number
}

/** The editable transcript: segments → word chips. Click a word to fix it; click the time to cue it. */
export function SegmentList({ transcript, timeSec, activeSegmentIndex, onEditWord, onCueSegment }: SegmentListProps) {
  const [editing, setEditing] = useState<EditTarget | null>(null)
  const [draft, setDraft] = useState('')

  const beginEdit = (segment: number, word: number, current: string) => {
    setEditing({ segment, word })
    setDraft(current)
  }

  const commit = () => {
    if (!editing) return
    const text = draft.trim()
    if (text) onEditWord(editing.segment, editing.word, text)
    setEditing(null)
  }

  return (
    <div className={styles.segments}>
      {transcript.segments.map((segment, segmentIndex) => {
        const live = segmentIndex === activeSegmentIndex
        const span = Math.max(0.0001, segment.endSec - segment.startSec)
        const fill = Math.min(1, Math.max(0, (timeSec - segment.startSec) / span))
        const words = segment.words

        return (
          <div key={`seg-${segment.startSec}-${segment.endSec}`} className={`${styles.segment} ${live ? styles.segmentLive : ''}`}>
            <div className={styles.segmentHead}>
              <span className={styles.segIndex}>SEG {String(segmentIndex + 1).padStart(2, '0')}</span>
              <button type="button" className={styles.cue} onClick={() => onCueSegment(segmentIndex)} title="Cue the playhead here">
                {formatAssTime(segment.startSec)} → {formatAssTime(segment.endSec)}
              </button>
              <span className={styles.segDur}>{span.toFixed(2)}s</span>
            </div>

            <div className={styles.segProgress}>
              <div className={styles.segProgressFill} style={{ width: `${fill * 100}%` }} />
            </div>

            {words.length > 0 ? (
              <div className={styles.words}>
                {words.map((word, wordIndex) => {
                  const isEditing = editing?.segment === segmentIndex && editing?.word === wordIndex
                  if (isEditing) {
                    return (
                      <input
                        // biome-ignore lint/a11y/noAutofocus: focus follows an explicit click on the word being edited.
                        autoFocus
                        key={`w-${word.startSec}-${word.endSec}-edit`}
                        className={styles.wordEditor}
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        onBlur={commit}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') commit()
                          if (event.key === 'Escape') setEditing(null)
                        }}
                        aria-label={`Edit word "${word.text}"`}
                      />
                    )
                  }
                  const state = live ? wordStateAt(word, timeSec) : null
                  const stateClass =
                    state === 'active'
                      ? styles.wordActive
                      : state === 'sung'
                        ? styles.wordSung
                        : state === 'unsung'
                          ? styles.wordUnsung
                          : ''
                  return (
                    <button
                      type="button"
                      key={`w-${word.startSec}-${word.endSec}`}
                      className={`${styles.word} ${stateClass}`}
                      onClick={() => beginEdit(segmentIndex, wordIndex, word.text)}
                    >
                      {word.text}
                    </button>
                  )
                })}
              </div>
            ) : (
              <p className={styles.segPlain}>{segment.text} — no word timings (plain caption line)</p>
            )}
          </div>
        )
      })}
    </div>
  )
}
