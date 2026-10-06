#!/usr/bin/env node
// Public record of a succeeded retirement observation. Never a fresh health,
// archive, backup or DDL authorization proof; the host controller precedes it.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFileSync,writeFileSync,copyFileSync,mkdirSync,lstatSync,realpathSync} from 'node:fs';
import {validateManifest,evidenceHash} from './validate-manifest.mjs';
import {createDeploymentStore} from './deploy-state.mjs';
import {activeProjectionContext,assertProtectedProjectionFile,validatePublicActive} from './active-projection.mjs';
import {validateRetirementOutcomeJournal} from './retirement-outcome-journal.mjs';
const same=(a,b)=>evidenceHash(a)===evidenceHash(b);
const read=file=>JSON.parse(readFileSync(file,'utf8'));
function exact(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||!same(Object.keys(value).sort(),[...keys].sort()))throw Error('Unexpected retirement projection fields');}
export function validateRetirementProjection(projection,{request,manifest,expectedActive}={}){
  exact(projection,['schemaVersion','kind','status','scope','deployment','manifestHash','activeHash','operationHash','operation','active','projectionHash']);
  exact(projection.deployment,['repository','runId','runAttempt','controlCommit','sourceCommit']);
  validateManifest(manifest);validatePublicActive(projection.active);validateRetirementOutcomeJournal(projection.operation);
  validatePublicActive(projection.operation.previous);validatePublicActive(projection.operation.desired);
  const {projectionHash,...document}=projection;
  if(projection.schemaVersion!==1||projection.kind!=='recorded-active-retirement'||projection.status!=='succeeded'||projection.scope!=='recorded-retirement-only'
    ||!same(projection.deployment,activeProjectionContext(request))||projection.operation.status!=='succeeded'
    ||projection.operationHash!==evidenceHash(projection.operation)||!same(projection.active,projection.operation.desired)
    ||projection.manifestHash!==evidenceHash(manifest)||!same(projection.active.manifest,manifest)||manifest.releaseCommit!==request.sourceCommit
    ||projection.activeHash!==evidenceHash(projection.active)||projectionHash!==evidenceHash(document)
    ||expectedActive!==undefined&&!same(expectedActive,projection.active))throw Error('Recorded retirement projection identity mismatch');
  return projection;
}
export function projectRetirementObservation({store,operation,manifest,request}){
  validateManifest(manifest);activeProjectionContext(request);
  if(operation?.repeated===true){const {repeated,...recorded}=operation;operation=recorded;}
  const unlock=store.lock();
  try{
    if(store.pending().length)throw Error('Unresolved operation prevents retirement projection');
    validateRetirementOutcomeJournal(operation);const recorded=store.operation(operation.releaseId),active=validatePublicActive(store.active());
    if(!recorded||!same(recorded,operation)||recorded.status!=='succeeded'||!same(recorded.desired,active)||!same(active.manifest,manifest))throw Error('Exact current succeeded retirement journal required');
    const document={schemaVersion:1,kind:'recorded-active-retirement',status:'succeeded',scope:'recorded-retirement-only',deployment:activeProjectionContext(request),manifestHash:evidenceHash(manifest),activeHash:evidenceHash(active),operationHash:evidenceHash(recorded),operation:structuredClone(recorded),active:structuredClone(active)};
    const projection={...document,projectionHash:evidenceHash(document)};validateRetirementProjection(projection,{request,manifest,expectedActive:store.active()});return projection;
  }finally{unlock();}
}
export function retirementBaselineReceipt(projection){
  const request={...projection.deployment,runId:projection.deployment.runId,attempt:projection.deployment.runAttempt};
  validateRetirementProjection(projection,{request,manifest:projection.active.manifest});
  return {schemaVersion:1,status:'succeeded',releaseId:projection.active.manifest.releaseId,releaseCommit:projection.active.manifest.releaseCommit,controlCommit:projection.deployment.controlCommit,manifestHash:projection.manifestHash,retirementObservationHash:evidenceHash(projection)};
}
export function main(args,env=process.env){
  const [configFile,operationFile,manifestFile,output,attemptDirectory,...extra]=args;if(!attemptDirectory||extra.length)throw Error('Expected protected config, succeeded retirement journal, manifest, new output and private attempt');
  const config=read(configFile),root=path.resolve(config.root??''),attempt=path.resolve(attemptDirectory);
  if(config.schemaVersion!==1||!path.isAbsolute(config.root??'')||realpathSync(root)!==root||lstatSync(root).isSymbolicLink())throw Error('Protected deployment root required');
  const info=lstatSync(attempt);if(!path.isAbsolute(attemptDirectory)||!info.isDirectory()||info.isSymbolicLink()||realpathSync(attempt)!==attempt||process.platform!=='win32'&&(info.mode&0o077)!==0)throw Error('Exact private attempt required');
  for(const file of [configFile,path.join(root,'active.json')])assertProtectedProjectionFile(file,root);
  for(const file of [operationFile,manifestFile])assertProtectedProjectionFile(file,attempt);
  const target=path.resolve(output),parent=path.dirname(target);if(!target.startsWith(attempt+path.sep)||realpathSync(parent)!==parent||lstatSync(parent).isSymbolicLink())throw Error('New artifact output must remain in the private attempt');
  const manifest=read(manifestFile),request={repository:env.GITHUB_REPOSITORY,controlCommit:env.GITHUB_SHA,sourceCommit:env.DEPLOY_SOURCE_COMMIT,runId:env.GITHUB_RUN_ID,attempt:env.GITHUB_RUN_ATTEMPT};
  const projection=projectRetirementObservation({store:createDeploymentStore(root),operation:read(operationFile),manifest,request});
  mkdirSync(target,{mode:0o700});copyFileSync(manifestFile,path.join(target,'manifest.json'));
  writeFileSync(path.join(target,'retirement-observation.json'),JSON.stringify(projection,null,2)+'\n',{flag:'wx',mode:0o600});
  writeFileSync(path.join(target,'deployment.json'),JSON.stringify(retirementBaselineReceipt(projection),null,2)+'\n',{flag:'wx',mode:0o600});return {status:'recorded-retirement-only',activeHash:projection.activeHash,projectionHash:projection.projectionHash};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{process.stdout.write(JSON.stringify(main(process.argv.slice(2)))+'\n');}
  catch{process.stderr.write('Retirement projection refused; retain the protected journal and partial output for inspection.\n');process.exitCode=1;}
}
