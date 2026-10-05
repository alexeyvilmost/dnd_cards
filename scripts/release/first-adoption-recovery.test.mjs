import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateFirstAdoptionRecovery,loadControlRecovery,assertRecoveredInitialHistory,recoveryFields,reviewedRecoveryAttempts} from './first-adoption-recovery.mjs';
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

function chainProof(){
 const {failedDeployment,...base}=proof;
 const row={runId:37287164307,runAttempt:1,controlCommit,conclusion:'failure',mode:'adopt',stage:'pre-capture-recovery-refusal',observedAt:'2026-10-05T08:30:00.000Z',auditHash:'sha256:'+'8'.repeat(64),
  recoveryReference:{id:proof.id,proofHash:evidenceHash(proof),controlCommit}};
 return {...base,schemaVersion:2,id:`${row.runId}-1`,observedAt:row.observedAt,auditHash:row.auditHash,failedDeployments:[...reviewedRecoveryAttempts(proof),row]};
}
function controlFixture(t){
 const root=mkdtempSync(path.join(tmpdir(),'recovery-chain-'));
 t.after(()=>{assert.equal(path.dirname(root),path.resolve(tmpdir()));assert.ok(path.basename(root).startsWith('recovery-chain-'));rmSync(root,{recursive:true,force:true});});
 const directory=path.join(root,'infra','first-adoption-recoveries');mkdirSync(directory,{recursive:true});
 const save=value=>writeFileSync(path.join(directory,value.id+'.json'),JSON.stringify(value)+'\n');save(proof);
 return {root,save,original:path.join(directory,proof.id+'.json')};
}
test('schema2 loads exact trusted predecessor proof without rewriting schema1 bytes or hashes',t=>{
 const f=controlFixture(t),original=readFileSync(f.original),hash=evidenceHash(proof),chain=chainProof();f.save(chain);
 const loaded=loadControlRecovery({id:chain.id,controlRoot:f.root,controlCommit,repository});
 assert.equal(loaded.proof.schemaVersion,2);assert.equal(loaded.reference.proofHash,evidenceHash(chain));
 assert.deepEqual(readFileSync(f.original),original);assert.equal(evidenceHash(JSON.parse(original)),hash);
 for(const mutate of [p=>p.observedAt='2026-10-05T08:31:00.000Z',p=>p.auditHash='sha256:'+'9'.repeat(64),p=>p.failedDeployments[1].runId=p.failedDeployments[0].runId,p=>p.failedDeployments[1].mode='apply',p=>p.failedDeployments[1].stage='rehearsal-start-refusal',p=>p.failedDeployments[1].recoveryReference.controlCommit='e'.repeat(40)]){
  const bad=structuredClone(chain);mutate(bad);assert.throws(()=>validateFirstAdoptionRecovery(bad));
 }
 for(const mutate of [p=>p.failedDeployments[0].auditHash='sha256:'+'7'.repeat(64),p=>p.components.backend.imageId='sha256:'+'6'.repeat(64),p=>p.failedDeployments[1].recoveryReference.proofHash='sha256:'+'5'.repeat(64)]){
  const bad=structuredClone(chain);mutate(bad);f.save(bad);assert.throws(()=>loadControlRecovery({id:bad.id,controlRoot:f.root,controlCommit,repository}));
 }
});
test('complete two-failure history is accepted only by the explicit chain, never normal discovery',async()=>{
 const chain=chainProof(),second=chain.failedDeployments[1],rows=[run(proof.failedDeployment.runId),run(second.runId,{head_sha:controlCommit})];
 await assert.rejects(assertRecoveredInitialHistory(metadata(rows),{proof,now}),/unreviewed/);
 await assert.rejects(selectLatestDeployedRun(metadata(rows),{repository,now}),/recovery is required/);
 const result=await assertRecoveredInitialHistory(metadata(rows),{proof:chain,now});assert.equal(result.reviewedFailedDeployments.length,2);
 const current=run(77,{status:'in_progress',conclusion:null,head_sha:controlCommit});
 for(const boundary of ['before-capture','under-lock']){
  let observed=0;const request={runId:77,attempt:1,controlCommit},get=metadata([...rows,current]);
  assert.equal(await verifyRecoveredHostAuthority({proof:chain,request,get,observe:()=>{observed++;return boundary;}}),boundary);
  assert.equal(observed,1);await assert.rejects(verifyRecoveredHostAuthority({proof:chain,request,get:r=>r==='commits/main'?{sha:'e'.repeat(40)}:get(r),observe:()=>{observed++;}}),/superseded/);assert.equal(observed,1);
 }
 for(const extra of [run(56),run(56,{conclusion:'success'}),run(56,{status:'in_progress',conclusion:null}),run(56,{run_attempt:2})])await assert.rejects(assertRecoveredInitialHistory(metadata([...rows,extra]),{proof:chain,now}));
 for(const only of [[rows[0]],[rows[1]]])await assert.rejects(assertRecoveredInitialHistory(metadata(only),{proof:chain,now}),/absent/);
 await assert.rejects(assertRecoveredInitialHistory(metadata([rows[0],{...rows[1],run_attempt:2}]),{proof:chain,now}));
 await assertRecoveredInitialHistory(metadata([...rows,run(56,{conclusion:'success',jobConclusion:'skipped'})]),{proof:chain,now});
 const changing=metadata(rows);let freshReads=0;
 await assert.rejects(assertRecoveredInitialHistory(async route=>{const value=await changing(route);return route===`actions/runs/${rows[0].id}`&&++freshReads===2?{...value,run_attempt:2}:value;},{proof:chain,now}),/changed/);
 await assert.rejects(assertRecoveredInitialHistory(metadata(rows,{[`actions/runs/${second.runId}/jobs?filter=latest&per_page=100&page=1`]:{total_count:0,jobs:[]}}),{proof:chain,now}),/absent/);
});
test('trusted recovery file cycles are bounded before recursively following repeated proof IDs',t=>{
 const f=controlFixture(t),template=chainProof();
 const make=(first,last)=>{
  const value=structuredClone(template);value.id=`${last}-1`;value.failedDeployments[0].runId=first;value.failedDeployments[1].runId=last;value.failedDeployments[1].recoveryReference.id=`${first}-1`;return value;
 };
 const b=make(20,10),a=make(10,20);a.failedDeployments[1].recoveryReference.proofHash=evidenceHash(b);f.save(a);f.save(b);
 assert.throws(()=>loadControlRecovery({id:a.id,controlRoot:f.root,controlCommit,repository}),/cyclic or exceeds/);
 const tooLong=chainProof();tooLong.failedDeployments=Array.from({length:9},(_,i)=>({...tooLong.failedDeployments[1],runId:100+i}));assert.throws(()=>validateFirstAdoptionRecovery(tooLong),/Bounded/);
});

test('third reviewed historical replay refusal preserves the exact trusted chain and requires its report hash',async t=>{
 const f=controlFixture(t),chain=chainProof();f.save(chain);
 const row={runId:37294402253,runAttempt:1,controlCommit:'e'.repeat(40),conclusion:'failure',mode:'adopt',stage:'rehearsal-historical-replay-refusal',observedAt:'2026-10-05T10:44:53.100Z',auditHash:'sha256:'+'4'.repeat(64),rehearsalHash:'sha256:'+'5'.repeat(64),recoveryReference:{id:chain.id,proofHash:evidenceHash(chain),controlCommit:'e'.repeat(40)}};
 const third={...chain,id:row.runId+'-1',observedAt:row.observedAt,auditHash:row.auditHash,failedDeployments:[...chain.failedDeployments,row]};f.save(third);
 assert.equal(loadControlRecovery({id:third.id,controlRoot:f.root,controlCommit:'f'.repeat(40),repository}).proof.failedDeployments.length,3);
 for(const mutate of [p=>delete p.failedDeployments[2].rehearsalHash,p=>p.failedDeployments[2].stage='rehearsal-start-refusal',p=>p.failedDeployments[2].stage='duplicate-command',p=>p.failedDeployments[2].rehearsalHash='invalid',p=>p.failedDeployments[1].rehearsalHash=row.rehearsalHash]){const bad=structuredClone(third);mutate(bad);assert.throws(()=>validateFirstAdoptionRecovery(bad));}
 const rows=third.failedDeployments.map(item=>run(item.runId,{head_sha:item.controlCommit})),later=Date.parse('2026-10-05T11:00:00.000Z');
 assert.equal((await assertRecoveredInitialHistory(metadata(rows),{proof:third,now:later})).reviewedFailedDeployments.length,3);
 await assert.rejects(assertRecoveredInitialHistory(metadata(rows),{proof:chain,now:later}),/unreviewed/);await assert.rejects(selectLatestDeployedRun(metadata(rows),{repository,now:later}),/recovery is required/);
});
