// Historical refusal evidence only. This never authorizes a successful rehearsal.
import {evidenceHash} from './validate-manifest.mjs';
import {rehearsalInput} from './candidate-rehearsal.mjs';
import {validateMigrationRehearsal} from './migration-rehearsal.mjs';
const equal=(a,b)=>evidenceHash(a)===evidenceHash(b);
const prefix=['snapshot','migrations','full-candidate-health','image-contract','historical-inventory'];
export function validateReviewedReplayRefusal({candidate,input,report,row,proof}) {
 const actual=rehearsalInput(candidate,input.active,input.backup);
 if(!equal(actual,input)||actual.activeHash!==proof.activeHash||report.schemaVersion!==1
   ||report.kind!=='candidate-rehearsal'||report.execution!=='docker'||report.status!=='failed'
   ||report.failure!=='candidate-rehearsal-failed'||report.failureStage!=='historical-replay'
   ||evidenceHash(report)!==row.rehearsalHash||report.activeHash!==actual.activeHash
   ||report.candidateHash!==actual.candidateHash||report.backupHash!==actual.backupHash
   ||report.compositionFingerprint!==actual.compositionFingerprint||report.releaseId!==actual.manifest.releaseId
   ||!equal(report.checks?.map(check=>check.id),prefix)||report.checks.some(check=>check.status!=='passed')
   ||report.cleanup?.status!=='stopped'||!Array.isArray(report.cleanup.errors)||report.cleanup.errors.length
   ||!Number.isSafeInteger(report.cleanup.resourceCount)||report.cleanup.resourceCount<1
   ||![report.startedAt,report.completedAt,row.observedAt].every(value=>typeof value==='string'&&Number.isFinite(Date.parse(value)))
   ||Date.parse(report.startedAt)>Date.parse(report.completedAt)||Date.parse(report.completedAt)>Date.parse(row.observedAt)
   ||report.migrationFailure!==undefined)throw Error('Reviewed historical replay refusal differs');
 const checks=Object.fromEntries(report.checks.map(check=>[check.id,check]));
 if(checks.snapshot.backupHash!==actual.backupHash||checks.snapshot.schemaFingerprint!==actual.backup.schemaFingerprint
   ||!equal(checks.migrations.versions,actual.manifest.migrationSet.map(entry=>entry.id).sort())
   ||checks['historical-inventory'].complete!==true||!equal(checks['historical-inventory'].artifactHashes,actual.historicalArtifactHashes))throw Error('Reviewed rehearsal prefix binding differs');
 validateMigrationRehearsal(actual,report.additiveMigrations);
 return {status:'verified-historical-replay-refusal',rehearsalHash:row.rehearsalHash};
}
