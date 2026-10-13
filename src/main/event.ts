import type { BrowserWindow } from 'electron'
import WebSocket from 'ws'
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { VideoCache } from './cache'
import { getConfig } from './config'
import { log } from './logger'
import type {
  EventState,
  EventPlayback,
  EventScene,
  PlaybackEvent,
  PlaylistEntry,
  QueueItem
} from '@shared/types'

type Reply = {
  campaign?: string
  media_revision?: string
  assets?: string[]
  active_game?: EventScene | null
  queue: QueueItem[]
  celebration:
    | (EventScene & { videoUrl: string; duration: number; failure_remaining_ms?: number | null })
    | null
  public_url: string
}
class EventRequestError extends Error {
  constructor(readonly status: number) {
    super(`Event API ${status}`)
  }
}
/** Opt-in event transport. No advertising billing or campaign endpoints. */
export class EventOrchestrator {
  private feedbackSocket: WebSocket | null = null
  private feedbackCursor = 0
  private cache: VideoCache
  private timer: NodeJS.Timeout | null = null
  private polling = false
  private flushing = false
  private warming = false
  private state: EventState | null = null
  private outbox: EventPlayback[] = []
  private stopped = false
  private lastQueue = ''
  private mediaRevision = ''
  private mediaWarming = false
  private metadata: string
  constructor(private win: BrowserWindow) {
    const dir = getConfig().eventCacheDir
    mkdirSync(dir, { recursive: true })
    this.metadata = dir
    this.cache = new VideoCache(join(dir, 'videos'))
    try {
      this.state = JSON.parse(readFileSync(join(dir, 'playlist.json'), 'utf8')) as EventState
      if (this.state) {
        this.state.celebration = null
        this.state.activeGame = null
      }
    } catch {}
    try {
      this.outbox = JSON.parse(readFileSync(join(dir, 'outbox.json'), 'utf8')) as EventPlayback[]
    } catch {}
  }
  get snapshot(): EventState | null {
    return this.state
  }
  private persist(name: string, value: unknown): void {
    const dest = join(this.metadata, name)
    writeFileSync(dest + '.tmp', JSON.stringify(value), { mode: 0o600 })
    renameSync(dest + '.tmp', dest)
  }
  private async request(path: string, body?: unknown): Promise<unknown> {
    const cfg = getConfig()
    const res = await fetch(cfg.eventApiBase + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        'X-Player-Key': cfg.eventPlayerKey,
        Authorization: 'Bearer ' + cfg.eventPlayerKey,
        'Content-Type': 'application/json',
        'X-Cannect-Media': this.mediaRevision
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(8000)
    })
    if (!res.ok) throw new EventRequestError(res.status)
    return res.json()
  }
  async start(): Promise<void> {
    await this.cache.init()
    this.resendPlaylist()
    void this.listenFeedback()
    void this.poll()
    this.timer = setInterval(() => void this.poll(), 2000)
  }
  stop(): void {
    this.stopped = true
    this.feedbackSocket?.terminate()
    if (this.timer) clearInterval(this.timer)
  }
  resendPlaylist(): void {
    if (this.state && !this.win.isDestroyed()) this.win.webContents.send('event:update', this.state)
  }
  handlePlaybackEvent(_event: PlaybackEvent): void {}
  interruptPlayback(_reason: 'interrupted' | 'error' = 'interrupted'): void {}
  handleEvent(ev: EventPlayback): void {
    if (ev.type === 'playing') {
      void this.request('/api/player/playback', {
        video_id: ev.videoId,
        next_id: ev.nextId,
        round: ev.round,
        started: ev.started
      }).catch(() => {})
    } else {
      if (
        !this.outbox.some(
          (e) => e.type === 'celebration' && e.id === ev.id && e.action === ev.action
        )
      ) {
        this.outbox.push(ev)
        this.persist('outbox.json', this.outbox)
      }
      void this.poll()
    }
  }
  acknowledgeFeedback(id: number): void {
    if (!Number.isSafeInteger(id) || id < 0) return
    this.feedbackCursor = Math.max(this.feedbackCursor, id)
    if (this.feedbackSocket?.readyState === WebSocket.OPEN)
      this.feedbackSocket.send(JSON.stringify({ type: 'ack', id }))
  }
  private async listenFeedback(): Promise<void> {
    while (!this.stopped) {
      await new Promise<void>((resolve) => {
        const cfg = getConfig(),
          url = new URL(cfg.eventApiBase + '/api/player/events/ws')
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
        const socket = new WebSocket(url, { handshakeTimeout: 8000, maxPayload: 8192 })
        this.feedbackSocket = socket
        let received = Date.now()
        const watchdog = setInterval(() => {
          if (Date.now() - received > 25000) socket.terminate()
        }, 5000)
        socket.on('open', () =>
          socket.send(
            JSON.stringify({ type: 'hello', key: cfg.eventPlayerKey, after: this.feedbackCursor })
          )
        )
        socket.on('message', (raw) => {
          received = Date.now()
          try {
            const data = JSON.parse(raw.toString())
            if (data.type === 'ready') log('info', 'StepFair WebSocket connected')
            else if (data.type === 'ping') socket.send(JSON.stringify({ type: 'pong' }))
            else if (data.type === 'feedback') {
              const event = data.event
              if (!event || !Number.isSafeInteger(event.id)) return
              if (event.id <= this.feedbackCursor) {
                this.acknowledgeFeedback(event.id)
                return
              }
              if (!this.win.isDestroyed()) this.win.webContents.send('event:feedback', event)
              if (event.kind === 'win' || event.kind === 'loss') {
                log('info', `StepFair WebSocket sound received: ${event.kind} #${event.id}`)
                void this.poll()
              }
            }
          } catch {
            socket.terminate()
          }
        })
        socket.on('error', () => {})
        socket.once('close', () => {
          clearInterval(watchdog)
          if (this.feedbackSocket === socket) this.feedbackSocket = null
          resolve()
        })
      })
      if (!this.stopped) {
        log('warn', 'StepFair WebSocket interrupted; reconnecting')
        await new Promise((r) => setTimeout(r, 1200))
      }
    }
  }
  private async poll(): Promise<void> {
    if (this.polling || this.stopped) return
    this.polling = true
    // A stale or offline acknowledgement must never block fresh state,
    // including the tablet's command to stop the victory soundtrack.
    void this.flushOutbox()
    try {
      const reply = (await this.request('/api/player/state')) as Reply
      if (
        reply.media_revision &&
        reply.media_revision !== this.mediaRevision &&
        !this.mediaWarming
      ) {
        this.mediaWarming = true
        const revision = reply.media_revision
        const assets = [
          ...(reply.assets ?? []),
          ...(getConfig().eventQueueMode === 'event'
            ? reply.queue.filter((e) => e.videoId.startsWith('event-intro')).map((e) => e.videoUrl)
            : [])
        ]
        void this.cache
          .prefetchAll(assets, 2)
          .then((cached) => {
            if (assets.length && assets.every((url) => cached.get(url)))
              this.mediaRevision = revision
          })
          .finally(() => (this.mediaWarming = false))
      }
      let celebration: EventState['celebration'] = null
      if (reply.celebration) {
        const c = reply.celebration
        const expiresAt = Date.now() + Math.max(0, Math.min(35000, c.failure_remaining_ms ?? 35000))
        const url = await this.cache.ensure(c.videoUrl)
        const overlay = c.overlayUrl ? await this.cache.ensure(c.overlayUrl) : undefined
        celebration = {
          ...c,
          localOverlayUrl: overlay,
          expiresAt,
          entry: {
            videoId: 'celebration-' + c.id,
            videoTitle: c.name,
            videoUrl: c.videoUrl,
            localUrl: url,
            duration: c.duration,
            aspectRatio: '9:16',
            source: 'event'
          }
        }
      }
      const raw = reply.active_game
      const activeGame = raw
        ? {
            ...raw,
            seenAt: Date.now(),
            localUrl: raw.videoUrl ? await this.cache.ensure(raw.videoUrl) : undefined,
            localOverlayUrl: raw.overlayUrl ? await this.cache.ensure(raw.overlayUrl) : undefined
          }
        : null
      if (getConfig().eventQueueMode === 'cannect') {
        this.state = {
          entries: [],
          campaign: reply.campaign,
          publicUrl: reply.public_url,
          celebration,
          activeGame
        }
        this.resendPlaylist()
        return
      }
      if (this.state) {
        this.state = { ...this.state, campaign: reply.campaign, celebration, activeGame }
        this.resendPlaylist()
      }
      const key = JSON.stringify(reply.queue.map((e) => [e.videoId, e.videoUrl]))
      if (key !== this.lastQueue && !this.warming) {
        this.warming = true
        void this.warm(reply, key, celebration, activeGame).finally(() => (this.warming = false))
      }
    } catch (e) {
      log('warn', `StepFair connection: ${(e as Error).message}`)
    } finally {
      this.polling = false
    }
  }
  private async flushOutbox(): Promise<void> {
    if (this.flushing || this.stopped) return
    this.flushing = true
    try {
      while (this.outbox.length && !this.stopped) {
        const ev = this.outbox[0]
        try {
          if (ev.type === 'celebration')
            await this.request('/api/player/celebrations/' + encodeURIComponent(ev.id), {
              action: ev.action,
              manual_close: ev.manualClose ?? false
            })
        } catch (e) {
          // Retry connectivity/auth/rate-limit failures. Discard only events
          // the server permanently rejected (e.g. an obsolete gift ID).
          if (!(e instanceof EventRequestError) || ![400, 404, 409, 410, 422].includes(e.status))
            return
          log('warn', `StepFair acknowledgement discarded: ${e.message}`)
        }
        this.outbox.shift()
        this.persist('outbox.json', this.outbox)
      }
    } finally {
      this.flushing = false
    }
  }
  private async warm(
    reply: Reply,
    key: string,
    celebration: EventState['celebration'],
    activeGame: EventState['activeGame']
  ): Promise<void> {
    const cached = await this.cache.prefetchAll(
      reply.queue.map((e) => e.videoUrl),
      2
    )
    if (this.stopped) return
    // Do not switch a round to a partially downloaded queue.
    if (reply.queue.some((e) => !cached.get(e.videoUrl))) return
    const entries: PlaylistEntry[] = reply.queue.map((e) => ({
      ...e,
      localUrl: cached.get(e.videoUrl)!
    }))
    this.state = {
      entries,
      campaign: reply.campaign,
      publicUrl: reply.public_url,
      activeGame: this.state ? this.state.activeGame : activeGame,
      celebration: this.state ? this.state.celebration : celebration
    }
    this.lastQueue = key
    this.persist('playlist.json', { ...this.state, celebration: null, activeGame: null })
    this.resendPlaylist()
  }
}
