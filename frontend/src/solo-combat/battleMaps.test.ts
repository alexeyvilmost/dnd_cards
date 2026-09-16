import {describe,it,expect} from 'vitest';
import fixture from '../pages/rulesLabFixture.generated.json';
import {createWorld,type ActorState} from '../rules-core/domain';
import {BATTLE_MAPS,packBattleMap,selectBattleMap,materializeMapAreas,mapConnectedPositions,generateBattleMap} from './battleMaps';
import {boardCells,terrainFits,terrainSight,terrainStepFits,featureCells,type BattleMapDefinition} from './boardGeometry';
import {actorFootprint,footprintCells} from './footprint';
import {reachableRoutes,areaActorIds} from './tacticalGrid';
import {spatialFacts,type SoloCombatState} from './types';
import {movementCostThroughAreas,queueCombatAreaEvent} from './combatAreas';
import {autoResolveSystemDecisions,moveActorAlongRoute} from './engine';

function actor(id:string,size=2):ActorState{
 const base=structuredClone(fixture.roots.magicInitiateFighter.actor) as unknown as ActorState;
 return {...base,id,name:id,character:{...base.character,baseSize:size,characterSpeed:30},
  runtime:{...base.runtime,hp:{current:100,max:100,temp:0},resources:{action:1,reaction:1,bonus_action:1},activeEffects:[]},
  capabilities:{actionIds:[]},kind:id==='hero'?'playerCharacter':'monster'};
}
function battlefield(index=0):SoloCombatState{
 const hero=actor('hero'),enemy=actor('enemy');
 const world=createWorld({id:'map-test',actors:[hero,enemy],ruleset:{systemId:'dnd5e-2024',releaseId:'r',contentHash:'h',errataVersion:'e'}});
 world.scene={mode:'encounter',round:1,activeIndex:0,initiative:['hero','enemy'],turnStarted:true};
 const map=BATTLE_MAPS[index];
 return {schemaVersion:1,characterId:'hero',controlledCharacterIds:['hero'],tacticalFootprints:'sized',runtimeRevision:0,world,
  battleMap:map,catalogActions:[],sideByActorId:{hero:'heroes',enemy:'monsters'},actorPresentation:{},actionPresentation:{},playerActionIds:[],certifiedPlayerActionIds:[],monsterActionIds:{},opportunityActionIds:{},resourceBindings:{},
  tokens:{hero:{actorId:'hero',color:'green',position:{x:0,y:0}},enemy:{actorId:'enemy',color:'red',position:{x:17,y:11}}},
  combatAreas:materializeMapAreas(map),boardRevision:1,movementRemainingFt:{hero:60,enemy:30},initiativeBonuses:{},initiative:[],log:[],outcome:'active'} as unknown as SoloCombatState;
}
describe('data-owned battle maps',()=>{
 it('retains river bends as authoritative cells, not its bounding box',()=>{
  const map=BATTLE_MAPS[2],river=map.features.find(f=>f.id==='river')!;
  expect(river.baked).toBe(true);expect(featureCells(river)).toHaveLength(24);
  expect(materializeMapAreas(map)[`map:${map.id}:river`].cells).toEqual(featureCells(river));
  expect(featureCells(river)).not.toContainEqual({x:8,y:0});
  expect(featureCells(river)).toContainEqual({x:8,y:5});
  const state=battlefield(2);
  expect(movementCostThroughAreas(state,{x:7,y:0},{x:8,y:0},5,'hero')).toBe(5);
  expect(movementCostThroughAreas(state,{x:7,y:5},{x:8,y:5},5,'hero')).toBe(10);
 });
 it.each(BATTLE_MAPS)('$id generates deterministic distinct layouts without moving baked scenery',map=>{
  const original=JSON.stringify(map),first=generateBattleMap(map,123)!;
  expect(first).not.toBeNull();expect(generateBattleMap(map,123)).toEqual(first);
  expect(generateBattleMap(map,456)?.features).not.toEqual(first.features);
  expect(JSON.stringify(map)).toBe(original);
  for(const feature of map.features.filter(f=>f.baked))expect(first.features.find(f=>f.id===feature.id)).toEqual(feature);
  const cells=first.features.flatMap(featureCells).map(p=>`${p.x}:${p.y}`);
  expect(new Set(cells).size).toBe(cells.length);
  expect(JSON.parse(JSON.stringify(first))).toEqual(first);
 });
 it('rejects crowded procedural candidates instead of silently overlapping props',()=>{
  const map={...BATTLE_MAPS[0],width:3,height:3};
  expect(generateBattleMap(map,1)).toBeNull();
 });
 it.each([1,2,3,4])('generated selection safely packs footprint %i with a six-member party',footprint=>{
  const heroes=Array.from({length:6},(_,i)=>actor(`hero-${i}`));
  const actors=[...heroes,actor('large-enemy',footprint+1),...Array.from({length:8},(_,i)=>actor(`enemy-${i}`))];
  for(let index=0;index<BATTLE_MAPS.length;index++)for(const seed of [0,7,43,123,9999,0xffffffff]){
   const {map,positions}=selectBattleMap(actors,heroes.map(a=>a.id),index,seed);
   const cells=actors.flatMap(a=>footprintCells(positions[a.id],actorFootprint(a)));
   expect(new Set(cells.map(p=>`${p.x}:${p.y}`)).size).toBe(cells.length);
   const hazardCells=new Set(map.features.filter(f=>f.zone?.hazard).flatMap(featureCells).map(p=>`${p.x}:${p.y}`));
   expect(cells.some(p=>hazardCells.has(`${p.x}:${p.y}`))).toBe(false);
   for(const a of actors){
    expect(terrainFits({battleMap:map},positions[a.id],actorFootprint(a))).toBe(true);
    expect(mapConnectedPositions(map,actorFootprint(a),positions['large-enemy'])).toContainEqual(positions[a.id]);
   }
  }
 },30000);
 it.each(BATTLE_MAPS)('$id has in-bounds, non-overlapping mechanical features and connected spawns',map=>{
  expect(map.width*map.height).toBe(boardCells({battleMap:map}).length);
  expect(new Set(map.features.map(f=>f.id)).size).toBe(map.features.length);
  for(const feature of map.features){expect(feature.x+feature.width).toBeLessThanOrEqual(map.width);expect(feature.y+feature.height).toBeLessThanOrEqual(map.height);}
  const actors=Array.from({length:Math.min(14,map.maxActors)},(_,i)=>actor(`actor-${i}`));
  const positions=packBattleMap(map,actors,actors.slice(0,6).map(a=>a.id))!;
  expect(positions).not.toBeNull();
  const cells=actors.flatMap(a=>footprintCells(positions[a.id],actorFootprint(a)));
  expect(new Set(cells.map(c=>`${c.x}:${c.y}`)).size).toBe(cells.length);
  expect(actors.every(a=>terrainFits({battleMap:map},positions[a.id],actorFootprint(a)))).toBe(true);
 });
 it.each([1,2,3,4,5,6])('packs %i fighters and 24 medium opponents with no overlaps',count=>{
  const heroes=Array.from({length:count},(_,i)=>actor(`hero-${i}`));
  const enemies=Array.from({length:24},(_,i)=>actor(`enemy-${i}`));
  for(let index=0;index<BATTLE_MAPS.length;index++){
   const {map,positions}=selectBattleMap([...heroes,...enemies],heroes.map(a=>a.id),index);
   expect(map.maxActors).toBeGreaterThanOrEqual(count+24);
   expect(new Set(Object.values(positions).map(p=>`${p.x}:${p.y}`)).size).toBe(count+24);
  }
 });
 it.each([3,4,5])('size %i never enters an unsuitable map or disconnected giant passage',size=>{
  const actors=[actor('hero'),actor('giant',size)];
  for(let i=0;i<BATTLE_MAPS.length;i++){
   const {map,positions}=selectBattleMap(actors,['hero'],i);
   expect(map.maxFootprint).toBeGreaterThanOrEqual(size-1);
   expect(mapConnectedPositions(map,size-1)).toContainEqual(positions.giant);
   expect(map.maxFootprint).toBeGreaterThanOrEqual(actorFootprint(actors[1]));
  }
 });
 it('blocks walls and diagonal corner cutting, including the full footprint',()=>{
  const board={battleMap:BATTLE_MAPS[1]};
  expect(terrainFits(board,{x:5,y:3})).toBe(false);
  expect(terrainStepFits(board,{x:4,y:3},{x:5,y:4})).toBe(false);
  expect(terrainFits(board,{x:5,y:4},2)).toBe(true);
  expect(terrainFits(board,{x:5,y:4},3)).toBe(false);
 });
 it('derives total, half and three-quarter cover from different terrain data',()=>{
  const map={...BATTLE_MAPS[0],features:[{id:'screen',name:'Screen',x:4,y:0,width:1,height:12,sprite:'wall',blocksMovement:true,blocksSight:true}]} as BattleMapDefinition;
  expect(terrainSight({battleMap:map},{x:2,y:4},{x:7,y:4})).toEqual({blocked:true,cover:'total'});
  map.features=[{...map.features[0],blocksSight:false,cover:'half'}];
  expect(terrainSight({battleMap:map},{x:2,y:4},{x:7,y:4})).toEqual({blocked:false,cover:'half'});
  map.features=[{...map.features[0],cover:'three_quarters'}];
  expect(terrainSight({battleMap:map},{x:2,y:4},{x:7,y:4}).cover).toBe('three_quarters');
  const state=battlefield();state.battleMap={...map,features:[{...map.features[0],blocksSight:true}]};state.tokens.hero.position={x:2,y:4};state.tokens.enemy.position={x:7,y:4};
  expect(spatialFacts(state,'hero','enemy')).toMatchObject({lineOfSight:false,cover:'total'});
  expect(areaActorIds({state,sourceActorId:'hero',aimPosition:{x:7,y:4},action:{mechanics:{targeting:{shape:'area',area:{kind:'cone',size_ft:40}}},targeting:{rangeFt:40,allowedRelations:['enemy']}}})).not.toContain('enemy');
 });
 it('river and mud share the difficult-terrain operation, without stacking cost',()=>{
  for(const [index,from,to] of [[0,{x:3,y:5},{x:4,y:5}],[2,{x:9,y:2},{x:10,y:2}]] as const){
   const state=battlefield(index);
   expect(movementCostThroughAreas(state,from,to,5,'hero')).toBe(10);
   state.tokens.hero.position=from;
   const paths=reachableRoutes(state,'hero',30);
   expect(paths.every(r=>r.path.every(p=>terrainFits(state,p)))).toBe(true);
  }
 });
 it('campfire and fireplace resolve ordinary zone damage and survive serialization',()=>{
  for(const index of [2,3]){
   let state=battlefield(index);const fire=Object.values(state.combatAreas!).find(a=>a.hazard)!;
   state.tokens.hero.position=fire.cells[0];
   state=JSON.parse(JSON.stringify(state));
   state=queueCombatAreaEvent(state,'start_turn',['hero']);
   const after=autoResolveSystemDecisions(state,()=>.5);
   expect(after.world.actors.hero.runtime.hp.current).toBeLessThan(100);
   expect(after.world.actors.hero.runtime.hp.current).toBeGreaterThanOrEqual(94);
  }
 });
 it('walking through fire runs a hazard before further steps, not after teleporting to the destination',()=>{
  const state=battlefield(2);state.tokens.hero.position={x:12,y:5};
  // Constrain the route to cross a single burning cell.
  state.battleMap={...state.battleMap!,features:[]};const area=Object.values(state.combatAreas!).find(a=>a.hazard)!;
  area.cells=Array.from({length:12},(_,y)=>({x:13,y}));state.combatAreas={fire:area};
  const after=moveActorAlongRoute({state,actorId:'hero',destination:{x:14,y:5},rng:()=>.5});
  expect(after.tokens.hero.position).toEqual({x:14,y:5});expect(after.world.actors.hero.runtime.hp.current).toBeLessThan(100);
 });
 it('a failed web save restrains and stops the remaining route; a success permits passage',()=>{
  const state=battlefield(1);state.tokens.hero.position={x:4,y:4};
  const stopped=moveActorAlongRoute({state,actorId:'hero',destination:{x:7,y:4},rng:()=>0});
  const after=autoResolveSystemDecisions(stopped,()=>0);
  expect(after.tokens.hero.position).toEqual({x:5,y:4});
  expect(after.world.actors.hero.runtime.activeEffects).toEqual(expect.arrayContaining([expect.objectContaining({mechanics:expect.objectContaining({kind:'condition',value:'restrained'})})]));
  const passed=autoResolveSystemDecisions(moveActorAlongRoute({state,actorId:'hero',destination:{x:7,y:4},rng:()=>.99}),()=>.99);
  expect(passed.tokens.hero.position).toEqual({x:7,y:4});
 });
});
