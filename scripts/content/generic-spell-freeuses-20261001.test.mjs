import {test} from 'node:test';
import assert from 'node:assert/strict';
import {restoreGenericSpellFreeuses} from './generic-spell-freeuses-20261001.mjs';
test('two different spells restore generic boolean and formula counts while keeping new grants and abilities',()=>{
 const original={effects:[{result:[{kind:'grant_spell',value:'alpha',freeuse:true},
  {kind:'grant_spell',value:'beta',freeuse:{count:'prof_bonus',recharge:'short_rest',level:2}}]}]};
 const current={effects:[{result:[{kind:'grant_spell',value:'SPELL-A',label:'always_prepared',ability:'wis',freeuse:{count:1,recharge:'long_rest',resource_id:'freeuse-alpha'}},
  {kind:'grant_spell',value:'SPELL-B',ability:'cha',freeuse:{count:'prof_bonus',recharge:'short_rest',level:2,resource_id:'freeuse-beta'}}]}]};
 const copy=structuredClone(current),result=restoreGenericSpellFreeuses(current,original);
 assert.equal(result.changes.length,2);assert.equal(result.mechanics.effects[0].result[0].freeuse,true);
 assert.deepEqual(result.mechanics.effects[0].result[1].freeuse,original.effects[0].result[1].freeuse);
 assert.equal(result.mechanics.effects[0].result[0].ability,'wis');assert.equal(result.mechanics.effects[0].result[0].value,'SPELL-A');
 assert.deepEqual(current,copy);assert.equal(restoreGenericSpellFreeuses(result.mechanics,original).changes.length,0);
});
test('dynamic choice restores its generic free use and rejects missing, authored and drifted preimages',()=>{
 const original={grant:{kind:'grant_spell',freeuse:true}};
 const current={grant:{kind:'grant_spell',freeuse:{count:1,recharge:'long_rest',resource_id_prefix:'freeuse-'}}};
 assert.deepEqual(restoreGenericSpellFreeuses(current,original).mechanics,original);
 assert.throws(()=>restoreGenericSpellFreeuses(current,{}),/Missing reviewed/);
 assert.throws(()=>restoreGenericSpellFreeuses(current,{grant:{kind:'grant_spell',freeuse:{count:1,resource_id:'authored'}}}),/authored/);
 assert.throws(()=>restoreGenericSpellFreeuses({...current,grant:{...current.grant,freeuse:{...current.grant.freeuse,count:2}}},original),/gameplay values changed/);
});
