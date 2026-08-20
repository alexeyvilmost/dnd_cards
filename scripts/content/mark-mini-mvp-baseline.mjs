#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import { apiUrl, login } from './api.mjs';
import {
  buildCertificationIndex,
  certificationHashes,
} from './certification-hash.mjs';
import {
  assessMiniMvpCatalogs,
  fetchMiniMvpCatalogs,
} from './mini-mvp-audit.mjs';

const SUPPORT_VERSION = 'mini-mvp-baseline-v1';
const BASELINE_ALLOWED_ISSUES = new Set(['certification_missing', 'dependency_not_ready']);

/** Baseline is intentionally narrow: an entity with any content/mechanics
 * defect remains unmarked instead of receiving a misleading partial badge. */
export function eligibleMiniMvpBaselineRecords(report) {
  return report.records.filter((record) => {
    const codes = record.issues.map((item) => item.code);
    return codes.includes('certification_missing')
      && codes.every((code) => BASELINE_ALLOWED_ISSUES.has(code));
  });
}

export function planMiniMvpBaseline(report, catalogs) {
  return eligibleMiniMvpBaselineRecords(report).map((record) => {
    const matches = (catalogs[record.entityType] ?? [])
      .filter((entity) => entity.id === record.entityId);
    if (matches.length !== 1) {
      throw new Error(`${record.key}: expected one resolved live entity, got ${matches.length}`);
    }
    return { record, entity: matches[0] };
  });
}

export async function runMiniMvpBaseline({
  apply = process.argv.includes('--apply'),
} = {}) {
  const catalogs = await fetchMiniMvpCatalogs();
  const report = assessMiniMvpCatalogs(catalogs);
  const plan = planMiniMvpBaseline(report, catalogs);
  console.log(`${apply ? 'APPLY' : 'DRY-RUN'} ${apiUrl()}: ${plan.length} baseline entities`);
  for (const item of plan) {
    console.log(`  ${apply ? '◔' : '✓'} ${item.record.cardNumber} ${item.record.expectedName} [${item.record.collection}]`);
  }
  if (!apply) return plan;
  if (!process.env.CONTENT_CERTIFICATION_KEY?.trim()) {
    throw new Error('--apply requires CONTENT_CERTIFICATION_KEY');
  }
  const token = await login();
  const index = buildCertificationIndex(catalogs);
  for (const item of plan) {
    const entityType = item.record.entityType;
    const hashes = certificationHashes(item.entity, entityType, index);
    const payload = {
      status: 'verified_partial',
      content_hash: hashes.contentHash,
      dependency_hash: hashes.dependencyHash,
      certification_version: SUPPORT_VERSION,
      limitations: [
        'Пройдены только идентичность mini-MVP manifest, базовая структура live-данных и разрешение ссылок.',
        'Нет отдельного механического сценария и живого прогона этой сущности через реальный лист персонажа.',
      ],
      note: 'Базовый маркер 1/3: он делает отсутствие сценарного покрытия видимым и не подтверждает механику.',
      test_coverage: {
        schema_version: 1,
        scope: SUPPORT_VERSION,
        required: 3,
        passed: 1,
        percent: 33,
      },
      mechanics_locked: false,
    };
    const response = await fetch(
      `${apiUrl()}/api/content-support/${entityType}/${item.entity.id}`,
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
  runMiniMvpBaseline().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
