import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {repositoryRoot,execute} from '../testing/runtime.mjs';
import {startTestUI} from '../testing/ui-server.mjs';
import {browserPerformanceProxy} from './browser-proxy.mjs';
const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const {build}=require('esbuild'),{chromium}=require('@playwright/test');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const close=server=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
const distribution=values=>{const a=[...values].sort((a,b)=>a-b);return {count:a.length,median:a[Math.floor(a.length*.5)]??0,p95:a[Math.min(a.length-1,Math.ceil(a.length*.95)-1)]??0,total:a.reduce((a,b)=>a+b,0)};};

export async function profileMapBrowser({repetitions=30}={}){
  assert.ok(Number.isInteger(repetitions)&&repetitions>0&&repetitions<=30);
  const directory=path.join(repositoryRoot,'outputs/testing',`map-browser-${randomUUID()}`);await mkdir(directory,{recursive:true});
  const component='frontend/src/components/TacticalBattleMap.tsx';
  const before=await execute('git',['show',`HEAD:${component}`]),current=await readFile(path.join(repositoryRoot,component),'utf8');
  const reports=[];
  for(const [arm,source]of [['before',before],['current',current]]){
    const root=path.join(directory,arm);await mkdir(root,{recursive:true});
    const output=await build({entryPoints:[path.join(repositoryRoot,'scripts/performance/map-profile-entry.tsx')],outdir:root,bundle:true,format:'esm',platform:'browser',minify:true,jsx:'automatic',metafile:true,
      define:{'process.env.NODE_ENV':'"production"','import.meta.env':'{}'},loader:{'.png':'dataurl','.jpg':'dataurl','.svg':'dataurl','.woff2':'dataurl'},
      plugins:[{name:'local-renderer-profile',setup(builder){
        builder.onResolve({filter:/^react(?:\/jsx-runtime|\/jsx-dev-runtime)?$/},args=>({path:require.resolve(args.path)}));
        builder.onResolve({filter:/^react-dom(?:\/client)?$/},()=>({path:require.resolve('react-dom/profiling')}));
        builder.onLoad({filter:/TacticalBattleMap\.tsx$/},()=>({contents:source,loader:'tsx',resolveDir:path.join(repositoryRoot,'frontend/src/components')}));
        for(const [file,fn,key]of [['combatIllumination.ts','illuminationAt','lighting'],['auraTerrain.ts','auraSurfacesAt','surfaces']])builder.onLoad({filter:new RegExp(file.replace('.','\\.')+'$')},async args=>{
          const text=await readFile(args.path,'utf8'),pattern=new RegExp(`(export function ${fn}\\([^]*?\\)\\s*:[^{]+\\{)`);
          assert.equal((text.match(pattern)||[]).length,2,'Instrumented canonical seam changed');
          return {contents:text.replace(pattern,`$1 (window as any).__mapProfile && (window as any).__mapProfile.${key}++;`),loader:'ts'};
        });
      }}],logLevel:'silent'});
    const deps={};for(const file of Object.keys(output.metafile.inputs))if(!file.includes('node_modules')&&!file.startsWith('<'))deps[file]=file.replaceAll('\\','/')===component?hash(source):hash(await readFile(path.resolve(repositoryRoot,file)));
    await writeFile(path.join(root,'index.html'),'<html><head><link rel="stylesheet" href="/map-profile-entry.css"></head><body><div id="root"></div><script type="module" src="/map-profile-entry.js"></script></body></html>');
    const server=await startTestUI({root,fixtureOnly:true}),origin=`http://127.0.0.1:${server.address().port}`,proxy=await browserPerformanceProxy([origin]);let browser;
    try{
      browser=await chromium.launch({channel:'chrome',headless:true,proxy:{server:proxy.server},args:['--proxy-bypass-list=<-loopback>']});
      const context=await browser.newContext({viewport:{width:1600,height:1050},serviceWorkers:'block'}),page=await context.newPage(),errors=[];
      page.on('pageerror',error=>errors.push(error.message.slice(0,180)));
      await page.route('**/api/animations',route=>route.fulfill({json:{profiles:[],bindings:[],defaults:{}}}));
      await page.goto(origin,{waitUntil:'networkidle'});
      try{await page.locator('.tactical-cell').last().waitFor({timeout:10000});}catch(error){throw Error(`Renderer bootstrap failed (${errors.join('; ')}): ${error.message}`);}
      assert.equal(await page.locator('.tactical-cell').count(),432);
      assert.deepEqual(await page.evaluate(()=>window.__mapProfile.footprints),[1,2,3]);
      const hoverCells=await page.locator('.tactical-cell:not(.has-token)').evaluateAll(rows=>rows.map(row=>{const b=row.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2};}).filter(p=>p.x>100&&p.x<innerWidth-100&&p.y>100&&p.y<innerHeight-100).slice(0,10));
      assert.equal(hoverCells.length,10,'Visible map cells required for real pointer input');
      const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');await cdp.send('Profiler.enable');
      const samples=[];
      for(const scenario of ['hover','target','movement_presentation','animation']){
        await page.mouse.move(1590,1040);await page.waitForTimeout(700);
        const metric=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(row=>[row.name,row.value]));
        const initial=await metric();await cdp.send('Profiler.start');
        const start=await page.evaluate(()=>{const x=window.__mapProfile;return {at:performance.now(),renders:x.renders.length,frames:x.frames.length,longTasks:x.longTasks.length,lighting:x.lighting,surfaces:x.surfaces};});
        for(let i=0;i<repetitions;i++){
          if(scenario==='hover'){const point=hoverCells[i%hoverCells.length];await page.mouse.move(point.x,point.y);if(i===0)await page.mouse.click(point.x,point.y);}
          else await page.getByRole('button',{name:{target:'Target',movement_presentation:'Movement presentation',animation:'Animation'}[scenario],exact:true}).click();
          await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        }
        if(scenario==='animation')await page.waitForTimeout(700);
        const measured=await page.evaluate(start=>{const x=window.__mapProfile;return {elapsed_ms:performance.now()-start.at,renders:x.renders.slice(start.renders),frames:x.frames.slice(start.frames).map(x=>x.duration),longTasks:x.longTasks.slice(start.longTasks),lightingCalls:x.lighting-start.lighting,surfaceCalls:x.surfaces-start.surfaces,immutableInput:x.unchanged()};},start);
        const final=await metric(),cpu=await cdp.send('Profiler.stop');await writeFile(path.join(root,`${scenario}.cpuprofile`),JSON.stringify(cpu.profile));
        assert.equal(measured.immutableInput,true);if(arm==='current'&&['hover','target','animation'].includes(scenario))assert.equal(measured.lightingCalls,0,'Overlay repeated static lighting');
        samples.push({scenario,...measured,react:distribution(measured.renders.map(row=>row.actualDuration)),raf:distribution(measured.frames),cpu_ms:Object.fromEntries(['TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration'].map(key=>[key,(final[key]-initial[key])*1000]))});
      }
      assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>window.__mapProfile.clicks),1);
      const labels=await page.locator('.tactical-cell').evaluateAll(rows=>rows.map(row=>({label:row.getAttribute('aria-label'),illumination:row.getAttribute('data-illumination')})));
      reports.push({arm,sourceHash:hash(source),dependencyHashes:deps,renderedProjectionHash:hash(JSON.stringify(labels)),samples,pageErrors:errors.length,chrome:browser.version()});
    }finally{if(browser)await browser.close();await proxy.close();await close(server);}
  }
  assert.equal(reports[0].renderedProjectionHash,reports[1].renderedProjectionHash,'Canonical cell projection changed');
  const report={status:'passed',directory,repetitions,fixture:{width:24,height:18,lights:4,footprints:[1,2,3]},scope:'renderer-only; movement presentation input and animation beats, no authoritative command or saved game mutation',comparison:'Only TacticalBattleMap.tsx differs: HEAD versus current; all dependencies/fixture shared. Profiling React overhead included; sequential local Chromium diagnostic, not production latency.',reports};
  await writeFile(path.join(directory,'result.json'),JSON.stringify(report,null,2));return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const report=await profileMapBrowser({repetitions:process.argv.includes('--smoke')?2:30});console.log(JSON.stringify({status:report.status,directory:report.directory,summary:report.reports.map(row=>({arm:row.arm,samples:row.samples.map(sample=>({scenario:sample.scenario,react:sample.react,cpu_ms:sample.cpu_ms,lightingCalls:sample.lightingCalls}))}))}));}
