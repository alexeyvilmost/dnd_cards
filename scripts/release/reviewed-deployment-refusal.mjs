// Bounded source-controlled recovery evidence for a reviewed rehearsal refusal.
// It never declares the failed workflow successful or authorizes a cutover.
import assert from 'node:assert/strict';
import {readFileSync,lstatSync,realpathSync,existsSync} from 'node:fs';
import path from 'node:path';import {fileURLToPath}from'node:url';
import {evidenceHash}from'./validate-manifest.mjs';
const positive=n=>Number.isSafeInteger(n)&&n>0,sha=/^[a-f0-9]{40}$/,hash=/^sha256:[a-f0-9]{64}$/;
const date=s=>typeof s==='string'&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString()===s;
const fields=['schemaVersion','kind','status','observedAt','repository','failed','baseline','candidateManifestHash','failedReleaseId','hostConfigHash','transferHash','rehearsalHash','rehearsalRunId','rehearsalCompletedAt','phaseHashes','retained','operations','services','protectedRuntime','databaseBindingHash','routingSecurityHash','cleanup','readOnly','sqlQueries','serviceReplacements','providerRequests'];
export function reviewedRefusalPhaseScripts(proof){
 const scripts=['release-publication.mjs','deployment-handoff.mjs','automatic-release.mjs','prepare-host-release.mjs','candidate-rehearsal.mjs'];
 assert.ok([5,6].includes(proof.phaseHashes?.length),'Reviewed refusal must stop at candidate rehearsal');
 if(proof.phaseHashes.length===6)scripts.splice(3,0,'reviewed-deployment-refusal-host.mjs');
 return scripts;
}
export function validateReviewedDeploymentRefusal(proof){
 assert.deepEqual(Object.keys(proof??{}).sort(),[...fields].sort());assert.equal(proof.schemaVersion,1);assert.equal(proof.kind,'reviewed-followon-pre-cutover-refusal-audit');assert.equal(proof.status,'passed');
 assert.match(proof.repository,/^[\w.-]+\/[\w.-]+$/);assert.ok(date(proof.observedAt));
 assert.deepEqual(Object.keys(proof.failed).sort(),['id','attempt','controlCommit','completedAt'].sort());assert.ok(positive(proof.failed.id));assert.equal(proof.failed.attempt,1);assert.match(proof.failed.controlCommit,sha);assert.ok(Number.isFinite(Date.parse(proof.failed.completedAt)));assert.ok(Date.parse(proof.failed.completedAt)<=Date.parse(proof.observedAt));
 assert.deepEqual(Object.keys(proof.baseline).sort(),['id','attempt','controlCommit','releaseId','manifestHash','activeHash'].sort());assert.ok(positive(proof.baseline.id)&&proof.baseline.id!==proof.failed.id);assert.equal(proof.baseline.attempt,1);assert.match(proof.baseline.controlCommit,sha);assert.match(proof.baseline.releaseId,/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/);
 for(const key of ['manifestHash','activeHash'])assert.match(proof.baseline[key],hash);
 for(const key of ['candidateManifestHash','hostConfigHash','transferHash','rehearsalHash','databaseBindingHash','routingSecurityHash'])assert.match(proof[key],hash);
 assert.match(proof.failedReleaseId,/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/);assert.notEqual(proof.failedReleaseId,proof.baseline.releaseId);assert.match(proof.rehearsalRunId,/^[a-f0-9-]{36}$/);assert.ok(date(proof.rehearsalCompletedAt)&&Date.parse(proof.rehearsalCompletedAt)<=Date.parse(proof.failed.completedAt));
 assert.deepEqual(proof.phaseHashes.map(r=>r.file),reviewedRefusalPhaseScripts(proof).map((_,i)=>'phase-'+String(i+1).padStart(2,'0')+'.json'));
 assert.deepEqual(proof.retained.map(r=>r.file),['state.json','compose.env','compose.prod.yml','Caddyfile','compose.runtime.json']);
 for(const rows of [proof.phaseHashes,proof.retained,proof.operations]){assert.ok(Array.isArray(rows)&&new Set(rows.map(r=>r.file)).size===rows.length);for(const r of rows){assert.deepEqual(Object.keys(r).sort(),['file','sha256']);assert.match(r.file,/^[A-Za-z0-9_.-]+$/);assert.match(r.sha256,hash);}}
 assert.deepEqual(Object.keys(proof.services).sort(),['backend','frontend','rulesWorker']);for(const row of Object.values(proof.services)){assert.equal(row.healthy,true);assert.match(row.containerId,/^[a-f0-9]{64}$/);assert.match(row.imageDigest,/^[^\s@]+@sha256:[a-f0-9]{64}$/);assert.equal(row.identity?.provenance,'baked');assert.match(row.identity.sourceCommit,sha);}
 assert.deepEqual(Object.keys(proof.protectedRuntime).sort(),['backend','rulesWorker']);for(const row of Object.values(proof.protectedRuntime)){assert.match(row.containerId,/^[a-f0-9]{64}$/);for(const key of ['configurationHash','mountsHash','databaseBindingHash'])assert.match(row[key],hash);}
 assert.deepEqual(proof.cleanup,{remainingOwnedResources:0,validatorStopped:true,dockerAuthRemoved:true,deploymentJournalCreated:false,deployLockPresent:false,operatorApplicationMutations:0});assert.equal(proof.readOnly,true);for(const key of ['sqlQueries','serviceReplacements','providerRequests'])assert.equal(proof[key],0);
 return proof;
}
export function loadReviewedDeploymentRefusal({id,attempt,repository,controlRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..')}){
 assert.ok(positive(id)&&positive(attempt));if(attempt!==1)return null;const root=path.resolve(controlRoot),directory=path.join(root,'infra','reviewed-deployment-refusals'),file=path.join(directory,`${id}-${attempt}.json`);
 if(!existsSync(file))return null;
 assert.equal(realpathSync(directory),directory);assert.equal(realpathSync(file),file);const stat=lstatSync(file);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>0&&stat.size<=65536);
 const proof=validateReviewedDeploymentRefusal(JSON.parse(readFileSync(file,'utf8')));assert.equal(proof.repository,repository);assert.equal(proof.failed.id,id);assert.equal(proof.failed.attempt,attempt);return proof;
}
export function assertReviewedRefusalRun(proof,{identity,job,now}){
 validateReviewedDeploymentRefusal(proof);assert.ok(Date.parse(proof.observedAt)<=now);
 assert.equal(identity.id,proof.failed.id);assert.equal(identity.runAttempt,proof.failed.attempt);assert.equal(identity.controlCommit,proof.failed.controlCommit);assert.equal(identity.repository,proof.repository);assert.equal(identity.event,'workflow_dispatch');assert.equal(identity.conclusion,'failure');assert.equal(job.conclusion,'failure');assert.equal(job.completed_at,proof.failed.completedAt);
 return proof;
}
export function assertReviewedRefusalBaseline(proof,run,manifest){
 validateReviewedDeploymentRefusal(proof);assert.equal(run.id,proof.baseline.id);assert.equal(run.runAttempt,proof.baseline.attempt);assert.equal(run.controlCommit,proof.baseline.controlCommit);
 if(manifest){assert.equal(manifest.releaseId,proof.baseline.releaseId);assert.equal(evidenceHash(manifest),proof.baseline.manifestHash);}return proof;
}
