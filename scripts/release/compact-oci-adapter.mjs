// Private owned-fixture adapter. No production/deployment authorization claim.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,lstat,realpath,unlink,chmod} from 'node:fs/promises';
import {createReadStream,writeFileSync} from 'node:fs';
import {createHash,randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {imageProtocolEmulatorProgram} from './image-protocol-emulator.mjs';
import {startOwnedBrowserRelay,ownedBrowserForwardProgram} from './owned-browser-relay.mjs';
import {safeExecutionEnvironment} from './ui-execution-profile.mjs';
const hashPattern=/^sha256:[a-f0-9]{64}$/;
const hash=async file=>{const h=createHash('sha256');for await(const bytes of createReadStream(file))h.update(bytes);return 'sha256:'+h.digest('hex');};
const read=async p=>JSON.parse(await readFile(p,'utf8'));
const ownedAdapters=new WeakSet();
export async function assertOwnedCompactAdapter(adapter){
 if(!ownedAdapters.has(adapter))throw Error('Live owned compact adapter required');
 await adapter.assertOwned();
}
async function regular(file){const s=await lstat(file);if(!s.isFile()||s.isSymbolicLink()||path.resolve(file)!==await realpath(file))throw Error('Real regular input file required');return s;}
export async function validateOwnedDump(proof){
 if(proof?.schemaVersion!==1||proof.kind!=='owned-integration-dump'||!/^test_[a-f0-9]{24}$/.test(proof.runId??'')||!hashPattern.test(proof.sha256??''))throw Error('Owned integration dump proof required');
 await regular(proof.registryPath);const registry=await read(proof.registryPath),directory=path.resolve(registry.directory??'.');
 if(registry.version!==1||registry.runId!==proof.runId||!['ready','stopped'].includes(registry.status)||registry.fixture?.profile!=='integration-baseline'||path.basename(directory)!==proof.runId||path.dirname(path.resolve(proof.registryPath))!==directory||await realpath(directory)!==directory)throw Error('Owned integration registry differs');
 const relative=path.relative(directory,path.resolve(proof.dumpFile));if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('Dump must remain inside its owned registry');
 const stat=await regular(proof.dumpFile);if(stat.size!==proof.bytes||stat.size<=0||await hash(proof.dumpFile)!==proof.sha256)throw Error('Owned dump bytes differ');
 return {runId:proof.runId,directory,dumpFile:path.resolve(proof.dumpFile),sha256:proof.sha256,bytes:stat.size};
}
function executeDocker(args,{input,inputFile,env={},timeout=180000,diagnosticDirectory}={}){
 return new Promise((resolve,reject)=>{const child=spawn('docker',args,{env:{...Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.toUpperCase().startsWith('PG'))),...env},windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',bytes=0,failed=false,stderr=Buffer.alloc(0);
  const fail=code=>{if(failed)return;failed=true;child.kill();let diagnosticFile;if(diagnosticDirectory&&stderr.length){diagnosticFile=path.join(diagnosticDirectory,'failed-command-'+randomBytes(8).toString('hex')+'.stderr');try{writeFileSync(diagnosticFile,stderr,{flag:'wx',mode:0o600});}catch{diagnosticFile=undefined;}}reject(Object.assign(Error('Owned compact OCI command failed; raw process output withheld'),{code,diagnosticFile}));};
  const timer=setTimeout(()=>fail('timeout'),timeout);child.on('error',e=>fail(e.code));child.stdout.setEncoding('utf8');child.stdout.on('data',s=>{bytes+=Buffer.byteLength(s);if(bytes>128*1024*1024)fail('ENOBUFS');else out+=s;});child.stderr.on('data',s=>{if(stderr.length<1024*1024)stderr=Buffer.concat([stderr,s.subarray(0,1024*1024-stderr.length)]);});child.stdin.on('error',()=>{});child.on('close',code=>{clearTimeout(timer);if(code!==0)fail(code);else if(!failed)resolve(out.trim());});if(inputFile){const stream=createReadStream(inputFile);stream.on('error',e=>fail(e.code));stream.pipe(child.stdin);}else child.stdin.end(input??'');
 });
}
const proxyProgram=`const http=require('node:http');let posts=0;http.createServer((request,response)=>{if(request.url==='/__owned_counter'&&request.method==='GET'){response.setHeader('content-type','application/json');response.end(JSON.stringify({posts}));return}if(request.method==='POST')posts++;const downstream=http.request({hostname:'rules-worker',port:8090,path:request.url,method:request.method,headers:request.headers,agent:false},upstream=>{response.writeHead(upstream.statusCode,upstream.headers);upstream.pipe(response)});downstream.on('error',()=>{response.writeHead(502);response.end()});request.on('error',()=>downstream.destroy());request.pipe(downstream)}).listen(8091,'0.0.0.0');`;
const browserBridgeProgram=`const http=require('node:http');http.createServer((request,response)=>{const api=request.url.startsWith('/api/');const target=http.request({hostname:api?'backend':'frontend',port:api?8080:3000,path:request.url,method:request.method,headers:request.headers,agent:false},upstream=>{response.writeHead(upstream.statusCode,upstream.headers);upstream.pipe(response);upstream.on('error',()=>response.destroy())});target.on('error',()=>{if(!response.headersSent)response.writeHead(502);response.end()});request.on('error',()=>target.destroy());request.pipe(target)}).listen(8095,'0.0.0.0');`;
export function healthIdentity(body){if(!body||typeof body!=='object'||Array.isArray(body)||body.status!=='ok'||(body.timestamp!==undefined&&!Number.isSafeInteger(body.timestamp)))throw Error('Actual health envelope differs');const {status,timestamp,...identity}=body;return identity;}
const httpProgram=`process.stdin.setEncoding('utf8');let s='';for await(const c of process.stdin)s+=c;const x=JSON.parse(s);const r=await fetch(x.url,{method:x.method??'GET',headers:x.headers,body:x.body===undefined?undefined:JSON.stringify(x.body),signal:AbortSignal.timeout(60000)});const text=await r.text();let body;try{body=JSON.parse(text)}catch{body=text};console.log(JSON.stringify({status:r.status,body}));`;
export function imageProtocolEnvironment(enabled,token){
 if(typeof enabled!=='boolean'||(enabled&&(typeof token!=='string'||token.length<16)))throw Error('Explicit owned image protocol configuration required');
 return enabled?{OPENAI_API_KEY:token,OPENAI_BASE_URL:'http://image-fixture:8093/v1',YANDEX_CLOUD_ENDPOINT:'http://image-fixture:8093/storage',YANDEX_CLOUD_BUCKET_NAME:'owned-image-fixture',YANDEX_CLOUD_ACCESS_KEY_ID:'owned-fixture',YANDEX_CLOUD_SECRET_ACCESS_KEY:token,YANDEX_CLOUD_REGION:'ru-central1'}:{OPENAI_API_KEY:'',OPENAI_BASE_URL:'http://127.0.0.1:1/v1'};
}
export function browserOriginFromPorts(ports){
 assert.deepEqual(Object.entries(ports??{}).filter(([,value])=>value!==null).map(([key])=>key),['8095/tcp']);const bindings=ports['8095/tcp'];
 if(!Array.isArray(bindings)||bindings.length!==1||bindings[0].HostIp!=='127.0.0.1'||!/^\d+$/.test(bindings[0].HostPort)||Number(bindings[0].HostPort)<1024||Number(bindings[0].HostPort)>65535)throw Error('One owned loopback browser binding required');
 return 'http://127.0.0.1:'+bindings[0].HostPort;
}
export function fixtureImageRoles({imageRoles,backend,worker,frontend}){
 if(imageRoles!==undefined){
  if(backend||worker||frontend||!imageRoles||Object.keys(imageRoles).sort().join(',')!=='candidate,previous')throw Error('Exact candidate/previous image pair required');
  for(const role of ['candidate','previous'])if(!imageRoles[role]||Object.keys(imageRoles[role]).sort().join(',')!=='backend,frontend,worker')throw Error('Every role requires all three exact component images');
  return structuredClone(imageRoles);
 }
 const rows={backend,worker,...(frontend?{frontend}:{})};return {candidate:structuredClone(rows),previous:structuredClone(rows)};
}
export function imageInputKind(row){
 if(row?.image!==undefined){
  if(!/^[a-z0-9][a-z0-9.:/_-]*@sha256:[a-f0-9]{64}$/.test(row.image)||['archive','archiveHash','imageId'].some(key=>row[key]!==undefined))throw Error('One immutable registry image input required');
  return 'registry';
 }
 if(!hashPattern.test(row?.imageId??'')||!hashPattern.test(row?.archiveHash??'')||typeof row?.archive!=='string')throw Error('Exact owned archive identity required');
 return 'archive';
}
export function fixtureLaunches(role,records,roleLaunches,releaseId){
 const launches=roleLaunches?.[role]??Object.fromEntries(Object.entries(records).map(([key,row])=>[key==='worker'?'rulesWorker':key,{releaseId,releaseCommit:row.sourceCommit}]));
 if(roleLaunches&&Object.keys(launches??{}).sort().join(',')!=='backend,frontend,rulesWorker')throw Error('Exact per-component launch identities required');
 for(const value of Object.values(launches))if(!value||Object.keys(value).sort().join(',')!=='releaseCommit,releaseId'||!/^[A-Za-z0-9_.-]{1,160}$/.test(value.releaseId??'')||!/^[a-f0-9]{40}$/.test(value.releaseCommit??''))throw Error('Invalid component launch identity');
 return structuredClone(launches);
}
export function assertFormatProbePolicy({compactReceipts=false,imageJobs=false,frozenCatalogs=false}){
 if(typeof compactReceipts!=='boolean'||typeof imageJobs!=='boolean'||frozenCatalogs!==false)throw Error('Explicit supported format policies required; frozen catalogs remain OFF');
 return {compactReceipts,imageJobs,frozenCatalogs:false};
}
function assertBakedIdentity(actual,row,launch){
 if(actual.provenance!=='baked'||actual.sourceCommit!==row.sourceCommit||actual.inputFingerprint!==row.inputFingerprint||actual.releaseId!==launch.releaseId||actual.releaseCommit!==launch.releaseCommit)throw Error('Actual baked/launch identity differs');
 for(const [key,value]of Object.entries(row.identity))if(!['status','timestamp','releaseId','releaseCommit'].includes(key))assert.deepEqual(actual[key],value,'Actual baked field differs: '+key);
}
export async function createCompactOciAdapter({directory,dump,backend,worker,frontend,imageRoles,roleLaunches,postgresImage,artifacts=[],imageProtocol=false}){
 imageProtocolEnvironment(imageProtocol,'configuration-preflight');
 const ownedDump=await validateOwnedDump(dump);directory=path.resolve(directory);
 const docker=(args,options={})=>executeDocker(args,{...options,diagnosticDirectory:directory});
 if(!/^postgres@sha256:[a-f0-9]{64}$/.test(postgresImage??''))throw Error('Pinned PostgreSQL image required');
 const roles=fixtureImageRoles({imageRoles,backend,worker,frontend});
 roleLaunches=roleLaunches===undefined?undefined:structuredClone(roleLaunches);
 if(roleLaunches&&Object.keys(roleLaunches).sort().join(',')!=='candidate,previous')throw Error('Exact launch roles required');
 ({backend,worker,frontend}=roles.candidate);
 const forRole=role=>{if(role===undefined&&imageRoles===undefined)return {role:'candidate',records:roles.candidate};if(!['candidate','previous'].includes(role))throw Error('Explicit exact image role required');return {role,records:roles[role]};};
 const imageRecords=Object.values(roles).flatMap(rows=>Object.entries(rows));
 for(const [component,row]of imageRecords){
  const kind=imageInputKind(row);
  if(!/^[a-f0-9]{40}$/.test(row.sourceCommit??'')||!hashPattern.test(row.inputFingerprint??''))throw Error('Exact image source identity required');
  if(kind==='archive'){await regular(row.archive);if(await hash(row.archive)!==row.archiveHash)throw Error('Owned image archive differs');}
  if(row.identity?.provenance!=='baked'||row.identity.sourceCommit!==row.sourceCommit||row.identity.inputFingerprint!==row.inputFingerprint||row.identity.component!==(component==='worker'?'rulesWorker':component))throw Error('Archive identity proof differs');
 }
 for(const row of artifacts){await regular(row.path);if(!hashPattern.test(row.sha256)||await hash(row.path)!==row.sha256)throw Error('Historical CJS bytes differ');}
 await mkdir(directory,{mode:0o700});if(await realpath(directory)!==directory)throw Error('New real output directory required');
 const owner='compact_'+randomBytes(12).toString('hex'),label='bagofholding.compact-writer='+owner;
 const names={network:owner+'_net',postgres:owner+'_db',pgVolume:owner+'_pgdata',artifacts:owner+'_artifacts',proxy:owner+'_proxy',...(imageProtocol?{image:owner+'_image'}:{})};
 const secrets={database:randomBytes(32).toString('hex'),worker:randomBytes(32).toString('hex'),jwt:randomBytes(32).toString('hex'),image:randomBytes(32).toString('hex')};
 const resources=[],secretFiles=[];let ready=false,apps=null,generation=0,cleaned=false,browser=null,browserRelay=null,activeDatabase=ownedDump.runId,dumpSequence=0,restoreSequence=0,artifactSequence=0;
 const snapshots=new Map();
 await writeFile(path.join(directory,'owner.json'),JSON.stringify({schemaVersion:1,owner,dumpHash:ownedDump.sha256,runId:ownedDump.runId})+'\n',{flag:'wx',mode:0o600});
 async function resource(kind,name,args,options){resources.push({kind,name});return docker(args,options);}
 async function ownedResource(kind,name){const value=JSON.parse(await docker([kind,'inspect',name]))[0];const labels=kind==='container'?value.Config?.Labels:value.Labels;if(labels?.['bagofholding.compact-writer']!==owner)throw Error('Owned resource identity changed');return value;}
 async function assertNetwork(){const network=await ownedResource('network',names.network);if(network.Internal!==true)throw Error('Owned network lost egress isolation');for(const name of [names.postgres,names.proxy,...(names.image?[names.image]:[]),...(apps?[apps.worker,apps.backend]:[]),...(browser?[browser.frontend]:[])]){const container=await ownedResource('container',name);assert.deepEqual(Object.keys(container.NetworkSettings?.Networks??{}),[names.network]);if(Object.values(container.NetworkSettings?.Ports??{}).some(v=>v?.length))throw Error('Owned container unexpectedly publishes ports');}}
 async function removeContainer(name){await ownedResource('container',name);await docker(['container','rm','--force',name]);const r=resources.find(r=>r.kind==='container'&&r.name===name);if(r)r.removed=true;}
 async function envFile(name,values){const file=path.join(directory,name+'.env');await writeFile(file,Object.entries(values).map(([k,v])=>k+'='+v).join('\n')+'\n',{flag:'wx',mode:0o600});secretFiles.push(file);return file;}
 async function wait(probe){const deadline=Date.now()+120000;while(Date.now()<deadline){try{if(await probe())return;}catch{}await new Promise(r=>setTimeout(r,250));}throw Error('Owned OCI readiness failed');}
 async function query(sql){if(!ready)throw Error('Owned database not ready');await ownedResource('container',names.postgres);return docker(['exec','-i',names.postgres,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','test_runner','-d',activeDatabase],{input:sql});}
 async function http(url,{method='GET',body,token,headers={}}={}){await ownedResource('container',names.proxy);return JSON.parse(await docker(['exec','-i',names.proxy,'node','--input-type=module','-e',httpProgram],{input:JSON.stringify({url,method,body,headers:{'content-type':'application/json',...headers,...(token?{authorization:'Bearer '+token}:{})}})}));}
 async function initialize(){
  const endpoint=JSON.parse(await docker(['context','inspect','--format','{{json .Endpoints.docker.Host}}']));if(!/^(unix:\/\/|npipe:\/\/)/.test(endpoint)||process.env.DOCKER_HOST||process.env.DOCKER_CONTEXT)throw Error('Default local Docker socket required');
  const loaded=new Map();for(const [,row]of imageRecords){const reference=row.image??row.imageId;if(!loaded.has(reference)){if(imageInputKind(row)==='registry')await docker(['pull',row.image],{timeout:300000});else await docker(['load','--input',row.archive],{timeout:300000});const actual=JSON.parse(await docker(['image','inspect',reference]))[0];if(!hashPattern.test(actual.Id)||(!row.image&&actual.Id!==row.imageId)||(row.image&&!actual.RepoDigests?.includes(row.image)))throw Error('Loaded immutable image identity differs');loaded.set(reference,actual.Id);}row.imageId=loaded.get(reference);}
  await docker(['pull',postgresImage]);await resource('network',names.network,['network','create','--internal','--label',label,names.network]);if(!(await ownedResource('network',names.network)).Internal)throw Error('Owned network egress must be disabled');
  for(const name of [names.pgVolume,names.artifacts])await resource('volume',name,['volume','create','--label',label,name]);
  const file=await envFile('postgres',{POSTGRES_USER:'test_runner',POSTGRES_DB:ownedDump.runId,POSTGRES_PASSWORD:secrets.database});
  await resource('container',names.postgres,['run','-d','--name',names.postgres,'--label',label,'--network',names.network,'--network-alias','postgres','--env-file',file,'--mount',`type=volume,source=${names.pgVolume},target=/var/lib/postgresql/data`,postgresImage]);
  await wait(async()=>{await docker(['exec',names.postgres,'pg_isready','-h','127.0.0.1','-U','test_runner','-d',ownedDump.runId]);return true;});
  await docker(['exec','-i',names.postgres,'pg_restore','--exit-on-error','--no-owner','--no-privileges','-U','test_runner','-d',ownedDump.runId],{inputFile:ownedDump.dumpFile,timeout:300000});ready=true;
  const marker=JSON.parse(await query('SELECT coalesce(json_agg(run_id ORDER BY run_id),\'[]\'::json) FROM test_run_ownership;'));assert.deepEqual(marker,[ownedDump.runId]);
  const copyName=owner+'_copy',copyProgram=`import{writeFile,chmod}from'node:fs/promises';import{createHash}from'node:crypto';process.stdin.setEncoding('utf8');let raw='';for await(const c of process.stdin)raw+=c;for(const row of JSON.parse(raw)){const bytes=Buffer.from(row.base64,'base64');if('sha256:'+createHash('sha256').update(bytes).digest('hex')!==row.sha256)throw Error('artifact mismatch');await writeFile('/artifacts/'+row.sha256.slice(7)+'.cjs',bytes,{flag:'wx',mode:0o444})}await chmod('/artifacts',0o777);`;
  await resource('container',copyName,['run','-i','--name',copyName,'--label',label,'--network','none','--read-only','--user','0','--mount',`type=volume,source=${names.artifacts},target=/artifacts`,'--entrypoint','node',worker.imageId,'--input-type=module','-e',copyProgram],{input:JSON.stringify(await Promise.all(artifacts.map(async r=>({sha256:r.sha256,base64:(await readFile(r.path)).toString('base64')}))))});
  await resource('container',names.proxy,['run','-d','--name',names.proxy,'--label',label,'--network',names.network,'--network-alias','rules-proxy','--read-only','--entrypoint','node',worker.imageId,'-e',proxyProgram]);
  await wait(async()=>{const r=await http('http://127.0.0.1:8091/__owned_counter');return r.status===200;});
  if(imageProtocol){
   const imageEnv=await envFile('image-protocol',{OWNED_IMAGE_FIXTURE_TOKEN:secrets.image});
   await resource('container',names.image,['run','-d','--name',names.image,'--label',label,'--network',names.network,'--network-alias','image-fixture','--read-only','--env-file',imageEnv,'--entrypoint','node',worker.imageId,'-e',imageProtocolEmulatorProgram]);
   await wait(async()=>{const r=await http('http://image-fixture:8093/__owned/stats',{headers:{'x-owned-fixture-token':secrets.image}});return r.status===200;});
  }
 }
 async function stopApplications(){if(!apps)return;const errors=[];for(const name of [apps.backend,apps.worker,...(imageRoles&&browser?[browser.frontend]:[])])try{await removeContainer(name);}catch(error){errors.push(error);}if(errors.length)throw Error('Owned application cleanup failed');apps=null;if(imageRoles)browser=null;}
 async function start({role,frontendRole,compactReceipts=false,imageJobs=false,frozenCatalogs=false,releaseId}={}){
  assertFormatProbePolicy({compactReceipts,imageJobs,frozenCatalogs});
  const selected=forRole(role),{backend,worker}=selected.records;
  if(cleaned||apps)throw Error('Start requires stopped owned applications');if(typeof compactReceipts!=='boolean'||typeof imageJobs!=='boolean'||(imageJobs&&!imageProtocol)||!/^[A-Za-z0-9_.-]{1,100}$/.test(releaseId??''))throw Error('Explicit policy and isolated provider configuration required');
  const launches=fixtureLaunches(selected.role,selected.records,roleLaunches,releaseId);
  if(!ready)await initialize();generation++;apps={backend:owner+'_api_'+generation,worker:owner+'_worker_'+generation,releaseId,compactReceipts,imageJobs,role:selected.role,records:selected.records,launches};
  const workerEnv=await envFile('worker-'+generation,{RELEASE_ID:launches.rulesWorker.releaseId,RELEASE_COMMIT:launches.rulesWorker.releaseCommit,PORT:'8090',RULES_WORKER_TOKEN:secrets.worker,RULES_ARTIFACTS_DIR:'/artifacts',RULES_ARTIFACT_FILE:'/app/artifact.cjs'});
  await resource('container',apps.worker,['run','-d','--name',apps.worker,'--label',label,'--network',names.network,'--network-alias','rules-worker','--read-only','--env-file',workerEnv,'--mount',`type=volume,source=${names.artifacts},target=/artifacts`,worker.imageId]);
  await wait(async()=>{const r=await http('http://rules-worker:8090/health');return r.status===200;});
  const databaseURL=new URL('postgres://postgres:5432/'+activeDatabase+'?sslmode=disable');databaseURL.username='test_runner';databaseURL.password=secrets.database;
  const apiEnv=await envFile('backend-'+generation,{RELEASE_ID:launches.backend.releaseId,RELEASE_COMMIT:launches.backend.releaseCommit,PORT:'8080',DATABASE_URL:databaseURL.href,JWT_SECRET:secrets.jwt,RULES_WORKER_URL:'http://rules-proxy:8091',RULES_WORKER_TOKEN:secrets.worker,RULES_EQUIPMENT_INTENT_ENABLED:'1',DB_COMPACT_RECEIPTS:compactReceipts?'1':'0',DB_FROZEN_CATALOGS:'0',IMAGE_JOBS_ENABLED:imageJobs?'1':'0',IMAGE_JOBS_MAX_CONCURRENCY:'1',...imageProtocolEnvironment(imageProtocol,secrets.image),CONTENT_ADMIN_USER_IDS:''});
  await resource('container',apps.backend,['run','-d','--name',apps.backend,'--label',label,'--network',names.network,'--network-alias','backend','--read-only','--tmpfs','/tmp:rw,nosuid,nodev,size=64m','--env-file',apiEnv,backend.imageId]);
  await wait(async()=>{const r=await http('http://backend:8080/api/health');return r.status===200;});
  if(imageRoles){const front=forRole(frontendRole??role);await startFrontend(front.records.frontend,fixtureLaunches(front.role,front.records,roleLaunches,releaseId).frontend);}
  return observe();
 }
 async function observe(){if(!apps)throw Error('Owned apps are stopped');await assertNetwork();const images={},identities={},executionProfile={schemaVersion:1};let environment;
  for(const [component,name,row,url]of [['backend',apps.backend,apps.records.backend,'http://backend:8080/api/health'],['rulesWorker',apps.worker,apps.records.worker,'http://rules-worker:8090/health']]){
   const c=await ownedResource('container',name);if(!c.State.Running||c.Image!==row.imageId||c.Config.Image!==row.imageId||Object.values(c.NetworkSettings.Ports??{}).some(v=>v?.length))throw Error('Actual owned image/network differs');const response=await http(url);if(response.status!==200)throw Error('Real health failed');const identity=healthIdentity(response.body);assertBakedIdentity(identity,row,apps.launches[component]);
   images[component]=row.image??row.imageId;identities[component]=identity;executionProfile[component]={instance:structuredClone(apps.launches[component]),environment:safeExecutionEnvironment(component,c.Config.Env)};if(component==='backend')environment=c.Config.Env.filter(v=>/^(DB_COMPACT_RECEIPTS|DB_FROZEN_CATALOGS|IMAGE_JOBS_ENABLED)=/.test(v));
  }
  if(imageRoles){if(!browser)throw Error('Exact frontend must be running');const actual=await ownedResource('container',browser.frontend),row=browser.record,response=await http('http://frontend:3000/build-info.json');if(!actual.State.Running||actual.Image!==row.imageId||actual.Config.Image!==row.imageId||response.status!==200)throw Error('Actual frontend image differs');assertBakedIdentity(response.body,row,browser.launch);images.frontend=row.image??row.imageId;identities.frontend=response.body;}
  return {images,identities,environment,executionProfile};
 }
 async function cleanup(){if(cleaned)return {status:'stopped',retainedImages:true};const errors=[];
  if(browserRelay)try{await browserRelay.close();browserRelay=null;}catch{errors.push({kind:'browser-relay'});}
  for(const r of [...resources].reverse()){if(r.removed)continue;try{await ownedResource(r.kind,r.name);await docker(r.kind==='container'?['container','rm','--force',r.name]:[r.kind,'rm',r.name]);r.removed=true;}catch{errors.push({kind:r.kind,name:r.name});}}
  for(const file of secretFiles)try{await unlink(file);}catch(error){if(error.code!=='ENOENT')errors.push({kind:'secret-file'});}const result={schemaVersion:1,owner,status:errors.length?'failed':'stopped',errors,retainedImages:true,productionTouched:false};await writeFile(path.join(directory,'cleanup.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});if(!errors.length)cleaned=true;return result;
 }
 async function imageRequest(route,options={}){if(!imageProtocol||!ready)throw Error('Owned image protocol unavailable');await assertNetwork();const r=await http('http://image-fixture:8093/__owned/'+route,{...options,headers:{'x-owned-fixture-token':secrets.image}});if(r.status!==(route==='control'?201:200))throw Error('Owned image protocol control failed');return r.body;}
 async function dumpDatabase(){
  if(!ready||apps)throw Error('Database snapshot requires stopped owned applications');await assertNetwork();
  const marker=JSON.parse(await query('SELECT json_agg(run_id ORDER BY run_id) FROM test_run_ownership;'));assert.deepEqual(marker,[ownedDump.runId]);
  const number=++dumpSequence,file=path.join(directory,'expanded-'+number+'.dump'),containerFile='/tmp/'+owner+'-expanded-'+number+'.dump';
  await docker(['exec',names.postgres,'pg_dump','--format=custom','--no-owner','--no-privileges','-U','test_runner','-d',activeDatabase,'--file',containerFile],{timeout:300000});
  await docker(['cp',names.postgres+':'+containerFile,file]);await chmod(file,0o600);const stat=await regular(file);
  const snapshot={schemaVersion:1,kind:'owned-expanded-database-snapshot',owner,path:file,sha256:await hash(file),bytes:stat.size,createdAt:new Date().toISOString(),sourceDatabase:activeDatabase,runId:ownedDump.runId};
  if(snapshot.bytes<=0)throw Error('Expanded database dump is empty');snapshots.set(file,JSON.stringify(snapshot));return snapshot;
 }
 async function restoreDatabase(snapshot){
  if(!ready||apps||snapshots.get(snapshot?.path)!==JSON.stringify(snapshot))throw Error('Restore requires the exact snapshot from this stopped owned adapter');
  await assertNetwork();const stat=await regular(snapshot.path);if(stat.size!==snapshot.bytes||await hash(snapshot.path)!==snapshot.sha256)throw Error('Expanded dump changed before restore');
  const previous=activeDatabase,database=ownedDump.runId+'_restored_'+(++restoreSequence);
  await docker(['exec',names.postgres,'createdb','--template=template0','-U','test_runner',database]);
  await docker(['exec','-i',names.postgres,'pg_restore','--exit-on-error','--no-owner','--no-privileges','-U','test_runner','-d',database],{inputFile:snapshot.path,timeout:300000});
  activeDatabase=database;
  try{assert.deepEqual(JSON.parse(await query('SELECT json_agg(run_id ORDER BY run_id) FROM test_run_ownership;')),[ownedDump.runId]);}catch(error){activeDatabase=previous;throw error;}
  return {sourceDatabase:snapshot.sourceDatabase,restoredDatabase:database,runId:ownedDump.runId,dumpHash:snapshot.sha256,sourceRetained:true,markerVerified:true};
 }
 async function artifactClosure(){
  if(!ready)throw Error('Owned artifact volume not ready');await ownedResource('volume',names.artifacts);
  const name=owner+'_artifact_read_'+(++artifactSequence),program=`import{readdir,lstat,readFile}from'node:fs/promises';import{createHash}from'node:crypto';const files=[];for(const name of(await readdir('/artifacts')).sort()){if(!/^[a-f0-9]{64}\\.cjs$/.test(name))throw Error('Unexpected artifact entry');const file='/artifacts/'+name,s=await lstat(file);if(!s.isFile()||s.isSymbolicLink())throw Error('Unexpected artifact kind');const b=await readFile(file),h=createHash('sha256').update(b).digest('hex');if(name!==h+'.cjs')throw Error('Artifact bytes differ');files.push({path:name,sha256:'sha256:'+h,bytes:b.length})}console.log(JSON.stringify(files));`;
  let result,failure;try{result=JSON.parse(await resource('container',name,['run','--name',name,'--label',label,'--network','none','--read-only','--mount',`type=volume,source=${names.artifacts},target=/artifacts,readonly`,'--entrypoint','node',worker.imageId,'--input-type=module','-e',program]));}catch(error){failure=error;}
  try{await removeContainer(name);}catch(error){failure??=error;}if(failure)throw failure;return result;
 }
 async function startFrontend(frontend,launch){
  if(!frontend||browser||!apps)throw Error('Explicit owned frontend image and ready applications required');
  const frontName=owner+'_frontend_'+generation;
  await resource('container',frontName,['run','-d','--name',frontName,'--label',label,'--network',names.network,'--network-alias','frontend','-e','RELEASE_ID='+launch.releaseId,'-e','RELEASE_COMMIT='+launch.releaseCommit,frontend.imageId]);
  browser={frontend:frontName,launch,record:frontend};
  await wait(async()=>{const r=await http('http://frontend:3000/build-info.json');return r.status===200;});
  await assertNetwork();const identity=(await http('http://frontend:3000/build-info.json')).body;
  const actual=await ownedResource('container',frontName);
  if(actual.Image!==frontend.imageId||actual.Config.Image!==frontend.imageId)throw Error('Actual frontend image differs');assertBakedIdentity(identity,frontend,launch);
 }
 async function startBrowserSurface({role,releaseId}){
  const selected=forRole(role),{frontend}=selected.records;
  if(!apps||!frontend)throw Error('Actual frontend/application role required');
  const launches=fixtureLaunches(selected.role,selected.records,roleLaunches,releaseId);
  if(!browser)await startFrontend(frontend,launches.frontend);
  if(browser.record!==frontend||JSON.stringify(browser.launch)!==JSON.stringify(launches.frontend))throw Error('Requested browser role differs from observed frontend');
  if(!browserRelay)browserRelay=await startOwnedBrowserRelay(async input=>{await ownedResource('container',names.proxy);return JSON.parse(await docker(['exec','-i',names.proxy,'node','--input-type=module','-e',ownedBrowserForwardProgram],{input:JSON.stringify(input)}));});
  return {origin:browserRelay.origin,image:frontend.image??frontend.imageId,identity:(await http('http://frontend:3000/build-info.json')).body};
 }
 const adapter={execution:'docker',owner,names,directory,start,stopApplications,startBrowserSurface,observe,query,dumpDatabase,restoreDatabase,artifactClosure,imageControl:body=>imageRequest('control',{method:'POST',body}),imageStats:()=>imageRequest('stats'),request:(route,options)=>{if(typeof route!=='string'||!route.startsWith('/')||route.startsWith('//')||/[\r\n]/.test(route))throw Error('Owned API path required');return http('http://backend:8080/api'+route,options);},workerCalls:async()=>{const r=await http('http://127.0.0.1:8091/__owned_counter');if(r.status!==200||!Number.isSafeInteger(r.body.posts)||r.body.posts<0)throw Error('Actual proxy counter invalid');return r.body.posts;},assertOwned:async()=>{if(!ready)await initialize();await assertNetwork();assert.deepEqual(JSON.parse(await query('SELECT json_agg(run_id ORDER BY run_id) FROM test_run_ownership;')),[ownedDump.runId]);},cleanup};
 ownedAdapters.add(adapter);return adapter;
}
