import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const {chromium}=require('@playwright/test');
const snapshot=JSON.parse(await readFile('outputs/attack-stall/snapshot.json','utf8'));
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1500,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:3001/login');
 const report=await page.evaluate(async state=>{
  const {combatApproachRoute,combatActionRangeFt,combatActionIsRanged}=await import('/src/solo-combat/defaultInteraction.ts');
  const {reachableRoutes}=await import('/src/solo-combat/tacticalGrid.ts');
  const {spatialFacts}=await import('/src/solo-combat/types.ts');
  const {previewCombatAttackRoll}=await import('/src/solo-combat/engine.ts');
  const {previewAttackCover}=await import('/src/solo-combat/attackCoverPreview.ts');
  const sourceId='8fa0500f-d9b2-4ffe-89d4-4f1c301efc36',targetId=Object.keys(state.tokens).find(id=>state.sideByActorId[id]!==state.sideByActorId[sourceId]&&state.world.actors[id].runtime.hp.current>0);
  const action=state.catalogActions.find(a=>a.id===state.pendingD20Interrupt?.command.actionId)||state.catalogActions.find(a=>state.playerActionIds.includes(a.id)&&combatActionIsRanged(state,sourceId,a));
  const input={state,actorId:sourceId,actionId:action.id,targetIds:[targetId]};
  const measure=fn=>{const times=[];let value;for(let i=0;i<10;i++){const t=performance.now();value=fn();times.push(performance.now()-t);}return {mean:times.reduce((a,b)=>a+b,0)/times.length,max:Math.max(...times),value};};
  const range=combatActionRangeFt(state,sourceId,action),route=measure(()=>combatApproachRoute(state,sourceId,targetId,range));
  const profile=previewCombatAttackRoll(input);
  const metrics={range,route,reachable:measure(()=>reachableRoutes(state,sourceId,3600).length),facts:measure(()=>spatialFacts(state,sourceId,targetId,false)),attackPreview:measure(()=>Boolean(previewCombatAttackRoll(input))),coverPreview:measure(()=>previewAttackCover(input,profile))};
  const React=(await import('/node_modules/.vite/deps/react.js')).default,client=await import('/node_modules/.vite/deps/react-dom_client.js');
  const {default:Map}=await import('/src/components/TacticalBattleMap.tsx');await import('/src/pages/SoloCombatPage.css');
  const host=document.createElement('div');host.style.cssText='position:fixed;inset:0;padding:10px;background:#121411;z-index:100;color:#eed9b3;';document.body.append(host);
  const root=(client.createRoot??client.default.createRoot)(host);
  window.stallQA={commits:[],longTasks:[],sourceId,targetId};
  new PerformanceObserver(list=>window.stallQA.longTasks.push(...list.getEntries().map(e=>({duration:e.duration,start:e.startTime})))).observe({type:'longtask'});
  root.render(React.createElement(React.Profiler,{id:'map',onRender:(id,phase,duration)=>window.stallQA.commits.push({phase,duration})},React.createElement('div',{className:'combat-stage',style:{height:'95vh'}},React.createElement(Map,{state,actorId:sourceId,selectedActionId:action.id,defaultActionId:action.id,implicitActionsEnabled:true,movementMode:false,onCell:()=>{}}))));
  return metrics;
 },snapshot.envelope.state);
 const target=page.locator(`[data-actor-id="${report.facts.value ? Object.keys(snapshot.envelope.state.tokens).find(id=>snapshot.envelope.state.sideByActorId[id]!==snapshot.envelope.state.sideByActorId['8fa0500f-d9b2-4ffe-89d4-4f1c301efc36']&&snapshot.envelope.state.world.actors[id].runtime.hp.current>0):''}"]`).first();
 await target.hover();await page.screenshot({path:'outputs/attack-stall/hover.png'});
 const box=await target.boundingBox();for(let i=0;i<20;i++)await page.mouse.move(box.x+10+i,box.y+10+i);
 report.ui=await page.evaluate(()=>window.stallQA);report.errors=errors;
 await writeFile('outputs/attack-stall/browser-profile.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
