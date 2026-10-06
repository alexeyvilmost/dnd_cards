import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';
import {assertFrontendOnlyReleaseReady,verifyOriginalFullAnchor} from './ui-release-receipt.mjs';
import {collectImmutableClosure,assertImmutablePreservation,assertUnchangedRunningRuntime} from './ui-preservation.mjs';
import {verifyRecoverabilityBaseline,verifyDeploymentBackup,checksum} from './backup-manifest.mjs';
import {assertReleaseReady,evidenceHash} from './validate-manifest.mjs';
import {uiFixture,h} from './ui-release-unit-fixture.mjs';
const verify=f=>assertFrontendOnlyReleaseReady(f.manifest,f.bundle,f);
function directory(t){const dir=mkdtempSync(path.join(tmpdir(),'ui-release-draft-'));t.after(()=>{assert.equal(path.dirname(dir),path.resolve(tmpdir()));assert.ok(path.basename(dir).startsWith('ui-release-draft-'));rmSync(dir,{recursive:true,force:true});});return dir;}

test('typed selective contract retains original full history/date and old component launch identities',()=>{
  const f=uiFixture();assert.equal(verify(f).kind,'frontend-only');
  assert.equal(f.bundle.identities.backend.releaseId,'full-origin');assert.equal(f.bundle.identities.frontend.releaseId,'ui-new');
  assert.equal(f.bundle.rehearsalReceipt.history.disposition,'reused');
  assert.equal(f.bundle.rehearsalReceipt.databaseReferenceInventory,'not_executed');
  // Deployment wiring is deliberately absent: old full gates still reject it.
  assert.throws(()=>assertReleaseReady(f.manifest,f.bundle));
});
test('no local/simulation/unknown receipt, failed cleanup or fake fullscan can pass selective gate',()=>{
  for(const mutate of [f=>{f.bundle.rehearsalReceipt.localOnly=true;},f=>{f.bundle.rehearsalReceipt.simulation=true;},f=>{f.bundle.rehearsalReceipt.kind='candidate-rehearsal';},f=>{f.bundle.rehearsalReceipt.execution='native';},f=>{f.bundle.rehearsalReceipt.cleanup.status='failed';},f=>{f.bundle.rehearsalReceipt.currentDatabaseSnapshot=true;},f=>{f.bundle.rehearsalReceipt.databaseReferenceInventory='passed';},f=>{f.bundle.rehearsalReceipt.currentDatabaseReferenceCoverage='complete';},f=>{f.bundle.rehearsalReceipt.checks[3].disposition='reused';},f=>{f.bundle.rehearsalReceipt.checks.pop();}]){
    const f=uiFixture();mutate(f);assert.throws(()=>verify(f));
  }
});
test('full anchor cannot be a reuse chain or acquire a new history date/count/hash',()=>{
  for(const mutate of [f=>{f.originalAnchor.bundle.rehearsalReceipt.kind='frontend-selective-rehearsal';},f=>{f.originalAnchor.bundle.localOnly=true;},f=>{f.bundle.rehearsalReceipt.history.originalCompletedAt=f.manifest.createdAt;},f=>{f.bundle.rehearsalReceipt.history.originalReport.commands=900;},f=>{f.bundle.rehearsalReceipt.anchor.backupCreatedAt=f.manifest.createdAt;},f=>{f.recovery.restoreReportHash=h('0');}]){
    const f=uiFixture();mutate(f);assert.throws(()=>verify(f));
  }
});
test('OCI observation and rollback cannot replace backend/worker or advance their launch IDs',()=>{
  for(const mutate of [f=>{f.bundle.identities.backend.releaseId='ui-new';},f=>{f.bundle.images.rulesWorker='example.test/other@'+h('1');},f=>{f.bundle.rehearsalReceipt.runtimeAfter.backend.containerId='f'.repeat(64);},f=>{f.bundle.rehearsalReceipt.runtimeAfterRollback.rulesWorker.mountsHash=h('0');},f=>{f.bundle.rehearsalReceipt.checks.find(c=>c.id==='frontend-rollback').changedComponents.push('backend');},f=>{f.bundle.rehearsalReceipt.checks.find(c=>c.id==='frontend-rollback').previousDigest=f.manifest.components.frontend.imageDigest;}]){
    const f=uiFixture();mutate(f);assert.throws(()=>verify(f));
  }
});
test('readonly closure preserves preexisting and concurrent new files; deletion/overwrite/redirect fails',t=>{
  const dir=directory(t),store=path.join(dir,'artifacts');mkdirSync(store);writeFileSync(path.join(store,'old.cjs'),'old CJS');
  const before=collectImmutableClosure({artifacts:store});const original=readFileSync(path.join(store,'old.cjs'));
  writeFileSync(path.join(store,'new.cjs'),'concurrent new CJS');const after=collectImmutableClosure({artifacts:store});
  assert.equal(assertImmutablePreservation(before,after).concurrentAdditions,1);assert.deepEqual(readFileSync(path.join(store,'old.cjs')),original);
  writeFileSync(path.join(store,'old.cjs'),'changed');assert.throws(()=>assertImmutablePreservation(before,collectImmutableClosure({artifacts:store})),/changed/);
  rmSync(path.join(store,'old.cjs'));assert.throws(()=>assertImmutablePreservation(before,collectImmutableClosure({artifacts:store})),/disappeared/);
  const alias=path.join(dir,'redirect');symlinkSync(store,alias,process.platform==='win32'?'junction':'dir');
  assert.throws(()=>collectImmutableClosure({artifacts:alias}),/Redirected/);
});
test('typed receipt rejects missing after-set and changed running database/config binding',()=>{
  const f=uiFixture();f.bundle.rehearsalReceipt.filesAfter.files=[];assert.throws(()=>verify(f),/disappeared/);
  const g=uiFixture(),after=structuredClone(g.protectedRunning);after.backend.databaseBindingHash=h('0');assert.throws(()=>assertUnchangedRunningRuntime(g.protectedRunning,after),/changed/);
  after.backend.databaseBindingHash=h('d');after.backend.configurationHash=h('0');assert.throws(()=>assertUnchangedRunningRuntime(g.protectedRunning,after),/changed/);
  const missing=uiFixture();for(const key of ['filesBefore','filesAfter','filesAfterRollback'])missing.bundle.rehearsalReceipt[key].files=[];
  assert.throws(()=>verify(missing),/disappeared/);
});
test('aged original backup is integrity-checked without fresh snapshot claim; full path stays fresh',async t=>{
  const dir=directory(t),original={releaseId:'old-backed-up'},files=[];
  for(const [name,category,data] of [['database.dump','database','owned unit bytes'],['old.cjs','rules-artifact','module.exports={}'],['media.json','media-manifest','[]'],['release.json','release-manifest',JSON.stringify(original)]]){
    writeFileSync(path.join(dir,name),data);files.push({path:name,category,sha256:await checksum(path.join(dir,name)),bytes:Buffer.byteLength(data)});
  }
  const manifest={schemaVersion:1,kind:'release-backup',status:'captured',createdAt:'2026-01-01T00:00:00.000Z',schemaFingerprint:h('a'),files,
    artifactInventoryComplete:true,referencedArtifactHashes:[files[1].sha256],releaseManifestHash:evidenceHash(original)};
  const restore={status:'passed',backupHash:evidenceHash(manifest),schemaFingerprint:h('a'),scope:'accepted-deployment-recovery',checks:['snapshot','artifacts','migrations','pending-decision','duplicate-command','media-references'].map(id=>({id,status:'passed'}))};
  writeFileSync(path.join(dir,'backup.json'),JSON.stringify(manifest));writeFileSync(path.join(dir,'restore-report.json'),JSON.stringify(restore));
  const options={restoreReportHash:evidenceHash(restore),now:Date.parse('2026-10-05T00:00:00Z')};
  const proof=await verifyRecoverabilityBaseline(dir,original,options);assert.equal(proof.currentDatabaseSnapshot,false);assert.equal(proof.originalBackupCreatedAt,manifest.createdAt);
  await assert.rejects(verifyDeploymentBackup(dir,original,{now:options.now}),/Fresh backup/);
  await assert.rejects(verifyRecoverabilityBaseline(dir,original,{...options,restoreReportHash:h('0')}),/changed/);
  writeFileSync(path.join(dir,'database.dump'),'corrupt');await assert.rejects(verifyRecoverabilityBaseline(dir,original,options),/corrupt/);
});
