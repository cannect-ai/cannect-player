import { useEffect, useState } from 'react'
import type { PlaylistUpdate, ProvisioningStatus, RendererConfig } from '@shared/types'
import { Player } from './Player'
import { EventPlayer } from './EventPlayer'
import type { EventState } from '@shared/types'
import { Wizard } from './Wizard'

export function App(): JSX.Element {
  const [eventState, setEventState] = useState<EventState | null>(null)
  const [status, setStatus] = useState<ProvisioningStatus | null>(null)
  const [provisioned, setProvisioned] = useState(false)
  const [config, setConfig] = useState<RendererConfig | null>(null)
  const [playlist, setPlaylist] = useState<PlaylistUpdate | null>(null)

  useEffect(() => {
    void window.cannect.getProvisioningStatus().then((s) => {
      setStatus(s)
      setProvisioned(s.provisioned)
    })
    const off = window.cannect.onPlaylist(setPlaylist)
    const offEvent = window.cannect.onEventState(setEventState)
    void window.cannect.getEventState().then((s) => {
      if (s) setEventState(s)
    })
    return () => {
      off()
      offEvent()
    }
  }, [])

  // Конфиг (со stationId) грузим только когда станция настроена.
  useEffect(() => {
    if (provisioned) void window.cannect.getConfig().then(setConfig)
  }, [provisioned])

  if (!status) return <div className="status">инициализация…</div>

  // Станция не настроена → мастер первого запуска.
  if (!provisioned) return <Wizard status={status} onDone={() => setProvisioned(true)} />

  if (!config) return <div className="status">инициализация…</div>

  if (config.eventMode && config.eventQueueMode !== 'cannect')
    return eventState ? (
      <EventPlayer config={config} state={eventState} />
    ) : (
      <div className="status">Подключаем игру…</div>
    )

  if (config.eventMode && config.eventQueueMode === 'cannect' && playlist)
    return (
      <EventPlayer
        config={config}
        state={eventState ?? { entries: [], publicUrl: '', activeGame: null, celebration: null }}
        fleetPlaylist={playlist}
      />
    )

  const playable = playlist?.entries.filter((e) => e.localUrl) ?? []
  if (playable.length === 0) {
    return (
      <div className="status">
        {playlist ? 'нет прогретого контента — ожидание…' : 'загрузка плейлиста…'}
      </div>
    )
  }

  return <Player config={config} playlist={playlist!} />
}
