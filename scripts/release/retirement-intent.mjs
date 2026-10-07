// Durable metadata before the separately authorized explicit CLI. No command,
// DDL, external evidence acceptance or production authorization happens here.
import {evidenceHash,validateManifest} from './validate-manifest.mjs';
import {validateActive} from './deploy-state.mjs';
import {databaseMigrationSet} from './migration-transition.mjs';
import {validateRetirementExecutionRequest} from './retirement-execution-result.mjs';

const same=(a,b)=>evidenceHash(a)===evidenceHash(b);
const kind='character-retirement-intent-302';
const keys=['schemaVersion','kind','releaseId','status','previous','executorManifest','approvalHash','request','intentHash','createdAt','updatedAt'];
function binding(value){return {previous:value.previous,executorManifest:value.executorManifest,approvalHash:value.approvalHash,request:value.request};}
export function validateRetirementExecutionIntent(intent){
 if(!intent||typeof intent!=='object'||Array.isArray(intent)||!same(Object.keys(intent).sort(),[...keys].sort())
   ||intent.schemaVersion!==1||intent.kind!==kind||!['retirement_prepared','retirement_outcome_unknown'].includes(intent.status))throw Error('Exact retirement execution intent required');
 validateActive(intent.previous);validateManifest(intent.executorManifest);validateRetirementExecutionRequest(intent.request);
 const backend=intent.executorManifest.components.backend;
 if(intent.previous.database?.status!=='verified-additive'||intent.releaseId!==intent.request.releaseId
   ||intent.releaseId===intent.previous.manifest.releaseId||!same(intent.request.expectedCurrent,databaseMigrationSet(intent.previous))
   ||intent.request.expectedAdditiveSchemaProofHash!==intent.previous.database.schemaProofHash
   ||backend.sourceCommit!==intent.request.candidateSourceCommit||backend.inputFingerprint!==intent.request.candidateInputFingerprint
   ||!/^sha256:[a-f0-9]{64}$/.test(intent.approvalHash)||intent.intentHash!==evidenceHash(binding(intent)))throw Error('Retirement intent differs from the recorded baseline or exact executor');
 for(const date of [intent.createdAt,intent.updatedAt])if(typeof date!=='string'||!Number.isFinite(Date.parse(date)))throw Error('Retirement intent timestamp required');
 return intent;
}
export function assertRetirementExecutionIntentBinding(intent,{active,executorManifest,approvalHash,request}){
 validateRetirementExecutionIntent(intent);
 if(!same(binding(intent),{previous:active,executorManifest,approvalHash,request}))throw Error('Changed retirement intent cannot replace the original request');
 return intent;
}
export async function prepareRetirementExecutionIntent({store,executorManifest,approvalHash,request}){
 const unlock=store.lock();
 try{
  validateRetirementExecutionRequest(request);const active=store.active(),existing=store.operation(request.releaseId);
  if(existing){assertRetirementExecutionIntentBinding(existing,{active,executorManifest,approvalHash,request});if(store.pending().some(op=>op.releaseId!==request.releaseId))throw Error('Another operation requires reconciliation');return {...existing,repeated:true};}
  if(store.pending().length)throw Error('Another operation requires reconciliation');
  const now=new Date().toISOString(),intent={schemaVersion:1,kind,releaseId:request.releaseId,status:'retirement_prepared',previous:structuredClone(active),executorManifest:structuredClone(executorManifest),approvalHash,request:structuredClone(request),createdAt:now,updatedAt:now};intent.intentHash=evidenceHash(binding(intent));
  validateRetirementExecutionIntent(intent);store.writeOperation(intent);return intent;
 }finally{unlock();}
}
// Persist uncertainty BEFORE sending the command. Repeating this transition
// does not send a command, infer commit/rollback, or permit a different request.
export async function markRetirementExecutionOutcomeUnknown({store,releaseId,intentHash}){
 const unlock=store.lock();
 try{
  const intent=store.operation(releaseId);validateRetirementExecutionIntent(intent);
  if(intent.intentHash!==intentHash||!same(store.active(),intent.previous))throw Error('Retirement intent is stale or changed');
  if(store.pending().some(op=>op.releaseId!==releaseId))throw Error('Another operation requires reconciliation');
  if(intent.status==='retirement_outcome_unknown')return {...intent,repeated:true};
  intent.status='retirement_outcome_unknown';intent.updatedAt=new Date().toISOString();store.writeOperation(intent);return intent;
 }finally{unlock();}
}
