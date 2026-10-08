#!/usr/bin/env node
// Transport for recording an existing succeeded retirement. No candidate/DDL.
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createReadStream} from 'node:fs';
import {readFile,writeFile,mkdir,mkdtemp,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {execute,validateSSHRequestContext,validateSSHEndpoint,sshArguments,shellQuote} from './ssh-transport.mjs';
import {unpackControlArchive} from './ssh-archive.mjs';
import {validateRetirementProjection,retirementBaselineReceipt} from './retirement-projection.mjs';
import {evidenceHash} from './validate-manifest.mjs';
import {validateRetirementRecordInput} from './retirement-record-ci.mjs';

const requestKeys=['schemaVersion','controlCommit','sourceCommit','repository','actor','eventName','mode','runId','attempt','attemptRoot','hostConfig','nodePath','productionEnabled'];
// Recording reads only the protected host journal. Application media and build
// contexts are unnecessary; the Git PAX commit and complete archive hash remain
// verified by the same authenticated unpacker used for ordinary releases.
export const retirementRecordControlPaths=Object.freeze([
  'scripts/release','scripts/testing','scripts/database','infra','tests',
  'backend/migrations/data/retire-legacy-characters-302.sql',
  'backend/migrations/character_lifecycle_301.go',
]);
const exact=(value,keys)=>assert.deepEqual(Object.keys(value??{}).sort(),[...keys].sort());
export function validateRetirementSSHRequest(request){
  exact(request,requestKeys);validateSSHRequestContext(request);
  assert.equal(request.mode,'record-retirement');assert.equal(request.eventName,'workflow_dispatch');return request;
}
export function validateRetirementRecordPacket(packet){
  exact(packet,['schemaVersion','kind','request','operationId','expectedManifestHash','archiveHash']);
  assert.equal(packet.schemaVersion,1);assert.equal(packet.kind,'record-retirement-only');validateRetirementSSHRequest(packet.request);
  assert.match(packet.operationId??'',/^retirement302-[A-Za-z0-9_.-]{1,100}$/);
  for(const key of ['expectedManifestHash','archiveHash'])assert.match(packet[key]??'',/^sha256:[a-f0-9]{64}$/);return packet;
}
export function recordAttemptDirectory(request){validateRetirementSSHRequest(request);return `${request.attemptRoot}/deploy-${request.runId}-${request.attempt}`;}
export function validateRetirementRecordReceipt(result,packet){
  validateRetirementRecordPacket(packet);exact(result,['status','manifest','deployment','retirementObservation']);assert.equal(result.status,'recorded-retirement-only');
  validateRetirementProjection(result.retirementObservation,{request:packet.request,manifest:result.manifest});
  assert.equal(result.retirementObservation.operation.releaseId,packet.operationId);
  assert.equal(evidenceHash(result.manifest),packet.expectedManifestHash);
  assert.deepEqual(result.deployment,retirementBaselineReceipt(result.retirementObservation));return result;
}
async function fileHash(file){const hash=createHash('sha256');for await(const part of createReadStream(file))hash.update(part);return 'sha256:'+hash.digest('hex');}
export async function createRetirementRecordTransfer({controlDirectory,directory,request,operationId,expectedManifestHash,run=execute}){
  validateRetirementSSHRequest(request);
  assert.equal((await run('git',['rev-parse','HEAD'],{cwd:controlDirectory})).trim(),request.controlCommit);
  assert.equal((await run('git',['status','--porcelain'],{cwd:controlDirectory})).trim(),'');
  const archive=path.join(directory,'control.tar');await run('git',['archive','--format=tar','--output',archive,request.controlCommit,'--',...retirementRecordControlPaths],{cwd:controlDirectory});
  assert((await stat(archive)).size<=2*1024**3);
  const packet=validateRetirementRecordPacket({schemaVersion:1,kind:'record-retirement-only',request,operationId,expectedManifestHash,archiveHash:await fileHash(archive)});
  const packetFile=path.join(directory,'record-transfer.json');await writeFile(packetFile,JSON.stringify(packet),{flag:'wx',mode:0o600});return{archive,packetFile,packet};
}
export async function recordRetirementOverSSH({controlDirectory,outputDirectory,request,operationId,expectedManifestHash,endpoint,privateKey,knownHosts,token,run=execute}){
  validateRetirementSSHRequest(request);validateSSHEndpoint(endpoint);
  assert(privateKey?.includes('PRIVATE KEY')&&knownHosts?.trim()&&token?.trim()&&!/[\r\n]/.test(token));
  const local=await mkdtemp(path.join(tmpdir(),'bagofholding-retirement-record-')),remote=recordAttemptDirectory(request);
  const keyFile=path.join(local,'key'),hosts=path.join(local,'known_hosts'),ssh=(command,options={})=>run('ssh',sshArguments(endpoint,keyFile,hosts,command),options);
  try{
    await writeFile(keyFile,privateKey.trim()+'\n',{mode:0o600});await writeFile(hosts,knownHosts.trim()+'\n',{mode:0o600});
    const transfer=await createRetirementRecordTransfer({controlDirectory,directory:local,request,operationId,expectedManifestHash,run});
    await ssh(`set -eu; umask 077; test -d ${shellQuote(request.attemptRoot)}; test ! -L ${shellQuote(request.attemptRoot)}; test "$(${shellQuote(request.nodePath)} -p 'process.versions.node')" = '24.19.0'; mkdir -m 700 ${shellQuote(remote)}`,{timeout:60_000});
    for(const [name,file]of [['control.tar',transfer.archive],['record-transfer.json',transfer.packetFile]])await ssh(`umask 077; set -C; cat > ${shellQuote(remote+'/'+name)}`,{inputFile:file});
    const bootstrap=`(${unpackControlArchive.toString()})(...process.argv.slice(1))`;
    await ssh(`${shellQuote(request.nodePath)} -e ${shellQuote(bootstrap)} ${shellQuote(remote)} ${shellQuote(transfer.packet.archiveHash)} ${shellQuote(request.controlCommit)}`,{timeout:120_000});
    const result=JSON.parse(await ssh(`${shellQuote(request.nodePath)} ${shellQuote(remote+'/control/scripts/release/ssh-host-retirement-record.mjs')} ${shellQuote(remote)}`,{input:token,timeout:120_000}));
    validateRetirementRecordReceipt(result,transfer.packet);await mkdir(outputDirectory,{recursive:false});
    for(const [name,document]of [['manifest.json',result.manifest],['deployment.json',result.deployment],['retirement-observation.json',result.retirementObservation]])await writeFile(path.join(outputDirectory,name),JSON.stringify(document,null,2)+'\n',{flag:'wx'});
    return {status:result.status,sourceCommit:request.sourceCommit,attemptDirectory:remote};
  }catch{throw Error('Retirement recording did not produce a verified receipt; inspect '+remote+' before another attempt');}
  finally{assert.equal(path.dirname(path.resolve(local)),path.resolve(tmpdir()));assert(path.basename(local).startsWith('bagofholding-retirement-record-'));await rm(local,{recursive:true,force:true});}
}
export function retirementRequestFromEnvironment(env){return{schemaVersion:1,controlCommit:env.GITHUB_SHA,sourceCommit:env.SOURCE_SHA,repository:env.GITHUB_REPOSITORY,actor:env.GITHUB_ACTOR,eventName:env.GITHUB_EVENT_NAME,mode:'record-retirement',runId:env.GITHUB_RUN_ID,attempt:env.GITHUB_RUN_ATTEMPT,attemptRoot:env.DEPLOY_SSH_ATTEMPT_ROOT,hostConfig:env.DEPLOY_HOST_CONFIG_FILE,nodePath:env.DEPLOY_SSH_NODE,productionEnabled:env.PRODUCTION_DEPLOY_ENABLED};}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const [control,inputFile,output,...extra]=process.argv.slice(2);assert(control&&inputFile&&output&&extra.length===0);
    const input=validateRetirementRecordInput(JSON.parse(await readFile(inputFile,'utf8'))),request=retirementRequestFromEnvironment(process.env);
    assert.equal(input.sourceCommit,request.sourceCommit);
    const result=await recordRetirementOverSSH({controlDirectory:path.resolve(control),outputDirectory:path.resolve(output),request,operationId:input.operationId,expectedManifestHash:input.expectedManifestHash,
      endpoint:{host:process.env.DEPLOY_SSH_HOST,user:process.env.DEPLOY_SSH_USER,port:Number(process.env.DEPLOY_SSH_PORT||22)},privateKey:process.env.DEPLOY_SSH_PRIVATE_KEY,knownHosts:process.env.DEPLOY_SSH_KNOWN_HOSTS,token:process.env.GITHUB_TOKEN});
    process.stdout.write(JSON.stringify(result)+'\n');
  }catch{process.stderr.write('Authenticated retirement record transport refused; inspect its protected attempt.\n');process.exitCode=1;}
}
