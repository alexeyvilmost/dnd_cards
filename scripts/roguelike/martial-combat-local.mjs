// Real local authoritative combats, using only the QA runs from the Forge acceptance.
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const {chromium}=require('@playwright/test');
const base='http://127.0.0.1:3001',out='outputs/martial-classes-256';
const credentials=JSON.parse(await readFile('outputs/party-maps-254/credentials.json','utf8'));
const auth=await(await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(credentials)})).json();assert(auth.token);
async function api(method,path,body,status=200){const r=await fetch(`${base}/api${path}`,{method,headers:{Authorization:`Bearer ${auth.token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const t=await r.text();assert.equal(r.status,status,t.slice(0,1500));return JSON.parse(t);}
const partyMode=process.env.MARTIAL_PARTY_QA==='1';
const entries=partyMode
 ? [{class:'MIXED-party',runId:JSON.parse(await readFile(`${out}/mixed-party.json`,'utf8')).runId}]
 : JSON.parse(await readFile(`${out}/progression.json`,'utf8')).report;
const browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1050},ignoreHTTPSErrors:true});const report=[],errors=[];
page.on('pageerror',e=>errors.push(e.message));
try{
 await page.addInitScript(({token,user})=>{localStorage.setItem('auth_token',token);localStorage.setItem('user',JSON.stringify(user));},auth);
 await page.goto(base);
 for(const entry of entries){
  let run=(await api('GET',`/roguelike/runs/${entry.runId}`)).run;
  const record={class:entry.class,runId:run.id,steps:[],classActions:[],actingCharacters:[]};report.push(record);
  const command=async(type,payload={})=>{
   const body={command_id:randomUUID(),expected_revision:run.revision,type,payload};
   try{const accepted=await api('POST',`/roguelike/runs/${run.id}/commands`,body);assert.deepEqual(await api('POST',`/roguelike/runs/${run.id}/commands`,body),accepted);run=accepted.run;}
   catch(error){await writeFile(`${out}/combat-failure.json`,JSON.stringify({run,body}));throw error;}
  };
  if(run.phase==='camp')await command('start_encounter');
  if(!run.combat_state)await command('initialize_combat');
  for(let n=0;n<160&&run.combat_state.outcome==='active';n++){
   const decision=await page.evaluate(async s=>{
    const {activeActor,triggeredSecondaryTargetIds}=await import('/src/solo-combat/engine.ts');
    const ref=id=>s.actionPresentation?.[id]?.actionRef?.card_number;
    const simple=intent=>({intent});
    if(s.pendingD20Interrupt)return simple({type:'d20_interrupt',actorId:null});
    if(s.pendingInterception)return simple({type:'interception',actorId:null});
    if(s.pendingTriggeredAction){
     const pending=s.pendingTriggeredAction;
     const id=pending.optionActionIds.find(id=>ref(id)==='ACT-monk-deflect-redirect');
     const target=id?triggeredSecondaryTargetIds(s,id)[0]:null;
     return {intent:{type:'triggered_action',actionId:target?id:null,...(target?{targetIds:[target]}:{})},classAction:target?ref(id):undefined};
    }
    if(s.pendingTurnStartGrappleDamage)return simple({type:'turn_start',targetActorId:null});
    if(s.pendingAdditionalMovement)return simple({type:'decline_movement',actorId:s.pendingAdditionalMovement.actorId});
    if(s.world.pendingResolution){
     if(s.world.pendingResolution.request.type==='reaction'){
      const id=s.world.pendingResolution.request.options.find(o=>ref(o.actionId)==='ACT-monk-deflect-attacks')?.actionId;
      return {intent:{type:'reaction',response:{kind:'reaction',actionId:id??null}},classAction:id?ref(id):undefined};
     }
     return simple({type:'saving_throw'});
    }
    const actor=activeActor(s);if(!s.controlledCharacterIds.includes(actor.id))return simple({type:'resume'});
    const owned=s.catalogActions.filter(a=>actor.capabilities.actionIds.includes(a.id));
    const rage=owned.find(a=>ref(a.id)==='ACT-rage');
    if(rage&&actor.runtime.resources.bonus_action>0&&actor.runtime.resources.rage_charge>0&&!actor.runtime.activeEffects.some(e=>e.mechanics.stack_id==='class:barbarian:rage:damage'))return {intent:{type:'action',actorId:actor.id,actionId:rage.id,targetIds:[]},classAction:'ACT-rage'};
    const {defaultCombatAttackAction,combatApproachRoute,combatActionRangeFt}=await import('/src/solo-combat/defaultInteraction.ts');
    const {collectSoloCombatActionChoices}=await import('/src/solo-combat/actionChoices.ts');
    const {reachableRoutes}=await import('/src/solo-combat/tacticalGrid.ts');
    let action=defaultCombatAttackAction(s,actor.id);
    if(actor.runtime.resources.bonus_action>0){const special=owned.find(a=>ref(a.id)===(actor.runtime.resources.focus>0?'ACT-monk-flurry-of-blows':'ACT-monk-bonus-unarmed'));if(special)action=special;}
    if(!action||actor.runtime.hp.current<1||(actor.runtime.resources.action<1&&!['ACT-monk-flurry-of-blows','ACT-monk-bonus-unarmed'].includes(ref(action.id))))return simple({type:'end_turn',actorId:actor.id});
    const options=Object.values(s.world.actors).filter(a=>s.sideByActorId[a.id]!==s.sideByActorId[actor.id]&&a.runtime.hp.current>0)
     .map(a=>({target:a,route:combatApproachRoute(s,actor.id,a.id,combatActionRangeFt(s,actor.id,action))})).filter(x=>x.route).sort((a,b)=>a.route.costFt-b.route.costFt);
    const chosen=options[0];if(!chosen)return simple({type:'end_turn',actorId:actor.id});
    if(chosen.route.available){
     const choices=Object.fromEntries(collectSoloCombatActionChoices(actor,action,ref(action.id),chosen.target,s.world).map(c=>[c.id,c.recommended?.length?c.recommended:c.items.slice(0,c.count??1).map(i=>i.id)]));
     return {intent:{type:'approach_action',actorId:actor.id,actionId:action.id,targetActorId:chosen.target.id,choices},classAction:ref(action.id)};
    }
    const reachable=reachableRoutes(s,actor.id,s.movementRemainingFt[actor.id]??0);
    const point=[...chosen.route.path].reverse().find(p=>reachable.some(r=>r.destination.x===p.x&&r.destination.y===p.y));
    return simple(point?{type:'move',actorId:actor.id,destination:point}:{type:'end_turn',actorId:actor.id});
   },run.combat_state);
   await command('combat_intent',{intent:decision.intent});
   record.steps.push(decision.intent.type);if(decision.classAction)record.classActions.push(decision.classAction);
   if(decision.intent.actorId&&!record.actingCharacters.includes(decision.intent.actorId))record.actingCharacters.push(decision.intent.actorId);
   if(n%10===0)console.log(JSON.stringify({class:entry.class,step:n,last:decision.intent.type}));
  }
  record.outcome=run.combat_state.outcome;assert.notEqual(record.outcome,'active','battle must terminate');
  await writeFile(`${out}/${entry.class}-combat.json`,JSON.stringify(run));
  await page.goto(`${base}/characters-v3/${run.character_id}/combat?roguelike=${run.id}`);await page.locator('.solo-combat-page').waitFor({timeout:30000});
  await page.screenshot({path:`${out}/${entry.class}-combat.png`,fullPage:true});
  if(partyMode)assert.equal(record.actingCharacters.length,2,'both classes must act');
 }
 assert.deepEqual(errors,[],'browser exceptions');
 console.log(JSON.stringify(report));
}finally{await writeFile(`${out}/${partyMode?'mixed-party-combats':'combats'}.json`,JSON.stringify(report,null,2));await browser.close();}
