// Local evidence preflight. No production executor or automatic migration.
import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {backupFile,checksum} from './backup-manifest.mjs';
import {validateManifest,evidenceHash} from './validate-manifest.mjs';
import {validateActive,assertServiceIdentities} from './deploy-state.mjs';
const hash=b=>'sha256:'+createHash('sha256').update(b).digest('hex');
const hashPattern=/^sha256:[a-f0-9]{64}$/;
const source=await readFile(new URL('../../backend/migrations/data/retire-legacy-characters-302.sql',import.meta.url));
const verifiedPlans=new WeakMap();
const artifactKinds=['sql','dump','archive','archiveRestore','retirementProof','retainedBefore','retainedAfter','readerPair','candidate','active'];
export const retirementProfile=Object.freeze({schemaVersion:1,id:'retire-character-generations-302-local',migrationId:'302_retire_legacy_characters',mode:'local-owned-rehearsal',fingerprintTimezone:'UTC',sqlSourceHash:hash(source),productionExecutionSupported:false,automaticMigration:false});
export const retirementReaderChecks=Object.freeze([
 ['previous','image-contract'],['previous','full-candidate-health'],['previous','v3-paper-personal-inventory-equipment-and-exact-retry'],
 ['candidate','image-contract'],['candidate','full-candidate-health'],['candidate','v3-paper-personal-inventory-equipment-and-exact-retry'],['candidate','pending-decision'],
 ['rollback','image-contract'],['rollback','pending-decision'],['rollback','duplicate-command'],[null,'all-original-ledger-rows-and-retirement-receipt-unchanged-after-three-startups'],
].map(Object.freeze));
const retirementChecks=['complete-source-restored-on-owned-native-postgres','exact-retired-row-archive-created-under-private-acl','actual-private-archive-restored-with-identical-full-row-preimages','all-retained-table-row-fingerprints-preserved-during-archive-restore','all-existing-migration-ledger-rows-retained-exactly','real-owned-retirement-preserves-all-retained-table-full-row-fingerprints','same-request-retry-retains-identical-journal-receipt'];
function frozen(value){if(value&&typeof value==='object'){for(const child of Object.values(value))frozen(child);Object.freeze(value);}return value;}
function passed(report){assert.equal(report.status,'passed');assert.equal(report.cleanup.status,'stopped');assert.deepEqual(report.cleanup.errors,[]);assert.equal(report.productionChanges,0);}
function preimages(value){assert.deepEqual(Object.keys(value).sort(),['characters','characters_v2','retired_inventories','retired_items']);for(const row of Object.values(value)){assert.deepEqual(Object.keys(row).sort(),['rows','sha256']);assert(Number.isSafeInteger(row.rows)&&row.rows>=0);assert(hashPattern.test(row.sha256));}return value;}
function tableFingerprints(value){assert(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length>0);for(const [name,row]of Object.entries(value)){assert(/^[a-z][a-z0-9_]*$/.test(name));assert(Number.isSafeInteger(row.rows)&&row.rows>=0);assert(hashPattern.test(row.sha256));}return value;}

export async function verifyLocalRetirementArtifacts(directory){
 try{
  const bytes=await readFile(backupFile(directory,'retirement-bundle.json'));
  assert(bytes.length<=1024*1024);const bundle=JSON.parse(bytes);
  assert.equal(bundle.schemaVersion,1);assert.equal(bundle.kind,'local-retirement-artifact-bundle');assert.equal(bundle.profileId,retirementProfile.id);
  assert.equal(bundle.mode,retirementProfile.mode);assert.equal(bundle.fingerprintTimezone,'UTC');assert.equal(bundle.productionReady,false);
  assert.deepEqual(Object.keys(bundle.artifacts).sort(),[...artifactKinds].sort());
  const paths=new Set(),files={},values={};
  for(const kind of artifactKinds){
   const row=bundle.artifacts[kind];assert.deepEqual(Object.keys(row).sort(),['bytes','path','sha256']);assert(hashPattern.test(row.sha256));assert(Number.isSafeInteger(row.bytes)&&row.bytes>0);
   const file=backupFile(directory,row.path);assert(!paths.has(file));paths.add(file);
   assert.equal((await stat(file)).size,row.bytes);assert.equal(await checksum(file),row.sha256);files[kind]=file;
   if(kind!=='dump'){assert(row.bytes<=32*1024*1024);const content=await readFile(file);assert.equal(hash(content),row.sha256);values[kind]=kind==='sql'?content:JSON.parse(content);}
  }
  assert.equal(bundle.artifacts.sql.sha256,retirementProfile.sqlSourceHash);assert.deepEqual(values.sql,source);
  const raw=values.retirementProof;passed(raw);assert.equal(raw.scope,'local-complete-owned-snapshot-retired-archive-and-retirement-rehearsal');
  assert.equal(raw.actualArchiveRestoreProven,true);assert.equal(raw.retirementOnOwnedSnapshotProven,true);assert.equal(raw.sourceDumpUnchanged,true);assert.equal(raw.sqlSourceUnchanged,true);assert.equal(raw.helperSourceUnchanged,true);
  assert.deepEqual(raw.checks,retirementChecks);assert.equal(raw.sourceDumpHash,bundle.artifacts.dump.sha256);assert.equal(raw.sqlSourceHash,bundle.artifacts.sql.sha256);
  assert.equal(raw.archiveHash,bundle.artifacts.archive.sha256);assert.equal(raw.archiveBytes,bundle.artifacts.archive.bytes);assert.equal(raw.archiveRestoreReportHash,bundle.artifacts.archiveRestore.sha256);
  preimages(raw.preimages);
  const archive=values.archive;assert.equal(archive.schemaVersion,1);assert.equal(archive.kind,'retired-character-generations-row-archive');assert.equal(archive.sourceDumpHash,raw.sourceDumpHash);assert.equal(archive.sourceCapture,raw.sourceCapture);
  assert.deepEqual(archive.preimages,raw.preimages);assert.deepEqual(Object.keys(archive.rows).sort(),Object.keys(raw.preimages).sort());for(const [name,rows]of Object.entries(archive.rows)){assert(Array.isArray(rows));assert.equal(rows.length,raw.preimages[name].rows);}
  const restore=values.archiveRestore;assert.equal(restore.status,'passed');assert.equal(restore.scope,'local-real-retired-row-archive-restore');assert.equal(restore.sourceDumpHash,raw.sourceDumpHash);assert.equal(restore.archiveHash,raw.archiveHash);assert.deepEqual(restore.preimages,raw.preimages);
  assert.deepEqual(tableFingerprints(values.retainedBefore),tableFingerprints(values.retainedAfter));assert.deepEqual(restore.allRetainedTables,values.retainedBefore);assert.equal(raw.retainedTableCount,Object.keys(values.retainedBefore).length);
  const pair=values.readerPair;passed(pair);assert.equal(pair.kind,'local-actual-image-readers-after-retirement');assert.equal(pair.localOnly,true);assert.equal(pair.deployable,false);assert.equal(pair.actualImageReadersProven,true);assert.equal(pair.actualApplicationRollbackPairAccepted,false);assert.equal(pair.releaseProtocolIntegrated,false);
  assert.equal(pair.originalSourceUnchanged,true);assert.equal(pair.sqlSourceUnchanged,true);assert.equal(pair.helperSourceUnchanged,true);assert.equal(pair.fingerprintTimezone,'UTC');assert.equal(pair.paidProviderRequests,0);
  assert.equal(pair.sourceDumpHash,raw.sourceDumpHash);assert.equal(pair.sqlSourceHash,raw.sqlSourceHash);assert.equal(pair.archiveRestoreReportHash,raw.archiveRestoreReportHash);
  assert.deepEqual(pair.checks.map(c=>[c.generation??null,c.id]),retirementReaderChecks);assert(pair.checks.every(c=>c.status==='passed'));
  const candidate=values.candidate,active=values.active;validateManifest(candidate.manifest);validateActive(active);
  assert.equal(candidate.status,'candidate-only');assert.equal(candidate.deployable,false);assert.equal(candidate.provenance.manifestHash,evidenceHash(candidate.manifest));assert.equal(candidate.provenance.sourceCommit,candidate.manifest.releaseCommit);
  assert.equal(candidate.manifest.previousReleaseId,active.manifest.releaseId);
  const expectedCurrentMigrations=(active.database?.migrationSet??active.manifest.migrationSet).map(row=>row.id).sort();
  assert.equal(raw.priorMigrationCount,expectedCurrentMigrations.length);
  for(const c of pair.checks.filter(c=>c.id==='image-contract')){
   const manifest=c.generation==='candidate'?candidate.manifest:active.manifest;
   const state=c.generation==='candidate'?{schemaVersion:1,status:'active',manifest,instances:Object.fromEntries(Object.keys(manifest.components).map(k=>[k,{releaseId:manifest.releaseId,releaseCommit:manifest.releaseCommit}]))}:active;
   const services=Object.fromEntries(Object.keys(manifest.components).map(k=>[k,{healthy:true,imageDigest:c.images[k],identity:c.identities[k]}]));assertServiceIdentities(state,services);
  }
  assert.equal(hash(await readFile(backupFile(directory,'retirement-bundle.json'))),hash(bytes));
  const request={schemaVersion:1,kind:'retire-character-generations-302',backupHash:raw.sourceDumpHash,archiveRestoreReportHash:raw.archiveRestoreReportHash,acceptedRollbackPairHash:bundle.artifacts.readerPair.sha256,preimages:structuredClone(raw.preimages)};
  const plan=frozen({schemaVersion:1,kind:'verified-local-retirement-plan',profileId:retirementProfile.id,migrationId:retirementProfile.migrationId,mode:retirementProfile.mode,productionReady:false,productionExecutionSupported:false,bundleHash:hash(bytes),sqlSourceHash:raw.sqlSourceHash,request,candidateSource:candidate.manifest.releaseCommit,previousSource:active.manifest.releaseCommit,expectedCurrentMigrations,retainedFingerprints:structuredClone(values.retainedBefore),retainedTables:raw.retainedTableCount});
  verifiedPlans.set(plan,{directory,files,bundle:structuredClone(bundle),source:Buffer.from(source),request:structuredClone(request)});return plan;
 }catch{throw Error('Local retirement artifact verification refused');}
}

// Only same-process verified plans can become SQL. Execution/target ownership
// belongs to the separate native-test executor, never to a serialized JSON flag.
export async function localRetirementProgram(plan){
 const proof=verifiedPlans.get(plan);if(!proof)throw Error('Live verified local retirement plan required');
 assert.equal(hash(await readFile(backupFile(proof.directory,'retirement-bundle.json'))),plan.bundleHash);
 for(const kind of artifactKinds)assert.equal(await checksum(backupFile(proof.directory,proof.bundle.artifacts[kind].path)),proof.bundle.artifacts[kind].sha256);
 assert.equal(hash(await readFile(new URL('../../backend/migrations/data/retire-legacy-characters-302.sql',import.meta.url))),plan.sqlSourceHash);
 return proof.source.toString('utf8').replace(":'retirement_request'","'"+JSON.stringify(proof.request).replaceAll("'","''")+"'");
}
