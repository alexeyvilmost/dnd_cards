import test from 'node:test';
import assert from 'node:assert/strict';
import {selectLatestDeployedRun} from './deployed-baseline.mjs';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync}from'node:fs';import {tmpdir}from'node:os';import path from'node:path';

const repository = 'fixture/project', control = 'a'.repeat(40), now = Date.parse('2026-10-04T12:00:00Z');
const at = (id, offset = 0) => new Date(Date.parse('2026-10-04T10:00:00Z') + id * 60000 + offset).toISOString();
const run = (id, extra = {}) => ({id, run_attempt: 1, path: '.github/workflows/deploy.yml', head_sha: control,
  head_branch: 'main', event: 'workflow_run', status: 'completed', conclusion: 'success',
  repository: {full_name: repository}, head_repository: {full_name: repository}, ...extra});
const job = (id, conclusion = 'success', extra = {}) => ({id: id * 100, run_id: id, run_attempt: 1,
  head_sha: control, name: 'deploy', status: 'completed', conclusion,
  started_at: at(id), completed_at: at(id, 60000), ...extra});
const artifact = (id, extra = {}) => ({id: id * 1000, name: 'deployed-release', expired: false, size_in_bytes: 2048,
  created_at: at(id, 30000), expires_at: '2027-01-01T00:00:00Z', workflow_run: {id, head_sha: control}, ...extra});
function fixture(runs = [run(9), run(8)]) {
  const jobs = new Map(runs.map(row => [row.id, [job(row.id)]]));
  const artifacts = new Map(runs.map(row => [row.id, [artifact(row.id)]]));
  const requested = [];
  const response = (rows, key, url) => ({total_count: rows.length,
    [key]: rows.slice((Number(url.searchParams.get('page')) - 1) * 100, Number(url.searchParams.get('page')) * 100)});
  const get = async route => {
    requested.push(route);
    const url = new URL(route, 'https://fixture.invalid/');
    if (url.pathname === '/actions/workflows/deploy.yml/runs') {
      assert.equal(url.searchParams.get('status'), 'completed');
      assert.equal(url.searchParams.get('branch'), 'main');
      return response(runs, 'workflow_runs', url);
    }
    const match = /^\/actions\/runs\/(\d+)(?:\/(jobs|artifacts))?$/.exec(url.pathname);
    assert.ok(match, `Unexpected route ${route}`);
    const id = Number(match[1]);
    if (!match[2]) return structuredClone(runs.find(row => row.id === id));
    assert.equal(url.searchParams.get('per_page'), '100');
    if (match[2] === 'jobs') {
      assert.equal(url.searchParams.get('filter'), 'latest');
      return response(jobs.get(id), 'jobs', url);
    }
    return response(artifacts.get(id), 'artifacts', url);
  };
  return {runs, jobs, artifacts, get, requested, select: () => selectLatestDeployedRun(get, {repository, now})};
}
function reviewedFixture(t,{completedRestore=false,detailed=false}={}){
 const f=fixture([run(9,{event:'workflow_dispatch',conclusion:'failure'}),run(8)]);f.jobs.set(9,[job(9,'failure')]);
 const name=completedRestore?'37420370284':detailed?'37428679118':'37405297914';
 const proof=JSON.parse(readFileSync(new URL('../../infra/reviewed-deployment-refusals/'+name+'-1.json',import.meta.url),'utf8'));Object.assign(proof,{repository,observedAt:at(9,120000)});if(completedRestore){proof.expiry.capturedAt=at(9,-31*60000);proof.expiry.restoreReportWrittenAt=at(9,59000);}else proof.rehearsalCompletedAt=at(9,59000);Object.assign(proof.failed,{id:9,controlCommit:control,completedAt:at(9,60000)});Object.assign(proof.baseline,{id:8,controlCommit:control});
 const root=mkdtempSync(path.join(tmpdir(),'baseline-reviewed-'));t.after(()=>{assert.equal(path.dirname(root),path.resolve(tmpdir()));assert.ok(path.basename(root).startsWith('baseline-reviewed-'));rmSync(root,{recursive:true,force:true});});const directory=path.join(root,'infra','reviewed-deployment-refusals');mkdirSync(directory,{recursive:true});const file=path.join(directory,'9-1.json');writeFileSync(file,JSON.stringify(proof));
 return {...f,proof,file,select:()=>selectLatestDeployedRun(f.get,{repository,now,controlRoot:root})};
}
test('individually reviewed rehearsal refusal retains genuine predecessor and never becomes a successful baseline',async t=>{
 const f=reviewedFixture(t),selected=await f.select();assert.equal(selected.id,8);assert.deepEqual(selected.reviewedRefusals,[f.proof]);assert.ok(!f.requested.some(r=>r.startsWith('actions/runs/9/artifacts')));
});

test('an audited expired completed restore selects only the genuine healthy predecessor',async t=>{
 const f=reviewedFixture(t,{completedRestore:true}),selected=await f.select();assert.equal(selected.id,8);assert.deepEqual(selected.reviewedRefusals,[f.proof]);
 assert.ok(!f.requested.some(r=>r.startsWith('actions/runs/9/artifacts')));
 f.proof.expiry.rehearsalReceiptAbsent=false;writeFileSync(f.file,JSON.stringify(f.proof));await assert.rejects(f.select());
});

test('version2 historical refusal remains failed and selects only the individually verified healthy predecessor',async t=>{
 const f=reviewedFixture(t,{detailed:true}),selected=await f.select();assert.equal(selected.id,8);assert.deepEqual(selected.reviewedRefusals,[f.proof]);
 assert.equal(f.proof.rehearsalFailure.stage,'historical-replay');assert.ok(!f.requested.some(r=>r.startsWith('actions/runs/9/artifacts')));
 f.proof.rehearsalFailure.completedChecks.reverse();writeFileSync(f.file,JSON.stringify(f.proof));await assert.rejects(f.select());
});
test('reviewed refusal cannot conceal a newer unreviewed failure or select a different healthy baseline',async t=>{
 const f=reviewedFixture(t);f.runs.unshift(run(10,{conclusion:'failure'}));f.jobs.set(10,[job(10,'failure')]);await assert.rejects(f.select(),/recovery/);
 f.runs.shift();f.proof.baseline.id=7;writeFileSync(f.file,JSON.stringify(f.proof));await assert.rejects(f.select());
});
test('reviewed failed run must still match its original event, attempt, completion and failed conclusion',async t=>{
 const f=reviewedFixture(t);f.runs[0].event='workflow_run';await assert.rejects(f.select());f.runs[0].event='workflow_dispatch';f.jobs.set(9,[job(9,'failure',{completed_at:at(9,65000)})]);await assert.rejects(f.select());
});
test('a later genuine success supersedes the old reviewed refusal without advancing from the failed record',async t=>{
 const f=reviewedFixture(t);f.runs.unshift(run(10));f.jobs.set(10,[job(10)]);f.artifacts.set(10,[artifact(10)]);assert.equal((await f.select()).id,10);assert.equal((await f.select()).reviewedRefusals,undefined);
});
test('reviewed refusal never substitutes an expired or missing successful predecessor receipt',async t=>{
 const f=reviewedFixture(t);f.artifacts.set(8,[artifact(8,{expired:true})]);await assert.rejects(f.select(),/receipt/);f.artifacts.set(8,[]);await assert.rejects(f.select(),/receipt/);
});

test('returns verified actual deployment identity, independent of application source SHA', async () => {
  const f = fixture();
  assert.deepEqual(await f.select(), {id: 9, workflow: '.github/workflows/deploy.yml', repository,
    controlCommit: control, event: 'workflow_run', runAttempt: 1, artifactId: 9000, completedAt: at(9, 60000)});
  assert.ok(f.requested.some(route => route.startsWith('actions/runs/8/jobs')));
  assert.ok(!f.requested.some(route => route.startsWith('actions/runs/8/artifacts')));
});

test('explicit skipped deploy jobs are noops, including failed preparation; never need a receipt', async () => {
  const f = fixture(); f.runs[0].conclusion = 'failure'; f.jobs.set(9, [job(9, 'skipped')]); f.artifacts.set(9, []);
  assert.equal((await f.select()).id, 8);
  assert.ok(!f.requested.some(route => route.startsWith('actions/runs/9/artifacts')));
  f.jobs.set(8, [job(8, 'skipped')]); assert.equal(await f.select(), null);
  assert.equal(await fixture([]).select(), null);
});

test('workflow, jobs and artifacts traverse subsequent pages before declaring a baseline', async () => {
  const f = fixture(Array.from({length: 101}, (_, i) => run(200 - i)));
  for (const row of f.runs.slice(0, 100)) f.jobs.set(row.id, [job(row.id, 'skipped')]);
  f.jobs.set(100, [...Array.from({length: 100}, (_, i) => job(100, 'success', {id: 50000 + i, name: `audit-${i}`})), job(100)]);
  f.artifacts.set(100, [...Array.from({length: 100}, (_, i) => artifact(100, {id: 60000 + i, name: `diagnostic-${i}`})), artifact(100)]);
  assert.equal((await f.select()).id, 100);
  for (const fragment of ['runs?branch=main&status=completed', '100/jobs?filter=latest', '100/artifacts?']) {
    assert.ok(f.requested.some(route => route.includes(fragment) && route.endsWith('page=2')));
  }
});

test('a failed, cancelled or otherwise ambiguous deployment never falls back to an older success', async () => {
  for (const conclusion of ['failure', 'cancelled', 'timed_out', 'neutral', 'unknown', null]) {
    const f = fixture(); f.jobs.set(9, [job(9, conclusion)]);
    await assert.rejects(f.select(), /unsuccessful|ambiguous/);
    assert.ok(!f.requested.some(route => route.startsWith('actions/runs/8/artifacts')));
  }
  const f = fixture(); f.runs[0].conclusion = 'failure';
  await assert.rejects(f.select(), /unsuccessful or ambiguous/);
});

test('actual successful deploy requires one present unexpired receipt from that job attempt', async () => {
  const invalid = [[], [artifact(9), artifact(9, {id: 9001})], [artifact(9, {name: 'other'})],
    [artifact(9, {expired: true})], [artifact(9, {expires_at: '2026-10-01T00:00:00Z'})],
    [artifact(9, {expired: undefined})], [artifact(9, {size_in_bytes: 0})],
    [artifact(9, {workflow_run: {id: 8, head_sha: control}})],
    [artifact(9, {workflow_run: {id: 9, head_sha: 'b'.repeat(40)}})],
    [artifact(9, {created_at: '2026-10-04T09:59:59Z'})], [artifact(9, {created_at: '2026-10-04T10:11:00Z'})]];
  for (const receipts of invalid) {
    const f = fixture(); f.artifacts.set(9, receipts);
    await assert.rejects(f.select(), /receipt/);
    assert.ok(!f.requested.some(route => route.startsWith('actions/runs/8/artifacts')));
  }
});

test('latest job filter rejects old attempt identities and old receipt timestamps after a rerun', async () => {
  const f = fixture(); f.runs[0].run_attempt = 2;
  await assert.rejects(f.select(), /attempt/);
  f.jobs.set(9, [job(9, 'success', {run_attempt: 2, started_at: '2026-10-04T11:00:00Z', completed_at: '2026-10-04T11:10:00Z'})]);
  await assert.rejects(f.select(), /receipt/);
  f.artifacts.set(9, [artifact(9, {created_at: '2026-10-04T11:09:00Z'})]);
  assert.equal((await f.select()).runAttempt, 2);
});

test('missing, duplicate or unfinished deploy jobs fail closed', async () => {
  for (const jobs of [[], [job(9, 'success', {name: 'renamed'})], [job(9), job(9, 'success', {id: 901})],
    [job(9, 'success', {run_id: 8})], [job(9, 'success', {head_sha: 'b'.repeat(40)})],
    [job(9, null, {status: 'in_progress'})], [job(9, 'success', {completed_at: null})]]) {
    const f = fixture(); f.jobs.set(9, jobs); await assert.rejects(f.select(), /job/i);
  }
});

test('forks, wrong workflow, branch, event or incomplete run metadata cannot become a baseline', async () => {
  for (const extra of [{repository: {full_name: 'fork/project'}}, {head_repository: {full_name: 'fork/project'}},
    {path: '.github/workflows/other.yml'}, {head_branch: 'feature'}, {event: 'pull_request'},
    {status: 'in_progress'}, {run_attempt: undefined}, {head_sha: 'main'}, {conclusion: null}]) {
    const f = fixture([run(9, extra), run(8)]); await assert.rejects(f.select(), /metadata/);
  }
});

test('metadata outages, truncation and duplicate pagination never mean initial deployment', async () => {
  for (const response of [{}, {total_count: 2, workflow_runs: []}, {total_count: 1, workflow_runs: [run(9), run(8)]},
    {total_count: 2, workflow_runs: [run(9), run(9)]}]) {
    await assert.rejects(selectLatestDeployedRun(async () => response, {repository, now}));
  }
  await assert.rejects(selectLatestDeployedRun(async () => {throw Error('403');}, {repository, now}), /403/);
  const f = fixture();
  await assert.rejects(selectLatestDeployedRun(async route => route.includes('/artifacts') ? {total_count: 1, artifacts: []} : f.get(route), {repository, now}), /pagination/);
});

test('a workflow rerun during job or receipt discovery cannot publish stale baseline metadata', async () => {
  for (const skipped of [true, false]) {
    const f = fixture(); if (skipped) f.jobs.set(9, [job(9, 'skipped')]);
    let freshReads = 0;
    await assert.rejects(selectLatestDeployedRun(async route => {
      const value = await f.get(route);
      if (route === 'actions/runs/9' && ++freshReads > 1) value.run_attempt++;
      return value;
    }, {repository, now}), /changed/);
  }
});

test('an older-created manual rerun completed later is the actual latest deployed baseline', async () => {
  const f = fixture(); f.runs[1].event = 'workflow_dispatch'; f.runs[1].run_attempt = 2;
  f.jobs.set(8, [job(8, 'success', {run_attempt: 2, started_at: '2026-10-04T11:00:00Z', completed_at: '2026-10-04T11:10:00Z'})]);
  f.artifacts.set(8, [artifact(8, {created_at: '2026-10-04T11:09:00Z'})]);
  assert.equal((await f.select()).id, 8);
  f.artifacts.set(8, []); await assert.rejects(f.select(), /receipt/);
  assert.ok(!f.requested.some(route => route.startsWith('actions/runs/9/artifacts')));
});

test('latest actual failure requires recovery but a later successful deployment supersedes an older failure', async () => {
  const f = fixture(); f.jobs.set(8, [job(8, 'failure', {started_at: '2026-10-04T11:00:00Z', completed_at: '2026-10-04T11:10:00Z'})]);
  f.runs[1].conclusion = 'failure'; await assert.rejects(f.select(), /recovery/);
  f.jobs.set(9, [job(9, 'failure')]); f.runs[0].conclusion = 'failure';
  f.jobs.get(8)[0].conclusion = 'success'; f.runs[1].conclusion = 'success';
  f.artifacts.set(8, [artifact(8, {created_at: '2026-10-04T11:09:00Z'})]);
  assert.equal((await f.select()).id, 8);
});

test('tied latest completion or invalid timestamps anywhere in the scan cannot imply an ordering', async () => {
  const f = fixture(); f.jobs.get(8)[0].completed_at = at(9, 60000);
  await assert.rejects(f.select(), /ambiguous/);
  for (const value of [null, 'invalid', '2026-02-30T10:00:00Z', '2026-10-04T13:00:00Z', '2026-10-04T09:00:00Z']) {
    const fixtureWithBadDate = fixture(); fixtureWithBadDate.jobs.get(8)[0].completed_at = value;
    await assert.rejects(fixtureWithBadDate.select(), /timestamps/);
  }
});

test('bounded history exhaustion never returns an early success as a guessed latest baseline', async () => {
  for (const count of [1000, 10001]) {
    await assert.rejects(selectLatestDeployedRun(async () => ({total_count: count, workflow_runs: [run(9)]}), {repository, now}), /completeness limit/);
  }
  let pages = 0;
  await assert.rejects(selectLatestDeployedRun(async route => {
    const url = new URL(route, 'https://fixture.invalid/');
    if (url.pathname === '/actions/workflows/deploy.yml/runs') {
      return {total_count: 1, workflow_runs: [run(9)]};
    }
    if (url.pathname === '/actions/runs/9/jobs') {
      pages++;
      return {total_count: 10001, jobs: Array.from({length: 100}, (_, i) => job(9, 'success', {id: (pages - 1) * 100 + i + 1, name: i === 0 && pages === 1 ? 'deploy' : `audit-${pages}-${i}`}))};
    }
    assert.equal(url.pathname, '/actions/runs/9', 'No artifact may be read before the history scan completes');
    return run(9);
  }, {repository, now}), /pagination limit/);
  assert.equal(pages, 100);
});
