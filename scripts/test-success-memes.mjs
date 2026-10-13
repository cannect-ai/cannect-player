import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {successMemeFor, successMemeIds} from '../src/shared/successMemes.ts'
const choices = JSON.parse(readFileSync(new URL('./fixtures/success_meme_choices.json', import.meta.url), 'utf8'))
for (const {gift_id, meme_id} of choices) assert.equal(successMemeFor(gift_id), meme_id)
assert.deepEqual(new Set(choices.map(choice => successMemeFor(choice.gift_id))), new Set(successMemeIds))
console.log('PASS: station soundtrack matches tablet GIF for every shared fixture.')
