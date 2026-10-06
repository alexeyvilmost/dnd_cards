// An expired completed restore is an audited pre-cutover refusal, never an
// accepted nine-check rehearsal. The original missing report stays missing.
import assert from 'node:assert/strict';
import {readFileSync,lstatSync,realpathSync,existsSync} from 'node:fs';
import path from 'node:path';import {createHash}from'node:crypto';
import {verifyDeploymentBackup,verifyRecoverabilityBaseline}from'./backup-manifest.mjs';
import {evidenceHash}from'./validate-manifest.mjs';
import {validateReviewedDeploymentRefusal,isCompletedRestoreRefusal}from'./reviewed-deployment-refusal.mjs';
const hash=b=>'sha256:'+createHash('sha256').update(b).digest('hex');
function bytes(file,{code=false}={}){
 assert.equal(realpathSync(file),path.resolve(file));const stat=lstatSync(file);
 assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>0&&stat.size<=32*1024*1024);
 if(process.platform!=='win32'&&!code)assert.equal(stat.mode&0o077,0);
 return readFileSync(file);
}
const read=f=>JSON.parse(bytes(f));
export async function observeCompletedRestoreRefusal({proof,old,root,active,candidate}){
 validateReviewedDeploymentRefusal(proof);assert.ok(isCompletedRestoreRefusal(proof));
 assert.equal(path.basename(old),`deploy-${proof.failed.id}-1`);
 assert.equal(evidenceHash(active),proof.baseline.activeHash);assert.equal(evidenceHash(candidate.manifest),proof.candidateManifestHash);
 for(const file of ['rehearsal.json','verified-backup.json'])assert.equal(existsSync(path.join(old,'rehearsal',file)),false);
 const directory=path.join(root,'backups',`capture-${proof.failed.id}-1`),captureFile=path.join(directory,'capture.json'),backupFile=path.join(directory,'backup.json'),inputFile=path.join(old,'rehearsal','input.json'),restoreFile=path.join(directory,'restore-report.json');
 const capture=read(captureFile),backup=read(backupFile),input=read(inputFile),restore=read(restoreFile);
 assert.equal(capture.kind,'candidate-capture');assert.equal(capture.status,'captured');assert.equal(capture.schemaVersion,1);
 assert.equal(capture.activeHash,proof.baseline.activeHash);assert.equal(capture.releaseManifestHash,proof.baseline.manifestHash);assert.equal(capture.createdAt,backup.createdAt);
 assert.equal(input.activeHash,proof.baseline.activeHash);assert.equal(evidenceHash(input.active),proof.baseline.activeHash);assert.equal(input.candidateHash,evidenceHash(candidate));assert.equal(evidenceHash(input.backup),evidenceHash(backup));assert.equal(input.backupHash,evidenceHash(backup));
 assert.equal(restore.backupHash,input.backupHash);assert.equal(restore.cleanup.status,'stopped');assert.deepEqual(restore.cleanup.errors,[]);assert.equal(restore.cleanup.resourceCount,19);
 await verifyRecoverabilityBaseline(directory,active.manifest,{restoreReportHash:evidenceHash(restore)});
 await assert.rejects(verifyDeploymentBackup(directory,active.manifest,{maximumAgeMs:30*60_000}),/^Error: Fresh backup of active release required$/);
 const expiry={captureHash:hash(bytes(captureFile)),backupFileHash:hash(bytes(backupFile)),inputHash:hash(bytes(inputFile)),restoreReportHash:hash(bytes(restoreFile)),restoreRehearsalHash:restore.rehearsalHash,
  collectorCodeHash:hash(bytes(path.join(old,'control','scripts','release','candidate-rehearsal.mjs'),{code:true})),backupCodeHash:hash(bytes(path.join(old,'control','scripts','release','backup-manifest.mjs'),{code:true})),
  capturedAt:capture.createdAt,restoreReportWrittenAt:lstatSync(restoreFile).mtime.toISOString(),maximumAgeMs:30*60_000,ownedResourcesStopped:restore.cleanup.resourceCount,
  rehearsalReceiptAbsent:true,verifiedBackupReceiptAbsent:true,legacyFreshnessRefused:true};
 assert.deepEqual(expiry,proof.expiry,'Original completed restore evidence changed');return expiry;
}
