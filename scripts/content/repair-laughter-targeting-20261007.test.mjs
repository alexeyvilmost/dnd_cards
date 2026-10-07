import {test} from 'node:test';
import assert from 'node:assert/strict';
import {missingBaseTargetPlan,targetingRepairSQL} from './repair-laughter-targeting-20261007.mjs';
test('declares the reviewed base target count while preserving upcast and other entity data',()=>{
 for(const count of [1,2]){
  const row={mechanics:{targeting:{shape:'multiple',additional_target_slots_per_spell_slot_above_base:1},effects:[{kind:'condition'}]},support:{notes:'retained',status:'partial'}};
  const before=JSON.stringify(row),plan=missingBaseTargetPlan(row,count);
  assert.equal(plan.mechanics.targeting.max_targets,count);assert.equal(plan.mechanics.targeting.min_targets,count);
  assert.equal(plan.mechanics.targeting.additional_target_slots_per_spell_slot_above_base,1);
  assert.equal(plan.support.notes,'retained');assert.equal(plan.support.status,'not_verified');assert.equal(JSON.stringify(row),before);
 }
});
test('customized and deleted declarations are untouched, conflicting minima require review',()=>{
 assert.equal(missingBaseTargetPlan({mechanics:{targeting:{shape:'multiple',max_targets:2}}},1),null);
 assert.equal(missingBaseTargetPlan({deleted_at:'date',mechanics:{targeting:{shape:'multiple'}}},1),null);
 assert.equal(missingBaseTargetPlan({mechanics:{targeting:{shape:'single'}}},1),null);
 assert.throws(()=>missingBaseTargetPlan({mechanics:{targeting:{shape:'multiple',min_targets:3}}},1),/review/);
});
test('application requires exact preimage, holds its row and rejects changes to frozen history before commit',()=>{
 assert.throws(()=>targetingRepairSQL("'; SELECT 1"),/hash/);
 const sql=targetingRepairSQL('sha256:'+'a'.repeat(64));
 assert.match(sql,/FOR UPDATE/);assert.match(sql,/Reviewed preimage changed/);assert.match(sql,/Frozen history changed/);
 assert.equal((sql.match(/UPDATE spells/g)||[]).length,2);assert.doesNotMatch(sql,/UPDATE roguelike_runs|UPDATE frozen_combat_catalogs/);
 assert.match(sql,/BEGIN ISOLATION LEVEL REPEATABLE READ/);assert.match(sql,/COMMIT/);
});
