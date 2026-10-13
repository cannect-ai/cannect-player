import { useEffect, useRef, useState } from 'react'
import type { GameFeedback } from '@shared/types'
const sounds: Record<string, string> = {
  bounce: new URL('./event-assets/audio/bounce.wav', import.meta.url).href,
  catch: new URL('./event-assets/audio/catch.wav', import.meta.url).href,
  miss: new URL('./event-assets/audio/miss.wav', import.meta.url).href,
  move: new URL('./event-assets/audio/move.wav', import.meta.url).href,
  count: new URL('./event-assets/audio/count.wav', import.meta.url).href,
  start: new URL('./event-assets/audio/start.wav', import.meta.url).href,
  loss: new URL('./event-assets/audio/loss.wav', import.meta.url).href
}
export function audioPreference(muted?: boolean): boolean {
  try {
    const saved = sessionStorage.getItem('steppe-audio')
    return saved === null ? !muted : saved === 'on'
  } catch {
    return !muted
  }
}
export function GameEffects({
  muted,
  onEnabledChange,
  onActivityChange,
  celebrating = false,
  videoMusic = false
}: {
  videoMusic?: boolean
  celebrating?: boolean
  muted?: boolean
  onEnabledChange?: (enabled: boolean) => void
  onActivityChange?: (active: boolean) => void
}): JSX.Element {
  const [enabled, setEnabled] = useState(() => audioPreference(muted)),
    [blocked, setBlocked] = useState(false),
    [event, setEvent] = useState<GameFeedback | null>(null)
  const context = useRef<AudioContext | null>(null),
    buffers = useRef(new Map<string, AudioBuffer>()),
    enabledRef = useRef(audioPreference(muted)),
    last = useRef(0)
  const celebratingRef = useRef(celebrating),
    sources = useRef(new Set<AudioBufferSourceNode>())
  const videoMusicRef = useRef(videoMusic)
  videoMusicRef.current = videoMusic
  celebratingRef.current = celebrating
  const music = useRef<AudioBufferSourceNode | null>(null),
    activity = useRef(0),
    activeRef = useRef(false),
    preparing = useRef<Promise<void> | null>(null)
  function gameActive(value: boolean) {
    if (activeRef.current !== value) {
      activeRef.current = value
      onActivityChange?.(value)
    }
  }
  function stopMusic() {
    try {
      music.current?.stop()
    } catch {}
    music.current = null
    gameActive(false)
  }
  function playMusic() {
    const c = context.current,
      buffer = buffers.current.get('music')
    if (
      !c ||
      !buffer ||
      music.current ||
      !enabledRef.current ||
      celebratingRef.current ||
      videoMusicRef.current
    )
      return
    const source = c.createBufferSource(),
      gain = c.createGain()
    source.buffer = buffer
    source.loop = true
    gain.gain.value = 0.13
    source.connect(gain).connect(c.destination)
    source.start()
    music.current = source
    gameActive(true)
  }
  async function prepare() {
    if (preparing.current) return preparing.current
    preparing.current = initialize()
    return preparing.current
  }
  async function initialize() {
    if (!context.current) {
      const c = new AudioContext()
      context.current = c
      c.onstatechange = () => setBlocked(enabledRef.current && c.state !== 'running')
      setBlocked(enabledRef.current && c.state !== 'running')
      await Promise.all(
        Object.entries({
          ...sounds,
          music: new URL('./event-assets/audio/game-loop.m4a', import.meta.url).href
        }).map(async ([kind, url]) => {
          try {
            const bytes = await (await fetch(url)).arrayBuffer()
            buffers.current.set(kind, await c.decodeAudioData(bytes))
          } catch {
            window.cannect.log('warn', 'StepFair audio decode failed: ' + kind)
          }
        })
      )
    }
  }
  function stopEffects() {
    for (const source of sources.current) {
      try {
        source.stop()
      } catch {}
    }
    sources.current.clear()
  }
  async function cue(kind: string) {
    await prepare()
    if (!enabledRef.current || celebratingRef.current) return
    const c = context.current,
      buffer = buffers.current.get(kind)
    if (!c || !buffer) return
    try {
      await c.resume()
      if (!enabledRef.current || celebratingRef.current) return
      const source = c.createBufferSource(),
        gain = c.createGain()
      source.buffer = buffer
      gain.gain.value = kind === 'move' ? 0.15 : kind === 'bounce' ? 0.4 : 0.65
      source.connect(gain).connect(c.destination)
      sources.current.add(source)
      source.onended = () => {
        sources.current.delete(source)
        source.disconnect()
        gain.disconnect()
      }
      source.start()
    } catch {
      window.cannect.log('warn', 'StepFair audio playback blocked: ' + kind)
      setBlocked(true)
    }
  }
  useEffect(() => {
    onEnabledChange?.(enabledRef.current)
    void prepare()
    const timer = setInterval(() => {
      if (Date.now() - activity.current > 5000) stopMusic()
    }, 1000)
    return () => {
      clearInterval(timer)
      stopMusic()
      stopEffects()
      if (context.current) context.current.onstatechange = null
      void context.current?.close()
    }
  }, [])
  useEffect(() => {
    if (celebrating) {
      activity.current = 0
      stopMusic()
      stopEffects()
      setEvent(null)
    }
  }, [celebrating])
  useEffect(() => {
    if (videoMusic) stopMusic()
  }, [videoMusic])
  // Celebration owns its single soundtrack; the game win event never layers a cue.
  useEffect(() => {
    let clear: ReturnType<typeof setTimeout> | undefined
    const off = window.cannect.onGameFeedback((e) => {
      if (e.id <= last.current) return
      last.current = e.id
      if (e.kind === 'win' || e.kind === 'loss') {
        activity.current = 0
        stopMusic()
      }
      if (celebratingRef.current || e.kind === 'win') return
      if (e.kind !== 'move' && e.kind !== 'count' && e.kind !== 'bounce') {
        setEvent(e)
        if (clear) clearTimeout(clear)
        clear = setTimeout(() => setEvent(null), 900)
      }
      if (e.kind !== 'loss') {
        activity.current = Date.now()
        void prepare().then(() => {
          if (Date.now() - activity.current < 5000 && e.kind !== 'count') playMusic()
        })
      }
      void cue(e.kind)
    })
    return () => {
      off()
      if (clear) clearTimeout(clear)
    }
  }, [])
  async function toggle() {
    const next = blocked ? true : !enabledRef.current
    try {
      sessionStorage.setItem('steppe-audio', next ? 'on' : 'off')
    } catch {}
    enabledRef.current = next
    setEnabled(next)
    onEnabledChange?.(next)
    await prepare()
    if (next) {
      await context.current?.resume()
      setBlocked(context.current?.state !== 'running')
      if (Date.now() - activity.current < 5000) playMusic()
    } else {
      stopMusic()
      setBlocked(false)
      await context.current?.suspend()
    }
  }
  return (
    <>
      {(muted !== undefined || blocked) && (
        <button className="event-audio-toggle" onClick={() => void toggle()}>
          {blocked
            ? '♫ Нажми, чтобы включить звук'
            : enabled
              ? '♫ Звук включён'
              : '♫ Включить звук'}
        </button>
      )}
      {event && (
        <div className={'event-feedback feedback-' + event.kind} key={event.id}>
          {[0, 1, 2].map((strip) => (
            <div className="feedback-strip" key={strip}>
              <div className="feedback-ring" />
              <div className="feedback-badge">
                {event.kind === 'catch'
                  ? `${event.collected ?? 0} / 3`
                  : event.kind === 'miss'
                    ? '×'
                    : event.kind === 'win'
                      ? '3 / 3'
                      : event.kind === 'loss'
                        ? 'ЕЩЁ РАЗ'
                        : 'ПОЕХАЛИ!'}
              </div>
              {(event.kind === 'catch' || event.kind === 'win') &&
                Array.from({ length: event.kind === 'win' ? 30 : 12 }, (_, i) => (
                  <i
                    key={i}
                    className="feedback-spark"
                    style={
                      {
                        '--angle': `${i * 137.5}deg`,
                        '--travel': `${50 + (i % 5) * 25}px`,
                        '--color': ['#ff76f2', '#eeff51', '#b0f4ff', '#ff0e0d'][i % 4]
                      } as React.CSSProperties
                    }
                  />
                ))}
            </div>
          ))}
        </div>
      )}
    </>
  )
}
