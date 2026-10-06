import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const requireId=value=>{assert.match(value,uuid);return value;};
const route='/images/jobs/generate-standalone';

export async function imageJobCommandIO(adapter,accounts,binding){
 let tokens=null,applicationsStopped=true;
 const creation=[];
 function accepted(response,status,phase){
  if(response?.status!==status)throw Error(`Owned image job ${phase} returned HTTP ${Number.isInteger(response?.status)?response.status:0}; code=${/^[a-z0-9_]+$/.test(response?.body?.code??'')?response.body.code:'unavailable'}`);
  return response.body;
 }
 const submit=(row,token=tokens.admin)=>adapter.request(route,{method:'POST',token,body:row.body,headers:{'Idempotency-Key':row.jobId}});
 const read=row=>adapter.request('/images/jobs/'+requireId(row.jobId),{token:tokens.admin});
 async function login(){
  if(tokens)return;
  await adapter.assertOwned();
  // An equally privileged second administrator tests ownership rather than a
  // coarse middleware rejection. This disposable dump contains synthetic users.
  const peer=requireId(accounts.peer.id),owner=requireId(accounts.admin.id);
  const proof=JSON.parse(await adapter.query(`UPDATE users SET is_admin=true WHERE id='${peer}' AND deleted_at IS NULL; SELECT json_build_object('admins',(SELECT count(*) FROM users WHERE id IN ('${peer}','${owner}') AND is_admin AND deleted_at IS NULL));`));
  assert.equal(proof.admins,2);tokens={};
  for(const role of ['admin','peer']){
   const body=accepted(await adapter.request('/auth/login',{method:'POST',body:{username:accounts[role].username,password:accounts[role].password}}),200,'login');
   assert.equal(typeof body.token,'string');tokens[role]=body.token;
   const list=accepted(await adapter.request('/images/jobs',{token:tokens[role]}),200,'authorized-history');
   assert.deepEqual(list.jobs,[]);
  }
 }
 async function awaitState(row,state){
  const deadline=Date.now()+60000;
  while(Date.now()<deadline){
   const result=accepted(await read(row),200,'read-'+row.id);
   assert.equal(result.job.id,row.jobId);
   if(result.job.state===state)return result.job;
   if(['failed','unknown','succeeded'].includes(result.job.state))throw Error(`Owned image job ${row.id} reached unexpected terminal state ${result.job.state}; code=${/^[a-z0-9_]+$/.test(result.job.problem?.code??'')?result.job.problem.code:'unavailable'}`);
   await new Promise(resolve=>setTimeout(resolve,150));
  }
  throw Error('Owned image job phase did not settle: '+row.id);
 }
 async function create(id,mode,state){
  const jobId=randomUUID(),row={id,jobId,body:{prompt:'owned-image-job:'+jobId,quality:'low'}};
  await adapter.imageControl({id:jobId,mode});
  const saved=accepted(await submit(row),202,'create-'+id);assert.equal(saved.job.id,jobId);
  await awaitState(row,state);
  if(mode==='hold'){
   const deadline=Date.now()+10000;
   while(Date.now()<deadline){const stats=await adapter.imageStats();if(stats.jobs.find(j=>j.id===jobId)?.calls===1&&stats.held===1)break;await new Promise(r=>setTimeout(r,100));}
   const stats=await adapter.imageStats();assert.equal(stats.jobs.find(j=>j.id===jobId)?.calls,1);assert.equal(stats.held,1);
  }
  creation.push({id,jobId,state,mode});return row;
 }
 return {
  execution:adapter.execution,creation,assertOwned:()=>adapter.assertOwned(),
  start:async(role,policy)=>{assert.equal(policy.frozenCatalogs,false);await adapter.start({role,compactReceipts:policy.compactReceipts,imageJobs:policy.imageJobs,releaseId:binding[role].identities.backend.releaseId});applicationsStopped=false;},
  stop:async()=>{await adapter.stopApplications();applicationsStopped=true;},observe:()=>adapter.observe(),providerStats:()=>adapter.imageStats(),
  createCases:async()=>{await login();const succeeded=await create('succeeded','success','succeeded'),unknown=await create('unknown','unknown','unknown'),running=await create('expired-running','hold','running'),queued=await create('queued','success','queued');return [queued,succeeded,unknown,running];},
  createSettledCases:async()=>{await login();return [await create('succeeded','success','succeeded'),await create('unknown','unknown','unknown')];},
  read,retry:row=>submit(row),readOtherOwner:row=>adapter.request('/images/jobs/'+requireId(row.jobId),{token:tokens.peer}),
  newRequest:()=>submit({jobId:randomUUID(),body:{prompt:'owned-image-job:new-request-must-not-dispatch',quality:'low'}}),
  expireHeldLease:async row=>{
   assert.equal(applicationsStopped,true);await adapter.assertOwned();const id=requireId(row.jobId),owner=requireId(accounts.admin.id),before=await adapter.imageStats();
   const value=JSON.parse(await adapter.query(`WITH changed AS (UPDATE image_jobs SET lease_until=NOW()-INTERVAL '1 second' WHERE id='${id}' AND owner_id='${owner}' AND state='running' AND lease_until IS NOT NULL RETURNING state,lease_until) SELECT json_build_object('count',count(*),'state',min(state),'expired',bool_and(lease_until < NOW())) FROM changed;`));
   assert.equal(value.count,1);assert.equal(value.state,'running');assert.equal(value.expired,true);const after=await adapter.imageStats();assert.equal(after.providerCalls,before.providerCalls);
   return {jobId:id,mode:'owned-expired-lease-after-process-stop',stateBefore:'running',stateAfter:'running',leaseExpired:true,providerCallsBefore:before.providerCalls,providerCallsAfter:after.providerCalls};
  }
 };
}
