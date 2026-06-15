'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

const MS_PER_SEC = 1000

/**
 * Drives the scrub playhead for the caption preview. `timeSec` is the single source of truth; the DOM
 * karaoke overlay and the optional `<video>` backdrop both follow it. Playback advances the playhead with
 * a `requestAnimationFrame` clock against the transcript's own timeline — no ffmpeg, no media required —
 * so the preview works even when no video file is loaded. Scrubbing always pins the time via `seek`.
 */
export function usePlayhead(durationSec: number) {
  const [timeSec, setTimeSec] = useState(0)
  const [playing, setPlaying] = useState(false)
  const rafRef = useRef<number | null>(null)
  const lastTsRef = useRef<number | null>(null)

  const seek = useCallback(
    (next: number) => {
      const ceiling = Math.max(0, durationSec)
      setTimeSec(Math.min(Math.max(0, next), ceiling))
    },
    [durationSec],
  )

  const togglePlay = useCallback(() => {
    // Restart from the top when play is pressed at (or past) the end. Kept OUT of the setPlaying
    // updater so the updater stays pure (no side effects under StrictMode double-invocation); `timeSec`
    // is current here because togglePlay runs from a click handler on the latest committed render.
    if (!playing && timeSec >= durationSec) setTimeSec(0)
    setPlaying((prev) => !prev)
  }, [playing, timeSec, durationSec])

  useEffect(() => {
    if (!playing) {
      lastTsRef.current = null
      return
    }
    const tick = (ts: number) => {
      if (lastTsRef.current !== null) {
        const elapsed = (ts - lastTsRef.current) / MS_PER_SEC
        setTimeSec((current) => Math.min(current + elapsed, durationSec))
      }
      lastTsRef.current = ts
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      lastTsRef.current = null
    }
  }, [playing, durationSec])

  // Pause automatically when the clock reaches the end of the media.
  useEffect(() => {
    if (playing && timeSec >= durationSec) setPlaying(false)
  }, [playing, timeSec, durationSec])

  return { timeSec, playing, seek, togglePlay }
}
