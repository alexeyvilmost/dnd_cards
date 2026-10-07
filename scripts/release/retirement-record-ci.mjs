#!/usr/bin/env node
// Prepare a manual record input from the latest authenticated deploy artifact.
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFileSync,writeFileSync} from 'node:fs';
import {githubReader} from './ui-ci.mjs';
import {selectLatestDeployedRun} from './deployed-baseline.mjs';
import {verifyBaseline} from './ci-release.mjs';
import {readRetirementBaselineArtifact} from './retirement-baseline.mjs';
import {validateRetirementRecordRun} from './retirement-record-host.mjs';
import {evidenceHash} from './validate-manifest.mjs';
const read=file=>JSON.parse(readFileSync(file,'utf8'));
export function validateRetirementRecordInput(input){
  assert.deepEqual(Object.keys(input??{}).sort(),['schemaVersion','kind','operationId','sourceCommit','expectedManifestHash'].sort());
  assert.equal(input.schemaVersion,1);assert.equal(input.kind,'record-retirement-input');
  assert.match(input.operationId??'',/^retirement302-[A-Za-z0-9_.-]{1,100}$/);assert.match(input.sourceCommit??'',/^[a-f0-9]{40}$/);
  assert.match(input.expectedManifestHash??'',/^sha256:[a-f0-9]{64}$/);return input;
}
export async function prepareRetirementRecord({operationId,manifest,receipt,retirementObservation,latest,request,get}){
  assert(latest);verifyBaseline(manifest,receipt,latest,retirementObservation);
  assert.equal(request.sourceCommit,manifest.releaseCommit);
  assert.deepEqual(await selectLatestDeployedRun(get,{repository:request.repository}),latest);
  validateRetirementRecordRun(await get('actions/runs/'+request.runId),{request,operationId});
  assert.equal((await get('commits/main')).sha,request.controlCommit);
  return validateRetirementRecordInput({schemaVersion:1,kind:'record-retirement-input',operationId,sourceCommit:manifest.releaseCommit,expectedManifestHash:evidenceHash(manifest)});
}
export async function main(args,env=process.env){
  const [operationId,baselineDirectory,latestFile,output,...extra]=args;assert(output&&extra.length===0);
  assert.equal(env.GITHUB_EVENT_NAME,'workflow_dispatch');assert.equal(env.GITHUB_REF,'refs/heads/main');
  assert.equal(env.ADOPT_LEGACY,'false');assert.equal(env.PRODUCTION_DEPLOY_ENABLED,'true');
  const manifest=read(path.join(baselineDirectory,'manifest.json'));
  const input=await prepareRetirementRecord({operationId,manifest,receipt:read(path.join(baselineDirectory,'deployment.json')),retirementObservation:readRetirementBaselineArtifact(baselineDirectory),latest:read(latestFile),
    request:{repository:env.GITHUB_REPOSITORY,controlCommit:env.GITHUB_SHA,sourceCommit:manifest.releaseCommit,runId:env.GITHUB_RUN_ID,attempt:env.GITHUB_RUN_ATTEMPT,eventName:env.GITHUB_EVENT_NAME,actor:env.GITHUB_ACTOR},get:githubReader(env.GITHUB_REPOSITORY,env.GITHUB_TOKEN)});
  writeFileSync(output,JSON.stringify(input,null,2)+'\n',{flag:'wx'});return input;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const result=await main(process.argv.slice(2));process.stdout.write(`source_sha=${result.sourceCommit}\ncandidate_available=true\n`);}
  catch{process.stderr.write('Manual retirement record preparation refused; no host operation requested.\n');process.exitCode=1;}
}
