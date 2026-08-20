#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { apiRequest, apiUrl, fetchAll, login } from './api.mjs';
import {
  buildCertificationIndex,
  certificationHashes,
  sha256Canonical,
} from './certification-hash.mjs';
import { ENTITY_ENDPOINTS } from './micro-micro-gate.mjs';

const definitions = JSON.parse(await readFile(
  new URL('./data/mini-mvp-utility-cantrips.v1.json', import.meta.url),
  'utf8',
));
const weaponDefinitions = JSON.parse(await readFile(
  new URL('./data/mini-mvp-shillelagh-weapons.v1.json', import.meta.url),
  'utf8',
));

const PREIMAGE_HASHES = Object.freeze({
  'SPELL-0173': 'sha256:b76eb874aef0b1eaf2fa0f8b27f9d8e62996dd74d9a905de099cf20915e5518c',
  'SPELL-0194': 'sha256:a72c9f6c14bfe707e3c4a05819732f7298d1986c4154e698a2fe699350a7b185',
  'SPELL-0294': 'sha256:fa83baf45de04b0b233832b605e0c3fe697eba9b7ed2d7bdf259af9a3e7796cf',
  'SPELL-0298': 'sha256:46b9090348d7506ef79ad4f61e92457e4e9cf8f41a038febc7ecda9b544a24c8',
  'SPELL-0312': 'sha256:df3f2b4b0297ce70ce32ddced62eede1245b2203dad3d87afe8e2e76c989c0ef',
});
const SUPPORT_VERSION = 'mini-mvp-utility-cantrips-v1';
const SUPPORT = Object.freeze({
  'SPELL-0173': { passed: 2, required: 3, limitation: 'Состояние руки и ограничения команд проверены; выбор объекта и применение мутации к сцене ещё не встроены в UI карты.' },
  'SPELL-0194': { passed: 3, required: 4, limitation: 'Выбор реального экипированного оружия и проекция атаки проверены; явное событие отпускания оружия ещё не подключено.' },
  'SPELL-0294': { passed: 2, required: 3, limitation: 'Приватная доставка, ответ и блокеры проверены; UI ещё не собирает знакомство с целью и материал препятствия.' },
  'SPELL-0298': { passed: 2, required: 3, limitation: 'Все пять типизированных вариантов проверяются движком; визуальная мутация объектов сцены ещё не подключена.' },
  'SPELL-0312': { passed: 2, required: 3, limitation: 'Стабилизация и сохранение death_saves проверены для mini-MVP 1-го уровня; удвоение дальности на старших уровнях ещё не скомпилировано.' },
  'CARD-0504': { passed: 2, required: 3, limitation: 'Профиль quarterstaff и применение Дубинки проверены; уникальное магическое действие карточки вне этого тестового scope.' },
  'CARD-0568': { passed: 2, required: 3, limitation: 'Профиль club и применение Дубинки проверены; полный самостоятельный каталог атак оружия вне этого тестового scope.' },
  'CARD-0569': { passed: 2, required: 3, limitation: 'Профиль quarterstaff и применение Дубинки проверены; полный самостоятельный каталог атак оружия вне этого тестового scope.' },
  'CARD-0857': { passed: 2, required: 3, limitation: 'Профиль club и применение Дубинки проверены; полный самостоятельный каталог атак оружия вне этого тестового scope.' },
});

export const MINI_MVP_UTILITY_CANTRIP_PATCHES = Object.freeze(definitions.map((definition) => Object.freeze({
  cardNumber: definition.card_number,
  name: definition.name,
  expectedBeforeHash: PREIMAGE_HASHES[definition.card_number],
  expectedAfterHash: sha256Canonical(definition.mechanics),
  mechanics: definition.mechanics,
})));

export const MINI_MVP_SHILLELAGH_WEAPON_PATCHES = Object.freeze(weaponDefinitions.map((definition) => Object.freeze({
  cardNumber: definition.card_number,
  name: definition.name,
  expectedBeforeHash: 'sha256:74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b',
  expectedAfterHash: sha256Canonical(definition.mechanics),
  mechanics: definition.mechanics,
})));

export function planMiniMvpUtilityCantripUpgrade(spells) {
  return MINI_MVP_UTILITY_CANTRIP_PATCHES.map((spec) => {
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

export function planMiniMvpShillelaghWeaponUpgrade(cards) {
  return MINI_MVP_SHILLELAGH_WEAPON_PATCHES.map((spec) => {
    const matches = cards.filter((card) => card.card_number === spec.cardNumber);
    if (matches.length !== 1) {
      throw new Error(`${spec.cardNumber}: expected exactly one live Card, got ${matches.length}`);
    }
    const card = matches[0];
    if (card.name !== spec.name) {
      throw new Error(`${spec.cardNumber}: expected «${spec.name}», got «${card.name}»`);
    }
    const currentHash = sha256Canonical(card.mechanics ?? null);
    if (currentHash !== spec.expectedBeforeHash && currentHash !== spec.expectedAfterHash) {
      throw new Error(
        `${spec.cardNumber}: mechanics drift; expected ${spec.expectedBeforeHash} or ${spec.expectedAfterHash}, got ${currentHash}`,
      );
    }
    return {
      ...spec,
      entityId: card.id,
      support: card.support ?? null,
      currentHash,
      changeRequired: currentHash !== spec.expectedAfterHash,
    };
  });
}

export function assertMiniMvpUtilityCantripPlanUnlocked(plan) {
  const blocked = plan.filter((item) => item.changeRequired && item.support?.mechanics_locked === true);
  if (blocked.length) {
    throw new Error(
      `Locked mechanics must be revoked before apply: ${blocked.map((item) => item.cardNumber).join(', ')}`,
    );
  }
}

async function fetchEntityGroups() {
  return Object.fromEntries(await Promise.all(
    Object.entries(ENTITY_ENDPOINTS).map(async ([entityType, [path, key]]) => [
      entityType,
      await fetchAll(path, key, { limit: 1_000 }),
    ]),
  ));
}

async function markUtilityCoverage(token) {
  const groups = await fetchEntityGroups();
  const index = buildCertificationIndex(groups);
  for (const [cardNumber, coverage] of Object.entries(SUPPORT)) {
    const entityType = cardNumber.startsWith('SPELL-') ? 'spell' : 'card';
    const matches = groups[entityType].filter((entity) => entity.card_number === cardNumber);
    if (matches.length !== 1) throw new Error(`${cardNumber}: cannot mark ambiguous live entity`);
    const entity = matches[0];
    const hashes = certificationHashes(entity, entityType, index);
    const payload = {
      status: 'verified_partial',
      content_hash: hashes.contentHash,
      dependency_hash: hashes.dependencyHash,
      certification_version: SUPPORT_VERSION,
      limitations: [coverage.limitation],
      note: 'Проверено unit + live DB контрактами пакета utility cantrips; незакрытые адаптеры явно перечислены.',
      test_coverage: {
        schema_version: 1,
        scope: SUPPORT_VERSION,
        required: coverage.required,
        passed: coverage.passed,
        percent: Math.floor((coverage.passed * 100) / coverage.required),
      },
      mechanics_locked: false,
    };
    const response = await fetch(`${apiUrl()}/api/content-support/${entityType}/${entity.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Content-Certification-Key': process.env.CONTENT_CERTIFICATION_KEY?.trim() ?? '',
      },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Coverage ${cardNumber} → ${response.status}: ${text.slice(0, 500)}`);
    console.log(`  ◐ ${cardNumber}: ${payload.test_coverage.percent}% (${payload.status})`);
  }
}

export async function runMiniMvpUtilityCantripUpgrade({
  apply = process.argv.includes('--apply'),
  markTested = process.argv.includes('--mark-tested'),
} = {}) {
  const spells = await fetchAll('/api/spells', 'spells', { limit: 1_000 });
  const cards = await fetchAll('/api/cards', 'cards', { limit: 1_000 });
  const plan = [
    ...planMiniMvpUtilityCantripUpgrade(spells).map((item) => ({ ...item, endpoint: 'spells' })),
    ...planMiniMvpShillelaghWeaponUpgrade(cards).map((item) => ({ ...item, endpoint: 'cards' })),
  ];
  console.log(`${apply ? 'APPLY' : 'DRY-RUN'} ${apiUrl()}`);
  for (const item of plan) {
    console.log(`  ${item.changeRequired ? '↻' : '✓'} ${item.cardNumber} ${item.name}`);
  }
  if (!apply) return plan;
  assertMiniMvpUtilityCantripPlanUnlocked(plan);

  const token = await login();
  for (const item of plan.filter((candidate) => candidate.changeRequired)) {
    await apiRequest(token, 'PUT', `/api/${item.endpoint}/${item.entityId}`, { mechanics: item.mechanics });
  }
  const [persistedSpells, persistedCards] = await Promise.all([
    fetchAll('/api/spells', 'spells', { limit: 1_000 }),
    fetchAll('/api/cards', 'cards', { limit: 1_000 }),
  ]);
  const postimage = [
    ...planMiniMvpUtilityCantripUpgrade(persistedSpells).map((item) => ({ ...item, endpoint: 'spells' })),
    ...planMiniMvpShillelaghWeaponUpgrade(persistedCards).map((item) => ({ ...item, endpoint: 'cards' })),
  ];
  const incomplete = postimage.filter((item) => item.changeRequired);
  if (incomplete.length) {
    throw new Error(`Postimage mismatch: ${incomplete.map((item) => item.cardNumber).join(', ')}`);
  }
  if (markTested) {
    if (!process.env.CONTENT_CERTIFICATION_KEY?.trim()) {
      throw new Error('--mark-tested requires CONTENT_CERTIFICATION_KEY');
    }
    await markUtilityCoverage(token);
  }
  return postimage;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runMiniMvpUtilityCantripUpgrade().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
