import type { GameMemeId } from '@shared/gameMemes'

export type GamePresentation = {
  id: GameMemeId
  label: string
  music: string
  videoUrl: string
  audioUrl?: string
  headline: readonly [string, string]
  volume: number
}

export const gamePresentations: Record<GameMemeId, GamePresentation> = {
  pedro: {
    id: 'pedro',
    label: 'Pedro · енот',
    music: 'Pedro',
    videoUrl: new URL('./event-assets/game-memes/pedro.mp4', import.meta.url).href,
    headline: ['PEDRO', 'БОЛЕЕТ ЗА ТЕБЯ'],
    volume: 0.65
  },
  oiia: {
    id: 'oiia',
    label: 'OIIA · вращающийся кот',
    music: 'W&W — OIIA OIIA',
    videoUrl: new URL('./event-assets/game-memes/oiia.mp4', import.meta.url).href,
    audioUrl: new URL('./event-assets/game-memes/oiia-ww.mp3', import.meta.url).href,
    headline: ['КРУТИМСЯ', 'РАДИ КОФЕ'],
    volume: 0.65
  },
  toothless: {
    id: 'toothless',
    label: 'Беззубик · танец',
    music: 'Driftveil City',
    videoUrl: new URL('./event-assets/game-memes/toothless.mp4', import.meta.url).href,
    headline: ['БЕЗЗУБИК', 'В ТВОЕЙ КОМАНДЕ'],
    volume: 0.65
  }
}
