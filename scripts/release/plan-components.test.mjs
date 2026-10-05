import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync, renameSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {classifyPath, createPlan, readDependencyManifest, assertWorkerInputsCovered} from './plan-components.mjs';

const manifest = readDependencyManifest();
const cases = [
  ['UI page', 'frontend/src/pages/LibraryPage.tsx', ['frontend']],
  ['UI stylesheet at root', 'frontend/src/App.css', ['frontend']],
  ['Go API', 'backend/controller.go', ['backend']],
  ['worker shell', 'frontend/worker/server.mjs', ['worker']],
  ['engine', 'frontend/src/engine/cost.ts', ['frontend', 'worker']],
  ['rules core', 'frontend/src/rules-core/handler.ts', ['frontend', 'worker']],
  ['assembler', 'frontend/src/character/assemble.ts', ['frontend', 'worker']],
  ['roguelike', 'frontend/src/roguelike/campAction.ts', ['frontend', 'worker']],
  ['shared animation', 'backend/animationpresentation/catalog.json', ['frontend', 'backend', 'worker']],
  ['shared audio', 'backend/audiopresentation/catalog.json', ['frontend', 'backend']],
  ['lockfile', 'frontend/package-lock.json', ['frontend', 'worker']],
  ['frontend Dockerfile', 'frontend/Dockerfile', ['frontend']],
  ['worker Dockerfile', 'infra/Dockerfile.rules-worker', manifest.components],
  ['build planner', 'scripts/release/plan-components.mjs', manifest.components],
  ['root dockerignore', '.dockerignore', manifest.components],
  ['unknown source', 'shared/new-runtime.ts', manifest.components],
  ['doc', 'docs/example.md', []],
  ['shipped raw doc', 'frontend/src/docs/mechanics.md', ['frontend', 'worker']],
  ['local output', 'output/art/image.png', []],
];
for (const [name, file, expected] of cases) test(`component boundary: ${name}`, () => {
  assert.deepEqual(classifyPath(file).components, expected);
});

test('worker graph rejects a newly imported source declared UI-only', () => {
  assert.doesNotThrow(() => assertWorkerInputsCovered(['frontend/src/engine/cost.ts', 'backend/animationpresentation/catalog.json']));
  assert.throws(() => assertWorkerInputsCovered(['frontend/src/pages/LibraryPage.tsx']), /missing worker dependency/);
});

test('invalid repository paths and unknown manifest versions fail closed', t => {
  for (const value of ['../secret', '/etc/config', 'C:\\private\\file']) assert.throws(() => classifyPath(value), /Invalid repository path/);
  const dir = mkdtempSync(path.join(tmpdir(), 'component-manifest-test-'));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  const file = path.join(dir, 'manifest.json');
  writeFileSync(file, '{"schema_version":2}');
  assert.throws(() => readDependencyManifest(file), /Invalid component dependency manifest/);
  writeFileSync(file, JSON.stringify({...manifest, fallback_components: ['frontend']}));
  assert.throws(() => readDependencyManifest(file), /Fallback must include every component/);
});

function fixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'component-plan-test-'));
  const repo = path.join(dir, 'repo');
  mkdirSync(repo);
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  git('init', '--quiet');
  const write = (file, content = file) => {
    mkdirSync(path.dirname(path.join(repo, file)), {recursive: true});
    writeFileSync(path.join(repo, file), content);
  };
  let head;
  // Fixture objects only: no commits, index or refs in the application checkout.
  const checkpoint = () => {
    git('add', '--all');
    const tree = git('write-tree');
    const args = ['-c', 'user.name=Component planner fixture', '-c', 'user.email=fixture@example.invalid', 'commit-tree', tree];
    if (head) args.push('-p', head);
    head = git(...args, '-m', 'isolated planner fixture');
    git('update-ref', 'HEAD', head);
    return head;
  };
  write('frontend/src/engine/cost.ts', 'old engine');
  write('frontend/src/pages/LibraryPage.tsx', 'old UI');
  write('backend/api.go', 'old backend');
  write('docs/guide.md', 'old documentation');
  const base = checkpoint();
  const deployed = (data = {releaseCommit: base, deploymentStatus: 'succeeded'}) => {
    const file = path.join(dir, 'deployed.json');
    writeFileSync(file, JSON.stringify(data));
    return file;
  };
  return {dir, repo, git, write, checkpoint, base, deployed};
}

test('local plan includes staged, unstaged, untracked, deleted and both sides of a rename', t => {
  const f = fixture(t);
  f.write('backend/api.go', 'staged change');
  f.git('add', 'backend/api.go');
  f.write('frontend/src/pages/LibraryPage.tsx', 'unstaged UI change');
  rmSync(path.join(f.repo, 'frontend/src/engine/cost.ts'));
  renameSync(path.join(f.repo, 'docs/guide.md'), path.join(f.repo, 'backend/renamed.go'));
  f.git('add', 'docs/guide.md', 'backend/renamed.go');
  f.write('frontend/worker/new resolver.mjs', 'untracked worker');
  const result = createPlan({repo: f.repo, base: f.base});
  assert.equal(result.full_fallback, false);
  assert.deepEqual(result.components, {frontend: true, backend: true, worker: true, infrastructure: false});
  assert.ok(result.changes.some(change => change.path === 'backend/api.go' && change.source === 'staged'));
  assert.ok(result.changes.some(change => change.path === 'frontend/src/pages/LibraryPage.tsx' && change.source === 'unstaged'));
  assert.ok(result.changes.some(change => change.path === 'frontend/src/engine/cost.ts' && change.status === 'D'));
  assert.ok(result.changed_files.includes('docs/guide.md'));
  assert.ok(result.changed_files.includes('backend/renamed.go'));
  assert.ok(result.changed_files.includes('frontend/worker/new resolver.mjs'));
});

test('CI uses the supplied commit range, excludes worktree noise and allows docs-only', t => {
  const f = fixture(t);
  f.write('docs/guide.md', 'new doc');
  const candidate = f.checkpoint();
  f.write('backend/api.go', 'unrelated dirty checkout');
  const result = createPlan({repo: f.repo, mode: 'ci', base: f.base, candidate});
  assert.deepEqual(result.changed_files, ['docs/guide.md']);
  assert.ok(Object.values(result.components).every(value => !value));
});

test('missing baseline conservatively selects every component; invalid candidate fails', t => {
  const f = fixture(t);
  for (const base of [undefined, 'missing-base', '0'.repeat(40)]) {
    const result = createPlan({repo: f.repo, mode: 'ci', base});
    assert.ok(Object.values(result.components).every(Boolean));
    assert.equal(result.full_reason, 'missing-baseline');
  }
  assert.throws(() => createPlan({repo: f.repo, candidate: 'missing-candidate'}));
});

test('explicit full overrides a docs-only range without changing its evidence', t => {
  const f = fixture(t);
  f.write('docs/guide.md', 'new doc');
  const candidate = f.checkpoint();
  const result = createPlan({repo: f.repo, mode: 'ci', base: f.base, candidate, full: true});
  assert.equal(result.full_reason, 'explicit-full');
  assert.deepEqual(result.changed_files, ['docs/guide.md']);
  assert.ok(Object.values(result.components).every(Boolean));
});

test('deploy compares last successful manifest across failed/skipped commits even when origin/main equals HEAD', t => {
  const f = fixture(t);
  f.write('frontend/src/engine/cost.ts', 'commit whose deployment failed');
  f.checkpoint();
  f.write('backend/api.go', 'next commit');
  const candidate = f.checkpoint();
  f.git('update-ref', 'refs/remotes/origin/main', candidate);
  const result = createPlan({repo: f.repo, mode: 'deploy', candidate, deployedManifest: f.deployed()});
  assert.equal(result.baseline.sha, f.base);
  assert.equal(result.baseline.source, 'deployed-manifest');
  assert.deepEqual(result.components, {frontend: true, backend: true, worker: true, infrastructure: false});
  assert.deepEqual(result.changed_files, ['backend/api.go', 'frontend/src/engine/cost.ts']);
});

test('deploy rejects missing/failed/ambiguous manifest, guessed base and moving candidate', t => {
  const f = fixture(t);
  const opts = {repo: f.repo, mode: 'deploy', candidate: f.base};
  assert.throws(() => createPlan(opts), /requires --deployed-manifest/);
  assert.throws(() => createPlan({...opts, base: f.base, deployedManifest: f.deployed()}), /last successful/);
  assert.throws(() => createPlan({...opts, candidate: 'HEAD', deployedManifest: f.deployed()}), /exact 40-character/);
  assert.throws(() => createPlan({...opts, deployedManifest: f.deployed({releaseCommit: f.base, deploymentStatus: 'failed'})}), /not a successful/);
  assert.throws(() => createPlan({...opts, deployedManifest: f.deployed({releaseCommit: f.base, source_commit: f.base})}), /unambiguous/);
  assert.throws(() => createPlan({...opts, deployedManifest: f.deployed({releaseCommit: f.base, deploymentStatus: 'succeeded', deployment_status: 'failed'})}), /Ambiguous deployment status/);
  const legacy = createPlan({...opts, deployedManifest: f.deployed({source_commit: f.base})});
  assert.equal(legacy.baseline.source, 'legacy-deployed-manifest:source_commit');
});

test('local candidate cannot mix an older commit with the current worktree', t => {
  const f = fixture(t);
  f.write('backend/api.go', 'next backend');
  f.checkpoint();
  assert.throws(() => createPlan({repo: f.repo, base: f.base, candidate: f.base}), /Local candidate must match HEAD/);
});

test('non-ASCII and newline paths survive NUL-delimited Git output', t => {
  const f = fixture(t);
  // Windows forbids newlines in filenames; Git fixtures on Linux exercise both.
  const file = process.platform === 'win32' ? 'backend/данные с пробелом.go' : 'backend/данные\nс пробелом.go';
  f.write(file, 'new source');
  const candidate = f.checkpoint();
  const result = createPlan({repo: f.repo, mode: 'ci', base: f.base, candidate});
  assert.deepEqual(result.changed_files, [file]);
  assert.equal(result.components.backend, true);
});

test('deploy rejects a dirty tracked checkout or a different checked-out candidate', t => {
  const f = fixture(t);
  const deployedManifest = f.deployed();
  f.write('backend/api.go', 'dirty');
  assert.throws(() => createPlan({repo: f.repo, mode: 'deploy', candidate: f.base, deployedManifest}), /clean tracked checkout/);
  f.checkpoint();
  assert.throws(() => createPlan({repo: f.repo, mode: 'deploy', candidate: f.base, deployedManifest}), /HEAD must equal/);
});

test('optional old worker graph may widen but cannot narrow current dependency selection', t => {
  const f = fixture(t);
  f.write('frontend/src/pages/LibraryPage.tsx', 'UI');
  const candidate = f.checkpoint();
  const graphFile = path.join(f.dir, 'worker-inputs.json');
  writeFileSync(graphFile, JSON.stringify({schema_version: 1, source_sha: f.base, inputs: ['frontend/src/pages/LibraryPage.tsx']}));
  const result = createPlan({repo: f.repo, mode: 'ci', base: f.base, candidate, workerInputs: graphFile});
  assert.equal(result.components.frontend, true);
  assert.equal(result.components.worker, true);
  assert.equal(result.worker_graph.additive_only, true);
});

test('CLI emits stable JSON and bounded GitHub outputs', t => {
  const f = fixture(t);
  f.write('backend/api.go', 'next backend');
  const candidate = f.checkpoint();
  const output = path.join(f.dir, 'result', 'plan.json');
  const githubOutput = path.join(f.dir, 'github-output');
  const cli = fileURLToPath(new URL('./plan-components.mjs', import.meta.url));
  const raw = execFileSync(process.execPath, [cli, '--repo', f.repo, '--mode', 'ci', '--base', f.base,
    '--candidate', candidate, '--output', output, '--github-output', githubOutput], {encoding: 'utf8'});
  assert.deepEqual(JSON.parse(raw), JSON.parse(readFileSync(output, 'utf8')));
  assert.equal(readFileSync(githubOutput, 'utf8'), 'frontend=false\nbackend=true\nworker=false\ninfrastructure=false\n');
});
