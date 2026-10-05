import test from 'node:test';
import assert from 'node:assert/strict';
import {buildIdentity} from './write-build-identity.mjs';
import {inspectIdentity} from './ci-images.mjs';

const inputs={component:'frontend',sourceCommit:'a'.repeat(40),inputFingerprint:'sha256:'+'b'.repeat(64)};
test('frontend reader protocol is source-owned, detached and retains provenance requirements',()=>{
  const first=buildIdentity({...inputs,readerCapabilities:['forged-v99'],mediaEnvironment:{READER_CAPABILITIES:'forged-v99',IMAGE_JOBS_ENABLED:'0'}});
  assert.deepEqual(first.readerCapabilities,['image-job-v1']);
  assert.equal(first.provenance,'baked');
  assert.equal(first.sourceCommit,inputs.sourceCommit);
  assert.equal(first.inputFingerprint,inputs.inputFingerprint);
  first.readerCapabilities.push('mutated-response');
  assert.deepEqual(buildIdentity(inputs).readerCapabilities,['image-job-v1']);
  assert.equal(buildIdentity({component:'frontend'}).provenance,'unverified');
  assert.throws(()=>buildIdentity({component:'frontend',sourceCommit:inputs.sourceCommit}),/Both component identities/);
  assert.equal(buildIdentity({component:'rulesWorker',artifact:Buffer.from('fixture')}).readerCapabilities,undefined,'worker does not own persisted receipt or image-job readers');
});

test('image identity probe retains extra baked reader metadata without enabling writers',()=>{
  const identity={...buildIdentity(inputs),releaseCommit:inputs.sourceCommit,releaseId:'reader-metadata-fixture'};
  let args;
  const actual=inspectIdentity('example.invalid/frontend@sha256:'+'c'.repeat(64),{candidate:inputs.sourceCommit,releaseId:identity.releaseId},{name:'frontend'},{command:command=>{args=command;return JSON.stringify(identity);}});
  assert.deepEqual(actual.readerCapabilities,['image-job-v1']);
  assert.ok(!args.some(arg=>/^(?:IMAGE_JOBS_ENABLED|DB_COMPACT_RECEIPTS)=/.test(arg)));
});
