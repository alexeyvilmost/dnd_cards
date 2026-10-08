import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {workerTestBuild} from '../../scripts/testing/worker-test-build.mjs';
import {createHash} from 'node:crypto';
import {spatialMemoSource,compileNativeHashArtifact} from './native-hash.mjs';
import {withContainerCatalog} from './fixtures/container-catalog.mjs';
const root=fileURLToPath(workerTestBuild()),file=root+'/artifact.cjs',bytes=fs.readFileSync(file),source=bytes.toString('utf8');
const require=createRequire(import.meta.url),original=require(file),optimized=compileNativeHashArtifact(file,bytes);
const hash='sha256:'+createHash('sha256').update(bytes).digest('hex');

test('recognized aura optimization is applied and unknown routines retain their full source',()=>{
  const changed=spatialMemoSource(source);assert.notEqual(changed,source);
  assert.ok(changed.includes('illuminationSources, __projectionLifeMemo)'));
  assert.ok(changed.includes('__sameAuraCharacterJSON(state.world.actors[id].character,actors[id].character)'));
  for(const name of ['projectCombatAuras','spatialFacts','collectLifePolicies']) {
    const altered=source.replace('function '+name+'(', 'function '+name+'Unknown(');
    assert.equal(spatialMemoSource(altered),altered);
  }
});
test('character comparison preserves JSON equality for data, omitted values, arrays and key order',()=>{
  const changed=spatialMemoSource(source),start=changed.indexOf('function __sameAuraCharacterJSON('),end=changed.indexOf('\n}',start)+2;
  const same=Function(changed.slice(start,end)+';return __sameAuraCharacterJSON;')();
  const shared={text:'<&> 🐉',items:[null,1,{z:2}]};
  const inputs=[
    [{id:'first',catalog:shared,spatialObservations:{nearby:[]}},{id:'first',catalog:shared,spatialObservations:{nearby:[]}}],
    [{id:'second',catalog:shared,abilityScores:{str:10}},{id:'second',catalog:shared,abilityScores:{str:12}}],
    [{x:undefined},{ }], [{x:NaN},{x:null}], [{x:[undefined,1]},{x:[null,1]}],
    [{a:1,b:2},{b:2,a:1}], [{x:{z:1,a:2}},{x:{a:2,z:1}}],
  ];
  for(const [a,b]of inputs)assert.equal(same(a,b),JSON.stringify(a)===JSON.stringify(b));
});
test('passive comparison preserves array values, holes, omitted entries and changed effects',()=>{
  const changed=spatialMemoSource(source),start=changed.indexOf('function __sameAuraPassivesJSON('),end=changed.indexOf('\n}',start)+2;
  const same=Function(changed.slice(start,end)+';return __sameAuraPassivesJSON;')();
  const shared={id:'fixture-effect',effects:[{kind:'modifier',value:2}]};
  for(const [a,b]of [[undefined,[]],[[shared],[shared]],[[shared],[{...shared}]],[[],[shared]],[[undefined],[null]],[[,],[{different:1}]],[[NaN],[null]],[[{value:2}],[{value:3}]],[[{a:1,b:2}],[{b:2,a:1}]]])assert.equal(same(a,b),JSON.stringify(a)===JSON.stringify(b));
});
for(const partySize of [1,2,6])test(`aura memo retains full seeded transitions, RNG and input for party ${partySize}`,async()=>{
  const pinned=withContainerCatalog(JSON.parse(fs.readFileSync('frontend/src/roguelike/pinnedFighter.fixture.json')),JSON.parse(fs.readFileSync('officials/canon/prod-snapshot/cards.json')));
  const input={...pinned,seed:'spatial-memo-party-'+partySize,roster:[{monster_id:'spatial-enemy',quantity:partySize===6?2:1}],monsters:{version:1,effects:[],actions:[],monsters:[{id:'spatial-enemy',slug:'spatial-test',name:'Synthetic enemy',size:'medium',creature_type:'humanoid',armor_class:10,max_hp:20,speed:30,initiative_bonus:-100,proficiency_bonus:2,abilities:{str:14,dex:10,con:10,int:10,wis:10,cha:10},action_ids:[],effect_ids:[],ai:{strategy:'tactical'}}]}};
  input.monsters.monsters[0].size=partySize===1?'medium':partySize===2?'large':'huge';
  input.character.initiative_bonus=100;
  if(partySize>1)input.characters=Array.from({length:partySize},(_,i)=>({...structuredClone(input.character),id:i?`qa:spatial-${i}`:input.character.id,initiative_bonus:100-i,current_hp:Math.max(1,input.character.current_hp-i)}));
  const before=JSON.stringify(input),expected=await original.initializeRoguelikeCombat(input,hash),actual=await optimized.initializeRoguelikeCombat(input,hash);
  assert.equal(expected.status,'ready');assert.equal(expected.envelope.state.tacticalFootprints,'sized');assert.deepEqual(actual,expected);assert.equal(JSON.stringify(input),before);
  let envelope=expected.envelope;
  for(let i=0;i<partySize*2;i++){
    const scene=envelope.state.world.scene,actorId=scene.initiative[scene.activeIndex],intent={type:'end_turn',actorId};
    const saved=JSON.stringify(envelope),left=original.stepRoguelikeCombat(envelope,intent,hash),right=optimized.stepRoguelikeCombat(envelope,intent,hash);
    assert.deepEqual(right,left);assert.equal(JSON.stringify(envelope),saved);envelope=left.envelope;
  }
});

test('unknown footprint implementation retains the previously verified compiler optimization',async()=>{
 const changed=source.replace('function actorFootprint(','function actorFootprintUnknown(');const optimized=spatialMemoSource(changed);assert.ok(optimized.includes('illuminationSources, __projectionLifeMemo)'));assert.ok(!optimized.includes('const __footprintBySpatialScope='));
});
test('footprint memo is limited to one immutable spatial scope and both exact input identities',()=>{
 const changed=spatialMemoSource(source),begin=changed.indexOf('const __footprintBySpatialScope='),end=changed.indexOf('let __spatialLifeMemo;',begin);assert.ok(begin>=0&&end>begin);
 const factory=Function('let __spatialLifeMemo;let calls=0;function __footprintUncached(actor,rules){calls++;return actor.size;}'+changed.slice(begin,end)+';return {calculate:actorFootprint,scope(value){__spatialLifeMemo=value;},calls(){return calls;}};')();
 const first={size:2},second={size:4},rules={tacticalFootprints:'sized'};factory.scope(new WeakMap());for(let i=0;i<3;i++){assert.equal(factory.calculate(first,rules),2);assert.equal(factory.calculate(second,rules),4);}assert.equal(factory.calls(),2);
 first.size=3;factory.scope(new WeakMap());assert.equal(factory.calculate(first,rules),3);assert.equal(factory.calculate(second,rules),4);assert.equal(factory.calls(),4);
 assert.equal(factory.calculate(first,{tacticalFootprints:'sized'}),3);assert.equal(factory.calls(),5);factory.scope(undefined);first.size=5;assert.equal(factory.calculate(first,rules),5);assert.equal(factory.calls(),6);
});
