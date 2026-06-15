'use client'

import { useEffect, useRef } from 'react'
import { formatAssTime } from '@/src/captions/ass'
import type { Transcript } from '@/src/transcribe/types'
import { wordStateAt } from '../lib/karaoke'
import styles from '../studio.module.css'

const SEEK_EPSILON_SEC = 0.05

interface CaptionStageProps {
  readonly transcript: Transcript
  readonly timeSec: number
  readonly playing: boolean
  readonly activeSegmentIndex: number
  readonly videoSrc: string
  readonly onSeek: (timeSec: number) => void
  readonly onTogglePlay: () => void
}

const wordClass: Record<ReturnType<typeof wordStateAt>, string> = {
  unsung: styles.capUnsung,
  active: styles.capActive,
  sung: styles.capSung,
}

/** 9:16 preview stage: a DOM/CSS karaoke overlay synced to the scrub playhead (no ffmpeg burn). */
export function CaptionStage({
  transcript,
  timeSec,
  playing,
  activeSegmentIndex,
  videoSrc,
  onSeek,
  onTogglePlay,
}: CaptionStageProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const { durationSec, segments } = transcript
  const activeSegment = activeSegmentIndex >= 0 ? segments[activeSegmentIndex] : null
  const pct = (sec: number) => (durationSec > 0 ? `${Math.min(100, Math.max(0, (sec / durationSec) * 100))}%` : '0%')

  // One-way sync: the optional <video> backdrop follows the playhead. The overlay is the source of truth.
  useEffect(() => {
    const video = videoRef.current
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return
    const target = Math.min(timeSec, video.duration)
    if (Math.abs(video.currentTime - target) > SEEK_EPSILON_SEC) video.currentTime = target
  }, [timeSec])

  return (
    <div className={styles.previewStack}>
      <div className={styles.stage}>
        {videoSrc ? (
          <video ref={videoRef} className={styles.stageVideo} src={videoSrc} muted playsInline preload="metadata" />
        ) : null}

        {segments.length === 0 ? (
          <p className={styles.stageEmpty}>No speech detected — nothing to caption. Paste a transcript with segments to preview karaoke.</p>
        ) : activeSegment ? (
          <div className={styles.safeArea}>
            <p className={styles.caption}>
              {activeSegment.words.length > 0 ? (
                activeSegment.words.map((word) => (
                  <span key={`cap-${word.startSec}-${word.endSec}`} className={`${styles.capWord} ${wordClass[wordStateAt(word, timeSec)]}`}>
                    {word.text}
                  </span>
                ))
              ) : (
                <span className={`${styles.capWord} ${styles.capSung}`}>{activeSegment.text}</span>
              )}
            </p>
          </div>
        ) : null}
      </div>

      <div className={styles.transport}>
        <button
          type="button"
          className={styles.playBtn}
          onClick={onTogglePlay}
          disabled={segments.length === 0}
          aria-label={playing ? 'Pause preview' : 'Play preview'}
        >
          {playing ? (
            <svg width="13" height="13" viewBox="0 0 12 12" aria-hidden="true">
              <rect x="2" y="1.5" width="3" height="9" rx="0.5" fill="currentColor" />
              <rect x="7" y="1.5" width="3" height="9" rx="0.5" fill="currentColor" />
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M3 1.8 10 6 3 10.2Z" fill="currentColor" />
            </svg>
          )}
        </button>
        <span className={styles.clock}>
          {formatAssTime(timeSec)} <span className={styles.clockDim}>/ {formatAssTime(durationSec)}</span>
        </span>
      </div>

      <div className={styles.timeline} aria-hidden="true">
        {segments.map((segment, index) => (
          <span
            key={`tl-${segment.startSec}-${segment.endSec}`}
            className={`${styles.segBlock} ${index === activeSegmentIndex ? styles.segBlockLive : ''}`}
            style={{ left: pct(segment.startSec), width: pct(segment.endSec - segment.startSec) }}
          />
        ))}
        <span className={styles.playhead} style={{ left: pct(timeSec) }} />
      </div>

      <input
        className={styles.scrub}
        type="range"
        min={0}
        max={durationSec}
        step={0.05}
        value={timeSec}
        onChange={(event) => onSeek(Number(event.target.value))}
        disabled={segments.length === 0}
        aria-label="Scrub playhead"
      />
    </div>
  )
}
