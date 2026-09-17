// Local browser acceptance. Uses real remote audio playback, not an Audio mock.
import {readFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const {chromium,expect}=require('@playwright/test'),base='http://127.0.0.1:3001';
const creds=JSON.parse(await readFile('outputs/party-maps-254/credentials.json','utf8'));
const login=await(await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(creds)})).json();assert(login.token);
const response=await fetch(base+'/api/audio',{headers:{Authorization:`Bearer ${login.token}`}});assert(response.ok);const catalog=await response.json();
assert.equal(catalog.cues.length,34);assert(catalog.cues.every(c=>c.url.startsWith('https://storage.yandexcloud.net/dnd-cards-images/audio/roguelike-v1/')));
assert(catalog.bindings.length>=5);
const fixture=JSON.parse(await readFile('outputs/cover-symmetry/battle-before.json','utf8')).events[0].record.baseline.state;
const browser=await chromium.launch({channel:'chrome',headless:true});await mkdir('outputs/audio-260',{recursive:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(({token,user})=>{
  localStorage.setItem('auth_token',token);localStorage.setItem('user',JSON.stringify(user));localStorage.setItem('boh:mobile-suggestion-dismissed','1');localStorage.setItem('site-settings',JSON.stringify({audioEnabled:true,playerMode:false}));
  window.audioMedia=[];window.audioPlayFailures=[];const original=HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play=function(){window.audioMedia.push(this);const promise=original.call(this);promise.catch(e=>window.audioPlayFailures.push({src:this.src,message:e.message}));return promise;};
 },login);
 await page.goto(base+'/settings');await page.getByRole('button',{name:'Звук и музыка',exact:false}).click();
 await page.getByRole('button',{name:'Проверить звук кубиков',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.audioMedia.some(a=>a.src.includes('dice.roll')&&a.currentTime>0&&!a.error))).toBe(true);
 await expect(page.locator('.audio-volume')).toHaveCount(4);await page.screenshot({path:'outputs/audio-260/settings-desktop.png'});
 await page.getByLabel('Включить звук',{exact:false}).uncheck();
 assert(await page.evaluate(()=>window.audioMedia.every(a=>a.paused||a.volume===0)));
 await page.getByLabel('Включить звук',{exact:false}).check();
 await page.goto(base+'/roguelike');await page.locator('h1').first().click();
 await expect.poll(()=>page.evaluate(()=>window.audioMedia.some(a=>a.src.includes('music.camp')&&a.currentTime>.1&&a.volume>0))).toBe(true);
 // Exercise real map feedback + sound dispatch on a read-only isolated fixture.
 await page.evaluate(async({state,catalog})=>{
  const React=(await import('/node_modules/.vite/deps/react.js')).default,client=await import('/node_modules/.vite/deps/react-dom_client.js');
  const {default:Map}=await import('/src/components/TacticalBattleMap.tsx');
  const {soundPlayer}=await import('/src/audio/player.ts');const {playCombatBeat}=await import('/src/audio/combatSounds.ts');
  await import('/src/pages/SoloCombatPage.css');soundPlayer.setCatalog(catalog);
  const hero=state.characterId,enemy=Object.keys(state.tokens).find(id=>id!==hero);
  const host=document.createElement('div');host.style.cssText='position:fixed;inset:0;z-index:500;background:#121411;padding:30px;color:#eed9b3';document.body.append(host);const root=(client.createRoot??client.default.createRoot)(host);
  let count=0;
  window.audioQA={play:(visual,miss=false,heal=false,entity=false)=>{
   const action=catalog.bindings[0];state={...state,actionPresentation:{...state.actionPresentation,qa:{entityType:action.entity_type,entityId:action.entity_id}}};
   const beat={id:`qa:${++count}`,sourceId:hero,sourceName:'QA',targetId:enemy,actionName:'QA',actionId:entity?'qa':undefined,visual,from:state.tokens[hero].position,to:state.tokens[enemy].position,cues:heal?[{actorId:hero,text:'+6',kind:'healing'}]:miss?[{actorId:enemy,text:'Промах',kind:'miss'}]:[{actorId:enemy,text:'5',kind:'damage'}],roll:{kind:'d20',dice:[{sides:20,result:10}],total:15,modifiers:[],advantage:'none',outcome:miss?'miss':'hit'}};
   root.render(React.createElement('div',{className:'combat-stage',style:{height:'90vh'}},React.createElement(Map,{state,actorId:hero,feedback:beat,onCell:()=>{}})));playCombatBeat(state,beat);
  },clear:()=>{root.unmount();host.remove();},music:key=>soundPlayer.setMusic(key)};
 },{state:fixture,catalog});
 for(const kind of ['slashing','piercing','bludgeoning','ranged','magic'])for(const miss of [false,true]){
  const key=`attack.${kind}.${miss?'miss':'hit'}`;await page.evaluate(([kind,miss])=>window.audioQA.play(kind,miss),[kind,miss]);
  await expect.poll(()=>page.evaluate(key=>window.audioMedia.some(a=>a.src.includes(key)&&a.currentTime>.05&&!a.error),key)).toBe(true);
 }
 await page.evaluate(()=>window.audioQA.play('magic',false,false,true));await expect.poll(()=>page.evaluate(()=>window.audioMedia.some(a=>a.src.includes('breath.fire')&&a.currentTime>.05&&!a.error))).toBe(true);
 await page.evaluate(()=>window.audioQA.play('magic',false,true));await expect(page.locator('.combat-healing-aura')).toBeVisible();await page.screenshot({path:'outputs/audio-260/healing.png'});
  for(const key of ['music.shop','music.combat']){await page.evaluate(key=>window.audioQA.music(key),key);try{await expect.poll(()=>page.evaluate(key=>window.audioMedia.some(a=>a.src.includes(key)&&a.currentTime>.1&&a.volume>0),key),{timeout:20000}).toBe(true);}catch(e){console.log(await page.evaluate(async()=>{const {soundPlayer:p}=await import('/src/audio/player.ts');return {music:p.desiredMusic,voice:p.music?.cue?.key,hidden:p.hidden,settings:localStorage.getItem('site-settings'),media:window.audioMedia.filter(a=>a.src.includes('music.')).map(a=>({src:a.src,time:a.currentTime,volume:a.volume,paused:a.paused,error:a.error?.message})),failures:window.audioPlayFailures};}));throw e;}}
 await page.evaluate(()=>window.audioQA.clear());
 // Isolated admin-editor UI. Its HTTP writes are intercepted; real permissions
 // and DB persistence are covered by the separate PostgreSQL controller tests.
 const editorCatalog=structuredClone(catalog);editorCatalog.can_manage=true;
 const binding=editorCatalog.bindings[0];let saved=0;
 await page.route('**/api/audio',route=>route.fulfill({json:editorCatalog}));
 await page.route('**/api/audio/entities/**',route=>{
  const key=route.request().postDataJSON().cue_key;editorCatalog.bindings=editorCatalog.bindings.filter(b=>!(b.entity_type===binding.entity_type&&b.entity_id===binding.entity_id&&b.event==='hit'));
  if(key)editorCatalog.bindings.push({entity_type:binding.entity_type,entity_id:binding.entity_id,event:'hit',cue_key:key});saved++;return route.fulfill({json:{saved:true}});
 });
 await page.evaluate(async binding=>{
  const React=(await import('/node_modules/.vite/deps/react.js')).default,client=await import('/node_modules/.vite/deps/react-dom_client.js');const {default:Editor}=await import('/src/audio/EntitySoundEditor.tsx');
  const host=document.createElement('div');host.style.cssText='position:fixed;inset:0;overflow:auto;background:#211c15;color:#edddbd;padding:30px;z-index:800';document.body.append(host);const root=(client.createRoot??client.default.createRoot)(host);
  root.render(React.createElement(Editor,{type:binding.entity_type,id:binding.entity_id}));window.clearAudioEditor=()=>{root.unmount();host.remove();};
 },binding);
 await page.getByText('Звуковое оформление',{exact:true}).click();
 await page.getByLabel('Попадание',{exact:true}).selectOption('attack.ranged.hit');
 await expect.poll(()=>saved).toBe(1);await expect(page.getByLabel('Попадание',{exact:true})).toHaveValue('attack.ranged.hit');
 await page.screenshot({path:'outputs/audio-260/entity-editor.png'});
 await page.getByLabel('Попадание',{exact:true}).selectOption('');await expect.poll(()=>saved).toBe(2);await page.evaluate(()=>window.clearAudioEditor());
 await page.unroute('**/api/audio');await page.unroute('**/api/audio/entities/**');
 // All original media decode in the browser. Their licensing is stored alongside URLs.
 const media=await page.evaluate(async cues=>{
  const results=[];for(const c of cues){const a=new Audio();a.preload='metadata';results.push(await new Promise(resolve=>{const timer=setTimeout(()=>resolve({key:c.key,error:'timeout'}),10000);a.onloadedmetadata=()=>{clearTimeout(timer);resolve({key:c.key,duration:a.duration});};a.onerror=()=>{clearTimeout(timer);resolve({key:c.key,error:a.error?.code});};a.src=c.url;}));a.removeAttribute('src');a.load();}return results;
 },catalog.cues);assert(media.every(m=>m.duration>0&&!m.error),JSON.stringify(media.filter(m=>m.error)));
 await page.goto(base+'/settings');await page.getByRole('button',{name:'Звук и музыка',exact:false}).click();await page.setViewportSize({width:390,height:844});await expect(page.locator('.audio-volume').first()).toBeVisible();await page.screenshot({path:'outputs/audio-260/settings-mobile.png'});
 assert.deepEqual(errors,[]);console.log('PASS: 34 public cloud URLs in local DB; actual browser audio decoding/playback, dice, all hit/miss types, data-bound breath, music transitions, mute, desktop/mobile settings, healing feedback; isolated admin-editor save/reset; no gameplay writes.');
}finally{await browser.close();}
