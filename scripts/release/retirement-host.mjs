#!/usr/bin/env node
// Explicit host entry point. No ordinary deploy/startup imports this command.
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDeploymentStore} from './deploy-state.mjs';
import {assertHostConfiguration,createDockerDeploymentAdapter} from './docker-deployment.mjs';
import {executeRetirement} from './retirement-controller.mjs';
import {verifyProductionRetirementArtifacts,readPrivateRetirementJSON} from './retirement-production-artifacts.mjs';
import {evidenceHash} from './validate-manifest.mjs';

export function assertRetirementHostPaths(config,directory,backupDirectory,releaseId) {
  assert(path.isAbsolute(directory)&&path.isAbsolute(backupDirectory));
  assert.equal(path.dirname(path.resolve(directory)),path.join(path.resolve(config.root),'retirements'));
  assert.equal(path.basename(directory),releaseId);assert(/^retirement302-[A-Za-z0-9_.-]{1,100}$/.test(releaseId));
  assert.equal(path.dirname(path.resolve(backupDirectory)),path.join(path.resolve(config.root),'backups'));
  assert(/^capture-[A-Za-z0-9][A-Za-z0-9_.-]{0,100}$/.test(path.basename(backupDirectory)));
}
const privateJSON=file=>readPrivateRetirementJSON(file,{maximumBytes:1024*1024});
export async function main(args) {
  if(args.length!==6||args[0]!=='apply'||args[1]!=='--production')throw Error('Expected apply --production HOST_CONFIG POLICY PRIVATE_RETIREMENT_DIRECTORY CAPTURE_DIRECTORY');
  const [, ,configFile,policyFile,directory,backupDirectory]=args;
  const policy=await privateJSON(policyFile),config=assertHostConfiguration(await privateJSON(configFile),policy,{production:true});
  assert.equal(policy.characterRetirementEnabled,true,'Explicit character retirement policy required');
  assert.equal(policy.automaticCharacterRetirement,false,'Automatic retirement is forbidden');
  const request=await privateJSON(path.join(directory,'request.json')),approvalFile=path.join(directory,'approval.json'),approval=await privateJSON(approvalFile);
  assertRetirementHostPaths(config,directory,backupDirectory,request.releaseId);
  const store=createDeploymentStore(config.root),active=store.active();
  const executorManifest=structuredClone(active.manifest),approvalHash=evidenceHash(approval);
  // The canonical adapter binds the live healthy backend DSN to this capture.
  // This creates a transport, not permission to call the destructive command.
  const adapter=await createDockerDeploymentAdapter({...config,backupDirectory});
  const command=adapter.createRetirementCommand({state:active,executorManifest});
  const operation=await executeRetirement({store,executorManifest,approvalHash,request,command,observe:state=>adapter.observe(state),
    verifyArtifacts:accepted=>verifyProductionRetirementArtifacts({directory,backupDirectory,approvalFile,...accepted})});
  return {schemaVersion:1,status:operation.status,releaseId:operation.releaseId,repeated:operation.repeated===true,activeHash:evidenceHash(store.active()),applicationCompositionChanged:false,productionDatabaseRestored:false,automaticMigration:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try{process.stdout.write(JSON.stringify(await main(process.argv.slice(2)))+'\n');}
  catch{process.stderr.write('Explicit character retirement refused or requires reconciliation; preserve its original journal and inspect before retrying.\n');process.exitCode=1;}
}
