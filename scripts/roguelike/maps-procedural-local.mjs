// Local browser acceptance; only fresh QA-owned sheets/runs are mutated.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const {chromium,expect}=require('@playwright/test');
const base='http://127.0.0.1:3001',out='outputs/maps-procedural-256';
await mkdir(out,{recursive:true});
const credentials=JSON.parse(await readFile('outputs/party-maps-254/credentials.json','utf8'));
const auth=await(await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(credentials)})).json();
assert(auth.token);
const api=async(method,path,body,status=200)=>{
 const r=await fetch(`${base}/api${path}`,{method,headers:{Authorization:`Bearer ${auth.token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 const data=await r.json();assert.equal(r.status,status,JSON.stringify(data).slice(0,1000));return data;
};
const t=(await api('GET','/character-templates')).templates[0];
const c=await api('POST',`/character-templates/${t.id}/copies`,{name:`QA карты 256 ${randomUUID().slice(0,6)}`},201);
let run=(await api('POST','/roguelike/runs',{source_character_id:c.id},201)).run;
for(const type of ['start_encounter','initialize_combat'])run=(await api('POST',`/roguelike/runs/${run.id}/commands`,{command_id:randomUUID(),expected_revision:run.revision,type,payload:{}})).run;
assert(run.combat_state.battleMap.generation,'new encounter must use seeded layout');
const reloaded=(await api('GET',`/roguelike/runs/${run.id}`)).run;
assert.deepEqual(reloaded.combat_state.battleMap,run.combat_state.battleMap);
await writeFile(`${out}/run.json`,JSON.stringify(run));
const report={runId:run.id,checks:['server-owned generated map survives reload'],maps:[],errors:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1100},ignoreHTTPSErrors:true});
page.on('pageerror',e=>report.errors.push(e.message));
try{
 await page.addInitScript(({token,user})=>{localStorage.setItem('auth_token',token);localStorage.setItem('user',JSON.stringify(user));localStorage.setItem('boh:mobile-suggestion-dismissed','1');},auth);
 await page.goto(`${base}/characters-v3/${run.character_id}/combat?roguelike=${run.id}`);
 await expect(page.locator('.battle-map-scenery')).toBeVisible({timeout:40000});
 await page.screenshot({path:`${out}/real-combat.png`,fullPage:true});
 await page.goto(base);
 await page.evaluate(async state=>{
  const React=(await import('/node_modules/.vite/deps/react.js')).default,client=await import('/node_modules/.vite/deps/react-dom_client.js');
  const {default:Map}=await import('/src/components/TacticalBattleMap.tsx');await import('/src/pages/SoloCombatPage.css');
  const {installBattleMap,BATTLE_MAPS}=await import('/src/solo-combat/battleMaps.ts');
  const host=document.createElement('div');host.style.cssText='position:fixed;inset:0;background:#101510;z-index:1000;padding:24px;overflow:auto';document.body.append(host);
  const root=(client.createRoot??client.default.createRoot)(host);
  window.mapQA={count:BATTLE_MAPS.length,async show(index,seed){
   const scene=installBattleMap(structuredClone(state),index,seed);
   await Promise.all([scene.battleMap.background,'/assets/battle-maps/masonry-atlas-v2.png','/assets/battle-maps/table-v2.png','/assets/battle-maps/props-atlas-v1.png'].map(src=>new Promise((resolve,reject)=>{const img=new Image();img.onload=resolve;img.onerror=()=>reject(Error(src));img.src=src;})));
   root.render(React.createElement(Map,{key:`${index}:${seed}`,state:scene,actorId:scene.characterId,selectedActionId:null,movementMode:false,onCell:()=>{}}));
   return {id:scene.battleMap.id,name:scene.battleMap.name};
  }};
 },run.combat_state);
 const count=await page.evaluate(()=>window.mapQA.count);assert.equal(count,8);
 for(let i=0;i<count;i++)for(const seed of [null,123]){
  const map=await page.evaluate(({i,seed})=>window.mapQA.show(i,seed??undefined),{i,seed});
  await expect(page.locator('.tactical-map-legend summary')).toContainText(map.name);
  await expect(page.locator('.battle-map-scenery')).toBeVisible();
  assert(await page.locator('.battle-map-feature__sprite').evaluateAll(rows=>rows.every(el=>el.getAttribute('preserveAspectRatio')==='xMidYMid meet')));
  if(i===2)await expect(page.locator('[data-feature-id="river"]')).toHaveCount(0);
  await page.locator('.tactical-map-viewport').screenshot({path:`${out}/map-${i}-${seed??'authored'}.png`});
  report.maps.push(map);
 }
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.mapQA.show(2,123));
 await page.screenshot({path:`${out}/map-mobile.png`});
 assert.deepEqual(report.errors,[]);report.checks.push('8 authored + 8 procedural maps rendered; assets load; preserved sprite aspect; river baked');
 console.log(JSON.stringify(report,null,2));
}finally{await writeFile(`${out}/acceptance.json`,JSON.stringify(report,null,2));await browser.close();}
