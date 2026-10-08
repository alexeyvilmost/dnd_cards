import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {Module} from 'node:module';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {workerTestBuild} from '../../scripts/testing/worker-test-build.mjs';import {withContainerCatalog} from './fixtures/container-catalog.mjs';import {routeObservationMemoSource,spatialMemoSource,nativeHashSource} from './native-hash.mjs';
const file=fileURLToPath(new URL('artifact.cjs',workerTestBuild())),source=fs.readFileSync(file,'utf8');
function compile(source){const module=new Module(file);module.filename=file;module.paths=Module._nodeModulePaths(path.dirname(file));module._compile(source+'\nmodule.exports.routeProbe={reachableRoutes,auraDifficultStep};',file);return module.exports;}
const original=compile(source),changed=routeObservationMemoSource(spatialMemoSource(nativeHashSource(source))),candidate=compile(changed);assert.notEqual(changed,source);
assert.ok(changed.includes('const __previousLife=__spatialLifeMemo,__previousAura=__routeAuraPayloadMemo;'));
assert.ok(changed.includes('__routeAuraPayloads(source2)'));
test('unrecognized route or aura implementations retain the original source',()=>{for(const routine of ['reachableRoutes','auraDifficultStep']){const unknown=spatialMemoSource(nativeHashSource(source)).replace('function '+routine+'(','function '+routine+'Unknown(');assert.equal(routeObservationMemoSource(unknown),unknown);}});
test('route scope retains exact paths for different payloads, recipients and inactive effects',async()=>{
 const input=withContainerCatalog(JSON.parse(fs.readFileSync(new URL('../src/roguelike/pinnedFighter.fixture.json',import.meta.url))),JSON.parse(fs.readFileSync(new URL('../../officials/canon/prod-snapshot/cards.json',import.meta.url))));input.seed='route-aura-prefilter';input.character.initiative_bonus=100;
 input.characters=[input.character,{...structuredClone(input.character),id:'qa:route-ally',initiative_bonus:99}];
 input.roster=[{monster_id:'route-enemy',quantity:1}];input.monsters={version:1,effects:[],actions:[],monsters:[{id:'route-enemy',slug:'route-enemy',name:'Synthetic enemy',size:'large',creature_type:'humanoid',armor_class:10,max_hp:20,speed:30,initiative_bonus:-100,proficiency_bonus:2,abilities:{str:14,dex:10,con:10,int:10,wis:10,cha:10},action_ids:[],effect_ids:[],ai:{strategy:'tactical'}}]};
 const initial=await original.initializeRoguelikeCombat(input,'sha256:'+'a'.repeat(64));assert.equal(initial.status,'ready');
 const state=initial.envelope.state,ids=Object.keys(state.world.actors),player=input.character.id;
 const base={kind:'aura',radius_ft:20,recipients:'all',effects:[{kind:'movement_policy',difficult_terrain:true}]};
 for(const sourceId of ids)for(const payload of [undefined,base,{...base,recipients:'enemies'},{...base,recipients:'allies'},{...base,events:['start_turn']},{...base,effects:[{kind:'movement_policy',difficult_terrain:false}]},{payloads:[{...base,radius_ft:0},{kind:'modifier',value:1}]}])for(const rounds of [undefined,0,2]){
  const board=structuredClone(state),actor=board.world.actors[sourceId];actor.passives=payload?[payload]:[];actor.runtime.activeEffects=payload?[{id:'qa:route-effect',mechanics:payload,roundsLeft:rounds}]:[];
  const before=JSON.stringify(board);const expected=original.routeProbe.reachableRoutes(board,player,30,{x:6,y:6}),actual=candidate.routeProbe.reachableRoutes(board,player,30,{x:6,y:6});assert.deepEqual(actual,expected);assert.equal(JSON.stringify(board),before);
 }
});

test('a later search observes mutations on the same actor and effect objects and recovers after rejection',async()=>{
 const input=withContainerCatalog(JSON.parse(fs.readFileSync(new URL('../src/roguelike/pinnedFighter.fixture.json',import.meta.url))),JSON.parse(fs.readFileSync(new URL('../../officials/canon/prod-snapshot/cards.json',import.meta.url))));
 input.seed='route-observation-lifetime';input.character.initiative_bonus=100;
 input.roster=[{monster_id:'scope-enemy',quantity:1}];input.monsters={version:1,effects:[],actions:[],monsters:[{id:'scope-enemy',slug:'scope-enemy',name:'Synthetic enemy',size:'medium',creature_type:'humanoid',armor_class:10,max_hp:20,speed:30,initiative_bonus:-100,proficiency_bonus:2,abilities:{str:14,dex:10,con:10,int:10,wis:10,cha:10},action_ids:[],effect_ids:[],ai:{strategy:'tactical'}}]};
 const initial=await original.initializeRoguelikeCombat(input,'sha256:'+'b'.repeat(64));assert.equal(initial.status,'ready');
 const board=initial.envelope.state,player=input.character.id,actor=board.world.actors[player];
 actor.passives=[{kind:'aura',radius_ft:20,recipients:'all',requires_conscious:true,effects:[{kind:'movement_policy',difficult_terrain:true}]},{kind:'life_policy',remain_conscious_at_zero:true}];
 actor.runtime.activeEffects=[];
 const check=()=>{const before=JSON.stringify(board);assert.deepEqual(candidate.routeProbe.reachableRoutes(board,player,30,{x:6,y:6}),original.routeProbe.reachableRoutes(board,player,30,{x:6,y:6}));assert.equal(JSON.stringify(board),before);};
 check();actor.passives[0].radius_ft=0;check();actor.passives[0].radius_ft=20;actor.runtime.hp.current=0;check();actor.passives[1].remain_conscious_at_zero=false;check();
 actor.runtime.hp.current=10;actor.passives[1].max_death_failures=-2;
 assert.throws(()=>original.routeProbe.reachableRoutes(board,player,30),/Invalid life_policy/);
 assert.throws(()=>candidate.routeProbe.reachableRoutes(board,player,30),/Invalid life_policy/);
 delete actor.passives[1].max_death_failures;check();
 actor.passives=[];const effect={id:'qa:scope-effect',mechanics:{kind:'aura',radius_ft:15,recipients:'all',effects:[{kind:'movement_policy',difficult_terrain:true}]},roundsLeft:2};actor.runtime.activeEffects=[effect];check();effect.roundsLeft=0;check();effect.roundsLeft=2;board.tokens[player].position={...board.tokens[player].position,x:board.tokens[player].position.x+1};check();
});
