import test from 'node:test';
import assert from 'node:assert/strict';
import {shardPlan,assignShard,assertShardCoverage,aggregateShardReports} from './shards.mjs';
import {suiteWorkload} from './workload.mjs';
import {readSuites,selectGroups,catalogTests} from './suites.mjs';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';

function fixture(suite='extended'){
  const plan=shardPlan({suite,nodeFiles:['scripts/a.test.mjs','frontend/worker/a.test.mjs'],vitestFiles:['frontend/src/a.test.ts'],
    goGroups:[{package:'.'}],scripts:[{id:'api',file:'scripts/api.mjs'}],browserGroups:[{id:'browser',files:['frontend/e2e-local/main.spec.ts']}],
    gates:[{id:'durable',script:'scripts/durable.mjs'}],fixtureFiles:['frontend/e2e/example.spec.ts','frontend/e2e/battle-3d.spec.ts']});
  const reports=plan.names.map((name,i)=>{
    const shard=assignShard(plan,name);
    return {suite,status:'passed',started_at:new Date(1000+i*100).toISOString(),candidate:{sha:'a'.repeat(40)},manifest_sha256:'a'.repeat(64),selection:{selected:['all']},
      source_snapshot:{sha256:'b'.repeat(64),files:2},duration_ms:10,shard,coverage:{completed:[...shard.assigned]},
      checks:[{id:'source-hygiene',status:'passed'},{id:name,status:'passed'},
        {id:'source-stability',status:'passed',result:{unchanged:true,sha256:'b'.repeat(64),files:2}}],
      fixture:name==='unit'?null:{run_id:`test_${String(i).repeat(24)}`,artifact_hash:'sha256:'+'c'.repeat(64),
        ui_build:{isolatedBuild:true,reused:false,manifestHash:'d'.repeat(64)}},cleanup:{status:name==='unit'?'not-required':'stopped',errors:[]}};
  });return {plan,reports};
}
test('real mandatory inventory assigns every required file/group to exactly one nonempty lane',()=>{
  const {manifest}=readSuites(),catalog=catalogTests(manifest);
  for(const suite of ['core','extended']){
    const selection=selectGroups(manifest,{components:{frontend:true,backend:true,worker:true,infrastructure:true}},{suite});
    const work=suiteWorkload({selection,catalog,manifest,suite}),plan=shardPlan(work);
    assert.deepEqual(plan.names,suite==='core'?['unit','backend','flows']:['unit','backend','flows','extended']);
    assert.equal(new Set(plan.units.map(unit=>unit.id)).size,plan.units.length);
    assert.equal(plan.units.filter(unit=>unit.id.startsWith('node:')).length,work.nodeFiles.length);
    assert.equal(plan.units.filter(unit=>unit.id.startsWith('vitest:')).length,work.vitestFiles.length);
    assert.equal(plan.units.filter(unit=>unit.id.startsWith('gate:')).length,suite==='extended'?manifest.extended_gates.length:0);
    for(const name of plan.names){const shard=assignShard(plan,name);assertShardCoverage(shard,shard.assigned);}
    assert.throws(()=>assignShard(plan,'typo'));
  }
});
test('aggregation proves global coverage and strips the partial receipt marker',()=>{
  const {plan,reports}=fixture();const result=aggregateShardReports(reports,plan);
  assert.equal(result.status,'passed');assert.equal(result.shard,undefined);
  assert.equal(result.aggregation.global_coverage_complete,true);assert.equal(result.aggregation.workload,plan.units.length);
  assert.equal(result.aggregation.shards.length,4);assert.equal(result.cleanup.status,'stopped');
  assert.equal(result.duration_ms,310);assert.equal(result.aggregation.max_shard_duration_ms,10);
});
test('missing, duplicate, failed and unowned work cannot create a green aggregate',async t=>{
  const faults={missing:r=>r.pop(),duplicate:r=>r.push(r[0]),failed:r=>r[1].status='failed',
    absentUnit:r=>r[0].coverage.completed.pop(),extraUnit:r=>r[0].coverage.completed.push('invented'),
    repeatedUnit:r=>r[0].coverage.completed.push(r[0].coverage.completed[0]),assignment:r=>r[0].shard.assigned.pop(),
    changedSource:r=>r[1].source_snapshot.sha256='e'.repeat(64),drift:r=>r[0].checks.at(-1).result.unchanged=false,
    cleanSourceLie:r=>r[0].checks.at(-1).result.files++,changedPlan:r=>r[0].shard.units.pop(),
    skippedCheck:r=>r[0].checks[0].status='skipped',cleanup:r=>r[1].cleanup.status='cleanup_failed',
    cleanupErrors:r=>r[1].cleanup.errors.push('leak'),sharedStack:r=>r[2].fixture.run_id=r[1].fixture.run_id,
    artifact:r=>r[2].fixture.artifact_hash='sha256:'+'e'.repeat(64),ui:r=>r[2].fixture.ui_build.manifestHash='e'.repeat(64),
    sharedBuild:r=>r[2].fixture.ui_build.isolatedBuild=false,reusedBuild:r=>r[2].fixture.ui_build.reused=true,
    candidate:r=>r[2].candidate.sha='f'.repeat(40),doubleCheck:r=>r[2].checks[1].id=r[1].checks[1].id};
  for(const [name,mutate] of Object.entries(faults))await t.test(name,()=>{const {plan,reports}=fixture();mutate(reports);assert.throws(()=>aggregateShardReports(reports,plan));});
  const {plan,reports}=fixture();const changed=structuredClone(plan);changed.units.pop();assert.throws(()=>aggregateShardReports(reports,changed));
  assert.throws(()=>aggregateShardReports(reports));
});
test('documentation selection permits a single unit lane without fabricating a stack',()=>{
  const {manifest}=readSuites(),selection=selectGroups(manifest,{components:{}},{suite:'core'});
  const plan=shardPlan(suiteWorkload({selection,catalog:catalogTests(manifest),manifest,suite:'core'}));
  assert.deepEqual(plan.names,['unit']);
});
test('CI schedules the same bounded lanes and publishes a release receipt only after aggregation',()=>{
  const yaml=createRequire(new URL('../../frontend/package.json',import.meta.url))('js-yaml');
  const workflow=yaml.load(readFileSync(new URL('../../.github/workflows/ci.yml',import.meta.url),'utf8'));
  assert.equal(workflow.jobs.contracts.strategy['max-parallel'],2);
  assert.equal(workflow.jobs.contracts.strategy['fail-fast'],false);
  assert.match(workflow.jobs.contracts.strategy.matrix.shard,/needs\.plan\.outputs\.shards/);
  const runner=workflow.jobs.contracts.steps.find(step=>step.name==='Run the shared suite runner');
  assert.match(runner.run,/args\+=\(--shard "\$SHARD"\)/);
  const aggregate=workflow.jobs.aggregate;
  assert.deepEqual(aggregate.needs,['plan','contracts']);
  assert.match(aggregate.steps[0].run,/test "\$SHARD_RESULT" = success/);
  assert.ok(aggregate.steps.some(step=>step.run?.includes('scripts/testing/aggregate-shards.mjs')));
  assert.equal(aggregate.steps.at(-1).with.name,'local-suite-results');
});
