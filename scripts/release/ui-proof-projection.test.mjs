import test from 'node:test';import assert from 'node:assert/strict';
import {createUIProofProjection,assertUIProofProjection} from './ui-proof-projection.mjs';
import {uiFixture} from './ui-release-unit-fixture.mjs';
import {safeExecutionEnvironment} from './ui-execution-profile.mjs';
test('public original anchor projection rejects stale attempts, paths and source substitution',()=>{
  const f=uiFixture(),manifest=f.manifest,run={id:57,runAttempt:2,controlCommit:'a'.repeat(40)};
  const document={kind:'protected-full-ui-anchor',status:'captured-after-success',binding:f.planning.input.fullAnchor,
    anchor:f.originalAnchor,observedAt:'2026-10-06T00:00:00.000Z',executionProfile:{schemaVersion:1,...Object.fromEntries(['backend','rulesWorker'].map(component=>[component,{instance:{releaseId:manifest.releaseId,releaseCommit:manifest.releaseCommit},environment:safeExecutionEnvironment(component,[])}]))}};
  const p=createUIProofProjection(document,{manifest,run});assert.equal(assertUIProofProjection(p,{manifest,run}),p);
  for(const patch of [{runAttempt:1},{sourceCommit:'c'.repeat(40)},{privatePath:'/secret'},{originalObservedAt:'2020-01-01T00:00:00Z'}])assert.throws(()=>assertUIProofProjection({...p,...patch},{manifest,run}));
  assert.equal(JSON.stringify(p).includes('/secret'),false);
  assert.deepEqual(p.executionProfile,document.executionProfile);
  for(const mutate of [v=>{v.executionProfile.backend.environment.DATABASE_URL='private';},v=>{v.executionProfile.backend.instance.extra='private';},v=>{delete v.executionProfile;}]){const broken=structuredClone(p);mutate(broken);assert.throws(()=>assertUIProofProjection(broken,{manifest,run}));}
});
