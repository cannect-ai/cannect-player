import { useEffect, useRef, useState } from 'react'
import type {
  EventState,
  EventScene,
  PlaylistEntry,
  PlaylistUpdate,
  RendererConfig
} from '@shared/types'
import { EventRound } from '@shared/eventRound'
import { Deck } from './Deck'
import { Player } from './Player'
import { DigitalBridgeStage } from './DigitalBridgeStage'
import { PlayerFrame } from './PlayerFrame'
import { GameEffects, audioPreference } from './GameEffects'
import { victorySoundFor } from './VictorySound'
import { GameMemePicker } from '@shared/gameMemes'
import { gamePresentations, type GamePresentation } from './GameMemes'
import steppeLogo from './event-assets/steppe-logo.svg'
import cannectLogo from './event-assets/cannect-logo.svg'
import guestQr from './event-assets/guest-upload-qr.svg'
const sheckerLogo = new URL('./event-assets/shecker-logo-v1.png', import.meta.url).href

export function EventPlayer({
  state,
  config,
  gamePresentation,
  fleetPlaylist
}: {
  state: EventState
  config: RendererConfig
  gamePresentation?: GamePresentation
  fleetPlaylist?: PlaylistUpdate
}): JSX.Element {
  const [audioEnabled, setAudioEnabled] = useState(() => audioPreference(config.muteAudio))
  const [gameAudioActive, setGameAudioActive] = useState(false)
  const [liveGame, setLiveGame] = useState<
    (EventScene & { seenAt: number; finishing?: boolean }) | null
  >(null)
  const memePicker = useRef<GameMemePicker>()
  if (!memePicker.current) memePicker.current = new GameMemePicker()
  const presentation = liveGame
    ? (gamePresentation ?? gamePresentations[memePicker.current.forGame(liveGame.id)])
    : null
  const finishedGames = useRef(new Set<string>())
  useEffect(() => {
    const game = state.activeGame
    if (game && !finishedGames.current.has(game.id)) setLiveGame(game)
    else if (!game) setLiveGame((g) => (g?.finishing ? g : null))
  }, [state.activeGame])
  useEffect(
    () =>
      window.cannect.onGameFeedback((e) => {
        if (Date.now() - e.created * 1000 > 15000) return
        if (e.kind === 'win' || e.kind === 'loss') {
          finishedGames.current.add(e.gameId)
          if (finishedGames.current.size > 100)
            finishedGames.current.delete(finishedGames.current.values().next().value!)
          setLiveGame((g) =>
            g?.id === e.gameId
              ? e.kind === 'win'
                ? { ...g, finishing: true, seenAt: Date.now() }
                : null
              : g
          )
        } else if (!finishedGames.current.has(e.gameId)) {
          setLiveGame((g) => ({
            ...(g?.id === e.gameId ? g : {}),
            id: e.gameId,
            name: g?.id === e.gameId ? g.name : '',
            seenAt: Date.now()
          }))
        }
      }),
    []
  )
  useEffect(() => {
    const t = setInterval(
      () =>
        setLiveGame((g) => (g && Date.now() - g.seenAt > (g.finishing ? 20000 : 35000) ? null : g)),
      1000
    )
    return () => clearInterval(t)
  }, [])
  const round = useRef(new EventRound<PlaylistEntry>())
  const [, render] = useState(0)
  const [active, setActive] = useState<0 | 1>(0)
  const [slots, setSlots] = useState<[PlaylistEntry | undefined, PlaylistEntry | undefined]>([
    undefined,
    undefined
  ])
  const [done, setDone] = useState<string | null>(null)
  const [clock, setClock] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 250)
    return () => clearInterval(timer)
  }, [])
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null)
  const currentCelebration =
    state.celebration &&
    state.celebration.id !== done &&
    (state.celebration.expiresAt === undefined || state.celebration.expiresAt > clock)
      ? state.celebration
      : null
  const interrupted = !!currentCelebration || !!liveGame
  useEffect(() => {
    if (currentCelebration) setLiveGame((g) => (g?.finishing ? null : g))
  }, [currentCelebration?.id])
  const activeRef = useRef<0 | 1>(0)
  const transition = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const first = round.current.stage(state.entries)
    if (first) setSlots([round.current.current, round.current.next])
    else
      setSlots((s) => {
        const r = [...s] as typeof s
        r[activeRef.current === 0 ? 1 : 0] = round.current.next
        return r
      })
    render((n) => n + 1)
  }, [state.entries])
  useEffect(
    () => () => {
      if (transition.current) clearTimeout(transition.current)
      if (retry.current) clearTimeout(retry.current)
    },
    []
  )
  function ended() {
    if (interrupted) return
    const freed = activeRef.current
    round.current.advance()
    activeRef.current = freed === 0 ? 1 : 0
    setActive(activeRef.current)
    if (transition.current) clearTimeout(transition.current)
    transition.current = setTimeout(
      () =>
        setSlots((s) => {
          const copy = [...s] as typeof s
          copy[freed] = round.current.next
          return copy
        }),
      300
    )
  }
  function started() {
    if (fleetPlaylist || interrupted) return
    const r = round.current
    if (r.current)
      window.cannect.sendEventPlayback({
        type: 'playing',
        videoId: r.current.videoId,
        nextId: r.next?.videoId ?? null,
        round: r.round,
        started: Date.now() / 1000
      })
  }
  const startedRef = useRef(started)
  startedRef.current = started
  useEffect(() => {
    const t = setInterval(() => {
      startedRef.current()
    }, 5000)
    return () => clearInterval(t)
  }, [])
  const portrait =
    (currentCelebration?.entry.aspectRatio ?? (liveGame ? '9:16' : slots[active]?.aspectRatio)) ===
    '9:16'
  return (
    <>
      {fleetPlaylist && <Player config={config} playlist={fleetPlaylist} paused={interrupted} />}
      <PlayerFrame
        dividerPx={config.stripDividerPx}
        portrait={portrait}
        className={
          'event-stage' +
          (fleetPlaylist
            ? ' event-stage--campaign' + (!interrupted ? ' event-stage--idle' : '')
            : '')
        }
      >
        <GameEffects
          videoMusic={!!liveGame}
          celebrating={!!currentCelebration}
          muted={config.muteAudio}
          onEnabledChange={setAudioEnabled}
          onActivityChange={setGameAudioActive}
        />
        {!fleetPlaylist &&
          [0, 1].map(
            (slot) =>
              slots[slot] && (
                <Deck
                  key={slot}
                  entry={slots[slot]!}
                  forceMute={!audioEnabled || gameAudioActive}
                  active={active === slot}
                  paused={interrupted}
                  restartOnResume
                  dividerPx={config.stripDividerPx}
                  onEnded={() => {
                    if (slot === activeRef.current) ended()
                  }}
                  onFailed={() => {
                    if (slot === activeRef.current) ended()
                  }}
                  onStarted={() => {
                    if (slot === activeRef.current) started()
                  }}
                />
              )
          )}
        {!fleetPlaylist &&
          !interrupted &&
          slots[active] &&
          slots[active]?.videoId !== 'event-intro' &&
          slots[active]?.videoId !== 'event-partner-aitea' && (
            <GuestUploadQr divider={config.stripDividerPx} />
          )}
        {liveGame?.campaign === 'digital-bridge' && liveGame.localUrl && (
          <DigitalBridgeStage
            key={liveGame.id}
            name={liveGame.name}
            scene={liveGame}
            paused={!!currentCelebration}
            forceMute={!audioEnabled}
            divider={config.stripDividerPx}
          />
        )}
        {liveGame &&
          presentation &&
          liveGame.campaign !== 'digital-bridge' &&
          state.campaign !== 'digital-bridge' && (
            <GameLive
              discount={!!fleetPlaylist}
              language={liveGame.language}
              key={liveGame.id + ':' + presentation.id}
              name={liveGame.name}
              paused={!!currentCelebration}
              forceMute={!audioEnabled}
              divider={config.stripDividerPx}
              presentation={presentation}
            />
          )}
        {currentCelebration?.campaign === 'digital-bridge' && (
          <DigitalBridgeStage
            key={currentCelebration.id}
            name={currentCelebration.name}
            scene={{
              ...currentCelebration,
              localUrl: currentCelebration.entry.localUrl ?? undefined
            }}
            giftId={currentCelebration.id}
            forceMute={!audioEnabled}
            divider={config.stripDividerPx}
            onFailure={() => {
              setDone(currentCelebration.id)
              retry.current = setTimeout(() => setDone(null), 5000)
            }}
          />
        )}
        {currentCelebration &&
          currentCelebration.campaign !== 'digital-bridge' &&
          state.campaign !== 'digital-bridge' && (
            <Celebration
              discount={!!fleetPlaylist}
              key={currentCelebration.id}
              celebration={currentCelebration}
              forceMute={!audioEnabled}
              divider={config.stripDividerPx}
              onComplete={(success) => {
                setDone(currentCelebration.id)
                if (!success) retry.current = setTimeout(() => setDone(null), 5000)
              }}
            />
          )}
      </PlayerFrame>
    </>
  )
}

function Celebration({
  celebration,
  divider,
  onComplete,
  forceMute = false,
  discount = false
}: {
  discount?: boolean
  forceMute?: boolean
  celebration: NonNullable<EventState['celebration']>
  divider: number
  onComplete: (success: boolean) => void
}): JSX.Element {
  const kazakh = celebration.language === 'kk'
  const sent = useRef(false)
  const ended = useRef(false)
  const refs = useRef<(HTMLVideoElement | null)[]>([])
  const sound = useRef<HTMLAudioElement | null>(null)
  const soundtrack = victorySoundFor(celebration.id)
  useEffect(() => {
    const currentSound = sound.current
    refs.current.forEach((v, i) => {
      if (v) {
        v.muted = true
        v.volume = 0
        void v.play().catch(() => {
          window.cannect.log('warn', 'StepFair victory video play rejected on strip ' + i)
          if (i === 0 && !ended.current) {
            ended.current = true
            report('failed')
            onComplete(false)
          }
        })
      }
    })
    return () => {
      refs.current.forEach((v) => v?.pause())
      currentSound?.pause()
    }
  }, [])
  useEffect(() => {
    if (sound.current) sound.current.muted = forceMute
  }, [forceMute])
  useEffect(() => {
    const t = setTimeout(() => {
      if ((discount || !sent.current) && !ended.current) {
        ended.current = true
        report('failed')
        onComplete(false)
      }
    }, 40000)
    return () => clearTimeout(t)
  }, [])
  const report = (action: 'started' | 'completed' | 'failed') =>
    window.cannect.sendEventPlayback({
      type: 'celebration',
      id: celebration.id,
      action,
      manualClose: !discount
    })
  return (
    <div className="event-celebration" style={{ gap: divider }}>
      <audio
        ref={sound}
        src={soundtrack.url}
        loop={soundtrack.loop}
        muted={forceMute}
        preload="auto"
      />
      {[0, 1, 2].map((i) => (
        <div className="event-celebration-strip" key={i}>
          <video
            ref={(v) => (refs.current[i] = v)}
            src={celebration.entry.localUrl!}
            playsInline
            muted
            loop={!discount}
            onEnded={
              i === 0 && discount
                ? () => {
                    if (!ended.current) {
                      ended.current = true
                      report('completed')
                      onComplete(true)
                    }
                  }
                : undefined
            }
            onPlaying={
              i === 0
                ? () => {
                    if (!sent.current) {
                      sent.current = true
                      report('started')
                      const audio = sound.current
                      if (audio) {
                        audio.volume = 0.8
                        void audio
                          .play()
                          .then(() =>
                            window.cannect.log('info', 'StepFair single victory soundtrack started')
                          )
                          .catch(() =>
                            window.cannect.log(
                              'warn',
                              'StepFair victory soundtrack playback failed'
                            )
                          )
                      }
                      window.cannect.log(
                        'info',
                        'StepFair victory video started; embedded audio muted'
                      )
                    }
                  }
                : undefined
            }
            onTimeUpdate={
              i === 0
                ? () => {
                    const primary = refs.current[0]
                    if (primary)
                      refs.current.slice(1).forEach((v) => {
                        if (v && Math.abs(v.currentTime - primary.currentTime) > 0.3)
                          v.currentTime = primary.currentTime
                      })
                  }
                : undefined
            }
            onError={
              i === 0
                ? () => {
                    if (!ended.current) {
                      ended.current = true
                      report('failed')
                      onComplete(false)
                    }
                  }
                : undefined
            }
          />
          <div className="event-winner">
            <div className="event-brands">
              <img
                src={discount ? sheckerLogo : steppeLogo}
                alt={discount ? 'SHECKER' : 'STEPPE FAIR'}
              />
              <img src={cannectLogo} alt="CANNECT" />
            </div>
            <h1 style={celebration.name.length > 18 ? { fontSize: 'min(2vw,4vh)' } : undefined}>
              {celebration.name},<br />
              {kazakh ? 'сен жеңдің!' : 'это победа!'}
            </h1>
            <b>{kazakh ? 'COLD BREW — 700 ₸' : 'ТВОЙ COLD BREW ЗА 700 ₸'}</b>
            <div className="event-tea-partner">
              <img src={sheckerLogo} alt="SHECKER" />
              <span>{kazakh ? 'ПЛАНШЕТТЕ ТӨЛЕ' : 'ОПЛАТИ НА ПЛАНШЕТЕ'}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

/** Repeated around the cylinder; stays in place while guest videos transition. */
export function GuestUploadQr({ divider }: { divider: number }): JSX.Element {
  return (
    <div
      className="event-guest-qr"
      style={{ gap: divider }}
      aria-label="Загрузи свой ролик на экран"
    >
      {[0, 1, 2].map((i) => (
        <div className="guest-qr-strip" key={i}>
          <div className="guest-qr-ticket">
            <img src={guestQr} alt="QR-код сайта Cannect × STEPPE FAIR" />
            <div>
              <span>CANNECT × STEPPE FAIR</span>
              <strong>
                ТВОЙ РОЛИК.
                <br />
                НА НАШЕМ ЭКРАНЕ.
              </strong>
              <p>
                Сканируй QR
                <br />и загрузи своё видео
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

/** One meme for the entire game. A separate song fully replaces embedded audio. */
function GameLive({
  name,
  language = 'ru',
  paused,
  forceMute,
  divider,
  presentation,
  discount = false
}: {
  discount?: boolean
  language?: 'ru' | 'kk'
  name: string
  paused: boolean
  forceMute: boolean
  divider: number
  presentation: GamePresentation
}): JSX.Element {
  const refs = useRef<(HTMLVideoElement | null)[]>([])
  const sound = useRef<HTMLAudioElement | null>(null)
  const kazakh = language === 'kk'
  const headline = kazakh
    ? {
        pedro: ['PEDRO', 'СЕНІ ҚОЛДАЙДЫ'],
        oiia: ['КОФЕ ҮШІН', 'АЙНАЛАМЫЗ'],
        toothless: ['ТІССІЗ', 'СЕНІҢ КОМАНДАҢДА']
      }[presentation.id]
    : presentation.headline
  const volume = presentation.volume
  useEffect(() => {
    const media = [...refs.current, sound.current]
    media.forEach((v) => {
      if (v) {
        v.volume = volume
        if (paused) v.pause()
        else
          void v
            .play()
            .catch(() => window.cannect.log('warn', 'StepFair game media playback blocked'))
      }
    })
    return () => media.forEach((v) => v?.pause())
  }, [paused, volume])
  return (
    <div
      className="event-game-live game-live-meme"
      data-game-presentation={presentation.id}
      style={{ gap: divider }}
    >
      {presentation.audioUrl && (
        <audio
          ref={sound}
          src={presentation.audioUrl}
          loop
          muted={forceMute || paused}
          preload="auto"
        />
      )}
      {[0, 1, 2].map((i) => (
        <div className="event-game-strip" key={i}>
          <video
            ref={(v) => (refs.current[i] = v)}
            src={presentation.videoUrl}
            muted={forceMute || paused || i !== 0 || !!presentation.audioUrl}
            loop
            playsInline
            onTimeUpdate={
              i === 0
                ? () => {
                    const primary = refs.current[0]
                    if (primary)
                      refs.current.slice(1).forEach((v) => {
                        if (v && Math.abs(v.currentTime - primary.currentTime) > 0.3)
                          v.currentTime = primary.currentTime
                      })
                  }
                : undefined
            }
          />
          <div className="game-live-copy">
            <div className="event-brands">
              <img
                src={discount ? sheckerLogo : steppeLogo}
                alt={discount ? 'SHECKER' : 'STEPPE FAIR'}
              />
              <img src={cannectLogo} alt="CANNECT" />
            </div>
            <span className="game-live-label">
              <i />
              {kazakh ? 'ҚАЗІР ОЙНАП ЖАТЫР' : 'СЕЙЧАС ИГРАЮТ'}
            </span>
            <h1>
              {name || (kazakh ? 'СӘТІҢДІ' : 'ПОЙМАЙ')}
              <br />
              {name ? (kazakh ? 'ОЙЫНДА!' : 'В ИГРЕ!') : kazakh ? 'ҰСТА!' : 'СВОЙ МОМЕНТ'}
            </h1>
            <div className="game-live-footer">
              <strong>
                {headline[0]}
                <br />
                {headline[1]}
              </strong>
              <span>{kazakh ? '3 БАНКА ЖИНА — КОФЕ 700 ₸' : 'СОБЕРИ 3 БАНКИ — КОФЕ ЗА 700 ₸'}</span>
              <div className="game-live-partner">
                <img src={sheckerLogo} alt="SHECKER" />
                <span>{kazakh ? 'COLD BREW · ОЙЫНСЫЗ 1500 ₸' : 'COLD BREW · 1500 ₸ БЕЗ ИГРЫ'}</span>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
