#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { apiRequest, apiUrl, fetchAll, login } from './api.mjs';
import { sha256Canonical } from './certification-hash.mjs';

const definitionsUrl = new URL('./data/mini-mvp-level1-ongoing-spells.v1.json', import.meta.url);
const definitions = JSON.parse(await readFile(definitionsUrl, 'utf8'));

const PREIMAGE_HASHES = Object.freeze({
  'SPELL-0179': 'sha256:bc9251e18ded3368c83348c34caaba791c8ee24bc5637ef3650d86b35e900e04',
  'SPELL-0181': 'sha256:5679cd3aff8a480873fadeefb0295729ab205ad59c4333ed3cccb69e9f632630',
  faerie_fire: 'sha256:86d9ace03b3be9830598ba5cee784cbef5f0975ba7f91e886870b56fd7213ca2',
});

export const MINI_MVP_ONGOING_SPELL_PATCHES = Object.freeze(definitions.map((definition) => Object.freeze({
  cardNumber: definition.card_number,
  name: definition.name,
  expectedBeforeHash: PREIMAGE_HASHES[definition.card_number],
  expectedAfterHash: sha256Canonical(definition.mechanics),
  mechanics: definition.mechanics,
})));

export function planMiniMvpOngoingSpellUpgrade(spells) {
  return MINI_MVP_ONGOING_SPELL_PATCHES.map((spec) => {
    if (!spec.expectedBeforeHash) throw new Error(`${spec.cardNumber}: preimage hash is missing`);
    const matches = spells.filter((spell) => spell.card_number === spec.cardNumber);
    if (matches.length !== 1) {
      throw new Error(`${spec.cardNumber}: expected exactly one live spell, got ${matches.length}`);
    }
    const spell = matches[0];
    if (spell.name !== spec.name) {
      throw new Error(`${spec.cardNumber}: expected «${spec.name}», got «${spell.name}»`);
    }
    const currentHash = sha256Canonical(spell.mechanics);
    if (currentHash !== spec.expectedBeforeHash && currentHash !== spec.expectedAfterHash) {
      throw new Error(
        `${spec.cardNumber}: mechanics drift; expected ${spec.expectedBeforeHash} or ${spec.expectedAfterHash}, got ${currentHash}`,
      );
    }
    return {
      ...spec,
      entityId: spell.id,
      currentHash,
      changeRequired: currentHash !== spec.expectedAfterHash,
    };
  });
}

export async function runMiniMvpOngoingSpellUpgrade({
  apply = process.argv.includes('--apply'),
} = {}) {
  const spells = await fetchAll('/api/spells', 'spells', { limit: 1_000 });
  const plan = planMiniMvpOngoingSpellUpgrade(spells);
  console.log(`${apply ? 'APPLY' : 'DRY-RUN'} ${apiUrl()}`);
  for (const item of plan) {
    console.log(`  ${item.changeRequired ? '↻' : '✓'} ${item.cardNumber} ${item.name}`);
  }
  if (!apply || plan.every((item) => !item.changeRequired)) return plan;

  const token = await login();
  for (const item of plan.filter((candidate) => candidate.changeRequired)) {
    await apiRequest(token, 'PUT', `/api/spells/${item.entityId}`, { mechanics: item.mechanics });
  }

  const persisted = await fetchAll('/api/spells', 'spells', { limit: 1_000 });
  const postimage = planMiniMvpOngoingSpellUpgrade(persisted);
  const incomplete = postimage.filter((item) => item.changeRequired);
  if (incomplete.length > 0) {
    throw new Error(`Postimage mismatch: ${incomplete.map((item) => item.cardNumber).join(', ')}`);
  }
  return postimage;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runMiniMvpOngoingSpellUpgrade().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
