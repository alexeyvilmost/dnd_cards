import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const shardNames=suite=>suite==='extended'?['unit','backend','flows','extended']:['unit','backend','flows'];
export function shardPlan({suite,nodeFiles,vitestFiles,goGroups,scripts,browserGroups,gates,fixtureFiles}) {
  assert.ok(['core','extended'].includes(suite),'Only mandatory suites may be sharded');
  const units=[];
  const add=(id,shard,files=[])=>units.push({id,shard,files:[...new Set(files)].sort()});
  for(const file of nodeFiles)add(`node:${file}`,file.startsWith('frontend/worker/')||file.endsWith('.integration.test.mjs')?'backend':'unit',[file]);
  for(const file of vitestFiles)add(`vitest:${file}`,'unit',[file]);
  if(goGroups.length){
    if(suite==='extended')add('go:all-local-packages','backend');
    else for(const pkg of [...new Set(goGroups.map(group=>group.package))])add(`go:${pkg}`,'backend');
  }
  for(const group of scripts)add(`script:${group.id}`,'flows',[group.file]);
  for(const group of browserGroups)add(`browser:${group.id}`,'flows',group.files);
  if(suite==='extended'){
    for(const gate of gates)add(`gate:${gate.id}`,'extended',[gate.script]);
    for(const profile of ['production','battle3d']){
      const files=fixtureFiles.filter(file=>(file==='frontend/e2e/battle-3d.spec.ts')===(profile==='battle3d'));
      if(files.length)add(`fixture:${profile}`,'extended',files);
    }
  }
  units.sort((a,b)=>a.id.localeCompare(b.id));
  assert.equal(new Set(units.map(unit=>unit.id)).size,units.length,'Duplicate workload unit');
  const names=shardNames(suite).filter(name=>units.some(unit=>unit.shard===name));
  assert.ok(units.length>0&&names.length>0,'Empty shard workload');
  return {schema_version:1,suite,names,units,sha256:digest({suite,names,units})};
}
export function assignShard(plan,name) {
  if(!plan.names.includes(name))throw Error(`Unknown or empty required shard: ${name}`);
  return {...plan,name,assigned:plan.units.filter(unit=>unit.shard===name).map(unit=>unit.id)};
}
export function assertShardCoverage(shard,completed) {
  assert.equal(new Set(completed).size,completed.length,'Shard ran a workload unit more than once');
  assert.deepEqual([...completed].sort(),[...shard.assigned].sort(),'Shard workload missing or unexpectedly executed');
}
export function aggregateShardReports(reports, expectedPlan) {
  assert.ok(Array.isArray(reports)&&reports.length>0,'Shard reports are required');
  const first=reports[0],plan=first.shard;
  assert.ok(plan&&plan.schema_version===1,'Expected mandatory shard report');
  assert.ok(expectedPlan,'A current independently selected workload is required');
  assert.deepEqual({...plan,name:undefined,assigned:undefined},{...expectedPlan,name:undefined,assigned:undefined},'Reported workload differs from current mandatory selection');
  assert.equal(plan.sha256,digest({suite:plan.suite,names:plan.names,units:plan.units}),'Shard plan was modified');
  assert.deepEqual(reports.map(row=>row.shard?.name).sort(),[...plan.names].sort(),'Missing or duplicate shard');
  const completed=[],resources=new Set();
  let artifactHash,uiHash;
  for(const report of reports){
    assert.equal(report.status,'passed','A required shard failed');
    assert.equal(report.shard.sha256,plan.sha256,'Shard plans differ');
    assert.deepEqual({...report.shard,name:undefined,assigned:undefined},{...plan,name:undefined,assigned:undefined},'Shard workload inventories differ');
    assert.equal(report.shard.sha256,digest({suite:report.shard.suite,names:report.shard.names,units:report.shard.units}));
    assert.deepEqual(report.shard.assigned,plan.units.filter(unit=>unit.shard===report.shard.name).map(unit=>unit.id),'Shard assignment changed');
    assert.equal(report.suite,plan.suite);
    for(const key of ['candidate','manifest_sha256','component_plan','selection','source_snapshot','ci_source','lockfiles','worktree','go_race','frontend_verification','frontend_planning'])assert.deepEqual(report[key],first[key],`Shard ${key} differs`);
    assertShardCoverage(report.shard,report.coverage?.completed??[]);completed.push(...report.coverage.completed);
    assert.ok(report.checks.length&&report.checks.every(check=>check.status==='passed'),'Unfinished shard check');
    const stable=report.checks.find(check=>check.id==='source-stability')?.result;
    assert.equal(stable?.unchanged,true);assert.equal(stable.sha256,report.source_snapshot.sha256);assert.equal(stable.files,report.source_snapshot.files);
    if(report.fixture){
      assert.ok(!resources.has(report.fixture.run_id),'Two shards shared mutable stand resources');resources.add(report.fixture.run_id);
      assert.equal(report.cleanup?.status,'stopped');assert.deepEqual(report.cleanup.errors??[],[]);
      if(report.fixture.artifact_hash){
        assert.match(report.fixture.artifact_hash,/^sha256:[a-f0-9]{64}$/);
        artifactHash??=report.fixture.artifact_hash;assert.equal(report.fixture.artifact_hash,artifactHash,'Shards ran different rule artifacts');
        assert.equal(report.fixture.ui_build?.isolatedBuild,true,'Shard UI build was not isolated');
        assert.equal(report.fixture.ui_build?.reused,false,'Shard reused an unverified UI build');
        assert.match(report.fixture.ui_build?.manifestHash??'',/^[a-f0-9]{64}$/);
        uiHash??=report.fixture.ui_build.manifestHash;assert.equal(report.fixture.ui_build.manifestHash,uiHash,'Shards ran different UI bytes');
      }
    }else{assert.equal(report.cleanup?.status,'not-required');assert.deepEqual(report.cleanup.errors??[],[]);}
  }
  assert.equal(new Set(completed).size,completed.length,'Global workload was executed more than once');
  assert.deepEqual(completed.sort(),plan.units.map(unit=>unit.id).sort(),'Global mandatory workload is incomplete');
  const checks=new Map();
  for(const report of reports)for(const check of report.checks){
    if(checks.has(check.id))assert.ok(['source-hygiene','source-stability','isolated-stack'].includes(check.id),'Duplicate non-infrastructure check');
    else checks.set(check.id,check);
  }
  const primary=reports.find(report=>report.shard.name==='flows')??first;
  const starts=reports.map(row=>Date.parse(row.started_at));
  assert.ok(starts.every(Number.isFinite)&&reports.every(row=>Number.isFinite(row.duration_ms)&&row.duration_ms>=0),'Invalid shard timing');
  const earliest=Math.min(...starts),duration=Math.max(...reports.map((row,index)=>starts[index]+row.duration_ms))-earliest;
  const result={...primary,checks:[...checks.values()],status:'passed',cleanup:{status:resources.size?'stopped':'not-required',errors:[]},
    started_at:new Date(earliest).toISOString(),duration_ms:duration,
    aggregation:{schema_version:1,plan_sha256:plan.sha256,workload:plan.units.length,global_coverage_complete:true,
      max_shard_duration_ms:Math.max(...reports.map(row=>row.duration_ms)),
      shards:reports.map(row=>({name:row.shard.name,report_sha256:digest(row),run_id:row.fixture?.run_id??null,checks:row.checks.length,duration_ms:row.duration_ms}))}};
  delete result.shard;delete result.coverage;
  return result;
}
