#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import { apiUrl, login } from './api.mjs';
import { buildCertificationIndex } from './certification-hash.mjs';
import { assessMiniMvpCatalogs, fetchMiniMvpCatalogs } from './mini-mvp-audit.mjs';
import { miniMvpBaselineSupportPayload } from './mark-mini-mvp-baseline.mjs';

export const STRUCTURAL_REPAIR_SUPPORT_TARGETS = Object.freeze([
  'CLASS-bard', 'CLASS-warrior', 'CLASS-wizard', 'CLASS-druid', 'CLASS-cleric',
  'CLASS-warlock', 'CLASS-paladin', 'CLASS-rogue', 'CLASS-ranger', 'CLASS-sorcerer',
  'RACE-0003', 'RACE-0002', 'FEAT-0009',
]);

export function planStructuralRepairSupport(report, catalogs) {
  return STRUCTURAL_REPAIR_SUPPORT_TARGETS.map((cardNumber) => {
    const records = report.records.filter((record) => record.cardNumber === cardNumber);
    if (records.length !== 1) throw new Error(`${cardNumber}: expected one audit record, got ${records.length}`);
    const record = records[0];
    const blocking = record.issues.filter((item) => (
      item.kind === 'data' || item.code === 'reference_unresolved'
    ));
    if (blocking.length > 0) {
      throw new Error(`${cardNumber}: structural repair is not clean: ${blocking.map((item) => item.code).join(', ')}`);
    }
    const matches = (catalogs[record.entityType] ?? []).filter((entity) => entity.id === record.entityId);
    if (matches.length !== 1) throw new Error(`${cardNumber}: expected one live entity, got ${matches.length}`);
    return { record, entity: matches[0] };
  });
}

export async function runStructuralRepairSupport({ apply = process.argv.includes('--apply') } = {}) {
  const catalogs = await fetchMiniMvpCatalogs();
  const report = assessMiniMvpCatalogs(catalogs);
  const plan = planStructuralRepairSupport(report, catalogs);
  console.log(`${apply ? 'APPLY' : 'DRY-RUN'} ${apiUrl()}: ${plan.length} repaired entities`);
  for (const item of plan) console.log(`  ${apply ? '◔' : '✓'} ${item.record.cardNumber} ${item.record.expectedName}`);
  if (!apply) return plan;
  if (!process.env.CONTENT_CERTIFICATION_KEY?.trim()) throw new Error('--apply requires CONTENT_CERTIFICATION_KEY');
  const token = await login();
  const index = buildCertificationIndex(catalogs);
  for (const item of plan) {
    const payload = miniMvpBaselineSupportPayload(
      item.entity,
      item.record.entityType,
      index,
      { note: 'Структурные данные приведены к mini-MVP manifest; маркер сознательно сброшен до 1/3 до отдельного сценарного прогона.' },
    );
    const response = await fetch(`${apiUrl()}/api/content-support/${item.record.entityType}/${item.entity.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Content-Certification-Key': process.env.CONTENT_CERTIFICATION_KEY.trim(),
      },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${item.record.key}: support update returned ${response.status}: ${text.slice(0, 500)}`);
  }
  return plan;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runStructuralRepairSupport().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
