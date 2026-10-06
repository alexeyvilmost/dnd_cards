// Full captured history is distinct from the public format fixture. No writer
// or paid-job dispatcher is started against these restored user rows.
import assert from 'node:assert/strict';
import {lstat} from 'node:fs/promises';
import {backupFile,checksum} from './backup-manifest.mjs';
import {verifyBackupSourceReleases} from './source-release-references.mjs';
import {evidenceHash} from './validate-manifest.mjs';
import {snapshotExpandedDatabase} from './expanded-writer-restore.mjs';
const same=(a,b)=>assert.equal(evidenceHash(a),evidenceHash(b),'Retained captured history changed');
export function assertMountedHistoryArtifacts(backup,snapshot){
 assert.ok(Array.isArray(snapshot?.artifacts)&&snapshot.artifacts.length>0);
 const byHash=new Map();
 for(const row of snapshot.artifacts){assert.match(row.sha256,/^sha256:[a-f0-9]{64}$/);assert.ok(Number.isSafeInteger(row.bytes)&&row.bytes>0);assert.ok(!byHash.has(row.sha256),'Repeated mounted executable');byHash.set(row.sha256,row);}
 for(const row of backup.files.filter(row=>row.category==='rules-artifact')){
  const mounted=byHash.get(row.sha256);assert.ok(mounted,'Captured executable absent from actual mounted history');assert.equal(mounted.bytes,row.bytes,'Mounted executable bytes differ');
 }
 for(const hash of backup.referencedArtifactHashes)assert.ok(byHash.has(hash),'Referenced executable absent from actual mounted history');
}

export function assertRetainedWriterHistory(proof,backupHash){
 const hash=/^sha256:[a-f0-9]{64}$/;
 assert.equal(proof?.schemaVersion,1);assert.equal(proof.kind,'retained-writer-history-restore');assert.equal(proof.status,'passed');assert.equal(proof.execution,'docker');assert.equal(proof.scope,'full-captured-history');
 assert.deepEqual(proof.writerEnvironment,{compactReceipts:false,imageJobs:false,frozenCatalogs:false});
 assert.equal(proof.closure?.schemaVersion,1);assert.equal(proof.closure.kind,'verified-captured-writer-history');assert.equal(proof.closure.backupHash,backupHash);assert.match(backupHash,hash);
 for(const value of [proof.closure.artifactClosureHash,proof.closure.sourceCertificationClosureHash,proof.closure.sourceReferenceHash,proof.dump?.sha256,proof.beforeHash,proof.restoredHash])assert.match(value,hash);
 assert.equal(proof.beforeHash,proof.restoredHash);assert.equal(proof.sourceRetained,true);
 for(const value of [proof.tables,proof.migrationCount,proof.dump.bytes,proof.closure.artifactCount])assert.ok(Number.isSafeInteger(value)&&value>0);
 assert.ok(Number.isSafeInteger(proof.closure.sourceReleaseCount)&&proof.closure.sourceReleaseCount>=0);assert.ok(Number.isFinite(Date.parse(proof.dump.createdAt)));
 for(const key of ['rogue','character','jobs'])assert.ok(Number.isSafeInteger(proof.formats?.[key])&&proof.formats[key]>=0);
 return proof;
}

export async function verifiedWriterHistoryClosure(input,directory){
 const backup=input.backup;
 assert.equal(backup?.artifactInventoryComplete,true);
 assert.ok(Array.isArray(backup.sourceReleaseReferences));
 assert.ok(Array.isArray(backup.sourceReleases));
 assert.ok(Array.isArray(backup.referencedArtifactHashes));
 assert.equal(input.backupHash,evidenceHash(backup),'Captured backup identity differs');
 const sourceProof=await verifyBackupSourceReleases(directory,backup.sourceReleaseReferences,backup.sourceReleases,backup.files);
 const files=backup.files.filter(row=>['rules-artifact','historical-source-certification'].includes(row.category)).map(row=>({path:row.path,category:row.category,sha256:row.sha256,bytes:row.bytes})).sort((a,b)=>a.path.localeCompare(b.path));
 assert.equal(new Set(files.map(row=>row.path)).size,files.length);
 for(const row of files){
  const file=backupFile(directory,row.path),stat=await lstat(file);
  assert.ok(stat.isFile()&&!stat.isSymbolicLink());assert.equal(stat.size,row.bytes);assert.equal(await checksum(file),row.sha256);
 }
 for(const hash of backup.referencedArtifactHashes)assert.ok(files.some(row=>row.category==='rules-artifact'&&row.sha256===hash),'Retained executable omitted from backup closure');
 return {schemaVersion:1,kind:'verified-captured-writer-history',backupHash:input.backupHash,
  artifactClosureHash:evidenceHash(files.filter(row=>row.category==='rules-artifact')),
  sourceCertificationClosureHash:evidenceHash({references:backup.sourceReleaseReferences,descriptors:backup.sourceReleases,files:files.filter(row=>row.category==='historical-source-certification')}),
  artifactCount:backup.referencedArtifactHashes.length,sourceReleaseCount:sourceProof.sourceReleases,sourceReferenceHash:sourceProof.referenceHash};
}

// adapter is the collector's own stopped full-history database, not a supplied
// report. It creates a new DB, retains the source, and never starts applications
// on either database during this comparison.
export async function probeRetainedWriterHistory(input,adapter,{backupDirectory,snapshot=snapshotExpandedDatabase}={}){
 assert.equal(adapter.execution,'docker');await adapter.assertOwned();await adapter.assertApplicationsStopped();
 const closure=await verifiedWriterHistoryClosure(input,backupDirectory);
 const before=await snapshot(adapter);assertMountedHistoryArtifacts(input.backup,before);
 const dump=await adapter.dumpDatabase();
 assert.match(dump.sha256,/^sha256:[a-f0-9]{64}$/);assert.ok(dump.bytes>0);
 same(before,await snapshot(adapter));
 const restored=await adapter.restoreDatabase(dump);
 assert.equal(restored.sourceRetained,true);assert.equal(restored.markerVerified,true);assert.equal(restored.dumpHash,dump.sha256);
 assert.notEqual(restored.sourceDatabase,restored.restoredDatabase);
 const after=await snapshot(adapter);same(before,after);
 same(closure,await verifiedWriterHistoryClosure(input,backupDirectory));
 assert.equal(await checksum(dump.path),dump.sha256,'Retained dump bytes changed');
 await adapter.restoreSourceDatabase(restored);
 same(before,await snapshot(adapter));
 await adapter.assertApplicationsStopped();
 return assertRetainedWriterHistory({schemaVersion:1,kind:'retained-writer-history-restore',status:'passed',scope:'full-captured-history',execution:'docker',
  writerEnvironment:{compactReceipts:false,imageJobs:false,frozenCatalogs:false},closure,
  dump:{sha256:dump.sha256,bytes:dump.bytes,createdAt:dump.createdAt},
  beforeHash:evidenceHash(before),restoredHash:evidenceHash(after),sourceRetained:true,
  tables:before.rows.length,migrationCount:before.schema.migrations.length,formats:before.versions},input.backupHash);
}
