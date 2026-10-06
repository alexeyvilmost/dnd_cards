#!/usr/bin/env node
// Runs only after a successful full state commit. Fresh evidence is dated now;
// original backup/rehearsal dates are retained and no DB operation is performed.
import {readFileSync,writeFileSync,renameSync,existsSync,rmSync} from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {randomUUID} from 'node:crypto';
import {capturePostDeploymentAnchor} from './capture-full-ui-anchor.mjs';import {createDeploymentStore} from './deploy-state.mjs';
import {createUIProofProjection} from './ui-proof-projection.mjs';import {assertProtectedPath,observeUIHost} from './ui-host-observation.mjs';import {evidenceHash} from './validate-manifest.mjs';
import {assertUnchangedRunningRuntime,assertImmutablePreservation} from './ui-preservation.mjs';import {checksum} from './backup-manifest.mjs';
const read=file=>JSON.parse(readFileSync(file,'utf8'));
const same=(a,b)=>evidenceHash(a)===evidenceHash(b);
export async function recheckPublishedAnchor({config,document,manifest,store,observe=observeUIHost}){
  const active=store.active(),operation=store.operation(manifest.releaseId);
  if(evidenceHash(active)!==document.activeHash||evidenceHash(operation)!==document.operationHash||store.pending().length||operation?.status!=='succeeded')throw Error('Deployment changed before anchor publication');
  const current=await observe(config,active,{now:Date.now()});
  assertUnchangedRunningRuntime(document.observation.protectedRuntime,current.protectedRuntime);
  assertImmutablePreservation(document.observation.files,current.files);
  if(current.routingSecurityHash!==document.observation.routingSecurityHash||current.databaseBindingHash!==document.observation.databaseBindingHash
    ||!same(current.executionProfile,document.executionProfile)||!same(current.services,document.observation.services)
    ||await checksum(assertProtectedPath(config.root,document.runtimeDocument.file))!==document.runtimeDocument.sha256
    ||!same(store.active(),active)||!same(store.operation(manifest.releaseId),operation)||store.pending().length)throw Error('Protected runtime changed before anchor publication');
}
function writePublication({directory,document,projection,output}){
  const pointerTemp=path.join(directory,randomUUID()+'.tmp'),outputTemp=path.join(path.dirname(output),randomUUID()+'.tmp');
  try{
    writeFileSync(pointerTemp,JSON.stringify({schemaVersion:1,anchorHash:evidenceHash(document)})+'\n',{flag:'wx',mode:0o600});
    writeFileSync(outputTemp,JSON.stringify(projection,null,2)+'\n',{flag:'wx',mode:0o600});
    renameSync(pointerTemp,path.join(directory,'current.json'));renameSync(outputTemp,output);
  }finally{for(const file of [pointerTemp,outputTemp])rmSync(file,{force:true});}
}
// Only a publication I/O failure may downgrade an already successful deployment.
// Integrity/observation errors are never converted into a success receipt.
export async function publishCapturedUIAnchor({config,document,manifest,run,output,store=createDeploymentStore(config.root),recheck=recheckPublishedAnchor,publish=writePublication}){
  const projection=createUIProofProjection(document,{manifest,run}),directory=assertProtectedPath(config.root,path.join(config.root,'full-anchors'),{directory:true});
  if(existsSync(output))throw Error('Public projection output already exists');
  const unlock=store.lock();try{
    await recheck({config,document,manifest,store});
    try{publish({directory,document,projection,output});}
    catch(error){
      if(!['ENOSPC','EDQUOT','EACCES','EPERM','EROFS','EIO'].includes(error?.code))throw error;
      await recheck({config,document,manifest,store});
      return {status:'unavailable',reason:'anchor_publication_failed'};
    }
    return {status:'published',projection};
  }finally{unlock();}
}
export async function publishFullUIAnchor({config,readyDirectory,run,output,capture=capturePostDeploymentAnchor}){
  if(!Number.isSafeInteger(run.id)||run.id<1||!Number.isSafeInteger(run.runAttempt)||run.runAttempt<1||!(/^[a-f0-9]{40}$/).test(run.controlCommit??''))throw Error('Actual deployment workflow attempt required');
  const manifest=read(path.join(readyDirectory,'manifest.json')),candidate=read(path.join(readyDirectory,'candidate.json')),bundle=read(path.join(readyDirectory,'bundle.json'));
  const backup=read(assertProtectedPath(config.root,path.join(config.backupDirectory,'backup.json'))),originals=backup.files.filter(row=>row.category==='release-manifest');
  if(originals.length!==1)throw Error('Original captured release missing');
  const original=read(assertProtectedPath(config.root,path.join(config.backupDirectory,originals[0].path))),restore=read(assertProtectedPath(config.root,path.join(config.backupDirectory,'restore-report.json')));
  const captured=await capture({config,manifest,bundle,candidate,buildPlan:candidate.buildPlan,originalBackedUpManifest:original,restoreReportHash:evidenceHash(restore)});
  const document=read(assertProtectedPath(path.join(config.root,'full-anchors'),captured.anchorFile));
  return publishCapturedUIAnchor({config,document,manifest,run,output});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [configFile,readyDirectory,runId,attempt,controlCommit,output,...extra]=process.argv.slice(2);if(!output||extra.length)throw Error('Expected exact post-success arguments');
  const result=await publishFullUIAnchor({config:read(configFile),readyDirectory,run:{id:Number(runId),runAttempt:Number(attempt),controlCommit},output});
  process.stdout.write(JSON.stringify(result)+'\n');
}
