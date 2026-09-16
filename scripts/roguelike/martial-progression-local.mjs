// Real local browser progression; XP is an explicitly marked QA fixture.
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const {chromium,expect}=require('@playwright/test');
const base='http://127.0.0.1:3001',out='outputs/martial-classes-256';
const creds=JSON.parse(await readFile('outputs/party-maps-254/credentials.json','utf8'));
const auth=await(await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(creds)})).json();assert(auth.token);
const builds=JSON.parse(await readFile(`${out}/builds.json`,'utf8'));
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1050},ignoreHTTPSErrors:true});
const errors=[],report=[];page.on('pageerror',e=>errors.push(e.message));
const get=async path=>{const r=await fetch(`${base}/api${path}`,{headers:{Authorization:`Bearer ${auth.token}`}});assert(r.ok);return r.json();};
try{
 await page.addInitScript(({token,user})=>{localStorage.setItem('auth_token',token);localStorage.setItem('user',JSON.stringify(user));localStorage.setItem('boh:mobile-suggestion-dismissed','1');},auth);
 for(const build of builds.filter(b=>b.level===1)){
  let sourceId=build.character.id;
  if(process.env.MARTIAL_FRESH_QA==='1'){
   const {id,user_id,access_mode,runtime_revision,created_at,updated_at,...copy}=build.character;
   const response=await fetch(`${base}/api/characters-v3`,{method:'POST',headers:{Authorization:`Bearer ${auth.token}`,'Content-Type':'application/json'},body:JSON.stringify({...copy,name:`QA 256 progression ${build.card} ${Date.now()}`})});
   assert.equal(response.status,201);const created=await response.json();sourceId=(created.character??created).id;
  }
  await page.goto(`${base}/characters-v3/${sourceId}`);
  await page.getByRole('button',{name:'Начать забег',exact:true}).click({timeout:30000});
  await page.waitForURL(/\/roguelike\/[a-f0-9-]+$/);
  const runId=page.url().split('/').at(-1);let run=(await get(`/roguelike/runs/${runId}`)).run;
  assert.equal(run.character.class_id,build.character.class_id);assert.notEqual(run.character_id,sourceId);
  const entry={class:build.card,runId,levels:[],xpFixture:true};report.push(entry);
  for(const [level,xp] of [[2,300],[3,900]]){
   if(run.character.level >= level)continue;
   const seeded=execFileSync('pwsh',['-NoProfile','-File','scripts/roguelike/seed-levelup-local.ps1','-RunId',runId,'-OwnerId',auth.user.id,'-Experience',String(xp)],{encoding:'utf8'});
   assert(seeded.includes(runId),'seed must update only the QA run');
   await page.goto(`${base}/characters-v3/${run.character_id}?roguelike=${runId}`);
   await page.getByRole('link',{name:new RegExp(`Уровень ${level}|Продолжить повышение`)}).click({timeout:30000});
   await expect(page.getByRole('button',{name:`Подтвердить уровень ${level}`,exact:true})).toBeVisible({timeout:30000});
   if(level===3){
    await page.getByText(build.card==='CLASS-barbarian'?'Путь берсерка':'Воин открытой ладони',{exact:true}).click();
    if(build.card==='CLASS-barbarian'){
     for(const name of ['Запугивание','Восприятие','Выживание','Уход за животными','Атлетика','Природа']){
      const skill=page.getByRole('button',{name,exact:true});
      if(await skill.isEnabled()){await skill.click();break;}
     }
    }
   }
   await writeFile(`${out}/${build.card}-level${level}-ui.txt`,await page.locator('body').innerText());
   await page.screenshot({path:`${out}/${build.card}-level${level}-forge.png`,fullPage:true});
   const confirm=page.getByRole('button',{name:`Подтвердить уровень ${level}`,exact:true});
   await expect(confirm).toBeEnabled({timeout:2000});
   await confirm.click();await page.waitForURL(/\/characters-v3\//,{timeout:40000});
   run=(await get(`/roguelike/runs/${runId}`)).run;
   assert.equal(run.character.level,level);assert.equal(run.character.class_id,build.character.class_id);assert.equal(run.pending_level??0,0);
   entry.levels.push({level,hp:run.character.max_hp,resources:run.character.max_resources});
   console.log(JSON.stringify({class:build.card,level,runId}));
  }
 }
 assert.deepEqual(errors,[]);
}finally{await writeFile(`${out}/progression.json`,JSON.stringify({report,errors},null,2));await browser.close();}
