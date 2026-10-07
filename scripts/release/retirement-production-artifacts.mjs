// Acceptance of an explicitly requested host retirement. Local evidence keeps
// its local-only profile; only this verifier binds it to fresh installed state.
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFile,lstat,realpath} from 'node:fs/promises';
import {evidenceHash,validateManifest} from './validate-manifest.mjs';
import {validateActive} from './deploy-state.mjs';
import {databaseMigrationSet} from './migration-transition.mjs';
import {verifyLocalRetirementArtifacts,recheckLocalRetirementArtifacts} from './retirement-artifacts.mjs';
import {validateRetirementExecutionRequest} from './retirement-execution-result.mjs';
import {backupFile,checksum,verifyBackup,captureMaximumStartAgeMs} from './backup-manifest.mjs';
import {assertOutsideCheckout} from './capture-host-backup.mjs';

const same=(a,b)=>evidenceHash(a)===evidenceHash(b);
const hash=v=>/^sha256:[a-f0-9]{64}$/.test(v??'');
const approvalKeys=['schemaVersion','kind','activeHash','bundleHash','captureHash','executorManifestHash','requestHash','automaticMigration'];
const extraChecks=[['previous','actual-browser'],['previous','historical-replay'],['candidate','actual-browser'],['candidate','historical-replay'],['rollback','actual-browser']];

// Pure checks for unit tests and the file verifier below. Passing this function
// alone is not an executable capability or acceptance of external artifacts.
export function assertProductionRetirementBinding({active,executorManifest,request,approvalHash,approval,plan,bundle,capture,backup,pair,now}) {
  validateActive(active);validateManifest(executorManifest);validateRetirementExecutionRequest(request);
  assert.equal(active.database?.status,'verified-additive');
  assert.equal(bundle.schemaVersion,4,'Fresh installed-candidate capture required');
  assert.equal(plan.productionReady,false);assert.equal(plan.productionExecutionSupported,false);
  assert.equal(plan.capturedActiveHash,evidenceHash(active));assert.equal(plan.capturedSource,active.manifest.releaseCommit);
  assert.equal(plan.candidateSource,active.manifest.releaseCommit);
  assert(same(executorManifest,active.manifest),'Only the installed executor may retire this schema');
  const backend=executorManifest.components.backend;
  assert(same(plan.publishedExecutor,{status:'passed',sourceCommit:backend.sourceCommit,inputFingerprint:backend.inputFingerprint,localDiagnosticBinary:false,publishedExecutor:true,receiptHash:pair.actualLinuxExecutor302.receiptHash,repeatApplied:0,imageDigest:backend.imageDigest}));
  assert(same(request.expectedCurrent,databaseMigrationSet(active)));
  assert.equal(request.expectedAdditiveSchemaProofHash,active.database.schemaProofHash);
  assert.equal(request.sqlSourceHash,plan.sqlSourceHash);assert(same(request.retirement,plan.request));
  assert.equal(request.candidateSourceCommit,backend.sourceCommit);assert.equal(request.candidateInputFingerprint,backend.inputFingerprint);
  assert.notEqual(request.releaseId,active.manifest.releaseId);
  assert.equal(approval.schemaVersion,1);assert.equal(approval.kind,'character-retirement-302-approval');
  assert(same(Object.keys(approval).sort(),[...approvalKeys].sort()));assert.equal(approval.automaticMigration,false);
  for(const key of ['activeHash','bundleHash','captureHash','executorManifestHash','requestHash'])assert(hash(approval[key]));
  assert.equal(approvalHash,evidenceHash(approval));assert.equal(approval.activeHash,evidenceHash(active));
  assert.equal(approval.bundleHash,plan.bundleHash);assert.equal(approval.captureHash,bundle.artifacts.capture.sha256);
  assert.equal(approval.executorManifestHash,evidenceHash(executorManifest));assert.equal(approval.requestHash,evidenceHash(request));
  assert.equal(capture.activeHash,evidenceHash(active));assert.equal(capture.releaseManifestHash,evidenceHash(active.manifest));
  assert.equal(backup.releaseManifestHash,capture.releaseManifestHash);assert.equal(backup.createdAt,capture.createdAt);
  assert(same([...backup.migrations].sort(),plan.expectedCurrentMigrations));
  for(const row of capture.files)assert(backup.files.some(file=>same(file,row)),'Recovery manifest must retain every captured input');
  const dump=backup.files.filter(row=>row.category==='database');assert.equal(dump.length,1);
  assert.equal(dump[0].sha256,bundle.artifacts.dump.sha256);assert.equal(dump[0].bytes,bundle.artifacts.dump.bytes);
  assert(Number.isSafeInteger(now)&&now>=0);const created=Date.parse(capture.createdAt);
  assert(Number.isFinite(created)&&created<=now&&now-created<=captureMaximumStartAgeMs,'Fresh retirement capture required');
  assert(same(pair.additionalChecks?.map(row=>[row.generation,row.id]),extraChecks));
  for(const row of pair.additionalChecks){
    assert.equal(row.status,'passed');
    if(row.id==='actual-browser'){
      assert.equal(row.execution,'docker');assert.equal(row.browserVersion,'151.0.7922.34');
      assert(same(Object.keys(row.checks).sort(),['api-routing','character','equipment','paper','json-export','pdf-export','inventory','combat'].sort()));
      assert(Object.values(row.checks).every(check=>check.status==='passed'));
    }else {
      assert(Number.isSafeInteger(row.commands)&&row.commands>0&&Number.isSafeInteger(row.combats)&&row.combats>0);
      assert(Array.isArray(row.artifactHashes)&&row.artifactHashes.length>0&&row.artifactHashes.every(hash));
    }
  }
}

async function protectedDirectory(directory) {
  assert.equal(process.platform,'linux','Production retirement requires the Linux host');
  assert(path.isAbsolute(directory));await assertOutsideCheckout(directory);
  const info=await lstat(directory);assert(info.isDirectory()&&!info.isSymbolicLink());
  assert.equal(await realpath(directory),path.resolve(directory));assert.equal(info.mode&0o077,0);
}
async function protectedRead(file,{maximumBytes=32*1024*1024}={}) {
  assert.equal(process.platform,'linux','Production retirement requires the Linux host');
  assert(Number.isSafeInteger(maximumBytes)&&maximumBytes>0&&maximumBytes<=32*1024*1024);
  const info=await lstat(file);assert(info.isFile()&&!info.isSymbolicLink());
  assert.equal(await realpath(file),path.resolve(file));assert.equal(info.mode&0o077,0);
  assert(info.size>0&&info.size<=maximumBytes);return JSON.parse(await readFile(file));
}
export {protectedDirectory as assertPrivateRetirementDirectory,protectedRead as readPrivateRetirementJSON};
export async function verifyProductionRetirementArtifacts({directory,backupDirectory,approvalFile,active,executorManifest,approvalHash,request}) {
  try {
    const accepted=structuredClone({active,executorManifest,approvalHash,request});
    await protectedDirectory(directory);await protectedDirectory(backupDirectory);
    assert.equal(path.dirname(path.resolve(approvalFile)),path.resolve(directory));
    const approval=await protectedRead(approvalFile);
    const bundle=await protectedRead(backupFile(directory,'retirement-bundle.json'));
    assert.equal(bundle.schemaVersion,4);
    for(const row of Object.values(bundle.artifacts)){
      const file=backupFile(directory,row.path),info=await lstat(file);
      assert.equal(info.mode&0o077,0);assert(info.isFile()&&!info.isSymbolicLink());
    }
    const plan=await verifyLocalRetirementArtifacts(directory),backup=await verifyBackup(backupDirectory);
    const capture=await protectedRead(backupFile(directory,bundle.artifacts.capture.path));
    const pair=await protectedRead(backupFile(directory,bundle.artifacts.readerPair.path));
    assert.equal(await checksum(backupFile(backupDirectory,'capture.json')),bundle.artifacts.capture.sha256);
    const captured=await protectedRead(backupFile(directory,bundle.artifacts.capturedActive.path));
    assert(same(captured,accepted.active));
    await recheckLocalRetirementArtifacts(plan);
    assertProductionRetirementBinding({...accepted,approval,plan,bundle,capture,backup,pair,now:Date.now()});
    // Recheck descriptors after every artifact was checked again through its
    // original same-process local verifier, including the large source dump.
    assert.equal(await checksum(backupFile(directory,'retirement-bundle.json')),plan.bundleHash);
    assert.equal(evidenceHash(await protectedRead(approvalFile)),accepted.approvalHash);
    return Object.freeze({schemaVersion:1,kind:'verified-production-retirement-artifacts',activeHash:evidenceHash(accepted.active),bundleHash:plan.bundleHash,approvalHash:accepted.approvalHash,requestHash:evidenceHash(accepted.request),automaticMigration:false});
  }catch{throw Error('Production retirement artifacts refused; no retirement command dispatched');}
}
