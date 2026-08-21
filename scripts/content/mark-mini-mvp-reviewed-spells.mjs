#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import { apiUrl, fetchAll, login } from './api.mjs';
import {
  buildCertificationIndex,
  certificationHashes,
  sha256Canonical,
} from './certification-hash.mjs';
import { ENTITY_ENDPOINTS } from './micro-micro-gate.mjs';
import { MINI_MVP_CANTRIP_PRIMITIVE_PATCHES } from './upgrade-mini-mvp-cantrip-primitives.mjs';
import { MINI_MVP_LEVEL1_RIDER_PATCHES } from './upgrade-mini-mvp-level1-riders.mjs';
import { MINI_MVP_ONGOING_SPELL_PATCHES } from './upgrade-mini-mvp-ongoing-spells.mjs';
import { MINI_MVP_TRAVERSAL_SPELL_PATCHES } from './upgrade-mini-mvp-traversal-spells.mjs';
import { MINI_MVP_CONTROL_SPELL_PATCHES } from './upgrade-mini-mvp-control-spells.mjs';

const SUPPORT_VERSION = 'mini-mvp-reviewed-spells-v1';
const REAL_SHEET_LIMITATION = 'Для этой сущности ещё нет отдельного живого прогона через реальный лист персонажа; пройдены unit- и live-DB-контракты.';

function narrativeLimitations(value, output = []) {
  if (Array.isArray(value)) {
    for (const item of value) narrativeLimitations(item, output);
  } else if (value && typeof value === 'object') {
    if (value.kind === 'narrative') {
      const text = value.description ?? value.text;
      if (typeof text === 'string' && text.trim()) output.push(text.trim());
    }
    for (const item of Object.values(value)) narrativeLimitations(item, output);
  }
  return output;
}

function groupSpecs(group, specs) {
  return specs.map((spec) => Object.freeze({
    ...spec,
    group,
    limitations: [...new Set([
      ...narrativeLimitations(spec.mechanics),
      REAL_SHEET_LIMITATION,
    ])],
  }));
}

export const REVIEWED_SPELL_SUPPORT_SPECS = Object.freeze([
  ...groupSpecs('cantrip-primitives', MINI_MVP_CANTRIP_PRIMITIVE_PATCHES),
  ...groupSpecs('level1-riders', MINI_MVP_LEVEL1_RIDER_PATCHES),
  ...groupSpecs('ongoing-spells', MINI_MVP_ONGOING_SPELL_PATCHES),
  ...groupSpecs('traversal-spells', MINI_MVP_TRAVERSAL_SPELL_PATCHES),
  ...groupSpecs('control-spells', MINI_MVP_CONTROL_SPELL_PATCHES),
]);

// Class-list UUIDs are transport/catalog linkage injected by migration 107.
// They do not change the reviewed executable spell contract and therefore must
// not invalidate a semantic postimage produced before that linkage existed.
function executableSpellMechanics(mechanics) {
  if (!mechanics || typeof mechanics !== 'object' || Array.isArray(mechanics)) return mechanics;
  const { spell_class_list_ids: _catalogLinks, ...executable } = mechanics;
  return executable;
}

export function planReviewedSpellSupport(spells) {
  const seen = new Set();
  return REVIEWED_SPELL_SUPPORT_SPECS.map((spec) => {
    if (seen.has(spec.cardNumber)) throw new Error(`${spec.cardNumber}: duplicate reviewed support spec`);
    seen.add(spec.cardNumber);
    const matches = spells.filter((spell) => spell.card_number === spec.cardNumber);
    if (matches.length !== 1) {
      throw new Error(`${spec.cardNumber}: expected exactly one live spell, got ${matches.length}`);
    }
    const entity = matches[0];
    if (entity.name !== spec.name) {
      throw new Error(`${spec.cardNumber}: expected «${spec.name}», got «${entity.name}»`);
    }
    const mechanicsHash = sha256Canonical(entity.mechanics);
    const executableHash = sha256Canonical(executableSpellMechanics(entity.mechanics));
    const reviewedExecutableHash = sha256Canonical(executableSpellMechanics(spec.mechanics));
    if (executableHash !== reviewedExecutableHash) {
      throw new Error(`${spec.cardNumber}: live mechanics differ from reviewed postimage; got ${executableHash}`);
    }
    return { ...spec, entity, mechanicsHash, executableHash, reviewedExecutableHash };
  });
}

async function fetchEntityGroups() {
  return Object.fromEntries(await Promise.all(
    Object.entries(ENTITY_ENDPOINTS).map(async ([entityType, [path, key]]) => [
      entityType,
      await fetchAll(path, key, { limit: 1_000 }),
    ]),
  ));
}

export async function runReviewedSpellSupport({
  apply = process.argv.includes('--apply'),
} = {}) {
  const groups = await fetchEntityGroups();
  const plan = planReviewedSpellSupport(groups.spell);
  console.log(`${apply ? 'APPLY' : 'DRY-RUN'} ${apiUrl()}`);
  for (const item of plan) console.log(`  ${apply ? '◐' : '✓'} ${item.cardNumber} ${item.name} [${item.group}]`);
  if (!apply) return plan;
  if (!process.env.CONTENT_CERTIFICATION_KEY?.trim()) {
    throw new Error('--apply requires CONTENT_CERTIFICATION_KEY');
  }
  const token = await login();
  const index = buildCertificationIndex(groups);
  for (const item of plan) {
    const hashes = certificationHashes(item.entity, 'spell', index);
    const payload = {
      status: 'verified_partial',
      content_hash: hashes.contentHash,
      dependency_hash: hashes.dependencyHash,
      certification_version: SUPPORT_VERSION,
      limitations: item.limitations,
      note: `Механика подтверждена пакетом ${item.group}; маркер не является полной mini-MVP сертификацией.`,
      test_coverage: {
        schema_version: 1,
        scope: SUPPORT_VERSION,
        required: 3,
        passed: 2,
        percent: 66,
      },
      mechanics_locked: false,
    };
    const response = await fetch(`${apiUrl()}/api/content-support/spell/${item.entity.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Content-Certification-Key': process.env.CONTENT_CERTIFICATION_KEY.trim(),
      },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${item.cardNumber}: support update returned ${response.status}: ${text.slice(0, 500)}`);
  }
  return plan;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runReviewedSpellSupport().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
