import{test}from'node:test';import assert from'node:assert/strict';import{discoverWriterFixture,activeForWriterFixture,readWriterPredecessor,createWriterGithubReader,writerMetadataDiagnostic}from'./writer-fixture-cli.mjs';import{pair}from'./writer-policy-unit-fixture.mjs';import{evidenceHash}from'./validate-manifest.mjs';
import{mkdirSync,writeFileSync}from'node:fs';import path from'node:path';
import{retirementRecordUnitFixture}from'./retirement-record-unit-fixture.mjs';
import{projectRetirementObservation,retirementBaselineReceipt}from'./retirement-projection.mjs';
function fixture(){const{candidate:manifest,active}=pair(),environment={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'owner/project',GITHUB_REF:'refs/heads/main',GITHUB_WORKFLOW_REF:'owner/project/.github/workflows/release.yml@refs/heads/main',GITHUB_SHA:'c'.repeat(40),GITHUB_RUN_ID:'99',GITHUB_RUN_ATTEMPT:'1'},candidate={manifest,provenance:{schemaVersion:1,releaseRunId:99,controlCommit:environment.GITHUB_SHA,sourceCommit:manifest.releaseCommit,manifestHash:evidenceHash(manifest),planHash:'sha256:'+'d'.repeat(64)}};
const predecessor={id:8,runAttempt:2,artifactId:80,repository:'owner/project',controlCommit:'f'.repeat(40)},discovery={schemaVersion:1,required:true,candidateHash:evidenceHash(candidate),predecessor},deployment={schemaVersion:1,status:'succeeded',releaseId:active.manifest.releaseId,releaseCommit:active.manifest.releaseCommit,controlCommit:predecessor.controlCommit,manifestHash:evidenceHash(active.manifest)};
const document={schemaVersion:1,kind:'recorded-active-deployment',status:'succeeded',scope:'recorded-active-only',deployment:{repository:predecessor.repository,runId:predecessor.id,runAttempt:predecessor.runAttempt,controlCommit:predecessor.controlCommit,sourceCommit:active.manifest.releaseCommit},manifestHash:evidenceHash(active.manifest),activeHash:evidenceHash(active),operationHash:'sha256:'+'1'.repeat(64),active},projection={...document,projectionHash:evidenceHash(document)};return{candidate,environment,discovery,manifest:active.manifest,deployment,projection};}
test('absent-policy first release remains unchanged and never invents an active predecessor',async()=>{const f=fixture();delete f.candidate.manifest.writerPolicy;f.candidate.provenance.manifestHash=evidenceHash(f.candidate.manifest);const before=evidenceHash(f.candidate);const result=await discoverWriterFixture(f.candidate,{environment:f.environment,get:()=>{throw Error('must not call');}});assert.equal(result.required,false);assert.equal(evidenceHash(f.candidate),before);});
test('canonical recorded active preserves distinct component launches without reconstruction',()=>{const f=fixture(),active=activeForWriterFixture(f);assert.equal(active.instances.frontend.releaseId,'older-ui');assert.deepEqual(active,f.projection.active);});
test('self-rehash cannot bless wrong workflow attempt/source/control or another predecessor',()=>{for(const change of[f=>f.projection.deployment.runAttempt++,f=>f.projection.deployment.controlCommit='0'.repeat(40),f=>f.projection.deployment.sourceCommit='0'.repeat(40),f=>f.deployment.status='failed',f=>f.discovery.candidateHash='sha256:'+'0'.repeat(64),f=>f.candidate.manifest.previousReleaseId='other']){const f=fixture();change(f);const{projectionHash,...body}=f.projection;f.projection.projectionHash=evidenceHash(body);assert.throws(()=>activeForWriterFixture(f));}});
function retirementPredecessor(t){
 const f=retirementRecordUnitFixture(t),active=f.store.active(),operation=f.store.operation(f.operationId);
 const retirementObservation=projectRetirementObservation({store:f.store,operation,manifest:active.manifest,request:f.request});
 const candidate={manifest:{...structuredClone(active.manifest),releaseId:'next-writer',previousReleaseId:active.manifest.releaseId,migrationSet:structuredClone(active.database.migrationSet)}};
 const predecessor={repository:f.request.repository,id:f.request.runId,runAttempt:f.request.attempt,controlCommit:f.request.controlCommit};
 return{root:f.root,candidate,discovery:{schemaVersion:1,required:true,candidateHash:evidenceHash(candidate),predecessor},manifest:active.manifest,deployment:retirementBaselineReceipt(retirementObservation),retirementObservation};
}
test('recorded retirement predecessor preserves actual database and component launches',t=>{
 const f=retirementPredecessor(t),active=activeForWriterFixture(f);assert.deepEqual(active,f.retirementObservation.active);
 assert.notDeepEqual(active.database.migrationSet,active.manifest.migrationSet);active.instances.frontend.releaseId='caller-mutated';assert.notEqual(f.retirementObservation.active.instances.frontend.releaseId,'caller-mutated');
});
test('retirement artifacts load without inventing the absent ordinary deployment projection',async t=>{
 const f=retirementPredecessor(t),directory=path.join(f.root,'published');mkdirSync(directory,{mode:0o700});
 for(const [name,value]of [['manifest.json',f.manifest],['deployment.json',f.deployment],['retirement-observation.json',f.retirementObservation]])writeFileSync(path.join(directory,name),JSON.stringify(value));
 const actual=await readWriterPredecessor(directory);assert.equal(actual.projection,undefined);assert.deepEqual(activeForWriterFixture({...f,...actual}),f.retirementObservation.active);
});
test('ordinary predecessor still loads its exact mixed deployment projection',async t=>{
 const owner=retirementRecordUnitFixture(t),f=fixture(),directory=path.join(owner.root,'ordinary');mkdirSync(directory,{mode:0o700});
 for(const [name,value]of [['manifest.json',f.manifest],['deployment.json',f.deployment],['active-projection.json',f.projection]])writeFileSync(path.join(directory,name),JSON.stringify(value));
 const actual=await readWriterPredecessor(directory);assert.equal(actual.retirementObservation,undefined);assert.deepEqual(activeForWriterFixture({...f,...actual}),f.projection.active);
});
test('missing, unattested, wrong-attempt and competing retirement projections remain rejected',t=>{
 const base=retirementPredecessor(t);
 for(const change of[f=>delete f.retirementObservation,f=>delete f.deployment.retirementObservationHash,f=>f.discovery.predecessor.runAttempt++,f=>f.discovery.predecessor.controlCommit='e'.repeat(40),f=>f.projection=fixture().projection,f=>f.retirementObservation.scope='recorded-active-only']){const f=structuredClone(base);change(f);assert.throws(()=>activeForWriterFixture(f));}
});
const readerEnvironment={GITHUB_REPOSITORY:'owner/project',GITHUB_TOKEN:'private-unit-sentinel'};
test('metadata timeout and temporary upstream failure retry GET only and return the actual fresh response',async()=>{
 const diagnostics=[],delays=[],requests=[];let calls=0;
 const get=createWriterGithubReader(readerEnvironment,{wait:async ms=>delays.push(ms),onDiagnostic:value=>diagnostics.push(value),request:async(url,options)=>{requests.push({url,method:options.method,redirect:options.redirect});calls++;if(calls===1)throw Object.assign(Error(readerEnvironment.GITHUB_TOKEN),{name:'TimeoutError'});if(calls===2)return new Response(readerEnvironment.GITHUB_TOKEN,{status:503});return Response.json({id:12,run_attempt:2});}});
 assert.deepEqual(await get('actions/runs/12'),{id:12,run_attempt:2});assert.equal(calls,3);assert.deepEqual(delays,[1000,1000]);assert.ok(requests.every(row=>row.method==='GET'&&row.redirect==='error'));assert.deepEqual(diagnostics.map(row=>row.reason),['timeout','http']);assert.ok(!JSON.stringify(diagnostics).includes(readerEnvironment.GITHUB_TOKEN));
});
test('permission denial and exhausted quota stop with numeric diagnostics without reading or exposing the response body',async()=>{
 for(const headers of [{},{'x-ratelimit-remaining':'0','retry-after':'3600'}]){
  let calls=0,bodyReads=0;const get=createWriterGithubReader(readerEnvironment,{wait:async()=>{throw Error('must not wait');},request:async()=>{calls++;return{ok:false,status:403,headers:new Headers(headers),json:async()=>{bodyReads++;return{private:readerEnvironment.GITHUB_TOKEN};}};}});
  await assert.rejects(get('actions/runs/12'),error=>{const value=writerMetadataDiagnostic(error);assert.equal(value.status,403);assert.equal(value.attempt,1);assert.ok(!JSON.stringify(value).includes(readerEnvironment.GITHUB_TOKEN));assert.ok(!String(error).includes(readerEnvironment.GITHUB_TOKEN));return true;});assert.equal(calls,1);assert.equal(bodyReads,0);
 }
 assert.equal(writerMetadataDiagnostic(Error(readerEnvironment.GITHUB_TOKEN)),null);
});
test('metadata retries remain bounded and cannot disguise malformed successful JSON or private header text',async()=>{
 let calls=0;const get=createWriterGithubReader(readerEnvironment,{wait:async()=>{},request:async()=>{calls++;throw Error(readerEnvironment.GITHUB_TOKEN);}});
 await assert.rejects(get('actions/runs/12'),error=>writerMetadataDiagnostic(error).attempt===3);assert.equal(calls,3);
 const invalid=createWriterGithubReader(readerEnvironment,{request:async()=>new Response('not JSON',{status:200,headers:{'x-ratelimit-remaining':readerEnvironment.GITHUB_TOKEN}})});
 await assert.rejects(invalid('actions/runs/12'),error=>{const value=writerMetadataDiagnostic(error);assert.equal(value.reason,'invalid-json');assert.equal(value.attempt,1);assert.equal(value.rateLimitRemaining,null);return true;});
 let throttledCalls=0;const waits=[],shortThrottle=createWriterGithubReader(readerEnvironment,{wait:async ms=>waits.push(ms),request:async()=>++throttledCalls===1?new Response('',{status:429,headers:{'retry-after':'2'}}):Response.json({id:12})});
 assert.deepEqual(await shortThrottle('actions/runs/12'),{id:12});assert.equal(throttledCalls,2);assert.deepEqual(waits,[2000]);
 let bodyCalls=0;const bodyDiagnostics=[],bodyTimeout=createWriterGithubReader(readerEnvironment,{wait:async()=>{},onDiagnostic:value=>bodyDiagnostics.push(value),request:async()=>++bodyCalls===1?{ok:true,status:200,headers:new Headers(),json:async()=>{throw Object.assign(Error(readerEnvironment.GITHUB_TOKEN),{name:'AbortError'});}}:Response.json({id:13})});
 assert.deepEqual(await bodyTimeout('actions/runs/13'),{id:13});assert.equal(bodyCalls,2);assert.equal(bodyDiagnostics[0].reason,'timeout');assert.ok(!JSON.stringify(bodyDiagnostics).includes(readerEnvironment.GITHUB_TOKEN));
});
