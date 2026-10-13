// Общие типы — контракт между main / preload / renderer.
// Поля основаны на API cannect-web (см. CLAUDE.md) и камеры (current-ad).

export type AspectRatio = '16:9' | '9:16'
export type VideoSource = 'smb' | 'agency' | 'event'

/** Элемент плейлиста, как его отдаёт GET /api/stations/<id>/queue → data.queue[]. */
export interface QueueItem {
  videoId: string
  videoTitle: string
  videoUrl: string
  duration: number // секунды
  aspectRatio: AspectRatio
  source: VideoSource
  campaignId?: string
  bookingId?: string
  /** Сколько раз за час этот ролик должен быть оплачиваемым (бонус-петли сверх — billable:false). */
  showsPerHour?: number
}

/** Ответ GET /api/stations/<id>/queue → data. */
export interface QueueResponse {
  queue: QueueItem[]
  operating: boolean // в рабочих ли часах сейчас
  timezone: string
}

/** Элемент плейлиста, обогащённый локальным путём из кэша (main → renderer). */
export interface PlaylistEntry extends QueueItem {
  /** file:// URL прогретого в кэше файла, либо null если ещё качается / не удалось. */
  localUrl: string | null
}

export interface PlaylistUpdate {
  entries: PlaylistEntry[]
  operating: boolean
  timezone: string
  /** Дефолтный (заглушка) плейбэк — когда очередь пуста или вне рабочих часов. */
  isDefault: boolean
}

/** Имена событий в проводе cannect-web /current-playback и камеры /current-ad. */
export type PlaybackEventType = 'playback_started' | 'playback_changed' | 'playback_ended'

interface ClipRef {
  /** Identity of one actual playback, shared by both sinks and its terminal. */
  playbackId: string
  videoId: string
  videoTitle: string
  campaignId?: string
  bookingId?: string
  expectedDuration: number
  startedAt: string // ISO-8601 момента старта показа
  isDefault: boolean
}

/** Клип начал играть. main: current-playback (started если isFirst, иначе changed) + камера. */
export interface ClipStartEvent extends ClipRef {
  type: 'start'
  /** Первый клип после загрузки плейлиста → playback_started; иначе playback_changed. */
  isFirst: boolean
}

/** Клип доиграл/прервался. main: /report. */
export interface ClipEndEvent extends ClipRef {
  type: 'end'
  completed: boolean // доиграл до конца
  endedAt: string
  playedDurationSec: number
  endReason: 'completed' | 'interrupted' | 'error'
}

/** Внутреннее событие renderer → main. */
export type PlaybackEvent = ClipStartEvent | ClipEndEvent

/** Состояние провижининга станции (для мастера первого запуска). */
export interface ProvisioningStatus {
  /** Заданы ли STATION_ID и STATION_TOKEN. Если нет — показываем мастер. */
  provisioned: boolean
  /** Установлен ли на банке модуль cannect-camera. */
  cameraInstalled: boolean
  /** Индексы /dev/video* — подсказка по числу подключённых камер. */
  detectedCameras: number[]
}

/** Ввод мастера первого запуска. */
export interface ProvisionInput {
  stationId: string
  stationToken: string
  /** Число камер; -1 = «Пропустить» (не трогать число камер у камеры). */
  cameraCount: number
}

/** Результат провижининга. */
export interface ProvisionOutcome {
  ok: boolean
  cameraEnv?: { ok: boolean; reason?: string }
  cameraRestart?: { ok: boolean; reason?: string }
}

/** API, доступное в renderer через preload (window.cannect). */
export interface EventScene {
  id: string
  name: string
  campaign?: string
  language?: 'ru' | 'kk'
  videoUrl?: string
  overlayUrl?: string
  localUrl?: string
  localOverlayUrl?: string
}
export interface EventState {
  campaign?: string
  activeGame?: (EventScene & { seenAt: number }) | null
  entries: PlaylistEntry[]
  publicUrl: string
  celebration: (EventScene & { entry: PlaylistEntry; expiresAt?: number }) | null
}
export type EventPlayback =
  | { type: 'playing'; videoId: string; nextId: string | null; round: number; started: number }
  | {
      type: 'celebration'
      id: string
      action: 'started' | 'completed' | 'failed'
      manualClose?: boolean
    }
export interface GameFeedback {
  id: number
  created: number
  gameId: string
  kind: 'start' | 'count' | 'move' | 'bounce' | 'catch' | 'miss' | 'win' | 'loss'
  collected?: number
  score: number
  misses: number
  lane: number
}
export interface CannectBridge {
  onGameFeedback(cb: (event: GameFeedback) => void): () => void
  getEventState(): Promise<EventState | null>
  onEventState(cb: (state: EventState) => void): () => void
  sendEventPlayback(ev: EventPlayback): void
  getConfig(): Promise<RendererConfig>
  onPlaylist(cb: (playlist: PlaylistUpdate) => void): () => void
  sendPlaybackEvent(ev: PlaybackEvent): void
  log(level: 'info' | 'warn' | 'error', message: string): void
  // --- Мастер первого запуска ---
  getProvisioningStatus(): Promise<ProvisioningStatus>
  provision(input: ProvisionInput): Promise<ProvisionOutcome>
}

/** Безопасный для renderer срез конфига (без секретов). */
export interface RendererConfig {
  muteAudio?: boolean
  eventMode?: boolean
  eventQueueMode?: 'cannect' | 'event'
  stationId: string
  stripDividerPx: number
  bufferGateSec: number
}
