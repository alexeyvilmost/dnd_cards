// Persist read-only observations of a retirement already performed by the
// separate explicit executor. This module never executes or authorizes DDL.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {evidenceHash,validateManifest,validateMigrationSet} from './validate-manifest.mjs';
export const retirementMigrationId='302_retire_legacy_characters';
export const retirementSQLHash='sha256:'+createHash('sha256').update(readFileSync(new URL('../../backend/migrations/data/retire-legacy-characters-302.sql',import.meta.url))).digest('hex');
const same=(a,b)=>evidenceHash(a)===evidenceHash(b);
const hash=v=>typeof v==='string'&&/^sha256:[a-f0-9]{64}$/.test(v);
const image=v=>typeof v==='string'&&/^[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}$/.test(v)&&!v.split('@')[0].split('/').at(-1).includes(':');
function exact(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||!same(Object.keys(value).sort(),[...keys].sort()))throw Error('Unexpected retirement state fields');}
export function validateRetirementInspectionRequest(request){
 exact(request,['schemaVersion','kind','releaseId','expectedCurrent','sqlSourceHash','expectedAdditiveSchemaProofHash','receiptHash','retirement','candidateSourceCommit','candidateInputFingerprint']);
 if(request.schemaVersion!==1||request.kind!=='inspect-character-retirement-302'||!/^([A-Za-z0-9][A-Za-z0-9_.-]{0,127})$/.test(request.releaseId??'')
   ||request.sqlSourceHash!==retirementSQLHash||!hash(request.expectedAdditiveSchemaProofHash)||!hash(request.receiptHash)||!/^[a-f0-9]{40}$/.test(request.candidateSourceCommit??'')||!hash(request.candidateInputFingerprint))throw Error('Invalid retirement inspection identity');
 validateMigrationSet(request.expectedCurrent);
 exact(request.retirement,['schemaVersion','kind','backupHash','archiveRestoreReportHash','acceptedRollbackPairHash','preimages']);
 const r=request.retirement;if(r.schemaVersion!==1||r.kind!=='retire-character-generations-302'||![r.backupHash,r.archiveRestoreReportHash,r.acceptedRollbackPairHash].every(hash))throw Error('Invalid original retirement request');
 exact(r.preimages,['characters','characters_v2','retired_inventories','retired_items']);for(const row of Object.values(r.preimages)){exact(row,['rows','sha256']);if(!Number.isSafeInteger(row.rows)||row.rows<0||!hash(row.sha256))throw Error('Invalid retirement row preimage');}
 const row=request.expectedCurrent.find(row=>row.id===retirementMigrationId);if(!same(row,{id:retirementMigrationId,checksum:retirementSQLHash}))throw Error('Exact installed retirement identity required');
 return request;
}
export function validateRetirementDatabaseState(active){
 const d=active.database;exact(d,['schemaVersion','status','migrationSet','baselineMigrationSet','schemaProofHash','approvalHash','request','executorImageDigest']);
 if(d.schemaVersion!==2||d.status!=='verified-character-retirement'||!hash(d.schemaProofHash)||!hash(d.approvalHash)||!image(d.executorImageDigest))throw Error('Invalid persisted retirement observation');
 validateRetirementInspectionRequest(d.request);validateMigrationSet(d.migrationSet);validateMigrationSet(d.baselineMigrationSet);
 if(!d.baselineMigrationSet.length||d.baselineMigrationSet.some(row=>row.id===retirementMigrationId)||!same(d.request.expectedCurrent,d.migrationSet)
   ||!same(d.migrationSet,[...d.baselineMigrationSet,{id:retirementMigrationId,checksum:retirementSQLHash}]))throw Error('Retirement state removed, changed or introduced another migration');
 for(const row of active.manifest.migrationSet)if(!d.migrationSet.some(item=>same(row,item)))throw Error('Application expects a migration absent from retired database');
 return d;
}
export function assertRetirementInspectionResult(database,receipt){
 validateRetirementInspectionRequest(database.request);const r=receipt?.result,request=database.request;
 if(receipt?.schemaVersion!==1||receipt.status!=='verified'||r?.schemaVersion!==1||r.status!=='verified'||r.releaseId!==request.releaseId
   ||!same(r.observedVersions,request.expectedCurrent.map(row=>row.id).sort())||r.sqlSourceHash!==request.sqlSourceHash||r.receiptHash!==request.receiptHash
   ||!hash(r.schemaProofHash)||!same(r.applied,[])||typeof r.rollbackReadersSafe!=='boolean'
   ||receipt.build?.provenance!=='baked'||receipt.build.sourceCommit!==request.candidateSourceCommit||receipt.build.inputFingerprint!==request.candidateInputFingerprint
   ||database.schemaProofHash!==undefined&&database.schemaProofHash!==r.schemaProofHash)throw Error('Retirement inspection is incomplete or belongs to another accepted observation');
 return r;
}
export function retirementDatabaseStateFromInspection({active,executorManifest,approvalHash,request},receipt){
 validateManifest(active.manifest);validateManifest(executorManifest);validateRetirementInspectionRequest(request);
 const backend=executorManifest.components.backend;
 if(backend.sourceCommit!==request.candidateSourceCommit||backend.inputFingerprint!==request.candidateInputFingerprint||!hash(approvalHash))throw Error('Inspection executor differs from exact baked backend manifest');
 const result=assertRetirementInspectionResult({request},receipt);
 if(active.database?.status==='verified-character-retirement'){
  const old=validateRetirementDatabaseState(active);
  if(!same(old.request,request)||old.approvalHash!==approvalHash||old.executorImageDigest!==backend.imageDigest||old.schemaProofHash!==result.schemaProofHash)throw Error('Another retirement observation cannot replace an installed one');
  return structuredClone(old);
 }
 const baseline=active.database?.migrationSet??active.manifest.migrationSet;
 if(active.database?.schemaProofHash!==request.expectedAdditiveSchemaProofHash)throw Error('Retirement must preserve the actually recorded additive schema proof');
 const d={schemaVersion:2,status:'verified-character-retirement',migrationSet:structuredClone(request.expectedCurrent),baselineMigrationSet:structuredClone(baseline),schemaProofHash:result.schemaProofHash,approvalHash,request:structuredClone(request),executorImageDigest:backend.imageDigest};
 validateRetirementDatabaseState({...active,database:d});return d;
}
