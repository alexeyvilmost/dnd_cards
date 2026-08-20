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
  new URL('./data/mini-mvp-utility-level1-spells.v1.json', import.meta.url),
  'utf8',
));

const PREIMAGE_HASHES = Object.freeze({
  'SPELL-0161': 'sha256:913bffa939d36965cf795bc3d446beece2a9813d06b1b63f0024e3e913f1d814',
  'SPELL-0188': 'sha256:3fc2e4d21af25cbd83ff11c9926962e05de309e6f0fdd71a0189d0fcfa3c4c3e',
  'SPELL-0206': 'sha256:c6677bc6be6d5ca21c8037ff24db25825224e197046737872ac7ac6f93d64134',
  'SPELL-0222': 'sha256:5237649e188c76d3147080d74b02bb6fec3cdfbc47fe5cb90ca4695c3e7b1032',
  'SPELL-0232': 'sha256:f9510a849449b7fcddcf28bd6742a083adefb1e6c7067c450edbb330b5b31fd2',
  'SPELL-0237': 'sha256:1ffd01bd16795752bf3552de7a9a4c0d272f7585577e5cf72a969053aefa542d',
  'SPELL-0245': 'sha256:f619c9a78996203db254882de4cef9c269b7a2abcd262cab65101de55438f792',
  'SPELL-0256': 'sha256:c5b1c0a8e7ebcfaeca7f4c54a8c06b6047d7cd69ec7001bdcf28a00e7ff0ff9a',
  'SPELL-0265': 'sha256:5b1365f18226d03aba076c4d38d42264afb26e3e3ba834f2205daf1e7e317379',
  'SPELL-0277': 'sha256:2b5498945034c1bc02c5cb79172b953acb4c682b5c851bad0c7263d122e6aa78',
  'SPELL-0288': 'sha256:dbe67ededa255a3174e9cef3de7d38c44e17040bea55223c821369957a58d9df',
  'SPELL-0296': 'sha256:c9dcc98d7f18c3d67db0a37f192cfdbcc0a553c43cf6fd457a5504115157424f',
  'SPELL-0303': 'sha256:b29c34c91ec0da22d46654f92e95db4e99e2597c595900af9f662e917b1c8ab6',
});

const SUPPORT_VERSION = 'mini-mvp-utility-level1-v1';
const LIMITATIONS = Object.freeze({
  'SPELL-0161': 'Состояние, обнаружение и управление иллюзией проверены; размещение и визуальная смена образа ещё не подключены к карте.',
  'SPELL-0188': 'Количество, срок, Бонусное действие, лечение и насыщение проверены; передача ягод другому существу ещё не подключена к инвентарю сцены.',
  'SPELL-0206': 'Политика чтения и жизненный цикл иллюзии проверены; текст документа, читатели и расход материального компонента остаются за адаптером предметов.',
  'SPELL-0222': 'Ограничения облика и обнаружение проверены; редактор внешности и физический контакт ещё не подключены к UI сцены.',
  'SPELL-0232': 'Стат-блок, запрет атаки, команда, скорость и привязка проверены; отдельный актёр и токен слуги ещё не создаются на карте.',
  'SPELL-0237': 'Типы существ, дальность и материальные блокеры проверены; карта ещё не передаёт движку типы и препятствия.',
  'SPELL-0245': 'Набор раскрываемых сведений типизирован; выбор объекта и проекция свойств реального предмета ещё не подключены к сцене.',
  'SPELL-0256': 'Грузоподъёмность, дистанции и перепады высоты закреплены данными; автоматическое следование и сброс груза ещё не подключены к карте.',
  'SPELL-0265': 'Режимы языка, касание и время чтения проверены; выбор текста и минутный прогресс чтения ещё не подключены к UI.',
  'SPELL-0277': 'Ограничение Зверьми, речь и доступ к Влиянию проверены; диалог и знания конкретного зверя остаются за адаптером сцены.',
  'SPELL-0288': 'Оба режима, дальности, исключения и срабатывание проверены; размещение зоны и автоматическое обнаружение входа ещё не подключены к карте.',
  'SPELL-0296': 'Все четыре варианта и их пределы типизированы; фактическая мутация воды, огня и тумана ещё не подключена к сцене.',
  'SPELL-0303': 'Геометрия, сильное заслонение, длительность, развеивание ветром и масштабирование закреплены; LOS карты ещё не читает эту зону.',
});

export const MINI_MVP_UTILITY_LEVEL1_PATCHES = Object.freeze(definitions.map((definition) => Object.freeze({
  cardNumber: definition.card_number,
  name: definition.name,
  expectedBeforeHash: PREIMAGE_HASHES[definition.card_number],
  expectedAfterHash: sha256Canonical(definition.mechanics),
  mechanics: definition.mechanics,
})));

export function planMiniMvpUtilityLevel1Upgrade(spells) {
  return MINI_MVP_UTILITY_LEVEL1_PATCHES.map((spec) => {
    const matches = spells.filter((spell) => spell.card_number === spec.cardNumber);
    if (matches.length !== 1) {
      throw new Error(`${spec.cardNumber}: expected exactly one live spell, got ${matches.length}`);
    }
    const entity = matches[0];
    if (entity.name !== spec.name) {
      throw new Error(`${spec.cardNumber}: expected «${spec.name}», got «${entity.name}»`);
    }
    const currentHash = sha256Canonical(entity.mechanics);
    if (currentHash !== spec.expectedBeforeHash && currentHash !== spec.expectedAfterHash) {
      throw new Error(
        `${spec.cardNumber}: mechanics drift; expected ${spec.expectedBeforeHash} or ${spec.expectedAfterHash}, got ${currentHash}`,
      );
    }
    return {
      ...spec,
      entityId: entity.id,
      support: entity.support ?? null,
      currentHash,
      changeRequired: currentHash !== spec.expectedAfterHash,
    };
  });
}

export function assertMiniMvpUtilityLevel1PlanUnlocked(plan) {
  const blocked = plan.filter((item) => item.changeRequired && item.support?.mechanics_locked === true);
  if (blocked.length) {
    throw new Error(`Locked mechanics must be revoked before apply: ${blocked.map((item) => item.cardNumber).join(', ')}`);
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

async function markCoverage(token) {
  const groups = await fetchEntityGroups();
  const index = buildCertificationIndex(groups);
  for (const spec of MINI_MVP_UTILITY_LEVEL1_PATCHES) {
    const matches = groups.spell.filter((entity) => entity.card_number === spec.cardNumber);
    if (matches.length !== 1) throw new Error(`${spec.cardNumber}: cannot mark ambiguous live entity`);
    const entity = matches[0];
    const hashes = certificationHashes(entity, 'spell', index);
    const payload = {
      status: 'verified_partial',
      content_hash: hashes.contentHash,
      dependency_hash: hashes.dependencyHash,
      certification_version: SUPPORT_VERSION,
      limitations: [LIMITATIONS[spec.cardNumber]],
      note: 'Пакет проверен unit + live DB и репрезентативным прогоном реального листа; незакрытый адаптер сцены явно указан.',
      test_coverage: {
        schema_version: 1,
        scope: SUPPORT_VERSION,
        required: 3,
        passed: 2,
        percent: 66,
      },
      mechanics_locked: false,
    };
    const response = await fetch(`${apiUrl()}/api/content-support/spell/${entity.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Content-Certification-Key': process.env.CONTENT_CERTIFICATION_KEY?.trim() ?? '',
      },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Coverage ${spec.cardNumber} → ${response.status}: ${text.slice(0, 500)}`);
    console.log(`  ◐ ${spec.cardNumber}: ${payload.test_coverage.percent}% (${payload.status})`);
  }
}

export async function runMiniMvpUtilityLevel1Upgrade({
  apply = process.argv.includes('--apply'),
  markTested = process.argv.includes('--mark-tested'),
} = {}) {
  const spells = await fetchAll('/api/spells', 'spells', { limit: 1_000 });
  const plan = planMiniMvpUtilityLevel1Upgrade(spells);
  console.log(`${apply ? 'APPLY' : 'DRY-RUN'} ${apiUrl()}`);
  for (const item of plan) console.log(`  ${item.changeRequired ? '↻' : '✓'} ${item.cardNumber} ${item.name}`);
  if (!apply) return plan;
  assertMiniMvpUtilityLevel1PlanUnlocked(plan);
  const token = await login();
  for (const item of plan.filter((candidate) => candidate.changeRequired)) {
    await apiRequest(token, 'PUT', `/api/spells/${item.entityId}`, { mechanics: item.mechanics });
  }
  const postimage = planMiniMvpUtilityLevel1Upgrade(
    await fetchAll('/api/spells', 'spells', { limit: 1_000 }),
  );
  const incomplete = postimage.filter((item) => item.changeRequired);
  if (incomplete.length) throw new Error(`Postimage mismatch: ${incomplete.map((item) => item.cardNumber).join(', ')}`);
  if (markTested) {
    if (!process.env.CONTENT_CERTIFICATION_KEY?.trim()) {
      throw new Error('--mark-tested requires CONTENT_CERTIFICATION_KEY');
    }
    await markCoverage(token);
  }
  return postimage;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runMiniMvpUtilityLevel1Upgrade().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
