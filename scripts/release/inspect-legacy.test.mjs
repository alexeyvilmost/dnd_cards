import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {evidenceHash,validateManifest} from './validate-manifest.mjs';
import {validateLegacyBaseline,assertLegacyObservation,legacyMigrationBaseline} from './legacy-baseline.mjs';
import {assertLegacyConfiguration,inspectLegacy,resolvedLegacyServiceHash,withLegacyReadSnapshot} from './inspect-legacy.mjs';
const hash=c=>'sha256:'+c.repeat(64),commit='a'.repeat(40);
export function legacyFixture(){
 const body={schemaVersion:1,kind:'observed-legacy-baseline',status:'observed',provenance:'runtime-observation-only',deployable:false,observedAt:new Date().toISOString(),claimedReleaseCommit:commit,
 components:Object.fromEntries(['frontend','backend','rulesWorker'].map((key,i)=>[key,{imageId:hash(String(i+1)),containerId:String(i+1).repeat(64),configurationHash:hash('4'),healthy:true,runtimeClaim:commit,imageReference:`legacy/${key.toLowerCase()}:old`} ])),
 rollbackConfigurationHash:hash('b'),databaseIdentityHash:hash('c'),schemaFingerprint:hash('d'),rulesArtifactHash:hash('e'),migrationIds:['297_existing'],artifactHashes:[hash('e')],historicalChecksums:'unavailable',bakedIdentity:'unavailable'};
 return {...body,observationHash:evidenceHash(body)};
}
test('legacy observation remains explicitly unverified build provenance with ID-only migrations',()=>{
 const fixture=legacyFixture();assert.equal(validateLegacyBaseline(fixture),fixture);assert.throws(()=>validateManifest(fixture));
 const request=legacyMigrationBaseline(fixture);assert.equal(request.schemaVersion,2);assert.deepEqual(request.expectedCurrentIds,['297_existing']);assert.equal(request.expectedCurrent,undefined);
 assert.throws(()=>validateLegacyBaseline({...fixture,historicalChecksums:hash('a')}));
 const changed=legacyFixture();changed.components.backend.imageId=hash('f');const {observationHash,...body}=changed;changed.observationHash=evidenceHash(body);assert.throws(()=>assertLegacyObservation(fixture,changed));
});
test('Compose service hash consumes the resolved env-file document through stdin, never unresolved config or secret argv',()=>{
 const document={services:{backend:{image:'legacy/backend:old',environment:{EXAMPLE_VALUE:'resolved$$value'}}}},before=structuredClone(document);
 let calls=0;const result=resolvedLegacyServiceHash(document,'boh','backend',(args,options)=>{
  calls++;assert.deepEqual(args,['compose','--project-name','boh','-f','-','config','--hash','backend']);assert.deepEqual(JSON.parse(options.input),before);assert.ok(!args.some(value=>value.includes('resolved')));return `backend ${'b'.repeat(64)}\n`;
 });assert.equal(calls,1);assert.equal(result,'b'.repeat(64));assert.deepEqual(document,before);
 assert.throws(()=>resolvedLegacyServiceHash(document,'boh','backend',()=> 'backend invalid'));assert.throws(()=>resolvedLegacyServiceHash(document,'boh','unrecognized',()=>''));
});
test('legacy rollback config pins actual image IDs and rejects env-file drift, wrong health and enabled new writers',()=>{
 const document={services:{}},containers={};
 for(const [key,name]of Object.entries({frontend:'frontend',backend:'backend',rulesWorker:'rules-worker'})){
  document.services[name]={image:`legacy/${name}:old`,environment:{SOURCE_COMMIT:commit,DATABASE_URL:'postgres://user:password@db/app?sslmode=disable'},build:{context:'.'}};
  containers[key]={Image:hash('a'),State:{Running:true,Health:{Status:'healthy'}},Config:{Image:`legacy/${name}:old`,Env:[`SOURCE_COMMIT=${commit}`,'DATABASE_URL=postgres://user:password@db/app?sslmode=disable']}};
 }
 const pinned=assertLegacyConfiguration(document,containers,commit);assert.equal(pinned.services.backend.image,hash('a'));assert.equal(pinned.services.backend.build,undefined);assert.equal(document.services.backend.image,'legacy/backend:old');
 document.services.backend.environment.DATABASE_URL='postgres://user:password@other/app?sslmode=disable';assert.throws(()=>assertLegacyConfiguration(document,containers,commit));document.services.backend.environment.DATABASE_URL='postgres://user:password@db/app?sslmode=disable';
 containers.backend.Config.Env.push('DB_COMPACT_RECEIPTS=1');assert.throws(()=>assertLegacyConfiguration(document,containers,commit));containers.backend.Config.Env.pop();
 containers.backend.State.Health.Status='starting';assert.throws(()=>assertLegacyConfiguration(document,containers,commit));
});
test('legacy inspector writes only a new private observation, never active.json or a fake manifest',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'boh-legacy-inspect-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const rollbackConfiguration={services:{backend:{image:hash('a')}}},baseline=legacyFixture();baseline.rollbackConfigurationHash=evidenceHash(rollbackConfiguration);const {observationHash,...body}=baseline;baseline.observationHash=evidenceHash(body);
 const config={schemaVersion:1,root,project:'boh',claimedReleaseCommit:commit,composeFile:path.join(root,'compose.yml'),envFiles:[path.join(root,'deploy.env')],postgresImage:`postgres@${hash('1')}`,databaseNetwork:'boh_edge'};
 const output=path.join(root,'legacy-observation-test'),adapter={inspect:async()=>({baseline,rollbackConfiguration})};
 const result=await inspectLegacy({config,output,adapter});assert.equal(result.deployable,false);assert.equal(result.observationHash,baseline.observationHash);
 assert.deepEqual(JSON.parse(await readFile(path.join(output,'baseline.json'))),baseline);await assert.rejects(readFile(path.join(root,'active.json')),/ENOENT/);
 await assert.rejects(inspectLegacy({config,output,adapter}),/EEXIST/);await assert.rejects(inspectLegacy({config,output:path.join(root,'nested','legacy-observation-other'),adapter}),/child/);
});
test('legacy inventory exporter keeps one bounded readonly snapshot and always removes only its own helper',async()=>{
 const name='legacy_inspect_test',label=`bagofholding.legacy-inspection=${name}`,calls=[],snapshot='00000003-0000001B-1';
 const command=(args,options)=>{calls.push({args,options});if(args[0]==='run'){assert.ok(args.includes('--read-only'));assert.ok(args.at(-1).includes('REPEATABLE READ READ ONLY'));assert.ok(args.at(-1).includes('pg_sleep(1)'));assert.ok(args.at(-1).includes('stat -c %Y /tmp/lease'));assert.ok(!args.join(' ').includes('private-dsn'));assert.equal(options.env.DATABASE_URL,'private-dsn');return'created';}
  if(args[0]==='exec')return snapshot;if(args[1]==='inspect')return JSON.stringify([{State:{Running:true},Config:{Labels:{'bagofholding.legacy-inspection':name}}}]);if(args[1]==='ls')return name+'_snapshot';if(args[1]==='rm')return'removed';throw Error('unexpected');};
 const input={command,config:{databaseNetwork:'boh_edge',postgresImage:'postgres@'+hash('a')},dsn:'private-dsn',name,label};
 assert.equal(await withLegacyReadSnapshot(input,async actual=>{assert.equal(actual,snapshot);return'complete';}),'complete');assert.deepEqual(calls.at(-1).args,['container','rm','--force',name+'_snapshot']);
 await assert.rejects(()=>withLegacyReadSnapshot(input,async()=>{throw Error('scan failed');}),/scan failed/);assert.deepEqual(calls.at(-1).args,['container','rm','--force',name+'_snapshot']);
});
