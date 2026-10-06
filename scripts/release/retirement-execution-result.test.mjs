import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {retirementExecutionUnitFixture as fixture,retirementUnitHash as h} from './retirement-state-unit-fixture.mjs';
import {retirementMigrationId} from './retirement-state.mjs';
import {retirementInspectionFromExecution} from './retirement-execution-result.mjs';
import {databaseStateFromRetirementExecution,stateWithDatabase} from './migration-transition.mjs';
import {createDeploymentStore} from './deploy-state.mjs';

test('first explicit command and its already committed retry project the same retained database observation',()=>{
  const f=fixture(),first=databaseStateFromRetirementExecution(f,f.execution);
  assert.deepEqual(first.request,f.execution.result.request);assert.deepEqual(first.baselineMigrationSet,f.active.database.migrationSet);
  f.execution.result.applied=[];assert.deepEqual(databaseStateFromRetirementExecution(f,f.execution),first);
  f.active=stateWithDatabase(f.active,first);assert.deepEqual(databaseStateFromRetirementExecution(f,f.execution),first);
  f.execution.result.inspection.rollbackReadersSafe=false;assert.deepEqual(databaseStateFromRetirementExecution(f,f.execution),first);
});
test('the returned inspection is detached from the raw command wrapper and omits build extras',()=>{
  const f=fixture();f.execution.build.diagnostic='PRIVATE_CANARY';const observed=retirementInspectionFromExecution(f.request,f.execution);
  assert(!JSON.stringify(observed).includes('PRIVATE_CANARY'));observed.request.retirement.preimages.characters.rows++;observed.inspection.result.observedVersions.pop();assert.deepEqual(f.execution.result.inspection,f.inspection.result);
});
test('actual deployment store retains the execution observation through restart and refuses a changed retry without changing bytes',t=>{
  const root=mkdtempSync(path.join(tmpdir(),'retirement-execution-result-'));t.after(()=>{assert.equal(path.dirname(root),path.resolve(tmpdir()));assert(path.basename(root).startsWith('retirement-execution-result-'));rmSync(root,{recursive:true,force:true});});
  const f=fixture(),store=createDeploymentStore(root);const unlock=store.lock();try{store.writeActive(stateWithDatabase(f.active,databaseStateFromRetirementExecution(f,f.execution)));}finally{unlock();}
  const before=readFileSync(path.join(root,'active.json')),reloaded=createDeploymentStore(root);f.active=reloaded.active();f.execution.result.applied=[];
  assert.deepEqual(databaseStateFromRetirementExecution(f,f.execution),f.active.database);
  f.execution.result.request.retirement.backupHash=h('a');assert.throws(()=>databaseStateFromRetirementExecution(f,f.execution));assert.deepEqual(readFileSync(path.join(root,'active.json')),before);
});
for(const [name,change]of Object.entries({
  'unknown outcome':f=>{f.execution.status='failed_or_unknown';},
  'wrong operation kind':f=>{f.request.kind='inspect-character-retirement-301';},
  'empty prior ledger':f=>{f.request.expectedCurrent=[];},
  'already retired baseline':f=>{f.request.expectedCurrent.push(f.execution.result.request.expectedCurrent.at(-1));},
  'extra execution request field':f=>{f.request.databaseURL='PRIVATE_CANARY';},
  'extra raw wrapper field':f=>{f.execution.private='PRIVATE_CANARY';},
  'extra result field':f=>{f.execution.result.private='PRIVATE_CANARY';},
  'extra inspection field':f=>{f.execution.result.inspection.private='PRIVATE_CANARY';},
  'extra accepted request field':f=>{f.execution.result.request.private='PRIVATE_CANARY';},
  'wrong outer schema':f=>{f.execution.schemaVersion=2;},
  'wrong result status':f=>{f.execution.result.status='failed';},
  'wrong result release':f=>{f.execution.result.releaseId='another';},
  'another applied migration':f=>{f.execution.result.applied=['300_image_jobs'];},
  'duplicate application':f=>{f.execution.result.applied.push(retirementMigrationId);},
  'changed original backup':f=>{f.execution.result.request.retirement.backupHash=h('a');},
  'changed archive restoration':f=>{f.execution.result.request.retirement.archiveRestoreReportHash=h('a');},
  'changed rollback pair':f=>{f.execution.result.request.retirement.acceptedRollbackPairHash=h('a');},
  'changed original rows':f=>{f.execution.result.request.retirement.preimages.characters.rows++;},
  'changed source SQL':f=>{f.execution.result.request.sqlSourceHash=h('a');},
  'changed additive proof':f=>{f.execution.result.request.expectedAdditiveSchemaProofHash=h('a');},
  'changed baseline identity':f=>{f.execution.result.request.expectedCurrent[0].checksum=h('a');},
  'unknown inspected migration':f=>{f.execution.result.inspection.observedVersions.push('999_unknown');},
  'missing inspected migration':f=>{f.execution.result.inspection.observedVersions.pop();},
  'DDL claimed by inspector':f=>{f.execution.result.inspection.applied=[retirementMigrationId];},
  'changed receipt hash':f=>{f.execution.result.inspection.receiptHash=h('a');},
  'missing rollback observation':f=>{delete f.execution.result.inspection.rollbackReadersSafe;},
  'unverified build':f=>{f.execution.build.provenance='runtime';},
  'wrong baked source':f=>{f.execution.build.sourceCommit='c'.repeat(40);},
  'wrong baked input':f=>{f.execution.build.inputFingerprint=h('a');},
  'different image manifest':f=>{f.executorManifest.components.backend.sourceCommit='c'.repeat(40);},
  'changed previously retained schema':f=>{f.active.database.schemaProofHash=h('a');},
}))test('explicit retirement result refuses '+name,()=>{const f=fixture();change(f);assert.throws(()=>databaseStateFromRetirementExecution(f,f.execution));});
