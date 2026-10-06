// Typed draft verifier only. Existing full deploy entry points intentionally do
// not dispatch here until the real OCI/host operation has independent proof.
import {assertReleaseReady,validateManifest,evidenceHash,compositionFingerprint} from './validate-manifest.mjs';
import {assertFrontendEligibility,assertFullAnchorBinding,runtimeCompatibilityHash} from './ui-release-policy.mjs';
import {verifyFrontendCIReport} from './ui-release-planning.mjs';
import {assertImmutablePreservation,assertUnchangedRunningRuntime} from './ui-preservation.mjs';
const same=(a,b)=>evidenceHash(a)===evidenceHash(b);
const hash=/^sha256:[a-f0-9]{64}$/;
export const frontendRehearsalChecks=['image-contract','api-routing','character','equipment','combat-pending','reload','exact-retry','paper','json-export','pdf-export','frontend-rollback','old-chunk-fetch'];

export function verifyOriginalFullAnchor(anchor,{domain,recovery}) {
  if(anchor?.bundle?.rehearsalReceipt?.kind!=='candidate-rehearsal'||anchor.bundle.localOnly||anchor.bundle.simulation
    ||anchor.bundle.rehearsalReceipt.localOnly||anchor.bundle.rehearsalReceipt.simulation)throw Error('Actual original full anchor required; no reuse chain');
  if(!anchor.domain||!same(anchor.domain,domain))throw Error('Protected original full anchor domain missing or changed');
  assertReleaseReady(anchor.manifest,anchor.bundle);
  const receipt=anchor.bundle.rehearsalReceipt;
  assertImmutablePreservation(anchor.files,anchor.files);
  if(anchor.files.rootsHash!==domain.immutableRootsHash||![anchor.manifest.rulesArtifactHash,...anchor.bundle.historicalArtifactHashes].every(hash=>anchor.files.files.some(file=>file.path.endsWith('.cjs')&&file.sha256===hash)))throw Error('Original full anchor executable closure missing');
  if(recovery?.schemaVersion!==1||recovery.kind!=='recoverability-baseline'||recovery.status!=='verified'||recovery.currentDatabaseSnapshot!==false
    ||recovery.backupHash!==receipt.backupHash||!hash.test(recovery.restoreReportHash)||!hash.test(recovery.originalReleaseManifestHash)
    ||!Number.isFinite(Date.parse(recovery.verifiedAt))||!Number.isFinite(Date.parse(recovery.originalBackupCreatedAt)))throw Error('Verified immutable recovery baseline required');
  // Backup belongs to its actual historical release, not retroactively to the
  // newer UI. Full rehearsal links those original bytes to this runtime domain.
  const binding={kind:'full-proof-anchor',manifestHash:evidenceHash(anchor.manifest),bundleHash:evidenceHash(anchor.bundle),
    rehearsalHash:evidenceHash(receipt),backupHash:recovery.backupHash,restoreReportHash:recovery.restoreReportHash,filesystemHash:evidenceHash(anchor.files),
    runtimeCompatibilityHash:runtimeCompatibilityHash(anchor.manifest,domain),completedAt:receipt.completedAt,backupCreatedAt:recovery.originalBackupCreatedAt};
  assertFullAnchorBinding(binding,binding.runtimeCompatibilityHash);
  return binding;
}
export function assertFrontendOnlyReleaseReady(manifest,bundle,{planning,originalAnchor,recovery,ciReport,workloadPlan,protectedRunning}) {
  validateManifest(manifest);
  const {input,eligibility}=planning;
  assertFrontendEligibility(eligibility,{...input,candidateManifest:manifest});
  const anchor=verifyOriginalFullAnchor(originalAnchor,{domain:input.previousDomain,recovery});
  if(!same(anchor,eligibility.binding.fullAnchor))throw Error('Full anchor bytes or original dates changed');
  const ci=verifyFrontendCIReport(ciReport,{...planning,workloadPlan});
  const receipt=bundle?.rehearsalReceipt;
  if(receipt?.schemaVersion!==1||receipt.kind!=='frontend-selective-rehearsal'||receipt.execution!=='docker'||receipt.scope!=='owned-synthetic'
    ||receipt.status!=='passed'||receipt.localOnly!==false||receipt.simulation!==false||bundle.localOnly||bundle.simulation
    ||!/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.test(receipt.runId??'')
    ||receipt.candidateManifestHash!==evidenceHash(manifest)||receipt.previousManifestHash!==evidenceHash(input.previousManifest)
    ||receipt.compositionFingerprint!==compositionFingerprint(manifest)||receipt.eligibilityHash!==eligibility.bindingHash
    ||receipt.coreReportHash!==evidenceHash(ciReport)||receipt.workloadHash!==workloadPlan.sha256
    ||receipt.databaseReferenceInventory!=='not_executed'||receipt.currentDatabaseReferenceCoverage!=='not_asserted'
    ||receipt.currentDatabaseSnapshot!==false||!same(receipt.anchor,anchor)||!same(receipt.recovery,recovery)
    ||receipt.hostObservationScope!=='read-only-around-owned-rehearsal'
    ||!Number.isFinite(Date.parse(receipt.completedAt))||receipt.cleanup?.status!=='stopped'||receipt.cleanup.errors?.length)throw Error('Typed actual selective rehearsal, original anchor and cleanup required');
  if(!Array.isArray(receipt.checks)||!same(receipt.checks.map(row=>row.id),frontendRehearsalChecks)
    ||receipt.checks.some(row=>row.status!=='passed'||row.disposition!=='executed'||!hash.test(row.evidenceHash)))throw Error('Fresh mixed OCI and UI rollback checks required');
  const originalHistory=originalAnchor.bundle.reports['pinned-artifacts'];
  if(!same(receipt.history,{disposition:'reused',sourceProofHash:evidenceHash(originalHistory),applicabilityHash:eligibility.bindingHash,
    originalCompletedAt:anchor.completedAt,originalReport:originalHistory}))throw Error('Historical proof must retain original contents/date; no new replay claim');
  if(!same(bundle.images,Object.fromEntries(Object.entries(manifest.components).map(([name,row])=>[name,row.imageDigest]))))throw Error('Actual mixed OCI image digests differ');
  for(const [name,component] of Object.entries(manifest.components)){
    const identity=bundle.identities?.[name];
    if(identity?.component!==name||identity.provenance!=='baked'||identity.identitySchemaVersion!==1||identity.sourceCommit!==component.sourceCommit
      ||identity.inputFingerprint!==component.inputFingerprint||identity.apiProtocolVersion!==manifest.apiProtocolVersion)throw Error('Mixed OCI identity mismatch');
    if(name!=='frontend'&&!same(identity,protectedRunning[name].identity))throw Error('Reused backend/worker launch identity changed');
    if(name==='frontend'&&(identity.releaseId!==manifest.releaseId||identity.releaseCommit!==manifest.releaseCommit))throw Error('New frontend launch identity missing');
  }
  const imageCheck=receipt.checks[0];
  if(!same(imageCheck.images,bundle.images)||!same(imageCheck.identities,bundle.identities))throw Error('Image check observation differs from receipt');
  if(!same(receipt.runtimeBefore,protectedRunning))throw Error('Protected active runtime mismatch');
  for(const [name,row] of Object.entries(protectedRunning)){
    const configKey=name==='backend'?'backendConfigurationHash':'workerConfigurationHash';
    if(row.configurationHash!==input.previousDomain[configKey]||row.databaseBindingHash!==input.previousDomain.databaseBindingHash
      ||row.mountsHash!==input.previousDomain[name==='backend'?'backendMountsHash':'workerMountsHash'])throw Error('Running runtime differs from protected domain');
    if(name==='rulesWorker'&&!same({artifactHash:row.identity.artifactHash,workerRuntime:row.identity.workerRuntime,workerProtocolVersion:row.identity.workerProtocolVersion,
      supportedWorldSchemaVersions:row.identity.supportedWorldSchemaVersions,capabilities:row.identity.capabilities},
      {artifactHash:manifest.rulesArtifactHash,workerRuntime:manifest.workerRuntime,workerProtocolVersion:manifest.workerProtocolVersion,
      supportedWorldSchemaVersions:manifest.supportedWorldSchemaVersions,capabilities:manifest.capabilities}))throw Error('Running worker compatibility differs');
  }
  assertUnchangedRunningRuntime(receipt.runtimeBefore,receipt.runtimeAfter);
  assertUnchangedRunningRuntime(receipt.runtimeBefore,receipt.runtimeAfterRollback);
  assertUnchangedRunningRuntime(receipt.rehearsalRuntimeBefore,receipt.rehearsalRuntimeAfter);
  assertUnchangedRunningRuntime(receipt.rehearsalRuntimeBefore,receipt.rehearsalRuntimeAfterRollback);
  for(const name of ['backend','rulesWorker'])if(!same(receipt.rehearsalRuntimeBefore[name].identity,bundle.identities[name])
    ||receipt.rehearsalRuntimeBefore[name].containerId===receipt.runtimeBefore[name].containerId)throw Error('Owned OCI identity or isolation differs from protected host');
  assertImmutablePreservation(receipt.filesBefore,receipt.filesAfter);
  assertImmutablePreservation(receipt.filesBefore,receipt.filesAfterRollback);
  assertImmutablePreservation(originalAnchor.files,receipt.filesBefore);
  if(receipt.filesBefore.rootsHash!==input.previousDomain.immutableRootsHash)throw Error('Filesystem roots differ from protected domain');
  const rollback=receipt.checks.find(row=>row.id==='frontend-rollback');
  if(rollback.previousDigest!==input.previousManifest.components.frontend.imageDigest||!same(rollback.changedComponents,['frontend']))throw Error('Rollback must replace only previous frontend');
  return {kind:'frontend-only',status:'verified-contract',eligibilityHash:eligibility.bindingHash,ci,
    databaseReferenceInventory:'not_executed',currentDatabaseSnapshot:false,anchor};
}
