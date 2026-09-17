import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {replayCombatRecords} from '../../frontend/worker/replay.mjs';
const require=createRequire(import.meta.url);
const snapshot=JSON.parse(await readFile('outputs/attack-stall/snapshot.json','utf8'));
const timings=[],groups=[],heldRolls=[];let slowest=0,slowState;
for(const {record} of snapshot.events){if(record.baseline)groups.push([]);groups.at(-1).push(record);}
for(const records of groups){
 const artifact=require(`../../outputs/rules-artifacts-251/${records[0].artifactHash.slice(7)}.cjs`);
 const measured={...artifact,stepRoguelikeCombat:(envelope,intent,hash)=>{
  const start=performance.now(),result=artifact.stepRoguelikeCombat(envelope,intent,hash),ms=performance.now()-start;
  timings.push({type:intent.type,actor:intent.actorId,ms:Math.round(ms*10)/10,logLength:envelope.state.log.length});
  const state=result.envelope.state,held=state.pendingD20Interrupt;
  if(intent.type==='approach_action'&&held?.held)heldRolls.push({
   round:state.world.scene.round,worldRevision:state.world.revision,
   logLength:state.log.length,lastEntry:state.log.at(-1)?.id,
   actor:held.command.actorId,total:held.held.roll.total,outcome:held.held.roll.outcome,
   automaticKey:`roll:${held.command.actorId}:${state.log.length}`,
  });
  if(ms>slowest){slowest=ms;slowState=envelope.state;}
  return result;
 }};
 const replay=replayCombatRecords(records,measured);console.log('Verified commands:',replay.commands);
}
await writeFile('outputs/attack-stall/replay-timings.json',JSON.stringify(timings,null,2));
await writeFile('outputs/attack-stall/slow-state.json',JSON.stringify(slowState));
console.log(JSON.stringify(timings.sort((a,b)=>b.ms-a.ms).slice(0,10),null,2));
await writeFile('outputs/attack-stall/held-rolls.json',JSON.stringify(heldRolls,null,2));
console.log('Held hits with saturated log:',JSON.stringify(heldRolls.filter(row=>row.logLength===80&&row.outcome==='hit'),null,2));
