import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pureActionGrants,planActionWrapperMigration,actionWrapperMigrationSql} from './flatten-action-wrappers.mjs';
const wrapper=(id,ref)=>({id,card_number:`EFF-${id}`,name:id,description:`Описание ${id}`,mechanics:{activation:{mode:'passive'},effects:[{resolution:'auto',result:[{kind:'grant_action',value:ref}]}]}});
test('keeps species flight at level 5 and subclass actions at their unlock, preserving descriptions',()=>{
  const first=wrapper('flight','fly'),second=wrapper('channel','strike');
  const plan=planActionWrapperMigration({effects:[first,second],actions:[{id:'a',card_number:'fly',name:'Полёт',description:'Краткое описание'},{id:'b',card_number:'strike',name:'Удар',description:'Описание channel'}],edges:[],races:[{id:'race',name:'Вид',level_progression:{'5':{effects:['flight'],actions:[]}}}],classes:[{id:'sub',name:'Подкласс',is_subclass:true,subclass_level:3,related_effects:['channel']}]});
  assert.deepEqual(plan.parents[0].after.level_progression['5'],{effects:[],actions:['a']});
  assert.deepEqual(plan.parents[1].after.level_progression['3'].actions,['b']);
  assert.equal(plan.parents[1].after.level_progression['1'],undefined);
  assert.equal(plan.actions[0].after.detailed_description,'Описание flight');assert.equal(plan.actions.length,1);
  assert.match(actionWrapperMigrationSql(plan,{apply:true}),/content_action_wrapper_archive/);
});
test('never drops costs, contextual grants, resource changes, duration or additional semantics',()=>{
  for(const modify of [e=>{e.mechanics.duration={type:'rounds',amount:10}},e=>{e.mechanics.activation.cost=[{resource:'action'}]},e=>{e.mechanics.effects[0].condition={kind:'bloodied'}},e=>{e.mechanics.effects[0].result.push({kind:'resource',op:'grant',id:'charges',amount:1})},e=>{e.mechanics.effects[0].result.push({kind:'narrative',description:'Дополнительное правило'})},e=>{e.script={bonus:1}},e=>{e.repeatable=true}]){
    const effect=wrapper('extra','action');modify(effect);assert.equal(pureActionGrants(effect),null);
  }
});
test('preserves a wrapper used by another catalog owner instead of deleting a live reference',()=>{
  const plan=planActionWrapperMigration({effects:[wrapper('flight','fly')],actions:[{id:'a',card_number:'fly'}],races:[{id:'r',related_effects:['flight']}],classes:[],edges:[{source_type:'spell',source_id:'s',target_key:'flight',path:'mechanics.effects[0]'}]});
  assert.equal(plan.replacements.length,0);assert.equal(plan.skipped.length,1);
});
