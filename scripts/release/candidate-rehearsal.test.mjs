import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rehearsalInput,collectRehearsal,rehearsalStages} from './candidate-rehearsal.mjs';
import {assembleDeploymentBundle} from './assemble-bundle.mjs';
import {attachUnitRehearsal} from './unit-rehearsal-fixture.mjs';
import {compositionFingerprint,evidenceHash,assertReleaseReady} from './validate-manifest.mjs';
import {migrationScenarios} from './migration-transition.mjs';
const hash=char=>`sha256:${char.repeat(64)}`;
function fixture({additive=false}={}){
  const previous={schemaVersion:1,releaseId:'previous',releaseCommit:'a'.repeat(40),previousReleaseId:null,createdAt:'2026-10-04T10:00:00Z',
    components:Object.fromEntries(['frontend','backend','rulesWorker'].map((key,i)=>[key,{sourceCommit:'a'.repeat(40),inputFingerprint:hash(String(i+1)),imageDigest:`example.test/${key.toLowerCase()}@${hash(String(i+4))}`} ])),
    rulesArtifactHash:hash('a'),contentManifestHash:hash('b'),apiProtocolVersion:1,workerProtocolVersion:1,supportedWorldSchemaVersions:[5],workerRuntime:{name:'node',version:'24.0.0'},capabilities:['pinned-artifact-routing','pending-decision-pass-through'],migrationSet:[{id:'001',checksum:hash('c')}],
    validationEvidence:[{gate:'core',status:'passed',reportHash:hash('d'),inputFingerprint:hash('e'),completedAt:'2026-10-04T10:00:00Z'}]};
  const active={schemaVersion:1,status:'active',manifest:previous,instances:Object.fromEntries(Object.keys(previous.components).map(key=>[key,{releaseId:'previous',releaseCommit:previous.releaseCommit}]))};
  const manifest=structuredClone(previous);manifest.releaseId='candidate';manifest.previousReleaseId='previous';manifest.releaseCommit='b'.repeat(40);
  if(additive)manifest.migrationSet.push(...['298_compact_command_receipts','299_frozen_combat_catalogs','300_image_jobs'].map(id=>({id,checksum:hash('e')})));
  const core={status:'passed',compositionFingerprint:compositionFingerprint(manifest)};manifest.validationEvidence[0]={...manifest.validationEvidence[0],inputFingerprint:core.compositionFingerprint,reportHash:evidenceHash(core)};
  const candidate={status:'candidate-only',deployable:false,manifest,reports:{core},provenance:{schemaVersion:1,releaseRunId:10,controlCommit:'c'.repeat(40),sourceCommit:manifest.releaseCommit,planHash:hash('f'),manifestHash:evidenceHash(manifest)}};
  const backup={migrations:['001'],releaseManifestHash:evidenceHash(previous),schemaFingerprint:hash('c'),referencedArtifactHashes:[previous.rulesArtifactHash],files:[{category:'rules-artifact',sha256:previous.rulesArtifactHash}]};
  const input=rehearsalInput(candidate,active,backup);
  const identities=Object.fromEntries(Object.entries(manifest.components).map(([key,row])=>[key,{identitySchemaVersion:1,component:key,provenance:'baked',sourceCommit:row.sourceCommit,source_commit:row.sourceCommit,inputFingerprint:row.inputFingerprint,releaseId:manifest.releaseId,releaseCommit:manifest.releaseCommit,apiProtocolVersion:1}]));
  Object.assign(identities.rulesWorker,{artifactHash:manifest.rulesArtifactHash,workerRuntime:manifest.workerRuntime,workerProtocolVersion:1,supportedWorldSchemaVersions:[5],capabilities:manifest.capabilities});
  const bundle={reports:{core,'image-contract':{},'pinned-artifacts':{}},images:Object.fromEntries(Object.entries(manifest.components).map(([key,row])=>[key,row.imageDigest])),identities,historicalArtifactHashes:input.historicalArtifactHashes};
  attachUnitRehearsal(manifest,bundle);
  const receipt=bundle.rehearsalReceipt;Object.assign(receipt,{candidateHash:input.candidateHash,activeHash:input.activeHash,backupHash:input.backupHash});
  Object.assign(receipt.checks.find(row=>row.id==='snapshot'),{backupHash:input.backupHash,schemaFingerprint:backup.schemaFingerprint});
  if(additive){
    // Unit-only protocol data. Real receipts come only from the seven executable
    // fault scenarios; their orchestration has its own fault matrix tests.
    const byId={
      'atomic-ddl-ledger':{historyHash:hash('1'),schemaProofHash:hash('2'),versions:manifest.migrationSet.map(row=>row.id).sort()},
      'crash-before-ledger':{transactionRolledBack:true,restartPassed:true,committedBaselineHash:hash('3')},
      'repeat-after-commit':{reapplied:0,schemaProofHash:hash('2'),historyHash:hash('1')},
      'same-connection-lock':{startupLockShared:true,ddlAndLedgerSessionVerified:true},
      'unknown-migration-rejected':{rejected:true,committedStateHash:hash('4')},'schema-proof':{tamperedTriggerRejected:true,noSilentRepair:true},
      'old-readers-after-expansion':{checked:true,writerFlagsOff:true,pendingHash:hash('5'),acceptedHash:hash('6'),invariantHash:hash('7')},
    };
    const report={schemaVersion:1,kind:'additive-migration-rehearsal',execution:'docker',status:'passed',candidateHash:input.candidateHash,
      candidateSourceCommit:manifest.components.backend.sourceCommit,candidateInputFingerprint:manifest.components.backend.inputFingerprint,
      baseline:previous.migrationSet,target:manifest.migrationSet,compositionFingerprint:input.compositionFingerprint,backwardCompatible:true,rollbackWriters:'off',
      scenarios:[...migrationScenarios],checks:migrationScenarios.map(id=>({id,status:'passed',...byId[id]})),cleanup:{status:'trials-cleared',remaining:0}};
    receipt.additiveMigrations={report,approval:{schemaVersion:1,mode:'additive-298-300',baseline:report.baseline,target:report.target,compositionFingerprint:report.compositionFingerprint,reportHash:evidenceHash(report)}};
  }
  return {candidate,input,receipt};
}
test('offline assembler adds only evidence to original candidate and binds actual health/cleanup receipt',()=>{
  const {candidate,input,receipt}=fixture(),before=structuredClone(candidate);
  const result=assembleDeploymentBundle(candidate,input,receipt);assertReleaseReady(result.manifest,result.bundle);assert.deepEqual(candidate,before);
  const application=manifest=>{const {validationEvidence,...rest}=manifest;return rest;};assert.deepEqual(application(result.manifest),application(candidate.manifest));
  assert.equal(result.manifest.validationEvidence.length,3);assert.equal(result.bundle.reports['image-contract'].rehearsalHash,evidenceHash(receipt));
});

test('first manifest bundle binds observed legacy IDs without inventing old build provenance or migration checksums',()=>{
 const s=fixture({additive:true}),prior=s.input.active.manifest;
 const body={schemaVersion:1,kind:'observed-legacy-baseline',status:'observed',provenance:'runtime-observation-only',deployable:false,observedAt:new Date().toISOString(),claimedReleaseCommit:prior.releaseCommit,
  components:Object.fromEntries(Object.keys(prior.components).map((key,i)=>[key,{imageId:hash(String(i+1)),containerId:String(i+1).repeat(64),configurationHash:hash('8'),healthy:true,runtimeClaim:prior.releaseCommit,imageReference:`old/${key.toLowerCase()}:old`} ])),
  rollbackConfigurationHash:hash('1'),databaseIdentityHash:hash('2'),schemaFingerprint:s.input.backup.schemaFingerprint,rulesArtifactHash:prior.rulesArtifactHash,migrationIds:['001_existing'],artifactHashes:[prior.rulesArtifactHash],historicalChecksums:'unavailable',bakedIdentity:'unavailable'};
 const active={...body,observationHash:evidenceHash(body)},manifest=s.candidate.manifest;
 manifest.previousReleaseId=null;manifest.migrationSet[0]={id:'001_existing',kind:'observed-id-only',observationHash:active.observationHash};
 s.candidate.reports.core.compositionFingerprint=compositionFingerprint(manifest);manifest.validationEvidence=manifest.validationEvidence.filter(row=>row.gate==='core').map(row=>({...row,inputFingerprint:compositionFingerprint(manifest),reportHash:evidenceHash(s.candidate.reports.core)}));s.candidate.provenance.manifestHash=evidenceHash(manifest);
 const backup={...s.input.backup,migrations:active.migrationIds,releaseManifestHash:evidenceHash(active)},input=rehearsalInput(s.candidate,active,backup),r=s.receipt;
 Object.assign(r,{candidateHash:input.candidateHash,activeHash:input.activeHash,backupHash:input.backupHash,compositionFingerprint:input.compositionFingerprint});
 Object.assign(r.checks.find(row=>row.id==='snapshot'),{backupHash:input.backupHash});r.checks.find(row=>row.id==='migrations').versions=manifest.migrationSet.map(row=>row.id).sort();
 const report=r.additiveMigrations.report;Object.assign(report,{candidateHash:input.candidateHash,baseline:active.migrationIds.map(id=>({id})),baselineObservationHash:active.observationHash,target:manifest.migrationSet,compositionFingerprint:input.compositionFingerprint});report.checks.find(row=>row.id==='atomic-ddl-ledger').versions=manifest.migrationSet.map(row=>row.id).sort();
 Object.assign(r.additiveMigrations.approval,{baseline:report.baseline,baselineObservationHash:active.observationHash,target:manifest.migrationSet,compositionFingerprint:input.compositionFingerprint,reportHash:evidenceHash(report)});
 const result=assembleDeploymentBundle(s.candidate,input,r);assert.equal(result.bundle.previousManifest,null);assert.deepEqual(result.bundle.legacyBaseline,active);assert.equal(result.bundle.migrationApproval.baseline[0].checksum,undefined);
 const wrong=structuredClone(r);wrong.additiveMigrations.report.baselineObservationHash=hash('0');assert.throws(()=>assembleDeploymentBundle(s.candidate,input,wrong));
});
test('every stage failure invokes cleanup and cannot emit a passing rehearsal',async()=>{
  for(const failureAt of ['start',...rehearsalStages]){
    const {input,receipt}=fixture();let cleaned=0,saved;
    const adapter={execution:'simulation',start:async()=>{if(failureAt==='start')throw Error('injected');},check:async id=>{if(id===failureAt)throw Error('injected');return structuredClone(receipt.checks.find(row=>row.id===id));},cleanup:async()=>{cleaned++;return {status:'stopped',errors:[]};}};
    await assert.rejects(collectRehearsal(input,adapter,{onReport:async value=>{saved=value;}}));assert.equal(cleaned,1);assert.equal(saved.status,'failed');assert.equal(saved.cleanup.status,'stopped');
  }
});
test('cleanup error invalidates successful probes and simulation cannot be assembled',async()=>{
  const {candidate,input,receipt}=fixture();let saved;
  const adapter={execution:'simulation',start:async()=>{},check:async id=>structuredClone(receipt.checks.find(row=>row.id===id)),cleanup:async()=>({status:'failed',errors:['injected']})};
  await assert.rejects(collectRehearsal(input,adapter,{onReport:async value=>{saved=value;}}));assert.equal(saved.status,'failed');
  adapter.cleanup=async()=>({status:'stopped',errors:[]});const simulated=await collectRehearsal(input,adapter);assert.throws(()=>assembleDeploymentBundle(candidate,input,simulated));
});
test('missing, stale, substituted or partial rehearsal cannot become a release bundle',()=>{
  const mutations=[r=>{r.checks.pop();},r=>{r.checks.push(r.checks[0]);},r=>{r.execution='simulation';},r=>{r.candidateHash=hash('0');},r=>{r.activeHash=hash('0');},r=>{r.backupHash=hash('0');},r=>{r.compositionFingerprint=hash('0');},r=>{r.runId='arbitrary';},r=>{r.cleanup.status='failed';},r=>{r.cleanup.errors=['leftover'];},
    r=>{r.checks[2].components.pop();},r=>{r.checks[2].canonicalCurrentArtifact=false;},r=>{r.checks[2].currentArtifactHash=hash('0');},r=>{r.checks[2].publishedPorts=1;},r=>{r.checks[3].identities.backend.provenance='unverified';},r=>{r.checks[5].commands=0;},r=>{r.checks[6].checked=false;},r=>{r.checks[7].invariantHash='missing';}];
  for(const change of mutations){const {candidate,input,receipt}=fixture();change(receipt);assert.throws(()=>assembleDeploymentBundle(candidate,input,receipt));}
});
test('candidate predecessor, backup ledger and historical executable coverage are mandatory',()=>{
  for(const change of [(c,a,b)=>{c.provenance.manifestHash=hash('0');},(c,a,b)=>{b.migrations=[];},(c,a,b)=>{b.files=[];},(c,a,b)=>{b.releaseManifestHash=hash('0');},(c,a,b)=>{c.manifest.migrationSet.push({id:'999',checksum:hash('0')});c.provenance.manifestHash=evidenceHash(c.manifest);}]){
    const {candidate,input}=fixture();change(candidate,input.active,input.backup);assert.throws(()=>rehearsalInput(candidate,input.active,input.backup));
  }
});

test('additive assembly preserves baseline backup and binds exact executed migration result',async()=>{
  const {candidate,input,receipt}=fixture({additive:true});
  assert.deepEqual(input.backup.migrations,['001']);
  const result=assembleDeploymentBundle(candidate,input,receipt);assertReleaseReady(result.manifest,result.bundle);
  assert.deepEqual(result.bundle.reports.additiveMigrations,receipt.additiveMigrations.report);
  assert.deepEqual(result.bundle.migrationApproval,receipt.additiveMigrations.approval);
  for(const mutate of [r=>{delete r.additiveMigrations;},r=>{r.additiveMigrations.report.execution='simulation';},r=>{r.additiveMigrations.report.checks.pop();},r=>{r.additiveMigrations.report.cleanup.remaining=1;},r=>{r.additiveMigrations.report.candidateHash=hash('0');},r=>{r.additiveMigrations.approval.baseline=[];}]){
    const bad=structuredClone(receipt);mutate(bad);assert.throws(()=>assembleDeploymentBundle(candidate,input,bad));
  }
  for(const mutate of [b=>{delete b.rehearsalReceipt.additiveMigrations;},b=>{b.migrationApproval.reportHash=hash('0');},b=>{b.reports.additiveMigrations.checks=[];}]){
    const bad=structuredClone(result.bundle);mutate(bad);assert.throws(()=>assertReleaseReady(result.manifest,bad));
  }
  let cleaned=false;
  const adapter={execution:'docker',start:async()=>({}),check:async()=>{throw Error('Must not start probes without migration proof');},cleanup:async()=>{cleaned=true;return {status:'stopped',errors:[]};}};
  await assert.rejects(collectRehearsal(input,adapter));assert.equal(cleaned,true);
});

test('failure diagnostics keep the private cause in memory and persist only fixed stage identifiers',async()=>{
 const {input}=fixture(),secret='PRIVATE_CANARY_DO_NOT_SERIALIZE';
 const cause=Object.assign(Error(secret),{migrationReport:{failureStage:secret,checks:[{id:secret},{id:'atomic-ddl-ledger'}],cleanup:{status:secret,remaining:secret}}});
 let saved;
 await assert.rejects(collectRehearsal(input,{execution:'simulation',start:async()=>{throw cause;},cleanup:async()=>({status:'stopped',errors:[]})},{onReport:async report=>{saved=report;}}),error=>error.cause===cause);
 assert.equal(saved.failureStage,'start');assert.deepEqual(saved.migrationFailure,{stage:'unavailable',completedScenarios:['atomic-ddl-ledger'],cleanup:'incomplete'});
 assert.ok(!JSON.stringify(saved).includes(secret));
});
