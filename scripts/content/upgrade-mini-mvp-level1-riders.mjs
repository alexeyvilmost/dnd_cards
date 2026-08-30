#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { apiRequest, apiUrl, fetchAll, login } from './api.mjs';
import { sha256Canonical } from './certification-hash.mjs';

const definitionsUrl = new URL('./data/mini-mvp-level1-spell-primitives.v1.json', import.meta.url);
const definitions = JSON.parse(await readFile(definitionsUrl, 'utf8'));

const PREIMAGE_HASHES = Object.freeze({
  ray_of_sickness: 'sha256:b9e04b442b54606748f2efe15480b2336209a030656381aa3f9f1e5d8230d40f',
  'SPELL-0165': 'sha256:0b7f4a8747c0b16f26fc1742087ca0559046855866d7e1f1b7da22934ac16251',
  'SPELL-0223': 'sha256:0eaa810287d157ea260b9dba43d080cfbae60f73bfcddeb7ebb7880eb9e2b007',
  'SPELL-0267': 'sha256:ab9b4711ed30d427304b1c68664550ffb20b976e00cd46f33dcb9e3040c3e87e',
  'SPELL-0287': 'sha256:8d2538cf1f3d811d1b11204e0b20a785772903ac7a0d230d6e5a466f5f30a8fa',
});

export const MINI_MVP_LEVEL1_RIDER_PATCHES = Object.freeze(definitions.map((definition) => Object.freeze({
  cardNumber: definition.card_number,
  name: definition.name,
  expectedBeforeHash: PREIMAGE_HASHES[definition.card_number],
  expectedAfterHash: sha256Canonical(definition.mechanics),
  mechanics: definition.mechanics,
})));

export function planMiniMvpLevel1RiderUpgrade(spells) {
  return MINI_MVP_LEVEL1_RIDER_PATCHES.map((spec) => {
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

export async function runMiniMvpLevel1RiderUpgrade({
  apply = process.argv.includes('--apply'),
} = {}) {
  const spells = await fetchAll('/api/spells', 'spells', { limit: 1_000 });
  const plan = planMiniMvpLevel1RiderUpgrade(spells);
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
  const postimage = planMiniMvpLevel1RiderUpgrade(persisted);
  const incomplete = postimage.filter((item) => item.changeRequired);
  if (incomplete.length > 0) {
    throw new Error(`Postimage mismatch: ${incomplete.map((item) => item.cardNumber).join(', ')}`);
  }
  return postimage;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runMiniMvpLevel1RiderUpgrade().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
