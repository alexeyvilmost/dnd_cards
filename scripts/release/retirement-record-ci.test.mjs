// A synthetic latest deploy API exercises source binding, not live acceptance.
import test from 'node:test';import assert from 'node:assert/strict';
import {retirementRecordUnitFixture} from './retirement-record-unit-fixture.mjs';
import {selectLatestDeployedRun} from './deployed-baseline.mjs';
import {evidenceHash} from './validate-manifest.mjs';
import {prepareRetirementRecord,validateRetirementRecordInput} from './retirement-record-ci.mjs';

async function fixture(t){
  const f=retirementRecordUnitFixture(t),manifest=f.store.active().manifest,repository=f.request.repository,control='d'.repeat(40);
  const previous={id:8,run_attempt:1,path:'.github/workflows/deploy.yml',head_branch:'main',head_sha:control,event:'workflow_run',status:'completed',conclusion:'success',repository:{full_name:repository},head_repository:{full_name:repository}};
  const get=async route=>{
    const url=new URL(route,'https://unit.invalid/');
    if(route==='commits/main')return{sha:f.request.controlCommit};if(url.pathname==='/actions/runs/42')return structuredClone(f.run);
    if(url.pathname==='/actions/workflows/deploy.yml/runs')return {total_count:1,workflow_runs:[structuredClone(previous)]};
    if(url.pathname==='/actions/runs/8')return structuredClone(previous);
    if(url.pathname==='/actions/runs/8/jobs')return{total_count:1,jobs:[{id:80,run_id:8,run_attempt:1,head_sha:control,name:'deploy',status:'completed',conclusion:'success',started_at:'2026-01-01T00:00:00Z',completed_at:'2026-01-01T00:01:00Z'}]};
    if(url.pathname==='/actions/runs/8/artifacts')return{total_count:1,artifacts:[{id:800,name:'deployed-release',expired:false,size_in_bytes:100,created_at:'2026-01-01T00:00:30Z',expires_at:'2099-01-01T00:00:00Z',workflow_run:{id:8,head_sha:control}}]};
    throw Error('Unexpected synthetic API route');
  };
  const latest=await selectLatestDeployedRun(get,{repository}),receipt={schemaVersion:1,status:'succeeded',releaseId:manifest.releaseId,releaseCommit:manifest.releaseCommit,controlCommit:control,manifestHash:evidenceHash(manifest)};
  return{...f,manifest,receipt,latest,get};
}

test('manual preparation preserves the latest installed manifest and separates source from workflow control',async t=>{
  const f=await fixture(t),input=await prepareRetirementRecord(f);validateRetirementRecordInput(input);
  assert.equal(input.sourceCommit,f.manifest.releaseCommit);assert.notEqual(input.sourceCommit,f.request.controlCommit);
  assert.equal(input.expectedManifestHash,evidenceHash(f.manifest));assert.equal(input.operationId,f.operationId);
});

test('changed deployment, corrupted receipt and moved main refuse preparation',async t=>{
  for(const change of [f=>f.latest.runAttempt++,f=>f.receipt.manifestHash='sha256:'+'f'.repeat(64),f=>{const get=f.get;f.get=r=>r==='commits/main'?Promise.resolve({sha:'e'.repeat(40)}):get(r);}]){
    const f=await fixture(t);change(f);await assert.rejects(prepareRetirementRecord(f));
  }
});

test('the public record input cannot carry extra/private fields or path injection',()=>{
  const input={schemaVersion:1,kind:'record-retirement-input',operationId:'retirement302-fixture',sourceCommit:'a'.repeat(40),expectedManifestHash:'sha256:'+'b'.repeat(64)};
  for(const change of [{kind:'candidate'},{operationId:'../outside'},{sourceCommit:'main'},{expectedManifestHash:'unknown'},{private:'PRIVATE_CANARY'}])assert.throws(()=>validateRetirementRecordInput({...input,...change}));
});
