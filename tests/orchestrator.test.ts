import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import type { ClipEndEvent, ClipStartEvent, QueueItem } from '../src/shared/types'
const mocks = vi.hoisted(() => ({
  camera: vi.fn(),
  current: vi.fn(),
  report: vi.fn(),
  config: { cacheDir: '/unused', pollIntervalMs: 60_000 }
}))
vi.mock('../src/main/camera', () => ({ notifyCamera: mocks.camera }))
vi.mock('../src/main/api', () => ({
  fetchQueue: vi.fn(),
  sendCurrentPlayback: mocks.current,
  sendReport: mocks.report
}))
vi.mock('../src/main/config', () => ({ getConfig: () => mocks.config }))
vi.mock('../src/main/logger', () => ({ log: vi.fn() }))
vi.mock('../src/main/cache', () => ({ VideoCache: class {} }))
import { Orchestrator } from '../src/main/orchestrator'
const start = (id = 'instance-a', extra: Partial<ClipStartEvent> = {}): ClipStartEvent => ({
  type: 'start',
  playbackId: id,
  videoId: 'video-a',
  videoTitle: 'A',
  bookingId: 'booking-a',
  expectedDuration: 15,
  isDefault: false,
  isFirst: true,
  startedAt: new Date().toISOString(),
  ...extra
})
const end = (event: ClipStartEvent, completed = true): ClipEndEvent => ({
  ...event,
  type: 'end',
  completed,
  endedAt: new Date().toISOString(),
  playedDurationSec: completed ? 15 : 3,
  endReason: completed ? 'completed' : 'interrupted'
})
beforeEach(() => {
  vi.clearAllMocks()
})
describe('one canonical playback fans out to analytics and completed billing', () => {
  it('notifies both sinks for start/default/end using same ID and original timestamp', () => {
    const o = new Orchestrator({} as BrowserWindow),
      a = start()
    o.handlePlaybackEvent(a)
    o.handlePlaybackEvent(end(a))
    expect(mocks.camera.mock.calls.map((c) => c[0].event)).toEqual([
      'playback_started',
      'playback_ended'
    ])
    expect(mocks.camera.mock.calls[1][0]).toMatchObject({
      playbackId: a.playbackId,
      startedAt: a.startedAt
    })
    expect(mocks.current).toHaveBeenCalledTimes(2)
    expect(mocks.report).toHaveBeenCalledTimes(1)
    const d = start('default', { videoId: 'default-1', bookingId: undefined, isDefault: true })
    o.handlePlaybackEvent(d)
    o.handlePlaybackEvent(end(d))
    expect(mocks.camera.mock.calls[2][0]).toMatchObject({ isDefault: true, videoId: 'default-1' })
    expect(mocks.report).toHaveBeenCalledTimes(1)
  })
  it('rejects duplicate/stale terminals and never bills an interrupted clip', () => {
    const o = new Orchestrator({} as BrowserWindow),
      a = start(),
      b = start('instance-b')
    o.handlePlaybackEvent(a)
    o.handlePlaybackEvent(a)
    o.handlePlaybackEvent(b)
    expect(mocks.camera.mock.calls.map((c) => c[0].event)).toEqual([
      'playback_started',
      'playback_ended',
      'playback_started'
    ])
    o.handlePlaybackEvent(end(a))
    o.handlePlaybackEvent(a)
    expect(mocks.camera).toHaveBeenCalledTimes(3)
    expect(mocks.report).not.toHaveBeenCalled()
    o.handlePlaybackEvent(end(b))
    o.handlePlaybackEvent(end(b))
    expect(mocks.report).toHaveBeenCalledTimes(1)
  })
  it('main clears a crashed renderer exactly once with canonical placement', () => {
    const o = new Orchestrator({} as BrowserWindow),
      a = start()
    o.handlePlaybackEvent(a)
    o.interruptPlayback('error')
    o.stop()
    expect(mocks.camera.mock.calls[1][0]).toMatchObject({
      event: 'playback_ended',
      playbackId: a.playbackId,
      bookingId: a.bookingId,
      startedAt: a.startedAt
    })
    expect(mocks.report).not.toHaveBeenCalled()
    expect(mocks.camera).toHaveBeenCalledTimes(2)
  })
  it('snapshots the placement quota at start, before a queue refresh changes it', () => {
    const o = new Orchestrator({} as BrowserWindow),
      a = start()
    const internals = o as unknown as { items: Map<string, QueueItem> }
    const item: QueueItem = {
      videoId: a.videoId,
      bookingId: a.bookingId,
      videoTitle: 'A',
      videoUrl: 'a.mp4',
      duration: 15,
      aspectRatio: '16:9',
      source: 'smb',
      showsPerHour: 0
    }
    internals.items.set(JSON.stringify([a.videoId, undefined, a.bookingId]), item)
    o.handlePlaybackEvent(a)
    internals.items.clear()
    o.handlePlaybackEvent(end(a))
    expect(mocks.report.mock.calls[0][0]).toMatchObject({ bookingId: 'booking-a', billable: false })
  })
  it('reannounces only the live instance with its original expiry', () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-10-13T10:00:00Z')
    try {
      const o = new Orchestrator({} as BrowserWindow),
        a = start()
      o.handlePlaybackEvent(a)
      const reannounce = () => (o as unknown as { reannounceCamera(): void }).reannounceCamera()
      vi.advanceTimersByTime(5000)
      reannounce()
      expect(mocks.camera.mock.calls[1][0]).toMatchObject({
        playbackId: a.playbackId,
        startedAt: a.startedAt,
        expectedDuration: 15
      })
      vi.advanceTimersByTime(10000)
      reannounce()
      expect(mocks.camera).toHaveBeenCalledTimes(2)
      o.interruptPlayback()
      reannounce()
      expect(mocks.camera).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })
})
