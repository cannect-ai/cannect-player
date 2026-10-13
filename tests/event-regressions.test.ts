import { it } from 'vitest'
it('preserves immutable event rounds and promotions across queue updates', async () => {
  await import('../scripts/test-event-round.mjs')
})
it('keeps the same game media for repeated feedback', async () => {
  await import('../scripts/test-game-memes.mjs')
})
it('preserves tablet/audio gift agreement', async () => {
  await import('../scripts/test-success-memes.mjs')
})
it('a hung acknowledgement never blocks game state or Home recovery', async () => {
  await import('../scripts/test-event-recovery.mjs')
})
