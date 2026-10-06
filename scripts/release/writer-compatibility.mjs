import {assertWriterCompatibility,writerCompatibilityRequirements,evidenceHash,compositionFingerprint,writerPolicy} from './validate-manifest.mjs';
import {writerTraceBinding,validateWriterTrace} from './writer-traces.mjs';
import {assertRuntimeWriterPolicy} from './writer-environment.mjs';
import {assertRetainedWriterHistory} from './writer-retained-history.mjs';
import {writerPublication} from './writer-browser-consumption.mjs';
import {retirementWriterBaseline} from './candidate-rehearsal.mjs';

/** Collect executable traces, never accept an arbitrary external receipt file.
 * All required drivers are checked BEFORE any probe. Absent drivers refuse the
 * stage; consumers cannot substitute an eight-stage OFF report for ON.
 */
export async function collectWriterCompatibility(input,io,{runId}) {
  const before=await io.observeCandidate();
  assertRuntimeWriterPolicy(before.environment,{manifest:input.manifest});
  const previous=input.previousManifest?await io.observePrevious():null;
  const check={id:'writer-compatibility',status:'passed',compositionFingerprint:compositionFingerprint(input.manifest),writerPolicy:writerPolicy(input.manifest),
    candidate:{images:before.images,identities:before.identities},previous:previous?{state:input.active,images:previous.images,identities:previous.identities}:null,
    executionProfile:{candidate:before.executionProfile,previous:previous?.executionProfile??null},outcomes:[],traces:[]};
  if(previous)assertRuntimeWriterPolicy(previous.environment,input.active);
  const receipt={runId,activeHash:input.activeHash,backupHash:input.backupHash},binding=writerTraceBinding(input.manifest,check,receipt);
  const bundle={previousManifest:input.previousManifest,images:before.images,identities:before.identities,rehearsalReceipt:receipt,...retirementWriterBaseline(input)};
  const required=writerCompatibilityRequirements(input.manifest,bundle,check);
  if(required.includes('frontend-pending-job-reload'))check.writerPublication=writerPublication(input.publishedCandidate,input.verifiedReleaseRun);
  for(const id of required)if(typeof io.drivers?.[id]!=='function')throw Object.assign(Error('Executable writer outcome adapter is not implemented'),{code:'WRITER_PROBE_UNAVAILABLE',outcomeId:id});
  if(required.length&&typeof io.retainedHistory!=='function')throw Object.assign(Error('Actual full-history restore adapter is not implemented'),{code:'WRITER_HISTORY_UNAVAILABLE'});
  // Validate exact observed identities/readers BEFORE executing a format probe.
  // The final validator below checks all observations/traces again. This guard
  // cannot use fabricated outcome hashes to authorize a bundle.
  await io.assertOwnedImages(binding);
  let failure;
  try{
    if(required.length)check.retainedHistory=assertRetainedWriterHistory(await io.retainedHistory(),input.backupHash);
    for(const id of required){
      const trace=await io.drivers[id](binding);
      validateWriterTrace(trace,id,binding);
      check.traces.push(trace);check.outcomes.push({id,status:'passed',traceHash:evidenceHash(trace)});
    }
  }catch(error){failure=error;}
  finally{
    try{
      const after=await io.restoreCandidateAndObserve();
      assertRuntimeWriterPolicy(after.environment,{manifest:input.manifest});
      if(evidenceHash({images:after.images,identities:after.identities})!==evidenceHash(check.candidate))throw Error('Writer probe failed to restore exact candidate');
      if(evidenceHash(after.executionProfile)!==evidenceHash(check.executionProfile.candidate))throw Error('Writer probe failed to restore candidate runtime profile');
    }catch(error){failure??=error;}
  }
  if(failure)throw failure;
  assertWriterCompatibility(input.manifest,bundle,check);
  return check;
}
