export const gameMemeIds = ['pedro', 'oiia', 'toothless'] as const
export type GameMemeId = (typeof gameMemeIds)[number]

/** Pick once per game, retaining the choice across feedback and playlist updates. */
export class GameMemePicker {
  private readonly choices = new Map<string, GameMemeId>()
  private readonly random: () => number

  constructor(random: () => number = Math.random) {
    this.random = random
  }

  forGame(gameId: string): GameMemeId {
    const previous = this.choices.get(gameId)
    if (previous) return previous
    const choice = gameMemeIds[Math.floor(this.random() * gameMemeIds.length)]
    this.choices.set(gameId, choice)
    if (this.choices.size > 100) this.choices.delete(this.choices.keys().next().value!)
    return choice
  }
}
