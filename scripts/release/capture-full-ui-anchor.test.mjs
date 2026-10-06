import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync,existsSync} from 'node:fs';import path from 'node:path';import {tmpdir} from 'node:os';
import {fixture,recordsFor,publishedFor} from './ui-planning-unit-fixture.mjs';
import {assembleCandidateManifest} from './ci-release.mjs';import {attachUnitRehearsal} from './unit-rehearsal-fixture.mjs';
import {evidenceHash,compositionFingerprint} from './validate-manifest.mjs';import {createDeploymentStore} from './deploy-state.mjs';
import {checksum} from './backup-manifest.mjs';import {capturePostDeploymentAnchor} from './capture-full-ui-anchor.mjs';import {uiFixture,h} from './ui-release-unit-fixture.mjs';

import {anchorUnitFixture as setup} from './ui-anchor-unit-fixture.mjs';
test('post-success anchor preserves original proof dates and writes only a new immutable observation',async t=>{
  const f=await setup(t),priorActive=readFileSync(path.join(f.config.root,'active.json')),priorOperation=readFileSync(path.join(f.config.root,'operations',f.manifest.releaseId+'.json'));
  const result=await capturePostDeploymentAnchor(f),doc=JSON.parse(readFileSync(result.anchorFile));
  assert.equal(result.status,'captured-after-success');assert.equal(f.observations(),2);assert.equal(doc.originalRehearsalCompletedAt,f.bundle.rehearsalReceipt.completedAt);
  assert.equal(doc.recovery.originalBackupCreatedAt,'2026-01-01T00:00:00Z');assert.equal(doc.currentDatabaseSnapshot,false);assert.equal(doc.databaseReferenceInventory,'not_executed');
  assert.equal(doc.buildPlanHash,f.buildPlan.planHash);assert.equal(doc.schemaScope,'original-full-rehearsal-snapshot');assert.equal(doc.binding.filesystemHash,evidenceHash(doc.anchor.files));
  assert.deepEqual(readFileSync(path.join(f.config.root,'active.json')),priorActive);assert.deepEqual(readFileSync(path.join(f.config.root,'operations',f.manifest.releaseId+'.json')),priorOperation);
  assert.equal(existsSync(path.join(f.config.root,'deploy.lock')),false);assert.equal(readdirSync(path.join(f.config.root,'full-anchors')).length,1);
});
test('anchor refuses pending/failed/foreign deployment, mutated plan or redirected provenance before observation',async t=>{
  for(const change of [f=>{f.candidate.provenance.planHash=h('0');},f=>{f.buildPlan.matrix[0].sourceCommit='f'.repeat(40);},f=>{const op=f.store.operation(f.manifest.releaseId);op.status='recovery_required';f.store.writeOperation(op);},f=>{f.store.writeOperation({releaseId:'other',status:'preparing'});},f=>{f.candidate.manifest.contentManifestHash=h('0');}]){
    const f=await setup(t);change(f);await assert.rejects(capturePostDeploymentAnchor(f));assert.equal(f.observations(),0);assert.equal(existsSync(path.join(f.config.root,'full-anchors')),false);assert.equal(existsSync(path.join(f.config.root,'deploy.lock')),false);
  }
});
test('anchor fails closed on between-observation runtime/file/config drift and on corrupt old backup',async t=>{
  for(const change of [o=>{o.protectedRuntime.backend.containerId='f'.repeat(64);},o=>{o.files.files=[];},o=>{o.routingSecurityHash=h('0');}]){
    const f=await setup(t);let n=0;f.observe=async()=>{const o=structuredClone(f.observation);if(n++)change(o);return o;};await assert.rejects(capturePostDeploymentAnchor(f));assert.equal(existsSync(path.join(f.config.root,'full-anchors')),false);assert.equal(existsSync(path.join(f.config.root,'deploy.lock')),false);
  }
  const f=await setup(t);writeFileSync(path.join(f.config.backupDirectory,'database.dump'),'CORRUPT');await assert.rejects(capturePostDeploymentAnchor(f),/corrupt/);assert.equal(existsSync(path.join(f.config.root,'full-anchors')),false);
});
