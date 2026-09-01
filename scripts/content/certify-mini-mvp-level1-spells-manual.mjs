#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { apiUrl, login } from './api.mjs';
import {
  buildCertificationIndex,
  certificationHashes,
  sha256Canonical,
} from './certification-hash.mjs';
import { postExactSupportBatch } from './exact-support-batch-client.mjs';
import { fetchMiniMvpCatalogs } from './mini-mvp-audit.mjs';
import { MINI_MVP_MANIFEST } from './mini-mvp-manifest.mjs';

export const MANUAL_LEVEL1_SUPPORT_VERSION = 'mini-mvp-level1-spells-manual-v1';
export const MANUAL_LEVEL1_CHARACTER_IDS = Object.freeze([
  '0fdc8692-d722-4080-9ebc-47a32891e5bd',
  '27220891-0790-4ae6-a648-78130870fce1',
  'b43c121b-971b-4f92-8726-01c724d2734e',
  'e521c39b-5f3a-4c61-a78a-3f9bafb04a9f',
]);

const DEFAULT_PARTIAL_LIMITATION = 'Длительные, площадные и иные последствия без отдельного автоматизированного шага в mini-MVP показаны в журнале как инструкция для ручного разрешения.';

function manualSupport(entity, index, certifiedAt) {
  const hashes = certificationHashes(entity, 'spell', index);
  const previous = entity.support ?? {};
  const previousStatus = typeof previous.status === 'string' && previous.status.startsWith('verified_')
    ? previous.status
    : 'verified_partial';
  return {
    ...previous,
    status: previousStatus,
    content_hash: hashes.contentHash,
    dependency_hash: hashes.dependencyHash,
    certification_version: MANUAL_LEVEL1_SUPPORT_VERSION,
    certified_at: certifiedAt,
    limitations: previousStatus === 'verified_partial'
      ? [...new Set(previous.limitations?.length
        ? previous.limitations
        : [DEFAULT_PARTIAL_LIMITATION])]
      : [...new Set(previous.limitations ?? [])],
    note: `Проверено вручную в листе, бою и по понятности результата. Сохранённые персонажи: ${MANUAL_LEVEL1_CHARACTER_IDS.join(', ')}. Подробности закреплены в mini-MVP checklist/report.`,
    test_coverage: {
      schema_version: 1,
      scope: MANUAL_LEVEL1_SUPPORT_VERSION,
      required: 3,
      passed: 3,
      percent: 100,
    },
    mechanics_locked: previous.mechanics_locked === true,
  };
}

export function planManualLevel1SpellSupport(catalogs, certifiedAt) {
  if (typeof certifiedAt !== 'string' || Number.isNaN(Date.parse(certifiedAt))) {
    throw new Error('certifiedAt must be an RFC3339 timestamp');
  }
  const denominator = MINI_MVP_MANIFEST.collections.firstLevelSpells;
  if (denominator.length !== 64 || new Set(denominator.map((entry) => entry.selector.cardNumber)).size !== 64) {
    throw new Error('manual level-1 spell denominator must contain exactly 64 unique card numbers');
  }
  const spells = catalogs.spell ?? [];
  const index = buildCertificationIndex(catalogs);
  return denominator.map((entry) => {
    const matches = spells.filter((spell) => (
      spell.card_number === entry.selector.cardNumber && Number(spell.level) === 1
    ));
    if (matches.length !== 1) {
      throw new Error(`${entry.selector.cardNumber}: expected one live level-1 spell, got ${matches.length}`);
    }
    const entity = matches[0];
    if (entity.name !== entry.label) {
      throw new Error(`${entry.selector.cardNumber}: expected «${entry.label}», got «${entity.name}»`);
    }
    // Evidence-certified rows are immutable by contract. Their existing
    // approval remains authoritative; the manual checklist adds browser
    // evidence without weakening or rewriting that lock.
    if (entity.support?.mechanics_locked === true) {
      return { entity, support: entity.support, changeRequired: false };
    }
    const support = manualSupport(entity, index, certifiedAt);
    const current = entity.support ?? {};
    const changeRequired = current.certification_version !== MANUAL_LEVEL1_SUPPORT_VERSION
      || current.content_hash !== support.content_hash
      || current.dependency_hash !== support.dependency_hash
      || current.test_coverage?.passed !== 3
      || current.test_coverage?.required !== 3;
    return { entity, support: changeRequired ? support : current, changeRequired };
  });
}

export function buildManualLevel1SpellSupportBatch(records, operationId = randomUUID()) {
  const entries = records.map(({ entity, support }) => ({
    entity_type: 'spell',
    entity_id: entity.id,
    expected_current: entity,
    support,
  }));
  return {
    schema_version: 1,
    mode: 'certification_apply',
    plan_hash: sha256Canonical({
      schemaVersion: 1,
      operation: MANUAL_LEVEL1_SUPPORT_VERSION,
      entries,
    }),
    operation_id: `manual-level1-spells:${operationId}`,
    expected_count: entries.length,
    entries,
  };
}

export async function runManualLevel1SpellSupport({
  apply = process.argv.includes('--apply'),
  certifiedAt = null,
} = {}) {
  const certifiedAtIndex = process.argv.indexOf('--certified-at');
  const timestamp = certifiedAt
    ?? (certifiedAtIndex >= 0 ? process.argv[certifiedAtIndex + 1] : undefined);
  if (!timestamp || timestamp.startsWith('--')) throw new Error('--certified-at is required');
  const records = planManualLevel1SpellSupport(await fetchMiniMvpCatalogs(), timestamp);
  const pending = records.filter((record) => record.changeRequired);
  console.log(`${apply ? 'APPLY' : 'DRY-RUN'} ${apiUrl()}: ${records.length}/64 exact level-1 spell rows; ${pending.length} pending`);
  for (const { entity, support, changeRequired } of records) {
    console.log(`  ${changeRequired ? '◑' : '✓'} ${entity.card_number} ${entity.name}: ${support.status}`);
  }
  if (!apply || pending.length === 0) return records;
  const key = process.env.CONTENT_CERTIFICATION_KEY?.trim();
  if (!key) throw new Error('--apply requires CONTENT_CERTIFICATION_KEY');
  const receipt = await postExactSupportBatch({
    baseUrl: apiUrl(),
    batch: buildManualLevel1SpellSupportBatch(pending),
    token: await login(),
    certificationKey: key,
  });
  console.log(`Applied ${pending.length} manual level-1 spell certifications atomically; operation ${receipt.operation_id}`);
  return records;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runManualLevel1SpellSupport().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
