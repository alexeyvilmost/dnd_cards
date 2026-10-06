// Fabricated unit data only. Never persist as actual OCI/release evidence.
import {evidenceHash,requiredWriterOutcomes} from './validate-manifest.mjs';
import {safeExecutionEnvironment} from './ui-execution-profile.mjs';
import {writerBrowserPins} from './writer-browser-consumption.mjs';
import {expectedWriterBrowserProfiles} from './writer-runtime-profile.mjs';
const h=x=>'sha256:'+x.repeat(64);
const id=n=>`${String(n).padStart(8,'0')}-0000-4000-8000-000000000001`;
export function unitWriterPublication(manifest){
 const verifiedReleaseRun={id:1,runAttempt:1,conclusion:'success',workflow:'.github/workflows/release.yml',repository:'unit/example',controlCommit:'c'.repeat(40),event:'workflow_dispatch'};
 return {manifest:structuredClone(manifest),provenance:{schemaVersion:1,releaseRunId:1,controlCommit:verifiedReleaseRun.controlCommit,sourceCommit:manifest.releaseCommit,planHash:h('c'),manifestHash:evidenceHash(manifest)},verifiedReleaseRun};
}
export function unitHostedBrowserTrace(binding,publication){
 const original={...structuredClone(binding),runId:'22222222-2222-4222-8222-222222222222'};
 const provenance=publication?{releaseRunId:publication.provenance.releaseRunId,runAttempt:publication.verifiedReleaseRun.runAttempt,sourceCommit:publication.provenance.sourceCommit,controlCommit:publication.provenance.controlCommit,manifestHash:publication.provenance.manifestHash}:{releaseRunId:1,runAttempt:1,sourceCommit:binding.candidate.identities.backend.releaseCommit,controlCommit:'c'.repeat(40),manifestHash:h('d')};
 const proof={schemaVersion:1,kind:'writer-browser-oci-proof',status:'passed',execution:'docker',binding:original,trace:unitWriterTrace('frontend-pending-job-reload',original),provenance,cleanup:{status:'stopped',errors:[]},executionProfile:expectedWriterBrowserProfiles(binding),browserRuntime:{kind:'playwright-bundled-chromium',...writerBrowserPins,executableSHA256:h('f'),runnerOS:'linux',architecture:'x64'}};
 return {schemaVersion:1,kind:'verified-hosted-writer-trace',execution:'hosted-proof-consumption',outcomeId:'frontend-pending-job-reload',consumptionBindingHash:evidenceHash(binding),verifiedReleaseRunHash:publication?evidenceHash(publication.verifiedReleaseRun):h('e'),proofHash:evidenceHash(proof),proof};
}
export function unitWriterTrace(outcomeId,binding){
  let observations;const required=requiredWriterOutcomes({writerPolicy:binding.writerPolicy},binding.previous?.state.manifest,binding.previous?.identities);
  if(outcomeId==='compact-receipt-cross-image-retry')observations=['roguelike_command_receipts','character_runtime_commands'].map((table,i)=>({id:table,commandId:id(i+1),requestHash:h('1'),responseHash:h('2'),storage:{version:2,rawLength:4096,encodedLength:256,rawSHA256:h('3'),decodedSHA256:h('3'),rowHash:h('4')},
    reads:['candidate-retry','candidate-restart-retry','previous-off-retry','candidate-return-retry'].map(id=>({id,responseHash:h('2'),replayed:table==='character_runtime_commands'?true:null,beforeInvariantHash:h('5'),afterInvariantHash:h('5'),storageHash:h('4'),workerCallsBefore:2,workerCallsAfter:2})),offWrite:{commandId:id(i+11),version:1,responseHash:h('6'),readbackHash:h('6'),replayed:table==='character_runtime_commands'?true:null,beforeInvariantHash:h('7'),afterInvariantHash:h('7'),workerCallsBefore:3,workerCallsAfter:3},
    corruptions:['length','hash','version'].map(id=>({id,httpStatus:500,beforeInvariantHash:h('5'),afterInvariantHash:h('5'),restoredStorageHash:h('4'),workerCallsBefore:5,workerCallsAfter:5}))}));
  else if(outcomeId==='image-job-cross-image-retry')observations=['queued','succeeded','unknown','expired-running'].map((phase,i)=>({id:phase,jobId:id(i+21),statusBefore:phase==='expired-running'?'running':phase,statusAfterOff:phase==='expired-running'?'unknown':phase,providerBefore:phase==='queued'?0:1,providerAfterOff:phase==='queued'?0:1,providerAfterRetry:phase==='queued'?0:1,sameOwnerStatus:200,otherOwnerStatus:404,newJobOffStatus:503,newJobOffOutcome:'not_started',statusAfterOffRestart:phase==='expired-running'?'unknown':phase,providerAfterOffRestart:phase==='queued'?0:1}));
  else if(outcomeId==='frontend-pending-job-reload')observations=['candidate-ui','previous-ui'].map(phase=>({id:phase,jobIdBefore:id(30),jobIdAfterReload:id(30),jobIdAfterOff:id(30),capabilityOff:false,jobRequests:2,syncRequests:0,providerCallsBefore:1,providerCallsAfter:1}));
  else if(outcomeId==='expanded-data-dump-restore'){const snapshot={receiptsHash:h('1'),jobsHash:h('2'),artifactClosureHash:h('3'),sourceCertificationClosureHash:h('4'),v2Receipts:2,imageJobs:4};observations=[{id:'expanded-snapshot',dumpHash:h('a'),before:snapshot,after:structuredClone(snapshot),retryResponseHash:h('b'),restoredRetryResponseHash:h('b')}];}
  else if(outcomeId==='enabled-off-enabled-rollback')observations=['enabled','previous-off','enabled-again'].map(phase=>({id:phase,backendImage:phase==='previous-off'?binding.previous.images.backend:binding.candidate.images.backend,effectivePolicy:{compactReceipts:phase!=='previous-off'&&required.includes('compact-receipt-cross-image-retry'),imageJobs:phase!=='previous-off'&&required.includes('image-job-cross-image-retry'),frozenCatalogs:false},receiptResponseHash:h('1'),jobIdentityHash:h('2')}));
  else throw Error('Unknown unit trace');
  return {schemaVersion:1,kind:'writer-compatibility-trace',execution:'docker',outcomeId,bindingHash:evidenceHash(binding),observations,
    ...(outcomeId==='compact-receipt-cross-image-retry'?{schemaFaults:['roguelike_command_receipts','character_runtime_commands'].map(table=>({table,id:'version',constraintName:`${table}_storage_version`,definitionHash:h('7'),constraintRejected:true,injectedVersion:99,restored:true})),triggerFaults:[{table:'character_runtime_commands',triggerName:'character_runtime_commands_append_only',definitionHash:h('8'),mutationRejected:true,scope:'owned-transaction-only',restored:true}]}:{}),
    ...(outcomeId==='image-job-cross-image-retry'?{leaseFixture:{jobId:id(24),mode:'owned-expired-lease-after-process-stop',stateBefore:'running',stateAfter:'running',leaseExpired:true,providerCallsBefore:3,providerCallsAfter:3}}:{})};
}
