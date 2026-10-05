#!/usr/bin/env node
// Explicit POSIX/Linux image-contract gate. Not an anonymous skip in core.
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {buildIdentity} from './write-build-identity.mjs';

if (process.platform === 'win32') throw Error('POSIX shell gate requires Linux/macOS; Windows Docker startup remains unverified');
const directory = mkdtempSync(path.join(tmpdir(), 'frontend-identity-'));
try {
  const input = path.join(directory, 'baked.json'), output = path.join(directory, 'build-info.json');
  const identity = buildIdentity({component: 'frontend', sourceCommit: 'a'.repeat(40), inputFingerprint: `sha256:${'b'.repeat(64)}`});
  writeFileSync(input, `${JSON.stringify(identity)}\n`);
  const run = extra => spawnSync('sh', [fileURLToPath(new URL('../../frontend/write-build-info.sh', import.meta.url)), input, output], {
    encoding: 'utf8', env: {...process.env, SOURCE_COMMIT: 'f'.repeat(40), RELEASE_COMMIT: 'c'.repeat(40), RELEASE_ID: 'release-2', ...extra}});
  const first = run(); assert.equal(first.status, 0, first.stderr);
  assert.deepEqual(JSON.parse(readFileSync(output)), {...identity, releaseCommit: 'c'.repeat(40), releaseId: 'release-2'});
  assert.equal(existsSync(`${output}.tmp`), false);
  assert.equal(run({RELEASE_ID: 'bad"json\nvalue', RELEASE_COMMIT: 'short'}).status, 0);
  assert.deepEqual(JSON.parse(readFileSync(output)), {...identity, releaseCommit: '', releaseId: ''});
  writeFileSync(input, '{}\n'); assert.notEqual(run().status, 0);
  console.log('PASS: frontend baked identity, runtime separation, atomic file and invalid metadata');
} finally {
  assert.equal(path.dirname(directory), path.resolve(tmpdir()));
  assert.ok(path.basename(directory).startsWith('frontend-identity-'));
  rmSync(directory, {recursive: true, force: true});
}
