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

export const MINI_MVP_SPELL_ACTIVATION_SUPPORT_VERSION = 'mini-mvp-spell-activation-v1';
const VISIBLE = new Set(['verified_partial', 'verified_mechanical']);
const LIMITATION = 'Подтверждены доступность из Forge/листа, schema, targeting-adapter, sheet projection, экономика слота и режим активации; полный исход каждого заклинания остаётся в отдельных semantic/manual сценариях.';

function denominator() {
  return [
    ...MINI_MVP_MANIFEST.collections.cantrips,
    ...MINI_MVP_MANIFEST.collections.firstLevelSpells,
  ];
}

export function spellActivationSupportPayload(entity, index, certifiedAt) {
  const hashes = certificationHashes(entity, 'spell', index);
  return {
    status: 'verified_partial',
    content_hash: hashes.contentHash,
    dependency_hash: hashes.dependencyHash,
    certification_version: MINI_MVP_SPELL_ACTIVATION_SUPPORT_VERSION,
    certified_at: certifiedAt,
    limitations: [LIMITATION],
    note: 'Заклинание прошло exact 98-row activation catalog через реальную границу Forge/Character Sheet.',
    test_coverage: {
      schema_version: 1,
      scope: MINI_MVP_SPELL_ACTIVATION_SUPPORT_VERSION,
      required: 5,
      passed: 5,
      percent: 100,
    },
    mechanics_locked: false,
  };
}

export function planMiniMvpSpellActivationSupport(catalogs, certifiedAt) {
  if (typeof certifiedAt !== 'string' || Number.isNaN(Date.parse(certifiedAt))) {
    throw new Error('certifiedAt must be an RFC3339 timestamp');
  }
  const spells = catalogs.spell ?? [];
  const index = buildCertificationIndex(catalogs);
  const entries = denominator();
  if (entries.length !== 98 || new Set(entries.map((entry) => entry.selector.cardNumber)).size !== 98) {
    throw new Error('mini-MVP spell denominator must contain 98 unique rows');
  }
  return entries.map((record) => {
    const cardNumber = record.selector.cardNumber;
    const matches = spells.filter((spell) => spell.card_number === cardNumber);
    if (matches.length !== 1) throw new Error(`${cardNumber}: expected one live spell, got ${matches.length}`);
    const entity = matches[0];
    if (entity.name !== record.label) {
      throw new Error(`${cardNumber}: expected «${record.label}», got «${entity.name}»`);
    }
    const status = entity.support?.status ?? 'untested';
    if (!VISIBLE.has(status) && status !== 'untested') {
      throw new Error(`${cardNumber}: refusing unexpected support status ${status}`);
    }
    return {
      cardNumber,
      entity,
      changeRequired: !VISIBLE.has(status),
      support: spellActivationSupportPayload(entity, index, certifiedAt),
    };
  });
}

export function buildMiniMvpSpellActivationSupportBatch(records, operationId = randomUUID()) {
  const entries = records.map((record) => ({
    entity_type: 'spell',
    entity_id: record.entity.id,
    expected_current: record.entity,
    support: record.support,
  }));
  return {
    schema_version: 1,
    mode: 'certification_apply',
    plan_hash: sha256Canonical({
      schemaVersion: 1,
      operation: MINI_MVP_SPELL_ACTIVATION_SUPPORT_VERSION,
      entries,
    }),
    operation_id: `mini-mvp-spell-activation:${operationId}`,
    expected_count: entries.length,
    entries,
  };
}

export async function runMiniMvpSpellActivationSupport({
  apply = process.argv.includes('--apply'),
  certifiedAt = null,
} = {}) {
  const certifiedAtIndex = process.argv.indexOf('--certified-at');
  const timestamp = certifiedAt ?? (certifiedAtIndex >= 0 ? process.argv[certifiedAtIndex + 1] : undefined);
  if (!timestamp || timestamp.startsWith('--')) throw new Error('--certified-at is required');
  const catalogs = await fetchMiniMvpCatalogs();
  const complete = planMiniMvpSpellActivationSupport(catalogs, timestamp);
  const pending = complete.filter((entry) => entry.changeRequired);
  console.log(`${apply ? 'APPLY' : 'DRY-RUN'} ${apiUrl()}: ${complete.length - pending.length}/98 already visible; ${pending.length} pending`);
  for (const item of pending) console.log(`  ${apply ? '◑' : '✓'} ${item.cardNumber} ${item.entity.name}`);
  if (!apply || pending.length === 0) return complete;
  const key = process.env.CONTENT_CERTIFICATION_KEY?.trim();
  if (!key) throw new Error('--apply requires CONTENT_CERTIFICATION_KEY');
  const token = await login();
  const batch = buildMiniMvpSpellActivationSupportBatch(pending);
  const receipt = await postExactSupportBatch({
    baseUrl: apiUrl(), batch, token, certificationKey: key,
  });
  console.log(`Applied ${pending.length} spell activation certifications atomically; operation ${receipt.operation_id}`);
  return complete;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runMiniMvpSpellActivationSupport().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
