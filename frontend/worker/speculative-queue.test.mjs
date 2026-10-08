import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createSpeculativeTransitions} from './speculative-transitions.mjs';

const bytes=Buffer.from(`exports.stepRoguelikeCombat=(envelope,intent)=>{const deadline=Date.now()+80;while(Date.now()<deadline){};return {envelope,accepted:intent};};`);
const artifactHash='sha256:'+createHash('sha256').update(bytes).digest('hex');
const envelope=id=>({artifactHash,state:{outcome:'active',characterId:id,controlledCharacterIds:[id],world:{scene:{initiative:[id],activeIndex:0}}}});
for(const closeEarly of [false,true])test(`queued requested predictions are retained and resolved, close=${closeEarly}`,async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'queued-combat-'));
 const cache=createSpeculativeTransitions({artifactsDirectory:directory,maxResults:1});
 try {
  await writeFile(path.join(directory,artifactHash.slice(7)+'.cjs'),bytes);
  cache.schedule('busy',envelope('first'));
  cache.schedule('requested',envelope('second'));
  const first=cache.take('requested',{type:'end_turn',actorId:'second'});
  const second=cache.take('requested',{type:'end_turn',actorId:'second'});
  // Overflowing guesses cannot evict the actual requested queued result.
  for(let i=0;i<4;i++)cache.schedule('guess-'+i,envelope('guess-'+i));
  if(closeEarly)await cache.close();
  const values=await Promise.all([first,second]);
  if(closeEarly)assert.deepEqual(values,[undefined,undefined]);
  else {assert.deepEqual(values[0].result,{envelope:envelope('second'),accepted:{type:'end_turn',actorId:'second'}});assert.deepEqual(values[1],values[0]);values[0].result.envelope.state.characterId='mutated';assert.equal((await cache.take('requested',{type:'end_turn',actorId:'second'})).result.envelope.state.characterId,'second');}
 }finally{await cache.close();assert.equal(path.dirname(directory),tmpdir());assert.ok(path.basename(directory).startsWith('queued-combat-'));await rm(directory,{recursive:true,force:true});}
});
