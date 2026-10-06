// Separate typed operation, never a skip-backup switch on the full deploy path.
import {evidenceHash} from './validate-manifest.mjs';import {validateActive} from './deploy-state.mjs';
import {assertFrontendOnlyReleaseReady} from './ui-release-receipt.mjs';import {runtimeCompatibilityHash} from './ui-release-policy.mjs';
import {assertImmutablePreservation,assertUnchangedRunningRuntime} from './ui-preservation.mjs';
const same=(a,b)=>evidenceHash(a)===evidenceHash(b);
export function assertObservedUIDomain(observation,domain){
  const runtime=observation.protectedRuntime;
  for(const [name,prefix] of [['backend','backend'],['rulesWorker','worker']])if(runtime?.[name]?.configurationHash!==domain[prefix+'ConfigurationHash']
    ||runtime[name].mountsHash!==domain[prefix+'MountsHash']||runtime[name].databaseBindingHash!==domain.databaseBindingHash)throw Error('Protected host runtime differs from approved domain');
  if(observation.databaseBindingHash!==domain.databaseBindingHash||observation.routingSecurityHash!==domain.routingSecurityHash
    ||observation.files?.rootsHash!==domain.immutableRootsHash||observation.databaseReferenceInventory!=='not_executed'
    ||observation.currentDatabaseReferenceCoverage!=='not_asserted')throw Error('Protected host paths/configuration differ');
}
export function planFrontendDeployment(candidate,bundle,active,context){
  validateActive(active);const proof=assertFrontendOnlyReleaseReady(candidate,bundle,context);
  if(!same(active.manifest,context.planning.input.previousManifest)||candidate.previousReleaseId!==active.manifest.releaseId
    ||candidate.releaseId===active.manifest.releaseId)throw Error('Selective candidate does not follow actual active release');
  if(runtimeCompatibilityHash(active.manifest,context.planning.input.previousDomain)!==proof.anchor.runtimeCompatibilityHash)throw Error('Original full anchor incompatible with active runtime');
  const desired={...structuredClone(active),manifest:structuredClone(candidate),instances:{...structuredClone(active.instances),frontend:{releaseId:candidate.releaseId,releaseCommit:candidate.releaseCommit}},uiProofAnchor:proof.anchor};
  return {schemaVersion:1,kind:'frontend-only',candidateHash:evidenceHash(candidate),baselineHash:evidenceHash(active),changed:['frontend'],previous:active,desired,
    domain:context.planning.input.previousDomain,anchor:proof.anchor,eligibilityHash:proof.eligibilityHash,receiptHash:evidenceHash(bundle.rehearsalReceipt),migrationMode:'not-executed'};
}
function preserve(operation,observed){
  assertObservedUIDomain(observed,operation.plan.domain);
  assertUnchangedRunningRuntime(operation.before.protectedRuntime,observed.protectedRuntime);
  assertImmutablePreservation(operation.before.files,observed.files);
}
export async function deployFrontend({store,adapter,candidate,bundle,context}){
  const unlock=store.lock();let operation;
  try{
    const active=store.active(),existing=store.operation(candidate.releaseId);
    if(existing){
      if(existing.kind!=='frontend-only'||existing.plan.candidateHash!==evidenceHash(candidate))throw Error('Release ID collision');
      if(existing.status==='succeeded'&&same(active,existing.plan.desired)){const observed=await adapter.observe(active);preserve(existing,observed);return {...existing,repeated:true};}
      throw Error('Previous outcome requires explicit inspection; no blind retry');
    }
    if(store.pending().length)throw Error('Another pending operation requires recovery');
    const plan=planFrontendDeployment(candidate,bundle,active,context),before=await adapter.observe(active);
    assertObservedUIDomain(before,plan.domain);assertUnchangedRunningRuntime(context.protectedRunning,before.protectedRuntime);assertImmutablePreservation(context.originalAnchor.files,before.files);
    operation={schemaVersion:1,kind:'frontend-only',releaseId:candidate.releaseId,status:'preparing',plan,before,touched:[],createdAt:new Date().toISOString(),databaseSnapshot:'not-created',databaseReferenceInventory:'not_executed'};
    const record=status=>{operation.status=status;operation.updatedAt=new Date().toISOString();store.writeOperation(operation);};record('preparing');
    try{
      await adapter.prepare(plan);
      if(!same(store.active(),active))throw Error('Active release changed during selective preparation');
      preserve(operation,await adapter.observe(active));record('prepared');
      operation.touched=['frontend'];record('replacing:frontend');await adapter.replaceFrontend(plan.desired);
      record('verifying');const after=await adapter.observe(plan.desired);preserve(operation,after);operation.after=after;
      store.writeActive(plan.desired);record('succeeded');return operation;
    }catch(error){
      operation.failure=error.code??'selective-step-failed';
      if(error.uncertainOutcome){record('recovery_required');throw Error('Selective outcome unknown; inspect journal before recovery');}
      if(!operation.touched.length){
        try{if(!same(store.active(),active))throw Error('Active drift');preserve(operation,await adapter.observeProtected(active));}
        catch{record('recovery_required');throw Error('Protected state changed during selective preparation');}
        record('failed_before_cutover');throw error;
      }
      try{
        // No rollback may conceal replacement/configuration drift in services
        // this operation does not own. Frontend health is not required here.
        preserve(operation,await adapter.observeProtected(plan.previous));record('rolling_back');
        await adapter.replaceFrontend(plan.previous);const rolledBack=await adapter.observe(plan.previous);preserve(operation,rolledBack);
        operation.afterRollback=rolledBack;store.writeActive(plan.previous);record('rolled_back');
      }catch{record('recovery_required');throw Error('Selective rollback unverified; preserve evidence and inspect');}
      throw Error('Frontend candidate failed; previous frontend restored; backend/worker and database not replaced');
    }
  }finally{unlock();}
}
export async function recoverFrontend({store,adapter,releaseId,rollback=false}){
  const unlock=store.lock();
  try{
    const operation=store.operation(releaseId);
    if(operation?.kind!=='frontend-only'||operation.plan?.kind!=='frontend-only'||!same(operation.plan.changed,['frontend'])
      ||operation.touched?.some(component=>component!=='frontend'))throw Error('Typed frontend operation required');
    const {previous,desired}=operation.plan,active=store.active();
    if(!same(active,previous)&&!same(active,desired))throw Error('Recovery does not own current active state');
    adapter.allowRecovery?.(operation);
    preserve(operation,await adapter.observeProtected(previous));
    if(['succeeded','rolled_back','failed_before_cutover'].includes(operation.status)){
      const completed=operation.status==='succeeded'?desired:previous;
      if(!same(active,completed))throw Error('Completed operation no longer active');preserve(operation,await adapter.observe(completed));return {...operation,repeated:true};
    }
    for(const [state,status] of [[desired,'succeeded'],[previous,'rolled_back']]){
      let observed;try{observed=await adapter.observe(state);}catch{continue;}preserve(operation,observed);
      store.writeActive(state);operation.status=status;operation.recoveryObservation=observed;store.writeOperation(operation);return operation;
    }
    if(!rollback)throw Error('Frontend state unknown; explicit rollback required');
    operation.status='rolling_back';store.writeOperation(operation);
    try{await adapter.replaceFrontend(previous);const observed=await adapter.observe(previous);preserve(operation,observed);store.writeActive(previous);operation.status='rolled_back';operation.afterRollback=observed;store.writeOperation(operation);return operation;}
    catch{operation.status='recovery_required';store.writeOperation(operation);throw Error('Selective rollback remains unverified');}
  }finally{unlock();}
}
