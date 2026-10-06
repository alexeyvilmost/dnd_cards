import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export async function closeWriterBrowserResources({context,browser,proxy,browserConfiguration}){
 const errors=[];for(const resource of [context,browser,proxy])if(resource)try{await resource.close();}catch(error){errors.push(error);}
 if(browserConfiguration)try{await browserConfiguration.assertUnchanged();}catch(error){errors.push(error);}
 if(errors.length)throw new AggregateError(errors,'Writer browser resource cleanup failed');
}
// Presentation is the actual immutable OCI frontend. The only peer substitutes
// are the isolated external provider/S3 protocol endpoints, never application API.
export async function probeImageJobBrowser({adapter,accounts,id,surface,releaseIds,repositoryRoot=process.cwd(),browserConfiguration,frontendRole,compactReceipts=false}){
 const require=createRequire(path.join(repositoryRoot,'frontend/package.json'));
 const {chromium,expect}=require('@playwright/test');
 const {browserPerformanceProxy}=await import(pathToFileURL(path.join(repositoryRoot,'scripts/performance/browser-proxy.mjs')));
 let browser,context,proxy;const requests=[];let result;
 const marker=randomUUID();await adapter.assertOwned();await adapter.imageControl({id:marker,mode:'hold'});
 const auth=await adapter.request('/auth/login',{method:'POST',body:{username:accounts.admin.username,password:accounts.admin.password}});
 assert.equal(auth.status,200);assert.equal(typeof auth.body.token,'string');
 const saved=page=>page.evaluate(()=>Object.entries(localStorage).filter(([key])=>key.startsWith('image-job:')).map(([,value])=>value));
 const stats=()=>adapter.imageStats();
 async function fill(page){await page.getByRole('button',{name:'Свой промпт (перебивает стиль)',exact:true}).click();await page.getByPlaceholder('Полный промпт на английском — если заполнен, поля выше игнорируются').fill('owned-image-job:'+marker);}
 async function submit(page){const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/images/jobs/generate-standalone'&&r.request().method()==='POST');await page.getByRole('button',{name:'Сгенерировать',exact:true}).click();const accepted=await response;assert.equal(accepted.status(),202);const body=await accepted.json();assert.match(body.job.id,/^[a-f0-9-]{36}$/);return body.job.id;}
 try{
  if(browserConfiguration?.connect){
   // Local-only remote browser proof supplies its own internal-network allowlist.
   // The production hosted producer never selects this controller seam.
   browser=await browserConfiguration.connect(chromium);
  }else{
   proxy=await browserPerformanceProxy([surface.origin]);
   browser=await chromium.launch({...browserConfiguration?browserConfiguration.launch:{channel:process.platform==='win32'?'chrome':undefined},headless:true,proxy:{server:proxy.server},args:['--proxy-bypass-list=<-loopback>']});
  }
  if(browserConfiguration)await browserConfiguration.assertLaunched(browser);
  context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'allow'});
  await context.addInitScript(auth=>{localStorage.setItem('auth_token',auth.token);localStorage.setItem('user',JSON.stringify(auth.user));},auth.body);
  const page=await context.newPage();
  page.on('request',request=>{const pathname=new URL(request.url()).pathname;if(request.method()==='POST'&&['/api/images/jobs/generate-standalone','/api/images/generate-standalone'].includes(pathname))requests.push(pathname);});
  await page.goto(surface.origin+'/image-generator');await expect(page.getByRole('heading',{name:'Генерация изображений',exact:true})).toBeVisible();
  await fill(page);const jobId=await submit(page);
  await expect.poll(()=>saved(page)).toEqual([jobId]);
  await expect.poll(async()=>{const s=await stats();return s.jobs.find(row=>row.id===marker)?.calls??0;}).toBe(1);
  const providerBefore=(await stats()).providerCalls;
  await expect(page.getByRole('region',{name:'История генерации'})).toContainText('Генерируется');
  await page.reload();await expect(page.getByRole('heading',{name:'Генерация изображений',exact:true})).toBeVisible();
  const afterReload=await saved(page);assert.deepEqual(afterReload,[jobId]);
  await adapter.stopApplications();await adapter.start({...(frontendRole?{role:'previous',frontendRole}:{}),compactReceipts:false,imageJobs:false,releaseId:releaseIds.previous});
  await page.reload();await expect(page.getByRole('heading',{name:'Генерация изображений',exact:true})).toBeVisible();
  const capability=await adapter.request('/images/jobs/capabilities',{token:auth.body.token});assert.equal(capability.status,200);assert.equal(capability.body.enabled,false);
  await fill(page);const retriedId=await submit(page);assert.equal(retriedId,jobId);
  const afterOff=await saved(page);assert.deepEqual(afterOff,[jobId]);
  // History after the accepted OFF retry is loaded through the same real API.
  const savedJob=await adapter.request('/images/jobs/'+jobId,{token:auth.body.token});assert.equal(savedJob.status,200);assert.equal(savedJob.body.job.id,jobId);assert.ok(['running','unknown'].includes(savedJob.body.job.state));
  const after=(await stats());assert.equal(after.providerCalls,providerBefore);assert.equal(after.storageUploads,0);assert.equal(after.unexpected,0);
  assert.equal(requests.filter(route=>route==='/api/images/jobs/generate-standalone').length,2);assert.equal(requests.filter(route=>route==='/api/images/generate-standalone').length,0);
  result={id,jobIdBefore:jobId,jobIdAfterReload:afterReload[0],jobIdAfterOff:afterOff[0],capabilityOff:capability.body.enabled,jobRequests:2,syncRequests:0,providerCallsBefore:providerBefore,providerCallsAfter:after.providerCalls};
 }finally{await closeWriterBrowserResources({context,browser,proxy,browserConfiguration});}
 return result;
}
