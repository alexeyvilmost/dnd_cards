import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';import path from 'node:path';import {tmpdir} from 'node:os';import {createHash} from 'node:crypto';
import {observeUIHost} from './ui-host-observation.mjs';import {uiFixture,h} from './ui-release-unit-fixture.mjs';import {checksum} from './backup-manifest.mjs';
import {assertUnchangedRunningRuntime} from './ui-preservation.mjs';
function unitDatabaseEnvironment(username,password,database='owned'){
 const value=new URL('postgres://database/'+database+'?sslmode=disable');value.username=username;value.password=password;return 'DATABASE_URL='+value.href;
}
async function setup(t){
  const root=mkdtempSync(path.join(tmpdir(),'ui-observe-unit-'));t.after(()=>{assert.equal(path.dirname(root),path.resolve(tmpdir()));assert.ok(path.basename(root).startsWith('ui-observe-unit-'));rmSync(root,{recursive:true,force:true});});
  const config={root,project:'owned_unit',artifactDirectory:path.join(root,'artifacts'),assetDirectory:path.join(root,'assets')};mkdirSync(config.artifactDirectory);mkdirSync(config.assetDirectory);
  const artifact=Buffer.from('module.exports={}'),hash='sha256:'+createHash('sha256').update(artifact).digest('hex');writeFileSync(path.join(config.artifactDirectory,hash.slice(7)+'.cjs'),artifact);
  for(const key of ['composeFile','caddyFile','appEnvFile','workerEnvFile','deployEnvFile']){config[key]=path.join(root,key);writeFileSync(config[key],key==='appEnvFile'?'SECRET=not-an-artifact\n':'owned-unit');}
  config.composeHash=await checksum(config.composeFile);config.caddyHash=await checksum(config.caddyFile);
  const fixture=uiFixture(),manifest=fixture.originalAnchor.manifest;manifest.rulesArtifactHash=hash;
  const active={schemaVersion:1,status:'active',manifest,instances:Object.fromEntries(Object.keys(manifest.components).map(key=>[key,{releaseId:manifest.releaseId,releaseCommit:manifest.releaseCommit}]))};
  const containers={},identities=structuredClone(fixture.originalAnchor.bundle.identities),images={};identities.rulesWorker.artifactHash=hash;
  for(const [i,component] of ['backend','rulesWorker','frontend'].entries()){
    const id=String(i+1).repeat(64),image=manifest.components[component].imageDigest,service=component==='rulesWorker'?'rules-worker':component;
    images[image]={Id:h(String(i+1)),RepoDigests:[image]};containers[id]={Id:id,Image:images[image].Id,Config:{Image:image,Env:component==='backend'?[unitDatabaseEnvironment('owner','secret')]:[],Labels:{'com.docker.compose.project':config.project,'com.docker.compose.service':service}},HostConfig:{ReadonlyRootfs:false},State:{Running:true,Health:{Status:'healthy'}},Mounts:component==='rulesWorker'?[{Type:'bind',Source:config.artifactDirectory,Destination:'/artifacts',RW:true}]:component==='frontend'?[{Type:'bind',Source:config.assetDirectory,Destination:'/var/lib/bagofholding/frontend',RW:false}]:[]};
  }
  const calls=[];const run=args=>{calls.push(args);if(args[0]==='context')return JSON.stringify('unix:///var/run/docker.sock');if(args[0]==='ps'){const service=args.find(a=>a.startsWith('label=com.docker.compose.service=')).split('=').at(-1);return Object.values(containers).find(c=>c.Config.Labels['com.docker.compose.service']===service)?.Id??'';}if(args[0]==='inspect')return JSON.stringify([containers[args[1]]]);if(args[0]==='image')return JSON.stringify([images[args[2]]]);if(args[0]==='exec'){const component=Object.keys(identities).find(key=>containers[args[1]].Config.Labels['com.docker.compose.service']===(key==='rulesWorker'?'rules-worker':key));return JSON.stringify(identities[component]);}throw Error('Unexpected Docker operation');};
  return {config,active,containers,identities,calls,run};
}
test('observation binds actual source mount and identities, never queries DB or emits environment',async t=>{
  const f=await setup(t),result=await observeUIHost(f.config,f.active,{run:f.run});
  assert.equal(result.databaseReferenceInventory,'not_executed');assert.equal(result.files.files.length,1);assert.equal(result.services.backend.containerId,'1'.repeat(64));assert.equal(JSON.stringify(result).includes('secret'),false);assert.equal(JSON.stringify(result).includes('not-an-artifact'),false);
  assert.ok(f.calls.every(a=>['context','ps','inspect','image','exec'].includes(a[0])));assert.ok(f.calls.filter(a=>a[0]==='exec').every(a=>['node','wget'].includes(a[2])));
});
test('backend health time is excluded, but changed launch identity remains guarded',async t=>{
  const f=await setup(t);f.identities.backend.timestamp=1;
  const before=await observeUIHost(f.config,f.active,{run:f.run});f.identities.backend.timestamp=2;
  const after=await observeUIHost(f.config,f.active,{run:f.run});assertUnchangedRunningRuntime(before.protectedRuntime,after.protectedRuntime);
  f.identities.backend.releaseId='changed';await assert.rejects(observeUIHost(f.config,f.active,{run:f.run}));
});
test('unrelated valid directory cannot stand in for actual worker artifact store; changed env/mount fails',async t=>{
  for(const change of [f=>{const other=path.join(f.config.root,'other');mkdirSync(other);f.config.artifactDirectory=other;},f=>{f.containers['2'.repeat(64)].Mounts[0].Type='volume';},f=>{f.containers['2'.repeat(64)].Config.Env=['RULES_ARTIFACTS_DIR=/elsewhere'];},f=>{f.containers['1'.repeat(64)].Config.Env.push(unitDatabaseEnvironment('other','p','other'));}]){
    const f=await setup(t);change(f);await assert.rejects(observeUIHost(f.config,f.active,{run:f.run}));
  }
});
test('wrong health/image/compose or corrupt executable refuses actual closure',async t=>{
  for(const change of [f=>{f.containers['1'.repeat(64)].State.Health.Status='unhealthy';},f=>{f.containers['2'.repeat(64)].Image=h('f');},f=>{writeFileSync(f.config.composeFile,'changed');},f=>{writeFileSync(path.join(f.config.artifactDirectory,'0'.repeat(64)+'.cjs'),'corrupt');}]){const f=await setup(t);change(f);await assert.rejects(observeUIHost(f.config,f.active,{run:f.run}));}
});
