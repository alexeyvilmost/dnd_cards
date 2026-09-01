#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { apiUrl, login } from './api.mjs';
import {
  buildCertificationIndex,
  certificationHashes,
  sha256Canonical,
} from './certification-hash.mjs';
import { CANTRIP_UPGRADES, EXPECTED_CANTRIP_NAMES } from './cantrips-2024.mjs';
import { postExactSupportBatch } from './exact-support-batch-client.mjs';
import { fetchMiniMvpCatalogs } from './mini-mvp-audit.mjs';

export const MANUAL_CANTRIP_SUPPORT_VERSION = 'mini-mvp-cantrips-manual-v1';

function manualSupport(entity, index, certifiedAt) {
  const declared = CANTRIP_UPGRADES[entity.name]?.support;
  if (!declared?.status?.startsWith('verified_')) {
    throw new Error(`${entity.name}: missing reviewed cantrip support classification`);
  }
  const hashes = certificationHashes(entity, 'spell', index);
  return {
    status: declared.status,
    content_hash: hashes.contentHash,
    dependency_hash: hashes.dependencyHash,
    certification_version: MANUAL_CANTRIP_SUPPORT_VERSION,
    certified_at: certifiedAt,
    limitations: [...(declared.limitations ?? [])],
    note: 'Проверено вручную в листе, бою и по понятности результата; подробности, персонажи и сцены закреплены в mini-MVP checklist/report.',
    test_coverage: {
      schema_version: 1,
      scope: MANUAL_CANTRIP_SUPPORT_VERSION,
      required: 3,
      passed: 3,
      percent: 100,
    },
    mechanics_locked: false,
  };
}

export function planManualCantripSupport(catalogs, certifiedAt) {
  if (typeof certifiedAt !== 'string' || Number.isNaN(Date.parse(certifiedAt))) {
    throw new Error('certifiedAt must be an RFC3339 timestamp');
  }
  if (EXPECTED_CANTRIP_NAMES.length !== 35 || new Set(EXPECTED_CANTRIP_NAMES).size !== 35) {
    throw new Error('manual cantrip denominator must contain exactly 35 unique names');
  }
  const spells = catalogs.spell ?? [];
  const index = buildCertificationIndex(catalogs);
  return EXPECTED_CANTRIP_NAMES.map((name) => {
    const matches = spells.filter((spell) => spell.name === name && Number(spell.level) === 0);
    if (matches.length !== 1) throw new Error(`${name}: expected one live level-0 spell, got ${matches.length}`);
    const entity = matches[0];
    return { entity, support: manualSupport(entity, index, certifiedAt) };
  });
}

export function buildManualCantripSupportBatch(records, operationId = randomUUID()) {
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
      operation: MANUAL_CANTRIP_SUPPORT_VERSION,
      entries,
    }),
    operation_id: `manual-cantrips:${operationId}`,
    expected_count: entries.length,
    entries,
  };
}

export async function runManualCantripSupport({
  apply = process.argv.includes('--apply'),
  certifiedAt = null,
} = {}) {
  const certifiedAtIndex = process.argv.indexOf('--certified-at');
  const timestamp = certifiedAt
    ?? (certifiedAtIndex >= 0 ? process.argv[certifiedAtIndex + 1] : undefined);
  if (!timestamp || timestamp.startsWith('--')) throw new Error('--certified-at is required');
  const records = planManualCantripSupport(await fetchMiniMvpCatalogs(), timestamp);
  console.log(`${apply ? 'APPLY' : 'DRY-RUN'} ${apiUrl()}: ${records.length}/35 exact cantrip rows`);
  for (const { entity, support } of records) {
    console.log(`  ${entity.card_number} ${entity.name}: ${support.status}`);
  }
  if (!apply) return records;
  const key = process.env.CONTENT_CERTIFICATION_KEY?.trim();
  if (!key) throw new Error('--apply requires CONTENT_CERTIFICATION_KEY');
  const receipt = await postExactSupportBatch({
    baseUrl: apiUrl(),
    batch: buildManualCantripSupportBatch(records),
    token: await login(),
    certificationKey: key,
  });
  console.log(`Applied ${records.length} manual cantrip certifications atomically; operation ${receipt.operation_id}`);
  return records;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runManualCantripSupport().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
