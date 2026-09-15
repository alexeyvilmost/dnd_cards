import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const {chromium,expect}=require('@playwright/test');
const base='http://127.0.0.1:3001';
const access=JSON.parse(await readFile(new URL('../../outputs/presets-250/acceptance.json',import.meta.url),'utf8'));
const admin=JSON.parse(await readFile(new URL('../../outputs/shop-249/review-access.json',import.meta.url),'utf8'));
async function login(a){return (await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:a.username,password:a.password})})).json();}
const auth=await login(access);
async function api(method,path,body){const r=await fetch(`${base}/api${path}`,{method,headers:{Authorization:`Bearer ${auth.token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const data=await r.json();assert(r.ok,JSON.stringify(data));return data;}
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1050}});
 await page.addInitScript(({token,user})=>{localStorage.setItem('auth_token',token);localStorage.setItem('user',JSON.stringify(user));localStorage.setItem('boh:mobile-suggestion-dismissed','1');},auth);
 // Cold navigation must not depend on CSS loaded by a prior Forge visit.
 await page.goto(`${base}/roguelike`);
 await page.locator('.character-template-grid article').filter({hasText:'Лучник'}).getByRole('button',{name:'Начать за пресет',exact:true}).click();
 const modal=page.getByRole('dialog',{name:'Создание из шаблона'});
 await modal.getByLabel('Имя',{exact:true}).fill('Проверка видимости');
 const start=modal.getByRole('button',{name:'Создать и начать забег',exact:true});
 await expect(start).toBeVisible();
 assert.deepEqual(await start.evaluate(el=>[getComputedStyle(el).backgroundColor,getComputedStyle(el).color]),['rgb(216, 185, 120)','rgb(32, 27, 20)']);
 await page.screenshot({path:'outputs/presets-250/preset-name-fixed.png'});
 await modal.getByRole('button',{name:'Отмена',exact:true}).click();
 const runID=access.created.find(c=>c.preset==='Лучник').runID;
 let run=(await api('GET',`/roguelike/runs/${runID}`)).run;
 const command=async(type,payload={})=>{run=(await api('POST',`/roguelike/runs/${runID}/commands`,{command_id:randomUUID(),expected_revision:run.revision,type,payload})).run;};
 if(run.phase==='camp') await command('start_encounter');
 await page.goto(`${base}/characters-v3/${run.character_id}/combat?roguelike=${runID}`);
 for(let i=0;i<60;i++){run=(await api('GET',`/roguelike/runs/${runID}`)).run;if(run.combat_state)break;await page.waitForTimeout(500);}
 assert(run.combat_state,'combat initialization failed');
 // Validate the live catalog path without changing any saved combat state.
 const probe=await page.evaluate(async state=>{
  const {executeCombatAction}=await import('/src/solo-combat/engine.ts');
  const {collectSoloCombatActionChoices,combatPassiveTogglesForAction,resolveCombatPassiveChoices}=await import('/src/solo-combat/actionChoices.ts');
  const {breakdownValue}=await import('/src/engine/breakdown.ts');
  const actor=state.world.actors[state.characterId];const action=state.catalogActions.find(a=>a.name==='Дальнобойная атака оружием');
  const enemy=Object.values(state.world.actors).find(a=>a.kind==='monster');
  delete state.pendingAlertSwapActorIds;delete state.pendingD20Interrupt;state.world.pendingResolution=null;
  state.world.scene.activeIndex=state.world.scene.initiative.indexOf(actor.id);
  actor.runtime.resources.action=1;actor.runtime.resources.heroic_inspiration=0;enemy.runtime.hp={current:100,max:100,temp:0};enemy.ac=1;
  state.tokens[actor.id].position={x:3,y:4};state.tokens[enemy.id].position={x:3,y:1};
  const automatic=resolveCombatPassiveChoices(collectSoloCombatActionChoices(actor,action),combatPassiveTogglesForAction(actor,action),{}).automatic;
  const before=breakdownValue('speed',enemy.character,enemy.runtime,enemy.passives??[]).value;
  const after=executeCombatAction({state,actorId:actor.id,actionId:action.id,targetIds:[enemy.id],choices:automatic,rng:()=>.6});
  const target=after.world.actors[enemy.id];
  return {automatic,before,after:breakdownValue('speed',target.character,target.runtime,target.passives??[]).value};
 },structuredClone(run.combat_state));
 assert.deepEqual(probe.automatic['weapon_mastery.slow.use'],['use']);assert.equal(probe.after,probe.before-10);
 console.log('PASS cold modal contrast and real longbow Slow: -10 ft');
 // Stop presentation automation while issuing the real persisted roll.
 await page.goto(`${base}/roguelike`);
 run=(await api('GET',`/roguelike/runs/${runID}`)).run;
 for(let i=0;i<30;i++) {
  const state=run.combat_state;
  if(state.pendingAlertSwapActorIds?.length) await command('combat_intent',{intent:{type:'alert_swap',actorId:state.pendingAlertSwapActorIds[0],allyActorId:null}});
  else if(state.pendingD20Interrupt) await command('combat_intent',{intent:{type:'d20_interrupt',actorId:null}});
  else if(state.world.pendingResolution?.request.type==='reaction') await command('combat_intent',{intent:{type:'reaction',response:{kind:'reaction',actionId:null}}});
  else if(state.world.pendingResolution?.request.type==='saving_throw') await command('combat_intent',{intent:{type:'saving_throw'}});
  else if(state.world.scene.initiative[state.world.scene.activeIndex]!==state.characterId) await command('combat_intent',{intent:{type:'resume'}});
  else break;
 }
 let state=run.combat_state;const actor=state.world.actors[state.characterId];
 const action=state.catalogActions.find(a=>a.name==='Дальнобойная атака оружием');
 const target=Object.values(state.world.actors).find(a=>a.kind==='monster'&&a.runtime.hp.current>0);
 const arrows=actor.runtime.inventory.find(i=>i.cardId==='59b10a1e-8669-4bf6-88a5-69d0abfc76a6').qty;
 await command('combat_intent',{intent:{type:'action',actorId:actor.id,actionId:action.id,targetIds:[target.id],choices:{'weapon_mastery.slow.use':['use']}}});
 assert.equal(run.combat_state.pendingD20Interrupt?.operation,'roll_influence');
 assert.equal(run.combat_state.world.actors[actor.id].runtime.resources.heroic_inspiration,1);
 await page.goto(`${base}/characters-v3/${run.character_id}/combat?roguelike=${runID}`);
 const reroll=page.locator('.combat-roll-influences button');
 await expect(reroll).toBeEnabled({timeout:30000});await page.screenshot({path:'outputs/presets-250/inspiration-fixed.png'});
 await page.evaluate(async()=>{const {getSettings,setSetting}=await import('/src/settings.ts');setSetting('entityDisplay',{...getSettings().entityDisplay,actions:'row'});});
 await expect(reroll).toHaveClass(/sheet-item-row/);
 await reroll.hover();
 await expect(page.locator('.forge-effect-popover .sp-tip')).toContainText('Перебросьте');
 await page.screenshot({path:'outputs/presets-250/inspiration-action-row.png'});
 await page.mouse.move(5,5);
 await page.locator('.combat-roll-details summary').click();
 await expect(page.locator('.combat-roll-detail-columns > section')).toHaveCount(2);
 await expect(page.locator('[aria-label="Расчёт КД цели"]')).not.toContainText('не сохранена');
 await reroll.click();
 await expect.poll(async()=>((await api('GET',`/roguelike/runs/${runID}`)).run.combat_state.world.actors[actor.id].runtime.resources.heroic_inspiration),{timeout:15000}).toBe(0);
 await expect(reroll).toHaveCount(0,{timeout:30000});
 run=(await api('GET',`/roguelike/runs/${runID}`)).run;
 assert.equal(run.combat_state.world.actors[actor.id].runtime.resources.heroic_inspiration,0);
 assert.equal(run.combat_state.world.actors[actor.id].runtime.inventory.find(i=>i.cardId==='59b10a1e-8669-4bf6-88a5-69d0abfc76a6').qty,arrows-1);
 console.log('PASS actual worker, persisted roll after reload, inspiration/arrow paid once');
 const adminAuth=await login(admin), adminPage=await browser.newPage();
 await adminPage.addInitScript(({token,user})=>{localStorage.setItem('auth_token',token);localStorage.setItem('user',JSON.stringify(user));},adminAuth);
 await adminPage.goto(`${base}/characters-forge`);await adminPage.getByRole('button',{name:'Создать из шаблона',exact:true}).click();
 await expect(adminPage.getByRole('button',{name:'Редактировать шаблон',exact:true})).toHaveCount(3);
 await adminPage.getByRole('button',{name:'Редактировать шаблон',exact:true}).first().click();
 await expect(adminPage.getByRole('dialog').getByLabel('Лист-источник')).toBeVisible();
 console.log('PASS admin editing UI');
 await writeFile('outputs/presets-250/polish-acceptance.json',JSON.stringify({runID,probe,passed:true},null,2));
} finally {await browser.close();}
