// Read-only planning adapter. No workflow or CLI invokes this draft API yet.
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {selectLatestDeployedRun} from './deployed-baseline.mjs';
import {verifyBaseline,calculateBuildMatrix,validateBuildConfig,verifySuiteReport} from './ci-release.mjs';
import {createPlan} from './plan-components.mjs';
import {evidenceHash} from './validate-manifest.mjs';
import {assertSourceContentManifest} from './source-content-manifest.mjs';
import {classifyReleaseVerification,assertFrontendEligibility,candidateWriterPolicyFields} from './ui-release-policy.mjs';
import {validateExecutionProfile} from './ui-execution-profile.mjs';

export async function readDeployedUIBaseline(get,{repository,readArtifact}) {
  const run=await selectLatestDeployedRun(get,{repository});
  if (!run) return null;
  // readArtifact must fetch this exact immutable artifact, not search by name
  // again. Discovery already rejects expired/deleted and rerun ambiguity.
  const {manifest,receipt,retirementObservation}=await readArtifact(run.artifactId);
  verifyBaseline(manifest,receipt,run,retirementObservation);
  const latest=await selectLatestDeployedRun(get,{repository});
  if (evidenceHash(latest)!==evidenceHash(run)) throw Error('Deployment changed while reading baseline');
  return {manifest,receipt,...(retirementObservation?{retirementObservation}:{}),binding:{repository,runId:run.id,runAttempt:run.runAttempt,artifactId:run.artifactId,
    controlCommit:run.controlCommit,sourceCommit:manifest.releaseCommit,manifestHash:evidenceHash(manifest),
    receiptHash:evidenceHash(receipt),completedAt:run.completedAt}};
}
export function prepareFrontendVerification({repo,candidate,repository,config,baseline,baselineFile,fullAnchor,previousDomain,candidateDomain,workerInputs,testCatalog}) {
  if (!baseline) return {eligibility:{kind:'full',requiredTier:'extended',reason:'no-deployed-baseline'}};
  validateBuildConfig(config);
  const git=args=>execFileSync('git',args,{cwd:repo,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  if (!/^[a-f0-9]{40}$/.test(candidate) || git(['rev-parse','HEAD'])!==candidate || git(['status','--porcelain','--untracked-files=all'])) throw Error('Exact clean candidate checkout required');
  git(['merge-base','--is-ancestor',candidate,'refs/remotes/origin/main']);
  verifyBaseline(baseline.manifest,baseline.receipt,{repository:baseline.binding.repository,id:baseline.binding.runId,runAttempt:baseline.binding.runAttempt,controlCommit:baseline.binding.controlCommit},baseline.retirementObservation);
  if (evidenceHash(JSON.parse(readFileSync(baselineFile,'utf8')))!==baseline.binding.manifestHash) throw Error('Baseline file differs from selected deployment');
  if(baseline.retirementObservation)return {eligibility:{kind:'full',requiredTier:'extended',reason:'recorded-character-retirement'}};
  assertSourceContentManifest(repo,config);
  const selection=createPlan({repo,mode:'deploy',candidate,deployedManifest:baselineFile});
  const matrix=calculateBuildMatrix({repo,candidate,repository,config,selection,baseline:baseline.manifest});
  const frontend=matrix.find(row=>row.component==='frontend');
  // Planning projection only; the old image digest is explicitly not a claim
  // about unbuilt frontend bytes. Final receipt separately binds real OCI bytes.
  const candidateManifest={...structuredClone(baseline.manifest),releaseId:`ui-plan-${candidate.slice(0,12)}`,releaseCommit:candidate,
    previousReleaseId:baseline.manifest.releaseId,contentManifestHash:config.contentManifestHash,migrationSet:config.migrationSet,
    components:{...baseline.manifest.components,frontend:{...baseline.manifest.components.frontend,sourceCommit:frontend.sourceCommit,inputFingerprint:frontend.inputFingerprint}}};
  // Keep the writer follow-on producer contract when the drafts are merged:
  // missing config means OFF, never inherit a predecessor's enabled policy.
  Object.assign(candidateManifest,candidateWriterPolicyFields(baseline.manifest,config));
  const input={previousManifest:baseline.manifest,candidateManifest,selection,matrix,baselineBinding:baseline.binding,fullAnchor,
    previousDomain,candidateDomain,workerInputs,testCatalog};
  return {input,eligibility:classifyReleaseVerification(input)};
}
export function verifyFrontendCIReport(report,{input,eligibility,executionProfile,workloadPlan}) {
  assertFrontendEligibility(eligibility,input);
  const planning={input,eligibility};
  if(executionProfile!==undefined){validateExecutionProfile(executionProfile);planning.executionProfile=executionProfile;}
  const verification=verifySuiteReport(report,input.candidateManifest.releaseCommit,{requiredTier:'core'});
  if (report.suite!=='core' || evidenceHash(report.frontend_verification)!==evidenceHash(eligibility)
    || evidenceHash(report.frontend_planning??null)!==evidenceHash(planning)
    || report.aggregation?.global_coverage_complete!==true || report.aggregation.plan_sha256!==workloadPlan.sha256
    || report.aggregation.workload!==workloadPlan.units.length
    || !eligibility.binding.affectedTests.every(file=>workloadPlan.units.some(unit=>unit.id===`vitest:${file}`))
    || !workloadPlan.units.some(unit=>unit.id==='browser:local-browser-flows')
    || !workloadPlan.units.some(unit=>unit.id==='script:local-api-spine')) throw Error('Fresh bound core with affected UI and global real E2E coverage required');
  return {...verification,frontendBindingHash:eligibility.bindingHash,workloadHash:workloadPlan.sha256};
}
// Called again after fresh GitHub discovery and actual build-matrix inventory.
// Never promotes an old core receipt to extended if applicability has changed.
export function revalidateFrontendCI(report,previousPlanning,freshPlanning,workloadPlan) {
  if (evidenceHash(previousPlanning)!==evidenceHash(freshPlanning)) throw Error('Baseline or actual build inputs changed; new verification required');
  return verifyFrontendCIReport(report,{...freshPlanning,workloadPlan});
}
