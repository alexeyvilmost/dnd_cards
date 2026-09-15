// Read-only check: search an image beyond the initially loaded page in the real local catalog.
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const {chromium,expect}=require('@playwright/test');
const base='http://127.0.0.1:3001';
const credentials=JSON.parse(await readFile('outputs/presets-250/acceptance.json','utf8'));
const auth=await (await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:credentials.username,password:credentials.password})})).json();
const get=async path=>await(await fetch(`${base}/api${path}`,{headers:{Authorization:`Bearer ${auth.token}`}})).json();
const first=await get('/image-library?page=1&limit=100'),second=await get('/image-library?page=2&limit=100');
const target=second.images.find(row=>row.card_name&&!first.images.some(item=>item.card_name===row.card_name));assert(target);
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1080}});
 await page.addInitScript(({token,user})=>{localStorage.setItem('auth_token',token);localStorage.setItem('user',JSON.stringify(user));},auth);
 await page.goto(`${base}/card-creator`);
 await page.getByRole('button',{name:'Изображение',exact:true}).click();
 await page.getByRole('button',{name:'Выбрать из библиотеки',exact:true}).click();
 await expect(page.locator('#image-scroll-container img')).toHaveCount(100,{timeout:30000});
 assert(!(await page.locator('#image-scroll-container img').evaluateAll(images=>images.map(img=>img.getAttribute('src')))).includes(target.cloudinary_url));
 const response=page.waitForResponse(r=>r.url().includes('/api/image-library?')&&new URL(r.url()).searchParams.get('search')===target.card_name);
 await page.getByPlaceholder('Введите название карты...').fill(target.card_name);
 const matches=await(await response).json();assert(matches.images.some(row=>row.id===target.id));
 await expect.poll(()=>page.locator('#image-scroll-container img').evaluateAll(images=>images.map(img=>img.getAttribute('src')))).toContain(target.cloudinary_url);
 await page.screenshot({path:'outputs/ui-polish-252/image-search.png'});
 await writeFile('outputs/ui-polish-252/image-search.json',JSON.stringify({total:first.pagination.total,targetID:target.id,targetName:target.card_name,passed:true},null,2));
 console.log('PASS whole-library search: a previously unloaded image is returned and displayed');
}finally{await browser.close();}
