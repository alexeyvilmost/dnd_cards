// Browser integration of the real rest-choice collector/dialog and canonical
// previews. Uses a disposable QA sheet; never commits a rest or edits a player.
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const {chromium,expect}=require('@playwright/test');
const base='http://127.0.0.1:3001';
const access=JSON.parse(await readFile(new URL('../../outputs/presets-250/acceptance.json',import.meta.url),'utf8'));
const auth=await (await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:access.username,password:access.password})})).json();
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('UI error:',e.message);});
 await page.addInitScript(({token,user})=>{localStorage.setItem('auth_token',token);localStorage.setItem('user',JSON.stringify(user));localStorage.setItem('boh:mobile-suggestion-dismissed','1');},auth);
 await page.goto(`${base}/characters-v3/${access.created[0].sourceID}`);
 await page.getByRole('button',{name:'Долгий отдых',exact:false}).first().waitFor();
 await page.evaluate(async()=>{
  const React=(await import('/node_modules/.vite/deps/react.js')).default;
  const client=await import('/node_modules/.vite/deps/react-dom_client.js');
  const createRoot=client.createRoot ?? client.default.createRoot;
  const previewModule=await (await fetch('/src/components/SpellPreview.tsx')).text();
  const routerPath=previewModule.match(/from\s+["']([^"']*react-router-dom[^"']*)["']/)?.[1];
  if(!routerPath)throw Error('Vite router import not found');
  const {MemoryRouter}=await import(routerPath);
  const {ChoiceDialogProvider,useChoiceDialog}=await import('/src/contexts/ChoiceDialogContext.tsx');
  const {collectLongRestPreparationChoices}=await import('/src/character/sheetSpellPreparation.ts');
  const {spellsApi}=await import('/src/api/client.ts');
  const {getSettings,setSetting}=await import('/src/settings.ts');
  const spells=(await spellsApi.getSpells({level:1,limit:4})).spells;
  if(spells.length<2)throw Error('Need actual local library spells');
  const choice={id:'qa-prepare',source:'prepared_spell',prompt:'Подготовьте заклинания',count:2,
    origin:{id:'qa-class',kind:'class',name:'Волшебник'},allowedOptionIds:spells.map(s=>s.id)};
  const choices=collectLongRestPreparationChoices({assembled:{pendingChoices:[choice],spells},
    character:{resolved_choices:{'qa-prepare':spells.slice(0,2).map(s=>s.id)},turn_state:{}}});
  window.entityPresentationQA={names:spells.map(s=>s.name),setMode:mode=>setSetting('entityDisplay',{...getSettings().entityDisplay,spells:mode}),result:null};
  const host=document.createElement('div');document.body.append(host);
  function Harness(){const dialog=useChoiceDialog();return React.createElement('button',{style:{position:'fixed',top:4,left:4,zIndex:999},onClick:()=>dialog.request(choices,'Долгий отдых — подготовка заклинаний').then(result=>window.entityPresentationQA.result=result)},'QA: подготовка');}
  createRoot(host).render(React.createElement(MemoryRouter,{},React.createElement(ChoiceDialogProvider,{},React.createElement(Harness))));
 });
 for(const mode of ['row','icon']){
  await page.evaluate(mode=>window.entityPresentationQA.setMode(mode),mode);
  await page.getByRole('button',{name:'QA: подготовка',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Выбор при действии'});
  const entities=dialog.locator('.choice-spell-entities');
  await expect(dialog).toBeVisible();
  await expect(entities.locator(mode==='icon'?'.cs-action-tile':'.sheet-item-row')).toHaveCount(4);
  await expect(entities.locator('[aria-pressed="true"]')).toHaveCount(2);
  await entities.locator('button').first().hover();
  await expect(page.locator('.forge-effect-popover .sp-pagelink')).toBeVisible();
  await page.screenshot({path:`outputs/presets-250/prepared-spells-${mode}.png`});
  await page.mouse.move(5,950);
  await entities.locator('button').nth(2).click();
  await expect(entities.locator('[aria-pressed="true"]')).toHaveCount(2);
  await dialog.getByRole('button',{name:'Применить',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.entityPresentationQA.result?.['qa-prepare']?.length)).toBe(2);
 }
 await page.setViewportSize({width:390,height:844});
 await page.getByRole('button',{name:'QA: подготовка',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Выбор при действии'});
 await expect(dialog).toBeVisible();
 await page.screenshot({path:'outputs/presets-250/prepared-spells-mobile.png'});
 const bounds=await dialog.boundingBox();expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(391);
 expect(errors).toEqual([]);
 console.log('PASS real library spell previews, row/icon settings, current selections, choice IDs, confirmation and 390px layout');
}finally{await browser.close();}
