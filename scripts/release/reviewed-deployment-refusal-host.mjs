// Recheck committed refusal evidence on the authenticated host before capture
// and under the normal cutover lock. No restore, SQL or application mutation.
import assert from 'node:assert/strict';import {readFileSync,lstatSync,realpathSync,existsSync,readdirSync}from'node:fs';
import path from'node:path';import {fileURLToPath}from'node:url';import {createHash}from'node:crypto';
import {evidenceHash}from'./validate-manifest.mjs';import {validateHostPacket}from'./ssh-host-release.mjs';import {observeUIHost,localDockerRead}from'./ui-host-observation.mjs';
import {validateReviewedDeploymentRefusal,loadReviewedDeploymentRefusal}from'./reviewed-deployment-refusal.mjs';
const hash=b=>'sha256:'+createHash('sha256').update(b).digest('hex');
function bytes(file){assert.equal(realpathSync(file),path.resolve(file));const s=lstatSync(file);assert.ok(s.isFile()&&!s.isSymbolicLink()&&s.size<=32*1024*1024);if(process.platform!=='win32')assert.equal(s.mode&0o077,0);return readFileSync(file);}
const read=f=>JSON.parse(bytes(f));
export function assertReviewedRefusalObservation(proof,observed){
 validateReviewedDeploymentRefusal(proof);
 for(const key of ['hostConfigHash','transferHash','rehearsalHash','phaseHashes','retained','operations','services','protectedRuntime','databaseBindingHash','routingSecurityHash'])assert.equal(evidenceHash(observed[key]),evidenceHash(proof[key]),'Reviewed refusal host state changed: '+key);
 assert.equal(observed.activeHash,proof.baseline.activeHash);assert.equal(observed.cleanupComplete,true);return {status:'verified-reviewed-pre-cutover-refusal',failedRunId:proof.failed.id,baselineRunId:proof.baseline.id,proofHash:evidenceHash(proof),applicationMutations:0};
}
function assertValidatorAbsent(directory){
 assert.equal(process.platform,'linux');for(const id of readdirSync('/proc').filter(n=>/^[1-9]\d*$/.test(n))){let b;try{b=readFileSync('/proc/'+id+'/cmdline');}catch(e){if(['ENOENT','ESRCH'].includes(e.code))continue;throw e;}assert.ok(b.length<1024*1024&&!b.toString().split('\0').some(s=>s.includes(directory)),'Prior host attempt still running');}
}
export async function assertHostReviewedDeploymentRefusal({directory,underLock=false,command=localDockerRead,observe=observeUIHost,get}){
 const packet=read(path.join(directory,'transfer.json')),request=validateHostPacket(packet,directory),control=path.join(directory,'control');
 const candidate=JSON.parse(packet.files['candidate.json'].text),root=path.join(control,'infra','reviewed-deployment-refusals');if(!existsSync(root))return {status:'not-required'};
 assert.equal(realpathSync(root),root);const names=readdirSync(root);assert.ok(names.length<=32);for(const name of names)assert.match(name,/^[1-9]\d*-1\.json$/);
 // These are public reviewed control files from the exact transferred archive,
 // not private host configuration: their normal Git mode is 0644.
 const proofs=names.map(name=>loadReviewedDeploymentRefusal({id:Number(name.split('-')[0]),attempt:1,repository:request.repository,controlRoot:control})).filter(p=>p.baseline.releaseId===candidate.manifest.previousReleaseId);
 if(!proofs.length)return {status:'not-required'};
 const config=read(request.hostConfig),active=read(path.join(config.root,'active.json')),lock=path.join(config.root,'deploy.lock');
 if(underLock){assert.equal(read(path.join(lock,'owner.json')).pid,process.pid);}else assert.equal(existsSync(lock),false);
 const actual=await observe(config,active,{run:command});const results=[];
 for(const proof of proofs){
  assert.equal(evidenceHash(active.manifest),proof.baseline.manifestHash);assert.equal(evidenceHash(active),proof.baseline.activeHash);
  const old=path.join(request.attemptRoot,`deploy-${proof.failed.id}-${proof.failed.attempt}`),previous=read(path.join(old,'transfer.json')),oldRequest=validateHostPacket(previous,old);
  assert.equal(oldRequest.mode,'apply');assert.equal(oldRequest.repository,proof.repository);assert.equal(oldRequest.sourceCommit,proof.failed.controlCommit);assert.equal(oldRequest.controlCommit,proof.failed.controlCommit);assert.equal(String(oldRequest.runId),String(proof.failed.id));assert.equal(Number(oldRequest.attempt),1);
  const oldCandidate=JSON.parse(previous.files['candidate.json'].text);assert.equal(evidenceHash(oldCandidate.manifest),proof.candidateManifestHash);assert.equal(oldCandidate.manifest.releaseId,proof.failedReleaseId);
  const scripts=['release-publication.mjs','deployment-handoff.mjs','automatic-release.mjs','prepare-host-release.mjs','candidate-rehearsal.mjs'];assert.deepEqual(readdirSync(old).filter(n=>n.startsWith('phase-')).sort(),proof.phaseHashes.map(r=>r.file));for(const[i,row]of proof.phaseHashes.entries())assert.deepEqual(read(path.join(old,row.file)),{script:scripts[i],status:'started'});
  for(const name of ['ready','deployed-release','deployment-operation.json','docker-auth'])assert.equal(existsSync(path.join(old,name)),false);assert.equal(existsSync(path.join(config.root,'operations',proof.failedReleaseId+'.json')),false);
  const rehearsal=read(path.join(old,'rehearsal','rehearsal.json'));assert.equal(rehearsal.status,'failed');assert.equal(rehearsal.failureStage,'writer-compatibility');assert.equal(rehearsal.runId,proof.rehearsalRunId);assert.equal(rehearsal.activeHash,proof.baseline.activeHash);assert.equal(rehearsal.completedAt,proof.rehearsalCompletedAt);assert.equal(rehearsal.cleanup.status,'stopped');assert.deepEqual(rehearsal.cleanup.errors,[]);assert.equal(rehearsal.checks.length,8);assert.ok(rehearsal.checks.every(c=>c.status==='passed'));
  assertValidatorAbsent(old);for(const label of ['bagofholding.rehearsal','bagofholding.legacy-inspection'])for(const kind of ['container','network','volume'])assert.equal(command([kind,'ls',...(kind==='container'?['-a']:[]),'--filter','label='+label,'--format',kind==='volume'?'{{.Name}}':'{{.ID}}']).trim(),'');
  const operations=readdirSync(path.join(config.root,'operations')).sort().map(file=>({file,sha256:hash(bytes(path.join(config.root,'operations',file)))}));
  const observed={activeHash:evidenceHash(active),hostConfigHash:hash(bytes(request.hostConfig)),transferHash:hash(bytes(path.join(old,'transfer.json'))),rehearsalHash:hash(bytes(path.join(old,'rehearsal','rehearsal.json'))),phaseHashes:proof.phaseHashes.map(row=>({file:row.file,sha256:hash(bytes(path.join(old,row.file)))})),retained:proof.retained.map(row=>({file:row.file,sha256:hash(bytes(path.join(config.root,'releases',active.manifest.releaseId,row.file)))})),operations,services:actual.services,protectedRuntime:actual.protectedRuntime,databaseBindingHash:actual.databaseBindingHash,routingSecurityHash:actual.routingSecurityHash,cleanupComplete:true};
  results.push(assertReviewedRefusalObservation(proof,observed));
  // The failed workflow remains failed. A rerun or different terminal outcome
  // invalidates this source-controlled exception, even on the same host.
  const actualRun=await get('actions/runs/'+proof.failed.id),jobs=await get('actions/runs/'+proof.failed.id+'/jobs?filter=latest&per_page=100');assert.equal(actualRun.path,'.github/workflows/deploy.yml');assert.equal(actualRun.event,'workflow_dispatch');assert.equal(actualRun.head_branch,'main');assert.equal(actualRun.repository?.full_name,proof.repository);assert.equal(actualRun.head_repository?.full_name,proof.repository);assert.equal(actualRun.id,proof.failed.id);assert.equal(actualRun.run_attempt,proof.failed.attempt);assert.equal(actualRun.head_sha,proof.failed.controlCommit);assert.equal(actualRun.status,'completed');assert.equal(actualRun.conclusion,'failure');assert.equal(jobs.total_count,jobs.jobs.length);const job=jobs.jobs.filter(j=>j.name==='deploy');assert.equal(job.length,1);assert.equal(job[0].run_id,proof.failed.id);assert.equal(job[0].head_sha,proof.failed.controlCommit);if(job[0].run_attempt!==undefined)assert.equal(job[0].run_attempt,proof.failed.attempt);assert.equal(job[0].status,'completed');assert.equal(job[0].conclusion,'failure');assert.equal(job[0].completed_at,proof.failed.completedAt);
  const fresh=await get('actions/runs/'+proof.failed.id);for(const key of ['id','run_attempt','head_sha','path','event','head_branch','status','conclusion'])assert.equal(fresh[key],actualRun[key]);assert.equal(fresh.repository?.full_name,proof.repository);assert.equal(fresh.head_repository?.full_name,proof.repository);
 }
 assert.equal(evidenceHash(read(path.join(config.root,'active.json'))),evidenceHash(active));return {status:'verified-reviewed-refusals',checks:results,underLock,applicationMutations:0,providerRequests:0};
}
export function refusalMetadataReader(environment=process.env){
 assert.ok(environment.GITHUB_TOKEN);assert.match(environment.GITHUB_REPOSITORY,/^[\w.-]+\/[\w.-]+$/);return async route=>{assert.match(route,/^actions\//);const response=await fetch('https://api.github.com/repos/'+environment.GITHUB_REPOSITORY+'/'+route,{headers:{Authorization:'Bearer '+environment.GITHUB_TOKEN,Accept:'application/vnd.github+json'},redirect:'error',signal:AbortSignal.timeout(15000)});assert.ok(response.ok);return response.json();};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 assert.equal(process.argv.length,3);assertHostReviewedDeploymentRefusal({directory:path.resolve(process.argv[2]),get:refusalMetadataReader()}).then(r=>console.log(JSON.stringify(r))).catch(()=>{process.stderr.write('Reviewed deployment refusal no longer matches host; inspect without retry.\n');process.exitCode=1;});
}
