import {mkdir, readFile, writeFile, copyFile, stat, readdir} from 'node:fs/promises';
import path from 'node:path';
import {assertTestDsn, assertRealOwnedPath} from '../testing/guards.mjs';
import {execute, resolveTool, runsRoot} from '../testing/runtime.mjs';
import {checksum, verifyBackup, backupFile} from './backup-manifest.mjs';
import {databaseRecoveryInventory} from './artifact-references.mjs';
import {evidenceHash} from './validate-manifest.mjs';
import {normalizeMediaReferences} from './reference-values.mjs';

async function owned(database, registry) {
  assertTestDsn(database.dsn, registry); await assertRealOwnedPath(runsRoot, registry.directory);
  if ((await database.query('SELECT run_id FROM test_run_ownership;')).trim() !== registry.runId) throw Error('Recovery operation requires a live runner-owned database');
}
export async function captureNativeBackup(stack, {releaseManifest = null} = {}) {
  const {database, registry} = stack; await owned(database, registry);
  const directory = path.join(registry.directory, 'recovery-backup'); await mkdir(directory, {mode: 0o700});
  const before = await databaseRecoveryInventory(database);
  if(before.sourceReleaseReferences.length)throw Error('Native synthetic backup lacks historical source certification closure; use prepared verified host capture');
  const pgdump = resolveTool('pg_dump', path.join(path.dirname(database.psql), `pg_dump${process.platform === 'win32' ? '.exe' : ''}`));
  const start = performance.now(), dump = path.join(directory, 'database.dump');
  await writeFile(dump, '', {flag: 'wx', mode: 0o600});
  // Excluding only the harness ownership marker keeps the target's fresh marker.
  await execute(pgdump, ['--format=custom', '--no-owner', '--no-privileges', '--exclude-table=public.test_run_ownership', '-h', '127.0.0.1', '-p', String(registry.ports.database), '-U', 'test_runner', '-d', registry.runId, '-f', dump],
    {env: database.env, log: path.join(registry.directory, 'backup.log'), timeout: 300_000});
  const after = await databaseRecoveryInventory(database);
  if (evidenceHash(before) !== evidenceHash(after)) throw Error('Database recovery references/schema changed while capturing; repeat in a new owned run');
  const files = [];
  const record = async (file, category) => {files.push({path: path.relative(directory, file).replaceAll('\\', '/'), category, sha256: await checksum(file), bytes: (await stat(file)).size});};
  await record(dump, 'database');
  const artifacts = path.join(registry.directory, 'rules-artifacts'), target = path.join(directory, 'artifacts'); await mkdir(target);
  // Preserve all immutable CJS as well as DB references: old journal/backup
  // consumers may outlive their current active run pointer. Never GC here.
  for (const file of await readdir(artifacts)) {
    if (!/^[a-f0-9]{64}\.cjs$/.test(file)) throw Error('Unknown executable artifact filename');
    await assertRealOwnedPath(registry.directory, path.join(artifacts, file));
    if (await checksum(path.join(artifacts, file)) !== `sha256:${file.slice(0, 64)}`) throw Error('Corrupt executable artifact');
    await copyFile(path.join(artifacts, file), path.join(target, file)); await record(path.join(target, file), 'rules-artifact');
  }
  for (const hash of before.artifactHashes) if (!files.some(file => file.category === 'rules-artifact' && file.sha256 === hash)) throw Error('Snapshot refers to missing executable artifact');
  const media = path.join(directory, 'media-references.json');
  await writeFile(media, JSON.stringify({scope: 'references-only', remoteObjectAvailability: 'not_checked', references: before.mediaReferences}, null, 2) + '\n', {mode: 0o600}); await record(media, 'media-manifest');
  if (releaseManifest) {const file = path.join(directory, 'release.json'); await writeFile(file, JSON.stringify(releaseManifest, null, 2) + '\n', {mode: 0o600}); await record(file, 'release-manifest');}
  const manifest = {schemaVersion: 1, kind: 'release-backup', status: 'captured', createdAt: new Date().toISOString(), sourceRunId: registry.runId,
    fixtureProfile: registry.fixture?.profile ?? 'owned-local', releaseManifestHash: releaseManifest ? evidenceHash(releaseManifest) : null,
    schemaFingerprint: before.schemaFingerprint, migrations: before.migrations, referencedArtifactHashes: before.artifactHashes,sourceReleaseReferences:before.sourceReleaseReferences,sourceReleases:[],
    artifactInventoryComplete: true, files, configurationRecovery: 'separate-protected-channel; credentials excluded',
    mediaRecovery: 'reference inventory only; actual off-host objects require separate backup policy', snapshotDurationMs: performance.now() - start};
  await writeFile(path.join(directory, 'backup.json'), JSON.stringify(manifest, null, 2) + '\n', {flag: 'wx', mode: 0o600});
  await verifyBackup(directory); return {directory, manifest};
}

export async function restoreOwnedSnapshot(database, registry, directory) {
  await owned(database, registry); await assertRealOwnedPath(runsRoot, directory);
  const manifest = await verifyBackup(directory);
  // Full gameplay restores are allowed only for a harness-created synthetic
  // backup, never a production/private dump supplied as a bare path.
  const sourceDirectory = path.dirname(directory);
  const source = JSON.parse(await readFile(path.join(sourceDirectory, 'registry.json'), 'utf8'));
  if (source.runId !== manifest.sourceRunId || source.directory !== sourceDirectory || !/^test_[a-f0-9]{24}$/.test(source.runId)
    || manifest.fixtureProfile !== 'integration-baseline') throw Error('Full restore requires an identified synthetic integration backup');
  const tables = (await database.query("SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name <> 'test_run_ownership';")).trim();
  if (tables !== '0') throw Error('Restore target must be fresh and empty apart from its ownership marker');
  const pgrestore = resolveTool('pg_restore', path.join(path.dirname(database.psql), `pg_restore${process.platform === 'win32' ? '.exe' : ''}`));
  const snapshot = manifest.files.find(file => file.category === 'database'), start = performance.now();
  await execute(pgrestore, ['--no-owner', '--no-privileges', '--exit-on-error', '-h', '127.0.0.1', '-p', String(registry.ports.database), '-U', 'test_runner', '-d', registry.runId, backupFile(directory, snapshot.path)],
    {env: database.env, log: path.join(registry.directory, 'recovery-restore.log'), timeout: 300_000});
  await owned(database, registry);
  const actual = await databaseRecoveryInventory(database);
  if (actual.schemaFingerprint !== manifest.schemaFingerprint || evidenceHash(actual.migrations) !== evidenceHash(manifest.migrations)
    || evidenceHash(actual.artifactHashes) !== evidenceHash(manifest.referencedArtifactHashes)) throw Error('Restored schema/migrations/artifact references differ from snapshot');
  if(evidenceHash(actual.sourceReleaseReferences)!==evidenceHash(manifest.sourceReleaseReferences??[]))throw Error('Restored canonical source-release identities differ');
  const media = JSON.parse(await readFile(backupFile(directory, manifest.files.find(file => file.category === 'media-manifest').path), 'utf8'));
  if (evidenceHash(normalizeMediaReferences(media.references)) !== evidenceHash(normalizeMediaReferences(actual.mediaReferences))) throw Error('Restored media references differ');
  const target = path.join(registry.directory, 'rules-artifacts'); await mkdir(target);
  for (const file of manifest.files.filter(file => file.category === 'rules-artifact')) await copyFile(backupFile(directory, file.path), path.join(target, `${file.sha256.slice(7)}.cjs`));
  return {profile: 'owned-full-recovery', backupHash: evidenceHash(manifest), sourceRunId: manifest.sourceRunId,
    schemaFingerprint: actual.schemaFingerprint, restoreDurationMs: performance.now() - start, artifactCount: actual.artifactHashes.length,
    checks: ['snapshot', 'artifacts', 'migrations', 'media-references'].map(id => ({id, status: 'passed'}))};
}
