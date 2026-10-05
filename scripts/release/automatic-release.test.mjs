import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolveReleaseRequest,assertCurrentMainCandidate} from './automatic-release.mjs';

const repository='fixture/project', candidate='a'.repeat(40), control='b'.repeat(40);
const run=(kind='ci',id=11)=>({id,run_attempt:1,path:`.github/workflows/${kind}.yml`,head_sha:candidate,head_branch:'main',event:'push',status:'completed',conclusion:'success',repository:{full_name:repository},head_repository:{full_name:repository}});
const baselineRoute='actions/workflows/deploy.yml/runs?branch=main&status=completed&per_page=100&page=1';
function fixture() {
  const event={repository:{full_name:repository},workflow_run:run()};
  const responses={'actions/runs/11':run(),'commits/main':{sha:candidate},[baselineRoute]:{workflow_runs:[]},
    'actions/runs/8':run('deploy',8),
    'actions/runs/8/jobs?filter=latest&per_page=100&page=1':{total_count:1,jobs:[{id:80,name:'deploy',run_id:8,head_sha:candidate,status:'completed',conclusion:'success',started_at:'2026-01-01T00:00:00Z',completed_at:'2026-01-01T00:10:00Z'}]},
    'actions/runs/8/artifacts?per_page=100&page=1':{total_count:1,artifacts:[{id:800,name:'deployed-release',size_in_bytes:200,expired:false,created_at:'2026-01-01T00:09:00Z',expires_at:'2099-01-01T00:00:00Z',workflow_run:{id:8,head_sha:candidate}}]}};
  return {eventName:'workflow_run',event,repository,controlCommit:control,variables:{RELEASE_BUILD_ENABLED:'true',AUTO_RELEASE_MAIN_ENABLED:'true',RELEASE_PUBLICATION_ENABLED:'true'},
    get:async route=>{if(!Object.hasOwn(responses,route))throw Error('Unexpected metadata request');const value=responses[route];return route===baselineRoute&&Array.isArray(value.workflow_runs)?{total_count:value.workflow_runs.length,...value}:value;},responses};
}
test('automatic release binds CI source separately from workflow control and discovers the last deployment',async()=>{
  const f=fixture();f.responses[baselineRoute].workflow_runs=[run('deploy',8)];
  const result=await resolveReleaseRequest(f);
  assert.deepEqual(result,{schemaVersion:1,candidate,controlCommit:control,repository,verificationRunId:'11',baselineRunId:'8',publish:true});
});
test('automatic first release selects no baseline and does not infer publication authority',async()=>{
  const f=fixture();f.variables.RELEASE_PUBLICATION_ENABLED='false';
  const result=await resolveReleaseRequest(f);assert.equal(result.baselineRunId,'');assert.equal(result.publish,false);
});
test('queued automatic cutover rechecks main while explicit manual historical source remains possible',async()=>{
  const get=async()=>({sha:'c'.repeat(40)});
  await assert.rejects(assertCurrentMainCandidate({eventName:'workflow_run',candidate,get}),/superseded/);
  assert.equal((await assertCurrentMainCandidate({eventName:'workflow_dispatch',candidate,get})).currentMainChecked,false);
  assert.equal((await assertCurrentMainCandidate({eventName:'workflow_run',candidate,get:async()=>({sha:candidate})})).currentMainChecked,true);
});
test('automatic requests reject failed, forked, PR, wrong workflow, disabled and superseded inputs',async()=>{
  for(const change of [f=>f.event.workflow_run.conclusion='failure',f=>f.event.workflow_run.event='pull_request',
    f=>f.event.workflow_run.head_repository.full_name='fork/project',f=>f.event.workflow_run.path='.github/workflows/other.yml',
    f=>f.event.repository.full_name='fork/project',f=>f.variables.RELEASE_BUILD_ENABLED='false',
    f=>f.variables.AUTO_RELEASE_MAIN_ENABLED='false',f=>f.responses['commits/main'].sha='c'.repeat(40),
    f=>f.responses['actions/runs/11'].head_sha='d'.repeat(40),f=>f.responses['actions/runs/11'].id=12]) {
    const f=fixture();change(f);await assert.rejects(resolveReleaseRequest(f));
  }
});
test('baseline metadata failures fail closed instead of becoming an initial full build',async()=>{
  const f=fixture();f.responses[baselineRoute]={};
  await assert.rejects(resolveReleaseRequest(f),/unavailable/);
  f.responses[baselineRoute]={workflow_runs:[{...run('deploy',8),conclusion:'failure'}]};
  await assert.rejects(resolveReleaseRequest(f));
});
function manual() {
  const f=fixture();f.eventName='workflow_dispatch';f.variables.AUTO_RELEASE_MAIN_ENABLED='false';
  f.event={repository:{full_name:repository},ref:'refs/heads/main',inputs:{candidate,verification_run_id:'11',publish:'false'}};return f;
}
test('manual release still requires exact verified source and main control',async()=>{
  const f=manual();assert.equal((await resolveReleaseRequest(f)).candidate,candidate);
  for(const change of [v=>v.event.ref='refs/heads/feature',v=>v.event.inputs.candidate='main',v=>v.event.inputs.verification_run_id='0',
    v=>v.event.inputs.publish='yes',v=>v.event.inputs.baseline_run_id='8',v=>v.event.inputs.candidate='c'.repeat(40)]) {
    const v=manual();change(v);await assert.rejects(resolveReleaseRequest(v));
  }
});
test('manual publication and stale baseline cannot bypass policy',async()=>{
  const f=manual();f.variables.RELEASE_PUBLICATION_ENABLED='false';f.event.inputs.publish='true';await assert.rejects(resolveReleaseRequest(f),/disabled/);
  f.event.inputs.publish='false';f.event.inputs.baseline_run_id='7';f.responses[baselineRoute].workflow_runs=[run('deploy',8)];
  await assert.rejects(resolveReleaseRequest(f),/latest/);
  f.event.inputs.baseline_run_id='8';assert.equal((await resolveReleaseRequest(f)).baselineRunId,'8');
});
test('workflow chains verification to resolved exact source with publication disabled by default',()=>{
  const yaml=createRequire(new URL('../../frontend/package.json',import.meta.url))('js-yaml');
  const workflow=yaml.load(readFileSync(new URL('../../.github/workflows/release.yml',import.meta.url),'utf8'));
  assert.deepEqual(workflow.on.workflow_run.workflows,['Local contract suites']);
  assert.match(workflow.jobs.prepare.if,/AUTO_RELEASE_MAIN_ENABLED/);
  const sourceCheckouts=workflow.jobs.prepare.steps.filter(step=>step.with?.path==='source');
  assert.equal(sourceCheckouts[0].with.ref,'${{ steps.request.outputs.candidate }}');
  assert.equal(workflow.jobs.components.steps.find(step=>step.with?.path==='source').with.ref,'${{ needs.prepare.outputs.candidate }}');
  assert.match(workflow.jobs.publish.if,/needs.prepare.outputs.publish/);
  assert.equal(workflow.on.workflow_dispatch.inputs.publish.default,false);
});
