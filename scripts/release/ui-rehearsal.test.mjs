import test from 'node:test';import assert from 'node:assert/strict';import {uiFixture} from './ui-release-unit-fixture.mjs';
import {executeFrontendChecks,collectFrontendRehearsal} from './ui-rehearsal.mjs';import {frontendRehearsalChecks} from './ui-release-receipt.mjs';
function setup(){const context=uiFixture(),seen=[];let runId;
  const adapter={execution:'docker',scope:'owned-synthetic',start:async input=>{runId=input.runId;seen.push('start');return {runId,status:'ready',execution:'docker',scope:'owned-synthetic'};},observeProtected:async()=>structuredClone(context.bundle.rehearsalReceipt.rehearsalRuntimeBefore),check:async id=>{seen.push(id);const row=context.bundle.rehearsalReceipt.checks.find(row=>row.id===id);return {...structuredClone(row),id,runId,execution:'docker'};},cleanup:async()=>{seen.push('cleanup');return {status:'stopped',errors:[]};}};
  const observeHost=async()=>({protectedRuntime:structuredClone(context.protectedRunning),files:structuredClone(context.bundle.rehearsalReceipt.filesBefore)});
  return {context,adapter,seen,observeHost,manifest:context.manifest};}
test('fresh producer executes all mixed OCI stages and preserves distinct host/owned runtime observations',async()=>{
  const f=setup(),bundle=await collectFrontendRehearsal(f);assert.deepEqual(f.seen,['start',...frontendRehearsalChecks,'cleanup']);assert.equal(bundle.rehearsalReceipt.history.disposition,'reused');assert.equal(bundle.rehearsalReceipt.currentDatabaseSnapshot,false);assert.notEqual(bundle.rehearsalReceipt.runtimeBefore.backend.containerId,bundle.rehearsalReceipt.rehearsalRuntimeBefore.backend.containerId);assert.equal(bundle.rehearsalReceipt.hostObservationScope,'read-only-around-owned-rehearsal');
});
test('missing/failed/foreign-run stage or cleanup failure cannot produce a passed receipt',async()=>{
  for(const mode of ['start','failed','foreign','cleanup']){const f=setup();if(mode==='start')f.adapter.start=async()=>{throw Error('partial start');};if(mode==='failed')f.adapter.check=async()=>({status:'failed'});if(mode==='foreign')f.adapter.check=async()=>({status:'passed',execution:'docker',id:'image-contract',runId:'other'});if(mode==='cleanup')f.adapter.cleanup=async()=>({status:'failed',errors:['retained live container']});await assert.rejects(executeFrontendChecks(f.adapter,{}),error=>error.evidence.status==='failed'&&error.evidence.authorization==='not-produced');if(mode!=='cleanup')assert.equal(f.seen.at(-1),'cleanup');}
});
test('backend replacement in owned rollback fails even when protected host remains unchanged',async()=>{
  const f=setup();let reads=0;f.adapter.observeProtected=async()=>{const value=structuredClone(f.context.bundle.rehearsalReceipt.rehearsalRuntimeBefore);if(reads++===2)value.backend.containerId='e'.repeat(64);return value;};await assert.rejects(collectFrontendRehearsal(f),error=>error.evidence.status==='failed');assert.equal(f.seen.at(-1),'cleanup');
});
