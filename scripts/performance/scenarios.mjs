import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {isDeepStrictEqual} from 'node:util';

export const digest = value => `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
export function assertSame(actual,expected,message) { if(!isDeepStrictEqual(actual,expected))throw Error(message); }
function numeric(raw) {
  try {const values=JSON.parse(raw||'{}');return Object.fromEntries(Object.entries(values).filter(([key,value])=>/^[a-z][a-z0-9_]{0,63}$/.test(key)&&typeof value==='number'&&Number.isFinite(value)&&value>=0));}
  catch {return {};}
}

/** Uses only the runner-owned context's guarded local HTTP client. Samples
 * contain numbers, hashes and fixed scenario names, never bodies or auth. */
export async function createScenarioAPI(context,{role='player',onSample=()=>{}}={}) {
  let token;
  async function request(method,resource,body,{status=200,scenario,cacheCondition='warm_process',trace=true}={}) {
    const requestId=randomUUID(),serialized=body===undefined?undefined:JSON.stringify(body);
    const start=performance.now();
    const response=await context.request(`/api${resource}`,{method,headers:{'content-type':'application/json','x-request-id':requestId,
      ...(trace?{'x-performance-trace':'1'}:{}),...(token?{authorization:`Bearer ${token}`}:{})},body:serialized});
    const headersAt=performance.now(),raw=await response.text(),bodyAt=performance.now();
    let data;try{data=JSON.parse(raw);}catch{throw Error('Local service returned non-JSON; body omitted');}const parsedAt=performance.now();
    assert.equal(response.status,status,`Unexpected HTTP status for ${scenario||'fixture setup'} (code=${typeof data.code==='string'?data.code.slice(0,80):'absent'})`);
    assert.equal(response.headers.get('x-request-id'),requestId,'Backend correlation differs from the client request ID');
    if(scenario) await onSample({scenario,cacheCondition,requestId,status:response.status,
      client_headers_ms:headersAt-start,client_body_read_ms:bodyAt-headersAt,client_parse_ms:parsedAt-bodyAt,client_total_ms:parsedAt-start,
      request_bytes:serialized?Buffer.byteLength(serialized):0,response_bytes:Buffer.byteLength(raw),
      phases:numeric(response.headers.get('x-performance-metrics'))});
    return data;
  }
  const auth=await context.authenticate(role);token=auth.token;
  return {request,user:auth.user,auth,context};
}

export async function createRunFixture(context,{partySize=1,onSample,preset='line',api,onCommandPlan=()=>{}}={}) {
  assert.ok([1,2,6].includes(partySize),'Measured party size must be 1, 2 or 6');
  api??=await createScenarioAPI(context,{onSample});
  const catalog=await api.request('GET','/character-templates');
  const template=catalog.templates.find(row=>row.preset_key===preset);
  assert.ok(template,'Supported canonical template missing');
  const sources=[];
  for(let i=0;i<partySize;i++) sources.push(await api.request('POST',`/character-templates/${template.id}/copies`,{name:`Performance fixture ${i+1}`},{status:201}));
  const sourceBefore=await Promise.all(sources.map(row=>api.request('GET',`/characters-v3/${row.id}`)));
  let run=(await api.request('POST','/roguelike/runs',partySize===1?{source_character_id:sources[0].id}:{source_character_ids:sources.map(row=>row.id)},{status:201})).run;
  return connectRunFixture(api,{run,sources,sourceBefore,partySize,onCommandPlan});
}

function connectRunFixture(api,{run,sources,sourceBefore,partySize,onCommandPlan=()=>{}}) {
  const initialRevision=run.revision;
  const command=async(type,payload={},options={})=>{
    const previous=run.revision,body=options.commandRequest??{command_id:randomUUID(),expected_revision:previous,type,payload};
    assert.equal(body.expected_revision,previous,'Recorded command revision differs from restored fixture');
    assert.equal(body.type,type);assertSame(body.payload,payload,'Recorded payload differs');
    await onCommandPlan(structuredClone(body));
    const result=await api.request('POST',`/roguelike/runs/${run.id}/commands`,body,options);
    assert.equal(result.run.revision,previous+1,`${type} did not commit exactly one run revision`);
    const invariant=await api.context.readRunInvariant?.(run.id);
    const retry=await api.request('POST',`/roguelike/runs/${run.id}/commands`,body);
    assertSame(retry,result,`${type} exact retry changed its saved outcome`);
    if(invariant)assertSame(await api.context.readRunInvariant(run.id),invariant,`${type} retry changed private RNG/pinning/envelope`);
    run=result.run;
    return {result,commandId:body.command_id,outcomeHash:digest(result),invariant};
  };
  return {api,partySize,sources,initialRevision,get run(){return run;},command,
    verify:async()=>{
      const restored=(await api.request('GET',`/roguelike/runs/${run.id}`)).run;
      assertSame(restored.combat_state,run.combat_state,'Reload changed combat state');
      assert.equal(restored.revision,run.revision,'Reload changed run revision');
      assertSame(await Promise.all(sources.map(row=>api.request('GET',`/characters-v3/${row.id}`))),sourceBefore,'Run changed source sheets');
      return {runId:run.id,revision:run.revision,outcomeHash:digest(restored),sourceUnchanged:true,exactRetry:true};
    }};
}

/** Attach only to a restored, runner-owned synthetic run through the guarded
 * local context. Restoring rows itself belongs to the stand owner. */
export async function attachRunFixture(context,{runId,onSample,onCommandPlan}={}) {
  assert.match(runId,/^[a-f0-9-]{36}$/i);
  const api=await createScenarioAPI(context,{onSample});
  const run=(await api.request('GET',`/roguelike/runs/${runId}`)).run;
  assert.ok(run.source_character_id,'Recorded run must retain its source');
  const sources=[await api.request('GET',`/characters-v3/${run.source_character_id}`)];
  assert.equal((run.characters??[run.character]).filter(Boolean).length,1,'Cross-DB attachment currently supports a solo fixture');
  return connectRunFixture(api,{run,sources,sourceBefore:structuredClone(sources),partySize:1,onCommandPlan});
}

/** Reusable DB-01 driver: real authoritative turn commands, real receipts and
 * journal rows. Supply an existing fixture to take a DB snapshot after setup. */
export async function runCommandSeries(context,{count=100,partySize=1,fixture,onSample=()=>{},onProgress=()=>{},commandPlan}={}) {
  assert.ok(Number.isSafeInteger(count)&&count>0&&count<=10000,'Command count must be 1..10000');
  fixture??=await createRunFixture(context,{partySize,onSample});
  if(commandPlan)assert.equal(commandPlan.length,count,'Recorded plan length differs from command count');
  const before=fixture.run.revision,outcomes=[];
  for(let i=0;i<count;i++) {
    const outcome=await fixture.command('camp_turn',{}, {scenario:`camp_turn_party_${fixture.partySize}`,commandRequest:commandPlan?.[i]});
    outcomes.push(outcome.outcomeHash);
    if((i+1)%10===0)await onProgress(i+1,count);
  }
  assert.equal(fixture.run.revision,before+count);
  return {commandCount:count,committedCommands:count,replayRequests:count,partySize:fixture.partySize,beforeRevision:before,afterRevision:fixture.run.revision,
    commandOutcomeDigest:digest(outcomes),verification:await fixture.verify()};
}

export async function runCombatLatency(context,{repetitions=30,partySizes=[1,2,6],onSample=()=>{},onProgress=()=>{}}={}) {
  assert.ok(Number.isSafeInteger(repetitions)&&repetitions>0&&repetitions<=100);
  const outcomes=[],api=await createScenarioAPI(context,{onSample});
  for(const partySize of partySizes) for(let i=0;i<repetitions;i++) {
    const fixture=await createRunFixture(context,{partySize,api});
    await fixture.command('start_encounter');
    const initialized=await fixture.command('initialize_combat',{}, {scenario:`combat_initialize_party_${partySize}`,cacheCondition:'fresh_catalog_existing_process'});
    assert.ok(fixture.run.combat_state,'Real worker did not initialize combat');
    outcomes.push({scenario:`combat_initialize_party_${partySize}`,outcomeHash:initialized.outcomeHash,invariant:initialized.invariant,
      map:{width:fixture.run.combat_state.battleMap?.width??12,height:fixture.run.combat_state.battleMap?.height??10},...await fixture.verify()});
    // The canonical server state chooses the current player. Never fabricate
    // a client result or mutate the persisted world to keep a benchmark running.
    const state=fixture.run.combat_state;
    const actor=state.world?.scene?.initiative?.[state.world?.scene?.activeIndex];
    const playerIds=(fixture.run.characters??[fixture.run.character]).filter(Boolean).map(row=>row.id);
    assert.ok(playerIds.includes(actor),'Opening did not reach a player turn; scenario needs an explicit pending-decision policy');
    const actorId=actor;
    const continued=await fixture.command('combat_intent',{intent:{type:'end_turn',actorId}}, {scenario:`combat_continue_party_${partySize}`});
    outcomes.push({scenario:`combat_continue_party_${partySize}`,outcomeHash:continued.outcomeHash,invariant:continued.invariant,...await fixture.verify()});
    await onProgress({partySize,iteration:i+1,repetitions});
  }
  return outcomes;
}

export function summarize(samples) {
  return Object.fromEntries([...new Set(samples.map(row=>row.scenario))].map(scenario=>{
    const group=samples.filter(row=>row.scenario===scenario),values=group.map(row=>row.client_total_ms).sort((a,b)=>a-b);
    const quantile=p=>values[Math.min(values.length-1,Math.ceil(values.length*p)-1)];
    return [scenario,{count:values.length,median_ms:quantile(.5),p95_ms:quantile(.95),p95_preliminary:values.length<100,
      min_ms:values[0],max_ms:values.at(-1),phase_means:Object.fromEntries([...new Set(group.flatMap(row=>Object.keys(row.phases)))].sort().map(key=>[key,group.reduce((sum,row)=>sum+(row.phases[key]??0),0)/group.length]))}];
  }));
}
