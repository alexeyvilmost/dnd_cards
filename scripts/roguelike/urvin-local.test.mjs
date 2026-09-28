// Explicit local-only integration harness. Uses an isolated QA account and
// newly copied templates; never mutates existing characters or production.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
const base='http://127.0.0.1:3001';
assert(new URL(base).hostname==='127.0.0.1');
const out=new URL('../../outputs/urvin-273/',import.meta.url);
await mkdir(out,{recursive:true});
let access;
try{access=JSON.parse(await readFile(new URL('access.json',out),'utf8'));}catch{
  access={username:`urvin_qa_${randomBytes(5).toString('hex')}`,password:randomBytes(32).toString('base64url')};
  const registered=await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...access,email:access.username+'@example.test',display_name:'Урвин · локальная проверка'})});
  assert.equal(registered.status,201,await registered.text());
  await writeFile(new URL('access.json',out),JSON.stringify(access));
}
const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(access)});
assert(login.ok);const auth=await login.json();
export const qaUserId=auth.user.id;
export async function api(path,method='GET',body,status=200){
  const r=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',Authorization:`Bearer ${auth.token}`},...(body?{body:JSON.stringify(body)}:{})});
  const value=await r.json();assert.equal(r.status,status,`${method} ${path}: ${JSON.stringify(value)}`);return value;
}
export async function command(run,type,payload={},status=200,id=randomUUID()){
  return api(`/roguelike/runs/${run.id}/commands`,'POST',{type,payload,command_id:id,expected_revision:run.revision},status);
}
const {mode}=await api('/roguelike/runs/modes');assert.equal(mode.auras.length,5);
const {templates}=await api('/character-templates');assert(templates.length>=3);
const created=[];
const sourceIds=[];
for(const aura of mode.auras){
  const source=await api(`/character-templates/${templates[0].id}/copies`,'POST',{name:`Урвин QA · ${aura.key}`},201);
  const second=await api(`/character-templates/${templates[1].id}/copies`,'POST',{name:`Урвин QA · союзник ${aura.key}`},201);
  sourceIds.push(source.id,second.id);
  const sources=aura.key==='solitude'?[source.id]:[source.id,second.id];
  if(aura.key==='solitude')await api('/roguelike/runs','POST',{source_character_ids:[source.id,second.id],mode:'urvin',aura_id:aura.id},400);
  const {run}=await api('/roguelike/runs','POST',{source_character_ids:sources,mode:'urvin',aura_id:aura.id},201);
  assert.equal(run.mode,'urvin');assert.equal(run.journey.aura.id,aura.id);assert.equal(run.journey.nodes.length,43);
  assert(run.characters.every(c=>c.active_effects.some(e=>e.id===aura.id)));
  for(const key of ['mode_rules','journey_private','run_seed','checkpoint','combat_envelope'])assert(!(key in run));
  created.push({key:aura.key,id:run.id,character_id:run.character_id,gold:run.gold});
}
assert.equal(created.find(r=>r.key==='wealth').gold-created.find(r=>r.key==='ferocity').gold,200);
let {run}=await api('/roguelike/runs/'+created[0].id);
for(const type of ['start_encounter','long_rest','short_rest','buy','victory'])await command(run,type,{},409);
await command(run,'enter_room',{node_id:'r14-l0'},409);
const id=randomUUID(),before=run;
({run}=await command(run,'enter_room',{node_id:'r0-l0'},200,id));
assert.equal(run.phase,'combat');assert.deepEqual(await command(before,'enter_room',{node_id:'r0-l0'},200,id),{run});
({run}=await command(run,'initialize_combat'));
assert(run.combat_state);assert(run.combat_state.battleMap.id.startsWith('urvin-'));
const again=(await api('/roguelike/runs/'+run.id)).run;
assert.deepEqual(again.combat_state,run.combat_state);
const evidence={created,sourceIds,battle:run.id,checks:['5 auras created','solitude party rejected','wealth +200 once','private saves not exposed','room gates','adjacency enforced','duplicate command replay','combat initialized on generated arena','combat survives reload']};
await writeFile(new URL('integration.json',out),JSON.stringify(evidence,null,2));
console.log(JSON.stringify(evidence,null,2));
