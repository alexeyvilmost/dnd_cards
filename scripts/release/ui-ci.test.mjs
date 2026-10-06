import test from 'node:test';import assert from 'node:assert/strict';import {mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';import path from 'node:path';
import {loadPublishedUIPlanning} from './ui-ci.mjs';import {prepareDispatchedBuild} from './ui-release-plan.mjs';
import {selectLatestDeployedRun} from './deployed-baseline.mjs';import {assembleCandidateManifest} from './ci-release.mjs';
import {createUIProofProjection} from './ui-proof-projection.mjs';import {runtimeCompatibilityHash} from './ui-release-policy.mjs';import {safeExecutionEnvironment} from './ui-execution-profile.mjs';
import {evidenceHash} from './validate-manifest.mjs';import {fixture,recordsFor,publishedFor} from './ui-planning-unit-fixture.mjs';import {uiFixture} from './ui-release-unit-fixture.mjs';
async function setup(t){
 const f=fixture(t),first=f.plan(f.candidate),manifest=assembleCandidateManifest(first,recordsFor(first),publishedFor(first)).manifest,repository='fixture/project';
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
