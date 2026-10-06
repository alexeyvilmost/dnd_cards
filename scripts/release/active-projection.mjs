#!/usr/bin/env node
// Public recorded-state receipt. This is not a fresh health, database or replay proof.
import {readFileSync,writeFileSync,lstatSync,realpathSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDeploymentStore,validateActive,serviceOrder} from './deploy-state.mjs';
import {validateManifest,evidenceHash,validateMigrationSet} from './validate-manifest.mjs';
import {assertFullAnchorBinding} from './ui-release-policy.mjs';

const sha=/^[a-f0-9]{40}$/,hash=/^sha256:[a-f0-9]{64}$/,release=/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const same=(a,b)=>evidenceHash(a)===evidenceHash(b);
const read=file=>JSON.parse(readFileSync(file,'utf8'));
function exact(value,keys){
  if(!value||typeof value!=='object'||Array.isArray(value)||!same(Object.keys(value).sort(),[...keys].sort()))throw Error('Unexpected public projection fields');
}
function positive(value){return /^[1-9]\d*$/.test(String(value))&&Number.isSafeInteger(Number(value));}
function context(request){
  if(!/^\w[\w.-]*\/[\w.-]+$/.test(request?.repository??'')||!sha.test(request.controlCommit??'')||!sha.test(request.sourceCommit??'')
    ||!positive(request.runId)||!positive(request.attempt))throw Error('Exact deployment workflow identity required');
  return {repository:request.repository,runId:Number(request.runId),runAttempt:Number(request.attempt),controlCommit:request.controlCommit,sourceCommit:request.sourceCommit};
}
// Reject unknown fields rather than silently project away a private value. The
// retained active hash therefore identifies the exact persisted active document.
export function validatePublicActive(active){
  exact(active,['schemaVersion','status','manifest','instances',...(active?.database!==undefined?['database']:[]),...(active?.uiProofAnchor!==undefined?['uiProofAnchor']:[])]);
  validateActive(active);
  // Only the canonical compact binding is public. The protected domain/profile
  // remains private; authority comes from the exact succeeded journal below.
  if(active.uiProofAnchor!==undefined)assertFullAnchorBinding(active.uiProofAnchor,active.uiProofAnchor.runtimeCompatibilityHash);
  exact(active.instances,serviceOrder);
  for(const key of serviceOrder)exact(active.instances[key],['releaseId','releaseCommit']);
  if(active.database!==undefined){
    const d=active.database,r=d.request;
    exact(d,['schemaVersion','status','migrationSet','schemaProofHash','approvalHash','request','executorImageDigest']);
    const common=['schemaVersion','releaseId','target','candidateSourceCommit','candidateInputFingerprint'];
    exact(r,[...common,...(r?.schemaVersion===2?['kind','baselineObservationHash','expectedCurrentIds']:['expectedCurrent'])]);
    if(!release.test(r.releaseId??''))throw Error('Invalid recorded database release identity');
    validateMigrationSet(d.migrationSet);validateMigrationSet(r.target);
    if(r.schemaVersion===1)validateMigrationSet(r.expectedCurrent);
    else if(!r.expectedCurrentIds.every(id=>typeof id==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,255}$/.test(id)))throw Error('Invalid recorded migration IDs');
  }
  return active;
}
// Structural validation alone does not manufacture authority. Callers must bind
// request/manifest to the authenticated workflow; emission additionally compares
// expectedActive with the protected deployment store while holding its lock.
export function validateActiveProjection(projection,{request,manifest,expectedActive}={}){
  exact(projection,['schemaVersion','kind','status','scope','deployment','manifestHash','activeHash','operationHash','active','projectionHash']);
  exact(projection.deployment,['repository','runId','runAttempt','controlCommit','sourceCommit']);
  validateManifest(manifest);validatePublicActive(projection.active);
  const {projectionHash,...document}=projection;
  if(projection.schemaVersion!==1||projection.kind!=='recorded-active-deployment'||projection.status!=='succeeded'||projection.scope!=='recorded-active-only'
    ||!same(projection.deployment,context(request))||!hash.test(projection.operationHash??'')||projection.manifestHash!==evidenceHash(manifest)
    ||!same(projection.active.manifest,manifest)||manifest.releaseCommit!==request.sourceCommit||projection.activeHash!==evidenceHash(projection.active)
    ||projectionHash!==evidenceHash(document)||expectedActive!==undefined&&!same(projection.active,expectedActive))throw Error('Recorded active projection identity mismatch');
  return projection;
}
export function projectSucceededActive({store,operation,manifest,request}){
  validateManifest(manifest);context(request);
  const unlock=store.lock();
  try{
    if(store.pending().length)throw Error('Unresolved deployment operation prevents public projection');
    const active=validatePublicActive(store.active()),recorded=store.operation(manifest.releaseId);
    // deploy() may return the exact previously succeeded operation plus a local
    // repeated marker. No other journal differences are normalized.
    const {repeated,...provided}=operation??{};
    if(repeated!==undefined&&repeated!==true)throw Error('Invalid repeated deployment marker');
    if(!recorded||recorded.schemaVersion!==1||recorded.status!=='succeeded'||recorded.releaseId!==manifest.releaseId
      ||!same(recorded,provided)||recorded.plan?.candidateHash!==evidenceHash(manifest)||!same(recorded.plan.desired,active)
      ||!same(active.manifest,manifest))throw Error('Current active state does not match the exact succeeded operation');
    const document={schemaVersion:1,kind:'recorded-active-deployment',status:'succeeded',scope:'recorded-active-only',deployment:context(request),
      manifestHash:evidenceHash(manifest),activeHash:evidenceHash(active),operationHash:evidenceHash(recorded),active:structuredClone(active)};
    const projection={...document,projectionHash:evidenceHash(document)};
    validateActiveProjection(projection,{request,manifest,expectedActive:store.active()});
    return projection;
  }finally{unlock();}
}
function protectedFile(file,root){
  const absolute=path.resolve(file),relative=path.relative(root,absolute);
  if(!relative||relative.startsWith('..'+path.sep)||path.isAbsolute(relative)||lstatSync(absolute).isSymbolicLink()
    ||realpathSync(absolute)!==absolute||!lstatSync(absolute).isFile())throw Error('Protected regular deployment state required');
}
export function main(args,env=process.env){
  const [configFile,operationFile,manifestFile,outputFile,attemptDirectory,...extra]=args;
  if(!attemptDirectory||extra.length)throw Error('Expected protected config, succeeded operation, manifest, new projection path and exact private attempt');
  const config=read(configFile),root=path.resolve(config.root??'');
  // The store/configuration and authenticated SSH attempt can have distinct
  // protected roots. No paths or configuration values enter the public DTO.
  if(config.schemaVersion!==1||!path.isAbsolute(config.root??'')||root!==realpathSync(root)||lstatSync(root).isSymbolicLink())throw Error('Protected deployment root required');
  const attempt=path.resolve(attemptDirectory),info=lstatSync(attempt);
  if(!path.isAbsolute(attemptDirectory)||!info.isDirectory()||info.isSymbolicLink()||realpathSync(attempt)!==attempt||process.platform!=='win32'&&(info.mode&0o077)!==0)throw Error('Exact private attempt directory required');
  for(const file of [configFile,path.join(root,'active.json')])protectedFile(file,root);
  for(const file of [operationFile,manifestFile])protectedFile(file,attempt);
  const parent=path.dirname(path.resolve(outputFile));
  if(parent!==attempt&&!parent.startsWith(attempt+path.sep)||realpathSync(parent)!==parent||lstatSync(parent).isSymbolicLink())throw Error('Protected existing output directory required');
  const manifest=read(manifestFile),request={repository:env.GITHUB_REPOSITORY,controlCommit:env.GITHUB_SHA,sourceCommit:env.DEPLOY_SOURCE_COMMIT,runId:env.GITHUB_RUN_ID,attempt:env.GITHUB_RUN_ATTEMPT};
  const store=createDeploymentStore(root);
  const projection=projectSucceededActive({store,operation:read(operationFile),manifest,request});
  writeFileSync(outputFile,JSON.stringify(projection,null,2)+'\n',{flag:'wx',mode:0o600});
  return {status:'succeeded',activeHash:projection.activeHash,projectionHash:projection.projectionHash};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{process.stdout.write(JSON.stringify(main(process.argv.slice(2)))+'\n');}
  catch{process.stderr.write('Recorded active projection refused; retain the successful deployment journal and inspect the protected attempt.\n');process.exitCode=1;}
}
