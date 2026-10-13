import type { ClipStartEvent, PlaybackEvent, PlaylistEntry } from './types'

/** Only the primary video's `playing` event starts a session. Repeated events
 * (buffer recovery, mirrors) cannot overwrite its original timestamp or ID. */
export class PlaybackSession {
  private current: ClipStartEvent | null = null
  private startedMono = 0

  constructor(
    private emit: (event: PlaybackEvent) => void,
    private clock: () => number = () => performance.now(),
    private wallClock: () => string = () => new Date().toISOString(),
    private newId: () => string = () => crypto.randomUUID()
  ) {}

  start(entry: PlaylistEntry, isDefault: boolean, isFirst: boolean): void {
    if (this.current) return
    this.startedMono = this.clock()
    this.current = {
      type: 'start',
      playbackId: this.newId(),
      isFirst,
      videoId: entry.videoId,
      videoTitle: entry.videoTitle,
      campaignId: entry.campaignId,
      bookingId: entry.bookingId,
      expectedDuration: entry.duration,
      isDefault,
      startedAt: this.wallClock()
    }
    this.emit(this.current)
  }

  end(completed: boolean, reason: 'interrupted' | 'error' = 'interrupted'): void {
    const current = this.current
    if (!current) return
    this.current = null
    this.emit({
      ...current,
      type: 'end',
      completed,
      endedAt: this.wallClock(),
      playedDurationSec: Math.min(
        current.expectedDuration,
        Math.max(0, (this.clock() - this.startedMono) / 1000)
      ),
      endReason: completed ? 'completed' : reason
    })
  }
}
