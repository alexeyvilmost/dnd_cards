// Synthetic workflow metadata exercises the record boundary, not DDL authority.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync,writeFileSync,mkdirSync,chmodSync} from 'node:fs';
import path from 'node:path';
import {retirementRecordUnitFixture as fixture} from './retirement-record-unit-fixture.mjs';
import {recordRetirementObservation,validateRetirementRecordRun,main} from './retirement-record-host.mjs';


test('exact current succeeded retirement is recorded without changing the store or its manifest',async t=>{
  const f=fixture(t),before=readFileSync(path.join(f.root,'active.json')),journal=readFileSync(path.join(f.root,'operations',f.operationId+'.json'));
  const proof=await recordRetirementObservation(f);
  assert.equal(proof.scope,'recorded-retirement-only');assert.equal(proof.deployment.runId,42);
  assert.equal(proof.active.database.status,'verified-character-retirement');assert.equal(f.calls(),2);
  assert.deepEqual(proof.active.manifest,f.store.active().manifest);assert.deepEqual(readFileSync(path.join(f.root,'active.json')),before);
  assert.deepEqual(readFileSync(path.join(f.root,'operations',f.operationId+'.json')),journal);assert.equal(existsSync(path.join(f.root,'deploy.lock')),false);
});

test('foreign workflow, fork, actor, attempt, title and automatic events cannot attest a record',t=>{
  const f=fixture(t);
  for(const change of [r=>r.path='.github/workflows/release.yml',r=>r.head_branch='feature',r=>r.head_sha='e'.repeat(40),r=>r.id++,r=>r.run_attempt++,
    r=>r.repository.full_name='other/project',r=>r.head_repository.full_name='fork/project',r=>r.actor.login='other-owner',r=>r.display_title='Record retirement other',
    r=>r.event='workflow_run',r=>r.status='completed',r=>r.conclusion='success']){
    const run=structuredClone(f.run);change(run);assert.throws(()=>validateRetirementRecordRun(run,f));
  }
  for(const operationId of ['../retirement302-a','retirement302-../a','retirement302-a/b','other-a',''])assert.throws(()=>validateRetirementRecordRun(f.run,{...f,operationId}));
  assert.throws(()=>validateRetirementRecordRun(f.run,{...f,request:{...f.request,eventName:'workflow_run'}}));
});

test('changed workflow on the second GET and unavailable metadata are refused',async t=>{
  const f=fixture(t);let calls=0;
  await assert.rejects(recordRetirementObservation({...f,get:async()=>{const run=structuredClone(f.run);if(++calls===2)run.run_attempt++;return run;}}));
  await assert.rejects(recordRetirementObservation({...f,get:async()=>{throw Error('metadata unavailable');}}),/metadata unavailable/);
  assert.equal(existsSync(path.join(f.root,'deploy.lock')),false);
});

test('pending journal, unsuccessful operation and source drift cannot produce an observation',async t=>{
  for(const change of [f=>f.store.writeOperation({releaseId:'pending-operation',status:'recovery_required'}),f=>{const op=f.store.operation(f.operationId);op.status='outcome_unknown';f.store.writeOperation(op);},f=>f.request.sourceCommit='e'.repeat(40),f=>f.expectedManifestHash='sha256:'+'f'.repeat(64)]){
    const f=fixture(t),before=readFileSync(path.join(f.root,'active.json'));change(f);await assert.rejects(recordRetirementObservation(f));assert.deepEqual(readFileSync(path.join(f.root,'active.json')),before);
  }
});

test('host entry requires Linux and private exact paths; native output is immutable and bound to the current store',async t=>{
  if(process.platform!=='linux'){await assert.rejects(main([],{}),/protected Linux host/);return;}
  const f=fixture(t),config=path.join(f.root,'config.json'),policy=path.join(f.root,'policy.json'),parent=path.join(f.root,'deploy-attempts'),attempt=path.join(parent,'deploy-42-1');
  for(const [file,data]of [[config,{schemaVersion:1,root:f.root}],[policy,{schemaVersion:1,productionEnabled:true}]])writeFileSync(file,JSON.stringify(data),{flag:'wx',mode:0o600});
  mkdirSync(parent,{mode:0o700});mkdirSync(attempt,{mode:0o700});
  const env={DEPLOY_PRODUCTION_ENABLED:'true',GITHUB_REPOSITORY:f.request.repository,GITHUB_SHA:f.request.controlCommit,DEPLOY_SOURCE_COMMIT:f.request.sourceCommit,
    GITHUB_RUN_ID:'42',GITHUB_RUN_ATTEMPT:'1',GITHUB_EVENT_NAME:f.request.eventName,GITHUB_ACTOR:f.request.actor,DEPLOY_EXPECTED_MANIFEST_HASH:f.expectedManifestHash};
  const args=[config,policy,f.operationId,attempt],before=readFileSync(path.join(f.root,'active.json'));
  chmodSync(attempt,0o755);await assert.rejects(main(args,env,f.get));assert.equal(existsSync(path.join(attempt,'deployed-release')),false);chmodSync(attempt,0o700);
  await assert.rejects(main(args,{...env,GITHUB_RUN_ATTEMPT:'2'},f.get));
  const result=await main(args,env,f.get);assert.equal(result.databaseChanges,0);assert.equal(result.applicationCompositionChanged,false);
  const receipt=path.join(attempt,'deployed-release','retirement-observation.json'),bytes=readFileSync(receipt);
  await assert.rejects(main(args,env,f.get),error=>error.code==='EEXIST');assert.deepEqual(readFileSync(receipt),bytes);assert.deepEqual(readFileSync(path.join(f.root,'active.json')),before);
});
