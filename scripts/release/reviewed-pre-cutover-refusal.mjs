// A terminal, untouched preparation failure is historical evidence only.
// A new capture, rehearsal and deployment plan are still mandatory.
import {evidenceHash} from './validate-manifest.mjs';
import {rehearsalInput,validateRehearsal} from './candidate-rehearsal.mjs';
import {assembleDeploymentBundle} from './assemble-bundle.mjs';
import {planDeployment} from './deploy-state.mjs';
const same=(a,b)=>evidenceHash(a)===evidenceHash(b);
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&same(Object.keys(value).sort(),[...keys].sort());
const date=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const hash=/^sha256:[a-f0-9]{64}$/;
export function validateReviewedPreCutoverRefusal({candidate,input,report,manifest,bundle,operation,row,proof}){
 const expected=rehearsalInput(candidate,input.active,input.backup);
 if(row.stage!=='deployment-pre-cutover-refusal'||!same(expected,input)||input.activeHash!==proof.activeHash
   ||candidate.provenance.sourceCommit!==row.controlCommit||candidate.provenance.controlCommit!==row.controlCommit
   ||!same(candidate.provenance.firstAdoptionRecovery,row.recoveryReference)||input.localOnly!==undefined
   ||evidenceHash(report)!==row.rehearsalHash)throw Error('Reviewed preparation rehearsal binding differs');
 validateRehearsal(input,report);
 if(!same(assembleDeploymentBundle(candidate,input,report),{manifest,bundle})||manifest.releaseId!==row.releaseId
   ||manifest.releaseCommit!==row.controlCommit)throw Error('Reviewed ready bundle differs from its original assembly');
 const plan=planDeployment(manifest,bundle,input.active);
 if(!exact(operation,['schemaVersion','releaseId','status','plan','touched','createdAt','updatedAt','backup','failure'])
   ||operation.schemaVersion!==1||operation.releaseId!==row.releaseId||operation.status!=='failed_before_cutover'
   ||!same(operation.touched,[])||operation.failure!=='docker-step-failed'||!same(operation.plan,plan)
   ||evidenceHash(operation)!==row.operationHash)throw Error('Reviewed journal is not its exact untouched terminal preparation');
 const backup=operation.backup;
 if(!exact(backup,['status','manifestHash','backupHash','restoreReportHash','restoreDrillPassed'])
   ||backup.status!=='verified'||backup.manifestHash!==input.activeHash||backup.backupHash!==input.backupHash
   ||!hash.test(backup.restoreReportHash??'')||backup.restoreDrillPassed!==true)throw Error('Reviewed preparation backup differs');
 if(![report.startedAt,report.completedAt,operation.createdAt,operation.updatedAt,row.observedAt].every(date)
   ||Date.parse(report.startedAt)>Date.parse(report.completedAt)||Date.parse(report.completedAt)>Date.parse(operation.createdAt)
   ||Date.parse(operation.createdAt)>Date.parse(operation.updatedAt)||Date.parse(operation.updatedAt)>Date.parse(row.observedAt))throw Error('Reviewed preparation chronology differs');
 return {status:'verified-terminal-preparation-refusal',operationHash:row.operationHash,rehearsalHash:row.rehearsalHash};
}
