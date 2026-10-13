import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
const state = vi.hoisted(() => ({
  config: {
    eventCacheDir: '',
    eventQueueMode: 'cannect',
    eventApiBase: 'https://event.example.test',
    eventPlayerKey: 'test-key'
  }
}))
vi.mock('../src/main/config', () => ({ getConfig: () => state.config }))
vi.mock('../src/main/logger', () => ({ log: vi.fn() }))
vi.mock('../src/main/cache', () => ({
  VideoCache: class {
    async ensure(url: string) {
      return `file:///cache/${url.split('/').at(-1)}`
    }
    async prefetchAll(urls: string[]) {
      return new Map(urls.map((url) => [url, `file:///cache/${url.split('/').at(-1)}`]))
    }
  }
}))
import { EventOrchestrator } from '../src/main/event'
beforeEach(() => {
  state.config.eventCacheDir = mkdtempSync(join(tmpdir(), 'cannect-event-test-'))
  state.config.eventQueueMode = 'cannect'
})
afterEach(() => {
  rmSync(state.config.eventCacheDir, { recursive: true, force: true })
  vi.unstubAllGlobals()
})
describe('deployed event transport compatibility', () => {
  it('keeps the fleet queue separate, caches digital media and acknowledges its revision', async () => {
    const reply = {
      campaign: 'digital-bridge',
      media_revision: 'revision-1',
      assets: ['https://event.example.test/scene.mp4', 'https://event.example.test/overlay.png'],
      queue: [],
      public_url: 'https://example.test',
      active_game: {
        id: 'game',
        name: 'Test',
        language: 'kk',
        campaign: 'digital-bridge',
        videoUrl: 'https://event.example.test/scene.mp4',
        overlayUrl: 'https://event.example.test/overlay.png'
      },
      celebration: null
    }
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => reply })
    vi.stubGlobal('fetch', fetcher)
    const o = new EventOrchestrator({
      isDestroyed: () => false,
      webContents: { send: vi.fn() }
    } as unknown as BrowserWindow)
    const poll = () => (o as unknown as { poll(): Promise<void> }).poll()
    await poll()
    await poll()
    expect(o.snapshot).toMatchObject({
      entries: [],
      campaign: 'digital-bridge',
      activeGame: {
        id: 'game',
        language: 'kk',
        localUrl: 'file:///cache/scene.mp4',
        localOverlayUrl: 'file:///cache/overlay.png'
      }
    })
    expect(fetcher.mock.calls[1][1].headers).toMatchObject({
      'X-Player-Key': 'test-key',
      Authorization: 'Bearer test-key',
      'X-Cannect-Media': 'revision-1'
    })
  })
  it('keeps non-looping Shecker celebration metadata and server failure deadline', async () => {
    const reply = {
      campaign: 'alm002-shecker',
      queue: [],
      public_url: '',
      active_game: null,
      celebration: {
        id: 'gift',
        name: 'Test',
        language: 'kk',
        campaign: 'alm002-shecker',
        videoUrl: 'https://event.example.test/victory.mp4',
        duration: 8,
        failure_remaining_ms: 1200
      }
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => reply }))
    const o = new EventOrchestrator({
      isDestroyed: () => false,
      webContents: { send: vi.fn() }
    } as unknown as BrowserWindow)
    await (o as unknown as { poll(): Promise<void> }).poll()
    expect(o.snapshot?.celebration).toMatchObject({
      id: 'gift',
      language: 'kk',
      campaign: 'alm002-shecker',
      entry: { localUrl: 'file:///cache/victory.mp4' }
    })
    expect(o.snapshot!.celebration!.expiresAt!).toBeLessThanOrEqual(Date.now() + 1200)
  })
})
