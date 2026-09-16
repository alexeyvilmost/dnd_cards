// Isolated in-memory combat mechanics against the real local Forge catalog.
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const {chromium}=require('@playwright/test');
const base='http://127.0.0.1:3001',out='outputs/martial-classes-256';
const creds=JSON.parse(await readFile('outputs/party-maps-254/credentials.json','utf8'));
const auth=await(await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(creds)})).json();assert(auth.token);
const builds=JSON.parse(await readFile(`${out}/builds.json`,'utf8'));
const browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();
try{
 await page.addInitScript(({token,user})=>{localStorage.setItem('auth_token',token);localStorage.setItem('user',JSON.stringify(user));},auth);
 await page.goto(base);
 const report=await page.evaluate(async builds=>{
  const {charactersV3Api}=await import('/src/character/api.ts');
  const {loadSheetCombatParticipant}=await import('/src/character/sheetCombatTargetRuntime.ts');
  const {executeAction}=await import('/src/engine/execute.ts');
  const {shortRest,longRest}=await import('/src/engine/turn.ts');
  const {weaponContext}=await import('/src/engine/weapon.ts');
  const {parseWeaponProfile}=await import('/src/engine/weaponProfile.ts');
  const {applyUnarmedDamageProfileToAction}=await import('/src/rules-core/fightingStyleComplexPrimitives.ts');
  const check=(v,label)=>{if(!v)throw Error(label);};const report=[];
  for(const build of builds){
   const character=await charactersV3Api.get(build.character.id);
   const participant=await loadSheetCombatParticipant({character,cards:new Map(),basicActions:[]});
   const actor=participant.canonical.world.actors[participant.canonical.actorId];
   // The persisted catalog is actor-neutral; this low-level executor probe
   // applies the same actor projection as the authoritative rules handler.
   const action=card=>{
    const raw=participant.canonical.actions.find(a=>participant.actionPresentation[a.id]?.actionRef?.card_number===card);
    return raw && applyUnarmedDamageProfileToAction(raw,actor.passives??[],{
     variables:actor.character.variables,abilityMods:actor.character.abilityMods,
     holdingWeaponOrShield:['main_hand','off_hand'].some(slot=>!!actor.runtime.equipment[slot]),
     wearingArmorOrShield:Object.values(actor.runtime.equipment).some(id=>actor.character.knownCards?.find(c=>c.id===id)?.defense_type!=null),
    });
   };
   const target={hp:{current:100,max:100,temp:0},resources:{},maxResources:{},equipment:{},inventory:[],activeEffects:[]};
   const ctx={character:actor.character,passives:actor.passives,rng:()=>0.55,selfId:actor.id,target:{id:'qa-target',ac:10,runtimeState:target,characterContext:{abilityMods:{str:0,dex:0,con:0,int:0,wis:0,cha:0},level:1,profBonus:2}}};
   const runtime=structuredClone(actor.runtime), checks=[];
   if(build.card==='CLASS-barbarian'){
    const rage=action('ACT-rage');check(rage,'rage missing');
    const raging=executeAction(runtime,rage.mechanics,{...ctx,target:undefined});
    check(raging.state.resources.rage_charge===runtime.resources.rage_charge-1,'rage price');
    check(raging.state.activeEffects.some(e=>e.mechanics.damage_type==='slashing'),'rage resistance');
    const empty={...runtime,resources:{...runtime.resources,rage_charge:0}};
    check(shortRest(empty,participant.restContext).state.resources.rage_charge===1,'rage short rest +1');
    check(longRest(empty,participant.restContext).state.resources.rage_charge===(build.level===3?3:2),'rage long rest');
    checks.push('rage cost/resistances; short +1; long full');
    if(build.level>=2){const reckless=action('ACT-reckless-attack');check(reckless,'reckless missing');const r=executeAction(runtime,reckless.mechanics,{...ctx,target:undefined});check(r.state.activeEffects.length>=2,'reckless advantage both sides');checks.push('reckless attack');}
   }else{
    const weapon=actor.character.knownCards.find(c=>{const p=parseWeaponProfile(c);return p.valid&&p.profile.proficiencyCategory==='simple'&&p.profile.defaultAttackMode==='melee';});
    check(weapon,'starting monk weapon');
    const equipped={...runtime,equipment:{...runtime.equipment,main_hand:weapon.id,off_hand:null}};
    const profile=weaponContext(actor.character,'main',equipped.equipment,equipped,actor.passives);
    check(actor.character.abilityMods[profile.ability]===Math.max(actor.character.abilityMods.str,actor.character.abilityMods.dex),'monk weapon best ability');
    checks.push('monk weapon profile');
    const bonus=action('ACT-monk-bonus-unarmed');check(bonus,'bonus strike missing');
    const presentation=participant.actionPresentation[bonus.id].actionRef;
    check(presentation.mechanics.effects[0].ability==='str','shared preview must keep the unbound entity, not another actor ability');
    const hit=executeAction(runtime,bonus.mechanics,ctx);
    check(hit.state.resources.bonus_action===0&&hit.state.resources.action===runtime.resources.action,'independent bonus attack');
    check(hit.events.some(e=>e.type==='damage'&&e.amount>=4),'martial arts damage');checks.push('independent martial bonus strike');
    if(build.level>=2){
     const flurry=action('ACT-monk-flurry-of-blows');const r=executeAction(runtime,flurry.mechanics,ctx);
     check(r.events.filter(e=>e.type==='roll'&&e.roll.kind==='d20').length===2,'two flurry attacks');
     check(r.state.resources.focus===build.level-1&&r.state.resources.bonus_action===0,'flurry price');
     const empty={...runtime,resources:{...runtime.resources,focus:0}};
     check(shortRest(empty,participant.restContext).state.resources.focus===build.level,'focus short rest');
     for(const card of ['ACT-monk-step-of-the-wind','ACT-monk-step-of-the-wind-focus'])check(action(card)?.mechanics.activation.counts_as==='dash','dash declaration');
     checks.push('flurry 2 attacks; focus price/rest; dash declaration');
    }
    if(build.level===3){
     const deflect=action('ACT-monk-deflect-attacks');const r=executeAction(runtime,deflect.mechanics,{...ctx,target:undefined,incomingDamage:15});
     check(r.events.some(e=>e.type==='damage_reduction'&&e.amount>=4),'deflect dice');check(r.state.resources.reaction===0,'deflect reaction price');
     const redirect=action('ACT-monk-deflect-redirect');check(redirect.mechanics.activation.mode==='triggered','redirect gate');
     const redirected=executeAction(runtime,redirect.mechanics,{...ctx,forceSaveOutcome:'fail',triggeringAttack:{targetActorId:'qa-target',damageType:'slashing',critical:false}});
     check(redirected.events.some(e=>e.type==='damage'&&e.damageType==='slashing'),'redirect original type');
     const saved=executeAction(runtime,redirect.mechanics,{...ctx,forceSaveOutcome:'success',triggeringAttack:{targetActorId:'qa-target',damageType:'slashing',critical:false}});
     check(!saved.events.some(e=>e.type==='damage'&&e.amount>0),'redirect successful save prevents damage');
     checks.push('deflect dice/reaction; redirect original damage type');
    }
   }
   report.push({class:build.card,level:build.level,checks,resources:runtime.resources});
  }
  return report;
 },builds);
 await writeFile(`${out}/mechanics.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();}
