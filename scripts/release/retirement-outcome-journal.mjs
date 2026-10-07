// Record an already returned command observation under the deployment lock.
// There is no SQL/command execution here. External proof acceptance and the
// explicit execution intent must precede this layer in a future host controller.
import {evidenceHash} from './validate-manifest.mjs';
import {validateActive,assertObserved} from './deploy-state.mjs';
import {databaseStateFromRetirementExecution,stateWithDatabase,databaseMigrationSet} from './migration-transition.mjs';
import {validateRetirementExecutionIntent,assertRetirementExecutionIntentBinding} from './retirement-intent.mjs';
import {retirementInspectionRequestForExecution} from './retirement-execution-result.mjs';

const same=(a,b)=>evidenceHash(a)===evidenceHash(b);
const kind='character-retirement-observation-302';
export function validateRetirementOutcomeJournal(operation){
  const keys=['schemaVersion','kind','releaseId','status','previous','desired','transitionHash','createdAt','updatedAt',...(operation?.schemaVersion===2?['executionIntent']:[])];
  if(![1,2].includes(operation?.schemaVersion)||operation.kind!==kind||!['retirement_observed','recovery_required','succeeded'].includes(operation.status)
    ||!same(Object.keys(operation).sort(),keys.sort()))throw Error('Exact retirement observation journal required');
  validateActive(operation.previous);validateActive(operation.desired);
  if(operation.transitionHash!==evidenceHash({previous:operation.previous,desired:operation.desired}))throw Error('Retirement observation transition bytes changed');
  const database=operation.desired.database;
  if(database?.status!=='verified-character-retirement'||operation.releaseId!==database.request.releaseId
    ||!same({...operation.previous,database},operation.desired))throw Error('Retirement observation cannot change the application composition');
  if(operation.previous.database?.status==='verified-character-retirement'){
    if(!same(operation.previous.database,database))throw Error('Retirement journal changed an already recorded observation');
  }else if(!same(database.baselineMigrationSet,databaseMigrationSet(operation.previous))
    ||database.request.expectedAdditiveSchemaProofHash!==operation.previous.database?.schemaProofHash)throw Error('Retirement journal changed the prior database proof');
  if(operation.schemaVersion===2){
    const intent=validateRetirementExecutionIntent(operation.executionIntent);
    if(intent.status!=='retirement_outcome_unknown'||intent.releaseId!==operation.releaseId||!same(intent.previous,operation.previous)
      ||intent.approvalHash!==database.approvalHash||intent.executorManifest.components.backend.imageDigest!==database.executorImageDigest
      ||!same(retirementInspectionRequestForExecution(intent.request,database.request.receiptHash),database.request))throw Error('Retirement outcome changed its original execution intent');
  }
  for(const date of [operation.createdAt,operation.updatedAt])if(typeof date!=='string'||!Number.isFinite(Date.parse(date)))throw Error('Retirement journal timestamp required');
  return operation;
}
async function finish({store,operation,observe}){
  validateRetirementOutcomeJournal(operation);
  const active=store.active();
  if(operation.status==='succeeded'&&!same(active,operation.desired))throw Error('Completed retirement observation is stale relative to the active release');
  if(!same(active,operation.previous)&&!same(active,operation.desired))throw Error('Retirement observation is stale relative to the active release');
  if(store.pending().some(item=>item.releaseId!==operation.releaseId))throw Error('Another operation requires reconciliation');
  try{
    assertObserved(operation.desired,await observe(operation.desired));
    if(operation.status==='succeeded')return {...operation,repeated:true};
    store.writeActive(operation.desired);
    operation.status='succeeded';operation.updatedAt=new Date().toISOString();store.writeOperation(operation);return operation;
  }catch(error){
    if(operation.status!=='succeeded'){
      operation.status='recovery_required';operation.updatedAt=new Date().toISOString();store.writeOperation(operation);
    }
    throw error;
  }
}
export async function recordRetirementExecutionOutcome({store,executorManifest,approvalHash,request,receipt,observe}){
  const unlock=store.lock();
  try{
    const active=store.active(),existing=store.operation(request.releaseId);
    let executionIntent;
    if(existing?.kind==='character-retirement-intent-302'){
      assertRetirementExecutionIntentBinding(existing,{active,executorManifest,approvalHash,request});
      if(existing.status!=='retirement_outcome_unknown')throw Error('Retirement execution uncertainty must be persisted before command outcome');
      executionIntent=structuredClone(existing);
    }else if(existing){
      validateRetirementOutcomeJournal(existing);
      const database=databaseStateFromRetirementExecution({active:existing.previous,executorManifest,approvalHash,request},receipt);
      if(!same(database,existing.desired.database))throw Error('Another retirement outcome cannot replace the journal');
      return await finish({store,operation:existing,observe});
    }
    if(store.pending().some(item=>item.releaseId!==request.releaseId))throw Error('Another operation requires reconciliation');
    const database=databaseStateFromRetirementExecution({active,executorManifest,approvalHash,request},receipt);
    const now=new Date().toISOString(),desired=stateWithDatabase(active,database),operation={schemaVersion:executionIntent?2:1,kind,releaseId:request.releaseId,status:'retirement_observed',previous:active,desired,transitionHash:evidenceHash({previous:active,desired}),createdAt:executionIntent?.createdAt??now,updatedAt:now,...executionIntent?{executionIntent}:{}};
    validateRetirementOutcomeJournal(operation);store.writeOperation(operation);
    return await finish({store,operation,observe});
  }finally{unlock();}
}
export async function reconcileRetirementObservation({store,releaseId,observe}){
  const unlock=store.lock();
  try{return await finish({store,operation:store.operation(releaseId),observe});}finally{unlock();}
}
