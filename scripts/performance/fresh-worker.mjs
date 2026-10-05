// One fresh child per protocol/artifact. Caller supplies only an owned synthetic fixture.
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {copyFile,mkdir,readFile} from 'node:fs/promises';
import {performance,monitorEventLoopDelay} from 'node:perf_hooks';
import {isDeepStrictEqual} from 'node:util';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRulesWorker,snapshotHash} from '../../frontend/worker/server.mjs';
import {expandWorkerMirrors,MIRROR_WIRE} from '../../frontend/worker/mirrors.mjs';
import {assertRealOwnedPath,assertRunId,localFetch} from '../testing/guards.mjs';
import {cleanEnvironment,runsRoot} from '../testing/runtime.mjs';

const memory=()=>{const row=process.memoryUsage();return {rssBytes:row.rss,heapUsedBytes:row.heapUsed,heapTotalBytes:row.heapTotal,externalBytes:row.external,arrayBuffersBytes:row.arrayBuffers};};
const maximum=(left,right)=>Object.fromEntries(Object.keys(left).map(key=>[key,Math.max(left[key],right[key])]));

async function childMain(){
  let server,timer,window,active=0;
  const lag=monitorEventLoopDelay({resolution:10});
  process.on('message',async message=>{
    try{
      let result;
      if(message.type==='init'){
        assert.ok(!server);assertRunId(message.runId);
        const directory=await assertRealOwnedPath(runsRoot,message.directory);
        assert.equal(path.basename(directory),message.runId);
        const artifactFile=await assertRealOwnedPath(runsRoot,message.artifactFile);
        const artifactsDirectory=await assertRealOwnedPath(directory,message.artifactsDirectory);
        server=await createRulesWorker({artifactFile,artifactsDirectory,token:message.token,performanceEnabled:true,...(message.maxCachedArtifacts===undefined?{}:{maxCachedArtifacts:message.maxCachedArtifacts})});
        server.requestTimeout=30000;server.headersTimeout=10000;
        // Count the exact observable callback boundary, never a socket/kernel queue.
        // No request body listener is attached: it could change streaming semantics.
        server.prependListener('request',(request,response)=>{
          active++;
          if(window){window.callbacksEntered++;window.callbackActivePeak=Math.max(window.callbackActivePeak,active);window.observedPeak=maximum(window.observedPeak,memory());}
          const owner=window;let done=false;
          const finish=()=>{if(done)return;done=true;active--;if(owner){owner.callbacksClosed++;owner.responseCodes[response.statusCode]=(owner.responseCodes[response.statusCode]??0)+1;owner.observedPeak=maximum(owner.observedPeak,memory());}};
          response.once('finish',finish);response.once('close',finish);
        });
        await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
        result={origin:`http://127.0.0.1:${server.address().port}`,pid:process.pid,runtime:{node:process.version,platform:process.platform,arch:process.arch}};
      }else if(message.type==='start'){
        assert.ok(server);assert.equal(active,0);assert.ok(!window);
        lag.reset();lag.enable();
        const before=memory();window={before,observedPeak:before,callbacksEntered:0,callbacksClosed:0,callbackActivePeak:0,responseCodes:{},started:performance.now(),cpu:process.cpuUsage(),elu:performance.eventLoopUtilization(),maxRSSLifetimeBeforeBytes:process.resourceUsage().maxRSS*1024};
        timer=setInterval(()=>{if(window)window.observedPeak=maximum(window.observedPeak,memory());},5);
        result={started:true};
      }else if(message.type==='finish'){
        assert.ok(window);assert.equal(active,0);
        // Let the delayed histogram tick run after synchronous executor work.
        // This explicit drain is included in windowDurationMs, never in HTTP latency.
        await new Promise(resolve=>setTimeout(resolve,60));
        clearInterval(timer);lag.disable();const cpu=process.cpuUsage(window.cpu),after=memory();
        result={windowDurationMs:performance.now()-window.started,histogramDrainMs:60,
          processWindowCPUms:(cpu.user+cpu.system)/1000,eventLoopUtilization:performance.eventLoopUtilization(window.elu),
          eventLoopDelay:{resolutionMs:10,samples:Number(lag.count),meanMs:Number.isFinite(lag.mean)?lag.mean/1e6:null,p50Ms:lag.percentile(50)/1e6,p95Ms:lag.percentile(95)/1e6,maxMs:lag.max/1e6},
          before:window.before,after,observedPeak:maximum(window.observedPeak,after),
          maxRSSLifetimeBeforeBytes:window.maxRSSLifetimeBeforeBytes,maxRSSLifetimeAfterBytes:process.resourceUsage().maxRSS*1024,
          handlerBoundary:{callbacksEntered:window.callbacksEntered,callbacksClosed:window.callbacksClosed,callbackActivePeak:window.callbackActivePeak,activeAtFinish:active,responseCodes:window.responseCodes},
          admission:{mode:'existing-wrapper-no-explicit-admission-limit',enforcedGlobalLimit:null,queueTimeMeasured:false}};
        window=null;
      }else if(message.type==='close'){
        clearInterval(timer);lag.disable();
        if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
        process.send?.({id:message.id,result:{closed:true}},()=>process.disconnect());return;
      }else throw Error('Unknown probe command');
      process.send?.({id:message.id,result});
    }catch{process.send?.({id:message.id,error:'owned_worker_probe_failed'});}
  });
  process.on('disconnect',()=>{clearInterval(timer);lag.disable();server?.closeAllConnections();server?.close();});
}

/** Does not create a DB, mutate a fixture or log private input/result.
 * Reuse the canonical profile-worker fixture driver for committed commands/retries. */
export async function profileFreshProtocol({stack,body,expected,artifactFile,protocol=MIRROR_WIRE,rounds=10,evictingArtifactFiles=[]}){
  assert.ok(['full',MIRROR_WIRE].includes(protocol));assert.ok(Number.isSafeInteger(rounds)&&rounds>=1&&rounds<=30);
  assertRunId(stack.registry.runId);const directory=await assertRealOwnedPath(runsRoot,stack.registry.directory);
  artifactFile=await assertRealOwnedPath(runsRoot,artifactFile);
  const artifactHash=`sha256:${createHash('sha256').update(await readFile(artifactFile)).digest('hex')}`;
  assert.equal(body.artifactHash,artifactHash);assert.equal(body.envelope.artifactHash,artifactHash);
  const artifactsDirectory=path.join(directory,`worker-probe-${randomUUID()}`);await mkdir(artifactsDirectory);
  const evictingHashes=[];
  for(const input of evictingArtifactFiles){const file=await assertRealOwnedPath(runsRoot,input),hash=`sha256:${createHash('sha256').update(await readFile(file)).digest('hex')}`;assert.notEqual(hash,artifactHash);assert.equal(path.basename(file),`${hash.slice(7)}.cjs`);await copyFile(file,path.join(artifactsDirectory,path.basename(file)),1);evictingHashes.push(hash);}
  const token=randomBytes(32).toString('hex');
  const child=fork(fileURLToPath(import.meta.url),['--child'],{execArgv:[],env:cleanEnvironment(),windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});
  let nextId=0;const pending=new Map();
  child.on('message',message=>{const row=pending.get(message.id);if(!row)return;clearTimeout(row.timer);pending.delete(message.id);if(message.error)row.reject(Error(message.error));else row.resolve(message.result);});
  const failAll=()=>{for(const row of pending.values()){clearTimeout(row.timer);row.reject(Error('owned_worker_probe_exited'));}pending.clear();};
  child.on('exit',failAll);child.on('error',failAll);
  function rpc(type,fields={}){return new Promise((resolve,reject)=>{const id=++nextId;const timer=setTimeout(()=>{pending.delete(id);reject(Error('owned_worker_probe_timeout'));},30000);pending.set(id,{resolve,reject,timer});child.send({id,type,...fields},error=>{if(error){clearTimeout(timer);pending.delete(id);reject(Error('owned_worker_probe_ipc_failed'));}});});}
  const abort=()=>child.kill();stack.signal?.addEventListener('abort',abort,{once:true});
  const serialized=JSON.stringify(body),inputHash=snapshotHash(body),resultHash=snapshotHash(expected);
  try{
    const {origin,runtime}=await rpc('init',{runId:stack.registry.runId,directory,artifactFile,artifactsDirectory,token,...(evictingHashes.length?{maxCachedArtifacts:1}:{})});
    async function transition(){
      const start=performance.now();
      const timeout=AbortSignal.timeout(30000);
      const response=await localFetch(origin,'/transition',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json','x-performance-trace':'1','x-request-id':randomUUID(),...(protocol===MIRROR_WIRE?{'x-rules-wire':MIRROR_WIRE}:{})},body:serialized,signal:stack.signal?AbortSignal.any([stack.signal,timeout]):timeout});
      if(response.status!==200)throw Error(`owned_worker_probe_http_${response.status}`);
      const raw=await response.text(),wire=JSON.parse(raw),expanded=expandWorkerMirrors(wire);
      if(protocol===MIRROR_WIRE)assert.equal(wire.wireSchema,2);
      if(!isDeepStrictEqual(expanded,expected))throw Error('owned_worker_probe_full_result_mismatch');
      const metrics=JSON.parse(response.headers.get('x-rules-performance')??'{}');
      assert.ok([0,1].includes(metrics.worker_artifact_cache_hit));
      return {elapsedMs:performance.now()-start,responseBytes:Buffer.byteLength(raw),metrics};
    }
    await rpc('start');const cold=await transition();const coldWindow=await rpc('finish');
    assert.equal(cold.metrics.worker_artifact_cache_hit,0,'Cold means a genuinely unloaded CJS in this fresh process');
    let evictionProbe;
    if(evictingHashes.length){
      for(const hash of evictingHashes){const response=await localFetch(origin,'/transition',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({artifactHash:hash})});assert.equal(response.status,422);await response.arrayBuffer();}
      const reloaded=await transition();assert.equal(reloaded.metrics.worker_artifact_cache_hit,0);
      evictionProbe={evictingHashes,reloaded,fullResultEquality:true};
    }
    const loads=[];
    for(const concurrency of [1,4,16]){
      await rpc('start');const samples=[];
      for(let round=0;round<rounds;round++){
        const batch=await Promise.all(Array.from({length:concurrency},()=>transition()));
        for(const sample of batch)assert.equal(sample.metrics.worker_artifact_cache_hit,1);
        samples.push(...batch);
      }
      const window=await rpc('finish');assert.equal(window.handlerBoundary.callbacksEntered,samples.length);assert.equal(window.handlerBoundary.callbacksClosed,samples.length);
      loads.push({protocol,concurrency,rounds,requests:samples.length,samples,window});
    }
    assert.equal(snapshotHash(body),inputHash);
    return {runtime,artifactHash,protocol,requestBytes:Buffer.byteLength(serialized),inputHash,resultHash,cold,coldWindow,loads,...(evictionProbe?{evictionProbe}:{}),fullResultEquality:true,
      limits:['Private input/results remain only in memory.','Process maxRSS is lifetime high-water, not per-window heap.','Timer/response-boundary heap sampling can miss a synchronous executor peak.','No remote queue or admission timestamp is invented: only entered/closed Node callbacks are counted.','No process-kill transaction test, long-session growth proof or enforced admission limit is provided by this measurement helper.']};
  }finally{
    try{if(child.connected)await rpc('close');}finally{stack.signal?.removeEventListener('abort',abort);child.kill();}
  }
}

if(process.argv[2]==='--child')await childMain();
