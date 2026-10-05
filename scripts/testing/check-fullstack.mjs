#!/usr/bin/env node
import assert from 'node:assert/strict';
import {access, readFile} from 'node:fs/promises';
import path from 'node:path';
import {startTestStack} from './stack.mjs';
import {execute, repositoryRoot} from './runtime.mjs';
const evidence = [];
for (let iteration = 0; iteration < 2; iteration++) {
  const stack = await startTestStack({profile: 'integration', reuseBuild: iteration > 0 || process.argv.includes('--reuse-ui-build')});
  try {
    await execute(process.execPath, [path.join(repositoryRoot, 'scripts/testing/check-api.mjs')], {env: stack.env, log: path.join(stack.registry.directory, 'api-smoke.log'), signal: stack.signal});
    if (iteration === 1) {process.emit('SIGINT'); assert(stack.signal.aborted);}
    evidence.push({runId: stack.registry.runId, directory: stack.registry.directory, artifactHash: stack.registry.artifactHash, fixture: stack.registry.fixture.profile, interruptedAfterCommands: iteration === 1});
  } finally {await Promise.all([stack.cleanup(), stack.cleanup()]);}
  await assert.rejects(access(stack.registry.database.data), {code: 'ENOENT'});
  const saved = JSON.parse(await readFile(path.join(stack.registry.directory, 'registry.json'), 'utf8'));
  assert.equal(saved.status, 'stopped'); assert.deepEqual(saved.cleanupErrors, []);
}
console.log(JSON.stringify({status: 'passed', runs: evidence}, null, 2));
