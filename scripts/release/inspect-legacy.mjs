#!/usr/bin/env node
import {withLegacyReadSnapshot} from './read-snapshot.mjs';
// Read-only live inspection. Only the protected output directory is created;
// no application container, DB row, schema, image tag or active.json is changed.
import {readFile,writeFile,mkdir,lstat,realpath} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {evidenceHash} from './validate-manifest.mjs';
import {legacyServices,validateLegacyBaseline,legacyRuntimeFingerprint} from './legacy-baseline.mjs';
import {databaseURLFromEnvironment,databaseIdentityHash} from './database-binding.mjs';
import {databaseRecoveryInventory} from './artifact-references.mjs';
import {assertOutsideCheckout} from './capture-host-backup.mjs';
const read=async file=>JSON.parse(await readFile(file,'utf8'));
function defaultCommand(args,{input,env={}}={}){
  try{return execFileSync('docker',args,{input,env:{...Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.toUpperCase().startsWith('PG'))),...env},encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:16*1024*1024,timeout:300000,windowsHide:true}).trim();}
  catch(error){const code=error.code==='ENOBUFS'?'ENOBUFS':/canceling statement due to statement timeout/.test(String(error.stderr??''))?'PG_STATEMENT_TIMEOUT':undefined;throw Object.assign(Error('Legacy observation failed; no application mutation attempted'),code?{code}:{});}
}
export function legacyInspectorConfiguration(config){
  if(config?.schemaVersion!==1||!/^([a-z][a-z0-9_-]{0,62})$/.test(config.project??'')||!/^[a-f0-9]{40}$/.test(config.claimedReleaseCommit??'')
    ||!Array.isArray(config.envFiles)||!config.envFiles.length||!/^\S+@sha256:[a-f0-9]{64}$/.test(config.postgresImage??''))throw Error('Explicit reviewed legacy inspector configuration required');
  for(const file of [config.root,config.composeFile,...config.envFiles])if(typeof file!=='string'||!path.isAbsolute(file)||/[\r\n\0,]/.test(file))throw Error('Absolute protected legacy paths required');
  if(config.databaseNetwork!==`${config.project}_edge`)throw Error('Reviewed existing project edge network required');
  return config;
}
const decode=value=>String(value).replaceAll('$$','$');
export {withLegacyReadSnapshot} from './read-snapshot.mjs';
export function resolvedLegacyServiceHash(document,project,service,command){
  if(!Object.values(legacyServices).includes(service)||!/^[a-z][a-z0-9_-]{0,62}$/.test(project))throw Error('Reviewed legacy service/project required');
  // Compose 2.40 config --hash uses WithoutEnvironmentResolution. Hash the
  // already resolved document instead, so env_file values are included exactly
  // as they were when `up` created the container. Secrets remain on stdin.
  const output=command(['compose','--project-name',project,'-f','-','config','--hash',service],{input:JSON.stringify(document)});
  const value=output.trim().split(/\s+/).at(-1);if(!/^[a-f0-9]{64}$/.test(value))throw Error('Invalid resolved Compose service hash');return value;
}
export function assertLegacyConfiguration(document,containers,claimedReleaseCommit){
  const pinned=structuredClone(document);
  for(const [key,name] of Object.entries(legacyServices)){
    const container=containers[key],service=document.services?.[name];
    if(!service||container.State?.Running!==true||container.State.Health?.Status!=='healthy'||!/^sha256:[a-f0-9]{64}$/.test(container.Image??'')
      ||container.Config?.Image!==service.image)throw Error('Legacy resolved configuration does not match healthy running images');
    const actual=new Map((container.Config.Env??[]).map(item=>{const index=item.indexOf('=');return [item.slice(0,index),item.slice(index+1)];}));
    for(const [name,value] of Object.entries(service.environment??{}))if(actual.get(name)!==decode(value))throw Error('Legacy environment file differs from running container');
    if(actual.get('SOURCE_COMMIT')!==claimedReleaseCommit)throw Error('Legacy runtime source claim differs');
    for(const flag of ['DB_COMPACT_RECEIPTS','DB_FROZEN_CATALOGS','IMAGE_JOBS_ENABLED'])if(actual.get(flag)==='1')throw Error('Old-reader rollback requires expansion writers disabled');
    // Config-hash comparison is performed by the adapter before this helper.
    // Pin the immutable local image ID: never rely on mutable old tags to roll back.
    pinned.services[name].image=container.Image;
    delete pinned.services[name].build;delete pinned.services[name].pull_policy;
  }
  return pinned;
}
export function createLegacyInspector(config,{command=defaultCommand}={}){
  legacyInspectorConfiguration(config);
  const compose=['compose','--project-name',config.project,...config.envFiles.flatMap(file=>['--env-file',file]),'-f',config.composeFile];
  return {
    async inspect(){
      const endpoint=JSON.parse(command(['context','inspect','--format','{{json .Endpoints.docker.Host}}']));
      if(!/^(unix:\/\/|npipe:\/\/)/.test(endpoint)||process.env.DOCKER_HOST||process.env.DOCKER_CONTEXT)throw Error('Local Docker socket required');
      const network=JSON.parse(command(['network','inspect',config.databaseNetwork]))[0];
      if(network.Labels?.['com.docker.compose.project']!==config.project||network.Labels?.['com.docker.compose.network']!=='edge')throw Error('Legacy database network ownership differs');
      const document=JSON.parse(command([...compose,'config','--format','json'])),containers={},components={};let rulesArtifactHash;
      for(const [key,name] of Object.entries(legacyServices)){
        const id=command(['ps','--filter',`label=com.docker.compose.project=${config.project}`,'--filter',`label=com.docker.compose.service=${name}`,'--filter','status=running','--no-trunc','--format','{{.ID}}']);
        if(!/^[a-f0-9]{64}$/.test(id))throw Error('Exactly one healthy legacy component required');
        const container=JSON.parse(command(['inspect',id]))[0];containers[key]=container;
        const configuredHash=resolvedLegacyServiceHash(document,config.project,name,command);
        if(!/^[a-f0-9]{64}$/.test(configuredHash)||configuredHash!==container.Config.Labels?.['com.docker.compose.config-hash'])throw Error('Legacy Compose source changed since containers were created');
        const url=key==='rulesWorker'?'http://127.0.0.1:8090/health':key==='backend'?'http://127.0.0.1:8080/api/health':'http://127.0.0.1:3000/build-info.json';
        const args=key==='rulesWorker'?['node','-e',`fetch('${url}').then(async r=>{if(!r.ok)process.exit(1);console.log(JSON.stringify(await r.json()))}).catch(()=>process.exit(1))`]:['wget','-qO-',url];
        const health=JSON.parse(command(['exec',id,...args]));
        if((health.source_commit??health.sourceCommit)!==config.claimedReleaseCommit||key!=='frontend'&&health.status!=='ok')throw Error('Legacy health/runtime source claim differs');
        const image=JSON.parse(command(['image','inspect',container.Image]))[0];if(image.Id!==container.Image)throw Error('Legacy image ID unavailable');
        components[key]={containerId:id,imageReference:container.Config.Image,imageId:container.Image,healthy:true,runtimeClaim:config.claimedReleaseCommit,configurationHash:legacyRuntimeFingerprint(container),composeSourceHash:`sha256:${configuredHash}`};
        if(key==='rulesWorker'){
          rulesArtifactHash=command(['exec',id,'node','-e',"const{readFileSync}=require('node:fs');const{createHash}=require('node:crypto');process.stdout.write('sha256:'+createHash('sha256').update(readFileSync('/app/artifact.cjs')).digest('hex'))"]);
          if(rulesArtifactHash!==health.artifactHash)throw Error('Legacy current artifact bytes differ from health');
        }
      }
      const rollbackConfiguration=assertLegacyConfiguration(document,containers,config.claimedReleaseCommit);
      const dsn=databaseURLFromEnvironment(containers.backend.Config.Env),name=`legacy_inspect_${randomUUID().replaceAll('-','')}`,label=`bagofholding.legacy-inspection=${name}`;
      let snapshot,progress;
      const query=async sql=>{
        await progress();
        try{const output=command(['run','--name',name,'--label',label,'--rm','-i','--read-only','--network',config.databaseNetwork,'-e','DATABASE_URL','-e','PGCONNECT_TIMEOUT=10','--entrypoint','sh',config.postgresImage,'-ec','exec psql "$DATABASE_URL" -X -qAt -v ON_ERROR_STOP=1'],{input:`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET TRANSACTION SNAPSHOT '${snapshot}'; SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='2s';\n${sql}\nCOMMIT;`,env:{DATABASE_URL:dsn}});await progress();return output;}
        finally{
          const listed=command(['container','ls','-a','--filter',`label=${label}`,'--format','{{.Names}}']);
          if(listed.split(/\r?\n/).includes(name)){
            const value=JSON.parse(command(['container','inspect',name]))[0];if(value.Config.Labels?.['bagofholding.legacy-inspection']!==name)throw Error('Inspection helper ownership changed');
            command(['container','rm','--force',name]);
          }
        }
      };
      const inventory=await withLegacyReadSnapshot({command,config,dsn,name,label},async (exported,renew)=>{snapshot=exported;progress=renew;return databaseRecoveryInventory({query},config.inventory??{});});
      const body={schemaVersion:1,kind:'observed-legacy-baseline',status:'observed',provenance:'runtime-observation-only',deployable:false,
        observedAt:new Date().toISOString(),claimedReleaseCommit:config.claimedReleaseCommit,components,rulesArtifactHash,
        rollbackConfigurationHash:evidenceHash(rollbackConfiguration),databaseIdentityHash:databaseIdentityHash(dsn),schemaFingerprint:inventory.schemaFingerprint,
        migrationIds:inventory.migrations,artifactHashes:[...new Set([...inventory.artifactHashes,rulesArtifactHash])].sort(),historicalChecksums:'unavailable',bakedIdentity:'unavailable'};
      // Recheck actual containers after all reads, without persisting secrets.
      for(const [key,row] of Object.entries(components)){
        const current=JSON.parse(command(['inspect',row.containerId]))[0];
        if(current.State?.Running!==true||current.Image!==row.imageId||evidenceHash(current.Config)!==evidenceHash(containers[key].Config))throw Error('Legacy deployment changed during inspection');
      }
      return {baseline:validateLegacyBaseline({...body,observationHash:evidenceHash(body)}),rollbackConfiguration};
    },
  };
}
export async function inspectLegacy({config,output,adapter}){
  legacyInspectorConfiguration(config);await assertOutsideCheckout(config.root);
  const root=path.resolve(config.root);if((await lstat(root)).isSymbolicLink()||await realpath(root)!==root)throw Error('Real protected root required');
  output=path.resolve(output);if(path.dirname(output)!==root||!/^legacy-observation-[A-Za-z0-9_-]+$/.test(path.basename(output)))throw Error('New legacy-observation-* child of protected root required');
  const result=await (adapter??createLegacyInspector(config)).inspect();validateLegacyBaseline(result.baseline);
  if(evidenceHash(result.rollbackConfiguration)!==result.baseline.rollbackConfigurationHash)throw Error('Rollback configuration proof differs');
  await mkdir(output,{mode:0o700});
  for(const [file,value] of [['baseline.json',result.baseline],['rollback.compose.json',result.rollbackConfiguration]])await writeFile(path.join(output,file),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
  return {status:'observed',directory:output,observationHash:result.baseline.observationHash,deployable:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const [file,output,...extra]=process.argv.slice(2);if(!file||!output||extra.length)throw Error('Expected CONFIG NEW_OUTPUT');process.stdout.write(JSON.stringify(await inspectLegacy({config:await read(file),output}))+'\n');}
  catch{process.stderr.write('Legacy inspection refused or incomplete; no active manifest was written.\n');process.exitCode=1;}
}
