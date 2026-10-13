import { useEffect, useRef, useState } from 'react'
import type { PlaylistEntry, PlaylistUpdate, RendererConfig } from '@shared/types'
import { PlaybackSession } from '@shared/playbackSession'
import { Deck } from './Deck'
import { PlayerFrame } from './PlayerFrame'

interface PlayerProps {
  config: RendererConfig
  playlist: PlaylistUpdate
  paused?: boolean
}

/** A placement/metadata change replaces the session before a new deck emits
 * events. Unchanged queue polls keep the current clip playing. */
export function Player(props: PlayerProps): JSX.Element {
  const entries = props.playlist.entries.filter((entry) => Boolean(entry.localUrl))
  const key = JSON.stringify([
    props.playlist.isDefault,
    entries.map((entry) => [
      entry.videoId,
      entry.localUrl,
      entry.campaignId,
      entry.bookingId,
      entry.duration,
      entry.aspectRatio
    ])
  ])
  return <PlaylistPlayer key={key} {...props} entries={entries} />
}

function PlaylistPlayer({
  config,
  playlist,
  entries,
  paused = false
}: PlayerProps & { entries: PlaylistEntry[] }): JSX.Element {
  const len = entries.length
  const [slots, setSlots] = useState<[number, number]>([0, len > 1 ? 1 : 0])
  const [active, setActive] = useState<0 | 1>(0)
  const activeRef = useRef<0 | 1>(0)
  const playingIndex = useRef(0)
  const isFirst = useRef(true)
  const mounted = useRef(true)
  const pausedRef = useRef(paused)
  pausedRef.current = paused
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null)
  const session = useRef<PlaybackSession>()
  if (!session.current)
    session.current = new PlaybackSession((event) => window.cannect.sendPlaybackEvent(event))

  useEffect(() => {
    if (paused) session.current!.end(false)
  }, [paused])
  useEffect(
    () => () => {
      mounted.current = false
      if (pending.current) clearTimeout(pending.current)
      session.current!.end(false)
    },
    []
  )

  const advance = (slot: 0 | 1, completed: boolean): void => {
    if (!mounted.current || pausedRef.current || slot !== activeRef.current || len === 0) return
    session.current!.end(completed, completed ? 'interrupted' : 'error')
    if (pending.current) clearTimeout(pending.current)
    const transition = (): void => {
      if (!mounted.current || pausedRef.current || slot !== activeRef.current) return
      const nextIndex = (playingIndex.current + 1) % len
      const nextSlot = slot === 0 ? 1 : 0
      activeRef.current = nextSlot
      playingIndex.current = nextIndex
      isFirst.current = false
      // A short/failing clip can finish before the previous fade timer. The next
      // slot must still be correct when it could not be preloaded yet.
      setSlots((current) => {
        const updated = [...current] as [number, number]
        updated[nextSlot] = nextIndex
        return updated
      })
      setActive(nextSlot)
      if (pending.current) clearTimeout(pending.current)
      pending.current = setTimeout(() => {
        setSlots((current) => {
          const updated = [...current] as [number, number]
          updated[slot] = (nextIndex + 1) % len
          return updated
        })
      }, 300)
    }
    if (completed) transition()
    else pending.current = setTimeout(transition, 1_000)
  }

  if (!len) return <div className="status">нет прогретого контента — ожидание…</div>
  return (
    <PlayerFrame
      dividerPx={config.stripDividerPx}
      portrait={entries[slots[active]]?.aspectRatio === '9:16'}
    >
      {([0, 1] as const).map((slot) => (
        <Deck
          key={`${slot}:${slots[slot]}`}
          entry={entries[slots[slot]]}
          active={active === slot}
          paused={paused}
          restartOnResume
          forceMute={config.muteAudio}
          dividerPx={config.stripDividerPx}
          onStarted={() => {
            if (mounted.current && !pausedRef.current && slot === activeRef.current) {
              session.current!.start(
                entries[playingIndex.current],
                playlist.isDefault,
                isFirst.current
              )
            }
          }}
          onEnded={() => advance(slot, true)}
          onFailed={() => advance(slot, false)}
        />
      ))}
    </PlayerFrame>
  )
}
