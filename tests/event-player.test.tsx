// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type { CannectBridge, EventState, PlaylistUpdate } from '../src/shared/types'
vi.mock('../src/renderer/src/GameEffects', () => ({
  GameEffects: () => null,
  audioPreference: () => false
}))
import { EventPlayer } from '../src/renderer/src/EventPlayer'
import { DigitalBridgeStage } from '../src/renderer/src/DigitalBridgeStage'
const playlist: PlaylistUpdate = {
  isDefault: false,
  operating: true,
  timezone: 'Asia/Almaty',
  entries: [
    {
      videoId: 'a',
      videoTitle: 'A',
      videoUrl: 'https://example.test/a.mp4',
      localUrl: 'file:///a.mp4',
      duration: 15,
      aspectRatio: '16:9',
      source: 'smb',
      bookingId: 'booking-a'
    }
  ]
}
const config = {
  stationId: 'station',
  stripDividerPx: 20,
  bufferGateSec: 6,
  eventMode: true,
  eventQueueMode: 'cannect' as const
}
const idle: EventState = {
  campaign: 'alm002-shecker',
  entries: [],
  publicUrl: '',
  activeGame: null,
  celebration: null
}
const emit = vi.fn(),
  eventEmit = vi.fn()
beforeEach(() => {
  vi.useFakeTimers()
  emit.mockClear()
  eventEmit.mockClear()
  window.cannect = {
    sendPlaybackEvent: emit,
    sendEventPlayback: eventEmit,
    onGameFeedback: () => () => {},
    log: vi.fn()
  } as unknown as CannectBridge
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})
it('Shecker overlays interrupt the real paid session and resume only after actual playing', () => {
  const { container, rerender } = render(
    <EventPlayer state={idle} config={config} fleetPlaylist={playlist} />
  )
  fireEvent.playing(container.querySelector('.deck.active video')!)
  const original = emit.mock.calls[0][0]
  const game: EventState = {
    ...idle,
    activeGame: { id: 'game', name: 'Алия', language: 'kk', seenAt: Date.now() }
  }
  rerender(<EventPlayer state={game} config={config} fleetPlaylist={playlist} />)
  expect(emit.mock.calls[1][0]).toMatchObject({
    type: 'end',
    playbackId: original.playbackId,
    startedAt: original.startedAt,
    completed: false
  })
  expect(container.textContent).toContain('ОЙЫНДА!')
  act(() => {
    vi.advanceTimersByTime(5000)
  })
  expect(eventEmit).not.toHaveBeenCalled()
  fireEvent.playing(container.querySelector('.deck.active video')!)
  expect(emit).toHaveBeenCalledTimes(2)
  rerender(<EventPlayer state={idle} config={config} fleetPlaylist={playlist} />)
  fireEvent.playing(container.querySelector('.deck.active video')!)
  expect(emit.mock.calls[2][0].playbackId).not.toBe(original.playbackId)
})
it('Shecker victory is non-looping, acknowledged once, and releases the paid playlist', () => {
  const state: EventState = {
    ...idle,
    celebration: {
      id: 'gift',
      name: 'Алия',
      language: 'kk',
      expiresAt: Date.now() + 35000,
      entry: playlist.entries[0]
    }
  }
  const { container } = render(
    <EventPlayer state={state} config={config} fleetPlaylist={playlist} />
  )
  const victory = container.querySelector('.event-celebration video') as HTMLVideoElement
  expect(victory.loop).toBe(false)
  fireEvent.playing(victory)
  fireEvent.playing(victory)
  expect(eventEmit).toHaveBeenCalledTimes(1)
  expect(eventEmit.mock.calls[0][0]).toMatchObject({
    id: 'gift',
    action: 'started',
    manualClose: false
  })
  fireEvent.ended(victory)
  expect(eventEmit.mock.calls[1][0]).toMatchObject({
    id: 'gift',
    action: 'completed',
    manualClose: false
  })
  expect(container.querySelector('.event-celebration')).toBeNull()
  fireEvent.playing(container.querySelector('.deck.active video')!)
  expect(emit.mock.calls[0][0].type).toBe('start')
})
it('Digital Bridge acknowledges all three ready videos and overlays, never a partially visible gift', () => {
  const { container } = render(
    <DigitalBridgeStage
      name="Test"
      scene={{
        id: 'gift',
        name: 'Test',
        localUrl: 'file:///game.mp4',
        localOverlayUrl: 'file:///overlay.png'
      }}
      giftId="gift"
      divider={20}
      forceMute
    />
  )
  const videos = container.querySelectorAll('video'),
    images = container.querySelectorAll('img')
  videos.forEach((video) => fireEvent.playing(video))
  fireEvent.load(images[0])
  fireEvent.load(images[1])
  expect(eventEmit).not.toHaveBeenCalled()
  fireEvent.load(images[2])
  fireEvent.playing(videos[2])
  expect(eventEmit).toHaveBeenCalledTimes(1)
  expect(eventEmit.mock.calls[0][0]).toMatchObject({
    id: 'gift',
    action: 'started',
    manualClose: true
  })
})
