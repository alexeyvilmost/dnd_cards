import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {readFile,writeFile,copyFile,stat} from 'node:fs/promises';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {startTestStack,waitReady} from '../../scripts/testing/stack.mjs';
import {restoreIntegrationBaseline} from '../../scripts/testing/integration-baseline.mjs';
import {newAccounts,seedAccounts,seedCanonicalTemplates} from '../../scripts/testing/fixtures.mjs';
import {cleanEnvironment,freePort,writeRegistry,execute,resolveTool} from '../../scripts/testing/runtime.mjs';
import {localFetch} from '../../scripts/testing/guards.mjs';
import {createRulesWorker,snapshotHash} from '../../frontend/worker/server.mjs';
import {authorizeNativeRehearsal,createCanonicalPendingScenario,acceptedReceiptReplay} from '../../scripts/release/rehearsal-scenarios.mjs';
import {localAcceptanceContext} from '../../scripts/testing/acceptance-context.mjs';
import {readOwnedCrashSource,assertCrashSourceUnchanged,assertCrashRecoveryProof,cleanupCrashResources} from './crash-recovery-proof.mjs';

const hash=bytes=>`sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const assertSame=(a,b,label)=>{if(snapshotHash(a)!==snapshotHash(b))throw Error(label);};
const defer=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const bounded=async (promise,timeout=30000)=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Owned crash boundary timeout')),timeout);})]);}finally{clearTimeout(timer);}};
export async function checkCrashRecovery(sourceStack,_options={}, {go,pgBin}={}){
const sourceContext=await localAcceptanceContext(sourceStack.env);
assert.equal(sourceContext.registry.runId,sourceStack.registry.runId);
const sourceMarker=(await sourceStack.database.query("SELECT current_database() || ':' || run_id FROM test_run_ownership;",undefined,{sensitive:true})).trim().split(/\r?\n/).at(-1);
assert.equal(sourceMarker,`${sourceContext.registry.runId}:${sourceContext.registry.runId}`);
const sourceHealth=await sourceContext.request('/api/health');assert.equal(sourceHealth.status,200);assert.equal((await sourceHealth.json()).status,'ok');
const source=await readOwnedCrashSource(sourceContext.registry),expectedArtifact=source.artifactHash;
const stack=await startTestStack({dbOnly:true,profile:'integration',go,pgBin}),servers=[],children=[],crashes=[],childGenerations=new WeakMap();
let backend,workerGate,apiGate,workerObservation,workerCalls=0,apiOrigin,workerOrigin,workerProxyOrigin,backendEnv,backendBinary,proof;
const report={schemaVersion:1,status:'running',kind:'native-owned-phase-crash',runId:stack.registry.runId,scenarios:[]};
async function listen(server){await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});servers.push(server);return `http://127.0.0.1:${server.address().port}`;}
async function stopOwnedChild(child,phase){
  assert.ok(child&&children.includes(child)&&child.exitCode===null&&child.signalCode===null,'Only this drill\'s live ChildProcess can be killed');
  const closed=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));assert.equal(child.kill('SIGKILL'),true);
  const result=await bounded(closed,5000);assert.ok(child.exitCode!==null||child.signalCode!==null);
  crashes.push({phase,pid:child.pid,generation:childGenerations.get(child),requestedSignal:'SIGKILL',...result});if(child===backend)backend=null;
}
const stopBackend=phase=>stopOwnedChild(backend,phase);
async function startBackend(){
  backend=spawn(backendBinary,[],{cwd:stack.registry.directory,env:backendEnv,windowsHide:true,stdio:'ignore'});children.push(backend);childGenerations.set(backend,children.length);
  const child=backend;await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
  await waitReady(apiOrigin,'/api/health',async r=>(await r.json()).status==='ok',90000,()=>child.exitCode===null&&child.signalCode===null);
}
async function privateJSON(sql){const raw=await stack.database.query(`SELECT encode(convert_to((${sql})::text,'UTF8'),'base64');`,undefined,{sensitive:true});return JSON.parse(Buffer.from(raw.trim(),'base64').toString('utf8'));}
async function snapshot(runId){
  assert.match(runId,/^[a-f0-9-]{36}$/i);
  return privateJSON(`SELECT jsonb_build_object('run',to_jsonb(r),'character',to_jsonb(c),'receipts',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM roguelike_command_receipts x WHERE x.run_id=r.id),'[]'::jsonb),'combat_events',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM roguelike_combat_events e WHERE e.run_id=r.id),'[]'::jsonb),'character_events',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM character_events e WHERE e.character_id=c.id),'[]'::jsonb)) FROM roguelike_runs r JOIN characters_v3 c ON c.id=r.character_id WHERE r.id='${runId}'`);
}
async function proxy(request,response,target,kind){
  try{
    const chunks=[];for await(const chunk of request)chunks.push(chunk);const raw=Buffer.concat(chunks);
    const input=raw.length?JSON.parse(raw):undefined;
    const gate=kind==='worker'?workerGate:apiGate;
    const selected=gate&&request.url===gate.route&&(kind==='worker'?input?.intent?.effectId===gate.effectId:input?.command_id===gate.commandId);
    if(kind==='worker')workerCalls++;
    const headers={'content-type':'application/json',...(request.headers.authorization?{authorization:request.headers.authorization}:{})};
    if(request.headers['x-request-id'])headers['x-request-id']=request.headers['x-request-id'];
    const upstream=await localFetch(target,request.url,{method:request.method,headers,...(raw.length?{body:raw}:{})});
    const bytes=Buffer.from(await upstream.arrayBuffer());
    if(kind==='worker'&&workerObservation&&input?.intent?.effectId===workerObservation.effectId){workerObservation.input=input;workerObservation.output=JSON.parse(bytes);}
    if(selected){assert.equal(upstream.status,200,`${kind} boundary expected canonical success`);gate.input=input;gate.output=JSON.parse(bytes);gate.reached.resolve();await gate.release.promise;}
    if(!response.destroyed){response.writeHead(upstream.status,{'content-type':'application/json'});response.end(bytes);}
  }catch{if(!response.destroyed)response.destroy();}
}
try{
  const binarySource=source.binaryFile,artifactSource=source.artifactFile;
  assert.equal(hash(await readFile(artifactSource)),expectedArtifact);
  backendBinary=path.join(stack.registry.directory,path.basename(binarySource));await copyFile(binarySource,backendBinary,1);
  const artifactFile=path.join(stack.registry.directory,`${expectedArtifact.slice(7)}.cjs`);await copyFile(artifactSource,artifactFile,1);
  const buildInfo=await execute(resolveTool('go',go),['version','-m',backendBinary]);
  report.binary={sourceRun:source.runId,sha256:hash(await readFile(backendBinary)),bytes:(await stat(backendBinary)).size,goRuntime:buildInfo.split(/\r?\n/)[0].split(': ').at(-1),artifactHash:expectedArtifact};
  assert.equal(report.binary.sha256,source.binaryHash);await assertCrashSourceUnchanged(source);
  stack.registry.fixture=await restoreIntegrationBaseline(stack.database,stack.registry);
  const accounts=newAccounts(),workerToken=randomBytes(32).toString('hex'),jwtSecret=randomBytes(32).toString('hex');
  workerOrigin=await listen(await createRulesWorker({artifactFile,artifactsDirectory:path.join(stack.registry.directory,'rules-artifacts'),token:workerToken}));
  workerProxyOrigin=await listen(createServer((req,res)=>proxy(req,res,workerOrigin,'worker')));
  apiOrigin=`http://127.0.0.1:${await freePort()}`;
  const apiProxyOrigin=await listen(createServer((req,res)=>proxy(req,res,apiOrigin,'api')));
  const denyOrigin=await listen(createServer((_req,res)=>{res.writeHead(503);res.end();}));
  backendEnv=cleanEnvironment({DATABASE_URL:stack.database.dsn,PORT:new URL(apiOrigin).port,LISTEN_HOST:'127.0.0.1',JWT_SECRET:jwtSecret,
    RULES_WORKER_URL:workerProxyOrigin,RULES_WORKER_TOKEN:workerToken,CONTENT_ADMIN_USER_IDS:accounts.admin.id,CORS_ALLOWED_ORIGINS:apiProxyOrigin,
    OPENAI_API_KEY:'',OPENAI_BASE_URL:`${denyOrigin}/v1`,HTTPS_PROXY:denyOrigin,HTTP_PROXY:denyOrigin,NO_PROXY:'127.0.0.1,localhost,::1',GIN_MODE:'release',IMAGE_JOBS_ENABLED:'0',DB_COMPACT_RECEIPTS:'0',DB_FROZEN_CATALOGS:'0',RULES_WORKER_MIRRORS_ENABLED:'0'});
  await startBackend();stack.registry.fixture.templates=await seedCanonicalTemplates(stack.database);await seedAccounts(stack.database,accounts);await stack.database.query('ANALYZE;');
  Object.assign(stack.registry,{origins:{api:apiProxyOrigin,ui:apiProxyOrigin,worker:workerOrigin},artifactHash:expectedArtifact,accounts:Object.fromEntries(Object.entries(accounts).map(([role,a])=>[role,{id:a.id}]))});
  Object.assign(stack.env,{TEST_API_ORIGIN:apiProxyOrigin,TEST_UI_ORIGIN:apiProxyOrigin,TEST_WORKER_ORIGIN:workerOrigin,TEST_WORKER_TOKEN:workerToken,TEST_USERNAME:accounts.player.username,TEST_PASSWORD:accounts.player.password,TEST_ADMIN_USERNAME:accounts.admin.username,TEST_ADMIN_PASSWORD:accounts.admin.password});await writeRegistry(stack.registry);
  const influenceDeclarations=JSON.parse(await readFile(new URL('../../frontend/src/engine/data/rollInfluences.json',import.meta.url)));
  for(const phase of ['before_commit','after_commit']){
    const pending=await createCanonicalPendingScenario(await authorizeNativeRehearsal(stack),{label:'Owned process crash proof'});
    const loaded=await pending.request(''),state=loaded.run.combat_state,actor=state.world.actors[state.characterId];
    const choice=pending.held.responders.find(row=>row.actorId===actor.id&&influenceDeclarations.some(action=>action.id===row.effectId));assert.ok(choice,'Actual offered canonical influence required');
    const definition=influenceDeclarations.find(action=>action.id===choice.effectId);assert.ok(definition.activation.cost.length);
    const command={command_id:randomUUID(),expected_revision:loaded.run.revision,type:'combat_intent',payload:{intent:{type:'d20_interrupt',actorId:actor.id,effectId:choice.effectId}}};
    const before=await snapshot(pending.id),callsBefore=workerCalls;assert.equal(before.receipts.filter(row=>row.command_id===command.command_id).length,0);
    const gate={route:phase==='before_commit'?'/transition':`/api/roguelike/runs/${pending.id}/commands`,commandId:command.command_id,effectId:choice.effectId,reached:defer(),release:defer()};
    if(phase==='before_commit')workerGate=gate;else apiGate=gate;
    const original=pending.request('/commands',command).then(()=>({delivered:true}),()=>({delivered:false}));
    await bounded(gate.reached.promise);
    let committed;
    if(phase==='before_commit'){assertSame(await snapshot(pending.id),before,'Pre-commit boundary already persisted changes');}
    else{committed=await snapshot(pending.id);const receipt=committed.receipts.find(r=>r.command_id===command.command_id);assert.ok(receipt);assertSame(acceptedReceiptReplay(receipt).response,gate.output,'Held API response differs from durable receipt');assert.equal(committed.run.revision,before.run.revision+1);}
    await stopBackend(phase);
    // Suppress the held downstream response instead of returning a fabricated failure.
    if(phase==='before_commit')workerGate=null;else apiGate=null;
    for(const server of servers)if(server!==servers[0])server.closeAllConnections();
    gate.release.resolve();assert.equal((await bounded(original)).delivered,false,'Client saw a response before simulated loss');
    const afterCrash=await snapshot(pending.id);assertSame(afterCrash,phase==='before_commit'?before:committed,'Crash changed observed committed database image');
    await startBackend();assertSame(await snapshot(pending.id),afterCrash,'Backend restart changed run or receipt');
    const callsAtRetry=workerCalls;
    if(phase==='before_commit')workerObservation={effectId:choice.effectId};
    const accepted=await pending.request('/commands',command),after=await snapshot(pending.id);
    assert.equal(after.run.revision,before.run.revision+1);assert.equal(after.character.runtime_revision,before.character.runtime_revision+1);
    const receipt=after.receipts.filter(r=>r.command_id===command.command_id);assert.equal(receipt.length,1);assertSame(acceptedReceiptReplay(receipt[0]).response,accepted,'Accepted result differs from its one receipt');
    if(phase==='before_commit'){assertSame(workerObservation.input,gate.input,'Retry changed exact worker input');assertSame(workerObservation.output,gate.output,'Retry changed full worker result including trace/random values');assertSame(after.run.combat_envelope,gate.output.envelope,'Retry changed held exact RNG/envelope');assertSame(accepted.run.combat_state,gate.output.envelope.state,'Retry changed computed game result');assert.equal(workerCalls,callsAtRetry+1);}
    else{assertSame(accepted,gate.output,'Post-commit retry changed exact response');assertSame(after,committed,'Post-commit retry mutated committed state');assert.equal(workerCalls,callsAtRetry,'Receipt recovery reran worker');}
    const nextActor=accepted.run.combat_state.world.actors[actor.id];
    const paid=[];for(const cost of definition.activation.cost){const beforeValue=actor.runtime.resources[cost.resource],afterValue=nextActor.runtime.resources[cost.resource];assert.equal(afterValue,beforeValue-Number(cost.amount??1));paid.push({resource:cost.resource,before:beforeValue,after:afterValue,cost:Number(cost.amount??1)});}
    assert.notEqual(snapshotHash(after.run.combat_envelope.entropy),snapshotHash(before.run.combat_envelope.entropy),'Paid reroll did not advance saved RNG');
    const callsAtDuplicate=workerCalls,duplicate=await pending.request('/commands',command),afterDuplicate=await snapshot(pending.id);assertSame(duplicate,accepted,'Second exact retry changed receipt');assertSame(afterDuplicate,after,'Second exact retry mutated state');assert.equal(workerCalls,callsAtDuplicate,'Second exact retry reran worker');
    report.scenarios.push({phase,runId:pending.id,commandId:command.command_id,commandHash:snapshotHash(command),noClientResponse:true,beforeHash:snapshotHash(before),afterCrashHash:snapshotHash(afterCrash),afterHash:snapshotHash(after),afterDuplicateHash:snapshotHash(afterDuplicate),envelopeBeforeHash:snapshotHash(before.run.combat_envelope),envelopeAfterHash:snapshotHash(after.run.combat_envelope),rngBeforeHash:snapshotHash(before.run.combat_envelope.entropy),rngAfterHash:snapshotHash(after.run.combat_envelope.entropy),receiptHash:snapshotHash(receipt[0]),receiptResponseHash:snapshotHash(acceptedReceiptReplay(receipt[0]).response),resultHash:snapshotHash(accepted),...(phase==='before_commit'?{heldWorkerResultHash:snapshotHash(gate.output),retriedWorkerResultHash:snapshotHash(workerObservation.output),heldWorkerInputHash:snapshotHash(gate.input),retriedWorkerInputHash:snapshotHash(workerObservation.input),fullWorkerReplayEquality:true}:{committedHash:snapshotHash(committed),heldApiResultHash:snapshotHash(gate.output)}),revisionBefore:before.run.revision,revisionAfter:after.run.revision,runtimeRevisionBefore:before.character.runtime_revision,runtimeRevisionAfter:after.character.runtime_revision,receiptCountBefore:0,receiptCount:receipt.length,workerCalls:workerCalls-callsBefore,retryWorkerCalls:phase==='before_commit'?1:0,duplicateWorkerCalls:workerCalls-callsAtDuplicate,paid,exactRetry:true});
    workerObservation=null;
  }
  report.status='passed';report.crashes=crashes;
  report.sourceAfter=await assertCrashSourceUnchanged(source);
  report.executionAfter={binaryHash:hash(await readFile(backendBinary)),artifactHash:hash(await readFile(artifactFile))};
}catch{report.status='failed';report.failure='owned_crash_drill_failed';}
finally{
  workerGate?.release.resolve();apiGate?.release.resolve();
  const cleanup=await cleanupCrashResources({children,servers,stopChild:child=>stopOwnedChild(child,'cleanup'),stopDatabase:()=>stack.cleanup()});
  report.cleanup={status:stack.registry.status,...cleanup};report.crashes=crashes;
  if(cleanup.errors.length){report.status='failed';report.failure='owned_crash_cleanup_failed';}
  if(report.status==='passed')try{proof=assertCrashRecoveryProof(report);}catch{report.status='failed';report.failure='owned_crash_proof_invalid';}
  await writeFile(path.join(stack.registry.directory,'crash-drill.json'),JSON.stringify(report,null,2));
}
if(report.status!=='passed')throw Error(`Owned crash drill failed (${report.failure}); run ${stack.registry.runId}`);
return {runId:stack.registry.runId,...proof,binary:report.binary};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const sourceStack=await startTestStack({profile:'integration',reuseBuild:true});
  try{console.log(JSON.stringify(await checkCrashRecovery(sourceStack)));}finally{await sourceStack.cleanup();}
}
