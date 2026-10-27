import test from 'node:test';
import assert from 'node:assert/strict';
import {reactionIds,reactionFrame,earReactionOffset} from '../src/reactions.ts';

test('all twelve named reactions end without changing any gameplay transform',()=>{
  for(const id of reactionIds){
    assert.equal(reactionFrame(id,0).active,true);
    assert.equal(reactionFrame(id,.7).active,false);
    assert.equal(reactionFrame(id,-1).active,false);
    assert.equal(reactionFrame(id,Infinity).active,false);
  }
  assert.equal(reactionFrame('unknown',.1).active,false);
});
test('six cheek responses have distinct registered eyelid/ear choreography',()=>{
  const signatures=reactionIds.slice(0,6).map(id=>[.1,.2,.3,.4,.5].map(t=>{const f=reactionFrame(id,t);return [f.closeLeft,f.closeRight,f.earLeft.toFixed(3),f.earRight.toFixed(3)]}));
  assert.equal(new Set(signatures.map(s=>JSON.stringify(s))).size,6);
});
test('ear responses remain bounded and leave eyes, nose, cheeks and paws fixed',()=>{
  for(const id of reactionIds)for(let age=0;age<.7;age+=.017){
    const frame=reactionFrame(id,age);
    for(let x=0;x<=1;x+=.05)for(let y=0;y<=1;y+=.05){
      const d=earReactionOffset(x,y,frame);
      assert.ok(Math.abs(d.x)<=5.1&&Math.abs(d.y)<=3.1);
      if(y>=.28)assert.deepEqual(d,{x:0,y:0});
    }
  }
});
test('reduced motion retains expression response without ear movement',()=>{
  const f=reactionFrame('cheek-gentle',.2,true);
  assert.equal(f.closeLeft,true);assert.equal(f.closeRight,true);
  for(const id of reactionIds){const r=reactionFrame(id,.2,true);assert.equal(r.earLeft,0);assert.equal(Math.abs(r.earRight),0)}
});
