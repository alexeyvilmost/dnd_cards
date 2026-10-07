import {evidenceHash} from './validate-manifest.mjs';import {verifyFrontendCIReport} from './ui-release-planning.mjs';
import {classifyReleaseVerification,assertFrontendEligibility} from './ui-release-policy.mjs';import {verifyCandidateProvenance} from './deployment-handoff.mjs';
import {assertFrontendOnlyReleaseReady} from './ui-release-receipt.mjs';
import {verifySuiteReport} from './ci-release.mjs';
const same=(a,b)=>evidenceHash(a)===evidenceHash(b);
// Called before image publication. Fresh planning must come from canonical
// deployed-run discovery, never from an untrusted workflow output alone.
export async function dispatchVerifiedRelease({planning,ciReport,workloadPlan,freshPlanning,prepareFull,prepareFrontend}){
  const current=await freshPlanning(),mode=classifyReleaseVerification(current.input);
  if(!same(mode,current.eligibility))throw Error('Fresh planning output differs from exact inputs');
  if(mode.kind==='no-deployment-needed'){
    if(mode.reason==='verification-only-exact-runtime-reuse')verifySuiteReport(ciReport,current.input.candidateManifest.releaseCommit,{requiredTier:'extended'});
    return {schemaVersion:1,kind:'no-deployment-needed',status:'not-deployed',candidate:current.input.candidateManifest.releaseCommit,
    previousManifestHash:mode.previousManifestHash,selectionHash:mode.selectionHash,matrixHash:mode.matrixHash,publishImages:false,createCandidate:false,deploy:false,advanceBaseline:false};
  }
  if(mode.kind==='full'){
    // Canonical full preparation verifies its required extended CI tier. No UI
    // core report is adapted into a full report or a successful deploy marker.
    if(typeof prepareFull!=='function')throw Error('Full release path required');return prepareFull(current);
  }
  // A reconciler deliberately requests a complete extended verification. Its
  // explicit full planning is never re-labelled as selective/core evidence.
  if(ciReport?.suite==='extended'&&planning?.eligibility?.kind==='full'){
    verifySuiteReport(ciReport,current.input.candidateManifest.releaseCommit,{requiredTier:'extended'});
    if(typeof prepareFull!=='function')throw Error('Full release path required');
    return prepareFull(current);
  }
  assertFrontendEligibility(planning?.eligibility,planning?.input);
  if(!same(planning,current))throw Error('Deployed baseline or runtime proof changed; new frontend verification required');
  const verified=verifyFrontendCIReport(ciReport,{...current,workloadPlan});
  if(typeof prepareFrontend!=='function')throw Error('Typed frontend publication path unavailable');
  return prepareFrontend({planning:current,ciReport,workloadPlan,verified});
}
export function verifyFrontendHandoff({candidate,manifest,bundle,run,context}){
  const provenance=verifyCandidateProvenance(candidate,run),application=value=>{const {validationEvidence,...rest}=value;return rest;};
  if(!same(application(candidate.manifest),application(manifest)))throw Error('Frontend composition differs from published immutable candidate');
  const readiness=assertFrontendOnlyReleaseReady(manifest,bundle,context);
  return {schemaVersion:1,kind:'frontend-selective-handoff',status:'validated-handoff',releaseId:manifest.releaseId,releaseCommit:manifest.releaseCommit,
    releaseControlCommit:provenance.controlCommit,releaseRunId:provenance.releaseRunId,manifestHash:evidenceHash(manifest),receiptHash:evidenceHash(bundle.rehearsalReceipt),eligibilityHash:readiness.eligibilityHash};
}
