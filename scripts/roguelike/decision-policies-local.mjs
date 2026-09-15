// Local-only QA: own disposable account from templates-local-acceptance.mjs.
import {readFile, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const {chromium,expect}=require('@playwright/test');
const base='http://127.0.0.1:3001';
const access=JSON.parse(await readFile(new URL('../../outputs/presets-250/acceptance.json',import.meta.url),'utf8'));
const auth=await (await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:access.username,password:access.password})})).json();
async function api(method,path,body){const response=await fetch(`${base}/api${path}`,{method,headers:{Authorization:`Bearer ${auth.token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const data=await response.json();assert(response.ok,JSON.stringify(data));return data;}
const runID=process.env.BOH_QA_RUN_ID || access.created.find(row=>row.preset==='Лучник').runID;
let run=(await api('GET',`/roguelike/runs/${runID}`)).run;
const command=async(type,payload={})=>{run=(await api('POST',`/roguelike/runs/${runID}/commands`,{command_id:randomUUID(),expected_revision:run.revision,type,payload})).run;};
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1050}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(({token,user})=>{localStorage.setItem('auth_token',token);localStorage.setItem('user',JSON.stringify(user));localStorage.setItem('boh:mobile-suggestion-dismissed','1');},auth);
 if(run.phase==='camp')await command('start_encounter');
 const combatURL=`${base}/characters-v3/${run.character_id}/combat?roguelike=${runID}`;
 await page.goto(combatURL);
 await expect.poll(async()=>Boolean((await api('GET',`/roguelike/runs/${runID}`)).run.combat_state),{timeout:30000}).toBe(true);
 await page.goto(`${base}/roguelike`);
 run=(await api('GET',`/roguelike/runs/${runID}`)).run;
 for(let i=0;i<30;i++) {
  const state=run.combat_state;
  if(state.pendingAlertSwapActorIds?.length)await command('combat_intent',{intent:{type:'alert_swap',actorId:state.pendingAlertSwapActorIds[0],allyActorId:null}});
  else if(state.pendingD20Interrupt)await command('combat_intent',{intent:{type:'d20_interrupt',actorId:null}});
  else if(state.world.pendingResolution?.request.type==='reaction')await command('combat_intent',{intent:{type:'reaction',response:{kind:'reaction',actionId:null}}});
  else if(state.world.pendingResolution?.request.type==='saving_throw')await command('combat_intent',{intent:{type:'saving_throw'}});
  else if(state.world.scene.initiative[state.world.scene.activeIndex]!==state.characterId)await command('combat_intent',{intent:{type:'resume'}});
  else break;
 }
 const state=run.combat_state,actor=state.world.actors[state.characterId];
 const action=state.catalogActions.find(a=>a.name==='Дальнобойная атака оружием');
 const target=Object.values(state.world.actors).find(a=>a.kind==='monster'&&a.runtime.hp.current>0);
 const initialResources=structuredClone(actor.runtime.resources);
 await command('combat_intent',{intent:{type:'action',actorId:actor.id,actionId:action.id,targetIds:[target.id],choices:{'weapon_mastery.slow.use':['use']}}});
 assert(run.combat_state.pendingD20Interrupt?.held);
 const heldSnapshot=structuredClone(run.combat_state);
 const savedDice=run.combat_state.pendingD20Interrupt.held.roll.dice;
 await page.goto(combatURL);
 await expect(page.locator('.combat-roll-influences button')).toBeEnabled({timeout:30000});
 await page.evaluate(()=>{
  window.dialogQA={dialog:document.querySelector('.combat-presentation-dialog'),die:document.querySelector('.combat-attack-dice .committed-die'),removed:false};
  window.dialogQA.observer=new MutationObserver(records=>{for(const r of records)for(const n of r.removedNodes)if(n===window.dialogQA.dialog||n.contains?.(window.dialogQA.dialog))window.dialogQA.removed=true;});
  window.dialogQA.observer.observe(document.body,{childList:true,subtree:true});
 });
 await page.locator('.combat-presentation-continue').click();
 await expect(page.locator('.combat-roll-influences')).toHaveCount(0,{timeout:30000});
 await expect(page.locator('.combat-presentation-dialog')).toHaveCount(1);
 assert.deepEqual(await page.evaluate(()=>({removed:window.dialogQA.removed,sameDialog:window.dialogQA.dialog===document.querySelector('.combat-presentation-dialog'),sameDie:window.dialogQA.die===document.querySelector('.combat-attack-dice .committed-die')})),{removed:false,sameDialog:true,sameDie:true});
 await expect(page.locator('.combat-attack-dice .is-rolling')).toHaveCount(0);
 await expect(page.locator('.combat-presentation-continue')).toBeEnabled({timeout:10000});
 await page.screenshot({path:'outputs/presets-250/roll-continuation-same-window.png'});
 run=(await api('GET',`/roguelike/runs/${runID}`)).run;
 assert.equal(run.combat_state.world.actors[actor.id].runtime.resources.heroic_inspiration,initialResources.heroic_inspiration);
 console.log('PASS real worker decline: same DOM dialog/die, no second attack animation, inspiration preserved');
 // The first encounter may already be won in a single hit. Test remaining UI
 // against the pre-attack snapshot with all writes intercepted, not a dead foe.
 const mockRun={...run,combat_state:structuredClone(state)};
 const mockCommands=[];
 let autoResult=null;
 let autoIntentType='d20_interrupt';
 await page.route(`**/api/roguelike/runs/${runID}/commands`,route=>{
  const body=route.request().postDataJSON();mockCommands.push(body.payload?.intent);
  if(autoResult&&body.payload?.intent?.type===autoIntentType)mockRun.combat_state=autoResult;
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({run:mockRun})});
 });
 await page.route(`**/api/roguelike/runs/${runID}`,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({run:mockRun})}));
 await page.reload();
 await page.getByRole('tab',{name:/Пассивы/}).click();
 const missToggle=page.getByLabel('Показывать воздействия на бросок только при промахе',{exact:true});
 await missToggle.click();
 const shieldToggle=page.getByLabel('Предлагать реакцию, только когда она изменяет исход',{exact:true});
 await expect(shieldToggle).toHaveCount(1);await shieldToggle.click();
 await page.reload();await page.getByRole('tab',{name:/Пассивы/}).click();
 await expect(missToggle).toHaveAttribute('aria-pressed','true');await expect(shieldToggle).toHaveAttribute('aria-pressed','true');
 await page.screenshot({path:'outputs/presets-250/decision-policy-passives.png'});
 console.log('PASS both declared passives persist across reload');

 // Pure clone probes use real catalog/actor data; never persist these synthetic attacks.
 const probe=await page.evaluate(async state=>{
  const {previewAttackDefense}=await import('/src/rules-core/handler.ts');
  const {effectiveArmorClass}=await import('/src/rules-core/actorArmorClass.ts');
  const {decisionPolicyToggles,decisionOfferVisible}=await import('/src/solo-combat/decisionPolicies.ts');
  const {sheetReactionDecisionOptions}=await import('/src/components/SheetPendingCombatPanel.tsx');
  const {executeCombatAction}=await import('/src/solo-combat/engine.ts');
  const defender=state.world.actors[state.characterId];
  const shield=state.catalogActions.find(a=>decisionPolicyToggles('reaction',a).length&&defender.capabilities.actionIds.includes(a.id));
  const source=Object.values(state.world.actors).find(a=>a.kind==='monster');
  const attack=state.catalogActions.find(a=>source.capabilities.actionIds.includes(a.id)&&Array.isArray(a.mechanics.effects)&&a.mechanics.effects.some(e=>e.resolution==='attack_roll'));
  delete state.pendingD20Interrupt;delete state.pendingAlertSwapActorIds;state.world.pendingResolution=null;
  state.world.scene.activeIndex=state.world.scene.initiative.indexOf(source.id);
  source.runtime.resources.action=1;defender.runtime.resources.reaction=1;defender.ac=10;
  defender.runtime.resources.heroic_inspiration=0;source.runtime.resources.heroic_inspiration=0;
  state.tokens[source.id].position={x:3,y:3};state.tokens[defender.id].position={x:3,y:4};
  const after=executeCombatAction({state,actorId:source.id,actionId:attack.id,targetIds:[defender.id],rng:()=>.55});
  const pending=after.world.pendingResolution;
  if(pending?.type!=='attack_reaction')throw Error('No real shield request from cloned attack');
  const option=sheetReactionDecisionOptions(pending.request.options).find(o=>o.response.actionId===shield.id);
  const ac=effectiveArmorClass(defender);
  const roll={...pending.attackRoll,total:ac+2,dice:[{sides:20,result:10}],outcome:'hit',target:{type:'ac',value:ac}};
  const useful=previewAttackDefense(defender,shield,roll,option.response.spell);
  const useless=previewAttackDefense(defender,shield,{...roll,total:ac+9},option.response.spell);
  const critical=previewAttackDefense(defender,shield,{...roll,outcome:'crit',dice:[{sides:20,result:20}]},option.response.spell);
  const toggles=decisionPolicyToggles('reaction',shield),prefs={[toggles[0].id]:true};
  return {useful,useless,critical,magicMissileVisible:decisionOfferVisible(toggles,prefs,{}),reactionState:after,shieldId:shield.id};
 },structuredClone(state));
 assert.equal(probe.useful.changesOutcome,true);assert.equal(probe.useless.changesOutcome,false);assert.equal(probe.critical.changesOutcome,false);assert.equal(probe.magicMissileVisible,true);
 console.log('PASS real Shield catalog/access preview, useless defense, critical hit and unknown/Magic Missile trigger');
 // Render the full combat page against an isolated mocked snapshot. Block ALL
 // mutation requests for this run so the probe cannot reach the real API.
 mockRun.combat_state=probe.reactionState;
 await page.evaluate(()=>localStorage.setItem('dnd-cards:combat-passive-toggles:v1','{}'));
 await page.reload();
 const reaction=page.locator('section[aria-label="По вам попали"]');
 await expect(reaction).toBeVisible({timeout:30000});
 await expect(reaction).toContainText('КД');await expect(reaction).toContainText(String(probe.reactionState.world.pendingResolution.attackRoll.total));
 await expect(reaction.getByLabel('Предлагать реакцию, только когда она изменяет исход',{exact:true})).toBeVisible();
 await page.screenshot({path:'outputs/presets-250/reaction-defense-preview.png'});
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:'outputs/presets-250/reaction-defense-preview-mobile.png'});
 const box=await reaction.boundingBox();assert(box.x>=0&&box.x+box.width<=391);
 await reaction.locator('.combat-roll-details summary').click();
 await expect(reaction.locator('.combat-roll-detail-columns > section')).toHaveCount(2);
 assert(await reaction.evaluate(el=>el.scrollWidth<=el.clientWidth));
 await page.screenshot({path:'outputs/presets-250/reaction-defense-details-mobile.png'});
 autoIntentType='reaction';autoResult=structuredClone(state);mockCommands.length=0;
 await page.evaluate(id=>localStorage.setItem('dnd-cards:combat-passive-toggles:v1',JSON.stringify({[`reaction.changes-outcome:${id}`]:true})),probe.shieldId);
 await page.reload();
 await expect.poll(()=>mockCommands.some(intent=>intent?.type==='reaction'&&intent.response.actionId===null)).toBe(true);
 console.log('PASS full page auto-declines an ineffective defense without spending the reaction');
 mockRun.combat_state=structuredClone(heldSnapshot);
 const successful=mockRun.combat_state.pendingD20Interrupt.held.roll;
 successful.outcome='hit';successful.total=successful.target.value+1;
 autoResult=structuredClone(run.combat_state);
 autoIntentType='d20_interrupt';
 mockCommands.length=0;
 await page.evaluate(()=>localStorage.setItem('dnd-cards:combat-passive-toggles:v1',JSON.stringify({'roll-influence.only-misses':true})));
 await page.addInitScript(()=>{
  window.offerShown=false;
  new MutationObserver(()=>{if(document.querySelector('.combat-roll-influences'))window.offerShown=true;}).observe(document,{childList:true,subtree:true});
 });
 await page.reload();
 await expect.poll(()=>mockCommands.some(intent=>intent?.type==='d20_interrupt'&&intent.actorId===null)).toBe(true);
 assert.equal(await page.evaluate(()=>window.offerShown),false);
 console.log('PASS full page auto-declines a hit through the normal command without flashing the offer');
 assert.deepEqual(errors,[]);
 await writeFile('outputs/presets-250/decision-policies-acceptance.json',JSON.stringify({runID,savedDice,useful:probe.useful,useless:probe.useless,critical:probe.critical,passed:true},null,2));
 console.log('PASS full reaction UI: incoming roll + AC + predicted AC + toggle; desktop/mobile; no page errors');
} finally {await browser.close();}
