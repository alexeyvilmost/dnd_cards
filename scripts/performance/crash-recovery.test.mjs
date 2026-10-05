import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,rm} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import path from 'node:path';
import {runsRoot,writeRegistry} from '../../scripts/testing/runtime.mjs';
import {assertRealOwnedPath} from '../../scripts/testing/guards.mjs';
import {readOwnedCrashSource,assertCrashSourceUnchanged,assertCrashRecoveryProof,cleanupCrashResources} from './crash-recovery-proof.mjs';

const h=letter=>`sha256:${letter.repeat(64)}`;
function proof(){
  const scenarios=['before_commit','after_commit'].map((phase,index)=>({phase,runId:`${index+1}0000000-0000-4000-8000-000000000001`,commandId:`${index+1}0000000-0000-4000-8000-000000000002`,commandHash:h('a'),beforeHash:h('b'),afterCrashHash:phase==='before_commit'?h('b'):h('c'),afterHash:h('c'),afterDuplicateHash:h('c'),envelopeBeforeHash:h('d'),envelopeAfterHash:h('e'),rngBeforeHash:h('f'),rngAfterHash:h('a'),receiptHash:h('b'),receiptResponseHash:h('c'),resultHash:h('c'),noClientResponse:true,exactRetry:true,revisionBefore:3,revisionAfter:4,runtimeRevisionBefore:2,runtimeRevisionAfter:3,receiptCountBefore:0,receiptCount:1,workerCalls:index?1:2,retryWorkerCalls:index?0:1,duplicateWorkerCalls:0,paid:[{resource:'fixture_pool',before:2,after:1,cost:1}],...(index?{committedHash:h('c'),heldApiResultHash:h('c')}:{heldWorkerResultHash:h('e'),retriedWorkerResultHash:h('e'),heldWorkerInputHash:h('d'),retriedWorkerInputHash:h('d'),fullWorkerReplayEquality:true})}));
  return {schemaVersion:1,kind:'native-owned-phase-crash',status:'passed',runId:`test_${'1'.repeat(24)}`,binary:{sourceRun:`test_${'2'.repeat(24)}`,sha256:h('a'),artifactHash:h('b'),goRuntime:'go1.25.12',bytes:1024},sourceAfter:{binaryHash:h('a'),artifactHash:h('b')},executionAfter:{binaryHash:h('a'),artifactHash:h('b')},scenarios,crashes:[{phase:'before_commit',pid:1,generation:1,code:null,signal:'SIGKILL',requestedSignal:'SIGKILL'},{phase:'after_commit',pid:2,generation:2,code:null,signal:'SIGKILL',requestedSignal:'SIGKILL'}],cleanup:{status:'stopped',errors:[],ownedChildrenExited:true}};
}

test('crash source rejects escaped/stopped/mismatched inputs and detects post-copy mutation',async()=>{
  const runId=`test_${randomBytes(12).toString('hex')}`,directory=path.join(runsRoot,runId),artifact='exports.version=1;',artifactHash=`sha256:${createHash('sha256').update(artifact).digest('hex')}`;
  await mkdir(path.join(directory,'rules-artifacts'),{recursive:true});
  const registry={runId,directory,status:'ready',artifactHash};await writeRegistry(registry);
  const binaryFile=path.join(directory,process.platform==='win32'?'backend.exe':'backend'),artifactFile=path.join(directory,'rules-artifacts',`${artifactHash.slice(7)}.cjs`);
  await writeFile(binaryFile,'unit-only opaque bytes');await writeFile(artifactFile,artifact);
  try{
    const source=await readOwnedCrashSource(registry);await assertCrashSourceUnchanged(source);
    await assert.rejects(readOwnedCrashSource({...registry,directory:runsRoot}));
    await assert.rejects(readOwnedCrashSource({...registry,runId:`test_${'f'.repeat(24)}`}));
    await assert.rejects(readOwnedCrashSource({...registry,artifactHash:h('0')}));
    await writeRegistry({...registry,status:'stopped'});await assert.rejects(readOwnedCrashSource(registry));await writeRegistry(registry);
    await writeFile(binaryFile,'changed bytes');await assert.rejects(assertCrashSourceUnchanged(source));await writeFile(binaryFile,'unit-only opaque bytes');
    await writeFile(artifactFile,'changed artifact');await assert.rejects(readOwnedCrashSource(registry));
  }finally{await assertRealOwnedPath(runsRoot,directory);assert.equal(path.basename(directory),runId);await rm(directory,{recursive:true,force:true});}
});

test('crash proof rejects loss of any phase, payment, RNG, receipt, replay, source or cleanup guarantee',()=>{
  assert.equal(assertCrashRecoveryProof(proof()).phases,2);
  const reusedPID=proof();reusedPID.crashes[1].pid=reusedPID.crashes[0].pid;assert.equal(assertCrashRecoveryProof(reusedPID).phases,2);
  for(const mutate of [
    r=>{r.scenarios.pop();},r=>{r.scenarios[0].afterCrashHash=h('d');},r=>{r.scenarios[1].committedHash=h('d');},
    r=>{r.scenarios[0].paid=[];},r=>{r.scenarios[0].paid[0].after=2;},r=>{r.scenarios[1].paid[0].cost=0;},
    r=>{r.scenarios[0].rngAfterHash=r.scenarios[0].rngBeforeHash;},r=>{r.scenarios[1].receiptCount=2;},
    r=>{r.scenarios[1].retryWorkerCalls=1;},r=>{r.scenarios[1].duplicateWorkerCalls=1;},r=>{r.scenarios[0].retriedWorkerResultHash=h('f');},
    r=>{r.scenarios[0].retriedWorkerInputHash=h('f');},r=>{r.scenarios[1].heldApiResultHash=h('f');},
    r=>{r.scenarios[0].noClientResponse=false;},r=>{r.scenarios[1].runtimeRevisionAfter=4;},
    r=>{r.sourceAfter.binaryHash=h('f');},r=>{r.sourceAfter.artifactHash=h('f');},
    r=>{r.executionAfter.binaryHash=h('f');},r=>{r.executionAfter.artifactHash=h('f');},
    r=>{r.crashes[1].generation=r.crashes[0].generation;},r=>{delete r.crashes[0].generation;},r=>{r.crashes[0].requestedSignal='SIGTERM';},r=>{r.cleanup.ownedChildrenExited=false;},r=>{r.cleanup.errors.push('failed');},
  ]){const changed=proof();mutate(changed);assert.throws(()=>assertCrashRecoveryProof(changed));}
});

test('cleanup attempts every owned resource after stop failures and cannot yield a green proof',async()=>{
  const attempted=[],children=[{exitCode:null,signalCode:null},{exitCode:null,signalCode:null}],servers=[{listening:true,closeAllConnections(){attempted.push('socket1');},close(callback){attempted.push('server1');callback();}},{listening:true,closeAllConnections(){attempted.push('socket2');throw Error('synthetic stop failure');}}];
  const result=await cleanupCrashResources({children,servers,stopChild:async child=>{attempted.push(`child${children.indexOf(child)}`);if(child===children[1])throw Error('synthetic kill failure');child.signalCode='SIGKILL';},stopDatabase:async()=>{attempted.push('database');throw Error('synthetic database failure');}});
  assert.deepEqual(attempted,['child1','child0','socket2','socket1','server1','database']);assert.equal(result.ownedChildrenExited,false);assert.deepEqual(result.errors,['owned_backend_cleanup_failed','owned_proxy_cleanup_failed','owned_database_cleanup_failed']);
  const report=proof();report.cleanup={status:'stopped',...result};assert.throws(()=>assertCrashRecoveryProof(report));
});
