#!/usr/bin/env node
// Executes existing release gates on a trusted host; stdout is public receipt only.
import {readFileSync,writeFileSync,mkdirSync,rmSync,lstatSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execute,validateSSHRequest,validatePublicReceipt,attemptDirectory,transferFiles} from './ssh-transport.mjs';
import {verifyCandidateProvenance} from './deployment-handoff.mjs';
import {evidenceHash} from './validate-manifest.mjs';

const read=file=>JSON.parse(readFileSync(file,'utf8'));
function save(file,data){writeFileSync(file,typeof data==='string'?data:JSON.stringify(data,null,2)+'\n',{flag:'wx',mode:0o600});}
export function validateTransferredCandidate(packet){
  const request=validateSSHRequest(packet?.request);
  if(JSON.stringify(Object.keys(packet.files??{}).sort())!==JSON.stringify([...transferFiles].sort()))throw Error('Unexpected transferred candidate files');
  for(const file of transferFiles){const row=packet.files[file];if(typeof row?.text!=='string'||Buffer.byteLength(row.text)>32*1024*1024
    ||'sha256:'+createHash('sha256').update(row.text).digest('hex')!==row.sha256)throw Error('Candidate transfer checksum mismatch');JSON.parse(row.text);}
  const candidate=JSON.parse(packet.files['candidate.json'].text),run=JSON.parse(packet.files['verified-release-run.json'].text);
  if(verifyCandidateProvenance(candidate,run).sourceCommit!==request.sourceCommit
    ||evidenceHash(candidate.manifest)!==evidenceHash(JSON.parse(packet.files['manifest.json'].text)))throw Error('Host candidate source mismatch');
  return request;
}
export function validateHostPacket(packet,directory){
  const request=validateTransferredCandidate(packet);
  if(path.resolve(directory)!==attemptDirectory(request)||realpathSync(directory)!==path.resolve(directory)
    ||lstatSync(directory).isSymbolicLink()||(lstatSync(directory).mode&0o077)!==0)throw Error('Private exact attempt directory required');
  return request;
}
export async function runHostRelease({directory,token,run=execute}){
  const packet=read(path.join(directory,'transfer.json')),request=validateHostPacket(packet,directory);
  return executeHostGates({directory,packet,request,token,run});
}
// Kept separate to fault-test every real command boundary on any test OS.
// The executable entrypoint always validates the protected packet/directory first.
export async function executeHostGates({directory,packet,request,token,run=execute}){
  validateSSHRequest(request);
  if(!token||/[\r\n]/.test(token))throw Error('Read-only job token required on stdin');
  const control=path.join(directory,'control'),candidate=path.join(directory,'candidate'),dockerConfig=path.join(directory,'docker-auth');
  const rehearsal=path.join(directory,'rehearsal'),ready=path.join(directory,'ready'),receipt=path.join(directory,'deployed-release');
  const operation=path.join(directory,'deployment-operation.json');
  mkdirSync(candidate,{mode:0o700});for(const name of transferFiles)save(path.join(candidate,name),packet.files[name].text);
  mkdirSync(dockerConfig,{mode:0o700});
  // No inherited token/DOCKER endpoint/PG environment. Existing host docker
  // authentication is never read or overwritten by this attempt.
  const env={PATH:process.env.PATH,HOME:process.env.HOME,LANG:'C.UTF-8',GITHUB_TOKEN:token,
    GITHUB_REPOSITORY:request.repository,GITHUB_SHA:request.controlCommit,GITHUB_EVENT_NAME:request.eventName,
    GITHUB_RUN_ID:String(request.runId),GITHUB_RUN_ATTEMPT:String(request.attempt),DEPLOY_SOURCE_COMMIT:request.sourceCommit,
    DEPLOY_PRODUCTION_ENABLED:request.productionEnabled,RECOVERY_ATTEMPT_DIRECTORY:directory,DOCKER_CONFIG:dockerConfig};
  const stages=[];let cleaned=false,aborted=false;
  const cleanup=()=>{if(cleaned)return;if(path.dirname(dockerConfig)!==path.resolve(directory)||path.basename(dockerConfig)!=='docker-auth')throw Error('Invalid auth cleanup target');rmSync(dockerConfig,{recursive:true,force:true});cleaned=true;};
  // A still-running docker login may write config.json on completion. Stop at
  // the command boundary and clean afterwards, never ahead of that writer.
  const signals=['SIGINT','SIGTERM','SIGHUP'];const stop=()=>{aborted=true;process.exitCode=130;};
  for(const signal of signals)process.once(signal,stop);
  const command=async(script,args)=>{
    if(aborted)throw Error('Host attempt interrupted; inspect outcome');
    stages.push(script);save(path.join(directory,`phase-${String(stages.length).padStart(2,'0')}.json`),{script,status:'started'});
    const output=await run(request.nodePath,[path.join(control,'scripts/release',script),...args],{cwd:directory,env});
    if(aborted)throw Error('Host attempt interrupted; inspect outcome');return output;
  };
  try{
    // Re-fetch actual GitHub workflow metadata on the host before using data;
    // uploaded metadata is a comparison input, never its own trust authority.
    const releaseRun=JSON.parse(packet.files['verified-release-run.json'].text),freshRun=path.join(directory,'verified-release-run.json');
    await command('ci-release.mjs',['verify-run',String(releaseRun.id),request.repository,'-','release',freshRun]);
    await command('deployment-handoff.mjs',['candidate',candidate,freshRun]);
    await command('automatic-release.mjs',['check-current',request.sourceCommit]);
    if(JSON.parse(packet.files['candidate.json'].text).provenance?.firstAdoptionRecovery)await command('first-adoption-recovery-host.mjs',[directory,request.hostConfig]);
    await run('docker',['login','ghcr.io','--username',request.actor,'--password-stdin'],{env,input:token});
    const prepared=await command('prepare-host-release.mjs',[request.hostConfig,path.join(control,'infra/deployment-policy.json'),request.rehearsalConfig,`capture-${request.runId}-${request.attempt}`]);
    const pointers=Object.fromEntries(prepared.trim().split('\n').map(line=>line.split('=')));
    if(!pointers.host_config||!pointers.rehearsal_config||Object.keys(pointers).length!==3)throw Error('Capture did not return exact attempt config');
    await command('candidate-rehearsal.mjs',['run',candidate,pointers.rehearsal_config,rehearsal]);
    await command('assemble-bundle.mjs',[candidate,rehearsal,ready]);
    await command('deployment-handoff.mjs',['verify',ready,freshRun,'-']);
    await command('automatic-release.mjs',['check-current',request.sourceCommit]);
    const result=JSON.parse(await command('deploy.mjs',[request.mode,'--production',pointers.host_config,path.join(control,'infra/deployment-policy.json'),ready]));
    save(operation,result);
    await command('deployment-handoff.mjs',['receipt',operation,ready,receipt]);
    const manifest=read(path.join(receipt,'manifest.json')),deployment=read(path.join(receipt,'deployment.json'));
    const activeProjectionFile=path.join(receipt,'active-projection.json');
    await command('active-projection.mjs',[pointers.host_config,operation,path.join(receipt,'manifest.json'),activeProjectionFile,directory]);
    const activeProjection=read(activeProjectionFile);
    const publicResult=validatePublicReceipt({status:'succeeded',sourceCommit:request.sourceCommit,controlCommit:request.controlCommit,manifest,deployment,activeProjection},request);
    cleanup();
    return publicResult;
  }finally{cleanup();for(const signal of signals)process.removeListener(signal,stop);}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const [directory,...extra]=process.argv.slice(2);if(!directory||extra.length)throw Error('One private host attempt required');
    const token=readFileSync(0,'utf8');process.stdout.write(JSON.stringify(await runHostRelease({directory,token}))+'\n');
  }catch{process.stderr.write('Host release failed or outcome unknown; retain private attempt and inspect deployment journal before recovery.\n');process.exitCode=1;}
}
