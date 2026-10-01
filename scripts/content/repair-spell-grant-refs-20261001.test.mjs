import {test} from 'node:test';
import assert from 'node:assert/strict';
import {repairSpellGrantReferences,spellGrantAlias} from './repair-spell-grant-refs-20261001.mjs';
import {sha256Canonical} from './certification-hash.mjs';
const spell=(id,name_en,card_number)=>({table:'spells',id,name_en,card_number,mechanics:{}});
const source=(id,grants)=>({table:'effects',id,card_number:'EFF-'+id,name:id,description:'Original source '+id,mechanics:{effects:[{resolution:'auto',result:grants}]}});
test('exact refs win over aliases and apostrophe/punctuation slug normalization matches the backend',()=>{
 assert.equal(spellGrantAlias("  Hunter's Mark!  "),'hunters_mark');
 assert.equal(spellGrantAlias('Dragon’s Breath'),'dragons_breath');
 const entities=[spell('a',"Hunter's Mark",'SPELL-a'),spell('b','Other','hunters_mark'),source('one',[{kind:'grant_spell',value:'hunters_mark'}])];
 assert.equal(repairSpellGrantReferences(entities).repairs.length,0);
});
test('repairs different declarative sources while preserving choice IDs, old free-use pools and unrelated mechanics',()=>{
 const entities=[spell('a',"Hunter's Mark",'SPELL-a'),spell('b','Speak With Animals','SPELL-b'),
  source('one',[{kind:'grant_spell',value:'hunters_mark',freeuse:true,label:'always_prepared',choice_id:'keep-choice'}]),
  source('two',[{kind:'grant_spell',value:'speak_with_animals',freeuse:{count:'prof_bonus',recharge:'short_rest',level:2},level_gate:3}])];
 const original=structuredClone(entities),result=repairSpellGrantReferences(entities);
 assert.equal(result.unresolved.length,0);assert.equal(result.repairs.length,2);
 assert.deepEqual(result.repairs[0].mechanics.effects[0].result[0],{kind:'grant_spell',value:'SPELL-a',freeuse:true,label:'always_prepared',choice_id:'keep-choice'});
 assert.deepEqual(result.repairs[1].mechanics.effects[0].result[0],{kind:'grant_spell',value:'SPELL-b',freeuse:{count:'prof_bonus',recharge:'short_rest',level:2},level_gate:3});
 assert.deepEqual(entities,original);
 const after=entities.map(entity=>({...entity,mechanics:result.repairs.find(repair=>repair.id===entity.id)?.mechanics??entity.mechanics}));
 assert.deepEqual(repairSpellGrantReferences(after).repairs,[]);
});
test('at-will and predeclared resources retain their semantics; dynamic grant templates are not guessed',()=>{
 const entities=[spell('a','Alpha Spell','SPELL-a'),source('one',[{kind:'grant_spell',value:'alpha_spell',freeuse:{at_will:true}},
  {kind:'choice',id:'unchanged',grant:{kind:'grant_spell',freeuse:true}},
  {kind:'grant_spell',value:'alpha_spell',freeuse:{count:2,resource_id:'stable-pool'}}])];
 const results=repairSpellGrantReferences(entities).repairs[0].mechanics.effects[0].result;
 assert.deepEqual(results[0].freeuse,{at_will:true});assert.deepEqual(results[1],entities[1].mechanics.effects[0].result[1]);
 assert.equal(results[2].freeuse.resource_id,'stable-pool');
});
test('missing and ambiguous spell aliases are reported without choosing a random spell',()=>{
 const result=repairSpellGrantReferences([spell('a','Same Spell','SPELL-a'),spell('b','Same Spell','SPELL-b'),
  source('one',[{kind:'grant_spell',value:'same_spell'},{kind:'grant_spell',value:'missing_spell'}])]);
 assert.equal(result.repairs.length,0);assert.equal(result.unresolved.length,2);
});
test('reference repair does not rewrite a previously authored free-use object',()=>{
 const entities=[spell('a','Alpha Spell','SPELL-a'),source('one',[
  {kind:'grant_spell',value:'alpha_spell',freeuse:{count:2,recharge:'long_rest',resource_id_prefix:'source-pool-'}},
 ])];
 const grant=repairSpellGrantReferences(entities).repairs[0].mechanics.effects[0].result[0];
 assert.equal(grant.value,'SPELL-a');
 assert.deepEqual(grant.freeuse,{count:2,recharge:'long_rest',resource_id_prefix:'source-pool-'});
});
test('variants do not make a unique parent grant alias ambiguous or independently acquirable',()=>{
 const entities=[spell('parent','Some Spell','SPELL-parent'),{...spell('child','Some Spell','SPELL-child'),mechanics:{variant_of_spell_id:'parent'}},
  source('one',[{kind:'grant_spell',value:'some_spell'}])];
 const result=repairSpellGrantReferences(entities);
 assert.equal(result.unresolved.length,0);assert.equal(result.repairs[0].changes[0].spell_id,'parent');
});
test('fills missing access only from reviewed source descriptions and rejects stale reviews',()=>{
 const one={...source('one',[{kind:'grant_spell',value:'SPELL-a'}]),description:'First declared always prepared'};
 const two={...source('two',[{kind:'grant_spell',value:'SPELL-a',label:'known'}]),description:'Other declaration'};
 const entities=[spell('a','Alpha','SPELL-a'),one,two];
 const reviews=[one,two].map(source=>({id:source.id,table:source.table,card_number:source.card_number,
  description_hash:sha256Canonical(source.description),access_label:'always_prepared'}));
 const result=repairSpellGrantReferences(entities,reviews);
 assert.equal(result.repairs.length,1);assert.equal(result.repairs[0].mechanics.effects[0].result[0].label,'always_prepared');
 assert.equal(two.mechanics.effects[0].result[0].label,'known');
 assert.throws(()=>repairSpellGrantReferences([{...one,description:'Changed source'},entities[0]],reviews),/source changed/);
});
