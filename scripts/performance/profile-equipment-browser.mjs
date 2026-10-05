import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {startTestStack} from '../testing/stack.mjs';
import {localAcceptanceContext} from '../testing/acceptance-context.mjs';
import {createScenarioAPI,assertSame,digest} from './scenarios.mjs';
import {browserPerformanceProxy} from './browser-proxy.mjs';
import {installBrowserVitals} from './browser-vitals.mjs';
const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const {chromium}=require('@playwright/test');
const backendBuildHash=async stack=>`sha256:${createHash('sha256').update(await readFile(path.join(stack.registry.directory,process.platform==='win32'?'backend.exe':'backend'))).digest('hex')}`;

export async function profileEquipmentBrowser(stack,{intent,repetitions=30,catalogBatch=false,preparationCache=false}={}){
  assert.equal(typeof intent,'boolean');assert.ok(Number.isInteger(repetitions)&&repetitions>0&&repetitions<=30);
  const context=await localAcceptanceContext(stack.env),api=await createScenarioAPI(context),admin=await createScenarioAPI(context,{role:'admin'});
  assert.equal((await api.request('GET','/characters-v3/equipment-authority')).enabled,intent);
  const template=(await api.request('GET','/character-templates')).templates.find(row=>row.preset_key==='line');assert.ok(template);
  const source=await api.request('POST',`/character-templates/${template.id}/copies`,{name:'Local UI performance fixture'},{status:201}),cards=[];
  for(const resource of [false,true])cards.push(await admin.request('POST','/cards',{name:resource?'Local measured capacity ring':'Local measured ordinary ring',description:'Disposable local fixture',rarity:'common',type:'ring',weight:.1,
    mechanics:resource?{activation:{mode:'passive',while:'equipped'},effects:[{resolution:'auto',result:[{kind:'resource',op:'grant',id:'measured_capacity',amount:3}]}]}:{}},{status:201}));
  await admin.request('PATCH',`/characters-v3/${source.id}/runtime`,{expected_runtime_revision:source.runtime_revision,inventory_items:[...(source.inventory_items??[]),...cards.map(card=>({card_id:card.id,qty:1}))]});
  const sourceBefore=await api.request('GET',`/characters-v3/${source.id}`),run=(await api.request('POST','/roguelike/runs',{source_character_id:source.id},{status:201})).run;
  const proxy=await browserPerformanceProxy([context.uiOrigin,context.apiOrigin]);let browser;const samples=[];
  try{
    browser=await chromium.launch({channel:'chrome',headless:true,proxy:{server:proxy.server},args:['--proxy-bypass-list=<-loopback>']});
    const isolated=await browser.newContext({viewport:{width:1440,height:1050},serviceWorkers:'block'});
    const vitals=await installBrowserVitals(isolated);
    await isolated.addInitScript(auth=>{
      localStorage.setItem('auth_token',auth.token);localStorage.setItem('user',JSON.stringify(auth.user));localStorage.setItem('boh:mobile-suggestion-dismissed','1');window.__DND_PERFORMANCE__=true;
      window.__equipmentMeasure=null;
      const maybeFinish=()=>{
        const m=window.__equipmentMeasure;if(!m?.start||!m.committed||m.finishing||localStorage.getItem(m.pendingKey)!==null)return;
        const equipped=[...document.querySelectorAll('.sheet-slot-item')].some(row=>row.getAttribute('alt')===m.name);
        if(equipped!==m.equipped)return;m.finishing=true;
        requestAnimationFrame(()=>requestAnimationFrame(()=>{m.end=performance.now();}));
      };
      addEventListener('dnd:performance',event=>{const m=window.__equipmentMeasure;if(!m?.start)return;m.phases.push(event.detail);if(event.detail.phase==='equipment_commit'){m.committed=true;maybeFinish();}});
      addEventListener('click',event=>{const m=window.__equipmentMeasure,target=event.target.closest?.('button');if(m&&!m.start&&target?.closest('.sheet-equip-overlay')&&target.textContent.trim()===m.button){m.start=performance.now();}},true);
      addEventListener('DOMContentLoaded',()=>new MutationObserver(maybeFinish).observe(document.body,{subtree:true,childList:true,attributes:true}));
    },api.auth);
    const page=await isolated.newPage();let errors=0,requests=0;page.on('pageerror',()=>errors++);page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/'))requests++;});
    await page.goto(`${context.uiOrigin}/characters-v3/${run.character_id}?roguelike=${run.id}`,{waitUntil:'networkidle',timeout:60000});
    const nav=page.getByRole('navigation',{name:'Разделы листа'});if(await nav.count())await nav.getByRole('button',{name:'Инвентарь',exact:true}).click();
    let previous=await api.request('GET',`/characters-v3/${run.character_id}`);
    for(const [index,card]of cards.entries())for(let iteration=-1;iteration<repetitions;iteration++)for(const operation of ['equip','unequip']){
      const equipped=operation==='equip',button=equipped?'Надеть':'Снять в сумку',escaped=card.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      await page.getByRole('button',{name:new RegExp(escaped)}).first().click();
      await page.evaluate(data=>{window.__equipmentMeasure={...data,start:0,end:0,phases:[],committed:false,finishing:false,profileStart:window.__localReactProfiles.length};},{name:card.name,equipped,button,pendingKey:`dnd:pending-equipment:v1:${run.character_id}`});
      requests=0;await page.locator('.sheet-equip-overlay').getByRole('button',{name:button,exact:true}).click();
      await page.waitForFunction(()=>window.__equipmentMeasure?.end>0,{},{timeout:60000});
      const sample=await page.evaluate(()=>{const m=window.__equipmentMeasure;return {click_to_ready_ms:m.end-m.start,phases:m.phases,reactProfiles:window.__localReactProfiles.slice(m.profileStart)};});
      if(stack.registry.uiBuild.reactProfile)assert.ok(sample.reactProfiles.some(row=>row.id==='SheetEquipmentPanel'),'Profiling build did not report equipment renders');
      const saved=await api.request('GET',`/characters-v3/${run.character_id}`);
      assert.equal(saved.runtime_revision,previous.runtime_revision+1);assert.equal(Object.values(saved.equipment??{}).includes(card.id),equipped);
      if(index)assert.equal(saved.max_resources?.measured_capacity??0,equipped?3:0,'Resource capacity differs from current placement');
      samples.push({scenario:`equipment_${index?'resource':'ordinary'}_${operation}`,iteration,warmup:iteration<0,requests,...sample,outcomeHash:digest(saved)});previous=saved;
    }
    assert.equal(errors,0);assertSame(await api.request('GET',`/characters-v3/${source.id}`),sourceBefore,'UI equipment changed source character');
    const browserMetrics=await vitals.finish(page);
    const report={runId:stack.registry.runId,artifactHash:stack.registry.artifactHash,backendBuildHash:await backendBuildHash(stack),uiBuild:stack.registry.uiBuild,fixture:stack.registry.fixture,intent,catalogBatch,preparationCache,repetitions,samples,browserMetrics,sourceIsolated:true,pageErrors:errors,
      measurement:'DOM click capture on the actual equipment button through committed mirror render and two animation frames; includes canonical browser preparation and actual API, excludes opening the item preview.'};
    const directory=path.join(stack.registry.directory,'equipment-browser');await mkdir(directory,{recursive:true});await writeFile(path.join(directory,'result.json'),JSON.stringify(report,null,2));return report;
  }finally{if(browser)await browser.close();await proxy.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const modes=process.argv.includes('--cache-compare')?[{intent:false,cache:false},{intent:true,cache:false},{intent:true,cache:true}]
    :(process.argv.includes('--compare')?[false,true]:[process.argv.includes('--intent')]).map(intent=>({intent,cache:process.argv.includes('--cache')}));let identity;
  for(const [index,{intent,cache}] of modes.entries()){const stack=await startTestStack({profile:'integration',isolatedBuild:true,reuseBuild:!process.argv.includes('--fresh-ui')||index>0,reactProfile:process.argv.includes('--react-profile'),performance:true,equipmentIntent:intent,catalogBatch:process.argv.includes('--batch'),preparationCache:cache});
    try{const current={artifactHash:stack.registry.artifactHash,backend:await backendBuildHash(stack),ui:stack.registry.uiBuild.manifestHash,fixture:digest(stack.registry.fixture)};if(identity)assertSame(current,identity,'Paired run source/build/fixture changed');identity=current;
      console.log(JSON.stringify({phase:'owned_ui_snapshot_ready',runId:stack.registry.runId,manifestHash:stack.registry.uiBuild.manifestHash,artifactHash:stack.registry.artifactHash,intent,cache}));
      const report=await profileEquipmentBrowser(stack,{intent,catalogBatch:process.argv.includes('--batch'),preparationCache:cache,repetitions:process.argv.includes('--smoke')?1:30});console.log(JSON.stringify({runId:report.runId,intent,cache,samples:report.samples.length,sourceIsolated:true}));
    }finally{await stack.cleanup();}
  }
}
