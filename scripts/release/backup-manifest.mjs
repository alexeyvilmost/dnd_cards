import {createReadStream, lstatSync, readFileSync, realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {evidenceHash} from './validate-manifest.mjs';
import {verifyBackupSourceReleases} from './source-release-references.mjs';
const hashPattern = /^sha256:[a-f0-9]{64}$/;
export async function checksum(file) {
  const hash = createHash('sha256'); for await (const data of createReadStream(file)) hash.update(data); return `sha256:${hash.digest('hex')}`;
}
export function backupFile(root, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || path.isAbsolute(relative) || relative.split('/').some(part => !part || ['.', '..'].includes(part))) throw Error('Unsafe backup file path');
  const result = path.resolve(root, relative);
  if (!result.startsWith(path.resolve(root) + path.sep) || realpathSync(result) !== result || !lstatSync(result).isFile()) throw Error('Backup file must be an owned regular file');
  return result;
}
export async function verifyBackup(directory) {
  const manifest = JSON.parse(readFileSync(backupFile(directory, 'backup.json'), 'utf8'));
  if (manifest.schemaVersion !== 1 || manifest.kind !== 'release-backup' || manifest.status !== 'captured'
    || !hashPattern.test(manifest.schemaFingerprint) || !Array.isArray(manifest.files) || !manifest.files.length
    || manifest.artifactInventoryComplete !== true || !Array.isArray(manifest.referencedArtifactHashes)
    || manifest.referencedArtifactHashes.some(value => !hashPattern.test(value))
    || new Set(manifest.files.map(file => file.path)).size !== manifest.files.length) throw Error('Incomplete backup manifest');
  for (const file of manifest.files) {
    const absolute = backupFile(directory, file.path);
    if (!hashPattern.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes <= 0
      || lstatSync(absolute).size !== file.bytes || await checksum(absolute) !== file.sha256) throw Error('Backup file missing, empty or corrupt');
  }
  if (manifest.files.filter(file => file.category === 'database').length !== 1) throw Error('One database snapshot required');
  for (const hash of manifest.referencedArtifactHashes) if (!manifest.files.some(file => file.category === 'rules-artifact' && file.sha256 === hash)) throw Error('Referenced executable artifact missing');
  if (!manifest.files.some(file => file.category === 'media-manifest')) throw Error('Media reference inventory required');
  await verifyBackupSourceReleases(directory,manifest.sourceReleaseReferences??[],manifest.sourceReleases??[],manifest.files);
  return manifest;
}
export async function verifyDeploymentBackup(directory, releaseManifest, {now, maximumAgeMs = 30 * 60_000} = {}) {
  const manifest = await verifyBackup(directory);
  // Hashing captured files takes time; an implicit clock must describe the
  // verified bytes now, not the instant before their verification began.
  const verifiedAt = now === undefined ? Date.now() : now;
  if (manifest.releaseManifestHash !== evidenceHash(releaseManifest) || verifiedAt - Date.parse(manifest.createdAt) > maximumAgeMs
    || !Number.isFinite(Date.parse(manifest.createdAt)) || Date.parse(manifest.createdAt) > verifiedAt) throw Error('Fresh backup of active release required');
  return verifyOriginalRestoreProof(directory, releaseManifest, manifest);
}
function verifyOriginalRestoreProof(directory, releaseManifest, manifest) {
  const report = JSON.parse(readFileSync(backupFile(directory, 'restore-report.json'), 'utf8'));
  const releaseFile = manifest.files.filter(file => file.category === 'release-manifest');
  if (releaseFile.length !== 1 || evidenceHash(JSON.parse(readFileSync(backupFile(directory, releaseFile[0].path), 'utf8'))) !== evidenceHash(releaseManifest)) throw Error('Backed-up release manifest differs from active release');
  if (report.status !== 'passed' || report.backupHash !== evidenceHash(manifest) || report.schemaFingerprint !== manifest.schemaFingerprint
    || report.scope !== 'accepted-deployment-recovery' || !Array.isArray(report.checks) || report.checks.some(check => check.status !== 'passed')
    || new Set(report.checks.map(check => check.id)).size !== report.checks.length) throw Error('Backup has no matching complete restore proof');
  for (const id of ['snapshot', 'artifacts', 'migrations', 'pending-decision', 'duplicate-command', 'media-references']) {
    if (!report.checks.some(check => check.id === id && check.status === 'passed')) throw Error(`Restore check missing: ${id}`);
  }
  return {status: 'verified', manifestHash: manifest.releaseManifestHash, backupHash: evidenceHash(manifest), restoreReportHash: evidenceHash(report), restoreDrillPassed: true};
}

// This verifies old bytes, never calls dump/restore and never claims a current
// snapshot. The full deployment verifier above keeps its 30-minute rule.
export async function verifyRecoverabilityBaseline(directory, originalManifest, {restoreReportHash, now=Date.now()}={}) {
  const manifest=await verifyBackup(directory);
  const originalReport=JSON.parse(readFileSync(backupFile(directory,'restore-report.json'),'utf8'));
  if(originalReport.localOnly||originalReport.simulation)throw Error('Actual accepted recovery proof required');
  if (manifest.releaseManifestHash!==evidenceHash(originalManifest) || !Number.isFinite(Date.parse(manifest.createdAt)) || Date.parse(manifest.createdAt)>now) throw Error('Original recoverability baseline identity/date mismatch');
  const proof=verifyOriginalRestoreProof(directory,originalManifest,manifest);
  if (!hashPattern.test(restoreReportHash)||restoreReportHash!==proof.restoreReportHash) throw Error('Original restore proof changed');
  return {schemaVersion:1,kind:'recoverability-baseline',status:'verified',currentDatabaseSnapshot:false,
    originalBackupCreatedAt:manifest.createdAt,originalReleaseManifestHash:manifest.releaseManifestHash,
    backupHash:proof.backupHash,restoreReportHash:proof.restoreReportHash,schemaFingerprint:manifest.schemaFingerprint,
    verifiedAt:new Date(now).toISOString()};
}
