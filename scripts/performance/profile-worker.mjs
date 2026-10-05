import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {createHash,randomUUID} from 'node:crypto';
import {startTestStack} from '../testing/stack.mjs';
import {localAcceptanceContext} from '../testing/acceptance-context.mjs';
import {localFetch,assertLocalOrigin,assertRealOwnedPath} from '../testing/guards.mjs';
import {runsRoot} from '../testing/runtime.mjs';
import {runRequiredGo} from '../testing/required-go.mjs';
import {createScenarioAPI,createRunFixture,assertSame,digest} from './scenarios.mjs';
import {snapshotHash} from '../../frontend/worker/server.mjs';
import {expandWorkerMirrors} from '../../frontend/worker/mirrors.mjs';
import {isDeepStrictEqual} from 'node:util';
import {Session} from 'node:inspector';
import {profileFreshProtocol} from './fresh-worker.mjs';

const require=createRequire(import.meta.url);
// Go encoding/json sorts map keys. Reproduce the exact request semantics before
// invoking the worker; do not reorder output arrays or normalize gameplay data.
const goMapOrder=value=>Array.isArray(value)?value.map(goMapOrder):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,goMapOrder(value[key])])):value;
const bytes=value=>Buffer.byteLength(JSON.stringify(value)??'');
const stats=values=>{const sorted=[...values].sort((a,b)=>a-b);return {count:sorted.length,mean:sorted.reduce((a,b)=>a+b,0)/sorted.length,p50:sorted[Math.ceil(sorted.length*.5)-1],p95:sorted[Math.ceil(sorted.length*.95)-1]};};
function measure(work,count){const times=[];for(let i=0;i<count;i++){const start=performance.now();work();times.push(performance.now()-start);}return stats(times);}
function composition(envelope){
  const state=envelope.state;
  const stateFields=Object.fromEntries(['world','catalogActions','actionPresentation','actorPresentation','log','battleMap','tokens','combatAreas','pendingD20Interrupt','pendingTriggeredAction'].map(key=>[key,bytes(state[key])]));
  const actors=Object.values(state.world.actors);
  return {envelopeBytes:bytes(envelope),stateBytes:bytes(state),stateFields,
    actorFields:Object.fromEntries(['character','runtime','passives','capabilities'].map(key=>[key,actors.reduce((sum,row)=>sum+bytes(row[key]),0)])),
    worldFields:Object.fromEntries(['actors','objects','scene','catalog','appliedCommandIds','pendingResolution'].map(key=>[key,bytes(state.world[key])])),
    actors:actors.length,actions:state.catalogActions.length,logEntries:state.log.length};
}
function differencePaths(left,right,prefix='',result=[]){
  if(isDeepStrictEqual(left,right)||result.length>=12)return result;
  if(left&&right&&typeof left==='object'&&typeof right==='object'){
    for(const key of new Set([...Object.keys(left),...Object.keys(right)]))differencePaths(left[key],right[key],`${prefix}/${/^[a-f0-9-]{36}$/i.test(key)?':id':key}`,result);
  }else {
    let detail='';if(typeof left==='string'&&typeof right==='string'){let index=0;while(index<Math.min(left.length,right.length)&&left[index]===right[index])index++;detail=`[lengths=${left.length}/${right.length},index=${index},codepoints=${left.codePointAt(index)}/${right.codePointAt(index)}]`;}
    result.push(prefix+detail);
  }
  return result;
}
async function cpuProfile(work){
  const session=new Session();session.connect();
  const post=(method,params={})=>new Promise((resolve,reject)=>session.post(method,params,(error,result)=>error?reject(error):resolve(result)));
  try{
    await post('Profiler.enable');await post('Profiler.start');for(let i=0;i<10;i++)work();
    const {profile}=await post('Profiler.stop');
    return {iterations:10,sampledDurationUs:profile.endTime-profile.startTime,sampleCount:profile.samples?.length??0,
      topFunctions:profile.nodes.filter(row=>row.hitCount>0).sort((a,b)=>b.hitCount-a.hitCount).slice(0,25).map(row=>({function:row.callFrame.functionName||'(anonymous)',file:path.basename(row.callFrame.url),line:row.callFrame.lineNumber+1,hits:row.hitCount}))};
  }finally{session.disconnect();}
}

/** All private envelopes stay in memory. Reports contain fixed field names,
 * sizes, timings and outcome hashes only. No seed, state, token or command body. */
export async function profileWorker(stack,{repetitions=30,concurrencyLevels=[1,4,16],mirrorComparison=false,baselineArtifact,freshCapacity=false,capacityRounds=10}={}){
  assert.ok(Number.isSafeInteger(repetitions)&&repetitions>=1&&repetitions<=100);
  const context=await localAcceptanceContext(stack.env),apiSamples=[],api=await createScenarioAPI(context,{onSample:sample=>apiSamples.push(sample)});
  context.readRunInvariant=async runId=>{assert.match(runId,/^[a-f0-9-]{36}$/i);return (await stack.database.query(`SELECT md5(combat_envelope::text) FROM roguelike_runs WHERE id='${runId}';`)).trim();};
  const readEnvelope=async runId=>{
    assert.match(runId,/^[a-f0-9-]{36}$/i);
    // ASCII framing keeps this diagnostic independent of terminal chunk/locale
    // decoding. Decoded private JSON is retained only in this process's memory.
    const encoded=await stack.database.query(`SELECT encode(convert_to(combat_envelope::text,'UTF8'),'base64') FROM roguelike_runs WHERE id='${runId}';`);
    return JSON.parse(Buffer.from(encoded,'base64').toString('utf8'));
  };
  const origin=assertLocalOrigin(stack.env.TEST_WORKER_ORIGIN);assert.equal(origin,stack.registry.origins.worker);
  const artifactFile=path.join(stack.registry.directory,'rules-artifacts',`${stack.registry.artifactHash.slice(7)}.cjs`);
  assert.equal(`sha256:${createHash('sha256').update(await readFile(artifactFile)).digest('hex')}`,stack.registry.artifactHash);
  const artifact=require(artifactFile),rows=[];
  let baseline,baselineHash;
  if(baselineArtifact){
    baselineArtifact=await assertRealOwnedPath(runsRoot,baselineArtifact);
    baselineHash=`sha256:${createHash('sha256').update(await readFile(baselineArtifact)).digest('hex')}`;
    assert.equal(path.basename(baselineArtifact),`${baselineHash.slice(7)}.cjs`);baseline=require(baselineArtifact);
    const retained=path.join(stack.registry.directory,'rules-artifacts',path.basename(baselineArtifact));
    await copyFile(baselineArtifact,retained,1); // Exclusive: never replace retained bytes.
  }
  for(const partySize of [1,2,6]){
    const fixture=await createRunFixture(context,{partySize,api});await fixture.command('start_encounter');await fixture.command('initialize_combat');
    assert.match(fixture.run.id,/^[a-f0-9-]{36}$/i);
    const envelope=goMapOrder(await readEnvelope(fixture.run.id));
    const state=envelope.state,actorId=state.world.scene.initiative[state.world.scene.activeIndex];
    assert.ok((fixture.run.characters??[fixture.run.character]).some(row=>row.id===actorId));
    const intent={type:'end_turn',actorId},body={artifactHash:envelope.artifactHash,envelope,intent,character:fixture.run.character,...(partySize>1?{characters:fixture.run.characters}:{})};
    const beforeHash=snapshotHash(body),serialized=JSON.stringify(body),samples=[];
    let expected;
    async function transition(mirrors=false){
      const start=performance.now(),response=await localFetch(origin,'/transition',{method:'POST',headers:{authorization:`Bearer ${stack.env.TEST_WORKER_TOKEN}`,'content-type':'application/json','x-performance-trace':'1','x-request-id':randomUUID(),...(mirrors?{'x-rules-wire':'mirrors-v2'}:{})},body:serialized});
      assert.equal(response.status,200,'Owned worker transition failed; private body omitted');
      const raw=await response.text(),wire=JSON.parse(raw),result=expandWorkerMirrors(wire),elapsed=performance.now()-start;
      if(mirrors)assert.equal(wire.wireSchema,2,'Fixture did not exercise compact transport');
      if(expected)assertSame(result,expected,'Repeated identical seeded worker input changed its full result');else expected=result;
      return {elapsed_ms:elapsed,response_bytes:Buffer.byteLength(raw),metrics:JSON.parse(response.headers.get('x-rules-performance')??'{}')};
    }
    const firstTransition=await transition();for(let i=0;i<repetitions;i++)samples.push(await transition());
    const mirrorSamples=[];if(mirrorComparison)for(let i=0;i<repetitions;i++)mirrorSamples.push(await transition(true));
    const direct=()=>artifact.stepRoguelikeCombat(envelope,intent,envelope.artifactHash);
    const directResult=direct(),projected=partySize>1?artifact.projectRoguelikePartyCombatPatch(directResult.envelope,body.characters):artifact.projectRoguelikeCombatPatch(directResult.envelope,body.character);
    assertSame(JSON.parse(JSON.stringify(projected.envelope)),expected.envelope,`Wrapper and direct canonical executor/projection disagree party=${partySize} paths=${differencePaths(JSON.parse(JSON.stringify(projected.envelope)),expected.envelope).join(',')}`);
    assertSame(directResult.randomValues,expected.randomValues,'Wrapper changed the recorded RNG sequence');
    const micro={parse:measure(()=>JSON.parse(serialized),repetitions),stringify:measure(()=>JSON.stringify(body),repetitions),
      structuredClone:measure(()=>structuredClone(envelope.state),repetitions),snapshotHash:measure(()=>snapshotHash(envelope),repetitions),executor:measure(direct,repetitions)};
    let differential,archivedBody,archivedExpected;
    if(baseline){
      // Pure execution comparison supplies the exact same artifact identity to
      // both module versions. It does not rewrite any stored encounter pin.
      const oldDirect=()=>baseline.stepRoguelikeCombat(envelope,intent,envelope.artifactHash);
      const oldTimes=[],newTimes=[];
      for(let i=0;i<repetitions;i++){
        const measureOne=(work,times)=>{const start=performance.now(),result=work();times.push(performance.now()-start);return JSON.parse(JSON.stringify(result));};
        let oldValue,newValue;
        if(i%2){oldValue=measureOne(oldDirect,oldTimes);newValue=measureOne(direct,newTimes);}else{newValue=measureOne(direct,newTimes);oldValue=measureOne(oldDirect,oldTimes);}
        assertSame(newValue,oldValue,'Light-source optimization changed full seeded executor result');
      }
      const oldEnvelope={...envelope,artifactHash:baselineHash};
      const response=await localFetch(origin,'/transition',{method:'POST',headers:{authorization:`Bearer ${stack.env.TEST_WORKER_TOKEN}`,'content-type':'application/json','x-rules-wire':'mirrors-v2'},
        body:JSON.stringify({...body,artifactHash:baselineHash,envelope:oldEnvelope})});
      assert.equal(response.status,200,'Archived pinned worker replay failed');
      const oldWireResult=expandWorkerMirrors(await response.json()),expectedArchived=structuredClone(expected);
      expectedArchived.envelope.artifactHash=baselineHash;
      expectedArchived.trace.beforeHash=snapshotHash(oldEnvelope);expectedArchived.trace.afterHash=snapshotHash(expectedArchived.envelope);
      assertSame(oldWireResult,expectedArchived,'Archived artifact changed gameplay, entropy, mirrors or trace identities');
      archivedBody={...body,artifactHash:baselineHash,envelope:oldEnvelope};archivedExpected=expectedArchived;
      differential={baselineArtifact:baselineHash,currentArtifact:envelope.artifactHash,identicalInputFullOutcome:true,archivedPinnedReplay:true,
        oldTimesMs:oldTimes,newTimesMs:newTimes,old:stats(oldTimes),new:stats(newTimes)};
    }
    const loads=[];
    for(const concurrency of concurrencyLevels){assert.ok([1,4,16].includes(concurrency));const start=performance.now();const results=await Promise.all(Array.from({length:concurrency},()=>transition(mirrorComparison)));loads.push({protocol:mirrorComparison?'mirrors-v2':'full',concurrency,total_ms:performance.now()-start,latency:stats(results.map(row=>row.elapsed_ms)),fullResultEqual:true});}
    const freshProfiles=[];
    if(freshCapacity){
      for(const protocol of ['full','mirrors-v2'])freshProfiles.push(await profileFreshProtocol({stack,body,expected,artifactFile,protocol,rounds:capacityRounds,evictingArtifactFiles:baselineArtifact?[baselineArtifact]:[]}));
      if(archivedBody)freshProfiles.push(await profileFreshProtocol({stack,body:archivedBody,expected:archivedExpected,artifactFile:baselineArtifact,protocol:'mirrors-v2',rounds:capacityRounds,evictingArtifactFiles:[artifactFile]}));
    }
    assert.equal(snapshotHash(body),beforeHash,'Profiling mutated the input envelope/entropy');
    const committed=await fixture.command('combat_intent',{intent},{scenario:`worker_profile_commit_party_${partySize}`});
    if(mirrorComparison){assert.ok(apiSamples.at(-1).phases.backend_worker_mirror_expand_ms>0,'Enable workerMirrors and performance on the shared stack to verify actual Go expansion');}
    assertSame(committed.result.run.combat_state,expected.envelope.state,`Direct worker output differs from committed API command party=${partySize} paths=${differencePaths(committed.result.run.combat_state,expected.envelope.state).join(',')}`);
    assertSame(await readEnvelope(fixture.run.id),expected.envelope,'Committed private envelope differs from exact worker result');
    for(const [id,patch] of Object.entries(expected.patches??{[expected.envelope.state.characterId]:expected.patch})){
      const character=(committed.result.run.characters??[committed.result.run.character]).find(row=>row.id===id);assert.ok(character);
      for(const [key,value] of Object.entries(patch))assertSame(character[key],value,`Committed character mirror differs at ${key}`);
    }
    rows.push({partySize,input:composition(envelope),requestBytes:Buffer.byteLength(serialized),resultBytes:bytes(expected),
      mirrors:{leaderPatch:expected.patches?isDeepStrictEqual(expected.patch,expected.patches[expected.envelope.state.characterId]):false,
        patchState:isDeepStrictEqual(expected.patch?.turn_state?.solo_combat_v1,expected.envelope.state),
        stateDifferencePaths:differencePaths(expected.patch?.turn_state?.solo_combat_v1,expected.envelope.state),
        snapshotBytes:bytes(expected.patch?.turn_state?.solo_combat_v1),leaderInput:body.characters?isDeepStrictEqual(body.character,body.characters[0]):false},
      resultFields:Object.fromEntries(['envelope','patch','patches','previousPatch','combatOpeningState','trace','randomValues'].map(key=>[key,bytes(expected[key])])),
      artifactHash:envelope.artifactHash,inputHash:beforeHash,resultHash:digest(expected),firstTransition,samples,mirrorSamples,micro,loads,freshProfiles,differential,...(partySize===6?{cpuProfile:await cpuProfile(direct)}:{}),source:await fixture.verify()});
  }
  const report={runId:stack.registry.runId,fixture:stack.registry.fixture,artifactHash:stack.registry.artifactHash,repetitions,rows,apiSamples,
    limitations:['Local synthetic fighters; not a production p95 SLA.','Concurrent worker process CPU deltas overlap and are not exclusive request CPU.','Microbench phases are independent probes and cannot be added as a breakdown of executor time.','Identical seeded requests are read-only worker probes; committed API commands and retries are counted separately.']};
  const output=path.join(stack.registry.directory,'worker-profile');await mkdir(output,{recursive:true});await writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2));
  return {runId:stack.registry.runId,artifactHash:report.artifactHash,scenarios:rows.length,fullResultEquality:true,sourceUnchanged:true};
}
export async function checkWorkerMirrors(stack){
  const native=await runRequiredGo(stack,{tests:['TestWorkerMirrorsExactRestorationAndFailClosed','TestWorkerMirrorsClientNegotiationAndLegacyFallback']});
  return {native,flow:await profileWorker(stack,{repetitions:1,concurrencyLevels:[1,4,16],mirrorComparison:true})};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const mirrors=process.argv.includes('--mirrors'),stack=await startTestStack({profile:'integration',reuseBuild:true,performance:true,workerMirrors:mirrors});
  try{console.log(JSON.stringify(await profileWorker(stack,{repetitions:process.argv.includes('--smoke')?1:30,mirrorComparison:mirrors,freshCapacity:process.argv.includes('--capacity'),capacityRounds:process.argv.includes('--smoke')?1:10,baselineArtifact:process.argv.find(arg=>arg.startsWith('--baseline-artifact='))?.slice('--baseline-artifact='.length)})));}finally{await stack.cleanup();}
}
