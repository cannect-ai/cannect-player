/** Guest order is immutable for a round. Promo cadence spans round boundaries. */
export class EventRound<T extends { videoId: string }> {
  entries: T[] = []
  pending: T[] = []
  index = 0
  round = 1
  private source: T[] = []
  private position = 1

  private schedule(items: T[], position: number): T[] {
    const promo = items.find((item) => item.videoId === 'event-intro')
    if (!promo) return [...items]
    const partner = items.find((item) => item.videoId === 'event-partner-aitea')
    const guests = items.filter(
      (item) => item.videoId !== 'event-intro' && item.videoId !== 'event-partner-aitea'
    )
    if (partner) {
      if (!guests.length) return [promo, partner]
      const scheduled: T[] = []
      for (const guest of guests) {
        // Repeat: CANNECT, AITEA, guest, guest. Keep cadence across rounds.
        if ((position - 1) % 4 === 0) {
          scheduled.push(promo, partner)
          position += 2
        } else if ((position - 1) % 4 === 1) {
          scheduled.push(partner)
          position++
        }
        scheduled.push(guest)
        position++
      }
      return scheduled
    }
    if (!guests.length) return [promo]
    const scheduled: T[] = []
    for (const guest of guests) {
      // Intro is slot 1; subsequent promos are slots 5, 10, 15, ...
      if (position === 1 || position % 5 === 0) {
        scheduled.push(promo)
        position++
      }
      scheduled.push(guest)
      position++
    }
    return scheduled
  }

  stage(items: T[]): boolean {
    this.pending = [...items]
    if (this.entries.length === 0 && items.length > 0) {
      this.source = [...items]
      this.entries = this.schedule(this.source, this.position)
      this.index = 0
      return true
    }
    return false
  }
  get current(): T | undefined {
    return this.entries[this.index]
  }
  get next(): T | undefined {
    return this.index + 1 < this.entries.length
      ? this.entries[this.index + 1]
      : this.schedule(this.pending.length ? this.pending : this.source, this.position + 1)[0]
  }
  advance(): T | undefined {
    if (!this.current) return undefined
    this.position++
    if (this.index + 1 < this.entries.length) this.index++
    else {
      if (this.pending.length) this.source = [...this.pending]
      this.entries = this.schedule(this.source, this.position)
      this.index = 0
      this.round++
    }
    return this.current
  }
}
