import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,stat} from 'node:fs/promises';
import {readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createDockerDeploymentAdapter} from './docker-deployment.mjs';
import {checksum} from './backup-manifest.mjs';
import {databaseIdentityHash} from './database-binding.mjs';
import {evidenceHash} from './validate-manifest.mjs';
import {legacyRuntimeFingerprint} from './legacy-baseline.mjs';
import {retirementStateUnitFixture,retirementExecutionUnitFixture} from './retirement-state-unit-fixture.mjs';
import {databaseStateFromRetirementInspection} from './migration-transition.mjs';
import {retirementMigrationId,retirementSQLHash} from './retirement-state.mjs';
import {executeRetirement} from './retirement-controller.mjs';
import {createDeploymentStore} from './deploy-state.mjs';
const h=x=>`sha256:${x.repeat(64)}`;
const dsn='postgresql://user:password@db/source?sslmode=require';
async function fixture(t){
  const root=await mkdtemp(path.join(tmpdir(),'deployment-binding-test-'));
  t.after(async()=>{assert.equal(path.dirname(root),path.resolve(tmpdir()));assert.ok(path.basename(root).startsWith('deployment-binding-test-'));await rm(root,{recursive:true,force:true});});
  const manifest={schemaVersion:1,releaseId:'old',releaseCommit:'a'.repeat(40),previousReleaseId:null,createdAt:'2026-10-04T10:00:00Z',
    components:Object.fromEntries(['backend','frontend','rulesWorker'].map(key=>[key,{sourceCommit:'a'.repeat(40),inputFingerprint:h('b'),imageDigest:`example.test/${key.toLowerCase()}@${h('c')}`} ])),
    rulesArtifactHash:h('c'),contentManifestHash:h('d'),apiProtocolVersion:1,workerProtocolVersion:1,supportedWorldSchemaVersions:[5],workerRuntime:{name:'node',version:'24.19.0'},
    capabilities:['pinned-artifact-routing','pending-decision-pass-through'],migrationSet:[],validationEvidence:[{gate:'core',status:'passed',reportHash:h('e'),inputFingerprint:h('f'),completedAt:'2026-10-04T10:00:00Z'}]};
  const active={schemaVersion:1,status:'active',manifest,instances:Object.fromEntries(Object.keys(manifest.components).map(key=>[key,{releaseId:'old',releaseCommit:manifest.releaseCommit}]))};
  const config={root,project:'fixture',postgresImage:`postgres@${h('f')}`,backupDirectory:path.join(root,'backup')};
  await mkdir(config.backupDirectory);
  for(const key of ['composeFile','caddyFile','deployEnvFile','appEnvFile','workerEnvFile','assetDirectory','artifactDirectory','migrationBaselineFile'])config[key]=path.join(root,key);
  await writeFile(config.composeFile,'reviewed compose');await writeFile(config.caddyFile,'reviewed caddy');
  config.composeHash=await checksum(config.composeFile);config.caddyHash=await checksum(config.caddyFile);
  await writeFile(config.migrationBaselineFile,JSON.stringify({schemaVersion:1,inspected:true,migrationSet:[],inspectionReportHash:h('b')}));
  await writeFile(path.join(root,'active.json'),JSON.stringify(active));
  const sourcePath=path.join(config.backupDirectory,'source-binding.json');
  await writeFile(sourcePath,JSON.stringify({schemaVersion:1,backendContainerId:'a'.repeat(64),databaseIdentityHash:databaseIdentityHash(dsn)}));
  const source={path:'source-binding.json',category:'source-binding',sha256:await checksum(sourcePath),bytes:(await stat(sourcePath)).size};
  await writeFile(path.join(config.backupDirectory,'backup.json'),JSON.stringify({files:[source]}));
  await writeFile(path.join(config.backupDirectory,'capture.json'),JSON.stringify({schemaVersion:1,kind:'candidate-capture',status:'captured',files:[source]}));
  await writeFile(config.appEnvFile,JSON.stringify({DATABASE_URL:dsn}));await writeFile(config.workerEnvFile,'{}');
  const backend=active.manifest.components.backend;
  const container={Config:{Image:backend.imageDigest,Env:[`DATABASE_URL=${dsn}`,'RELEASE_ID=old',`RELEASE_COMMIT=${active.manifest.releaseCommit}`]},Image:'image-id',State:{Running:true,Health:{Status:'healthy'}}};
  const calls=[];let mutateAfterRender,missing=false,failLaunch=false;
  const command=(args,options)=>{
    calls.push({args,options});
    if(args[0]==='context')return JSON.stringify('unix:///var/run/docker.sock');
    if(args[0]==='ps'||args[0]==='compose'&&args.includes('ps'))return missing?'':'a'.repeat(64);
    if(args[0]==='inspect')return JSON.stringify([container]);
    if(args[0]==='image')return JSON.stringify([{Id:'image-id',RepoDigests:[backend.imageDigest]}]);
    if(args[0]==='network')return JSON.stringify([{Labels:{'com.docker.compose.project':'fixture','com.docker.compose.network':'edge'}}]);
    if(args[0]==='run')return '[]';
    if(args[0]==='compose'&&args.includes('config')){
      // Simulate Compose's actual env-file merge, including worker override.
      const environment={...JSON.parse(readFileSync(config.appEnvFile)),...JSON.parse(readFileSync(config.workerEnvFile)),RELEASE_ID:'old',RELEASE_COMMIT:active.manifest.releaseCommit};
      const resolved={services:{backend:{image:backend.imageDigest,environment:Object.fromEntries(Object.entries(environment).map(([key,value])=>[key,String(value).replaceAll('$',()=>'$$')]))}}};
      for(const [key,name] of [['frontend','frontend'],['rulesWorker','rules-worker']])resolved.services[name]={image:active.manifest.components[key].imageDigest,environment:{RELEASE_ID:'old',RELEASE_COMMIT:active.manifest.releaseCommit}};
      mutateAfterRender?.();return JSON.stringify(resolved);
    }
    if(args[0]==='compose'&&args.includes('up')){if(failLaunch){missing=true;failLaunch=false;throw Error('Simulated failed candidate launch');}missing=false;return '';}
    throw Error('Unexpected simulated Docker command');
  };
  const adapter=await createDockerDeploymentAdapter(config,{command});
  return {root,config,active,adapter,calls,container,command,onRender(callback){mutateAfterRender=callback;},loseBackend(){missing=true;},failNextLaunch(){failLaunch=true;}};
}
test('database probes inherit only the inspected live DSN, never mutable app env files',async t=>{
  const f=await fixture(t);await writeFile(f.config.appEnvFile,JSON.stringify({DATABASE_URL:dsn.replace('/source','/other')}));
  await f.adapter.assertDatabase([]);
  const query=f.calls.find(row=>row.args[0]==='run');
  assert.deepEqual(query.options.env,{DATABASE_URL:dsn});assert.ok(!query.args.includes('--env-file'));assert.ok(query.args.includes('DATABASE_URL'));assert.ok(!query.args.includes(dsn));
});

async function retirementTransportFixture(t){
 const f=await fixture(t),unit=retirementExecutionUnitFixture();f.active.database=structuredClone(unit.active.database);
 await writeFile(path.join(f.root,'active.json'),JSON.stringify(f.active));
 const calls=[];let surviving,fail=false,changedOwner=false;
 const command=(args,options)=>{
  calls.push({args,options});
  if(args[0]==='ps'&&args.some(arg=>arg.startsWith('label=bagofholding.retirement-command=')))return surviving?'d'.repeat(64):'';
  if(args[0]==='inspect'&&args[1]==='d'.repeat(64))return JSON.stringify([{Name:'/'+surviving,Config:{Labels:{'bagofholding.retirement-command':changedOwner?'another-owner':surviving}}}]);
  if(args[0]==='rm'&&args[1]==='--force'){assert.equal(args[2],'d'.repeat(64));surviving=null;return '';}
  if(args[0]==='run'){
   if(args.at(-1)==='--migration-info')return JSON.stringify({schemaVersion:1,versions:unit.request.expectedCurrent.map(r=>r.id),build:unit.execution.build,retirementExecutionProtocolVersion:1,retirementReconciliationProtocolVersion:1,supportedRetirementMigrations:[{id:retirementMigrationId,checksum:retirementSQLHash}]});
   if(fail){surviving=args[args.indexOf('--name')+1];throw Error('private DSN '+dsn);}
   return JSON.stringify(unit.execution);
  }
  return f.command(args,options);
 };
 const adapter=await createDockerDeploymentAdapter(f.config,{command});
 const transport=adapter.createRetirementCommand({state:f.active,executorManifest:unit.executorManifest});
 return {...f,unit,calls,transport,failTransport({ownerChanges=false}={}){fail=true;changedOwner=ownerChanges;}};
}
test('explicit retirement transport keeps metadata offline and uses only captured live DSN for all three database modes',async t=>{
 const f=await retirementTransportFixture(t),imageDigest=f.unit.executorManifest.components.backend.imageDigest;
 await writeFile(f.config.appEnvFile,JSON.stringify({DATABASE_URL:dsn.replace('/source','/other')}));
 await f.transport({imageDigest,args:['--migration-info'],input:null});
 for(const flag of ['--execute-character-retirement','--reconcile-character-retirement','--inspect-character-retirement']){
  const request=flag==='--inspect-character-retirement'?f.unit.execution.result.request:f.unit.request;
  await f.transport({imageDigest,args:[flag],input:JSON.stringify(request)});
 }
 const runs=f.calls.filter(c=>c.args[0]==='run');assert.equal(runs.length,4);
 assert(runs[0].args.includes('none'));assert(!runs[0].args.includes('DATABASE_URL'));assert.equal(runs[0].options,undefined);
 for(const c of runs.slice(1)){assert(c.args.includes('fixture_edge'));assert(c.args.includes('--read-only'));assert(!c.args.includes('--env-file'));assert(!c.args.join(' ').includes(dsn));assert.deepEqual(c.options.env,{DATABASE_URL:dsn});assert(c.args.includes(imageDigest));assert(c.args.includes('--name'));}
 assert(!f.calls.some(c=>c.args.includes('up')||c.args.includes('pull')||c.args.includes('--migrate-release')));
});
test('retirement transport refuses different images, injected flags, oversized input, changed source and schema before dispatch',async t=>{
 const f=await retirementTransportFixture(t),call={imageDigest:f.unit.executorManifest.components.backend.imageDigest,args:['--execute-character-retirement'],input:JSON.stringify(f.unit.request)};
 for(const mutation of [c=>{c.imageDigest='example.test/backend@'+h('f');},c=>{c.args.push('--migrate-release');},c=>{c.args=['--migrate-release'];},c=>{c.input='x'.repeat(512*1024+1);},c=>{const r=JSON.parse(c.input);r.candidateSourceCommit='c'.repeat(40);c.input=JSON.stringify(r);},c=>{const r=JSON.parse(c.input);r.expectedCurrent.pop();c.input=JSON.stringify(r);},c=>{const r=JSON.parse(c.input);r.expectedAdditiveSchemaProofHash=h('f');c.input=JSON.stringify(r);}]){const altered=structuredClone(call);mutation(altered);await assert.rejects(f.transport(altered));}
 assert(!f.calls.some(c=>c.args[0]==='run'));
});
test('retirement transport rechecks authoritative active and actual database source immediately before dispatch',async t=>{
 const f=await retirementTransportFixture(t),call={imageDigest:f.unit.executorManifest.components.backend.imageDigest,args:['--execute-character-retirement'],input:JSON.stringify(f.unit.request)};
 f.container.Config.Env[0]='DATABASE_URL='+dsn.replace('/source','/other');await assert.rejects(f.transport(call),/captured source/);
 f.container.Config.Env[0]='DATABASE_URL='+dsn;
 const changed=structuredClone(f.active);changed.instances.frontend.releaseId='changed';await writeFile(path.join(f.root,'active.json'),JSON.stringify(changed));await assert.rejects(f.transport(call),/active baseline changed/);
 assert(!f.calls.some(c=>c.args[0]==='run'));
});
test('uncertain retirement transport sanitizes failures and cleans only its exact owned container without retrying execute',async t=>{
 const f=await retirementTransportFixture(t);f.failTransport();
 await assert.rejects(f.transport({imageDigest:f.unit.executorManifest.components.backend.imageDigest,args:['--execute-character-retirement'],input:JSON.stringify(f.unit.request)}),error=>!error.message.includes(dsn)&&error.message.includes('read-only reconciliation'));
 assert.equal(f.calls.filter(c=>c.args[0]==='run').length,1);assert.equal(f.calls.filter(c=>c.args[0]==='rm').length,1);
});
test('changed command container ownership blocks cleanup and never deletes the mismatched container',async t=>{
 const f=await retirementTransportFixture(t);f.failTransport({ownerChanges:true});
 await assert.rejects(f.transport({imageDigest:f.unit.executorManifest.components.backend.imageDigest,args:['--execute-character-retirement'],input:JSON.stringify(f.unit.request)}),/cleanup requires inspection/);
 assert(!f.calls.some(c=>c.args[0]==='rm'));
});
test('unhealthy or stopped backend refuses even the offline retirement capability probe',async t=>{
 const f=await retirementTransportFixture(t),call={imageDigest:f.unit.executorManifest.components.backend.imageDigest,args:['--migration-info'],input:null};
 f.container.State.Health.Status='unhealthy';await assert.rejects(f.transport(call),/Healthy live backend/);
 f.container.State.Health.Status='healthy';f.container.State.Running=false;await assert.rejects(f.transport(call),/Healthy live backend/);
 assert(!f.calls.some(c=>c.args[0]==='run'));
});
test('controller with the real Docker transport shape rejects changed external archive proof before intent or SQL dispatch',async t=>{
 const f=await retirementTransportFixture(t),store=createDeploymentStore(f.root);
 await assert.rejects(executeRetirement({store,executorManifest:f.unit.executorManifest,approvalHash:f.unit.approvalHash,request:f.unit.request,
  command:f.transport,verifyArtifacts:async()=>{throw Error('retired archive bytes changed');},observe:async()=>{throw Error('must not observe');}}),/archive bytes changed/);
 assert.equal(store.operation(f.unit.request.releaseId),null);assert.deepEqual(store.active(),f.active);
 assert.deepEqual(f.calls.filter(c=>c.args[0]==='run').map(c=>c.args.at(-1)),['--migration-info']);
});

test('installed retirement uses the exact read-only inspector and captured DB binding instead of additive execution',async t=>{
 const f=await fixture(t),unit=retirementStateUnitFixture(),database=databaseStateFromRetirementInspection(unit,unit.inspection);
 let receipt=structuredClone(unit.inspection);const calls=[];
 const command=(args,options)=>{calls.push({args,options});if(args[0]==='run'&&args.includes('--inspect-character-retirement'))return JSON.stringify(receipt);return f.command(args,options);};
 const adapter=await createDockerDeploymentAdapter(f.config,{command});
 const observed=await adapter.assertDatabase(database.migrationSet,database);assert.equal(observed.schemaProofHash,database.schemaProofHash);assert.equal(observed.oldReadersSafe,true);
 const run=calls.find(row=>row.args.includes('--inspect-character-retirement'));
 assert(run.args.includes('--read-only'));assert(run.args.includes(database.executorImageDigest));assert(!run.args.includes('--migrate-release'));assert(!run.args.includes('--inspect-release-migrations'));assert(!run.args.includes(dsn));assert.deepEqual(run.options.env,{DATABASE_URL:dsn});assert.deepEqual(JSON.parse(run.options.input),database.request);
 for(const change of [r=>{r.result.receiptHash=h('a');},r=>{r.result.sqlSourceHash=h('a');},r=>{r.result.applied=['302_retire_legacy_characters'];},r=>{r.build.sourceCommit='c'.repeat(40);},r=>{r.result.schemaProofHash=h('a');}]){receipt=structuredClone(unit.inspection);change(receipt);await assert.rejects(adapter.assertDatabase(database.migrationSet,database));}
 receipt=structuredClone(unit.inspection);receipt.result.rollbackReadersSafe=false;assert.equal((await adapter.assertDatabase(database.migrationSet,database)).oldReadersSafe,false);
 assert(calls.filter(row=>row.args[0]==='run').every(row=>row.args.includes('--inspect-character-retirement')));
});

test('legacy rollback uses observed image ID and protected resolved config; mutable tag/env and substituted config cannot redirect it',async t=>{
 const f=await fixture(t),commit='a'.repeat(40);f.container.Image=h('a');f.container.Config.Image='legacy/backend:old';f.container.Config.Env=[`DATABASE_URL=${dsn}`,`SOURCE_COMMIT=${commit}`];
 const document={services:{backend:{image:h('a'),environment:{DATABASE_URL:dsn,SOURCE_COMMIT:commit}}}};
 const body={schemaVersion:1,kind:'observed-legacy-baseline',status:'observed',provenance:'runtime-observation-only',deployable:false,observedAt:new Date().toISOString(),claimedReleaseCommit:commit,
  components:Object.fromEntries(['backend','frontend','rulesWorker'].map(key=>[key,{imageId:h('a'),imageReference:`legacy/${key}:old`,containerId:'a'.repeat(64),configurationHash:legacyRuntimeFingerprint(f.container),healthy:true,runtimeClaim:commit}])),
  rollbackConfigurationHash:evidenceHash(document),databaseIdentityHash:databaseIdentityHash(dsn),schemaFingerprint:h('b'),rulesArtifactHash:h('c'),migrationIds:['297_existing'],artifactHashes:[h('c')],historicalChecksums:'unavailable',bakedIdentity:'unavailable'};
 const legacy={...body,observationHash:evidenceHash(body)};f.config.legacyBaselineDirectory=path.join(f.root,'legacy-observation-test');await mkdir(f.config.legacyBaselineDirectory);
 await writeFile(path.join(f.config.legacyBaselineDirectory,'baseline.json'),JSON.stringify(legacy));const rollback=path.join(f.config.legacyBaselineDirectory,'rollback.compose.json');await writeFile(rollback,JSON.stringify(document));
 await rm(path.join(f.root,'active.json'));await writeFile(f.config.migrationBaselineFile,JSON.stringify(legacy));
 const calls=[],command=(args,options)=>{calls.push(args);if(args[0]==='image')return JSON.stringify([{Id:h('a')}]);if(args[0]==='compose'&&args.includes('config'))return readFileSync(rollback,'utf8');return f.command(args,options);};
 const adapter=await createDockerDeploymentAdapter(f.config,{command});
 await writeFile(f.config.appEnvFile,JSON.stringify({DATABASE_URL:dsn.replace('/source','/other')}));
 await adapter.replace('backend',legacy);const launch=calls.find(args=>args.includes('up'));assert.equal(JSON.parse(await readFile(launch[launch.indexOf('-f')+1])).services.backend.image,h('a'));assert.ok(!launch.includes('--env-file'));
 document.services.backend.environment.DATABASE_URL=dsn.replace('/source','/other');await writeFile(rollback,JSON.stringify(document));await assert.rejects(adapter.replace('backend',legacy),/rollback configuration changed/);
 await writeFile(rollback,JSON.stringify({...document,services:{backend:{image:h('a'),environment:{DATABASE_URL:dsn,SOURCE_COMMIT:commit}}}}));f.container.Image=h('b');await assert.rejects(adapter.replace('backend',legacy),/captured source/);
});
for(const file of ['appEnvFile','workerEnvFile'])test(`changed ${file} database refuses preparation and cutover before any migration/launch`,async t=>{
  const f=await fixture(t);await writeFile(f.config[file],JSON.stringify({DATABASE_URL:dsn.replace('/source','/other')}));
  await assert.rejects(f.adapter.prepare({previous:f.active,desired:f.active}),/Effective Compose backend database/);
  await assert.rejects(f.adapter.replace('backend',f.active),/Effective Compose backend database/);
  assert.ok(!f.calls.some(row=>row.args[0]==='run'||row.args.includes('up')));
});
test('changed live database or launch identity refuses before the first database query',async t=>{
  const f=await fixture(t);f.container.Config.Env[0]=`DATABASE_URL=${dsn.replace('/source','/other')}`;
  await assert.rejects(f.adapter.assertDatabase([]),/differs from captured source/);
  f.container.Config.Env[0]=`DATABASE_URL=${dsn}`;f.container.Config.Env[1]='RELEASE_ID=unknown';
  await assert.rejects(f.adapter.assertDatabase([]),/differs from captured source/);
  assert.ok(!f.calls.some(row=>row.args[0]==='run'));
});
test('cutover launches the exact checked private document despite subsequent env-file edits',async t=>{
  const f=await fixture(t);
  f.onRender(()=>{const file=f.config.workerEnvFile;
    // The checked result has already been assembled; only a reread is unsafe.
    const next=JSON.stringify({DATABASE_URL:dsn.replace('/source','/other')});
    // Use the existing sync API to model a concurrent external file change.
    writeFileSync(file,next);
  });
  await f.adapter.replace('backend',f.active);
  const launch=f.calls.find(row=>row.args.includes('up')),runtimeFile=launch.args[launch.args.indexOf('-f')+1];
  assert.equal(JSON.parse(await readFile(runtimeFile)).services.backend.environment.DATABASE_URL,dsn);
  assert.ok(!launch.args.includes('--env-file'));assert.equal(path.basename(runtimeFile),'compose.runtime.json');
  if(process.platform!=='win32')assert.equal((await stat(runtimeFile)).mode&0o777,0o600);
  await assert.rejects(f.adapter.replace('backend',f.active),/Effective Compose backend database/);
});
test('private Compose snapshot preserves literal dollars and stopped candidate DB binding for recovery',async t=>{
  const f=await fixture(t),url=new URL(dsn);url.password='pass$word';const secret=url.toString();
  f.container.Config.Env[0]=`DATABASE_URL=${secret}`;f.container.State.Running=false;f.container.State.Health.Status='unhealthy';
  await writeFile(f.config.appEnvFile,JSON.stringify({DATABASE_URL:secret}));
  await f.adapter.assertDatabase([]);
  assert.equal(f.calls.find(row=>row.args[0]==='run').options.env.DATABASE_URL,secret);
  await f.adapter.replace('backend',f.active);
  const file=path.join(f.root,'releases','old','compose.runtime.json');
  assert.equal(JSON.parse(await readFile(file)).services.backend.environment.DATABASE_URL,secret.replaceAll('$',()=>'$$'));
});
test('missing backend is refused before cutover but known failed replacement can restore its bound DB',async t=>{
  const f=await fixture(t);f.failNextLaunch();
  await assert.rejects(f.adapter.replace('backend',f.active),/Simulated failed candidate/);
  await f.adapter.assertDatabase([]);
  await f.adapter.replace('backend',f.active);
  f.loseBackend();
  const restarted=await createDockerDeploymentAdapter(f.config,{command:f.command});
  await assert.rejects(restarted.assertDatabase([]),/Exactly one backend/);
  restarted.allowRecovery({status:'recovery_required',touched:['backend'],plan:{previous:f.active,desired:f.active}});
  await restarted.assertDatabase([]);await restarted.replace('backend',f.active);
  assert.ok(f.calls.filter(row=>row.args[0]==='run').every(row=>row.options.env.DATABASE_URL===dsn));
});


test('modern permitted ON release is observed exactly while substituted flags fail before database reads',async t=>{
 const f=await fixture(t);f.active.manifest.writerPolicy={compactReceipts:true,imageJobs:true,frozenCatalogs:false};
 await writeFile(path.join(f.root,'active.json'),JSON.stringify(f.active));
 const values={DB_COMPACT_RECEIPTS:'1',DB_FROZEN_CATALOGS:'0',IMAGE_JOBS_ENABLED:'1'};
 f.container.Config.Env.push(...Object.entries(values).map(([k,v])=>k+'='+v));
 await writeFile(f.config.appEnvFile,JSON.stringify({DATABASE_URL:dsn,...values}));
 const adapter=await createDockerDeploymentAdapter(f.config,{command:f.command});
 await adapter.assertDatabase([]);await adapter.replace('backend',f.active);
 f.container.Config.Env=f.container.Config.Env.map(row=>row==='IMAGE_JOBS_ENABLED=1'?'IMAGE_JOBS_ENABLED=0':row);
 const before=f.calls.filter(row=>row.args[0]==='run').length;
 await assert.rejects(adapter.assertDatabase([]),/captured source/);
 assert.equal(f.calls.filter(row=>row.args[0]==='run').length,before);
});

test('modern Compose policy mismatch is rejected even when live source is the exact ON predecessor',async t=>{
 const f=await fixture(t);f.active.manifest.writerPolicy={compactReceipts:true,imageJobs:true,frozenCatalogs:false};
 await writeFile(path.join(f.root,'active.json'),JSON.stringify(f.active));
 f.container.Config.Env.push('DB_COMPACT_RECEIPTS=1','DB_FROZEN_CATALOGS=0','IMAGE_JOBS_ENABLED=1');
 await writeFile(f.config.appEnvFile,JSON.stringify({DATABASE_URL:dsn,DB_COMPACT_RECEIPTS:'1',DB_FROZEN_CATALOGS:'0',IMAGE_JOBS_ENABLED:'0'}));
 const adapter=await createDockerDeploymentAdapter(f.config,{command:f.command});
 await assert.rejects(adapter.replace('backend',f.active),/writer policy/);
 assert.ok(!f.calls.some(row=>row.args.includes('up')));
});
