// Explicit reviewed recovery of a bounded failed first-adoption chain. Never a fallback
// from normal deployed-baseline discovery and never a successful backup proof.
import {readFileSync,realpathSync,lstatSync} from 'node:fs';
import path from 'node:path';
import {evidenceHash} from './validate-manifest.mjs';

const sha=/^[a-f0-9]{40}$/,hash=/^sha256:[a-f0-9]{64}$/,positive=n=>Number.isSafeInteger(n)&&n>0;
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&JSON.stringify(Object.keys(value).sort())===JSON.stringify([...keys].sort());
const date=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const same=(a,b)=>evidenceHash(a)===evidenceHash(b);
export function validateFirstAdoptionRecovery(proof) {
  const chain=[2,3].includes(proof?.schemaVersion);
  if(!exact(proof,['schemaVersion','kind','status','id','repository',chain?'failedDeployments':'failedDeployment','observedAt','auditHash','activeHash','claimedReleaseCommit','components','cleanup'])
    ||![1,2,3].includes(proof.schemaVersion)||proof.kind!=='manual-first-adoption-recovery'||proof.status!=='reviewed-pre-cutover-refusal'
    ||!/^\w[\w.-]*\/[\w.-]+$/.test(proof.repository??'')||!date(proof.observedAt)||!hash.test(proof.auditHash??'')||!hash.test(proof.activeHash??'')||!sha.test(proof.claimedReleaseCommit??''))throw Error('Invalid reviewed first-adoption recovery');
  if(!chain){
    const failed=proof.failedDeployment;
    if(!exact(failed,['runId','runAttempt','controlCommit','conclusion'])||!positive(failed.runId)||failed.runAttempt!==1||!sha.test(failed.controlCommit??'')||failed.conclusion!=='failure'||proof.id!==`${failed.runId}-${failed.runAttempt}`)throw Error('Exact failed first deployment attempt required');
  }else{
    if(!Array.isArray(proof.failedDeployments)||proof.failedDeployments.length<2||proof.failedDeployments.length>8)throw Error('Bounded reviewed failure chain required');
    const seen=new Set();let previous;
    for(const row of proof.failedDeployments){
      const journal=row.stage==='deployment-pre-cutover-refusal';
      if(!exact(row,['runId','runAttempt','controlCommit','conclusion','mode','stage','observedAt','auditHash','recoveryReference',...(row.stage==='rehearsal-historical-replay-refusal'?['rehearsalHash']:journal?['rehearsalHash','operationHash','releaseId']:[])])
        ||!positive(row.runId)||row.runAttempt!==1||!sha.test(row.controlCommit??'')||row.conclusion!=='failure'||row.mode!=='adopt'
        ||!date(row.observedAt)||Date.parse(row.observedAt)>Date.parse(proof.observedAt)||!hash.test(row.auditHash??'')||seen.has(row.runId))throw Error('Exact reviewed chain attempt required');
      if(!previous){if(row.stage!=='rehearsal-start-refusal'||row.recoveryReference!==null)throw Error('Original rehearsal refusal must anchor the chain');}
      else{
        const ref=validateRecoveryReference(row.recoveryReference);
        if(!['pre-capture-recovery-refusal','rehearsal-historical-replay-refusal',...(proof.schemaVersion===3?['deployment-pre-cutover-refusal']:[])].includes(row.stage)
          ||journal&&(!hash.test(row.rehearsalHash??'')||!hash.test(row.operationHash??'')||!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(row.releaseId??''))
          ||row.stage==='rehearsal-historical-replay-refusal'&&!hash.test(row.rehearsalHash??'')||Date.parse(row.observedAt)<=Date.parse(previous.observedAt)
          ||ref.id!==`${previous.runId}-${previous.runAttempt}`||ref.controlCommit!==row.controlCommit)throw Error('Reviewed recovery refusal must bind its previous proof');
      }
      seen.add(row.runId);previous=row;
    }
    if(proof.id!==`${previous.runId}-${previous.runAttempt}`||proof.observedAt!==previous.observedAt||proof.auditHash!==previous.auditHash)throw Error('Recovery identity and audit must name the final reviewed attempt');
    const journals=proof.failedDeployments.filter(row=>row.stage==='deployment-pre-cutover-refusal');
    if(proof.schemaVersion===3&&(!journals.length||new Set(journals.map(row=>row.releaseId)).size!==journals.length))throw Error('Schema3 requires distinct reviewed terminal journals');
  }
  if(!exact(proof.components,['backend','frontend','rulesWorker']))throw Error('Original component identities required');
  for(const row of Object.values(proof.components))if(!exact(row,['containerId','imageId','health'])||!/^[a-f0-9]{64}$/.test(row.containerId??'')||!hash.test(row.imageId??'')||row.health!=='healthy')throw Error('Original healthy component identity required');
  const cleanup={remainingOwnedResources:0,validatorStopped:true,dockerAuthRemoved:true,deploymentJournalCreated:proof.schemaVersion===3,deployLockPresent:false,operatorApplicationMutations:0};
  if(!same(proof.cleanup,cleanup))throw Error('Reviewed refusal must precede every application mutation');
  return proof;
}
export function reviewedRecoveryAttempts(proof){
  validateFirstAdoptionRecovery(proof);
  return proof.schemaVersion!==1?proof.failedDeployments:[{...proof.failedDeployment,mode:'adopt',stage:'rehearsal-start-refusal',observedAt:proof.observedAt,auditHash:proof.auditHash,recoveryReference:null}];
}
export function validateRecoveryReference(ref) {
  if(!exact(ref,['id','proofHash','controlCommit'])||!/^[1-9]\d*-[1-9]\d*$/.test(ref.id??'')||!hash.test(ref.proofHash??'')||!sha.test(ref.controlCommit??''))throw Error('Invalid first-adoption recovery reference');
  return ref;
}
export function recoveryFields(ref) {return ref===undefined?{}:{firstAdoptionRecovery:validateRecoveryReference(ref)};}
export function loadControlRecovery({id,controlRoot,controlCommit,repository,reference},ancestry=[]) {
  if(ancestry.length>=8||ancestry.includes(id))throw Error('Reviewed recovery proof traversal is cyclic or exceeds its bound');
  if(!/^[1-9]\d*-1$/.test(id??'')||!sha.test(controlCommit??''))throw Error('Invalid reviewed recovery selection');
  const root=path.resolve(controlRoot),file=path.join(root,'infra','first-adoption-recoveries',`${id}.json`);
  if(realpathSync(file)!==file||lstatSync(file).isSymbolicLink()||lstatSync(file).size>16384)throw Error('Recovery must be a bounded exact control file');
  const proof=validateFirstAdoptionRecovery(JSON.parse(readFileSync(file,'utf8')));
  if(proof.id!==id||proof.repository!==repository)throw Error('Recovery repository or identity differs');
  const ref={id,proofHash:evidenceHash(proof),controlCommit};
  if(reference&&!same(validateRecoveryReference(reference),ref))throw Error('Recovery differs from the reviewed release control source');
  if(proof.schemaVersion!==1)for(let i=1;i<proof.failedDeployments.length;i++){
    const row=proof.failedDeployments[i],prior=loadControlRecovery({id:row.recoveryReference.id,controlRoot:root,controlCommit:row.controlCommit,repository,reference:row.recoveryReference},[...ancestry,id]).proof;
    if(!same(reviewedRecoveryAttempts(prior),proof.failedDeployments.slice(0,i))
      ||!same(prior.components,proof.components)||prior.activeHash!==proof.activeHash||prior.claimedReleaseCommit!==proof.claimedReleaseCommit)throw Error('Reviewed chain differs from its trusted prior proof');
  }
  return {proof,reference:ref};
}
async function list(get,route,key) {
  let total,rows=[];const seen=new Set();
  for(let page=1;page<=100;page++) {
    const response=await get(`${route}${route.includes('?')?'&':'?'}per_page=100&page=${page}`),batch=response?.[key];
    if(!Number.isSafeInteger(response?.total_count)||response.total_count<0||response.total_count>999||total!==undefined&&total!==response.total_count||!Array.isArray(batch)||batch.length>100||!batch.length&&rows.length!==response.total_count)throw Error('Recovery history is incomplete or changed');
    total=response.total_count;
    for(const item of batch){if(!positive(item?.id)||seen.has(item.id))throw Error('Recovery history identity is ambiguous');seen.add(item.id);rows.push(item);}
    if(rows.length>total)throw Error('Recovery history count differs');
    if(rows.length===total)return rows;
  }
  throw Error('Recovery history bound exceeded');
}
function identity(run,repository) {
  if(!positive(run?.id)||!positive(run.run_attempt)||run.path!=='.github/workflows/deploy.yml'||run.head_branch!=='main'||run.repository?.full_name!==repository||run.head_repository?.full_name!==repository||!sha.test(run.head_sha??'')||!['workflow_dispatch','workflow_run'].includes(run.event))throw Error('Untrusted recovery workflow metadata');
  return {id:run.id,attempt:run.run_attempt,controlCommit:run.head_sha,status:run.status,conclusion:run.conclusion,event:run.event};
}
export async function assertRecoveredInitialHistory(get,{proof,currentDeployment,now=Date.now()}) {
  const attempts=reviewedRecoveryAttempts(proof),expected=new Map(attempts.map(row=>[row.runId,row]));
  if(typeof get!=='function'||!Number.isFinite(now)||Date.parse(proof.observedAt)>now)throw Error('Invalid recovery metadata context');
  if(currentDeployment&&(!exact(currentDeployment,['id','attempt','controlCommit'])||!positive(currentDeployment.id)||currentDeployment.attempt!==1||!sha.test(currentDeployment.controlCommit??'')||expected.has(currentDeployment.id)))throw Error('Invalid current trusted deployment exclusion');
  // Unfiltered history includes queued/in-progress operations. Do not infer
  // safety from only the latest completed run or its green workflow conclusion.
  const runs=await list(get,'actions/workflows/deploy.yml/runs','workflow_runs');const found=new Set();let currentFound=false;
  for(const listed of runs) {
    const item=identity(listed,proof.repository),fresh=identity(await get(`actions/runs/${item.id}`),proof.repository);
    if(!same(item,fresh)||item.attempt!==1)throw Error('Changed or rerun deployment history requires separate recovery');
    if(currentDeployment&&item.id===currentDeployment.id) {
      if(item.attempt!==currentDeployment.attempt||item.controlCommit!==currentDeployment.controlCommit||item.event!=='workflow_dispatch'||!['queued','in_progress'].includes(item.status)||item.conclusion!==null)throw Error('Current recovery deployment identity differs');
      currentFound=true;continue;
    }
    if(item.status!=='completed')throw Error('Another deployment is in progress or its outcome is unknown');
    const jobs=await list(get,`actions/runs/${item.id}/jobs?filter=latest`,'jobs'),actual=jobs.filter(job=>job.name==='deploy');
    if(actual.length!==1)throw Error('Recovery deploy job is absent or ambiguous');
    const job=actual[0];
    if(job.run_id!==item.id||job.head_sha!==item.controlCommit||job.run_attempt!==undefined&&job.run_attempt!==item.attempt||job.status!=='completed')throw Error('Recovery deploy job identity differs');
    if(expected.has(item.id)) {
      const row=expected.get(item.id);
      if(item.controlCommit!==row.controlCommit||item.event!=='workflow_dispatch'||item.conclusion!=='failure'||job.conclusion!=='failure'||!Number.isFinite(Date.parse(job.completed_at))||Date.parse(job.completed_at)>Date.parse(row.observedAt))throw Error('Reviewed failed deployment attempt differs');
      found.add(item.id);
    } else if(job.conclusion!=='skipped'||!['success','failure','cancelled','skipped'].includes(item.conclusion))throw Error('Prior successful or unreviewed actual deployment requires normal recovery');
    if(!same(item,identity(await get(`actions/runs/${item.id}`),proof.repository)))throw Error('Deployment changed during recovery discovery');
  }
  if(found.size!==expected.size||currentDeployment&&!currentFound)throw Error('Reviewed failed or current deployment is absent from complete history');
  return proof.schemaVersion===1?{status:'reviewed-initial-only',failedRunId:proof.failedDeployment.runId,failedRunAttempt:1}
    :{status:'reviewed-initial-only',reviewedFailedDeployments:attempts.map(({runId,runAttempt})=>({runId,runAttempt}))};
}
