import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const {chromium,expect}=require('@playwright/test');
const base='http://127.0.0.1:3001';
const creds=JSON.parse(await readFile('outputs/party-maps-254/credentials.json','utf8'));
const login=await(await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(creds)})).json();assert(login.token);
const report=JSON.parse(await readFile('outputs/entity-tags-258/browser-acceptance.json','utf8'));
const response=await fetch(base+`/api/roguelike/runs/${report.runId}`,{headers:{Authorization:`Bearer ${login.token}`}});assert(response.ok);
const body=await response.json();const run=body.run??body;
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 await page.addInitScript(({token,user})=>{localStorage.setItem('auth_token',token);localStorage.setItem('user',JSON.stringify(user));localStorage.setItem('site-settings',JSON.stringify({playerMode:false,itemPreview:'interface'}));},login);
 await page.goto(base+`/shop/roguelike?roguelike=${report.runId}&character=${run.character_id}`);
 await expect(page.getByText('Постоянный ассортимент',{exact:true})).toBeVisible();
 await page.waitForFunction(()=>{const images=[...document.querySelectorAll('.shop-shelf-item img')].slice(0,4);return images.length===4&&images.every(i=>i.complete&&i.naturalWidth>0);},{},{timeout:45000});
 await page.screenshot({path:'outputs/entity-tags-258/tagged-starting-shop.png'});
 await page.goto(base+'/monsters?tag=d2580000-0000-4000-8000-000000000002');
 await expect(page.getByRole('combobox',{name:'Фильтр по тегу'})).toHaveValue('d2580000-0000-4000-8000-000000000002');
 await expect(page.getByText('Монстры не найдены.',{exact:true})).toBeVisible();
 console.log('PASS: merchant images loaded; monster tag filter applied');
} finally {await browser.close();}
