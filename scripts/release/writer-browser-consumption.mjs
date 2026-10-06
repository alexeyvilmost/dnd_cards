// A host consumes an already published, exact-run hosted proof. Its raw browser
// trace is preserved verbatim: consumption is not a new browser execution.
import assert from 'node:assert/strict';
import {evidenceHash} from './validate-manifest.mjs';
import {validateExecutionProfile} from './ui-execution-profile.mjs';
import {verifyCandidateProvenance} from './deployment-handoff.mjs';
import {expectedWriterBrowserProfiles} from './writer-runtime-profile.mjs';
const hash=/^sha256:[a-f0-9]{64}$/,sha=/^[a-f0-9]{40}$/;
const same=(a,b)=>assert.equal(evidenceHash(a),evidenceHash(b),'Hosted writer proof belongs to another input');
const exact=(value,keys)=>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));assert.deepEqual(Object.keys(value).sort(),[...keys].sort());};
// Host validation has no node_modules/browser. These pins are source-owned and
// must agree with the producer's installed lockfile/package browser registry.
export const writerBrowserPins=Object.freeze({playwrightVersion:'1.62.1',browserRevision:'1234',browserVersion:'151.0.7922.34'});
export function validateWriterBrowserRuntime(runtime){
 exact(runtime,['kind','playwrightVersion','browserRevision','browserVersion','executableSHA256','runnerOS','architecture']);
 assert.equal(runtime.kind,'playwright-bundled-chromium');
 for(const [key,value] of Object.entries(writerBrowserPins))assert.equal(runtime[key],value);
 assert.match(runtime.executableSHA256,hash);assert.equal(runtime.runnerOS,'linux');assert.equal(runtime.architecture,'x64');
 return runtime;
}
export function writerPublication(candidate,verifiedReleaseRun){
 verifyCandidateProvenance(candidate,verifiedReleaseRun);
 assert.equal(verifiedReleaseRun.conclusion,'success');
 assert.ok(Number.isSafeInteger(verifiedReleaseRun.runAttempt)&&verifiedReleaseRun.runAttempt>0);
 return {manifest:structuredClone(candidate.manifest),provenance:structuredClone(candidate.provenance),verifiedReleaseRun:structuredClone(verifiedReleaseRun)};
}
export function assertHostedWriterPublication(value,publication,manifest){
 exact(publication,['manifest','provenance','verifiedReleaseRun']);
 const actual=writerPublication(publication,publication.verifiedReleaseRun),p=actual.provenance,run=actual.verifiedReleaseRun;
 const application=m=>{const {validationEvidence,...rest}=m;return rest;};
 same(application(actual.manifest),application(manifest));
 assert.equal(value.verifiedReleaseRunHash,evidenceHash(run));
 same(value.proof.provenance,{releaseRunId:p.releaseRunId,runAttempt:run.runAttempt,sourceCommit:p.sourceCommit,controlCommit:p.controlCommit,manifestHash:p.manifestHash});
 return value;
}
export function validateHostedWriterConsumption(value,binding,validateRaw){
 exact(value,['schemaVersion','kind','execution','outcomeId','consumptionBindingHash','verifiedReleaseRunHash','proofHash','proof']);
 assert.equal(value.schemaVersion,1);assert.equal(value.kind,'verified-hosted-writer-trace');assert.equal(value.execution,'hosted-proof-consumption');assert.equal(value.outcomeId,'frontend-pending-job-reload');
 assert.equal(value.consumptionBindingHash,evidenceHash(binding));assert.match(value.verifiedReleaseRunHash,hash);assert.equal(value.proofHash,evidenceHash(value.proof));
 const proof=value.proof;exact(proof,['schemaVersion','kind','status','execution','binding','trace','provenance','cleanup','executionProfile','browserRuntime']);
 assert.equal(proof.schemaVersion,1);assert.equal(proof.kind,'writer-browser-oci-proof');assert.equal(proof.status,'passed');assert.equal(proof.execution,'docker');
 assert.equal(proof.trace?.kind,'writer-compatibility-trace');assert.equal(proof.trace.execution,'docker');
 validateWriterBrowserRuntime(proof.browserRuntime);
 // Only the execution UUID may differ. All image, launch, policy, prior state,
 // active and composition hashes are the same inputs to the hosted execution.
 const {runId:hostedRunId,...hosted}=proof.binding??{}, {runId:hostRunId,...consumed}=binding;
 for(const id of [hostedRunId,hostRunId])assert.match(id,/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);same(hosted,consumed);
 const p=proof.provenance;exact(p,['releaseRunId','runAttempt','sourceCommit','controlCommit','manifestHash']);
 assert.ok(Number.isSafeInteger(p.releaseRunId)&&p.releaseRunId>0);assert.ok(Number.isSafeInteger(p.runAttempt)&&p.runAttempt>0);assert.match(p.sourceCommit,sha);assert.match(p.controlCommit,sha);assert.match(p.manifestHash,hash);
 assert.equal(p.sourceCommit,binding.candidate.identities.backend.releaseCommit);
 exact(proof.cleanup,['status','errors']);assert.equal(proof.cleanup.status,'stopped');assert.deepEqual(proof.cleanup.errors,[]);
 exact(proof.executionProfile,['candidate','previous']);
 for(const role of ['candidate','previous']){
  const profile=validateExecutionProfile(proof.executionProfile[role]);
  for(const component of ['backend','rulesWorker'])same(profile[component].instance,{releaseId:binding[role].identities[component].releaseId,releaseCommit:binding[role].identities[component].releaseCommit});
  assert.equal(profile.backend.environment.IMAGE_JOBS_ENABLED,role==='candidate'?'1':'0');assert.equal(profile.backend.environment.DB_FROZEN_CATALOGS,'0');
 }
 same(proof.executionProfile,expectedWriterBrowserProfiles(binding));
 validateRaw(proof.trace,'frontend-pending-job-reload',proof.binding);
 return value;
}
