import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  ENTITY_ENDPOINTS,
} from './micro-micro-gate.mjs';
import {
  MICRO_MVP_MANIFEST,
  flattenMicroMvpManifest,
} from './micro-mvp-manifest.mjs';
import {
  MICRO_MVP_CONDITION_TARGETS,
  MICRO_MVP_CONDITION_MECHANICS,
  MICRO_MVP_CONDITION_FIELDS,
  MICRO_MVP_CERTIFICATION_VERSION,
  MICRO_MVP_CERTIFIED_AT,
  applyMicroMvpCertificationPlan,
  assertCertificationCatalogIntegrity,
  assertCertificationPlanIntegrity,
  createMicroMvpCertificationPlanFromCatalogs,
  expandMicroMvpCoverageSummaryForCatalogs,
  loadCertificationCatalogs,
  readCertificationBundle,
  rollbackMicroMvpCertificationPlan,
  runMicroMvpCertificationCommand,
  writeCertificationBundleAtomic,
} from './micro-mvp-certifications.mjs';
import {
  REQUIRED_RELEASE_GATES,
  MICRO_MVP_RELEASE_EVIDENCE_SCHEMA_VERSION,
  currentMicroMvpReleaseIdentity,
  currentMicroMvpSourceCommit,
  microMvpCatalogFingerprint,
  microMvpReleaseEvidenceBinding,
  readMicroMvpReleaseEvidence,
  writeMicroMvpReleaseEvidenceAtomic,
} from './micro-mvp-release-evidence.mjs';

const clone = (value) => JSON.parse(JSON.stringify(value));
const CURRENT_RELEASE_IDENTITY = currentMicroMvpReleaseIdentity();
const CURRENT_COMMIT = currentMicroMvpSourceCommit();

function completeTestCoverage() {
  const keys = [
    ...flattenMicroMvpManifest().map((item) => item.key),
    ...MICRO_MVP_CONDITION_TARGETS.map((target) => target.key),
  ].sort();
  const entities = Object.fromEntries(keys.map((key) => [
    key,
    { schema_version: 1, scope: 'micro-mvp-l1', required: 2, passed: 2, percent: 100 },
  ]));
  return {
    schemaVersion: 1,
    scope: 'micro-mvp-l1',
    rulesHash: CURRENT_RELEASE_IDENTITY.rulesHash,
    contentHash: CURRENT_RELEASE_IDENTITY.contentHash,
    required: keys.length * 2,
    passed: keys.length * 2,
    percent: 100,
    entities,
  };
}

function syntheticCatalogs() {
  const catalogs = Object.fromEntries(
    Object.keys(ENTITY_ENDPOINTS).map((entityType) => [entityType, []]),
  );
  let sequence = 1;
  for (const item of flattenMicroMvpManifest()) {
    const entityType = MICRO_MVP_MANIFEST.collectionEntityTypes[item.collection];
    const suffix = String(sequence++).padStart(12, '0');
    catalogs[entityType].push({
      id: `00000000-0000-4000-8000-${suffix}`,
      card_number: item.selector.cardNumber,
      name: item.label,
      support: { status: 'untested' },
      updated_at: '2026-08-05T09:00:00Z',
      ...(item.expected.level === undefined ? {} : { level: item.expected.level }),
      ...(item.expected.category ? { category: item.expected.category } : {}),
    });
  }
  for (const target of MICRO_MVP_CONDITION_TARGETS) {
    const suffix = String(sequence++).padStart(12, '0');
    catalogs.effect.push({
      id: `00000000-0000-4000-8000-${suffix}`,
      card_number: target.cardNumber,
      ...clone(MICRO_MVP_CONDITION_FIELDS[target.id]),
      support: { status: 'untested' },
      updated_at: '2026-08-05T09:00:00Z',
    });
  }
  return catalogs;
}

function testEvidenceBinding(catalogs, baseUrl = 'https://api.example.test') {
  const now = '2026-08-05T07:59:00Z';
  return {
    schemaVersion: MICRO_MVP_RELEASE_EVIDENCE_SCHEMA_VERSION,
    evidenceId: '00000000-0000-4000-8000-000000000998',
    sha256: `sha256:${'e'.repeat(64)}`,
    apiBase: baseUrl,
    frontendBase: 'https://frontend.example.test',
    startedAt: now,
    completedAt: now,
    deploymentAttestation: {
      sourceCommit: CURRENT_COMMIT,
      expectedDeployedCommit: CURRENT_COMMIT,
      basis: 'operator-supplied-commit-identity',
      externalVerificationRequired: true,
    },
    release: clone(CURRENT_RELEASE_IDENTITY),
    catalog: microMvpCatalogFingerprint(catalogs),
    testCoverage: completeTestCoverage(),
    gateIds: REQUIRED_RELEASE_GATES.map((gate) => gate.id),
  };
}

function createTestPlan(catalogs, options = {}) {
  const baseUrl = options.baseUrl ?? 'https://api.example.test';
  return createMicroMvpCertificationPlanFromCatalogs(catalogs, {
    ...options,
    baseUrl,
    evidence: options.evidence ?? testEvidenceBinding(catalogs, baseUrl),
  });
}

test('coverage and certification expand to every exercised DB dependency and lock mechanics', () => {
  const catalogs = syntheticCatalogs();
  const action = {
    id: '00000000-0000-4000-8000-999999999999',
    card_number: 'ACT-dependency-probe',
    name: 'Dependency probe',
    mechanics: { effects: [] },
    support: { status: 'untested' },
    updated_at: '2026-08-05T09:00:00Z',
  };
  catalogs.action.push(action);
  catalogs.class[0].level_progression = { 1: { actions: [action.id] } };
  const baseCoverage = completeTestCoverage();
  const expanded = expandMicroMvpCoverageSummaryForCatalogs(baseCoverage, catalogs);
  assert.equal(Object.keys(expanded.entities).length, 65);
  assert.deepEqual(expanded.entities['dependency.action.ACT-dependency-probe'], {
    schema_version: 1,
    scope: 'micro-mvp-l1',
    required: 2,
    passed: 2,
    percent: 100,
  });

  const evidence = testEvidenceBinding(catalogs);
  evidence.testCoverage = expanded;
  const plan = createMicroMvpCertificationPlanFromCatalogs(catalogs, {
    baseUrl: evidence.apiBase,
    evidence,
  });
  assert.equal(plan.denominator, 65);
  assert.equal(plan.records.length, 65);
  const record = plan.records.find((item) => item.key === 'dependency.action.ACT-dependency-probe');
  assert.equal(record.support.status, 'verified_mechanical');
  assert.equal(record.support.mechanics_locked, true);
  assert.deepEqual(record.support.test_coverage, expanded.entities[record.key]);
});

test('partial dependency certification names its limited standalone scope and fails closed when erased', () => {
  const catalogs = syntheticCatalogs();
  const card = {
    id: '00000000-0000-4000-8000-999999999998',
    card_number: 'CARD-dependency-probe',
    name: 'Partial dependency probe',
    support: { status: 'untested' },
    updated_at: '2026-08-05T09:00:00Z',
  };
  catalogs.card.push(card);
  catalogs.class[0].starting_equipment = { required: [card.id] };
  const evidence = testEvidenceBinding(catalogs);
  evidence.testCoverage = expandMicroMvpCoverageSummaryForCatalogs(
    completeTestCoverage(),
    catalogs,
  );
  const plan = createMicroMvpCertificationPlanFromCatalogs(catalogs, {
    baseUrl: evidence.apiBase,
    evidence,
  });
  const record = plan.records.find((item) => item.key === 'dependency.card.CARD-dependency-probe');
  assert.ok(record);
  assert.equal(record.support.status, 'verified_partial');
  assert.ok(record.support.limitations.some((limitation) => limitation.trim().length > 0));
  assert.doesNotThrow(() => assertCertificationPlanIntegrity(plan));

  record.support.limitations = [];
  assert.throws(
    () => assertCertificationPlanIntegrity(plan),
    /certification limitations differ from the verified status/,
  );
});

test('certification evidence binding rejects a missing or malformed frontend origin', () => {
  const catalogs = syntheticCatalogs();
  for (const invalid of [undefined, '', 'not-a-url', 'https://frontend.example.test/']) {
    const evidence = testEvidenceBinding(catalogs);
    if (invalid === undefined) delete evidence.frontendBase;
    else evidence.frontendBase = invalid;
    assert.throws(
      () => createMicroMvpCertificationPlanFromCatalogs(catalogs, {
        baseUrl: evidence.apiBase,
        evidence,
      }),
      /release evidence frontendBase must be an exact credential-free HTTP\(S\) origin/,
    );
  }
});

function passingEvidenceArtifact(catalogs, baseUrl = 'https://api.example.test', timestamp = new Date()) {
  const completedAt = timestamp.toISOString();
  const startedAt = new Date(timestamp.getTime() - 60_000).toISOString();
  const gates = REQUIRED_RELEASE_GATES.map((gate, index) => {
    const skipped = gate.allowedSkippedTests?.length ?? 0;
    const todo = gate.allowedTodoTests?.length ?? 0;
    return {
      id: gate.id,
      command: gate.command,
      startedAt: new Date(Date.parse(startedAt) + index * 3_000).toISOString(),
      completedAt: new Date(Date.parse(startedAt) + (index + 1) * 3_000).toISOString(),
      status: 'passed',
      exitCode: 0,
      outputHash: `sha256:${'a'.repeat(64)}`,
      outputBytes: 1,
      reportHash: gate.tests ? `sha256:${'b'.repeat(64)}` : null,
      testSummary: gate.tests
        ? { total: 1 + skipped + todo, passed: 1, failed: 0, skipped, todo }
        : null,
      ...(gate.id === 'semantic_coverage' ? { testCoverage: completeTestCoverage() } : {}),
    };
  });
  const aggregate = gates.reduce((totals, gate) => {
    for (const key of Object.keys(totals)) totals[key] += gate.testSummary?.[key] ?? 0;
    return totals;
  }, { total: 0, passed: 0, failed: 0, skipped: 0, todo: 0 });
  return {
    schemaVersion: MICRO_MVP_RELEASE_EVIDENCE_SCHEMA_VERSION,
    kind: 'micro-mvp-release-gate-evidence',
    evidenceId: '00000000-0000-4000-8000-000000000997',
    apiBase: baseUrl,
    frontendBase: 'https://frontend.example.test',
    startedAt,
    completedAt,
    status: 'passed',
    totalTests: aggregate.total,
    passedTests: aggregate.passed,
    skippedTests: aggregate.skipped,
    failedTests: aggregate.failed,
    todoTests: aggregate.todo,
    deploymentAttestation: {
      sourceCommit: CURRENT_COMMIT,
      expectedDeployedCommit: CURRENT_COMMIT,
      basis: 'operator-supplied-commit-identity',
      externalVerificationRequired: true,
    },
    release: clone(CURRENT_RELEASE_IDENTITY),
    catalog: microMvpCatalogFingerprint(catalogs),
    gates,
  };
}

function persistedEvidence(t, catalogs, baseUrl = 'https://api.example.test') {
  const directory = mkdtempSync(join(tmpdir(), 'micro-mvp-release-evidence-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'evidence.json');
  writeMicroMvpReleaseEvidenceAtomic(path, passingEvidenceArtifact(catalogs, baseUrl));
  const read = readMicroMvpReleaseEvidence(path, { apiBase: baseUrl, catalogs });
  return { path, binding: microMvpReleaseEvidenceBinding(read) };
}

function inMemoryCertificationApi(initialCatalogs, {
  corruptPostimageFor = null,
  loseAtomicResponseOnce = false,
} = {}) {
  const catalogs = clone(initialCatalogs);
  const requests = [];
  let shouldLoseAtomicResponse = loseAtomicResponseOnce;
  const endpointByPath = new Map(Object.entries(ENTITY_ENDPOINTS).map(
    ([entityType, [path, key]]) => [path, { entityType, key }],
  ));
  const same = (left, right) => {
    try {
      assert.deepEqual(left, right);
      return true;
    } catch {
      return false;
    }
  };
  const withoutUpdatedAt = (entity) => Object.fromEntries(
    Object.entries(entity).filter(([key]) => key !== 'updated_at'),
  );

  const fetchImpl = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    const catalogEndpoint = endpointByPath.get(url.pathname);
    if (method === 'GET' && catalogEndpoint) {
      const page = Number(url.searchParams.get('page') ?? 1);
      const limit = Number(url.searchParams.get('limit') ?? 100);
      const start = (page - 1) * limit;
      const rows = catalogs[catalogEndpoint.entityType];
      requests.push({ method, path: url.pathname });
      return Response.json({
        [catalogEndpoint.key]: rows.slice(start, start + limit),
        page,
        total: rows.length,
      });
    }

    if (method === 'POST' && url.pathname === '/api/content-support/batch-exact') {
      const body = JSON.parse(String(init.body));
      requests.push({ method, path: url.pathname, headers: init.headers, body });
      const states = new Set();
      const resolved = [];
      for (const entry of body.entries) {
        const entity = catalogs[entry.entity_type]?.find(
          (candidate) => candidate.id === entry.entity_id,
        );
        if (!entity) return new Response('missing', { status: 404 });
        const desired = { ...clone(entry.expected_current), support: clone(entry.support) };
        const isExpected = same(entity, entry.expected_current);
        const isDesired = same(withoutUpdatedAt(entity), withoutUpdatedAt(desired));
        if (!isExpected && !isDesired) return new Response('drift', { status: 409 });
        if (isExpected && !isDesired) states.add('expected');
        if (isDesired && !isExpected) states.add('desired');
        resolved.push({ entity, support: entry.support });
      }
      if (states.size > 1) return new Response('mixed', { status: 409 });
      const alreadyApplied = states.has('desired');
      if (!alreadyApplied) {
        for (const { entity, support } of resolved) {
          entity.support = clone(support);
          entity.updated_at = body.mode === 'certification_apply'
            ? '2026-08-05T09:00:01Z'
            : '2026-08-05T09:00:02Z';
        }
      }
      if (corruptPostimageFor) {
        const corrupted = Object.values(catalogs).flat().find(
          (entity) => entity.card_number === corruptPostimageFor,
        );
        corrupted.support = { ...corrupted.support, certified_at: '2099-01-01T00:00:00Z' };
      }
      if (shouldLoseAtomicResponse) {
        shouldLoseAtomicResponse = false;
        throw new Error('simulated lost atomic response');
      }
      return Response.json({
        schema_version: 1,
        mode: body.mode,
        plan_hash: body.plan_hash,
        operation_id: body.operation_id,
        total: body.expected_count,
        updated: alreadyApplied ? 0 : body.expected_count,
        already_in_requested_state_count: alreadyApplied ? body.expected_count : 0,
        already_applied: alreadyApplied,
      });
    }

    return new Response('not found', { status: 404 });
  };

  return {
    catalogs,
    requests,
    fetchImpl,
    loseNextAtomicResponse: () => { shouldLoseAtomicResponse = true; },
  };
}

function persistedTestBundle(t, plan) {
  const directory = mkdtempSync(join(tmpdir(), 'micro-mvp-certification-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'bundle.json');
  writeCertificationBundleAtomic(path, plan, { refuseOverwrite: true });
  return path;
}

test('certification bundle reader and writer require a private regular file', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'micro-mvp-private-certification-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const plan = createTestPlan(syntheticCatalogs());
  const bundlePath = join(directory, 'bundle.json');
  writeCertificationBundleAtomic(bundlePath, plan);
  assert.equal(readCertificationBundle(bundlePath).planHash, plan.planHash);

  const directoryPath = join(directory, 'not-a-file');
  mkdirSync(directoryPath);
  assert.throws(() => readCertificationBundle(directoryPath), /must be a regular file/);
  assert.throws(
    () => writeCertificationBundleAtomic(directoryPath, plan),
    /must be a regular file/,
  );

  if (process.platform !== 'win32') {
    chmodSync(bundlePath, 0o644);
    assert.throws(() => readCertificationBundle(bundlePath), /group\/world access/);
    assert.throws(
      () => writeCertificationBundleAtomic(bundlePath, plan),
      /group\/world access/,
    );
    chmodSync(bundlePath, 0o600);

    const linkPath = join(directory, 'bundle-link.json');
    symlinkSync(bundlePath, linkPath);
    assert.throws(() => readCertificationBundle(linkPath), /must not be a symlink/);
    assert.throws(
      () => writeCertificationBundleAtomic(linkPath, plan),
      /must not be a symlink/,
    );
  }
});

test('plan is deterministic and covers exactly 49 core entries plus 15 conditions', () => {
  const catalogs = syntheticCatalogs();
  const bundleIdentity = {
    bundleId: '00000000-0000-4000-8000-000000000999',
    createdAt: '2026-08-05T08:00:00Z',
  };
  const left = createTestPlan(catalogs, {
    baseUrl: 'https://api.example.test',
    ...bundleIdentity,
  });
  const right = createTestPlan(clone(catalogs), {
    baseUrl: 'https://api.example.test',
    ...bundleIdentity,
  });

  assert.equal(left.denominator, 64);
  assert.equal(left.records.length, 64);
  assert.equal(left.records.filter((record) => record.collection === 'conditions').length, 15);
  assert.ok(left.records.filter((record) => record.collection === 'conditions')
    .every((record) => record.support.status === 'verified_mechanical'));
  assert.equal(left.certifiedAt, MICRO_MVP_CERTIFIED_AT);
  assert.equal(left.planHash, right.planHash);
  assert.ok(left.records.every((record) => (
    record.support.certified_at === MICRO_MVP_CERTIFIED_AT
    && record.support.certification_version === MICRO_MVP_CERTIFICATION_VERSION
    && record.beforeHash
    && record.before.id === record.id
  )));
  assert.doesNotThrow(() => assertCertificationPlanIntegrity(left));
});

test('duplicate catalog ids and card_numbers fail before a plan can be produced', () => {
  const duplicateId = syntheticCatalogs();
  duplicateId.spell[1].id = duplicateId.spell[0].id;
  assert.throws(
    () => assertCertificationCatalogIntegrity(duplicateId),
    /duplicate identities; ids:/,
  );

  const duplicateCard = syntheticCatalogs();
  duplicateCard.feat[1].card_number = duplicateCard.feat[0].card_number;
  assert.throws(
    () => createTestPlan(duplicateCard),
    /duplicate identities; card_numbers:/,
  );
});

test('condition certification requires the exact versioned mechanics, not identity alone', () => {
  const catalogs = syntheticCatalogs();
  const blinded = catalogs.effect.find((entity) => entity.card_number === 'COND-blinded');
  blinded.mechanics = {
    condition: { id: 'blinded' },
    effects: [],
    world_facts: { cannot_see: false },
  };
  assert.throws(
    () => createTestPlan(catalogs, {
      baseUrl: 'https://api.example.test',
    }),
    /condition\.blinded: condition fields differ from the exact versioned content patch/,
  );
});

test('condition certification rejects a mechanically exact row hidden from the condition API', () => {
  const catalogs = syntheticCatalogs();
  const blinded = catalogs.effect.find((entity) => entity.card_number === 'COND-blinded');
  blinded.effect_type = 'passive';
  assert.deepEqual(blinded.mechanics, MICRO_MVP_CONDITION_MECHANICS.blinded);
  assert.throws(
    () => createTestPlan(catalogs, {
      baseUrl: 'https://api.example.test',
    }),
    /condition\.blinded: effect_type must be condition so the browser condition API can load it/,
  );
});

test('tampered plan denominator fails closed before authentication or writes', async () => {
  const api = inMemoryCertificationApi(syntheticCatalogs());
  const plan = createTestPlan(api.catalogs, {
    baseUrl: 'https://api.example.test',
  });
  plan.records.pop();

  await assert.rejects(
    applyMicroMvpCertificationPlan(plan, {
      baseUrl: 'https://api.example.test',
      confirmApi: 'https://api.example.test',
      token: 'token',
      certificationKey: 'key',
      fetchImpl: api.fetchImpl,
    }),
    /denominator must contain at least 64 records/,
  );
  assert.equal(api.requests.filter((request) => request.method === 'POST').length, 0);
});

test('apply requires both secrets and an exact API acknowledgement', async () => {
  const api = inMemoryCertificationApi(syntheticCatalogs());
  const plan = createTestPlan(api.catalogs, {
    baseUrl: 'https://api.example.test',
  });
  const catalogLoader = () => loadCertificationCatalogs(undefined, {
    baseUrl: 'https://api.example.test',
    fetchImpl: api.fetchImpl,
  });

  await assert.rejects(
    applyMicroMvpCertificationPlan(plan, {
      baseUrl: 'https://api.example.test',
      confirmApi: 'https://api.example.test',
      token: '',
      certificationKey: 'key',
      fetchImpl: api.fetchImpl,
      catalogLoader,
    }),
    /API token\/login is required/,
  );
  await assert.rejects(
    applyMicroMvpCertificationPlan(plan, {
      baseUrl: 'https://api.example.test',
      confirmApi: 'https://api.example.test',
      token: 'token',
      certificationKey: '',
      fetchImpl: api.fetchImpl,
      catalogLoader,
    }),
    /CONTENT_CERTIFICATION_KEY is required/,
  );
  await assert.rejects(
    applyMicroMvpCertificationPlan(plan, {
      baseUrl: 'https://api.example.test',
      confirmApi: 'https://other.example.test',
      token: 'token',
      certificationKey: 'key',
      fetchImpl: api.fetchImpl,
      catalogLoader,
    }),
    /must exactly equal API_URL/,
  );
  assert.equal(api.requests.filter((request) => request.method === 'POST').length, 0);
});

test('apply rejects non-target catalog drift before the atomic support mutation', async (t) => {
  const catalogs = syntheticCatalogs();
  catalogs.effect.push({
    id: '00000000-0000-4000-8000-000000000997',
    card_number: 'EFF-outside-micro-mvp',
    name: 'Non-target release row',
    support: null,
    updated_at: '2026-08-05T09:00:00Z',
  });
  const api = inMemoryCertificationApi(catalogs);
  const baseUrl = 'https://api.example.test';
  const plan = createTestPlan(api.catalogs, { baseUrl });
  const bundlePath = persistedTestBundle(t, plan);
  api.catalogs.effect.find((row) => row.card_number === 'EFF-outside-micro-mvp').name =
    'Concurrent non-target drift';
  const catalogLoader = () => loadCertificationCatalogs(undefined, {
    baseUrl, fetchImpl: api.fetchImpl,
  });

  await assert.rejects(
    applyMicroMvpCertificationPlan(plan, {
      baseUrl, confirmApi: baseUrl, token: 'token', certificationKey: 'key',
      bundlePath, fetchImpl: api.fetchImpl, catalogLoader,
    }),
    /release evidence catalog fingerprint differs/,
  );
  assert.equal(api.requests.filter((request) => request.method === 'POST').length, 0);
});

test('default command is read-only and never invokes login', async () => {
  const api = inMemoryCertificationApi(syntheticCatalogs());
  let loginCalls = 0;
  const output = [];
  const result = await runMicroMvpCertificationCommand({
    argv: [],
    env: { API_URL: 'https://api.example.test' },
    fetchImpl: api.fetchImpl,
    loginImpl: async () => {
      loginCalls += 1;
      return 'should-not-be-used';
    },
    write: (message) => output.push(message),
  });

  assert.equal(result.mode, 'plan');
  assert.equal(result.plan.records.length, 64);
  assert.equal(loginCalls, 0);
  assert.equal(api.requests.filter((request) => request.method === 'POST').length, 0);
  assert.match(output.join('\n'), /No API writes performed/);
});

test('persisted plan requires a recent policy-complete release evidence artifact', async (t) => {
  const api = inMemoryCertificationApi(syntheticCatalogs());
  const directory = mkdtempSync(join(tmpdir(), 'micro-mvp-cert-plan-evidence-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const bundlePath = join(directory, 'certification.json');

  await assert.rejects(
    runMicroMvpCertificationCommand({
      argv: [
        '--bundle', bundlePath,
        '--certified-at', '2026-08-05T12:34:56Z',
      ],
      env: { API_URL: 'https://api.example.test' },
      fetchImpl: api.fetchImpl,
    }),
    /requires --evidence/,
  );
  assert.equal(api.requests.length, 0);

  const stalePath = join(directory, 'stale-evidence.json');
  writeMicroMvpReleaseEvidenceAtomic(
    stalePath,
    passingEvidenceArtifact(api.catalogs, 'https://api.example.test', new Date('2026-08-01T00:00:00Z')),
  );
  await assert.rejects(
    runMicroMvpCertificationCommand({
      argv: [
        '--bundle', bundlePath,
        '--evidence', stalePath,
        '--certified-at', '2026-08-05T12:34:56Z',
      ],
      env: { API_URL: 'https://api.example.test' },
      fetchImpl: api.fetchImpl,
      now: new Date('2026-08-05T18:00:00Z'),
    }),
    /release evidence is stale/,
  );
});

test('apply rejects a tampered evidence file before login or mutation', async (t) => {
  const api = inMemoryCertificationApi(syntheticCatalogs());
  const baseUrl = 'https://api.example.test';
  const evidence = persistedEvidence(t, api.catalogs, baseUrl);
  const plan = createTestPlan(api.catalogs, { baseUrl, evidence: evidence.binding });
  const bundlePath = persistedTestBundle(t, plan);
  writeFileSync(evidence.path, `${readFileSync(evidence.path, 'utf8')} `, { mode: 0o600 });
  let loginCalls = 0;

  await assert.rejects(
    runMicroMvpCertificationCommand({
      argv: [
        '--apply', '--confirm-api', baseUrl,
        '--bundle', bundlePath, '--evidence', evidence.path,
      ],
      env: { API_URL: baseUrl, CONTENT_CERTIFICATION_KEY: 'key' },
      fetchImpl: api.fetchImpl,
      loginImpl: async () => { loginCalls += 1; return 'token'; },
    }),
    /identity\/hash differs/,
  );
  assert.equal(loginCalls, 0);
  assert.equal(api.requests.filter((request) => request.method === 'POST').length, 0);
});

test('persisted bundle is 0600 and apply uses one atomic 64-entry request', async (t) => {
  const api = inMemoryCertificationApi(syntheticCatalogs());
  let loginCalls = 0;
  const output = [];
  const certifiedAt = '2026-08-05T12:34:56Z';
  const baseUrl = 'https://api.example.test';
  const evidence = persistedEvidence(t, api.catalogs, baseUrl);
  const plan = createTestPlan(api.catalogs, {
    baseUrl, certifiedAt, evidence: evidence.binding,
  });
  const bundlePath = persistedTestBundle(t, plan);
  if (process.platform !== 'win32') {
    assert.equal(statSync(bundlePath).mode & 0o777, 0o600);
  }
  const result = await runMicroMvpCertificationCommand({
    argv: [
      '--apply',
      '--confirm-api', 'https://api.example.test',
      '--bundle', bundlePath,
      '--evidence', evidence.path,
    ],
    env: {
      API_URL: 'https://api.example.test',
      CONTENT_CERTIFICATION_KEY: 'cert-key',
    },
    fetchImpl: api.fetchImpl,
    loginImpl: async () => {
      loginCalls += 1;
      return 'login-token';
    },
    write: (message) => output.push(message),
  });

  const batches = api.requests.filter((request) => request.method === 'POST');
  assert.equal(result.mode, 'apply');
  assert.deepEqual(result.result, {
    applied: 64,
    denominator: 64,
    planHash: result.plan.planHash,
    atomic: true,
  });
  assert.equal(loginCalls, 1);
  assert.equal(batches.length, 1);
  assert.equal(batches[0].body.entries.length, 64);
  assert.equal(batches[0].body.mode, 'certification_apply');
  assert.equal(batches[0].headers.Authorization, 'Bearer login-token');
  assert.equal(batches[0].headers['X-Content-Certification-Key'], 'cert-key');
  assert.ok(batches[0].body.entries.every((entry) => entry.support.certified_at === certifiedAt));
  assert.ok(Object.values(api.catalogs).flat().filter((entity) => (
    entity.support?.certification_version === MICRO_MVP_CERTIFICATION_VERSION
  )).every((entity) => entity.support.certified_at === certifiedAt));
  const persisted = readCertificationBundle(bundlePath);
  assert.equal(persisted.status, 'applied');
  assert.ok(persisted.records.every((record) => record.after && record.afterHash));
  if (process.platform !== 'win32') {
    assert.equal(statSync(bundlePath).mode & 0o777, 0o600);
  }
  assert.match(output.join('\n'), /APPLIED ATOMIC 64\/64/);
});

test('atomic rollback restores every exact nested/null support preimage in one request', async (t) => {
  const catalogs = syntheticCatalogs();
  const originalSupports = Object.fromEntries(Object.values(catalogs).flat().map((entity, index) => {
    entity.support = index % 2 === 0
      ? null
      : { status: 'legacy', nested: { preserved: [entity.card_number, true, null] } };
    return [entity.id, clone(entity.support)];
  }));
  const api = inMemoryCertificationApi(catalogs);
  const baseUrl = 'https://api.example.test';
  const plan = createTestPlan(api.catalogs, { baseUrl });
  const bundlePath = persistedTestBundle(t, plan);
  const catalogLoader = () => loadCertificationCatalogs(undefined, {
    baseUrl, fetchImpl: api.fetchImpl,
  });
  await applyMicroMvpCertificationPlan(plan, {
    baseUrl, confirmApi: baseUrl, token: 'token', certificationKey: 'key',
    bundlePath, fetchImpl: api.fetchImpl, catalogLoader,
  });
  const applied = readCertificationBundle(bundlePath);
  const result = await rollbackMicroMvpCertificationPlan(applied, {
    baseUrl, confirmApi: baseUrl, token: 'token', certificationKey: 'key',
    bundlePath, fetchImpl: api.fetchImpl, catalogLoader,
  });

  assert.deepEqual(result, {
    rolledBack: 64, denominator: 64, planHash: plan.planHash, atomic: true,
  });
  assert.equal(api.requests.filter((request) => request.method === 'POST').length, 2);
  assert.deepEqual(
    Object.fromEntries(Object.values(api.catalogs).flat().map((entity) => [entity.id, entity.support])),
    originalSupports,
  );
  const rolledBack = readCertificationBundle(bundlePath);
  assert.equal(rolledBack.status, 'rolled-back');
  assert.ok(rolledBack.records.every((record) => record.rollbackAfter && record.rollbackAfterHash));
});

test('lost atomic apply response reconciles all-requested without a second write', async (t) => {
  const api = inMemoryCertificationApi(syntheticCatalogs(), { loseAtomicResponseOnce: true });
  const baseUrl = 'https://api.example.test';
  const plan = createTestPlan(api.catalogs, { baseUrl });
  const bundlePath = persistedTestBundle(t, plan);
  const catalogLoader = () => loadCertificationCatalogs(undefined, {
    baseUrl, fetchImpl: api.fetchImpl,
  });

  const result = await applyMicroMvpCertificationPlan(plan, {
    baseUrl, confirmApi: baseUrl, token: 'token', certificationKey: 'key',
    bundlePath, fetchImpl: api.fetchImpl, catalogLoader,
  });
  assert.equal(result.atomic, true);
  assert.equal(api.requests.filter((request) => request.method === 'POST').length, 1);
  assert.equal(readCertificationBundle(bundlePath).status, 'applied');
});

test('lost atomic rollback response reconciles exact preimages without replay', async (t) => {
  const api = inMemoryCertificationApi(syntheticCatalogs());
  const baseUrl = 'https://api.example.test';
  const plan = createTestPlan(api.catalogs, { baseUrl });
  const bundlePath = persistedTestBundle(t, plan);
  const catalogLoader = () => loadCertificationCatalogs(undefined, {
    baseUrl, fetchImpl: api.fetchImpl,
  });
  await applyMicroMvpCertificationPlan(plan, {
    baseUrl, confirmApi: baseUrl, token: 'token', certificationKey: 'key',
    bundlePath, fetchImpl: api.fetchImpl, catalogLoader,
  });
  api.loseNextAtomicResponse();
  const applied = readCertificationBundle(bundlePath);
  await rollbackMicroMvpCertificationPlan(applied, {
    baseUrl, confirmApi: baseUrl, token: 'token', certificationKey: 'key',
    bundlePath, fetchImpl: api.fetchImpl, catalogLoader,
  });
  assert.equal(api.requests.filter((request) => request.method === 'POST').length, 2);
  assert.equal(readCertificationBundle(bundlePath).status, 'rolled-back');
});

test('process resume from durable applying state recognizes committed postimages without replay', async (t) => {
  const api = inMemoryCertificationApi(syntheticCatalogs());
  const baseUrl = 'https://api.example.test';
  const plan = createTestPlan(api.catalogs, { baseUrl });
  const bundlePath = persistedTestBundle(t, plan);
  for (const record of plan.records) {
    const entity = api.catalogs[record.entity_type].find((candidate) => candidate.id === record.id);
    entity.support = clone(record.support);
    entity.updated_at = '2026-08-05T09:00:01Z';
  }
  plan.status = 'applying';
  writeCertificationBundleAtomic(bundlePath, plan);
  const resumed = readCertificationBundle(bundlePath);
  const catalogLoader = () => loadCertificationCatalogs(undefined, {
    baseUrl, fetchImpl: api.fetchImpl,
  });

  await applyMicroMvpCertificationPlan(resumed, {
    baseUrl, confirmApi: baseUrl, token: 'token', certificationKey: 'key',
    bundlePath, fetchImpl: api.fetchImpl, catalogLoader,
  });
  assert.equal(api.requests.filter((request) => request.method === 'POST').length, 0);
  assert.equal(readCertificationBundle(bundlePath).status, 'applied');
});

test('mixed state and concurrent body drift both fail before atomic mutation', async (t) => {
  const baseUrl = 'https://api.example.test';
  for (const scenario of ['mixed', 'drift']) {
    const api = inMemoryCertificationApi(syntheticCatalogs());
    const plan = createTestPlan(api.catalogs, { baseUrl });
    const bundlePath = persistedTestBundle(t, plan);
    const first = plan.records[0];
    const entity = api.catalogs[first.entity_type].find((candidate) => candidate.id === first.id);
    if (scenario === 'mixed') {
      entity.support = clone(first.support);
      entity.updated_at = '2026-08-05T09:00:01Z';
    } else {
      entity.name = `${entity.name} concurrent drift`;
    }
    const catalogLoader = () => loadCertificationCatalogs(undefined, {
      baseUrl, fetchImpl: api.fetchImpl,
    });
    await assert.rejects(
      applyMicroMvpCertificationPlan(plan, {
        baseUrl, confirmApi: baseUrl, token: 'token', certificationKey: 'key',
        bundlePath, fetchImpl: api.fetchImpl, catalogLoader,
      }),
      scenario === 'mixed' ? /mixed between expected and requested/ : /neither exact expected nor requested/,
    );
    assert.equal(api.requests.filter((request) => request.method === 'POST').length, 0);
  }
});

test('rollback refuses concurrent body drift without restoring stale support', async (t) => {
  const api = inMemoryCertificationApi(syntheticCatalogs());
  const baseUrl = 'https://api.example.test';
  const plan = createTestPlan(api.catalogs, { baseUrl });
  const bundlePath = persistedTestBundle(t, plan);
  const catalogLoader = () => loadCertificationCatalogs(undefined, {
    baseUrl, fetchImpl: api.fetchImpl,
  });
  await applyMicroMvpCertificationPlan(plan, {
    baseUrl, confirmApi: baseUrl, token: 'token', certificationKey: 'key',
    bundlePath, fetchImpl: api.fetchImpl, catalogLoader,
  });
  const applied = readCertificationBundle(bundlePath);
  const first = applied.records[0];
  const entity = api.catalogs[first.entity_type].find((candidate) => candidate.id === first.id);
  entity.name = `${entity.name} concurrent drift`;

  await assert.rejects(
    rollbackMicroMvpCertificationPlan(applied, {
      baseUrl, confirmApi: baseUrl, token: 'token', certificationKey: 'key',
      bundlePath, fetchImpl: api.fetchImpl, catalogLoader,
    }),
    /neither exact expected nor requested postimage/,
  );
  assert.equal(api.requests.filter((request) => request.method === 'POST').length, 1);
  assert.deepEqual(entity.support, first.support);
});

test('a mismatching refetched postimage leaves a durable unknown outcome for guarded rollback', async (t) => {
  const catalogs = syntheticCatalogs();
  const firstCardNumber = flattenMicroMvpManifest()[0].selector.cardNumber;
  const api = inMemoryCertificationApi(catalogs, { corruptPostimageFor: firstCardNumber });
  const baseUrl = 'https://api.example.test';
  const plan = createTestPlan(catalogs, { baseUrl });
  const bundlePath = persistedTestBundle(t, plan);
  const catalogLoader = () => loadCertificationCatalogs(undefined, {
    baseUrl,
    fetchImpl: api.fetchImpl,
  });

  await assert.rejects(
    applyMicroMvpCertificationPlan(plan, {
      baseUrl,
      confirmApi: baseUrl,
      token: 'token',
      certificationKey: 'key',
      bundlePath,
      fetchImpl: api.fetchImpl,
      catalogLoader,
    }),
    /current full entity is neither exact expected nor requested postimage/,
  );
  assert.equal(api.requests.filter((request) => request.method === 'POST').length, 1);
  assert.equal(readCertificationBundle(bundlePath).status, 'apply-outcome-unknown');
});
