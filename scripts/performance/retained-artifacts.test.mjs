import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,rm} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import path from 'node:path';
import {profileRetainedArtifacts} from './retained-artifacts.mjs';
import {runsRoot} from '../testing/runtime.mjs';
import {assertRealOwnedPath} from '../testing/guards.mjs';

test('retention probe distinguishes loaded modules from heap and verifies reloading after eviction',async()=>{
  const runId=`test_${randomBytes(12).toString('hex')}`,directory=path.join(runsRoot,runId);await mkdir(directory);const files=[];
  try{
    for(const version of [1,2,3]){const source=`exports.stepRoguelikeCombat=()=>{throw Error('private-probe-marker-${version}')};`,hash=createHash('sha256').update(source).digest('hex'),file=path.join(directory,`${hash}.cjs`);await writeFile(file,source);files.push(file);}
    const report=await profileRetainedArtifacts({registry:{runId,directory}},{artifactFiles:files,maxCachedArtifacts:2});
    assert.equal(report.uniqueArtifacts,3);assert.deepEqual(report.samples.map(row=>row.loadedModuleCount),[1,2,2,2]);assert.equal(report.samples.at(-1).cacheHit,0);
    assert.ok(report.samples.every(row=>row.liveExports<=2));assert.ok(report.samples.every(row=>row.memory.rssBytes>0&&row.memory.heapUsedBytes>0));assert.equal(report.forcedGC,true);
    assert.ok(!JSON.stringify(report).includes('private-probe-marker'));
    await assert.rejects(profileRetainedArtifacts({registry:{runId,directory}},{artifactFiles:[files[0],files[0]]}));
  }finally{await assertRealOwnedPath(runsRoot,directory);assert.equal(path.basename(directory),runId);await rm(directory,{recursive:true,force:true});}
});
