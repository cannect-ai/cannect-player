import { expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
vi.mock('../src/main/config', () => ({ getConfig: () => ({cacheDir:'/unused'}) }))
vi.mock('../src/main/logger', () => ({ log:vi.fn() }))
import { VideoCache } from '../src/main/cache'
it('reuses the installed Digital Bridge PNG overlay cache with its correct extension', async () => {
  const dir=mkdtempSync(join(tmpdir(),'cannect-overlay-cache-'))
  const url='https://event.example.test/overlay.png?revision=2'
  const name=createHash('sha1').update(url).digest('hex')+'.png'
  const fetcher=vi.fn(); vi.stubGlobal('fetch',fetcher)
  try {
    writeFileSync(join(dir,name),Buffer.from('cached-overlay'))
    const cache=new VideoCache(dir)
    expect(await cache.ensure(url)).toMatch(new RegExp(name+'$'))
    await cache.cleanup([url])
    expect(await cache.isCached(url)).toBe(true)
    expect(fetcher).not.toHaveBeenCalled()
  } finally { vi.unstubAllGlobals(); rmSync(dir,{recursive:true,force:true}) }
})
