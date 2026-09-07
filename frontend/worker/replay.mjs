import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {snapshotHash} from './server.mjs';

const require = createRequire(import.meta.url);

/** Private diagnostic export: records contain entropy and must not be public. */
export function replayCombatRecords(records, artifact) {
  let envelope;
  let commands = 0;
  for (const record of records) {
    assert.equal(record.schemaVersion, 1, 'Unsupported journal schema');
    if (record.baseline) {
      assert.equal(envelope, undefined, 'Unexpected second baseline in one combat');
      envelope = structuredClone(record.baseline);
      const expected = record.baselinePosition === 'after' ? record.afterHash : record.beforeHash;
      assert.equal(snapshotHash(envelope), expected, 'Baseline hash mismatch');
      if (record.baselinePosition === 'after') continue;
    }
    assert.ok(envelope, 'Missing replay baseline');
    assert.equal(envelope.artifactHash, record.artifactHash, 'Artifact changed during combat');
    assert.equal(snapshotHash(envelope), record.beforeHash, 'Missing or reordered command');
    const result = artifact.stepRoguelikeCombat(envelope, record.intent, record.artifactHash);
    assert.deepEqual(result.randomValues, record.randomValues, 'Random stream mismatch');
    const projected = artifact.projectRoguelikeCombatPatch(result.envelope, {
      id: envelope.state.characterId, runtime_revision: record.runtimeRevision - 1, turn_state: {},
    });
    assert.equal(snapshotHash(projected.envelope), record.afterHash, 'Combat replay diverged');
    envelope = projected.envelope;
    commands++;
  }
  assert.ok(envelope, 'Empty journal');
  return {envelope, commands};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [recordsFile, artifactFile] = process.argv.slice(2);
  if (!recordsFile || !artifactFile) throw Error('Usage: node replay.mjs private-records.json pinned-artifact.cjs');
  const records = JSON.parse(await readFile(recordsFile, 'utf8'));
  const hash = `sha256:${createHash('sha256').update(await readFile(artifactFile)).digest('hex')}`;
  assert.ok(records.every(record => record.artifactHash === hash), 'Wrong executable artifact');
  const result = replayCombatRecords(records, require(path.resolve(artifactFile)));
  console.log(JSON.stringify({status: 'verified', commands: result.commands, artifactHash: hash, finalHash: snapshotHash(result.envelope)}));
}
