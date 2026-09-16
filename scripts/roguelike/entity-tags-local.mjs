import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const {chromium,expect}=require('@playwright/test');
const base='http://127.0.0.1:3001',out='outputs/entity-tags-258';await mkdir(out,{recursive:true});
const creds=JSON.parse(await readFile('outputs/party-maps-254/credentials.json','utf8'));
const login=await(await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(creds)})).json();assert(login.token);
const api=async(path,method='GET',body,token=login.token)=>{const r=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await r.json();if(!r.ok)throw Error(`${r.status} ${path}: ${data.error}`);return data};
const initial=await api('/roguelike/shop-settings');assert(initial.can_manage);
const items=await api(`/cards?limit=1&tag=${initial.config.pool_tag}`);const card=items.cards[0];assert(card);
const feats=await api('/feats?limit=1');const feat=feats.feats[0];assert(feat);
const beforeCard=await api(`/entity-tags/card/${card.id}`),beforeFeat=await api(`/entity-tags/feat/${feat.id}`);
const beforeRule=await api(`/roguelike/item-rules/${card.id}`);
const tagName=`QA-tags-258-${Date.now()}`;let createdTag,editedSettings,run;const checks=[],errors=[];
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));
try{
 await page.addInitScript(({token,user})=>{localStorage.setItem('auth_token',token);localStorage.setItem('user',JSON.stringify(user));localStorage.setItem('site-settings',JSON.stringify({playerMode:false,itemPreview:'interface'}));localStorage.setItem('boh:mobile-suggestion-dismissed','1')},login);
 await page.goto(base+'/?type=cards');await page.getByRole('button',{name:'Справочник тегов',exact:true}).click();
 await page.getByLabel('Название нового тега').fill(tagName);await page.getByLabel('Описание тега',{exact:true}).fill('Проверка универсальных метаданных');
 await page.getByRole('button',{name:'Создать тег',exact:true}).click();await expect(page.getByRole('button',{name:tagName,exact:true})).toBeVisible();
 createdTag=(await api('/entity-tags')).tags.find(t=>t.name===tagName);assert(createdTag);checks.push('tag creation through website');
 await page.getByRole('button',{name:'Закрыть',exact:true}).click();
 await page.goto(base+`/?card=${card.id}`);await page.getByText('Изменить теги',{exact:true}).click();
 const selected=page.getByRole('checkbox',{name:new RegExp(tagName)});await selected.check();
 await expect(page.locator('.entity-tag-chips a').filter({hasText:tagName})).toBeVisible();
 await expect(selected).toBeEnabled();assert((await api(`/entity-tags/card/${card.id}`)).tags.some(t=>t.id===createdTag.id));checks.push('assign tag in canonical item detail');
 await page.getByText('Параметры товара забега',{exact:true}).click();await page.getByLabel('Предметов в пачке',{exact:true}).fill('2');await page.getByRole('button',{name:'Сохранить параметры товара',exact:true}).click();await expect(page.getByText('Сохранено. Новые предложения используют эти параметры.',{exact:true})).toBeVisible();assert.equal((await api(`/roguelike/item-rules/${card.id}`)).quantity,2);await api(`/roguelike/item-rules/${card.id}`,'PUT',beforeRule);checks.push('item bundle rules edited through website');
 await page.getByRole('link',{name:tagName,exact:true}).click();
 await expect(page.getByRole('combobox',{name:'Фильтр по тегу'})).toHaveValue(createdTag.id);
 let filtered=await api(`/cards?tag=${createdTag.id}&limit=1`);assert.equal(filtered.total,1);assert.equal(filtered.cards[0].id,card.id);checks.push('global tag filter + URL');
 // The same metadata contract works for a second, non-item entity.
 await api(`/entity-tags/feat/${feat.id}`,'PUT',{tag_ids:[...beforeFeat.tags.map(t=>t.id),createdTag.id]});
 const taggedFeats=await api(`/feats?tag=${createdTag.id}`);assert.equal(taggedFeats.total,1);assert.equal(taggedFeats.feats[0].id,feat.id);checks.push('same tag on a different entity type');
 await page.goto(base+`/?card=${card.id}`);await expect(page.locator('.entity-tag-chips a').filter({hasText:tagName})).toBeVisible();
 await page.evaluate(async()=>{const {setSetting}=await import('/src/settings.ts');setSetting('playerMode',true)});
 await expect(page.locator('.entity-tags')).toHaveCount(0);checks.push('player mode hides metadata');
 await page.evaluate(async()=>{const {setSetting}=await import('/src/settings.ts');setSetting('playerMode',false)});
 await page.goto(base+'/roguelike');await page.getByRole('button',{name:'Настройки магазина забега',exact:true}).click();
 await page.getByLabel('Уровень 1: slots',{exact:true}).fill('3');await page.getByLabel('Уровень 1: magic_limit',{exact:true}).fill('1');await page.getByLabel('Уровень 1: uncommon_bp',{exact:true}).fill('100');
 await page.getByRole('button',{name:'Сохранить настройки магазина',exact:true}).click();await expect(page.getByText('Настройки сохранены',{exact:true})).toBeVisible();
 editedSettings=await api('/roguelike/shop-settings');assert.equal(editedSettings.config.levels[0].uncommon_bp,10000);assert.equal(editedSettings.config.levels[0].magic_limit,1);checks.push('admin merchant configuration UI persisted');
 await page.screenshot({path:out+'/merchant-settings.png'});
 // Reject a stale save, rather than overwriting another administrator.
 const stale=await fetch(base+'/api/roguelike/shop-settings',{method:'PUT',headers:{'Content-Type':'application/json',Authorization:`Bearer ${login.token}`},body:JSON.stringify(initial)});assert.equal(stale.status,409);checks.push('concurrent settings edit rejected');
 const templates=await api('/character-templates');const template=templates.templates.find(t=>t.name==='Лучник')??templates.templates[0];assert(template);
 const source=await api(`/character-templates/${template.id}/copies`,'POST',{name:`QA теги 258 ${Date.now()}`});
 run=(await api('/roguelike/runs','POST',{source_character_id:source.id})).run;assert(run);assert(run.shop.offers.length<=3);
 const offerCards=await Promise.all(run.shop.offers.map(o=>api(`/cards/${o.card_id}`)));assert(offerCards.filter(c=>c.rarity!=='common').length<=1);assert(offerCards.some(c=>c.rarity==='uncommon'));assert(run.shop.staples.length>3);checks.push('new run uses settings and tagged starting stock');
 const staple=run.shop.staples.find(o=>o.card_number==='CARD-0728');assert(staple);const startGold=run.gold;
 const body={command_id:randomUUID(),expected_revision:run.revision,type:'buy',payload:{offer_id:staple.id}};
 const first=(await api(`/roguelike/runs/${run.id}/commands`,'POST',body)).run;const replay=(await api(`/roguelike/runs/${run.id}/commands`,'POST',body)).run;
 assert.equal(replay.gold,first.gold);assert.equal(replay.revision,first.revision);
 run=(await api(`/roguelike/runs/${run.id}/commands`,'POST',{...body,command_id:randomUUID(),expected_revision:first.revision})).run;
 assert.equal(run.gold,startGold-2*staple.price);assert.equal(run.shop.staples.find(o=>o.id===staple.id).sold,false);checks.push('unlimited purchases and idempotent command replay');
 await page.goto(base+`/shop/roguelike?roguelike=${run.id}&character=${run.character_id}`);await expect(page.getByText('Лавка странника',{exact:true})).toBeVisible();await expect(page.getByText('Постоянный ассортимент',{exact:true})).toBeVisible();await page.screenshot({path:out+'/tagged-starting-shop.png'});
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Настройки магазина забега',exact:true}).click();await expect(page.getByLabel('Уровень 1: slots',{exact:true})).toBeVisible();
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));await page.screenshot({path:out+'/merchant-settings-mobile.png'});checks.push('mobile settings stay inside viewport');
 // Pre-provisioned unprivileged local account: no implicit registration.
 const regularCreds=JSON.parse(await readFile(out+'/regular-credentials.json','utf8'));
 const regular=await api('/auth/login','POST',regularCreds);
 for(const [path,method,body] of [['/entity-tags','POST',{name:'forbidden'}],[`/entity-tags/card/${card.id}`,'PUT',{tag_ids:[]}],['/roguelike/shop-settings','PUT',editedSettings],[`/roguelike/item-rules/${card.id}`,'PUT',{}]]){
  const response=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',Authorization:`Bearer ${regular.token}`},body:JSON.stringify(body)});assert.equal(response.status,403,path);
 }checks.push('non-admin cannot create/assign tags or change shop rules');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({checks,runId:run.id}));
}finally{
 if(editedSettings){const now=await api('/roguelike/shop-settings');if(now.version===editedSettings.version)await api('/roguelike/shop-settings','PUT',{...initial,version:now.version});else errors.push('Settings changed concurrently; original config not overwritten');}
 await api(`/entity-tags/card/${card.id}`,'PUT',{tag_ids:beforeCard.tags.map(t=>t.id)});await api(`/entity-tags/feat/${feat.id}`,'PUT',{tag_ids:beforeFeat.tags.map(t=>t.id)});
 await api(`/roguelike/item-rules/${card.id}`,'PUT',beforeRule);
 await writeFile(out+'/browser-acceptance.json',JSON.stringify({checks,errors,createdTag,runId:run?.id},null,2));await browser.close();
}
