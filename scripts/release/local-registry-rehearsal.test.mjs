import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {componentInputFingerprint,evidenceHash,validateManifest} from './validate-manifest.mjs';
import {prepareOwnedRegistryFixture,prepareLocalRegistryPlan,validateLocalRegistryPlan,assertLocalRecord,runLocalRegistryRehearsal,createLocalRegistryDockerAdapter,measureRegistryPayload} from './local-registry-rehearsal.mjs';
import {localRehearsalInput,ownedLocalSession} from './local-candidate-rehearsal.mjs';
import {rehearsalInput,collectRehearsal} from './candidate-rehearsal.mjs';

const sha=char=>`sha256:${char.repeat(64)}`,pin=name=>`${name}@${sha('a')}`;
const baseImages={GO_IMAGE:pin('golang'),ALPINE_IMAGE:pin('alpine'),NODE_IMAGE:pin('node'),NGINX_IMAGE:pin('nginx')};
function fixture(t){
  const repo=mkdtempSync(path.join(tmpdir(),'owned-registry-'));t.after(()=>rmSync(repo,{recursive:true,force:true}));
  const put=(file,bytes)=>{mkdirSync(path.dirname(path.join(repo,file)),{recursive:true});writeFileSync(path.join(repo,file),bytes);};
  put('.gitignore','/outputs/\n');put('backend/main.go','package main\nfunc main(){}\n');put('backend/Dockerfile','FROM scratch\nCOPY main.go /source\n');put('backend/.dockerignore','**\n!main.go\n!Dockerfile\n!.dockerignore\n');
  put('frontend/index.html','<html></html>');put('frontend/Dockerfile','FROM scratch\nCOPY frontend/index.html /index.html\n');put('frontend/Dockerfile.dockerignore','**\n!frontend/index.html\n!frontend/Dockerfile\n!frontend/Dockerfile.dockerignore\n');
  put('frontend/worker/server.mjs','export const value=1;\n');put('infra/Dockerfile.rules-worker','FROM scratch\nCOPY frontend/worker/server.mjs /server.mjs\n');put('infra/Dockerfile.rules-worker.dockerignore','**\n!frontend/worker/**\n!infra/Dockerfile.rules-worker\n!infra/Dockerfile.rules-worker.dockerignore\n');
  const git=(...args)=>execFileSync('git',['-c','core.autocrlf=false','-C',repo,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();git('init','--quiet');git('add','--all');const tree=git('write-tree'),commit=git('-c','user.name=Local registry test','-c','user.email=fixture@example.invalid','commit-tree',tree,'-m','fixture');git('update-ref','HEAD',commit);
  return {repo,put,git,commit};
}
function plan(t){const f=fixture(t);return prepareLocalRegistryPlan({repo:f.repo,output:path.join(f.repo,'outputs/release-measure/actual'),baseImages,registryImage:pin('registry')});}
function record(plan,row){return {scope:'owned-loopback-registry',planHash:plan.planHash,name:row.name,inputFingerprint:row.inputFingerprint,sourceCommit:plan.sourceCommit,imageId:sha('b'),runtimeContentFingerprint:sha('f'),build:{mode:'test-only'},archiveHash:sha('c'),identity:{identitySchemaVersion:1,provenance:'baked',component:row.component,sourceCommit:plan.sourceCommit,source_commit:plan.sourceCommit,inputFingerprint:row.inputFingerprint,apiProtocolVersion:1,...(row.name==='worker'?{artifactHash:sha('d'),workerProtocolVersion:1,workerRuntime:{name:'node',version:'24.19.0'}}:{})}};}
function fake(plan){const calls=[];return {execution:'simulated-unit-only',calls,save:async()=>{},preflight:async()=>calls.push('preflight'),start:async()=>calls.push('start'),build:async row=>{calls.push('build:'+row.name);return record(plan,row);},archiveHash:async r=>r.archiveHash,
  publish:async(row,r)=>{assertLocalRecord(plan,row,r,r.corrupt?sha('e'):r.archiveHash);calls.push('publish:'+row.name);return `127.0.0.1:5000/${row.name}@${row.inputFingerprint}`;},pull:async ref=>calls.push('pull:'+ref),corruptArchiveCopy:async r=>({...r,corrupt:true}),
  measureTransfer:async()=>({objects:[{digest:sha('a'),bytes:42}],totalPayloadBytes:42}),missingManifest:async()=>({boundary:'pull',status:'rejected'}),missingLayerManifest:async()=>({boundary:'registry',status:'rejected',code:'MANIFEST_BLOB_UNKNOWN'}),cleanup:async()=>calls.push('cleanup')};}
test('local source plan is immutable, exact and never accepted as deployment provenance',t=>{
  const p=plan(t);assert.equal(validateLocalRegistryPlan(p),p);assert.equal(p.deployable,false);assert.equal(p.ciProvenance,null);assert.throws(()=>validateManifest(p));
  for(const patch of [{deployable:true},{ciProvenance:{}},{sourceCommit:'0'},{output:tmpdir()}]){const changed={...p,...patch};delete changed.planHash;changed.planHash=evidenceHash(changed);assert.throws(()=>validateLocalRegistryPlan(changed));}
  const f=fixture(t);f.put('backend/main.go','changed');assert.throws(()=>prepareLocalRegistryPlan({repo:f.repo,output:path.join(f.repo,'outputs/release-measure/dirty'),baseImages,registryImage:pin('registry')}),/clean committed/);
});
test('owned fixture captures current source bytes in its own real commit, without changing application refs',t=>{
  const f=fixture(t);f.put('backend/main.go','package main\nfunc main(){ /* changed input */ }\n');
  const before=f.git('status','--porcelain'),owned=prepareOwnedRegistryFixture({repo:f.repo,output:path.join(f.repo,'outputs/release-measure/source-fixture')});
  assert.equal(f.git('rev-parse','HEAD'),f.commit);assert.equal(f.git('status','--porcelain'),before);
  assert.notEqual(owned.sourceEvidence.fixtureCommit,f.commit);
  const p=prepareLocalRegistryPlan({...owned,output:path.join(owned.repo,'outputs/release-measure/registry'),baseImages,registryImage:pin('registry')});
  assert.equal(p.sourceCommit,owned.sourceEvidence.fixtureCommit);assert.equal(p.sourceEvidence.hash,owned.sourceEvidence.hash);
  const evidence=JSON.parse(readFileSync(owned.sourceEvidence.path));assert.equal(evidence.deployable,false);assert.equal(evidence.originHead,f.commit);
});
test('registry orchestration proves separate phases without inventing CI or production readiness',async t=>{
  const p=plan(t),adapter=fake(p),report=await runLocalRegistryRehearsal(p,adapter);
  assert.equal(report.status,'passed');assert.equal(report.execution,'simulated-unit-only');assert.equal(report.deployable,false);assert.equal(report.checks.length,9);assert.equal(report.cleanup.status,'stopped');
  assert.deepEqual(adapter.calls.filter(x=>x.startsWith('build:')),['build:backend','build:frontend','build:worker','build:backend','build:backend','build:frontend','build:frontend','build:worker','build:worker','build:frontend']);
  assert.deepEqual(report.reused,['backend','worker']);assert.notEqual(report.images.frontend,report.changedFrontendDigest);
  assert.equal(adapter.calls.filter(x=>x.startsWith('publish:')).length,7);
});
test('owned local collector input preserves the production execution path without fabricated CI authority',async t=>{
  const p=plan(t),report=await runLocalRegistryRehearsal(p,fake(p));
  // This unit fixture exercises contract validation only; it is never saved as Docker evidence.
  report.execution='docker';Object.assign(report.records.worker.identity,{supportedWorldSchemaVersions:[5],capabilities:['pinned-artifact-routing','pending-decision-pass-through']});
  const old={schemaVersion:1,releaseId:'previous-local',releaseCommit:'a'.repeat(40),previousReleaseId:null,createdAt:new Date().toISOString(),components:Object.fromEntries(p.rows.map(row=>[row.component,{sourceCommit:'a'.repeat(40),inputFingerprint:row.inputFingerprint,imageDigest:`127.0.0.1:5000/${row.name}@${sha('b')}`}])),rulesArtifactHash:sha('d'),contentManifestHash:sha('e'),apiProtocolVersion:1,workerProtocolVersion:1,supportedWorldSchemaVersions:[5],workerRuntime:{name:'node',version:'24.19.0'},capabilities:['pinned-artifact-routing','pending-decision-pass-through'],migrationSet:[],validationEvidence:[{gate:'image-contract',status:'passed',reportHash:sha('a'),inputFingerprint:sha('b'),completedAt:new Date().toISOString()}]};
  const active={schemaVersion:1,status:'active',manifest:old,instances:Object.fromEntries(p.rows.map(row=>[row.component,{releaseId:old.releaseId,releaseCommit:old.releaseCommit}]))};
  const backup={releaseManifestHash:evidenceHash(old),migrations:[],referencedArtifactHashes:[sha('d')],files:[{category:'rules-artifact',sha256:sha('d')}]};
  const args={plan:p,registryReport:report,images:report.images,active,backup,contentManifestHash:sha('e'),migrationSet:[]};
  const input=localRehearsalInput(args);assert.equal(input.localOnly,true);assert.equal(input.deployable,false);assert.equal(input.ciProvenance,null);
  assert.throws(()=>rehearsalInput({status:'candidate-only',deployable:false,manifest:input.manifest},active,backup),/provenance/);
  for(const patch of [{execution:'simulation'},{ciProvenance:{}},{cleanup:{status:'failed'}},{checks:report.checks.map((row,i)=>i?row:{...row,id:'unknown-stage'})}])assert.throws(()=>localRehearsalInput({...args,registryReport:{...report,...patch}}),/local registry proof/);
  assert.throws(()=>localRehearsalInput({...args,images:{...report.images,backend:`registry.example/backend@${sha('b')}`}}),/loopback/);
  assert.throws(()=>localRehearsalInput({...args,backup:{...backup,releaseManifestHash:sha('c')}}),/predecessor/);
  let saved;await assert.rejects(()=>collectRehearsal(input,{execution:'simulation',start:async()=>{throw Error('owned stage failure');},cleanup:async()=>({status:'stopped'})},{onReport:async value=>{saved=value;}}));
  assert.equal(saved.kind,'local-candidate-rehearsal');assert.equal(saved.deployable,false);assert.equal(saved.ciProvenance,null);assert.equal(saved.status,'failed');
});
test('final local session records registry and candidate cleanup independently, even after an inner passing receipt',async t=>{
 for(const failure of ['registry','candidate','execute',null]){
  const f=fixture(t),calls=[],adapter={execution:'simulated-unit-only',cleanup:async()=>{calls.push('candidate');if(failure==='candidate')throw Error('candidate cleanup');return {status:'stopped'};}},registry={cleanup:async()=>{calls.push('registry');if(failure==='registry')throw Error('registry cleanup');}};
  const run=()=>ownedLocalSession({registry,adapter,output:f.repo},async()=>{if(failure==='execute')throw Error('execution failed');return {kind:'local-candidate-rehearsal',status:'passed',cleanup:{status:'stopped'}};});
  if(failure)await assert.rejects(run,/session failed/);else assert.equal((await run()).status,'passed');
  assert.deepEqual(calls,['candidate','registry']);const final=JSON.parse(readFileSync(path.join(f.repo,'local-session.json')));assert.equal(final.status,failure?'failed':'passed');assert.equal(final.deployable,false);assert.equal(final.cleanup.registry,failure==='registry'?'failed':'stopped');assert.equal(final.cleanup.candidate,failure==='candidate'?'failed':'stopped');
 }
});
test('registry setup, missing-layer setup and cleanup failures cannot become passing negative evidence',async t=>{
  for(const method of ['start','missingLayerManifest','cleanup']){const p=plan(t),adapter=fake(p);let saved;adapter.save=async r=>{saved=structuredClone(r);};adapter[method]=async()=>{throw Error('injected operation failure');};await assert.rejects(()=>runLocalRegistryRehearsal(p,adapter));assert.equal(saved.status,'failed');}
  const p=plan(t),adapter=fake(p);adapter.missingLayerManifest=async()=>({status:'rejected',boundary:'local-parser'});await assert.rejects(()=>runLocalRegistryRehearsal(p,adapter),/Actual missing-layer/);
});
test('local archive and baked source/input/protocol mismatches reject before publication',t=>{
  const p=plan(t),row=p.rows[0],r=record(p,row);assertLocalRecord(p,row,r,r.archiveHash);
  assert.throws(()=>assertLocalRecord(p,row,r,sha('d')),/archive/);
  for(const patch of [{sourceCommit:'0'.repeat(40)},{provenance:'unverified'},{apiProtocolVersion:2}])assert.throws(()=>assertLocalRecord(p,row,{...r,identity:{...r.identity,...patch}},r.archiveHash),/identity/);
});
test('Docker adapter rejects remote daemon before creating any resource',async t=>{
  const p=plan(t),calls=[];const adapter=createLocalRegistryDockerAdapter(p,{command:args=>{calls.push(args);return JSON.stringify('tcp://remote.example:2375');}});
  await assert.rejects(()=>adapter.preflight(),/local Docker/);assert.equal(calls.length,1);await adapter.cleanup();assert.equal(calls.length,1);
});
test('registry byte proof streams hash-checked compressed objects once and rejects altered payload/descriptor',async()=>{
  const digestOf=bytes=>`sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  const config=Buffer.from('{"architecture":"amd64"}'),layer=Buffer.from([31,139,8,0,1,2,3,4]);
  const descriptor=bytes=>({digest:digestOf(bytes),size:bytes.length});
  const manifest=Buffer.from(JSON.stringify({schemaVersion:2,config:descriptor(config),layers:[descriptor(layer),descriptor(layer)]}));
  const store=new Map([[digestOf(config),config],[digestOf(layer),layer],[digestOf(manifest),manifest]]),calls=[];
  const request=async route=>{calls.push(route);return new Response(store.get(route.split('/').at(-1)));};
  const proof=await measureRegistryPayload('frontend',digestOf(manifest),request);
  assert.equal(proof.totalPayloadBytes,config.length+layer.length+manifest.length);assert.equal(proof.compressedLayerBytes,layer.length);assert.equal(calls.length,3);
  store.set(digestOf(layer),Buffer.from('altered'));await assert.rejects(()=>measureRegistryPayload('frontend',digestOf(manifest),request),/hash\/size/);
  const bad=Buffer.from(JSON.stringify({schemaVersion:2,config:descriptor(config),layers:[{...descriptor(layer),size:999}]}));store.set(digestOf(layer),layer);store.set(digestOf(bad),bad);
  await assert.rejects(()=>measureRegistryPayload('frontend',digestOf(bad),request),/hash\/size/);
});
