import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const {chromium}=require('@playwright/test');
const base='http://127.0.0.1:3001',out='outputs/party-maps-254';
const credentials=JSON.parse(await readFile('outputs/party-maps-254/credentials.json','utf8'));
const auth=await(await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:credentials.username,password:credentials.password})})).json();
assert(auth.token);
const timings=[];
const api=async(method,path,body)=>{const start=performance.now();const response=await fetch(`${base}/api${path}`,{method,headers:{Authorization:`Bearer ${auth.token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const text=await response.text();timings.push({operation:body?.payload?.intent?.type??body?.type??path,ms:performance.now()-start,bytes:text.length});assert(response.ok,text.slice(0,500));return JSON.parse(text);};
const template=(await api('GET','/character-templates')).templates.find(t=>t.preset_key==='swordsman');
const character=await api('POST',`/character-templates/${template.id}/copies`,{name:`QA перемещение ${randomUUID().slice(0,6)}`});
let run=(await api('POST','/roguelike/runs',{source_character_id:character.id})).run;
const command=async(type,payload={})=>run=(await api('POST',`/roguelike/runs/${run.id}/commands`,{command_id:randomUUID(),expected_revision:run.revision,type,payload})).run;
await command('start_encounter');await command('initialize_combat');
const browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();
try{
 await page.goto(base);
 const wholeRoute=process.argv[2]==='route';
 for(let n=0;n<(wholeRoute?1:6);n++){
  const state=run.combat_state;if(state.outcome!=='active'||state.world.pendingResolution||state.pendingD20Interrupt)break;
  const route=await page.evaluate(async ({s,feet})=>{const {reachableRoutes}=await import('/src/solo-combat/tacticalGrid.ts');return reachableRoutes(s,s.characterId,feet).sort((a,b)=>b.costFt-a.costFt)[0];},{s:state,feet:wholeRoute?30:5});
  if(!route)break;await command('combat_intent',{intent:{type:'move',actorId:state.characterId,destination:route.destination}});
 }
 await mkdir(out,{recursive:true});await writeFile(`${out}/movement-http-${process.argv[2]??'before'}.json`,JSON.stringify({runID:run.id,timings},null,2));console.log(JSON.stringify({runID:run.id,timings},null,2));
}finally{await browser.close();}
