// Local-only boundary checks on disposable QA sheets; never mutates a player's run.
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const {chromium,expect}=require('@playwright/test');
const base='http://127.0.0.1:3001',out='outputs/ui-polish-252';
const credentials=JSON.parse(await readFile('outputs/presets-250/acceptance.json','utf8'));
const auth=await (await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:credentials.username,password:credentials.password})})).json();
assert(auth.token);
const api=async(method,path,body)=>{const response=await fetch(`${base}/api${path}`,{method,headers:{Authorization:`Bearer ${auth.token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const result=await response.json();assert(response.ok,`${method} ${path}: ${JSON.stringify(result)}`);return result;};
const template=(await api('GET','/character-templates')).templates.find(row=>row.preset_key==='archer');
const hero=await api('POST',`/character-templates/${template.id}/copies`,{name:`Границы UI-252 ${randomUUID().slice(0,6)}`});
let run=(await api('POST','/roguelike/runs',{source_character_id:hero.id})).run;
const command=async(type,payload={})=>{run=(await api('POST',`/roguelike/runs/${run.id}/commands`,{command_id:randomUUID(),expected_revision:run.revision,type,payload})).run;};
await command('start_encounter');await command('initialize_combat');
assert.equal(run.combat_state.tacticalFootprints,'sized','new worker persists footprint-aware rules');
const combatURL=`${base}/characters-v3/${run.character_id}/combat?roguelike=${run.id}`;
const browser=await chromium.launch({channel:'chrome',headless:true});
const checks=[];let page,lockedBefore,lockedEdited=false;
try{
 page=await browser.newPage({viewport:{width:1440,height:1080}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(({token,user})=>{localStorage.setItem('auth_token',token);localStorage.setItem('user',JSON.stringify(user));localStorage.setItem('boh:mobile-suggestion-dismissed','1');},auth);
 const mock=structuredClone(run),state=mock.combat_state;
 state.tacticalFootprints='sized';
 for(const key of ['pendingD20Interrupt','pendingAlertSwapActorIds','pendingInterception','pendingTriggeredAction','pendingTurnStartGrappleDamage','playerMovement','pendingAdditionalMovement'])delete state[key];
 state.world.pendingResolution=null;state.world.scene.activeIndex=state.world.scene.initiative.indexOf(state.characterId);
 const enemy=Object.values(state.world.actors).find(row=>row.kind==='monster');assert(enemy);
 state.world.actors[state.characterId].character.baseSize=3;enemy.character.baseSize=4;
 state.tokens[state.characterId].position={x:1,y:6};state.tokens[enemy.id].position={x:6,y:1};
 state.movementRemainingFt[state.characterId]=30;
 await page.route(`**/api/roguelike/runs/${run.id}`,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({run:mock})}));
 await page.route(`**/api/roguelike/runs/${run.id}/commands`,route=>route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'Read-only geometry probe'})}));
 await page.goto(combatURL);
 await expect(page.locator(`.tactical-cell[data-actor-id="${state.characterId}"]`)).toHaveCount(4,{timeout:30000});
 await expect(page.locator(`.tactical-cell[data-actor-id="${enemy.id}"]`)).toHaveCount(9);
 const dimensions=await page.locator(`.tactical-cell[data-actor-id="${enemy.id}"] .battle-token`).evaluate(token=>({width:token.getBoundingClientRect().width,cell:token.parentElement.getBoundingClientRect().width}));
 assert(dimensions.width>dimensions.cell*2.7&&dimensions.width<dimensions.cell*3.1);
 await page.getByRole('button',{name:'Клетка 5, 7',exact:true}).hover();
 await expect(page.locator('.battle-token--ghost')).toHaveCount(1);
 assert.equal(await page.locator('.battle-token--ghost').evaluate(el=>el.style.getPropertyValue('--token-size')),'2');
 await page.screenshot({path:`${out}/large-huge-map.png`});
 await page.getByRole('button',{name:'Клетка 12, 10',exact:true}).hover();
 await expect(page.locator('.battle-token--ghost')).toHaveCount(0);
 checks.push('full-page Large 2x2 / Huge 3x3, ghost footprint, map-boundary rejection');
 await page.unrouteAll({behavior:'wait'});await page.goto(`${base}/roguelike`);
 // Decline all choices and pass turns until the real worker declares defeat.
 for(let i=0;i<180&&run.combat_state.outcome==='active';i++){
  const s=run.combat_state,p=s.world.pendingResolution;
  let intent;
  if(s.pendingAlertSwapActorIds?.length)intent={type:'alert_swap',actorId:s.pendingAlertSwapActorIds[0],allyActorId:null};
  else if(s.pendingD20Interrupt)intent={type:'d20_interrupt',actorId:null};
  else if(s.pendingInterception)intent={type:'interception',actorId:null};
  else if(p?.request.type==='reaction')intent={type:'reaction',response:{kind:'reaction',actionId:null}};
  else if(p?.request.type==='saving_throw')intent={type:'saving_throw'};
  else if(s.pendingTriggeredAction)intent={type:'triggered_action',actionId:null};
  else if(s.world.scene.initiative[s.world.scene.activeIndex]===s.characterId)intent={type:'end_turn',actorId:s.characterId};
  else intent={type:'resume'};
  await command('combat_intent',{intent});
 }
 assert.equal(run.combat_state.outcome,'defeat');
 await page.goto(combatURL);
 await expect(page.getByRole('button',{name:'Получить награду',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Повторить с контрольной точки',exact:true})).toBeVisible({timeout:30000});
 await page.screenshot({path:`${out}/defeat-retry.png`});
 const portrait=run.character.avatar_url;
 await page.getByRole('button',{name:'Повторить с контрольной точки',exact:true}).click();
 await expect(page).toHaveURL(new RegExp(`/characters-v3/${run.character_id}\\?roguelike=`),{timeout:30000});
 run=(await api('GET',`/roguelike/runs/${run.id}`)).run;
 assert.equal(run.status,'active');assert.equal(run.phase,'camp');assert.equal(run.character.avatar_url,portrait);
 checks.push('real worker defeat -> checkpoint retry, no reward, portrait retained');
 const actions=[];
 for(let i=1; ;i++){const result=await api('GET',`/actions?limit=100&page=${i}`);actions.push(...result.actions);if(actions.length>=result.total)break;}
 lockedBefore=actions.find(row=>row.support?.mechanics_locked);assert(lockedBefore);
 await page.goto(`${base}/action-creator?edit=${lockedBefore.id}`);
 await page.getByPlaceholder('Название действия').fill(lockedBefore.name+' — локальная проверка');
 lockedEdited=true;
 await page.getByRole('button',{name:'Сохранить изменения',exact:true}).click();
 await expect(page).toHaveURL(`${base}/?type=actions`,{timeout:30000});
 const saved=await api('GET',`/actions/${lockedBefore.id}`);
 assert.equal(saved.name,lockedBefore.name+' — локальная проверка');
 assert.deepEqual(saved.mechanics,lockedBefore.mechanics);assert.deepEqual(saved.support,lockedBefore.support);
 checks.push('certified action metadata saved through constructor; mechanics and certificate unchanged');
 assert.deepEqual(errors,[]);
 await writeFile(`${out}/boundaries.json`,JSON.stringify({runID:run.id,checks},null,2));
 console.log(JSON.stringify(checks,null,2));
}catch(error){if(page)await page.screenshot({path:`${out}/boundary-failure.png`});throw error;}
finally{
 if(lockedEdited){const {mechanics,support,id,card_number,created_at,updated_at,...metadata}=lockedBefore;await api('PUT',`/actions/${id}`,metadata);}
 await browser.close();
}
