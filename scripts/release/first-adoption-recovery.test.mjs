import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateFirstAdoptionRecovery,loadControlRecovery,assertRecoveredInitialHistory,recoveryFields} from './first-adoption-recovery.mjs';
import {resolveReleaseRequest} from './automatic-release.mjs';
import {selectLatestDeployedRun} from './deployed-baseline.mjs';
import {evidenceHash} from './validate-manifest.mjs';
import {verifyRecoveredHostAuthority} from './first-adoption-recovery-host.mjs';
const controlRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const proof=JSON.parse(readFileSync(path.join(controlRoot,'infra/first-adoption-recoveries/37273035754-1.json'),'utf8'));
const repository=proof.repository,controlCommit='d'.repeat(40),now=Date.parse('2026-10-05T09:00:00.000Z');
function run(id,{conclusion='failure',status='completed',head_sha=proof.failedDeployment.controlCommit,...rest}={}) {return {id,run_attempt:1,path:'.github/workflows/deploy.yml',head_branch:'main',event:'workflow_dispatch',repository:{full_name:repository},head_repository:{full_name:repository},head_sha,status,conclusion,...rest};}
function metadata(runs=[run(proof.failedDeployment.runId)],overrides={}) {
  return async route=>{
    if(route==='commits/main')return {sha:controlCommit};
    if(route==='actions/runs/99')return {id:99,path:'.github/workflows/ci.yml',head_branch:'main',head_sha:controlCommit,event:'push',repository:{full_name:repository},head_repository:{full_name:repository},status:'completed',conclusion:'success'};
    if(overrides[route])return overrides[route];
    if(route.startsWith('actions/workflows/deploy.yml/runs'))return {total_count:runs.length,workflow_runs:runs};
    const match=/^actions\/runs\/(\d+)(\/jobs\?.*)?$/.exec(route),row=runs.find(r=>r.id===Number(match?.[1]));
    if(row&&!match[2])return row;
    if(row)return {total_count:1,jobs:[{id:row.id+1,name:'deploy',run_id:row.id,run_attempt:row.run_attempt,head_sha:row.head_sha,status:row.status,conclusion:row.jobConclusion??row.conclusion,started_at:'2026-10-05T06:33:38Z',completed_at:'2026-10-05T07:14:00Z'}]};
    throw Error('Unexpected fixture GET');
  };
}
test('closed safe projection binds reviewed bytes and control, no private additions',()=>{
  const {reference}=loadControlRecovery({id:proof.id,controlRoot,controlCommit,repository});
  assert.equal(reference.proofHash,evidenceHash(proof));assert.deepEqual(recoveryFields(undefined),{});
  assert.throws(()=>validateFirstAdoptionRecovery({...proof,env:{TOKEN:'private'}}));
  assert.throws(()=>loadControlRecovery({id:proof.id,controlRoot,controlCommit,repository,reference:{...reference,proofHash:'sha256:'+'0'.repeat(64)}}));
  assert.throws(()=>loadControlRecovery({id:'../escape',controlRoot,controlCommit,repository}));
  assert.throws(()=>validateFirstAdoptionRecovery({...proof,cleanup:{...proof.cleanup,remainingOwnedResources:1}}));
});
test('reviewed exact terminal failure is explicit initial-only; normal discovery still refuses',async()=>{
  await assertRecoveredInitialHistory(metadata(),{proof,now});
  await assert.rejects(selectLatestDeployedRun(metadata(),{repository,now}),/recovery is required/);
  const current=run(77,{status:'in_progress',conclusion:null,head_sha:controlCommit});
  await assertRecoveredInitialHistory(metadata([run(proof.failedDeployment.runId),current]),{proof,now,currentDeployment:{id:77,attempt:1,controlCommit}});
});
test('success, unknown failure, foreign active, changed rerun and incomplete history never become no predecessor',async()=>{
  for(const row of [run(55,{conclusion:'success'}),run(55),run(55,{status:'in_progress',conclusion:null}),run(55,{conclusion:'neutral'})])await assert.rejects(assertRecoveredInitialHistory(metadata([run(proof.failedDeployment.runId),row]),{proof,now}));
  await assert.rejects(assertRecoveredInitialHistory(metadata([run(proof.failedDeployment.runId,{run_attempt:2})]),{proof,now}));
  await assert.rejects(assertRecoveredInitialHistory(metadata([]),{proof,now}));
  await assert.rejects(assertRecoveredInitialHistory(metadata(undefined,{'actions/workflows/deploy.yml/runs?per_page=100&page=1':{total_count:2,workflow_runs:[]}}),{proof,now}));
  await assert.rejects(assertRecoveredInitialHistory(metadata(),{proof,now,currentDeployment:{id:77,attempt:1,controlCommit}}));
});
test('only proven skipped foreign deploy jobs may coexist with the reviewed first failure',async()=>{
  await assertRecoveredInitialHistory(metadata([run(proof.failedDeployment.runId),run(55,{conclusion:'success',jobConclusion:'skipped'})]),{proof,now});
  await assert.rejects(assertRecoveredInitialHistory(metadata([run(proof.failedDeployment.runId,{head_sha:'e'.repeat(40)})]),{proof,now}));
});
test('manual explicit current-main recovery creates initial request; automatic and baseline overrides fail',async()=>{
  const event={ref:'refs/heads/main',repository:{full_name:repository},inputs:{candidate:controlCommit,verification_run_id:'99',first_adoption_recovery:proof.id,publish:false}};
  const args={eventName:'workflow_dispatch',event,repository,controlCommit,controlRoot,variables:{RELEASE_BUILD_ENABLED:'true'},get:metadata()};
  const request=await resolveReleaseRequest(args);assert.equal(request.baselineRunId,'');assert.equal(request.firstAdoptionRecovery.proofHash,evidenceHash(proof));
  await assert.rejects(resolveReleaseRequest({...args,eventName:'workflow_run'}),/manual only/);
  await assert.rejects(resolveReleaseRequest({...args,event:{...event,inputs:{...event.inputs,baseline_run_id:'1'}}}));
  await assert.rejects(resolveReleaseRequest({...args,event:{...event,inputs:{...event.inputs,first_adoption_recovery:undefined}}}),/recovery is required/);
});
test('host recovery refuses a main push after planning before either protected observation boundary',async()=>{
  const current=run(77,{status:'in_progress',conclusion:null,head_sha:controlCommit}),fresh=metadata([run(proof.failedDeployment.runId),current]);
  const request={runId:77,attempt:1,controlCommit};
  for(const boundary of ['before-capture','under-lock']) {
    let observed=0;
    await assert.rejects(verifyRecoveredHostAuthority({proof,request,get:async route=>route==='commits/main'?{sha:'e'.repeat(40)}:fresh(route),observe:()=>{observed++;return boundary;}}),/superseded/);
    assert.equal(observed,0);
    assert.equal(await verifyRecoveredHostAuthority({proof,request,get:fresh,observe:()=>{observed++;return boundary;}}),boundary);
    assert.equal(observed,1);
  }
});
