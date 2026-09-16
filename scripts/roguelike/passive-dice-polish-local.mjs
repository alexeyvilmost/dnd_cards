// Local QA account only; all synthetic dice are rendered in memory, never persisted.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const {chromium,expect}=require('@playwright/test');
const base='http://127.0.0.1:3001',out='outputs/passive-dice-polish';
const credentials=JSON.parse(await readFile('outputs/presets-250/acceptance.json','utf8'));
const auth=await (await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:credentials.username,password:credentials.password})})).json();
assert(auth.token,'QA login');
const api=async(method,path,body)=>{const response=await fetch(`${base}/api${path}`,{method,headers:{Authorization:`Bearer ${auth.token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const result=await response.json();assert(response.ok,JSON.stringify(result));return result;};
await mkdir(out,{recursive:true});
const template=(await api('GET','/character-templates')).templates.find(t=>t.preset_key==='archer');
const character=await api('POST',`/character-templates/${template.id}/copies`,{name:`Проверка пассивов ${randomUUID().slice(0,6)}`});
const run=(await api('POST','/roguelike/runs',{source_character_id:character.id})).run;
const result={characterID:character.id,runID:run.id,checks:[]};
await writeFile(`${out}/acceptance.json`,JSON.stringify(result,null,2));
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1050}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const passiveBefore=(await api('GET','/passive-presentations')).passives.find(p=>p.key==='mastery.slow');
let edited=false;
try{
 await page.addInitScript(({token,user})=>{localStorage.setItem('auth_token',token);localStorage.setItem('user',JSON.stringify(user));localStorage.setItem('boh:mobile-suggestion-dismissed','1');},auth);
 await page.goto(`${base}/shop/roguelike?roguelike=${run.id}`);
 await expect(page.locator('.shop-shelf-item').first()).toBeVisible({timeout:40000});
 const icon=page.locator('.shop-shelf-item .cs-action-tile').first();
 assert.deepEqual(await icon.evaluate(el=>({background:getComputedStyle(el).backgroundColor,border:getComputedStyle(el).borderTopWidth})),{background:'rgba(0, 0, 0, 0)',border:'0px'});
 await icon.hover();await expect(page.locator('.forge-effect-popover')).toBeVisible();
 await page.screenshot({path:`${out}/shop-shelves.png`,fullPage:true});
 await page.getByRole('button',{name:'Полные карточки',exact:true}).click();
 await expect(page.locator('.shop-full-item .sp-tip').first()).toBeVisible();
 await page.screenshot({path:`${out}/shop-interface.png`,fullPage:true});
 await page.evaluate(async()=>{const {setSetting}=await import('/src/settings.ts');setSetting('itemPreview','card');});
 await expect(page.locator('.shop-full-item .card-preview').first()).toBeVisible();
 await page.screenshot({path:`${out}/shop-cards.png`,fullPage:true});
 await page.reload();await expect(page.getByRole('button',{name:'Полные карточки',exact:true})).toHaveAttribute('aria-pressed','true');
 for(const mode of ['card','interface']){
   await page.evaluate(async mode=>{const {setSetting}=await import('/src/settings.ts');setSetting('itemPreview',mode);},mode);
   await page.setViewportSize({width:390,height:844});
   await page.screenshot({path:`${out}/shop-${mode}-mobile.png`,fullPage:true});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`shop ${mode} mobile overflow`);
 }
 result.checks.push('transparent shop icons; full canonical cards/interfaces; remembered mode; 390px');
 await page.setViewportSize({width:1440,height:1050});
 await page.goto(`${base}/characters-v3/${character.id}`);
 const section=page.locator('[aria-label="Переключаемые пассивы"]');
 await expect(section.locator('button')).toHaveCount(4,{timeout:40000});
 const names=await section.locator('button').evaluateAll(rows=>rows.map(row=>row.getAttribute('aria-label')||row.title));
 result.passives=names;
 const toggle=section.locator('button').first();
 const before=await toggle.getAttribute('aria-pressed');await toggle.click();
 await expect(toggle).toHaveAttribute('aria-pressed',before==='true'?'false':'true');
 await page.reload();await expect(section.locator('button').first()).toHaveAttribute('aria-pressed',before==='true'?'false':'true');
 await section.locator('button').first().hover();await expect(page.locator('.forge-effect-popover')).toBeVisible();
 await page.screenshot({path:`${out}/sheet-passives.png`,fullPage:true});
 assert(await page.locator('.sheet-feature-section h3').evaluateAll(rows=>rows.every(row=>getComputedStyle(row).textTransform==='none')));
 const sizes=await page.locator('.sheet-feature-sections .forge-spell-icon').evaluateAll(rows=>rows.map(row=>({passive:row.classList.contains('is-passive'),radius:getComputedStyle(row).borderRadius,width:row.clientWidth})));
 assert(sizes.some(row=>row.passive&&row.radius==='50%'),'circular effects');
 assert(sizes.some(row=>!row.passive&&row.radius!=='50%'),'square actions');
 result.checks.push('canonical sheet passives, persisted toggle and preview, circular effects / square actions');
 await page.evaluate(async()=>{const {setSetting}=await import('/src/settings.ts');setSetting('entityDisplay',{effects:'row',actions:'row',spells:'icon',items:'icon'});});
 await expect(page.locator('.sheet-feature-sections .sheet-item-row.is-passive').first()).toBeVisible();
 await page.screenshot({path:`${out}/sheet-rows.png`,fullPage:true});
 await page.setViewportSize({width:390,height:844});
 await page.goto(`${base}/m/characters/${character.id}`);
 await page.getByRole('button',{name:'Пассивы',exact:true}).click();
 await expect(section.locator('button')).toHaveCount(4,{timeout:40000});
 await page.screenshot({path:`${out}/native-mobile-passives.png`,fullPage:true});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile sheet overflow');
 result.checks.push('dedicated mobile sheet toggles and compact rows');
 await page.setViewportSize({width:1440,height:1050});
 await page.goto(`${base}/passive-creator?edit=mastery.slow`);
 await expect(page.getByLabel('Описание',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Жирный',exact:true})).toHaveCount(3);
 await page.getByLabel('Описание',{exact:true}).fill('**Выделенное описание** и :fire: — [[Спасбросок|concept:saving_throw]]');
 await expect(page.locator('.sp-tip .font-bold')).toHaveText('Выделенное описание');
 await page.getByLabel('Когда включён',{exact:true}).fill('__Автоматически__ применить свойство.');
 edited=true;await page.getByRole('button',{name:'Сохранить',exact:true}).click();
 await expect(page.getByRole('status')).toHaveText('Оформление сохранено.');
 await page.reload();await expect(page.getByLabel('Описание',{exact:true})).toHaveValue('**Выделенное описание** и :fire: — [[Спасбросок|concept:saving_throw]]');
 await page.screenshot({path:`${out}/rich-passive-editor.png`,fullPage:true});
 result.checks.push('three rich text editors; canonical parser; save/reload');
 // Exercise the actual dialog and engine with in-memory rolls (no fake writes).
 await page.goto(`${base}/?type=passives`);
 await page.evaluate(async()=>{
   const React=(await import('/node_modules/.vite/deps/react.js')).default;
   const client=await import('/node_modules/.vite/deps/react-dom_client.js');
   const {default:Dialog}=await import('/src/components/CombatPresentationDialog.tsx');
   const {rollD20}=await import('/src/engine/roll.ts');
   const {setSetting}=await import('/src/settings.ts');setSetting('combatRollMode','standard');
   const host=document.createElement('div');document.body.append(host);
   const root=(client.createRoot??client.default.createRoot)(host);
   window.diceQA={show(advantage,kind='attack'){
     root.render(null);
     const values=[.8,.3,.5,.1];let n=0;
     const roll=rollD20({rng:()=>values[n++%values.length],advantage,target:{type:kind==='save'?'dc':'ac',value:14},rules:[{op:'bonus_die',faces:4,source:'Благословение'},{op:'bonus_die',faces:6,sign:-1,source:'Проклятие'}]});
     root.render(React.createElement(Dialog,{key:advantage+kind,beat:{id:'ui-only',sourceId:'qa',sourceName:'Проверка',actionName:kind==='save'?'Спасбросок':'Атака',rollKind:kind,roll,cues:[]},onClose:()=>root.render(null)}));
   }};
 });
 for(const advantage of ['advantage','disadvantage']){
   await page.evaluate(value=>window.diceQA.show(value),advantage);
   await expect(page.locator('.d20-primary-dice .is-rolling')).toHaveCount(2);
   await expect(page.locator('.d20-bonus-tray .is-rolling')).toHaveCount(2);
   await expect(page.locator('.d20-roll-tray .is-discarded')).toHaveCount(0);
   await page.screenshot({path:`${out}/${advantage}-rolling.png`});
   await expect(page.locator('.d20-roll-tray.is-comparing')).toBeVisible();
   await expect(page.locator('.d20-primary-dice .is-discarded')).toHaveCount(0);
   await expect(page.locator('.d20-roll-tray.is-resolved')).toBeVisible();
   await expect(page.locator('.d20-primary-dice .is-discarded')).toHaveCount(1);
   await expect(page.locator('.combat-roll-result')).toHaveCSS('opacity','1');
   await page.screenshot({path:`${out}/${advantage}-resolved.png`});
   assert(await page.locator('.committed-die-fallback').count()===0,'real 3D renderer');
 }
 await page.setViewportSize({width:390,height:844});
 await page.evaluate(()=>window.diceQA.show('advantage','save'));
 await expect(page.locator('.d20-roll-tray.is-resolved')).toBeVisible();
 await expect(page.locator('.combat-roll-result')).toHaveCSS('opacity','1');
 await page.screenshot({path:`${out}/dice-mobile.png`});
 assert(await page.locator('.combat-presentation-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth),'mobile dice overflow');
 result.checks.push('real 3D advantage/disadvantage: equal dice until landing; separate committed bonus tray; save/mobile');
 assert.deepEqual(errors,[]);result.checks.push('no browser exceptions');
}catch(e){await page.screenshot({path:`${out}/failure.png`,fullPage:true});console.error('At',page.url(),(await page.locator('body').innerText()).slice(-2500),errors);throw e;}
finally{
 if(edited){const current=(await api('GET','/passive-presentations')).passives.find(row=>row.key===passiveBefore.key);const {key,...body}=passiveBefore;await api('PUT',`/passive-presentations/${key}`,{...body,version:current.version});}
 await writeFile(`${out}/acceptance.json`,JSON.stringify(result,null,2));await browser.close();
}
console.log(JSON.stringify(result,null,2));
