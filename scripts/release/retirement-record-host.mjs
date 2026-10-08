#!/usr/bin/env node
// Record an already succeeded schema operation in an authenticated workflow.
// Execution and its fresh backup/reader proof belong to retirement-host.mjs.
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {writeFileSync,lstatSync,realpathSync} from 'node:fs';
import {activeProjectionContext,assertProtectedProjectionFile} from './active-projection.mjs';
import {createDeploymentStore} from './deploy-state.mjs';
import {githubReader} from './ui-ci.mjs';
import {readPrivateRetirementJSON} from './retirement-production-artifacts.mjs';
import {projectRetirementObservation,main as emitProjection} from './retirement-projection.mjs';
import {evidenceHash} from './validate-manifest.mjs';

export function validateRetirementRecordRun(run,{request,operationId}){
  const context=activeProjectionContext(request);
  assert.match(operationId??'',/^retirement302-[A-Za-z0-9_.-]{1,100}$/);
  assert.equal(request.eventName,'workflow_dispatch');
  assert.match(request.actor??'',/^\w[\w-]*(?:\[bot\])?$/);
  assert.equal(run?.id,context.runId);assert.equal(run.run_attempt,context.runAttempt);
  assert.equal(run.path,'.github/workflows/deploy.yml');assert.equal(run.head_branch,'main');
  assert.equal(run.repository?.full_name,context.repository);assert.equal(run.head_repository?.full_name,context.repository);
  assert.equal(run.head_sha,context.controlCommit);assert.equal(run.event,'workflow_dispatch');
  assert.equal(run.status,'in_progress');assert.equal(run.conclusion,null);
  assert.equal(run.actor?.login,request.actor);
  assert.equal(run.display_title,'Record retirement '+operationId);
  return context;
}

// Unit tests supply metadata, not host/DDL authority. The CLI below additionally
// requires Linux, private host paths and the actual read-only GitHub API.
export async function recordRetirementObservation({store,operationId,request,expectedManifestHash,get}){
  assert.match(expectedManifestHash??'',/^sha256:[a-f0-9]{64}$/);
  validateRetirementRecordRun(await get('actions/runs/'+request.runId),{request,operationId});
  const active=store.active(),operation=store.operation(operationId);
  assert.equal(active?.manifest?.releaseCommit,request.sourceCommit);
  assert.equal(evidenceHash(active.manifest),expectedManifestHash);
  const projection=projectRetirementObservation({store,operation,manifest:active.manifest,request});
  validateRetirementRecordRun(await get('actions/runs/'+request.runId),{request,operationId});
  return projection;
}

export async function main(args,env=process.env,get){
  assert.equal(process.platform,'linux','Recording requires the protected Linux host');
  const [configFile,policyFile,operationId,attempt,...extra]=args;
  assert(attempt&&extra.length===0);assert.equal(env.DEPLOY_PRODUCTION_ENABLED,'true');
  const config=await readPrivateRetirementJSON(configFile,{maximumBytes:1024*1024});
  const policy=await readPrivateRetirementJSON(policyFile,{maximumBytes:1024*1024});
  assert.equal(policy.schemaVersion,1);assert.equal(policy.productionEnabled,true);
  assert.equal(config.schemaVersion,1);assert(path.isAbsolute(config.root));
  const root=path.resolve(config.root);assert.equal(realpathSync(root),root);
  assert(!lstatSync(root).isSymbolicLink());assert.equal(lstatSync(root).mode&0o077,0);
  assertProtectedProjectionFile(configFile,root);
  const request={repository:env.GITHUB_REPOSITORY,controlCommit:env.GITHUB_SHA,sourceCommit:env.DEPLOY_SOURCE_COMMIT,
    runId:env.GITHUB_RUN_ID,attempt:env.GITHUB_RUN_ATTEMPT,eventName:env.GITHUB_EVENT_NAME,actor:env.GITHUB_ACTOR};
  const context=activeProjectionContext(request);
  const expected=path.join(root,'deploy-attempts',`deploy-${context.runId}-${context.runAttempt}`);
  assert.equal(path.resolve(attempt),expected);assert.equal(realpathSync(attempt),expected);
  const info=lstatSync(attempt);assert(info.isDirectory()&&!info.isSymbolicLink());assert.equal(info.mode&0o077,0);
  const projection=await recordRetirementObservation({store:createDeploymentStore(root),operationId,request,expectedManifestHash:env.DEPLOY_EXPECTED_MANIFEST_HASH,get:get??githubReader(request.repository,env.GITHUB_TOKEN)});
  const manifestFile=path.join(attempt,'recorded-manifest.json'),operationFile=path.join(attempt,'recorded-retirement-operation.json');
  for(const [file,document]of [[manifestFile,projection.active.manifest],[operationFile,projection.operation]]){
    writeFileSync(file,JSON.stringify(document,null,2)+'\n',{flag:'wx',mode:0o600});
  }
  // Re-check the exact current journal under the canonical projection lock.
  const result=emitProjection([configFile,operationFile,manifestFile,path.join(attempt,'deployed-release'),attempt],env);
  assert.equal(result.activeHash,projection.activeHash);
  return {...result,sourceCommit:request.sourceCommit,applicationCompositionChanged:false,databaseChanges:0};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{process.stdout.write(JSON.stringify(await main(process.argv.slice(2)))+'\n');}
  catch{process.stderr.write('Retirement record refused; retain the existing operation and protected attempt.\n');process.exitCode=1;}
}
