// Actual byte verification with owned synthetic fixtures; these are not
// production restore/release receipts.
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,utimesSync,statSync}from'node:fs';
import {tmpdir}from'node:os';import path from'node:path';import {createHash}from'node:crypto';
import {observeCompletedRestoreRefusal}from'./completed-restore-refusal.mjs';
import {validateReviewedDeploymentRefusal}from'./reviewed-deployment-refusal.mjs';
import {assertReviewedRefusalObservation}from'./reviewed-deployment-refusal-host.mjs';
import {persistRehearsalResult}from'./candidate-rehearsal.mjs';
import {evidenceHash}from'./validate-manifest.mjs';
const original=JSON.parse(readFileSync(new URL('../../infra/reviewed-deployment-refusals/37420370284-1.json',import.meta.url),'utf8'));
const digest=b=>'sha256:'+createHash('sha256').update(b).digest('hex');
async function fixture(t){
 const root=mkdtempSync(path.join(tmpdir(),'completed-restore-'));
 t.after(()=>{assert.equal(path.dirname(root),path.resolve(tmpdir()));assert.ok(path.basename(root).startsWith('completed-restore-'));rmSync(root,{recursive:true,force:true});});
 const proof=structuredClone(original),old=path.join(root,'attempts',`deploy-${proof.failed.id}-1`),directory=path.join(root,'backups',`capture-${proof.failed.id}-1`),output=path.join(old,'rehearsal');
 mkdirSync(output,{recursive:true,mode:0o700});mkdirSync(directory,{recursive:true,mode:0o700});
 const write=(file,value)=>{mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const text=typeof value==='string'?value:JSON.stringify(value);writeFileSync(file,text,{mode:0o600});return {bytes:Buffer.byteLength(text),sha256:digest(text)};};
 const manifest={releaseId:'owned-synthetic-previous'},active={manifest},candidate={manifest:{releaseId:'owned-synthetic-candidate'}};
 const files=[['database.dump','database','owned database bytes'],['prior.cjs','rules-artifact','module.exports={}'],['media.json','media-manifest','[]'],['release.json','release-manifest',manifest]].map(([file,category,value])=>({path:file,category,...write(path.join(directory,file),value)}));
 const backup={schemaVersion:1,kind:'release-backup',status:'captured',createdAt:proof.expiry.capturedAt,schemaFingerprint:'sha256:'+'a'.repeat(64),files,artifactInventoryComplete:true,referencedArtifactHashes:[files[1].sha256],releaseManifestHash:evidenceHash(manifest)};
 const capture={schemaVersion:1,kind:'candidate-capture',status:'captured',activeHash:evidenceHash(active),releaseManifestHash:evidenceHash(manifest),createdAt:backup.createdAt};
 const input={active,backup,activeHash:evidenceHash(active),backupHash:evidenceHash(backup),candidateHash:evidenceHash(candidate)};
 const restore={schemaVersion:1,status:'passed',scope:'accepted-deployment-recovery',backupHash:input.backupHash,schemaFingerprint:backup.schemaFingerprint,rehearsalHash:'sha256:'+'b'.repeat(64),cleanup:{status:'stopped',errors:[],resourceCount:19},checks:['snapshot','artifacts','migrations','pending-decision','duplicate-command','media-references'].map(id=>({id,status:'passed'}))};
 write(path.join(directory,'capture.json'),capture);write(path.join(directory,'backup.json'),backup);write(path.join(output,'input.json'),input);write(path.join(directory,'restore-report.json'),restore);
 const written=new Date(proof.expiry.restoreReportWrittenAt);utimesSync(path.join(directory,'restore-report.json'),written,written);
 for(const name of ['candidate-rehearsal.mjs','backup-manifest.mjs'])write(path.join(old,'control','scripts','release',name),readFileSync(new URL(name,import.meta.url),'utf8'));
 Object.assign(proof.baseline,{activeHash:evidenceHash(active),manifestHash:evidenceHash(manifest)});proof.candidateManifestHash=evidenceHash(candidate.manifest);
 for(const [key,file]of Object.entries({captureHash:path.join(directory,'capture.json'),backupFileHash:path.join(directory,'backup.json'),inputHash:path.join(output,'input.json'),restoreReportHash:path.join(directory,'restore-report.json'),collectorCodeHash:path.join(old,'control','scripts','release','candidate-rehearsal.mjs'),backupCodeHash:path.join(old,'control','scripts','release','backup-manifest.mjs')}))proof.expiry[key]=digest(readFileSync(file));
 proof.expiry.restoreRehearsalHash=restore.rehearsalHash;proof.expiry.restoreReportWrittenAt=statSync(path.join(directory,'restore-report.json')).mtime.toISOString();
 return {root,old,directory,output,proof,active,candidate,input,write};
}
test('completed restore refusal keeps its genuine failed run and absence of accepted rehearsal explicit',()=>{
 validateReviewedDeploymentRefusal(original);
 assert.equal(assertReviewedRefusalObservation(original,{...structuredClone(original),activeHash:original.baseline.activeHash,cleanupComplete:true}).status,'verified-reviewed-pre-cutover-refusal');
 for(const change of [p=>p.expiry.rehearsalReceiptAbsent=false,p=>p.expiry.verifiedBackupReceiptAbsent=false,p=>p.expiry.legacyFreshnessRefused=false,p=>p.expiry.maximumAgeMs=60*60_000,p=>p.expiry.ownedResourcesStopped=18,p=>p.expiry.restoreReportWrittenAt=p.expiry.capturedAt,p=>p.expiry.restoreReportWrittenAt=p.observedAt,p=>p.expiry.captureHash='unknown',p=>p.rehearsalHash=p.expiry.restoreRehearsalHash,p=>p.kind='reviewed-followon-pre-cutover-refusal-audit',p=>p.phaseHashes.shift()]){const p=structuredClone(original);change(p);assert.throws(()=>validateReviewedDeploymentRefusal(p));}
 const changed={...structuredClone(original),activeHash:original.baseline.activeHash,cleanupComplete:true};changed.expiry.inputHash='sha256:'+'0'.repeat(64);assert.throws(()=>assertReviewedRefusalObservation(original,changed));
});
test('completed restore reader verifies original bytes/date/proof without producing a missing rehearsal',async t=>{
 const f=await fixture(t);assert.deepEqual(await observeCompletedRestoreRefusal(f),f.proof.expiry);
 assert.equal(readFileSync(path.join(f.directory,'backup.json'),'utf8'),JSON.stringify(f.input.backup));
 assert.throws(()=>readFileSync(path.join(f.output,'rehearsal.json')),/ENOENT/);
 f.write(path.join(f.output,'rehearsal.json'),{status:'passed'});await assert.rejects(observeCompletedRestoreRefusal(f));
});
test('changed snapshot bytes, active state or original restore metadata refuse the audited exception',async t=>{
 const f=await fixture(t);
 await assert.rejects(observeCompletedRestoreRefusal({...f,active:{manifest:{releaseId:'changed'}}}));
 const stamp=f.proof.expiry.restoreReportWrittenAt;utimesSync(path.join(f.directory,'restore-report.json'),new Date(stamp),new Date(Date.parse(stamp)+1000));await assert.rejects(observeCompletedRestoreRefusal(f));
 utimesSync(path.join(f.directory,'restore-report.json'),new Date(stamp),new Date(stamp));f.write(path.join(f.directory,'database.dump'),'changed database');await assert.rejects(observeCompletedRestoreRefusal(f));
});
test('late freshness refusal retains the real report and restore proof but cannot issue verified backup',async t=>{
 const f=await fixture(t),restoreFile=path.join(f.directory,'restore-report.json');
 // The fixture certificate is not a captured producer output. Remove only
 // this exact owned fixture file so the real producer can create its bytes.
 const {unlinkSync}=await import('node:fs');unlinkSync(restoreFile);
 const report={status:'passed',cleanup:{status:'stopped',errors:[],resourceCount:19},checks:[{id:'snapshot',status:'passed'}]};
 t.mock.method(Date,'now',()=>Date.parse(f.input.backup.createdAt)+60*60_000+1);
 await assert.rejects(persistRehearsalResult({...f,backupDirectory:f.directory,report,capture:true}),/Fresh backup/);
 assert.deepEqual(JSON.parse(readFileSync(path.join(f.output,'rehearsal.json'),'utf8')),report);
 assert.equal(JSON.parse(readFileSync(restoreFile,'utf8')).rehearsalHash,evidenceHash(report));
 assert.throws(()=>readFileSync(path.join(f.output,'verified-backup.json')),/ENOENT/);
 await assert.rejects(persistRehearsalResult({...f,backupDirectory:f.directory,report,capture:true}),/EEXIST/);
});
