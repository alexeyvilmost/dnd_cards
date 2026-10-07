#!/usr/bin/env node
// Offline preflight only: no network, Docker, deployment, secret reads or mutation.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertOCIMediaDisabled} from './write-build-identity.mjs';
import {assertWriterTraces} from './writer-traces.mjs';
import {assertRetainedWriterHistory} from './writer-retained-history.mjs';
import {validateWriterPreviewProfiles} from './writer-runtime-profile.mjs';
import {validateRetirementDatabaseState} from './retirement-state.mjs';

export const manifestSchema = JSON.parse(readFileSync(new URL('../../infra/release-manifest.schema.json', import.meta.url), 'utf8'));
const keys = ['frontend', 'backend', 'rulesWorker'];
const hashPattern = /^sha256:[a-f0-9]{64}$/;
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const json = value => JSON.stringify(canonical(value));
export const evidenceHash = value => `sha256:${createHash('sha256').update(json(value)).digest('hex')}`;

// Deliberately small evaluator for the checked-in schema, not a general JSON
// Schema engine. Unknown validation keywords fail closed (schema drift test).
export function checkSchema(value, schema = manifestSchema, location = 'manifest') {
  const supported = new Set(['$schema', '$id', '$defs', 'title', '$ref', 'type', 'const', 'enum', 'anyOf', 'required',
    'properties', 'additionalProperties', 'items', 'minItems', 'uniqueItems', 'pattern', 'format']);
  for (const key of Object.keys(schema)) if (!supported.has(key)) throw Error(`Unsupported schema keyword: ${key}`);
  if (schema.$ref) {
    if (!schema.$ref.startsWith('#/$defs/')) throw Error('Unsupported schema reference');
    const target = manifestSchema.$defs[schema.$ref.slice(8)];
    if (!target) throw Error('Unknown schema reference');
    checkSchema(value, target, location);
  }
  if (schema.anyOf && !schema.anyOf.some(branch => {try {checkSchema(value, branch, location); return true;} catch {return false;}})) throw Error(`${location}: no valid alternative`);
  if ('const' in schema && json(value) !== json(schema.const)) throw Error(`${location}: incompatible value`);
  if (schema.enum && !schema.enum.some(item => json(value) === json(item))) throw Error(`${location}: unknown value`);
  const actualType = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (schema.type && actualType !== schema.type) throw Error(`${location}: expected ${schema.type}`);
  if (schema.pattern && (typeof value !== 'string' || !new RegExp(schema.pattern).test(value))) throw Error(`${location}: invalid format`);
  if (schema.format) {
    if (schema.format !== 'date-time') throw Error('Unsupported schema format');
    const date = new Date(value);
    if (!Number.isFinite(date.valueOf()) || date.toISOString() !== value.replace(/(?<!\.\d{3})Z$/, '.000Z')) throw Error(`${location}: invalid timestamp`);
  }
  if (actualType === 'object') {
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) throw Error(`${location}.${key}: required`);
    for (const [key, item] of Object.entries(value)) {
      if (schema.properties?.[key]) checkSchema(item, schema.properties[key], `${location}.${key}`);
      else if (schema.additionalProperties === false) throw Error(`${location}.${key}: unknown field`);
    }
  }
  if (actualType === 'array') {
    if (schema.minItems && value.length < schema.minItems) throw Error(`${location}: insufficient items`);
    if (schema.uniqueItems && new Set(value.map(json)).size !== value.length) throw Error(`${location}: duplicate items`);
    if (schema.items) value.forEach((item, index) => checkSchema(item, schema.items, `${location}[${index}]`));
  }
  return value;
}

// Absence is a logical OFF policy, never a mutation of old manifest bytes.
export function writerPolicy(manifest) {
  if (!Object.hasOwn(manifest, 'writerPolicy')) return {compactReceipts:false,imageJobs:false,frozenCatalogs:false};
  checkSchema(manifest.writerPolicy, manifestSchema.$defs.writerPolicy, 'writerPolicy');
  return {...manifest.writerPolicy};
}
// A missing configuration remains OFF. Preserve the explicit lineage contract
// once introduced, while historical absent/absent manifests keep their bytes.
export function writerPolicyFields(previous,config) {
  return previous && Object.hasOwn(previous,'writerPolicy') || Object.hasOwn(config,'writerPolicy')
    ? {writerPolicy:writerPolicy(config)} : {};
}
// Only the reviewed nullable lifecycle expansion keeps the existing writer
// formats unchanged. This allows building a candidate, never authorizes cutover:
// planDeployment still requires the exact-image migration approval and all
// cross-image writer, retained-history, pending/retry and rollback outcomes.
export const lifecycleMigrationIdentity = Object.freeze({id:'301_character_lifecycle',checksum:'sha256:b9e0ce00f22803866a7f511d0e0ba8bf7b3975ceae7cf9f51dfb0e2176ad4ab5'});
export function lifecycleWriterExpansion(candidate,previous) {
  if(!candidate || !previous || json(writerPolicy(candidate))!==json(writerPolicy(previous)))return false;
  const baseline=previous.migrationSet,target=candidate.migrationSet;
  return Array.isArray(baseline)&&Array.isArray(target)&&target.length===baseline.length+1
    && !baseline.some(row=>row.id===lifecycleMigrationIdentity.id)
    && baseline.every(row=>target.some(other=>json(other)===json(row)))
    && target.some(row=>json(row)===json(lifecycleMigrationIdentity));
}
export const presentationMigrationIdentity = Object.freeze({id:'307_catalog_presentation',checksum:"sha256:f2a1975deccfaadc1b83d9339977792c49ea0cad9d754d68608483419dbcbd32"});
export function presentationWriterExpansion(candidate,previous) {
 if(!candidate || !previous || json(writerPolicy(candidate))!==json(writerPolicy(previous)))return false;
 const baseline=previous.migrationSet,target=candidate.migrationSet;
 return Array.isArray(baseline)&&Array.isArray(target)&&target.length===baseline.length+1
  && !baseline.some(row=>row.id===presentationMigrationIdentity.id)
  && ['298_compact_command_receipts','299_frozen_combat_catalogs','300_image_jobs','301_character_lifecycle'].every(id=>baseline.some(row=>row.id===id&&hashPattern.test(row.checksum)))
  && baseline.every(row=>target.some(other=>json(other)===json(row)))
  && target.some(row=>json(row)===json(presentationMigrationIdentity));
}
export function validateWriterTransition(candidate, previous, retirementActive) {
  const policy=writerPolicy(candidate);
  if(previous)writerPolicy(previous);
  if(previous && Object.hasOwn(previous,'writerPolicy') && !Object.hasOwn(candidate,'writerPolicy')) throw Error('Writer policy cannot disappear from a manifest release line');
  if(policy.compactReceipts || policy.imageJobs) {
    if(!previous || candidate.previousReleaseId!==previous.releaseId) throw Error('Enabled writers require a verified manifest predecessor; legacy adoption is forbidden');
    for(const key of ['apiProtocolVersion','workerProtocolVersion','supportedWorldSchemaVersions']) if(json(candidate[key])!==json(previous[key])) throw Error('Enabled writer policy requires the same schema and migration identities');
    if(json(candidate.migrationSet)!==json(previous.migrationSet)&&!lifecycleWriterExpansion(candidate,previous)&&!presentationWriterExpansion(candidate,previous)){
      if(!retirementActive||json(retirementActive.manifest)!==json(previous))throw Error('Enabled writer policy requires the same schema and migration identities');
      const database=validateRetirementDatabaseState(retirementActive);
      if(json(database.baselineMigrationSet)!==json(previous.migrationSet)||json(database.migrationSet)!==json(candidate.migrationSet))throw Error('Writer transition must declare exactly the already recorded retirement');
    }
    for(const id of ['298_compact_command_receipts','300_image_jobs']) if(!candidate.migrationSet.some(row=>row.id===id && hashPattern.test(row.checksum))) throw Error('Enabled writers require exact additive migration 298/300 checksums');
  }
  return policy;
}
export function validateManifest(manifest) {
  checkSchema(manifest);
  if (manifest.previousReleaseId === manifest.releaseId) throw Error('Release cannot be its own predecessor');
  if (new Set(manifest.migrationSet.map(item => item.id)).size !== manifest.migrationSet.length) throw Error('Duplicate migration ID');
  validateMigrationSet(manifest.migrationSet);
  if (new Set(manifest.validationEvidence.map(item => item.gate)).size !== manifest.validationEvidence.length) throw Error('Duplicate validation gate');
  for (const component of Object.values(manifest.components)) {
    // Digest-only references: prohibit a mutable :tag before @ even though OCI permits both.
    if (component.imageDigest.split('@')[0].split('/').at(-1).includes(':')) throw Error('Image reference must omit mutable tag');
  }
  return manifest;
}
export const additiveMigrationIDs=new Set(['298_compact_command_receipts','299_frozen_combat_catalogs','300_image_jobs','301_character_lifecycle','307_catalog_presentation']);
export function validateMigrationSet(rows){
  checkSchema(rows,{type:'array',items:{$ref:'#/$defs/migrationIdentity'}});
  if(new Set(rows.map(row=>row.id)).size!==rows.length)throw Error('Duplicate migration ID');
  const observed=rows.filter(row=>row.kind==='observed-id-only');
  if(new Set(observed.map(row=>row.observationHash)).size>1||observed.some(row=>additiveMigrationIDs.has(row.id)))throw Error('Observed migration identities must bind one historical observation; additive source checksums required');
  return rows;
}
export function assertObservedMigrationBinding(rows,ids,observationHash){
  validateMigrationSet(rows);
  if(!hashPattern.test(observationHash)||!Array.isArray(ids)||new Set(ids).size!==ids.length)throw Error('Explicit historical observation required');
  for(const id of ids){const row=rows.find(item=>item.id===id);if(!row||!additiveMigrationIDs.has(id)&&(row.kind!=='observed-id-only'||row.observationHash!==observationHash))throw Error('Historical migration identity differs from observed baseline');}
  for(const row of rows.filter(row=>row.kind==='observed-id-only'))if(!ids.includes(row.id)||row.observationHash!==observationHash)throw Error('Unobserved migration cannot acquire ID-only provenance');
}

// Source estimate fingerprints alone omit compiler/runtime pins and build args.
// CI must compute this from a clean committed source snapshot; the helper does
// not claim a dirty worktree is the supplied Git commit.
export function componentInputFingerprint({component, sourceFingerprint, baseImages, platform, buildArguments = {}}) {
  const required = {frontend: ['NODE_IMAGE', 'NGINX_IMAGE'], backend: ['GO_IMAGE', 'ALPINE_IMAGE'], rulesWorker: ['NODE_IMAGE']}[component];
  if (!required || !hashPattern.test(sourceFingerprint) || !/^linux\/(?:amd64|arm64)$/.test(platform)) throw Error('Invalid component build inputs');
  if (!baseImages || json(Object.keys(baseImages).sort()) !== json([...required].sort())
    || Object.values(baseImages).some(ref => typeof ref !== 'string' || !/^[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}$/.test(ref))) throw Error('Exact component base image pins required');
  const argumentKeys = Object.keys(buildArguments);
  if (argumentKeys.some(key => component !== 'frontend' || !['VITE_API_URL', 'VITE_MEDIA_VARIANTS'].includes(key))
    || Object.values(buildArguments).some(value => typeof value !== 'string')) throw Error('Unknown build argument');
  if (component === 'frontend') assertOCIMediaDisabled(buildArguments);
  return evidenceHash({version: 1, component, sourceFingerprint, baseImages, platform,
    buildArguments: component === 'frontend' ? {VITE_API_URL: '', VITE_MEDIA_VARIANTS: '0', ...buildArguments} : {}});
}

// Baseline discovery only. Never invent missing image digests/old artifact hashes.
export function adaptLegacyManifest(legacy) {
  if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) throw Error('Invalid legacy manifest');
  if (legacy.schemaVersion !== undefined && legacy.schemaVersion !== 0) throw Error('Explicit legacy adapter only accepts unversioned/v0 data');
  const aliases = ['releaseCommit', 'release_sha', 'source_commit'].filter(key => Object.hasOwn(legacy, key));
  if (aliases.length !== 1 || !/^[a-f0-9]{40}$/.test(legacy[aliases[0]])) throw Error('Legacy identity missing or ambiguous');
  return {schemaVersion: 0, provenance: 'legacy-unverified', deployable: false, releaseCommit: legacy[aliases[0]], legacyField: aliases[0]};
}

// Gates bind to the full immutable composition and compatibility contract, not
// releaseId/time/evidence themselves, so reports can be produced before release.
export function compositionFingerprint(manifest) {
  validateManifest(manifest);
  const {components, rulesArtifactHash, contentManifestHash, apiProtocolVersion, workerProtocolVersion,
    supportedWorldSchemaVersions, workerRuntime, capabilities, migrationSet} = manifest;
  return evidenceHash({components, rulesArtifactHash, contentManifestHash, apiProtocolVersion, workerProtocolVersion,
    supportedWorldSchemaVersions, workerRuntime, capabilities, migrationSet, ...(Object.hasOwn(manifest, 'writerPolicy') ? {writerPolicy: manifest.writerPolicy} : {})});
}

export const candidateRehearsalStages = ['snapshot','migrations','full-candidate-health','image-contract','historical-inventory','historical-replay','pending-decision','duplicate-command'];
export function rehearsalStages(manifest) {
  return [...candidateRehearsalStages, ...(Object.hasOwn(manifest,'writerPolicy') ? ['writer-compatibility'] : [])];
}
export function assertWriterRehearsalBoundary(manifest,checks){
  if(!Object.hasOwn(manifest,'writerPolicy'))return;
  if(json(checks['full-candidate-health']?.historyWriterPolicy)!==json({compactReceipts:false,imageJobs:false,frozenCatalogs:false}))throw Error('Captured-history applications must start with all writers OFF');
  const check=checks['writer-compatibility'],cleanup=check?.formatFixtureCleanup;
  if(check?.formatScope!=='separate-public-owned-fixture'||cleanup?.status!=='stopped'
    ||!Number.isSafeInteger(cleanup.executions)||cleanup.executions!==1+(check.outcomes??[]).filter(row=>row.id!=='frontend-pending-job-reload').length)throw Error('Separate writer fixture cleanup is incomplete');
}
export function assertCandidateRehearsal(manifest, bundle) {
  const receipt=bundle?.rehearsalReceipt, reports=bundle?.reports;
  if(receipt?.schemaVersion!==1||receipt.kind!=='candidate-rehearsal'||receipt.execution!=='docker'||receipt.status!=='passed'
    ||!/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.test(receipt.runId??'')
    ||receipt.releaseId!==manifest.releaseId||receipt.compositionFingerprint!==compositionFingerprint(manifest)
    ||!['candidateHash','activeHash','backupHash'].every(key=>hashPattern.test(receipt[key]))
    ||receipt.cleanup?.status!=='stopped'||receipt.cleanup.errors?.length||!Number.isFinite(Date.parse(receipt.completedAt))
    ||!Array.isArray(receipt.checks)||json(receipt.checks.map(row=>row.id))!==json(rehearsalStages(manifest))||receipt.checks.some(row=>row.status!=='passed'))throw Error('Complete isolated Docker candidate rehearsal with verified cleanup required');
  const checks=Object.fromEntries(receipt.checks.map(row=>[row.id,row])),health=checks['full-candidate-health'],image=checks['image-contract'];
  if(checks.snapshot.backupHash!==receipt.backupHash||!hashPattern.test(checks.snapshot.schemaFingerprint)
    ||json(checks.migrations.versions)!==json(manifest.migrationSet.map(row=>row.id).sort())
    ||json(health.components)!==json([...keys].sort())||health.publishedPorts!==0||health.canonicalCurrentArtifact!==true||health.currentArtifactHash!==manifest.rulesArtifactHash
    ||json(image.images)!==json(bundle.images)||json(image.identities)!==json(bundle.identities)
    ||checks['historical-inventory'].complete!==true||json(checks['historical-inventory'].artifactHashes)!==json(bundle.historicalArtifactHashes)
    ||json(checks['historical-replay'].artifactHashes)!==json(bundle.historicalArtifactHashes)||!Number.isSafeInteger(checks['historical-replay'].commands)||checks['historical-replay'].commands<1
    ||checks['pending-decision'].checked!==true||!hashPattern.test(checks['pending-decision'].pendingHash)
    ||checks['duplicate-command'].checked!==true||!['acceptedHash','continuedHash','invariantHash'].every(key=>hashPattern.test(checks['duplicate-command'][key])))throw Error('Candidate health, current engine, historical replay or durable command proof missing');
  for(const gate of ['image-contract','pinned-artifacts'])if(reports?.[gate]?.rehearsalHash!==evidenceHash(receipt))throw Error('Gate report does not bind the actual rehearsal receipt');
  if(json(reports['image-contract'].health)!==json(health))throw Error('Image gate health differs from actual candidate observation');
  if(receipt.additiveMigrations){
    if(json(receipt.additiveMigrations.report)!==json(reports.additiveMigrations)||json(receipt.additiveMigrations.approval)!==json(bundle.migrationApproval))throw Error('Additive report differs from actual candidate rehearsal');
  }else if(reports.additiveMigrations||bundle.migrationApproval)throw Error('Additive approval has no candidate rehearsal binding');
  assertWriterCompatibility(manifest,bundle,checks['writer-compatibility']);
  assertWriterRehearsalBoundary(manifest,checks);
  return checks;
}

// This consumes actual image/rehearsal observations. It cannot infer persisted
// reader support from runtime flags or the migration ledger. Docker producers
// must supply the additional stage before any explicit policy becomes ready.
export const writerCompatibilityOutcomes = ['compact-receipt-cross-image-retry','image-job-cross-image-retry','frontend-pending-job-reload','expanded-data-dump-restore','enabled-off-enabled-rollback'];
export function requiredWriterOutcomes(manifest,previous,previousIdentities) {
  const current=writerPolicy(manifest),prior=previous?writerPolicy(previous):writerPolicy({});
  const backend=previousIdentities?.backend?.readerCapabilities??[],frontend=previousIdentities?.frontend?.readerCapabilities??[];
  const receipts=current.compactReceipts||prior.compactReceipts||backend.includes('receipt-v2');
  const jobs=current.imageJobs||prior.imageJobs||backend.includes('image-job-v1')||frontend.includes('image-job-v1');
  return writerCompatibilityOutcomes.filter((_,index)=>index===0?receipts:index<3?jobs:receipts||jobs);
}
function observedReaders(manifest,images,identities,instances) {
  const result={};
  for(const key of keys) {
    const component=manifest.components[key], identity=identities?.[key], launch=instances?.[key];
    if(images?.[key]!==component.imageDigest || identity?.identitySchemaVersion!==1 || identity.provenance!=='baked' || identity.component!==key
      ||identity.sourceCommit!==component.sourceCommit ||identity.inputFingerprint!==component.inputFingerprint ||identity.apiProtocolVersion!==manifest.apiProtocolVersion
      ||!launch || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(launch.releaseId??'') || !/^[a-f0-9]{40}$/.test(launch.releaseCommit??'')
      ||identity.releaseId!==launch.releaseId || identity.releaseCommit!==launch.releaseCommit
      ||identity.source_commit!==undefined && identity.source_commit!==identity.sourceCommit) throw Error('Writer compatibility requires exact baked image and launch identities');
    const readers=identity.readerCapabilities===undefined?[]:identity.readerCapabilities;
    if(!Array.isArray(readers)||new Set(readers).size!==readers.length||readers.some(value=>typeof value!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(value)))throw Error('Invalid source-owned reader capabilities');
    result[key]=readers;
  }
  return result;
}
export function writerCompatibilityRequirements(manifest,bundle,check) {
  const previous=bundle.previousManifest,policy=validateWriterTransition(manifest,previous,bundle.retirementActive);
  if(bundle.retirementActive&&evidenceHash(bundle.retirementActive)!==bundle.rehearsalReceipt?.activeHash)throw Error('Retirement writer baseline differs from the actual rehearsal input');
  if(!Object.hasOwn(manifest,'writerPolicy'))return [];
  if(check?.status!=='passed'||check.compositionFingerprint!==compositionFingerprint(manifest)||json(check.writerPolicy)!==json(policy)
    ||json(check.candidate?.images)!==json(bundle.images)||json(check.candidate?.identities)!==json(bundle.identities))throw Error('Exact writer compatibility rehearsal is required');
  const launches=Object.fromEntries(keys.map(key=>[key,{releaseId:manifest.releaseId,releaseCommit:manifest.releaseCommit}]));
  const candidateReaders=observedReaders(manifest,bundle.images,bundle.identities,launches);
  let previousReaders=null;
  if(previous) {
    const state=check.previous?.state;
    if(state?.schemaVersion!==1||state.status!=='active'||json(state.manifest)!==json(previous)||evidenceHash(state)!==bundle.rehearsalReceipt.activeHash)throw Error('Writer rehearsal predecessor differs from the verified active state');
    previousReaders=observedReaders(previous,check.previous.images,check.previous.identities,state.instances);
    for(const key of keys)for(const reader of previousReaders[key])if(!candidateReaders[key].includes(reader))throw Error('Persisted reader capabilities cannot be removed, including when writers are OFF');
  } else if(check.previous!==null)throw Error('Unexpected writer compatibility predecessor');
  validateWriterPreviewProfiles({candidate:check.candidate,previous:check.previous,writerPolicy:policy,executionProfile:check.executionProfile});
  const required={backend:[],frontend:[]};
  const prior=previous?writerPolicy(previous):writerPolicy({});
  // OFF is not evidence that persisted data disappeared. Conservatively retain
  // the proof obligation of the predecessor's source-owned readers; those
  // declarations are themselves monotonic above, so ON -> OFF -> OFF is safe.
  const receipts=policy.compactReceipts||prior.compactReceipts||previousReaders?.backend.includes('receipt-v2');
  const jobs=policy.imageJobs||prior.imageJobs||previousReaders?.backend.includes('image-job-v1')||previousReaders?.frontend.includes('image-job-v1');
  if(receipts)required.backend.push('receipt-v1','receipt-v2');
  if(jobs){required.backend.push('image-job-v1');required.frontend.push('image-job-v1');}
  for(const [key,readers] of Object.entries(required))for(const reader of readers)if(!candidateReaders[key].includes(reader)||!previousReaders?.[key].includes(reader))throw Error('Candidate and rollback image readers must support persisted writer formats');
  return requiredWriterOutcomes(manifest,previous,check.previous?.identities);
}
export function assertWriterCompatibility(manifest,bundle,check) {
  const expected=writerCompatibilityRequirements(manifest,bundle,check);
  if(!Object.hasOwn(manifest,'writerPolicy'))return;
  if(expected.length)assertRetainedWriterHistory(check.retainedHistory,bundle.rehearsalReceipt.backupHash);
  if(!Array.isArray(check.outcomes)||json(check.outcomes.map(row=>row.id))!==json(expected)||check.outcomes.some(row=>row.status!=='passed'||!hashPattern.test(row.traceHash)))throw Error('Actual cross-image read/retry, restore and rollback outcomes required');
  assertWriterTraces(manifest,check,bundle.rehearsalReceipt,expected);
}

export function assertReleaseReady(manifest, bundle = {}) {
  const {reports, identities, images, historicalArtifactHashes, historicalInventoryComplete, previousManifest}=bundle;
  validateManifest(manifest);
  if (historicalInventoryComplete !== true || !Array.isArray(historicalArtifactHashes)) throw Error('Explicit complete historical artifact inventory required');
  if (manifest.previousReleaseId !== null && !previousManifest) throw Error('Previous manifest required');
  if (manifest.previousReleaseId === null && previousManifest) throw Error('Unexpected previous manifest');
  const fingerprint = compositionFingerprint(manifest);
  for (const gate of ['core', 'image-contract', 'pinned-artifacts']) {
    const evidence = manifest.validationEvidence.find(item => item.gate === gate);
    const report = reports?.[gate];
    if (!evidence || evidence.inputFingerprint !== fingerprint || !report || evidenceHash(report) !== evidence.reportHash
      || report.status !== 'passed' || report.compositionFingerprint !== fingerprint) throw Error(`Missing/stale evidence: ${gate}`);
  }
  if (json(reports['pinned-artifacts'].workerRuntime) !== json(manifest.workerRuntime)) throw Error('Pinned artifacts must be checked with the exact worker runtime');
  if (!Array.isArray(reports['pinned-artifacts'].artifactHashes)) throw Error('Pinned artifact inventory required');
  if (reports['pinned-artifacts'].pendingDecisionChecked !== true) throw Error('Pinned pending decision check required');
  const requiredArtifacts = new Set([manifest.rulesArtifactHash, ...historicalArtifactHashes]);
  if (previousManifest) {
    validateManifest(previousManifest);
    if (manifest.previousReleaseId !== previousManifest.releaseId) throw Error('Predecessor mismatch');
    requiredArtifacts.add(previousManifest.rulesArtifactHash);
    // Rollback/cutover may add migrations, but must not erase/change already
    // applied migration identity. Actual destructive migration review is separate.
    for (const migration of previousManifest.migrationSet) if (!manifest.migrationSet.some(item => json(item) === json(migration))) throw Error('Applied migration removed or changed');
  }
  for (const artifact of requiredArtifacts) if (!hashPattern.test(artifact) || !reports['pinned-artifacts'].artifactHashes.includes(artifact)) throw Error('Historical artifact compatibility evidence missing');
  for (const key of keys) {
    const expected = manifest.components[key];
    const identity = identities?.[key];
    // Actual image digest comes from isolated-container inspection, not from a
    // user-controlled health field; endpoint alone cannot attest an OCI image.
    if (images?.[key] !== expected.imageDigest) throw Error(`${key}: image digest mismatch`);
    if (!identity || identity.identitySchemaVersion !== 1 || identity.component !== key || identity.provenance !== 'baked'
      || identity.sourceCommit !== expected.sourceCommit || identity.inputFingerprint !== expected.inputFingerprint
      || identity.releaseId !== manifest.releaseId || identity.releaseCommit !== manifest.releaseCommit
      || identity.apiProtocolVersion !== manifest.apiProtocolVersion) throw Error(`${key}: identity mismatch`);
    if (identity.source_commit !== undefined && identity.source_commit !== identity.sourceCommit) throw Error(`${key}: legacy identity alias mismatch`);
  }
  const worker = identities.rulesWorker;
  for (const [field, expected] of Object.entries({artifactHash: manifest.rulesArtifactHash, workerRuntime: manifest.workerRuntime,
    workerProtocolVersion: manifest.workerProtocolVersion, supportedWorldSchemaVersions: manifest.supportedWorldSchemaVersions,
    capabilities: manifest.capabilities})) if (json(worker[field]) !== json(expected)) throw Error(`Worker ${field} mismatch`);
  assertCandidateRehearsal(manifest,bundle);
  return manifest;
}

export function composeEnvironment(manifest) {
  validateManifest(manifest);
  return {RELEASE_ID: manifest.releaseId, RELEASE_COMMIT: manifest.releaseCommit,
    FRONTEND_IMAGE: manifest.components.frontend.imageDigest, BACKEND_IMAGE: manifest.components.backend.imageDigest,
    RULES_WORKER_IMAGE: manifest.components.rulesWorker.imageDigest};
}

// Read-only reachability output. Never interprets absent history as permission
// to delete. Callers must separately prove that the DB/history inventory is full.
export function retentionReferences(manifests, historicalArtifactHashes) {
  if (!Array.isArray(historicalArtifactHashes) || historicalArtifactHashes.some(value => !hashPattern.test(value))) throw Error('Explicit valid historical inventory required');
  manifests.forEach(validateManifest);
  return {images: [...new Set(manifests.flatMap(item => Object.values(item.components).map(component => component.imageDigest)))].sort(),
    artifacts: [...new Set([...historicalArtifactHashes, ...manifests.map(item => item.rulesArtifactHash)])].sort(),
    authorizesDeletion: false};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const file = args.shift();
  if (!file) throw Error('Usage: validate-manifest.mjs <manifest.json> [--legacy | --candidate-env | --preflight <bundle.json>]');
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  let result;
  if (args.length === 1 && args[0] === '--legacy') result = adaptLegacyManifest(manifest);
  else if (args.length === 1 && args[0] === '--candidate-env') result = {purpose: 'isolated-candidate-only', environment: composeEnvironment(manifest)};
  else if (args.length === 2 && args[0] === '--preflight') {
    assertReleaseReady(manifest, JSON.parse(readFileSync(args[1], 'utf8')));
    result = {status: 'ready', environment: composeEnvironment(manifest)};
  } else if (args.length === 0) {validateManifest(manifest); result = {status: 'schema-valid', compositionFingerprint: compositionFingerprint(manifest)};}
  else throw Error('Unknown arguments');
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
