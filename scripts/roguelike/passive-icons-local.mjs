// Read-only full-page visual QA; all combat writes are intercepted.
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const {chromium,expect}=require('@playwright/test');
const base='http://127.0.0.1:3001';
const access=JSON.parse(await readFile(new URL('../../outputs/presets-250/acceptance.json',import.meta.url),'utf8'));
const auth=await(await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:access.username,password:access.password})})).json();
const runID=access.created.find(row=>row.preset==='Лучник').runID;
const {run}=await(await fetch(`${base}/api/roguelike/runs/${runID}`,{headers:{Authorization:`Bearer ${auth.token}`}})).json();
const state=run.combat_state;
assert(state,'Initialize the disposable Archer run first');
state.outcome='active';state.world.pendingResolution=null;
delete state.pendingD20Interrupt;delete state.pendingAlertSwapActorIds;delete state.pendingInterception;
state.world.scene.activeIndex=state.world.scene.initiative.indexOf(state.characterId);
for(const actor of Object.values(state.world.actors)){actor.runtime.hp.current=actor.runtime.hp.max;}
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000},ignoreHTTPSErrors:true});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('requestfailed',request=>{if(request.resourceType()==='image')console.log('Image request failed:',request.url(),request.failure()?.errorText);});
 await page.addInitScript(({token,user})=>{localStorage.setItem('auth_token',token);localStorage.setItem('user',JSON.stringify(user));localStorage.setItem('boh:mobile-suggestion-dismissed','1');localStorage.setItem('dnd-cards:combat-passive-toggles:v1','{}');},auth);
 await page.route(`**/api/roguelike/runs/${runID}`,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({run})}));
 await page.route(`**/api/roguelike/runs/${runID}/commands`,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({run})}));
 await page.goto(`${base}/characters-v3/${run.character_id}/combat?roguelike=${runID}`);
 await page.getByRole('tab',{name:/Пассивы/}).click();
 const panel=page.getByRole('tabpanel',{name:'Пассивные эффекты атак'});
 const icons=panel.locator('button.cs-action-tile--round');
 await expect(icons).toHaveCount(4);await expect(panel.locator('input')).toHaveCount(0);
 const parentImages=Object.values(state.actionPresentation).filter(p=>/Щит|Безоружный удар/.test(p.actionRef?.name||p.spellRef?.name||'')).map(p=>p.imageUrl);
 const actualImages=await icons.locator('img').evaluateAll(imgs=>imgs.map(img=>img.getAttribute('src')));
 console.log('Parent images:',parentImages,'Actual images:',actualImages);
 await page.screenshot({path:'outputs/presets-250/passives-round-loading.png'});
 for(const url of parentImages)assert(actualImages.includes(url),'Parent action image must be reused');
 assert(actualImages.includes('/icons/passives/roll-influence.svg'));assert(actualImages.includes('/icons/passives/slow.svg'));
 for(const button of await icons.all()){
  const box=await button.boundingBox();assert.equal(box.width,48);assert.equal(box.height,48);
  assert.equal(await button.evaluate(el=>getComputedStyle(el).borderRadius),'50%');
  await button.hover();await expect(page.locator('.forge-effect-popover .sp-tip')).toBeVisible();
  await expect(page.locator('.forge-effect-popover')).toContainText('Включено:');
  await expect(page.locator('.forge-effect-popover')).toContainText('Выключено:');
  if(await button.getAttribute('aria-pressed')==='false')await button.click();
 }
 await page.mouse.move(20,100);await icons.last().blur();
 const orbit=icons.first().locator('.passive-orbit');
 const animation=await orbit.evaluate(el=>({name:getComputedStyle(el).animationName,iterations:getComputedStyle(el).animationIterationCount,
  a:getComputedStyle(el,'::before').content,b:getComputedStyle(el,'::after').content}));
 assert.equal(animation.name,'passive-orbit');assert.equal(animation.iterations,'infinite');assert.notEqual(animation.a,'none');assert.notEqual(animation.b,'none');
 const firstTransform=await orbit.evaluate(el=>getComputedStyle(el).transform);
 await expect.poll(()=>orbit.evaluate(el=>getComputedStyle(el).transform)).not.toBe(firstTransform);
 await page.screenshot({path:'outputs/presets-250/passives-round-desktop.png'});
 const slow=panel.getByRole('button',{name:'Замедляющее',exact:true});
 await slow.hover();await expect(page.locator('.forge-effect-popover')).toContainText('10 фт.');
 await page.screenshot({path:'outputs/presets-250/passives-round-preview.png'});
 await icons.first().click();await expect(icons.first()).toHaveAttribute('aria-pressed','false');
 assert.equal(await orbit.evaluate(el=>getComputedStyle(el).display),'none');
 await icons.first().click();
 await page.emulateMedia({reducedMotion:'reduce'});
 assert.equal(await orbit.evaluate(el=>getComputedStyle(el).animationName),'none');
 await page.emulateMedia({reducedMotion:'no-preference'});
 await page.setViewportSize({width:390,height:844});
 await page.mouse.move(2,100);await icons.first().blur();
 await page.screenshot({path:'outputs/presets-250/passives-round-mobile.png'});
 await slow.hover();await page.screenshot({path:'outputs/presets-250/passives-round-preview-mobile.png'});
 const popover=await page.locator('.forge-effect-popover').boundingBox();assert(popover.x>=0&&popover.x+popover.width<=391);
 assert.deepEqual(errors,[]);
 console.log('PASS four uniform 48px round passives; parent images; canonical detailed previews; two orbiting lights; off/reduced-motion; mobile; no combat writes');
 console.log('Loaded images:',await icons.locator('img').evaluateAll(imgs=>imgs.map(i=>({src:i.getAttribute('src'),loaded:i.complete&&i.naturalWidth>0}))));
} finally {await browser.close();}
