// Local evidence preflight. No production executor or automatic migration.
import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {backupFile,checksum} from './backup-manifest.mjs';
import {validateManifest,validateMigrationSet,evidenceHash} from './validate-manifest.mjs';
import {validateActive,assertServiceIdentities} from './deploy-state.mjs';
const hash=b=>'sha256:'+createHash('sha256').update(b).digest('hex');
const hashPattern=/^sha256:[a-f0-9]{64}$/;
const source=await readFile(new URL('../../backend/migrations/data/retire-legacy-characters-302.sql',import.meta.url));
const lifecycleSourceUrl=new URL('../../backend/migrations/character_lifecycle_301.go',import.meta.url);
const lifecycleIdentity=Object.freeze({id:'301_character_lifecycle',checksum:hash(await readFile(lifecycleSourceUrl))});
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
const orderedMigrations=rows=>[...rows].sort((a,b)=>a.id.localeCompare(b.id));
function localExpansion(raw,pair,expansion,baseline){
 assert.deepEqual(Object.keys(expansion).sort(),['fingerprint','identity','ordinaryMigrationSet','originalLedgerRowsPreserved','repeatApplied','schemaProofHash','sourceCommit','v3AndRunOriginalRowsPreserved']);
 assert.deepEqual(raw.localLifecycleExpansion,expansion);assert.deepEqual(expansion.identity,lifecycleIdentity);
 assert(/^[a-f0-9]{40}$/.test(expansion.sourceCommit));assert.equal(raw.sourceCommit,expansion.sourceCommit);
 assert(hashPattern.test(expansion.fingerprint));assert(hashPattern.test(expansion.schemaProofHash));
 assert.equal(raw.originalCaptureMigrationCount,baseline.length);assert(hashPattern.test(raw.originalCaptureLedgerHash));
 assert.equal(expansion.originalLedgerRowsPreserved,baseline.length);assert.equal(expansion.v3AndRunOriginalRowsPreserved,true);assert.equal(expansion.repeatApplied,0);
 assert(!baseline.some(row=>row.id===lifecycleIdentity.id));validateMigrationSet(expansion.ordinaryMigrationSet);
 const target=[...baseline,lifecycleIdentity];assert.deepEqual(orderedMigrations(expansion.ordinaryMigrationSet),orderedMigrations(target));
 assert.equal(raw.priorMigrationCount,target.length);assert.deepEqual(pair.localLifecycleExpansionIdentity,lifecycleIdentity);
 const linux=pair.actualLinuxExecutor302;assert.equal(linux.status,'passed');assert.equal(linux.sourceCommit,expansion.sourceCommit);
 assert.equal(linux.localDiagnosticBinary,true);assert.equal(linux.publishedExecutor,false);assert.equal(linux.repeatApplied,0);assert(hashPattern.test(linux.receiptHash));
 return target;
}
function publishedExecutor(pair,candidate,active,currentMigrationSet){
 assert.deepEqual(Object.keys(pair.publishedCandidateSourcePair).sort(),['candidate','previous']);
 assert.deepEqual(pair.publishedCandidateSourcePair,{previous:active.manifest.releaseCommit,candidate:candidate.manifest.releaseCommit});
 const backend=candidate.manifest.components.backend,linux=pair.actualLinuxExecutor302;
 assert.deepEqual(Object.keys(linux).sort(),['inputFingerprint','localDiagnosticBinary','publishedExecutor','receiptHash','repeatApplied','sourceCommit','status']);
 assert.equal(linux.status,'passed');assert.equal(linux.localDiagnosticBinary,false);assert.equal(linux.publishedExecutor,true);
 assert.equal(linux.sourceCommit,backend.sourceCommit);assert.equal(linux.inputFingerprint,backend.inputFingerprint);
 assert.equal(pair.publishedExecutorImage,backend.imageDigest);assert(hashPattern.test(linux.receiptHash));assert.equal(linux.repeatApplied,0);
 // The local published-reader proof must describe the captured schema. A new
 // ordinary migration needs a fresh capture and reader pair, not this report.
 assert.deepEqual(orderedMigrations(candidate.manifest.migrationSet),orderedMigrations(currentMigrationSet));
 return {...structuredClone(linux),imageDigest:backend.imageDigest};
}

export async function verifyLocalRetirementArtifacts(directory){
 try{
  const bytes=await readFile(backupFile(directory,'retirement-bundle.json'));
  assert(bytes.length<=1024*1024);const bundle=JSON.parse(bytes);
  assert([1,2,3,4].includes(bundle.schemaVersion));assert.equal(bundle.kind,'local-retirement-artifact-bundle');assert.equal(bundle.profileId,retirementProfile.id);
  assert.equal(bundle.mode,retirementProfile.mode);assert.equal(bundle.fingerprintTimezone,'UTC');assert.equal(bundle.productionReady,false);
  const kinds=bundle.schemaVersion===2?[...artifactKinds,'lifecycleExpansion']:bundle.schemaVersion===4?[...artifactKinds,'capturedActive','capture']:artifactKinds;
  assert.deepEqual(Object.keys(bundle.artifacts).sort(),[...kinds].sort());
  const paths=new Set(),files={},values={};
  for(const kind of kinds){
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
  // A fresh snapshot after an ordinary expansion belongs to the installed
  // composition, while rollback readers may come from its predecessor. Keep
  // those identities separate; the old format must not reinterpret old bytes.
  let capturedActive=active;
  if(bundle.schemaVersion===4){
   capturedActive=values.capturedActive;validateActive(capturedActive);
   const capture=values.capture;
   assert.equal(capture.schemaVersion,1);assert.equal(capture.kind,'candidate-capture');assert.equal(capture.status,'captured');
   assert(Number.isFinite(Date.parse(capture.createdAt)));
   assert.equal(capture.activeHash,evidenceHash(capturedActive));
   assert.equal(capture.releaseManifestHash,evidenceHash(capturedActive.manifest));
   assert(Array.isArray(capture.files));
   const dumpFiles=capture.files.filter(row=>row.category==='database'),stateFiles=capture.files.filter(row=>row.category==='deployment-state');
   assert.equal(dumpFiles.length,1);assert.equal(stateFiles.length,1);
   for(const [row,kind]of [[dumpFiles[0],'dump'],[stateFiles[0],'capturedActive']]){
    assert.equal(row.sha256,bundle.artifacts[kind].sha256);assert.equal(row.bytes,bundle.artifacts[kind].bytes);
   }
   assert.equal(pair.captureHash,bundle.artifacts.capture.sha256);
   // assemble-bundle adds the accepted rehearsal evidence to the published
   // candidate. Every identity/compatibility field must still match exactly.
   const {validationEvidence:capturedEvidence,...capturedComposition}=capturedActive.manifest;
   const {validationEvidence:candidateEvidence,...candidateComposition}=candidate.manifest;
   assert.equal(evidenceHash(capturedComposition),evidenceHash(candidateComposition));
   assert.equal(raw.capturedActiveHash,evidenceHash(capturedActive));
   assert.equal(pair.capturedActiveHash,evidenceHash(capturedActive));
   const current=capturedActive.database?.migrationSet??capturedActive.manifest.migrationSet;
   assert.equal(pair.capturedMigrationSetHash,evidenceHash(current));
   // Every migration expected by the old readers remains installed with its
   // original identity. This never proves compatibility by dropping a checksum.
   for(const row of active.manifest.migrationSet)assert(current.some(item=>evidenceHash(item)===evidenceHash(row)));
  }
  const snapshotMigrationSet=capturedActive.database?.migrationSet??capturedActive.manifest.migrationSet;
  let currentMigrationSet=snapshotMigrationSet;
  if(bundle.schemaVersion===2)currentMigrationSet=localExpansion(raw,pair,values.lifecycleExpansion,snapshotMigrationSet);
  else {assert.equal(raw.localLifecycleExpansion,undefined);assert.equal(pair.localLifecycleExpansionIdentity,undefined);assert.equal(raw.priorMigrationCount,snapshotMigrationSet.length);}
  const published=bundle.schemaVersion>=3?publishedExecutor(pair,candidate,active,currentMigrationSet):undefined;
  const expectedCurrentMigrations=currentMigrationSet.map(row=>row.id).sort();
  for(const c of pair.checks.filter(c=>c.id==='image-contract')){
   const manifest=c.generation==='candidate'?candidate.manifest:active.manifest;
   const state=c.generation==='candidate'?{schemaVersion:1,status:'active',manifest,instances:Object.fromEntries(Object.keys(manifest.components).map(k=>[k,{releaseId:manifest.releaseId,releaseCommit:manifest.releaseCommit}]))}:active;
   const services=Object.fromEntries(Object.keys(manifest.components).map(k=>[k,{healthy:true,imageDigest:c.images[k],identity:c.identities[k]}]));assertServiceIdentities(state,services);
  }
  assert.equal(hash(await readFile(backupFile(directory,'retirement-bundle.json'))),hash(bytes));
  const request={schemaVersion:1,kind:'retire-character-generations-302',backupHash:raw.sourceDumpHash,archiveRestoreReportHash:raw.archiveRestoreReportHash,acceptedRollbackPairHash:bundle.artifacts.readerPair.sha256,preimages:structuredClone(raw.preimages)};
  const plan=frozen({schemaVersion:1,kind:'verified-local-retirement-plan',profileId:retirementProfile.id,migrationId:retirementProfile.migrationId,mode:retirementProfile.mode,productionReady:false,productionExecutionSupported:false,bundleHash:hash(bytes),sqlSourceHash:raw.sqlSourceHash,request,candidateSource:candidate.manifest.releaseCommit,previousSource:active.manifest.releaseCommit,expectedCurrentMigrations,snapshotMigrations:snapshotMigrationSet.map(row=>row.id).sort(),...(bundle.schemaVersion===4?{capturedSource:capturedActive.manifest.releaseCommit,capturedActiveHash:evidenceHash(capturedActive)}:{}),...(bundle.schemaVersion===2?{localLifecycleExpansionIdentity:structuredClone(lifecycleIdentity),localExpansionArtifactHash:bundle.artifacts.lifecycleExpansion.sha256}:{}),...(published?{publishedExecutor:published}:{}),retainedFingerprints:structuredClone(values.retainedBefore),retainedTables:raw.retainedTableCount});
  verifiedPlans.set(plan,{directory,files,kinds:[...kinds],bundle:structuredClone(bundle),source:Buffer.from(source),request:structuredClone(request)});return plan;
 }catch{throw Error('Local retirement artifact verification refused');}
}

// Only same-process verified plans can become SQL. Execution/target ownership
// belongs to the separate native-test executor, never to a serialized JSON flag.
export async function recheckLocalRetirementArtifacts(plan){
 const proof=verifiedPlans.get(plan);if(!proof)throw Error('Live verified local retirement plan required');
 assert.equal(hash(await readFile(backupFile(proof.directory,'retirement-bundle.json'))),plan.bundleHash);
 for(const kind of proof.kinds)assert.equal(await checksum(backupFile(proof.directory,proof.bundle.artifacts[kind].path)),proof.bundle.artifacts[kind].sha256);
 if(plan.localLifecycleExpansionIdentity)assert.equal(hash(await readFile(lifecycleSourceUrl)),plan.localLifecycleExpansionIdentity.checksum);
 assert.equal(hash(await readFile(new URL('../../backend/migrations/data/retire-legacy-characters-302.sql',import.meta.url))),plan.sqlSourceHash);
}
export async function localRetirementProgram(plan){
 await recheckLocalRetirementArtifacts(plan);const proof=verifiedPlans.get(plan);
 return proof.source.toString('utf8').replace(":'retirement_request'","'"+JSON.stringify(proof.request).replaceAll("'","''")+"'");
}
