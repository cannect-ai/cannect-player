import assert from 'node:assert/strict';
import {EventRound} from '../src/shared/eventRound.ts';
const items=(...ids)=>ids.map(videoId=>({videoId}));
const r=new EventRound();r.stage(items('1','2','3'));assert.equal(r.current.videoId,'1');r.advance();r.stage(items('1','2','3','4'));assert.equal(r.current.videoId,'2');assert.equal(r.next.videoId,'3');r.advance();assert.equal(r.current.videoId,'3');assert.equal(r.round,1);r.advance();assert.equal(r.current.videoId,'1');assert.equal(r.round,2);r.advance();r.advance();r.advance();assert.equal(r.current.videoId,'4');r.advance();assert.equal(r.current.videoId,'1');assert.equal(r.round,3);
console.log('PASS: new upload enters next round, current clip does not restart.');
function take(round,count){
  return Array.from({length:count},()=>{
    const current=round.current.videoId,next=round.next;
    // The video preloaded by Deck must be the one advance actually selects.
    assert.equal(round.advance(),next);
    return current;
  });
}
const guestIds=Array.from({length:50},(_,i)=>`guest-${i+1}`);
const promo=new EventRound();promo.stage(items('event-intro',...guestIds));
const sequence=take(promo,150);
assert.deepEqual(sequence.slice(0,10),['event-intro','guest-1','guest-2','guest-3','event-intro','guest-4','guest-5','guest-6','guest-7','event-intro']);
sequence.forEach((id,index)=>assert.equal(id==='event-intro',index===0||(index+1)%5===0));
sequence.filter(id=>id!=='event-intro').forEach((id,index)=>assert.equal(id,guestIds[index%50]));
assert.ok(promo.round>=3);
console.log('PASS: 50 uploads keep their order; promo at 1, 5, 10, 15… across round boundaries.');

for(const count of [1,2,3,4]){
  const small=new EventRound();const ids=guestIds.slice(0,count);small.stage(items('event-intro',...ids));
  const played=take(small,40);
  played.forEach((id,index)=>assert.equal(id==='event-intro',index===0||(index+1)%5===0));
  played.filter(id=>id!=='event-intro').forEach((id,index)=>assert.equal(id,ids[index%count]));
}
const empty=new EventRound();assert.equal(empty.advance(),undefined);empty.stage(items('event-intro'));
assert.deepEqual(take(empty,3),Array(3).fill('event-intro'));
empty.stage(items('event-intro','guest-new'));assert.equal(empty.current.videoId,'event-intro');
empty.advance();assert.equal(empty.current.videoId,'event-intro'); // slot 5
empty.advance();assert.equal(empty.current.videoId,'guest-new');
console.log('PASS: short and empty queues; new upload after promo-only playback.');

const updated=new EventRound();updated.stage(items('event-intro','guest-a','guest-b','guest-c'));
assert.deepEqual(take(updated,2),['event-intro','guest-a']);
updated.stage(items('event-intro','guest-a','guest-c','guest-d'));
assert.deepEqual(take(updated,2),['guest-b','guest-c']); // current round remains intact
assert.deepEqual(take(updated,4),['event-intro','guest-a','guest-c','guest-d']);
const current=updated.current,next=updated.next;
for(let i=0;i<20;i++)updated.stage(items('event-intro','guest-a','guest-c','guest-d'));
assert.equal(updated.current,current);assert.equal(updated.next,next);
// Game/victory interruptions do not call advance: resuming the current ad
// must not consume an extra cadence position.
assert.equal(updated.advance(),next);
console.log('PASS: uploads/removals apply at round boundary; refreshes and interruptions preserve position.');

for(const count of [1,2,3,4,12]){
  const paired=new EventRound();const ids=guestIds.slice(0,count);
  paired.stage(items('event-intro','event-partner-aitea',...ids));
  const played=take(paired,96);
  played.forEach((id,index)=>{
    if(index%4===0)assert.equal(id,'event-intro');
    else if(index%4===1)assert.equal(id,'event-partner-aitea');
    else assert.ok(ids.includes(id));
  });
  played.filter(id=>ids.includes(id)).forEach((id,index)=>assert.equal(id,ids[index%count]));
}
const pairOnly=new EventRound();pairOnly.stage(items('event-intro','event-partner-aitea'));
assert.deepEqual(take(pairOnly,6),['event-intro','event-partner-aitea','event-intro','event-partner-aitea','event-intro','event-partner-aitea']);
const pairUpdates=new EventRound();pairUpdates.stage(items('event-intro','event-partner-aitea','g1','g2','g3'));
assert.deepEqual(take(pairUpdates,3),['event-intro','event-partner-aitea','g1']);
pairUpdates.stage(items('event-intro','event-partner-aitea','g1','g3','g4'));
assert.deepEqual(take(pairUpdates,5),['g2','event-intro','event-partner-aitea','g3','g1']);
assert.deepEqual(take(pairUpdates,4),['event-intro','event-partner-aitea','g3','g4']);
console.log('PASS: CANNECT → AITEA → two guests; odd/even rounds, no guests, and live queue changes.');
