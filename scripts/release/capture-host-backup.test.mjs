import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {captureHostBackup,hostDumpCommand,createHostCaptureAdapter,bindCaptureDatabase,assertOutsideCheckout} from './capture-host-backup.mjs';
import {checksum,verifyBackup} from './backup-manifest.mjs';
import {evidenceHash} from './validate-manifest.mjs';
import {recoverHistoricalSourceCertification} from './historical-source-certification.mjs';
import {verifyBackupSourceReleases} from './source-release-references.mjs';
import {assertLiveReferenceCoverage} from './docker-deployment.mjs';
import {fileURLToPath} from 'node:url';
const h=x=>`sha256:${x.repeat(64)}`;
async function fixture(t){
  const root=await mkdtemp(path.join(tmpdir(),'host-capture-test-'));
  t.after(async()=>{assert.equal(path.dirname(root),path.resolve(tmpdir()));assert.ok(path.basename(root).startsWith('host-capture-test-'));await rm(root,{recursive:true,force:true});});
  for(const name of ['backups','artifacts'])await mkdir(path.join(root,name));
  const artifact=path.join(root,'artifact-source');await writeFile(artifact,'module.exports={};');const artifactHash=await checksum(artifact);
  await writeFile(path.join(root,'artifacts',artifactHash.slice(7)+'.cjs'),'module.exports={};');
  const manifest={schemaVersion:1,releaseId:'old',releaseCommit:'a'.repeat(40),previousReleaseId:null,createdAt:'2026-10-04T10:00:00Z',
    components:Object.fromEntries(['backend','frontend','rulesWorker'].map(key=>[key,{sourceCommit:'a'.repeat(40),inputFingerprint:h('b'),imageDigest:`example.test/${key.toLowerCase()}@${h('c')}`} ])),
    rulesArtifactHash:artifactHash,contentManifestHash:h('d'),apiProtocolVersion:1,workerProtocolVersion:1,supportedWorldSchemaVersions:[5],workerRuntime:{name:'node',version:'24.19.0'},
    capabilities:['pinned-artifact-routing','pending-decision-pass-through'],migrationSet:[],validationEvidence:[{gate:'core',status:'passed',reportHash:h('e'),inputFingerprint:h('f'),completedAt:'2026-10-04T10:00:00Z'}]};
  const active={schemaVersion:1,status:'active',manifest,instances:Object.fromEntries(Object.keys(manifest.components).map(key=>[key,{releaseId:'old',releaseCommit:manifest.releaseCommit}]))};
  await writeFile(path.join(root,'active.json'),JSON.stringify(active));
  const config={schemaVersion:1,project:'fixture',root,postgresImage:`postgres@${h('f')}`,backupDirectory:path.join(root,'backups'),artifactDirectory:path.join(root,'artifacts')};
  for(const key of ['composeFile','caddyFile','deployEnvFile','appEnvFile','workerEnvFile','assetDirectory','migrationBaselineFile'])config[key]=path.join(root,key);
  await writeFile(config.composeFile,'reviewed compose');await writeFile(config.caddyFile,'reviewed caddy');
  config.composeHash=await checksum(config.composeFile);config.caddyHash=await checksum(config.caddyFile);
  const calls=[],adapter={async preflight(){calls.push('preflight');return {schemaVersion:1,backendContainerId:'a'.repeat(64),databaseIdentityHash:h('b')};},async verifyBinding(){},async dump(output){calls.push('dump');await writeFile(path.join(output,'database.dump'),'opaque-dump-fixture',{mode:0o600});}};
  return {config,policy:{schemaVersion:1,productionEnabled:true,migrationMode:'additive-298-300',deleteBackupsImagesAssets:false},output:path.join(root,'backups','capture-42-1'),adapter,production:true,enabled:'true',root,active,calls};
}
test('fresh capture binds bytes and active composition but cannot claim restored/complete backup',async t=>{
  const f=await fixture(t),result=await captureHostBackup(f),capture=JSON.parse(await readFile(path.join(result.captureDirectory,'capture.json')));
  assert.equal(capture.activeHash,evidenceHash(f.active));assert.equal(capture.releaseManifestHash,evidenceHash(f.active.manifest));assert.equal(capture.schemaFingerprint,undefined);assert.equal(capture.artifactInventoryComplete,undefined);
  assert.equal(capture.files.length,5);for(const file of capture.files)assert.equal(await checksum(path.join(f.output,file.path)),file.sha256);
  await assert.rejects(verifyBackup(f.output));
  assert.deepEqual(JSON.parse(await readFile(path.join(f.output,'capture-pointer.json'))),{captureDirectory:f.output});
  await assert.rejects(captureHostBackup(f),/EEXIST/);assert.deepEqual(f.calls,['preflight','dump','preflight']);
  if(process.platform!=='win32'){assert.equal((await stat(f.output)).mode&0o777,0o700);assert.equal((await stat(path.join(f.output,'capture.json'))).mode&0o777,0o600);}
});
test('capture preserves verified historical semantic certification separately from executable CJS',async t=>{
 const f=await fixture(t),releaseHash='sha256:04678a044c4dc809d213e01e392bc0f16562d5103ee96e070089c1edf7e7100b';
 const directory=path.join(f.root,'shared','source-certifications',releaseHash.slice(7));await mkdir(path.dirname(directory),{recursive:true});
 const proof=await recoverHistoricalSourceCertification({repo:fileURLToPath(new URL('../../',import.meta.url)),releaseHash,outputDirectory:directory});f.config.sourceCertificationDirectories=[directory];
 await captureHostBackup(f);const capture=JSON.parse(await readFile(path.join(f.output,'capture.json')));
 assert.equal(capture.sourceReleases.length,1);assert.equal(capture.files.filter(row=>row.category==='historical-source-certification').length,proof.files.length);
 const b=proof.databaseBinding,refs=[{rulesetReleaseId:b.rulesetReleaseId,releaseHash,contentHash:proof.contentHash,manifestHash:b.manifestHash,manifestBytesHash:b.manifestCanonicalBytesSha256,manifest:b.manifest,artifactVersion:proof.releaseId,serializerVersion:b.serializerVersion}];
 await verifyBackupSourceReleases(f.output,refs,capture.sourceReleases,capture.files);
 const live={inventory:{artifactHashes:[f.active.manifest.rulesArtifactHash],sourceReleaseReferences:refs},plan:{preservesArtifacts:[f.active.manifest.rulesArtifactHash]},backup:capture,backupDirectory:f.output,artifactDirectory:f.config.artifactDirectory};
 await assertLiveReferenceCoverage(live);
 for(const changed of [[{...refs[0],contentHash:h('0')}],[...refs,{...refs[0],releaseHash:h('0')}]] )await assert.rejects(assertLiveReferenceCoverage({...live,inventory:{...live.inventory,sourceReleaseReferences:changed}}),/lacks exact/);
 await assert.rejects(assertLiveReferenceCoverage({...live,inventory:{...live.inventory,artifactHashes:[releaseHash]}}),/not covered/);
 await assert.rejects(verifyBackupSourceReleases(f.output,refs,[],capture.files),/lacks exact/);
 const source=capture.files.find(row=>row.category==='historical-source-certification');await writeFile(path.join(f.output,source.path),'changed');
 await assert.rejects(verifyBackupSourceReleases(f.output,refs,capture.sourceReleases,capture.files));
 assert.equal(capture.files.filter(row=>row.category==='rules-artifact').length,1,'semantic release must not become a CJS artifact');
});
test('disabled policy and output outside protected root refuse before dump',async t=>{
  const f=await fixture(t);
  await assert.rejects(captureHostBackup({...f,enabled:'false'}),/disabled/);
  await assert.rejects(captureHostBackup({...f,output:path.join(f.root,'capture-outside')}),/Fresh capture/);
  await assert.rejects(captureHostBackup({...f,config:{...f.config,backupDirectory:f.root}}),/protected/);
  assert.deepEqual(f.calls,[]);
  await assert.rejects(assertOutsideCheckout(f.root,{workspace:f.root}),/workflow checkout/);
  await assert.rejects(assertOutsideCheckout(f.root,{workspace:path.dirname(f.root)}),/workflow checkout/);
  await mkdir(path.join(f.root,'.git'));
  await assert.rejects(captureHostBackup(f),/Git checkout/);assert.deepEqual(f.calls,[]);
});
test('changed active state, corrupt CJS and partial dump never produce capture success marker',async t=>{
  for(const mode of ['active','artifact','dump']){
    const f=await fixture(t);
    if(mode==='artifact')await writeFile(path.join(f.config.artifactDirectory,f.active.manifest.rulesArtifactHash.slice(7)+'.cjs'),'tampered');
    const original=f.adapter.dump;f.adapter.dump=async output=>{await original(output);if(mode==='active')await writeFile(path.join(f.root,'active.json'),JSON.stringify({...f.active,manifest:{...f.active.manifest,releaseId:'other'}}));if(mode==='dump')throw Error('simulated interruption');};
    await assert.rejects(captureHostBackup(f));await assert.rejects(readFile(path.join(f.output,'capture.json')));assert.equal(await readFile(path.join(f.output,'database.dump'),'utf8'),'opaque-dump-fixture');
  }
});
test('prepared dump command uses pinned image, protected env and consistent pg_dump without DSN in host argv',async t=>{
  const f=await fixture(t),args=hostDumpCommand(f.config,f.output,{uid:1001,gid:1001});
  assert.ok(args.includes('--read-only'));assert.ok(args.includes('fixture_edge'));assert.ok(args.includes(f.config.postgresImage));
  assert.equal(args.at(-1),'umask 077; exec pg_dump "$DATABASE_URL" --format=custom --no-owner --no-privileges --file=/capture/database.dump');
  assert.ok(!args.join(' ').includes('postgres://'));assert.throws(()=>hostDumpCommand(f.config,f.output,{uid:undefined,gid:1}));
  const expected=f.active.manifest.components.backend,dsn='postgresql://user:password@db/fixture?sslmode=require';
  const container={Config:{Image:expected.imageDigest,Env:[`DATABASE_URL=${dsn}`,'UNRELATED_KEY=private']},Image:'image-id',State:{Running:true,Health:{Status:'healthy'}}};
  const image={Id:'image-id',RepoDigests:[expected.imageDigest]};
  const identity={component:'backend',provenance:'baked',...expected,...f.active.instances.backend,apiProtocolVersion:1};
  let failDump=false,leftover,removed=false;
  const calls=[],adapter=createHostCaptureAdapter(f.config,{argsIdentity:{uid:1001,gid:1001},command:(args,options)=>{
    calls.push({args,options});if(args[0]==='context')return JSON.stringify('unix:///var/run/docker.sock');if(args[0]==='network')return JSON.stringify([{Labels:{'com.docker.compose.project':'fixture','com.docker.compose.network':'edge'}}]);
    if(args[0]==='run'&&failDump){leftover={name:args[2],owner:args[4].split('=')[1]};throw Error('simulated timeout');}
    if(args[0]==='container'&&args[1]==='ls')return leftover?.name??'';
    if(args[0]==='container'&&args[1]==='inspect')return JSON.stringify([{Config:{Labels:{'bagofholding.capture':leftover.owner}}}]);
    if(args[0]==='container'&&args[1]==='rm'){assert.equal(args.at(-1),leftover.name);removed=true;leftover=null;return '';}
    if(args[0]==='ps')return 'a'.repeat(64);if(args[0]==='inspect')return JSON.stringify([container]);if(args[0]==='image')return JSON.stringify([image]);if(args[0]==='exec')return JSON.stringify(identity);return '';}});
  await adapter.preflight(f.active);await adapter.dump(f.output);const dumped=calls.find(call=>call.args[0]==='run');
  assert.deepEqual([dumped.args[0],...dumped.args.slice(5)],args);assert.deepEqual(dumped.options,{env:{DATABASE_URL:dsn}});
  assert.match(dumped.args[2],/^capture_[a-f0-9]{24}$/);assert.match(dumped.args[4],/^bagofholding.capture=/);
  assert.ok(!dumped.args.includes(dsn));assert.ok(!dumped.args.includes('--env-file'));
  failDump=true;await assert.rejects(adapter.dump(f.output),/simulated timeout/);assert.equal(removed,true);failDump=false;
  await adapter.verifyBinding(f.active);
  container.Config.Env=[`DATABASE_URL=${dsn.replace('@db/','@other/')}`];await assert.rejects(adapter.verifyBinding(f.active),/binding changed/);
  for(const mutate of [c=>{c.Config.Image='wrong';},c=>{c.State.Health.Status='unhealthy';},c=>{c.Config.Env=[];},c=>{c.Config.Env=['DATABASE_URL=invalid'];}]){
    const bad=structuredClone(container);mutate(bad);assert.throws(()=>bindCaptureDatabase(f.active,bad,image,identity));
  }
  const ambiguousPassword=new URL('postgresql://user:password@db/app');ambiguousPassword.password='password host=evil';
  for(const badURL of ['postgresql://user:password@db/app?host=elsewhere','postgresql://user:password@db/app?dbname=other','postgresql://user:password@db',ambiguousPassword.toString(),'postgresql://user:password@db/app?sslmode=require&sslmode=disable','postgresql://user:password@db/a/../b','postgresql://user:password@db/a/%2e%2e/b','postgresql://user:password@d%62/app']){
    assert.throws(()=>bindCaptureDatabase(f.active,{...container,Config:{...container.Config,Env:[`DATABASE_URL=${badURL}`]}},image,identity));
  }
  assert.equal(bindCaptureDatabase(f.active,{...container,Config:{...container.Config,Env:['DATABASE_URL=postgresql://user:password@db/app']}},image,identity),'postgresql://user:password@db/app?sslmode=require');
  const bad=createHostCaptureAdapter(f.config,{command:()=>JSON.stringify('tcp://untrusted:2375')});await assert.rejects(bad.preflight(),/local Docker/);
});
