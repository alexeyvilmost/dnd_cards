#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { fetchAll } from './api.mjs';
import {
  COLLECTION_ENTITY_TYPES,
  ENTITY_ENDPOINTS,
  resolveManifestEntry,
} from './micro-micro-gate.mjs';
import {
  MICRO_MICRO_MANIFEST,
  flattenMicroMicroManifest,
} from './micro-micro-manifest.mjs';
import {
  buildCertificationIndex,
  certificationHashes,
} from './certification-hash.mjs';

export const MICRO_MICRO_CERTIFICATION_VERSION = 'micro-micro-v1';

export const MICRO_MICRO_LIMITATIONS = Object.freeze({
  classes: [
    'Проверены создание и механика первого уровня; повышение уровня, подклассы и encounter не входят в эту сертификацию.',
  ],
  species: [
    'Проверены сборка первого уровня и доступные базовые особенности; полный набор вариантов вида и encounter не входят в эту сертификацию.',
  ],
  backgrounds: [
    'Проверены выбор, бонусы характеристик и сборка первого уровня; стартовое снаряжение остаётся частично поддержанным.',
  ],
  originFeats: [
    'Проверены выбор, зависимости и применение в сборке первого уровня; граничные сценарии encounter не покрыты.',
  ],
  cantrips: [
    'Проверены выбор, схема и базовое исполнение; цели, длительность, области и полный encounter-цикл покрыты не полностью.',
  ],
  firstLevelSpells: [
    'Проверены выбор, схема, расход слота и базовое исполнение; реакции, концентрация, области, апкаст и полный encounter-цикл покрыты не полностью.',
  ],
  fightingStyles: [
    'Проверены выбор каждого стиля, зависимости и сборка Воина первого уровня; полное боевое исполнение без encounter не покрыто.',
  ],
});

export const MICRO_MICRO_ENTITY_LIMITATIONS = Object.freeze({
  'species.elf': [
    'Особенность «Транс» пока представлена только описанием и не имеет отдельной механической сущности.',
  ],
  'species.dwarf': [
    'Активное Камнечувствие пока не добавляет виброчувствительность в runtime-лист автоматически.',
  ],
  'species.dragonborn': [
    'Оружие дыхания пока расходует действие и использует только конус; Драконий полёт вне среза первого уровня.',
  ],
  'spell.shield': [
    'Реакция проверена как действие листа; автоматическая остановка encounter и иммунитет к Волшебной стреле ещё не покрыты.',
  ],
  'spell.mage-armor': [
    'Проверено наложение метода КЗ на лист; выбор иной цели и encounter-синхронизация ещё не покрыты.',
  ],
});

export async function loadCertificationCatalogs(fetcher = fetchAll) {
  return Object.fromEntries(await Promise.all(
    Object.entries(ENTITY_ENDPOINTS).map(async ([entityType, [path, key]]) => [
      entityType,
      await fetcher(path, key, { limit: 1000 }),
    ]),
  ));
}

export function prepareMicroMicroCertifications(entityGroups, {
  certifiedAt = new Date().toISOString(),
} = {}) {
  const index = buildCertificationIndex(entityGroups);
  return flattenMicroMicroManifest(MICRO_MICRO_MANIFEST).map((item) => {
    const entityType = COLLECTION_ENTITY_TYPES[item.collection];
    const resolved = resolveManifestEntry(item, entityGroups[entityType] ?? []);
    if (!resolved.entity || !['not_certified', 'ready'].includes(resolved.status)) {
      throw new Error(`${item.key}: невозможно сертифицировать (${resolved.status})`);
    }
    const hashes = certificationHashes(resolved.entity, entityType, index);
    const limitations = [
      ...MICRO_MICRO_LIMITATIONS[item.collection],
      ...(MICRO_MICRO_ENTITY_LIMITATIONS[item.key] ?? []),
    ];
    return {
      key: item.key,
      collection: item.collection,
      entity_type: entityType,
      table: ENTITY_ENDPOINTS[entityType][0].replace('/api/', ''),
      id: resolved.entity.id,
      card_number: resolved.entity.card_number,
      name: resolved.entity.name,
      support: {
        status: 'verified_partial',
        content_hash: hashes.contentHash,
        dependency_hash: hashes.dependencyHash,
        certification_version: MICRO_MICRO_CERTIFICATION_VERSION,
        certified_at: certifiedAt,
        limitations,
        note: 'Проверено автоматическим acceptance-аудитом micro-micro-MVP.',
      },
      dependencies: hashes.dependencies,
    };
  });
}

async function main() {
  const entityGroups = await loadCertificationCatalogs();
  const records = prepareMicroMicroCertifications(entityGroups, {
    certifiedAt: '2026-07-28T00:00:00Z',
  });
  const output = process.argv.includes('--seed')
    ? records.map(({ table, card_number, support }) => ({ table, card_number, support }))
    : records;
  console.log(JSON.stringify(output, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
