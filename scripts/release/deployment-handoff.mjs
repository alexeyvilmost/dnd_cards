#!/usr/bin/env node
import {readFileSync, writeFileSync, mkdirSync, copyFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertReleaseReady, evidenceHash, validateManifest} from './validate-manifest.mjs';
import {writerPublication,assertHostedWriterPublication} from './writer-browser-consumption.mjs';
import {validateRecoveryReference} from './first-adoption-recovery.mjs';
const read = file => JSON.parse(readFileSync(file, 'utf8'));
export function deploymentMode(event,adoptLegacy='false'){
  if(!['workflow_dispatch','workflow_run'].includes(event)||!['true','false'].includes(adoptLegacy))throw Error('Explicit deployment event and boolean adoption mode required');
  if(adoptLegacy==='true'&&event!=='workflow_dispatch')throw Error('Legacy adoption is an explicit manual first transition only');
  return adoptLegacy==='true'?'adopt':'apply';
}
export function checkTrigger(policy, event, sourceCommit) {
  if (policy.schemaVersion !== 1 || policy.productionEnabled !== true) throw Error('Production policy disabled');
  if (!['workflow_dispatch', 'workflow_run'].includes(event.name) || event.branch !== 'main' || event.sha !== sourceCommit || !/^[a-f0-9]{40}$/.test(sourceCommit)) throw Error('Exact trusted main event required');
  if (event.name === 'workflow_run' && (policy.autoDeployMain !== true || event.conclusion !== 'success')) throw Error('Automatic main deployment disabled or upstream failed');
}
export function verifyCandidateProvenance(candidate,run){
  validateManifest(candidate?.manifest);
  const p=candidate?.provenance;
  if(p?.schemaVersion!==1||!Number.isSafeInteger(p.releaseRunId)||p.releaseRunId!==run.id
    ||run.workflow!=='.github/workflows/release.yml'||!/^([a-f0-9]{40})$/.test(p.controlCommit??'')||p.controlCommit!==run.controlCommit
    ||!/^([a-f0-9]{40})$/.test(p.sourceCommit??'')||p.sourceCommit!==candidate.manifest?.releaseCommit
    ||!/^sha256:[a-f0-9]{64}$/.test(p.planHash??'')||p.manifestHash!==evidenceHash(candidate.manifest))throw Error('Candidate provenance differs from trusted release control run');
  if(p.firstAdoptionRecovery) {
    validateRecoveryReference(p.firstAdoptionRecovery);
    if(p.firstAdoptionRecovery.controlCommit!==p.controlCommit||p.sourceCommit!==p.controlCommit||candidate.manifest.previousReleaseId!==null||candidate.frontendVerification)throw Error('Recovered first adoption provenance differs');
  }
  return p;
}
export function verifyHandoff(manifest, bundle, run, sourceCommit, candidate) {
  assertReleaseReady(manifest, bundle);
  const p=verifyCandidateProvenance(candidate,run);
  const writer=bundle.rehearsalReceipt?.checks?.find(row=>row.id==='writer-compatibility');
  for(const trace of writer?.traces??[])if(trace.outcomeId==='frontend-pending-job-reload'){
    const publication=writerPublication(candidate,run);
    if(evidenceHash(writer.writerPublication)!==evidenceHash(publication))throw Error('Writer proof uses another verified publication');
    assertHostedWriterPublication(trace,publication,manifest);
  }
  const application=m=>{const {validationEvidence,...rest}=m;return rest;};
  if (manifest.releaseCommit !== sourceCommit || p.sourceCommit!==sourceCommit || evidenceHash(application(manifest))!==evidenceHash(application(candidate.manifest))) throw Error('Final composition differs from published candidate');
  return {schemaVersion: 1, status: 'validated-handoff', releaseId: manifest.releaseId, releaseCommit: sourceCommit, releaseControlCommit:p.controlCommit,releaseRunId:p.releaseRunId,manifestHash: evidenceHash(manifest)};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, ...args] = process.argv.slice(2);
  if(mode==='mode')process.stdout.write(deploymentMode(process.env.DEPLOY_EVENT,process.env.ADOPT_LEGACY??'false')+'\n');
  else if (mode === 'policy') checkTrigger(read(args[0]), {name: process.env.DEPLOY_EVENT, branch: process.env.DEPLOY_BRANCH, sha: process.env.DEPLOY_SHA, conclusion: process.env.UPSTREAM_CONCLUSION}, process.env.DEPLOY_SHA);
  else if (mode === 'verify') {
    const [directory, runFile, sha] = args;
    const candidate=read(path.join(directory,'candidate.json'));
    process.stdout.write(JSON.stringify(verifyHandoff(read(path.join(directory, 'manifest.json')), read(path.join(directory, 'bundle.json')), read(runFile), sha==='-'?candidate.manifest.releaseCommit:sha,candidate)) + '\n');
  } else if(mode==='candidate'){
    const [directory,runFile]=args;
    process.stdout.write(verifyCandidateProvenance(read(path.join(directory,'candidate.json')),read(runFile)).sourceCommit+'\n');
  } else if (mode === 'receipt') {
    const [operationFile, candidateDirectory, output] = args, operation = read(operationFile), manifest = read(path.join(candidateDirectory, 'manifest.json'));
    if (operation.status !== 'succeeded' || operation.plan.candidateHash !== evidenceHash(manifest)) throw Error('Successful observed cutover required');
    mkdirSync(output, {recursive: true}); copyFileSync(path.join(candidateDirectory, 'manifest.json'), path.join(output, 'manifest.json'));
    if (!/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? '')) throw Error('Exact deployment control commit required');
    writeFileSync(path.join(output, 'deployment.json'), JSON.stringify({schemaVersion: 1, status: 'succeeded', releaseId: manifest.releaseId,
      releaseCommit: manifest.releaseCommit, controlCommit: process.env.GITHUB_SHA, manifestHash: evidenceHash(manifest)}) + '\n', {flag: 'wx'});
  } else throw Error('Expected policy, verify or receipt');
}
