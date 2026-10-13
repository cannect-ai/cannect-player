import { successMemeFor } from '@shared/successMemes'

const dota = new URL('./event-assets/audio/dota-victory-full.mp3', import.meta.url).href
const custom = {
  'howling-cat': new URL('./event-assets/audio/success-memes/howling-cat.mp3', import.meta.url)
    .href,
  'strong-kitten': new URL('./event-assets/audio/success-memes/strong-kitten.mp3', import.meta.url)
    .href,
  'cool-dog': new URL('./event-assets/audio/success-memes/cool-dog.mp3', import.meta.url).href
}

export function victorySoundFor(giftId: string): { url: string; loop: boolean } {
  const meme = successMemeFor(giftId)
  return meme in custom
    ? { url: custom[meme as keyof typeof custom], loop: true }
    : { url: dota, loop: true }
}
