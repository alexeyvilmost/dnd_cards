// Local reader exercise after retirement. A capture of the installed candidate
// is distinct from the predecessor used as a rollback reader. No backup field
// is rewritten to satisfy the ordinary pre-deployment rehearsal contract.
import assert from 'node:assert/strict';
import {assertPublishedRehearsalCandidate} from './candidate-rehearsal.mjs';
import {validateActive} from './deploy-state.mjs';
import {databaseMigrationSet} from './migration-transition.mjs';
import {baselineArtifact} from './legacy-baseline.mjs';
import {evidenceHash,compositionFingerprint,validateWriterTransition} from './validate-manifest.mjs';
const same=(a,b)=>evidenceHash(a)===evidenceHash(b);
const composition=manifest=>{const {validationEvidence,...value}=manifest;return value;};

export function retirementRehearsalInput({candidate,rollbackActive,capturedActive,capture,captureHash,backup}) {
  const manifest=assertPublishedRehearsalCandidate(candidate);
  validateActive(rollbackActive);validateActive(capturedActive);
  assert.equal(capturedActive.database?.status,'verified-additive');
  assert.equal(rollbackActive.database?.status,'verified-additive');
  assert.equal(manifest.previousReleaseId,rollbackActive.manifest.releaseId);
  assert(same(composition(manifest),composition(capturedActive.manifest)));
  assert.match(captureHash??'',/^sha256:[a-f0-9]{64}$/);
  assert.equal(capture.schemaVersion,1);assert.equal(capture.kind,'candidate-capture');assert.equal(capture.status,'captured');
  assert.equal(capture.activeHash,evidenceHash(capturedActive));
  assert.equal(capture.releaseManifestHash,evidenceHash(capturedActive.manifest));
  assert.equal(backup.releaseManifestHash,capture.releaseManifestHash);assert.equal(backup.createdAt,capture.createdAt);
  assert(Number.isFinite(Date.parse(capture.createdAt)));
  assert(Array.isArray(capture.files)&&capture.files.length>0);
  assert.equal(capture.files.filter(row=>row.category==='database').length,1);
  assert.equal(capture.files.filter(row=>row.category==='deployment-state').length,1);
  for(const row of capture.files)assert(backup.files.some(file=>same(file,row)));
  const current=databaseMigrationSet(capturedActive);
  // This exercise changes only the retirement schema. An ordinary expansion
  // or an unrelated database proof requires its own accepted reader exercise.
  assert(same(current,databaseMigrationSet(rollbackActive)));
  assert(same(current,manifest.migrationSet));
  assert.equal(capturedActive.database.schemaProofHash,rollbackActive.database.schemaProofHash);
  assert(same([...backup.migrations].sort(),current.map(row=>row.id).sort()));
  validateWriterTransition(manifest,rollbackActive.manifest);
  const historicalArtifactHashes=[...new Set([...backup.referencedArtifactHashes,baselineArtifact(rollbackActive),baselineArtifact(capturedActive)])].sort();
  for(const hash of historicalArtifactHashes)assert(backup.files.some(row=>row.category==='rules-artifact'&&row.sha256===hash));
  return {schemaVersion:1,kind:'local-retirement-reader-input',localOnly:true,deployable:false,
    manifest,previousManifest:rollbackActive.manifest,active:rollbackActive,backup,historicalArtifactHashes,
    candidateHash:evidenceHash(candidate),activeHash:evidenceHash(rollbackActive),backupHash:evidenceHash(backup),compositionFingerprint:compositionFingerprint(manifest),
    capturedActiveHash:evidenceHash(capturedActive),capturedMigrationSetHash:evidenceHash(current),captureHash,
    ...(Object.hasOwn(manifest,'writerPolicy')?{publishedCandidate:candidate}:{})};
}
