import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {adaptLegacyManifest, assertReleaseReady, checkSchema, composeEnvironment, compositionFingerprint,
  componentInputFingerprint, evidenceHash, retentionReferences, validateManifest,validateMigrationSet,assertObservedMigrationBinding} from './validate-manifest.mjs';
import {buildIdentity} from './write-build-identity.mjs';
import {attachUnitRehearsal} from './unit-rehearsal-fixture.mjs';

const sha = char => `sha256:${char.repeat(64)}`;
const stamp = '2026-10-04T10:00:00Z';
function fixture() {
  const components = Object.fromEntries(['frontend', 'backend', 'rulesWorker'].map((key, i) => [key, {
    sourceCommit: String(i + 1).repeat(40), inputFingerprint: sha(String(i + 4)), imageDigest: `example.test/project/${key.toLowerCase()}@${sha(String(i + 7))}`,
  }]));
  const manifest = {schemaVersion: 1, releaseId: 'candidate-2', releaseCommit: 'f'.repeat(40), previousReleaseId: null, createdAt: stamp,
    components, rulesArtifactHash: sha('a'), contentManifestHash: sha('b'), apiProtocolVersion: 1, workerProtocolVersion: 1,
    supportedWorldSchemaVersions: [5], workerRuntime: {name: 'node', version: '20.20.0'},
    capabilities: ['pinned-artifact-routing', 'pending-decision-pass-through'], migrationSet: [{id: '101', checksum: sha('c')}],
    validationEvidence: [{gate: 'core', status: 'passed', inputFingerprint: sha('0'), reportHash: sha('0'), completedAt: stamp}]};
  const fingerprint = compositionFingerprint(manifest);
  const reports = Object.fromEntries(['core', 'image-contract', 'pinned-artifacts'].map(gate => [gate,
    {status: 'passed', compositionFingerprint: fingerprint, ...(gate === 'pinned-artifacts' ? {
      workerRuntime: manifest.workerRuntime, artifactHashes: [manifest.rulesArtifactHash, sha('d')], pendingDecisionChecked: true} : {})}]));
  manifest.validationEvidence = Object.entries(reports).map(([gate, report]) => ({gate, status: 'passed',
    inputFingerprint: fingerprint, reportHash: evidenceHash(report), completedAt: stamp}));
  const identities = Object.fromEntries(Object.entries(components).map(([component, identity]) => [component, {
    identitySchemaVersion: 1, component, provenance: 'baked', sourceCommit: identity.sourceCommit, source_commit: identity.sourceCommit,
    inputFingerprint: identity.inputFingerprint, releaseId: manifest.releaseId, releaseCommit: manifest.releaseCommit, apiProtocolVersion: 1,
  }]));
  Object.assign(identities.rulesWorker, {artifactHash: manifest.rulesArtifactHash, workerRuntime: manifest.workerRuntime,
    workerProtocolVersion: 1, supportedWorldSchemaVersions: [5], capabilities: manifest.capabilities});
  const bundle = {reports, identities, images: Object.fromEntries(Object.entries(components).map(([key, item]) => [key, item.imageDigest])), historicalArtifactHashes: [sha('d')], historicalInventoryComplete: true};
  attachUnitRehearsal(manifest, bundle);
  return {manifest, bundle};
}

test('mixed immutable composition passes and reused component keeps old source in new release', () => {
  const {manifest, bundle} = fixture();
  assertReleaseReady(manifest, bundle);
  assert.notEqual(bundle.identities.frontend.sourceCommit, manifest.releaseCommit);
  assert.equal(composeEnvironment(manifest).FRONTEND_IMAGE, manifest.components.frontend.imageDigest);
  assert.ok(!Object.hasOwn(composeEnvironment(manifest), 'SOURCE_COMMIT'));
});

test('schema and compatibility fail closed on missing, unknown or mutable values', () => {
  for (const change of [
    m => {delete m.components.backend;}, m => {m.schemaVersion = 2;}, m => {m.workerProtocolVersion = 2;},
    m => {m.apiProtocolVersion = 9;}, m => {m.supportedWorldSchemaVersions = [4];},
    m => {m.components.backend.imageDigest = 'repository:latest';}, m => {m.components.frontend.imageDigest = `repo:latest@${sha('a')}`;},
    m => {m.rulesArtifactHash = '../artifact';}, m => {m.components.rulesWorker.inputFingerprint = 'short';},
    m => {m.source_commit = 'f'.repeat(40);}, m => {m.createdAt = '2026-02-31T10:00:00Z';},
    m => {m.capabilities.pop();}, m => {m.validationEvidence[0].status = 'skipped';},
    m => {m.migrationSet.push({...m.migrationSet[0], checksum: sha('a')});},
  ]) {
    const {manifest} = fixture(); change(manifest); assert.throws(() => validateManifest(manifest));
  }
  assert.throws(() => checkSchema('x', {unknownConstraint: true}), /Unsupported schema keyword/);
});

test('explicit legacy adapter labels missing provenance and rejects ambiguous aliases', () => {
  for (const field of ['releaseCommit', 'release_sha', 'source_commit']) {
    const adapted = adaptLegacyManifest({[field]: 'f'.repeat(40)});
    assert.equal(adapted.deployable, false); assert.equal(adapted.legacyField, field);
    assert.throws(() => validateManifest(adapted));
  }
  assert.throws(() => adaptLegacyManifest({release_sha: 'a'.repeat(40), source_commit: 'a'.repeat(40)}), /ambiguous/);
  assert.throws(() => adaptLegacyManifest({schemaVersion: 99, source_commit: 'a'.repeat(40)}));
});
test('historical ID-only identity binds its actual observation and can never become an invented checksum',()=>{
  const rows=[{id:'001_existing',kind:'observed-id-only',observationHash:sha('e')},{id:'298_compact_command_receipts',checksum:sha('c')}];
  validateMigrationSet(rows);assertObservedMigrationBinding(rows,['001_existing'],sha('e'));
  const {manifest}=fixture();manifest.migrationSet=rows;validateManifest(manifest);
  for(const invalid of [[{...rows[0],checksum:sha('a')}],[{...rows[0],observationHash:undefined}],[{...rows[0],id:'298_compact_command_receipts'}],[rows[0],{id:'002',kind:'observed-id-only',observationHash:sha('a')}]])assert.throws(()=>validateMigrationSet(invalid));
  assert.throws(()=>assertObservedMigrationBinding(rows,['001_existing'],sha('f')));
  assert.throws(()=>assertObservedMigrationBinding([{id:'001_existing',checksum:sha('e')}],['001_existing'],sha('e')));
  assert.throws(()=>assertObservedMigrationBinding(rows,[],sha('e')));
});

test('identity, OCI inspection, runtime and pinned compatibility failures block readiness', () => {
  for (const change of [
    b => {b.identities.frontend.sourceCommit = 'f'.repeat(40);}, b => {b.identities.backend.provenance = 'unverified';},
    b => {b.identities.backend.source_commit = 'f'.repeat(40);}, b => {b.identities.frontend.releaseId = 'wrong';},
    b => {b.images.backend = `example.test/other@${sha('9')}`;}, b => {delete b.identities.rulesWorker;},
    b => {b.identities.rulesWorker.artifactHash = sha('f');}, b => {b.identities.rulesWorker.workerRuntime = {name: 'node', version: '22.0.0'};},
    b => {b.identities.rulesWorker.capabilities = [];}, b => {b.historicalArtifactHashes.push(sha('e'));},
    b => {delete b.historicalInventoryComplete;}, b => {delete b.historicalArtifactHashes;},
  ]) {
    const {manifest, bundle} = fixture(); change(bundle); assert.throws(() => assertReleaseReady(manifest, bundle));
  }
});

test('gate evidence must hash actual reports and bind to exact composition', () => {
  for (const change of [
    (m, b) => {b.reports.core.status = 'failed';}, (m, b) => {delete b.reports['image-contract'];},
    (m) => {m.components.backend.imageDigest = `other@${sha('f')}`;},
    (m, b) => {b.reports['pinned-artifacts'].workerRuntime = {name: 'node', version: '24.0.0'};
      m.validationEvidence.find(e => e.gate === 'pinned-artifacts').reportHash = evidenceHash(b.reports['pinned-artifacts']);},
  ]) {
    const {manifest, bundle} = fixture(); change(manifest, bundle); assert.throws(() => assertReleaseReady(manifest, bundle));
  }
});

test('predecessor migration hashes and old pinned artifacts survive composition change', () => {
  const {manifest, bundle} = fixture();
  manifest.previousReleaseId = 'release-1';
  assert.throws(() => assertReleaseReady(manifest, bundle), /Previous manifest required/);
  const previous = structuredClone(manifest);
  previous.releaseId = manifest.previousReleaseId; previous.previousReleaseId = null; previous.rulesArtifactHash = sha('d');
  bundle.previousManifest = previous;
  attachUnitRehearsal(manifest, bundle);
  assertReleaseReady(manifest, bundle);
  previous.migrationSet[0].checksum = sha('d');
  assert.throws(() => assertReleaseReady(manifest, bundle), /migration/);
});

test('retention uses all manifests and explicit historical inventory without authorizing deletion', () => {
  const {manifest} = fixture(); const previous = structuredClone(manifest);
  previous.components.backend.imageDigest = `example.test/old@${sha('e')}`;
  const refs = retentionReferences([previous, manifest], [sha('f')]);
  assert.equal(refs.images.length, 4); assert.ok(refs.artifacts.includes(sha('f')));
  assert.equal(refs.authorizesDeletion, false);
  assert.throws(() => retentionReferences([manifest]));
});

test('build identity is explicit, validates input pairs and hashes actual worker bytes', () => {
  const identity = buildIdentity({component: 'frontend', sourceCommit: 'a'.repeat(40), inputFingerprint: sha('b')});
  assert.equal(identity.provenance, 'baked'); assert.equal(identity.source_commit, identity.sourceCommit);
  assert.equal(buildIdentity({component: 'frontend'}).provenance, 'unverified');
  assert.throws(() => buildIdentity({component: 'frontend', sourceCommit: 'a'.repeat(40)}));
  assert.throws(() => buildIdentity({component: 'frontend', sourceCommit: '$malicious', inputFingerprint: sha('b')}));
  const worker = buildIdentity({component: 'rulesWorker', artifact: Buffer.from('one')});
  assert.notEqual(worker.artifactHash, buildIdentity({component: 'rulesWorker', artifact: Buffer.from('two')}).artifactHash);
  assert.equal(worker.workerRuntime.version, process.versions.node);
});

test('component fingerprint includes toolchains, platform and public compile arguments', () => {
  const inputs = {component: 'frontend', sourceFingerprint: sha('a'), platform: 'linux/amd64',
    baseImages: {NODE_IMAGE: `node@${sha('b')}`, NGINX_IMAGE: `nginx@${sha('c')}`}};
  const fingerprint = componentInputFingerprint(inputs);
  assert.equal(fingerprint, componentInputFingerprint({...inputs, buildArguments: {VITE_API_URL: ''}}));
  for (const changed of [
    {...inputs, sourceFingerprint: sha('b')}, {...inputs, platform: 'linux/arm64'},
    {...inputs, buildArguments: {VITE_API_URL: '/api-v2'}},
    {...inputs, baseImages: {...inputs.baseImages, NODE_IMAGE: `node@${sha('d')}`}},
  ]) assert.notEqual(componentInputFingerprint(changed), fingerprint);
  assert.throws(() => componentInputFingerprint({...inputs, baseImages: {NODE_IMAGE: 'node:latest'}}));
  assert.throws(() => componentInputFingerprint({...inputs, buildArguments: {SOURCE_COMMIT: 'override'}}));
});

test('CLI emits no candidate environment or ready marker on invalid identity', t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'release-preflight-'));
  t.after(() => {assert.equal(path.dirname(directory), path.resolve(tmpdir())); rmSync(directory, {recursive: true, force: true});});
  const {manifest, bundle} = fixture();
  const manifestFile = path.join(directory, 'manifest.json'), bundleFile = path.join(directory, 'bundle.json');
  writeFileSync(manifestFile, JSON.stringify(manifest)); writeFileSync(bundleFile, JSON.stringify(bundle));
  const run = () => spawnSync(process.execPath, [fileURLToPath(new URL('./validate-manifest.mjs', import.meta.url)), manifestFile, '--preflight', bundleFile], {encoding: 'utf8'});
  assert.equal(JSON.parse(run().stdout).status, 'ready');
  bundle.identities.frontend.inputFingerprint = sha('e'); writeFileSync(bundleFile, JSON.stringify(bundle));
  const failed = run(); assert.notEqual(failed.status, 0); assert.equal(failed.stdout, '');
  assert.deepEqual(JSON.parse(readFileSync(manifestFile)), manifest);
});

