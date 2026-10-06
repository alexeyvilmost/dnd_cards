#!/usr/bin/env node
// Production-capable entrypoint is deliberately separate from the full path.
// No dump, restore, migration, reference scan, browser or synthetic PG starts.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {assertHostConfiguration} from './docker-deployment.mjs';import {createDeploymentStore} from './deploy-state.mjs';
import {readProtectedFullAnchor} from './ui-host-anchor.mjs';import {observeUIHost} from './ui-host-observation.mjs';
import {createDockerFrontendAdapter} from './docker-ui-deployment.mjs';import {deployFrontend} from './ui-deploy-state.mjs';
import {bindHostedFrontendProof} from './ui-rehearsal.mjs';import {assertHostedMixedReport} from './ui-mixed-oci.mjs';
import {verifyCandidateProvenance} from './deployment-handoff.mjs';import {verifyFrontendCIReport} from './ui-release-planning.mjs';
import {selectLatestDeployedRun} from './deployed-baseline.mjs';import {githubReader} from './ui-ci.mjs';import {evidenceHash} from './validate-manifest.mjs';
import {createUIProofProjection,assertUIProofProjection} from './ui-proof-projection.mjs';
import {projectSucceededActive} from './active-projection.mjs';
import {assertCurrentMainCandidate} from './automatic-release.mjs';
import {discoverPublishedCandidate} from './release-publication.mjs';
const read=file=>JSON.parse(readFileSync(file,'utf8')),same=(a,b)=>evidenceHash(a)===evidenceHash(b);
export async function assertDeploymentWorkflow({workflow,repository,get}){
  if(!Number.isSafeInteger(workflow?.id)||workflow.id<1||!Number.isSafeInteger(workflow.runAttempt)||workflow.runAttempt<1
    ||!/^[a-f0-9]{40}$/.test(workflow.controlCommit??'')||!['workflow_run','workflow_dispatch'].includes(workflow.eventName)
    ||!/^[-\w.]+\/[-\w.]+$/.test(repository??''))throw Error('Exact deployment workflow identity required');
  const fresh=await get(`actions/runs/${workflow.id}`);
  if(fresh.id!==workflow.id||fresh.run_attempt!==workflow.runAttempt||fresh.head_sha!==workflow.controlCommit
    ||fresh.path!=='.github/workflows/deploy.yml'||fresh.head_branch!=='main'||fresh.event!==workflow.eventName
    ||fresh.status!=='in_progress'||fresh.conclusion!==null||fresh.repository?.full_name!==repository||fresh.head_repository?.full_name!==repository)throw Error('Current trusted deployment attempt required');
}
export async function applyHostedFrontend({candidate,config,policy,releaseRun,get,repository,workflow,output}){
  await assertDeploymentWorkflow({workflow,repository,get});
  assertHostConfiguration(config,policy,{production:true});
  if(config.frontendSelectiveEnabled!==true)throw Error('Selective host policy disabled');
  verifyCandidateProvenance(candidate,releaseRun);
  const published=await discoverPublishedCandidate(get,{runId:releaseRun.id,repository});
  if(!published.available||!same({...published.run,artifactId:published.artifactId},releaseRun))throw Error('Exact latest completed release attempt and artifact required');
  assertHostedMixedReport(candidate.frontendMixedReport,{candidate,run:releaseRun});
  const planning=candidate.frontendVerification.planning,baseline=await selectLatestDeployedRun(get,{repository});
  if(!baseline||baseline.id!==planning.eligibility.binding.baseline.runId||baseline.runAttempt!==planning.eligibility.binding.baseline.runAttempt||baseline.artifactId!==planning.eligibility.binding.baseline.artifactId)throw Error('Deployed predecessor changed before selective apply');
  const protectedAnchor=await readProtectedFullAnchor(config),store=createDeploymentStore(config.root),active=store.active();
  if(!same(active.manifest,planning.input.previousManifest)||!same(protectedAnchor.document.binding,planning.input.fullAnchor))throw Error('Protected active/full anchor differs from published plan');
  verifyFrontendCIReport(candidate.frontendVerification.ciReport,{...planning,workloadPlan:candidate.frontendVerification.workloadPlan});
  const before=await observeUIHost(config,active),after=await observeUIHost(config,active);
  if(!same(planning.executionProfile,before.executionProfile)||!same(before.executionProfile,after.executionProfile))throw Error('Host execution profile differs from hosted OCI');
  const context={...candidate.frontendVerification,originalAnchor:protectedAnchor.document.anchor,recovery:protectedAnchor.recovery,protectedRunning:before.protectedRuntime};
  const bundle=bindHostedFrontendProof({manifest:candidate.manifest,context,proof:candidate.frontendMixedReport.proof,before,after});
  const projection=createUIProofProjection(protectedAnchor.document,{manifest:candidate.manifest,run:workflow});
  const adapter=await createDockerFrontendAdapter(config,{authorized:true});
  await assertCurrentMainCandidate({eventName:workflow.eventName,candidate:candidate.manifest.releaseCommit,get});
  const operation=await deployFrontend({store,adapter,candidate:candidate.manifest,bundle,context});
  if(operation.status!=='succeeded')throw Error('Selective deployment not confirmed');
  return writeSucceededFrontendReceipt({store,operation,manifest:candidate.manifest,projection,workflow,repository,output});
}
// Both public documents identify the same exact persisted succeeded operation.
// No private host profile is projected into the recorded active state.
export function writeSucceededFrontendReceipt({store,operation,manifest,projection,workflow,repository,output}){
  assertUIProofProjection(projection,{manifest,run:workflow});
  const activeProjection=projectSucceededActive({store,operation,manifest,request:{repository,runId:workflow.id,attempt:workflow.runAttempt,controlCommit:workflow.controlCommit,sourceCommit:manifest.releaseCommit}});
  if(operation.kind!=='frontend-only'||!same(activeProjection.active.uiProofAnchor,projection.originalAnchor))throw Error('Succeeded frontend anchor differs from recorded active state');
  mkdirSync(output,{recursive:false});
  const deployment={schemaVersion:1,status:'succeeded',releaseId:manifest.releaseId,releaseCommit:manifest.releaseCommit,controlCommit:workflow.controlCommit,
    manifestHash:evidenceHash(manifest),kind:'frontend-only',operationHash:activeProjection.operationHash,originalFullAnchorHash:projection.anchorHash,completedAt:new Date().toISOString()};
  for(const [file,value] of Object.entries({'manifest.json':manifest,'deployment.json':deployment,'frontend-proof-anchor.json':projection,'active-projection.json':activeProjection}))writeFileSync(path.join(output,file),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
  return {status:'succeeded',releaseId:deployment.releaseId,receiptDirectory:output};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [candidateDirectory,configFile,policyFile,runFile,output,...extra]=process.argv.slice(2);if(!output||extra.length)throw Error('Expected candidate, protected host config, policy, fresh release run and receipt directory');
  const workflow={id:Number(process.env.GITHUB_RUN_ID),runAttempt:Number(process.env.GITHUB_RUN_ATTEMPT),controlCommit:process.env.GITHUB_SHA,eventName:process.env.GITHUB_EVENT_NAME};
  const result=await applyHostedFrontend({candidate:read(path.join(candidateDirectory,'candidate.json')),config:read(configFile),policy:read(policyFile),releaseRun:read(runFile),workflow,output,
    repository:process.env.GITHUB_REPOSITORY,get:githubReader(process.env.GITHUB_REPOSITORY,process.env.GITHUB_TOKEN)});
  process.stdout.write(JSON.stringify(result)+'\n');
}
