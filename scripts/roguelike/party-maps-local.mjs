// Local-only acceptance. All mutated sheets are freshly copied QA presets.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const {chromium,expect}=require('@playwright/test');
const base='http://127.0.0.1:3001',out='outputs/party-maps-254';
await mkdir(out,{recursive:true});
// Credentials are provisioned separately for the local QA database; this
// acceptance script must not create accounts as a side effect.
const credentials=JSON.parse(await readFile(`${out}/credentials.json`,'utf8'));
const auth=await(await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:credentials.username,password:credentials.password})})).json();
assert(auth.token,'QA login');
const report={checks:[],runs:[],timings:[]};
const api=async(method,path,body,expected=200)=>{
 const start=performance.now(),response=await fetch(`${base}/api${path}`,{method,headers:{Authorization:`Bearer ${auth.token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 const text=await response.text();report.timings.push({operation:body?.type??path,ms:performance.now()-start,bytes:text.length});
 assert.equal(response.status,expected,`${path}: ${text.slice(0,800)}`);return JSON.parse(text);
};
await mkdir(out,{recursive:true});
const templates=(await api('GET','/character-templates')).templates;
async function createParty(count){
 const source=[];
 for(let i=0;i<count;i++){
  const t=templates.find(t=>t.preset_key===(['swordsman','archer','frontliner'][i%3]))??templates[0];
  source.push(await api('POST',`/character-templates/${t.id}/copies`,{name:`QA группа ${count}-${i+1} ${randomUUID().slice(0,5)}`},201));
 }
 const run=(await api('POST','/roguelike/runs',{source_character_ids:source.map(c=>c.id)},201)).run;
 assert.equal(run.characters.length,count);assert.equal(run.supplies,count);assert.equal(run.party.members.length,count);
 report.runs.push(run.id);return run;
}
const commandBody=(run,type,payload={})=>({command_id:randomUUID(),expected_revision:run.revision,type,payload});
const command=async(run,type,payload={})=>(await api('POST',`/roguelike/runs/${run.id}/commands`,commandBody(run,type,payload))).run;
await api('POST','/roguelike/runs',{source_character_ids:Array.from({length:7},()=>randomUUID())},400);
const duplicate=randomUUID();await api('POST','/roguelike/runs',{source_character_ids:[duplicate,duplicate]},400);
report.checks.push('reject 7 members and duplicate identity');
let run=await createParty(3);
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1050},ignoreHTTPSErrors:true});const errors=[];
page.on('pageerror',e=>errors.push(e.message));
try{
 await page.addInitScript(({token,user})=>{localStorage.setItem('auth_token',token);localStorage.setItem('user',JSON.stringify(user));localStorage.setItem('boh:mobile-suggestion-dismissed','1');},auth);
 await page.goto(`${base}/roguelike/${run.id}`);
 await expect(page.locator('.run-party-member')).toHaveCount(3,{timeout:40000});
 await page.screenshot({path:`${out}/party-camp.png`,fullPage:true});
 await page.getByRole('button',{name:'Передать предметы',exact:true}).click();
 const items=page.locator('.run-party-transfer-items button');await expect(items.first()).toBeVisible();
 await items.first().click();
 await Promise.all([page.waitForResponse(r=>r.url().includes(`/runs/${run.id}/commands`)&&r.request().method()==='POST'),page.getByRole('button',{name:'Передать',exact:true}).click()]);
 await expect(page.getByRole('button',{name:'Передать',exact:true})).toBeDisabled();
 run=(await api('GET',`/roguelike/runs/${run.id}`)).run;
 const before=structuredClone(run);const stock=run.characters[0].inventory_items.find(r=>!r.container_id);
 if(stock){
  const payload={from_character_id:run.character_id,to_character_id:run.characters[1].id,card_id:stock.card_id,quantity:1};
  await api('POST',`/roguelike/runs/${run.id}/commands`,commandBody(run,'transfer_item',{...payload,to_character_id:randomUUID()}),403);
  const body=commandBody(run,'transfer_item',payload);
  const first=await api('POST',`/roguelike/runs/${run.id}/commands`,body);const repeated=await api('POST',`/roguelike/runs/${run.id}/commands`,body);
  assert.deepEqual(repeated,first);run=first.run;
  const count=r=>r.characters.reduce((sum,c)=>sum+(c.inventory_items??[]).filter(x=>x.card_id===stock.card_id).reduce((n,x)=>n+x.qty,0),0);
  assert.equal(count(run),count(before));
 }
 report.checks.push('browser transfer, conserved inventory, foreign recipient denied, idempotent repeat');
 let revisions=run.characters.map(c=>c.runtime_revision);
 run=await command(run,'short_rest');assert(run.characters.every((c,i)=>c.runtime_revision===revisions[i]+1));assert.equal(run.game_clock_hours,1);
 revisions=run.characters.map(c=>c.runtime_revision);const body=commandBody(run,'long_rest');
 const first=await api('POST',`/roguelike/runs/${run.id}/commands`,body);run=first.run;
 assert.equal(run.supplies,0);assert(run.characters.every((c,i)=>c.runtime_revision===revisions[i]+1&&c.current_hp===c.max_hp));
 assert.deepEqual(await api('POST',`/roguelike/runs/${run.id}/commands`,body),first);
 await api('POST',`/roguelike/runs/${run.id}/commands`,commandBody(run,'long_rest'),409);
 report.checks.push('synchronized short/long rest; three supplies; replay no charge; insufficient supplies denied');
 await page.reload();await page.setViewportSize({width:390,height:844});await page.screenshot({path:`${out}/party-mobile.png`,fullPage:true});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'party mobile overflow');await page.setViewportSize({width:1440,height:1050});
 await page.goto(`${base}/characters-v3/${run.characters[1].id}?roguelike=${run.id}`);
 await expect(page.getByRole('link',{name:'Группа и лагерь'})).toBeVisible({timeout:40000});
 assert(!(await page.getByRole('alert').allTextContents()).join().includes('другому персонажу'));
 report.checks.push('ally sheet authorized and party navigation');
 await page.goto(`${base}/shop/roguelike?roguelike=${run.id}`);
 await expect(page.getByRole('button',{name:'Предметы на полках',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Предметы на полках',exact:true}).click();
 const icons=page.locator('.shop-shelf-item .forge-entity-icon');await expect(icons.first()).toBeVisible();
 assert(await icons.evaluateAll(rows=>rows.every(el=>getComputedStyle(el).backgroundColor==='rgba(0, 0, 0, 0)'&&getComputedStyle(el).borderTopWidth==='0px')));
 await expect.poll(()=>page.locator('.shop-shelf-item img').evaluateAll(images=>images.every(img=>img.complete&&img.naturalWidth>0)),{timeout:40000}).toBe(true);
 await page.screenshot({path:`${out}/shop-transparent.png`,fullPage:true});report.checks.push('inner and outer shop icon backgrounds transparent');
 run=await command(run,'start_encounter');run=await command(run,'initialize_combat');
 assert.equal(run.combat_state.controlledCharacterIds.length,3);assert(run.combat_state.battleMap);assert.equal(run.combat_state.routeCommandVersion,1);
 await writeFile(`${out}/qa-party-run.json`,JSON.stringify(run));
 await page.goto(`${base}/characters-v3/${run.character_id}/combat?roguelike=${run.id}`);
 await expect(page.locator('.battle-map-scenery')).toBeVisible({timeout:40000});
 if(await page.getByRole('button',{name:'Продолжить',exact:true}).isVisible()) await page.getByRole('button',{name:'Продолжить',exact:true}).click();
 await expect(page.getByRole('button',{name:'Оставить порядок',exact:true})).toBeVisible({timeout:20000});
 while(await page.getByRole('button',{name:'Оставить порядок',exact:true}).isVisible()){
  await Promise.all([page.waitForResponse(r=>r.url().endsWith('/commands')&&r.request().method()==='POST'),page.getByRole('button',{name:'Оставить порядок',exact:true}).click()]);
  await expect(page.getByRole('button',{name:'Оставить порядок',exact:true})).not.toBeVisible();
 }
 await page.screenshot({path:`${out}/party-combat.png`,fullPage:true});
 report.checks.push('real party battle initialized with server-owned terrain and full party mirrors');
 // Render all maps from the same real state, without persisting fabricated moves.
 await page.goto(base);
 await page.evaluate(async state=>{
  const React=(await import('/node_modules/.vite/deps/react.js')).default,client=await import('/node_modules/.vite/deps/react-dom_client.js');
  const {default:Map}=await import('/src/components/TacticalBattleMap.tsx');await import('/src/pages/SoloCombatPage.css');
  const {installBattleMap}=await import('/src/solo-combat/battleMaps.ts');
  const host=document.createElement('div');host.style.cssText='position:fixed;inset:0;background:#101510;z-index:1000;padding:24px;overflow:auto';document.body.append(host);
  const root=(client.createRoot??client.default.createRoot)(host);
  window.mapQA={show(index){const scene=installBattleMap(structuredClone(state),index);scene.combatAreas=Object.fromEntries(Object.entries(scene.combatAreas).filter(([id])=>id.startsWith(`map:${scene.battleMap.id}:`)));
   root.render(React.createElement(Map,{key:index,state:scene,actorId:scene.characterId,selectedActionId:null,movementMode:false,onCell:()=>{}}));return scene.battleMap.id;}};
 },run.combat_state);
 for(let i=0;i<4;i++){
  const id=await page.evaluate(i=>window.mapQA.show(i),i);await expect(page.locator('.battle-map-scenery')).toBeVisible();
  await page.locator('.tactical-map-viewport').screenshot({path:`${out}/${id}.png`});
 }
 report.checks.push('all four maps rendered in actual battle component');
 let six=await createParty(6);six=await command(six,'start_encounter');six=await command(six,'initialize_combat');
 assert.equal(six.combat_state.controlledCharacterIds.length,6);assert.equal(six.characters.length,6);
 report.checks.push('six-member run initialized');
 assert.deepEqual(errors,[],'browser exceptions');
 await writeFile(`${out}/acceptance.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await writeFile(`${out}/acceptance-progress.json`,JSON.stringify({...report,errors},null,2));await browser.close();}
