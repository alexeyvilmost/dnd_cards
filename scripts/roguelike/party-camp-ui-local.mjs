import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const {chromium,expect}=require('@playwright/test'),base='http://127.0.0.1:3001',out='outputs/party-maps-254';
const credentials=JSON.parse(await readFile(`${out}/credentials.json`,'utf8'));
const auth=await(await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(credentials)})).json();
async function api(method,path,body){const r=await fetch(`${base}/api${path}`,{method,headers:{Authorization:`Bearer ${auth.token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});assert(r.ok);return r.json();}
const templates=(await api('GET','/character-templates')).templates;
const names=[];
for(let i=0;i<3;i++){const name=`QA UI группа ${i} ${randomUUID().slice(0,5)}`;names.push(name);await api('POST',`/character-templates/${templates[i].id}/copies`,{name});}
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1050},ignoreHTTPSErrors:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.addInitScript(auth=>{localStorage.setItem('auth_token',auth.token);localStorage.setItem('user',JSON.stringify(auth.user));localStorage.setItem('boh:mobile-suggestion-dismissed','1');},auth);
 await page.goto(`${base}/roguelike`);await expect(page.locator('.run-party-selection')).toBeVisible({timeout:30000});
 for(const c of await page.locator('.run-party-selection input:checked').all())await c.uncheck();
 for(const name of names)await page.locator('.run-party-selection label').filter({hasText:name}).locator('input').check();
 const created=page.waitForResponse(r=>r.url().endsWith('/roguelike/runs')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'Начать забег · 3',exact:true}).click();const run=(await(await created).json()).run;
 await expect(page.locator('.run-party-member')).toHaveCount(3);
 await page.goto(`${base}/characters-v3/${run.character_id}?roguelike=${run.id}`);
 await expect(page.getByRole('link',{name:'Группа и лагерь'})).toBeVisible({timeout:30000});
 await page.getByRole('button',{name:'Малое зелье лечения',exact:true}).first().click();
 await page.getByRole('button',{name:new RegExp(names[1])}).click();
 await page.screenshot({path:`${out}/party-heal-sheet.png`,fullPage:true});
 const cast=page.waitForResponse(r=>r.url().endsWith('/commands')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'Применить',exact:true}).click();const response=await cast;
 assert.equal(response.status(),200);const payload=response.request().postDataJSON().payload;
 assert.equal(payload.actor_id,run.character_id);assert.deepEqual(payload.target_ids,[run.characters[1].id]);
 let updated=(await response.json()).run;
 assert(updated.characters.every((c,i)=>c.runtime_revision===run.characters[i].runtime_revision+1));
 await page.goto(`${base}/roguelike/${run.id}`);await expect(page.locator('.run-party-member')).toHaveCount(3);
 const firstRevision=updated.revision;
 const race=await Promise.all([0,1].map(()=>fetch(`${base}/api/roguelike/runs/${run.id}/commands`,{method:'POST',headers:{Authorization:`Bearer ${auth.token}`,'Content-Type':'application/json'},body:JSON.stringify({command_id:randomUUID(),expected_revision:firstRevision,type:'short_rest',payload:{}})})));
 assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
 updated=(await api('GET',`/roguelike/runs/${run.id}`)).run;assert.equal(updated.revision,firstRevision+1);assert.equal(updated.game_clock_hours,1);
 assert(updated.characters.every((c,i)=>c.runtime_revision===run.characters[i].runtime_revision+2));
 console.log(JSON.stringify({status:'passed',checks:['browser party selection/start','canonical potion action and ally selection','one atomic camp action updates all sheets','concurrent rests: exactly one commit'],runId:run.id}));
 await writeFile(`${out}/camp-ui-created.json`,JSON.stringify(run));assert.deepEqual(errors,[]);
}finally{await browser.close();}
