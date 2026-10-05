import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer,request as httpRequest} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {repositoryRoot,runsRoot} from '../testing/runtime.mjs';
import {assertRealOwnedPath,assertRunId} from '../testing/guards.mjs';
import {startTestStack} from '../testing/stack.mjs';
import {startTestUI} from '../testing/ui-server.mjs';
import {inspectTestUIManifest} from '../testing/ui-snapshot.mjs';
import {localAcceptanceContext} from '../testing/acceptance-context.mjs';
import {createScenarioAPI} from './scenarios.mjs';
import {browserPerformanceProxy} from './browser-proxy.mjs';
import {retainImmutableAssets,isRetainableAsset} from '../release/retained-assets.mjs';
const require=createRequire(new URL('../../frontend/package.json',import.meta.url)),{chromium}=require('@playwright/test');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const close=server=>new Promise((resolve,reject)=>{server.closeAllConnections?.();server.close(error=>error?reject(error):resolve());});
const origin=server=>`http://127.0.0.1:${server.address().port}`;

export async function checkPwaUpdate(stack,{previousRunDirectory,candidateRunDirectory}={}){
  const local=await localAcceptanceContext(stack.env),api=await createScenarioAPI(local);
  const previous=JSON.parse(await readFile(path.join(await assertRealOwnedPath(runsRoot,previousRunDirectory),'registry.json'),'utf8'));
  assertRunId(previous.runId);assert.equal(path.basename(previous.directory),previous.runId);
  const candidate=candidateRunDirectory?JSON.parse(await readFile(path.join(await assertRealOwnedPath(runsRoot,candidateRunDirectory),'registry.json'),'utf8')):stack.registry;
  assertRunId(candidate.runId);assert.equal(path.basename(candidate.directory),candidate.runId);
  const oldRoot=await assertRealOwnedPath(previous.directory,previous.uiBuild.directory),newRoot=await assertRealOwnedPath(candidate.directory,candidate.uiBuild.directory);
  assert.equal(candidate.uiBuild.reactProfile,false,'PWA requires the normal production build');
  const oldIndex=await readFile(path.join(oldRoot,'index.html')),newIndex=await readFile(path.join(newRoot,'index.html'));
  assert.equal(hash(oldIndex),previous.uiBuild.indexHash);assert.equal(hash(newIndex),candidate.uiBuild.indexHash);assert.notEqual(hash(oldIndex),hash(newIndex));
  assert.equal(hash(JSON.stringify(await inspectTestUIManifest(oldRoot))),previous.uiBuild.manifestHash);
  assert.equal(hash(JSON.stringify(await inspectTestUIManifest(newRoot))),candidate.uiBuild.manifestHash);
  const newScript=newIndex.toString().match(/<script[^>]*src="([^"]+)"/)?.[1];assert.ok(newScript);
  const directory=path.join(stack.registry.directory,'pwa-update');await mkdir(directory,{recursive:true});
  const retainedRoot=path.join(directory,'retained'),retention=await retainImmutableAssets(oldRoot,retainedRoot);
  const servers=[];let browser,proxy;const missing=[],retained=[],errors=[],writes=[];let deployed=false,update=false;
  try{
    const old=await startTestUI({root:oldRoot,apiOrigin:local.apiOrigin,cacheAssets:true});servers.push(old);
    const next=await startTestUI({root:newRoot,apiOrigin:local.apiOrigin,cacheAssets:true});servers.push(next);
    const historical=await startTestUI({root:retainedRoot,fixtureOnly:true,cacheAssets:true});servers.push(historical);
    const stable=createServer((req,res)=>{
      const route=new URL(req.url,'http://localhost').pathname;
      const forward=(base,fallback=false)=>{
        const target=new URL(base),upstream=httpRequest({hostname:target.hostname,port:target.port,method:req.method,path:req.url,headers:{...req.headers,host:target.host}},response=>{
          if(response.statusCode===404&&fallback&&req.method==='GET'&&isRetainableAsset(route.slice(1))){response.resume();retained.push(route);forward(origin(historical));return;}
          if(response.statusCode>=400&&!route.startsWith('/api/'))missing.push({path:route,status:response.statusCode,phase:deployed?(update?'updated':'old-tab-new-host'):'before'});
          res.writeHead(response.statusCode,response.headers);response.pipe(res);
        });
        upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});req.on('aborted',()=>upstream.destroy());
        if(fallback||!isRetainableAsset(route.slice(1)))req.pipe(upstream);else upstream.end();
      };
      forward(origin(deployed&&(route!=='/sw.js'||update)?next:old),deployed);
    });await new Promise(resolve=>stable.listen(0,'127.0.0.1',resolve));servers.push(stable);
    const stableOrigin=origin(stable);proxy=await browserPerformanceProxy([stableOrigin,local.apiOrigin]);
    browser=await chromium.launch({channel:'chrome',headless:true,proxy:{server:proxy.server},args:['--proxy-bypass-list=<-loopback>']});
    const context=await browser.newContext({serviceWorkers:'allow',viewport:{width:1440,height:1050}});
    await context.addInitScript(auth=>{localStorage.setItem('auth_token',auth.token);localStorage.setItem('user',JSON.stringify(auth.user));localStorage.setItem('boh:mobile-suggestion-dismissed','1');},api.auth);
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message.slice(0,180)));
    page.on('request',request=>{const u=new URL(request.url());if(u.pathname.startsWith('/api/')&&!['GET','HEAD'].includes(request.method()))writes.push({method:request.method(),path:u.pathname});});
    await page.goto(stableOrigin+'/library',{waitUntil:'networkidle',timeout:60000});
    await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload({waitUntil:'networkidle'});
    assert.equal(await page.evaluate(()=>Boolean(navigator.serviceWorker.controller)),true,'Version A did not install/control');
    const preDeployScripts=await page.evaluate(()=>performance.getEntriesByType('resource').map(row=>row.name).filter(name=>name.endsWith('.js')));
    deployed=true;
    await page.getByRole('button',{name:'Ещё',exact:true}).hover();
    await page.getByRole('link',{name:'Экспорт',exact:true}).click();await page.waitForURL('**/export');await page.waitForLoadState('networkidle');
    assert.ok(retained.some(name=>name.endsWith('.js')&&!preDeployScripts.some(url=>url.endsWith(name))),'No previously unseen old lazy chunk was served from retention');
    assert.deepEqual(errors,[]);assert.equal(await page.locator('body').innerText().then(text=>text.includes('Экспорт')),true);
    update=true;
    await page.evaluate(async()=>{const registration=await navigator.serviceWorker.getRegistration();if(!registration)throw Error('Registration absent');await registration.update();});
    await page.waitForFunction(script=>[...document.scripts].some(row=>row.getAttribute('src')===script),newScript,{timeout:30000});
    await page.waitForLoadState('networkidle');
    assert.equal(await page.evaluate(()=>Boolean(navigator.serviceWorker.controller)),true);assert.deepEqual(errors,[]);
    const priorMisses=new Set(missing.filter(row=>row.phase==='before'&&!isRetainableAsset(row.path.slice(1))).map(row=>`${row.status}:${row.path}`));
    assert.deepEqual(missing.filter(row=>!priorMisses.has(`${row.status}:${row.path}`)),[],'Release introduced a missing asset or lost an immutable chunk');
    assert.deepEqual(writes,[],'Passive PWA upgrade resent a mutation');
    assert.equal(hash(await readFile(path.join(oldRoot,'index.html'))),previous.uiBuild.indexHash);assert.equal(hash(await readFile(path.join(newRoot,'index.html'))),candidate.uiBuild.indexHash);
    assert.equal(hash(JSON.stringify(await inspectTestUIManifest(oldRoot))),previous.uiBuild.manifestHash);
    assert.equal(hash(JSON.stringify(await inspectTestUIManifest(newRoot))),candidate.uiBuild.manifestHash);
    const report={status:'passed',runId:stack.registry.runId,previousRunId:previous.runId,candidateRunId:candidate.runId,artifactHash:stack.registry.artifactHash,oldBuild:previous.uiBuild,newBuild:candidate.uiBuild,retention,retainedRequests:[...new Set(retained)],oldWorkerControlled:true,newWorkerControlled:true,newEntryLoaded:true,unseenOldLazyRoute:'export',pageErrors:errors,preexistingAssetMisses:missing,newMissingAssets:[],mutations:writes,fullBuildManifestsUnchanged:true,scope:'Two genuine immutable application builds, local stable origin, real service worker install/update and retained lazy import. No fabricated API responses; not a paid pending-command crash test.'};
    await writeFile(path.join(directory,'result.json'),JSON.stringify(report,null,2));return report;
  }catch(error){
    await writeFile(path.join(directory,'failure.json'),JSON.stringify({status:'failed',message:error.message,runId:stack.registry.runId,previousRunId:previous.runId,candidateRunId:candidate.runId,deployed,update,errors,missing,retained:[...new Set(retained)],writes},null,2));throw error;
  }finally{
    const cleanup=await Promise.allSettled([browser?.close(),proxy?.close(),...servers.reverse().map(close)]);
    const failed=cleanup.filter(row=>row.status==='rejected');if(failed.length)throw new AggregateError(failed.map(row=>row.reason),'PWA test cleanup failed');
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const baseline=JSON.parse(await readFile(path.join(repositoryRoot,'outputs/testing/final-core-5/report.json'),'utf8'));
  const candidateId=process.argv[process.argv.indexOf('--candidate-run')+1];const selected=process.argv.includes('--candidate-run')?assertRunId(candidateId):undefined;
  const stack=await startTestStack({profile:'integration',isolatedBuild:!selected,reuseBuild:Boolean(selected),performance:true});
  try{console.log(JSON.stringify({runId:stack.registry.runId,status:(await checkPwaUpdate(stack,{previousRunDirectory:path.join(runsRoot,baseline.fixture.run_id),candidateRunDirectory:selected?path.join(runsRoot,selected):undefined})).status}));}finally{await stack.cleanup();}
}
