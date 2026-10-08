// Synthetic record metadata and owned temporary store; no DDL/host authority.
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createDeploymentStore} from './deploy-state.mjs';
import {retirementStateUnitFixture} from './retirement-state-unit-fixture.mjs';
import {retirementDatabaseStateFromInspection} from './retirement-state.mjs';
import {evidenceHash} from './validate-manifest.mjs';
export function retirementRecordUnitFixture(t){
  const f=retirementStateUnitFixture(),root=mkdtempSync(path.join(tmpdir(),'retirement-record-'));
  f.executorManifest.releaseId=f.request.releaseId=f.inspection.result.releaseId='retirement302-record-fixture';
  t.after(()=>{assert.equal(path.dirname(root),path.resolve(tmpdir()));assert.ok(path.basename(root).startsWith('retirement-record-'));rmSync(root,{recursive:true,force:true});});
  const active={...structuredClone(f.active),database:retirementDatabaseStateFromInspection(f,f.inspection)},stamp='2026-10-06T00:00:00Z';
  const operation={schemaVersion:1,kind:'character-retirement-observation-302',releaseId:f.request.releaseId,status:'succeeded',previous:f.active,desired:active,transitionHash:evidenceHash({previous:f.active,desired:active}),createdAt:stamp,updatedAt:stamp};
  const store=createDeploymentStore(root);store.writeActive(active);store.writeOperation(operation);
  const request={repository:'fixture/project',controlCommit:'c'.repeat(40),sourceCommit:active.manifest.releaseCommit,runId:42,attempt:1,eventName:'workflow_dispatch',actor:'fixture-owner'};
  const run={id:42,run_attempt:1,path:'.github/workflows/deploy.yml',head_branch:'main',head_sha:request.controlCommit,event:'workflow_dispatch',status:'in_progress',conclusion:null,
    repository:{full_name:request.repository},head_repository:{full_name:request.repository},actor:{login:request.actor},display_title:'Record retirement '+operation.releaseId};
  let calls=0;const get=async route=>{assert.equal(route,'actions/runs/42');calls++;return structuredClone(run);};
  return {root,store,request,run,get,expectedManifestHash:evidenceHash(active.manifest),operationId:operation.releaseId,calls:()=>calls};
}
