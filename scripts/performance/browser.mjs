import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {performance} from 'node:perf_hooks';
import {createScenarioAPI,createRunFixture,assertSame,digest} from './scenarios.mjs';
import {browserPerformanceProxy} from './browser-proxy.mjs';
const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const {chromium}=require('@playwright/test');

export async function runBrowserLatency(context,{repetitions=3}={}) {
  const api=await createScenarioAPI(context);
  const templates=await api.request('GET','/character-templates');
  const template=templates.templates.find(row=>row.preset_key==='line');assert.ok(template);
  const character=await api.request('POST',`/character-templates/${template.id}/copies`,{name:'Browser performance fixture'},{status:201});
  const proxy=await browserPerformanceProxy([context.uiOrigin,context.apiOrigin]);
  let browser;
  const samples=[],interactions=[];
  try {
    browser=await chromium.launch({channel:'chrome',headless:true,proxy:{server:proxy.server},args:['--proxy-bypass-list=<-loopback>']});
    for(const [scenario,route] of [['library','/library'],['forge',`/characters-v3/${character.id}/edit`],['sheet',`/characters-v3/${character.id}`],['paper','/paper-sheet']]) {
      for(let iteration=0;iteration<repetitions;iteration++) {
        const isolated=await browser.newContext({viewport:{width:1440,height:1050},serviceWorkers:'block'});
        await isolated.addInitScript(({auth})=>{
          localStorage.setItem('auth_token',auth.token);localStorage.setItem('user',JSON.stringify(auth.user));
          localStorage.setItem('boh:mobile-suggestion-dismissed','1');
          window.__DND_PERFORMANCE__=true;
          window.__localPerformance={events:[],longTasks:[],largestContentfulPaint:[],interactions:[]};
          const saved=window.__localPerformance;
          addEventListener('dnd:performance',event=>{if(saved.events.length<500)saved.events.push(event.detail);});
          for(const [type,key] of [['longtask','longTasks'],['largest-contentful-paint','largestContentfulPaint'],['event','interactions']]) {
            try {new PerformanceObserver(list=>{for(const entry of list.getEntries())if(saved[key].length<500)saved[key].push({startTime:entry.startTime,duration:entry.duration,interactionId:entry.interactionId??0});}).observe({type,buffered:true,...(type==='event'?{durationThreshold:16}:{})});}catch{}
          }
        },{auth:api.auth});
        const page=await isolated.newPage(),session=await isolated.newCDPSession(page);
        await session.send('Network.enable');await session.send('Performance.enable');
        let pageErrors=0;page.on('pageerror',()=>pageErrors++);
        for(const condition of ['cold_http_cache','warm_http_cache']) {
          await session.send('Network.setCacheDisabled',{cacheDisabled:condition==='cold_http_cache'});
          if(condition==='warm_http_cache') {
            await page.reload({waitUntil:'networkidle',timeout:60000}); // Explicit cache priming, not part of the sample.
          }
          const started=performance.now(),beforeMetrics=await session.send('Performance.getMetrics');
          const errorsBefore=pageErrors;
          await page.goto(`${context.uiOrigin}${route}`,{waitUntil:'domcontentloaded',timeout:60000});
          await page.locator('#root > *').first().waitFor({state:'visible',timeout:60000});
          await page.waitForLoadState('networkidle',{timeout:60000});
          const ready=performance.now()-started;
          const data=await page.evaluate(()=>{
            const saved=window.__localPerformance;
            const navigation=performance.getEntriesByType('navigation')[0]?.toJSON();
            const resources=performance.getEntriesByType('resource').map(row=>{
              const resource=row.toJSON(),url=new URL(resource.name);
              const kind=url.pathname.startsWith('/api/')?'api':/\.css$/.test(url.pathname)?'css':/\.m?js$/.test(url.pathname)?'js':/\.(png|webp|jpe?g|gif|svg|mp3|ogg|woff2?)$/i.test(url.pathname)?'media':'other';
              return {kind,start_ms:resource.startTime,duration_ms:resource.duration,transfer_bytes:resource.transferSize,encoded_bytes:resource.encodedBodySize,decoded_bytes:resource.decodedBodySize};
            });
            const lcp=saved.largestContentfulPaint.at(-1)?.startTime??null;
            return {navigation:navigation?Object.fromEntries(['duration','domContentLoadedEventEnd','loadEventEnd','responseStart','responseEnd','transferSize','encodedBodySize','decodedBodySize'].map(key=>[key,navigation[key]])):null,
              lcp_ms:lcp,resources,clientPhases:saved.events,longTasks:saved.longTasks,interactionTimings:saved.interactions};
          });
          const metrics=await session.send('Performance.getMetrics');
          const cachedAssets=data.resources.filter(row=>['js','css'].includes(row.kind)&&row.encoded_bytes>0&&row.transfer_bytes===0).length;
          const cumulative=['TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration','LayoutCount','RecalcStyleCount'];
          samples.push({scenario,iteration,cacheCondition:condition==='warm_http_cache'&&cachedAssets===0?'primed_process_http_cache_not_observed':condition,cached_asset_count:cachedAssets,ready_after_network_quiet_ms:ready,pageErrors:pageErrors-errorsBefore,...data,
            chromeMetrics:Object.fromEntries(metrics.metrics.filter(row=>[...cumulative,'JSHeapUsedSize','Nodes'].includes(row.name)).map(row=>[row.name,cumulative.includes(row.name)?row.value-(beforeMetrics.metrics.find(before=>before.name===row.name)?.value??0):row.value]))});
        }
        if(scenario==='sheet') {
          const before=await api.request('GET',`/characters-v3/${character.id}`);
          const equipped=Object.values(before.equipment??{}).find(value=>typeof value==='string');assert.ok(equipped);
          const card=await api.request('GET',`/cards/${equipped}`);
          const escaped=card.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
          for(const [operation,label] of [['unequip','Снять в сумку'],['equip','Надеть']]) {
            const navigation=page.getByRole('navigation',{name:'Разделы листа'});
            if(await navigation.count())await navigation.getByRole('button',{name:'Инвентарь',exact:true}).click();
            // Canonical icon mode prefixes the slot label ("Доспех: …");
            // row mode starts with the entity name. Support both settings.
            await page.getByRole('button',{name:new RegExp(escaped)}).first().click();
            const previous=await page.evaluate(()=>window.__localPerformance.events.filter(row=>row.phase==='equipment_commit').length);
            const started=performance.now();
            await page.locator('.sheet-equip-overlay').getByRole('button',{name:label,exact:true}).click();
            await page.waitForFunction(previous=>window.__localPerformance.events.filter(row=>row.phase==='equipment_commit').length>previous,previous,{timeout:30000});
            const clickToCommit=performance.now()-started;
            const restored=await api.request('GET',`/characters-v3/${character.id}`);
            assert.equal(Object.values(restored.equipment??{}).includes(equipped),operation==='equip','Browser equipment command did not persist');
            interactions.push({scenario:`sheet_${operation}`,iteration,click_to_commit_observed_ms:clickToCommit,
              phases:await page.evaluate(()=>window.__localPerformance.events.filter(row=>row.phase.startsWith('equipment_')).slice(-2)),
              eventTimings:await page.evaluate(()=>window.__localPerformance.interactions.slice(-10))});
          }
          const after=await api.request('GET',`/characters-v3/${character.id}`);
          assertSame(after.inventory_items,before.inventory_items,'Browser equipment changed inventory quantity');
        }
        await isolated.close();
        console.log(`Browser ${scenario}: ${iteration+1}/${repetitions}`);
      }
    }
    const fixture=await createRunFixture(context,{api});
    await fixture.command('start_encounter');await fixture.command('initialize_combat');
    const beforeHover=await api.request('GET',`/roguelike/runs/${fixture.run.id}`),privateBefore=await context.readRunInvariant?.(fixture.run.id);
    const hoverContext=await browser.newContext({viewport:{width:1440,height:1050},serviceWorkers:'block'});
    await hoverContext.addInitScript(auth=>{localStorage.setItem('auth_token',auth.token);localStorage.setItem('user',JSON.stringify(auth.user));localStorage.setItem('boh:mobile-suggestion-dismissed','1');},api.auth);
    const hoverPage=await hoverContext.newPage(),profiler=await hoverContext.newCDPSession(hoverPage);
    await hoverPage.goto(`${context.uiOrigin}/characters-v3/${fixture.run.character_id}/combat?roguelike=${fixture.run.id}`,{waitUntil:'networkidle',timeout:60000});
    const cells=hoverPage.locator('.tactical-cell');await cells.first().waitFor({state:'visible',timeout:60000});
    await profiler.send('Profiler.enable');await profiler.send('Profiler.start');
    const hoverDurations=[];
    for(let i=0;i<30;i++) {const started=performance.now();await cells.nth(i%await cells.count()).hover();await hoverPage.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));hoverDurations.push(performance.now()-started);}
    const {profile}=await profiler.send('Profiler.stop');
    const scripts=new Map();for(const node of profile.nodes) {
      const url=node.callFrame.url;const name=url.startsWith(context.uiOrigin)?new URL(url).pathname.split('/').at(-1):'browser/internal';
      scripts.set(name,(scripts.get(name)??0)+(node.hitCount??0));
    }
    assertSame(await api.request('GET',`/roguelike/runs/${fixture.run.id}`),beforeHover,'Hover changed saved run');
    if(privateBefore)assertSame(await context.readRunInvariant(fixture.run.id),privateBefore,'Hover changed RNG/artifact/envelope');
    interactions.push({scenario:'combat_hover',samples_ms:hoverDurations,cpu_profile_duration_us:profile.endTime-profile.startTime,cpu_samples:profile.samples?.length??0,
      scriptHitCounts:Object.fromEntries(scripts),outcomeHash:digest(beforeHover),savedStateUnchanged:true,reactComponentProfile:null});
    await hoverContext.close();
    return {browser:browser.version(),viewport:{width:1440,height:1050},samples,interactions,
      conditions:{navigation:'New document each sample; warm HTTP cache is explicitly primed. Application in-memory caches reset on navigation.',readiness:'Network quiet includes Playwright 500 ms quiet window; not a user-input latency metric.',interaction:'Playwright click/hover observation includes automation overhead; hover waits two animation frames. Click-to-commit excludes human decision time. These are not INP.',media:'External URLs blocked by local stand; PWA service worker blocked.',inp:'Event Timing entries are samples, not a complete web-vitals INP implementation; absent values remain unmeasured.',reactProfiler:'Standard production React build does not expose component commit profiles; Chrome CPU/task metrics reported separately.'}};
  } finally {await browser?.close();await proxy.close();}
}
