import type { BrowserWindow } from 'electron'
import type { PlaybackEvent } from '@shared/types'
import { EventOrchestrator } from './event'
import { Orchestrator } from './orchestrator'

/** Opt-in game overlays coexist with the station's normal ad queue. */
export class HybridOrchestrator {
  readonly event: EventOrchestrator
  readonly fleet: Orchestrator
  constructor(win: BrowserWindow) {
    this.fleet = new Orchestrator(win)
    this.event = new EventOrchestrator(win)
  }
  async start(): Promise<void> {
    await Promise.all([this.fleet.start(), this.event.start()])
  }
  stop(): void {
    this.fleet.stop()
    this.event.stop()
  }
  resendPlaylist(): void {
    this.fleet.resendPlaylist()
    this.event.resendPlaylist()
  }
  handlePlaybackEvent(event: PlaybackEvent): void {
    this.fleet.handlePlaybackEvent(event)
  }
  interruptPlayback(reason: 'interrupted' | 'error' = 'interrupted'): void {
    this.fleet.interruptPlayback(reason)
  }
}
