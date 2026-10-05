import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verifyUrvinSeed,urvinHash} from './urvin-fixture.mjs';
import {declineUrvinCombatChoice} from './urvin-acceptance.mjs';
import {requiredUrvinChecks,verifyUrvinReport} from '../performance/check-urvin.mjs';

function seed(){
 const effects=Array.from({length:5},(_,i)=>({id:`a0000000-0000-4000-8000-00000000000${i}`,name:`Aura ${i}`}));
 const action={id:'b0000000-0000-4000-8000-000000000001',name:'One action'};
 const monster={id:'c0000000-0000-4000-8000-000000000001',slug:'fixture-one',action_ids:[action.id],effect_ids:[]};
 return {schemaVersion:1,kind:'generated-public-seed-only',seedVersions:['199_materialize_roguelike_monsters','273_urvin_run'],
  mode:{version:1,id:'urvin',auras:effects.map(row=>({id:row.id})),events:Array.from({length:5},(_,id)=>({id})),encounters:[{monsters:[{slug:monster.slug}]}]},collections:{effects,actions:[action],monsters:[monster]}};
}
test('Urvin seed closure rejects missing dependencies and private inputs',()=>{
 assert.equal(verifyUrvinSeed(seed()).mode.version,1);
 for(const change of [row=>row.collections.actions.pop(),row=>row.collections.effects.pop(),row=>row.collections.monsters.pop(),row=>row.collections.monsters[0].user_id='private',row=>row.seedVersions.reverse()]){
  const row=seed();change(row);assert.throws(()=>verifyUrvinSeed(row));
 }
});
test('Urvin invariant hash is stable across object key order',()=>{
 assert.equal(urvinHash({a:1,b:{x:2,y:3}}),urvinHash({b:{y:3,x:2},a:1}));
 assert.notEqual(urvinHash({a:[1,2]}),urvinHash({a:[2,1]}));
});
test('Urvin combat driver declines known decisions and fails closed on unknown ones',()=>{
 const state={characterId:'hero',world:{scene:{initiative:['hero'],activeIndex:0}}};
 assert.equal(declineUrvinCombatChoice(state),undefined);
 assert.deepEqual(declineUrvinCombatChoice({...state,pendingD20Interrupt:{}}),{type:'d20_interrupt',actorId:null});
 for(const phase of ['rolled','resolved'])assert.deepEqual(declineUrvinCombatChoice({...state,pendingDeathSave:{actorId:'hero',phase}}),{type:'death_save',actorId:'hero',phase});
 assert.throws(()=>declineUrvinCombatChoice({...state,pendingDeathSave:{actorId:'hero',phase:'unknown'}}),/Unhandled/);
 assert.throws(()=>declineUrvinCombatChoice({...state,world:{...state.world,pendingResolution:{request:{type:'unsupported'}}}}),/Unhandled/);
});

test('Urvin receipt requires every real scenario and verified configuration restoration',()=>{
 const report={schemaVersion:1,status:'passed',execution:'native-owned-api',part:'all',runId:'owned',artifactHash:'sha256:'+'a'.repeat(64),
  checks:requiredUrvinChecks.map(id=>({id,status:'passed'})),createdRuns:30,
  fixture:{historicalChainVerified:false,fixtureHash:'sha256:'+'b'.repeat(64)},fixtureCleanup:{status:'restored',sharedCatalogUnchanged:true,sharedSettingsUnchanged:true}};
 assert.equal(verifyUrvinReport(report,'owned'),report);
 for(const change of [row=>row.checks.pop(),row=>row.checks[1]=row.checks[0],row=>row.checks[0].status='skipped',row=>row.fixtureCleanup.status='failed',row=>row.fixtureCleanup.sharedSettingsUnchanged=false,row=>row.part='route',row=>row.execution='synthetic',row=>row.runId='foreign']){
  const row=structuredClone(report);change(row);assert.throws(()=>verifyUrvinReport(row,'owned'));
 }
});
