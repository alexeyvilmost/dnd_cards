// Hosted Actions -> trusted host transport. No production-capable Actions runner.
import {spawn} from 'node:child_process';
import {createReadStream} from 'node:fs';
import {readFile,writeFile,mkdir,mkdtemp,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {verifyCandidateProvenance} from './deployment-handoff.mjs';
import {evidenceHash,validateManifest} from './validate-manifest.mjs';
import {unpackControlArchive} from './ssh-archive.mjs';
import {assertUIProofProjection} from './ui-proof-projection.mjs';
import {validateActiveProjection} from './active-projection.mjs';

export const transferFiles=['candidate.json','manifest.json','core-report.json','verified-release-run.json'];
const hash=value=>'sha256:'+createHash('sha256').update(value).digest('hex');
const sha=/^[a-f0-9]{40}$/;
export function shellQuote(value){return `'${String(value).replaceAll("'", "'\\''")}'`;}
function absolute(value){return typeof value==='string'&&/^\/[a-zA-Z0-9_./-]+$/.test(value)&&!value.split('/').some(part=>part==='.'||part==='..')&&value!=='/';}
export function validateSSHRequestContext(request){
  if(request?.schemaVersion!==1||!sha.test(request.controlCommit??'')||!sha.test(request.sourceCommit??'')
    ||!/^\w[\w.-]*\/[\w.-]+$/.test(request.repository??'')||!/^\w[\w-]*(?:\[bot\])?$/.test(request.actor??'')
    ||!['workflow_dispatch','workflow_run'].includes(request.eventName)
    ||![request.runId,request.attempt].every(value=>/^[1-9]\d*$/.test(String(value))&&Number.isSafeInteger(Number(value)))
    ||!['attemptRoot','hostConfig','nodePath'].every(key=>absolute(request[key]))
    ||request.productionEnabled!=='true')throw Error('Invalid exact-source SSH deployment request');
  return request;
}
export function validateSSHRequest(request){
  validateSSHRequestContext(request);
  if(!['apply','adopt'].includes(request.mode)||request.mode==='adopt'&&request.eventName!=='workflow_dispatch'
    ||!absolute(request.rehearsalConfig))throw Error('Invalid exact-source SSH deployment request');
  return request;
}
export function validateSSHEndpoint(endpoint){
  if(!/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(endpoint?.host??'')||!/^\w[\w-]*$/.test(endpoint?.user??'')
    ||!Number.isInteger(endpoint.port)||endpoint.port<1||endpoint.port>65535)throw Error('Invalid explicit SSH endpoint');
  return endpoint;
}
export function sshArguments(endpoint,keyFile,knownHosts,remoteCommand){
  validateSSHEndpoint(endpoint);
  return ['-T','-F','/dev/null','-o','PermitLocalCommand=no','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o',`UserKnownHostsFile=${knownHosts}`,
    '-o','GlobalKnownHostsFile=/dev/null','-o','ForwardAgent=no','-o','ClearAllForwardings=yes','-o','ConnectTimeout=20',
    '-o','ServerAliveInterval=15','-o','ServerAliveCountMax=3','-p',String(endpoint.port),'-i',keyFile,`${endpoint.user}@${endpoint.host}`,remoteCommand];
}
export async function execute(command,args,{cwd,input,inputFile,env=process.env,timeout=3_600_000,maxOutput=8*1024*1024}={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{cwd,env,stdio:['pipe','pipe','pipe']});let output='',bytes=0,settled=false,terminalError,killTimer;
    const finish=(error)=>{if(settled)return;settled=true;clearTimeout(timer);clearTimeout(killTimer);error?reject(error):resolve(output);};
    // Await close before callers clean credential files that this child could
    // still be writing. A timed-out SSH child still leaves remote outcome unknown.
    const stop=error=>{if(terminalError)return;terminalError=error;child.kill();killTimer=setTimeout(()=>child.kill('SIGKILL'),2000);};
    const timer=setTimeout(()=>stop(Error('Transport command timed out; remote outcome requires inspection')),timeout);
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stdout.on('data',chunk=>{bytes+=Buffer.byteLength(chunk);if(bytes>maxOutput)stop(Error('Transport output exceeded bound'));else if(!terminalError)output+=chunk;});
    // Child output may include private diagnostics. It never enters Actions logs.
    child.stderr.on('data',()=>{});child.on('error',()=>finish(Error('Transport process unavailable')));
    child.on('close',code=>finish(terminalError??(code===0?null:Error(`Transport command failed (${code}); inspect protected host attempt`))));
    child.stdin.on('error',()=>{});
    if(inputFile){const stream=createReadStream(inputFile);stream.on('error',()=>stop(Error('Transfer input unavailable')));stream.pipe(child.stdin);}
    else child.stdin.end(input??'');
  });
}
async function fileHash(file){const digest=createHash('sha256');for await(const chunk of createReadStream(file))digest.update(chunk);return 'sha256:'+digest.digest('hex');}
export async function createTransfer({controlDirectory,candidateDirectory,request,directory,run=execute}){
  validateSSHRequest(request);
  const head=(await run('git',['rev-parse','HEAD'],{cwd:controlDirectory})).trim();
  if(head!==request.controlCommit||(await run('git',['status','--porcelain'],{cwd:controlDirectory})).trim())throw Error('Control checkout must be clean at exact workflow SHA');
  const archive=path.join(directory,'control.tar');
  await run('git',['archive','--format=tar','--output',archive,request.controlCommit],{cwd:controlDirectory});
  if((await stat(archive)).size>2*1024**3)throw Error('Control archive exceeds transfer bound');
  const files={};
  for(const name of transferFiles){const raw=await readFile(path.join(candidateDirectory,name),'utf8');if(Buffer.byteLength(raw)>32*1024*1024)throw Error('Candidate input exceeds transfer bound');JSON.parse(raw);files[name]={text:raw,sha256:hash(raw)};}
  const candidate=JSON.parse(files['candidate.json'].text),verified=JSON.parse(files['verified-release-run.json'].text);
  if(verifyCandidateProvenance(candidate,verified).sourceCommit!==request.sourceCommit
    ||evidenceHash(candidate.manifest)!==evidenceHash(JSON.parse(files['manifest.json'].text)))throw Error('Transferred candidate identity mismatch');
  const packet={request,archiveHash:await fileHash(archive),files};
  const packetFile=path.join(directory,'transfer.json');await writeFile(packetFile,JSON.stringify(packet),{flag:'wx',mode:0o600});
  return {archive,packet,packetFile};
}

export function attemptDirectory(request){validateSSHRequest(request);return `${request.attemptRoot}/deploy-${request.runId}-${request.attempt}`;}
export function validatePublicReceipt(result,request){
  validateSSHRequest(request);validateManifest(result?.manifest);
  const exact=(value,keys)=>value&&evidenceHash(Object.keys(value).sort())===evidenceHash([...keys].sort());
  const ui=result.deployment?.kind==='frontend-only';
  if(!exact(result,['status','sourceCommit','controlCommit','manifest','deployment','activeProjection',...(result.frontendProof!==undefined?['frontendProof']:[])])
    ||!exact(result.deployment,['schemaVersion','status','releaseId','releaseCommit','controlCommit','manifestHash',...(ui?['kind','operationHash','originalFullAnchorHash','completedAt']:[])]))throw Error('Unexpected public deployment receipt fields');
  if(result.status!=='succeeded'||result.controlCommit!==request.controlCommit||result.sourceCommit!==request.sourceCommit
    ||result.manifest.releaseCommit!==request.sourceCommit||result.deployment?.schemaVersion!==1||result.deployment.status!=='succeeded'
    ||result.deployment.releaseId!==result.manifest.releaseId||result.deployment.manifestHash!==evidenceHash(result.manifest)
    ||result.deployment.controlCommit!==request.controlCommit||result.deployment.releaseCommit!==request.sourceCommit)throw Error('Host returned an invalid deployment receipt');
  validateActiveProjection(result.activeProjection,{request,manifest:result.manifest});
  if(result.frontendProof!==undefined){
    const proof=result.frontendProof;
    if(proof?.status==='published'){
      if(!exact(proof,['projection','status']))throw Error('Invalid published frontend proof');
      assertUIProofProjection(proof.projection,{manifest:result.manifest,run:{id:Number(request.runId),runAttempt:Number(request.attempt),controlCommit:request.controlCommit}});
    }else if(proof?.status!=='unavailable'||proof.reason!=='anchor_publication_failed'||!exact(proof,['reason','status']))throw Error('Invalid unavailable frontend proof');
  }
  if(ui){
    const d=result.deployment,p=result.frontendProof;
    if(p?.status!=='published'||!/^sha256:[a-f0-9]{64}$/.test(d.operationHash??'')||!/^sha256:[a-f0-9]{64}$/.test(d.originalFullAnchorHash??'')
      ||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(d.completedAt??'')||!Number.isFinite(Date.parse(d.completedAt))||new Date(d.completedAt).toISOString()!==d.completedAt
      ||d.operationHash!==result.activeProjection.operationHash||d.originalFullAnchorHash!==p.projection.anchorHash
      ||evidenceHash(result.activeProjection.active.uiProofAnchor)!==evidenceHash(p.projection.originalAnchor))throw Error('Frontend deployment receipt projection mismatch');
  }
  return result;
}
export async function deployOverSSH({controlDirectory,candidateDirectory,outputDirectory,request,endpoint,privateKey,knownHosts,token,run=execute}){
  validateSSHRequest(request);validateSSHEndpoint(endpoint);
  if(!privateKey?.includes('PRIVATE KEY')||!knownHosts?.trim()||!token?.trim()||/[\r\n]/.test(token))throw Error('SSH key, pinned hosts and read-only job token required');
  const local=await mkdtemp(path.join(tmpdir(),'bagofholding-ssh-'));
  const keyFile=path.join(local,'key'),hosts=path.join(local,'known_hosts'),remote=attemptDirectory(request);
  const ssh=(command,options={})=>run('ssh',sshArguments(endpoint,keyFile,hosts,command),options);
  try{
    await writeFile(keyFile,privateKey.trim()+'\n',{mode:0o600});await writeFile(hosts,knownHosts.trim()+'\n',{mode:0o600});
    const transfer=await createTransfer({controlDirectory,candidateDirectory,request,directory:local,run});
    // Only existing administrator-provisioned parent; no mkdir -p or remote symlink traversal.
    const prepare=`set -eu; umask 077; test -d ${shellQuote(request.attemptRoot)}; test ! -L ${shellQuote(request.attemptRoot)}; test "$(${shellQuote(request.nodePath)} -p 'process.versions.node')" = '24.19.0'; mkdir -m 700 ${shellQuote(remote)}`;
    await ssh(prepare,{timeout:60_000});
    await ssh(`umask 077; set -C; cat > ${shellQuote(remote+'/control.tar')}`,{inputFile:transfer.archive});
    await ssh(`umask 077; set -C; cat > ${shellQuote(remote+'/transfer.json')}`,{inputFile:transfer.packetFile});
    const bootstrap=`(${unpackControlArchive.toString()})(...process.argv.slice(1))`;
    await ssh(`${shellQuote(request.nodePath)} -e ${shellQuote(bootstrap)} ${shellQuote(remote)} ${shellQuote(transfer.packet.archiveHash)} ${shellQuote(request.controlCommit)}`,{timeout:120_000});
    // Credentials travel through stdin, never command arguments or the archive.
    const result=JSON.parse(await ssh(`${shellQuote(request.nodePath)} ${shellQuote(remote+'/control/scripts/release/ssh-host-release.mjs')} ${shellQuote(remote)}`,{input:token,timeout:55*60_000}));
    validatePublicReceipt(result,request);
    await mkdir(outputDirectory,{recursive:false});
    await writeFile(path.join(outputDirectory,'manifest.json'),JSON.stringify(result.manifest,null,2)+'\n',{flag:'wx'});
    await writeFile(path.join(outputDirectory,'deployment.json'),JSON.stringify(result.deployment,null,2)+'\n',{flag:'wx'});
    await writeFile(path.join(outputDirectory,'active-projection.json'),JSON.stringify(result.activeProjection,null,2)+'\n',{flag:'wx'});
    if(result.frontendProof?.status==='published')await writeFile(path.join(outputDirectory,'frontend-proof-anchor.json'),JSON.stringify(result.frontendProof.projection,null,2)+'\n',{flag:'wx'});
    if(result.frontendProof)await writeFile(path.join(outputDirectory,'frontend-proof-status.json'),JSON.stringify({status:result.frontendProof.status,...(result.frontendProof.status==='unavailable'?{reason:result.frontendProof.reason}:{anchorHash:result.frontendProof.projection.anchorHash})},null,2)+'\n',{flag:'wx'});
    return {status:'succeeded',attemptDirectory:remote,sourceCommit:request.sourceCommit,controlCommit:request.controlCommit};
  }catch(error){throw Error(`SSH deployment did not produce a verified receipt. Do not repeat apply blindly; inspect ${remote} and the existing deployment journal. ${error.message}`);}
  finally{if(path.dirname(path.resolve(local))!==path.resolve(tmpdir())||!path.basename(local).startsWith('bagofholding-ssh-'))throw Error('Invalid temporary cleanup target');await rm(local,{recursive:true,force:true});}
}
