import test from 'node:test';
import assert from 'node:assert/strict';
import {probeImageJobs} from './image-job-writer-probe.mjs';
import {validateWriterTrace,writerTraceBinding} from './writer-traces.mjs';
import {writerEnvironment} from './writer-environment.mjs';
import {pair,off} from './writer-policy-unit-fixture.mjs';

function simulation(change){
  const pairFixture=pair(),binding=writerTraceBinding(pairFixture.candidate,pairFixture.check,pairFixture.bundle.rehearsalReceipt);
  binding.writerPolicy=off;
  let role,policy,stopped=true,expired=false,providerCalls=3;
  const cases=['queued','succeeded','unknown','expired-running'].map((id,index)=>({id,jobId:`0000000${index+1}-0000-4000-8000-000000000001`}));
  const jobs=new Map(cases.map(row=>[row.jobId,{id:row.jobId,state:row.id==='expired-running'?'running':row.id}]));
  const io={execution:'simulation',assertOwned:async()=>{},
    start:async(r,p)=>{assert.equal(stopped,true);role=r;policy=p;stopped=false;},stop:async()=>{stopped=true;},
    observe:async()=>({...binding[role],environment:Object.entries(writerEnvironment({writerPolicy:policy})).map(([key,value])=>`${key}=${value}`)}),
    createCases:async()=>cases,
    providerStats:async()=>({providerCalls,storageUploads:1,unexpected:0,jobs:cases.map(row=>({id:row.jobId,calls:row.id==='queued'?0:1}))}),
    read:async row=>{if(row.id==='expired-running'&&expired)jobs.get(row.jobId).state='unknown';return {status:200,body:{job:structuredClone(jobs.get(row.jobId))}};},
    retry:async row=>({status:202,body:{job:structuredClone(jobs.get(row.jobId))}}),
    readOtherOwner:async()=>({status:404}),newRequest:async()=>({status:503,body:{outcome:'not_started'}}),
    expireHeldLease:async row=>{assert.equal(stopped,true);expired=true;return {jobId:row.jobId,mode:'owned-expired-lease-after-process-stop',stateBefore:'running',stateAfter:'running',leaseExpired:true,providerCallsBefore:providerCalls,providerCallsAfter:providerCalls};},
  };
  change?.(io,{bump:()=>providerCalls++,jobs});return {io,binding,policy:()=>policy};
}

test('job driver retains four real-phase identities through OFF retry and restart with explicit lease-only fixture',async()=>{
  const fixture=simulation(),trace=await probeImageJobs(fixture.binding,fixture.io);
  assert.equal(trace.execution,'simulation');assert.throws(()=>validateWriterTrace(trace,trace.outcomeId,fixture.binding));
  // Structural unit validation only; never retained as actual execution evidence.
  validateWriterTrace({...trace,execution:'docker'},trace.outcomeId,fixture.binding);
  assert.deepEqual(fixture.policy(),off);assert.equal(trace.observations.length,4);
});

for(const [name,change] of [
  ['another owner can read',(io)=>{io.readOtherOwner=async()=>({status:200});}],
  ['OFF retries create another provider attempt',(io,state)=>{const prior=io.retry;io.retry=async row=>{state.bump();return prior(row);};}],
  ['new OFF request is accepted',(io)=>{io.newRequest=async()=>({status:202,body:{}});}],
  ['unknown outcome is promoted to success',(io,state)=>{const prior=io.read;let count=0;io.read=async row=>{if(++count>4&&row.id==='unknown')state.jobs.get(row.jobId).state='succeeded';return prior(row);};}],
  ['initial phases share a single identity',(io)=>{io.createCases=async()=>Array.from({length:4},(_,index)=>({id:['queued','succeeded','unknown','expired-running'][index],jobId:'00000001-0000-4000-8000-000000000001'}));}],
])test(`job driver refuses ${name} and restores candidate flags`,async()=>{
  const fixture=simulation(change);await assert.rejects(probeImageJobs(fixture.binding,fixture.io));assert.deepEqual(fixture.policy(),off);
});
