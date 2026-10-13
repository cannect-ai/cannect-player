// Оркестратор плеера (main-процесс).
//
// Ответственность:
//   1. Периодически опрашивать /queue.
//   2. Прогревать в кэш ВЕСЬ плейлист, затем слать его renderer'у (с file:// путями).
//   3. Персистить последний реальный плейлист на диск — чтобы перезапуск во время
//      простоя бэкенда не оставлял банку без плейлиста (видео уже в кэше).
//   4. Фолбэк на дефолтные ролики, когда рекламы нет (пустая очередь, либо бэкенд
//      недоступен и нет сохранённого плейлиста).
//   5. Принимать события плейбэка от renderer и делать fan-out:
//        - cannect-web  POST /current-playback
//        - камера       POST /current-ad   (та же семантика, локально)
//        - cannect-web  POST /report       (на ended, с duration/completed/billable)
//
// Плейбэк-цикл (что играть, зацикливание, переходы) живёт в renderer — здесь только
// сеть, кэш и атрибуция.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { fetchQueue, sendCurrentPlayback, sendReport } from './api'
import { notifyCamera } from './camera'
import { VideoCache } from './cache'
import { BillableTracker } from './billable'
import { getConfig } from './config'
import { DEFAULT_VIDEOS } from './defaults'
import { log } from './logger'
import type {
  ClipStartEvent,
  PlaybackEvent,
  PlaybackEventType,
  PlaylistEntry,
  PlaylistUpdate,
  QueueItem,
  QueueResponse
} from '@shared/types'

export class Orchestrator {
  private win: BrowserWindow
  private cache = new VideoCache()
  private billable = new BillableTracker()
  private pollTimer: NodeJS.Timeout | null = null
  private cameraTimer: NodeJS.Timeout | null = null
  private lastQueueKey = ''
  private lastUpdate: PlaylistUpdate | null = null
  /** videoId → QueueItem из последнего плейлиста, чтобы обогащать события report'ом. */
  private items = new Map<string, QueueItem>()
  private activePlayback: { event: ClipStartEvent; item?: QueueItem; startedMono: number } | null =
    null
  private closedPlaybacks = new Set<string>()
  /** Файл с последним реальным плейлистом (переживает перезапуск при простое бэкенда). */
  private playlistFile = join(getConfig().cacheDir, 'last-playlist.json')

  constructor(win: BrowserWindow) {
    this.win = win
  }

  async start(): Promise<void> {
    await this.cache.init()
    this.cameraTimer = setInterval(() => this.reannounceCamera(), 5_000)
    // Дефолты всегда держим в кэше — крайний фолбэк, доступный даже офлайн с первого старта.
    void this.cache.prefetchAll(DEFAULT_VIDEOS.map((v) => v.videoUrl))
    await this.poll()
    const { pollIntervalMs } = getConfig()
    this.pollTimer = setInterval(() => void this.poll(), pollIntervalMs)
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = null
    if (this.cameraTimer) clearInterval(this.cameraTimer)
    this.cameraTimer = null
    this.interruptPlayback()
  }

  /** Сохранить последний реальный плейлист (для переживания перезапуска при простое бэкенда). */
  private persistPlaylist(qr: QueueResponse): void {
    try {
      writeFileSync(this.playlistFile, JSON.stringify(qr))
    } catch (e) {
      log('warn', `persist playlist failed: ${(e as Error).message}`)
    }
  }

  private loadPlaylist(): QueueResponse | null {
    try {
      if (existsSync(this.playlistFile)) {
        return JSON.parse(readFileSync(this.playlistFile, 'utf8')) as QueueResponse
      }
    } catch (e) {
      log('warn', `load playlist failed: ${(e as Error).message}`)
    }
    return null
  }

  /**
   * Определить, что играть: реальная очередь / сохранённый плейлист / дефолты.
   * Реальную очередь персистим на диск.
   */
  private resolvePlaylist(): Promise<{
    queue: QueueItem[]
    operating: boolean
    timezone: string
    isDefault: boolean
  }> {
    return fetchQueue().then(
      (r) => {
        if (r.queue.length > 0) {
          this.persistPlaylist(r)
          return { queue: r.queue, operating: r.operating, timezone: r.timezone, isDefault: false }
        }
        log('info', 'очередь пуста → дефолтные ролики')
        return {
          queue: DEFAULT_VIDEOS,
          operating: r.operating,
          timezone: r.timezone,
          isDefault: true
        }
      },
      (err) => {
        log('error', `queue poll failed: ${(err as Error).message}`)
        const persisted = this.loadPlaylist()
        if (persisted && persisted.queue.length > 0) {
          log('info', `бэкенд недоступен → сохранённый плейлист (${persisted.queue.length})`)
          return {
            queue: persisted.queue,
            operating: persisted.operating,
            timezone: persisted.timezone,
            isDefault: false
          }
        }
        log('info', 'бэкенд недоступен и плейлиста нет → дефолтные ролики')
        return { queue: DEFAULT_VIDEOS, operating: false, timezone: 'Asia/Almaty', isDefault: true }
      }
    )
  }

  /** Один цикл опроса: resolve → прогрев кэша → отправка плейлиста renderer'у. */
  private async poll(): Promise<void> {
    const { queue, operating, timezone, isDefault } = await this.resolvePlaylist()

    // Запоминаем элементы для report по videoId.
    this.items.clear()
    for (const it of queue) this.items.set(this.placementKey(it), it)

    // Прогреваем нужные ролики.
    const urls = queue.map((q) => q.videoUrl)
    const cached = await this.cache.prefetchAll(urls)

    // Чистим кэш, но НИКОГДА не удаляем дефолты и сохранённый реальный плейлист
    // (иначе при временном переключении на дефолты потеряли бы рекламу из кэша).
    const persisted = this.loadPlaylist()
    const keep = new Set<string>([
      ...urls,
      ...DEFAULT_VIDEOS.map((v) => v.videoUrl),
      ...(persisted?.queue.map((q) => q.videoUrl) ?? [])
    ])
    void this.cache.cleanup([...keep])

    const entries: PlaylistEntry[] = queue.map((q) => ({
      ...q,
      localUrl: cached.get(q.videoUrl) ?? null
    }))

    const update: PlaylistUpdate = { entries, operating, timezone, isDefault }
    this.lastUpdate = update

    // Шлём в renderer только если плейлист реально изменился (или это первый раз).
    const key = JSON.stringify([
      isDefault,
      ...entries.map((e) => [
        e.videoId,
        e.localUrl,
        e.campaignId,
        e.bookingId,
        e.duration,
        e.aspectRatio
      ])
    ])
    if (key !== this.lastQueueKey) {
      this.lastQueueKey = key
      this.send(update)
      log(
        'info',
        `playlist updated: ${entries.length} item(s), default=${isDefault}, operating=${operating}`
      )
    }
  }

  /**
   * Повторно отдать renderer'у то, что уже известно.
   *
   * Плейлист уходит только при изменении, поэтому окно, подключившееся позже
   * первой отправки, не получит его никогда и застынет на "загрузка
   * плейлиста…". Так и случилось на ALM-002. Тот же путь проходит окно после
   * перезагрузки, которой мы теперь лечим падение рендерера, — без этого
   * лечение оборачивалось бы вечным чёрным экраном.
   */
  resendPlaylist(): void {
    if (!this.lastUpdate) return
    log('info', 'повторная отправка плейлиста в окно')
    this.send(this.lastUpdate)
  }

  private send(update: PlaylistUpdate): void {
    if (!this.win.isDestroyed()) this.win.webContents.send('playlist:update', update)
  }

  private placementKey(item: Pick<QueueItem, 'videoId' | 'campaignId' | 'bookingId'>): string {
    return JSON.stringify([item.videoId, item.campaignId, item.bookingId])
  }

  /** Recover attribution after a local camera restart. Same identity/start and
   * duration: retrying cannot extend the camera receiver's original expiry. */
  private reannounceCamera(): void {
    const source = this.activePlayback?.event
    if (!source || Date.now() >= Date.parse(source.startedAt) + source.expectedDuration * 1000)
      return
    notifyCamera({
      event: 'playback_started',
      playbackId: source.playbackId,
      campaignId: source.campaignId,
      bookingId: source.bookingId,
      videoId: source.videoId,
      isDefault: source.isDefault,
      startedAt: source.startedAt,
      expectedDuration: source.expectedDuration
    })
  }

  /** Main survives renderer crashes/reloads; never leave its last ad active. */
  interruptPlayback(reason: 'interrupted' | 'error' = 'interrupted'): void {
    const active = this.activePlayback
    if (!active) return
    this.handlePlaybackEvent({
      ...active.event,
      type: 'end',
      completed: false,
      endReason: reason,
      endedAt: new Date().toISOString(),
      playedDurationSec: Math.max(0, (performance.now() - active.startedMono) / 1000)
    })
  }

  /** One canonical session fans out to both sinks. A late end/duplicate IPC from
   * an old deck cannot clear the new ad or create a second billable report. */
  handlePlaybackEvent(ev: PlaybackEvent): void {
    if (!ev || typeof ev.playbackId !== 'string' || !ev.playbackId || ev.playbackId.length > 128)
      return
    if (ev.type === 'start') {
      if (
        this.closedPlaybacks.has(ev.playbackId) ||
        this.activePlayback?.event.playbackId === ev.playbackId
      )
        return
      const started = Date.parse(ev.startedAt)
      if (
        !Number.isFinite(started) ||
        started > Date.now() + 5_000 ||
        !Number.isFinite(ev.expectedDuration) ||
        ev.expectedDuration <= 0 ||
        ev.expectedDuration > 86_400
      )
        return
      if (this.activePlayback && started < Date.parse(this.activePlayback.event.startedAt)) return
      this.interruptPlayback()
      this.activePlayback = {
        event: { ...ev },
        item: this.items.get(this.placementKey(ev)),
        startedMono: performance.now()
      }
      const event: PlaybackEventType = ev.isFirst ? 'playback_started' : 'playback_changed'
      const payload = {
        event,
        playbackId: ev.playbackId,
        campaignId: ev.campaignId,
        bookingId: ev.bookingId,
        videoId: ev.videoId,
        videoTitle: ev.videoTitle,
        expectedDuration: ev.expectedDuration,
        isDefault: ev.isDefault,
        startedAt: ev.startedAt
      }
      void sendCurrentPlayback(payload)
      // Explicit defaults clear paid context immediately. Receivers also expire
      // a lost terminal event at startedAt + expectedDuration.
      notifyCamera(payload)
      return
    }
    const active = this.activePlayback
    if (ev.type !== 'end' || !active || active.event.playbackId !== ev.playbackId) return
    this.activePlayback = null
    this.closedPlaybacks.add(ev.playbackId)
    if (this.closedPlaybacks.size > 256)
      this.closedPlaybacks.delete(this.closedPlaybacks.values().next().value!)
    const source = active.event
    const payload = {
      event: 'playback_ended' as const,
      playbackId: source.playbackId,
      campaignId: source.campaignId,
      bookingId: source.bookingId,
      videoId: source.videoId,
      videoTitle: source.videoTitle,
      expectedDuration: source.expectedDuration,
      isDefault: source.isDefault,
      startedAt: source.startedAt
    }
    void sendCurrentPlayback(payload)
    notifyCamera(payload)
    // /report counts bonus plays even for incomplete payloads. Only completed
    // clips belong in billing; interruptions still clear both analytics sinks.
    if (!source.isDefault && ev.completed) {
      void sendReport({
        playbackId: source.playbackId,
        videoId: source.videoId,
        campaignId: source.campaignId,
        bookingId: source.bookingId,
        timestamp: source.startedAt,
        duration: source.expectedDuration,
        completed: ev.completed,
        billable: active.item ? this.billable.register(active.item, source.startedAt) : true
      })
    }
  }
}
