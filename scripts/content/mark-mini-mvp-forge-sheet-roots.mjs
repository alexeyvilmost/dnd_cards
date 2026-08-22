#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { apiUrl, login } from './api.mjs';
import {
  buildCertificationIndex,
  certificationHashes,
  sha256Canonical,
} from './certification-hash.mjs';
import { assessMiniMvpCatalogs, fetchMiniMvpCatalogs } from './mini-mvp-audit.mjs';
import { MINI_MVP_MANIFEST } from './mini-mvp-manifest.mjs';

export const FORGE_SHEET_SUPPORT_VERSION = 'mini-mvp-forge-sheet-v2';
export const FORGE_SHEET_ROOT_COLLECTIONS = Object.freeze([
  'classes', 'species', 'backgrounds', 'originFeats',
]);

const fixture = JSON.parse(readFileSync(new URL(
  '../../frontend/src/canon/data/mini-mvp-forge-sheet-fixture.v1.json',
  import.meta.url,
), 'utf8'));

function declaredRootCardNumbers() {
  return new Set([
    ...FORGE_SHEET_ROOT_COLLECTIONS.flatMap((collection) => (
      MINI_MVP_MANIFEST.collections[collection].map((entry) => entry.selector.cardNumber)
    )),
    ...(fixture.coverage?.lineages ?? []),
  ]);
}

export function forgeSheetRootCoverageProblems() {
  const problems = [];
  if (fixture.schemaVersion !== 2 || fixture.strategy !== 'cyclic-covering-set-with-lineages-v2') {
    problems.push('Forge fixture has an unsupported schema or strategy');
  }
  const expectedLineages = MINI_MVP_MANIFEST.collections.species.flatMap((entry) => (
    (entry.expected?.variantSelectors ?? []).map((selector) => selector.cardNumber)
  ));
  if (JSON.stringify(fixture.coverage?.lineages) !== JSON.stringify(expectedLineages)) {
    problems.push('lineages: fixture coverage differs from the mini-MVP manifest');
  }
  for (const collection of FORGE_SHEET_ROOT_COLLECTIONS) {
    const expected = MINI_MVP_MANIFEST.collections[collection]
      .map((entry) => entry.selector.cardNumber);
    const actual = fixture.coverage?.[collection];
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      problems.push(`${collection}: fixture coverage differs from the mini-MVP manifest`);
    }
  }
  const observed = new Set(fixture.roots.flatMap((root) => [
    root.classCardNumber,
    root.raceCardNumber,
    root.lineageCardNumber,
    root.backgroundCardNumber,
    root.featCardNumber,
  ]));
  for (const cardNumber of declaredRootCardNumbers()) {
    if (!observed.has(cardNumber)) problems.push(`${cardNumber}: absent from Forge root rows`);
  }
  return problems;
}

export function planForgeSheetRootSupport(report, catalogs) {
  const fixtureProblems = forgeSheetRootCoverageProblems();
  if (fixtureProblems.length > 0) throw new Error(fixtureProblems.join('; '));
  const targets = declaredRootCardNumbers();
  return report.records.filter((record) => targets.has(record.cardNumber)).map((record) => {
    const blocking = record.issues.filter((item) => (
      item.kind === 'data'
      || item.kind === 'mechanics'
      || item.code === 'reference_unresolved'
    ));
    if (blocking.length > 0) {
      throw new Error(`${record.cardNumber}: root is not structurally clean: ${blocking.map((item) => item.code).join(', ')}`);
    }
    const matches = (catalogs[record.entityType] ?? [])
      .filter((entity) => entity.id === record.entityId);
    if (matches.length !== 1) {
      throw new Error(`${record.cardNumber}: expected one live entity, got ${matches.length}`);
    }
    return { record, entity: matches[0] };
  });
}

export function forgeSheetRootSupportPayload(entity, entityType, index, certifiedAt) {
  if (typeof certifiedAt !== 'string' || !certifiedAt.trim()) {
    throw new Error('certifiedAt is required for Forge/sheet support');
  }
  const hashes = certificationHashes(entity, entityType, index);
  return {
    status: 'verified_partial',
    content_hash: hashes.contentHash,
    dependency_hash: hashes.dependencyHash,
    certification_version: FORGE_SHEET_SUPPORT_VERSION,
    certified_at: certifiedAt,
    limitations: [
      'Проверены live-структура, ссылки, родительская принадлежность вариантов и завершённая сборка тем же data-driven конвейером, что использует кузница.',
      'Каждый вариант вида прошёл production UI: кузница, атомарное создание, сохранение lineage_id, стартового инвентаря/золота и открытие реального листа.',
      'Отдельные механические сценарии всех выдаваемых действий и эффектов ещё не сертифицированы; варианты снаряжения Б/В не входят в этот браузерный прогон.',
    ],
    note: 'Корневая или вариантная сущность mini-MVP подтверждена данными и реальным Forge→save→sheet; без блокировки механики.',
    test_coverage: {
      schema_version: 1,
      scope: FORGE_SHEET_SUPPORT_VERSION,
      required: 3,
      passed: 3,
      percent: 100,
    },
    mechanics_locked: false,
  };
}

export function buildForgeSheetRootCertificationBatch(records, operationId = randomUUID()) {
  const entries = records.map((record) => ({
    entity_type: record.entityType,
    entity_id: record.entity.id,
    expected_current: record.entity,
    support: record.support,
  }));
  return {
    schema_version: 1,
    mode: 'certification_apply',
    plan_hash: sha256Canonical({
      schemaVersion: 1,
      operation: FORGE_SHEET_SUPPORT_VERSION,
      entries,
    }),
    operation_id: `mini-mvp-forge-sheet:${operationId}`,
    expected_count: entries.length,
    entries,
  };
}

async function applyRecordsAtomically(records, token, key) {
  const batch = buildForgeSheetRootCertificationBatch(records);
  const response = await fetch(`${apiUrl()}/api/content-support/batch-exact`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Content-Certification-Key': key,
    },
    body: JSON.stringify(batch),
  });
  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`atomic Forge/sheet certification returned ${response.status}: ${responseText.slice(0, 500)}`);
  }
  const receipt = responseText ? JSON.parse(responseText) : null;
  if (receipt?.schema_version !== 1
    || receipt?.mode !== batch.mode
    || receipt?.plan_hash !== batch.plan_hash
    || receipt?.total !== batch.expected_count
    || receipt?.cas !== 'atomic_exact_full_api_response_v1') {
    throw new Error('atomic Forge/sheet certification returned an invalid receipt');
  }
  return receipt;
}

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? null : process.argv[index + 1] ?? null;
}

export async function runForgeSheetRootSupport({
  apply = process.argv.includes('--apply'),
  certifiedAt = option('certified-at'),
} = {}) {
  const catalogs = await fetchMiniMvpCatalogs();
  const report = assessMiniMvpCatalogs(catalogs);
  const plan = planForgeSheetRootSupport(report, catalogs);
  console.log(`${apply ? 'APPLY' : 'DRY-RUN'} ${apiUrl()}: ${plan.length} Forge/sheet roots`);
  for (const item of plan) console.log(`  ${apply ? '◑' : '✓'} ${item.record.cardNumber} ${item.record.expectedName}`);
  if (!apply) return plan;
  if (!certifiedAt) throw new Error('--apply requires --certified-at');
  const key = process.env.CONTENT_CERTIFICATION_KEY?.trim();
  if (!key) throw new Error('--apply requires CONTENT_CERTIFICATION_KEY');
  const token = await login();
  const index = buildCertificationIndex(catalogs);
  const records = plan.map((item) => ({
    entityType: item.record.entityType,
    entity: item.entity,
    support: forgeSheetRootSupportPayload(
      item.entity,
      item.record.entityType,
      index,
      certifiedAt,
    ),
  }));
  const receipt = await applyRecordsAtomically(records, token, key);
  console.log(`Applied ${records.length} Forge/sheet certifications atomically; operation ${receipt.operation_id}`);
  return plan;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runForgeSheetRootSupport().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
