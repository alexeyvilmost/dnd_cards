#!/usr/bin/env node
// The only dispatched host operation is retirement-record-host: no SQL/cutover.
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import {execute} from './ssh-transport.mjs';
import {validateRetirementRecordPacket,recordAttemptDirectory,validateRetirementRecordReceipt} from './ssh-retirement-record.mjs';
const read=file=>JSON.parse(readFileSync(file,'utf8'));
export async function runHostRetirementRecord({directory,token,run=execute}){
  assert.equal(process.platform,'linux');assert(token&&!/[\r\n]/.test(token));
  assert.equal(realpathSync(directory),path.resolve(directory));
  const info=lstatSync(directory);assert(info.isDirectory()&&!info.isSymbolicLink());assert.equal(info.mode&0o077,0);
  const packetFile=path.join(directory,'record-transfer.json'),packetInfo=lstatSync(packetFile);assert(packetInfo.isFile()&&!packetInfo.isSymbolicLink());assert.equal(packetInfo.mode&0o077,0);assert(packetInfo.size<=1024*1024);
  const packet=validateRetirementRecordPacket(read(packetFile)),request=packet.request;
  assert.equal(path.resolve(directory),recordAttemptDirectory(request));
  const control=path.join(directory,'control'),env={PATH:process.env.PATH,HOME:process.env.HOME,LANG:'C.UTF-8',GITHUB_TOKEN:token,
    GITHUB_REPOSITORY:request.repository,GITHUB_SHA:request.controlCommit,GITHUB_EVENT_NAME:request.eventName,GITHUB_ACTOR:request.actor,
    GITHUB_RUN_ID:String(request.runId),GITHUB_RUN_ATTEMPT:String(request.attempt),DEPLOY_SOURCE_COMMIT:request.sourceCommit,DEPLOY_PRODUCTION_ENABLED:request.productionEnabled,DEPLOY_EXPECTED_MANIFEST_HASH:packet.expectedManifestHash};
  const result=JSON.parse(await run(request.nodePath,[path.join(control,'scripts/release/retirement-record-host.mjs'),request.hostConfig,path.join(control,'infra/deployment-policy.json'),packet.operationId,directory],{cwd:directory,env,timeout:90_000}));
  assert.equal(result.status,'recorded-retirement-only');assert.equal(result.databaseChanges,0);assert.equal(result.applicationCompositionChanged,false);
  const artifact=path.join(directory,'deployed-release');
  return validateRetirementRecordReceipt({status:result.status,manifest:read(path.join(artifact,'manifest.json')),deployment:read(path.join(artifact,'deployment.json')),retirementObservation:read(path.join(artifact,'retirement-observation.json'))},packet);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const [directory,...extra]=process.argv.slice(2);assert(directory&&extra.length===0);process.stdout.write(JSON.stringify(await runHostRetirementRecord({directory,token:readFileSync(0,'utf8')}))+'\n');}
  catch{process.stderr.write('Protected retirement record failed; retain the existing journal and attempt.\n');process.exitCode=1;}
}
