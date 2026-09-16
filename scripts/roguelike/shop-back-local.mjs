import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const {chromium,expect}=require('@playwright/test');
const base='http://127.0.0.1:3001';
const credentials=JSON.parse(await readFile('outputs/party-maps-254/credentials.json','utf8'));
const auth=await(await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(credentials)})).json();
assert(auth.token);
const response=await fetch(base+'/api/roguelike/runs/d6bdda67-06e4-4429-8152-68ef0e945aee',{headers:{Authorization:`Bearer ${auth.token}`}});
assert(response.ok);const {run}=await response.json();
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage();
 await page.addInitScript(({token,user})=>{localStorage.setItem('auth_token',token);localStorage.setItem('user',JSON.stringify(user));localStorage.setItem('boh:mobile-suggestion-dismissed','1');},auth);
 await page.route('**/api/**',route=>route.request().method()==='GET'?route.continue():route.abort());
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:900});
  await page.goto(`${base}/shop/roguelike?roguelike=${run.id}&character=${run.character_id}`);
  const back=page.getByRole('link',{name:'Назад',exact:true});
  await expect(back).toBeVisible();
  const expected=`/characters-v3/${run.character_id}?roguelike=${run.id}`;
  await expect(back).toHaveAttribute('href',expected);
  const box=await back.boundingBox();assert(box.x>=0&&box.x+box.width<=width);
  await back.click();await expect(page).toHaveURL(base+expected);
 }
 for(const origin of [`/roguelike/${run.id}`,`/characters-v3/${run.character_id}?roguelike=${run.id}`]){
  await page.setViewportSize({width:1440,height:900});
  await page.goto(base+origin);
  const entry=page.locator('a[href^="/shop/roguelike?"]').first();
  await expect(entry).toBeVisible();await entry.click();
  await expect(page.getByRole('link',{name:'Назад',exact:true})).toHaveAttribute('href',origin);
  await page.reload();
  await page.getByRole('link',{name:'Назад',exact:true}).click();
  await expect(page).toHaveURL(base+origin);
 }
 console.log('PASS: shop back link visible at 1440px/390px; returns to character sheet with run context; no game writes.');
 console.log('PASS: camp and character sheet entries return to their exact source page, including after reload.');
}finally{await browser.close();}
