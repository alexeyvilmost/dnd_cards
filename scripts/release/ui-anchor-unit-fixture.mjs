import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync,existsSync} from 'node:fs';import path from 'node:path';import {tmpdir} from 'node:os';
import {fixture,recordsFor,publishedFor} from './ui-planning-unit-fixture.mjs';
import {assembleCandidateManifest} from './ci-release.mjs';import {attachUnitRehearsal} from './unit-rehearsal-fixture.mjs';
import {evidenceHash,compositionFingerprint} from './validate-manifest.mjs';import {createDeploymentStore} from './deploy-state.mjs';
import {checksum} from './backup-manifest.mjs';import {capturePostDeploymentAnchor} from './capture-full-ui-anchor.mjs';import {uiFixture,h} from './ui-release-unit-fixture.mjs';

// Unit-only source, OCI and dump bytes; never usable as an actual host receipt.
export async function anchorUnitFixture(t){
  const repo=fixture(t),buildPlan=repo.plan(repo.candidate),records=recordsFor(buildPlan),candidate=assembleCandidateManifest(buildPlan,records,publishedFor(buildPlan));
  const manifest=structuredClone(candidate.manifest),fingerprint=compositionFingerprint(manifest),base=uiFixture();
  const bundle={reports:{core:candidate.reports.core,'image-contract':{status:'passed',compositionFingerprint:fingerprint},'pinned-artifacts':{status:'passed',compositionFingerprint:fingerprint,workerRuntime:manifest.workerRuntime,artifactHashes:[manifest.rulesArtifactHash],pendingDecisionChecked:true}},
    identities:Object.fromEntries(Object.entries(records).map(([key,row])=>[key,{...row.identity,releaseId:manifest.releaseId,releaseCommit:manifest.releaseCommit}])),images:publishedFor(buildPlan),historicalArtifactHashes:[],historicalInventoryComplete:true};
  manifest.validationEvidence=Object.entries(bundle.reports).map(([gate,row])=>({gate,status:'passed',inputFingerprint:fingerprint,reportHash:evidenceHash(row),completedAt:manifest.createdAt}));attachUnitRehearsal(manifest,bundle);
  const root=mkdtempSync(path.join(tmpdir(),'ui-anchor-unit-'));t.after(()=>{assert.equal(path.dirname(root),path.resolve(tmpdir()));assert.ok(path.basename(root).startsWith('ui-anchor-unit-'));rmSync(root,{recursive:true,force:true});});
  const config={root,backupDirectory:path.join(root,'backup')};mkdirSync(config.backupDirectory);const originalBackedUpManifest={releaseId:'old-snapshot'},files=[];
  for(const [name,category,contents] of [['database.dump','database','UNIT DATA'],['old.cjs','rules-artifact','UNIT MODULE'],['media.json','media-manifest','[]'],['release.json','release-manifest',JSON.stringify(originalBackedUpManifest)]]){const file=path.join(config.backupDirectory,name);writeFileSync(file,contents);files.push({path:name,category,bytes:Buffer.byteLength(contents),sha256:await checksum(file)});}
  const backup={schemaVersion:1,kind:'release-backup',status:'captured',createdAt:'2026-01-01T00:00:00Z',schemaFingerprint:h('d'),files,artifactInventoryComplete:true,referencedArtifactHashes:[files[1].sha256],releaseManifestHash:evidenceHash(originalBackedUpManifest)};
  const restore={status:'passed',scope:'accepted-deployment-recovery',backupHash:evidenceHash(backup),schemaFingerprint:backup.schemaFingerprint,checks:['snapshot','artifacts','migrations','pending-decision','duplicate-command','media-references'].map(id=>({id,status:'passed'}))};
  writeFileSync(path.join(config.backupDirectory,'backup.json'),JSON.stringify(backup));writeFileSync(path.join(config.backupDirectory,'restore-report.json'),JSON.stringify(restore));
  bundle.rehearsalReceipt.backupHash=evidenceHash(backup);bundle.rehearsalReceipt.checks.find(row=>row.id==='snapshot').backupHash=evidenceHash(backup);
  for(const key of ['image-contract','pinned-artifacts'])bundle.reports[key].rehearsalHash=evidenceHash(bundle.rehearsalReceipt);
  for(const row of manifest.validationEvidence)row.reportHash=evidenceHash(bundle.reports[row.gate]);
  const active={schemaVersion:1,status:'active',manifest,instances:Object.fromEntries(Object.keys(manifest.components).map(key=>[key,{releaseId:manifest.releaseId,releaseCommit:manifest.releaseCommit}]))},store=createDeploymentStore(root);
  store.writeActive(active);store.writeOperation({schemaVersion:1,releaseId:manifest.releaseId,status:'succeeded',plan:{candidateHash:evidenceHash(manifest),desired:active}});
  const releaseDirectory=path.join(root,'releases',manifest.releaseId);mkdirSync(releaseDirectory,{recursive:true});
  writeFileSync(path.join(releaseDirectory,'compose.runtime.json'),JSON.stringify({services:Object.fromEntries(Object.keys(manifest.components).map(key=>[key==='rulesWorker'?'rules-worker':key,{image:manifest.components[key].imageDigest,environment:{RELEASE_ID:manifest.releaseId,RELEASE_COMMIT:manifest.releaseCommit}}]))}));
  const observation={schemaVersion:1,kind:'ui-host-observation',observedAt:new Date().toISOString(),activeHash:evidenceHash(active),databaseBindingHash:h('d'),routingSecurityHash:h('d'),services:{frontend:{identity:bundle.identities.frontend}},protectedRuntime:base.protectedRunning,files:structuredClone(base.originalAnchor.files)};
  observation.files.observedAt=observation.observedAt;observation.files.files[0].sha256=manifest.rulesArtifactHash;
  for(const key of ['backend','rulesWorker'])observation.protectedRuntime[key].identity=bundle.identities[key];
  let observations=0;const observe=async()=>{observations++;return structuredClone(observation);};
  return {config,manifest,bundle,candidate,buildPlan,originalBackedUpManifest,restoreReportHash:evidenceHash(restore),store,observe,observation,observations:()=>observations,active};
}
