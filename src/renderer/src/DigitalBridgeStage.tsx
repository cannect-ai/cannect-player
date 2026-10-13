import { useEffect, useRef } from 'react'
import type { EventScene } from '@shared/types'

/** Server-selected video and overlay, repeated around the physical cylinder.
 * A gift is acknowledged only when all three videos and overlays are ready. */
export function DigitalBridgeStage({
  name,
  scene,
  giftId,
  divider,
  forceMute,
  paused = false,
  onFailure
}: {
  name: string
  scene: EventScene
  giftId?: string
  divider: number
  forceMute: boolean
  paused?: boolean
  onFailure?: () => void
}): JSX.Element {
  const videos = useRef<(HTMLVideoElement | null)[]>([])
  const playing = useRef(new Set<number>()),
    images = useRef(new Set<number>())
  const started = useRef(false),
    failed = useRef(false)
  function fail(): void {
    if (failed.current) return
    failed.current = true
    if (giftId)
      window.cannect.sendEventPlayback({
        type: 'celebration',
        id: giftId,
        action: 'failed',
        manualClose: true
      })
    onFailure?.()
  }
  function ready(): void {
    if (
      !giftId ||
      started.current ||
      failed.current ||
      playing.current.size !== 3 ||
      images.current.size !== 3
    )
      return
    started.current = true
    window.cannect.sendEventPlayback({
      type: 'celebration',
      id: giftId,
      action: 'started',
      manualClose: true
    })
  }
  useEffect(() => {
    let cancelled = false
    const media = [...videos.current]
    media.forEach((video, index) => {
      if (!video) return
      video.volume = 0.8
      video.muted = forceMute || index !== 0 || paused
      if (paused) video.pause()
      else
        void video.play().catch(() => {
          if (!cancelled) fail()
        })
    })
    return () => {
      cancelled = true
      media.forEach((video) => video?.pause())
    }
  }, [paused])
  useEffect(() => {
    videos.current.forEach((video, index) => {
      if (video) video.muted = forceMute || index !== 0 || paused
    })
  }, [forceMute, paused])
  useEffect(() => {
    const timer = setTimeout(() => {
      if (giftId && !started.current) fail()
    }, 25_000)
    return () => clearTimeout(timer)
  }, [])
  return (
    <div
      className={`db-station-scene ${giftId ? 'db-station-finish' : 'db-station-game'}`}
      style={{ gap: divider }}
      data-gift={giftId}
    >
      {[0, 1, 2].map((index) => (
        <div className="db-station-panel" key={index}>
          <video
            ref={(video) => (videos.current[index] = video)}
            src={scene.localUrl}
            loop
            playsInline
            muted={forceMute || index !== 0 || paused}
            onPlaying={() => {
              playing.current.add(index)
              ready()
            }}
            onError={fail}
            onTimeUpdate={
              index === 0
                ? () => {
                    const primary = videos.current[0]
                    if (primary)
                      videos.current.slice(1).forEach((video) => {
                        if (video && Math.abs(video.currentTime - primary.currentTime) > 0.15)
                          video.currentTime = primary.currentTime
                      })
                  }
                : undefined
            }
          />
          <img
            className="db-station-overlay"
            src={scene.localOverlayUrl}
            alt=""
            onLoad={() => {
              images.current.add(index)
              ready()
            }}
            onError={fail}
          />
          <div
            className="db-station-name"
            style={{
              fontSize: `min(${(giftId ? 3.89 : 5.28) * Math.min(1, 16 / Math.max(1, name.length))}vh, ${((giftId ? 42 : 57) / 620) * 100 * Math.min(1, 16 / Math.max(1, name.length))}cqw)`
            }}
          >
            {name}
          </div>
        </div>
      ))}
    </div>
  )
}
