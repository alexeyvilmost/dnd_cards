import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {probeCompactReceipts} from './compact-writer-probe.mjs';
import {validateWriterTrace,writerTraceBinding} from './writer-traces.mjs';
import {writerEnvironment} from './writer-environment.mjs';
import {pair,off} from './writer-policy-unit-fixture.mjs';

function simulation(fault){
  const f=pair(),binding=writerTraceBinding(f.candidate,f.check,f.bundle.rehearsalReceipt);
  const rows=new Map(),corrupt=new Set(),calls=[];let workerCalls=0,revision=0,policy,role,count=0;
  const fixtures=['roguelike_command_receipts','character_runtime_commands'].map((table,i)=>({table,commandId:`0000000${i+1}-0000-4000-8000-000000000001`,request:{command_id:`0000000${i+1}-0000-4000-8000-000000000001`,type:'unit-canonical'}}));
  const schemaFaults=[],triggerFaults=[];
  const io={execution:'simulation',schemaFaults,triggerFaults,assertOwned:async()=>{calls.push('owned');},start:async(r,p)=>{role=r;policy=p;calls.push('start:'+r+':'+p.compactReceipts);},stop:async()=>{calls.push('stop');},
    observe:async()=>({images:structuredClone(binding[role].images),identities:structuredClone(binding[role].identities),environment:Object.entries(writerEnvironment({writerPolicy:policy})).map(([k,v])=>k+'='+v)}),
    fixtures:async()=>fixtures,workerCalls:async()=>workerCalls,invariant:async()=>({revision}),
    request:async f=>{
      if(corrupt.has(f.commandId))return {status:500,body:{code:'receipt_invalid'}};
      const prior=rows.get(f.commandId);if(prior)return {status:200,body:{...structuredClone(prior.body),...(f.table==='character_runtime_commands'?{replayed:true}:{})}};
      workerCalls++;revision++;
      const body={run:{history:'synthetic fixture '.repeat(512)},revision,...(f.table==='character_runtime_commands'?{replayed:false}:{})},raw=Buffer.from(JSON.stringify(body)),compact=policy.compactReceipts;
      const row={command_id:f.commandId,response_version:compact?2:1,response:compact?{}:body,response_payload_base64:compact?gzipSync(raw).toString('base64'):'',response_sha256:compact?createHash('sha256').update(raw).digest('hex'):'',response_length:compact?raw.length:0};
      rows.set(f.commandId,{body,row});return {status:200,body:structuredClone(body)};
    },
    readReceipt:async f=>structuredClone(rows.get(f.commandId).row),newCommand:async f=>{count++;const commandId=`000000${20+count}-0000-4000-8000-000000000001`;return {...f,commandId,request:{command_id:commandId,type:'unit-next'}};},
    corruptReceipt:async(f,field)=>{corrupt.add(f.commandId);calls.push('corrupt:'+f.table+':'+field);if(f.table==='character_runtime_commands'&&!triggerFaults.length)triggerFaults.push({table:f.table,triggerName:'character_runtime_commands_append_only',definitionHash:'sha256:'+'8'.repeat(64),mutationRejected:true,scope:'owned-transaction-only',restored:true});if(field==='version')schemaFaults.push({table:f.table,id:'version',constraintName:`${f.table}_storage_version`,definitionHash:'sha256:'+'7'.repeat(64),constraintRejected:true,injectedVersion:99,restored:false});},
    restoreReceipt:async(f,row)=>{calls.push('restore:'+f.table);corrupt.delete(f.commandId);rows.get(f.commandId).row=structuredClone(row);const fault=schemaFaults.find(value=>value.table===f.table);if(fault)fault.restored=true;},
  };
  fault?.(io,{rows,corrupt,calls,fixtures,binding,bumpWorker:()=>workerCalls++});
  return {io,binding,rows,calls,policy:()=>policy};
}
test('compact driver executes both raw codecs, restarts, rollback, v1 writes, six faults and returns private-data-free observations',async()=>{
  const f=simulation();const trace=await probeCompactReceipts(f.binding,f.io);
  assert.equal(trace.execution,'simulation');assert.throws(()=>validateWriterTrace(trace,trace.outcomeId,f.binding));
  // Explicitly fabricated structural assertion, never retained as OCI proof.
  validateWriterTrace({...trace,execution:'docker'},trace.outcomeId,f.binding);
  assert.equal(trace.observations.length,2);assert.equal(f.calls.filter(c=>c.startsWith('corrupt:')).length,6);
  assert.deepEqual(f.policy(),f.binding.writerPolicy);assert.equal(f.calls.at(-1),'start:candidate:true');
  assert.ok(!JSON.stringify(trace).includes('synthetic fixture'));
});
test('probe restores requested OFF policy even though disposable format production deliberately enabled v2',async()=>{
  const f=simulation();f.binding.writerPolicy=off;await probeCompactReceipts(f.binding,f.io);assert.deepEqual(f.policy(),off);
});
for(const [name,fault] of [
  ['accepted retry differs',(io,state)=>{const real=io.request;let n=0;io.request=async f=>{const r=await real(f);if(++n===2)r.body.forged=true;return r;};}],
  ['retry reruns worker',(io,state)=>{const real=io.request;let n=0;io.request=async f=>{const r=await real(f);if(++n===2)state.bumpWorker();return r;};}],
  ['character retry lacks authoritative replay marker',(io)=>{const real=io.request;io.request=async f=>{const r=await real(f);if(f.table==='character_runtime_commands'&&r.body.replayed===true)r.body.replayed=false;return r;};}],
  ['new OFF retry reruns worker',(io,state)=>{const real=io.request;const counts=new Map();io.request=async f=>{const n=(counts.get(f.commandId)??0)+1;counts.set(f.commandId,n);const result=await real(f);if(f.request.type==='unit-next'&&n===2)state.bumpWorker();return result;};}],
  ['raw SQL hash mismatch',(io)=>{const real=io.readReceipt;io.readReceipt=async f=>({...await real(f),response_sha256:'0'.repeat(64)});}],
  ['one receipt family absent',(io,state)=>{io.fixtures=async()=>state.fixtures.slice(0,1);}],
  ['corrupt receipt accepted',(io,state)=>{const real=io.request;io.request=async f=>state.corrupt.has(f.commandId)?{status:200,body:{accepted:true}}:real(f);}],
  ['corrupt receipt reruns worker',(io,state)=>{const real=io.request;io.request=async f=>{if(state.corrupt.has(f.commandId))state.bumpWorker();return real(f);};}],
  ['wrong previous image',(io)=>{const real=io.observe;let n=0;io.observe=async()=>{const r=await real();if(++n===3)r.images.backend='wrong';return r;};}],
])test(`compact driver rejects ${name} and returns to candidate policy`,async()=>{
  const f=simulation(fault);await assert.rejects(probeCompactReceipts(f.binding,f.io));assert.deepEqual(f.policy(),f.binding.writerPolicy);
});
test('lost mutation response still restores receipt and independent restoration continues after one failure',async()=>{
  const f=simulation((io,state)=>{
    const mutate=io.corruptReceipt;io.corruptReceipt=async(...args)=>{await mutate(...args);throw Error('Lost mutation acknowledgement');};
    const restore=io.restoreReceipt;let failed=false;io.restoreReceipt=async(f,row)=>{await restore(f,row);if(!failed){failed=true;throw Error('Lost restore acknowledgement');}};
  });
  await assert.rejects(probeCompactReceipts(f.binding,f.io));
  assert.ok(f.calls.includes('restore:character_runtime_commands'));assert.deepEqual(f.policy(),f.binding.writerPolicy);
});
test('failed final exact environment invalidates otherwise complete probe',async()=>{
  const f=simulation(io=>{const real=io.observe;let n=0;io.observe=async()=>{const r=await real();if(++n===5)r.environment=['DB_COMPACT_RECEIPTS=0','DB_FROZEN_CATALOGS=0','IMAGE_JOBS_ENABLED=0'];return r;};});
  await assert.rejects(probeCompactReceipts(f.binding,f.io),/policy/);
});
test('rejected real boundary exposes stage/status/code and excludes private response fields',async()=>{
 const f=simulation(io=>{io.request=async()=>({status:409,body:{code:'revision_conflict',error:'private-response-canary'}});});
 await assert.rejects(probeCompactReceipts(f.binding,f.io),error=>{assert.match(error.message,/stage=initial-write; table=roguelike_command_receipts; httpStatus=409; code=revision_conflict/);assert.ok(!error.message.includes('private-response-canary'));return true;});
});
