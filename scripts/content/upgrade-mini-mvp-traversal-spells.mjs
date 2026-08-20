#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { apiRequest, apiUrl, fetchAll, login } from './api.mjs';
import { sha256Canonical } from './certification-hash.mjs';

const definitionsUrl = new URL('./data/mini-mvp-traversal-spells.v1.json', import.meta.url);
const definitions = JSON.parse(await readFile(definitionsUrl, 'utf8'));

const PREIMAGE_HASHES = Object.freeze({
  'SPELL-0295': 'sha256:73df533593e808b9c403e813479c3273cf856ce5b48d8e2c946fe87edaa2a545',
  'SPELL-0253': 'sha256:13777891bde3f0cecd2065f219b05ff38ab20e3ef2352fb35c5e01211ccc75ed',
  'SPELL-0274': 'sha256:33d55577b40c644afa623245c28c2f95f60431bdd2cda57e4e0ae388eb5b0fd1',
});

export const MINI_MVP_TRAVERSAL_SPELL_PATCHES = Object.freeze(definitions.map((definition) => Object.freeze({
  cardNumber: definition.card_number,
  name: definition.name,
  expectedBeforeHash: PREIMAGE_HASHES[definition.card_number],
  expectedAfterHash: sha256Canonical(definition.mechanics),
  mechanics: definition.mechanics,
})));

export function planMiniMvpTraversalSpellUpgrade(spells) {
  return MINI_MVP_TRAVERSAL_SPELL_PATCHES.map((spec) => {
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

export async function runMiniMvpTraversalSpellUpgrade({
  apply = process.argv.includes('--apply'),
} = {}) {
  const spells = await fetchAll('/api/spells', 'spells', { limit: 1_000 });
  const plan = planMiniMvpTraversalSpellUpgrade(spells);
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
  const postimage = planMiniMvpTraversalSpellUpgrade(persisted);
  const incomplete = postimage.filter((item) => item.changeRequired);
  if (incomplete.length > 0) {
    throw new Error(`Postimage mismatch: ${incomplete.map((item) => item.cardNumber).join(', ')}`);
  }
  return postimage;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runMiniMvpTraversalSpellUpgrade().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
