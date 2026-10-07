// Synthetic metadata tests only; this does not attest an archive or SQL run.
import {test} from 'node:test';import assert from 'node:assert/strict';
import {retirementStateUnitFixture,retirementUnitHash as h} from './retirement-state-unit-fixture.mjs';
import {retirementRehearsalInput} from './retirement-rehearsal-input.mjs';
import {rehearsalInput} from './candidate-rehearsal.mjs';
import {compositionFingerprint,evidenceHash} from './validate-manifest.mjs';
function fixture(){
  const f=retirementStateUnitFixture(),manifest=structuredClone(f.executorManifest);
  const core={status:'passed',compositionFingerprint:compositionFingerprint(manifest)};
  manifest.validationEvidence[0].reportHash=evidenceHash(core);
  const candidate={status:'candidate-only',deployable:false,manifest,reports:{core},provenance:{releaseRunId:10,controlCommit:'c'.repeat(40),sourceCommit:manifest.releaseCommit,planHash:h('f'),manifestHash:evidenceHash(manifest)}};
  const capturedActive=structuredClone(f.active);capturedActive.manifest=structuredClone(manifest);capturedActive.instances=Object.fromEntries(Object.keys(manifest.components).map(key=>[key,{releaseId:manifest.releaseId,releaseCommit:manifest.releaseCommit}]));
  const files=[{path:'database.dump',category:'database',sha256:h('1'),bytes:100},{path:'active.json',category:'deployment-state',sha256:h('2'),bytes:100},{path:'artifact.cjs',category:'rules-artifact',sha256:manifest.rulesArtifactHash,bytes:100}];
  const capture={schemaVersion:1,kind:'candidate-capture',status:'captured',activeHash:evidenceHash(capturedActive),releaseManifestHash:evidenceHash(manifest),createdAt:'2026-10-07T14:00:00Z',files};
  const backup={releaseManifestHash:capture.releaseManifestHash,createdAt:capture.createdAt,migrations:manifest.migrationSet.map(row=>row.id),files:structuredClone(files),referencedArtifactHashes:[manifest.rulesArtifactHash]};
  return {candidate,rollbackActive:f.active,capturedActive,capture,captureHash:h('3'),backup};
}
test('installed capture and genuine predecessor remain separate without rewriting their source bindings',()=>{
  const f=fixture(),before=structuredClone(f),input=retirementRehearsalInput(f);
  assert.equal(input.localOnly,true);assert.equal(input.deployable,false);assert.equal(input.capturedActiveHash,evidenceHash(f.capturedActive));
  assert.equal(input.activeHash,evidenceHash(f.rollbackActive));assert.equal(input.backupHash,evidenceHash(f.backup));assert.deepEqual(f,before);
  // The ordinary production assembler still refuses this current-capture
  // diagnostic input: its required pre-release predecessor was not captured.
  assert.throws(()=>rehearsalInput(f.candidate,f.rollbackActive,f.backup),/predecessor differ/);
});
test('accepted evidence may extend a published manifest without changing its actual composition',()=>{
  const f=fixture();f.capturedActive.manifest.validationEvidence.push({gate:'image-contract',status:'passed',reportHash:h('4'),inputFingerprint:h('5'),completedAt:'2026-10-07T14:01:00Z'});
  f.capture.activeHash=evidenceHash(f.capturedActive);f.capture.releaseManifestHash=evidenceHash(f.capturedActive.manifest);f.backup.releaseManifestHash=f.capture.releaseManifestHash;
  assert.doesNotThrow(()=>retirementRehearsalInput(f));
});
for(const [name,change]of [
  ['a different installed image',f=>{f.capturedActive.manifest.components.frontend.imageDigest='example.test/frontend@'+h('9');}],
  ['a substituted core report',f=>{f.candidate.reports.core.compositionFingerprint=h('9');}],
  ['an unbound capture',f=>{f.capture.activeHash=h('9');}],
  ['a capture reinterpreted as the old release',f=>{f.capture.releaseManifestHash=evidenceHash(f.rollbackActive.manifest);}],
  ['a backup reinterpreted as the old release',f=>{f.backup.releaseManifestHash=evidenceHash(f.rollbackActive.manifest);}],
  ['a refreshed backup date',f=>{f.backup.createdAt='2026-10-07T14:02:00Z';}],
  ['a missing captured deployment state',f=>{f.capture.files=f.capture.files.filter(row=>row.category!=='deployment-state');}],
  ['a substituted source dump',f=>{f.backup.files[0].sha256=h('9');}],
  ['an unrelated schema proof',f=>{f.capturedActive.database.schemaProofHash=h('9');}],
  ['an extra current database migration',f=>{f.capturedActive.database.migrationSet.push({id:'999_other',checksum:h('9')});}],
  ['an incomplete snapshot ledger',f=>{f.backup.migrations.pop();}],
  ['a missing historical executable',f=>{f.capture.files=f.capture.files.filter(row=>row.category!=='rules-artifact');f.backup.files=f.backup.files.filter(row=>row.category!=='rules-artifact');}],
  ['missing original capture byte hash',f=>{delete f.captureHash;}],
])test('local reader input refuses '+name,()=>{const f=fixture();change(f);assert.throws(()=>retirementRehearsalInput(f));});
