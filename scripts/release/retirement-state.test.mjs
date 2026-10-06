import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {databaseStateFromRetirementInspection,stateWithDatabase,migrationTransition,databaseMigrationSet} from './migration-transition.mjs';
import {validateActive,createDeploymentStore} from './deploy-state.mjs';
import {validatePublicActive} from './active-projection.mjs';
import {assertRetirementInspectionResult,retirementMigrationId} from './retirement-state.mjs';
import {retirementStateUnitFixture,retirementUnitHash as h} from './retirement-state-unit-fixture.mjs';
function ready(){const f=retirementStateUnitFixture();f.database=databaseStateFromRetirementInspection(f,f.inspection);f.retired=stateWithDatabase(f.active,f.database);return f;}
test('recorded retirement retains prior identities, exact request and baked executor while leaving application manifest unchanged',()=>{
 const f=ready();assert.equal(validateActive(f.retired),f.retired);assert.equal(validatePublicActive(f.retired),f.retired);
 assert.deepEqual(f.database.baselineMigrationSet,f.active.database.migrationSet);assert.deepEqual(f.retired.manifest,f.active.manifest);assert.deepEqual(f.database.request,f.request);
 assert.deepEqual(databaseStateFromRetirementInspection({...f,active:f.retired},f.inspection),f.database);
 const candidate={...f.executorManifest,migrationSet:databaseMigrationSet(f.retired)};assert.equal(migrationTransition(candidate,{},f.retired).mode,'no-schema-change');
 assert.throws(()=>migrationTransition({...candidate,migrationSet:candidate.migrationSet.filter(row=>row.id!==retirementMigrationId)},{},f.retired));
 assert.throws(()=>migrationTransition({...candidate,migrationSet:[...candidate.migrationSet,{id:'999_unknown',checksum:h('a')}]},{},f.retired));
});
test('real filesystem state survives reload and cannot be rewritten by a changed receipt',t=>{
 const root=mkdtempSync(path.join(tmpdir(),'retirement-state-'));
 t.after(()=>{assert.equal(path.dirname(root),path.resolve(tmpdir()));assert(path.basename(root).startsWith('retirement-state-'));rmSync(root,{recursive:true,force:true});});
 const f=ready(),store=createDeploymentStore(root);const unlock=store.lock();store.writeActive(f.retired);unlock();assert.deepEqual(createDeploymentStore(root).active(),f.retired);
 const before=readFileSync(path.join(root,'active.json'));const changed=structuredClone(f);changed.inspection.result.receiptHash=h('a');assert.throws(()=>databaseStateFromRetirementInspection({...changed,active:store.active()},changed.inspection));assert.deepEqual(readFileSync(path.join(root,'active.json')),before);
});
for(const [name,change]of Object.entries({
 'wrong baked source':f=>{f.inspection.build.sourceCommit='c'.repeat(40);},
 'wrong baked fingerprint':f=>{f.inspection.build.inputFingerprint=h('a');},
 'unverified runtime identity':f=>{f.inspection.build.provenance='runtime';},
 'another executor manifest':f=>{f.executorManifest.components.backend.inputFingerprint=h('a');},
 'changed original retirement receipt':f=>{f.inspection.result.receiptHash=h('a');},
 'changed original SQL source':f=>{f.request.sqlSourceHash=h('a');},
 'changed previous additive proof':f=>{f.request.expectedAdditiveSchemaProofHash=h('a');},
 'missing previous additive observation':f=>{delete f.active.database;},
 'unknown observed migration':f=>{f.inspection.result.observedVersions.push('999_unknown');},
 'missing installed identity':f=>{f.inspection.result.observedVersions.pop();},
 'DDL in an inspection result':f=>{f.inspection.result.applied=[retirementMigrationId];},
 'unobserved rollback compatibility':f=>{delete f.inspection.result.rollbackReadersSafe;},
 'another operation alongside retirement':f=>{f.request.expectedCurrent.push({id:'999_unknown',checksum:h('a')});f.inspection.result.observedVersions=f.request.expectedCurrent.map(row=>row.id).sort();},
 'changed old migration checksum':f=>{f.request.expectedCurrent[0].checksum=h('a');},
 'unknown request fields':f=>{f.request.databaseURL='PRIVATE_CANARY';},
 'private field in preimage':f=>{f.request.retirement.preimages.characters.rowsText='PRIVATE_CANARY';},
 'fractional row count':f=>{f.request.retirement.preimages.characters.rows=1.5;},
 'unknown original request key':f=>{f.request.retirement.extra='PRIVATE_CANARY';},
}))test('retirement observation refuses '+name,()=>{const f=retirementStateUnitFixture();change(f);assert.throws(()=>databaseStateFromRetirementInspection(f,f.inspection));});
test('nested persisted private fields and an additive disguise fail before projection',()=>{
 for(const mutate of [s=>{s.database.password='PRIVATE_CANARY';},s=>{s.database.request.extra='PRIVATE_CANARY';},s=>{s.database.baselineMigrationSet[0].extra='PRIVATE_CANARY';},s=>{s.database.request.retirement.preimages.characters.extra='PRIVATE_CANARY';}]){const f=ready();mutate(f.retired);assert.throws(()=>validatePublicActive(f.retired));}
 const f=ready();f.active.database.migrationSet.push(f.database.migrationSet.at(-1));f.active.database.request.target=f.active.database.migrationSet;f.active.database.request.expectedCurrent=f.active.database.migrationSet;assert.throws(()=>validateActive(f.active));
});
test('later normal gameplay may make old readers unsafe without falsifying the retained structural observation',()=>{
 const f=ready();f.inspection.result.rollbackReadersSafe=false;assert.equal(assertRetirementInspectionResult(f.database,f.inspection).rollbackReadersSafe,false);
 const bad=structuredClone(f.inspection);bad.result.schemaProofHash=h('a');assert.throws(()=>assertRetirementInspectionResult(f.database,bad));
});
