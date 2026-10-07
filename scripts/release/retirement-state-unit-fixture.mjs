// Synthetic metadata for state/adapter boundary tests; no SQL or image proof.
import {retirementSQLHash,retirementMigrationId} from './retirement-state.mjs';
export const retirementUnitHash=c=>'sha256:'+c.repeat(64);
export function retirementStateUnitFixture(){
 const h=retirementUnitHash,manifest={schemaVersion:1,releaseId:'old',releaseCommit:'a'.repeat(40),previousReleaseId:null,createdAt:'2026-10-04T10:00:00Z',
  components:Object.fromEntries(['frontend','backend','rulesWorker'].map((key,i)=>[key,{sourceCommit:'a'.repeat(40),inputFingerprint:h(String(i+1)),imageDigest:`example.test/${key.toLowerCase()}@${h(String(i+4))}`} ])),
  rulesArtifactHash:h('a'),contentManifestHash:h('b'),apiProtocolVersion:1,workerProtocolVersion:1,supportedWorldSchemaVersions:[5],workerRuntime:{name:'node',version:'24.19.0'},capabilities:['pinned-artifact-routing','pending-decision-pass-through'],
  migrationSet:[{id:'001',checksum:h('c')},...['298_compact_command_receipts','299_frozen_combat_catalogs','300_image_jobs'].map(id=>({id,checksum:h('d')}))],
  validationEvidence:[{gate:'core',status:'passed',reportHash:h('e'),inputFingerprint:h('f'),completedAt:'2026-10-04T10:00:00Z'}]};
 const active={schemaVersion:1,status:'active',manifest,instances:Object.fromEntries(Object.keys(manifest.components).map(key=>[key,{releaseId:'old',releaseCommit:manifest.releaseCommit}]))};
 active.database={schemaVersion:1,status:'verified-additive',migrationSet:structuredClone(manifest.migrationSet),schemaProofHash:h('7'),approvalHash:h('8'),executorImageDigest:manifest.components.backend.imageDigest,
  request:{schemaVersion:1,releaseId:'prior-expansion',expectedCurrent:[structuredClone(manifest.migrationSet[0])],target:structuredClone(manifest.migrationSet),candidateSourceCommit:manifest.components.backend.sourceCommit,candidateInputFingerprint:manifest.components.backend.inputFingerprint}};
 const executorManifest=structuredClone(manifest);executorManifest.releaseId='retirement-inspector';executorManifest.releaseCommit='b'.repeat(40);executorManifest.previousReleaseId='old';
 Object.assign(executorManifest.components.backend,{sourceCommit:'b'.repeat(40),inputFingerprint:h('9'),imageDigest:`example.test/backend@${h('0')}`});
 const request={schemaVersion:1,kind:'inspect-character-retirement-302',releaseId:executorManifest.releaseId,expectedCurrent:[...structuredClone(manifest.migrationSet),{id:retirementMigrationId,checksum:retirementSQLHash}],sqlSourceHash:retirementSQLHash,expectedAdditiveSchemaProofHash:active.database.schemaProofHash,receiptHash:h('1'),
  retirement:{schemaVersion:1,kind:'retire-character-generations-302',backupHash:h('2'),archiveRestoreReportHash:h('3'),acceptedRollbackPairHash:h('4'),preimages:Object.fromEntries(['characters','characters_v2','retired_inventories','retired_items'].map((key,i)=>[key,{rows:i+1,sha256:h('5')}]))},candidateSourceCommit:executorManifest.components.backend.sourceCommit,candidateInputFingerprint:executorManifest.components.backend.inputFingerprint};
 const inspection={schemaVersion:1,status:'verified',result:{schemaVersion:1,status:'verified',releaseId:request.releaseId,observedVersions:request.expectedCurrent.map(row=>row.id).sort(),sqlSourceHash:retirementSQLHash,receiptHash:request.receiptHash,schemaProofHash:h('6'),applied:[],rollbackReadersSafe:true},build:{provenance:'baked',sourceCommit:request.candidateSourceCommit,inputFingerprint:request.candidateInputFingerprint}};
 return {active,executorManifest,request,inspection,approvalHash:h('e')};
}
export function retirementExecutionUnitFixture(){
 const f=retirementStateUnitFixture(),inspectionRequest=structuredClone(f.request);
 delete f.request.receiptHash;f.request.kind='execute-character-retirement-302';f.request.expectedCurrent=structuredClone(f.active.database.migrationSet);
 f.execution={schemaVersion:1,status:'verified',build:structuredClone(f.inspection.build),result:{schemaVersion:1,status:'verified',releaseId:f.request.releaseId,applied:[retirementMigrationId],request:inspectionRequest,inspection:structuredClone(f.inspection.result)}};
 return f;
}
