import test from 'node:test';import assert from 'node:assert/strict';import {mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';import path from 'node:path';
import {loadPublishedUIPlanning,githubReader} from './ui-ci.mjs';import {githubMetadataDiagnostic} from './github-metadata.mjs';import {prepareDispatchedBuild} from './ui-release-plan.mjs';
import {selectLatestDeployedRun} from './deployed-baseline.mjs';import {assembleCandidateManifest} from './ci-release.mjs';
import {createUIProofProjection} from './ui-proof-projection.mjs';import {runtimeCompatibilityHash} from './ui-release-policy.mjs';import {safeExecutionEnvironment} from './ui-execution-profile.mjs';
import {evidenceHash} from './validate-manifest.mjs';import {fixture,recordsFor,publishedFor} from './ui-planning-unit-fixture.mjs';import {uiFixture} from './ui-release-unit-fixture.mjs';
import {catalogTests} from '../testing/suites.mjs';import {suiteWorkload} from '../testing/workload.mjs';
import {retirementStateUnitFixture} from './retirement-state-unit-fixture.mjs';
import {retirementDatabaseStateFromInspection} from './retirement-state.mjs';
import {projectRetirementObservation,retirementBaselineReceipt} from './retirement-projection.mjs';
import {createDeploymentStore} from './deploy-state.mjs';
async function setup(t,{suiteManifest={groups:[],legacy_manual:[]},files={}}={}){
 const f=fixture(t);mkdirSync(path.join(f.repo,'tests'));writeFileSync(path.join(f.repo,'tests/suites.json'),JSON.stringify(suiteManifest));
 for(const [file,text] of Object.entries(files)){mkdirSync(path.dirname(path.join(f.repo,file)),{recursive:true});writeFileSync(path.join(f.repo,file),text);}
 const first=f.plan(f.commit()),manifest=assembleCandidateManifest(first,recordsFor(first),publishedFor(first)).manifest,repository='fixture/project';
 const raw={id:71,run_attempt:2,path:'.github/workflows/deploy.yml',head_sha:'c'.repeat(40),head_branch:'main',event:'workflow_run',status:'completed',conclusion:'success',repository:{full_name:repository},head_repository:{full_name:repository}};
 const job={id:711,run_id:71,run_attempt:2,head_sha:raw.head_sha,name:'deploy',status:'completed',conclusion:'success',started_at:'2026-01-01T00:00:00Z',completed_at:'2026-01-01T00:10:00Z'};
 const artifact={id:712,name:'deployed-release',expired:false,size_in_bytes:2048,created_at:'2026-01-01T00:09:00Z',expires_at:'2099-01-01T00:00:00Z',workflow_run:{id:71,head_sha:raw.head_sha}};
 const get=async route=>{const p=new URL(route,'https://unit.invalid/').pathname;if(p==='/actions/workflows/deploy.yml/runs')return {total_count:1,workflow_runs:[structuredClone(raw)]};if(p==='/actions/runs/71')return structuredClone(raw);if(p==='/actions/runs/71/jobs')return {total_count:1,jobs:[structuredClone(job)]};if(p==='/actions/runs/71/artifacts')return {total_count:1,artifacts:[structuredClone(artifact)]};throw Error('Unexpected test metadata route');};
 const run=await selectLatestDeployedRun(get,{repository}),baselineDirectory=path.join(f.directory,'baseline');mkdirSync(baselineDirectory);
 const receipt={schemaVersion:1,status:'succeeded',releaseId:manifest.releaseId,releaseCommit:manifest.releaseCommit,controlCommit:raw.head_sha,manifestHash:evidenceHash(manifest)};
 const unit=uiFixture(),domain=unit.planning.input.previousDomain,row=first.matrix.find(row=>row.component==='frontend');domain.frontendBuildContractHash=evidenceHash({baseImages:row.baseImages,buildArguments:row.buildArguments,platform:row.platform});
 const binding={...unit.planning.input.fullAnchor,manifestHash:evidenceHash(manifest),runtimeCompatibilityHash:runtimeCompatibilityHash(manifest,domain)};
 const executionProfile={schemaVersion:1,...Object.fromEntries(['backend','rulesWorker'].map(component=>[component,{instance:{releaseId:manifest.releaseId,releaseCommit:manifest.releaseCommit},environment:safeExecutionEnvironment(component,[])}]))};
 const projection=createUIProofProjection({kind:'protected-full-ui-anchor',status:'captured-after-success',binding,anchor:{domain},observedAt:'2026-10-05T00:00:00Z',executionProfile},{manifest,run});
 for(const [name,value] of Object.entries({'manifest.json':manifest,'deployment.json':receipt,'frontend-proof-anchor.json':projection}))writeFileSync(path.join(baselineDirectory,name),JSON.stringify(value));
 const options=()=>({get,repository,run,baselineDirectory,repo:f.repo,candidate:f.git(['rev-parse','HEAD']),config:{...first.config,contentManifestHash:evidenceHash(JSON.parse(readFileSync(path.join(f.repo,'infra/release-content-manifest.json'),'utf8')))}});
 return {...f,first,manifest,raw,job,artifact,get,run,baselineDirectory,projection,options};
}
test('downloaded planning binds exact latest deployed attempt, source, profile and projection',async t=>{
 const f=await setup(t);mkdirSync(path.join(f.repo,'frontend/src/components'));writeFileSync(path.join(f.repo,'frontend/src/components/Button.tsx'),'export const Button=()=>null;');writeFileSync(path.join(f.repo,'frontend/src/components/Button.test.tsx'),'// canonical adjacent corpus');f.commit();
 const planning=await loadPublishedUIPlanning(f.options());assert.equal(planning.eligibility.kind,'frontend-only');assert.deepEqual(planning.executionProfile,f.projection.executionProfile);assert.equal(planning.input.baselineBinding.artifactId,712);assert.equal(planning.input.baselineBinding.runAttempt,2);
 f.raw.run_attempt++;f.job.run_attempt++;await assert.rejects(loadPublishedUIPlanning(f.options()),/changed while downloading/);
});

test('planning and mandatory workload share TS/TSX inventory and exclude explicit manual tests',async t=>{
 const manifest={groups:[],legacy_manual:[{id:'manual-diagnostic',patterns:['frontend/src/components/Old.test.tsx'],reason:'Explicit manual-only diagnostic',runner:'vitest'}]};
 const f=await setup(t,{suiteManifest:manifest,files:{'frontend/src/components/Calculation.test.ts':'// current TS test','frontend/src/components/Old.test.tsx':'// explicitly manual diagnostic'}}),directory=path.join(f.repo,'frontend/src/components');
 for(const [file,text] of Object.entries({'Button.tsx':'export const Button=()=>null;','Button.test.tsx':'// current presentation test'}))writeFileSync(path.join(directory,file),text);f.commit();
 const planning=await loadPublishedUIPlanning(f.options());assert.equal(planning.eligibility.kind,'frontend-only');
 assert.deepEqual(planning.input.testCatalog,['frontend/src/components/Button.test.tsx','frontend/src/components/Calculation.test.ts']);
 const workload=suiteWorkload({selection:uiFixture().selectionGroups,catalog:catalogTests(manifest,f.repo),manifest,suite:'core',frontendPlanning:planning});
 assert.deepEqual(workload.vitestFiles,['frontend/src/components/Button.test.tsx']);
 const incomplete={...planning.input,testCatalog:['frontend/src/components/Button.test.tsx']};
 // A mismatched catalog remains a refusal; do not widen eligibility silently.
 const {classifyReleaseVerification}=await import('./ui-release-policy.mjs');
 assert.throws(()=>suiteWorkload({selection:uiFixture().selectionGroups,catalog:catalogTests(manifest,f.repo),manifest,suite:'core',frontendPlanning:{input:incomplete,eligibility:classifyReleaseVerification(incomplete)}}),/mandatory catalog/);
});
test('missing anchor requires full path but provided malformed or substituted evidence is rejected',async t=>{
 const f=await setup(t),file=path.join(f.baselineDirectory,'frontend-proof-anchor.json');rmSync(file);
 assert.equal((await loadPublishedUIPlanning(f.options())).eligibility.reason,'no-published-full-anchor');
 for(const patch of [{sourceCommit:'f'.repeat(40)},{runAttempt:1},{anchorHash:'not-a-hash'},{privateFile:'/secret'}]){writeFileSync(file,JSON.stringify({...f.projection,...patch}));await assert.rejects(loadPublishedUIPlanning(f.options()),/projection/);}
 writeFileSync(file,JSON.stringify(f.projection));const receipt=JSON.parse(readFileSync(path.join(f.baselineDirectory,'deployment.json'),'utf8'));receipt.manifestHash='sha256:'+'0'.repeat(64);writeFileSync(path.join(f.baselineDirectory,'deployment.json'),JSON.stringify(receipt));await assert.rejects(loadPublishedUIPlanning(f.options()),/attested/);
});
test('canonical documentation-only dispatch creates no candidate and leaves deployed baseline bytes unchanged',async t=>{
 const f=await setup(t),before=readFileSync(path.join(f.baselineDirectory,'manifest.json'));writeFileSync(path.join(f.repo,'README.md'),'Documentation-only change');const candidate=f.commit();
 const options={...f.options(),candidate,suiteReport:{},verification:{},controlCommit:candidate,releaseRunId:44};const result=await prepareDispatchedBuild(options,{get:f.get});
 assert.equal(result.kind,'no-deployment-needed');for(const key of ['publishImages','createCandidate','deploy','advanceBaseline'])assert.equal(result[key],false);assert.equal(result.previousManifestHash,evidenceHash(f.manifest));assert.deepEqual(readFileSync(path.join(f.baselineDirectory,'manifest.json')),before);assert.equal(result.matrix,undefined);
});
test('exact retirement artifact forces extended planning despite an existing frontend anchor',async t=>{
 const f=await setup(t),s=retirementStateUnitFixture();s.active.manifest.releaseCommit=f.candidate;
 const active={...s.active,database:retirementDatabaseStateFromInspection(s,s.inspection)},stamp='2026-10-06T00:00:00Z',operation={schemaVersion:1,kind:'character-retirement-observation-302',releaseId:s.request.releaseId,status:'succeeded',previous:s.active,desired:active,transitionHash:evidenceHash({previous:s.active,desired:active}),createdAt:stamp,updatedAt:stamp};
 const root=path.join(f.directory,'protected');mkdirSync(root);const store=createDeploymentStore(root);store.writeActive(active);store.writeOperation(operation);
 const request={repository:'fixture/project',runId:f.run.id,attempt:f.run.runAttempt,controlCommit:f.run.controlCommit,sourceCommit:f.candidate},p=projectRetirementObservation({store,operation,manifest:s.active.manifest,request});
 for(const [name,value] of Object.entries({'manifest.json':s.active.manifest,'deployment.json':retirementBaselineReceipt(p),'retirement-observation.json':p}))writeFileSync(path.join(f.baselineDirectory,name),JSON.stringify(value));
 const planning=await loadPublishedUIPlanning(f.options());assert.deepEqual(planning,{eligibility:{kind:'full',requiredTier:'extended',reason:'recorded-character-retirement'}});
 rmSync(path.join(f.baselineDirectory,'retirement-observation.json'));await assert.rejects(loadPublishedUIPlanning(f.options()),/Exact retirement artifact/);
});


test('workflow predecessor lookup survives a temporary HTTP 500 using actual fresh GET metadata',async t=>{
 const f=await setup(t),requests=[],waits=[],diagnostics=[];let failed=false;
 const get=githubReader('fixture/project','private-unit-workflow-token',{wait:async ms=>waits.push(ms),onDiagnostic:row=>diagnostics.push(row),request:async(url,options)=>{
  requests.push({url,method:options.method,redirect:options.redirect});
  if(!failed){failed=true;return new Response('private-unit-workflow-token',{status:500});}
  const route=url.slice('https://api.github.com/repos/fixture/project/'.length);return Response.json(await f.get(route));
 }});
 assert.deepEqual(await selectLatestDeployedRun(get,{repository:'fixture/project'}),f.run);assert.deepEqual(waits,[1000]);assert.equal(diagnostics.length,1);assert.equal(diagnostics[0].operation,'workflow-github-metadata');assert.equal(diagnostics[0].status,500);
 assert.ok(requests.every(row=>row.method==='GET'&&row.redirect==='error'));assert.equal(requests[0].url,requests[1].url);assert.ok(!JSON.stringify(diagnostics).includes('private-unit-workflow-token'));
});
test('latest main GET retries are bounded and successful metadata is fetched again for freshness',async()=>{
 const requests=[],waits=[];let calls=0;const get=githubReader('fixture/project','private-unit-workflow-token',{wait:async ms=>waits.push(ms),request:async(url,options)=>{
  requests.push({url,method:options.method});calls++;if(calls===1)return new Response('',{status:502});return Response.json({sha:String(calls).repeat(40)});
 }});
 assert.deepEqual(await get('commits/main'),{sha:'2'.repeat(40)});assert.deepEqual(await get('commits/main'),{sha:'3'.repeat(40)});assert.equal(calls,3);assert.deepEqual(waits,[1000]);assert.ok(requests.every(row=>row.method==='GET'&&row.url.endsWith('/commits/main')));
 let failures=0;const unavailable=githubReader('fixture/project','private-unit-workflow-token',{wait:async()=>{},request:async()=>{failures++;return new Response('private-unit-workflow-token',{status:500});}});
 await assert.rejects(unavailable('commits/main'),error=>{const diagnostic=githubMetadataDiagnostic(error);assert.equal(diagnostic.attempt,3);assert.equal(diagnostic.status,500);assert.ok(!String(error).includes('private-unit-workflow-token'));return true;});assert.equal(failures,3);
});
test('workflow metadata denies invalid routes, authorization failures and malformed successful JSON without retrying writes',async()=>{
 let calls=0;const get=githubReader('fixture/project','private-unit-workflow-token',{request:async()=>{calls++;return Response.json({});}});
 for(const route of ['https://elsewhere.invalid','actions/../commits/main','commits/other','actions/runs/1#secret','pulls/1'])await assert.rejects(get(route),/Invalid metadata route/);assert.equal(calls,0);
 for(const response of [()=>new Response('private-unit-workflow-token',{status:403}),()=>new Response('not JSON',{status:200})]){
  let reads=0;const denied=githubReader('fixture/project','private-unit-workflow-token',{wait:async()=>{throw Error('No retry allowed');},request:async()=>{reads++;return response();}});
  await assert.rejects(denied('actions/runs/12'),error=>{const diagnostic=githubMetadataDiagnostic(error);assert.equal(diagnostic.attempt,1);assert.ok(!String(error).includes('private-unit-workflow-token'));return true;});assert.equal(reads,1);
 }
});
