// Synthetic metadata and transports: real filesystem/process boundaries,
// but no backup acceptance, database mutation or production authorization.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, realpathSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {retirementExecutionUnitFixture} from './retirement-state-unit-fixture.mjs';
import {retirementMigrationId, retirementSQLHash} from './retirement-state.mjs';
import {createDeploymentStore} from './deploy-state.mjs';
import {prepareRetirementExecutionIntent} from './retirement-intent.mjs';
import {executeRetirement} from './retirement-controller.mjs';

function fixture(t) {
  const f = retirementExecutionUnitFixture();
  f.root = mkdtempSync(path.join(tmpdir(), 'retirement-controller-'));
  t.after(() => {
    assert.equal(path.dirname(f.root), path.resolve(tmpdir()));
    assert(path.basename(f.root).startsWith('retirement-controller-'));
    assert.equal(realpathSync(f.root), f.root);
    rmSync(f.root, {recursive: true, force: true});
  });
  f.store = createDeploymentStore(f.root);f.store.writeActive(f.active);
  f.metadata = {schemaVersion: 1, versions: f.request.expectedCurrent.map(r => r.id), build: f.execution.build, retirementExecutionProtocolVersion: 1, retirementReconciliationProtocolVersion: 1, supportedRetirementMigrations: [{id: retirementMigrationId, checksum: retirementSQLHash}]};
  f.calls = [];f.verifications = 0;
  f.command = async call => {
    f.calls.push(structuredClone(call));
    if (call.args[0] === '--migration-info') return f.metadata;
    assert.equal(f.store.operation(f.request.releaseId).status, 'retirement_outcome_unknown');
    assert.deepEqual(JSON.parse(call.input), f.request);
    const receipt = structuredClone(f.execution);
    if (call.args[0] === '--reconcile-character-retirement') receipt.result.applied = [];
    return receipt;
  };
  f.verifyArtifacts = async accepted => {
    f.verifications++;assert.deepEqual(accepted.active, f.active);
    assert.deepEqual(accepted.request, f.request);
  };
  f.observe = async state => {
    assert.throws(() => f.store.lock());
    return {database: {schemaStatus: 'verified', migrationSet: state.database.migrationSet, schemaProofHash: state.database.schemaProofHash, oldReadersSafe: true}, services: Object.fromEntries(Object.entries(state.manifest.components).map(([key, c]) => [key, {healthy: true, imageDigest: c.imageDigest, identity: {component: key, provenance: 'baked', sourceCommit: c.sourceCommit, inputFingerprint: c.inputFingerprint, apiProtocolVersion: state.manifest.apiProtocolVersion, ...state.instances[key], ...(key === 'rulesWorker' ? {artifactHash: state.manifest.rulesArtifactHash, workerRuntime: state.manifest.workerRuntime, workerProtocolVersion: state.manifest.workerProtocolVersion, supportedWorldSchemaVersions: state.manifest.supportedWorldSchemaVersions, capabilities: state.manifest.capabilities} : {})}}]))};
  };
  f.args = () => ({store: f.store, executorManifest: f.executorManifest, approvalHash: f.approvalHash, request: f.request, verifyArtifacts: f.verifyArtifacts, command: f.command, observe: f.observe});
  f.intentArgs = () => ({store: f.store, executorManifest: f.executorManifest, approvalHash: f.approvalHash, request: f.request});
  return f;
}

test('first dispatch persists intent and uncertainty, then records only the database observation', async t => {
  const f = fixture(t), result = await executeRetirement(f.args());
  assert.equal(result.status, 'succeeded');assert.equal(result.schemaVersion, 2);
  assert.equal(f.verifications, 1);assert.deepEqual(f.calls.map(c => c.args[0]), ['--migration-info', '--execute-character-retirement']);
  assert.deepEqual(f.store.active().manifest, f.active.manifest);assert.deepEqual(f.store.active().instances, f.active.instances);
  assert.deepEqual(f.store.pending(), []);
});

test('completed retry observes the same journal without sending any command or verifying new artifacts', async t => {
  const f = fixture(t);await executeRetirement(f.args());
  const before = readFileSync(path.join(f.root, 'active.json')), count = f.calls.length;
  assert.equal((await executeRetirement(f.args())).repeated, true);
  assert.equal(f.calls.length, count);assert.equal(f.verifications, 1);
  assert.deepEqual(readFileSync(path.join(f.root, 'active.json')), before);
});

test('unsupported reconciliation capability is refused before intent creation and execution', async t => {
  const f = fixture(t);delete f.metadata.retirementReconciliationProtocolVersion;
  await assert.rejects(executeRetirement(f.args()), /capability/);
  assert.equal(f.store.operation(f.request.releaseId), null);assert.equal(f.verifications, 0);
  assert.equal(f.calls.length, 1);
});

test('artifact verification failure cannot persist intent or dispatch SQL', async t => {
  const f = fixture(t);f.verifyArtifacts = async () => {throw Error('archive bytes changed');};
  await assert.rejects(executeRetirement(f.args()), /archive bytes/);
  assert.equal(f.store.operation(f.request.releaseId), null);assert.equal(f.calls.length, 1);
  assert.deepEqual(f.store.active(), f.active);
});

test('baseline changed during artifact I/O is refused atomically before writing intent', async t => {
  const f = fixture(t);f.verifyArtifacts = async () => {
    const newer = structuredClone(f.active);newer.manifest.releaseId = 'newer-app';f.store.writeActive(newer);
  };
  await assert.rejects(executeRetirement(f.args()), /baseline changed/);
  assert.equal(f.store.operation(f.request.releaseId), null);assert.equal(f.calls.length, 1);
  assert.equal(f.store.active().manifest.releaseId, 'newer-app');
});

test('a prepared original intent may continue while retaining its first creation time', async t => {
  const f = fixture(t), intent = await prepareRetirementExecutionIntent(f.intentArgs());
  const result = await executeRetirement(f.args());assert.equal(result.createdAt, intent.createdAt);
  assert.equal(result.executionIntent.intentHash, intent.intentHash);
});

test('lost returned receipt is recovered by the read-only command, never another execute', async t => {
  const f = fixture(t), original = f.command;let lose = true;
  f.command = async call => {
    const receipt = await original(call);
    if (call.args[0] === '--execute-character-retirement' && lose) {lose = false;throw Error('response lost after commit');}
    return receipt;
  };
  await assert.rejects(executeRetirement(f.args()), /response lost/);
  assert.equal(f.store.operation(f.request.releaseId).status, 'retirement_outcome_unknown');
  const result = await executeRetirement(f.args());assert.equal(result.status, 'succeeded');
  assert.deepEqual(f.calls.map(c => c.args[0]), ['--migration-info', '--execute-character-retirement', '--migration-info', '--reconcile-character-retirement']);
  assert.equal(f.verifications, 1);
});

test('missing actual ledger outcome leaves uncertainty and does not resend execution', async t => {
  const f = fixture(t), original = f.command;
  f.command = async call => {await original(call);if (call.args[0] !== '--migration-info') throw Error('no committed receipt');return f.metadata;};
  await assert.rejects(executeRetirement(f.args()));await assert.rejects(executeRetirement(f.args()), /no committed receipt/);
  assert.equal(f.calls.filter(c => c.args[0] === '--execute-character-retirement').length, 1);
  assert.equal(f.store.operation(f.request.releaseId).status, 'retirement_outcome_unknown');
});

test('changed original request during uncertainty is refused before any new transport call', async t => {
  const f = fixture(t), original = f.command;
  f.command = async call => {const r = await original(call);if (call.args[0] === '--execute-character-retirement') throw Error('lost');return r;};
  await assert.rejects(executeRetirement(f.args()));const count = f.calls.length;
  f.request.retirement.backupHash = 'sha256:' + 'f'.repeat(64);
  await assert.rejects(executeRetirement(f.args()), /Changed retirement intent/);assert.equal(f.calls.length, count);
});

test('reconciliation with an applied mutation cannot promote the unknown journal', async t => {
  const f = fixture(t), original = f.command;
  f.command = async call => {const r = await original(call);if (call.args[0] === '--execute-character-retirement') throw Error('lost');if (call.args[0] === '--reconcile-character-retirement') r.result.applied = [retirementMigrationId];return r;};
  await assert.rejects(executeRetirement(f.args()));await assert.rejects(executeRetirement(f.args()), /reported a mutation/);
  assert.equal(f.store.operation(f.request.releaseId).status, 'retirement_outcome_unknown');
});

test('health observation failure retains recovery journal and recovers without another CLI call', async t => {
  const f = fixture(t), original = f.observe;f.observe = async () => {throw Error('health unavailable');};
  await assert.rejects(executeRetirement(f.args()), /health unavailable/);
  assert.equal(f.store.operation(f.request.releaseId).status, 'recovery_required');
  const count = f.calls.length;f.observe = original;
  assert.equal((await executeRetirement(f.args())).status, 'succeeded');assert.equal(f.calls.length, count);
});

test('concurrent caller observes uncertainty and cannot dispatch a second destructive command', async t => {
  const f = fixture(t), original = f.command;let started, release;
  const ready = new Promise(resolve => {started = resolve;}), blocked = new Promise(resolve => {release = resolve;});
  f.command = async call => {
    if (call.args[0] === '--execute-character-retirement') {started();await blocked;}
    if (call.args[0] === '--reconcile-character-retirement') {f.calls.push(structuredClone(call));throw Error('first dispatch still in flight');}
    return original(call);
  };
  const first = executeRetirement(f.args());await ready;
  await assert.rejects(executeRetirement(f.args()), /still in flight/);release();
  assert.equal((await first).status, 'succeeded');
  assert.equal(f.calls.filter(c => c.args[0] === '--execute-character-retirement').length, 1);
});

test('real abrupt sender process exit leaves a durable unknown intent recoverable without execute', async t => {
  const f = fixture(t);
  // URL construction stays platform-correct through the actual module URL.
  const modules = {fixture: new URL('./retirement-state-unit-fixture.mjs', import.meta.url).href, store: new URL('./deploy-state.mjs', import.meta.url).href, controller: new URL('./retirement-controller.mjs', import.meta.url).href, state: new URL('./retirement-state.mjs', import.meta.url).href};
  const program = `import {retirementExecutionUnitFixture} from ${JSON.stringify(modules.fixture)};import {createDeploymentStore} from ${JSON.stringify(modules.store)};import {executeRetirement} from ${JSON.stringify(modules.controller)};import {retirementMigrationId,retirementSQLHash} from ${JSON.stringify(modules.state)};const f=retirementExecutionUnitFixture(),store=createDeploymentStore(process.argv[1]);await executeRetirement({store,executorManifest:f.executorManifest,approvalHash:f.approvalHash,request:f.request,verifyArtifacts:async()=>{},observe:async()=>{throw Error('must not observe');},command:async call=>{if(call.args[0]==='--migration-info')return {schemaVersion:1,versions:f.request.expectedCurrent.map(r=>r.id),build:f.execution.build,retirementExecutionProtocolVersion:1,retirementReconciliationProtocolVersion:1,supportedRetirementMigrations:[{id:retirementMigrationId,checksum:retirementSQLHash}]};if(store.operation(f.request.releaseId).status!=='retirement_outcome_unknown')process.exit(80);process.exit(79);}});`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', program, f.root], {encoding: 'utf8', timeout: 15000});
  assert.equal(child.status, 79, child.stderr);assert.equal(child.signal, null);
  assert.equal(f.store.operation(f.request.releaseId).status, 'retirement_outcome_unknown');
  assert.equal((await executeRetirement(f.args())).status, 'succeeded');
  assert.deepEqual(f.calls.map(c => c.args[0]), ['--migration-info', '--reconcile-character-retirement']);
});
