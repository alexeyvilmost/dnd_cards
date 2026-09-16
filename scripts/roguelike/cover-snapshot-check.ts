/** Read-only replay fixture: no API commands and no database writes. */
import {readFileSync, writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {InMemoryRulesSession} from '../../frontend/src/rules-core/session';
import {spatialFacts} from '../../frontend/src/solo-combat/types';
const snapshot=JSON.parse(readFileSync('outputs/cover-symmetry/battle-before.json','utf8'));
const state=structuredClone(snapshot.events[0].record.baseline.state);
const sourceId=Object.keys(state.world.actors).find(id=>id!==state.characterId)!;
const targetId=state.characterId;
const bow=state.catalogActions.find((a:any)=>a.name==='Короткий лук');
const facts=spatialFacts(state,sourceId,targetId);
assert.equal(facts.cover,'half');
assert.equal(spatialFacts(state,targetId,sourceId).cover,'half');
const reports=[];
for(const natural of [12,17]) {
 const world=structuredClone(state.world);
 world.pendingResolution=null;
 world.scene.activeIndex=world.scene.initiative.indexOf(sourceId);
 world.actors[sourceId].runtime.resources.action=1;
 const session=new InMemoryRulesSession(world,{getAction:id=>state.catalogActions.find((a:any)=>a.id===id)},
  {rng:()=>(natural-.5)/20,clock:()=>1,nextId:()=>''});
 const result=session.dispatch({schemaVersion:1,type:'UseAction',commandId:`cover-regression-${natural}`,
  expectedRevision:world.revision,rulesetContentHash:world.ruleset.contentHash,actorId:sourceId,
  actionId:bow.id,targetIds:[targetId],factsByTarget:{[targetId]:facts}});
 assert.equal(result.status,'accepted');
 if(result.status!=='accepted')throw Error(result.message);
 const rolls=result.events.flatMap(e=>e.payload.type==='EngineEventRecorded'&&e.payload.event.type==='roll'&&e.payload.event.roll.target?.type==='ac'?[e.payload.event.roll]:[]);
 assert.equal(rolls[0].target!.value,17);
 assert.equal(rolls[0].outcome,natural===12?'miss':'hit');
 assert.equal(session.getState().actors[targetId].ac,15);
 reports.push({natural,roll:rolls[0],pending:session.getState().pendingResolution?.type});
}
writeFileSync('outputs/cover-symmetry/snapshot-check.json',JSON.stringify(reports,null,2));
console.log(JSON.stringify(reports.map(r=>({natural:r.natural,ac:r.roll.target?.value,total:r.roll.total,outcome:r.roll.outcome,pending:r.pending}))));
