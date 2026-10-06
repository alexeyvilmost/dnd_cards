#!/usr/bin/env node
import {readFileSync,writeFileSync,mkdirSync,renameSync,mkdtempSync} from 'node:fs';import path from 'node:path';import {tmpdir} from 'node:os';import {fileURLToPath} from 'node:url';
import {executeFrontendChecks} from './ui-rehearsal.mjs';import {createDockerUIRehearsal,playwrightImage} from './docker-ui-rehearsal.mjs';
import {validateBuildPlan,verifySuiteReport} from './ci-release.mjs';import {verifyFrontendCIReport} from './ui-release-planning.mjs';import {assertFrontendEligibility} from './ui-release-policy.mjs';
import {evidenceHash,compositionFingerprint} from './validate-manifest.mjs';import {validateExecutionProfile} from './ui-execution-profile.mjs';
const read=file=>JSON.parse(readFileSync(file,'utf8'));
export const syntheticPostgresImage='postgres@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73';
export async function runMixedOCI({candidate,directory,postgresImage}){
  const {planning,ciReport,workloadPlan}=candidate.frontendVerification??{};
  assertFrontendEligibility(planning?.eligibility,{...planning?.input,candidateManifest:candidate.manifest});
  verifyFrontendCIReport(ciReport,{...planning,workloadPlan});validateExecutionProfile(planning.executionProfile);
  const adapter=createDockerUIRehearsal({directory,postgresImage,executionProfile:planning.executionProfile});
  return executeFrontendChecks(adapter,{manifest:candidate.manifest,previousManifest:planning.input.previousManifest});
}
export function assertHostedMixedReport(report,{candidate,run}){
  const proof=report?.proof,provenance=report?.provenance;
  if(report?.schemaVersion!==1||report.kind!=='hosted-frontend-mixed-oci'||report.status!=='passed'||report.localOnly!==false
    ||proof?.kind!=='frontend-oci-checks'||proof.status!=='passed'||proof.execution!=='docker'||proof.scope!=='owned-synthetic'||proof.authorization!=='not-produced'
    ||proof.cleanup?.status!=='stopped'||proof.cleanup.errors?.length||!Number.isFinite(Date.parse(proof.completedAt))
    ||provenance?.releaseRunId!==run.id||provenance.runAttempt!==run.runAttempt||provenance.controlCommit!==run.controlCommit
    ||provenance.sourceCommit!==candidate.manifest.releaseCommit||provenance.candidateManifestHash!==evidenceHash(candidate.manifest)
    ||provenance.compositionFingerprint!==compositionFingerprint(candidate.manifest)||provenance.planHash!==candidate.provenance.planHash
    ||report.proofHash!==evidenceHash(proof)||report.executionProfileHash!==evidenceHash(candidate.frontendVerification.planning.executionProfile)
    ||report.browserImage!==playwrightImage)throw Error('Actual latest-attempt hosted mixed OCI proof required');
  return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [candidateDirectory,planFile,output,...extra]=process.argv.slice(2);if(!output||extra.length)throw Error('Expected candidate, immutable build plan and output directories');
  const candidateFile=path.join(candidateDirectory,'candidate.json'),candidate=read(candidateFile),plan=validateBuildPlan(read(planFile));
  if(!candidate.frontendVerification){process.stdout.write('Full release: selective collector not applicable.\n');}
  else{
    const run={id:Number(process.env.GITHUB_RUN_ID),runAttempt:Number(process.env.GITHUB_RUN_ATTEMPT),controlCommit:process.env.GITHUB_SHA};
    if(process.env.GITHUB_ACTIONS!=='true'||!Number.isSafeInteger(run.id)||!Number.isSafeInteger(run.runAttempt)||run.runAttempt<1||run.id!==plan.releaseRunId
      ||run.controlCommit!==plan.controlCommit||candidate.provenance.planHash!==plan.planHash||evidenceHash(plan.frontendVerification)!==evidenceHash(candidate.frontendVerification))throw Error('Hosted exact-source workflow required');
    verifySuiteReport(candidate.frontendVerification.ciReport,plan.candidate,{requiredTier:'core'});
    mkdirSync(output,{recursive:true});const directory=mkdtempSync(path.join(tmpdir(),'frontend-mixed-'));
    const postgres=syntheticPostgresImage;
    let report;try{
      const proof=await runMixedOCI({candidate,directory:path.join(directory,'stand'),postgresImage:postgres});
      report={schemaVersion:1,kind:'hosted-frontend-mixed-oci',status:'passed',localOnly:false,browserImage:playwrightImage,proof,proofHash:evidenceHash(proof),
        executionProfileHash:evidenceHash(candidate.frontendVerification.planning.executionProfile),provenance:{releaseRunId:run.id,runAttempt:run.runAttempt,controlCommit:run.controlCommit,
          sourceCommit:plan.candidate,candidateManifestHash:evidenceHash(candidate.manifest),compositionFingerprint:compositionFingerprint(candidate.manifest),planHash:plan.planHash}};
      assertHostedMixedReport(report,{candidate,run});
    }catch(error){writeFileSync(path.join(output,'frontend-mixed-report.json'),JSON.stringify({schemaVersion:1,kind:'hosted-frontend-mixed-oci',status:'failed',proof:error.evidence??null},null,2)+'\n');throw error;}
    writeFileSync(path.join(output,'frontend-mixed-report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
    if(candidate.frontendMixedReport)throw Error('Mixed proof already attached');const next=candidateFile+'.mixed-tmp';writeFileSync(next,JSON.stringify({...candidate,frontendMixedReport:report},null,2)+'\n',{flag:'wx'});renameSync(next,candidateFile);
    process.stdout.write('Actual hosted mixed OCI checks passed; candidate proof attached.\n');
  }
}
