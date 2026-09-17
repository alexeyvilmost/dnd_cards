// Real UI against an isolated snapshot: no commands or database writes.
import {readFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const {chromium,expect}=require('@playwright/test');
const state=JSON.parse(await readFile('outputs/cover-symmetry/battle-before.json','utf8')).events[0].record.baseline.state;
const actorId=state.characterId,enemyId=Object.keys(state.tokens).find(id=>id!==actorId),bodyId='qa-cover-body';
state.tokens=Object.fromEntries([actorId,enemyId].map(id=>[id,state.tokens[id]]));
state.tokens[actorId].position={x:2,y:5};state.tokens[enemyId].position={x:8,y:5};
state.world.actors[bodyId]=structuredClone(state.world.actors[enemyId]);
Object.assign(state.world.actors[bodyId],{id:bodyId,name:'Существо-укрытие'});
state.world.actors[bodyId].character.baseSize=1;
state.tokens[bodyId]={...structuredClone(state.tokens[enemyId]),actorId:bodyId,position:{x:5,y:5}};
state.sideByActorId[bodyId]=state.sideByActorId[actorId];
state.creatureCoverVersion=1;state.tacticalFootprints='sized';
state.battleMap={...state.battleMap,width:12,height:10,features:[]};
state.combatAreas={};state.world.pendingResolution=null;
const browser=await chromium.launch({channel:'chrome',headless:true});
await mkdir('outputs/creature-cover',{recursive:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],audioRequests=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/\.(wav|mp3|ogg)(\?|$)/.test(r.url()))audioRequests.push(r.url());});
 await page.addInitScript(()=>{window.mediaPlays=0;HTMLMediaElement.prototype.play=function(){window.mediaPlays++;return Promise.resolve();};});
 await page.goto('http://127.0.0.1:3001/login');
 await page.evaluate(async({state,actorId,enemyId,bodyId})=>{
  const React=(await import('/node_modules/.vite/deps/react.js')).default;
  const client=await import('/node_modules/.vite/deps/react-dom_client.js');
  const {default:Map}=await import('/src/components/TacticalBattleMap.tsx');
  const {default:Settings}=await import('/src/components/SettingsPanel.tsx');
  const {combatActionIsRanged}=await import('/src/solo-combat/defaultInteraction.ts');
  const {setSetting}=await import('/src/settings.ts');
  const {soundPlayer}=await import('/src/audio/player.ts');
  setSetting('audioEnabled',true); // A saved preference must not bypass release mute.
  soundPlayer.setCatalog({bindings:[],can_manage:false,cues:['music','effects','ui'].map(channel=>({key:channel,name:channel,channel,gain:1,loop:channel==='music',url:`/qa-${channel}.wav`}))});
  soundPlayer.unlock();soundPlayer.setMusic('music');soundPlayer.play('effects');soundPlayer.play('ui');soundPlayer.refresh();
  await import('/src/pages/SoloCombatPage.css');
  const action=state.catalogActions.find(a=>state.playerActionIds.includes(a.id)&&combatActionIsRanged(state,actorId,a));
  if(!action)throw Error('No ranged action');
  const host=document.createElement('div');host.style.cssText='position:fixed;inset:0;padding:20px;background:#121411;z-index:100;color:#eed9b3;overflow:auto;';document.body.append(host);
  const root=(client.createRoot??client.default.createRoot)(host);
  const render=()=>root.render(React.createElement('div',{className:'combat-stage',style:{height:'90vh'}},React.createElement(Map,{state,actorId,selectedActionId:action.id,defaultActionId:action.id,implicitActionsEnabled:true,movementMode:false,onCell:()=>{}})));
  window.coverQA={setSize:size=>{state=structuredClone(state);state.world.actors[bodyId].character.baseSize=size;render();},
   corridor:()=>{state=structuredClone(state);state.battleMap.features=[{id:'top',name:'Стена',sprite:'wall',x:0,y:0,width:12,height:5,blocksSight:true,blocksMovement:true},{id:'bottom',name:'Стена',sprite:'wall',x:0,y:6,width:12,height:4,blocksSight:true,blocksMovement:true}];render();},
   settings:()=>root.render(React.createElement(Settings))};
  render();
 },{state,actorId,enemyId,bodyId});
 const target=page.locator(`[data-actor-id="${enemyId}"]`).first();await target.hover();
 await expect(page.locator('.combat-hit-chance__cover')).toContainText('Половинное укрытие · +2 к КД: 15 → 17');
 await expect(page.locator('.combat-projectile-preview__cover')).toHaveCount(1);
 await page.screenshot({path:'outputs/creature-cover/small.png'});
 await page.evaluate(()=>window.coverQA.setSize(2));await target.hover();
 await expect(page.locator('.combat-hit-chance__movement').first()).toContainText('Подойти');
 await expect(page.locator('.combat-hit-chance__cover')).not.toContainText('Полное укрытие');
 await page.screenshot({path:'outputs/creature-cover/approach.png'});
 await page.evaluate(()=>window.coverQA.corridor());await target.hover();
 await expect(page.locator('.combat-hit-chance__cover')).toHaveText('Полное укрытие — выстрел перекрыт');
 await expect(page.locator('.combat-hit-chance')).toContainText('Нет доступной точки для атаки');
 await page.screenshot({path:'outputs/creature-cover/blocked.png'});
 await page.evaluate(()=>window.coverQA.settings());await page.getByRole('button',{name:/Звук и музыка/}).click();
 await expect(page.getByRole('status')).toContainText('Звук временно отключён');
 assert.equal(await page.evaluate(()=>window.mediaPlays),0);assert.deepEqual(audioRequests,[]);assert.deepEqual(errors,[]);
 await page.screenshot({path:'outputs/creature-cover/muted.png'});
 console.log('PASS: Small +2 AC/yellow trajectory, Medium approach/blocked corridor, release mute with enabled saved preferences; no gameplay writes.');
}finally{await browser.close();}
