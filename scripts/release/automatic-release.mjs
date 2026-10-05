#!/usr/bin/env node
// Read-only workflow metadata. No image publication or deployment occurs here.
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyRun} from './ci-release.mjs';
import {selectLatestDeployedRun} from './deployed-baseline.mjs';
import {loadControlRecovery,assertRecoveredInitialHistory,recoveryFields} from './first-adoption-recovery.mjs';

const exactSHA = /^[a-f0-9]{40}$/;
const runID = value => /^[1-9]\d*$/.test(String(value ?? '')) && Number.isSafeInteger(Number(value));
export async function assertCurrentMainCandidate({eventName,candidate,get}) {
  if(!exactSHA.test(candidate??'')||!['workflow_dispatch','workflow_run'].includes(eventName))throw Error('Invalid deployment candidate event');
  if(eventName==='workflow_run'&&(await get('commits/main')).sha!==candidate)throw Error('Automatic candidate has been superseded on main');
  return {candidate,currentMainChecked:eventName==='workflow_run'};
}
export async function resolveReleaseRequest({eventName, event, repository, controlCommit, variables, get, controlRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..')}) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !exactSHA.test(controlCommit)
    || event?.repository?.full_name !== repository || variables.RELEASE_BUILD_ENABLED !== 'true') throw Error('Release build policy or repository identity is invalid');
  let candidate, verificationRunId, baselineRunId, publish, firstAdoptionRecovery;
  if(eventName!=='workflow_dispatch'&&event?.inputs?.first_adoption_recovery)throw Error('Recovery is manual only');
  if (eventName === 'workflow_run') {
    if (variables.AUTO_RELEASE_MAIN_ENABLED !== 'true') throw Error('Automatic release builds are disabled');
    const upstream = event.workflow_run;
    candidate = upstream?.head_sha;
    const verified = verifyRun(upstream, {repository, candidate, kind:'verification'});
    const fresh = verifyRun(await get(`actions/runs/${verified.id}`), {repository, candidate, kind:'verification'});
    if (fresh.id !== verified.id) throw Error('Verification run identity changed');
    const head = await get('commits/main');
    if (head.sha !== candidate) throw Error('Verified candidate has been superseded on main; wait for the newer CI run');
    verificationRunId = String(verified.id);
    publish = variables.RELEASE_PUBLICATION_ENABLED === 'true';
  } else if (eventName === 'workflow_dispatch') {
    if (event.ref !== 'refs/heads/main') throw Error('Manual release control must run on main');
    const inputs = event.inputs ?? {};
    candidate = inputs.candidate; verificationRunId = String(inputs.verification_run_id ?? '');
    baselineRunId = String(inputs.baseline_run_id ?? '');
    if (!exactSHA.test(candidate ?? '') || !runID(verificationRunId) || baselineRunId && !runID(baselineRunId)
      || ![true, false, 'true', 'false', undefined].includes(inputs.publish)) throw Error('Invalid exact-source release request');
    verifyRun(await get(`actions/runs/${verificationRunId}`), {repository, candidate, kind:'verification'});
    publish = inputs.publish === true || inputs.publish === 'true';
    if (publish && variables.RELEASE_PUBLICATION_ENABLED !== 'true') throw Error('Image publication is disabled');
  } else throw Error('Unsupported release event');
  // Select the last actual successful deployment, never the preceding push.
  // Its downloaded receipt and manifest are independently checked by ci-release.
  let last;
  const recoveryId=event.inputs?.first_adoption_recovery;
  if(recoveryId) {
    if(eventName!=='workflow_dispatch'||baselineRunId||candidate!==controlCommit||(await get('commits/main')).sha!==candidate)throw Error('Recovery requires an exact current-main initial manual full build');
    const loaded=loadControlRecovery({id:recoveryId,controlRoot,controlCommit,repository});
    await assertRecoveredInitialHistory(get,{proof:loaded.proof});
    firstAdoptionRecovery=loaded.reference;
  } else last = await selectLatestDeployedRun(get, {repository});
  if (last) {
    if (baselineRunId && baselineRunId !== String(last.id)) throw Error('Requested baseline is not the latest successful deployment');
    baselineRunId = String(last.id);
  } else if (baselineRunId) throw Error('Requested deployment baseline does not exist');
  else baselineRunId = '';
  return {schemaVersion:1, candidate, controlCommit, repository, verificationRunId, baselineRunId, publish,...recoveryFields(firstAdoptionRecovery)};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [eventFile, output] = process.argv.slice(2);
  if (!eventFile || !output || !process.env.GITHUB_TOKEN) throw Error('Event, output and read-only GitHub token are required');
  const repository = process.env.GITHUB_REPOSITORY;
  if(!/^[\w.-]+\/[\w.-]+$/.test(repository??''))throw Error('Invalid repository identity');
  const get=async route=>{
      const response = await fetch(`https://api.github.com/repos/${repository}/${route}`, {headers:{
        Authorization:`Bearer ${process.env.GITHUB_TOKEN}`, Accept:'application/vnd.github+json', 'X-GitHub-Api-Version':'2022-11-28'}, signal:AbortSignal.timeout(15000)});
      if (!response.ok) throw Error(`Workflow metadata unavailable (${response.status})`);
      return response.json();
    };
  if(eventFile==='check-current') {
    process.stdout.write(JSON.stringify(await assertCurrentMainCandidate({eventName:process.env.GITHUB_EVENT_NAME,candidate:output,get}))+'\n');
  } else {
  const request = await resolveReleaseRequest({eventName:process.env.GITHUB_EVENT_NAME, event:JSON.parse(readFileSync(eventFile,'utf8')),
    repository, controlCommit:process.env.GITHUB_SHA, variables:process.env,get});
  mkdirSync(path.dirname(output),{recursive:true}); writeFileSync(output,JSON.stringify(request,null,2)+'\n',{flag:'wx'});
  process.stdout.write(`candidate=${request.candidate}\nverification_run_id=${request.verificationRunId}\nbaseline_run_id=${request.baselineRunId}\npublish=${request.publish}\n`);
  }
}
