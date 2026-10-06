import {evidenceHash} from './validate-manifest.mjs';
import {assertRuntimeWriterPolicy} from './writer-environment.mjs';
import {validateWriterTrace} from './writer-traces.mjs';
const off={compactReceipts:false,imageJobs:false,frozenCatalogs:false};
const on={...off,imageJobs:true};
const phases=['queued','succeeded','unknown','expired-running'];
const same=(a,b)=>evidenceHash(a)===evidenceHash(b);
function requireThat(value,message){if(!value)throw Error(message);}

/** Real canonical job creation + provider/S3 protocol peers belong to the owned IO.
 * Only the running lease timestamp is aged after the process stops; no result,
 * provider response, job state, fingerprint or accepted identity is fabricated.
 */
export async function probeImageJobs(binding,io){
  await io.assertOwned();requireThat(['docker','simulation'].includes(io.execution),'Explicit owned execution required');
  const trace={schemaVersion:1,kind:'writer-compatibility-trace',execution:io.execution,outcomeId:'image-job-cross-image-retry',bindingHash:evidenceHash(binding),observations:[],leaseFixture:null};
  let failure,cases=[];
  async function start(role,policy){
    await io.start(role,policy);const observed=await io.observe(role);
    requireThat(same(observed.images,binding[role].images)&&same(observed.identities,binding[role].identities),'Actual job reader image or launch identity differs');
    assertRuntimeWriterPolicy(observed.environment,{manifest:{writerPolicy:policy}});
  }
  async function read(row){const response=await io.read(row);requireThat(response?.status===200&&response.body?.job?.id===row.jobId,'Saved job identity unavailable');return response;}
  async function stats(){const value=await io.providerStats();requireThat(value.unexpected===0&&Number.isSafeInteger(value.providerCalls)&&Number.isSafeInteger(value.storageUploads),'Local image protocol counters invalid');return value;}
  const calls=(value,row)=>value.jobs.find(job=>job.id===row.jobId)?.calls??0;
  try{
    await start('candidate',on);cases=await io.createCases();
    requireThat(Array.isArray(cases)&&same(cases.map(row=>row.id),phases)&&new Set(cases.map(row=>row.jobId)).size===4,'Distinct canonical image job phases required');
    const before=await stats();
    requireThat(before.providerCalls===3&&before.storageUploads===1,'Job fixtures did not execute three attempts and one stored image');
    for(const row of cases){const result=await read(row);requireThat(result.body.job.state===(row.id==='expired-running'?'running':row.id),'Canonical job did not reach required phase');requireThat(calls(before,row)===(row.id==='queued'?0:1),'Unexpected initial provider count');}
    await io.stop();trace.leaseFixture=await io.expireHeldLease(cases.find(row=>row.id==='expired-running'));
    await start('previous',off);
    for(const row of cases){
      const own=await read(row),expected=row.id==='expired-running'?'unknown':row.id;
      requireThat(own.body.job.state===expected,'OFF reader changed saved job outcome');
      const afterOff=await stats(),retry=await io.retry(row),afterRetry=await stats();
      requireThat(retry.status===202&&same(retry.body.job,own.body.job),'OFF retry did not retain exact accepted job');
      const other=await io.readOtherOwner(row);requireThat(other.status===404,'Another equally authorized owner accessed saved job');
      const fresh=await io.newRequest(row);requireThat(fresh.status===503&&fresh.body?.outcome==='not_started','OFF new job admission was not explicitly rejected');
      requireThat(before.providerCalls===afterOff.providerCalls&&before.providerCalls===afterRetry.providerCalls,'OFF reader or retry dispatched provider');
      trace.observations.push({id:row.id,jobId:row.jobId,statusBefore:row.id==='expired-running'?'running':row.id,statusAfterOff:own.body.job.state,
        providerBefore:calls(before,row),providerAfterOff:calls(afterOff,row),providerAfterRetry:calls(afterRetry,row),sameOwnerStatus:own.status,otherOwnerStatus:other.status,newJobOffStatus:fresh.status,newJobOffOutcome:fresh.body.outcome,
        statusAfterOffRestart:null,providerAfterOffRestart:null});
    }
    await io.stop();await start('previous',off);
    for(let index=0;index<cases.length;index++){
      const row=cases[index],saved=trace.observations[index],result=await read(row),retry=await io.retry(row);
      requireThat(result.body.job.state===saved.statusAfterOff&&retry.status===202&&same(retry.body.job,result.body.job),'OFF process restart lost durable job or redispatched it');
      const afterRestart=await stats();requireThat(before.providerCalls===afterRestart.providerCalls&&before.storageUploads===afterRestart.storageUploads,'OFF restart dispatched provider/storage');
      saved.statusAfterOffRestart=result.body.job.state;saved.providerAfterOffRestart=calls(afterRestart,row);
    }
  }catch(error){failure=error;}
  finally{try{await io.stop();await start('candidate',binding.writerPolicy);}catch(error){failure??=error;}}
  if(failure)throw failure;
  if(io.execution==='docker')validateWriterTrace(trace,trace.outcomeId,binding);
  return trace;
}
