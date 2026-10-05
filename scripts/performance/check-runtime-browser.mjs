import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {mkdir, writeFile} from 'node:fs/promises';
import {startTestStack} from '../testing/stack.mjs';
import {localAcceptanceContext} from '../testing/acceptance-context.mjs';
import {createScenarioAPI, createRunFixture, assertSame, digest} from './scenarios.mjs';
import {browserPerformanceProxy} from './browser-proxy.mjs';
const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const {chromium, expect}=require('@playwright/test');

export async function checkRuntimeBrowserFlow(stack) {
  const context=await localAcceptanceContext(stack.env),api=await createScenarioAPI(context);
  const fixture=await createRunFixture(context,{api});
  const sourceBefore=await api.request('GET',`/characters-v3/${fixture.sources[0].id}`);
  const proxy=await browserPerformanceProxy([context.uiOrigin,context.apiOrigin]);
  let browser;
  try {
    browser=await chromium.launch({channel:'chrome',headless:true,proxy:{server:proxy.server},args:['--proxy-bypass-list=<-loopback>']});
    const isolated=await browser.newContext({viewport:{width:1440,height:1050},serviceWorkers:'block'});
    await isolated.addInitScript(auth=>{
      localStorage.setItem('auth_token',auth.token);localStorage.setItem('user',JSON.stringify(auth.user));
      localStorage.setItem('boh:mobile-suggestion-dismissed','1');window.__DND_PERFORMANCE__=true;
      window.__runtimePhases=[];addEventListener('dnd:performance',event=>window.__runtimePhases.push(event.detail));
    },api.auth);
    const page=await isolated.newPage();let pageErrors=0;
    page.on('pageerror',()=>pageErrors++);
    const commands=[];
    page.on('request',request=>{
      if(request.method()==='POST'&&new URL(request.url()).pathname.endsWith('/equipment-commands')) {
        const body=request.postDataJSON();commands.push({id:body.command_id,keys:Object.keys(body).sort()});
      }
    });
    const route=`/characters-v3/${fixture.run.character_id}?roguelike=${fixture.run.id}`;
    await page.goto(context.uiOrigin+route,{waitUntil:'networkidle',timeout:60000});
    const before=await api.request('GET',`/characters-v3/${fixture.run.character_id}`);
    const equipped=Object.values(before.equipment??{}).find(id=>typeof id==='string');assert.ok(equipped);
    const card=await api.request('GET',`/cards/${equipped}`),escaped=card.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const pendingKey=`dnd:pending-equipment:v1:${fixture.run.character_id}`;
    async function select(label) {
      const navigation=page.getByRole('navigation',{name:'Разделы листа'});
      if(await navigation.count())await navigation.getByRole('button',{name:'Инвентарь',exact:true}).click();
      await page.getByRole('button',{name:new RegExp(escaped)}).first().click();
      await page.locator('.sheet-equip-overlay').getByRole('button',{name:label,exact:true}).click();
    }
    let loseResponse;
    const lost=new Promise((resolve,reject)=>{loseResponse={resolve,reject};});
    void lost.catch(()=>{}); // The request may fail while the click is still awaiting its handler.
    await page.route('**/equipment-commands',async intercepted=>{
      try {
        // Playwright route.fetch uses CONNECT even for this local HTTP URL;
        // the browser egress proxy intentionally forbids CONNECT. Forward this
        // one fault-injected request through the same guarded local API helper.
        const request=intercepted.request(),target=new URL(request.url());
        assert.equal(target.origin,context.uiOrigin);
        assert.equal(target.pathname,`/api/characters-v3/${fixture.run.character_id}/equipment-commands`);
        const headers=await request.allHeaders();
        const response=await context.request(target.pathname,{method:'POST',body:request.postData(),
          headers:{authorization:headers.authorization,'content-type':'application/json'}});
        if(response.status!==200) {
          let code='non_json';try{const rejected=await response.json();code=typeof rejected.code==='string'?rejected.code:'no_code';}catch{}
          throw Error(`Authoritative equipment status ${response.status} (${code}); origin ${target.origin}`);
        }
        await intercepted.abort('failed');loseResponse.resolve();
      } catch(error){await intercepted.abort('failed');loseResponse.reject(error);}
    },{times:1});
    await page.evaluate(()=>{window.__runtimePhases=[];});
    await select('Снять в сумку');await lost;
    await page.waitForFunction(key=>Boolean(localStorage.getItem(key)),pendingKey);
    const accepted=await api.request('GET',`/characters-v3/${fixture.run.character_id}`);
    assert.equal(Object.values(accepted.equipment??{}).includes(equipped),false);
    assert.equal(accepted.runtime_revision,before.runtime_revision+1);
    const preparedInBrowser=await page.evaluate(()=>window.__runtimePhases.filter(row=>row.phase==='sheet_combat_participant').length);
    assert.equal(preparedInBrowser,0,'Enabled equipment intent still performed the full browser build');
    await page.reload({waitUntil:'networkidle',timeout:60000});
    await page.waitForFunction(key=>localStorage.getItem(key)===null,pendingKey);
    assert.equal(commands.length,2);assert.equal(commands[0].id,commands[1].id);
    assertSame(await api.request('GET',`/characters-v3/${fixture.run.character_id}`),accepted,'Lost-response replay applied equipment again');
    await select('Надеть');
    await page.waitForFunction(key=>localStorage.getItem(key)===null,pendingKey);
    await expect.poll(async()=>Object.values((await api.request('GET',`/characters-v3/${fixture.run.character_id}`)).equipment??{}).includes(equipped)).toBe(true);
    const restored=await api.request('GET',`/characters-v3/${fixture.run.character_id}`);
    assertSame(restored.inventory_items,before.inventory_items,'Equipment cycle changed inventory');
    for(const command of commands)assertSame(command.keys,['command_id','expected_run_revision','expected_runtime_revision','operation','roguelike_run_id'],'Browser submitted more than identity/revisions');
    await fixture.command('start_encounter');
    let optionsRequests=0,initializeRequests=0;
    page.on('request',request=>{
      const pathname=new URL(request.url()).pathname;
      if(pathname.endsWith('/initiative-options'))optionsRequests++;
      if(request.method()==='POST'&&pathname===`/api/roguelike/runs/${fixture.run.id}/commands`&&request.postDataJSON().type==='initialize_combat')initializeRequests++;
    });
    await page.goto(`${context.uiOrigin}/characters-v3/${fixture.run.character_id}/combat?roguelike=${fixture.run.id}`,{waitUntil:'networkidle',timeout:60000});
    await expect.poll(async()=>Boolean((await api.request('GET',`/roguelike/runs/${fixture.run.id}`)).run.combat_state)).toBe(true);
    const initiativeBuilderCalls=await page.evaluate(()=>window.__runtimePhases.filter(row=>row.phase==='sheet_combat_participant').length);
    assert.equal(initiativeBuilderCalls,0,'Trusted initialization still performed the full browser build');
    assert.ok(optionsRequests>=1);assert.equal(initializeRequests,1);
    assertSame(await api.request('GET',`/characters-v3/${fixture.sources[0].id}`),sourceBefore,'UI changed the source sheet');
    assert.equal(pageErrors,0);
    const report={runId:stack.registry.runId,artifactHash:stack.registry.artifactHash,uiBuild:stack.registry.uiBuild,
      equipmentPosts:commands.length,samePendingCommandAfterReload:true,exactRetry:true,inventoryPreserved:true,
      equipmentBrowserBuildCalls:preparedInBrowser,initiativeBrowserBuildCalls:initiativeBuilderCalls,
      optionsRequests,initializeRequests,pageErrors,sourceIsolated:true,outcomeHash:digest(restored)};
    const output=path.join(stack.registry.directory,'runtime-browser');await mkdir(output,{recursive:true});
    await writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2));
    return report;
  } finally {if(browser)await browser.close();await proxy.close();}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const stack=await startTestStack({profile:'integration',reuseBuild:process.argv.includes('--reuse-ui-build'),
    equipmentIntent:true,initiativeOptions:true,performance:true});
  try {console.log(JSON.stringify(await checkRuntimeBrowserFlow(stack)));}
  finally{await stack.cleanup();}
}
