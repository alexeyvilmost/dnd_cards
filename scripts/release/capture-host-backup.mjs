#!/usr/bin/env node
// Prepared trusted-host capture. No SQL mutation, publication or restore.
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile,readdir,copyFile,lstat,realpath,chmod} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {bindCaptureDatabase,databaseIdentityHash} from './database-binding.mjs';
import {isLegacyBaseline,baselineDocument,baselineArtifact,componentImage,deploymentStateFile} from './legacy-baseline.mjs';
export {bindCaptureDatabase} from './database-binding.mjs';
import {assertHostConfiguration} from './docker-deployment.mjs';
import {validateActive} from './deploy-state.mjs';
import {checksum} from './backup-manifest.mjs';
import {evidenceHash} from './validate-manifest.mjs';

const read=async file=>JSON.parse(await readFile(file,'utf8'));
export async function assertOutsideCheckout(root,{workspace=process.env.GITHUB_WORKSPACE,cwd=process.cwd()}={}){
  const inside=(parent,child)=>{const relative=path.relative(path.resolve(parent),path.resolve(child));return relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));};
  if(workspace&&(inside(workspace,root)||inside(root,workspace)))throw Error('Private capture root overlaps workflow checkout');
  for(let directory=path.resolve(root);;directory=path.dirname(directory)){
    try{await lstat(path.join(directory,'.git'));throw Error('Private capture root is inside a Git checkout');}catch(error){if(error.code!=='ENOENT')throw error;}
    if(path.dirname(directory)===directory)break;
  }
  // Also reject a capture root that contains the currently executing checkout.
  for(let directory=path.resolve(cwd);;directory=path.dirname(directory)){
    try{await lstat(path.join(directory,'.git'));if(inside(root,directory))throw Error('Private capture root contains the current Git checkout');break;}catch(error){if(error.code!=='ENOENT')throw error;}
    if(path.dirname(directory)===directory)break;
  }
}
async function realDirectory(directory){
  if(!path.isAbsolute(directory)||/[\r\n\0,]/.test(directory)||(await lstat(directory)).isSymbolicLink()
    ||!(await lstat(directory)).isDirectory()||await realpath(directory)!==path.resolve(directory))throw Error('Existing real host directory required');
}
async function regularFile(file){
  const stat=await lstat(file);
  if(!stat.isFile()||stat.isSymbolicLink()||await realpath(file)!==path.resolve(file))throw Error('Regular protected host file required');
  return stat;
}
export function hostDumpCommand(config,output,{uid,gid}){
  if(!Number.isSafeInteger(uid)||uid<0||!Number.isSafeInteger(gid)||gid<0||/[\r\n\0,]/.test(output))throw Error('Native host uid/gid and safe capture path required');
  return ['run','--rm','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--user',`${uid}:${gid}`,
    '--network',`${config.project}_edge`,'-e','DATABASE_URL','--mount',`type=bind,src=${output},dst=/capture`,
    '--entrypoint','sh',config.postgresImage,'-ec','umask 077; exec pg_dump "$DATABASE_URL" --format=custom --no-owner --no-privileges --file=/capture/database.dump'];
}
export function createHostCaptureAdapter(config,{command,argsIdentity}={}){
  const run=command??((args,{env={}}={})=>{try{return execFileSync('docker',args,{env:{...Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.toUpperCase().startsWith('PG'))),...env},encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:2*1024*1024,timeout:20*60_000}).trim();}
    catch{throw Error('Host capture failed; private host diagnostics require separate inspection');}});
  let binding;
  function inspect(active){
    const id=run(['ps','--filter',`label=com.docker.compose.project=${config.project}`,'--filter','label=com.docker.compose.service=backend','--filter','status=running','--no-trunc','--format','{{.ID}}']);
    if(!/^[a-f0-9]{64}$/.test(id))throw Error('Exactly one running backend required for capture');
    const container=JSON.parse(run(['inspect',id]))[0],image=JSON.parse(run(['image','inspect',componentImage(active,'backend')]))[0];
    const identity=JSON.parse(run(['exec',id,'wget','-qO-','http://127.0.0.1:8080/api/health']));
    return {id,dsn:bindCaptureDatabase(active,container,image,identity)};
  }
  return {
    async preflight(active){
      const endpoint=JSON.parse(run(['context','inspect','--format','{{json .Endpoints.docker.Host}}']));
      if(!/^(unix:\/\/|npipe:\/\/)/.test(endpoint)||process.env.DOCKER_HOST||process.env.DOCKER_CONTEXT)throw Error('Default local Docker socket required');
      const network=JSON.parse(run(['network','inspect',`${config.project}_edge`]));
      if(network.length!==1||network[0].Labels?.['com.docker.compose.project']!==config.project||network[0].Labels?.['com.docker.compose.network']!=='edge')throw Error('Capture network does not belong to the reviewed deployment');
      if(await checksum(config.composeFile)!==config.composeHash||await checksum(config.caddyFile)!==config.caddyHash)throw Error('Host infrastructure differs from reviewed checksums');
      binding=inspect(active);
      return {schemaVersion:1,backendContainerId:binding.id,databaseIdentityHash:databaseIdentityHash(binding.dsn)};
    },
    async dump(output){
      if(!binding)throw Error('Capture source preflight required');
      const owner=randomBytes(12).toString('hex'),name=`capture_${owner}`,label=`bagofholding.capture=${owner}`;
      const args=hostDumpCommand(config,output,argsIdentity??{uid:process.getuid?.(),gid:process.getgid?.()});
      args.splice(1,0,'--name',name,'--label',label);
      try{run(args,{env:{DATABASE_URL:binding.dsn}});}
      finally{
        // A killed/timed-out Docker client does not necessarily stop pg_dump.
        // Remove only this generated, verified capture container; never the app.
        const listed=run(['container','ls','-a','--filter',`label=${label}`,'--format','{{.Names}}']);
        if(listed.split(/\r?\n/).includes(name)){
          const container=JSON.parse(run(['container','inspect',name]))[0];
          if(container.Config?.Labels?.['bagofholding.capture']!==owner)throw Error('Capture container ownership changed; cleanup requires inspection');
          run(['container','rm','--force',name]);
        }
      }
    },
    async verifyBinding(active){const current=inspect(active);if(!binding||current.id!==binding.id||current.dsn!==binding.dsn)throw Error('Running backend database binding changed during capture');},
  };
}
export async function captureHostBackup({config,policy,output,adapter,production=false,enabled=process.env.DEPLOY_PRODUCTION_ENABLED}){
  config=assertHostConfiguration(config,policy,{production,enabled});
  await assertOutsideCheckout(config.root);
  if(path.resolve(config.backupDirectory)!==path.join(path.resolve(config.root),'backups'))throw Error('Capture backup root must be protected config.root/backups, outside workflow checkout');
  await realDirectory(config.root);await realDirectory(config.backupDirectory);await realDirectory(config.artifactDirectory);
  output=path.resolve(output);
  // New direct child only: no mkdir-recursive, existing snapshot overwrite,
  // symlink ancestor, arbitrary deletion or path supplied by candidate content.
  if(path.dirname(output)!==path.resolve(config.backupDirectory)||!/^capture-[A-Za-z0-9][A-Za-z0-9_.-]{0,100}$/.test(path.basename(output)))throw Error('Fresh capture-* child of protected backupDirectory required');
  const activeFile=deploymentStateFile(config);await regularFile(activeFile);
  const active=validateActive(await read(activeFile)),activeHash=evidenceHash(active);
  adapter??=createHostCaptureAdapter(config);const sourceBinding=await adapter.preflight(active);
  if(sourceBinding?.schemaVersion!==1||!/^[a-f0-9]{64}$/.test(sourceBinding.backendContainerId)||!/^sha256:[a-f0-9]{64}$/.test(sourceBinding.databaseIdentityHash))throw Error('Verified capture database binding required');
  await mkdir(output,{mode:0o700}); // EEXIST is deliberately not recoverable.
  const createdAt=new Date().toISOString();
  await adapter.dump(output);
  const files=[];
  const record=async(file,category)=>{
    const stat=await regularFile(file);if(stat.size<=0)throw Error('Empty captured file');await chmod(file,0o600);
    files.push({path:path.relative(output,file).replaceAll('\\','/'),category,sha256:await checksum(file),bytes:stat.size});
  };
  await record(path.join(output,'database.dump'),'database');
  const sourceReleases=[];
  if(config.sourceCertificationDirectories!==undefined&&!Array.isArray(config.sourceCertificationDirectories))throw Error('Explicit source certification directories required');
  for(const directory of config.sourceCertificationDirectories??[]){
    await realDirectory(directory);const relative=path.relative(path.join(config.root,'shared'),directory);
    if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error('Source certification must be in protected shared directory');
    const {verifyHistoricalSourceCertification}=await import('./historical-source-certification.mjs');
    const proof=await verifyHistoricalSourceCertification(directory),prefix=`source-releases/${proof.releaseHash.slice(7)}`;
    if(sourceReleases.some(row=>row.releaseHash===proof.releaseHash))throw Error('Duplicate source certification');
    for(const file of proof.files){const source=path.join(directory,file.path),destination=path.join(output,prefix,file.path);await regularFile(source);await mkdir(path.dirname(destination),{recursive:true,mode:0o700});await copyFile(source,destination);await record(destination,'historical-source-certification');if(files.at(-1).sha256!==file.sha256||files.at(-1).bytes!==file.bytes)throw Error('Certification changed while captured');}
    const copied=await verifyHistoricalSourceCertification(path.join(output,prefix));if(copied.descriptorHash!==proof.descriptorHash)throw Error('Copied certification differs');
    sourceReleases.push({releaseHash:proof.releaseHash,descriptorHash:proof.descriptorHash,path:prefix});
  }
  const target=path.join(output,'artifacts');await mkdir(target,{mode:0o700});
  for(const entry of await readdir(config.artifactDirectory,{withFileTypes:true})){
    if(!entry.isFile()||entry.isSymbolicLink()||!/^([a-f0-9]{64})\.cjs$/.test(entry.name))throw Error('Unrecognized source executable artifact; capture is incomplete');
    const source=path.join(config.artifactDirectory,entry.name),destination=path.join(target,entry.name);
    await regularFile(source);const expected=`sha256:${entry.name.slice(0,64)}`;
    if(await checksum(source)!==expected)throw Error('Source executable artifact hash mismatch');
    await copyFile(source,destination);await record(destination,'rules-artifact');
    if(files.at(-1).sha256!==expected)throw Error('Artifact changed while being captured');
  }
  for(const [name,value,category] of [['release.json',baselineDocument(active),'release-manifest'],['active.json',active,'deployment-state'],['source-binding.json',sourceBinding,'source-binding']]){
    const file=path.join(output,name);await writeFile(file,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});await record(file,category);
  }
  if(isLegacyBaseline(active)){
    const source=path.join(config.legacyBaselineDirectory,'rollback.compose.json');await regularFile(source);
    if(evidenceHash(await read(source))!==active.rollbackConfigurationHash)throw Error('Legacy rollback configuration changed');
    const destination=path.join(output,'rollback.compose.json');await copyFile(source,destination);await record(destination,'legacy-rollback-configuration');
  }
  if(!files.some(file=>file.category==='rules-artifact'&&file.sha256===baselineArtifact(active)))throw Error('Active rules artifact missing from capture');
  await adapter.verifyBinding(active);
  await regularFile(activeFile);if(evidenceHash(validateActive(await read(activeFile)))!==activeHash)throw Error('Active deployment changed during capture; use a fresh capture');
  const capture={schemaVersion:1,kind:'candidate-capture',status:'captured',createdAt,activeHash,
    releaseManifestHash:evidenceHash(baselineDocument(active)),files,sourceReleases};
  await writeFile(path.join(output,'capture.json'),JSON.stringify(capture,null,2)+'\n',{flag:'wx',mode:0o600});
  await writeFile(path.join(output,'capture-pointer.json'),JSON.stringify({captureDirectory:output})+'\n',{flag:'wx',mode:0o600});
  return {schemaVersion:1,status:'captured',captureDirectory:output};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const [configFile,policyFile,output,...extra]=process.argv.slice(2);
    if(!configFile||!policyFile||!output||extra.length)throw Error('Expected HOSTCONFIG POLICY NEWOUTPUTDIR');
    process.stdout.write(JSON.stringify(await captureHostBackup({config:await read(configFile),policy:await read(policyFile),output,production:true}))+'\n');
  }catch{process.stderr.write('Host backup capture refused or incomplete; retain partial output for private inspection.\n');process.exitCode=1;}
}
