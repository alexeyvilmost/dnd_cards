import {randomUUID} from 'node:crypto';import {evidenceHash,compositionFingerprint} from './validate-manifest.mjs';
import {frontendRehearsalChecks,verifyOriginalFullAnchor,assertFrontendOnlyReleaseReady} from './ui-release-receipt.mjs';
import {assertFrontendEligibility} from './ui-release-policy.mjs';import {verifyFrontendCIReport} from './ui-release-planning.mjs';
import {assertImmutablePreservation,assertUnchangedRunningRuntime} from './ui-preservation.mjs';
import {isUIObservationFailureCode} from './ui-host-observation.mjs';
const same=(a,b)=>evidenceHash(a)===evidenceHash(b);
const startupStages=new Set(['postgres-start','catalog-seed','application-start','initial-observation','original-ui','frontend-prepare','frontend-replace']);
const failureCodes=new Set(['docker-step-failed','ETIMEDOUT','ENOBUFS','mixed-startup-failed']);
// Keep only bounded control metadata. Raw errors may contain commands, fixture
// credentials or provider responses and must never become a public report.
function safeFailure(error,stage){
  return {stage,...(startupStages.has(error?.rehearsalStage)?{startupStage:error.rehearsalStage}:{}),code:failureCodes.has(error?.code)||isUIObservationFailureCode(error?.code)?error.code:'rehearsal-step-failed',...(Number.isInteger(error?.exitCode)&&error.exitCode>=0&&error.exitCode<=255?{exitCode:error.exitCode}:{})};
}
// Actual-driver seam also used by a local-only OCI drill. It does not create a
// CI authorization or an original full anchor. No missing driver can be skipped.
export async function executeFrontendChecks(adapter,input){
  if(adapter?.execution!=='docker'||adapter.scope!=='owned-synthetic'||typeof adapter.start!=='function'||typeof adapter.check!=='function'
    ||typeof adapter.cleanup!=='function'||typeof adapter.observeProtected!=='function')throw Error('Actual owned Docker frontend adapter required');
  const runId=randomUUID(),checks=[];let error,stage='start',failure,started=false,runtimeBefore,runtimeAfter,runtimeAfterRollback,cleanup;
  try{
    const ready=await adapter.start({...input,runId});started=true;
    if(ready?.status!=='ready'||ready.runId!==runId||ready.execution!=='docker'||ready.scope!=='owned-synthetic')throw Error('Owned mixed OCI startup did not attest its run');
    stage='initial-runtime-observation';runtimeBefore=await adapter.observeProtected();
    for(const id of frontendRehearsalChecks){
      stage=id;
      const result=await adapter.check(id,{...input,runId});
      if(result?.status!=='passed'||result.runId!==runId||result.id!==id||result.execution!=='docker')throw Error('Required actual frontend check failed: '+id);
      checks.push({id,status:'passed',disposition:'executed',evidenceHash:evidenceHash(result),
        ...(id==='image-contract'?{images:result.images,identities:result.identities}:{}),
        ...(id==='frontend-rollback'?{previousDigest:result.previousDigest,changedComponents:result.changedComponents}:{})});
      if(id==='pdf-export')runtimeAfter=await adapter.observeProtected();
      if(id==='old-chunk-fetch')runtimeAfterRollback=await adapter.observeProtected();
    }
    assertUnchangedRunningRuntime(runtimeBefore,runtimeAfter);assertUnchangedRunningRuntime(runtimeBefore,runtimeAfterRollback);
  }catch(cause){error=cause;failure=safeFailure(cause,stage);}
  finally{
    // Cleanup runs even if start partially created resources before throwing.
    try{cleanup=await adapter.cleanup({runId,started});if(cleanup?.status!=='stopped'||cleanup.errors?.length)throw Error('Owned OCI cleanup incomplete');}
    catch(cause){error??=cause;failure??=safeFailure(cause,'cleanup');cleanup={status:'failed',errors:['owned-cleanup-failed']};}
  }
  const result={schemaVersion:1,kind:'frontend-oci-checks',execution:'docker',scope:'owned-synthetic',runId,status:error?'failed':'passed',checks,
    runtimeBefore,runtimeAfter,runtimeAfterRollback,cleanup,...(failure?{failure}:{}),completedAt:new Date().toISOString(),authorization:'not-produced'};
  if(error)throw Object.assign(Error('Mixed frontend OCI checks failed'),{evidence:result});return result;
}
export async function collectFrontendRehearsal({manifest,context,adapter,observeHost}){
  const {planning,originalAnchor,recovery,ciReport,workloadPlan,protectedRunning}=context;
  assertFrontendEligibility(planning.eligibility,{...planning.input,candidateManifest:manifest});
  const anchor=verifyOriginalFullAnchor(originalAnchor,{domain:planning.input.previousDomain,recovery});verifyFrontendCIReport(ciReport,{...planning,workloadPlan});
  const before=await observeHost();assertUnchangedRunningRuntime(protectedRunning,before.protectedRuntime);assertImmutablePreservation(originalAnchor.files,before.files);
  const proof=await executeFrontendChecks(adapter,{manifest,previousManifest:planning.input.previousManifest});
  const after=await observeHost();assertUnchangedRunningRuntime(before.protectedRuntime,after.protectedRuntime);assertImmutablePreservation(before.files,after.files);
  return bindHostedFrontendProof({manifest,context,proof,before,after});
}
// Host binds already completed hosted OCI checks to its new read-only interval.
// The entrypoint must separately validate exact workflow artifact provenance.
export function bindHostedFrontendProof({manifest,context,proof,before,after}){
  const {planning,originalAnchor,recovery,ciReport,workloadPlan,protectedRunning}=context;
  const anchor=verifyOriginalFullAnchor(originalAnchor,{domain:planning.input.previousDomain,recovery});
  if(proof?.kind!=='frontend-oci-checks'||proof.execution!=='docker'||proof.scope!=='owned-synthetic'||proof.status!=='passed'||proof.cleanup?.status!=='stopped'||proof.cleanup.errors?.length)throw Error('Completed actual hosted OCI proof required');
  assertUnchangedRunningRuntime(protectedRunning,before.protectedRuntime);assertUnchangedRunningRuntime(before.protectedRuntime,after.protectedRuntime);assertImmutablePreservation(originalAnchor.files,before.files);assertImmutablePreservation(before.files,after.files);
  const image=proof.checks[0],images=Object.fromEntries(Object.entries(manifest.components).map(([key,row])=>[key,row.imageDigest]));
  if(!same(image.images,images))throw Error('Actual mixed OCI composition differs');
  const history=originalAnchor.bundle.reports['pinned-artifacts'];
  const receipt={schemaVersion:1,kind:'frontend-selective-rehearsal',execution:'docker',scope:'owned-synthetic',status:'passed',localOnly:false,simulation:false,
    hostObservationScope:'read-only-around-owned-rehearsal',runId:proof.runId,candidateManifestHash:evidenceHash(manifest),previousManifestHash:evidenceHash(planning.input.previousManifest),compositionFingerprint:compositionFingerprint(manifest),
    eligibilityHash:planning.eligibility.bindingHash,coreReportHash:evidenceHash(ciReport),workloadHash:workloadPlan.sha256,anchor,recovery,
    databaseReferenceInventory:'not_executed',currentDatabaseReferenceCoverage:'not_asserted',currentDatabaseSnapshot:false,completedAt:proof.completedAt,cleanup:proof.cleanup,checks:proof.checks,
    history:{disposition:'reused',sourceProofHash:evidenceHash(history),applicabilityHash:planning.eligibility.bindingHash,originalCompletedAt:anchor.completedAt,originalReport:history},
    filesBefore:before.files,filesAfter:after.files,filesAfterRollback:after.files,runtimeBefore:before.protectedRuntime,runtimeAfter:after.protectedRuntime,runtimeAfterRollback:after.protectedRuntime,
    rehearsalRuntimeBefore:proof.runtimeBefore,rehearsalRuntimeAfter:proof.runtimeAfter,rehearsalRuntimeAfterRollback:proof.runtimeAfterRollback};
  // Host was only read during the owned rollback. These repeated host fields
  // denote that observation interval, never a production rollback execution.
  const bundle={images,identities:image.identities,rehearsalReceipt:receipt};assertFrontendOnlyReleaseReady(manifest,bundle,context);return bundle;
}
