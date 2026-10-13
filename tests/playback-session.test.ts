import { describe, expect, it } from 'vitest'
import { PlaybackSession } from '../src/shared/playbackSession'
import type { PlaybackEvent, PlaylistEntry } from '../src/shared/types'
const clip: PlaylistEntry = {
  videoId: 'video',
  videoTitle: 'Clip',
  videoUrl: 'https://example.test/a.mp4',
  localUrl: 'file:///a.mp4',
  duration: 15,
  aspectRatio: '16:9',
  source: 'smb',
  bookingId: 'booking'
}
describe('one actual playback instance', () => {
  it('ignores repeated playing, preserves start and ID, terminates once', () => {
    const events: PlaybackEvent[] = []
    let mono = 1000,
      wall = '2026-10-13T10:00:00.000Z',
      next = 0
    const session = new PlaybackSession(
      (e) => events.push(e),
      () => mono,
      () => wall,
      () => `instance-${++next}`
    )
    session.end(false)
    expect(events).toHaveLength(0)
    session.start(clip, false, true)
    mono += 5000
    wall = '2026-10-13T10:00:05.000Z'
    session.start(clip, false, false)
    session.end(false)
    session.end(true)
    expect(events).toHaveLength(2)
    expect(events[1]).toMatchObject({
      type: 'end',
      playbackId: 'instance-1',
      startedAt: '2026-10-13T10:00:00.000Z',
      endedAt: wall,
      playedDurationSec: 5,
      completed: false
    })
    session.start(clip, false, false)
    expect(events[2]).toMatchObject({ playbackId: 'instance-2', startedAt: wall })
  })
  it('preserves a default or original placement when the next playlist changes', () => {
    const events: PlaybackEvent[] = []
    const session = new PlaybackSession(
      (e) => events.push(e),
      () => 0,
      () => '2026-10-13T10:00:00Z',
      () => 'id'
    )
    session.start(clip, true, true)
    session.end(false, 'error')
    expect(events[1]).toMatchObject({
      isDefault: true,
      bookingId: 'booking',
      endReason: 'error',
      playedDurationSec: 0
    })
  })
})
