import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {copyFile,mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {getHeapCodeStatistics} from 'node:v8';
import {createRulesWorker} from '../../frontend/worker/server.mjs';
import {assertRealOwnedPath,assertRunId,localFetch} from '../testing/guards.mjs';
import {cleanEnvironment,runsRoot} from '../testing/runtime.mjs';
import {startTestStack} from '../testing/stack.mjs';

const hash=bytes=>`sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const require=createRequire(import.meta.url);
async function retainedSample(){
  assert.equal(typeof global.gc,'function');
  // Forced collection is diagnostic only. Production never invokes GC.
  global.gc();await new Promise(resolve=>setTimeout(resolve,20));global.gc();
  const m=process.memoryUsage();return {rssBytes:m.rss,heapUsedBytes:m.heapUsed,heapTotalBytes:m.heapTotal,externalBytes:m.external,arrayBuffersBytes:m.arrayBuffers,maxRSSLifetimeBytes:process.resourceUsage().maxRSS*1024,v8CodeStatistics:getHeapCodeStatistics()};
}

async function retainedChild(){
  process.once('message',async input=>{
    let server;
    try{
      assertRunId(input.runId);const directory=await assertRealOwnedPath(runsRoot,input.directory);assert.equal(path.basename(directory),input.runId);
      const artifactDirectory=await assertRealOwnedPath(directory,input.artifactDirectory),files=[];
      for(const file of input.files){
        const filename=await assertRealOwnedPath(artifactDirectory,file),bytes=await readFile(filename),artifactHash=hash(bytes);
        assert.equal(path.basename(filename),`${artifactHash.slice(7)}.cjs`);files.push({filename,artifactHash,sourceBytes:bytes.length});
      }
      server=await createRulesWorker({artifactFile:files[0].filename,artifactsDirectory:artifactDirectory,token:input.token,performanceEnabled:true,...(input.maxCachedArtifacts===undefined?{}:{maxCachedArtifacts:input.maxCachedArtifacts})});
      await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
      const before=await retainedSample(),samples=[],loadedExports=new Map();
      for(const file of [...files,files[0]]){
        const response=await localFetch(origin,'/transition',{method:'POST',headers:{authorization:`Bearer ${input.token}`,'content-type':'application/json','x-performance-trace':'1'},body:JSON.stringify({artifactHash:file.artifactHash})});
        // Deliberately incomplete input loads the actual module then rejects.
        // This is a cache-retention probe, never a gameplay/replay assertion.
        assert.equal(response.status,422);await response.arrayBuffer();
        const metrics=JSON.parse(response.headers.get('x-rules-performance'));
        assert.ok([0,1].includes(metrics.worker_artifact_cache_hit));
        const module=require.cache[file.filename];if(module)loadedExports.set(file.artifactHash,new WeakRef(module.exports));
        samples.push({artifactHash:file.artifactHash,sourceBytes:file.sourceBytes,cacheHit:metrics.worker_artifact_cache_hit,loadMs:metrics.worker_artifact_load_ms,memory:await retainedSample(),loadedModuleCount:Object.keys(require.cache).filter(key=>path.dirname(key).toLowerCase()===artifactDirectory.toLowerCase()).length,liveExports:[...loadedExports.values()].filter(ref=>ref.deref()).length});
      }
      process.send({result:{runtime:{node:process.version,platform:process.platform,arch:process.arch},before,samples,uniqueArtifacts:files.length,
        configuredLimit:input.maxCachedArtifacts??'wrapper-default',forcedGC:true,limitations:['Actual immutable artifacts; invalid commands intentionally stop after load. No gameplay acceptance is claimed.','Forced GC isolates retained references; RSS is allocator high-water and need not shrink immediately.','This is bounded local history, not a production OOM prediction.']}});
    }catch{process.send({error:'retained_artifact_probe_failed'});}
    finally{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}process.disconnect();}
  });
}

export async function profileRetainedArtifacts(stack,{artifactFiles,maxCachedArtifacts}={}){
  assertRunId(stack.registry.runId);const directory=await assertRealOwnedPath(runsRoot,stack.registry.directory);
  assert.ok(artifactFiles.length>=2&&artifactFiles.length<=32);
  const artifactDirectory=path.join(directory,`retention-${randomUUID()}`);await mkdir(artifactDirectory);
  const files=[],unique=new Set();
  for(const artifact of artifactFiles){const file=await assertRealOwnedPath(runsRoot,artifact),bytes=await readFile(file),artifactHash=hash(bytes);assert.equal(path.basename(file),`${artifactHash.slice(7)}.cjs`);assert.ok(!unique.has(artifactHash));unique.add(artifactHash);const target=path.join(artifactDirectory,path.basename(file));await copyFile(file,target,1);files.push(target);}
  const child=fork(fileURLToPath(import.meta.url),['--child'],{execArgv:['--expose-gc'],env:cleanEnvironment(),windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});
  try{return await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('retained_artifact_probe_timeout')),60000);child.once('message',message=>{clearTimeout(timer);message.error?reject(Error(message.error)):resolve(message.result);});child.once('error',()=>{clearTimeout(timer);reject(Error('retained_artifact_probe_exited'));});child.once('exit',code=>{clearTimeout(timer);if(code)reject(Error('retained_artifact_probe_exited'));});child.send({runId:stack.registry.runId,directory,artifactDirectory,files,token:randomBytes(32).toString('hex'),maxCachedArtifacts});});}
  finally{child.kill();}
}

if(process.argv[2]==='--child')await retainedChild();
else if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const files=new Map();
  // Only existing owned synthetic run artifacts, not repository/production files.
  for(const run of await readdir(runsRoot)){if(!/^test_[a-f0-9]{24}$/.test(run))continue;const folder=path.join(runsRoot,run,'rules-artifacts');let names;try{names=await readdir(folder);}catch{continue;}for(const name of names)if(/^[a-f0-9]{64}\.cjs$/.test(name)&&!files.has(name))files.set(name,path.join(folder,name));}
  const stack=await startTestStack({profile:'integration',dbOnly:true});
  try{const artifactFiles=[...files.values()].slice(0,32);const result=process.argv.includes('--compare')?{retained:await profileRetainedArtifacts(stack,{artifactFiles,maxCachedArtifacts:64}),bounded:await profileRetainedArtifacts(stack,{artifactFiles,maxCachedArtifacts:4})}:await profileRetainedArtifacts(stack,{artifactFiles});await writeFile(path.join(stack.registry.directory,'artifact-retention.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({runId:stack.registry.runId,uniqueArtifacts:artifactFiles.length,comparison:process.argv.includes('--compare')}));}finally{await stack.cleanup();}
}
