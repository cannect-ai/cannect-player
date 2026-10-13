import { useEffect, useRef } from 'react'
import type { PlaylistEntry } from '@shared/types'

const PORTRAIT_STRIPS = 3
const SYNC_DRIFT_SEC = 0.3
const RECOVERY_TIMEOUT_MS = 15_000

interface DeckProps {
  entry: PlaylistEntry
  active: boolean
  paused?: boolean
  restartOnResume?: boolean
  forceMute?: boolean
  dividerPx: number
  onEnded: () => void
  onStarted: () => void
  onFailed?: () => void
}

/** One primary video and two muted mirrors in portrait. A successful play()
 * promise is not proof of playback: only the primary `playing` event is. */
export function Deck({
  entry,
  active,
  paused = false,
  restartOnResume = false,
  forceMute = false,
  dividerPx,
  onEnded,
  onStarted,
  onFailed
}: DeckProps): JSX.Element {
  const portrait = entry.aspectRatio === '9:16'
  const count = portrait ? PORTRAIT_STRIPS : 1
  const videos = useRef<(HTMLVideoElement | null)[]>([])
  const src = entry.localUrl ?? ''
  const lifecycle = useRef({ active, paused, src, onStarted, onEnded, onFailed })
  lifecycle.current = { active, paused, src, onStarted, onEnded, onFailed }
  const wasPaused = useRef(paused)
  const failed = useRef(false)
  const lastMediaTime = useRef(0)
  const recoveryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearRecovery = (): void => {
    if (recoveryTimer.current) clearTimeout(recoveryTimer.current)
    recoveryTimer.current = null
  }
  const fail = (): void => {
    const current = lifecycle.current
    if (!current.active || current.paused || failed.current) return
    failed.current = true
    clearRecovery()
    current.onFailed?.()
  }
  const armRecovery = (): void => {
    if (recoveryTimer.current || !lifecycle.current.active || lifecycle.current.paused) return
    recoveryTimer.current = setTimeout(fail, RECOVERY_TIMEOUT_MS)
  }

  useEffect(() => {
    videos.current.forEach((video) => {
      if (!video) return
      video.src = src
      video.load()
      video.currentTime = 0
    })
  }, [src])
  useEffect(() => {
    videos.current.forEach((video, index) => {
      if (video) video.muted = forceMute || index !== 0
    })
  }, [forceMute, src])
  useEffect(() => {
    if (active)
      videos.current.forEach((video) => {
        if (video) video.currentTime = 0
      })
  }, [active, src])
  useEffect(() => {
    let cancelled = false
    const restarting = restartOnResume && wasPaused.current && !paused && active
    wasPaused.current = paused
    failed.current = false
    clearRecovery()
    if (active && !paused) armRecovery()
    videos.current.forEach((video, index) => {
      if (!video) return
      if (restarting) video.currentTime = 0
      if (active && !paused) {
        void video.play().catch((error: unknown) => {
          // Pause/load intentionally abort pending play promises. A decode or
          // unsupported-media failure should advance rather than freeze forever.
          if (!cancelled && index === 0 && (error as Error)?.name !== 'AbortError') fail()
        })
      } else video.pause()
    })
    return () => {
      cancelled = true
      clearRecovery()
    }
  }, [active, paused, src, restartOnResume])

  const handleTimeUpdate = (): void => {
    const primary = videos.current[0]
    if (!primary) return
    if (primary.currentTime > lastMediaTime.current) clearRecovery()
    lastMediaTime.current = primary.currentTime
    for (let index = 1; index < count; index++) {
      const mirror = videos.current[index]
      if (mirror && Math.abs(mirror.currentTime - primary.currentTime) > SYNC_DRIFT_SEC)
        mirror.currentTime = primary.currentTime
    }
  }
  const handlePlaying = (): void => {
    const current = lifecycle.current
    if (!current.active || current.paused || failed.current) return
    clearRecovery()
    current.onStarted()
  }
  const handleEnded = (): void => {
    const current = lifecycle.current
    if (!current.active || current.paused || failed.current) return
    failed.current = true
    clearRecovery()
    current.onEnded()
  }

  return (
    <div
      className={`deck ${portrait ? 'deck--portrait' : 'deck--landscape'} ${active ? 'active' : ''}`}
      style={portrait ? { gap: `${dividerPx}px` } : undefined}
    >
      {Array.from({ length: count }, (_, index) => {
        const video = (
          <video
            key={index}
            ref={(element) => (videos.current[index] = element)}
            preload="auto"
            playsInline
            muted={forceMute || index !== 0}
            onPlaying={index === 0 ? handlePlaying : undefined}
            onEnded={index === 0 ? handleEnded : undefined}
            onError={index === 0 ? fail : undefined}
            onWaiting={index === 0 ? armRecovery : undefined}
            onStalled={index === 0 ? armRecovery : undefined}
            onTimeUpdate={index === 0 ? handleTimeUpdate : undefined}
          />
        )
        return portrait ? (
          <div className="strip" key={index}>
            {video}
          </div>
        ) : (
          video
        )
      })}
    </div>
  )
}
