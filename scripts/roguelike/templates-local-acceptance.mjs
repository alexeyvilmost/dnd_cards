// Creates isolated QA personal sheets/runs in the local review DB; never use production.
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {localAcceptanceContext} from '../testing/acceptance-context.mjs';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(new URL('../../frontend/package.json',import.meta.url));
const {chromium,expect}=require('@playwright/test');
const context=await localAcceptanceContext();
const base=context.uiOrigin;
let token;
async function api(method,path,body,status=200) {
 const response=await context.request(`/api${path}`,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body==null?undefined:JSON.stringify(body)});
 const result=await response.json(); assert.equal(response.status,status,`${method} ${path}: unexpected HTTP status`);return result;
}
const {username,password}=context.player;
const login=await api('POST','/auth/login',{username,password});token=login.token;
const catalog=await api('GET','/character-templates');assert.equal(catalog.templates.length,3);assert.equal(catalog.can_manage,false);
for(const template of catalog.templates) for(const key of ['id','user_id','user','group_id','access_mode']) assert(!(key in template.character));
await api('PUT',`/character-templates/${catalog.templates[0].id}`,{name:'Forbidden',version:1},403);
const browser=await chromium.launch({channel:'chrome',headless:true});
const created=[];
try {
 const page=await browser.newPage({viewport:{width:1440,height:1050},serviceWorkers:'block'});
 await context.isolateBrowser(page.context());
 await page.addInitScript(({token,user})=>{localStorage.setItem('auth_token',token);localStorage.setItem('user',JSON.stringify(user));localStorage.setItem('boh:mobile-suggestion-dismissed','1');},login);
 await page.goto(`${base}/characters-forge`);
 await page.getByRole('button',{name:'Создать из шаблона',exact:true}).click();
 await expect(page.locator('.character-template-grid article')).toHaveCount(3);
 await expect(page.getByRole('button',{name:'Редактировать шаблон'})).toHaveCount(0);
 await page.screenshot({path:path.join(context.output,'templates-library.png')});
 const sword=page.locator('.character-template-grid article').filter({has:page.getByRole('heading',{name:'Мечник',exact:true})});
 await sword.getByRole('button',{name:'Создать копию'}).click();
 await page.getByRole('dialog').getByLabel('Имя',{exact:true}).fill('QA Мечник — личная копия');
 await page.getByRole('dialog').getByRole('button',{name:'Создать персонажа',exact:true}).click();
 await page.waitForURL(/\/characters-v3\/[0-9a-f-]+$/);
 const sourceID=new URL(page.url()).pathname.split('/').pop();
 const source=await api('GET',`/characters-v3/${sourceID}`);
 assert.equal(source.user_id,login.user.id);assert.equal(source.name,'QA Мечник — личная копия');assert.equal(source.character_type,'free');
 // Exercise the keyboard path as well as pointer activation elsewhere.
 await page.getByRole('button',{name:'Начать забег',exact:true}).focus();
 await page.keyboard.press('Enter');
 await page.getByRole('dialog',{name:'Забег персонажа'}).getByRole('button',{name:'Начать классический забег',exact:true}).click();
 await page.waitForURL(/\/roguelike\/[0-9a-f-]+$/);
 let runID=new URL(page.url()).pathname.split('/').pop();
 let run=(await api('GET',`/roguelike/runs/${runID}`)).run;
 assert.equal(run.source_character_id,sourceID);assert.notEqual(run.character_id,sourceID);
 assert.deepEqual(await api('GET',`/characters-v3/${sourceID}`),source);
 created.push({preset:'swordsman',sourceID,runID,characterID:run.character_id});
 // The preset launch path must be available independently of an existing sheet.
 for(const name of ['Лучник','Линейный боец']) {
  await page.goto(`${base}/roguelike`);
  await page.locator('.run-preset-row').filter({hasText:name}).getByRole('checkbox').check();
  await page.getByRole('button',{name:'Начать забег · 1',exact:true}).click();
  await page.getByRole('dialog',{name:'Имена участников группы'}).getByLabel(name,{exact:true}).fill(`QA ${name}`);
  await page.getByRole('dialog').getByRole('button',{name:'Создать и начать забег',exact:true}).click();
  await page.waitForURL(/\/roguelike\/[0-9a-f-]+$/);
  runID=new URL(page.url()).pathname.split('/').pop();run=(await api('GET',`/roguelike/runs/${runID}`)).run;
  const character=await api('GET',`/characters-v3/${run.character_id}`);
  assert.equal(character.user_id,login.user.id);assert.equal(character.character_type,'dungeon_crawl');
  assert.equal(character.current_hp,character.max_hp);
  created.push({preset:name,sourceID:run.source_character_id,runID,characterID:run.character_id});
 }
 assert.deepEqual(await api('GET','/character-templates'),catalog);
 // The current dialog explicitly selects an existing run; opening it alone
 // must not create another copy.
 await page.goto(`${base}/characters-v3/${sourceID}`);
 await page.getByRole('button',{name:'Начать забег',exact:true}).focus();
 await page.keyboard.press('Enter');
 await page.getByRole('dialog',{name:'Забег персонажа'}).locator('.start-run-dialog__run').click();
 await page.waitForURL(`${base}/roguelike/${created[0].runID}`);
 assert.equal((await api('GET','/roguelike/runs')).runs.length,3);
 await page.setViewportSize({width:390,height:844});await page.goto(`${base}/characters-forge`);
 await page.getByRole('button',{name:'Создать из шаблона',exact:true}).click();
 await expect(page.locator('.character-template-grid article')).toHaveCount(3);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'mobile page overflows');
 await writeFile(path.join(context.output,'templates.json'),JSON.stringify({runId:context.registry.runId,created},null,2));
 console.log('PASS: three templates, personal copy/rename, three run launches, source preservation, resume, non-admin protection, mobile layout');
} finally {await browser.close();}
