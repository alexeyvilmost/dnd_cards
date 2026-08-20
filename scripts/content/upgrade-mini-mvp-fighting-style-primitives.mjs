#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { apiRequest, apiUrl, fetchAll, login } from './api.mjs';
import { sha256Canonical } from './certification-hash.mjs';

const definitions = JSON.parse(await readFile(new URL(
  './data/mini-mvp-fighting-style-primitives.v1.json',
  import.meta.url,
), 'utf8'));

const PREIMAGE_HASHES = Object.freeze({
  fs_dueling: 'sha256:4f466c9700cebb5cf09fc96380007c8fc8338b0b5dc289257e10e6804256291f',
  fs_great_weapon: 'sha256:2fc033d7179afc20acbbfc522b9ab18b6c895223cdbcd561ad4f290f18ed230d',
  fs_blind_fighting: 'sha256:20e0c47da5379ce8ddd331412d1e5e25eaeae785e1be1b5116a9badd98fb7aa1',
  fs_thrown_weapon: 'sha256:8818befe7a71bc21cfbaf2064d0f026cac43d741b5cfb273115b68fc164cf295',
});

export const MINI_MVP_FIGHTING_STYLE_PRIMITIVE_PATCHES = Object.freeze(
  definitions.map((definition) => Object.freeze({
    cardNumber: definition.card_number,
    name: definition.name,
    mechanics: definition.mechanics,
    expectedBeforeHash: PREIMAGE_HASHES[definition.card_number],
    expectedAfterHash: sha256Canonical(definition.mechanics),
  })),
);

export function planMiniMvpFightingStylePrimitiveUpgrade(effects) {
  return MINI_MVP_FIGHTING_STYLE_PRIMITIVE_PATCHES.map((spec) => {
    if (!spec.expectedBeforeHash) throw new Error(`${spec.cardNumber}: preimage hash is missing`);
    const matches = effects.filter((effect) => effect.card_number === spec.cardNumber);
    if (matches.length !== 1) {
      throw new Error(`${spec.cardNumber}: expected exactly one live effect, got ${matches.length}`);
    }
    const effect = matches[0];
    if (effect.name !== spec.name) {
      throw new Error(`${spec.cardNumber}: expected «${spec.name}», got «${effect.name}»`);
    }
    const currentHash = sha256Canonical(effect.mechanics);
    if (currentHash !== spec.expectedBeforeHash && currentHash !== spec.expectedAfterHash) {
      throw new Error(
        `${spec.cardNumber}: mechanics drift; expected ${spec.expectedBeforeHash} or ${spec.expectedAfterHash}, got ${currentHash}`,
      );
    }
    return {
      ...spec,
      entityId: effect.id,
      support: effect.support ?? null,
      currentHash,
      changeRequired: currentHash !== spec.expectedAfterHash,
    };
  });
}

export function assertMiniMvpFightingStylePlanUnlocked(plan) {
  const blocked = plan.filter((item) => (
    item.changeRequired && item.support?.mechanics_locked === true
  ));
  if (blocked.length > 0) {
    throw new Error(
      `Locked mechanics must be revoked before apply: ${blocked.map((item) => item.cardNumber).join(', ')}`,
    );
  }
}

export async function runMiniMvpFightingStylePrimitiveUpgrade({
  apply = process.argv.includes('--apply'),
} = {}) {
  const effects = await fetchAll('/api/effects', 'effects', { limit: 1_000 });
  const plan = planMiniMvpFightingStylePrimitiveUpgrade(effects);
  console.log(`${apply ? 'APPLY' : 'DRY-RUN'} ${apiUrl()}`);
  for (const item of plan) {
    console.log(`  ${item.changeRequired ? '↻' : '✓'} ${item.cardNumber} ${item.name}`);
  }
  if (!apply || plan.every((item) => !item.changeRequired)) return plan;
  assertMiniMvpFightingStylePlanUnlocked(plan);
  const token = await login();
  for (const item of plan.filter((candidate) => candidate.changeRequired)) {
    await apiRequest(token, 'PUT', `/api/effects/${item.entityId}`, { mechanics: item.mechanics });
  }
  const persisted = await fetchAll('/api/effects', 'effects', { limit: 1_000 });
  const postimage = planMiniMvpFightingStylePrimitiveUpgrade(persisted);
  const incomplete = postimage.filter((item) => item.changeRequired);
  if (incomplete.length > 0) {
    throw new Error(`Postimage mismatch: ${incomplete.map((item) => item.cardNumber).join(', ')}`);
  }
  return postimage;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runMiniMvpFightingStylePrimitiveUpgrade().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
