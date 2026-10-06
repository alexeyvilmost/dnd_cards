// Unit-only fabricated observations: these never authorize OCI or deployment.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateManifest,writerPolicy,validateWriterTransition,lifecycleWriterExpansion,lifecycleMigrationIdentity,compositionFingerprint,evidenceHash,assertReleaseReady,writerCompatibilityOutcomes} from './validate-manifest.mjs';
import {planDeployment} from './deploy-state.mjs';
import {attachUnitRehearsal} from './unit-rehearsal-fixture.mjs';
import {unitWriterTrace} from './unit-writer-trace-fixture.mjs';
import {writerTraceBinding} from './writer-traces.mjs';
import {pair,off,on,manifest,refresh,hash} from './writer-policy-unit-fixture.mjs';
test('absent policy preserves historical fingerprint, eight-stage receipt and manifest bytes',()=>{
 const f=pair(off);delete f.candidate.writerPolicy;f.bundle.rehearsalReceipt.checks.pop();f.bundle.rehearsalReceipt.compositionFingerprint=compositionFingerprint(f.candidate);refresh(f.candidate,f.bundle);
 const bytes=JSON.stringify(f.candidate);
 // Captured by the unmodified predecessor validator, not this implementation.
 assert.equal(compositionFingerprint(f.candidate),'sha256:3e6091d9c6f86108773efa1863d8027d246f7640dc4b801b520a3b48a5e83ae8');
 assert.deepEqual(writerPolicy(f.candidate),off);assertReleaseReady(f.candidate,f.bundle);
 assert.equal(JSON.stringify(f.candidate),bytes);assert.equal(f.bundle.rehearsalReceipt.checks.length,8);
});
test('explicit policy is exact, fingerprinted and rejects unknown fields, types or frozen ON',()=>{
 const old=manifest(),explicit={...old,writerPolicy:off};assert.notEqual(compositionFingerprint(explicit),compositionFingerprint(old));
 for(const policy of [null,true,{}, {...off,imageJobs:'true'},{...off,frozenCatalogs:true},{...off,other:false}])assert.throws(()=>validateManifest({...old,writerPolicy:policy}));
 assert.deepEqual(writerPolicy(explicit),off);const clone=writerPolicy(explicit);clone.imageJobs=true;assert.equal(explicit.writerPolicy.imageJobs,false);
});
test('enabled policy rejects legacy adoption, schema changes and missing exact additive identities',()=>{
 const f=pair();assert.throws(()=>validateWriterTransition({...f.candidate,previousReleaseId:null},null),/legacy adoption/);
 for(const mutate of [m=>{m.migrationSet.pop();},m=>{m.migrationSet[0].checksum=hash('e');},m=>{m.supportedWorldSchemaVersions=[6];}]){
  const candidate=structuredClone(f.candidate);mutate(candidate);assert.throws(()=>validateWriterTransition(candidate,f.active.manifest),/same schema/);
 }
 for(const id of ['298_compact_command_receipts','300_image_jobs']){const candidate=structuredClone(f.candidate),previous=structuredClone(f.active.manifest);candidate.migrationSet=candidate.migrationSet.filter(row=>row.id!==id);previous.migrationSet=structuredClone(candidate.migrationSet);assert.throws(()=>validateWriterTransition(candidate,previous),/298\/300/);}
});
test('new policy cannot reuse a historical eight-stage OFF receipt',()=>{
 const f=pair();f.bundle.rehearsalReceipt.checks.pop();refresh(f.candidate,f.bundle);assert.throws(()=>assertReleaseReady(f.candidate,f.bundle),/rehearsal/);
});
test('only the exact lifecycle expansion can retain enabled writers, never approves deployment without fresh proofs',()=>{
 const f=pair(on,on),candidate=structuredClone(f.candidate),previous=f.active.manifest;
 candidate.migrationSet.push({...lifecycleMigrationIdentity});
 assert.equal(lifecycleWriterExpansion(candidate,previous),true);
 assert.deepEqual(validateWriterTransition(candidate,previous),on);
 assert.throws(()=>planDeployment(candidate,f.bundle,f.active),/evidence|rehearsal|fingerprint/i);
 for(const mutate of [
  m=>{m.migrationSet.at(-1).checksum=hash('f');},
  m=>{m.migrationSet.at(-1).id='302_unreviewed';},
  m=>{m.migrationSet.push({id:'302_unreviewed',checksum:hash('f')});},
  m=>{m.migrationSet[0].checksum=hash('f');},
  m=>{m.writerPolicy.imageJobs=false;},
  m=>{m.supportedWorldSchemaVersions=[6];},
 ]){const bad=structuredClone(candidate);mutate(bad);assert.throws(()=>validateWriterTransition(bad,previous));}
 const offPrior={...previous,writerPolicy:off};assert.equal(lifecycleWriterExpansion(candidate,offPrior),false);
 const changedBoth=structuredClone(previous);changedBoth.migrationSet.push({...lifecycleMigrationIdentity});
 assert.equal(lifecycleWriterExpansion(candidate,changedBoth),false);
});
test('new policy binds complete actual candidate and previous image/launch observations',()=>{
 const f=pair();assertReleaseReady(f.candidate,f.bundle);
 for(const mutate of [f=>{f.check.previous.identities.backend.inputFingerprint=hash('f');},f=>{f.check.previous.images.backend='other@'+hash('a');},f=>{f.check.previous.identities.frontend.releaseId='wrong';},f=>{f.check.previous.state.instances.backend.releaseId='wrong';},f=>{f.check.candidate.identities.backend.readerCapabilities=[];},f=>{f.check.writerPolicy.imageJobs=false;},f=>{f.check.compositionFingerprint=hash('e');},f=>{f.check.outcomes.pop();},f=>{f.check.outcomes[0].traceHash='unbound';}]){
  const bad=pair();mutate(bad);refresh(bad.candidate,bad.bundle);assert.throws(()=>assertReleaseReady(bad.candidate,bad.bundle));
 }
});
test('missing, malformed and dropped readers fail even when OFF',()=>{
 for(const mutate of [f=>{delete f.check.previous.identities.backend.readerCapabilities;},f=>{f.check.previous.identities.backend.readerCapabilities=null;},f=>{f.check.previous.identities.backend.readerCapabilities=['receipt-v1','receipt-v1'];},f=>{f.bundle.identities.frontend.readerCapabilities=[];f.check.candidate.identities=structuredClone(f.bundle.identities);f.bundle.rehearsalReceipt.checks.find(row=>row.id==='image-contract').identities=structuredClone(f.bundle.identities);}]){
  const bad=pair(off,on);mutate(bad);refresh(bad.candidate,bad.bundle);assert.throws(()=>assertReleaseReady(bad.candidate,bad.bundle));
 }
 const bad=pair(off,off);bad.check.previous.identities.backend.readerCapabilities.push('future-reader-v1');refresh(bad.candidate,bad.bundle);assert.throws(()=>assertReleaseReady(bad.candidate,bad.bundle),/cannot be removed/);
});
test('explicit OFF descendants cannot drop the policy contract',()=>{
 const f=pair(off,off);delete f.candidate.writerPolicy;assert.throws(()=>validateWriterTransition(f.candidate,f.active.manifest),/cannot disappear/);
});
test('policy-only ON and OFF replacements restart only backend and preserve other launch identities',()=>{
 for(const [policy,prior] of [[on,off],[off,on]]){
  const f=pair(policy,prior),plan=planDeployment(f.candidate,f.bundle,f.active);
  assert.deepEqual(plan.changed,['backend']);assert.deepEqual(plan.desired.instances.backend,{releaseId:'next',releaseCommit:'b'.repeat(40)});
  assert.deepEqual(plan.desired.instances.frontend,f.active.instances.frontend);assert.deepEqual(plan.desired.instances.rulesWorker,f.active.instances.rulesWorker);
  assert.deepEqual(plan.previous,f.active);assert.deepEqual(plan.desired.manifest.components,f.active.manifest.components);
 }
});
test('absent OFF to explicit OFF adds evidence but does not restart an unchanged backend',()=>{
 const f=pair(off);assert.deepEqual(planDeployment(f.candidate,f.bundle,f.active).changed,[]);
});
test('single writer policy requires its own cross-image outcomes plus restore and rollback',()=>{
 for(const policy of [{...off,compactReceipts:true},{...off,imageJobs:true}]){
  const f=pair(policy,off,policy);assertReleaseReady(f.candidate,f.bundle);
  f.check.outcomes.pop();refresh(f.candidate,f.bundle);assert.throws(()=>assertReleaseReady(f.candidate,f.bundle),/outcomes required/);
 }
});
test('ON to OFF to OFF still requires proofs for formats retained in the verified reader lineage',()=>{
 const first=pair(off,on);assertReleaseReady(first.candidate,first.bundle);
 const active=planDeployment(first.candidate,first.bundle,first.active).desired;
 const second=pair(off,undefined,on,active);
 assert.deepEqual(second.candidate.writerPolicy,off);assert.deepEqual(second.bundle.previousManifest.writerPolicy,off);
 second.check.outcomes=[];refresh(second.candidate,second.bundle);
 assert.throws(()=>assertReleaseReady(second.candidate,second.bundle),/outcomes required/);
 second.check.outcomes=second.check.traces.map(trace=>({id:trace.outcomeId,status:'passed',traceHash:evidenceHash(trace)}));refresh(second.candidate,second.bundle);
 assertReleaseReady(second.candidate,second.bundle);
 second.check.outcomes[0].status='failed';refresh(second.candidate,second.bundle);
 assert.throws(()=>assertReleaseReady(second.candidate,second.bundle),/outcomes required/);
});
