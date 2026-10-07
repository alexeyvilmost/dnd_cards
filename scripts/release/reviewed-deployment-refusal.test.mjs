// Unit contracts only; controlled observations are not host recovery evidence.
import test from'node:test';import assert from'node:assert/strict';import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync,chmodSync,utimesSync,statSync}from'node:fs';import {tmpdir}from'node:os';import path from'node:path';import {createHash}from'node:crypto';
import {validateReviewedDeploymentRefusal,loadReviewedDeploymentRefusal,assertReviewedRefusalRun,assertReviewedRefusalBaseline,reviewedRefusalPhaseScripts,isCompletedRestoreRefusal,assertReviewedRehearsalRefusal}from'./reviewed-deployment-refusal.mjs';
import {assertReviewedRefusalObservation,assertHostReviewedDeploymentRefusal,snapshotRefusalOperations}from'./reviewed-deployment-refusal-host.mjs';
import {evidenceHash,compositionFingerprint,candidateRehearsalStages}from'./validate-manifest.mjs';import {uiFixture}from'./ui-release-unit-fixture.mjs';
const original=JSON.parse(readFileSync(new URL('../../infra/reviewed-deployment-refusals/37405297914-1.json',import.meta.url),'utf8'));
const observation=p=>({...structuredClone(p),activeHash:p.baseline.activeHash,cleanupComplete:true});

test('version3 binds a reviewed automatic rerun and successful baseline attempt without reusing older proof identities',t=>{
 const f=detailedFixture(),p=f.proof;p.schemaVersion=3;p.failed.attempt=2;p.failed.event='workflow_run';p.baseline.attempt=3;
 p.operations.push({file:'maintenance/metadata.json',sha256:p.transferHash});validateReviewedDeploymentRefusal(p);assertReviewedRehearsalRefusal(p,f);
 const identity={id:p.failed.id,runAttempt:2,repository:p.repository,controlCommit:p.failed.controlCommit,event:'workflow_run',conclusion:'failure'},job={conclusion:'failure',completed_at:p.failed.completedAt},now=Date.parse(p.observedAt);
 assertReviewedRefusalRun(p,{identity,job,now});assertReviewedRefusalBaseline(p,{id:p.baseline.id,runAttempt:3,controlCommit:p.baseline.controlCommit});
 for(const patch of [{runAttempt:1},{runAttempt:3},{event:'workflow_dispatch'},{event:'push'},{conclusion:'success'}])assert.throws(()=>assertReviewedRefusalRun(p,{identity:{...identity,...patch},job,now}));
 assert.throws(()=>assertReviewedRefusalBaseline(p,{id:p.baseline.id,runAttempt:1,controlCommit:p.baseline.controlCommit}));
 for(const badPath of ['../outside','/absolute','nested/../outside','nested//file']){const bad=structuredClone(p);bad.operations[0].file=badPath;assert.throws(()=>validateReviewedDeploymentRefusal(bad));}
 const root=mkdtempSync(path.join(tmpdir(),'refusal-rerun-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const dir=path.join(root,'infra','reviewed-deployment-refusals');mkdirSync(dir,{recursive:true});writeFileSync(path.join(dir,`${p.failed.id}-2.json`),JSON.stringify(p));
 assert.deepEqual(loadReviewedDeploymentRefusal({id:p.failed.id,attempt:2,repository:p.repository,controlRoot:root}),p);assert.equal(loadReviewedDeploymentRefusal({id:p.failed.id,attempt:3,repository:p.repository,controlRoot:root}),null);
});
test('recursive operation inventory protects every maintenance file rather than ignoring nested state',t=>{
 const root=mkdtempSync(path.join(tmpdir(),'refusal-operations-'));t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(root+'/maintenance',{mode:0o700});writeFileSync(root+'/release.json','{}',{mode:0o600});writeFileSync(root+'/maintenance/metadata.json','PRIVATE_CANARY',{mode:0o600});
 const before=snapshotRefusalOperations(root,{recursive:true});assert.deepEqual(before.map(r=>r.file),['maintenance/metadata.json','release.json']);assert.ok(!JSON.stringify(before).includes('PRIVATE_CANARY'));assert.throws(()=>snapshotRefusalOperations(root));
 writeFileSync(root+'/maintenance/metadata.json','changed');assert.notEqual(evidenceHash(snapshotRefusalOperations(root,{recursive:true})),evidenceHash(before));
});

function detailedFixture(stage='historical-replay'){
 const proof=structuredClone(original),manifest=structuredClone(uiFixture().planning.input.previousManifest);
 const active={schemaVersion:1,status:'active',manifest,instances:Object.fromEntries(Object.keys(manifest.components).map(key=>[key,{releaseId:manifest.releaseId,releaseCommit:manifest.releaseCommit}]))};
 proof.schemaVersion=2;proof.baseline.manifestHash=evidenceHash(manifest);proof.baseline.activeHash=evidenceHash(active);
 const candidate={manifest:{...manifest,releaseId:proof.failedReleaseId,previousReleaseId:manifest.releaseId}},capture={schemaVersion:1,kind:'candidate-capture',status:'captured',createdAt:'2026-10-06T01:00:00.000Z',activeHash:evidenceHash(active),releaseManifestHash:evidenceHash(manifest)};
 proof.candidateManifestHash=evidenceHash(candidate.manifest);
 const backup={createdAt:capture.createdAt,releaseManifestHash:proof.baseline.manifestHash};
 const input={active,manifest:candidate.manifest,backup,candidateHash:evidenceHash(candidate),activeHash:evidenceHash(active),backupHash:evidenceHash(backup),compositionFingerprint:compositionFingerprint(candidate.manifest)};
 const completedChecks=candidateRehearsalStages.slice(0,candidateRehearsalStages.indexOf(stage));
 const report={schemaVersion:1,kind:'candidate-rehearsal',execution:'docker',status:'failed',failure:'candidate-rehearsal-failed',failureStage:stage,candidateHash:input.candidateHash,activeHash:input.activeHash,backupHash:input.backupHash,compositionFingerprint:input.compositionFingerprint,releaseId:proof.failedReleaseId,runId:proof.rehearsalRunId,startedAt:'2026-10-06T01:00:01.000Z',completedAt:proof.rehearsalCompletedAt,checks:completedChecks.map(id=>({id,status:'passed'})),cleanup:{status:'stopped',errors:[],resourceCount:12}};
 proof.rehearsalFailure={stage,completedChecks,inputHash:evidenceHash(input),captureHash:evidenceHash(capture),cleanupResourceCount:12};
 return {proof,candidate,input,capture,report,inputHash:evidenceHash(input),captureHash:evidenceHash(capture)};
}
for(const stage of ['historical-replay','pending-decision'])test(`version2 binds the actual failed prefix and original inputs at ${stage}, without assuming a writer failure`,()=>{
 const f=detailedFixture(stage);assert.equal(assertReviewedRehearsalRefusal(f.proof,f),f.proof.rehearsalFailure);assertReviewedRefusalObservation(f.proof,observation(f.proof));
 for(const mutate of [x=>x.proof.rehearsalFailure.stage='unknown',x=>x.proof.rehearsalFailure.completedChecks.pop(),x=>x.proof.rehearsalFailure.inputHash='sha256:'+'0'.repeat(64),x=>x.proof.rehearsalFailure.captureHash='sha256:'+'0'.repeat(64),x=>x.report.status='passed',x=>x.report.execution='simulation',x=>x.report.checks[0].status='failed',x=>x.report.checks.reverse(),x=>x.input.backup.createdAt='2020-01-01',x=>x.input.active.status='different',x=>x.input.manifest.releaseId='substituted',x=>x.report.candidateHash='sha256:'+'0'.repeat(64),x=>x.report.cleanup.errors.push('incomplete'),x=>x.report.cleanup.resourceCount++,x=>x.report.failureStage='start',x=>x.capture.status='changed',x=>x.report.kind='local-candidate-rehearsal']){
  const changed=structuredClone(f);mutate(changed);assert.throws(()=>assertReviewedRehearsalRefusal(changed.proof,changed));
 }
 const changed=observation(f.proof);changed.rehearsalFailure.inputHash='sha256:'+'0'.repeat(64);assert.throws(()=>assertReviewedRefusalObservation(f.proof,changed));
});
test('reviewed refusal binds exact failed workflow, existing genuine baseline and immutable host observations',()=>{
 const p=structuredClone(original);validateReviewedDeploymentRefusal(p);
 assertReviewedRefusalRun(p,{identity:{id:p.failed.id,runAttempt:1,repository:p.repository,controlCommit:p.failed.controlCommit,event:'workflow_dispatch',conclusion:'failure'},job:{conclusion:'failure',completed_at:p.failed.completedAt},now:Date.parse(p.observedAt)});
 assertReviewedRefusalBaseline(p,{id:p.baseline.id,runAttempt:1,controlCommit:p.baseline.controlCommit});
 assert.equal(assertReviewedRefusalObservation(p,observation(p)).status,'verified-reviewed-pre-cutover-refusal');
});
test('unknown outcome, writer mutation, unresolved cleanup or absent source-controlled proof cannot permit recovery',()=>{
 for(const change of [p=>p.status='unknown',p=>p.cleanup.deploymentJournalCreated=true,p=>p.cleanup.deployLockPresent=true,p=>p.cleanup.remainingOwnedResources=1,p=>p.providerRequests=1,p=>p.serviceReplacements=1,p=>p.failed.attempt=2,p=>p.phaseHashes.pop(),p=>p.retained.pop(),p=>p.services.backend.healthy=false,p=>p.observedAt='future',p=>p.extra=true]){const p=structuredClone(original);change(p);assert.throws(()=>validateReviewedDeploymentRefusal(p));}
});
test('host recheck refuses drift in each captured immutable, runtime, database, journal and cleanup binding',()=>{
 for(const key of ['hostConfigHash','transferHash','rehearsalHash','phaseHashes','retained','operations','services','protectedRuntime','databaseBindingHash','routingSecurityHash','activeHash','cleanupComplete']){const actual=observation(original);actual[key]=key==='cleanupComplete'?false:null;assert.throws(()=>assertReviewedRefusalObservation(original,actual),key);}
});
test('source-controlled loader has no inference from missing proofs and rejects changed identity or unsafe fields',t=>{
 const root=mkdtempSync(path.join(tmpdir(),'reviewed-refusal-'));t.after(()=>{assert.equal(path.dirname(root),path.resolve(tmpdir()));assert.ok(path.basename(root).startsWith('reviewed-refusal-'));rmSync(root,{recursive:true,force:true});});
 const options={id:original.failed.id,attempt:1,repository:original.repository,controlRoot:root};assert.equal(loadReviewedDeploymentRefusal(options),null);assert.equal(loadReviewedDeploymentRefusal({...options,attempt:2}),null);
 const directory=path.join(root,'infra','reviewed-deployment-refusals');mkdirSync(directory,{recursive:true});const file=path.join(directory,`${options.id}-1.json`);writeFileSync(file,JSON.stringify(original));assert.deepEqual(loadReviewedDeploymentRefusal(options),original);
 assert.throws(()=>loadReviewedDeploymentRefusal({...options,repository:'foreign/repository'}));writeFileSync(file,JSON.stringify({...original,providerRequests:1}));assert.throws(()=>loadReviewedDeploymentRefusal(options));
});
test('rerun, changed failure time, future audit or different baseline cannot reuse a reviewed refusal',()=>{
 const identity={id:original.failed.id,runAttempt:1,repository:original.repository,controlCommit:original.failed.controlCommit,event:'workflow_dispatch',conclusion:'failure'},job={conclusion:'failure',completed_at:original.failed.completedAt},now=Date.parse(original.observedAt);
 for(const patch of [{runAttempt:2},{id:1},{event:'workflow_run'},{controlCommit:'f'.repeat(40)},{conclusion:'success'}])assert.throws(()=>assertReviewedRefusalRun(original,{identity:{...identity,...patch},job,now}));
 assert.throws(()=>assertReviewedRefusalRun(original,{identity,job:{...job,completed_at:'2026-01-01T00:00:00Z'},now}));assert.throws(()=>assertReviewedRefusalRun(original,{identity,job,now:now-1}));
 assert.throws(()=>assertReviewedRefusalBaseline(original,{id:original.baseline.id+1,runAttempt:1,controlCommit:original.baseline.controlCommit}));assert.throws(()=>assertReviewedRefusalBaseline(original,{id:original.baseline.id,runAttempt:1,controlCommit:original.baseline.controlCommit},{releaseId:original.baseline.releaseId}));
});
const rerunTemplate=JSON.parse(readFileSync(new URL('../../infra/reviewed-deployment-refusals/37481467119-1.json',import.meta.url),'utf8'));rerunTemplate.schemaVersion=3;rerunTemplate.failed.attempt=2;rerunTemplate.failed.event='workflow_run';rerunTemplate.baseline.attempt=3;rerunTemplate.rehearsalFailure.stage='start';rerunTemplate.rehearsalFailure.completedChecks=[];
for(const template of [original,...['37414694346','37420370284','37428679118'].map(id=>JSON.parse(readFileSync(new URL('../../infra/reviewed-deployment-refusals/'+id+'-1.json',import.meta.url),'utf8'))),rerunTemplate])test(`Linux private host reader accepts ${template.failed.id}/${template.failed.attempt} ${template.phaseHashes.length}-phase 0644 evidence, rechecks under lock and refuses later-stage files`,{skip:process.platform!=='linux'},async t=>{
 const original=template;
 const root=mkdtempSync(path.join(tmpdir(),'refusal-host-reader-'));t.after(()=>{assert.equal(path.dirname(root),path.resolve(tmpdir()));assert.ok(path.basename(root).startsWith('refusal-host-reader-'));rmSync(root,{recursive:true,force:true});});
 const write=(file,value,mode=0o600)=>{mkdirSync(path.dirname(file),{recursive:true,mode:0o700});writeFileSync(file,typeof value==='string'?value:JSON.stringify(value),{mode});},digest=file=>'sha256:'+createHash('sha256').update(readFileSync(file)).digest('hex');
 const manifest=structuredClone(uiFixture().planning.input.previousManifest),active={schemaVersion:1,status:'active',manifest,instances:Object.fromEntries(Object.keys(manifest.components).map(k=>[k,{releaseId:manifest.releaseId,releaseCommit:manifest.releaseCommit}]))};
 const p=structuredClone(original);Object.assign(p,{repository:'fixture/project',operations:[],failedReleaseId:'failed-candidate'});Object.assign(p.baseline,{releaseId:manifest.releaseId,manifestHash:evidenceHash(manifest),activeHash:evidenceHash(active)});
 const old=root+'/attempts/deploy-'+p.failed.id+'-'+p.failed.attempt,current=root+'/attempts/deploy-42-1',hostFile=root+'/host-config.json';mkdirSync(old,{recursive:true,mode:0o700});mkdirSync(current,{recursive:true,mode:0o700});
 const config={root:root+'/app'};write(hostFile,config);write(config.root+'/active.json',active);mkdirSync(config.root+'/operations');
 const request={schemaVersion:1,repository:p.repository,actor:'unit-test',eventName:'workflow_dispatch',mode:'apply',runId:'42',attempt:'1',controlCommit:'b'.repeat(40),sourceCommit:'b'.repeat(40),attemptRoot:root+'/attempts',hostConfig:hostFile,rehearsalConfig:root+'/rehearsal-config.json',nodePath:'/usr/bin/node',productionEnabled:'true'};
 const packet=(req,releaseId)=>{const candidate={manifest:{...structuredClone(manifest),releaseId,releaseCommit:req.sourceCommit,previousReleaseId:manifest.releaseId},provenance:{schemaVersion:1,releaseRunId:9,controlCommit:req.controlCommit,sourceCommit:req.sourceCommit,planHash:'sha256:'+'f'.repeat(64)}};candidate.provenance.manifestHash=evidenceHash(candidate.manifest);return {request:req,files:Object.fromEntries(Object.entries({'candidate.json':candidate,'manifest.json':candidate.manifest,'core-report.json':{status:'passed'},'verified-release-run.json':{id:9,workflow:'.github/workflows/release.yml',controlCommit:req.controlCommit}}).map(([file,value])=>{const text=JSON.stringify(value);return[file,{text,sha256:'sha256:'+createHash('sha256').update(text).digest('hex')}];}))};};
 const oldPacket=packet({...request,runId:String(p.failed.id),attempt:String(p.failed.attempt),eventName:p.failed.event??'workflow_dispatch',controlCommit:p.failed.controlCommit,sourceCommit:p.failed.controlCommit},p.failedReleaseId);write(old+'/transfer.json',oldPacket);write(current+'/transfer.json',packet(request,'next-candidate'));p.transferHash=digest(old+'/transfer.json');p.candidateManifestHash=evidenceHash(JSON.parse(oldPacket.files['manifest.json'].text));p.hostConfigHash=digest(hostFile);
 const scripts=reviewedRefusalPhaseScripts(p);p.phaseHashes=scripts.map((script,i)=>{const file='phase-'+String(i+1).padStart(2,'0')+'.json';write(old+'/'+file,{script,status:'started'});return{file,sha256:digest(old+'/'+file)};});
 if(isCompletedRestoreRefusal(p)){
  const backupDirectory=config.root+'/backups/capture-'+p.failed.id+'-1';
  const files=[['database.dump','database','owned synthetic database'],['prior.cjs','rules-artifact','module.exports={}'],['media.json','media-manifest','[]'],['release.json','release-manifest',manifest]].map(([file,category,value])=>{const full=backupDirectory+'/'+file;write(full,value);return{path:file,category,sha256:digest(full),bytes:statSync(full).size};});
  const backup={schemaVersion:1,kind:'release-backup',status:'captured',createdAt:p.expiry.capturedAt,schemaFingerprint:'sha256:'+'a'.repeat(64),files,artifactInventoryComplete:true,referencedArtifactHashes:[files[1].sha256],releaseManifestHash:p.baseline.manifestHash};
  const capture={schemaVersion:1,kind:'candidate-capture',status:'captured',createdAt:backup.createdAt,activeHash:p.baseline.activeHash,releaseManifestHash:p.baseline.manifestHash};
  const oldCandidate=JSON.parse(oldPacket.files['candidate.json'].text),input={active,backup,activeHash:p.baseline.activeHash,backupHash:evidenceHash(backup),candidateHash:evidenceHash(oldCandidate)};
  const restore={schemaVersion:1,status:'passed',scope:'accepted-deployment-recovery',backupHash:input.backupHash,schemaFingerprint:backup.schemaFingerprint,rehearsalHash:p.expiry.restoreRehearsalHash,cleanup:{status:'stopped',errors:[],resourceCount:19},checks:['snapshot','artifacts','migrations','pending-decision','duplicate-command','media-references'].map(id=>({id,status:'passed'}))};
  write(backupDirectory+'/capture.json',capture);write(backupDirectory+'/backup.json',backup);write(old+'/rehearsal/input.json',input);write(backupDirectory+'/restore-report.json',restore);
  const stamp=new Date(p.expiry.restoreReportWrittenAt);utimesSync(backupDirectory+'/restore-report.json',stamp,stamp);p.expiry.restoreReportWrittenAt=statSync(backupDirectory+'/restore-report.json').mtime.toISOString();
  for(const name of ['candidate-rehearsal.mjs','backup-manifest.mjs'])write(old+'/control/scripts/release/'+name,readFileSync(new URL(name,import.meta.url),'utf8'),0o644);
  for(const[key,file]of Object.entries({captureHash:backupDirectory+'/capture.json',backupFileHash:backupDirectory+'/backup.json',inputHash:old+'/rehearsal/input.json',restoreReportHash:backupDirectory+'/restore-report.json',collectorCodeHash:old+'/control/scripts/release/candidate-rehearsal.mjs',backupCodeHash:old+'/control/scripts/release/backup-manifest.mjs'}))p.expiry[key]=digest(file);
 }else if([2,3].includes(p.schemaVersion)){
  const candidate=JSON.parse(oldPacket.files['candidate.json'].text),startedAt=new Date(Date.parse(p.rehearsalCompletedAt)-1000).toISOString();
  const capture={schemaVersion:1,kind:'candidate-capture',status:'captured',createdAt:new Date(Date.parse(startedAt)-1000).toISOString(),activeHash:p.baseline.activeHash,releaseManifestHash:p.baseline.manifestHash};
  const backup={createdAt:capture.createdAt,releaseManifestHash:p.baseline.manifestHash};
  const input={active,manifest:candidate.manifest,backup,activeHash:p.baseline.activeHash,candidateHash:evidenceHash(candidate),backupHash:evidenceHash(backup),compositionFingerprint:compositionFingerprint(candidate.manifest)};
  const report={schemaVersion:1,kind:'candidate-rehearsal',execution:'docker',status:'failed',failure:'candidate-rehearsal-failed',failureStage:p.rehearsalFailure.stage,runId:p.rehearsalRunId,startedAt,completedAt:p.rehearsalCompletedAt,releaseId:p.failedReleaseId,activeHash:input.activeHash,candidateHash:input.candidateHash,backupHash:input.backupHash,compositionFingerprint:input.compositionFingerprint,checks:p.rehearsalFailure.completedChecks.map(id=>({id,status:'passed'})),cleanup:{status:'stopped',errors:[],resourceCount:p.rehearsalFailure.cleanupResourceCount}};
  const inputFile=old+'/rehearsal/input.json',captureFile=config.root+'/backups/capture-'+p.failed.id+'-'+p.failed.attempt+'/capture.json';write(inputFile,input);write(captureFile,capture);write(old+'/rehearsal/rehearsal.json',report);
  p.rehearsalHash=digest(old+'/rehearsal/rehearsal.json');p.rehearsalFailure.inputHash=digest(inputFile);p.rehearsalFailure.captureHash=digest(captureFile);
 }else{
  write(old+'/rehearsal/rehearsal.json',{status:'failed',failureStage:'writer-compatibility',runId:p.rehearsalRunId,activeHash:p.baseline.activeHash,completedAt:p.rehearsalCompletedAt,cleanup:{status:'stopped',errors:[]},checks:Array.from({length:8},()=>({status:'passed'}))});p.rehearsalHash=digest(old+'/rehearsal/rehearsal.json');
 }
 if(p.schemaVersion===3){write(config.root+'/operations/maintenance/metadata.json','immutable maintenance');p.operations=snapshotRefusalOperations(config.root+'/operations',{recursive:true});}
 p.retained=p.retained.map(row=>{const file=config.root+'/releases/'+manifest.releaseId+'/'+row.file;write(file,'Unit retained bytes: '+row.file);return{file:row.file,sha256:digest(file)};});const controlFile=current+'/control/infra/reviewed-deployment-refusals/'+p.failed.id+'-'+p.failed.attempt+'.json';write(controlFile,p,0o644);chmodSync(controlFile,0o644);
 const get=async route=>route.endsWith('/jobs?filter=latest&per_page=100')?{total_count:1,jobs:[{name:'deploy',run_id:p.failed.id,run_attempt:p.failed.attempt,head_sha:p.failed.controlCommit,status:'completed',conclusion:'failure',completed_at:p.failed.completedAt}]}:{id:p.failed.id,run_attempt:p.failed.attempt,head_sha:p.failed.controlCommit,event:p.failed.event??'workflow_dispatch',path:'.github/workflows/deploy.yml',head_branch:'main',repository:{full_name:p.repository},head_repository:{full_name:p.repository},status:'completed',conclusion:'failure'};
 const options={directory:current,get,command:()=>'',observe:async()=>structuredClone(p)};assert.equal((await assertHostReviewedDeploymentRefusal(options)).status,'verified-reviewed-refusals');write(config.root+'/deploy.lock/owner.json',{pid:process.pid});assert.equal((await assertHostReviewedDeploymentRefusal({...options,underLock:true})).status,'verified-reviewed-refusals');
 write(old+'/ready/manifest.json',{});await assert.rejects(assertHostReviewedDeploymentRefusal({...options,underLock:true}));
});
