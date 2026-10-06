import assert from 'node:assert/strict';
import {evidenceHash,requiredWriterOutcomes} from './validate-manifest.mjs';
import {assertRuntimeWriterPolicy} from './writer-environment.mjs';
import {validateWriterTrace} from './writer-traces.mjs';
const off={compactReceipts:false,imageJobs:false,frozenCatalogs:false};
const same=(a,b)=>assert.equal(evidenceHash(a),evidenceHash(b),'Policy transition altered persisted state');
function accepted(f,r,retry){assert.equal(r.status,200);const body=structuredClone(r.body);if(f.table==='character_runtime_commands'){assert.equal(body.replayed,retry);body.replayed=false;}return body;}

export async function probeWriterPolicySequence({binding,adapter,compactIO,jobsIO}){
 assert.equal(adapter.execution,'docker');await adapter.assertOwned();
 const required=requiredWriterOutcomes({writerPolicy:binding.writerPolicy},binding.previous.state.manifest,binding.previous.identities);
 const on={compactReceipts:required.includes('compact-receipt-cross-image-retry'),imageJobs:required.includes('image-job-cross-image-retry'),frozenCatalogs:false};
 const receipts=[],jobs=[],rows=[];let failure;
 async function start(role,policy){await adapter.start({role,...policy,releaseId:binding[role].identities.backend.releaseId});const observed=await adapter.observe();same(observed.images,binding[role].images);same(observed.identities,binding[role].identities);assertRuntimeWriterPolicy(observed.environment,{manifest:{writerPolicy:policy}});return observed;}
 async function counters(){return {worker:await adapter.workerCalls(),provider:await adapter.imageStats()};}
 async function read(id,observed,policy){
  const before=await counters(),saved=[];
  for(const f of receipts){const invariant=await compactIO.invariant(f),response=accepted(f,await compactIO.request(f),true);same(response,f.response);same(await compactIO.readReceipt(f),f.stored);same(invariant,await compactIO.invariant(f));saved.push({table:f.table,commandId:f.commandId,responseHash:evidenceHash(response),storageHash:evidenceHash(f.stored)});}
  const identities=[];for(const row of jobs){const loaded=await jobsIO.read(row),retried=await jobsIO.retry(row);assert.equal(loaded.status,200);assert.equal(retried.status,202);same(loaded.body.job,row.saved);same(retried.body.job,row.saved);assert.equal((await jobsIO.readOtherOwner(row)).status,404);identities.push({jobId:row.jobId,responseHash:evidenceHash(row.saved)});}
  const after=await counters();same(before,after);assert.equal(after.provider.unexpected,0);
  rows.push({id,backendImage:observed.images.backend,effectivePolicy:policy,receiptResponseHash:evidenceHash(saved),jobIdentityHash:evidenceHash(identities)});
 }
 try{
  let observed=await start('candidate',on);
  if(on.compactReceipts)for(const f of await compactIO.fixtures()){const response=accepted(f,await compactIO.request(f),false),stored=await compactIO.readReceipt(f);assert.equal(stored.response_version,2);receipts.push({...f,response,stored});}
  // Settled jobs are appropriate here: a queued job legitimately dispatches
  // once upon re-enabling. Queue/lease semantics are a separate actual probe.
  if(on.imageJobs)for(const row of await jobsIO.createSettledCases()){const loaded=await jobsIO.read(row);assert.equal(loaded.status,200);assert.equal(loaded.body.job.state,row.id);jobs.push({...row,saved:loaded.body.job});}
  await read('enabled',observed,on);await adapter.stopApplications();observed=await start('previous',off);await read('previous-off',observed,off);
  await adapter.stopApplications();observed=await start('candidate',on);await read('enabled-again',observed,on);
 }catch(error){failure=error;}finally{try{await adapter.stopApplications();}catch(error){failure??=error;}}
 if(failure)throw failure;
 const trace={schemaVersion:1,kind:'writer-compatibility-trace',execution:'docker',outcomeId:'enabled-off-enabled-rollback',bindingHash:evidenceHash(binding),observations:rows};validateWriterTrace(trace,trace.outcomeId,binding);return trace;
}
