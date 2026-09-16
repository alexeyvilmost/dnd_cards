// Own QA characters only. Exercise real HTTP commands and persisted continuations.
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const {chromium}=require('@playwright/test');
const base='http://127.0.0.1:3001',out='outputs/party-maps-254';
const credentials=JSON.parse(await readFile(`${out}/credentials.json`,'utf8'));
const auth=await(await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(credentials)})).json();
assert(auth.token);
const report={steps:[],checks:[]};
async function api(method,path,body,status=200){
 const start=performance.now(),r=await fetch(`${base}/api${path}`,{method,headers:{Authorization:`Bearer ${auth.token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 const text=await r.text();assert.equal(r.status,status,text.slice(0,1000));
 if(body?.type)report.steps.push({type:body.payload?.intent?.type??body.type,ms:Math.round(performance.now()-start)});
 return JSON.parse(text);
}
const count=Number(process.argv[2]??3),templates=(await api('GET','/character-templates')).templates,ids=[];
for(let i=0;i<count;i++){const t=templates.find(t=>t.preset_key===['swordsman','archer','frontliner'][i%3])??templates[0];ids.push((await api('POST',`/character-templates/${t.id}/copies`,{name:`QA бой ${count}-${i+1} ${randomUUID().slice(0,5)}`},201)).id);}
let run=(await api('POST','/roguelike/runs',{source_character_ids:ids},201)).run;report.runId=run.id;
const command=async(type,payload={})=>{
 const body={command_id:randomUUID(),expected_revision:run.revision,type,payload};
 const before=run;let accepted;
 try{accepted=await api('POST',`/roguelike/runs/${run.id}/commands`,body);}catch(error){await writeFile(`${out}/party-failure-${count}.json`,JSON.stringify({run,body}));throw error;}
 if(type==='combat_intent'){
  assert(accepted.run.characters.every((c,i)=>c.runtime_revision===before.characters[i].runtime_revision+1));
  // Exact duplicate must be a receipt, including saved dice and every ally revision.
  assert.deepEqual(await api('POST',`/roguelike/runs/${run.id}/commands`,body),accepted);
 }
 run=accepted.run;return run;
};
const browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();
try{
 await page.goto(base);
 // Full-HP use still must consume the giver's potion, never the recipient's.
 const inventoryCards=await Promise.all(run.characters[0].inventory_items.map(r=>api('GET',`/cards/${r.card_id}`)));
 const potion=inventoryCards.find(c=>c.card_number==='CARD-0839');assert(potion);
 const itemCount=(c)=>(c.inventory_items??[]).filter(r=>r.card_id===potion.id).reduce((n,r)=>n+r.qty,0);
 const before=structuredClone(run);
 await command('use_item',{actor_id:run.characters[0].id,item_card_id:potion.id,card_id:potion.id,target_ids:[run.characters[1].id]});
 assert.equal(itemCount(run.characters[0]),itemCount(before.characters[0])-1);
 assert.equal(itemCount(run.characters[1]),itemCount(before.characters[1]));
 report.checks.push('real library potion targets ally and only consumes source inventory');
 await command('start_encounter');await command('initialize_combat');
 let alliedAttack=false;
 for(let n=0;n<140&&run.combat_state.outcome==='active';n++){
  const intent=await page.evaluate(async s=>{
   const {activeActor}=await import('/src/solo-combat/engine.ts');
   if(s.pendingAlertSwapActorIds?.length)return {type:'alert_swap',actorId:s.pendingAlertSwapActorIds[0],allyActorId:null};
   if(s.pendingD20Interrupt)return {type:'d20_interrupt',actorId:null};
   if(s.pendingInterception)return {type:'interception',actorId:null};
   if(s.pendingTriggeredAction)return {type:'triggered_action',actionId:null};
   if(s.pendingTurnStartGrappleDamage)return {type:'turn_start',targetActorId:null};
   if(s.pendingAdditionalMovement)return {type:'decline_movement',actorId:s.pendingAdditionalMovement.actorId};
   if(s.world.pendingResolution){
    if(s.world.pendingResolution.request.type==='reaction')return {type:'reaction',response:{kind:'reaction',actionId:null}};
    return {type:'saving_throw'};
   }
   const actor=activeActor(s);if(!s.controlledCharacterIds.includes(actor.id))return {type:'resume'};
   if(actor.runtime.resources.action<1||actor.runtime.hp.current<1)return {type:'end_turn',actorId:actor.id};
   const {defaultCombatAttackAction,combatApproachRoute,combatActionRangeFt}=await import('/src/solo-combat/defaultInteraction.ts');
   const {collectSoloCombatActionChoices}=await import('/src/solo-combat/actionChoices.ts');
   const {reachableRoutes}=await import('/src/solo-combat/tacticalGrid.ts');
   const action=defaultCombatAttackAction(s,actor.id);
   if(!action)return {type:'end_turn',actorId:actor.id};
   const options=Object.values(s.world.actors).filter(a=>s.sideByActorId[a.id]!==s.sideByActorId[actor.id]&&a.runtime.hp.current>0)
    .map(a=>({target:a,route:combatApproachRoute(s,actor.id,a.id,combatActionRangeFt(s,actor.id,action))}))
    .filter(x=>x.route).sort((a,b)=>a.route.costFt-b.route.costFt);
   const chosen=options[0];if(!chosen)return {type:'end_turn',actorId:actor.id};
   if(chosen.route.available){
    const choices=Object.fromEntries(collectSoloCombatActionChoices(actor,action,s.actionPresentation?.[action.id]?.actionRef?.card_number,chosen.target,s.world)
     .map(c=>[c.id,c.recommended?.length?c.recommended:c.items.slice(0,c.count??1).map(i=>i.id)]));
    return {type:'approach_action',actorId:actor.id,actionId:action.id,targetActorId:chosen.target.id,choices};
   }
   const reachable=reachableRoutes(s,actor.id,s.movementRemainingFt[actor.id]??0);
   const point=[...chosen.route.path].reverse().find(p=>reachable.some(r=>r.destination.x===p.x&&r.destination.y===p.y));
   return point?{type:'move',actorId:actor.id,destination:point}:{type:'end_turn',actorId:actor.id};
  },run.combat_state);
  if(intent.type==='approach_action'&&intent.actorId!==run.character_id)alliedAttack=true;
  await command('combat_intent',{intent});
  if(n%10===0)console.log(JSON.stringify({step:n,round:run.combat_state.world.scene.round,last:intent.type}));
 }
 assert(alliedAttack,'a non-leader attacks');assert.notEqual(run.combat_state.outcome,'active','battle must terminate');
 report.outcome=run.combat_state.outcome;report.checks.push('full party battle ends; every command replay preserves dice and all mirrors');
 await writeFile(`${out}/party-combat-${count}-run.json`,JSON.stringify(run));
 if(run.combat_state.outcome==='victory'){
  await command('complete_encounter');assert.equal(run.phase,'camp');report.checks.push('victory returns the whole party to camp');
 }
 console.log(JSON.stringify(report,null,2));
}finally{await writeFile(`${out}/party-combat-${count}.json`,JSON.stringify(report,null,2));await browser.close();}
