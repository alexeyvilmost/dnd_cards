import {randomUUID,randomBytes} from 'node:crypto';
import {decodeReceiptStorage} from '../database/receipt-codec.mjs';
import {localAcceptanceContext} from '../testing/acceptance-context.mjs';
import {dockerCommand} from './rehearsal-command.mjs';

// Opaque process-local capability: callers cannot supply an arbitrary HTTP
// adapter, origin, serialized proof or a lookalike object to register users.
const authorizedRehearsals=new WeakMap();
function authorize(access){const capability=Object.freeze({kind:'owned-rehearsal'});authorizedRehearsals.set(capability,access);return capability;}
export async function authorizeNativeRehearsal(stack){
  const assertOwned=async()=>{
    const context=await localAcceptanceContext(stack.env);
    const marker=(await stack.database.query('SELECT current_database() || \':\' || run_id FROM test_run_ownership;',undefined,{sensitive:true})).trim().split(/\r?\n/).at(-1);
    if(marker!==`${context.registry.runId}:${context.registry.runId}`)throw Error('Native rehearsal database ownership differs');
    return context;
  };
  await assertOwned();
  const request=async(route,body,bearer,method=body?'POST':'GET')=>{
    const context=await assertOwned();
    const response=await context.request(`/api${route}`,{method,headers:{'content-type':'application/json',...(bearer?{authorization:`Bearer ${bearer}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
    if(![200,201].includes(response.status))throw Error(`Owned canonical API returned HTTP ${response.status}`);
    return response.json();
  };
  return authorize({assertOwned,request});
}
export async function authorizeDockerRehearsal({names,owner}){
  if(!/^rehearsal_[a-f0-9]{24}$/.test(owner??'')||names?.postgres!==`${owner}_db`||names.backend!==`${owner}_api`||names.rulesWorker!==`${owner}_worker`||names.network!==`${owner}_net`)throw Error('Generated Docker rehearsal ownership required');
  const assertOwned=async()=>{
    const endpoint=JSON.parse(await dockerCommand(['context','inspect','--format','{{json .Endpoints.docker.Host}}']));
    if(!/^(unix:\/\/|npipe:\/\/)/.test(endpoint)||process.env.DOCKER_HOST||process.env.DOCKER_CONTEXT)throw Error('Default local Docker daemon required');
    const network=JSON.parse(await dockerCommand(['network','inspect',names.network]))[0];
    if(network.Internal!==true||network.Labels?.['bagofholding.rehearsal']!==owner)throw Error('Owned internal rehearsal network required');
    let backend;
    for(const name of [names.postgres,names.backend,names.rulesWorker]){
      const container=JSON.parse(await dockerCommand(['container','inspect',name]))[0];
      if(container.Config?.Labels?.['bagofholding.rehearsal']!==owner||container.State?.Running!==true||Object.keys(container.NetworkSettings?.Networks??{}).join()!==names.network
        ||Object.values(container.NetworkSettings?.Ports??{}).some(ports=>ports?.length))throw Error('Application is not confined to the owned clone network');
      if(name===names.backend)backend=container;
      if(name===names.postgres&&!container.NetworkSettings.Networks[names.network].Aliases?.includes('postgres'))throw Error('Clone database alias differs');
    }
    const entries=backend.Config.Env.filter(value=>value.startsWith('DATABASE_URL='));
    if(entries.length!==1)throw Error('One explicit clone database required');
    const target=new URL(entries[0].slice('DATABASE_URL='.length));
    if(target.protocol!=='postgres:'||target.hostname!=='postgres'||target.port!=='5432'||target.pathname!=='/rehearsal'||target.username!=='rehearsal'||target.search!=='?sslmode=disable'||target.hash)throw Error('Rehearsal backend does not target the owned clone');
    if((await dockerCommand(['exec',names.postgres,'psql','-X','-qAt','-U','rehearsal','-d','rehearsal','-c','SELECT current_database();'])).trim()!=='rehearsal')throw Error('Clone database identity differs');
  };
  await assertOwned();
  const program=`process.stdin.setEncoding('utf8');let raw='';for await(const c of process.stdin)raw+=c;const r=JSON.parse(raw);const response=await fetch('http://backend:8080/api'+r.route,{method:r.method,headers:r.headers,body:r.body===undefined?undefined:JSON.stringify(r.body),signal:AbortSignal.timeout(60000)});const data=await response.json();process.stdout.write(JSON.stringify({status:response.status,data}));`;
  const request=async(route,body,bearer,method=body?'POST':'GET')=>{
    await assertOwned();
    const result=JSON.parse(await dockerCommand(['exec','-i',names.rulesWorker,'node','--input-type=module','-e',program],{input:JSON.stringify({route,body,method,headers:{'content-type':'application/json',...(bearer?{authorization:`Bearer ${bearer}`}:{})}})}));
    if(![200,201].includes(result.status))throw Error(`Owned canonical API returned HTTP ${result.status}`);
    return result.data;
  };
  return authorize({assertOwned,request});
}

export function acceptedReceiptReplay(receipt) {
  const response=decodeReceiptStorage({...receipt,response_version:receipt.response_version??1,payload_hex:receipt.response_payload?receipt.response_payload.replace(/^\\x/,''):null});
  if(!Number.isSafeInteger(response?.run?.revision)||response.run.revision<1||!receipt.request||typeof receipt.request!=='object')throw Error('Receipt cannot prove its original accepted command');
  return {response,body:{command_id:receipt.command_id,expected_revision:response.run.revision-1,type:receipt.command_type,payload:receipt.request}};
}

// This runs only against the adapter's disposable restored clone. The normal
// API creates a new owner and character; no saved encounter/entropy is patched.
export async function createRehearsalAccount(capability,{label}) {
  if(!authorizedRehearsals.has(capability))throw Error('Live owned rehearsal capability required before registration');
  const access=authorizedRehearsals.get(capability);await access.assertOwned();
  const request=access.request;
  const suffix=randomBytes(8).toString('hex'),username=`rehearsal_${suffix}`;
  const password=randomBytes(32).toString('hex');
  await request('/auth/register',{username,email:`${username}@example.invalid`,password,display_name:label});
  const auth=await request('/auth/login',{username,password});
  if(typeof auth.token!=='string')throw Error('Canonical clone registration failed');
  return {username,password,token:auth.token};
}

export async function createCanonicalPendingScenario(capability,{label}) {
  const {username,token}=await createRehearsalAccount(capability,{label}),auth={token};
  const request=authorizedRehearsals.get(capability).request;
  const call=(route,body)=>request(route,body,auth.token);
  const catalog=await call('/character-templates');
  const template=catalog.templates?.find(row=>row.preset_key==='archer');
  if(!template)throw Error('Canonical archer template required for candidate rehearsal');
  let character=await call(`/character-templates/${template.id}/copies`,{name:label});
  // A normal user-owned sheet edit supplies the generic declared roll resource.
  // The authoritative engine decides whether/when to offer any influence.
  character=await request(`/characters-v3/${character.id}`,{...character,resources:{...character.resources,heroic_inspiration:1},max_resources:{...character.max_resources,heroic_inspiration:1}},auth.token,'PUT');
  let run=(await call('/roguelike/runs',{source_character_id:character.id})).run;
  const command=async(type,payload={})=>{const body={command_id:randomUUID(),expected_revision:run.revision,type,payload};run=(await call(`/roguelike/runs/${run.id}/commands`,body)).run;return body;};
  await command('start_encounter');await command('initialize_combat');
  for(let i=0;i<50;i++){
    const state=run.combat_state;let intent;
    if(state.pendingAlertSwapActorIds?.length)intent={type:'alert_swap',actorId:state.pendingAlertSwapActorIds[0],allyActorId:null};
    else if(state.pendingD20Interrupt)intent={type:'d20_interrupt',actorId:null};
    else if(state.pendingTriggeredAction)intent={type:'triggered_action',actionId:null};
    else if(state.world.pendingResolution?.request.type==='reaction')intent={type:'reaction',response:{kind:'reaction',actionId:null}};
    else if(state.world.pendingResolution?.request.type==='saving_throw')intent={type:'saving_throw'};
    else if(state.world.scene.initiative[state.world.scene.activeIndex]!==state.characterId)intent={type:'resume'};
    if(!intent)break;
    await command('combat_intent',{intent});
  }
  const state=run.combat_state;
  if(state.world.scene.initiative[state.world.scene.activeIndex]!==state.characterId)throw Error('Canonical fixture did not reach player turn');
  const action=state.catalogActions.find(row=>row.mechanics?.primitive?.type==='weapon_attack'&&row.mechanics.effects?.some(effect=>effect.attack_kind==='weapon_ranged'));
  const target=Object.values(state.world.actors).find(row=>row.kind==='monster'&&row.runtime.hp.current>0);
  if(!action||!target)throw Error('Canonical attack declaration or target absent');
  await command('combat_intent',{intent:{type:'approach_action',actorId:state.characterId,actionId:action.id,targetActorId:target.id}});
  if(run.combat_state.pendingD20Interrupt?.operation!=='roll_influence')throw Error('Canonical fixture did not produce durable roll choice');
  return {id:run.id,user_id:run.user_id,username,held:run.combat_state.pendingD20Interrupt,request:(suffix,body)=>call(`/roguelike/runs/${run.id}${suffix}`,body)};
}
