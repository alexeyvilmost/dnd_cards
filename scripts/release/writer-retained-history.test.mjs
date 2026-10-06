// Controlled unit faults; these results are never emitted as actual OCI proof.
import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,readFile,mkdir} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {checksum} from './backup-manifest.mjs';import {evidenceHash} from './validate-manifest.mjs';
import {verifiedWriterHistoryClosure,probeRetainedWriterHistory,assertRetainedWriterHistory} from './writer-retained-history.mjs';
import {unitRetainedHistory} from './writer-policy-unit-fixture.mjs';
import {pair,refresh} from './writer-policy-unit-fixture.mjs';import {assertReleaseReady} from './validate-manifest.mjs';
import {recoverHistoricalSourceCertification} from './historical-source-certification.mjs';

async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'writer-retained-unit-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const cjs=path.join(directory,'artifact.cjs');await writeFile(cjs,'module.exports = {};');
 const backup={artifactInventoryComplete:true,sourceReleaseReferences:[],sourceReleases:[],referencedArtifactHashes:[await checksum(cjs)],files:[{path:'artifact.cjs',category:'rules-artifact',sha256:await checksum(cjs),bytes:(await readFile(cjs)).length}]};
 const input={backup,backupHash:evidenceHash(backup)};let phase='source',apps=false;
 const data={schema:{migrations:['298'],schemaFingerprint:'sha256:'+'b'.repeat(64)},rows:[{name:'captured_user_rows',rows:7,digest:'a'.repeat(64)}],versions:{rogue:2,character:1,jobs:6},artifacts:backup.files};
 const adapter={execution:'docker',assertOwned:async()=>{},assertApplicationsStopped:async()=>assert.equal(apps,false),dumpDatabase:async()=>{const file=path.join(directory,'history.dump');await writeFile(file,'unit dump bytes');return {path:file,sha256:await checksum(file),bytes:15,createdAt:'2026-10-05T00:00:00Z'};},restoreDatabase:async dump=>{phase='restored';return {sourceDatabase:'source',restoredDatabase:'restored',sourceRetained:true,markerVerified:true,dumpHash:dump.sha256};},restoreSourceDatabase:async()=>{phase='source';}};
 return {directory,input,adapter,data,snapshot:async()=>structuredClone(data),get phase(){return phase;},start:()=>{apps=true;}};
}
test('full history proof binds real retained bytes and source, restore, source snapshots',async t=>{
 const f=await fixture(t),proof=await probeRetainedWriterHistory(f.input,f.adapter,{backupDirectory:f.directory,snapshot:f.snapshot});
 assert.equal(proof.closure.backupHash,f.input.backupHash);assert.equal(proof.closure.artifactCount,1);assert.equal(proof.closure.sourceReleaseCount,0);assert.equal(proof.beforeHash,proof.restoredHash);assert.equal(f.phase,'source');
 assert.notEqual(proof.closure.sourceCertificationClosureHash,evidenceHash([]),'Explicit empty verified closure is not an anonymous fixture hash');
});
test('missing source certification and altered captured executable are refused before restore',async t=>{
 const f=await fixture(t);f.input.backup.sourceReleaseReferences=[{releaseHash:'sha256:'+'e'.repeat(64)}];f.input.backupHash=evidenceHash(f.input.backup);
 await assert.rejects(verifiedWriterHistoryClosure(f.input,f.directory),/lacks exact verified/);
 f.input.backup.sourceReleaseReferences=[];f.input.backupHash=evidenceHash(f.input.backup);await writeFile(path.join(f.directory,'artifact.cjs'),'tampered');
 await assert.rejects(verifiedWriterHistoryClosure(f.input,f.directory));
});
test('nonempty archived certification closure is verified and cannot be replaced by the synthetic empty closure',async t=>{
 const f=await fixture(t),releaseHash='sha256:04678a044c4dc809d213e01e392bc0f16562d5103ee96e070089c1edf7e7100b',relative='source-releases/'+releaseHash.slice(7);
 await mkdir(path.join(f.directory,'source-releases'));
 const proof=await recoverHistoricalSourceCertification({repo:process.cwd(),releaseHash,outputDirectory:path.join(f.directory,relative)}),b=proof.databaseBinding;
 f.input.backup.sourceReleaseReferences=[{rulesetReleaseId:b.rulesetReleaseId,releaseHash,contentHash:proof.contentHash,manifestHash:b.manifestHash,manifestBytesHash:b.manifestCanonicalBytesSha256,manifest:b.manifest,artifactVersion:proof.releaseId,serializerVersion:b.serializerVersion}];
 f.input.backup.sourceReleases=[{releaseHash,path:relative,descriptorHash:proof.descriptorHash}];f.input.backup.files.push(...proof.files.map(row=>({...row,path:relative+'/'+row.path,category:'historical-source-certification'})));f.input.backupHash=evidenceHash(f.input.backup);
 const closure=await verifiedWriterHistoryClosure(f.input,f.directory);assert.equal(closure.sourceReleaseCount,1);assert.notEqual(closure.sourceCertificationClosureHash,evidenceHash([]));
 f.input.backup.files.pop();f.input.backupHash=evidenceHash(f.input.backup);await assert.rejects(verifiedWriterHistoryClosure(f.input,f.directory),/omitted from backup checksum closure/);
});
test('live applications, changed restore rows and changed closure never become a retained proof',async t=>{
 const live=await fixture(t);live.start();await assert.rejects(probeRetainedWriterHistory(live.input,live.adapter,{backupDirectory:live.directory,snapshot:live.snapshot}));
 const changed=await fixture(t);await assert.rejects(probeRetainedWriterHistory(changed.input,changed.adapter,{backupDirectory:changed.directory,snapshot:async()=>({...await changed.snapshot(),rows:changed.phase==='restored'?[]:changed.data.rows})}),/history changed/);
 const closure=await fixture(t),restore=closure.adapter.restoreDatabase;closure.adapter.restoreDatabase=async value=>{const result=await restore(value);await writeFile(path.join(closure.directory,'artifact.cjs'),'changed after restore');return result;};await assert.rejects(probeRetainedWriterHistory(closure.input,closure.adapter,{backupDirectory:closure.directory,snapshot:closure.snapshot}));
});

test('actual mounted CJS must cover every captured executable; extra candidate CJS is allowed',async t=>{
 for(const mutate of [
  rows=>rows.splice(0,1,{path:'other.cjs',sha256:'sha256:'+'f'.repeat(64),bytes:20}),
  rows=>rows[0].bytes++,rows=>rows.push({...rows[0]}),
 ]){
  const f=await fixture(t);f.data.artifacts=structuredClone(f.data.artifacts);mutate(f.data.artifacts);let dumped=false;f.adapter.dumpDatabase=async()=>{dumped=true;throw Error('unexpected dump');};
  await assert.rejects(probeRetainedWriterHistory(f.input,f.adapter,{backupDirectory:f.directory,snapshot:f.snapshot}));assert.equal(dumped,false);
 }
 const f=await fixture(t);f.data.artifacts=structuredClone(f.data.artifacts);f.data.artifacts.push({path:'candidate.cjs',sha256:'sha256:'+'e'.repeat(64),bytes:50});
 await probeRetainedWriterHistory(f.input,f.adapter,{backupDirectory:f.directory,snapshot:f.snapshot});
});
test('offline ninth-stage guard requires its own full-backup proof, never synthetic expanded trace alone',()=>{
 for(const mutate of [c=>delete c.retainedHistory,c=>c.retainedHistory.closure.backupHash='sha256:'+'e'.repeat(64),c=>c.retainedHistory.writerEnvironment.imageJobs=true,c=>c.retainedHistory.restoredHash='sha256:'+'f'.repeat(64),c=>c.retainedHistory.closure.sourceCertificationClosureHash='empty']){
  const f=pair();mutate(f.check);refresh(f.candidate,f.bundle);assert.throws(()=>assertReleaseReady(f.candidate,f.bundle));
 }
 const p=unitRetainedHistory('sha256:'+'a'.repeat(64));assertRetainedWriterHistory(p,p.closure.backupHash);
});
