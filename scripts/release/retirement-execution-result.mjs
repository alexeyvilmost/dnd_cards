// Validate the explicit command's observation. This does not verify external
// archive/backup/reader evidence, authorize DDL or invoke the executor.
import {evidenceHash} from './validate-manifest.mjs';
import {retirementMigrationId,retirementSQLHash,validateRetirementInspectionRequest,assertRetirementInspectionResult} from './retirement-state.mjs';

const same=(a,b)=>evidenceHash(a)===evidenceHash(b);
function exact(value,keys){
  if(!value||typeof value!=='object'||Array.isArray(value)||!same(Object.keys(value).sort(),[...keys].sort()))throw Error('Unexpected retirement execution fields');
}
const executionKeys=['schemaVersion','kind','releaseId','expectedCurrent','sqlSourceHash','expectedAdditiveSchemaProofHash','retirement','candidateSourceCommit','candidateInputFingerprint'];
function inspectionRequest(request,receiptHash){
  return {...structuredClone(request),kind:'inspect-character-retirement-302',expectedCurrent:[...structuredClone(request.expectedCurrent),{id:retirementMigrationId,checksum:retirementSQLHash}],receiptHash};
}
export function validateRetirementExecutionRequest(request){
  exact(request,executionKeys);
  if(request.kind!=='execute-character-retirement-302'||!Array.isArray(request.expectedCurrent)||!request.expectedCurrent.length||request.expectedCurrent.some(row=>row.id===retirementMigrationId))throw Error('Explicit retirement requires the complete prior migration set');
  validateRetirementInspectionRequest(inspectionRequest(request,'sha256:'+'0'.repeat(64)));
  return request;
}
export function retirementInspectionFromExecution(request,receipt){
  validateRetirementExecutionRequest(request);
  exact(receipt,['schemaVersion','status','result','build']);
  const result=receipt.result;
  exact(result,['schemaVersion','status','releaseId','applied','request','inspection']);
  if(receipt.schemaVersion!==1||receipt.status!=='verified'||result.schemaVersion!==1||result.status!=='verified'||result.releaseId!==request.releaseId
    ||!same(result.applied,[])&&!same(result.applied,[retirementMigrationId]))throw Error('Explicit retirement outcome is unverified or contains another mutation');
  validateRetirementInspectionRequest(result.request);
  if(!same(result.request,inspectionRequest(request,result.request.receiptHash)))throw Error('Explicit retirement returned another accepted request');
  exact(result.inspection,['schemaVersion','status','releaseId','observedVersions','sqlSourceHash','receiptHash','schemaProofHash','applied','rollbackReadersSafe']);
  const observed={schemaVersion:1,status:'verified',result:structuredClone(result.inspection),build:{provenance:receipt.build?.provenance,sourceCommit:receipt.build?.sourceCommit,inputFingerprint:receipt.build?.inputFingerprint}};
  assertRetirementInspectionResult({request:result.request},observed);
  return {request:structuredClone(result.request),inspection:observed};
}
