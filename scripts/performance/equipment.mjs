import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {createScenarioAPI,digest,assertSame} from './scenarios.mjs';
const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const {build}=require('esbuild');
const endpoints={race:'races',class:'classes',background:'backgrounds',feat:'feats',effect:'effects',action:'actions',spell:'spells',card:'cards',resource:'resources'};

async function allRows(api,endpoint,query='') {
  const rows=[];
  for(let page=1;page<=100;page++) {
    const result=await api.request('GET',`/${endpoint}?page=${page}&limit=1000${query}`);
    const batch=Array.isArray(result)?result:result[endpoint];assert.ok(Array.isArray(batch),`Missing ${endpoint} array`);
    rows.push(...batch);
    const pages=result.total_pages??(result.total&&result.limit?Math.ceil(result.total/result.limit):1);
    if(page>=pages)return rows;
  }
  throw Error('Catalog pagination exceeds fixture limit');
}

export async function runEquipmentLatency(context,{repetitions=30,onSample=()=>{},output=context.output,intent=false}={}) {
  const bundle=path.join(output,'equipment-bridge.mjs');
  await build({entryPoints:[fileURLToPath(new URL('./equipment-bridge.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',outfile:bundle,logLevel:'silent'});
  const {prepareEquipment}=await import(pathToFileURL(bundle).href);
  const api=await createScenarioAPI(context,{onSample}),admin=await createScenarioAPI(context,{role:'admin'});
  const template=(await api.request('GET','/character-templates')).templates.find(row=>row.preset_key==='line');assert.ok(template);
  const source=await api.request('POST',`/character-templates/${template.id}/copies`,{name:'Performance equipment fixture'},{status:201});
  const cards=[];
  for(const resource of [false,true]) cards.push(await admin.request('POST','/cards',{
    name:resource?'Local capacity ring':'Local ordinary ring',description:'Disposable performance fixture',rarity:'common',type:'ring',weight:0.1,
    mechanics:resource?{activation:{mode:'passive',while:'equipped'},effects:[{resolution:'auto',result:[{kind:'resource',op:'grant',id:'local_perf_capacity',amount:3}]}]}:{},
  },{status:201}));
  await admin.request('PATCH',`/characters-v3/${source.id}/runtime`,{expected_runtime_revision:source.runtime_revision,
    inventory_items:[...(source.inventory_items??[]),...cards.map(card=>({card_id:card.id,qty:1}))]});
  const run=(await api.request('POST','/roguelike/runs',{source_character_id:source.id},{status:201})).run;
  const sourceBefore=await api.request('GET',`/characters-v3/${source.id}`);
  const catalog={schemaVersion:1,entities:Object.fromEntries(Object.keys(endpoints).map(key=>[key,[]])),variables:[],variablesComplete:false,completeEffectTypes:[]};
  const byType=new Map();
  async function fulfill(need) {
    if(need.kind==='variables'){catalog.variables=await allRows(api,'variables');catalog.variablesComplete=true;return;}
    if(need.kind==='effect_type'){
      const rows=await allRows(api,'effects',`&type=${encodeURIComponent(need.effectType)}`);
      for(const row of rows)if(!catalog.entities.effect.some(entry=>entry.id===row.id))catalog.entities.effect.push(row);
      catalog.completeEffectTypes.push(need.effectType);return;
    }
    const endpoint=endpoints[need.entityType];assert.ok(endpoint);
    let row;
    if(/^[0-9a-f-]{36}$/i.test(need.reference))row=await api.request('GET',`/${endpoint}/${need.reference}`);
    else {
      if(!byType.has(endpoint))byType.set(endpoint,await allRows(api,endpoint));
      const matches=byType.get(endpoint).filter(row=>[row.id,row.card_number,row.resource_id].includes(need.reference));
      assert.equal(matches.length,1,'Fixture reference must resolve uniquely');row=matches[0];
    }
    if(!catalog.entities[need.entityType].some(entry=>entry.id===row.id))catalog.entities[need.entityType].push(row);
  }
  const outcomes=[];
  for(const [index,card] of cards.entries())for(let iteration=-1;iteration<repetitions;iteration++)for(const mode of ['equip','unequip']) {
    const character=await api.request('GET',`/characters-v3/${run.character_id}`),commandId=randomUUID();
    const slot=Object.entries(character.equipment??{}).find(([,id])=>id===card.id)?.[0];
    if(mode==='unequip')assert.ok(slot,'Previous command did not equip the test item');
    const operation=mode==='equip'?{equip:card.id}:{unequip:slot};
    const start=performance.now();let prepared;
    for(let round=0;round<32;round++){
      prepared=await prepareEquipment(character,catalog,commandId,operation);
      if(prepared.status==='ready')break;
      for(const need of prepared.needs)await fulfill(need);
    }
    assert.equal(prepared.status,'ready');
    const prepareMs=performance.now()-start;
    const request=intent ? {command_id:commandId,expected_runtime_revision:character.runtime_revision,
      roguelike_run_id:run.id,expected_run_revision:run.revision,operation}
      : {...prepared.request,roguelike_run_id:run.id,roguelike_intent:'camp'};
    const endpoint=intent ? `/characters-v3/${run.character_id}/equipment-commands` : '/characters-v3/runtime-commands';
    const scenario=`equipment_${index?'resource':'ordinary'}_${mode}`;
    const result=await api.request('POST',endpoint,request,{...(iteration>=0?{scenario}:{})});
    const retry=await api.request('POST',endpoint,request);
    assert.equal(retry.replayed,true);
    assertSame({...retry,replayed:false},result,'Equipment retry changed state/resources');
    const saved=await api.request('GET',`/characters-v3/${run.character_id}`);
    assert.equal(saved.runtime_revision,character.runtime_revision+1);
    const equipped=Object.values(saved.equipment??{}).includes(card.id);
    assert.equal(equipped,mode==='equip');
    const patch=prepared.request.participants[0].patch;
    assertSame(saved.resources,patch.resources,'Saved resources differ from the canonical command');
    assertSame(saved.max_resources,patch.max_resources,'Saved capacities differ from the canonical command');
    if(intent&&index)assert.equal(saved.max_resources.local_perf_capacity??0,mode==='equip'?3:0,'Intent grant capacity lags equipment');
    // Historical compatibility baselines retained this diagnostic flag while
    // exposing the pre-fix drift; the authoritative path requires alignment.
    outcomes.push({scenario,iteration,warmup:iteration<0,client_prepare_ms:prepareMs,contentManifestHash:prepared.contentManifestHash,
      outcomeHash:digest(result),exactRetry:true,...(index?{observed_capacity:saved.max_resources.local_perf_capacity??0,
        resourcePlacementProjectionAligned:(saved.max_resources.local_perf_capacity??0)===(mode==='equip'?3:0)}:{})});
  }
  assertSame(await api.request('GET',`/characters-v3/${source.id}`),sourceBefore,'Equipment changed the source character');
  return {authority:intent?'server_intent':'compatibility',committedCommands:outcomes.length,replayRequests:outcomes.length,outcomes,catalogHash:digest(catalog),sourceIsolated:true};
}
