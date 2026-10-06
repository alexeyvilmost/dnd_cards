// Read an already accepted private launch; never re-render it from newer env or
// Compose inputs. The protected files are authority, then pinned for this attempt.
import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {evidenceHash} from './validate-manifest.mjs';
import {assertRuntimeWriterPolicy} from './writer-environment.mjs';
import {databaseURLFromEnvironment,databaseIdentityHash} from './database-binding.mjs';
import {assertFullAnchorBinding,runtimeCompatibilityHash} from './ui-release-policy.mjs';
import {frontendComposition} from './docker-ui-deployment.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const components={backend:'backend',frontend:'frontend',rulesWorker:'rules-worker'};
const same=(a,b)=>evidenceHash(a)===evidenceHash(b);
const application=state=>{const {database,...rest}=state;return rest;};
function fileBytes(root,file){
 const absolute=path.resolve(file),relative=path.relative(path.resolve(root),absolute),s=lstatSync(absolute);
 if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||s.isSymbolicLink()||!s.isFile()||realpathSync(absolute)!==absolute||s.size>8*1024*1024)throw Error('Invalid protected retained launch file');
 const bytes=readFileSync(absolute),after=lstatSync(absolute);
 if(s.size!==after.size||s.mtimeMs!==after.mtimeMs||s.ino!==after.ino||s.dev!==after.dev||bytes.length!==s.size)throw Error('Retained launch changed while read');
 return bytes;
}
export function readRetainedRuntime(config,state,{command,expectedEnvironment}){
 const selective=Object.hasOwn(state,'uiProofAnchor');
 const directory=path.join(config.root,selective?'frontend-releases':'releases',state.manifest.releaseId);
 const files=new Map(),take=file=>{if(!files.has(file))files.set(file,fileBytes(config.root,file));return files.get(file);};
 let expectedSelective;
 if(selective){
  const operationFile=path.join(config.root,'operations',state.manifest.releaseId+'.json');
  const operation=JSON.parse(take(operationFile));
  if(operation.kind!=='frontend-only'||operation.status!=='succeeded'||operation.releaseId!==state.manifest.releaseId
   ||operation.plan?.kind!=='frontend-only'||!same(operation.plan.changed,['frontend'])||!same(application(operation.plan.desired),application(state))
   ||operation.plan.candidateHash!==evidenceHash(state.manifest)||!same(operation.plan.anchor,state.uiProofAnchor))throw Error('Succeeded frontend journal must bind the exact retained application');
  assertFullAnchorBinding(state.uiProofAnchor,runtimeCompatibilityHash(state.manifest,operation.plan.domain));
  for(const key of ['backend','rulesWorker'])if(!same(operation.plan.previous.manifest.components[key],state.manifest.components[key])||!same(operation.plan.previous.instances[key],state.instances[key]))throw Error('Frontend journal changed protected launches');
  const previousPolicy=operation.plan.previous.manifest.writerPolicy;
  if(Object.hasOwn(operation.plan.previous.manifest,'writerPolicy')!==Object.hasOwn(state.manifest,'writerPolicy')||!same(previousPolicy??null,state.manifest.writerPolicy??null))throw Error('Frontend journal changed explicit writer lineage');
  const anchorRoot=path.join(config.root,'full-anchors');let anchorFile=config.frontendAnchorFile;
  if(!anchorFile){const pointer=JSON.parse(take(path.join(anchorRoot,'current.json')));if(pointer.schemaVersion!==1||!/^sha256:[a-f0-9]{64}$/.test(pointer.anchorHash??''))throw Error('Protected full anchor pointer required');anchorFile=path.join(anchorRoot,pointer.anchorHash.slice(7)+'.json');}
  const anchor=JSON.parse(take(anchorFile));
  if(path.dirname(path.resolve(anchorFile))!==path.resolve(anchorRoot)||path.basename(anchorFile)!==evidenceHash(anchor).slice(7)+'.json'
   ||anchor.kind!=='protected-full-ui-anchor'||anchor.status!=='captured-after-success'||!same(anchor.binding,state.uiProofAnchor)
   ||anchor.currentDatabaseSnapshot!==false||anchor.currentDatabaseReferenceCoverage!=='not_asserted'||anchor.databaseReferenceInventory!=='not_executed')throw Error('Retained UI launch lacks its exact protected original anchor');
  const originalFile=anchor.runtimeDocument?.file,originalBytes=take(originalFile);
  if('sha256:'+hash(originalBytes)!==anchor.runtimeDocument.sha256)throw Error('Original resolved launch hash changed');
  expectedSelective=frontendComposition(JSON.parse(originalBytes),state);
  // Retain the original input files as well, without interpreting their dates
  // as a new backup or their contents as a current database-reference scan.
  for(const name of ['state.json','compose.env','compose.prod.yml','Caddyfile'])take(path.join(path.dirname(originalFile),name));
 }else{
 for(const name of ['state.json','compose.env','compose.prod.yml','Caddyfile'])take(path.join(directory,name));
 if(!same(JSON.parse(files.get(path.join(directory,'state.json'))),application(state)))throw Error('Retained application state differs from accepted manifest');
 const env={};
 for(const line of files.get(path.join(directory,'compose.env')).toString('utf8').trimEnd().split('\n')){
  const i=line.indexOf('=');if(i<1||line.includes('\r')||line.includes('\0')||Object.hasOwn(env,line.slice(0,i)))throw Error('Invalid retained environment record');
  env[line.slice(0,i)]=line.slice(i+1);
 }
 const oldEnvironment={...expectedEnvironment};
 if(!Object.hasOwn(state.manifest,'writerPolicy'))for(const key of ['DB_COMPACT_RECEIPTS','DB_FROZEN_CATALOGS','IMAGE_JOBS_ENABLED'])delete oldEnvironment[key];
 const paths=['APP_ENV_FILE','WORKER_ENV_FILE','RULES_ARTIFACTS_DIRECTORY','FRONTEND_ASSETS_DIRECTORY'];
 const values=Object.fromEntries(Object.entries(env).filter(([key])=>!paths.includes(key)));
 if(!same(values,expectedEnvironment)&&!same(values,oldEnvironment))throw Error('Retained environment differs from accepted writer/image/launch identity');
 if(paths.some(key=>typeof env[key]!=='string'||!path.isAbsolute(env[key])||/[\r\n\0]/.test(env[key])))throw Error('Retained environment paths missing');
 if(path.resolve(env.RULES_ARTIFACTS_DIRECTORY)!==path.resolve(config.artifactDirectory)||path.resolve(env.FRONTEND_ASSETS_DIRECTORY)!==path.resolve(config.assetDirectory))throw Error('Retained immutable store paths differ');
 }
 const runtimeFile=path.join(directory,'compose.runtime.json'),original=JSON.parse(take(runtimeFile));
 if(selective&&!same(original,expectedSelective))throw Error('Retained frontend launch differs from canonical original projection');
 function validate(document){
  for(const [key,name]of Object.entries(components)){
   const service=document.services?.[name],instance=state.instances[key];
   if(service?.image!==state.manifest.components[key].imageDigest||service.environment?.RELEASE_ID!==instance.releaseId||service.environment.RELEASE_COMMIT!==instance.releaseCommit)throw Error('Retained runtime image or launch identity differs');
  }
  const environment=Object.entries(document.services.backend.environment).map(([key,value])=>key+'='+String(value).replaceAll('$$','$'));
  assertRuntimeWriterPolicy(environment,state);
  return databaseIdentityHash(databaseURLFromEnvironment(environment));
 }
 const databaseHash=validate(original);
 const unchanged=()=>{for(const [file,bytes]of files)if(!fileBytes(config.root,file).equals(bytes))throw Error('Immutable retained launch bytes changed');};
 return {directory,runtimeFile,databaseHash,files:[...files].map(([file,bytes])=>({name:path.basename(file),sha256:'sha256:'+hash(bytes)})),
  document(){unchanged();const value=JSON.parse(files.get(runtimeFile));validate(value);return value;},
  assertUnchanged:unchanged,
  assertLive(){
   unchanged();
   for(const [key,name]of Object.entries(components)){
    const id=command(['ps','-a','--filter',`label=com.docker.compose.project=${config.project}`,'--filter',`label=com.docker.compose.service=${name}`,'--no-trunc','--format','{{.ID}}']);
    if(!/^[a-f0-9]{64}$/.test(id))throw Error('Exactly one retained component required');
    const actual=JSON.parse(command(['inspect',id]))[0],labels=actual.Config?.Labels;
    if(actual.Config?.Image!==state.manifest.components[key].imageDigest||labels?.['com.docker.compose.project']!==config.project||labels?.['com.docker.compose.service']!==name)throw Error('Live retained component identity differs');
    const raw=command(['compose','--project-name',config.project,'-f',runtimeFile,'config','--hash',name]).trim();
    const match=raw.match(new RegExp(`^(?:${name}\\s+)?([a-f0-9]{64})$`));
    if(!match||labels['com.docker.compose.config-hash']!==match[1])throw Error('Live runtime profile differs from retained resolved launch');
   }
   unchanged();
  }};
}
