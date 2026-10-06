#!/usr/bin/env node
// Prepare a reviewable build configuration from an already recorded retirement.
// Does not update the input file, run SQL, publish images or deploy applications.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFileSync,writeFileSync} from 'node:fs';
import {validateBuildConfig} from './ci-release.mjs';
import {validatePublicActive} from './active-projection.mjs';
import {createDeploymentStore} from './deploy-state.mjs';
import {assertExecutableMigrationRegistry} from './migration-transition.mjs';
import {validateRetirementOutcomeJournal} from './retirement-outcome-journal.mjs';
import {evidenceHash} from './validate-manifest.mjs';

const same=(a,b)=>evidenceHash(a)===evidenceHash(b);
export function retirementBuildConfig({config,active,backendMetadata}){
  validateBuildConfig(config);validatePublicActive(active);
  const d=active.database;
  if(d?.status!=='verified-character-retirement')throw Error('A recorded installed retirement is required');
  const build=backendMetadata?.build;
  if(build?.provenance!=='baked'||build.sourceCommit!==d.request.candidateSourceCommit||build.inputFingerprint!==d.request.candidateInputFingerprint)throw Error('Metadata differs from the recorded retirement executor');
  assertExecutableMigrationRegistry(backendMetadata,d.migrationSet,d.migrationSet);
  if(!same(config.migrationSet,d.baselineMigrationSet)&&!same(config.migrationSet,d.migrationSet))throw Error('Build configuration has another migration baseline');
  const next={...structuredClone(config),migrationSet:structuredClone(d.migrationSet)};validateBuildConfig(next);
  return {config:next,receipt:{schemaVersion:1,kind:'retirement-build-baseline',status:'review-required',activeHash:evidenceHash(active),inputConfigHash:evidenceHash(config),outputConfigHash:evidenceHash(next),retirementReceiptHash:d.request.receiptHash,retirementSchemaProofHash:d.schemaProofHash,retirementApprovalHash:d.approvalHash,executorImageDigest:d.executorImageDigest,changed:!same(config,next),databaseChanges:0}};
}
export function prepareRetirementBuildBaseline({store,config,backendMetadata}){
  const unlock=store.lock();
  try{
    if(store.pending().length)throw Error('Unresolved operation blocks preparation of the next build baseline');
    const active=store.active(),operation=store.operation(active.database?.request?.releaseId??'missing-retirement');
    validateRetirementOutcomeJournal(operation);
    if(operation.status!=='succeeded'||!same(operation.desired,active))throw Error('Exact current succeeded retirement observation required');
    return retirementBuildConfig({config,active,backendMetadata});
  }finally{unlock();}
}
export function main(args){
  if(args.length!==5||args[0]!=='prepare')throw Error('Expected prepare BUILD_CONFIG DEPLOYMENT_ROOT EXECUTOR_METADATA NEW_OUTPUT');
  const [,configFile,root,metadataFile,output]=args,read=file=>JSON.parse(readFileSync(file,'utf8'));
  const result=prepareRetirementBuildBaseline({store:createDeploymentStore(root),config:read(configFile),backendMetadata:read(metadataFile)});
  // One file contains both the proposed configuration and its exact binding;
  // applying it to the repository remains a normal reviewed commit/CI action.
  writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});return result.receipt;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{process.stdout.write(JSON.stringify(main(process.argv.slice(2)))+'\n');}
  catch{process.stderr.write('Retirement build baseline preparation refused; no database or input configuration changed.\n');process.exitCode=1;}
}
