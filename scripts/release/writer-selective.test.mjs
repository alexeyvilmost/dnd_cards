// Unit-only integration observations. These are not hosted or OCI evidence.
import test from 'node:test';import assert from 'node:assert/strict';
import {writerPolicyFields,writerPolicy,evidenceHash,rehearsalStages,validateWriterTransition} from './validate-manifest.mjs';
import {candidateWriterPolicyFields,classifyReleaseVerification,runtimeCompatibilityHash} from './ui-release-policy.mjs';
import {uiFixture} from './ui-release-unit-fixture.mjs';
const off={compactReceipts:false,imageJobs:false,frozenCatalogs:false},on={...off,compactReceipts:true,imageJobs:true};
test('one canonical optional policy projection preserves absent bytes and explicit persisted-format lineage',()=>{
 assert.deepEqual(writerPolicyFields({},{}),{});
 assert.deepEqual(writerPolicyFields({},{writerPolicy:off}),{writerPolicy:off});
 const next=writerPolicyFields({writerPolicy:on},{});assert.deepEqual(next,{writerPolicy:off});
 assert.deepEqual(candidateWriterPolicyFields({writerPolicy:on},{}),next);
 assert.equal(rehearsalStages({}).length,8);assert.equal(rehearsalStages(next).length,9);
 assert.throws(()=>validateWriterTransition({}, {writerPolicy:on}),/cannot disappear/);
 for(const policy of [null,{...off,frozenCatalogs:true},{...off,private:'value'}])assert.throws(()=>writerPolicyFields({},{writerPolicy:policy}));
 next.writerPolicy.imageJobs=true;assert.deepEqual(writerPolicy({}),off);
});
test('unchanged explicit policy can use a UI proof; any policy introduction/removal/value change requires full verification',()=>{
 for(const policy of [off,on]){
  const {input}=uiFixture().planning;input.previousManifest.writerPolicy=structuredClone(policy);input.candidateManifest.writerPolicy=structuredClone(policy);
  input.baselineBinding.manifestHash=evidenceHash(input.previousManifest);
  input.fullAnchor.manifestHash=evidenceHash(input.previousManifest);
  input.fullAnchor.runtimeCompatibilityHash=runtimeCompatibilityHash(input.previousManifest,input.previousDomain);
  assert.equal(classifyReleaseVerification(input).kind,'frontend-only');
  const missing=structuredClone(input);delete missing.candidateManifest.writerPolicy;assert.equal(classifyReleaseVerification(missing).kind,'full');
  const changed=structuredClone(input);changed.candidateManifest.writerPolicy=policy===off?on:off;assert.equal(classifyReleaseVerification(changed).kind,'full');
 }
 const {input}=uiFixture().planning;input.candidateManifest.writerPolicy=off;assert.equal(classifyReleaseVerification(input).kind,'full');
});
