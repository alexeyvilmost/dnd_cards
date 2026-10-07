// Only actual successful deploy receipts authorize a new verification request.
// No retries of host operations or published candidates are performed here.
import {selectLatestDeployedRun} from './deployed-baseline.mjs';
import {validateBuildPlan,verifyBaseline} from './ci-release.mjs';
import {verifyCandidateProvenance} from './deployment-handoff.mjs';
import {evidenceHash} from './validate-manifest.mjs';

const sha=/^[a-f0-9]{40}$/, digest=/^sha256:[a-f0-9]{64}$/;
const positive=n=>Number.isSafeInteger(n)&&n>0;
const same=(a,b)=>evidenceHash(a)===evidenceHash(b);
const timestamp=value=>{
  const match=typeof value==='string'&&/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/.exec(value);
  if(!match)return NaN;const canonical=`${match[1]}.${(match[2]??'').padEnd(3,'0')}Z`,ms=Date.parse(canonical);
  return Number.isFinite(ms)&&new Date(ms).toISOString()===canonical?ms:NaN;
};
export const automaticVariables=['RELEASE_BUILD_ENABLED','AUTO_RELEASE_MAIN_ENABLED','RELEASE_PUBLICATION_ENABLED','PRODUCTION_DEPLOY_ENABLED','AUTO_DEPLOY_MAIN_ENABLED','AUTO_RECONCILE_MAIN_ENABLED'];
export function reconciliationEnabled(variables,policy){
  return automaticVariables.every(key=>variables[key]==='true')&&policy?.schemaVersion===1&&policy.productionEnabled===true&&policy.autoDeployMain===true;
}
export async function readConvergenceBaseline(get,repository){return selectLatestDeployedRun(get,{repository});}

export async function preflightAutomaticDeployment({eventName,candidate,releaseRun,latest,manifest,receipt,retirementObservation,repository,get}){
  verifyCandidateProvenance(candidate,releaseRun);
  if(!['workflow_run','workflow_dispatch'].includes(eventName))throw Error('Unsupported deployment request');
  // Historical immutable manual candidates may predate embedded build plans.
  // Their canonical host verification/rollback contract remains unchanged.
  if(eventName==='workflow_dispatch')return {status:'ready',candidateAvailable:true,automatic:false};
  const plan=validateBuildPlan(candidate.buildPlan);
  if(plan.planHash!==candidate.provenance.planHash||plan.candidate!==candidate.manifest.releaseCommit
    ||plan.repository!==repository||plan.releaseRunId!==releaseRun.id||plan.controlCommit!==releaseRun.controlCommit
    ||candidate.manifest.previousReleaseId!==(plan.previousManifest?.releaseId??null))throw Error('Candidate build plan provenance mismatch');
  if(!latest&&plan.previousManifest)throw Error('Previously deployed baseline is unavailable; inspect history');
  if(latest){verifyBaseline(manifest,receipt,latest,retirementObservation);}else if(manifest||receipt||retirementObservation!==undefined)throw Error('Unexpected baseline receipt');
  if(!same(latest,await readConvergenceBaseline(get,repository)))throw Error('Deployment baseline changed during preflight');
  const head=(await get('commits/main')).sha;if(!sha.test(head??''))throw Error('Invalid main identity');
  if(head!==plan.candidate)return {status:'superseded',candidateAvailable:false,reason:'newer-main-source'};
  if(!same(plan.previousManifest,manifest??null))return {status:'superseded',candidateAvailable:false,reason:'newer-successful-deployment'};
  return {status:'ready',candidateAvailable:true,automatic:true};
}

async function pages(get,route,key){
  const result=[],seen=new Set();let total;
  for(let page=1;page<=10;page++){
    const response=await get(`${route}${route.includes('?')?'&':'?'}per_page=100&page=${page}`),rows=response?.[key];
    if(!Number.isSafeInteger(response?.total_count)||response.total_count<0||response.total_count>=1000
      ||total!==undefined&&total!==response.total_count||!Array.isArray(rows)||rows.length>100)throw Error('Incomplete reconciliation history');
    total=response.total_count;
    for(const row of rows){if(!positive(row?.id)||seen.has(row.id))throw Error('Ambiguous reconciliation history');seen.add(row.id);result.push(row);}
    if(result.length===total)return result;
    if(rows.length===0||result.length>total)throw Error('Incomplete reconciliation history');
  }
  throw Error('Reconciliation history limit reached');
}
function coordinatorIdentity(run,repository){
  if(!positive(run?.id)||!positive(run.run_attempt)||run.path!=='.github/workflows/reconcile.yml'||run.event!=='workflow_run'
    ||run.head_branch!=='main'||run.repository?.full_name!==repository||run.head_repository?.full_name!==repository
    ||!sha.test(run.head_sha??'')||!Number.isFinite(timestamp(run.created_at))||timestamp(run.created_at)>Date.now()
    ||!['queued','in_progress','completed','waiting','pending','requested'].includes(run.status))throw Error('Untrusted reconciliation coordinator');
  return run;
}
export function validateReconciliationRequest(request){
  const fields=['schemaVersion','repository','source','deployedRunId','deployedRunAttempt','manifestHash','coordinatorRunId','coordinatorRunAttempt','key'];
  if(!request||Object.keys(request).some(key=>!fields.includes(key))||request.schemaVersion!==1||!/^\w[\w.-]*\/[\w.-]+$/.test(request.repository??'')
    ||!sha.test(request.source??'')||!positive(request.deployedRunId)||!positive(request.deployedRunAttempt)||!digest.test(request.manifestHash??'')
    ||!positive(request.coordinatorRunId)||request.coordinatorRunAttempt!==1)throw Error('Invalid bounded reconciliation request');
  const key=evidenceHash({repository:request.repository,source:request.source,deployedRunId:request.deployedRunId,deployedRunAttempt:request.deployedRunAttempt,manifestHash:request.manifestHash});
  if(request.key!==key)throw Error('Reconciliation request key mismatch');return request;
}
const claimName=request=>`reconcile-claim-${request.key.slice(7)}`;
export async function planReconciliation({event,eventName,repository,controlCommit,runId,runAttempt,variables,policy,latest,manifest,receipt,retirementObservation,get}){
  if(!reconciliationEnabled(variables,policy))return {status:'disabled'};
  if(eventName!=='workflow_run'||event?.repository?.full_name!==repository||!sha.test(controlCommit??''))throw Error('Trusted main deployment event required');
  const upstream=event.workflow_run;
  if(upstream?.path!=='.github/workflows/deploy.yml'||upstream.head_branch!=='main'||upstream.repository?.full_name!==repository
    ||upstream.head_repository?.full_name!==repository||upstream.status!=='completed'||upstream.conclusion!=='success'
    ||!positive(upstream.id)||!positive(upstream.run_attempt)||!sha.test(upstream.head_sha??''))throw Error('Actual successful main deployment required');
  const current=coordinatorIdentity(await get(`actions/runs/${runId}`),repository);
  if(current.id!==runId||current.run_attempt!==runAttempt||current.head_sha!==controlCommit||current.status!=='in_progress')throw Error('Reconciliation control identity mismatch');
  // A repeated/unknown POST must never be sent again on a workflow rerun.
  if(runAttempt!==1)return {status:'already-attempted',reason:'coordinator-rerun'};
  const fresh=await readConvergenceBaseline(get,repository);
  if(!same(fresh,latest))throw Error('Downloaded deployment evidence changed');
  if(!latest||latest.id!==upstream.id||latest.runAttempt!==upstream.run_attempt)return {status:'superseded',reason:'newer-actual-deployment'};
  if(latest.controlCommit!==upstream.head_sha)throw Error('Deployment event identity mismatch');
  verifyBaseline(manifest,receipt,latest,retirementObservation);
  const title=`Reconcile deployed ${latest.id}/${latest.runAttempt}`;
  if(current.display_title!==title)throw Error('Coordinator is not bound to triggering deployment');
  const history=await pages(get,'actions/workflows/reconcile.yml/runs?branch=main&event=workflow_run','workflow_runs');
  if(!history.some(run=>run.id===current.id))throw Error('Current coordinator missing from history');
  for(const run of history){
    coordinatorIdentity(run,repository);
    if(run.id!==current.id&&run.display_title===title){
      // The serialized trusted workflow is the sole dispatcher. An earlier
      // invocation, even failed before publishing a claim, is not retried.
      const created=timestamp(run.created_at),ownCreated=timestamp(current.created_at);
      if(!Number.isFinite(created)||!Number.isFinite(ownCreated))throw Error('Coordinator ordering unavailable');
      if(created<ownCreated||created===ownCreated&&run.id<current.id)return {status:'already-attempted',reason:'previous-coordinator'};
    }
  }
  const source=(await get('commits/main')).sha;if(!sha.test(source??''))throw Error('Invalid main identity');
  if(source===manifest.releaseCommit)return {status:'converged'};
  const tuple={repository,source,deployedRunId:latest.id,deployedRunAttempt:latest.runAttempt,manifestHash:evidenceHash(manifest)};
  const request=validateReconciliationRequest({schemaVersion:1,...tuple,coordinatorRunId:runId,coordinatorRunAttempt:runAttempt,key:evidenceHash(tuple)});
  return {status:'planned',request,claimName:claimName(request)};
}
async function assertClaim(get,request){
  const run=coordinatorIdentity(await get(`actions/runs/${request.coordinatorRunId}`),request.repository);
  if(run.run_attempt!==request.coordinatorRunAttempt||!['in_progress','completed'].includes(run.status)
    ||run.status==='completed'&&run.conclusion!=='success'||run.display_title!==`Reconcile deployed ${request.deployedRunId}/${request.deployedRunAttempt}`)throw Error('Reconciliation attempt is no longer trusted');
  const claims=(await pages(get,`actions/runs/${run.id}/artifacts`,'artifacts')).filter(artifact=>artifact.name===claimName(request));
  if(claims.length!==1)throw Error('Immutable dispatch claim missing or ambiguous');
  const claim=claims[0];
  const created=timestamp(claim.created_at),expires=timestamp(claim.expires_at),started=timestamp(run.run_started_at??run.created_at);
  if(claim.expired!==false||!positive(claim.size_in_bytes)||claim.workflow_run?.id!==run.id||claim.workflow_run?.head_sha!==run.head_sha
    ||!Number.isFinite(expires)||expires<=Date.now()||!Number.isFinite(created)||created>Date.now()
    ||!Number.isFinite(started)||created<started)throw Error('Dispatch claim identity or validity mismatch');
  return run;
}
export async function dispatchReconciliation({request,get,post,variables,policy}){
  validateReconciliationRequest(request);
  if(!reconciliationEnabled(variables,policy))return {status:'disabled'};
  await assertClaim(get,request);
  const latest=await readConvergenceBaseline(get,request.repository);
  if(!latest||latest.id!==request.deployedRunId||latest.runAttempt!==request.deployedRunAttempt)return {status:'superseded',reason:'newer-actual-deployment'};
  if((await get('commits/main')).sha!==request.source)return {status:'superseded',reason:'newer-main-source'};
  // Exactly one non-retried HTTP request. A network error is an unknown outcome;
  // retained claim and coordinator identity prevent automatic re-sending.
  await post('actions/workflows/ci.yml/dispatches',{ref:'main',inputs:{suite:'extended',reconcile_request:JSON.stringify(request)}});
  return {status:'dispatched',key:request.key,source:request.source};
}
export async function verifyReconciledCI({request,eventName,ref,source,suite,get,variables,policy}){
  validateReconciliationRequest(request);
  if(!reconciliationEnabled(variables,policy)||eventName!=='workflow_dispatch'||ref!=='refs/heads/main'||suite!=='extended'||source!==request.source)throw Error('Reconciliation requires a fresh full main verification');
  await assertClaim(get,request);
  const latest=await readConvergenceBaseline(get,request.repository);
  if(!latest||latest.id!==request.deployedRunId||latest.runAttempt!==request.deployedRunAttempt||(await get('commits/main')).sha!==source)throw Error('Reconciled verification was superseded');
  return {status:'verified-request',source,key:request.key,suite:'extended'};
}
