import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {execFileSync, spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {assembleCandidateManifest, prepareBuildPlan, validateBuildConfig, validateBuildPlan, validateComponentRecord,
  verifyBaseline, verifyRun, verifySuiteReport, requiredVerificationTier, verifyGithubRunIdentity} from './ci-release.mjs';
import {assertPublicationInput, fileHash} from './ci-images.mjs';
import {verifyCandidateProvenance} from './deployment-handoff.mjs';
import {assertReleaseReady, evidenceHash} from './validate-manifest.mjs';
import {sourceContentManifest} from './source-content-manifest.mjs';
const yaml = createRequire(new URL('../../frontend/package.json', import.meta.url))('js-yaml');
const sha = char => `sha256:${char.repeat(64)}`;
const repository = 'fixture/project';
import {loadControlRecovery} from './first-adoption-recovery.mjs';
import {prepareDispatchedBuild} from './ui-release-plan.mjs';
import {retirementStateUnitFixture} from './retirement-state-unit-fixture.mjs';
import {retirementDatabaseStateFromInspection} from './retirement-state.mjs';
import {projectRetirementObservation,retirementBaselineReceipt} from './retirement-projection.mjs';
import {createDeploymentStore} from './deploy-state.mjs';
function config() {return {schemaVersion: 1, enabled: true, platform: 'linux/amd64', frontendApiUrl: '', contentManifestHash: sha('a'), migrationSet: [],
  buildkitImage: `moby/buildkit@${sha('b')}`, baseImages: Object.fromEntries(['GO_IMAGE', 'ALPINE_IMAGE', 'NODE_IMAGE', 'NGINX_IMAGE'].map((key, i) => [key, `example.test/base/${key.toLowerCase()}@${sha(String(i + 1))}`]))};}
function report(candidate) {return {schema_version: 1, status: 'passed', suite: 'extended',ci_source:{clean_checkout:true}, source_snapshot:{sha256:'a'.repeat(64),files:4},candidate: {sha: candidate}, component_plan: {mode: 'ci', candidate: {sha: candidate}},
  checks: ['source-hygiene', 'source-stability', 'local-api-spine', 'local-browser-flows'].map(id => ({id, status: 'passed',...(id==='source-stability'?{result:{unchanged:true,sha256:'a'.repeat(64),files:4}}:{})})), cleanup: {status: 'stopped', errors: []}};}
function trustedRun(candidate) {return {id: 10, path: '.github/workflows/ci.yml', status: 'completed', conclusion: 'success', event: 'push', head_branch: 'main', head_sha: candidate,
  repository: {full_name: repository}, head_repository: {full_name: repository}};}
test('the release CLI retains the exact verified predecessor artifact and rejects attempt drift',async()=>{
  const source='a'.repeat(40),raw={...trustedRun(source),path:'.github/workflows/deploy.yml',event:'workflow_dispatch',run_attempt:1};
  const completedAt='2026-10-04T10:01:00Z',now=Date.parse('2026-10-04T12:00:00Z');
  const get=async route=>{
    if(route==='actions/runs/10')return structuredClone(raw);
    if(route.startsWith('actions/workflows/deploy.yml/runs?'))return {total_count:1,workflow_runs:[structuredClone(raw)]};
    if(route.startsWith('actions/runs/10/jobs?'))return {total_count:1,jobs:[{id:100,run_id:10,run_attempt:1,head_sha:source,name:'deploy',status:'completed',conclusion:'success',started_at:'2026-10-04T10:00:00Z',completed_at:completedAt}]};
    if(route.startsWith('actions/runs/10/artifacts?'))return {total_count:1,artifacts:[{id:1234,name:'deployed-release',expired:false,size_in_bytes:2048,created_at:'2026-10-04T10:00:30Z',expires_at:'2027-01-01T00:00:00Z',workflow_run:{id:10,head_sha:source}}]};
    throw Error('Unexpected metadata route');
  };
  const verified=await verifyGithubRunIdentity(get,{runId:'10',repository,kind:'deployment',now});
  assert.equal(verified.artifactId,1234);assert.equal(verified.runAttempt,1);assert.equal(verified.completedAt,completedAt);assert.equal(verified.controlCommit,source);
  let first=true;
  await assert.rejects(verifyGithubRunIdentity(async route=>{if(first&&route==='actions/runs/10'){first=false;return {...raw,run_attempt:2};}return get(route);},{runId:'10',repository,kind:'deployment',now}),/manifest attempt/);
  await assert.rejects(verifyGithubRunIdentity(get,{runId:'11',repository,kind:'deployment',now}),/Unexpected/);
});
function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'release-ci-fixture-')), repo = path.join(directory, 'source'); mkdirSync(repo);
  t.after(() => {assert.equal(path.dirname(directory), path.resolve(tmpdir())); assert.ok(path.basename(directory).startsWith('release-ci-fixture-')); rmSync(directory, {recursive: true, force: true});});
  const files = {
    'backend/main.go': 'package main\nfunc main(){}\n', 'backend/Dockerfile': 'FROM scratch\nCOPY main.go /main.go\n',
    'backend/.dockerignore': '**\n!main.go\n!Dockerfile\n!.dockerignore\n',
    'frontend/src/index.ts': 'export const value = 1;\n', 'frontend/Dockerfile': 'FROM scratch\nCOPY frontend/src /src\n',
    'frontend/Dockerfile.dockerignore': '**\n!frontend/src/**\n!frontend/Dockerfile\n!frontend/Dockerfile.dockerignore\n',
    'frontend/worker/server.mjs': 'export const worker = 1;\n', 'infra/Dockerfile.rules-worker': 'FROM scratch\nCOPY frontend/worker /worker\n',
    'infra/Dockerfile.rules-worker.dockerignore': '**\n!frontend/worker/**\n!infra/Dockerfile.rules-worker\n!infra/Dockerfile.rules-worker.dockerignore\n',
  };
  for (const [file, text] of Object.entries(files)) {mkdirSync(path.dirname(path.join(repo, file)), {recursive: true}); writeFileSync(path.join(repo, file), text);}
  const git = args => execFileSync('git', args, {cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  git(['init', '--initial-branch=main']); git(['config', 'user.name', 'Local fixture']); git(['config', 'user.email', 'fixture@example.invalid']);
  function commit() {writeFileSync(path.join(repo,'infra/release-content-manifest.json'),JSON.stringify(sourceContentManifest(repo)));git(['add', '.']); git(['commit', '-m', 'fixture']); const candidate = git(['rev-parse', 'HEAD']); git(['update-ref', 'refs/remotes/origin/main', candidate]); return candidate;}
  function plan(candidate, extra = {}) {return prepareBuildPlan({repo, candidate, repository, controlCommit:candidate, releaseRunId:42, config: {...config(),contentManifestHash:evidenceHash(JSON.parse(readFileSync(path.join(repo,'infra/release-content-manifest.json'),'utf8')))},
    verification: verifyRun(trustedRun(candidate), {repository, candidate, kind: 'verification'}), suiteReport: report(candidate), ...extra});}
  return {directory, repo, git, commit, plan, candidate: commit()};
}
function recordsFor(plan) {return Object.fromEntries(plan.matrix.map((row, i) => [row.component, {
  schemaVersion: 1, status: 'verified-image', planHash: plan.planHash, component: row.component,
  sourceCommit: row.sourceCommit, inputFingerprint: row.inputFingerprint, imageId: sha(String(i + 4)), archiveHash: sha('8'),
  imageDigest: row.operation === 'reuse' ? row.imageDigest : null,
  identity: {identitySchemaVersion: 1, component: row.component, provenance: 'baked', sourceCommit: row.sourceCommit, source_commit: row.sourceCommit,
    inputFingerprint: row.inputFingerprint, apiProtocolVersion: 1, ...(row.component === 'rulesWorker' ? {artifactHash: sha('9'), workerProtocolVersion: 1,
      workerRuntime: {name: 'node', version: '20.20.0'}, supportedWorldSchemaVersions: [5], capabilities: ['pinned-artifact-routing', 'pending-decision-pass-through']} : {})},
} ]));}
function publishedFor(plan) {return Object.fromEntries(plan.matrix.map((row, i) => [row.component, `${row.imageRepository}@${sha(String(i + 5))}`]));}

test('reviewed first recovery changes optional provenance and plan hash only, forcing full extended without old baseline',t=>{
  const f=fixture(t),repository='alexeyvilmost/dnd_cards',controlRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
  const {reference}=loadControlRecovery({id:'37273035754-1',controlRoot,controlCommit:f.candidate,repository});
  const extra={repository,verification:{id:10,sourceCommit:f.candidate,repository},firstAdoptionRecovery:reference};
  const plan=f.plan(f.candidate,extra);validateBuildPlan(plan);assert.equal(plan.previousManifest,null);assert.equal(plan.verificationEvidence.requiredTier,'extended');assert.ok(plan.matrix.every(row=>row.operation==='build'));
  const candidate=assembleCandidateManifest(plan,recordsFor(plan),publishedFor(plan));assert.deepEqual(candidate.provenance.firstAdoptionRecovery,reference);
  verifyCandidateProvenance(candidate,{id:42,workflow:'.github/workflows/release.yml',controlCommit:f.candidate});
  assert.throws(()=>f.plan(f.candidate,{...extra,suiteReport:{...report(f.candidate),suite:'core'}}),/extended/);
  assert.throws(()=>f.plan(f.candidate,{...extra,baselineRun:{id:1}}),/cannot reuse/);
  const changed=structuredClone(plan);changed.firstAdoptionRecovery.proofHash=sha('0');changed.planHash=evidenceHash({candidate:changed.candidate,controlCommit:changed.controlCommit,releaseRunId:changed.releaseRunId,selection:changed.selection,matrix:changed.matrix,config:changed.config,verification:changed.verificationEvidence,baselineIdentity:changed.baselineIdentity,firstAdoptionRecovery:changed.firstAdoptionRecovery});
  assert.throws(()=>validateBuildPlan(changed),/reviewed release control/);
  const ordinary=f.plan(f.candidate);assert.equal(ordinary.firstAdoptionRecovery,undefined);
  assert.equal(ordinary.planHash,evidenceHash({candidate:ordinary.candidate,controlCommit:ordinary.controlCommit,releaseRunId:ordinary.releaseRunId,selection:ordinary.selection,matrix:ordinary.matrix,config:ordinary.config,verification:ordinary.verificationEvidence,baselineIdentity:ordinary.baselineIdentity}));
  assert.equal(assembleCandidateManifest(ordinary,recordsFor(ordinary),publishedFor(ordinary)).provenance.firstAdoptionRecovery,undefined);
});

function recoveredPlanning(t) {
  const f=fixture(t),repository='alexeyvilmost/dnd_cards',controlRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
  const {proof,reference}=loadControlRecovery({id:'37273035754-1',controlRoot,controlCommit:f.candidate,repository});
  const ordinary=f.plan(f.candidate,{repository,verification:{id:10,sourceCommit:f.candidate,repository}});
  const options={repo:f.repo,candidate:f.candidate,repository,controlCommit:f.candidate,releaseRunId:42,config:ordinary.config,
    verification:ordinary.verification,suiteReport:report(f.candidate),baselineDirectory:path.join(f.directory,'baseline'),firstAdoptionRecovery:reference};
  const calls=[],failed={id:proof.failedDeployment.runId,run_attempt:1,head_sha:proof.failedDeployment.controlCommit,path:'.github/workflows/deploy.yml',event:'workflow_dispatch',head_branch:'main',repository:{full_name:repository},head_repository:{full_name:repository},status:'completed',conclusion:'failure'};
  const get=async route=>{
    calls.push(route);
    if(route==='commits/main')return {sha:f.candidate};
    if(route==='actions/workflows/deploy.yml/runs?per_page=100&page=1')return {total_count:1,workflow_runs:[failed]};
    if(route===`actions/runs/${failed.id}`)return failed;
    if(route===`actions/runs/${failed.id}/jobs?filter=latest&per_page=100&page=1`)return {total_count:1,jobs:[{id:failed.id+1,name:'deploy',run_id:failed.id,run_attempt:1,head_sha:failed.head_sha,status:'completed',conclusion:'failure',completed_at:proof.observedAt}]};
    throw Error('Unexpected recovery planning route');
  };
  return {f,options,ordinary,reference,failed,calls,get};
}
test('selective dispatcher carries explicit reviewed recovery through an initial full build and publication',async t=>{
  const {options,ordinary,reference,calls,get}=recoveredPlanning(t),plan=await prepareDispatchedBuild(options,{get});
  validateBuildPlan(plan);assert.equal(plan.status,'build-planned');assert.equal(plan.frontendVerification,undefined);assert.equal(plan.previousManifest,null);
  assert.ok(plan.matrix.every(row=>row.operation==='build'));assert.equal(plan.verificationEvidence.requiredTier,'extended');assert.deepEqual(plan.firstAdoptionRecovery,reference);
  assert.notEqual(plan.planHash,ordinary.planHash);assert.equal(calls[0],'commits/main');assert.ok(calls.some(route=>route.includes('filter=latest')));
  const candidate=assembleCandidateManifest(plan,recordsFor(plan),publishedFor(plan));
  assert.deepEqual(candidate.provenance.firstAdoptionRecovery,reference);assert.deepEqual(candidate.buildPlan.firstAdoptionRecovery,reference);
  assert.equal(Object.hasOwn(candidate.manifest,'writerPolicy'),false);
  verifyCandidateProvenance(candidate,{id:42,workflow:'.github/workflows/release.yml',controlCommit:options.controlCommit});
  assert.throws(()=>verifyCandidateProvenance({...candidate,frontendVerification:{}},{id:42,workflow:'.github/workflows/release.yml',controlCommit:options.controlCommit}),/Recovered first adoption/);
});
test('recovery never becomes selective/no-op and refuses fresh metadata or baseline drift before building',async t=>{
  const {options,get,failed}=recoveredPlanning(t);
  for(const mutation of [{frontendVerification:{}},{baseline:{}},{baselineRun:{id:1}},{candidate:'e'.repeat(40)}])
    await assert.rejects(prepareDispatchedBuild({...options,...mutation},{get}),/Recovery cannot/);
  await assert.rejects(prepareDispatchedBuild({...options,suiteReport:{...options.suiteReport,suite:'core'}},{get}),/extended/);
  await assert.rejects(prepareDispatchedBuild(options,{get:route=>route==='commits/main'?Promise.resolve({sha:'e'.repeat(40)}):get(route)}),/superseded/);
  await assert.rejects(prepareDispatchedBuild(options,{get:route=>route===`actions/runs/${failed.id}`?Promise.resolve({...failed,run_attempt:2}):get(route)}),/rerun/);
  const extra={...failed,id:failed.id+30,conclusion:'success'};
  await assert.rejects(prepareDispatchedBuild(options,{get:route=>route.startsWith('actions/workflows/deploy.yml/runs')?Promise.resolve({total_count:2,workflow_runs:[failed,extra]}):route===`actions/runs/${extra.id}`?Promise.resolve(extra):route.startsWith(`actions/runs/${extra.id}/jobs`)?Promise.resolve({total_count:1,jobs:[{id:extra.id+1,name:'deploy',run_id:extra.id,run_attempt:1,head_sha:extra.head_sha,status:'completed',conclusion:'success'}]}):get(route)}),/successful or unreviewed/);
  mkdirSync(options.baselineDirectory);writeFileSync(path.join(options.baselineDirectory,'manifest.json'),'{}');
  await assert.rejects(prepareDispatchedBuild(options,{get}),/Recovery cannot/);
});
test('rehashed recovery plus a selective proof is rejected by full-plan validation',async t=>{
  const {options,get}=recoveredPlanning(t),plan=await prepareDispatchedBuild(options,{get});
  plan.frontendVerification={};
  plan.planHash=evidenceHash({candidate:plan.candidate,controlCommit:plan.controlCommit,releaseRunId:plan.releaseRunId,selection:plan.selection,matrix:plan.matrix,config:plan.config,verification:plan.verificationEvidence,baselineIdentity:plan.baselineIdentity,frontendVerification:plan.frontendVerification,firstAdoptionRecovery:plan.firstAdoptionRecovery});
  assert.throws(()=>validateBuildPlan(plan),/initial full extended/);
});

test('only a successful exact-main workflow and real API/browser report authorize builds', () => {
  const candidate = 'a'.repeat(40), run = trustedRun(candidate);
  verifyRun(run, {repository, candidate, kind: 'verification'}); verifySuiteReport(report(candidate), candidate);
  for (const change of [r => {r.event = 'pull_request';}, r => {r.path = '.github/workflows/evil.yml';}, r => {r.head_branch = 'feature';},
    r => {r.head_repository.full_name = 'fork/project';}, r => {r.conclusion = 'failure';}, r => {r.head_sha = 'b'.repeat(40);}]) {
    const changed = structuredClone(run); change(changed); assert.throws(() => verifyRun(changed, {repository, candidate, kind: 'verification'}));
  }
  for (const change of [r => {r.shard = {name:'flows'};}, r => {r.suite = 'legacy-manual';}, r => {r.candidate.sha = 'b'.repeat(40);}, r => {r.checks.pop();},
    r => {r.component_plan.candidate.sha = 'b'.repeat(40);}, r => {r.checks.push({...r.checks[0]});},
    r => {r.checks[1].status = 'skipped';}, r => {r.cleanup.status = 'cleanup_failed';}]) {
    const changed = report(candidate); change(changed); assert.throws(() => verifySuiteReport(changed, candidate));
  }
});

test('critical paths and missing baseline require extended verification; known UI and docs may use core',()=>{
  const plan=files=>({schema_version:1,baseline:{sha:'a'.repeat(40)},full_fallback:false,changed_files:files,components:{frontend:true,backend:false,worker:false,infrastructure:false}});
  for(const file of ['frontend/worker/server.mjs','frontend/src/utils/runtime.ts','backend/character_runtime_command.go','backend/migrations/new.go','unknown/file'])assert.equal(requiredVerificationTier(plan([file])),'extended');
  for(const file of ['frontend/src/pages/Screen.tsx','frontend/src/components/Screen.tsx','docs/readme.md'])assert.equal(requiredVerificationTier(plan([file])),'core');
  assert.equal(requiredVerificationTier({...plan([]),full_fallback:true}),'extended');
  assert.equal(requiredVerificationTier({...plan([]),baseline:{sha:null}}),'extended');
  assert.equal(requiredVerificationTier({...plan(['frontend/src/pages/Screen.tsx']),components:{worker:true}}),'extended');
  const candidate='a'.repeat(40),core={...report(candidate),suite:'core'};
  assert.throws(()=>verifySuiteReport(core,candidate),/extended/);verifySuiteReport(core,candidate,{requiredTier:'core'});
  for(const change of [r=>{r.source_snapshot.sha256='b'.repeat(64);},r=>{r.source_snapshot.files++;},r=>{r.source_drift={};},r=>{r.ci_source.clean_checkout=false;},r=>{r.checks=r.checks.filter(c=>c.id!=='source-stability');}]){
    const bad=report(candidate);change(bad);assert.throws(()=>verifySuiteReport(bad,candidate));
  }
});
test('release control SHA may differ from older exact source but candidate provenance must bind the successful run',t=>{
  const f=fixture(t),control='d'.repeat(40),plan=f.plan(f.candidate,{controlCommit:control});
  const candidate=assembleCandidateManifest(plan,recordsFor(plan),publishedFor(plan));
  const release={...trustedRun(control),id:42,run_attempt:2,path:'.github/workflows/release.yml',event:'workflow_run'};
  const run=verifyRun(release,{repository,kind:'release'});
  assert.equal(run.controlCommit,control);assert.equal(run.sourceCommit,undefined);
  assert.equal(run.runAttempt,2);assert.equal(run.conclusion,'success');
  for(const run_attempt of [undefined,0,-1,'2',1.5])assert.throws(()=>verifyRun({...release,run_attempt},{repository,kind:'release'}),/attempt/);
  assert.equal(verifyCandidateProvenance(candidate,run).sourceCommit,f.candidate);
  assert.throws(()=>verifyRun(release,{repository,candidate:f.candidate,kind:'release'}),/control SHA/);
  for(const mutate of [c=>{c.provenance.releaseRunId++;},c=>{c.provenance.controlCommit=f.candidate;},c=>{c.manifest.releaseCommit=control;},c=>{c.provenance.planHash='invalid';}]){
    const bad=structuredClone(candidate);mutate(bad);assert.throws(()=>verifyCandidateProvenance(bad,run));
  }
});

test('disabled, mutable or incomplete toolchain configuration fails before building', () => {
  const reviewed=JSON.parse(readFileSync(new URL('../../infra/release-build-config.json', import.meta.url)));
  validateBuildConfig(reviewed);
  assert.throws(() => validateBuildConfig({...reviewed,enabled:false}), /disabled/);
  assert.throws(() => validateBuildConfig({...config(), baseImages: {...config().baseImages, NODE_IMAGE: 'node:latest'}}));
  assert.throws(() => validateBuildConfig({...config(), frontendApiUrl: '/api\nINJECTED=1'}));
  assert.throws(() => validateBuildConfig({...config(), contentManifestHash: ''}));
  assert.throws(() => validateBuildConfig({...config(), migrationSet: [{id: '297', checksum: 'unknown'}]}));
  assert.throws(() => validateBuildConfig({...config(), migrationSet: [{id: '297', checksum: sha('a')}, {id: '297', checksum: sha('b')}]}));
  assert.throws(() => validateBuildConfig({...config(), frontendMediaVariants: true}), /originals only/);
  assert.throws(() => validateBuildConfig({...config(), frontendMediaVariants: null}), /originals only/);
  assert.throws(() => validateBuildConfig({...config(), mediaBundle: '/unbound'}), /originals only/);
  validateBuildConfig({...config(), frontendMediaVariants: false});
});

test('release plan rejects inherited enabled media and cannot rehash an enabled row into schema v1', t => {
  const f=fixture(t);
  assert.throws(()=>f.plan(f.candidate,{environment:{VITE_MEDIA_VARIANTS:'1'}}),/schema v1/);
  assert.throws(()=>f.plan(f.candidate,{environment:{MEDIA_VARIANTS_BUNDLE:'/unbound'}}),/schema v1/);
  const plan=f.plan(f.candidate,{environment:{VITE_MEDIA_VARIANTS:'0'}}),frontend=plan.matrix.find(row=>row.name==='frontend');
  assert.equal(frontend.buildArguments.VITE_MEDIA_VARIANTS,'0');
  frontend.buildArguments.VITE_MEDIA_VARIANTS='1';
  plan.planHash=evidenceHash({candidate:plan.candidate,controlCommit:plan.controlCommit,releaseRunId:plan.releaseRunId,selection:plan.selection,matrix:plan.matrix,config:plan.config,verification:plan.verificationEvidence,baselineIdentity:plan.baselineIdentity});
  assert.throws(()=>validateBuildPlan(plan),/input contract/);
});

test('exact clean Git plan builds all initially and rejects a dirty or non-main candidate', t => {
  const f = fixture(t), plan = f.plan(f.candidate); validateBuildPlan(plan);
  assert.ok(plan.matrix.every(row => row.operation === 'build' && row.sourceCommit === f.candidate));
  writeFileSync(path.join(f.repo, 'backend/main.go'), 'package changed\n');
  assert.throws(() => f.plan(f.candidate), /clean/);
  f.git(['checkout', '--', 'backend/main.go']); f.git(['checkout', '-b', 'unapproved']);
  writeFileSync(path.join(f.repo, 'note.txt'), 'branch'); f.git(['add', '.']); f.git(['commit', '-m', 'unapproved fixture']);
  assert.throws(() => f.plan(f.git(['rev-parse', 'HEAD'])));
});

test('UI-only release reuses old backend/worker digests while shared runtime selects worker', t => {
  const f = fixture(t), first = f.plan(f.candidate), old = assembleCandidateManifest(first, recordsFor(first), publishedFor(first)).manifest;
  const baselineFile = path.join(f.directory, 'manifest.json'); writeFileSync(baselineFile, JSON.stringify(old));
  const extra = {baseline: old, baselineFile, baselineReceipt: {schemaVersion: 1, status: 'succeeded', releaseId: old.releaseId, releaseCommit: f.candidate, controlCommit: f.candidate, manifestHash: evidenceHash(old)}, baselineRun: {controlCommit: f.candidate}};
  mkdirSync(path.join(f.repo, 'docs')); writeFileSync(path.join(f.repo, 'docs/readme.md'), 'doc');
  const docCandidate = f.commit(), reused = f.plan(docCandidate, extra);
  assert.ok(reused.matrix.every(row => row.operation === 'reuse' && row.sourceCommit === f.candidate));
  mkdirSync(path.join(f.repo, 'frontend/src/pages')); writeFileSync(path.join(f.repo, 'frontend/src/pages/Screen.tsx'), 'export const screen = 1;\n');
  const uiChanged = f.plan(f.commit(), extra);
  assert.equal(uiChanged.matrix.find(row => row.name === 'frontend').operation, 'build');
  for (const name of ['backend', 'worker']) {
    const row = uiChanged.matrix.find(row => row.name === name);
    assert.equal(row.operation, 'reuse'); assert.equal(row.sourceCommit, f.candidate);
    assert.equal(row.imageDigest, old.components[row.component].imageDigest);
  }
  writeFileSync(path.join(f.repo, 'frontend/src/index.ts'), 'export const value = 2;\n');
  const changed = f.plan(f.commit(), extra);
  assert.equal(changed.matrix.find(row => row.name === 'frontend').operation, 'build');
  assert.equal(changed.matrix.find(row => row.name === 'backend').operation, 'reuse');
  // Shared runtime intentionally selects worker even when this minimal fixture's worker source stays unchanged.
  assert.equal(changed.matrix.find(row => row.name === 'worker').operation, 'build');
});

test('backend source plus generated catalog checksums reuses exact frontend and worker images', t => {
  const f = fixture(t), configFile = path.join(f.repo, 'infra/release-build-config.json');
  const writeConfig = () => writeFileSync(configFile, JSON.stringify({...config(), contentManifestHash:evidenceHash(sourceContentManifest(f.repo))}));
  writeConfig(); const base = f.commit(), first = f.plan(base);
  const old = assembleCandidateManifest(first, recordsFor(first), publishedFor(first)).manifest;
  const baselineFile = path.join(f.directory, 'manifest.json'); writeFileSync(baselineFile, JSON.stringify(old));
  const extra = {baseline:old, baselineFile, baselineReceipt:{schemaVersion:1,status:'succeeded',releaseId:old.releaseId,releaseCommit:base,controlCommit:base,manifestHash:evidenceHash(old)},baselineRun:{controlCommit:base}};
  writeFileSync(path.join(f.repo,'backend/main.go'),'package main\nfunc main(){println("changed")}\n');
  writeConfig(); const candidate = f.commit(), changed = f.plan(candidate,extra); validateBuildPlan(changed);
  assert.equal(changed.matrix.find(row=>row.name==='backend').operation,'build');
  assert.equal(changed.verificationEvidence.requiredTier,'extended');
  assert.notEqual(changed.config.contentManifestHash,old.contentManifestHash);
  assert.deepEqual(changed.selection.components,{frontend:false,backend:true,worker:false,infrastructure:false});
  for (const name of ['frontend','worker']) {
    const row = changed.matrix.find(row=>row.name===name);
    assert.equal(row.operation,'reuse'); assert.equal(row.sourceCommit,base);
    assert.equal(row.imageDigest,old.components[row.component].imageDigest);
    assert.equal(row.inputFingerprint,old.components[row.component].inputFingerprint);
  }
  const actualConfig = JSON.parse(readFileSync(configFile,'utf8'));
  actualConfig.platform='unsupported';writeFileSync(configFile,JSON.stringify(actualConfig));
  // A non-derived configuration edit keeps the conservative component boundary.
  f.commit(); const conservative=f.plan(f.git(['rev-parse','HEAD']),extra);
  assert.ok(conservative.matrix.every(row=>row.operation==='build'));
});

test('baseline receipts, component identity and immutable archive checks fail closed', async t => {
  const f = fixture(t), plan = f.plan(f.candidate), records = recordsFor(plan), manifest = assembleCandidateManifest(plan, records, publishedFor(plan)).manifest;
  assert.throws(() => verifyBaseline(manifest, {status: 'failed'}, {sourceCommit: f.candidate}));
  const row = plan.matrix[0], record = records[row.component];
  assert.throws(() => validateComponentRecord(plan, row, {...record, sourceCommit: 'b'.repeat(40)}));
  assert.throws(() => assertPublicationInput(plan, row, record, sha('a')), /archive/);
  const archive = path.join(f.directory, 'image.tar'); writeFileSync(archive, 'fixture archive bytes');
  record.archiveHash = await fileHash(archive); assertPublicationInput(plan, row, record, await fileHash(archive));
  writeFileSync(archive, 'modified'); assert.throws(() => assertPublicationInput(plan, row, record, sha('0')));
  plan.matrix[0].context = '../outside'; assert.throws(() => validateBuildPlan(plan));
});

test('plan rehash cannot hide config drift or invented reuse provenance', t => {
  const f = fixture(t), original = f.plan(f.candidate);
  for (const change of [p => {p.matrix[0].platform = 'linux/arm64';}, p => {p.matrix[0].baseImages.EXTRA_IMAGE = 'example.test@' + sha('d');},
    p => {p.previousManifest = assembleCandidateManifest(original, recordsFor(original), publishedFor(original)).manifest;},
    p => {p.matrix[0].operation = 'reuse'; p.matrix[0].imageDigest = 'example.test/old@' + sha('d');}]) {
    const plan = structuredClone(original); change(plan);
    plan.planHash = evidenceHash({candidate: plan.candidate,controlCommit:plan.controlCommit,releaseRunId:plan.releaseRunId,selection:plan.selection, matrix: plan.matrix, config: plan.config, verification: plan.verificationEvidence, baselineIdentity: plan.baselineIdentity});
    assert.throws(() => validateBuildPlan(plan));
  }
});

test('publication requires explicit enablement and a candidate can never masquerade as ready', t => {
  const f = fixture(t), plan = f.plan(f.candidate), records = recordsFor(plan);
  const candidate = assembleCandidateManifest(plan, records, publishedFor(plan));
  assert.equal(candidate.deployable, false); assert.equal(candidate.status, 'candidate-only');
  assert.throws(() => assertReleaseReady(candidate.manifest, {reports: candidate.reports}));
  assert.throws(() => assembleCandidateManifest(plan, records, {}), /digest/);
  const planFile = path.join(f.directory, 'plan.json'); writeFileSync(planFile, JSON.stringify(plan));
  const disabled = spawnSync(process.execPath, [fileURLToPath(new URL('./ci-images.mjs', import.meta.url)), 'publish', planFile, f.directory, f.directory],
    {encoding: 'utf8', env: {SystemRoot: process.env.SystemRoot ?? '', RELEASE_PUBLICATION_ENABLED: 'false'}});
  assert.notEqual(disabled.status, 0); assert.match(disabled.stderr, /publication is disabled/); assert.equal(disabled.stdout, '');
});

test('workflow syntax pins actions and isolates publication from forks, builds and deployment', () => {
  const workflow = yaml.load(readFileSync(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(workflow.on).sort(), ['workflow_dispatch','workflow_run']);
  assert.match(workflow.jobs.prepare.if, /RELEASE_BUILD_ENABLED.*true/);
  assert.match(workflow.jobs.prepare.if, /refs\/heads\/main/);
  assert.equal(workflow.jobs.publish.environment, 'release-publication');
  assert.equal(workflow.jobs.components.permissions.packages, 'read');
  assert.equal(workflow.jobs.publish.permissions.packages, 'write');
  assert.match(workflow.jobs.publish.if, /needs.prepare.outputs.publish.*RELEASE_PUBLICATION_ENABLED/);
  for (const job of Object.values(workflow.jobs)) for (const step of job.steps) if (step.uses) assert.match(step.uses, /^[\w/-]+@[a-f0-9]{40}$/);
  assert.equal(workflow.jobs.components.steps.find(step => step.uses?.startsWith('docker/build-push-action')).with.push, false);
  assert.ok(!JSON.stringify(workflow).includes('ssh'));
  const planning=workflow.jobs.prepare.steps.find(step=>step.run?.includes('ui-release-plan.mjs'));
  assert.match(planning.run,/artifacts\/build-plan\.json artifacts\/request\.json/);
  assert.equal(workflow.on.workflow_dispatch.inputs.first_adoption_recovery.required,false);
});

test('absent producer policy preserves legacy composition and never reads writer flags from environment',t=>{
  const f=fixture(t),plan=f.plan(f.candidate,{environment:{DB_COMPACT_RECEIPTS:'1',IMAGE_JOBS_ENABLED:'1'}});
  assert.equal(Object.hasOwn(plan.config,'writerPolicy'),false);
  const candidate=assembleCandidateManifest(plan,recordsFor(plan),publishedFor(plan));
  assert.equal(Object.hasOwn(candidate.manifest,'writerPolicy'),false);
  const off={compactReceipts:false,imageJobs:false,frozenCatalogs:false};
  const explicit=f.plan(f.candidate,{config:{...plan.config,writerPolicy:off}});
  assert.deepEqual(assembleCandidateManifest(explicit,recordsFor(explicit),publishedFor(explicit)).manifest.writerPolicy,off);
  assert.throws(()=>validateBuildConfig({...plan.config,writerPolicy:{compactReceipts:true,imageJobs:true,frozenCatalogs:true}}));
  assert.throws(()=>validateBuildConfig({...plan.config,writerPolicy:{compactReceipts:'true',imageJobs:false,frozenCatalogs:false}}));
});

test('same-source manual policy plan changes composition and requires extended while reusing image inputs',t=>{
  // Does not model a commit of infra/release-build-config.json: canonical path
  // classification still selects every component for that release-tooling edit.
  const f=fixture(t),seed=f.plan(f.candidate),off={compactReceipts:false,imageJobs:false,frozenCatalogs:false},on={...off,compactReceipts:true,imageJobs:true};
  const configuration={...seed.config,writerPolicy:off,migrationSet:['298_compact_command_receipts','299_frozen_combat_catalogs','300_image_jobs'].map(id=>({id,checksum:sha('c')}))};
  const initial=f.plan(f.candidate,{config:configuration}),old=assembleCandidateManifest(initial,recordsFor(initial),publishedFor(initial)).manifest;
  const baselineFile=path.join(f.directory,'writer-baseline.json');writeFileSync(baselineFile,JSON.stringify(old));
  const predecessor={baseline:old,baselineFile,baselineReceipt:{schemaVersion:1,status:'succeeded',releaseId:old.releaseId,releaseCommit:old.releaseCommit,controlCommit:f.candidate,manifestHash:evidenceHash(old)},baselineRun:{controlCommit:f.candidate}};
  const disabled=f.plan(f.candidate,{...predecessor,config:configuration});
  const enabled=f.plan(f.candidate,{...predecessor,config:{...configuration,writerPolicy:on}});
  assert.deepEqual(enabled.matrix,disabled.matrix);assert.ok(enabled.matrix.every(row=>row.operation==='reuse'));
  assert.notEqual(enabled.planHash,disabled.planHash);assert.equal(enabled.verificationEvidence.requiredTier,'extended');
  const onCandidate=assembleCandidateManifest(enabled,recordsFor(enabled),publishedFor(enabled));
  const offCandidate=assembleCandidateManifest(disabled,recordsFor(disabled),publishedFor(disabled));
  assert.deepEqual(onCandidate.manifest.writerPolicy,on);assert.notEqual(onCandidate.manifest.validationEvidence[0].inputFingerprint,offCandidate.manifest.validationEvidence[0].inputFingerprint);
  const core={...report(f.candidate),suite:'core'};assert.throws(()=>f.plan(f.candidate,{...predecessor,config:{...configuration,writerPolicy:on},suiteReport:core}),/extended/);
  const forged=structuredClone(disabled);forged.config.writerPolicy=on;assert.throws(()=>validateBuildPlan(forged),/hash mismatch/);
  assert.throws(()=>f.plan(f.candidate,{config:{...configuration,writerPolicy:on}}),/legacy adoption/);
});

test('recorded retirement builds the full installed set with writers enabled without rewriting predecessor',t=>{
  // Real clean Git and protected files; synthetic database/image observations.
  const f=fixture(t),seed=f.plan(f.candidate),s=retirementStateUnitFixture(),on={compactReceipts:true,imageJobs:true,frozenCatalogs:false};
  s.active.manifest.releaseCommit=f.candidate;s.active.manifest.writerPolicy=on;
  const baseline=structuredClone(s.active.manifest),bytes=JSON.stringify(baseline,null,3)+'\n',baselineFile=path.join(f.directory,'retirement-baseline.json');writeFileSync(baselineFile,bytes);
  const retired={...structuredClone(s.active),database:retirementDatabaseStateFromInspection(s,s.inspection)},stamp='2026-10-06T00:00:00Z';
  const operation={schemaVersion:1,kind:'character-retirement-observation-301',releaseId:s.request.releaseId,status:'succeeded',previous:s.active,desired:retired,transitionHash:evidenceHash({previous:s.active,desired:retired}),createdAt:stamp,updatedAt:stamp};
  const root=path.join(f.directory,'protected');mkdirSync(root);const store=createDeploymentStore(root);store.writeActive(retired);store.writeOperation(operation);
  const request={repository,runId:71,attempt:2,controlCommit:'c'.repeat(40),sourceCommit:f.candidate};
  const retirementObservation=projectRetirementObservation({store,operation,manifest:baseline,request}),baselineReceipt=retirementBaselineReceipt(retirementObservation);
  const baselineRun={repository,id:71,runAttempt:2,controlCommit:request.controlCommit};
  const configuration={...seed.config,writerPolicy:on,migrationSet:retired.database.migrationSet},options={baseline,baselineFile,baselineReceipt,baselineRun,retirementObservation,config:configuration};
  const plan=f.plan(f.candidate,options);validateBuildPlan(plan);assert.deepEqual(plan.previousManifest,baseline);assert.equal(plan.verificationEvidence.requiredTier,'extended');
  assert.deepEqual(plan.retirementBaseline.observation.active,retired);assert.equal(readFileSync(baselineFile,'utf8'),bytes);
  const candidate=assembleCandidateManifest(plan,recordsFor(plan),publishedFor(plan));assert.deepEqual(candidate.manifest.migrationSet,retired.database.migrationSet);assert.deepEqual(candidate.manifest.writerPolicy,on);assert.equal(candidate.deployable,false);
  assert.throws(()=>f.plan(f.candidate,{...options,retirementObservation:undefined}),/Exact retirement artifact/);
  assert.throws(()=>f.plan(f.candidate,{...options,config:{...configuration,migrationSet:baseline.migrationSet}}),/complete recorded/);
  assert.throws(()=>f.plan(f.candidate,{...options,suiteReport:{...report(f.candidate),suite:'core'}}),/extended/);
  assert.throws(()=>f.plan(f.candidate,{...options,frontendVerification:{}}),/full extended/);
  for(const mutate of [p=>p.retirementBaseline.observation.deployment.runId++,p=>p.retirementBaseline.run.repository='other/project',p=>p.config.migrationSet.pop(),p=>p.retirementBaseline.private='PRIVATE_CANARY']){
    const p=structuredClone(plan);mutate(p);p.planHash=evidenceHash({candidate:p.candidate,controlCommit:p.controlCommit,releaseRunId:p.releaseRunId,selection:p.selection,matrix:p.matrix,config:p.config,verification:p.verificationEvidence,baselineIdentity:p.baselineIdentity,retirementBaseline:p.retirementBaseline});assert.throws(()=>validateBuildPlan(p));
  }
});
