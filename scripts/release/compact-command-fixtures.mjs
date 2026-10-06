import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {evidenceHash} from './validate-manifest.mjs';
const uuid=/^[a-f0-9-]{36}$/;
const safeId=value=>{assert.match(value,uuid);return value;};
const off={compactReceipts:false,imageJobs:false,frozenCatalogs:false};

export async function compactCommandIO(adapter,accounts,binding,{rollInfluences}={}){
 // Canonical host callers supply exact candidate source data from the verified
 // public package. The cwd fallback serves only archived local foundation runs.
 if(rollInfluences!==undefined)assert.ok(Array.isArray(rollInfluences)&&rollInfluences.length>0);
 const packagedInfluences=rollInfluences===undefined?undefined:structuredClone(rollInfluences);
 let auth;const initialEffects=[],offSelections=[],schemaFaults=[],triggerFaults=[];const constraintRestores=new Map(),triggerRestores=new Map();
 async function api(route,{body,method=body?'POST':'GET',role='player',status=200}={}){
  const response=await adapter.request(route,{body,method,token:auth[role]});
  if(response.status!==status)throw Error(`Owned fixture ${method} resource returned HTTP ${response.status}; code=${/^[a-z0-9_]+$/.test(response.body?.code??'')?response.body.code:'unavailable'}`);
  return response.body;
 }
 async function login(){
  await adapter.assertOwned();auth={};
  for(const role of ['player','admin']){
   const response=await adapter.request('/auth/login',{method:'POST',body:{username:accounts[role].username,password:accounts[role].password}});
   assert.equal(response.status,200);assert.equal(typeof response.body.token,'string');auth[role]=response.body.token;
  }
 }
 async function newRun(preset,name){
  const templates=(await api('/character-templates')).templates,template=templates.find(row=>row.preset_key===preset);assert.ok(template);
  const character=await api(`/character-templates/${template.id}/copies`,{body:{name},status:201});
  return {character,run:async()=>(await api('/roguelike/runs',{body:{source_character_id:character.id},status:201})).run};
 }
 const runCommand=(run,type,payload={})=>({command_id:randomUUID(),expected_revision:run.revision,type,payload});
 async function battle(){
  const source=await newRun('archer','Owned compact archer');
  await api(`/characters-v3/${source.character.id}`,{method:'PUT',body:{...source.character,resources:{...source.character.resources,heroic_inspiration:1},max_resources:{...source.character.max_resources,heroic_inspiration:1}}});
  let run=await source.run();
  const command=async(type,payload)=>{run=(await api(`/roguelike/runs/${run.id}/commands`,{body:runCommand(run,type,payload)})).run;};
  const monsters=(await api('/monsters?limit=100',{role:'admin'})).monsters;
  assert.equal(monsters.length,2);assert.ok(monsters.every(row=>row.source==='Local tests'));
  const changed=[];let setupFailure;
  try{for(const row of monsters){changed.push(row);await api(`/monsters/${row.id}`,{role:'admin',method:'PUT',body:{...row,max_hp:1000}});}await command('start_encounter');await command('initialize_combat');}
  catch(error){setupFailure=error;}
  finally{for(const row of changed)try{await api(`/monsters/${row.id}`,{role:'admin',method:'PUT',body:row});}catch(error){setupFailure??=error;}}
  if(setupFailure)throw setupFailure;
  for(let i=0;i<50;i++){
   const state=run.combat_state;let intent;
   if(state.pendingAlertSwapActorIds?.length)intent={type:'alert_swap',actorId:state.pendingAlertSwapActorIds[0],allyActorId:null};
   else if(state.pendingD20Interrupt)intent={type:'d20_interrupt',actorId:null};
   else if(state.pendingTriggeredAction)intent={type:'triggered_action',actionId:null};
   else if(state.world.pendingResolution?.request.type==='reaction')intent={type:'reaction',response:{kind:'reaction',actionId:null}};
   else if(state.world.pendingResolution?.request.type==='saving_throw')intent={type:'saving_throw'};
   else if(state.world.scene.initiative[state.world.scene.activeIndex]!==state.characterId)intent={type:'resume'};
   if(!intent)break;await command('combat_intent',{intent});
  }
  const state=run.combat_state;assert.equal(state.world.scene.initiative[state.world.scene.activeIndex],state.characterId);
  const action=state.catalogActions.find(row=>row.mechanics?.primitive?.type==='weapon_attack'&&row.mechanics.effects?.some(effect=>effect.attack_kind==='weapon_ranged'));
  const target=Object.values(state.world.actors).find(row=>row.kind==='monster'&&row.runtime.hp.current>0);assert.ok(action&&target);
  await command('combat_intent',{intent:{type:'approach_action',actorId:state.characterId,actionId:action.id,targetActorId:target.id}});
  const held=run.combat_state.pendingD20Interrupt;assert.equal(held?.operation,'roll_influence');
  const offered=held.responders.find(row=>row.effectId);assert.ok(offered);
  const core=packagedInfluences??JSON.parse(await readFile(path.resolve('frontend/src/engine/data/rollInfluences.json'),'utf8'));
  const declared=core.find(row=>row.id===offered.effectId)??run.combat_state.catalogActions.find(row=>row.id===offered.effectId)?.mechanics;
  assert.ok(declared?.activation?.cost?.length);
  const request=runCommand(run,'combat_intent',{intent:{type:'d20_interrupt',actorId:state.characterId,effectId:offered.effectId}});
  return {table:'roguelike_command_receipts',commandId:request.command_id,request,route:`/roguelike/runs/${run.id}/commands`,runId:run.id,userId:accounts.player.id,before:run,declaredCost:declared.activation.cost,initial:true};
 }
 async function equipment(){
  const source=await newRun('line','Owned compact equipment');
  const card=await api('/cards',{role:'admin',status:201,body:{name:'Owned compact proof ring',description:'Disposable storage-format fixture',rarity:'common',type:'ring',weight:0.1,mechanics:{}}});
  await api(`/characters-v3/${source.character.id}/runtime`,{role:'admin',method:'PATCH',body:{expected_runtime_revision:source.character.runtime_revision,inventory_items:[...(source.character.inventory_items??[]),{card_id:card.id,qty:1}]}});
  const run=await source.run(),character=await api(`/characters-v3/${run.character_id}`);
  const request={command_id:randomUUID(),expected_runtime_revision:character.runtime_revision,roguelike_run_id:run.id,expected_run_revision:run.revision,operation:{equip:card.id}};
  return {table:'character_runtime_commands',commandId:request.command_id,request,route:`/characters-v3/${run.character_id}/equipment-commands`,runId:run.id,characterId:run.character_id,cardId:card.id,userId:accounts.player.id,before:character,initial:true};
 }
 const where=f=>{safeId(f.commandId);safeId(f.userId);assert.ok(['roguelike_command_receipts','character_runtime_commands'].includes(f.table));return `user_id='${f.userId}' AND command_id='${f.commandId}'`;};
 const readReceipt=async f=>{
  const rows=JSON.parse(await adapter.query(`SELECT json_agg(row_to_json(x)) FROM (SELECT command_id,response_version,response,response_sha256,response_length,replace(encode(response_payload,'base64'),E'\\n','') AS response_payload_base64 FROM ${f.table} WHERE ${where(f)}) x;`));assert.equal(rows?.length,1);return rows[0];
 };
 const readConstraint=async f=>{
  where(f);const name=f.table+'_storage_version';
  const rows=JSON.parse(await adapter.query(`SELECT coalesce(json_agg(json_build_object('name',conname,'definition',pg_get_constraintdef(oid,false),'validated',convalidated)),'[]'::json) FROM pg_constraint WHERE conrelid='public.${f.table}'::regclass AND conname='${name}';`));
  assert.ok(Array.isArray(rows)&&rows.length<=1);return rows[0]??null;
 };
 const readTrigger=async f=>{
  where(f);const rows=JSON.parse(await adapter.query(`SELECT coalesce(json_agg(json_build_object('name',tgname,'definition',pg_get_triggerdef(oid,false),'function',pg_get_functiondef(tgfoid),'enabled',tgenabled)),'[]'::json) FROM pg_trigger WHERE tgrelid='public.${f.table}'::regclass AND tgname='character_runtime_commands_append_only' AND NOT tgisinternal;`));
  assert.equal(rows.length,1);return rows[0];
 };
 async function ensureTriggerGuard(f){
  if(f.table!=='character_runtime_commands'||triggerRestores.has(f.table))return;
  const original=await readTrigger(f);assert.equal(original.name,'character_runtime_commands_append_only');assert.equal(original.enabled,'O');
  const before=await readReceipt(f);
  const guarded=JSON.parse(await adapter.query(`DO $owned_trigger$ DECLARE actual_message text; BEGIN BEGIN UPDATE ${f.table} SET response_length=response_length+1 WHERE ${where(f)}; RAISE EXCEPTION 'Owned append-only guard did not reject'; EXCEPTION WHEN SQLSTATE '55000' THEN GET STACKED DIAGNOSTICS actual_message=MESSAGE_TEXT; IF actual_message IS DISTINCT FROM 'character runtime command receipts are append-only' THEN RAISE EXCEPTION 'Unexpected owned trigger rejection'; END IF; END; END $owned_trigger$; SELECT json_build_object('mutationRejected',true);`));
  assert.deepEqual(guarded,{mutationRejected:true});assert.deepEqual(await readReceipt(f),before);
  const proof={table:f.table,triggerName:original.name,definitionHash:evidenceHash(original),mutationRejected:true,scope:'owned-transaction-only',restored:false};
  triggerRestores.set(f.table,{original,proof});triggerFaults.push(proof);
 }
 const mutationSQL=(f,sql)=>{const trigger=triggerRestores.get(f.table);return `BEGIN; ${trigger?`ALTER TABLE ${f.table} DISABLE TRIGGER ${trigger.original.name};`:''} ${sql} ${trigger?`ALTER TABLE ${f.table} ENABLE TRIGGER ${trigger.original.name};`:''} COMMIT;`;};
 async function verifyTrigger(f){const trigger=triggerRestores.get(f.table);if(trigger){assert.deepEqual(await readTrigger(f),trigger.original,'Owned append-only trigger restoration differs');trigger.proof.restored=true;}}
 async function corruptReceipt(f,field){
  assert.ok(['length','hash','version'].includes(field));await adapter.assertOwned();await ensureTriggerGuard(f);
  if(field!=='version'){await adapter.query(mutationSQL(f,`UPDATE ${f.table} SET ${field==='length'?'response_length=response_length+1':"response_sha256=repeat('0',64)"} WHERE ${where(f)};`));await verifyTrigger(f);return;}
  const original=await readConstraint(f);assert.equal(original?.name,f.table+'_storage_version');assert.equal(original.validated,true);assert.ok(original.definition.startsWith('CHECK ('));
  const before=await readReceipt(f);
  // A PostgreSQL subtransaction must reject version 99 through this exact CHECK.
  // No schema relaxation is performed until this real database guard is proven.
  const guarded=JSON.parse(await adapter.query(mutationSQL(f,`DO $owned_guard$ DECLARE actual_constraint text; BEGIN BEGIN UPDATE ${f.table} SET response_version=99 WHERE ${where(f)}; RAISE EXCEPTION 'Owned version guard did not reject'; EXCEPTION WHEN check_violation THEN GET STACKED DIAGNOSTICS actual_constraint=CONSTRAINT_NAME; IF actual_constraint IS DISTINCT FROM '${original.name}' THEN RAISE EXCEPTION 'Unexpected owned constraint rejection'; END IF; END; END $owned_guard$;`)+` SELECT json_build_object('constraintRejected',true,'constraintName','${original.name}');`));
  await verifyTrigger(f);
  assert.deepEqual(guarded,{constraintRejected:true,constraintName:original.name});assert.deepEqual(await readReceipt(f),before);
  const proof={table:f.table,id:'version',constraintName:original.name,definitionHash:evidenceHash({definition:original.definition,validated:true}),constraintRejected:true,injectedVersion:99,restored:false};
  // Register restoration before any mutation, including a lost acknowledgement.
  constraintRestores.set(f.table,{original,proof});schemaFaults.push(proof);
  await adapter.query(mutationSQL(f,`ALTER TABLE ${f.table} DROP CONSTRAINT ${original.name}; UPDATE ${f.table} SET response_version=99 WHERE ${where(f)};`));await verifyTrigger(f);
  assert.equal((await readReceipt(f)).response_version,99);assert.equal(await readConstraint(f),null);
 }
 async function restoreReceipt(f,row){
  await adapter.assertOwned();assert.equal(row.command_id,f.commandId);const token='$receipt_'+randomUUID().replaceAll('-','')+'$',restore=constraintRestores.get(f.table),existing=restore?await readConstraint(f):null;
  if(restore&&existing)assert.deepEqual(existing,restore.original,'Unexpected replacement of owned CHECK');
  const needsWrite=evidenceHash(await readReceipt(f))!==evidenceHash(row);if(needsWrite&&f.table==='character_runtime_commands')assert.ok(triggerRestores.has(f.table),'Unknown owned immutable-row mutation');
  const update=needsWrite?`UPDATE ${f.table} SET response_version=${row.response_version},response_length=${row.response_length},response_sha256='${row.response_sha256}',response=${token}${JSON.stringify(row.response)}${token}::jsonb,response_payload=${row.response_payload_base64===null?'NULL':`decode('${row.response_payload_base64}','base64')`} WHERE ${where(f)};`:'';
  const add=restore&&!existing?`ALTER TABLE ${f.table} ADD CONSTRAINT ${restore.original.name} ${restore.original.definition}; ALTER TABLE ${f.table} VALIDATE CONSTRAINT ${restore.original.name};`:'';
  if(update||add)await adapter.query(mutationSQL(f,update+add));await verifyTrigger(f);
  assert.deepEqual(await readReceipt(f),row,'Owned row restoration differs');
  if(restore){assert.deepEqual(await readConstraint(f),restore.original,'Owned CHECK restoration differs');restore.proof.restored=true;}
 }
 const invariant=async f=>{
  safeId(f.userId);safeId(f.runId);
  return JSON.parse(await adapter.query(`SELECT json_build_object(
   'runs',(SELECT json_agg(to_jsonb(r) ORDER BY id) FROM roguelike_runs r WHERE user_id='${f.userId}'),
   'characters',(SELECT json_agg(to_jsonb(c) ORDER BY id) FROM characters_v3 c WHERE user_id='${f.userId}'),
   'events',(SELECT json_agg(to_jsonb(e) ORDER BY revision,id) FROM roguelike_combat_events e WHERE run_id IN (SELECT id FROM roguelike_runs WHERE user_id='${f.userId}')),
   'rogueReceipts',(SELECT json_agg(to_jsonb(r)-'response'-'response_payload'-'response_sha256'-'response_length'-'response_version' ORDER BY id) FROM roguelike_command_receipts r WHERE user_id='${f.userId}'),
   'characterReceipts',(SELECT json_agg(to_jsonb(c)-'response'-'response_payload'-'response_sha256'-'response_length'-'response_version' ORDER BY command_id) FROM character_runtime_commands c WHERE user_id='${f.userId}'));`));
 };
 const verified=new Set();
 return {
  execution:'docker',assertOwned:()=>adapter.assertOwned(),
  start:(role,policy)=>{assert.equal(policy.imageJobs,false);assert.equal(policy.frozenCatalogs,false);return adapter.start({role,compactReceipts:policy.compactReceipts,releaseId:binding[role].identities.backend.releaseId});},
  stop:()=>adapter.stopApplications(),observe:()=>adapter.observe(),workerCalls:()=>adapter.workerCalls(),
  fixtures:async()=>{await login();return [await battle(),await equipment()];},
  request:async f=>{
   const response=await adapter.request(f.route,{method:'POST',body:f.request,token:auth.player});
   if(response.status===200&&f.initial&&!verified.has(f.commandId)){
    if(f.table==='roguelike_command_receipts'){
     const run=response.body.run,state=run.combat_state,before=f.before.combat_state.world.actors[f.before.combat_state.characterId],after=state.world.actors[state.characterId];
     assert.equal(state.pendingD20Interrupt??null,null);assert.equal(run.revision,f.before.revision+1);
     const beforeResources=before.runtime.resources,afterResources=after.runtime.resources;
     const spent=Object.keys(beforeResources).filter(key=>typeof beforeResources[key]==='number'&&typeof afterResources[key]==='number'&&afterResources[key]<beforeResources[key]);
     for(const cost of f.declaredCost){assert.equal(typeof cost.resource,'string');assert.equal(afterResources[cost.resource],beforeResources[cost.resource]-Number(cost.amount??1));}
     assert.ok(spent.length,'Canonical saved influence must pay its declared resource');
     const beforeAmmo=before.runtime.inventory,afterAmmo=after.runtime.inventory,used=beforeAmmo.filter(row=>Number(afterAmmo.find(item=>item.cardId===row.cardId)?.qty??0)!==Number(row.qty));
     assert.equal(used.length,1);assert.equal(Number(afterAmmo.find(row=>row.cardId===used[0].cardId)?.qty??0),used[0].qty-1);
     initialEffects.push({table:f.table,kind:'canonical-paid-saved-roll-continuation',beforeHash:evidenceHash(before),afterHash:evidenceHash(after),paid:spent.map(key=>({resource:key,before:beforeResources[key],after:afterResources[key]})),ammunition:{before:used[0].qty,after:used[0].qty-1},pendingBefore:'roll_influence',pendingAfter:null});
    }else{
     assert.equal(response.body.replayed,false);const saved=await api(`/characters-v3/${f.characterId}`);
     assert.equal(saved.runtime_revision,f.before.runtime_revision+1);assert.ok(!Object.values(f.before.equipment??{}).includes(f.cardId));assert.ok(Object.values(saved.equipment??{}).includes(f.cardId));
     initialEffects.push({table:f.table,kind:'canonical-equipment-change',beforeHash:evidenceHash(f.before.equipment),afterHash:evidenceHash(saved.equipment),revisionBefore:f.before.runtime_revision,revisionAfter:saved.runtime_revision});
    }verified.add(f.commandId);
   }
   return response;
  },readReceipt,invariant,
  newCommand:async f=>{
   const run=(await api(`/roguelike/runs/${f.runId}`)).run;let request;
   if(f.table==='roguelike_command_receipts'){
    const state=run.combat_state,pending=state.world.pendingResolution?.request;let intent;
    if(state.pendingD20Interrupt)intent={type:'d20_interrupt',actorId:null};
    else if(state.pendingTriggeredAction)intent={type:'triggered_action',actionId:null};
    else if(pending?.type==='reaction')intent={type:'reaction',response:{kind:'reaction',actionId:null}};
    else if(pending?.type==='saving_throw')intent={type:'saving_throw'};
    else if(state.world.scene.initiative[state.world.scene.activeIndex]!==state.characterId)intent={type:'resume'};
    else {assert.equal(pending??null,null,'An unsupported saved pending phase requires its canonical continuation');intent={type:'end_turn',actorId:state.characterId};}
    offSelections.push({table:f.table,intentType:intent.type,pendingType:pending?.type??null});
    request=runCommand(run,'combat_intent',{intent});
   }
   else{const character=await api(`/characters-v3/${f.characterId}`),slot=Object.entries(character.equipment).find(([,id])=>id===f.cardId)?.[0];assert.ok(slot);request={command_id:randomUUID(),expected_runtime_revision:character.runtime_revision,roguelike_run_id:run.id,expected_run_revision:run.revision,operation:{unequip:slot}};}
   return {...f,initial:false,request,commandId:request.command_id};
  },
  corruptReceipt,restoreReceipt,initialEffects,offSelections,schemaFaults,triggerFaults,
 };
}
