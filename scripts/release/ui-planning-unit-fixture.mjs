// Extracted canonical CI unit fixture; synthetic repository only.
import assert from 'node:assert/strict';import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync}from'node:fs';import{execFileSync}from'node:child_process';import{tmpdir}from'node:os';import path from'node:path';
import{prepareBuildPlan,verifyRun}from'./ci-release.mjs';import{evidenceHash}from'./validate-manifest.mjs';import{sourceContentManifest}from'./source-content-manifest.mjs';
const sha = char => `sha256:${char.repeat(64)}`;
const repository = 'fixture/project';
function config() {return {schemaVersion: 1, enabled: true, platform: 'linux/amd64', frontendApiUrl: '', contentManifestHash: sha('a'), migrationSet: [],
  buildkitImage: `moby/buildkit@${sha('b')}`, baseImages: Object.fromEntries(['GO_IMAGE', 'ALPINE_IMAGE', 'NODE_IMAGE', 'NGINX_IMAGE'].map((key, i) => [key, `example.test/base/${key.toLowerCase()}@${sha(String(i + 1))}`]))};}
function report(candidate) {return {schema_version: 1, status: 'passed', suite: 'extended',ci_source:{clean_checkout:true}, source_snapshot:{sha256:'a'.repeat(64),files:4},candidate: {sha: candidate}, component_plan: {mode: 'ci', candidate: {sha: candidate}},
  checks: ['source-hygiene', 'source-stability', 'local-api-spine', 'local-browser-flows'].map(id => ({id, status: 'passed',...(id==='source-stability'?{result:{unchanged:true,sha256:'a'.repeat(64),files:4}}:{})})), cleanup: {status: 'stopped', errors: []}};}
function trustedRun(candidate) {return {id: 10, path: '.github/workflows/ci.yml', status: 'completed', conclusion: 'success', event: 'push', head_branch: 'main', head_sha: candidate,
  repository: {full_name: repository}, head_repository: {full_name: repository}};}
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


export {fixture,recordsFor,publishedFor};
