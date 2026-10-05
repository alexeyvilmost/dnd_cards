import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {startTestUI} from '../testing/ui-server.mjs';
import {startTestStack} from '../testing/stack.mjs';
import {localAcceptanceContext} from '../testing/acceptance-context.mjs';
import {browserPerformanceProxy} from './browser-proxy.mjs';
const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const {chromium,expect}=require('@playwright/test');

export async function checkPWAShell(stack){
 await localAcceptanceContext(stack.env);
 const root=stack.registry.uiBuild.directory;
 const bundle=JSON.parse(await readFile(path.join(root,'.vite/manifest.json'),'utf8'));
 const server=await startTestUI({root,fixtureOnly:true,cacheAssets:true});
 const origin=`http://127.0.0.1:${server.address().port}`,proxy=await browserPerformanceProxy([origin]);
 let browser;
 try {
  browser=await chromium.launch({channel:'chrome',headless:true,proxy:{server:proxy.server},args:['--proxy-bypass-list=<-loopback>']});
  const context=await browser.newContext({serviceWorkers:'allow'}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`${origin}/login`);await expect(page.getByLabel('Имя пользователя',{exact:true})).toBeVisible();
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
  await page.reload();await expect(page.getByLabel('Имя пользователя',{exact:true})).toBeVisible();
  await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller));
  const cachesBefore=await page.evaluate(async()=>Object.fromEntries(await Promise.all((await caches.keys()).map(async name=>[name,(await (await caches.open(name)).keys()).map(request=>new URL(request.url).pathname)]))));
  const precache=Object.entries(cachesBefore).filter(([name])=>name.startsWith('workbox-precache')).flatMap(([,urls])=>urls);
  assert.ok(precache.includes('/index.html'));assert.ok(precache.includes('/'+bundle['index.html'].file));
  const staticFiles=new Set();function collect(key){const entry=bundle[key];if(staticFiles.has(entry.file))return;staticFiles.add(entry.file);for(const imported of entry.imports??[])collect(imported);}collect('index.html');
  for(const entry of Object.values(bundle))if(entry.isDynamicEntry&&!staticFiles.has(entry.file))assert.ok(!precache.includes('/'+entry.file),`lazy route precached: ${entry.file}`);
  assert.ok(Object.values(cachesBefore).flat().every(url=>!url.startsWith('/api/')),'API data entered offline cache');
  await context.setOffline(true);await page.reload({waitUntil:'domcontentloaded'});
  await expect(page.getByLabel('Имя пользователя',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Войти',exact:true})).toBeVisible();
  assert.deepEqual(errors,[]);
  const report={run_id:stack.registry.runId,ui_build:stack.registry.uiBuild,precache_entries:precache.length,static_chunks:staticFiles.size,offline_visited_login:true,api_cache_entries:0,page_errors:0,status:'passed'};
  await writeFile(path.join(stack.registry.directory,'pwa-shell.json'),JSON.stringify(report,null,2));return report;
 } finally {if(browser)await browser.close();await proxy.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const stack=await startTestStack({profile:'integration',reuseBuild:true});
 try{console.log(JSON.stringify(await checkPWAShell(stack)));}finally{await stack.cleanup();}
}
