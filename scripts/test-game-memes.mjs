import assert from 'node:assert/strict'
import {GameMemePicker,gameMemeIds} from '../src/shared/gameMemes.ts'

let calls=0
const draws=[0,.3333333334,.9999999999,.42]
const picker=new GameMemePicker(()=>draws[calls++])
assert.equal(picker.forGame('game-a'),'pedro')
for(let i=0;i<1000;i++)assert.equal(picker.forGame('game-a'),'pedro')
assert.equal(calls,1,'Heartbeats and score feedback must not draw a new meme')
assert.equal(picker.forGame('game-b'),'oiia')
assert.equal(picker.forGame('game-c'),'toothless')
assert.equal(picker.forGame('game-a'),'pedro','A repeated game ID keeps its original meme')
assert.equal(calls,3)
assert.equal(picker.forGame('game-d'),'oiia')
assert.deepEqual(gameMemeIds,['pedro','oiia','toothless'],'The removed station video is not a candidate')

// Random selection can repeat: there is no imposed rotation or fourth fallback.
const repeat=new GameMemePicker(()=>.5)
assert.equal(repeat.forGame('one'),'oiia')
assert.equal(repeat.forGame('two'),'oiia')

console.log('PASS: three random choices, stable per game, and no forced rotation or old default.')
