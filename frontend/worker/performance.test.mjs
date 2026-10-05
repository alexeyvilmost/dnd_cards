import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createRulesWorker} from './server.mjs';

test('opt-in wrapper measurements preserve artifact response and correlation without private data',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'rules-performance-'));
  const artifactFile=path.join(directory,'current.cjs');
  await writeFile(artifactFile,"exports.executeRoguelikeCampRest=async()=>({status:'ready',patch:{runtime_revision:2}});");
  const token='local-performance-token-with-32-characters';
  const server=await createRulesWorker({artifactFile,artifactsDirectory:path.join(directory,'artifacts'),token,performanceEnabled:true});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const post=enabled=>fetch(`http://127.0.0.1:${server.address().port}/rest`,{method:'POST',headers:{authorization:`Bearer ${token}`,'x-request-id':'perf-test-1',...(enabled?{'x-performance-trace':'1'}:{})},body:JSON.stringify({input:{private:'secret-entropy-token'}})});
    const normal=await post(false),measured=await post(true);
    assert.deepEqual(await measured.json(),await normal.json());
    assert.equal(normal.headers.get('x-rules-performance'),null);
    assert.equal(measured.headers.get('x-request-id'),'perf-test-1');
    const raw=measured.headers.get('x-rules-performance');assert.ok(!raw.includes('secret'));
    const metrics=JSON.parse(raw);
    for(const value of Object.values(metrics)) assert.ok(Number.isFinite(value)&&value>=0);
    assert.ok(metrics.worker_request_bytes>0&&metrics.worker_response_bytes>0);
    assert.equal(metrics.worker_artifact_cache_hit,1);
    assert.ok(!('worker_queue_ms' in metrics));
  } finally {
    await new Promise(resolve=>server.close(resolve));
    assert.equal(path.dirname(path.resolve(directory)),path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('rules-performance-'));
    await rm(directory,{recursive:true,force:true});
  }
});
