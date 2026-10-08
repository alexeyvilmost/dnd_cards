import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {performance} from 'node:perf_hooks';
import {createArtifactCache} from './server.mjs';

// Speculation computes the existing pure, pinned transition. No state is
// accepted, resource spent or entropy advanced until the actual command uses
// this exact input hash and intent. A restart/miss uses ordinary execution.
if(!isMainThread&&workerData?.combatSpeculation){
  const artifacts=createArtifactCache({artifactsDirectory:workerData.artifactsDirectory});
  parentPort.on('message',async job=>{
    try{const artifact=await artifacts.load(job.artifactHash),started=performance.now();
      const result=artifact.stepRoguelikeCombat(job.envelope,job.intent,job.artifactHash);
      parentPort.postMessage({key:job.key,result,executeMs:performance.now()-started});
    }catch{parentPort.postMessage({key:job.key,unavailable:true});}
  });
}

export function createSpeculativeTransitions({artifactsDirectory,maxResults=8,maxBytes=32*1024*1024}={}){
  const results=new Map(),queued=new Map(),waiters=new Map();let thread,busy,closed=false,bytes=0;
  const keyOf=(hash,intent)=>{
    if(typeof intent?.actorId!=='string')return undefined;
    if(intent.type==='end_turn'&&Object.keys(intent).length===2)return `${hash}:end_turn:${intent.actorId}`;
    if(intent.type==='death_save'&&['rolled','resolved'].includes(intent.phase)&&Object.keys(intent).length===3)return `${hash}:death_save:${intent.phase}:${intent.actorId}`;
    return undefined;
  };
  function fail(){thread=undefined;busy=undefined;queued.clear();for(const resolve of waiters.values())resolve(undefined);waiters.clear();}
  function pump(){
    if(closed||busy||!queued.size)return;
    if(!thread){thread=new Worker(new URL('./speculative-transitions.mjs',import.meta.url),{workerData:{combatSpeculation:true,artifactsDirectory}});const current=thread;current.unref();const onFailure=()=>{if(thread===current)fail();};current.on('error',onFailure);current.on('exit',onFailure);
      current.on('message',message=>{
        if(thread!==current||closed)return;
        if(message.result){const size=Buffer.byteLength(JSON.stringify(message.result));if(size<=maxBytes){const old=results.get(message.key);if(old)bytes-=old.size;results.set(message.key,{...message,size});bytes+=size;while(results.size>maxResults||bytes>maxBytes){const key=results.keys().next().value;bytes-=results.get(key).size;results.delete(key);}}}
        const resolve=waiters.get(message.key);waiters.delete(message.key);resolve?.(message.result?message:undefined);busy=undefined;pump();
      });
    }
    const [key,job]=queued.entries().next().value;queued.delete(key);busy=key;thread.postMessage(job);
  }
  return {
    schedule(hash,envelope){
      if(closed||!envelope)return;
      const state=envelope.state,pending=state?.pendingDeathSave;
      if(state?.outcome!=='active'&&pending?.phase!=='resolved')return;
      const scene=state.world?.scene,actorId=pending?.actorId??scene?.initiative?.[scene.activeIndex];
      if(typeof actorId!=='string'||!(state.controlledCharacterIds??[state.characterId]).includes(actorId))return;
      const intent=pending?{type:'death_save',actorId,phase:pending.phase}:{type:'end_turn',actorId},key=keyOf(hash,intent);
      if(!key)return;
      if(results.has(key)||queued.has(key)||busy===key)return;
      queued.set(key,{key,envelope,artifactHash:envelope.artifactHash,intent});
      while(queued.size>maxResults)queued.delete(queued.keys().next().value);pump();
    },
    async take(hash,intent){
      const key=keyOf(hash,intent);if(!key||closed)return undefined;
      if(results.has(key))return structuredClone(results.get(key));
      if(busy===key){return new Promise(resolve=>{
        // Multiple authenticated requests may ask for the same deterministic
        // frame. They share work; the API separately serializes acceptance.
        const prior=waiters.get(key);waiters.set(key,value=>{prior?.(value);resolve(value?structuredClone(value):undefined);});
      });}
      return undefined;
    },
    async close(){closed=true;const current=thread;thread=undefined;fail();results.clear();bytes=0;if(current)await current.terminate();},
  };
}
