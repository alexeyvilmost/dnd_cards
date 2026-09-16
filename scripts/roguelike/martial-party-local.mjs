import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const base='http://127.0.0.1:3001',out='outputs/martial-classes-256';
const credentials=JSON.parse(await readFile('outputs/party-maps-254/credentials.json','utf8'));
const auth=await(await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(credentials)})).json();assert(auth.token);
async function api(method,path,body,status=200){const r=await fetch(`${base}/api${path}`,{method,headers:{Authorization:`Bearer ${auth.token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const t=await r.text();assert.equal(r.status,status,t.slice(0,1000));return JSON.parse(t);}
const builds=JSON.parse(await readFile(`${out}/builds.json`,'utf8')).filter(b=>b.level===1);
const sources=[];
for(const b of builds){
 const {id,user_id,access_mode,runtime_revision,created_at,updated_at,...copy}=b.character;
 const created=await api('POST','/characters-v3',{...copy,name:`QA 256 mixed ${b.card} ${randomUUID().slice(0,5)}`},201);
 sources.push((created.character??created).id);
}
let run=(await api('POST','/roguelike/runs',{source_character_ids:sources},201)).run;
assert.equal(run.characters.length,2);assert.deepEqual(run.characters.map(c=>c.class_id).sort(),builds.map(b=>b.character.class_id).sort());
for(const type of ['start_encounter','initialize_combat']){
 const command={command_id:randomUUID(),expected_revision:run.revision,type,payload:{}};
 const accepted=await api('POST',`/roguelike/runs/${run.id}/commands`,command);
 assert.deepEqual(await api('POST',`/roguelike/runs/${run.id}/commands`,command),accepted);run=accepted.run;
}
assert.equal(run.combat_state.controlledCharacterIds.length,2);
assert(run.combat_state.battleMap?.generation);
const reloaded=(await api('GET',`/roguelike/runs/${run.id}`)).run;
assert.deepEqual(reloaded.combat_state,run.combat_state);
for(const b of builds){const c=await api('GET',`/characters-v3/${b.character.id}`);assert.equal((c.character??c).level,1);}
await writeFile(`${out}/mixed-party.json`,JSON.stringify({runId:run.id,characterIds:run.characters.map(c=>c.id),map:run.combat_state.battleMap,checks:['mixed Barbarian/Monk party','server-generated layout','reload and command idempotency','source characters remain level 1']},null,2));
console.log(JSON.stringify({runId:run.id,map:run.combat_state.battleMap.id,members:2}));
