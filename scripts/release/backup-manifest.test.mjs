import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {backupFile, checksum, verifyBackup, verifyDeploymentBackup, deploymentBackupMaximumAgeMs, captureMaximumStartAgeMs} from './backup-manifest.mjs';
import {evidenceHash} from './validate-manifest.mjs';
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

async function deploymentFixture(t) {
  const f = await fixture(t), release = {releaseId: 'owned-clock-fixture'};
  const absolute = path.join(f.directory, 'release.json'), text = JSON.stringify(release);
  writeFileSync(absolute, text);
  f.manifest.files.push({path: 'release.json', category: 'release-manifest', sha256: await checksum(absolute), bytes: Buffer.byteLength(text)});
  f.manifest.createdAt = '2026-10-05T00:00:00.000Z'; f.manifest.releaseManifestHash = evidenceHash(release); f.save();
  const report = {status: 'passed', scope: 'accepted-deployment-recovery', backupHash: evidenceHash(f.manifest), schemaFingerprint: f.manifest.schemaFingerprint,
    checks: ['snapshot', 'artifacts', 'migrations', 'pending-decision', 'duplicate-command', 'media-references'].map(id => ({id, status: 'passed'}))};
  writeFileSync(path.join(f.directory, 'restore-report.json'), JSON.stringify(report));
  return {...f, release, capturedAt: Date.parse(f.manifest.createdAt)};
}

test('default age rejects crossing sixty minutes while real captured bytes are being verified', async t => {
  const f = await deploymentFixture(t), maximumAge = deploymentBackupMaximumAgeMs;
  const original = readFileSync(path.join(f.directory, 'backup.json'));
  let clock = f.capturedAt + maximumAge - 1;
  t.mock.method(Date, 'now', () => clock);
  // verifyBackup is already awaiting actual checksum streams. Advancing only
  // the clock at the microtask boundary is deterministic; no sleeps or fake
  // successful verifier/restore result replace the real file checks.
  const pending = verifyDeploymentBackup(f.directory, f.release);
  queueMicrotask(() => { clock += 2; });
  await assert.rejects(pending, /Fresh backup of active release required/);
  assert.equal(clock, f.capturedAt + maximumAge + 1);
  assert.deepEqual(readFileSync(path.join(f.directory, 'backup.json')), original);
});

test('default cutover age and explicit deterministic timestamps retain the exact sixty-minute boundary', async t => {
  const f = await deploymentFixture(t), boundary = f.capturedAt + deploymentBackupMaximumAgeMs;
  t.mock.method(Date, 'now', () => boundary);
  assert.equal((await verifyDeploymentBackup(f.directory, f.release)).status, 'verified');
  // Explicit now remains an authoritative test clock, including equality at
  // the limit. It must never consult the process clock as a second policy.
  t.mock.method(Date, 'now', () => { throw Error('Explicit timestamp unexpectedly consulted the clock'); });
  assert.equal((await verifyDeploymentBackup(f.directory, f.release, {now: boundary})).status, 'verified');
  await assert.rejects(verifyDeploymentBackup(f.directory, f.release, {now: boundary + 1}), /Fresh backup/);
});

test('a fresh thirty-one-minute full rehearsal uses original bytes; explicit shorter policy still refuses it',async t=>{
  const f=await deploymentFixture(t), original=readFileSync(path.join(f.directory,'backup.json')),now=f.capturedAt+31*60_000;
  assert.equal(deploymentBackupMaximumAgeMs,60*60_000);assert.equal(captureMaximumStartAgeMs,30*60_000);
  assert.equal((await verifyDeploymentBackup(f.directory,f.release,{now})).status,'verified');
  assert.equal((await verifyDeploymentBackup(f.directory,f.release,{now:f.capturedAt+captureMaximumStartAgeMs,maximumAgeMs:captureMaximumStartAgeMs})).status,'verified');
  await assert.rejects(verifyDeploymentBackup(f.directory,f.release,{now:f.capturedAt+captureMaximumStartAgeMs+1,maximumAgeMs:captureMaximumStartAgeMs}),/Fresh backup/);
  await assert.rejects(verifyDeploymentBackup(f.directory,f.release,{now,maximumAgeMs:captureMaximumStartAgeMs}),/Fresh backup/);
  await assert.rejects(verifyDeploymentBackup(f.directory,f.release,{now:f.capturedAt-1}),/Fresh backup/);
  for(const maximumAgeMs of [0,-1,Infinity,NaN,60*60_000+1,1.5])await assert.rejects(verifyDeploymentBackup(f.directory,f.release,{now,maximumAgeMs}),/Bounded/);
  for(const now of [NaN,Infinity,1.5])await assert.rejects(verifyDeploymentBackup(f.directory,f.release,{now}),/Bounded/);
  assert.deepEqual(readFileSync(path.join(f.directory,'backup.json')),original);
});
