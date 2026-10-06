// Offline validation of safe observations produced by executable adapters.
// A well-formed unit trace is never evidence of actual execution by itself.
import {evidenceHash,compositionFingerprint,requiredWriterOutcomes} from './validate-manifest.mjs';
import {validateHostedWriterConsumption,assertHostedWriterPublication} from './writer-browser-consumption.mjs';
const hash=/^sha256:[a-f0-9]{64}$/;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const same=(a,b)=>evidenceHash(a)===evidenceHash(b);
function requireThat(value,message){if(!value)throw Error(message);}
function exact(value,keys){requireThat(value&&typeof value==='object'&&!Array.isArray(value)&&same(Object.keys(value).sort(),[...keys].sort()),'Unexpected trace fields');}
function hashes(row,keys){for(const key of keys)requireThat(hash.test(row[key]),'Missing trace hash');}
function ids(rows,expected){requireThat(Array.isArray(rows)&&same(rows.map(r=>r.id),expected),'Incomplete trace observations');}
export function writerTraceBinding(manifest,check,receipt) {
  return {compositionFingerprint:compositionFingerprint(manifest),activeHash:receipt.activeHash,runId:receipt.runId,
    writerPolicy:check.writerPolicy,candidate:check.candidate,previous:check.previous,executionProfile:check.executionProfile};
}
export function validateWriterTrace(trace,id,binding) {
  if(trace?.kind==='verified-hosted-writer-trace'){
    requireThat(id==='frontend-pending-job-reload','Hosted proof may only supply the browser subgate');
    return validateHostedWriterConsumption(trace,binding,validateWriterTrace);
  }
  exact(trace,['schemaVersion','kind','execution','outcomeId','bindingHash','observations',...(id==='compact-receipt-cross-image-retry'?['schemaFaults','triggerFaults']:id==='image-job-cross-image-retry'?['leaseFixture']:[])]);
  requireThat(trace.schemaVersion===1&&trace.kind==='writer-compatibility-trace'&&trace.execution==='docker'&&trace.outcomeId===id&&trace.bindingHash===evidenceHash(binding),'Writer trace belongs to another execution');
  const rows=trace.observations;
  const required=requiredWriterOutcomes({writerPolicy:binding.writerPolicy},binding.previous?.state.manifest,binding.previous?.identities);
  const formats={compactReceipts:required.includes('compact-receipt-cross-image-retry'),imageJobs:required.includes('image-job-cross-image-retry'),frozenCatalogs:false};
  if(id==='compact-receipt-cross-image-retry'){
    ids(rows,['roguelike_command_receipts','character_runtime_commands']);
    requireThat(Array.isArray(trace.schemaFaults)&&same(trace.schemaFaults.map(row=>row.table),['roguelike_command_receipts','character_runtime_commands']),'Both owned schema fault restorations required');
    for(const fault of trace.schemaFaults){
      exact(fault,['table','id','constraintName','definitionHash','constraintRejected','injectedVersion','restored']);
      requireThat(fault.id==='version'&&fault.constraintName===`${fault.table}_storage_version`&&fault.constraintRejected===true&&fault.injectedVersion===99&&fault.restored===true,'Version fault did not preserve the exact enforced schema');
      hashes(fault,['definitionHash']);
    }
    requireThat(Array.isArray(trace.triggerFaults)&&trace.triggerFaults.length===1,'Owned append-only trigger fault proof required');
    const trigger=trace.triggerFaults[0];
    exact(trigger,['table','triggerName','definitionHash','mutationRejected','scope','restored']);
    requireThat(trigger.table==='character_runtime_commands'&&trigger.triggerName==='character_runtime_commands_append_only'&&trigger.mutationRejected===true&&trigger.scope==='owned-transaction-only'&&trigger.restored===true,'Receipt immutability was not restored');
    hashes(trigger,['definitionHash']);
    for(const row of rows){
      exact(row,['id','commandId','requestHash','responseHash','storage','reads','offWrite','corruptions']);
      requireThat(uuid.test(row.commandId),'Invalid receipt command');hashes(row,['requestHash','responseHash']);
      exact(row.storage,['version','rawLength','encodedLength','rawSHA256','decodedSHA256','rowHash']);
      requireThat(row.storage.version===2&&Number.isSafeInteger(row.storage.rawLength)&&row.storage.rawLength>=1024&&row.storage.rawLength<=64*1024**2&&Number.isSafeInteger(row.storage.encodedLength)&&row.storage.encodedLength>0&&row.storage.encodedLength+128<row.storage.rawLength,'Expanded receipt not produced');
      hashes(row.storage,['rawSHA256','decodedSHA256','rowHash']);requireThat(row.storage.rawSHA256===row.storage.decodedSHA256,'Receipt codec integrity differs');
      ids(row.reads,['candidate-retry','candidate-restart-retry','previous-off-retry','candidate-return-retry']);
      for(const read of row.reads){exact(read,['id','responseHash','replayed','beforeInvariantHash','afterInvariantHash','storageHash','workerCallsBefore','workerCallsAfter']);hashes(read,['responseHash','beforeInvariantHash','afterInvariantHash','storageHash']);
        requireThat(read.replayed===(row.id==='character_runtime_commands'?true:null),'Replay transport marker differs');
        requireThat(read.responseHash===row.responseHash&&read.beforeInvariantHash===read.afterInvariantHash&&read.storageHash===row.storage.rowHash&&Number.isSafeInteger(read.workerCallsBefore)&&read.workerCallsBefore>=0&&read.workerCallsBefore===read.workerCallsAfter,'Retry changed accepted response, storage, world, or worker work');}
      exact(row.offWrite,['commandId','version','responseHash','readbackHash','replayed','beforeInvariantHash','afterInvariantHash','workerCallsBefore','workerCallsAfter']);requireThat(uuid.test(row.offWrite.commandId)&&row.offWrite.commandId!==row.commandId&&row.offWrite.version===1&&row.offWrite.replayed===(row.id==='character_runtime_commands'?true:null),'OFF writer did not produce/replay a new legacy receipt');hashes(row.offWrite,['responseHash','readbackHash','beforeInvariantHash','afterInvariantHash']);requireThat(row.offWrite.responseHash===row.offWrite.readbackHash&&row.offWrite.beforeInvariantHash===row.offWrite.afterInvariantHash&&Number.isSafeInteger(row.offWrite.workerCallsBefore)&&row.offWrite.workerCallsBefore>=0&&row.offWrite.workerCallsBefore===row.offWrite.workerCallsAfter,'New OFF receipt retry differs');
      ids(row.corruptions,['length','hash','version']);
      for(const fault of row.corruptions){exact(fault,['id','httpStatus','beforeInvariantHash','afterInvariantHash','restoredStorageHash','workerCallsBefore','workerCallsAfter']);requireThat(fault.httpStatus>=400&&fault.httpStatus<600,'Corrupt receipt was accepted');hashes(fault,['beforeInvariantHash','afterInvariantHash','restoredStorageHash']);requireThat(fault.beforeInvariantHash===fault.afterInvariantHash&&fault.restoredStorageHash===row.storage.rowHash&&Number.isSafeInteger(fault.workerCallsBefore)&&fault.workerCallsBefore>=0&&fault.workerCallsBefore===fault.workerCallsAfter,'Corrupt receipt mutated gameplay, reran worker or failed to restore exact bytes');}
    }
  }else if(id==='image-job-cross-image-retry'){
    ids(rows,['queued','succeeded','unknown','expired-running']);
    exact(trace.leaseFixture,['jobId','mode','stateBefore','stateAfter','leaseExpired','providerCallsBefore','providerCallsAfter']);
    requireThat(trace.leaseFixture.jobId===rows[3].jobId&&trace.leaseFixture.mode==='owned-expired-lease-after-process-stop'&&trace.leaseFixture.stateBefore==='running'&&trace.leaseFixture.stateAfter==='running'&&trace.leaseFixture.leaseExpired===true&&Number.isSafeInteger(trace.leaseFixture.providerCallsBefore)&&trace.leaseFixture.providerCallsBefore>=0&&trace.leaseFixture.providerCallsBefore===trace.leaseFixture.providerCallsAfter,'Lease fixture changed job outcome or dispatched work');
    for(const row of rows){exact(row,['id','jobId','statusBefore','statusAfterOff','providerBefore','providerAfterOff','providerAfterRetry','sameOwnerStatus','otherOwnerStatus','newJobOffStatus','newJobOffOutcome','statusAfterOffRestart','providerAfterOffRestart']);
      requireThat(uuid.test(row.jobId)&&row.statusBefore===(row.id==='expired-running'?'running':row.id)&&row.statusAfterOff===(row.id==='expired-running'?'unknown':row.id),'Incorrect job continuation policy');
      requireThat(Number.isSafeInteger(row.providerBefore)&&row.providerBefore>=0&&row.providerBefore===row.providerAfterOff&&row.providerBefore===row.providerAfterRetry&&row.providerBefore===row.providerAfterOffRestart&&row.statusAfterOffRestart===row.statusAfterOff,'OFF, retry or process restart changed a provider job');
      requireThat(row.sameOwnerStatus===200&&[403,404].includes(row.otherOwnerStatus)&&row.newJobOffStatus>=400&&row.newJobOffOutcome==='not_started','Job ownership or OFF admission was bypassed');}
    requireThat(new Set(rows.map(r=>r.jobId)).size===rows.length,'Job cases reuse a single outcome');
  }else if(id==='frontend-pending-job-reload'){
    ids(rows,['candidate-ui','previous-ui']);
    for(const row of rows){exact(row,['id','jobIdBefore','jobIdAfterReload','jobIdAfterOff','capabilityOff','jobRequests','syncRequests','providerCallsBefore','providerCallsAfter']);
      requireThat(uuid.test(row.jobIdBefore)&&row.jobIdBefore===row.jobIdAfterReload&&row.jobIdBefore===row.jobIdAfterOff&&row.capabilityOff===false,'Browser lost accepted job identity on reload/OFF');
      requireThat(Number.isSafeInteger(row.jobRequests)&&row.jobRequests>0&&row.syncRequests===0&&Number.isSafeInteger(row.providerCallsBefore)&&row.providerCallsBefore>=0&&row.providerCallsBefore===row.providerCallsAfter,'Browser fell back to a new paid request');}
  }else if(id==='expanded-data-dump-restore'){
    ids(rows,['expanded-snapshot']);const row=rows[0];exact(row,['id','dumpHash','before','after','retryResponseHash','restoredRetryResponseHash']);hashes(row,['dumpHash','retryResponseHash','restoredRetryResponseHash']);
    for(const side of ['before','after']){exact(row[side],['receiptsHash','jobsHash','artifactClosureHash','sourceCertificationClosureHash','v2Receipts','imageJobs']);hashes(row[side],['receiptsHash','jobsHash','artifactClosureHash','sourceCertificationClosureHash']);requireThat(Number.isSafeInteger(row[side].v2Receipts)&&Number.isSafeInteger(row[side].imageJobs)&&row[side].v2Receipts>=0&&row[side].imageJobs>=0,'Missing restored row counts');}
    requireThat((!formats.compactReceipts||row.before.v2Receipts>=2)&&(!formats.imageJobs||row.before.imageJobs>=4),'Restore omits a required persisted format');
    requireThat(same(row.before,row.after)&&row.before.v2Receipts+row.before.imageJobs>0&&row.retryResponseHash===row.restoredRetryResponseHash,'Dump/restore changed expanded bytes or replay');
  }else if(id==='enabled-off-enabled-rollback'){
    ids(rows,['enabled','previous-off','enabled-again']);
    for(const row of rows){exact(row,['id','backendImage','effectivePolicy','receiptResponseHash','jobIdentityHash']);hashes(row,['receiptResponseHash','jobIdentityHash']);requireThat(row.backendImage===(row.id==='previous-off'?binding.previous?.images.backend:binding.candidate.images.backend),'Rollback used another image');}
    const off={compactReceipts:false,imageJobs:false,frozenCatalogs:false};
    requireThat(same(rows[1].effectivePolicy,off)&&same(rows[0].effectivePolicy,rows[2].effectivePolicy)&&same(rows[0].effectivePolicy,formats),'Actual enable/OFF/enable policy sequence absent');
    requireThat(rows.every(row=>row.receiptResponseHash===rows[0].receiptResponseHash&&row.jobIdentityHash===rows[0].jobIdentityHash),'Policy sequence changed persisted identity');
  }else throw Error('Unsupported writer compatibility outcome');
  return trace;
}
export function assertWriterTraces(manifest,check,receipt,expected) {
  requireThat(Array.isArray(check.traces)&&same(check.traces.map(t=>t.outcomeId),expected),'Full ordered writer traces required');
  const binding=writerTraceBinding(manifest,check,receipt);
  for(let i=0;i<expected.length;i++){
    if(expected[i]==='frontend-pending-job-reload')requireThat(check.traces[i].kind==='verified-hosted-writer-trace','Canonical host rehearsal requires a preserved hosted browser execution proof');
    validateWriterTrace(check.traces[i],expected[i],binding);
    if(expected[i]==='frontend-pending-job-reload')assertHostedWriterPublication(check.traces[i],check.writerPublication,manifest);
    requireThat(check.outcomes[i].traceHash===evidenceHash(check.traces[i]),'Writer trace hash differs from persisted observations');
  }
}
