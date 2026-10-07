import {execFileSync} from 'node:child_process';
import {readFileSync,realpathSync,lstatSync} from 'node:fs';
import path from 'node:path';
import {evidenceHash} from './validate-manifest.mjs';
import {validateActive,assertServiceIdentities} from './deploy-state.mjs';
import {bindCaptureDatabase,databaseIdentityHash} from './database-binding.mjs';
import {checksum} from './backup-manifest.mjs';
import {collectImmutableClosure} from './ui-preservation.mjs';
import {verifyHistoricalSourceCertification} from './historical-source-certification.mjs';
import {safeExecutionEnvironment,validateExecutionProfile} from './ui-execution-profile.mjs';

const observationStages=new Set(['active','docker-context','protected-paths','infrastructure',
  'backend-image','backend-health','backend-binding','rulesWorker-image','rulesWorker-health','rulesWorker-mount',
  'frontend-image','frontend-health','frontend-mount','runtime-settings','service-identities','source-certification',
  'artifact-closure','execution-profile']);
export function isUIObservationFailureCode(code){
  return typeof code==='string'&&code.startsWith('ui-observation-')&&observationStages.has(code.slice('ui-observation-'.length));
}

export function localDockerRead(args){
  try{return execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:8*1024*1024,timeout:30000}).trim();}
  catch{throw Error('Read-only Docker observation failed; inspect protected host diagnostics');}
}
export function assertProtectedPath(root,file,{directory=false}={}){
  const absolute=path.resolve(file),relative=path.relative(path.resolve(root),absolute),stat=lstatSync(absolute);
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||stat.isSymbolicLink()||realpathSync(absolute)!==absolute
    ||(directory?!stat.isDirectory():!stat.isFile()))throw Error('Regular protected direct filesystem required');
  return absolute;
}
export async function observeUIHost(config,state,{run=localDockerRead,now=Date.now(),protectedOnly=false}={}){
  let observationStage='active';try{
  validateActive(state);if(!state.manifest)throw Error('Modern active state required');
  observationStage='docker-context';
  const endpoint=JSON.parse(run(['context','inspect','--format','{{json .Endpoints.docker.Host}}']));
  if(!/^(unix:\/\/|npipe:\/\/)/.test(endpoint)||process.env.DOCKER_HOST||process.env.DOCKER_CONTEXT)throw Error('Default local Docker endpoint required');
  if(!/^[a-z][a-z0-9_-]{0,62}$/.test(config.project))throw Error('Protected Compose project required');
  observationStage='protected-paths';
  const root=path.resolve(config.root);if(realpathSync(root)!==root||!lstatSync(root).isDirectory())throw Error('Protected real root required');
  for(const key of ['composeFile','caddyFile','appEnvFile','workerEnvFile','deployEnvFile'])assertProtectedPath(root,config[key]);
  observationStage='infrastructure';
  if(await checksum(config.composeFile)!==config.composeHash||await checksum(config.caddyFile)!==config.caddyHash)throw Error('Reviewed infrastructure drift');
  const artifactDirectory=assertProtectedPath(root,config.artifactDirectory,{directory:true});
  const assetDirectory=assertProtectedPath(root,config.assetDirectory,{directory:true});
  const services={},protectedRuntime={},executionProfile={schemaVersion:1};let databaseBindingHash;
  for(const [component,service] of [['backend','backend'],['rulesWorker','rules-worker'],['frontend','frontend']]){
    if(component==='frontend'&&protectedOnly)continue;
    observationStage=component+'-image';
    const id=run(['ps','--filter',`label=com.docker.compose.project=${config.project}`,'--filter',`label=com.docker.compose.service=${service}`,'--filter','status=running','--no-trunc','--format','{{.ID}}']);
    if(!/^[a-f0-9]{64}$/.test(id))throw Error('Exactly one healthy running component required');
    const container=JSON.parse(run(['inspect',id]))[0],expected=state.manifest.components[component].imageDigest;
    const image=JSON.parse(run(['image','inspect',expected]))[0];
    if(container.Config?.Image!==expected||container.Image!==image.Id||!image.RepoDigests?.includes(expected)
      ||container.Config.Labels?.['com.docker.compose.project']!==config.project||container.Config.Labels?.['com.docker.compose.service']!==service)throw Error('Actual component image/project differs');
    const command=component==='rulesWorker'?['node','-e',"fetch('http://127.0.0.1:8090/health').then(async r=>{if(!r.ok)process.exit(1);console.log(JSON.stringify(await r.json()))}).catch(()=>process.exit(1))"]
      :['wget','-qO-',component==='backend'?'http://127.0.0.1:8080/api/health':'http://127.0.0.1:3000/build-info.json'];
    observationStage=component+'-health';
    const health=JSON.parse(run(['exec',id,...command]));
    // Backend health adds wall-clock seconds; this is not baked/launch identity.
    // Exclude only that explicit volatile field, preserving every other field.
    const identity={...health};
    if(component==='backend'&&Object.hasOwn(identity,'timestamp')){
      if(!Number.isSafeInteger(identity.timestamp)||identity.timestamp<0)throw Error('Invalid backend health timestamp');
      delete identity.timestamp;
    }
    services[component]={healthy:container.State?.Running===true&&container.State?.Health?.Status==='healthy',imageDigest:expected,containerId:id,identity};
    if(component==='backend'){observationStage='backend-binding';databaseBindingHash=databaseIdentityHash(bindCaptureDatabase(state,container,image,identity));}
    if(component==='rulesWorker'){
      observationStage='rulesWorker-mount';
      const mounts=container.Mounts?.filter(row=>row.Destination==='/artifacts')??[];
      const directories=container.Config.Env?.filter(row=>row.startsWith('RULES_ARTIFACTS_DIR='))??[];
      if(mounts.length!==1||mounts[0].Type!=='bind'||typeof mounts[0].RW!=='boolean'
        ||path.resolve(mounts[0].Source)!==artifactDirectory||realpathSync(mounts[0].Source)!==artifactDirectory
        ||directories.length>1||directories.length===1&&directories[0]!=='RULES_ARTIFACTS_DIR=/artifacts')throw Error('Observed executable closure must be the actual worker artifact mount');
    }
    if(component==='frontend'){
      observationStage='frontend-mount';
      const mounts=container.Mounts?.filter(row=>row.Destination==='/var/lib/bagofholding/frontend')??[];
      if(mounts.length!==1||mounts[0].Type!=='bind'||mounts[0].RW!==false||path.resolve(mounts[0].Source)!==assetDirectory
        ||realpathSync(mounts[0].Source)!==assetDirectory)throw Error('Retained assets must be the actual read-only frontend mount');
    }
    if(component!=='frontend'){
      observationStage='runtime-settings';
      executionProfile[component]={instance:structuredClone(state.instances[component]),environment:safeExecutionEnvironment(component,container.Config.Env)};
      const environment=container.Config.Env??[];if(new Set(environment.map(row=>row.split('=')[0])).size!==environment.length)throw Error('Duplicate runtime environment key');
      const mounts=container.Mounts.map(row=>({Type:row.Type,Name:row.Name??null,Source:row.Source,Destination:row.Destination,RW:row.RW,Propagation:row.Propagation??null})).sort((a,b)=>a.Destination.localeCompare(b.Destination));
      protectedRuntime[component]={containerId:id,identity,configurationHash:evidenceHash({Config:{...container.Config,Env:[...environment].sort()},HostConfig:container.HostConfig}),mountsHash:evidenceHash(mounts)};
    }
  }
  observationStage='service-identities';
  if(protectedOnly){
    // Recovery can inspect protected services when the frontend is absent or
    // unhealthy. This result never asserts frontend health or whole-app health.
    for(const name of ['backend','rulesWorker']){
      const actual=services[name],expected=state.manifest.components[name],instance=state.instances[name],identity=actual.identity;
      if(!actual.healthy||identity.provenance!=='baked'||identity.component!==name||identity.sourceCommit!==expected.sourceCommit
        ||identity.inputFingerprint!==expected.inputFingerprint||identity.apiProtocolVersion!==state.manifest.apiProtocolVersion
        ||identity.releaseId!==instance.releaseId||identity.releaseCommit!==instance.releaseCommit)throw Error('Protected runtime identity differs');
    }
    const worker=services.rulesWorker.identity;
    for(const key of ['artifactHash','workerRuntime','workerProtocolVersion','supportedWorldSchemaVersions','capabilities']){
      const expected=key==='artifactHash'?state.manifest.rulesArtifactHash:state.manifest[key];
      if(evidenceHash(worker[key])!==evidenceHash(expected))throw Error('Protected worker compatibility differs');
    }
  }else assertServiceIdentities(state,services);
  for(const row of Object.values(protectedRuntime))row.databaseBindingHash=databaseBindingHash;
  const roots={artifacts:artifactDirectory},certifications=[];
  observationStage='source-certification';
  if(!Array.isArray(config.sourceCertificationDirectories??[]))throw Error('Explicit source certification directories required');
  for(const [index,directory] of (config.sourceCertificationDirectories??[]).entries()){
    const absolute=assertProtectedPath(path.join(root,'shared'),directory,{directory:true});
    const proof=await verifyHistoricalSourceCertification(absolute);roots[`source-${index}`]=absolute;
    certifications.push({releaseHash:proof.releaseHash,descriptorHash:proof.descriptorHash});
  }
  observationStage='artifact-closure';
  const files=collectImmutableClosure(roots,{now});
  // Every observed executable must be the immutable name promised by its bytes.
  for(const row of files.files.filter(row=>row.root==='artifacts'))if(!/^[a-f0-9]{64}\.cjs$/.test(row.path)||`sha256:${row.path.slice(0,64)}`!==row.sha256)throw Error('Artifact filename/content mismatch');
  observationStage='execution-profile';
  return {schemaVersion:1,kind:'ui-host-observation',scope:protectedOnly?'protected-services-only':'whole-application',observedAt:new Date(now).toISOString(),activeHash:evidenceHash(state),services,protectedRuntime,files,certifications,executionProfile:validateExecutionProfile(executionProfile),
    databaseBindingHash,routingSecurityHash:evidenceHash({composeHash:config.composeHash,caddyHash:config.caddyHash,
      deployEnvironmentHash:evidenceHash(readFileSync(config.deployEnvFile,'utf8')),appEnvironmentHash:evidenceHash(readFileSync(config.appEnvFile,'utf8')),workerEnvironmentHash:evidenceHash(readFileSync(config.workerEnvFile,'utf8'))}),
    databaseReferenceInventory:'not_executed',currentDatabaseReferenceCoverage:'not_asserted'};
  }catch{
    // Arbitrary Docker/API exceptions can contain credentials. Expose only the
    // finite phase that failed; every original guard remains mandatory.
    throw Object.assign(Error('Read-only UI observation failed'),{code:'ui-observation-'+observationStage});
  }
}
