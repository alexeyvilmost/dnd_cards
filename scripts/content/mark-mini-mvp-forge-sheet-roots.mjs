#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { apiUrl, login } from './api.mjs';
import { buildCertificationIndex, certificationHashes } from './certification-hash.mjs';
import { assessMiniMvpCatalogs, fetchMiniMvpCatalogs } from './mini-mvp-audit.mjs';
import { MINI_MVP_MANIFEST } from './mini-mvp-manifest.mjs';

export const FORGE_SHEET_SUPPORT_VERSION = 'mini-mvp-forge-sheet-v1';
export const FORGE_SHEET_ROOT_COLLECTIONS = Object.freeze([
  'classes', 'species', 'backgrounds', 'originFeats',
]);

const fixture = JSON.parse(readFileSync(new URL(
  '../../frontend/src/canon/data/mini-mvp-forge-sheet-fixture.v1.json',
  import.meta.url,
), 'utf8'));

function declaredRootCardNumbers() {
  return new Set(FORGE_SHEET_ROOT_COLLECTIONS.flatMap((collection) => (
    MINI_MVP_MANIFEST.collections[collection].map((entry) => entry.selector.cardNumber)
  )));
}

export function forgeSheetRootCoverageProblems() {
  const problems = [];
  if (fixture.schemaVersion !== 1 || fixture.strategy !== 'cyclic-covering-set-v1') {
    problems.push('Forge fixture has an unsupported schema or strategy');
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

export function forgeSheetRootSupportPayload(entity, entityType, index) {
  const hashes = certificationHashes(entity, entityType, index);
  return {
    status: 'verified_partial',
    content_hash: hashes.contentHash,
    dependency_hash: hashes.dependencyHash,
    certification_version: FORGE_SHEET_SUPPORT_VERSION,
    limitations: [
      'Проверены live-структура, ссылки и завершённая сборка тем же data-driven конвейером, что использует кузница.',
      'Сущность прошла production UI: кузница, атомарное создание, сохранение стартового инвентаря/золота и открытие реального листа.',
      'Отдельные механические сценарии всех выдаваемых действий и эффектов ещё не сертифицированы; варианты снаряжения Б/В не входят в этот браузерный прогон.',
    ],
    note: 'Корневая сущность mini-MVP подтверждена на уровнях данных и реального Forge→sheet; 2/3, без блокировки механики.',
    test_coverage: {
      schema_version: 1,
      scope: FORGE_SHEET_SUPPORT_VERSION,
      required: 3,
      passed: 2,
      percent: 66,
    },
    mechanics_locked: false,
  };
}

export async function runForgeSheetRootSupport({ apply = process.argv.includes('--apply') } = {}) {
  const catalogs = await fetchMiniMvpCatalogs();
  const report = assessMiniMvpCatalogs(catalogs);
  const plan = planForgeSheetRootSupport(report, catalogs);
  console.log(`${apply ? 'APPLY' : 'DRY-RUN'} ${apiUrl()}: ${plan.length} Forge/sheet roots`);
  for (const item of plan) console.log(`  ${apply ? '◑' : '✓'} ${item.record.cardNumber} ${item.record.expectedName}`);
  if (!apply) return plan;
  if (!process.env.CONTENT_CERTIFICATION_KEY?.trim()) throw new Error('--apply requires CONTENT_CERTIFICATION_KEY');
  const token = await login();
  const index = buildCertificationIndex(catalogs);
  for (const item of plan) {
    const payload = forgeSheetRootSupportPayload(
      item.entity,
      item.record.entityType,
      index,
    );
    const response = await fetch(
      `${apiUrl()}/api/content-support/${item.record.entityType}/${item.entity.id}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'X-Content-Certification-Key': process.env.CONTENT_CERTIFICATION_KEY.trim(),
        },
        body: JSON.stringify(payload),
      },
    );
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${item.record.key}: support update returned ${response.status}: ${text.slice(0, 500)}`);
    }
  }
  return plan;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runForgeSheetRootSupport().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
