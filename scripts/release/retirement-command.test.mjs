// Synthetic boundary metadata; these tests do not attest an image or DDL.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runRetirementCommand} from './retirement-command.mjs';
import {retirementExecutionUnitFixture} from './retirement-state-unit-fixture.mjs';
import {retirementMigrationId, retirementSQLHash} from './retirement-state.mjs';

function fixture() {
  const f = retirementExecutionUnitFixture();
  f.metadata = {schemaVersion: 1, versions: f.request.expectedCurrent.map(r => r.id), build: structuredClone(f.execution.build), retirementExecutionProtocolVersion: 1, retirementReconciliationProtocolVersion: 1, supportedRetirementMigrations: [{id: retirementMigrationId, checksum: retirementSQLHash}]};
  f.calls = [];
  f.command = async call => {f.calls.push(structuredClone(call)); return call.args[0] === '--migration-info' ? JSON.stringify(f.metadata) : JSON.stringify(f.execution);};
  f.args = mode => ({mode, executorManifest: f.executorManifest, request: f.request, command: f.command});
  return f;
}

test('exact executor capability is checked before sending a bounded stdin request', async () => {
  const f = fixture(), receipt = await runRetirementCommand(f.args('execute'));
  assert.deepEqual(receipt, f.execution);
  assert.deepEqual(f.calls.map(c => c.args), [['--migration-info'], ['--execute-character-retirement']]);
  assert(f.calls.every(c => c.imageDigest === f.executorManifest.components.backend.imageDigest));
  assert.equal(f.calls[0].input, null);assert.deepEqual(JSON.parse(f.calls[1].input), f.request);
});

for (const [name, change] of Object.entries({
  'old binary with no execution flag': f => {delete f.metadata.retirementExecutionProtocolVersion;},
  'old binary with no reconciliation flag': f => {delete f.metadata.retirementReconciliationProtocolVersion;},
  'unbaked source': f => {f.metadata.build.provenance = 'unverified';},
  'another source': f => {f.metadata.build.sourceCommit = 'c'.repeat(40);},
  'another fingerprint': f => {f.metadata.build.inputFingerprint = 'sha256:' + 'c'.repeat(64);},
  'another SQL checksum': f => {f.metadata.supportedRetirementMigrations[0].checksum = 'sha256:' + 'c'.repeat(64);},
  'extra retirement command': f => {f.metadata.supportedRetirementMigrations.push({id: '999_drop_other', checksum: retirementSQLHash});},
  'undeclared startup migration': f => {f.metadata.versions.push('999');},
  'retirement registered at startup': f => {f.metadata.versions.push(retirementMigrationId);},
})) test(name + ' refuses before retirement dispatch', async () => {
  const f = fixture();change(f);
  await assert.rejects(runRetirementCommand(f.args('reconcile')));
  assert.equal(f.calls.length, 1);assert.deepEqual(f.calls[0].args, ['--migration-info']);
});

test('caller mutation during metadata I/O cannot change the original request or image', async () => {
  const f = fixture(), original = structuredClone(f.request), image = f.executorManifest.components.backend.imageDigest;
  f.command = async call => {f.calls.push(structuredClone(call)); if (call.args[0] === '--migration-info') {f.request.retirement.backupHash = 'sha256:' + 'f'.repeat(64);f.executorManifest.components.backend.imageDigest = 'example.test/changed@sha256:' + 'f'.repeat(64);return f.metadata;}return f.execution;};
  await runRetirementCommand(f.args('execute'));
  assert.equal(f.calls[1].imageDigest, image);assert.deepEqual(JSON.parse(f.calls[1].input), original);
});

test('read-only reconciliation must preserve the original request and report no applied SQL', async () => {
  const f = fixture();f.execution.result.applied = [];
  await runRetirementCommand(f.args('reconcile'));assert.deepEqual(f.calls[1].args, ['--reconcile-character-retirement']);
  f.execution.result.applied = [retirementMigrationId];
  await assert.rejects(runRetirementCommand(f.args('reconcile')), /reported a mutation/);
});

test('inspection uses its existing strict result validator', async () => {
  const f = fixture();f.request = structuredClone(f.execution.result.request);f.command = async call => {f.calls.push(call);return call.args[0] === '--migration-info' ? f.metadata : f.inspection;};
  const receipt = await runRetirementCommand(f.args('inspect'));
  assert.deepEqual(receipt, f.inspection);assert.deepEqual(f.calls[1].args, ['--inspect-character-retirement']);
});

test('unknown modes and a changed request binding never invoke even the metadata command', async () => {
  const f = fixture();await assert.rejects(runRetirementCommand(f.args('other')));
  f.request.candidateSourceCommit = 'c'.repeat(40);await assert.rejects(runRetirementCommand(f.args('execute')));
  assert.equal(f.calls.length, 0);
});

test('malformed or oversized metadata and a different returned receipt are refused', async () => {
  const f = fixture();f.command = async () => ' '.repeat(1024 * 1024 + 1);
  await assert.rejects(runRetirementCommand(f.args('execute')), /Bounded/);
  f.command = async call => call.args[0] === '--migration-info' ? '{' : f.execution;
  await assert.rejects(runRetirementCommand(f.args('execute')));
  f.command = async call => call.args[0] === '--migration-info' ? f.metadata : {...f.execution, build: {...f.execution.build, sourceCommit: 'c'.repeat(40)}};
  await assert.rejects(runRetirementCommand(f.args('execute')));
});
