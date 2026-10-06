import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writerEnvironment,assertRuntimeWriterPolicy,assertExpansionWritersOff,assertMigrationWriterPolicy} from './writer-environment.mjs';
import {writerTraceBinding,validateWriterTrace} from './writer-traces.mjs';
import {collectWriterCompatibility} from './writer-compatibility.mjs';
import {assertReleaseReady,evidenceHash,lifecycleMigrationIdentity,compositionFingerprint} from './validate-manifest.mjs';
import {assembleDeploymentBundle} from './assemble-bundle.mjs';
import {rehearsalInput,collectRehearsal,main as rehearsalMain} from './candidate-rehearsal.mjs';
import {mkdtemp,writeFile,rm,access} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {deploymentEnvironment} from './deploy-state.mjs';
import {pair,on,off,refresh} from './writer-policy-unit-fixture.mjs';
import {unitWriterTrace,unitHostedBrowserTrace,unitWriterPublication} from './unit-writer-trace-fixture.mjs';
import {retirementStateUnitFixture} from './retirement-state-unit-fixture.mjs';
import {retirementDatabaseStateFromInspection} from './retirement-state.mjs';
import {databaseMigrationSet} from './migration-transition.mjs';
const env=policy=>Object.entries(writerEnvironment({writerPolicy:policy})).map(([k,v])=>k+'='+v);
test('runtime environment is exact, rejects duplicate flags and preserves legacy absent OFF',()=>{
  const f=pair();assert.deepEqual(Object.fromEntries(Object.entries(deploymentEnvironment(f.active)).filter(([k])=>k.startsWith('DB_')||k==='IMAGE_JOBS_ENABLED')),writerEnvironment(f.active.manifest));
  for(const policy of [on,off]){assertRuntimeWriterPolicy(env(policy),{manifest:{writerPolicy:policy}});assert.throws(()=>assertRuntimeWriterPolicy([...env(policy),'DB_COMPACT_RECEIPTS=0'],{manifest:{writerPolicy:policy}}),/Duplicate/);}
  for(const bad of [[],['DB_COMPACT_RECEIPTS=true'],env(off)])assert.throws(()=>assertRuntimeWriterPolicy(bad,{manifest:{writerPolicy:on}}));
  assertRuntimeWriterPolicy([],{manifest:{}});assertExpansionWritersOff([]);
  for(const bad of [['IMAGE_JOBS_ENABLED=1'],['IMAGE_JOBS_ENABLED=true'],['IMAGE_JOBS_ENABLED=0','IMAGE_JOBS_ENABLED=0']])assert.throws(()=>assertExpansionWritersOff(bad));
});
test('stored traces are mandatory, rehashed mutations cannot bypass semantic verification',()=>{
  for(const mutate of [
    c=>{delete c.traces;},c=>{c.traces[0].observations.pop();},c=>{c.traces[0].observations[0].reads[0].workerCallsAfter++;},c=>{c.traces[0].observations[0].storage.decodedSHA256='sha256:'+'f'.repeat(64);},
    c=>{c.traces[1].observations[0].providerAfterRetry++;},c=>{c.traces[1].observations[3].statusAfterOff='succeeded';},c=>{c.traces[2].proof.trace.observations[0].syncRequests=1;},
    c=>{c.traces[3].observations[0].after.v2Receipts=0;},c=>{c.traces[4].observations[1].backendImage=c.candidate.images.frontend;},c=>{c.traces[0].observations[0].prompt='must never enter trace';},
  ]){
    const f=pair();mutate(f.check);if(f.check.traces)f.check.outcomes=f.check.traces.map(t=>({id:t.outcomeId,status:'passed',traceHash:evidenceHash(t)}));refresh(f.candidate,f.bundle);
    assert.throws(()=>assertReleaseReady(f.candidate,f.bundle));
  }
});
test('live migration retains writer flags only for the exact approved lifecycle expansion',()=>{
 const f=pair(on,on),candidate=structuredClone(f.candidate);candidate.migrationSet.push({...lifecycleMigrationIdentity});
 const plan={previous:f.active,desired:{manifest:candidate},migration:{mode:'additive-298-300',
  approvalHash:'sha256:'+'a'.repeat(64),added:[{...lifecycleMigrationIdentity}],baseline:f.active.manifest.migrationSet,target:candidate.migrationSet}};
 assertMigrationWriterPolicy(env(on),plan);
 for(const actual of [env(off),[],[...env(on),'IMAGE_JOBS_ENABLED=1'],['DB_COMPACT_RECEIPTS=1','DB_FROZEN_CATALOGS=1','IMAGE_JOBS_ENABLED=1']])assert.throws(()=>assertMigrationWriterPolicy(actual,plan));
 for(const mutate of [
  p=>{delete p.migration.approvalHash;},p=>{p.migration.mode='no-schema-change';},
  p=>{p.migration.added=[];},p=>{p.migration.target=[];},p=>{p.migration.baseline=[];},
  p=>{p.desired.manifest.migrationSet.at(-1).checksum='sha256:'+'f'.repeat(64);},
  p=>{p.desired.manifest.writerPolicy.imageJobs=false;},
 ]){const bad=structuredClone(plan);mutate(bad);assert.throws(()=>assertMigrationWriterPolicy(env(on),bad));}
 assertMigrationWriterPolicy(env(off),{previous:f.active,desired:{manifest:f.candidate}});
 assert.throws(()=>assertMigrationWriterPolicy(env(on),{previous:f.active,desired:{manifest:f.candidate}}),/writers/);
});

test('full captured history stays OFF and every separate fixture is stopped before acceptance',()=>{
 for(const mutate of [
  f=>delete f.bundle.rehearsalReceipt.checks.find(r=>r.id==='full-candidate-health').historyWriterPolicy,
  f=>f.bundle.rehearsalReceipt.checks.find(r=>r.id==='full-candidate-health').historyWriterPolicy.imageJobs=true,
  f=>delete f.check.formatScope,f=>delete f.check.formatFixtureCleanup,
  f=>f.check.formatFixtureCleanup.status='failed',f=>f.check.formatFixtureCleanup.executions--,
 ]){const f=pair();mutate(f);f.bundle.reports['image-contract'].health=structuredClone(f.bundle.rehearsalReceipt.checks.find(r=>r.id==='full-candidate-health'));refresh(f.candidate,f.bundle);assert.throws(()=>assertReleaseReady(f.candidate,f.bundle));}
});
test('owned invalid-version fault must prove database rejection and exact restored schema for both receipt families',()=>{
  for(const mutate of [
    trace=>{delete trace.schemaFaults;},
    trace=>{trace.schemaFaults.pop();},
    trace=>{trace.schemaFaults[0].restored=false;},
    trace=>{trace.schemaFaults[0].constraintRejected=false;},
    trace=>{trace.schemaFaults[0].definitionHash='not-a-hash';},
    trace=>{trace.schemaFaults[0].constraintName='unrelated_constraint';},
    trace=>{trace.schemaFaults[0].definition='private raw SQL must not enter receipt';},
    trace=>{delete trace.triggerFaults;},
    trace=>{trace.triggerFaults[0].restored=false;},
    trace=>{trace.triggerFaults[0].scope='all-tables';},
    trace=>{trace.triggerFaults[0].mutationRejected=false;},
  ]){
    const f=pair();mutate(f.check.traces[0]);
    f.check.outcomes=f.check.traces.map(trace=>({id:trace.outcomeId,status:'passed',traceHash:evidenceHash(trace)}));refresh(f.candidate,f.bundle);
    assert.throws(()=>assertReleaseReady(f.candidate,f.bundle));
  }
});
function collectorFixture(f=pair()){
  const input={manifest:f.candidate,previousManifest:f.active.manifest,active:f.active,activeHash:evidenceHash(f.active),backupHash:f.bundle.rehearsalReceipt.backupHash,publishedCandidate:f.check.writerPublication,verifiedReleaseRun:f.check.writerPublication.verifiedReleaseRun};let restored=0,called=0;
  const io={retainedHistory:async()=>structuredClone(f.check.retainedHistory),observeCandidate:async()=>({...f.check.candidate,environment:env(on),executionProfile:f.check.executionProfile.candidate}),observePrevious:async()=>({...f.check.previous,environment:env(off),executionProfile:f.check.executionProfile.previous}),assertOwnedImages:async()=>{},restoreCandidateAndObserve:async()=>{restored++;return {...f.check.candidate,environment:env(on),executionProfile:f.check.executionProfile.candidate};},
    drivers:Object.fromEntries(f.check.outcomes.map(({id})=>[id,async binding=>{called++;return id==='frontend-pending-job-reload'?unitHostedBrowserTrace(binding,f.check.writerPublication):unitWriterTrace(id,binding);}]))};
  return {f,input,io,counts:()=>({restored,called})};
}
test('producer preflights every executable outcome and exact readers before any mutation',async()=>{
  const t=collectorFixture();delete t.io.drivers['expanded-data-dump-restore'];
  await assert.rejects(collectWriterCompatibility(t.input,t.io,{runId:t.f.bundle.rehearsalReceipt.runId}),e=>e.code==='WRITER_PROBE_UNAVAILABLE');assert.deepEqual(t.counts(),{called:0,restored:0});
  const wrong=collectorFixture();wrong.io.observePrevious=async()=>({...wrong.f.check.previous,identities:{...wrong.f.check.previous.identities,backend:{...wrong.f.check.previous.identities.backend,readerCapabilities:[]}},environment:env(off)});
  await assert.rejects(collectWriterCompatibility(wrong.input,wrong.io,{runId:wrong.f.bundle.rehearsalReceipt.runId}));assert.equal(wrong.counts().called,0);
});
test('producer validates each actual observation contract and fails when candidate restoration fails',async()=>{
  const t=collectorFixture(),result=await collectWriterCompatibility(t.input,t.io,{runId:t.f.bundle.rehearsalReceipt.runId});assert.equal(result.traces.length,5);assert.equal(t.counts().restored,1);
  for(const fault of ['trace','restore']){
    const bad=collectorFixture();if(fault==='trace')bad.io.drivers['compact-receipt-cross-image-retry']=async()=>({status:'passed'});else bad.io.restoreCandidateAndObserve=async()=>{throw Error('cleanup');};
    await assert.rejects(collectWriterCompatibility(bad.input,bad.io,{runId:bad.f.bundle.rehearsalReceipt.runId}));
  }
});
test('producer rejects missing actual preview and changed restored runtime settings despite identical images',async()=>{
 const missing=collectorFixture();missing.io.observeCandidate=async()=>({...missing.f.check.candidate,environment:env(on)});
 await assert.rejects(collectWriterCompatibility(missing.input,missing.io,{runId:missing.f.bundle.rehearsalReceipt.runId}));assert.equal(missing.counts().called,0);
 const drift=collectorFixture();drift.io.restoreCandidateAndObserve=async()=>{const value={...structuredClone(drift.f.check.candidate),environment:env(on),executionProfile:structuredClone(drift.f.check.executionProfile.candidate)};value.executionProfile.backend.environment.RULES_WORKER_MAX_INFLIGHT='5';return value;};
 await assert.rejects(collectWriterCompatibility(drift.input,drift.io,{runId:drift.f.bundle.rehearsalReceipt.runId}),/restore candidate runtime profile/);
});
function assemblyFixture(f=pair()){
  const manifest=structuredClone(f.candidate);manifest.validationEvidence=manifest.validationEvidence.filter(row=>row.gate==='core');
  const publication=unitWriterPublication(manifest),candidate={status:'candidate-only',deployable:false,manifest,reports:{core:f.bundle.reports.core},provenance:publication.provenance};
  const backup={migrations:databaseMigrationSet(f.active).map(r=>r.id),releaseManifestHash:evidenceHash(f.active.manifest),schemaFingerprint:'sha256:'+'b'.repeat(64),referencedArtifactHashes:[manifest.rulesArtifactHash],files:[{category:'rules-artifact',sha256:manifest.rulesArtifactHash}]};
  const input=rehearsalInput(candidate,f.active,backup),receipt=structuredClone(f.bundle.rehearsalReceipt);
  input.verifiedReleaseRun=publication.verifiedReleaseRun;
  const writer=receipt.checks.find(r=>r.id==='writer-compatibility');writer.writerPublication=publication;
  const index=writer.traces.findIndex(t=>t.outcomeId==='frontend-pending-job-reload');
  writer.traces[index]=unitHostedBrowserTrace(writerTraceBinding(manifest,writer,receipt),publication);
  writer.outcomes[index].traceHash=evidenceHash(writer.traces[index]);
  Object.assign(receipt,{candidateHash:input.candidateHash,backupHash:input.backupHash});receipt.checks.find(r=>r.id==='writer-compatibility').retainedHistory.closure.backupHash=input.backupHash;Object.assign(receipt.checks[0],{backupHash:input.backupHash,schemaFingerprint:backup.schemaFingerprint});
  return {candidate,input,receipt};
}

test('retired baseline reaches the writer collector and final bundle without weakening cross-image probes',async()=>{
 // Protocol-only fabricated drivers. No new Docker or production claim.
 const s=retirementStateUnitFixture(),active={...s.active,database:retirementDatabaseStateFromInspection(s,s.inspection)},f=pair(on,off,on,active);
 f.candidate.migrationSet=structuredClone(active.database.migrationSet);const fp=compositionFingerprint(f.candidate);
 f.bundle.rehearsalReceipt.compositionFingerprint=fp;f.bundle.rehearsalReceipt.checks.find(r=>r.id==='migrations').versions=f.candidate.migrationSet.map(r=>r.id).sort();f.check.compositionFingerprint=fp;
 f.check.writerPublication=unitWriterPublication(f.candidate);
 f.check.traces=f.check.outcomes.map(({id})=>{const binding=writerTraceBinding(f.candidate,f.check,f.bundle.rehearsalReceipt);return id==='frontend-pending-job-reload'?unitHostedBrowserTrace(binding,f.check.writerPublication):unitWriterTrace(id,binding);});
 f.check.outcomes=f.check.traces.map(trace=>({id:trace.outcomeId,status:'passed',traceHash:evidenceHash(trace)}));refresh(f.candidate,f.bundle);
 const collected=collectorFixture(f);assert.equal((await collectWriterCompatibility(collected.input,collected.io,{runId:f.bundle.rehearsalReceipt.runId})).traces.length,5);assert.equal(collected.counts().restored,1);
 const a=assemblyFixture(f),input=a.input,receipt=a.receipt;
 const adapter={execution:'docker',start:async()=>{},check:async id=>structuredClone(receipt.checks.find(row=>row.id===id)),cleanup:async()=>({status:'stopped',errors:[]})};
 const result=assembleDeploymentBundle(a.candidate,input,await collectRehearsal(input,adapter,{runId:receipt.runId}));
 assert.deepEqual(result.bundle.retirementActive,f.active);assert.deepEqual(result.bundle.previousManifest,f.active.manifest);assert.notDeepEqual(result.manifest.migrationSet,result.bundle.previousManifest.migrationSet);assertReleaseReady(result.manifest,result.bundle);
 const forged=structuredClone(result.bundle);forged.retirementActive.database.approvalHash='sha256:'+'0'.repeat(64);assert.throws(()=>assertReleaseReady(result.manifest,forged));
});

test('writer CLI consumes independently refreshed host metadata before config, backup or Docker',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'writer-fresh-publication-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const f=assemblyFixture(),fresh=path.join(directory,'fresh-run.json'),output=path.join(directory,'must-not-exist');
  await writeFile(path.join(directory,'candidate.json'),JSON.stringify(f.candidate));
  // A valid transferred publication is deliberately present: it must not be a fallback.
  await writeFile(path.join(directory,'verified-release-run.json'),JSON.stringify(f.input.verifiedReleaseRun));
  const args=['run',directory,path.join(directory,'missing-config.json'),output];
  await assert.rejects(rehearsalMain(args),/independently refreshed release metadata/);
  await assert.rejects(rehearsalMain([...args,'verified-release-run.json']),/independently refreshed release metadata/);
  await writeFile(fresh,JSON.stringify({...f.input.verifiedReleaseRun,conclusion:'failure'}));
  await assert.rejects(rehearsalMain([...args,fresh]),error=>error.code!=='ENOENT');
  await writeFile(fresh,JSON.stringify(f.input.verifiedReleaseRun));
  // Only a verified fresh record allows the next (configuration) boundary to run.
  await assert.rejects(rehearsalMain([...args,fresh]),error=>error.code==='ENOENT'&&error.path===args[2]);
  await assert.rejects(access(output),{code:'ENOENT'});
});
test('nine-stage collector and offline assembler preserve full traces; absent-policy eight-stage tests remain unchanged',async()=>{
  const f=assemblyFixture();const adapter={execution:'docker',start:async()=>{},check:async id=>structuredClone(f.receipt.checks.find(row=>row.id===id)),cleanup:async()=>({status:'stopped',errors:[]})};
  // Fabricated adapter unit test only; no report is published as actual Docker.
  const receipt=await collectRehearsal(f.input,adapter,{runId:f.receipt.runId});const result=assembleDeploymentBundle(f.candidate,f.input,receipt);
  assert.equal(result.bundle.rehearsalReceipt.checks.at(-1).traces.length,5);assertReleaseReady(result.manifest,result.bundle);
  let saved;adapter.check=async id=>{const check=structuredClone(f.receipt.checks.find(r=>r.id===id));if(id==='writer-compatibility')delete check.traces;return check;};
  await assert.rejects(collectRehearsal(f.input,adapter,{runId:f.receipt.runId,onReport:async report=>{saved=report;}}));assert.equal(saved.status,'failed');assert.equal(saved.cleanup.status,'stopped');
});
