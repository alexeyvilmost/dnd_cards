import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const base='http://127.0.0.1:3001/api';
const creds=JSON.parse(await readFile('outputs/party-maps-254/credentials.json','utf8'));
const login=await(await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(creds)})).json();assert(login.token);
async function api(path,method='GET',body){const r=await fetch(base+path,{method,headers:{Authorization:`Bearer ${login.token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();assert(r.ok,JSON.stringify({status:r.status,error:data.error}));return data}
const templates=(await api('/character-templates')).templates;
const sources=[];
for(const [index,currency] of [{gold:5,silver:4,copper:3},{gold:1,silver:2,copper:9}].entries()){
 const source=await api(`/character-templates/${templates[index].id}/copies`,'POST',{name:`QA монеты группы ${index} ${Date.now()}`});
 await api(`/characters-v3/${source.id}/runtime`,'PATCH',{currency,expected_runtime_revision:source.runtime_revision});sources.push(source.id);
}
const run=(await api('/roguelike/runs','POST',{source_character_ids:sources})).run;
const total=c=>(c.gold??0)*100+(c.silver??0)*10+(c.copper??0);
assert.equal(total(run.character.currency),672);assert.equal(run.gold,6);assert.equal(run.character.currency.silver,7);assert.equal(run.character.currency.copper,2);
assert.equal(run.characters.filter(c=>c.id!==run.character_id).reduce((n,c)=>n+total(c.currency),0),0);
const reloaded=(await api(`/roguelike/runs/${run.id}`)).run;assert.equal(total(reloaded.character.currency),672);
await writeFile('outputs/shop-cart-259/party-money.json',JSON.stringify({runId:run.id,totalCopper:672,check:'mixed-denomination party purse is conserved; other wallets empty; reload stable'},null,2));console.log('PASS: party purse 5g4s3c + 1g2s9c = 6g7s2c, no duplicated coins');
