import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {repositoryRoot} from './runtime.mjs';
import {localAcceptanceContext} from './acceptance-context.mjs';
import {createScenarioAPI,createRunFixture} from '../performance/scenarios.mjs';
import {readSuites,catalogTests} from './suites.mjs';
import {checkBrowserFixtures} from './browser-fixtures.mjs';

export async function checkMediaMap(stack) {
  const local=await localAcceptanceContext(stack.env);
  const manifest=JSON.parse(await readFile(path.join(repositoryRoot,'outputs/maintenance/media-lossless-20261004-v2/manifest.json'),'utf8'));
  const rows=new Map(manifest.entries.map(row=>[row.sourceURL,row]));
  const api=await createScenarioAPI(local);
  const require=createRequire(path.join(repositoryRoot,'frontend/package.json'));
  const {chromium,expect}=require('@playwright/test');
  const browser=await chromium.launch({headless:true,channel:process.env.TEST_BROWSER_CHANNEL??(process.platform==='win32'?'chrome':undefined)});
  const results=[],attempts=[];
  try {
    for(let attempt=0;attempt<16&&results.length<2;attempt++) {
      const fixture=await createRunFixture(local,{api});
      await fixture.command('start_encounter');
      await fixture.command('initialize_combat');
      const source=fixture.run.combat_state?.battleMap?.background;
      assert.equal(typeof source,'string','Canonical initialized encounter needs a map background');
      const row=rows.get(source);assert.ok(row,'Map background absent from the verified source manifest');
      const kind=row.status==='variant'?'variant':'original';
      attempts.push({runId:fixture.run.id,map:fixture.run.combat_state.battleMap.generation?.templateId??fixture.run.combat_state.battleMap.id,source,kind});
      if(results.some(result=>result.kind===kind))continue;
      const context=await browser.newContext({viewport:{width:1440,height:1050},serviceWorkers:'block'});
      await local.isolateBrowser(context);
      await context.addInitScript(({token,user})=>{
        localStorage.setItem('auth_token',token);localStorage.setItem('user',JSON.stringify(user));
        localStorage.setItem('boh:mobile-suggestion-dismissed','1');
        localStorage.setItem('site-settings',JSON.stringify({combatRollMode:'standard',enemyCombatRollMode:'standard',dice3d:false,audioEnabled:false}));
      },api.auth);
      const page=await context.newPage(),errors=[],requests=[],responses=[];
      page.on('pageerror',error=>errors.push(error.name));
      page.on('request',request=>{const url=new URL(request.url());if(url.origin===local.uiOrigin&&!url.pathname.startsWith('/api/'))requests.push(url.pathname);});
      page.on('response',response=>{const url=new URL(response.url());if(url.origin===local.uiOrigin)responses.push({path:url.pathname,status:response.status(),type:response.headers()['content-type']});});
      const expected=kind==='variant'?row.variantURL:source;
      await page.goto(`${local.uiOrigin}/characters-v3/${fixture.run.character_id}/combat?roguelike=${fixture.run.id}`);
      const map=page.getByTestId('tactical-map');await expect(map).toBeVisible({timeout:30_000});
      await expect(map).toHaveCSS('background-image',`url("${local.uiOrigin}${expected}")`);
      const decoded=await page.evaluate(async url=>{const image=new Image();image.src=url;await image.decode();return {width:image.naturalWidth,height:image.naturalHeight};},expected);
      const originalBytes=await readFile(path.join(stack.registry.uiBuild.directory,row.sourcePath));
      assert.equal(originalBytes.subarray(1,4).toString(),'PNG','Original background must be PNG');
      const originalDimensions={width:originalBytes.readUInt32BE(16),height:originalBytes.readUInt32BE(20)};
      assert.deepEqual(decoded,originalDimensions);
      assert.ok(responses.some(response=>response.path===expected&&response.status===200),'Displayed background was not fetched successfully');
      if(kind==='variant')assert.ok(!requests.includes(source),'Screen fetched the original background in addition to its accepted variant');
      const imageResponse=await context.request.get(`${local.uiOrigin}${expected}`);assert.equal(imageResponse.status(),200);
      const body=await imageResponse.body(),bodyHash=createHash('sha256').update(body).digest('hex');
      assert.equal(bodyHash,kind==='variant'?row.variantSha256:row.sourceSha256);
      // Canonical saved/API/export input remains the original URL after rendering.
      const persisted=(await api.request('GET',`/roguelike/runs/${fixture.run.id}`)).run;
      assert.equal(persisted.combat_state.battleMap.background,source);
      const original=await context.request.get(`${local.uiOrigin}${source}`);assert.equal(original.status(),200);
      assert.equal(createHash('sha256').update(await original.body()).digest('hex'),row.sourceSha256);
      const screenshot=path.join(stack.registry.directory,'acceptance',`media-map-${kind}.png`);
      await map.screenshot({path:screenshot});assert.deepEqual(errors,[],'Real map raised a browser exception');
      results.push({kind,runId:fixture.run.id,source,screenURL:expected,canonicalSavedURL:persisted.combat_state.battleMap.background,
        decoded,response:responses.find(response=>response.path===expected),bodyBytes:body.length,bodyHash,
        originalBytes:row.sourceBytes,originalStillServed:true,originalScreenRequested:requests.includes(source),screenshot,pageErrors:errors});
      await context.close();
    }
    assert.ok(results.some(row=>row.kind==='variant'),'No natural canonical variant map selected within 16 fresh encounters');
    assert.ok(results.some(row=>row.kind==='original'),'No natural canonical original fallback map selected within 16 fresh encounters');
    const report={status:'passed',attempts,checks:results,method:'Natural canonical encounter generation; no saved combat, seed, map or receipt mutation; all APIs real',
      printBoundary:'Paper print/export is covered by the real main flows. Tactical map screen mapping does not rewrite saved original URLs; no claim that browser printing TacticalBattleMap switches its CSS back to PNG.',defaultDisabledBuild:'Not exercised by this opt-in build; resolver/build unit proof is separate'};
    await writeFile(path.join(stack.registry.directory,'acceptance','media-map.json'),JSON.stringify(report,null,2)+'\n');
    return report;
  } finally {await browser.close();}
}

export async function checkExtendedMediaBrowser(stack) {
  const report={};
  const catalog=catalogTests(readSuites().manifest).filter(row=>row.runner==='playwright'&&row.tier==='extended');
  assert.ok(catalog.length,'Extended browser fixture selector must not be empty');
  assert.ok(catalog.every(row=>row.file.startsWith('frontend/e2e/')),'Unmapped extended browser profile');
  for(const profile of ['production','battle3d']) {
    const files=catalog.map(row=>row.file).filter(file=>(file==='frontend/e2e/battle-3d.spec.ts')===(profile==='battle3d'));
    assert.ok(files.length,`Required ${profile} browser selector must not be empty`);
    report[profile]=await checkBrowserFixtures(stack,files,{profile});
    await writeFile(path.join(stack.registry.directory,'acceptance','media-extended.json'),JSON.stringify(report,null,2)+'\n');
  }
  return report;
}
