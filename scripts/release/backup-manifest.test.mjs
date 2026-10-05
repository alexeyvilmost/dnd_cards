import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {backupFile, checksum, verifyBackup, verifyDeploymentBackup} from './backup-manifest.mjs';
const hash = c => `sha256:${c.repeat(64)}`;
async function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'backup-contract-'));
  t.after(() => {assert.equal(path.dirname(directory), path.resolve(tmpdir())); assert.ok(path.basename(directory).startsWith('backup-contract-')); rmSync(directory, {recursive: true, force: true});});
  mkdirSync(path.join(directory, 'artifacts'));
  const files = [];
  for (const [file, category, text] of [['database.dump', 'database', 'binary-fixture'], ['artifacts/prior.cjs', 'rules-artifact', 'module.exports = {};'], ['media.json', 'media-manifest', '[]']]) {
    const absolute = path.join(directory, file); writeFileSync(absolute, text);
    files.push({path: file, category, sha256: await checksum(absolute), bytes: Buffer.byteLength(text)});
  }
  const manifest = {schemaVersion: 1, kind: 'release-backup', status: 'captured', createdAt: new Date().toISOString(), schemaFingerprint: hash('a'),
    files, artifactInventoryComplete: true, referencedArtifactHashes: [files[1].sha256], releaseManifestHash: null};
  const save = () => writeFileSync(path.join(directory, 'backup.json'), JSON.stringify(manifest)); save();
  return {directory, manifest, save};
}
test('backup verification binds snapshot/artifact/media bytes and refuses any corruption', async t => {
  const f = await fixture(t); await verifyBackup(f.directory);
  writeFileSync(path.join(f.directory, 'database.dump'), 'changed'); await assert.rejects(verifyBackup(f.directory), /corrupt/);
});
test('missing referenced artifact or unknown/incomplete inventory cannot pass', async t => {
  const f = await fixture(t); f.manifest.referencedArtifactHashes.push(hash('b')); f.save();
  await assert.rejects(verifyBackup(f.directory), /artifact missing/);
  f.manifest.artifactInventoryComplete = false; f.save(); await assert.rejects(verifyBackup(f.directory), /Incomplete/);
});
test('altered executable artifact is rejected even with a valid database snapshot', async t => {
  const f = await fixture(t); writeFileSync(path.join(f.directory, 'artifacts/prior.cjs'), 'module.exports = {tampered:true};');
  await assert.rejects(verifyBackup(f.directory), /corrupt/);
});
test('unsafe backup paths and synthetic restore proof cannot authorize deployment', async t => {
  const f = await fixture(t);
  for (const value of ['../database.dump', '/absolute.dump', 'artifacts/../../database.dump', 'a\\b']) assert.throws(() => backupFile(f.directory, value));
  await assert.rejects(verifyDeploymentBackup(f.directory, {releaseId: 'not-backed-up'}), /Fresh backup/);
  f.manifest.schemaVersion = 2; f.save(); await assert.rejects(verifyBackup(f.directory), /Incomplete/);
});
