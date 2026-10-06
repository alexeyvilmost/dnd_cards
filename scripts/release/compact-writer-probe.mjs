import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {evidenceHash} from './validate-manifest.mjs';
import {assertRuntimeWriterPolicy} from './writer-environment.mjs';
import {validateWriterTrace} from './writer-traces.mjs';
const tables=['roguelike_command_receipts','character_runtime_commands'];
const off={compactReceipts:false,imageJobs:false,frozenCatalogs:false};
const on={...off,compactReceipts:true};
const same=(a,b)=>evidenceHash(a)===evidenceHash(b);
const sha=bytes=>'sha256:'+createHash('sha256').update(bytes).digest('hex');
function requireThat(value,message){if(!value)throw Error(message);}
function accepted(response,stage,table){requireThat(response?.status===200&&response.body&&typeof response.body==='object',`Authoritative command was not accepted: stage=${stage}; table=${table}; httpStatus=${Number.isInteger(response?.status)?response.status:'unavailable'}; code=${/^[a-zA-Z0-9_]+$/.test(response?.body?.code??'')?response.body.code:'unavailable'}`);return response.body;}
function acceptedPayload(f,response,retry){
  if(f.table!=='character_runtime_commands')return {body:response,replayed:null};
  requireThat(response.replayed===retry,'Character command replay transport marker differs');
  return {body:{...response,replayed:false},replayed:response.replayed};
}
function decode(row){
  requireThat(row?.response_version===2&&typeof row.response_payload_base64==='string'&&row.response_payload_base64.length<=Math.ceil(64*1024**2/3)*4&&/^[a-f0-9]{64}$/.test(row.response_sha256)&&Number.isSafeInteger(row.response_length)&&row.response_length>=1024&&row.response_length<=64*1024**2,'Real expanded SQL receipt required');
  const encoded=Buffer.from(row.response_payload_base64,'base64');
  requireThat(encoded.length>0&&encoded.toString('base64')===row.response_payload_base64,'Invalid receipt bytea transport');
  const raw=gunzipSync(encoded,{maxOutputLength:64*1024**2});
  requireThat(raw.length===row.response_length&&sha(raw)==='sha256:'+row.response_sha256&&same(row.response,{}),'Expanded stored bytes fail integrity');
  return {body:JSON.parse(raw.toString('utf8')),storage:{version:2,rawLength:raw.length,encodedLength:encoded.length,rawSHA256:'sha256:'+row.response_sha256,decodedSHA256:sha(raw),rowHash:evidenceHash(row)}};
}
/**
 * Executes requests; it never accepts a caller-provided "passed" result.
 * IO owns disposable clones and exact images. No raw response, auth, prompt,
 * DSN or database rows escape into the returned safe trace.
 *
 * required IO: assertOwned, start(role,policy), stop, observe(role),
 * fixtures() -> two {table,commandId,request} from canonical API producers,
 * request(fixture), readReceipt(fixture) -> exactly one raw SQL row,
 * invariant(fixture) -> gameplay/journal/RNG/resources (excludes mutated row),
 * workerCalls(), newCommand(fixture), corruptReceipt(fixture,field),
 * restoreReceipt(fixture,exactRow). Restores are independent/fail closed.
 */
export async function probeCompactReceipts(binding,io){
  await io.assertOwned();
  requireThat(['docker','simulation'].includes(io.execution),'Explicit adapter execution required');
  const trace={schemaVersion:1,kind:'writer-compatibility-trace',execution:io.execution,outcomeId:'compact-receipt-cross-image-retry',bindingHash:evidenceHash(binding),observations:[],schemaFaults:io.schemaFaults??[],triggerFaults:io.triggerFaults??[]};
  const fixtures=[];let failure;
  async function start(role,policy){
    await io.start(role,policy);const observed=await io.observe(role),expected=binding[role];
    requireThat(expected&&same(observed.images,expected.images)&&same(observed.identities,expected.identities),'Wrong actual image or launch identity');
    assertRuntimeWriterPolicy(observed.environment,{manifest:{writerPolicy:policy}});
  }
  async function retry(f,id){
    const before=await io.invariant(f),workerCallsBefore=await io.workerCalls();
    const {body:response,replayed}=acceptedPayload(f,accepted(await io.request(f),id,f.table),true),workerCallsAfter=await io.workerCalls(),after=await io.invariant(f),stored=await io.readReceipt(f);
    requireThat(same(response,f.response)&&same(before,after)&&same(stored,f.stored)&&workerCallsBefore===workerCallsAfter,'Retry changed authoritative state or reran worker');
    f.row.reads.push({id,responseHash:evidenceHash(response),replayed,beforeInvariantHash:evidenceHash(before),afterInvariantHash:evidenceHash(after),storageHash:evidenceHash(stored),workerCallsBefore,workerCallsAfter});
  }
  try{
    // The ON format probe is explicitly confined to this disposable clone,
    // even when candidate deployment policy is OFF. Original policy is restored
    // before the collector can perform its final health observation.
    await start('candidate',on);
    const produced=await io.fixtures();requireThat(Array.isArray(produced)&&same(produced.map(f=>f.table),tables),'Both real command receipt families required');
    for(const f of produced){
      const {body:response}=acceptedPayload(f,accepted(await io.request(f),'initial-write',f.table),false),stored=await io.readReceipt(f),decoded=decode(stored);
      requireThat(stored.command_id===f.commandId&&same(decoded.body,response),'SQL receipt differs from authoritative HTTP response');
      const row={id:f.table,commandId:f.commandId,requestHash:evidenceHash(f.request),responseHash:evidenceHash(response),storage:decoded.storage,reads:[],offWrite:null,corruptions:[]};
      const value={...f,response,stored,row};fixtures.push(value);trace.observations.push(row);await retry(value,'candidate-retry');
    }
    await io.stop();await start('candidate',on);
    for(const f of fixtures)await retry(f,'candidate-restart-retry');
    await io.stop();await start('previous',off);
    for(const f of fixtures){
      await retry(f,'previous-off-retry');
      const next=await io.newCommand(f);requireThat(next.table===f.table&&next.commandId!==f.commandId,'Distinct canonical OFF command required');
      const {body:response}=acceptedPayload(next,accepted(await io.request(next),'off-write',f.table),false),stored=await io.readReceipt(next);
      requireThat(stored.command_id===next.commandId&&stored.response_version===1&&!stored.response_payload_base64&&!stored.response_sha256&&stored.response_length===0&&same(stored.response,response),'OFF did not write valid v1');
      const before=await io.invariant(next),workerCallsBefore=await io.workerCalls();
      const {body:readback,replayed}=acceptedPayload(next,accepted(await io.request(next),'off-write-retry',f.table),true),after=await io.invariant(next),workerCallsAfter=await io.workerCalls();
      requireThat(same(readback,response)&&same(before,after)&&workerCallsBefore===workerCallsAfter,'New v1 retry changed response, gameplay, or worker work');
      f.row.offWrite={commandId:next.commandId,version:1,responseHash:evidenceHash(response),readbackHash:evidenceHash(readback),replayed,beforeInvariantHash:evidenceHash(before),afterInvariantHash:evidenceHash(after),workerCallsBefore,workerCallsAfter};
    }
    await io.stop();await start('candidate',on);
    for(const f of fixtures){
      await retry(f,'candidate-return-retry');
      for(const field of ['length','hash','version']){
        const before=await io.invariant(f),workerCallsBefore=await io.workerCalls();let response,after,workerCallsAfter,originalFailure;
        try{await io.corruptReceipt(f,field);response=await io.request(f);after=await io.invariant(f);workerCallsAfter=await io.workerCalls();requireThat(response.status>=400&&response.status<600&&same(before,after)&&workerCallsBefore===workerCallsAfter,'Corrupt receipt must fail without gameplay mutation or worker execution');}
        catch(error){originalFailure=error;}
        finally{try{await io.restoreReceipt(f,f.stored);requireThat(same(await io.readReceipt(f),f.stored),'Corruption cleanup did not restore exact row');}catch(error){originalFailure??=error;}}
        if(originalFailure)throw originalFailure;
        f.row.corruptions.push({id:field,httpStatus:response.status,beforeInvariantHash:evidenceHash(before),afterInvariantHash:evidenceHash(after),restoredStorageHash:evidenceHash(f.stored),workerCallsBefore,workerCallsAfter});
      }
    }
  }catch(error){failure=error;}
  finally{
    // Never let a failed restore of one family prevent restoration of the other.
    for(const f of fixtures)try{await io.restoreReceipt(f,f.stored);requireThat(same(await io.readReceipt(f),f.stored),'Receipt cleanup differs');}catch(error){failure??=error;}
    try{await io.stop();await start('candidate',binding.writerPolicy);}catch(error){failure??=error;}
  }
  if(failure)throw failure;
  if(io.execution==='docker')validateWriterTrace(trace,trace.outcomeId,binding);
  return trace;
}
