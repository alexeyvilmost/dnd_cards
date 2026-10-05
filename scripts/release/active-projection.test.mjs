import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createDeploymentStore} from './deploy-state.mjs';
import {evidenceHash} from './validate-manifest.mjs';
import {projectSucceededActive,validateActiveProjection,validatePublicActive,main} from './active-projection.mjs';
const h=c=>'sha256:'+c.repeat(64),copy=structuredClone;
function fixture(t,version=0){
  const root=mkdtempSync(path.join(tmpdir(),'active-projection-'));
  t.after(()=>{assert.equal(path.dirname(root),path.resolve(tmpdir()));assert.ok(path.basename(root).startsWith('active-projection-'));rmSync(root,{recursive:true,force:true});});
  const request={repository:'example/project',runId:'42',attempt:'2',controlCommit:'c'.repeat(40),sourceCommit:'b'.repeat(40)};
  const manifest={schemaVersion:1,releaseId:'current',releaseCommit:request.sourceCommit,previousReleaseId:'previous',createdAt:'2026-10-05T00:00:00Z',
    components:Object.fromEntries(['frontend','backend','rulesWorker'].map((key,i)=>[key,{sourceCommit:(i?'a':'b').repeat(40),inputFingerprint:h(String(i+1)),imageDigest:`example.test/${key.toLowerCase()}@${h(String(i+4))}`} ])),
    rulesArtifactHash:h('a'),contentManifestHash:h('b'),apiProtocolVersion:1,workerProtocolVersion:1,supportedWorldSchemaVersions:[5],workerRuntime:{name:'node',version:'24.19.0'},capabilities:['pinned-artifact-routing','pending-decision-pass-through'],migrationSet:[{id:'001',checksum:h('c')}],
    validationEvidence:[{gate:'core',status:'passed',reportHash:h('d'),inputFingerprint:h('e'),completedAt:'2026-10-05T00:00:00Z'}]};
  const active={schemaVersion:1,status:'active',manifest,instances:{frontend:{releaseId:'current',releaseCommit:request.sourceCommit},backend:{releaseId:'prior-launch',releaseCommit:'d'.repeat(40)},rulesWorker:{releaseId:'older-launch',releaseCommit:'e'.repeat(40)}}};
  if(version){
    const baseline=version===1?copy(manifest.migrationSet):[{id:'001',kind:'observed-id-only',observationHash:h('0')}];
    manifest.migrationSet=[...baseline,{id:'298_compact_command_receipts',checksum:h('9')}];
    const req={schemaVersion:version,releaseId:'schema-expansion',target:copy(manifest.migrationSet),candidateSourceCommit:'a'.repeat(40),candidateInputFingerprint:h('2'),
      ...(version===1?{expectedCurrent:baseline}:{kind:'observed-legacy-baseline',baselineObservationHash:h('0'),expectedCurrentIds:['001']})};
    active.database={schemaVersion:1,status:'verified-additive',migrationSet:copy(manifest.migrationSet),schemaProofHash:h('6'),approvalHash:h('7'),request:req,executorImageDigest:manifest.components.backend.imageDigest};
  }
  const operation={schemaVersion:1,releaseId:manifest.releaseId,status:'succeeded',plan:{candidateHash:evidenceHash(manifest),desired:copy(active)},createdAt:'private-operation-time',privateCanary:'PRIVATE_JOURNAL_CANARY'};
  const store=createDeploymentStore(root);store.writeActive(active);store.writeOperation(operation);
  return {root,request,manifest,active,operation,store};
}
function emit(f){return projectSucceededActive(f);}
function rehash(p){p.activeHash=evidenceHash(p.active);const {projectionHash,...document}=p;p.projectionHash=evidenceHash(document);return p;}
test('real protected store preserves actual reused launches and both additive database identity formats',t=>{
  for(const version of [0,1,2]){
    const f=fixture(t,version),p=emit(f);
    assert.deepEqual(p.active,f.active);assert.equal(p.activeHash,evidenceHash(f.active));assert.equal(p.operationHash,evidenceHash(f.operation));
    assert.equal(p.active.instances.backend.releaseCommit,'d'.repeat(40));assert.notEqual(p.active.instances.backend.releaseCommit,p.active.manifest.components.backend.sourceCommit);
    assert.equal(p.deployment.runId,42);assert.equal(p.deployment.runAttempt,2);assert.equal(p.scope,'recorded-active-only');
    assert.ok(!JSON.stringify(p).includes('PRIVATE_JOURNAL_CANARY'));assert.ok(!JSON.stringify(p).includes('private-operation-time'));assert.ok(!JSON.stringify(p).includes(f.root));
    assert.deepEqual(emit({...f,operation:{...f.operation,repeated:true}}),p);assert.equal(existsSync(path.join(f.root,'deploy.lock')),false);
  }
});
test('emitter refuses unresolved, locked, stale or changed persisted operations without modifying active state',t=>{
  const f=fixture(t,2),before=readFileSync(path.join(f.root,'active.json'));
  const unlock=f.store.lock();assert.throws(()=>emit(f),/lock/);unlock();
  f.store.writeOperation({schemaVersion:1,releaseId:'pending',status:'preparing'});assert.throws(()=>emit(f),/Unresolved/);
  f.store.writeOperation({schemaVersion:1,releaseId:'pending',status:'failed_before_cutover'});
  for(const mutate of [x=>x.status='rolled_back',x=>x.plan.desired.instances.backend.releaseId='forged',x=>x.plan.candidateHash=h('0')]){
    const changed=copy(f.operation);mutate(changed);f.store.writeOperation(changed);assert.throws(()=>emit({...f,operation:changed}),/match/);
  }
  f.store.writeOperation(f.operation);assert.throws(()=>emit({...f,operation:{...f.operation,privateCanary:'changed'}}),/match/);
  const changed=copy(f.active);changed.instances.backend.releaseId='later-metadata-release';f.store.writeActive(changed);assert.throws(()=>emit(f),/match/);f.store.writeActive(f.active);
  assert.deepEqual(readFileSync(path.join(f.root,'active.json')),before);assert.equal(existsSync(path.join(f.root,'deploy.lock')),false);
});
test('nested allowlists reject private fields before publication even with coherent self hashes',t=>{
  const f=fixture(t,2),original=emit(f),mutations=[
    p=>p.secret='SECRET_CANARY',p=>p.deployment.hostPath='/private',p=>p.active.env={DATABASE_URL:'SECRET_CANARY'},
    p=>p.active.instances.backend.env='SECRET_CANARY',p=>p.active.database.databaseURL='SECRET_CANARY',
    p=>p.active.database.request.password='SECRET_CANARY',p=>p.active.database.request.expectedCurrentIds=['/private/SECRET_CANARY'],
    p=>p.active.database.migrationSet[0].secret='SECRET_CANARY',p=>p.active.manifest.components.backend.env='SECRET_CANARY',
  ];
  for(const mutate of mutations){const p=copy(original);mutate(p);rehash(p);assert.throws(()=>validateActiveProjection(p,{request:f.request,manifest:f.manifest}));}
  for(const version of [1,2]){const x=fixture(t,version);x.active.database.request.extra='SECRET_CANARY';assert.throws(()=>validatePublicActive(x.active));}
});
test('external workflow and expected state reject coherent self-hash forgery; no fabricated current identity',t=>{
  const f=fixture(t,2),original=emit(f);
  for(const mutate of [p=>p.deployment.runId++,p=>p.deployment.runAttempt++,p=>p.deployment.repository='other/project',p=>p.deployment.controlCommit='f'.repeat(40),p=>p.deployment.sourceCommit='f'.repeat(40),p=>p.active.instances.backend.releaseCommit='f'.repeat(40)]){
    const p=copy(original);mutate(p);rehash(p);assert.throws(()=>validateActiveProjection(p,{request:f.request,manifest:f.manifest,expectedActive:f.active}));
  }
});
test('actual CLI reads protected succeeded state and outputs no private configuration or journal data',t=>{
  const f=fixture(t,2),dir=fixture(t).root;
  const config=path.join(f.root,'config.json'),op=path.join(dir,'operation.json'),manifest=path.join(dir,'manifest.json'),output=path.join(dir,'active-projection.json');
  writeFileSync(config,JSON.stringify({schemaVersion:1,root:f.root,appEnvFile:'PRIVATE_CONFIG_CANARY',database:'SECRET_CANARY'}));
  writeFileSync(op,JSON.stringify(f.operation));writeFileSync(manifest,JSON.stringify(f.manifest));
  const env={...process.env,GITHUB_REPOSITORY:f.request.repository,GITHUB_SHA:f.request.controlCommit,DEPLOY_SOURCE_COMMIT:f.request.sourceCommit,GITHUB_RUN_ID:f.request.runId,GITHUB_RUN_ATTEMPT:f.request.attempt};
  const child=spawnSync(process.execPath,[fileURLToPath(new URL('./active-projection.mjs',import.meta.url)),config,op,manifest,output,dir],{env,encoding:'utf8'});
  assert.equal(child.status,0,child.stderr);assert.equal(JSON.parse(child.stdout).status,'succeeded');const p=JSON.parse(readFileSync(output,'utf8'));
  validateActiveProjection(p,{request:f.request,manifest:f.manifest,expectedActive:f.active});
  for(const canary of ['PRIVATE_CONFIG_CANARY','PRIVATE_JOURNAL_CANARY','SECRET_CANARY',f.root])assert.ok(!JSON.stringify(p).includes(canary));
  const bytes=readFileSync(output);assert.throws(()=>main([config,op,manifest,output,dir],env));assert.deepEqual(readFileSync(output),bytes);
  assert.throws(()=>main([config,op,manifest,path.join(tmpdir(),'not-owned-projection.json'),dir],env),/output/);
  assert.throws(()=>main([config,op,manifest,path.join(f.root,'not-attempt.json'),f.root],env),/Protected/);
});
