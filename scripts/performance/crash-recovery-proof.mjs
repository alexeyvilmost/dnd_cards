import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {assertRealOwnedPath,assertRunId} from '../../scripts/testing/guards.mjs';
import {readRegistry,runsRoot} from '../../scripts/testing/runtime.mjs';

const sha256=bytes=>`sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const assertHash=value=>assert.match(value,/^sha256:[a-f0-9]{64}$/);
export async function readOwnedCrashSource(registry){
  assertRunId(registry?.runId);
  const directory=await assertRealOwnedPath(runsRoot,registry.directory);
  assert.equal(path.basename(directory),registry.runId);
  const saved=await readRegistry(directory);
  assert.equal(saved.runId,registry.runId);assert.equal(path.resolve(saved.directory),path.resolve(directory));
  assert.equal(saved.status,'ready','Crash source stack must still be ready');
  assertHash(saved.artifactHash);assert.equal(saved.artifactHash,registry.artifactHash);
  const binaryFile=await assertRealOwnedPath(directory,path.join(directory,process.platform==='win32'?'backend.exe':'backend'));
  const artifactFile=await assertRealOwnedPath(directory,path.join(directory,'rules-artifacts',`${saved.artifactHash.slice(7)}.cjs`));
  assert.equal((await stat(binaryFile)).isFile(),true);assert.equal((await stat(artifactFile)).isFile(),true);
  const binary=await readFile(binaryFile),artifact=await readFile(artifactFile);
  assert.equal(sha256(artifact),saved.artifactHash,'Source artifact bytes do not match their pin');
  return {directory,runId:saved.runId,binaryFile,artifactFile,binaryHash:sha256(binary),binaryBytes:binary.length,artifactHash:saved.artifactHash};
}
export async function assertCrashSourceUnchanged(source){
  const current=await readOwnedCrashSource({directory:source.directory,runId:source.runId,artifactHash:source.artifactHash});
  assert.equal(current.binaryHash,source.binaryHash,'Source backend changed during crash drill');
  return {binaryHash:current.binaryHash,artifactHash:current.artifactHash};
}

export async function cleanupCrashResources({children,servers,stopChild,stopDatabase}){
  const errors=[];
  // A failed stop must never prevent cleanup of another owned process or DB.
  for(const child of [...children].reverse()){
    if(child.exitCode!==null||child.signalCode!==null)continue;
    try{await stopChild(child);}catch{errors.push('owned_backend_cleanup_failed');}
  }
  for(const server of [...servers].reverse()){
    try{
      server.closeAllConnections?.();
      if(!server.listening)continue;
      let timer;
      try{await Promise.race([new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve())),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('server stop timeout')),5000);})]);}
      finally{clearTimeout(timer);}
    }catch{errors.push('owned_proxy_cleanup_failed');}
  }
  try{await stopDatabase();}catch{errors.push('owned_database_cleanup_failed');}
  const ownedChildrenExited=children.every(child=>child.exitCode!==null||child.signalCode!==null);
  if(!ownedChildrenExited&&!errors.includes('owned_backend_cleanup_failed'))errors.push('owned_backend_still_running');
  return {errors,ownedChildrenExited};
}

/** Validate the numeric/hash receipt, not a substitute for running the owned drill. */
export function assertCrashRecoveryProof(report){
  assert.equal(report.schemaVersion,1);assert.equal(report.kind,'native-owned-phase-crash');assert.equal(report.status,'passed');assertRunId(report.runId);
  assertRunId(report.binary.sourceRun);assert.notEqual(report.binary.sourceRun,report.runId);assertHash(report.binary.sha256);assertHash(report.binary.artifactHash);
  assert.match(report.binary.goRuntime,/^go\d+\.\d+(?:\.\d+)?$/);assert.ok(Number.isSafeInteger(report.binary.bytes)&&report.binary.bytes>0);
  assert.equal(report.sourceAfter.binaryHash,report.binary.sha256);assert.equal(report.sourceAfter.artifactHash,report.binary.artifactHash);
  assert.equal(report.executionAfter.binaryHash,report.binary.sha256);assert.equal(report.executionAfter.artifactHash,report.binary.artifactHash);
  assert.equal(report.scenarios.length,2);assert.deepEqual(report.scenarios.map(row=>row.phase),['before_commit','after_commit']);
  const commands=new Set();
  for(const row of report.scenarios){
    assert.match(row.runId,/^[a-f0-9-]{36}$/);assert.match(row.commandId,/^[a-f0-9-]{36}$/);assert.ok(!commands.has(row.commandId));commands.add(row.commandId);
    for(const field of ['commandHash','beforeHash','afterCrashHash','afterHash','afterDuplicateHash','envelopeBeforeHash','envelopeAfterHash','rngBeforeHash','rngAfterHash','receiptHash','receiptResponseHash','resultHash'])assertHash(row[field]);
    assert.notEqual(row.beforeHash,row.afterHash);assert.notEqual(row.envelopeBeforeHash,row.envelopeAfterHash);assert.notEqual(row.rngBeforeHash,row.rngAfterHash);
    assert.equal(row.noClientResponse,true);assert.equal(row.exactRetry,true);assert.equal(row.afterDuplicateHash,row.afterHash);assert.equal(row.receiptResponseHash,row.resultHash);
    for(const key of ['revision','runtimeRevision']){assert.ok(Number.isSafeInteger(row[`${key}Before`])&&row[`${key}Before`]>=0);assert.equal(row[`${key}After`],row[`${key}Before`]+1);}
    assert.equal(row.receiptCountBefore,0);assert.equal(row.receiptCount,1);assert.equal(row.duplicateWorkerCalls,0);assert.ok(row.paid.length>0);
    for(const paid of row.paid){assert.ok(typeof paid.resource==='string'&&paid.resource.length>0);assert.ok(Number.isFinite(paid.before)&&Number.isFinite(paid.after)&&Number.isFinite(paid.cost));assert.ok(paid.cost>0&&paid.after>=0);assert.equal(paid.after,paid.before-paid.cost);}
    if(row.phase==='before_commit'){
      assert.equal(row.beforeHash,row.afterCrashHash);assert.equal(row.workerCalls,2);assert.equal(row.retryWorkerCalls,1);assert.equal(row.fullWorkerReplayEquality,true);
      for(const field of ['heldWorkerResultHash','retriedWorkerResultHash','heldWorkerInputHash','retriedWorkerInputHash'])assertHash(row[field]);
      assert.equal(row.heldWorkerResultHash,row.retriedWorkerResultHash);assert.equal(row.heldWorkerInputHash,row.retriedWorkerInputHash);
    }else{
      assert.equal(row.committedHash,row.afterCrashHash);assert.equal(row.afterHash,row.committedHash);assert.equal(row.heldApiResultHash,row.resultHash);assert.equal(row.workerCalls,1);assert.equal(row.retryWorkerCalls,0);
    }
  }
  const crashes=report.crashes.filter(row=>row.phase!=='cleanup');assert.deepEqual(crashes.map(row=>row.phase),['before_commit','after_commit']);
  for(const row of crashes){assert.ok(Number.isSafeInteger(row.pid)&&row.pid>0);assert.ok(Number.isSafeInteger(row.generation)&&row.generation>0);assert.ok(row.signal==='SIGKILL'||Number.isInteger(row.code));assert.equal(row.requestedSignal,'SIGKILL');}
  // The OS may reuse a PID; ownership comes from the distinct spawned handles.
  assert.notEqual(crashes[0].generation,crashes[1].generation);
  assert.equal(report.cleanup.status,'stopped');assert.deepEqual(report.cleanup.errors,[]);assert.equal(report.cleanup.ownedChildrenExited,true);
  return {status:'passed',phases:2,paidCommands:2,exactWorkerReplay:true,receiptRecoveryWithoutWorker:true,cleanup:'stopped'};
}
