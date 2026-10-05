#!/usr/bin/env node
// Owned loopback-only OCI exercise. This never creates a CI/deployment manifest.
import {createHash,randomUUID,randomInt} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync,mkdirSync,copyFileSync,lstatSync,realpathSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {components,inventory,ignorePolicy,copyInputs,checkEmbeddedInputs,validateImagePins} from './measure-local.mjs';
import {componentInputFingerprint,evidenceHash} from './validate-manifest.mjs';
import {fileHash,inspectIdentity} from './ci-images.mjs';
import {assertOCIMediaDisabled} from './write-build-identity.mjs';
import {cleanEnvironment} from '../testing/runtime.mjs';

const digest=/^[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}$/;
const hash=/^sha256:[a-f0-9]{64}$/;
const pinsFor={backend:['GO_IMAGE','ALPINE_IMAGE'],frontend:['NODE_IMAGE','NGINX_IMAGE'],worker:['NODE_IMAGE']};
const componentsFor={backend:'backend',frontend:'frontend',worker:'rulesWorker'};
const sourceHash=files=>`sha256:${createHash('sha256').update(files.map(f=>`${f.path}\0${f.sha256}`).join('\n')).digest('hex')}`;
const git=(repo,args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const childPath=(root,target)=>{const rel=path.relative(root,target);if(!rel||rel.startsWith('..')||path.isAbsolute(rel))throw Error('Rehearsal output must be a strict owned descendant');};
export function prepareOwnedRegistryFixture({repo,output}) {
  repo=realpathSync(repo);output=path.resolve(output);childPath(path.join(repo,'outputs/release-measure'),output);
  if(existsSync(output))throw Error('A new owned fixture directory is required');
  for(let parent=path.dirname(output);parent!==repo;parent=path.dirname(parent))if(existsSync(parent)&&lstatSync(parent).isSymbolicLink())throw Error('Fixture output symlink rejected');
  const collect=()=>{
    const entries=new Map();for(const spec of Object.values(components)){
      const root=path.resolve(repo,spec.context),files=inventory(root,ignorePolicy(readFileSync(path.join(repo,spec.ignore),'utf8')));
      copyInputs(readFileSync(path.join(repo,spec.dockerfile),'utf8'),files);if(spec.context==='backend')checkEmbeddedInputs(root,files);
      for(const file of files){const relative=path.posix.join(spec.context==='.'?'':spec.context,file.path);if(entries.has(relative)&&entries.get(relative).sha256!==file.sha256)throw Error('Overlapping source contexts changed');entries.set(relative,{...file,path:relative});}
      if(!entries.has(spec.ignore)){const bytes=readFileSync(path.join(repo,spec.ignore));entries.set(spec.ignore,{path:spec.ignore,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
    }return [...entries.values()].sort((a,b)=>a.path.localeCompare(b.path));
  };
  const source=collect(),fixture=path.join(output,'fixture');mkdirSync(fixture,{recursive:true});
  for(const file of source){const target=path.join(fixture,file.path);mkdirSync(path.dirname(target),{recursive:true});copyFileSync(path.join(repo,file.path),target);if(createHash('sha256').update(readFileSync(target)).digest('hex')!==file.sha256)throw Error('Fixture copy drift');}
  if(sourceHash(collect())!==sourceHash(source))throw Error('Source changed while creating owned fixture');
  // Only this new repository receives objects/refs. The application repository
  // is read-only; this commit is a test fixture, never a release attestation.
  if(existsSync(path.join(fixture,'.gitignore')))throw Error('Generated fixture ignore would replace a source input');
  writeFileSync(path.join(fixture,'.gitignore'),'/outputs/\n');
  const fixtureGit=args=>execFileSync('git',['-c','core.autocrlf=false','-c','core.longpaths=true','-c','commit.gpgsign=false','-C',fixture,...args],{encoding:'utf8',env:cleanEnvironment({GIT_CONFIG_NOSYSTEM:'1'}),stdio:['ignore','pipe','pipe']}).trim();
  fixtureGit(['init','--quiet','--template=']);fixtureGit(['add','--force','--all']);
  const stage=execFileSync('git',['-C',fixture,'ls-files','--stage','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
  for(const entry of stage){const match=entry.match(/^100644 ([a-f0-9]{40}) 0\t([\s\S]+)$/);if(!match)throw Error('Unexpected fixture index mode');const bytes=readFileSync(path.join(fixture,match[2]));if(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')!==match[1])throw Error('Git filters changed fixture source bytes');}
  const tree=fixtureGit(['write-tree']),commit=fixtureGit(['-c','user.name=Owned OCI rehearsal fixture','-c','user.email=fixture@example.invalid','commit-tree',tree,'-m','Nondeployable exact source fixture']);fixtureGit(['update-ref','HEAD',commit]);
  if(sourceHash(collect())!==sourceHash(source))throw Error('Source changed before fixture commit completed');
  const evidence={schemaVersion:1,kind:'owned-registry-source-fixture',deployable:false,originHead:git(repo,['rev-parse','HEAD']),sourceBasis:'current allowed working-tree Docker inputs; not origin HEAD provenance',sourceFingerprint:sourceHash(source),files:source,fixtureCommit:commit,generatedInputs:['.gitignore']};
  const evidencePath=path.join(output,'source-manifest.json');writeFileSync(evidencePath,JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});
  return {repo:fixture,sourceEvidence:{path:evidencePath,hash:evidenceHash(evidence),fixtureCommit:commit}};
}
export function validateLocalRegistryPlan(plan) {
  if(plan?.schemaVersion!==1||plan.kind!=='local-registry-rehearsal'||plan.deployable!==false||plan.ciProvenance!==null
    ||!/^\d{4}-\d\d-\d\dT/.test(plan.createdAt??'')||!/^[a-f0-9-]{36}$/.test(plan.runId??'')||!/^[a-f0-9]{40}$/.test(plan.sourceCommit??'')
    ||plan.platform!=='linux/amd64'||!digest.test(plan.registryImage??'')||plan.rows?.length!==3||!path.isAbsolute(plan.repo??'')||!path.isAbsolute(plan.output??''))throw Error('Invalid non-deployable local registry plan');
  childPath(path.join(plan.repo,'outputs/release-measure'),plan.output);
  const {planHash,...body}=plan;if(planHash!==evidenceHash(body))throw Error('Local registry plan changed');
  const names=new Set();for(const row of plan.rows){
    if(!components[row.name]||names.has(row.name)||row.component!==componentsFor[row.name]||!hash.test(row.sourceFingerprint??'')
      ||row.inputFingerprint!==componentInputFingerprint(row)||row.platform!==plan.platform||!Array.isArray(row.files)||!row.files.length
      ||row.sourceFingerprint!==sourceHash(row.files)||Object.keys(row.baseImages).sort().join(',')!==pinsFor[row.name].toSorted().join(',')
      ||Object.values(row.baseImages).some(v=>!digest.test(v)))throw Error('Local component input identity changed');
    if(row.name==='frontend'?(row.buildArguments.VITE_MEDIA_VARIANTS!=='0'||Object.keys(row.buildArguments).sort().join(',')!=='VITE_API_URL,VITE_MEDIA_VARIANTS'):Object.keys(row.buildArguments).length)throw Error('Unsupported local compile arguments');
    names.add(row.name);
    if(row.snapshot!==path.join(plan.output,'source',row.name)||row.dockerfile!==path.relative(path.resolve(plan.repo,components[row.name].context),path.join(plan.repo,components[row.name].dockerfile)))throw Error('Owned component paths changed');
  }return plan;
}
export function prepareLocalRegistryPlan({repo,output,baseImages,registryImage,platform='linux/amd64',sourceEvidence=null}) {
  assertOCIMediaDisabled(process.env);validateImagePins(baseImages);
  repo=realpathSync(repo);output=path.resolve(output);const outputRoot=path.join(repo,'outputs/release-measure');childPath(outputRoot,output);
  if(existsSync(output)||!digest.test(registryImage??'')||platform!=='linux/amd64')throw Error('New output and digest-pinned local runtime inputs required');
  for(let parent=path.dirname(output);parent!==repo;parent=path.dirname(parent))if(existsSync(parent)&&lstatSync(parent).isSymbolicLink())throw Error('Rehearsal output symlink rejected');
  if(git(repo,['status','--porcelain','--untracked-files=all']))throw Error('Local registry source must be a clean committed checkout');
  const sourceCommit=git(repo,['rev-parse','HEAD']),runId=randomUUID(),rows=[];
  mkdirSync(output,{recursive:true});
  for(const [name,spec]of Object.entries(components)) {
    const source=path.resolve(repo,spec.context),files=inventory(source,ignorePolicy(readFileSync(path.join(repo,spec.ignore),'utf8')));
    copyInputs(readFileSync(path.join(repo,spec.dockerfile),'utf8'),files);if(name==='backend')checkEmbeddedInputs(source,files);
    const snapshot=path.join(output,'source',name);for(const file of files){const target=path.join(snapshot,file.path);mkdirSync(path.dirname(target),{recursive:true});copyFileSync(path.join(source,file.path),target);if(createHash('sha256').update(readFileSync(target)).digest('hex')!==file.sha256)throw Error('Source changed during snapshot');}
    const ignoreTarget=path.join(snapshot,path.relative(source,path.join(repo,spec.ignore)));mkdirSync(path.dirname(ignoreTarget),{recursive:true});copyFileSync(path.join(repo,spec.ignore),ignoreTarget);
    const row={name,component:componentsFor[name],sourceFingerprint:sourceHash(files),baseImages:Object.fromEntries(pinsFor[name].map(key=>[key,baseImages[key]])),
      buildArguments:name==='frontend'?{VITE_API_URL:'',VITE_MEDIA_VARIANTS:'0'}:{},platform,files,snapshot,dockerfile:path.relative(source,path.join(repo,spec.dockerfile))};
    row.inputFingerprint=componentInputFingerprint(row);rows.push(row);
  }
  if(git(repo,['rev-parse','HEAD'])!==sourceCommit||git(repo,['status','--porcelain','--untracked-files=all']))throw Error('Source checkout drifted during preparation');
  if(sourceEvidence&&(sourceEvidence.fixtureCommit!==sourceCommit||evidenceHash(JSON.parse(readFileSync(sourceEvidence.path)))!==sourceEvidence.hash))throw Error('Owned source fixture evidence changed');
  const body={schemaVersion:1,kind:'local-registry-rehearsal',deployable:false,ciProvenance:null,createdAt:new Date().toISOString(),runId,sourceCommit,sourceEvidence,platform,registryImage,repo,output,rows};
  const plan=validateLocalRegistryPlan({...body,planHash:evidenceHash(body)});writeFileSync(path.join(output,'plan.json'),JSON.stringify(plan,null,2)+'\n',{flag:'wx'});return plan;
}
export function assertLocalRecord(plan,row,record,archiveHash) {
  validateLocalRegistryPlan(plan);
  if(record?.scope!=='owned-loopback-registry'||record.planHash!==plan.planHash||record.name!==row.name
    ||record.inputFingerprint!==row.inputFingerprint||record.sourceCommit!==plan.sourceCommit||!hash.test(record.imageId??'')
    ||!hash.test(record.archiveHash??'')||record.archiveHash!==archiveHash||!hash.test(record.runtimeContentFingerprint??''))throw Error('Local image record/archive identity changed');
  const identity=record.identity;
  if(identity?.sourceCommit!==plan.sourceCommit||identity.source_commit!==plan.sourceCommit||identity.component!==row.component||identity.inputFingerprint!==row.inputFingerprint
    ||identity.provenance!=='baked'||identity.identitySchemaVersion!==1||identity.apiProtocolVersion!==1)throw Error('Actual baked image identity mismatch');
  if(row.component==='rulesWorker'&&(!hash.test(identity.artifactHash??'')||identity.workerProtocolVersion!==1||identity.workerRuntime?.name!=='node'))throw Error('Worker artifact/runtime proof missing');
  return record;
}
const mustFail=async fn=>{let failed=false;try{await fn();}catch{failed=true;}if(!failed)throw Error('Negative registry scenario unexpectedly succeeded');};
export const localRegistryStages=Object.freeze(['build-publish-pull-three-components','registry-payload-byte-and-content-proof','two-warm-builds-preserve-runtime-layers-and-identities','repeat-publication-same-digest','frontend-only-build-input-change-reuses-other-digests','invalid-plan-refused-before-registry','corrupt-archive-refused-before-publication','missing-manifest-pull-refused','missing-layer-manifest-refused']);
// Download the actual encoded registry objects once, checking every byte against
// its content address. This measures HTTP response payloads, not Docker's cached
// pull traffic, transport headers or decompressed filesystem size.
export async function measureRegistryPayload(repository,imageDigest,request) {
  if(!/^[a-z0-9][a-z0-9._/-]*$/.test(repository)||!hash.test(imageDigest))throw Error('Invalid registry object identity');
  const objects=new Map();
  const read=async(kind,objectDigest,expectedSize)=>{
    if(objects.has(objectDigest)){const known=objects.get(objectDigest);if(expectedSize!==undefined&&known.bytes!==expectedSize)throw Error('Conflicting registry descriptor size');return known;}
    const response=await request(`/v2/${repository}/${kind==='manifest'?'manifests':'blobs'}/${objectDigest}`,{headers:{Accept:'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json','Accept-Encoding':'identity'}});
    if(!response.ok||!response.body||![null,'identity'].includes(response.headers.get('content-encoding')))throw Error('Registry object transfer failed');
    let bytes=0;const h=createHash('sha256'),chunks=[];
    for await(const chunk of response.body){bytes+=chunk.length;h.update(chunk);if(kind==='manifest'){if(bytes>2*1024*1024)throw Error('Oversized registry manifest');chunks.push(chunk);}}
    if(`sha256:${h.digest('hex')}`!==objectDigest||(expectedSize!==undefined&&bytes!==expectedSize))throw Error('Transferred registry object hash/size mismatch');
    const object={digest:objectDigest,kind,bytes};objects.set(objectDigest,object);return {...object,...(kind==='manifest'?{document:JSON.parse(Buffer.concat(chunks))}:{})};
  };
  let manifest=await read('manifest',imageDigest);const attachments=[];
  if(Array.isArray(manifest.document.manifests)){
    const descriptors=manifest.document.manifests;if(descriptors.length>32)throw Error('Oversized platform manifest index');
    const selected=descriptors.filter(x=>x.platform?.os==='linux'&&x.platform?.architecture==='amd64');
    if(selected.length!==1)throw Error('Unambiguous linux/amd64 registry manifest required');
    for(const descriptor of descriptors.filter(x=>x!==selected[0])){
      if(descriptor.platform?.os!=='unknown'||descriptor.platform?.architecture!=='unknown'||descriptor.annotations?.['vnd.docker.reference.type']!=='attestation-manifest')throw Error('Unexpected extra registry platform');
      attachments.push(await read('manifest',descriptor.digest,descriptor.size));
    }
    manifest=await read('manifest',selected[0].digest,selected[0].size);
  }
  for(const [item,attachment]of [[manifest,false],...attachments.map(item=>[item,true])]){
    const doc=item.document;if(doc?.schemaVersion!==2||!doc.config||!Array.isArray(doc.layers))throw Error('Image manifest required');
    for(const [kind,descriptor]of [['config',doc.config],...doc.layers.map(x=>[attachment?'attestation':'layer',x])]){
      if(!hash.test(descriptor?.digest??'')||!Number.isSafeInteger(descriptor.size)||descriptor.size<0)throw Error('Invalid registry descriptor');
      await read(kind,descriptor.digest,descriptor.size);
    }
  }
  const files=[...objects.values()];return {measurement:'actual hash-verified HTTP response payload bytes; complete published linux/amd64 index including attestations; unique objects; excludes headers/TLS and Docker cache',imageDigest,objects:files,
    totalPayloadBytes:files.reduce((n,x)=>n+x.bytes,0),compressedLayerBytes:files.filter(x=>x.kind==='layer').reduce((n,x)=>n+x.bytes,0)};
}
export async function runLocalRegistryRehearsal(plan,adapter) {
  validateLocalRegistryPlan(plan);
  const report={schemaVersion:1,kind:'local-registry-rehearsal-result',deployable:false,ciProvenance:null,execution:adapter.execution,
    planHash:plan.planHash,sourceCommit:plan.sourceCommit,runId:plan.runId,status:'running',checks:[],images:{},cleanup:{status:'pending'}};
  const check=async(id,fn)=>{await fn();report.checks.push({id,status:'passed'});await adapter.save(report);};
  try {
    await adapter.preflight(plan);await adapter.start(plan);
    const records={};
    await check('build-publish-pull-three-components',async()=>{for(const row of plan.rows){const record=await adapter.build(row,{mode:'cold'});assertLocalRecord(plan,row,record,await adapter.archiveHash(record));records[row.name]=record;report.images[row.name]=await adapter.publish(row,record);await adapter.pull(report.images[row.name]);}});
    report.records=records;report.builds=Object.values(records).map(record=>record.build).filter(Boolean);
    await check('registry-payload-byte-and-content-proof',async()=>{
      report.transfers={};for(const [name,reference]of Object.entries(report.images))report.transfers[name]=await adapter.measureTransfer(reference);
      if(adapter.legacyFrontendMeasurement)report.legacyFrontend=await adapter.legacyFrontendMeasurement();
    });
    await check('two-warm-builds-preserve-runtime-layers-and-identities',async()=>{
      for(const row of plan.rows)for(const mode of ['warm-1','warm-2']){
        const record=await adapter.build(row,{mode});assertLocalRecord(plan,row,record,await adapter.archiveHash(record));
        if(record.runtimeContentFingerprint!==records[row.name].runtimeContentFingerprint||evidenceHash(record.identity)!==evidenceHash(records[row.name].identity))throw Error('Warm rebuild changed runtime image content/identity');
        // BuildKit's timestamped attestation changes its OCI index digest even
        // when the cached runtime config/layers are byte-identical. Record it;
        // immutable publication is separately tested by replaying one archive.
        record.build.imageId=record.imageId;record.build.runtimeContentFingerprint=record.runtimeContentFingerprint;
        if(record.build)report.builds.push(record.build);
      }
    });
    await check('repeat-publication-same-digest',async()=>{for(const row of plan.rows)if(await adapter.publish(row,records[row.name])!==report.images[row.name])throw Error('Repeated publication changed digest');});
    await check('frontend-only-build-input-change-reuses-other-digests',async()=>{
      const row=plan.rows.find(r=>r.name==='frontend'),changed={...row,buildArguments:{...row.buildArguments,VITE_API_URL:'/local-registry-rehearsal'}};
      changed.inputFingerprint=componentInputFingerprint(changed);const record=await adapter.build(changed,{mode:'frontend-input-change'});
      assertLocalRecord(plan,changed,record,await adapter.archiveHash(record));const changedDigest=await adapter.publish(changed,record);
      if(changedDigest===report.images.frontend)throw Error('Changed baked input fingerprint did not change frontend image');
      for(const name of ['backend','worker'])await adapter.pull(report.images[name]);
      report.changedFrontendDigest=changedDigest;report.reused=['backend','worker'];
      report.changedFrontendTransfer=await adapter.measureTransfer(changedDigest);
      const known=new Set(report.transfers.frontend.objects.map(x=>x.digest));report.changedFrontendMissingObjectBytes=report.changedFrontendTransfer.objects.filter(x=>!known.has(x.digest)).reduce((n,x)=>n+x.bytes,0);
      if(record.build)report.builds.push(record.build);
    });
    await check('invalid-plan-refused-before-registry',()=>mustFail(()=>{validateLocalRegistryPlan({...plan,deployable:true});}));
    await check('corrupt-archive-refused-before-publication',async()=>{
      const row=plan.rows[0],record=records[row.name],corrupted=await adapter.corruptArchiveCopy(record);
      await mustFail(()=>adapter.publish(row,corrupted));
    });
    await check('missing-manifest-pull-refused',async()=>{const proof=await adapter.missingManifest();if(proof?.boundary!=='pull'||proof.status!=='rejected')throw Error('Actual negative pull proof missing');});
    await check('missing-layer-manifest-refused',async()=>{const proof=await adapter.missingLayerManifest(report.images.frontend);if(proof?.boundary!=='registry'||proof.status!=='rejected'||proof.code!=='MANIFEST_BLOB_UNKNOWN')throw Error('Actual missing-layer registry proof missing');report.missingLayer=proof;});
    report.status='passed';
  }catch(error){report.status='failed';report.failure='Local registry rehearsal failed; inspect owned logs';throw error;}
  finally {
    try{await adapter.cleanup();report.cleanup={status:'stopped'};}catch{report.status='failed';report.cleanup={status:'failed'};}
    await adapter.save(report);if(report.cleanup.status!=='stopped')throw Error('Owned registry cleanup failed');
  }return report;
}

export function createLocalRegistryDockerAdapter(plan,{docker='docker',builder='default',command,legacyFrontendImageId}={}) {
  if(legacyFrontendImageId!==undefined&&!hash.test(legacyFrontendImageId))throw Error('Exact legacy frontend image ID required');
  validateLocalRegistryPlan(plan);const env=cleanEnvironment(),run=plan.runId,name=`boh-registry-${run}`,label=`bagofholding.registry-rehearsal=${run}`;
  let buildOutput;
  const exec=command??((args)=>{
    const result=spawnSync(docker,args,{encoding:'utf8',env,windowsHide:true,stdio:['ignore','pipe','pipe'],maxBuffer:32*1024*1024,timeout:1_800_000});
    if(args[0]==='buildx'&&args[1]==='build')buildOutput=(result.stdout??'')+(result.stderr??'');
    if(result.error||result.status!==0){writeFileSync(path.join(plan.output,`docker-command-failed-${Date.now()}.json`),JSON.stringify({arguments:args,code:result.status,error:result.error?.message,stderr:result.stderr??''},null,2)+'\n');throw Object.assign(new Error('Owned Docker command failed'),{stderr:result.stderr??'',code:result.status});}return result.stdout.trim();
  });
  const resources=[],tags=new Set();let origin,httpOrigin,active=false;
  const own=kind=>{const data=JSON.parse(exec([kind,'inspect',name]))[0];const labels=kind==='container'?data.Config?.Labels:data.Labels;if(labels?.['bagofholding.registry-rehearsal']!==run)throw Error('Registry resource ownership changed');return data;};
  const save=async report=>writeFileSync(path.join(plan.output,'report.json'),JSON.stringify(report,null,2)+'\n');
  const localRef=ref=>{if(!origin||!ref.startsWith(origin+'/')||!digest.test(ref))throw Error('Only this owned loopback registry is accepted');return ref;};
  const registry=async(route,options={})=>{if(!active||!/^\/v2\//.test(route))throw Error('Owned registry not active');own('container');return fetch('http://'+httpOrigin+route,{...options,signal:AbortSignal.timeout(60_000),redirect:'error'});};
  const adapter={execution:command?'simulation':'docker',save,
    async preflight(){
      const endpoint=JSON.parse(exec(['context','inspect','--format','{{json .Endpoints.docker.Host}}']));if(!/^(unix|npipe):\/\//.test(endpoint))throw Error('Only a local Docker daemon is permitted');
      if(exec(['info','--format','{{.OSType}}'])!=='linux')throw Error('Linux OCI daemon required');
      if(!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(builder))throw Error('Invalid local builder');
      const info=exec(['buildx','inspect',builder]),context=exec(['context','show']);const endpoints=[...info.matchAll(/^Endpoint:\s+(\S+)\s*$/gm)].map(m=>m[1]);
      if(!/^Driver:\s+docker(?:-container)?\s*$/m.test(info)||!endpoints.length||endpoints.some(e=>e!==context&&!/^(unix|npipe):\/\//.test(e)))throw Error('Builder is not exclusively local');
      if(legacyFrontendImageId&&JSON.parse(exec(['image','inspect',legacyFrontendImageId]))[0].Id!==legacyFrontendImageId)throw Error('Legacy image must be loaded before building');
    },
    async start(){
      resources.push('volume');exec(['volume','create','--label',label,name]);
      resources.push('container');exec(['run','-d','--name',name,'--label',label,'--publish','127.0.0.1::5000','--volume',`${name}:/var/lib/registry`,plan.registryImage]);
      const container=own('container'),binding=container.NetworkSettings?.Ports?.['5000/tcp'];
      if(binding?.length!==1||binding[0].HostIp!=='127.0.0.1'||!/^\d+$/.test(binding[0].HostPort))throw Error('Registry is not loopback bound');
      httpOrigin=`127.0.0.1:${binding[0].HostPort}`;
      // Desktop's containerd registry client uses the VM loopback, whereas
      // published 127.0.0.1 ports belong to the desktop host. Keep both ends
      // loopback-only: one daemon listener plus a host HTTP measurement reader,
      // sharing this run's private content-addressed registry volume.
      const daemonName=`${name}-daemon`,port=randomInt(30000,60000);resources.push(daemonName);
      exec(['run','-d','--name',daemonName,'--label',label,'--network','host','-e',`REGISTRY_HTTP_ADDR=127.0.0.1:${port}`,'--volume',`${name}:/var/lib/registry`,plan.registryImage]);
      origin=`127.0.0.1:${port}`;active=true;
      let ready=false;for(let i=0;i<60&&!ready;i++){try{ready=(await registry('/v2/')).ok;}catch{}if(!ready)await new Promise(r=>setTimeout(r,500));}if(!ready)throw Error('Owned registry readiness timeout');
      const daemon=JSON.parse(exec(['container','inspect',daemonName]))[0];if(daemon.Config?.Labels?.['bagofholding.registry-rehearsal']!==run||daemon.State.Running!==true||daemon.HostConfig.NetworkMode!=='host')throw Error('Owned daemon-loopback registry failed');
    },
    async build(row,{mode='cold'}={}){
      if(!['cold','warm-1','warm-2','frontend-input-change'].includes(mode))throw Error('Unknown local build measurement phase');
      const ignore=path.join(row.snapshot,row.name==='backend'?'.dockerignore':components[row.name].ignore);
      if(sourceHash(inventory(row.snapshot,ignorePolicy(readFileSync(ignore,'utf8'))))!==row.sourceFingerprint)throw Error('Immutable local context drifted');
      const tag=`bagofholding-local-registry:${run}-${row.name}-${row.inputFingerprint.slice(7,19)}`;tags.add(tag);
      const args=['buildx','build','--builder',builder,'--load','--platform',plan.platform,'--progress=plain','--label',label,'-t',tag,'-f',path.join(row.snapshot,row.dockerfile)];
      if(mode==='cold')args.push('--no-cache');
      for(const [key,value]of Object.entries({...row.baseImages,...row.buildArguments,COMPONENT_SOURCE_COMMIT:plan.sourceCommit,COMPONENT_INPUT_FINGERPRINT:row.inputFingerprint,BUILD_CACHE_SCOPE:`local-registry-${run}-${row.name}`}))args.push('--build-arg',`${key}=${value}`);
      args.push(row.snapshot);let log;buildOutput=undefined;const started=performance.now();try{log=exec(args);}catch(error){writeFileSync(path.join(plan.output,`${row.name}-${mode}-build-failed.log`),buildOutput??String(error.stderr??'Build failed'));throw error;}
      const durationMs=performance.now()-started,logName=`${row.name}-${mode}-${row.inputFingerprint.slice(7,19)}-build.log`;log=buildOutput??log;writeFileSync(path.join(plan.output,logName),log);
      const info=JSON.parse(exec(['image','inspect',tag]))[0];if(`${info.Os}/${info.Architecture}`!==plan.platform)throw Error('Local image platform mismatch');
      const probe=`${name}-${row.name}`;resources.push(probe);
      const identity=inspectIdentity(tag,{candidate:plan.sourceCommit,releaseId:'local-registry-rehearsal'},row,{command:exec,containerName:probe,ownershipLabel:label});
      const archive=path.join(plan.output,`${row.name}-${mode}-${row.inputFingerprint.slice(7,19)}.tar`);exec(['save','-o',archive,tag]);
      const record={scope:'owned-loopback-registry',planHash:plan.planHash,name:row.name,inputFingerprint:row.inputFingerprint,sourceCommit:plan.sourceCommit,imageId:info.Id,runtimeContentFingerprint:evidenceHash({os:info.Os,architecture:info.Architecture,config:info.Config,rootfs:info.RootFS}),identity,archive,archiveHash:await fileHash(archive),tag,
        build:{component:row.name,mode,durationMs,imageBytes:info.Size,cachedSteps:(log.match(/^#\d+ CACHED$/gm)??[]).length,log:logName}};
      assertLocalRecord(plan,row,record,record.archiveHash);return record;
    },
    archiveHash:record=>fileHash(record.archive),
    async publish(row,record){
      assertLocalRecord(plan,row,record,await fileHash(record.archive));
      const tag=`${origin}/${row.name}:${run}-${row.inputFingerprint.slice(7,19)}`;tags.add(tag);
      exec(['load','-i',record.archive]);if(JSON.parse(exec(['image','inspect',record.tag]))[0].Id!==record.imageId)throw Error('Loaded archive image changed');
      exec(['tag',record.imageId,tag]);exec(['push',tag]);
      const refs=JSON.parse(exec(['image','inspect',tag]))[0].RepoDigests.filter(ref=>ref.startsWith(`${origin}/${row.name}@sha256:`));if(refs.length!==1)throw Error('Unambiguous local repository digest required');return localRef(refs[0]);
    },
    async pull(reference){exec(['pull','--platform',plan.platform,localRef(reference)]);},
      async restoreArchive(row,record){
        assertLocalRecord(plan,row,record,await fileHash(record.archive));
        exec(['load','-i',record.archive]);tags.add(record.tag);
        const info=JSON.parse(exec(['image','inspect',record.tag]))[0];if(info.Id!==record.imageId)throw Error('Reloaded owned archive image identity differs');
      },
    async measureTransfer(reference){localRef(reference);const [repository,imageDigest]=reference.slice(origin.length+1).split('@');return measureRegistryPayload(repository,imageDigest,registry);},
    async corruptArchiveCopy(record){const archive=record.archive+'.corrupt';writeFileSync(archive,'corrupt local archive\n',{flag:'wx'});return {...record,archive};},
    async missingManifest(){
      if(!(await registry('/v2/')).ok)throw Error('Registry unhealthy before negative pull');let rejected=false;
      try{await adapter.pull(`${origin}/missing-${run}@sha256:${'0'.repeat(64)}`);}catch(error){if(!/manifest unknown|not found/i.test(String(error.stderr??error.message)))throw error;rejected=true;}
      if(!rejected||!(await registry('/v2/')).ok)throw Error('Missing manifest was not rejected by a healthy registry');
      return {boundary:'pull',status:'rejected'};
    },
    async missingLayerManifest(reference){
      localRef(reference);const [repository,imageDigest]=reference.slice(origin.length+1).split('@');
      let response=await registry(`/v2/${repository}/manifests/${imageDigest}`,{headers:{Accept:'application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.oci.image.index.v1+json'}});
      if(!response.ok)throw Error('Published manifest cannot be inspected');let manifest=await response.json();
      if(Array.isArray(manifest.manifests)){
        const selected=manifest.manifests.filter(x=>x.platform?.os==='linux'&&x.platform?.architecture==='amd64');if(selected.length!==1||!hash.test(selected[0].digest))throw Error('Ambiguous published platform');
        response=await registry(`/v2/${repository}/manifests/${selected[0].digest}`,{headers:{Accept:'application/vnd.oci.image.manifest.v1+json'}});if(!response.ok)throw Error('Published platform manifest unavailable');manifest=await response.json();
      }
      if(manifest.schemaVersion!==2||!Array.isArray(manifest.layers)||!manifest.layers.length)throw Error('Single-platform layer manifest required');
      manifest.layers[0]={...manifest.layers[0],digest:`sha256:${createHash('sha256').update(run+'missing-layer').digest('hex')}`};
      // Registry refuses manifests with absent blobs. That refusal itself is the
      // real missing-layer gate; never turn an unsupported setup into a PASS.
      const rejected=await registry(`/v2/${repository}/manifests/missing-${run}`,{method:'PUT',headers:{'Content-Type':manifest.mediaType??response.headers.get('content-type')},body:JSON.stringify(manifest)});
      if(rejected.status!==400)throw Error('Registry did not reject missing-layer manifest');
      const failure=await rejected.json();if(!failure.errors?.some(e=>e.code==='MANIFEST_BLOB_UNKNOWN'))throw Error('Unexpected manifest rejection');
      return {boundary:'registry',status:'rejected',httpStatus:400,code:'MANIFEST_BLOB_UNKNOWN'};
    },
    async cleanup(){
      const errors=[];active=false;
      for(const resource of [...resources].reverse())try{
        if(resource==='container'){own('container');exec(['container','rm','--force',name]);}
        else if(resource==='volume'){own('volume');exec(['volume','rm',name]);}
        else{let probe;try{probe=JSON.parse(exec(['container','inspect',resource]))[0];}catch(error){if(/No such (object|container)/i.test(String(error.stderr??error.message)))continue;throw error;}if(probe.Config?.Labels?.['bagofholding.registry-rehearsal']!==run)throw Error('Probe ownership changed');exec(['container','rm','--force',resource]);}
      }catch{errors.push(resource);}
      for(const tag of tags)try{exec(['image','rm',tag]);}catch(error){if(!/No such image/i.test(String(error.stderr??error.message)))errors.push('owned-image-tag');}
      if(errors.length)throw Error('Some owned registry resources could not be cleaned');
    }
  };
  if(legacyFrontendImageId)adapter.legacyFrontendMeasurement=async()=>{
    const info=JSON.parse(exec(['image','inspect',legacyFrontendImageId]))[0];if(info.Id!==legacyFrontendImageId||`${info.Os}/${info.Architecture}`!==plan.platform)throw Error('Legacy frontend image identity changed');
    let retainedImageTag;
    if(!info.RepoTags?.length){retainedImageTag=`bagofholding-observed-legacy:${legacyFrontendImageId.slice(7)}`;exec(['tag',legacyFrontendImageId,retainedImageTag]);}
    const tag=`${origin}/legacy-frontend:${run}`;tags.add(tag);exec(['tag',legacyFrontendImageId,tag]);exec(['push',tag]);
    const refs=JSON.parse(exec(['image','inspect',tag]))[0].RepoDigests.filter(ref=>ref.startsWith(`${origin}/legacy-frontend@sha256:`));if(refs.length!==1)throw Error('Legacy image repository digest ambiguous');
    return {imageId:legacyFrontendImageId,imageBytes:info.Size,...(retainedImageTag?{retainedImageTag}:{}),provenance:'observed exact image ID; no invented source/build identity',transfer:await adapter.measureTransfer(refs[0])};
  };
  return adapter;
}

async function main(args){
  const options={};for(let i=0;i<args.length;i+=2){if(!['--repo','--output','--images','--registry-image','--docker','--builder','--owned-fixture'].includes(args[i])||!args[i+1]||options[args[i]])throw Error('Explicit local registry options required');options[args[i]]=args[i+1];}
  const original=path.resolve(options['--repo']??fileURLToPath(new URL('../..',import.meta.url)));
  const source=options['--owned-fixture']?prepareOwnedRegistryFixture({repo:original,output:options['--owned-fixture']}):{repo:original};const {repo,sourceEvidence}=source;
  const plan=prepareLocalRegistryPlan({repo,sourceEvidence,output:options['--output']??path.join(repo,'outputs/release-measure',`local-registry-${randomUUID()}`),baseImages:JSON.parse(readFileSync(options['--images'],'utf8')),registryImage:options['--registry-image']});
  const adapter=createLocalRegistryDockerAdapter(plan,{docker:options['--docker'],builder:options['--builder']});await runLocalRegistryRehearsal(plan,adapter);
  console.log(JSON.stringify({report:path.join(plan.output,'report.json'),scope:'owned-loopback-registry',deployable:false}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).catch(()=>{console.error('Local registry rehearsal failed; no deployable release produced.');process.exitCode=1;});
