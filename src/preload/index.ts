// Preload: безопасный мост между renderer и main (window.cannect).
// Никаких node-API наружу — только узкий типизированный контракт.

import { contextBridge, ipcRenderer } from 'electron'
import type {
  CannectBridge,
  PlaybackEvent,
  PlaylistUpdate,
  ProvisioningStatus,
  ProvisionInput,
  ProvisionOutcome,
  RendererConfig
} from '@shared/types'

const bridge: CannectBridge = {
  onGameFeedback: (cb) => {
    const listener = (_e: unknown, event: Parameters<typeof cb>[0]): void => {
      cb(event)
      ipcRenderer.send('event:feedback-ack', event.id)
    }
    ipcRenderer.on('event:feedback', listener)
    return () => ipcRenderer.removeListener('event:feedback', listener)
  },
  getEventState: () => ipcRenderer.invoke('event:state'),
  onEventState: (cb) => {
    const listener = (_e: unknown, state: Parameters<typeof cb>[0]): void => cb(state)
    ipcRenderer.on('event:update', listener)
    return () => ipcRenderer.removeListener('event:update', listener)
  },
  sendEventPlayback: (ev) => ipcRenderer.send('event:playback', ev),
  getConfig: (): Promise<RendererConfig> => ipcRenderer.invoke('config:get'),

  onPlaylist: (cb: (playlist: PlaylistUpdate) => void): (() => void) => {
    const listener = (_e: unknown, playlist: PlaylistUpdate): void => cb(playlist)
    ipcRenderer.on('playlist:update', listener)
    return () => ipcRenderer.removeListener('playlist:update', listener)
  },

  sendPlaybackEvent: (ev: PlaybackEvent): void => ipcRenderer.send('playback:event', ev),

  log: (level, message): void => ipcRenderer.send('renderer:log', level, message),

  getProvisioningStatus: (): Promise<ProvisioningStatus> =>
    ipcRenderer.invoke('provisioning:status'),

  provision: (input: ProvisionInput): Promise<ProvisionOutcome> =>
    ipcRenderer.invoke('provisioning:provision', input)
}

contextBridge.exposeInMainWorld('cannect', bridge)
