// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { Player } from '../src/renderer/src/Player'
import type { CannectBridge, PlaylistUpdate, RendererConfig } from '../src/shared/types'
const config: RendererConfig = { stationId: 'station', stripDividerPx: 20, bufferGateSec: 6 }
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
    },
    {
      videoId: 'b',
      videoTitle: 'B',
      videoUrl: 'https://example.test/b.mp4',
      localUrl: 'file:///b.mp4',
      duration: 15,
      aspectRatio: '16:9',
      source: 'smb',
      bookingId: 'booking-b'
    }
  ]
}
let emit = vi.fn()
beforeEach(() => {
  vi.useFakeTimers()
  emit = vi.fn()
  window.cannect = { sendPlaybackEvent: emit } as unknown as CannectBridge
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})
const active = (container: HTMLElement) => container.querySelector('.deck.active video')!
describe('actual media lifecycle', () => {
  it('does not emit on play request; ignores inactive/mirror/repeated playing', () => {
    const { container } = render(<Player playlist={playlist} config={config} />)
    expect(emit).not.toHaveBeenCalled()
    fireEvent.playing(container.querySelector('.deck:not(.active) video')!)
    expect(emit).not.toHaveBeenCalled()
    fireEvent.playing(active(container))
    fireEvent.playing(active(container))
    expect(emit).toHaveBeenCalledTimes(1)
    const old = active(container)
    fireEvent.ended(old)
    fireEvent.playing(old)
    fireEvent.ended(old)
    expect(emit).toHaveBeenCalledTimes(2)
    fireEvent.playing(active(container))
    expect(emit).toHaveBeenCalledTimes(3)
    expect(emit.mock.calls[2][0]).toMatchObject({ type: 'start', videoId: 'b' })
    expect(emit.mock.calls[2][0].playbackId).not.toBe(emit.mock.calls[0][0].playbackId)
  })
  it('ends original on default/placement swap and ignores old detached events', () => {
    const { container, rerender } = render(<Player playlist={playlist} config={config} />)
    const old = active(container)
    fireEvent.playing(old)
    const first = emit.mock.calls[0][0]
    rerender(<Player playlist={{ ...playlist, isDefault: true }} config={config} />)
    expect(emit.mock.calls[1][0]).toMatchObject({
      type: 'end',
      completed: false,
      playbackId: first.playbackId,
      startedAt: first.startedAt,
      isDefault: false
    })
    fireEvent.playing(old)
    fireEvent.ended(old)
    expect(emit).toHaveBeenCalledTimes(2)
    fireEvent.playing(active(container))
    expect(emit.mock.calls[2][0].isDefault).toBe(true)
  })
  it('keeps playing on identical polls; interrupts for Shecker then starts a new instance on resume', () => {
    const { container, rerender } = render(<Player playlist={playlist} config={config} />)
    fireEvent.playing(active(container))
    rerender(<Player playlist={{ ...playlist, entries: [...playlist.entries] }} config={config} />)
    expect(emit).toHaveBeenCalledTimes(1)
    rerender(<Player playlist={playlist} config={config} paused />)
    expect(emit.mock.calls[1][0]).toMatchObject({ type: 'end', completed: false })
    fireEvent.playing(active(container))
    expect(emit).toHaveBeenCalledTimes(2)
    rerender(<Player playlist={playlist} config={config} paused={false} />)
    fireEvent.playing(active(container))
    expect(emit.mock.calls[2][0].playbackId).not.toBe(emit.mock.calls[0][0].playbackId)
  })
  it('closes an errored clip and advances; clears on unmount once', () => {
    const { container, unmount } = render(<Player playlist={playlist} config={config} />)
    fireEvent.playing(active(container))
    fireEvent.error(active(container))
    expect(emit.mock.calls[1][0]).toMatchObject({
      type: 'end',
      completed: false,
      endReason: 'error'
    })
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    fireEvent.playing(active(container))
    unmount()
    expect(emit.mock.calls[3][0]).toMatchObject({ type: 'end', completed: false })
  })
  it('times out a clip that never plays without creating a phantom impression', () => {
    const { container } = render(<Player playlist={playlist} config={config} />)
    act(() => {
      vi.advanceTimersByTime(16_000)
    })
    expect(emit).not.toHaveBeenCalled()
    fireEvent.playing(active(container))
    expect(emit.mock.calls[0][0].videoId).toBe('b')
  })
  it('portrait mirrors never start or end an impression', () => {
    const portrait: PlaylistUpdate = {
      ...playlist,
      entries: [{ ...playlist.entries[0], aspectRatio: '9:16' }]
    }
    const { container } = render(<Player playlist={portrait} config={config} />)
    const videos = container.querySelectorAll('.deck.active video')
    expect(videos).toHaveLength(3)
    fireEvent.playing(videos[1])
    fireEvent.ended(videos[2])
    fireEvent.error(videos[1])
    expect(emit).not.toHaveBeenCalled()
    fireEvent.playing(videos[0])
    fireEvent.ended(videos[0])
    fireEvent.playing(active(container))
    expect(emit).toHaveBeenCalledTimes(3)
    expect(emit.mock.calls[2][0].playbackId).not.toBe(emit.mock.calls[0][0].playbackId)
  })
})
