// Unit-only journal/CI observations. No receipt produced here authorizes rollout.
import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';
import {readRetainedRuntime} from './retained-runtime.mjs';import {frontendComposition} from './docker-ui-deployment.mjs';
import {createDockerDeploymentAdapter} from './docker-deployment.mjs';import {deploymentEnvironment,planDeployment} from './deploy-state.mjs';
import {evidenceHash,writerPolicyFields} from './validate-manifest.mjs';import {runtimeCompatibilityHash} from './ui-release-policy.mjs';
import {databaseIdentityHash} from './database-binding.mjs';import {writerEnvironment} from './writer-environment.mjs';
import {pair,on,off,hash} from './writer-policy-unit-fixture.mjs';import {uiFixture} from './ui-release-unit-fixture.mjs';
const unitDatabaseURL=new URL('postgresql://db/fixture?sslmode=require');unitDatabaseURL.username='owned';unitDatabaseURL.password='owned';
const checksum=b=>'sha256:'+createHash('sha256').update(b).digest('hex'),dsn=unitDatabaseURL.href,names={backend:'backend',frontend:'frontend',rulesWorker:'rules-worker'};
function setup(t){
 const root=mkdtempSync(path.join(tmpdir(),'retained-ui-full-'));
 t.after(()=>{assert.equal(path.dirname(root),path.resolve(tmpdir()));assert.match(path.basename(root),/^retained-ui-full-/);rmSync(root,{recursive:true,force:true});});
 const config={root,project:'owned',artifactDirectory:path.join(root,'artifacts'),assetDirectory:path.join(root,'assets'),backupDirectory:path.join(root,'backup'),postgresImage:'postgres@'+hash('f')};
 const files=new Map(),put=(file,body)=>{const bytes=Buffer.from(typeof body==='string'?body:JSON.stringify(body,null,2)+'\n');mkdirSync(path.dirname(file),{recursive:true});writeFileSync(file,bytes);files.set(file,bytes);return file;};
 for(const key of ['composeFile','caddyFile','deployEnvFile','appEnvFile','workerEnvFile','migrationBaselineFile'])config[key]=path.join(root,key);
 put(config.composeFile,'new reviewed full Compose');put(config.caddyFile,'new reviewed Caddy');put(config.deployEnvFile,'APP_DOMAIN=fixture.invalid\n');put(config.appEnvFile,'not-read-by-retained-launch\n');put(config.workerEnvFile,'not-read-by-retained-launch\n');
 config.composeHash=checksum(readFileSync(config.composeFile));config.caddyHash=checksum(readFileSync(config.caddyFile));
 const origin=pair(off,on).active,fullDir=path.join(root,'releases',origin.manifest.releaseId);
 const runtime={services:Object.fromEntries(Object.entries(names).map(([key,name])=>[name,{image:origin.manifest.components[key].imageDigest,environment:{RELEASE_ID:origin.instances[key].releaseId,RELEASE_COMMIT:origin.instances[key].releaseCommit}}]))};
 Object.assign(runtime.services.backend.environment,{DATABASE_URL:dsn,...writerEnvironment(origin.manifest)});
 put(path.join(fullDir,'state.json'),origin);put(path.join(fullDir,'compose.env'),Object.entries({...deploymentEnvironment(origin),APP_ENV_FILE:config.appEnvFile,WORKER_ENV_FILE:config.workerEnvFile,RULES_ARTIFACTS_DIRECTORY:config.artifactDirectory,FRONTEND_ASSETS_DIRECTORY:config.assetDirectory}).map(([k,v])=>k+'='+v).join('\n')+'\n');
 put(path.join(fullDir,'compose.prod.yml'),'original full ON compose');put(path.join(fullDir,'Caddyfile'),'original Caddy');const originalRuntime=put(path.join(fullDir,'compose.runtime.json'),runtime);
 const state=structuredClone(origin);state.manifest.releaseId='ui-b';state.manifest.releaseCommit='d'.repeat(40);state.manifest.previousReleaseId=origin.manifest.releaseId;
 state.manifest.components.frontend={...state.manifest.components.frontend,sourceCommit:state.manifest.releaseCommit,imageDigest:'example.test/frontend@'+hash('d')};state.instances.frontend={releaseId:state.manifest.releaseId,releaseCommit:state.manifest.releaseCommit};
 const domain=uiFixture().planning.input.previousDomain,anchor={kind:'full-proof-anchor',manifestHash:evidenceHash(origin.manifest),bundleHash:hash('1'),rehearsalHash:hash('2'),backupHash:hash('3'),restoreReportHash:hash('4'),filesystemHash:hash('5'),runtimeCompatibilityHash:runtimeCompatibilityHash(state.manifest,domain),completedAt:'2026-10-04T10:00:00Z',backupCreatedAt:'2026-10-04T09:59:00Z'};
 state.uiProofAnchor=anchor;
 const doc={kind:'protected-full-ui-anchor',status:'captured-after-success',binding:anchor,runtimeDocument:{file:originalRuntime,sha256:checksum(readFileSync(originalRuntime))},currentDatabaseSnapshot:false,currentDatabaseReferenceCoverage:'not_asserted',databaseReferenceInventory:'not_executed'};
 const anchorFile=put(path.join(root,'full-anchors',evidenceHash(doc).slice(7)+'.json'),doc);put(path.join(root,'full-anchors/current.json'),{schemaVersion:1,anchorHash:evidenceHash(doc)});
 const operation={kind:'frontend-only',status:'succeeded',releaseId:state.manifest.releaseId,plan:{kind:'frontend-only',changed:['frontend'],previous:origin,desired:state,candidateHash:evidenceHash(state.manifest),anchor,domain}};
 const operationFile=put(path.join(root,'operations',state.manifest.releaseId+'.json'),operation),runtimeFile=put(path.join(root,'frontend-releases',state.manifest.releaseId,'compose.runtime.json'),frontendComposition(runtime,state));
 put(path.join(root,'active.json'),state);put(config.migrationBaselineFile,{schemaVersion:1,inspected:true,migrationSet:origin.manifest.migrationSet,inspectionReportHash:hash('e')});
 const ids={backend:'a'.repeat(64),frontend:'b'.repeat(64),rulesWorker:'c'.repeat(64)},containers={},calls=[];let desired=state;
 for(const [key,name]of Object.entries(names)){const service=frontendComposition(runtime,state).services[name];containers[ids[key]]={Config:{Image:service.image,Env:Object.entries(service.environment).map(([k,v])=>k+'='+v),Labels:{'com.docker.compose.project':'owned','com.docker.compose.service':name,'com.docker.compose.config-hash':'c'.repeat(64)}},Image:'image-'+key,State:{Running:true,Health:{Status:'healthy'}}};}
 const sourceFile=put(path.join(config.backupDirectory,'source-binding.json'),{schemaVersion:1,backendContainerId:ids.backend,databaseIdentityHash:databaseIdentityHash(dsn)}),source={path:'source-binding.json',category:'source-binding',sha256:checksum(readFileSync(sourceFile)),bytes:readFileSync(sourceFile).length};
 put(path.join(config.backupDirectory,'backup.json'),{files:[source]});put(path.join(config.backupDirectory,'capture.json'),{schemaVersion:1,kind:'candidate-capture',status:'captured',files:[source]});
 const command=args=>{calls.push(args);if(args[0]==='context')return JSON.stringify('unix:///var/run/docker.sock');
  if(args[0]==='ps'){const name=args.find(a=>a.startsWith('label=com.docker.compose.service='))?.split('=').at(-1)??'backend';return ids[Object.keys(names).find(k=>names[k]===name)];}
  if(args[0]==='inspect')return JSON.stringify([containers[args[1]]]);
  if(args[0]==='image'){const entry=Object.entries(containers).find(([,c])=>c.Config.Image===args.at(-1));return JSON.stringify([{Id:entry?.[1].Image,RepoDigests:[args.at(-1)]}]);}
  if(args[0]==='compose'){
   if(args.includes('--hash'))return args.at(-1)+' '+'c'.repeat(64);
   if(args.includes('config')){const next=structuredClone(runtime);for(const [key,name]of Object.entries(names)){next.services[name].image=desired.manifest.components[key].imageDigest;Object.assign(next.services[name].environment,{RELEASE_ID:desired.instances[key].releaseId,RELEASE_COMMIT:desired.instances[key].releaseCommit});}Object.assign(next.services.backend.environment,writerEnvironment(desired.manifest));return JSON.stringify(next);}
   if(args.includes('up')){const d=JSON.parse(readFileSync(args[args.indexOf('-f')+1])),name=args.at(-1),key=Object.keys(names).find(k=>names[k]===name),c=containers[ids[key]];c.Config.Image=d.services[name].image;c.Config.Env=Object.entries(d.services[name].environment).map(([k,v])=>k+'='+v);return '';}
  }
  throw Error('Unexpected controlled command '+args[0]);
 };
 return {config,root,origin,state,runtime,domain,anchor,anchorFile,operation,operationFile,runtimeFile,files,calls,containers,ids,command,reader:()=>readRetainedRuntime(config,state,{command,expectedEnvironment:deploymentEnvironment(state)}),desired:value=>{desired=value;}};
}
test('full A -> UI B -> full OFF C can roll back only affected backend to exact B/ON launch',async t=>{
 const f=setup(t),reader=f.reader();reader.assertLive();const previous=reader.document(),before=structuredClone(f.containers);
 assert.equal(previous.services.frontend.image,f.state.manifest.components.frontend.imageDigest);assert.notEqual(previous.services.frontend.image,f.origin.manifest.components.frontend.imageDigest);
 const c=pair(off,on,on,f.state),plan=planDeployment(c.candidate,c.bundle,f.state);assert.deepEqual(plan.changed,['backend']);assert.equal(Object.hasOwn(plan.desired,'uiProofAnchor'),false);assert.deepEqual(plan.desired.manifest.writerPolicy,off);
 assert.deepEqual(writerPolicyFields(plan.desired.manifest,{}),{writerPolicy:off});
 f.desired(plan.desired);const adapter=await createDockerDeploymentAdapter(f.config,{command:f.command});
 await adapter.replace('backend',plan.desired);assert.ok(f.containers[f.ids.backend].Config.Env.includes('IMAGE_JOBS_ENABLED=0'));
 await adapter.replace('backend',plan.previous);assert.ok(f.containers[f.ids.backend].Config.Env.includes('IMAGE_JOBS_ENABLED=1'));
 assert.deepEqual(f.containers[f.ids.frontend],before[f.ids.frontend]);assert.deepEqual(f.containers[f.ids.rulesWorker],before[f.ids.rulesWorker]);
 assert.deepEqual(f.calls.filter(a=>a.includes('up')).map(a=>a.at(-1)),['backend','backend']);
 for(const [file,bytes]of f.files)assert.ok(readFileSync(file).equals(bytes));reader.assertUnchanged();
 const next=pair(off,off,on,plan.desired);assert.deepEqual(next.candidate.writerPolicy,off);assert.ok(next.check.outcomes.length>0);
});
test('frontend retained reader rejects incomplete/foreign journal and anchor before any launch',t=>{
 for(const mutate of [f=>{f.operation.status='rolling_back';},f=>{f.operation.plan.changed=['backend'];},f=>{f.operation.plan.desired.instances.frontend.releaseId='wrong';},f=>{f.operation.plan.anchor={...f.anchor,backupHash:hash('f')};}]){
  const f=setup(t);mutate(f);writeFileSync(f.operationFile,JSON.stringify(f.operation));assert.throws(()=>f.reader(),/journal|anchor|launch|application/);assert.equal(f.calls.length,0);
 }
});
test('UI reader rejects canonical projection drift and preserves old anchor dates without new database claim',t=>{
 const f=setup(t),reader=f.reader();assert.equal(f.anchor.backupCreatedAt,'2026-10-04T09:59:00Z');assert.equal(reader.files.length,9);
 const changed=JSON.parse(readFileSync(f.runtimeFile));changed.services.backend.environment.DB_COMPACT_RECEIPTS='0';writeFileSync(f.runtimeFile,JSON.stringify(changed));
 assert.throws(()=>f.reader(),/canonical original projection/);assert.throws(()=>reader.document(),/bytes changed/);
});
