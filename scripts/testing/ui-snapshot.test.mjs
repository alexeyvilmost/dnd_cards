import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {snapshotTestUI} from './ui-snapshot.mjs';
import {runsRoot} from './runtime.mjs';
import {assertRealOwnedPath} from './guards.mjs';

test('owned UI snapshot is immutable after source rebuild and cannot be overwritten', async () => {
  const runId = `test_${randomBytes(12).toString('hex')}`, directory = path.join(runsRoot, runId);
  const source = path.join(directory, 'source');
  await mkdir(path.join(source, 'assets'), {recursive: true});
  try {
    await writeFile(path.join(source, 'index.html'), '<html>old</html>');
    await writeFile(path.join(source, 'assets/app-oldhash.js'), 'old asset');
    const snapshot = await snapshotTestUI(source, {runId, directory});
    assert.equal(snapshot.files, 2); assert.match(snapshot.manifestHash, /^[a-f0-9]{64}$/);
    await writeFile(path.join(source, 'index.html'), '<html>new</html>');
    await writeFile(path.join(source, 'assets/app-oldhash.js'), 'new asset');
    assert.equal(await readFile(path.join(snapshot.directory, 'index.html'), 'utf8'), '<html>old</html>');
    assert.equal(await readFile(path.join(snapshot.directory, 'assets/app-oldhash.js'), 'utf8'), 'old asset');
    await assert.rejects(snapshotTestUI(source, {runId, directory}));
    await assert.rejects(snapshotTestUI(source, {runId: 'test_' + '0'.repeat(24), directory}), /ownership mismatch/);
  } finally {
    await assertRealOwnedPath(runsRoot, directory);
    await rm(directory, {recursive: true});
  }
});
