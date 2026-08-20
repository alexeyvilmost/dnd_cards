#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import { apiRequest, apiUrl, fetchAll, login } from './api.mjs';
import { sha256Canonical } from './certification-hash.mjs';
import { CANTRIP_UPGRADES } from './cantrips-2024.mjs';

export const MINI_MVP_CANTRIP_PRIMITIVE_PATCHES = Object.freeze([
  {
    cardNumber: 'SPELL-0202',
    name: 'Защита от оружия',
    expectedBeforeHash: 'sha256:74b8a3aa69568891394c7545cdb7a7978055d51eac7634e2d008495348316a0e',
  },
  {
    cardNumber: 'SPELL-0224',
    name: 'Меткий удар',
    expectedBeforeHash: 'sha256:c224db75396c8c8006fb9aae7103fe2295ec27fd31b2a76cbad5a27ea13beb81',
  },
  {
    cardNumber: 'SPELL-0315',
    name: 'Чародейский выброс',
    expectedBeforeHash: 'sha256:06d1a9a929d7922e8ab3fb8eacfb3435fb91a0d87032d17c60bd8ac7c4bd468a',
  },
  {
    cardNumber: 'thaumaturgy',
    name: 'Чудотворство',
    expectedBeforeHash: 'sha256:8735998cf879b073bee3602ae24deed668b090e12e9394cda4eea9426f41f9c9',
  },
].map((spec) => Object.freeze({
  ...spec,
  mechanics: CANTRIP_UPGRADES[spec.name].mechanics,
  expectedAfterHash: sha256Canonical(CANTRIP_UPGRADES[spec.name].mechanics),
})));

export function planMiniMvpCantripPrimitiveUpgrade(spells) {
  return MINI_MVP_CANTRIP_PRIMITIVE_PATCHES.map((spec) => {
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

export async function runMiniMvpCantripPrimitiveUpgrade({
  apply = process.argv.includes('--apply'),
} = {}) {
  const spells = await fetchAll('/api/spells', 'spells', { limit: 1_000 });
  const plan = planMiniMvpCantripPrimitiveUpgrade(spells);
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
  const postimage = planMiniMvpCantripPrimitiveUpgrade(persisted);
  const incomplete = postimage.filter((item) => item.changeRequired);
  if (incomplete.length > 0) {
    throw new Error(`Postimage mismatch: ${incomplete.map((item) => item.cardNumber).join(', ')}`);
  }
  return postimage;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runMiniMvpCantripPrimitiveUpgrade().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

