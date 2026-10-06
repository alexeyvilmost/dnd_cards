// Executed inside the pinned Playwright OCI on an owned internal network.
import assert from 'node:assert/strict';import {readFile,writeFile} from 'node:fs/promises';import {createHash,randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
const input=JSON.parse(await readFile(process.argv[2],'utf8')),output=process.argv[3];
assert.match(input.owner,/^rehearsal_[a-f0-9]{24}$/);assert.equal(input.origin,'https://gateway:8443');
assert.match(input.account?.username,/^rehearsal_[a-f0-9]{16}$/);assert.match(input.account?.password,/^[a-f0-9]{64}$/);
// JSON object property order is not data; arrays, IDs, values and every field
// remain exact. This matches the canonical owned E2E comparison contract.
const canonical=value=>Array.isArray(value)?value.map(canonical):value!==null&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const digest=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const browser=await chromium.launch({headless:true,args:['--disable-dev-shm-usage']}),context=await browser.newContext({serviceWorkers:'block',acceptDownloads:true,ignoreHTTPSErrors:true});
const evidence={owner:input.owner,status:'running',execution:'docker',checks:{}},errors=[],requests=[];let page;
try{
  await context.route('**/*',route=>{const url=new URL(route.request().url());return ['data:','blob:','about:'].includes(url.protocol)||url.origin===input.origin?route.continue():route.abort();});
  page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{const url=new URL(request.url());if(!['data:','blob:'].includes(url.protocol))requests.push({method:request.method(),origin:url.origin,path:url.pathname});});page.on('requestfailed',request=>{const url=new URL(request.url());requests.push({failed:request.failure()?.errorText,origin:url.origin,path:url.pathname});});page.setDefaultTimeout(30000);
  const api=async(route,body,method=body?'POST':'GET',token)=>{const response=await context.request.fetch(input.origin+'/api'+route,{method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},...(body?{data:body}:{})});assert.ok([200,201].includes(response.status()),'Owned real API status '+response.status());return response.json();};
  const suffix=randomUUID().slice(0,8),{username,password}=input.account;
  await page.goto(input.origin+'/login');assert.equal(await page.evaluate(()=>isSecureContext&&typeof crypto.randomUUID==='function'),true);await page.getByLabel('Имя пользователя',{exact:true}).fill(username);await page.getByLabel('Пароль',{exact:true}).fill(password);
  const loginWait=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/auth/login');await page.getByRole('button',{name:'Войти',exact:true}).click();assert.equal((await loginWait).status(),200);await page.waitForURL(url=>!url.pathname.startsWith('/login'));
  const token=await page.evaluate(()=>localStorage.getItem('auth_token'));assert.ok(token);evidence.checks['api-routing']={status:'passed',realLogin:true};
  const catalog=await api('/character-templates',undefined,'GET',token),preset=catalog.templates.find(row=>row.preset_key==='swordsman');assert.ok(preset);
  const character=await api(`/character-templates/${preset.id}/copies`,{name:'Mixed OCI '+suffix},'POST',token);assert.ok(character.id);
  const before=await api('/characters-v3/'+character.id,undefined,'GET',token),equipped=Object.values(before.equipment).find(value=>typeof value==='string');assert.ok(equipped);
  const card=await api('/cards/'+equipped,undefined,'GET',token);await page.goto(input.origin+'/characters-v3/'+character.id);await page.locator('.cs-ac-v').waitFor();evidence.checks.character={status:'passed',idHash:digest(character.id)};
  const poll=async read=>{for(let i=0;i<120;i++){if(await read())return;await new Promise(resolve=>setTimeout(resolve,250));}throw Error('Persisted UI operation timed out');};
  const nav=page.getByRole('navigation',{name:'Разделы листа'});if(await nav.count())await nav.getByRole('button',{name:'Инвентарь',exact:true}).click();
  const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  await page.getByRole('button',{name:new RegExp(': '+escape(card.name)+'$')}).first().click();await page.locator('.sheet-equip-overlay').getByRole('button',{name:'Снять в сумку',exact:true}).click();
  await poll(async()=>!Object.values((await api('/characters-v3/'+character.id,undefined,'GET',token)).equipment).includes(equipped));await page.reload();await page.locator('.cs-ac-v').waitFor();if(await nav.count())await nav.getByRole('button',{name:'Инвентарь',exact:true}).click();
  await page.getByRole('button',{name:new RegExp('^'+escape(card.name)+'(?:\\s|$)')}).first().click();await page.locator('.sheet-equip-overlay').getByRole('button',{name:'Надеть',exact:true}).click();
  await poll(async()=>Object.values((await api('/characters-v3/'+character.id,undefined,'GET',token)).equipment).includes(equipped));
  const after=await api('/characters-v3/'+character.id,undefined,'GET',token);assert.equal(digest(after.inventory_items),digest(before.inventory_items));assert.equal(digest(after.resources),digest(before.resources));evidence.checks.equipment={status:'passed',inventoryHash:digest(after.inventory_items),resourcesHash:digest(after.resources)};
  await page.goto(input.origin+'/paper-sheet');await page.getByRole('button',{name:'Создать лист',exact:true}).click();await page.waitForURL(/\/paper-sheet\/[a-f0-9-]+$/);
  const paperID=new URL(page.url()).pathname.split('/').at(-1),name='Mixed paper '+suffix;await page.getByLabel('Имя персонажа',{exact:true}).fill(name);
  await poll(async()=>(await api('/paper-sheets/'+paperID,undefined,'GET',token)).document.fields.name===name);await page.reload();assert.equal(await page.getByLabel('Имя персонажа',{exact:true}).inputValue(),name);evidence.checks.paper={status:'passed',persisted:true};
  await page.getByRole('button',{name:'Настройки листа',exact:true}).click();const downloadWait=page.waitForEvent('download');await page.getByRole('button',{name:'Скачать лист JSON',exact:true}).click();const download=await downloadWait;
  const exported=JSON.parse(await readFile(await download.path(),'utf8')),saved=await api('/paper-sheets/'+paperID,undefined,'GET',token);assert.deepEqual(exported,saved.document);evidence.checks['json-export']={status:'passed',documentHash:digest(exported)};
  await page.getByRole('button',{name:'Закрыть окно',exact:true}).click();await page.emulateMedia({media:'print'});const pdf=await page.pdf({format:'A4',printBackground:true});assert.equal(pdf.subarray(0,5).toString(),'%PDF-');assert.ok(pdf.length>1000);evidence.checks['pdf-export']={status:'passed',bytes:pdf.length,sha256:createHash('sha256').update(pdf).digest('hex')};
  assert.deepEqual(errors,[]);evidence.status='passed';
}catch(error){evidence.status='failed';evidence.failure=error.message;await writeFile('failure-private.json',JSON.stringify({failure:error.message,alerts:await page?.getByRole('alert').allTextContents(),errors,requests},null,2),{mode:0o600});process.exitCode=1;}
finally{await context.close();await browser.close();await writeFile(output,JSON.stringify(evidence,null,2)+'\n',{mode:0o600});}
