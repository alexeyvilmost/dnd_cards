// Synthetic fault tests only. These values are never saved as actual OCI evidence.
import test from 'node:test';import assert from 'node:assert/strict';import {gzipSync} from 'node:zlib';import {createHash} from 'node:crypto';
import {probeExpandedWriterRestore} from './expanded-writer-restore.mjs';import {evidenceHash} from './validate-manifest.mjs';
const h=c=>'sha256:'+c.repeat(64),families=['roguelike_command_receipts','character_runtime_commands'];
function fixture(){
 let apps=false,role='candidate',policy,restored=false,worker=0,provider=0,uploads=0,snapshots=0;const log=[],records=new Map(),initialEffects=[];
 const binding={candidate:{images:{backend:h('1')},identities:{backend:{releaseId:'candidate'}}},previous:{images:{backend:h('1')},identities:{backend:{releaseId:'previous'}}}};
 const data={schema:{migrations:['298','299','300'],schemaFingerprint:h('2')},objectsHash:h('3'),rows:[{name:families[0],rows:1,digest:'a'.repeat(64)},{name:families[1],rows:1,digest:'b'.repeat(64)},{name:'image_jobs',rows:4,digest:'c'.repeat(64)}],sequences:[],versions:{rogue:1,character:1,jobs:4},artifacts:[{path:'current.cjs',bytes:42,sha256:h('4')}]};
 const jobs=['queued','succeeded','unknown','expired-running'].map((id,i)=>({id,jobId:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,body:{}}));
 const start=async(r,p)=>{assert.equal(apps,false);apps=true;role=r;policy=p;log.push('start:'+r);};const stop=async()=>{apps=false;log.push('stop');};
 const adapter={execution:'docker',assertOwned:async()=>{},stopApplications:stop,observe:async()=>({...binding[role],environment:[`DB_COMPACT_RECEIPTS=${policy.compactReceipts?1:0}`,`IMAGE_JOBS_ENABLED=${policy.imageJobs?1:0}`,'DB_FROZEN_CATALOGS=0']}),
  workerCalls:async()=>worker,imageStats:async()=>({unexpected:0,providerCalls:provider,storageUploads:uploads}),dumpDatabase:async()=>{assert.equal(apps,false);log.push('dump');return {sha256:h('5'),bytes:100,createdAt:'2026-10-05T00:00:00Z'};},restoreDatabase:async()=>{assert.equal(apps,false);restored=true;log.push('restore');return {sourceRetained:true,sourceDatabase:'test_'+'a'.repeat(24),restoredDatabase:'test_'+'a'.repeat(24)+'_restored_1',markerVerified:true,dumpHash:h('5')};}};
 const compactIO={initialEffects,start,stop,fixtures:async()=>families.map((table,i)=>({table,commandId:String(i)})),request:async f=>{
  let r=records.get(f.table),retry=Boolean(r);if(!r){worker++;initialEffects.push({table:f.table});const body={value:f.table,padding:'x'.repeat(2000),...(f.table===families[1]?{replayed:false}:{})},raw=Buffer.from(JSON.stringify(body));r={body,stored:{command_id:f.commandId,response_version:2,response:{},response_length:raw.length,response_sha256:createHash('sha256').update(raw).digest('hex'),response_payload_base64:gzipSync(raw).toString('base64')}};records.set(f.table,r);}
  return {status:200,body:{...r.body,...(f.table===families[1]?{replayed:retry}:{})}};
 },readReceipt:async f=>structuredClone(records.get(f.table).stored),invariant:async()=>({worker})};
 const jobsIO={start,stop,createCases:async()=>{provider=3;uploads=1;return jobs;},expireHeldLease:async()=>{assert.equal(apps,false);return {stateAfter:'running',leaseExpired:true};},read:async row=>({status:200,body:{job:{id:row.jobId,state:row.id==='expired-running'?'unknown':row.id}}}),retry:async row=>({status:202,body:{job:{id:row.jobId,state:row.id==='expired-running'?'unknown':row.id}}}),readOtherOwner:async()=>({status:404})};
 const snapshot=async()=>{assert.equal(apps,false);snapshots++;return structuredClone(data);};
 return {binding,adapter,compactIO,jobsIO,snapshot,data,log,get restored(){return restored;},get snapshots(){return snapshots;},get stopped(){return !apps;},incrementWorker:()=>worker++};
}
test('combined restore requires stopped processes, a new retained-source database and exact retries after restart',async()=>{
 const f=fixture(),r=await probeExpandedWriterRestore(f);assert.equal(r.status,'passed');assert.equal(r.deployable,false);assert.equal(f.snapshots,4);assert.equal(f.restored,true);assert.equal(f.stopped,true);
 assert.equal(r.snapshot.beforeHash,r.snapshot.afterHash);assert.equal(r.snapshot.beforeHash,r.snapshot.finalHash);assert.equal(r.reads.length,3);assert.ok(r.reads.every(row=>row.responsesHash===r.reads[0].responsesHash));assert.equal(f.log.filter(v=>v==='restore').length,1);
});
test('changed restored bytes fail before any OFF reader is started',async()=>{
 const f=fixture(),original=f.snapshot;f.snapshot=async()=>{const v=await original();if(f.restored)v.rows[0].digest='f'.repeat(64);return v;};await assert.rejects(probeExpandedWriterRestore(f),/Exact saved data differs/);assert.equal(f.stopped,true);assert.equal(f.log.slice(f.log.indexOf('restore')+1).some(v=>v.startsWith('start:')),false);
});
test('a retry that executes worker again cannot become a restore proof',async()=>{
 const f=fixture(),original=f.compactIO.request;let n=0;f.compactIO.request=async row=>{const value=await original(row);if(++n>2)f.incrementWorker();return value;};await assert.rejects(probeExpandedWriterRestore(f),/Exact saved data differs/);assert.equal(f.stopped,true);assert.equal(f.restored,false);
});
test('same database restore or missing original source preservation is rejected',async()=>{
 for(const change of [{sourceDatabase:'same',database:'same',sourceRetained:true},{sourceDatabase:'one',database:'two',sourceRetained:false}]){const f=fixture();f.adapter.restoreDatabase=async()=>change;await assert.rejects(probeExpandedWriterRestore(f));assert.equal(f.stopped,true);}
});
