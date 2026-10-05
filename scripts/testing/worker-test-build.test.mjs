import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,rm} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {workerTestBuild} from './worker-test-build.mjs';
import {runsRoot,repositoryRoot} from './runtime.mjs';
import {assertOwnedPath} from './guards.mjs';
test('worker tests use only their ready owned distribution when isolated',async()=>{
  const runId=`test_${randomBytes(12).toString('hex')}`,directory=assertOwnedPath(runsRoot,path.join(runsRoot,runId)),build=path.join(directory,'worker-build');
  await mkdir(build,{recursive:true});
  const registry={runId,directory,status:'ready'};
  const save=()=>writeFile(path.join(directory,'registry.json'),JSON.stringify(registry));await save();
  const env={TEST_WORKER_BUILD_DIRECTORY:build,TEST_RUN_ID:runId,TEST_RUN_DIRECTORY:directory};
  try{
    assert.equal(path.resolve(fileURLToPath(workerTestBuild(env))),build);
    assert.equal(path.resolve(fileURLToPath(workerTestBuild({}))),path.join(repositoryRoot,'frontend/worker/dist'));
    for(const change of [{TEST_RUN_ID:'foreign'},{TEST_WORKER_BUILD_DIRECTORY:path.join(repositoryRoot,'frontend/worker/dist')},{TEST_RUN_DIRECTORY:repositoryRoot}])assert.throws(()=>workerTestBuild({...env,...change}));
    registry.status='stopped';await save();assert.throws(()=>workerTestBuild(env));
  }finally{assertOwnedPath(runsRoot,directory);await rm(directory,{recursive:true,force:true});}
});
