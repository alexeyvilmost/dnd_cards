// Disposable local QA only. Never points at production or edits a player's run.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const {chromium,expect}=require('@playwright/test');
const base='http://127.0.0.1:3001',out='outputs/ui-polish-252';
const credentials=JSON.parse(await readFile('outputs/presets-250/acceptance.json','utf8'));
const auth=await (await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:credentials.username,password:credentials.password})})).json();
assert(auth.token,'local QA login');
const api=async(method,path,body)=>{const response=await fetch(`${base}/api${path}`,{method,headers:{Authorization:`Bearer ${auth.token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const result=await response.json();assert(response.ok,`${method} ${path}: ${JSON.stringify(result)}`);return result;};
await mkdir(out,{recursive:true});
const templates=(await api('GET','/character-templates')).templates;
const copies=[];
for(const template of templates.filter(t=>t.preset_key)){
 assert.equal(template.character.avatar_url,`/portraits/presets/${template.preset_key}.png`);
 assert((await fetch(`${base}${template.character.avatar_url}`)).ok);
 const copy=await api('POST',`/character-templates/${template.id}/copies`,{name:`UI-252 ${template.name} ${randomUUID().slice(0,6)}`});
 assert.equal(copy.avatar_url,template.character.avatar_url);assert.equal(copy.source_template_id,template.id);
 copies.push({preset:template.preset_key,id:copy.id});
}
let run=(await api('POST','/roguelike/runs',{source_character_id:copies.find(c=>c.preset==='archer').id})).run;
const acceptance={copies,runID:run.id,characterID:run.character_id,checks:[]};
await writeFile(`${out}/acceptance.json`,JSON.stringify(acceptance,null,2));
const browser=await chromium.launch({channel:'chrome',headless:true});
const errors=[];
let page;
const passiveBefore=(await api('GET','/passive-presentations')).passives.find(row=>row.key==='mastery.slow');
let passiveEdited=false;
try{
 page=await browser.newPage({viewport:{width:1440,height:1080}});
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(({token,user})=>{localStorage.setItem('auth_token',token);localStorage.setItem('user',JSON.stringify(user));localStorage.setItem('boh:mobile-suggestion-dismissed','1');},auth);
 await page.goto(`${base}/roguelike`);
 await expect(page.locator('.character-template-portrait')).toHaveCount(3,{timeout:30000});
 await page.screenshot({path:`${out}/presets.png`,fullPage:true});
 acceptance.checks.push('preset portraits and copy provenance');
 await page.goto(`${base}/shop/roguelike?roguelike=${run.id}`);
 await expect(page.locator('.shop-shelf-item').first()).toBeVisible({timeout:30000});
 await expect(page.locator('select').first()).toHaveValue(run.character_id);
 await expect.poll(()=>page.locator('.shop-shelf-item .cs-action-tile img').evaluateAll(images=>images.length>0&&images.every(img=>img.complete&&img.naturalWidth>0)),{timeout:20000}).toBe(true);
 await page.locator('.shop-shelf-item .cs-action-tile').first().hover();
 await expect(page.locator('.forge-effect-popover')).toBeVisible();
 await page.screenshot({path:`${out}/shop-hover.png`,fullPage:true});
 await page.mouse.move(5,5);
 const reserve=page.locator('.shop-reserve:not(:disabled)').first();
 if(await reserve.count()){
   await reserve.click();await expect(page.locator('.shop-reserve[aria-pressed="true"]')).toHaveCount(1);
   run=(await api('GET',`/roguelike/runs/${run.id}`)).run;
   assert(run.shop.offers.some(row=>row.pinned));
   acceptance.checks.push('server-backed shop reserve');
 }
 const buy=page.locator('.shop-buy:not(:disabled)').first();
 if(await buy.count()){
   const before=run.revision;await buy.click();
   await expect.poll(async()=>((await api('GET',`/roguelike/runs/${run.id}`)).run.revision),{timeout:10000}).toBeGreaterThan(before);
   acceptance.checks.push('server-backed shop purchase');
 }
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:`${out}/shop-mobile.png`,fullPage:true});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile horizontal overflow');
 await page.setViewportSize({width:1440,height:1080});
 await page.goto(`${base}/?type=passives`);
 await expect(page.locator('.passive-library article')).toHaveCount(6,{timeout:30000});
 await page.screenshot({path:`${out}/passives-library.png`,fullPage:true});
 await page.goto(`${base}/passive-creator?edit=mastery.slow`);
 await expect(page.getByRole('button',{name:'Сохранить',exact:true})).toBeEnabled({timeout:30000});
 await page.getByLabel('Название',{exact:true}).fill('Замедляющее — UI проверка');
 await page.getByLabel('Описание',{exact:true}).fill(passiveBefore.description+' Локальная проверка редактирования.');
 const png='data:image/png;base64,'+await readFile('frontend/public/icons/resources/action.png','base64');
 await page.getByLabel('Адрес изображения',{exact:true}).fill(png);
 passiveEdited=true;
 await page.getByRole('button',{name:'Сохранить',exact:true}).click();
 await expect(page.getByRole('status')).toHaveText('Оформление сохранено.');
 const saved=(await api('GET','/passive-presentations')).passives.find(row=>row.key==='mastery.slow');
 assert.equal(saved.name,'Замедляющее — UI проверка');
 assert.equal(saved.image_url,png);
 await page.reload();await expect(page.getByLabel('Название',{exact:true})).toHaveValue(saved.name);
 await page.screenshot({path:`${out}/passive-editor.png`,fullPage:true});
 acceptance.checks.push('passive constructor save and reload');
 const actions=[];
 for(let pageIndex=1; ;pageIndex++){const result=await api('GET',`/actions?limit=100&page=${pageIndex}`);actions.push(...result.actions);if(actions.length>=result.total)break;}
 const locked=actions.find(row=>row.support?.mechanics_locked);
 assert(locked,'locked library action exists');
 await page.goto(`${base}/action-creator?edit=${locked.id}`);
 await page.getByRole('button',{name:'Механика',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'JSON механики (только чтение)'})).toHaveAttribute('readonly','');
 await expect(page.getByRole('textbox',{name:'JSON механики (только чтение)'})).toHaveValue(JSON.stringify(locked.mechanics,null,2));
 await page.screenshot({path:`${out}/locked-mechanics.png`,fullPage:true});
 acceptance.checks.push('locked mechanics inspectable in real constructor');
 await page.goto(`${base}/characters-v3/${copies[0].id}`);
 await expect(page.locator('.sheet-feature-sections')).toBeVisible({timeout:30000});
 await expect(page.locator('.sheet-feature-section')).toHaveCount(3);
 await page.screenshot({path:`${out}/sheet-features.png`,fullPage:true});
 acceptance.checks.push('canonical source-grouped sheet');
 assert.deepEqual(errors,[]);
 acceptance.checks.push('no browser runtime errors');
} catch(error) {
 if(page){await page.screenshot({path:`${out}/failure.png`,fullPage:true});console.error('UI failure at',page.url(),(await page.locator('body').innerText()).slice(0,1600),errors);}
 throw error;
} finally {
 if(passiveEdited){const current=(await api('GET','/passive-presentations')).passives.find(row=>row.key===passiveBefore.key);const {key,...body}=passiveBefore;await api('PUT',`/passive-presentations/${key}`,{...body,version:current.version});}
 await writeFile(`${out}/acceptance.json`,JSON.stringify(acceptance,null,2));
 await browser.close();
}
console.log(JSON.stringify(acceptance,null,2));
