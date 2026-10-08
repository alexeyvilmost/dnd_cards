import test from 'node:test';import assert from 'node:assert/strict';
import {uiFixture,h} from './ui-release-unit-fixture.mjs';
import {evidenceHash} from './validate-manifest.mjs';
import {verifySuiteReport,validateBuildPlan,requiredBuildVerificationTier} from './ci-release.mjs';
import {components} from './measure-local.mjs';
import {automaticVariables,readConvergenceBaseline,preflightAutomaticDeployment,planReconciliation,dispatchReconciliation,verifyReconciledCI} from './automatic-convergence.mjs';
import {dispatchVerifiedRelease} from './ui-release-dispatch.mjs';
import {classifyReleaseVerification} from './ui-release-policy.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createDeploymentStore} from './deploy-state.mjs';
import {retirementStateUnitFixture} from './retirement-state-unit-fixture.mjs';
import {retirementDatabaseStateFromInspection} from './retirement-state.mjs';
import {projectRetirementObservation,retirementBaselineReceipt} from './retirement-projection.mjs';
const repository='fixture/project',control='c'.repeat(40),B='b'.repeat(40),C='e'.repeat(40),at=id=>`2026-01-01T00:${String(id).padStart(2,'0')}:00Z`;
function fixture(){
  const u=uiFixture(),manifest=structuredClone(u.planning.input.previousManifest),receipt={schemaVersion:1,status:'succeeded',releaseCommit:manifest.releaseCommit,releaseId:manifest.releaseId,controlCommit:control,manifestHash:evidenceHash(manifest)};
  const run=(id,extra={})=>({id,run_attempt:1,path:'.github/workflows/deploy.yml',head_sha:control,head_branch:'main',event:'workflow_run',status:'completed',conclusion:'success',repository:{full_name:repository},head_repository:{full_name:repository},...extra});
  const deployments=[run(8)],coordinator=run(20,{path:'.github/workflows/reconcile.yml',status:'in_progress',conclusion:null,display_title:'Reconcile deployed 8/1',created_at:at(20),run_started_at:at(20)}),coordinators=[coordinator],claims=[];
  const jobs=new Map([[8,'success']]),posts=[];
  const f={u,manifest,receipt,deployments,coordinator,coordinators,claims,jobs,posts,head:B,variables:Object.fromEntries(automaticVariables.map(key=>[key,'true'])),policy:{schemaVersion:1,productionEnabled:true,autoDeployMain:true},run};
  f.get=async route=>{
    const url=new URL(route,'https://unit.invalid/');
    const paged=(rows,key)=>({total_count:rows.length,[key]:structuredClone(rows.slice((Number(url.searchParams.get('page'))-1)*100,Number(url.searchParams.get('page'))*100))});
    if(route==='commits/main')return {sha:f.head};
    if(url.pathname==='/actions/workflows/deploy.yml/runs')return paged(deployments,'workflow_runs');
    if(url.pathname==='/actions/workflows/reconcile.yml/runs')return paged(coordinators,'workflow_runs');
    const match=/^\/actions\/runs\/(\d+)(?:\/(jobs|artifacts))?$/.exec(url.pathname);assert.ok(match,route);const id=Number(match[1]);
    if(!match[2])return structuredClone([...deployments,...coordinators].find(row=>row.id===id));
    if(match[2]==='jobs')return paged([{id:id*100,run_id:id,run_attempt:1,head_sha:control,name:'deploy',status:'completed',conclusion:jobs.get(id),started_at:at(id),completed_at:at(id+1)}],'jobs');
    return paged(id===20?claims:[{id:id*1000,name:'deployed-release',expired:false,size_in_bytes:100,created_at:at(id),expires_at:'2099-01-01T00:00:00Z',workflow_run:{id,head_sha:control}}],'artifacts');
  };
  f.plan=async()=>planReconciliation({eventName:'workflow_run',event:{repository:{full_name:repository},workflow_run:deployments[0]},repository,controlCommit:control,runId:20,runAttempt:coordinator.run_attempt,
    variables:f.variables,policy:f.policy,latest:await readConvergenceBaseline(f.get,repository),manifest:f.manifest,receipt:f.receipt,retirementObservation:f.retirementObservation,get:f.get});
  f.claim=p=>claims.push({id:20000,name:p.claimName,expired:false,size_in_bytes:100,created_at:at(21),expires_at:'2099-01-01T00:00:00Z',workflow_run:{id:20,head_sha:control}});
  f.dispatch=request=>dispatchReconciliation({request,get:f.get,variables:f.variables,policy:f.policy,post:async(route,body)=>{posts.push({route,body});}});
  f.ci=request=>verifyReconciledCI({request,get:f.get,variables:f.variables,policy:f.policy,eventName:'workflow_dispatch',ref:'refs/heads/main',source:request.source,suite:'extended'});
  return f;
}
function candidateFixture(f){
  const input=structuredClone(f.u.planning.input),matrix=input.matrix.map(row=>({...row,context:components[row.name].context,dockerfile:components[row.name].dockerfile,imageRepository:`ghcr.io/${repository}/${row.name}`}));
  const config={schemaVersion:1,enabled:true,platform:'linux/amd64',baseImages:{...matrix[0].baseImages,...matrix[1].baseImages},buildkitImage:`moby/buildkit@${h('1')}`,frontendApiUrl:'',contentManifestHash:input.candidateManifest.contentManifestHash,migrationSet:[]};
  const plan={schemaVersion:1,status:'build-planned',candidate:B,controlCommit:control,releaseRunId:42,repository,config,matrix,selection:input.selection,
    verification:{id:10,sourceCommit:B,repository},verificationEvidence:verifySuiteReport(f.u.ciReport,B,{requiredTier:'core'}),previousManifest:input.previousManifest,
    baselineIdentity:{releaseId:input.previousManifest.releaseId,manifestHash:evidenceHash(input.previousManifest)}};
  plan.verificationEvidence=verifySuiteReport(f.u.ciReport,B,{requiredTier:requiredBuildVerificationTier(plan)});
  plan.planHash=evidenceHash({candidate:B,controlCommit:control,releaseRunId:42,selection:plan.selection,matrix,config,verification:plan.verificationEvidence,baselineIdentity:plan.baselineIdentity});validateBuildPlan(plan);
  const candidate={manifest:input.candidateManifest,buildPlan:plan,provenance:{schemaVersion:1,releaseRunId:42,controlCommit:control,sourceCommit:B,planHash:plan.planHash,manifestHash:evidenceHash(input.candidateManifest)}};
  return {candidate,releaseRun:{id:42,workflow:'.github/workflows/release.yml',controlCommit:control}};
}
async function preflight(f,overrides={}){return preflightAutomaticDeployment({eventName:'workflow_run',...candidateFixture(f),latest:await readConvergenceBaseline(f.get,repository),manifest:f.manifest,receipt:f.receipt,retirementObservation:f.retirementObservation,repository,get:f.get,...overrides});}

function retiredFixture(t){
  const f=fixture(),s=retirementStateUnitFixture(),root=mkdtempSync(path.join(tmpdir(),'convergence-retirement-'));
  t.after(()=>{assert.equal(path.dirname(root),path.resolve(tmpdir()));assert.ok(path.basename(root).startsWith('convergence-retirement-'));rmSync(root,{recursive:true,force:true});});
  const active={...structuredClone(s.active),database:retirementDatabaseStateFromInspection(s,s.inspection)},stamp='2026-10-06T00:00:00Z';
  const operation={schemaVersion:1,kind:'character-retirement-observation-302',releaseId:s.request.releaseId,status:'succeeded',previous:s.active,desired:active,transitionHash:evidenceHash({previous:s.active,desired:active}),createdAt:stamp,updatedAt:stamp};
  const store=createDeploymentStore(root);store.writeActive(active);store.writeOperation(operation);
  f.retirementObservation=projectRetirementObservation({store,operation,manifest:active.manifest,request:{repository,runId:8,attempt:1,controlCommit:control,sourceCommit:active.manifest.releaseCommit}});
  f.manifest=active.manifest;f.receipt=retirementBaselineReceipt(f.retirementObservation);
  return f;
}

test('recorded retirement can request fresh verification and safely supersede an older candidate',async t=>{
  const f=retiredFixture(t),p=await f.plan();assert.equal(p.status,'planned');f.claim(p);assert.equal((await f.dispatch(p.request)).status,'dispatched');assert.equal(f.posts.length,1);
  assert.equal((await preflight(f)).reason,'newer-successful-deployment');
  // A new candidate with this exact predecessor may proceed; an old one may not.
  f.u.planning.input.previousManifest=structuredClone(f.manifest);
  f.u.planning.input.candidateManifest.previousReleaseId=f.manifest.releaseId;
  for(const row of f.u.planning.input.matrix){row.operation='build';row.imageDigest=null;row.sourceCommit=B;}
  f.u.ciReport.suite='extended';
  assert.equal((await preflight(f)).status,'ready');
});

test('missing or foreign retirement proof blocks reconciliation and preflight without dispatch',async t=>{
  for(const change of [f=>delete f.retirementObservation,f=>{f.retirementObservation.deployment.runId=9;}]){
    const f=retiredFixture(t);change(f);await assert.rejects(f.plan());await assert.rejects(preflight(f));assert.equal(f.posts.length,0);
  }
});

test('A success supersedes B(old baseline) without a deploy attempt; fresh extended B is dispatched once and reaches the new predecessor',async()=>{
  const f=fixture(),old=candidateFixture(f),original=evidenceHash(old);
  assert.equal((await preflight(f,old)).status,'ready');
  // D -> A changed successfully while the immutable B(D) candidate was queued.
  f.manifest={...structuredClone(f.manifest),releaseId:'full-A',releaseCommit:'d'.repeat(40)};
  f.receipt={...f.receipt,releaseId:f.manifest.releaseId,releaseCommit:f.manifest.releaseCommit,manifestHash:evidenceHash(f.manifest)};
  const stale=await preflight(f,old);assert.equal(stale.status,'superseded');assert.equal(stale.candidateAvailable,false);
  const p=await f.plan();f.claim(p);assert.equal((await f.dispatch(p.request)).status,'dispatched');assert.equal(f.posts.length,1);
  assert.equal(f.posts[0].body.inputs.suite,'extended');assert.equal((await f.ci(p.request)).status,'verified-request');
  const fresh=candidateFixture(f);fresh.candidate.buildPlan.previousManifest=structuredClone(f.manifest);
  fresh.candidate.buildPlan.baselineIdentity={releaseId:f.manifest.releaseId,manifestHash:evidenceHash(f.manifest)};
  fresh.candidate.manifest.previousReleaseId=f.manifest.releaseId;
  const plan=fresh.candidate.buildPlan;plan.releaseRunId=43;fresh.releaseRun.id=43;plan.verification.id=11;
  plan.selection.baseline.sha=f.manifest.releaseCommit;
  plan.verificationEvidence=verifySuiteReport({...f.u.ciReport,suite:'extended'},B,{requiredTier:'core'});
  plan.planHash=evidenceHash({candidate:plan.candidate,controlCommit:plan.controlCommit,releaseRunId:plan.releaseRunId,selection:plan.selection,matrix:plan.matrix,config:plan.config,verification:plan.verificationEvidence,baselineIdentity:plan.baselineIdentity});
  fresh.candidate.manifest.releaseId=`candidate-${B.slice(0,12)}-${plan.planHash.slice(7,19)}`;
  fresh.candidate.provenance={...fresh.candidate.provenance,releaseRunId:43,planHash:plan.planHash,manifestHash:evidenceHash(fresh.candidate.manifest)};
  assert.notEqual(plan.planHash,old.candidate.buildPlan.planHash);assert.notEqual(plan.verification.id,old.candidate.buildPlan.verification.id);
  assert.equal((await preflight(f,fresh)).status,'ready');assert.equal(evidenceHash(old),original,'old published inputs remain byte-equivalent');
});
test('skipped stale deploy jobs do not poison baseline; real failed host attempts still require recovery',async()=>{
  const f=fixture();f.deployments.push(f.run(10));f.jobs.set(10,'skipped');assert.equal((await readConvergenceBaseline(f.get,repository)).id,8);
  f.jobs.set(10,'failure');await assert.rejects(f.plan(),/recovery/);assert.equal(f.posts.length,0);
});
test('C replaces B before dispatch and no obsolete verification is launched',async()=>{
  const f=fixture(),p=await f.plan();f.claim(p);f.head=C;assert.equal((await f.dispatch(p.request)).reason,'newer-main-source');assert.equal(f.posts.length,0);
  await assert.rejects(f.ci(p.request),/superseded/);assert.equal((await preflight(f)).reason,'newer-main-source');
});
test('a coordinator reads latest C if several main pushes precede successful A completion',async()=>{
  const f=fixture();f.head=C;const p=await f.plan();assert.equal(p.request.source,C);f.claim(p);await f.dispatch(p.request);assert.equal(JSON.parse(f.posts[0].body.inputs.reconcile_request).source,C);
});
test('same predecessor event duplicates and workflow reruns never resend even after a failed/unknown dispatch',async()=>{
  const f=fixture(),p=await f.plan();f.claim(p);let calls=0;
  await assert.rejects(dispatchReconciliation({request:p.request,get:f.get,variables:f.variables,policy:f.policy,post:async()=>{calls++;throw Error('connection closed after acceptance');}}),/connection/);
  assert.equal(calls,1);f.coordinator.run_attempt=2;assert.equal((await f.plan()).reason,'coordinator-rerun');
  f.coordinator.run_attempt=1;f.coordinators.push({...f.coordinator,id:19,status:'completed',conclusion:'failure',created_at:at(19)});
  assert.equal((await f.plan()).reason,'previous-coordinator');assert.equal(calls,1);
});
test('manual core CI runs cannot count as a reconciliation request or suppress a new full verification',async()=>{
  const f=fixture(),p=await f.plan();assert.equal(p.status,'planned');
  await assert.rejects(f.ci(p.request),/claim/);f.claim(p);
  for(const override of [{suite:'core'},{ref:'refs/heads/feature'},{source:C},{eventName:'push'}])await assert.rejects(verifyReconciledCI({request:p.request,get:f.get,variables:f.variables,policy:f.policy,eventName:'workflow_dispatch',ref:'refs/heads/main',source:B,suite:'extended',...override}),/full main/);
});
test('every enable variable and tracked auto policy is required, without dispatch side effects',async()=>{
  for(const key of automaticVariables){const f=fixture();f.variables[key]='false';assert.equal((await f.plan()).status,'disabled');assert.equal(f.posts.length,0);}
  const f=fixture();f.policy.autoDeployMain=false;assert.equal((await f.plan()).status,'disabled');
});
test('failed/forked/foreign/control attempt metadata and expired or missing claims fail closed',async()=>{
  for(const change of [f=>f.coordinator.head_repository.full_name='fork/repo',f=>f.coordinator.event='workflow_dispatch',f=>f.coordinator.head_sha=C,f=>f.coordinator.display_title='arbitrary']){
    const f=fixture();change(f);await assert.rejects(f.plan());
  }
  for(const change of [f=>f.claims.splice(0),f=>f.claims[0].expired=true,f=>f.claims[0].workflow_run.head_sha=C,f=>f.claims.push({...f.claims[0],id:20001}),f=>f.coordinator.run_attempt=2,
    f=>f.coordinator.run_started_at='invalid',f=>f.claims[0].created_at='2026-02-30T00:00:00Z',f=>f.claims[0].created_at=at(19)]){
    const f=fixture(),p=await f.plan();f.claim(p);change(f);await assert.rejects(f.dispatch(p.request));assert.equal(f.posts.length,0);
  }
});
test('a newer actual deployment or an explicit no-op event cannot use an earlier event as fresh authority',async()=>{
  const f=fixture(),p=await f.plan();f.claim(p);f.deployments.push(f.run(12));f.jobs.set(12,'success');
  assert.equal((await f.dispatch(p.request)).reason,'newer-actual-deployment');assert.equal(f.posts.length,0);
  assert.equal((await f.plan()).reason,'newer-actual-deployment');
  const g=fixture();g.jobs.set(8,'skipped');assert.equal((await g.plan()).reason,'newer-actual-deployment');assert.equal(g.posts.length,0);
});
test('deployed evidence corruption and candidate corruption do not turn into a benign skip',async()=>{
  const f=fixture();f.receipt.manifestHash=h('f');await assert.rejects(f.plan(),/attested/);await assert.rejects(preflight(f),/attested/);
  const g=fixture(),c=candidateFixture(g);c.candidate.buildPlan.planHash=h('f');await assert.rejects(preflight(g,c),/hash mismatch/);
});
test('unavailable known baseline is an error, while historical manual candidate compatibility remains unchanged',async()=>{
  const f=fixture(),c=candidateFixture(f);f.deployments.splice(0);
  await assert.rejects(preflight(f,{...c,manifest:undefined,receipt:undefined}),/baseline is unavailable/);
  delete c.candidate.buildPlan;assert.equal((await preflight(f,{...c,eventName:'workflow_dispatch'})).automatic,false);
});
test('latest real successful receipt already at main produces no CI',async()=>{
  const f=fixture();f.head=f.manifest.releaseCommit;assert.equal((await f.plan()).status,'converged');assert.equal(f.posts.length,0);
});
test('fresh full extended planning safely uses canonical full release; stale selective core is still rejected',async()=>{
  const f=uiFixture();let full=0,ui=0;const planning={eligibility:{kind:'full',requiredTier:'extended',reason:'selective-policy-disabled'}};
  const ciReport={...f.ciReport,suite:'extended',frontend_planning:planning};
  const opts={planning,ciReport,freshPlanning:async()=>f.planning,prepareFull:()=>{full++;return 'full';},prepareFrontend:()=>{ui++;}};
  assert.equal(await dispatchVerifiedRelease(opts),'full');assert.equal(full,1);assert.equal(ui,0);
  await assert.rejects(dispatchVerifiedRelease({...opts,ciReport:{...ciReport,suite:'core'}}));
  await assert.rejects(dispatchVerifiedRelease({...opts,ciReport:{...ciReport,checks:[]}}),/Mandatory/);
  const stale=structuredClone(f.planning);stale.input.baselineBinding.runAttempt++;stale.eligibility=classifyReleaseVerification(stale.input);
  await assert.rejects(dispatchVerifiedRelease({...opts,planning:stale,ciReport:f.ciReport,workloadPlan:f.workloadPlan}),/new frontend verification/);
});
