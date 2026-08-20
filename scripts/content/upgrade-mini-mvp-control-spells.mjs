#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { apiRequest, apiUrl, fetchAll, login } from './api.mjs';
import { sha256Canonical } from './certification-hash.mjs';

const definitions = JSON.parse(await readFile(
  new URL('./data/mini-mvp-control-spells.v1.json', import.meta.url),
  'utf8',
));

const PREIMAGE_HASHES = Object.freeze({
  'SPELL-0201': 'sha256:250d839c870d791c5a4f77dfb5507322da89ab761298504411703756fd1cbc63',
  'SPELL-0272': 'sha256:0f3237ac3af7d14fb401c03d2d65e710c66fb8da814ede6ef790b607b8a3ea59',
  'SPELL-0306': 'sha256:1b202c32188da273f09567d760be54a6e2f3d43db54d717d1bff3d324c9e01f7',
});

export const MINI_MVP_CONTROL_SPELL_PATCHES = Object.freeze(definitions.map((definition) => Object.freeze({
  cardNumber: definition.card_number,
  name: definition.name,
  expectedBeforeHash: PREIMAGE_HASHES[definition.card_number],
  expectedAfterHash: sha256Canonical(definition.mechanics),
  mechanics: definition.mechanics,
})));

export function planMiniMvpControlSpellUpgrade(spells) {
  return MINI_MVP_CONTROL_SPELL_PATCHES.map((spec) => {
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
      support: spell.support ?? null,
      currentHash,
      changeRequired: currentHash !== spec.expectedAfterHash,
    };
  });
}

export function assertMiniMvpControlSpellPlanUnlocked(plan) {
  const blocked = plan.filter((item) => item.changeRequired && item.support?.mechanics_locked === true);
  if (blocked.length) {
    throw new Error(
      `Locked mechanics must be revoked before apply: ${blocked.map((item) => item.cardNumber).join(', ')}`,
    );
  }
}

export async function runMiniMvpControlSpellUpgrade({ apply = process.argv.includes('--apply') } = {}) {
  const spells = await fetchAll('/api/spells', 'spells', { limit: 1_000 });
  const plan = planMiniMvpControlSpellUpgrade(spells);
  console.log(`${apply ? 'APPLY' : 'DRY-RUN'} ${apiUrl()}`);
  for (const item of plan) {
    console.log(`  ${item.changeRequired ? '↻' : '✓'} ${item.cardNumber} ${item.name}`);
  }
  if (!apply || plan.every((item) => !item.changeRequired)) return plan;
  assertMiniMvpControlSpellPlanUnlocked(plan);

  const token = await login();
  for (const item of plan.filter((candidate) => candidate.changeRequired)) {
    await apiRequest(token, 'PUT', `/api/spells/${item.entityId}`, { mechanics: item.mechanics });
  }
  const persisted = await fetchAll('/api/spells', 'spells', { limit: 1_000 });
  const postimage = planMiniMvpControlSpellUpgrade(persisted);
  const incomplete = postimage.filter((item) => item.changeRequired);
  if (incomplete.length) {
    throw new Error(`Postimage mismatch: ${incomplete.map((item) => item.cardNumber).join(', ')}`);
  }
  return postimage;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runMiniMvpControlSpellUpgrade().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
