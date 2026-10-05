import test from 'node:test';
import assert from 'node:assert/strict';
import {selectCISuite} from './ci-policy.mjs';

const plan=(files=[],extra={})=>({schema_version:1,baseline:{sha:'a'.repeat(40)},full_fallback:false,
  changed_files:files,reasons:files.map(path=>({path,rule:'frontend-ui',components:['frontend']})),components:{frontend:true,backend:false,worker:false,infrastructure:false},...extra});
test('automatic CI uses the release risk policy and missing baseline expands verification',()=>{
  assert.equal(selectCISuite(plan(['frontend/src/components/Library.tsx']),{eventName:'pull_request'}),'core');
  assert.equal(selectCISuite(plan(['frontend/src/components/Library.tsx']),{eventName:'push'}),'extended');
  assert.equal(selectCISuite(plan([],{full_fallback:true,baseline:{sha:null}}),{eventName:'push'}),'extended');
  assert.equal(selectCISuite(plan(['backend/migrations/300.go'],{components:{backend:true}}),{eventName:'pull_request'}),'extended');
  assert.equal(selectCISuite(plan(['frontend/src/rules/engine.ts'],{components:{worker:true}}),{eventName:'push'}),'extended');
});
test('manual diagnostics preserve the requested tier without granting release eligibility',()=>{
  for(const requestedSuite of ['core','extended','legacy-manual'])assert.equal(selectCISuite(plan([],{full_fallback:true}),{eventName:'workflow_dispatch',requestedSuite}),requestedSuite);
  assert.throws(()=>selectCISuite(plan(),{eventName:'workflow_dispatch',requestedSuite:'typo'}));
  assert.throws(()=>selectCISuite(plan(),{eventName:'unknown'}));
});
