#!/usr/bin/env node
// Explicit integration command: missing PostgreSQL/tools is failure, never skip.
import assert from 'node:assert/strict';
import {access, readFile} from 'node:fs/promises';
import path from 'node:path';
import {startTestStack} from './stack.mjs';
import {runRequiredGo} from './required-go.mjs';

const evidence = [];
for (let iteration = 0; iteration < 2; iteration++) {
  const stack = await startTestStack({dbOnly: true});
  try {
    assert(!evidence.some(item => item.runId === stack.registry.runId));
    const tests = ['TestCharacterRuntimeCommandConcurrentRetryCommitsOnce', 'TestRuntimeEquipmentCommandConservesPhysicalItems'];
    const result = await runRequiredGo(stack, {tests});
    await stack.database.query('CREATE TABLE lifecycle_probe(id integer PRIMARY KEY); INSERT INTO lifecycle_probe VALUES (1);');
    if (iteration === 1) {
      // Exercise the same signal handler installed during startup and service
      // operation without asking Windows to force-terminate the node process.
      process.emit('SIGINT');
      assert(stack.signal.aborted);
    }
    evidence.push({runId: stack.registry.runId, directory: stack.registry.directory, postgres: stack.registry.database.version, ...result, interrupted: iteration === 1});
  } finally {await Promise.all([stack.cleanup(), stack.cleanup()]);}
  await assert.rejects(access(stack.registry.database.data), {code: 'ENOENT'});
  const registry = JSON.parse(await readFile(path.join(stack.registry.directory, 'registry.json'), 'utf8'));
  assert.equal(registry.status, 'stopped'); assert.deepEqual(registry.cleanupErrors, []);
}
process.stdout.write(JSON.stringify({status: 'passed', runs: evidence}, null, 2) + '\n');
